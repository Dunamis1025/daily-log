import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { displayName, makeT } from './i18n';

/* ───────────── 이 기기에만 저장하는 설정 (언어, 디자인) ─────────────
   기록과 달리 동기화하지 않는다. 폰은 한국어, 아이패드는 영어처럼 기기마다 다르게 둘 수 있다. */

const PREFS_KEY = 'dailylog:prefs';
const THEMES = [
  { id: 'wood', sw: ['#f5efe4', '#7a4b2a', '#3b2a1d'] },
  { id: 'pink', sw: ['#fff3f7', '#ec5b93', '#4d2c3a'] },
  { id: 'dark', sw: ['#0e0f12', '#d2b277', '#ebe8e1'] },
];
const THEME_BAR = { wood: '#f5efe4', pink: '#fff3f7', dark: '#0e0f12' };

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      lang: p.lang === 'en' ? 'en' : 'ko',
      theme: THEMES.some((x) => x.id === p.theme) ? p.theme : 'wood',
    };
  } catch {
    return { lang: 'ko', theme: 'wood' };
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 저장이 막힌 경우는 이번 실행 동안만 적용 */
  }
}

const I18n = React.createContext({ lang: 'ko', t: makeT('ko'), nm: (id, n) => n });
const useI18n = () => useContext(I18n);

/* ───────────── 시간 도구 ─────────────
   모든 시각은 기기의 현지 시간으로 'YYYY-MM-DDTHH:MM' 글자로 저장한다.
   (잠처럼 자정을 넘기는 기록도 시작/끝 날짜가 각각 있어서 계산이 쉽다.) */

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stampStr = (d) => `${dayStr(d)}T${timeStr(d)}`;
const hm = (s) => {
  const [h, m] = s.slice(-5).split(':');
  return `${Number(h)}:${m}`;
};

function parseStamp(s) {
  const [d, t] = s.split('T');
  const [y, m, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, da, h, mi);
}
function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(day, n) {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayStr(d);
}
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
function fmtDur(min, lang) {
  if (lang === 'en') {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
function dayLabel(day, lang) {
  const d = parseDay(day);
  if (lang === 'en') return `${MONTH_EN[d.getMonth()]} ${d.getDate()} (${WEEK_EN[d.getDay()]})`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}
function memoDay(day, lang) {
  const d = parseDay(day);
  if (lang === 'en') return `${MONTH_EN[d.getMonth()]} ${d.getDate()} (${WEEK_EN[d.getDay()]})`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEK[d.getDay()]})`;
}
function entryMin(e) {
  if (!e.end) return null;
  return Math.max(0, Math.round((parseStamp(e.end) - parseStamp(e.start)) / 60000));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* 수정 시각(u): 기기끼리 "누가 더 늦게 고쳤나"를 가릴 때 쓴다. 같은 기기에서는 항상 앞으로만 간다. */
let lastU = 0;
const stampU = () => {
  lastU = Math.max(Date.now(), lastU + 1);
  return lastU;
};

function firstGrapheme(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      for (const x of seg.segment(t)) return x.segment.slice(0, 16);
    }
  } catch {
    /* 아래 방법으로 */
  }
  return Array.from(t).slice(0, 2).join('');
}

/* ───────────── 저장 / 불러오기 (옛 데이터는 자동으로 정리해서 읽는다) ───────────── */

const KEY = 'dailylog:v1'; // 이름은 그대로 두고 안의 구조만 올림 (옛 기록을 그대로 읽기 위해)
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAIN_GROUP = 'g-main';

const DEFAULT_GROUPS = [{ id: MAIN_GROUP, name: '자주 쓰는 항목', o: 10, u: 1 }];
const DEFAULT_HABITS = [
  { id: 'h-sleep', name: '수면', emoji: '😴', kind: 'timed', group: MAIN_GROUP, o: 10, u: 1 },
  { id: 'h-ccna', name: 'CCNA 공부', emoji: '📘', kind: 'timed', group: MAIN_GROUP, o: 20, u: 1 },
  { id: 'h-water', name: '따뜻한 물', emoji: '💧', kind: 'check', group: MAIN_GROUP, o: 30, u: 1 },
  { id: 'h-workout', name: '운동', emoji: '🏃', kind: 'timed', group: MAIN_GROUP, o: 40, u: 1 },
];
const DEFAULT_PHRASES = [
  '따뜻한 물 한 잔',
  '탈모약',
  '프로바이오틱스',
  '삶은 계란 세 개',
  '커피 한 잔',
  '샤워',
  '낮잠',
  '산책',
  '식세기 돌림',
].map((text, i) => ({ id: `p-${i + 1}`, text, o: (i + 1) * 10, u: 1 }));

const SLOT_TIME = { all: '12:00', dawn: '04:00', am: '09:00', pm: '14:00', eve: '19:00', night: '22:00' };
const SLOTS = Object.keys(SLOT_TIME);
const byO = (a, b) => a.o - b.o;
const num = (x, fallback) => (Number.isFinite(x) ? x : fallback);

function normalizeGroup(g, idx = 0) {
  if (!g || typeof g !== 'object') return null;
  const name = String(g.name || '').trim().slice(0, 24);
  if (!name) return null;
  return { id: String(g.id || uid()), name, o: num(g.o, (idx + 1) * 10), u: num(g.u, 1) };
}

function normalizeHabit(h, idx = 0) {
  if (!h || typeof h !== 'object') return null;
  const name = String(h.name || '').trim().slice(0, 20);
  if (!name) return null;
  return {
    id: String(h.id || uid()),
    name,
    emoji: firstGrapheme(h.emoji),
    kind: h.kind === 'check' ? 'check' : 'timed',
    group: h.group ? String(h.group) : MAIN_GROUP,
    o: num(h.o, (idx + 1) * 10),
    u: num(h.u, 1),
  };
}

function normalizePhrase(p, idx = 0) {
  if (!p || typeof p !== 'object') return null;
  const text = String(p.text || '').trim().slice(0, 60);
  if (!text) return null;
  return { id: String(p.id || uid()), text, o: num(p.o, (idx + 1) * 10), u: num(p.u, 1) };
}

function normalizeEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.start !== 'string' || !STAMP_RE.test(e.start)) return null;
  const start = e.start.slice(0, 16);
  const approx = !!e.approx; // "대략 적기": 시각을 모를 때. 길이 계산·통계에 넣지 않음
  const slot = SLOTS.includes(e.slot) ? e.slot : 'all';
  const habitId = e.habitId && !approx ? String(e.habitId) : '';
  let kind = e.kind === 'check' || approx ? 'check' : 'timed';
  let end = kind === 'timed' && typeof e.end === 'string' && STAMP_RE.test(e.end) ? e.end.slice(0, 16) : null;
  let name = String(e.name || '').trim().slice(0, 20);
  if (!name && habitId) name = '이름 없음';
  if (kind === 'timed' && !end && !habitId) kind = 'check'; // 항목 없는 기록은 끝이 없으면 "시각 메모"
  if (kind === 'check') end = null;
  let u = e.u;
  if (!Number.isFinite(u)) {
    const t = parseStamp(start).getTime();
    u = Number.isFinite(t) ? t : 1;
  }
  return {
    id: String(e.id || uid()),
    habitId,
    name,
    emoji: firstGrapheme(e.emoji),
    kind,
    start,
    end,
    note: String(e.note || '').slice(0, 4000),
    approx,
    slot,
    u,
  };
}

function normalizeDay(date, d) {
  if (!DAY_RE.test(date) || !d || typeof d !== 'object') return null;
  return { text: String(d.text || '').slice(0, 20000), u: num(d.u, 1) };
}

function freshData(notice) {
  return {
    groups: DEFAULT_GROUPS,
    habits: DEFAULT_HABITS,
    phrases: DEFAULT_PHRASES,
    entries: [],
    days: {},
    gone: {},
    sync: { key: '', seq: 0, pushedU: 0, last: null },
    lastBackup: null,
    notice: notice || null, // 'storage' | 'corrupt' (글자는 화면에서 언어에 맞게)
  };
}

function loadData() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return freshData('storage');
  }
  if (!raw) return freshData();
  try {
    const d = JSON.parse(raw);
    const groups = (Array.isArray(d.groups) ? d.groups : DEFAULT_GROUPS).map(normalizeGroup).filter(Boolean).sort(byO);
    const habits = (Array.isArray(d.habits) ? d.habits : DEFAULT_HABITS).map(normalizeHabit).filter(Boolean).sort(byO);
    const phrases = (Array.isArray(d.phrases) ? d.phrases : DEFAULT_PHRASES).map(normalizePhrase).filter(Boolean).sort(byO);
    const entries = (Array.isArray(d.entries) ? d.entries : []).map(normalizeEntry).filter(Boolean);
    const days = {};
    Object.entries(d.days && typeof d.days === 'object' ? d.days : {}).forEach(([k, v]) => {
      const n = normalizeDay(k, v);
      if (n) days[k] = n;
    });
    const gone = {};
    Object.entries(d.gone && typeof d.gone === 'object' ? d.gone : {}).forEach(([k, v]) => {
      if (Number.isFinite(v) && /^[hpedg]:/.test(k)) gone[k] = v;
    });
    const s = d.sync && typeof d.sync === 'object' ? d.sync : {};
    const sync = {
      key: typeof s.key === 'string' ? s.key : '',
      seq: num(s.seq, 0),
      pushedU: num(s.pushedU, 0),
      last: typeof s.last === 'string' ? s.last : null,
    };
    return { groups, habits, phrases, entries, days, gone, sync, lastBackup: d.lastBackup || null, notice: null };
  } catch {
    // 읽을 수 없는 데이터는 지우지 않고 따로 보관한다.
    try {
      localStorage.setItem(`${KEY}:corrupt-${Date.now()}`, raw);
    } catch {
      /* 보관 실패는 어쩔 수 없음 */
    }
    return freshData('corrupt');
  }
}

function persist(d) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 3,
        groups: d.groups,
        habits: d.habits,
        phrases: d.phrases,
        entries: d.entries,
        days: d.days,
        gone: d.gone,
        sync: d.sync,
        lastBackup: d.lastBackup,
      })
    );
  } catch {
    /* 저장 공간이 막힌 경우는 시작할 때 안내 */
  }
}

/* ───────────── 동기화: 바뀐 것만 모으기 / 받은 것 합치기 ───────────── */

function collectChanges(d, since) {
  const out = [];
  const strip = ({ u, ...rest }) => rest; // eslint-disable-line no-unused-vars
  d.groups.forEach((x) => x.u > since && out.push({ key: `g:${x.id}`, v: strip(x), u: x.u }));
  d.habits.forEach((x) => x.u > since && out.push({ key: `h:${x.id}`, v: strip(x), u: x.u }));
  d.phrases.forEach((x) => x.u > since && out.push({ key: `p:${x.id}`, v: strip(x), u: x.u }));
  d.entries.forEach((x) => x.u > since && out.push({ key: `e:${x.id}`, v: strip(x), u: x.u }));
  Object.entries(d.days).forEach(([date, x]) => x.u > since && out.push({ key: `d:${date}`, v: { text: x.text }, u: x.u }));
  Object.entries(d.gone).forEach(([key, u]) => u > since && out.push({ key, v: null, u }));
  return out.sort((a, b) => a.u - b.u);
}

function hasUnpushed(d) {
  const p = d.sync.pushedU;
  return (
    d.groups.some((x) => x.u > p) ||
    d.habits.some((x) => x.u > p) ||
    d.phrases.some((x) => x.u > p) ||
    d.entries.some((x) => x.u > p) ||
    Object.values(d.days).some((x) => x.u > p) ||
    Object.values(d.gone).some((u) => u > p)
  );
}

function applyRemote(d, recs) {
  const maps = {
    g: new Map(d.groups.map((x) => [x.id, x])),
    h: new Map(d.habits.map((x) => [x.id, x])),
    p: new Map(d.phrases.map((x) => [x.id, x])),
    e: new Map(d.entries.map((x) => [x.id, x])),
  };
  const days = { ...d.days };
  const gone = { ...d.gone };
  let changed = false;

  recs.forEach((r) => {
    if (!r || typeof r.key !== 'string' || !Number.isFinite(r.u)) return;
    const i = r.key.indexOf(':');
    const kind = r.key.slice(0, i);
    const id = r.key.slice(i + 1);
    if (!['g', 'h', 'p', 'e', 'd'].includes(kind) || !id) return;
    const cur = kind === 'd' ? days[id] : maps[kind].get(id);
    const localU = Math.max(gone[r.key] || 0, cur ? cur.u : 0);
    if (r.u <= localU) return; // 내 쪽이 더 최근이거나 같음

    if (r.v === null) {
      if (kind === 'd') delete days[id];
      else maps[kind].delete(id);
      gone[r.key] = r.u;
      changed = true;
      return;
    }
    let item = null;
    if (kind === 'g') item = normalizeGroup({ ...r.v, id, u: r.u });
    else if (kind === 'h') item = normalizeHabit({ ...r.v, id, u: r.u });
    else if (kind === 'p') item = normalizePhrase({ ...r.v, id, u: r.u });
    else if (kind === 'e') item = normalizeEntry({ ...r.v, id, u: r.u });
    else item = normalizeDay(id, { ...r.v, u: r.u });
    if (!item) return;
    if (kind === 'd') days[id] = item;
    else maps[kind].set(id, kind === 'e' ? { ...item, id } : item);
    delete gone[r.key];
    changed = true;
  });

  if (!changed) return d;
  return {
    ...d,
    groups: [...maps.g.values()].sort(byO),
    habits: [...maps.h.values()].sort(byO),
    phrases: [...maps.p.values()].sort(byO),
    entries: [...maps.e.values()],
    days,
    gone,
  };
}

async function postSync(key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* 본문이 JSON이 아님 */
  }
  if (r.ok && j && Array.isArray(j.records)) return j;
  const err = new Error('sync');
  if (r.status === 401) err.code = 'auth';
  else if (r.status === 404 || (j && j.error === 'not-configured')) err.code = 'noserver';
  else if (r.status === 502) err.code = 'store';
  else err.code = 'error';
  throw err;
}

/* ───────────── 메모장용 글 만들기 ───────────── */

function buildSummary(day, list, diary, lang, t, nm, approxList) {
  const lines = [memoDay(day, lang)];
  const totals = new Map();
  const sorted = [...list].sort((a, b) => (a.start < b.start ? -1 : 1));
  sorted.forEach((e) => {
    const carry = e.start.slice(0, 10) !== day ? t('sumPrev') : '';
    const note = e.note.trim();
    const name = e.name ? nm(e.habitId, e.name) : '';
    let time;
    let head = '';
    if (e.kind === 'check') {
      time = hm(e.start);
      head = name;
    } else if (e.end) {
      const min = entryMin(e);
      time = `${hm(e.start)} - ${hm(e.end)}`;
      if (name) head = `${name} (${fmtDur(min, lang)})`;
      if (name && !carry) totals.set(name, (totals.get(name) || 0) + min);
    } else {
      time = `${hm(e.start)} -`;
      head = name ? `${name} (${t('sumRunning')})` : '';
    }
    const body = [head, note].filter(Boolean).join(' ');
    lines.push(`${carry}${time}${body ? ` ${body}` : ''}`);
  });
  const rough = (approxList || []).filter((e) => e.note.trim());
  if (rough.length) {
    lines.push('');
    rough.forEach((e) => lines.push(`${e.slot !== 'all' ? `(${t(`slot_${e.slot}`)}) ` : ''}${e.note.trim()}`));
  }
  const sums = [...totals.entries()].filter(([, m]) => m > 0).map(([n, m]) => `${n} ${fmtDur(m, lang)}`);
  if (sums.length) lines.push('', `${t('sumTotal')}: ${sums.join(' / ')}`);
  if (diary && diary.trim()) lines.push('', diary.trim());
  return lines.join('\n');
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 방법으로 다시 시도 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/* ───────────── 아이콘(이모지) ───────────── */

const EMOJI_GROUPS = [
  ['emoG1', '📘 📖 📚 ✏️ 📝 💻 🎓 🧠 🌐 🗣️ 🎧 🔤 📊 🗂️'],
  ['emoG2', '💧 💊 🏃 🏋️ 🚶 🧘 🦷 🚿 🛁 😴 🛌 🩺 🧴'],
  ['emoG3', '☕ 🍚 🍳 🥚 🥗 🍜 🍕 🍷 🍎 🥛 🍱 🍗 🍞 🍺'],
  ['emoG4', '🧹 🧺 🍽️ 🌱 🌿 🚗 🛒 💰 📞 🏠 ✂️ 🧼 🔧 📦'],
  ['emoG5', '📱 📸 🎨 🖌️ 🎮 🎬 📺 🎵 🎤 📷 🎞️ ✈️ ⛺ 🏖️'],
  ['emoG6', '🙏 ⛪ ❤️ 👫 👶 💬 🎁 😊'],
  ['emoG7', '☀️ 🌙 ⭐ 🔥 ⏰ 🗓️ ✅ 📌'],
].map(([label, s]) => [label, s.split(' ')]);

/* ───────────── 여러 줄 입력칸 (글이 길어지면 같이 커짐) ───────────── */

function AutoTextarea({ value, onChange, minRows, taRef, ...rest }) {
  const local = useRef(null);
  const ref = taRef || local;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);
  return <textarea ref={ref} rows={minRows || 4} value={value} onChange={onChange} {...rest} />;
}

/* ───────────── 앱 ───────────── */

export default function App() {
  const [data, setData] = useState(loadData);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [tab, setTab] = useState('today');
  const [now, setNow] = useState(() => new Date());
  const [day, setDay] = useState(() => dayStr(new Date()));
  const [sheet, setSheet] = useState(null); // { type: 'entry' | 'habit' | 'group', ... }
  const [toast, setToast] = useState(null); // { msg, undo, act }
  const [armedId, setArmedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(() => ({ phase: data.sync.key ? 'idle' : 'off', at: null }));

  const lang = prefs.lang;
  const i18n = useMemo(
    () => ({ lang, t: makeT(lang), nm: (id, name) => displayName(lang, id, name) }),
    [lang]
  );
  const { t, nm } = i18n;

  const dataRef = useRef(data);
  dataRef.current = data;
  const statusRef = useRef(syncStatus.phase);
  statusRef.current = syncStatus.phase;
  const syncing = useRef(false);
  const again = useRef(false);
  const runSyncRef = useRef(null);

  const { habits, phrases, entries } = data;
  const groups = data.groups.length ? data.groups : DEFAULT_GROUPS; // 모두 지워진 경우에도 화면에는 기본 그룹
  const today = dayStr(now);

  /* 저장 */
  useEffect(() => {
    persist(data);
  }, [data]);

  /* 언어·디자인: 저장하고 바로 적용 */
  useEffect(() => {
    savePrefs(prefs);
    const el = document.documentElement;
    el.setAttribute('data-theme', prefs.theme);
    el.setAttribute('lang', prefs.lang);
    const meta = document.getElementById('themecolor');
    if (meta) meta.setAttribute('content', THEME_BAR[prefs.theme]);
  }, [prefs]);

  /* 시계 */
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 20000);
    const vis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), toast.act ? 7000 : 5000);
    return () => clearTimeout(id);
  }, [toast]);

  /* ── 동기화 ── */
  const runSync = useCallback(async (opts) => {
    const key = dataRef.current.sync.key;
    if (!key) return;
    if (syncing.current) {
      again.current = true;
      return;
    }
    syncing.current = true;
    setSyncStatus((s) => ({ ...s, phase: 'syncing' }));
    const full = !!(opts && opts.full);
    try {
      const snap = dataRef.current;
      const startSince = full ? 0 : snap.sync.seq;
      const changes = collectChanges(snap, full ? 0 : snap.sync.pushedU);
      const maxSent = changes.reduce((m, c) => Math.max(m, c.u), 0);
      const queue = [];
      for (let i = 0; i < changes.length; i += 300) queue.push(changes.slice(i, i + 300));

      let next = startSince;
      let first = true;
      for (let guard = 0; guard < 200; guard += 1) {
        const chunk = queue.length ? queue.shift() : [];
        // 처음 한 번은 조금 겹치게 받아서(20칸) 동시에 쓴 기록을 놓치지 않게 한다
        const res = await postSync(key, { since: first ? Math.max(0, startSince - 20) : next, changes: chunk });
        if (first && !full && res.next < startSince) {
          const err = new Error('reset'); // 서버 기록이 비워진 경우 → 전부 다시 올린다
          err.code = 'reset';
          throw err;
        }
        setData((d) => applyRemote(d, res.records));
        next = res.next;
        first = false;
        if (!queue.length && !res.more) break;
      }
      setData((d) => ({
        ...d,
        sync: {
          ...d.sync,
          seq: Math.max(next, full ? 0 : d.sync.seq),
          pushedU: Math.max(full ? 0 : d.sync.pushedU, maxSent),
          last: new Date().toISOString(),
        },
      }));
      setSyncStatus({ phase: 'ok', at: Date.now() });
    } catch (e) {
      if (e && e.code === 'reset') {
        syncing.current = false;
        setTimeout(() => runSyncRef.current && runSyncRef.current({ full: true }), 50);
        return;
      }
      setSyncStatus({ phase: (e && e.code) || 'offline', at: Date.now() });
    } finally {
      syncing.current = false;
      if (again.current) {
        again.current = false;
        setTimeout(() => runSyncRef.current && runSyncRef.current(), 300);
      }
    }
  }, []);
  runSyncRef.current = runSync;

  // 앱을 열 때, 다시 화면으로 돌아올 때, 인터넷이 돌아올 때, 가끔씩
  useEffect(() => {
    if (dataRef.current.sync.key) runSync();
    const go = () => {
      if (document.visibilityState === 'visible' && dataRef.current.sync.key) runSync();
    };
    const online = () => dataRef.current.sync.key && runSync();
    document.addEventListener('visibilitychange', go);
    window.addEventListener('online', online);
    const id = setInterval(go, 90000);
    return () => {
      document.removeEventListener('visibilitychange', go);
      window.removeEventListener('online', online);
      clearInterval(id);
    };
  }, [runSync]);

  // 내가 고친 게 있으면 잠깐 뒤에 올린다
  useEffect(() => {
    if (!data.sync.key || !hasUnpushed(data)) return undefined;
    if (statusRef.current === 'auth' || statusRef.current === 'noserver') return undefined;
    const id = setTimeout(() => runSync(), 1500);
    return () => clearTimeout(id);
  }, [data, runSync]);

  /* ── 기록 고치기 (고칠 때마다 수정 시각 u를 새로 찍는다) ── */
  const showToast = (msg, undo, act) => setToast({ msg, undo: undo || null, act: act || null });

  const upsertEntry = (entry) =>
    setData((d) => {
      const e = { ...entry, u: stampU() };
      const gone = { ...d.gone };
      delete gone[`e:${e.id}`];
      const has = d.entries.some((x) => x.id === e.id);
      return { ...d, entries: has ? d.entries.map((x) => (x.id === e.id ? e : x)) : [...d.entries, e], gone };
    });
  const removeEntry = (id) =>
    setData((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== id), gone: { ...d.gone, [`e:${id}`]: stampU() } }));

  function saveHabit(h, isNew) {
    setData((d) => {
      const maxO = d.habits.reduce((m, x) => Math.max(m, x.o), 0);
      const item = { ...h, o: isNew ? maxO + 10 : h.o, u: stampU() };
      const gone = { ...d.gone };
      delete gone[`h:${item.id}`];
      if (isNew) return { ...d, habits: [...d.habits, item], gone };
      return {
        ...d,
        habits: d.habits.map((x) => (x.id === item.id ? item : x)),
        entries: d.entries.map((e) =>
          e.habitId === item.id && (e.name !== item.name || e.emoji !== item.emoji)
            ? { ...e, name: item.name, emoji: item.emoji, u: stampU() }
            : e
        ),
        gone,
      };
    });
  }
  const deleteHabit = (id) =>
    setData((d) => ({ ...d, habits: d.habits.filter((x) => x.id !== id), gone: { ...d.gone, [`h:${id}`]: stampU() } }));
  const restoreHabit = (h) =>
    setData((d) => {
      const gone = { ...d.gone };
      delete gone[`h:${h.id}`];
      return { ...d, habits: [...d.habits.filter((x) => x.id !== h.id), { ...h, u: stampU() }].sort(byO), gone };
    });
  function removeHabit(h) {
    deleteHabit(h.id);
    showToast(t('deletedMsg', { name: nm(h.id, h.name) }), () => restoreHabit(h));
  }
  // orderIds: 지금 화면에 보이는 순서의 id 목록. 이웃과 자리를 바꾼다.
  function moveHabit(id, dir, orderIds) {
    setData((d) => {
      const i = orderIds.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= orderIds.length) return d;
      const a = d.habits.find((x) => x.id === orderIds[i]);
      const b = d.habits.find((x) => x.id === orderIds[j]);
      if (!a || !b) return d;
      const na = { ...a, o: b.o, u: stampU() };
      const nb = { ...b, o: a.o, u: stampU() };
      return { ...d, habits: d.habits.map((x) => (x.id === a.id ? na : x.id === b.id ? nb : x)).sort(byO) };
    });
  }

  function saveGroup(g, isNew) {
    setData((d) => {
      const maxO = d.groups.reduce((m, x) => Math.max(m, x.o), 0);
      const item = { ...g, o: isNew ? maxO + 10 : g.o, u: stampU() };
      const gone = { ...d.gone };
      delete gone[`g:${item.id}`];
      const list = d.groups.length ? d.groups : [];
      // 기본 그룹(g-main)을 이름만 바꾸는 경우에도 한 번은 저장 목록에 들어가야 함
      const has = list.some((x) => x.id === item.id);
      return {
        ...d,
        groups: (has ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]).sort(byO),
        gone,
      };
    });
  }
  function deleteGroup(id) {
    setData((d) => {
      if (d.groups.length <= 1) return d;
      const rest = d.groups.filter((x) => x.id !== id);
      const target = rest[0].id;
      return {
        ...d,
        groups: rest,
        habits: d.habits.map((h) => (h.group === id ? { ...h, group: target, u: stampU() } : h)),
        gone: { ...d.gone, [`g:${id}`]: stampU() },
      };
    });
  }
  function moveGroup(id, dir) {
    setData((d) => {
      const i = d.groups.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.groups.length) return d;
      const a = d.groups[i];
      const b = d.groups[j];
      const na = { ...a, o: b.o, u: stampU() };
      const nb = { ...b, o: a.o, u: stampU() };
      return { ...d, groups: d.groups.map((x) => (x.id === a.id ? na : x.id === b.id ? nb : x)).sort(byO) };
    });
  }

  function addPhrase(text) {
    const s = String(text || '').trim().slice(0, 60);
    if (!s) return false;
    setData((d) => {
      if (d.phrases.some((p) => p.text === s)) return d;
      const maxO = d.phrases.reduce((m, x) => Math.max(m, x.o), 0);
      return { ...d, phrases: [...d.phrases, { id: `p-${uid()}`, text: s, o: maxO + 10, u: stampU() }] };
    });
    return true;
  }
  const deletePhrase = (id) =>
    setData((d) => ({ ...d, phrases: d.phrases.filter((x) => x.id !== id), gone: { ...d.gone, [`p:${id}`]: stampU() } }));

  function setDiary(date, text) {
    setData((d) => {
      if (!text && !d.days[date]) return d;
      return { ...d, days: { ...d.days, [date]: { text, u: stampU() } } };
    });
  }

  /* ── 보여 줄 것 계산 ── */
  const groupedHabits = useMemo(() => {
    const firstId = groups[0].id;
    return groups.map((g) => ({
      g,
      list: habits.filter((h) => (groups.some((x) => x.id === h.group) ? h.group : firstId) === g.id),
    }));
  }, [groups, habits]);

  const running = useMemo(
    () => entries.filter((e) => e.kind === 'timed' && !e.end).sort((a, b) => (a.start < b.start ? -1 : 1)),
    [entries]
  );

  const dayEntries = useMemo(
    () =>
      entries
        .filter((e) => {
          if (e.approx) return false; // 대략 적은 기록은 "하루 요약"에 따로
          if (e.kind === 'timed' && !e.end) return false; // 진행 중인 것은 위쪽 카드에 따로 보여 준다
          const sd = e.start.slice(0, 10);
          return sd === day || (e.end && e.end.slice(0, 10) === day);
        })
        .sort((a, b) => (a.start < b.start ? -1 : 1)),
    [entries, day]
  );

  const approxEntries = useMemo(
    () => entries.filter((e) => e.approx && e.start.slice(0, 10) === day).sort((a, b) => (a.start < b.start ? -1 : 1)),
    [entries, day]
  );
  const diaryText = (data.days[day] || {}).text || '';

  const summary = useMemo(
    () =>
      buildSummary(
        day,
        [...dayEntries, ...running.filter((e) => e.start.slice(0, 10) === day)],
        diaryText,
        lang,
        t,
        nm,
        approxEntries
      ),
    [day, dayEntries, running, diaryText, lang, t, nm, approxEntries]
  );

  const dayTotals = useMemo(() => {
    const m = new Map();
    dayEntries.forEach((e) => {
      if (e.kind !== 'timed' || !e.end || !e.habitId || e.start.slice(0, 10) !== day) return;
      const cur = m.get(e.habitId) || { name: nm(e.habitId, e.name), emoji: e.emoji, min: 0 };
      cur.min += entryMin(e);
      m.set(e.habitId, cur);
    });
    return [...m.values()].filter((x) => x.min > 0);
  }, [dayEntries, day, nm]);

  // 그 날(day)에서 지금(또는 하루 끝)까지 가장 늦게 끝난 기록의 끝 시각
  function lastEndOf(dayS, limitStamp) {
    let best = null;
    entries.forEach((e) => {
      if (e.approx || (e.kind === 'timed' && !e.end)) return;
      const stamp = e.end || e.start;
      if (e.start.slice(0, 10) !== dayS && stamp.slice(0, 10) !== dayS) return;
      if (limitStamp && stamp > limitStamp) return;
      if (!best || stamp > best) best = stamp;
    });
    return best;
  }
  const prevEndHint = lastEndOf(day, day === today ? stampStr(now) : null);

  /* ── 빠른 기록 ── */
  function openEditEntry(e, isNew) {
    setArmedId(null);
    setSheet({
      type: 'entry',
      isNew: !!isNew,
      prevEnd: null,
      draft: {
        id: e.id,
        habitId: e.habitId || '',
        date: e.start.slice(0, 10),
        start: e.start.slice(11),
        end: e.end ? e.end.slice(11) : '',
        note: e.note,
        approx: !!e.approx,
        slot: e.slot || 'all',
        ghost: e.habitId ? { id: e.habitId, name: e.name, emoji: e.emoji, kind: e.kind } : null,
      },
    });
  }

  function quick(h) {
    const tm = new Date();
    setDay(dayStr(tm));
    const label = nm(h.id, h.name);
    if (h.kind === 'check') {
      const entry = {
        id: uid(), habitId: h.id, name: h.name, emoji: h.emoji, kind: 'check',
        start: stampStr(tm), end: null, note: '',
      };
      upsertEntry(entry);
      showToast(t('checkedAt', { name: label, time: timeStr(tm) }), () => removeEntry(entry.id), {
        label: t('noteBtn'), fn: () => openEditEntry(entry),
      });
      return;
    }
    const run = entries.find((e) => e.habitId === h.id && e.kind === 'timed' && !e.end);
    if (run) {
      stop(run);
    } else {
      const entry = {
        id: uid(), habitId: h.id, name: h.name, emoji: h.emoji, kind: 'timed',
        start: stampStr(tm), end: null, note: '',
      };
      upsertEntry(entry);
      showToast(t('startedAt', { name: label, time: timeStr(tm) }), () => removeEntry(entry.id));
    }
  }

  function stop(run) {
    const tm = new Date();
    let endStamp = stampStr(tm);
    if (endStamp < run.start) endStamp = run.start;
    const done = { ...run, end: endStamp };
    upsertEntry(done);
    const min = Math.max(0, Math.round((parseStamp(endStamp) - parseStamp(run.start)) / 60000));
    showToast(t('endedAfter', { name: nm(run.habitId, run.name), dur: fmtDur(min, lang) }), () => upsertEntry({ ...run, end: null }), {
      label: t('noteBtn'), fn: () => openEditEntry(done),
    });
    setDay(dayStr(tm));
  }

  /* ── 기록 추가: 직전 기록이 끝난 시각에서 이어서 시작 ── */
  function openAdd() {
    const tm = new Date();
    const nowStamp = stampStr(tm);
    const prev = lastEndOf(day, day === today ? nowStamp : null);
    let startStamp;
    let endTime;
    if (day === today) {
      if (prev) {
        startStamp = prev;
        endTime = nowStamp > prev ? timeStr(tm) : '';
      } else {
        const s = new Date(tm.getTime() - 30 * 60000);
        startStamp = stampStr(s);
        endTime = timeStr(tm);
      }
    } else if (prev) {
      startStamp = prev;
      endTime = timeStr(new Date(parseStamp(prev).getTime() + 30 * 60000));
    } else {
      startStamp = `${day}T09:00`;
      endTime = '09:30';
    }
    setSheet({
      type: 'entry',
      isNew: true,
      prevEnd: prev,
      draft: {
        id: uid(), habitId: '', date: startStamp.slice(0, 10), start: startStamp.slice(11),
        end: endTime, note: '', approx: false, slot: 'all', ghost: null,
      },
    });
  }

  function openEdit(id) {
    const e = entries.find((x) => x.id === id);
    if (e) openEditEntry(e, false);
  }

  function saveEntry(entry) {
    upsertEntry(entry);
    setSheet(null);
    // 지금 보던 날에 걸쳐 있는 기록이면 그 화면에 그대로 있고, 아니면 기록이 있는 날로 이동
    const sd = entry.start.slice(0, 10);
    const ed = (entry.end || entry.start).slice(0, 10);
    if (sd !== day && ed !== day) setDay(sd);
  }

  async function copySummary() {
    const ok = await copyText(summary);
    showToast(ok ? t('copiedOk') : t('copiedFail'));
  }

  /* ── 동기화 설정 화면에서 쓰는 동작 ── */
  function connectSync(key) {
    const k = String(key || '').trim();
    if (!k) return;
    setData((d) => ({ ...d, sync: { ...d.sync, key: k } }));
    setSyncStatus({ phase: 'syncing', at: null });
    setTimeout(() => runSync(), 80);
  }
  function disconnectSync() {
    setData((d) => ({ ...d, sync: { key: '', seq: 0, pushedU: 0, last: null } }));
    setSyncStatus({ phase: 'off', at: null });
  }

  const onRowDelete = (id) => {
    const old = entries.find((x) => x.id === id);
    removeEntry(id);
    setArmedId(null);
    if (old) {
      showToast(t('deletedMsg', { name: old.name ? nm(old.habitId, old.name) : t('entryWord') }), () => upsertEntry(old));
    }
  };
  const isRunning = (h) => running.some((e) => e.habitId === h.id);
  const dayTag = day === today ? t('today') : day === addDays(today, -1) ? t('yesterday') : '';
  const chip = (() => {
    if (!data.sync.key) return null;
    const p = syncStatus.phase;
    if (p === 'syncing' || p === 'idle') return { icon: '⏳', text: t('chipSyncing') };
    if (p === 'ok') return { icon: '☁️', text: t('chipOk') };
    return { icon: '⚠️', text: t('chipCheck') };
  })();

  return (
    <I18n.Provider value={i18n}>
      <div className="app" onClick={() => armedId && setArmedId(null)}>
        {tab === 'today' && (
          <>
            <header className="topbar">
              <h1>{t('appTitle')}</h1>
              <div className="topright">
                {chip && (
                  <button className={chip.icon === '⚠️' ? 'syncchip warn' : 'syncchip'} onClick={() => setTab('settings')}>
                    {chip.icon} {chip.text}
                  </button>
                )}
                <button className={editing ? 'editbtn on' : 'editbtn'} onClick={() => setEditing(!editing)}>
                  {editing ? t('done') : t('edit')}
                </button>
              </div>
            </header>

            <div className="daynav">
              <button className="navbtn" aria-label={t('prevDay')} onClick={() => setDay(addDays(day, -1))}>‹</button>
              <label className="daylabel">
                {dayTag && <span className="daytag">{dayTag}</span>}
                {dayLabel(day, lang)}
                <input
                  type="date"
                  value={day}
                  aria-label={t('pickDate')}
                  onChange={(e) => e.target.value && setDay(e.target.value)}
                />
              </label>
              <button className="navbtn" aria-label={t('nextDay')} onClick={() => setDay(addDays(day, 1))}>›</button>
              {day !== today && (
                <button className="todaybtn" onClick={() => setDay(today)}>{t('today')}</button>
              )}
            </div>

            {running.map((e) => (
              <div className="running" key={e.id}>
                <div>
                  <div className="running-name">⏱ {e.emoji} {nm(e.habitId, e.name)}</div>
                  <div className="running-sub">
                    {e.start.slice(0, 10) !== today ? `${dayLabel(e.start.slice(0, 10), lang)} ` : ''}
                    {t('runningSub', {
                      time: e.start.slice(11),
                      dur: fmtDur(Math.max(0, Math.round((now - parseStamp(e.start)) / 60000)), lang),
                    })}
                  </div>
                </div>
                <button className="stopbtn" onClick={(ev) => { ev.stopPropagation(); stop(e); }}>{t('stop')}</button>
              </div>
            ))}

            {editing && <p className="hint nomargin">{t('editHint')}</p>}

            {groupedHabits.map(({ g, list }, gi) => {
              const gname = nm(g.id, g.name);
              const ids = list.map((x) => x.id);
              return (
                <section className="group" key={g.id}>
                  <div className="grouphead">
                    <h2 className="sec">{gname}</h2>
                    {editing && (
                      <div className="gtools">
                        <button className="mini" aria-label={t('groupRename', { name: gname })} onClick={() => setSheet({ type: 'group', group: g })}>✎</button>
                        <button className="mini" aria-label={t('groupUp', { name: gname })} disabled={gi === 0} onClick={() => moveGroup(g.id, -1)}>▲</button>
                        <button className="mini" aria-label={t('groupDown', { name: gname })} disabled={gi === groupedHabits.length - 1} onClick={() => moveGroup(g.id, 1)}>▼</button>
                      </div>
                    )}
                  </div>
                  <div className="quick">
                    {list.map((h, hi) => {
                      const label = nm(h.id, h.name);
                      return (
                        <div className="qwrap" key={h.id}>
                          <button
                            className={isRunning(h) ? 'qbtn on' : 'qbtn'}
                            onClick={() => (editing ? setSheet({ type: 'habit', habit: h }) : quick(h))}
                          >
                            <span className="qe">{h.emoji || '•'}</span>
                            <span className="qn">{label}</span>
                            <span className="qh">
                              {h.kind === 'check' ? t('tapLog') : isRunning(h) ? t('tapStop') : t('tapStart')}
                            </span>
                          </button>
                          {editing && (
                            <>
                              <button className="qx" aria-label={t('removeItem', { name: label })} onClick={() => removeHabit(h)}>✕</button>
                              <div className="qmv">
                                <button aria-label={t('moveLeft', { name: label })} disabled={hi === 0} onClick={() => moveHabit(h.id, -1, ids)}>◀</button>
                                <button aria-label={t('moveRight', { name: label })} disabled={hi === list.length - 1} onClick={() => moveHabit(h.id, 1, ids)}>▶</button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                    <button className="qbtn add" onClick={() => setSheet({ type: 'habit', habit: null, group: g.id })}>
                      <span className="qe">＋</span>
                      <span className="qn">{t('newItem')}</span>
                    </button>
                  </div>
                </section>
              );
            })}
            {editing && (
              <button className="ghost wide" onClick={() => setSheet({ type: 'group', group: null })}>{t('addGroup')}</button>
            )}

            <button className="primary wide addbtn" onClick={openAdd}>
              <span>{t('addEntry')}</span>
              <span className="addhint">
                {prevEndHint ? t('addHintPrev', { time: hm(prevEndHint) }) : t('addHintNone')}
              </span>
            </button>

            <h2 className="sec">{day === today ? t('todayEntries') : t('dayEntries')}</h2>
            {dayEntries.length === 0 ? (
              <p className="empty">{t('emptyDay')}</p>
            ) : (
              <ul className="list">
                {dayEntries.map((e) => (
                  <EntryRow
                    key={e.id}
                    e={e}
                    day={day}
                    armed={armedId === e.id}
                    onArm={setArmedId}
                    onOpen={openEdit}
                    onDelete={onRowDelete}
                  />
                ))}
              </ul>
            )}

            {approxEntries.length > 0 && (
              <>
                <h2 className="sec">{t('approxTitle')}</h2>
                <ul className="list">
                  {approxEntries.map((e) => (
                    <EntryRow
                      key={e.id}
                      e={e}
                      day={day}
                      armed={armedId === e.id}
                      onArm={setArmedId}
                      onOpen={openEdit}
                      onDelete={onRowDelete}
                    />
                  ))}
                </ul>
              </>
            )}

            <div className="card diary">
              <h2 className="sec nomargin">{t('diaryTitle')}</h2>
              <AutoTextarea
                className="text area"
                minRows={3}
                placeholder={t('diaryPh')}
                value={diaryText}
                onChange={(e) => setDiary(day, e.target.value)}
              />
            </div>

            <div className="card summary">
              <div className="card-head">
                <h2 className="sec nomargin">{t('memoTitle')}</h2>
                <button className="primary small" onClick={copySummary}>{t('copy')}</button>
              </div>
              {dayTotals.length > 0 && (
                <div className="totals">
                  {dayTotals.map((x) => (
                    <span className="pill" key={x.name}>{x.emoji} {x.name} {fmtDur(x.min, lang)}</span>
                  ))}
                </div>
              )}
              <pre className="memo">{summary}</pre>
            </div>
          </>
        )}

        {tab === 'stats' && <Stats entries={entries} habits={habits} today={today} />}

        {tab === 'settings' && (
          <Settings
            data={data}
            groups={groups}
            setData={setData}
            prefs={prefs}
            setPrefs={setPrefs}
            syncStatus={syncStatus}
            onConnect={connectSync}
            onDisconnect={disconnectSync}
            onSyncNow={() => runSync()}
            onResync={() => runSync({ full: true })}
            onEditHabit={(h) => setSheet({ type: 'habit', habit: h, group: groups[0].id })}
            onMove={moveHabit}
            onAddPhrase={addPhrase}
            onDeletePhrase={deletePhrase}
            showToast={showToast}
          />
        )}

        <nav className="tabbar">
          {[
            ['today', t('tabToday'), '🗓️'],
            ['stats', t('tabStats'), '📊'],
            ['settings', t('tabSettings'), '⚙️'],
          ].map(([k, label, icon]) => (
            <button key={k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
              <span className="tab-ic">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {toast && (
          <div className="toast" role="status">
            <span className="toast-msg">{toast.msg}</span>
            <span className="toast-btns">
              {toast.act && (
                <button onClick={() => { const f = toast.act.fn; setToast(null); f(); }}>{toast.act.label}</button>
              )}
              {toast.undo && (
                <button onClick={() => { toast.undo(); setToast(null); }}>{t('undo')}</button>
              )}
            </span>
          </div>
        )}

        {sheet && sheet.type === 'entry' && (
          <EntrySheet
            habits={habits}
            phrases={phrases}
            defaultGroup={groups[0].id}
            draft={sheet.draft}
            isNew={sheet.isNew}
            prevEnd={sheet.prevEnd}
            onClose={() => setSheet(null)}
            onSave={saveEntry}
            onCreateHabit={(h) => saveHabit(h, true)}
            onCreatePhrase={addPhrase}
            onDelete={(id) => {
              const old = entries.find((x) => x.id === id);
              removeEntry(id);
              setSheet(null);
              if (old) {
                showToast(
                  t('deletedMsg', { name: old.name ? nm(old.habitId, old.name) : t('entryWord') }),
                  () => upsertEntry(old)
                );
              }
            }}
          />
        )}

        {sheet && sheet.type === 'habit' && (
          <HabitSheet
            habit={sheet.habit}
            groups={groups}
            defaultGroup={sheet.group || groups[0].id}
            onClose={() => setSheet(null)}
            onSave={(h, isNew) => { saveHabit(h, isNew); setSheet(null); }}
            onDelete={(h) => { removeHabit(h); setSheet(null); }}
          />
        )}

        {sheet && sheet.type === 'group' && (
          <GroupSheet
            group={sheet.group}
            canDelete={data.groups.length > 1}
            onClose={() => setSheet(null)}
            onSave={(g, isNew) => { saveGroup(g, isNew); setSheet(null); }}
            onDelete={(id) => { deleteGroup(id); setSheet(null); }}
          />
        )}
      </div>
    </I18n.Provider>
  );
}

/* ───────────── 기록 한 줄 (왼쪽으로 밀면 삭제) ───────────── */

const ACTION_W = 168;

function EntryRow({ e, day, armed, onArm, onOpen, onDelete }) {
  const { t, lang, nm } = useI18n();
  const [dx, setDx] = useState(null); // 손가락을 따라 움직이는 중일 때만 값이 있음
  const tr = useRef({ x: 0, y: 0, mode: null, moved: false, dx: 0 });
  const base = armed ? -ACTION_W : 0;
  const shift = dx !== null ? dx : base;

  function start(ev) {
    const p = ev.touches[0];
    tr.current = { x: p.clientX, y: p.clientY, mode: null, moved: false, dx: base };
  }
  function move(ev) {
    const r = tr.current;
    const p = ev.touches[0];
    const ddx = p.clientX - r.x;
    const ddy = p.clientY - r.y;
    if (!r.mode) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      r.mode = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
    }
    if (r.mode === 'h') {
      r.moved = true;
      r.dx = Math.max(-ACTION_W, Math.min(0, base + ddx));
      setDx(r.dx);
    }
  }
  function end() {
    const r = tr.current;
    if (r.mode === 'h') onArm(r.dx < -70 ? e.id : null); // 충분히 밀었으면 열어 둠 (마지막 값은 ref에서 읽음)
    setDx(null);
    r.mode = null;
  }
  function click(ev) {
    ev.stopPropagation();
    if (tr.current.moved) {
      tr.current.moved = false;
      return;
    }
    if (armed) onArm(null);
    else onOpen(e.id);
  }

  const min = entryMin(e);
  const carry = !e.approx && e.start.slice(0, 10) !== day;
  const timeText = e.approx ? t(`slot_${e.slot}`) : e.kind === 'check' ? e.start.slice(11) : `${e.start.slice(11)}–${e.end ? e.end.slice(11) : ''}`;
  const note = e.note.trim();

  return (
    <li className="swipe">
      <div className={armed || dx !== null ? 'swipe-actions show' : 'swipe-actions'}>
        <button className="del" onClick={(ev) => { ev.stopPropagation(); onDelete(e.id); }}>{t('del')}</button>
        <button className="cancel" onClick={(ev) => { ev.stopPropagation(); onArm(null); }}>{t('cancel')}</button>
      </div>
      <button
        className={dx !== null ? 'row drag' : 'row'}
        style={{ transform: shift ? `translateX(${shift}px)` : 'none' }}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        onTouchCancel={end}
        onClick={click}
      >
        <div className="row-time">
          {carry && <span className="carry">{t('carryFrom')}</span>}
          {timeText}
        </div>
        <div className="row-main">
          {e.name && <div className="row-name">{e.emoji} {nm(e.habitId, e.name)}</div>}
          {note && <div className={e.name ? 'row-note' : 'row-note solo'}>{note}</div>}
          {!e.name && !note && <div className="row-note">{t('noContent')}</div>}
        </div>
        {min !== null && <div className="row-dur">{fmtDur(min, lang)}</div>}
      </button>
    </li>
  );
}

/* ───────────── 아이콘 고르기 ───────────── */

function EmojiPicker({ value, onChange }) {
  const { t } = useI18n();
  return (
    <div className="emopicker">
      <div className="emosel">
        <span className="emocur">{value || t('emoCur')}</span>
        <input
          className="text emoinput"
          type="text"
          placeholder={t('emoInputPh')}
          value=""
          aria-label={t('emoInputAria')}
          onChange={(e) => {
            const g = firstGrapheme(e.target.value);
            if (g) onChange(g);
          }}
        />
        {value && <button type="button" className="mini" onClick={() => onChange('')}>{t('clear')}</button>}
      </div>
      <div className="emoscroll">
        {EMOJI_GROUPS.map(([label, list]) => (
          <div key={label}>
            <div className="emolabel">{t(label)}</div>
            <div className="emogrid">
              {list.map((em) => (
                <button
                  type="button"
                  key={em}
                  className={value === em ? 'emo sel' : 'emo'}
                  onClick={() => onChange(value === em ? '' : em)}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── 항목 만들기 입력칸 (시트 두 곳에서 같이 씀) ───────────── */

function HabitFields({ v, onChange, lockKind, groups }) {
  const { t, nm } = useI18n();
  return (
    <div className="hfields">
      <input
        className="text"
        type="text"
        placeholder={t('itemNamePh')}
        value={v.name}
        maxLength={20}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <EmojiPicker value={v.emoji} onChange={(emoji) => onChange({ emoji })} />
      <div className="seg">
        <button
          type="button"
          className={v.kind === 'timed' ? 'on' : ''}
          disabled={lockKind}
          onClick={() => onChange({ kind: 'timed' })}
        >
          {t('kindTimed')}
        </button>
        <button
          type="button"
          className={v.kind === 'check' ? 'on' : ''}
          disabled={lockKind}
          onClick={() => onChange({ kind: 'check' })}
        >
          {t('kindCheck')}
        </button>
      </div>
      {lockKind && <div className="hint">{t('kindLocked')}</div>}
      {groups && groups.length > 1 && (
        <div>
          <div className="label tight0">{t('groupLbl')}</div>
          <div className="chips">
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={v.group === g.id ? 'chip sel' : 'chip'}
                onClick={() => onChange({ group: g.id })}
              >
                {nm(g.id, g.name)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function newHabitFrom(v, fallbackGroup) {
  return { id: `h-${uid()}`, name: v.name.trim(), emoji: v.emoji, kind: v.kind, group: v.group || fallbackGroup || MAIN_GROUP };
}

/* ───────────── 기록 추가/수정 시트 ───────────── */

const DURATIONS = [15, 30, 45, 60, 90, 120];

function EntrySheet({ habits, phrases, defaultGroup, draft, isNew, prevEnd, onClose, onSave, onDelete, onCreateHabit, onCreatePhrase }) {
  const { t, lang, nm } = useI18n();
  const [f, setF] = useState(draft);
  const [creating, setCreating] = useState(false);
  const [hv, setHv] = useState({ name: '', emoji: '', kind: 'timed' });
  const [newPhrase, setNewPhrase] = useState(null); // null이면 닫힘, 글자면 입력 중
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [last, setLast] = useState('end'); // 시작/끝 중 마지막으로 고친 쪽 (길이 버튼의 기준)
  const taRef = useRef(null);

  useEffect(() => {
    if (isNew && taRef.current) taRef.current.focus();
  }, [isNew]);

  const choices =
    draft.ghost && !habits.some((h) => h.id === draft.ghost.id) ? [...habits, draft.ghost] : habits;
  const habit = choices.find((h) => h.id === f.habitId) || null;
  const timed = habit ? habit.kind === 'timed' : true;
  const set = (patch) => {
    setErr('');
    setF((prev) => ({ ...prev, ...patch }));
  };

  let info = '';
  if (timed && f.start && f.end) {
    if (f.end === f.start) {
      info = t('sameTimes');
    } else {
      const next = f.end < f.start;
      const min = toMin(f.end) + (next ? 1440 : 0) - toMin(f.start);
      info = next ? t('lenNext', { dur: fmtDur(min, lang), time: f.end }) : t('lenInfo', { dur: fmtDur(min, lang) });
    }
  } else if (timed && f.start && !f.end) {
    info = habit ? t('endBlankHabit') : t('endBlankFree');
  }

  const endDayOf = (v) => (v.end && v.start && v.end < v.start ? addDays(v.date, 1) : v.date);

  function applyDuration(mins) {
    if (last === 'start' && f.start && f.date) {
      const endDT = new Date(parseStamp(`${f.date}T${f.start}`).getTime() + mins * 60000);
      set({ end: timeStr(endDT) });
      return;
    }
    const endDT = f.end && f.start && f.date ? parseStamp(`${endDayOf(f)}T${f.end}`) : new Date();
    const startDT = new Date(endDT.getTime() - mins * 60000);
    set({ date: dayStr(startDT), start: timeStr(startDT), end: timeStr(endDT) });
  }

  function insertPhrase(text) {
    setErr('');
    setF((prev) => {
      const cur = prev.note;
      if (!cur.trim()) return { ...prev, note: text };
      const sep = /\s$/.test(cur) ? '' : /[.!?]$/.test(cur) ? ' ' : ', ';
      return { ...prev, note: `${cur}${sep}${text}` };
    });
    if (taRef.current) taRef.current.focus();
  }

  function makePhrase() {
    const s = String(newPhrase || '').trim();
    if (!s) return;
    onCreatePhrase(s);
    insertPhrase(s);
    setNewPhrase(null);
  }

  function makeHabit() {
    if (!hv.name.trim()) return;
    const h = newHabitFrom(hv, defaultGroup);
    onCreateHabit(h);
    set({ habitId: h.id });
    setCreating(false);
    setHv({ name: '', emoji: '', kind: 'timed' });
  }

  function save() {
    if (f.approx) {
      if (!f.date) return setErr(t('errTime'));
      if (!f.note.trim()) return setErr(t('errNeed'));
      return onSave({
        id: f.id, habitId: '', name: '', emoji: '', kind: 'check',
        start: `${f.date}T${SLOT_TIME[f.slot] || '12:00'}`, end: null, note: f.note.trim(), approx: true, slot: f.slot || 'all',
      });
    }
    if (!f.date || !f.start) return setErr(t('errTime'));
    if (!habit && !f.note.trim()) return setErr(t('errNeed'));
    let end = null;
    if (timed && f.end) {
      if (f.end === f.start) return setErr(t('errSame'));
      const endDate = f.end < f.start ? addDays(f.date, 1) : f.date;
      end = `${endDate}T${f.end}`;
    }
    const kind = habit ? habit.kind : end ? 'timed' : 'check';
    return onSave({
      id: f.id,
      habitId: habit ? habit.id : '',
      name: habit ? habit.name : '',
      emoji: habit ? habit.emoji : '',
      kind,
      start: `${f.date}T${f.start}`,
      end,
      note: f.note.trim(),
      approx: false,
      slot: 'all',
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{isNew ? t('addTitle') : t('editTitle')}</h2>
          <button className="linkbtn" onClick={onClose}>{t('close')}</button>
        </div>

        <div className="seg modeseg">
          <button className={!f.approx ? 'on' : ''} onClick={() => set({ approx: false })}>{t('modeExact')}</button>
          <button className={f.approx ? 'on' : ''} onClick={() => set({ approx: true, habitId: '' })}>{t('modeApprox')}</button>
        </div>
        {f.approx && (
          <>
            <div className="label">{t('slotLbl')}</div>
            <div className="chips">
              {SLOTS.map((k) => (
                <button key={k} className={f.slot === k ? 'chip sel' : 'chip'} onClick={() => set({ slot: k })}>{t(`slot_${k}`)}</button>
              ))}
            </div>
            <div className="hint">{t('approxHint')}</div>
          </>
        )}

        {!f.approx && (
        <>
        <div className="timegrid">
          <div>
            <div className="label">{timed ? t('start') : t('at')}</div>
            <input
              className="time"
              type="time"
              aria-label={t('startAria')}
              value={f.start}
              onChange={(e) => { setLast('start'); set({ start: e.target.value }); }}
            />
          </div>
          {timed && (
            <div>
              <div className="label">{t('end')}</div>
              <input
                className="time"
                type="time"
                aria-label={t('endAria')}
                value={f.end}
                onChange={(e) => { setLast('end'); set({ end: e.target.value }); }}
              />
            </div>
          )}
        </div>
        <div className="chips tight">
          {prevEnd && (
            <button
              className="chip"
              onClick={() => { setLast('start'); set({ date: prevEnd.slice(0, 10), start: prevEnd.slice(11) }); }}
            >
              {t('fromPrev', { time: hm(prevEnd) })}
            </button>
          )}
          <button
            className="chip"
            onClick={() => { const tm = new Date(); setLast('start'); set({ date: dayStr(tm), start: timeStr(tm) }); }}
          >
            {t('startNow')}
          </button>
          {timed && (
            <>
              <button className="chip" onClick={() => { setLast('end'); set({ end: timeStr(new Date()) }); }}>{t('endNow')}</button>
              <button className="chip" onClick={() => set({ end: '' })}>{t('endClear')}</button>
            </>
          )}
        </div>
        {timed && (
          <>
            <div className="label">{t('byLength')}</div>
            <div className="chips">
              {DURATIONS.map((m) => (
                <button key={m} className="chip" onClick={() => applyDuration(m)}>{fmtDur(m, lang)}</button>
              ))}
            </div>
          </>
        )}
        {info && <div className="info">{info}</div>}
        <div className="hint">{t('nextDayHint')}</div>

        </>
        )}

        <div className="label">{t('content')}</div>
        <AutoTextarea
          className="text area"
          minRows={4}
          taRef={taRef}
          placeholder={t('contentPh')}
          value={f.note}
          onChange={(e) => set({ note: e.target.value })}
        />

        <div className="label">{t('phrasesLabel')}</div>
        <div className="chips">
          {phrases.map((p) => (
            <button
              key={p.id}
              className="chip phrase"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => insertPhrase(nm(p.id, p.text))}
            >
              {nm(p.id, p.text)}
            </button>
          ))}
          <button className={newPhrase !== null ? 'chip sel' : 'chip dashed'} onClick={() => setNewPhrase(newPhrase === null ? '' : null)}>
            {t('plusPhrase')}
          </button>
        </div>
        {newPhrase !== null && (
          <div className="timerow phrase-new">
            <input
              className="text"
              type="text"
              placeholder={t('phrasePh')}
              value={newPhrase}
              maxLength={60}
              onChange={(e) => setNewPhrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && makePhrase()}
            />
            <button className="mini" disabled={!newPhrase.trim()} onClick={makePhrase}>{t('add')}</button>
          </div>
        )}

        {!f.approx && (
        <>
        <div className="label">{t('itemOptional')}</div>
        <div className="chips">
          <button className={!f.habitId ? 'chip sel' : 'chip'} onClick={() => set({ habitId: '' })}>{t('none')}</button>
          {choices.map((h) => (
            <button
              key={h.id}
              className={f.habitId === h.id ? 'chip sel' : 'chip'}
              onClick={() => set({ habitId: h.id })}
            >
              {h.emoji} {nm(h.id, h.name)}
            </button>
          ))}
          <button className={creating ? 'chip sel' : 'chip dashed'} onClick={() => setCreating(!creating)}>
            {t('plusItem')}
          </button>
        </div>
        {creating && (
          <div className="inline-new">
            <HabitFields v={hv} onChange={(p) => setHv({ ...hv, ...p })} />
            <button className="primary wide" disabled={!hv.name.trim()} onClick={makeHabit}>{t('makeItem')}</button>
          </div>
        )}

        </>
        )}

        <div className="label">{t('dateLbl')}</div>
        <input className="time" type="date" aria-label={t('dateLbl')} value={f.date} onChange={(e) => set({ date: e.target.value })} />

        {err && <div className="err">{err}</div>}
        <button className="primary wide" onClick={save}>{t('save')}</button>
        {!isNew && (
          <button
            className={confirmDel ? 'danger wide on' : 'danger wide'}
            onClick={() => (confirmDel ? onDelete(f.id) : setConfirmDel(true))}
          >
            {confirmDel ? t('confirmDel') : t('delEntry')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────── 항목 추가/수정 시트 ───────────── */

function HabitSheet({ habit, groups, defaultGroup, onClose, onSave, onDelete }) {
  const { t } = useI18n();
  const isNew = !habit;
  const [v, setV] = useState(
    habit
      ? { ...habit, group: groups.some((g) => g.id === habit.group) ? habit.group : defaultGroup }
      : { name: '', emoji: '', kind: 'timed', group: defaultGroup }
  );
  const [confirmDel, setConfirmDel] = useState(false);

  function save() {
    if (!v.name.trim()) return;
    onSave(
      isNew ? newHabitFrom(v, defaultGroup) : { ...habit, name: v.name.trim(), emoji: v.emoji, group: v.group },
      isNew
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{isNew ? t('newItemTitle') : t('editItemTitle')}</h2>
          <button className="linkbtn" onClick={onClose}>{t('close')}</button>
        </div>
        <HabitFields v={v} groups={groups} onChange={(p) => setV({ ...v, ...p })} lockKind={!isNew} />
        <button className="primary wide" disabled={!v.name.trim()} onClick={save}>{t('save')}</button>
        {!isNew && (
          <>
            <button
              className={confirmDel ? 'danger wide on' : 'danger wide'}
              onClick={() => (confirmDel ? onDelete(habit) : setConfirmDel(true))}
            >
              {confirmDel ? t('confirmDel') : t('delItem')}
            </button>
            <div className="hint">{t('delItemHint')}</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────── 그룹 추가/이름 바꾸기 시트 ───────────── */

function GroupSheet({ group, canDelete, onClose, onSave, onDelete }) {
  const { t, nm } = useI18n();
  const isNew = !group;
  const [name, setName] = useState(group ? nm(group.id, group.name) : '');
  const [confirmDel, setConfirmDel] = useState(false);

  function save() {
    const n = name.trim();
    if (!n) return;
    onSave(isNew ? { id: `g-${uid()}`, name: n } : { ...group, name: n }, isNew);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{isNew ? t('groupSheetNew') : t('groupSheetEdit')}</h2>
          <button className="linkbtn" onClick={onClose}>{t('close')}</button>
        </div>
        <input
          className="text"
          type="text"
          autoComplete="off"
          placeholder={t('groupNamePh')}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="primary wide" disabled={!name.trim()} onClick={save}>{t('save')}</button>
        {!isNew && canDelete && (
          <>
            <button
              className={confirmDel ? 'danger wide on' : 'danger wide'}
              onClick={() => (confirmDel ? onDelete(group.id) : setConfirmDel(true))}
            >
              {confirmDel ? t('confirmDel') : t('delGroup')}
            </button>
            <div className="hint">{t('delGroupHint')}</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────── 통계 ───────────── */

function Stats({ entries, habits, today }) {
  const { t, lang, nm } = useI18n();
  const [range, setRange] = useState(7);

  const rows = useMemo(() => {
    const from = addDays(today, -(range - 1));
    const days = Array.from({ length: range }, (_, i) => addDays(from, i));
    const map = new Map();
    habits.forEach((h) => map.set(h.id, { key: h.id, name: h.name, emoji: h.emoji, kind: h.kind, count: 0, min: 0, per: {} }));
    entries.forEach((e) => {
      if (!e.habitId) return; // 항목 없이 적은 기록은 통계에 넣지 않음
      const d = e.start.slice(0, 10);
      if (d < from || d > today) return;
      if (e.kind === 'timed' && !e.end) return;
      if (!map.has(e.habitId)) {
        map.set(e.habitId, { key: e.habitId, name: e.name, emoji: e.emoji, kind: e.kind, count: 0, min: 0, per: {} });
      }
      const r = map.get(e.habitId);
      const m = e.kind === 'timed' ? entryMin(e) : 1;
      r.count += 1;
      r.min += m;
      r.per[d] = (r.per[d] || 0) + m;
    });
    return { days, list: [...map.values()] };
  }, [entries, habits, today, range]);

  return (
    <>
      <header className="topbar"><h1>{t('statsTitle')}</h1></header>
      <div className="seg">
        <button className={range === 7 ? 'on' : ''} onClick={() => setRange(7)}>{t('range7')}</button>
        <button className={range === 30 ? 'on' : ''} onClick={() => setRange(30)}>{t('range30')}</button>
      </div>
      {rows.list.map((r) => {
        const max = Math.max(1, ...rows.days.map((d) => r.per[d] || 0));
        const activeDays = rows.days.filter((d) => r.per[d]).length;
        return (
          <div className="card stat" key={r.key}>
            <div className="stat-head">
              <div className="stat-name">{r.emoji} {nm(r.key, r.name)}</div>
              <div className="stat-sum">
                {r.kind === 'timed' ? fmtDur(r.min, lang) : t('timesN', { n: r.count })}
              </div>
            </div>
            <div className="stat-sub">
              {r.count === 0
                ? t('noRec')
                : `${t('daysRec', { n: activeDays })}${r.kind === 'timed' ? ` · ${t('timesN', { n: r.count })}` : ''}`}
            </div>
            <div className="bars" aria-hidden="true">
              {rows.days.map((d) => {
                const v = r.per[d] || 0;
                return (
                  <div className="bar-col" key={d} title={dayLabel(d, lang)}>
                    <div className={v ? 'bar on' : 'bar'} style={{ height: v ? `${Math.max(12, (v / max) * 100)}%` : '4px' }} />
                  </div>
                );
              })}
            </div>
            <div className="bar-axis">
              <span>{dayLabel(rows.days[0], lang)}</span>
              <span>{dayLabel(rows.days[rows.days.length - 1], lang)}</span>
            </div>
          </div>
        );
      })}
      <p className="hint pad">{t('statsHint')}</p>
    </>
  );
}

/* ───────────── 설정 / 언어 / 디자인 / 동기화 / 백업 ───────────── */

function Settings({
  data, groups, setData, prefs, setPrefs, syncStatus, onConnect, onDisconnect, onSyncNow, onResync,
  onEditHabit, onMove, onAddPhrase, onDeletePhrase, showToast,
}) {
  const { t, lang, nm } = useI18n();
  const fileRef = useRef(null);
  const [keyInput, setKeyInput] = useState('');
  const [phraseInput, setPhraseInput] = useState('');
  const { habits, phrases, entries } = data;
  const connected = !!data.sync.key;
  const groupName = (id) => {
    const g = groups.find((x) => x.id === id) || groups[0];
    return nm(g.id, g.name);
  };

  async function exportAll() {
    const payload = {
      app: 'daily-log', version: 3, exportedAt: new Date().toISOString(),
      groups: data.groups, habits, phrases, entries, days: data.days,
    };
    const text = JSON.stringify(payload, null, 2);
    const name = `daily-log-${dayStr(new Date())}.json`;
    const file = new File([text], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        setData((d) => ({ ...d, lastBackup: new Date().toISOString() }));
        showToast(t('exported'));
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 공유창을 닫은 경우
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setData((d) => ({ ...d, lastBackup: new Date().toISOString() }));
    showToast(t('exported'));
  }

  function importAll(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const arr = (x) => (Array.isArray(x) ? x : []);
        const inGroups = arr(parsed.groups).map(normalizeGroup).filter(Boolean);
        const inHabits = arr(parsed.habits).map(normalizeHabit).filter(Boolean);
        const inPhrases = arr(parsed.phrases).map(normalizePhrase).filter(Boolean);
        const inEntries = arr(parsed.entries).map(normalizeEntry).filter(Boolean);
        const inDays = Object.entries(parsed.days && typeof parsed.days === 'object' ? parsed.days : {})
          .map(([k, v]) => [k, normalizeDay(k, v)])
          .filter(([, v]) => v);
        if (!inGroups.length && !inHabits.length && !inEntries.length && !inPhrases.length && !inDays.length) throw new Error('empty');
        const addedE = inEntries.filter((e) => !entries.some((x) => x.id === e.id) && !data.gone[`e:${e.id}`]).length;
        setData((d) => {
          const fresh = (list, kind) => {
            const have = new Set(list.map((x) => x.id));
            return (items) => items.filter((x) => !have.has(x.id) && !d.gone[`${kind}:${x.id}`]).map((x) => ({ ...x, u: stampU() }));
          };
          const days = { ...d.days };
          inDays.forEach(([k, v]) => {
            if (!days[k] || !days[k].text.trim()) days[k] = { ...v, u: stampU() };
          });
          return {
            ...d,
            groups: [...d.groups, ...fresh(d.groups, 'g')(inGroups)].sort(byO),
            habits: [...d.habits, ...fresh(d.habits, 'h')(inHabits)].sort(byO),
            phrases: [...d.phrases, ...fresh(d.phrases, 'p')(inPhrases)].sort(byO),
            entries: [...d.entries, ...fresh(d.entries, 'e')(inEntries)],
            days,
          };
        });
        showToast(t('imported', { n: addedE }));
      } catch {
        showToast(t('importFail'));
      }
    };
    reader.readAsText(file);
  }

  const last = data.lastBackup ? new Date(data.lastBackup) : null;
  const lastSync = data.sync.last ? new Date(data.sync.last) : null;
  const phase = connected ? syncStatus.phase : 'off';
  const phaseKey = `sync_${phase}`;

  return (
    <>
      <header className="topbar"><h1>{t('settingsTitle')}</h1></header>

      {data.notice && (
        <div className="notice">
          {t(`notice_${data.notice}`)}
          <button className="linkbtn" onClick={() => setData((d) => ({ ...d, notice: null }))}>{t('ok')}</button>
        </div>
      )}

      <h2 className="sec">{t('langTitle')}</h2>
      <div className="seg langseg">
        <button className={lang === 'ko' ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, lang: 'ko' }))}>한국어</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, lang: 'en' }))}>English</button>
      </div>
      <p className="hint nomargin">{t('langHint')}</p>

      <h2 className="sec">{t('themeTitle')}</h2>
      <div className="themes">
        {THEMES.map((th) => (
          <button
            key={th.id}
            className={prefs.theme === th.id ? 'themecard on' : 'themecard'}
            aria-pressed={prefs.theme === th.id}
            onClick={() => setPrefs((p) => ({ ...p, theme: th.id }))}
          >
            <span className="swatch" aria-hidden="true">
              {th.sw.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="tname">{t(`theme_${th.id}`)}</span>
            <span className="tdesc">{t(`themeDesc_${th.id}`)}</span>
          </button>
        ))}
      </div>
      <p className="hint nomargin">{t('themeHint')}</p>

      <h2 className="sec">{t('syncTitle')}</h2>
      <div className="card">
        {connected ? (
          <>
            <div className={phase === 'ok' || phase === 'syncing' ? 'syncline ok' : 'syncline warn'}>
              {t(phaseKey)}
              {phase === 'ok' && lastSync ? ` · ${timeStr(lastSync)}` : ''}
            </div>
            <p className="hint">{t('syncHintOn')}</p>
            <div className="btnrow">
              <button className="primary" onClick={onSyncNow}>{t('syncNow')}</button>
              <button className="ghost" onClick={onDisconnect}>{t('disconnect')}</button>
            </div>
            <button className="linkbtn" onClick={onResync}>{t('resync')}</button>
          </>
        ) : (
          <>
            <p className="hint nomargin">{t('syncHintOff')}</p>
            <input
              className="text"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              placeholder={t('pwPh')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onConnect(keyInput)}
            />
            <button className="primary wide" disabled={!keyInput.trim()} onClick={() => onConnect(keyInput)}>{t('connect')}</button>
          </>
        )}
      </div>

      <h2 className="sec">{t('myItems')}</h2>
      <ul className="list">
        {habits.map((h, i) => (
          <li className="hrow" key={h.id}>
            <button className="hmain" onClick={() => onEditHabit(h)}>
              <span className="hname">{h.emoji} {nm(h.id, h.name)}</span>
              <span className="hkind">
                {groupName(h.group)} · {h.kind === 'check' ? t('typeCheck') : t('typeTimed')}
              </span>
            </button>
            <button className="mini" aria-label={t('up')} disabled={i === 0} onClick={() => onMove(h.id, -1, habits.map((x) => x.id))}>▲</button>
            <button className="mini" aria-label={t('down')} disabled={i === habits.length - 1} onClick={() => onMove(h.id, 1, habits.map((x) => x.id))}>▼</button>
          </li>
        ))}
      </ul>
      <button className="primary wide" onClick={() => onEditHabit(null)}>{t('addItem')}</button>

      <h2 className="sec">{t('phrasesTitle')}</h2>
      <div className="card">
        <p className="hint nomargin">{t('phrasesHint')}</p>
        <div className="chips phrasebox">
          {phrases.map((p) => (
            <span className="chip phrase del" key={p.id}>
              {nm(p.id, p.text)}
              <button aria-label={t('removeAria', { name: nm(p.id, p.text) })} onClick={() => onDeletePhrase(p.id)}>✕</button>
            </span>
          ))}
          {phrases.length === 0 && <span className="hint nomargin">{t('noneYet')}</span>}
        </div>
        <div className="timerow phrase-new">
          <input
            className="text"
            type="text"
            placeholder={t('newPhrasePh')}
            value={phraseInput}
            maxLength={60}
            onChange={(e) => setPhraseInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onAddPhrase(phraseInput)) setPhraseInput('');
            }}
          />
          <button
            className="mini"
            disabled={!phraseInput.trim()}
            onClick={() => { if (onAddPhrase(phraseInput)) setPhraseInput(''); }}
          >
            {t('add')}
          </button>
        </div>
      </div>

      <h2 className="sec">{t('backupTitle')}</h2>
      <div className="card">
        <p className="hint nomargin">
          {t('backupHint')}
          {last ? t('lastBackup', { when: `${dayLabel(dayStr(last), lang)} ${timeStr(last)}` }) : t('noBackup')}
        </p>
        <div className="btnrow">
          <button className="primary" onClick={exportAll}>{t('exportBtn')}</button>
          <button className="ghost" onClick={() => fileRef.current.click()}>{t('importBtn')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importAll} hidden />
        </div>
        <p className="hint">{t('importHint', { n: entries.length })}</p>
      </div>
    </>
  );
}
