import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ───────────── 시간 도구 ─────────────
   모든 시각은 기기의 현지 시간으로 'YYYY-MM-DDTHH:MM' 글자로 저장한다.
   (잠처럼 자정을 넘기는 기록도 시작/끝 날짜가 각각 있어서 계산이 쉽다.) */

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stampStr = (d) => `${dayStr(d)}T${timeStr(d)}`;

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
function fmtDur(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
function dayLabel(day) {
  const d = parseDay(day);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}
function entryMin(e) {
  if (!e.end) return null;
  return Math.max(0, Math.round((parseStamp(e.end) - parseStamp(e.start)) / 60000));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ───────────── 저장 / 불러오기 (옛 데이터는 자동으로 정리해서 읽는다) ───────────── */

const KEY = 'dailylog:v1';
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const DEFAULT_HABITS = [
  { id: 'h-sleep', name: '수면', emoji: '😴', kind: 'timed' },
  { id: 'h-ccna', name: 'CCNA 공부', emoji: '📘', kind: 'timed' },
  { id: 'h-water', name: '따뜻한 물', emoji: '💧', kind: 'check' },
  { id: 'h-workout', name: '운동', emoji: '🏃', kind: 'timed' },
];

function normalizeHabit(h) {
  if (!h || typeof h !== 'object') return null;
  const name = String(h.name || '').trim();
  if (!name) return null;
  return {
    id: String(h.id || uid()),
    name,
    emoji: Array.from(String(h.emoji || '')).slice(0, 2).join(''),
    kind: h.kind === 'check' ? 'check' : 'timed',
  };
}

function normalizeEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.start !== 'string' || !STAMP_RE.test(e.start)) return null;
  const kind = e.kind === 'check' ? 'check' : 'timed';
  const end = kind === 'timed' && typeof e.end === 'string' && STAMP_RE.test(e.end) ? e.end.slice(0, 16) : null;
  const name = String(e.name || '').trim() || '이름 없음';
  return {
    id: String(e.id || uid()),
    habitId: String(e.habitId || `x-${name}`),
    name,
    emoji: Array.from(String(e.emoji || '')).slice(0, 2).join(''),
    kind,
    start: e.start.slice(0, 16),
    end,
    note: String(e.note || ''),
  };
}

function freshData(notice) {
  return { habits: DEFAULT_HABITS, entries: [], lastBackup: null, notice: notice || null };
}

function loadData() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return freshData('이 기기에서 저장 공간을 쓸 수 없어요. 기록이 저장되지 않을 수 있어요.');
  }
  if (!raw) return freshData();
  try {
    const d = JSON.parse(raw);
    const habits = Array.isArray(d.habits) ? d.habits.map(normalizeHabit).filter(Boolean) : DEFAULT_HABITS;
    const entries = Array.isArray(d.entries) ? d.entries.map(normalizeEntry).filter(Boolean) : [];
    return { habits, entries, lastBackup: d.lastBackup || null, notice: null };
  } catch {
    // 읽을 수 없는 데이터는 지우지 않고 따로 보관한다.
    try {
      localStorage.setItem(`${KEY}:corrupt-${Date.now()}`, raw);
    } catch {
      /* 보관 실패는 어쩔 수 없음 */
    }
    return freshData('저장된 데이터를 읽지 못해서 원본을 따로 보관해 두었어요. 백업 파일이 있다면 설정에서 가져와 주세요.');
  }
}

/* ───────────── 메모장용 글 만들기 ───────────── */

function buildSummary(day, list) {
  const lines = [dayLabel(day)];
  const totals = new Map();
  const sorted = [...list].sort((a, b) => (a.start < b.start ? -1 : 1));
  sorted.forEach((e) => {
    const t = e.start.slice(11);
    const carry = e.start.slice(0, 10) !== day ? '(전날) ' : '';
    const note = e.note.trim() ? ` - ${e.note.trim()}` : '';
    if (e.kind === 'check') {
      lines.push(`- ${t} ${e.name}${note}`);
    } else if (e.end) {
      const min = entryMin(e);
      lines.push(`- ${carry}${t}~${e.end.slice(11)} ${e.name} (${fmtDur(min)})${note}`);
      if (!carry) totals.set(e.name, (totals.get(e.name) || 0) + min);
    } else {
      lines.push(`- ${t}~ ${e.name} (진행 중)${note}`);
    }
  });
  const sums = [...totals.entries()].filter(([, m]) => m > 0).map(([n, m]) => `${n} ${fmtDur(m)}`);
  if (sums.length) lines.push('', `합계: ${sums.join(' / ')}`);
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

/* ───────────── 앱 ───────────── */

const EMOJIS = ['📘', '😴', '💧', '🏃', '🙏', '📖', '💻', '🎧', '🍚', '💊', '🧹', '☀️'];

export default function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState('today');
  const [now, setNow] = useState(() => new Date());
  const [day, setDay] = useState(() => dayStr(new Date()));
  const [sheet, setSheet] = useState(null); // { type: 'entry', draft, isNew } | { type: 'habit', habit }
  const [toast, setToast] = useState(null); // { msg, undo }
  const [armedId, setArmedId] = useState(null);

  const { habits, entries } = data;
  const today = dayStr(now);

  useEffect(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ version: 1, habits: data.habits, entries: data.entries, lastBackup: data.lastBackup })
      );
    } catch {
      /* 저장 공간이 막힌 경우는 시작할 때 안내 */
    }
  }, [data]);

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
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const setEntries = (fn) => setData((d) => ({ ...d, entries: fn(d.entries) }));
  const setHabits = (fn) => setData((d) => ({ ...d, habits: fn(d.habits) }));
  const upsertEntry = (entry) =>
    setEntries((list) =>
      list.some((x) => x.id === entry.id) ? list.map((x) => (x.id === entry.id ? entry : x)) : [...list, entry]
    );
  const removeEntry = (id) => setEntries((list) => list.filter((x) => x.id !== id));

  const running = useMemo(
    () => entries.filter((e) => e.kind === 'timed' && !e.end).sort((a, b) => (a.start < b.start ? -1 : 1)),
    [entries]
  );

  const dayEntries = useMemo(
    () =>
      entries
        .filter((e) => {
          if (e.kind === 'timed' && !e.end) return false; // 진행 중인 것은 위쪽 카드에 따로 보여 준다
          const sd = e.start.slice(0, 10);
          return sd === day || (e.end && e.end.slice(0, 10) === day);
        })
        .sort((a, b) => (a.start < b.start ? -1 : 1)),
    [entries, day]
  );

  const summary = useMemo(
    () => buildSummary(day, [...dayEntries, ...running.filter((e) => e.start.slice(0, 10) === day)]),
    [day, dayEntries, running]
  );

  const dayTotals = useMemo(() => {
    const m = new Map();
    dayEntries.forEach((e) => {
      if (e.kind !== 'timed' || !e.end || e.start.slice(0, 10) !== day) return;
      const key = e.habitId;
      const cur = m.get(key) || { name: e.name, emoji: e.emoji, min: 0 };
      cur.min += entryMin(e);
      m.set(key, cur);
    });
    return [...m.values()].filter((x) => x.min > 0);
  }, [dayEntries, day]);

  /* 빠른 기록 */
  function showToast(msg, undo) {
    setToast({ msg, undo: undo || null });
  }

  function quick(h) {
    const t = new Date();
    setDay(dayStr(t));
    if (h.kind === 'check') {
      const entry = {
        id: uid(), habitId: h.id, name: h.name, emoji: h.emoji, kind: 'check',
        start: stampStr(t), end: null, note: '',
      };
      upsertEntry(entry);
      showToast(`${h.name} · ${timeStr(t)} 기록했어요`, () => removeEntry(entry.id));
      return;
    }
    const run = entries.find((e) => e.habitId === h.id && e.kind === 'timed' && !e.end);
    if (run) {
      stop(run);
    } else {
      const entry = {
        id: uid(), habitId: h.id, name: h.name, emoji: h.emoji, kind: 'timed',
        start: stampStr(t), end: null, note: '',
      };
      upsertEntry(entry);
      showToast(`${h.name} 시작 · ${timeStr(t)}`, () => removeEntry(entry.id));
    }
  }

  function stop(run) {
    const t = new Date();
    let endStamp = stampStr(t);
    if (endStamp < run.start) endStamp = run.start;
    upsertEntry({ ...run, end: endStamp });
    const min = Math.max(0, Math.round((parseStamp(endStamp) - parseStamp(run.start)) / 60000));
    showToast(`${run.name} 끝 · ${fmtDur(min)}`, () => upsertEntry({ ...run, end: null }));
    setDay(dayStr(t));
  }

  /* 시트 열기 */
  function openAdd() {
    const t = new Date();
    const lastHabit = entries.length ? entries[entries.length - 1].habitId : '';
    const habitId = habits.some((h) => h.id === lastHabit) ? lastHabit : habits[0] ? habits[0].id : '';
    let date;
    let start;
    let end;
    if (day === dayStr(t)) {
      const s = new Date(t.getTime() - 30 * 60000);
      date = dayStr(s);
      start = timeStr(s);
      end = timeStr(t);
    } else {
      date = day;
      start = '09:00';
      end = '09:30';
    }
    setSheet({ type: 'entry', isNew: true, draft: { id: uid(), habitId, date, start, end, note: '' } });
  }

  function openEdit(id) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    setArmedId(null);
    setSheet({
      type: 'entry',
      isNew: false,
      draft: {
        id: e.id, habitId: e.habitId, date: e.start.slice(0, 10), start: e.start.slice(11),
        end: e.end ? e.end.slice(11) : '', note: e.note,
        ghost: { id: e.habitId, name: e.name, emoji: e.emoji, kind: e.kind },
      },
    });
  }

  function saveEntry(entry) {
    upsertEntry(entry);
    setSheet(null);
    setDay(entry.start.slice(0, 10));
  }

  function saveHabit(h, isNew) {
    if (isNew) {
      setHabits((list) => [...list, h]);
    } else {
      setHabits((list) => list.map((x) => (x.id === h.id ? h : x)));
      setEntries((list) => list.map((e) => (e.habitId === h.id ? { ...e, name: h.name, emoji: h.emoji } : e)));
    }
  }

  function deleteHabit(id) {
    setHabits((list) => list.filter((x) => x.id !== id));
  }

  function moveHabit(id, dir) {
    setHabits((list) => {
      const i = list.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function copySummary() {
    const ok = await copyText(summary);
    showToast(ok ? '복사했어요. 메모장에 붙여넣으세요' : '복사가 안 됐어요. 아래 글을 길게 눌러 복사해 주세요');
  }

  const isRunning = (h) => running.some((e) => e.habitId === h.id);
  const dayTag = day === today ? '오늘' : day === addDays(today, -1) ? '어제' : '';

  return (
    <div className="app" onClick={() => armedId && setArmedId(null)}>
      {tab === 'today' && (
        <>
          <header className="topbar">
            <h1>일과 기록</h1>
          </header>

          <div className="daynav">
            <button className="navbtn" aria-label="전날" onClick={() => setDay(addDays(day, -1))}>‹</button>
            <label className="daylabel">
              {dayTag && <span className="daytag">{dayTag}</span>}
              {dayLabel(day)}
              <input
                type="date"
                value={day}
                aria-label="날짜 고르기"
                onChange={(e) => e.target.value && setDay(e.target.value)}
              />
            </label>
            <button className="navbtn" aria-label="다음날" onClick={() => setDay(addDays(day, 1))}>›</button>
            {day !== today && (
              <button className="todaybtn" onClick={() => setDay(today)}>오늘</button>
            )}
          </div>

          {running.map((e) => (
            <div className="running" key={e.id}>
              <div>
                <div className="running-name">⏱ {e.emoji} {e.name}</div>
                <div className="running-sub">
                  {e.start.slice(0, 10) !== today ? `${dayLabel(e.start.slice(0, 10))} ` : ''}
                  {e.start.slice(11)} 시작 · {fmtDur(Math.max(0, Math.round((now - parseStamp(e.start)) / 60000)))} 경과
                </div>
              </div>
              <button className="stopbtn" onClick={(ev) => { ev.stopPropagation(); stop(e); }}>끝내기</button>
            </div>
          ))}

          <div className="quick">
            {habits.map((h) => (
              <button
                key={h.id}
                className={isRunning(h) ? 'qbtn on' : 'qbtn'}
                onClick={() => quick(h)}
              >
                <span className="qe">{h.emoji || '•'}</span>
                <span className="qn">{h.name}</span>
                <span className="qh">
                  {h.kind === 'check' ? '탭하면 기록' : isRunning(h) ? '탭하면 끝내기' : '탭하면 시작'}
                </span>
              </button>
            ))}
            <button className="qbtn add" onClick={() => setSheet({ type: 'habit', habit: null })}>
              <span className="qe">＋</span>
              <span className="qn">새 항목</span>
            </button>
          </div>

          <button className="primary wide" onClick={openAdd}>시간 직접 입력해서 추가</button>

          <h2 className="sec">{day === today ? '오늘 기록' : '이 날의 기록'}</h2>
          {dayEntries.length === 0 ? (
            <p className="empty">아직 기록이 없어요. 위 항목을 탭하면 바로 기록돼요.</p>
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
                  onDelete={(id) => {
                    const old = entries.find((x) => x.id === id);
                    removeEntry(id);
                    setArmedId(null);
                    if (old) showToast(`${old.name} 기록을 지웠어요`, () => upsertEntry(old));
                  }}
                />
              ))}
            </ul>
          )}

          <div className="card summary">
            <div className="card-head">
              <h2 className="sec nomargin">메모장용 글</h2>
              <button className="primary small" onClick={copySummary}>복사</button>
            </div>
            {dayTotals.length > 0 && (
              <div className="totals">
                {dayTotals.map((t) => (
                  <span className="pill" key={t.name}>{t.emoji} {t.name} {fmtDur(t.min)}</span>
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
          setData={setData}
          onEditHabit={(h) => setSheet({ type: 'habit', habit: h })}
          onMove={moveHabit}
          showToast={showToast}
        />
      )}

      <nav className="tabbar">
        {[
          ['today', '오늘', '🗓️'],
          ['stats', '통계', '📊'],
          ['settings', '설정', '⚙️'],
        ].map(([k, label, icon]) => (
          <button key={k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
            <span className="tab-ic">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button onClick={() => { toast.undo(); setToast(null); }}>되돌리기</button>
          )}
        </div>
      )}

      {sheet && sheet.type === 'entry' && (
        <EntrySheet
          habits={habits}
          draft={sheet.draft}
          isNew={sheet.isNew}
          onClose={() => setSheet(null)}
          onSave={saveEntry}
          onCreateHabit={(h) => saveHabit(h, true)}
          onDelete={(id) => {
            const old = entries.find((x) => x.id === id);
            removeEntry(id);
            setSheet(null);
            if (old) showToast(`${old.name} 기록을 지웠어요`, () => upsertEntry(old));
          }}
        />
      )}

      {sheet && sheet.type === 'habit' && (
        <HabitSheet
          habit={sheet.habit}
          onClose={() => setSheet(null)}
          onSave={(h, isNew) => { saveHabit(h, isNew); setSheet(null); }}
          onDelete={(id) => { deleteHabit(id); setSheet(null); }}
        />
      )}
    </div>
  );
}

/* ───────────── 기록 한 줄 (왼쪽으로 밀면 삭제) ───────────── */

const ACTION_W = 168;

function EntryRow({ e, day, armed, onArm, onOpen, onDelete }) {
  const [dx, setDx] = useState(null); // 손가락을 따라 움직이는 중일 때만 값이 있음
  const t = useRef({ x: 0, y: 0, mode: null, moved: false, dx: 0 });
  const base = armed ? -ACTION_W : 0;
  const shift = dx !== null ? dx : base;

  function start(ev) {
    const p = ev.touches[0];
    t.current = { x: p.clientX, y: p.clientY, mode: null, moved: false, dx: base };
  }
  function move(ev) {
    const r = t.current;
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
    const r = t.current;
    if (r.mode === 'h') onArm(r.dx < -70 ? e.id : null); // 충분히 밀었으면 열어 둠 (마지막 값은 ref에서 읽음)
    setDx(null);
    r.mode = null;
  }
  function click(ev) {
    ev.stopPropagation();
    if (t.current.moved) {
      t.current.moved = false;
      return;
    }
    if (armed) onArm(null);
    else onOpen(e.id);
  }

  const min = entryMin(e);
  const carry = e.start.slice(0, 10) !== day;
  const timeText = e.kind === 'check' ? e.start.slice(11) : `${e.start.slice(11)}–${e.end ? e.end.slice(11) : ''}`;

  return (
    <li className="swipe">
      <div className={armed || dx !== null ? 'swipe-actions show' : 'swipe-actions'}>
        <button className="del" onClick={(ev) => { ev.stopPropagation(); onDelete(e.id); }}>삭제</button>
        <button className="cancel" onClick={(ev) => { ev.stopPropagation(); onArm(null); }}>취소</button>
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
          {carry && <span className="carry">전날부터</span>}
          {timeText}
        </div>
        <div className="row-main">
          <div className="row-name">{e.emoji} {e.name}</div>
          {e.note.trim() && <div className="row-note">{e.note.trim()}</div>}
        </div>
        {min !== null && <div className="row-dur">{fmtDur(min)}</div>}
      </button>
    </li>
  );
}

/* ───────────── 항목 만들기 입력칸 (시트 두 곳에서 같이 씀) ───────────── */

function HabitFields({ v, onChange, lockKind }) {
  return (
    <div className="hfields">
      <input
        className="text"
        type="text"
        placeholder="항목 이름 (예: 영어 단어)"
        value={v.name}
        maxLength={20}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <div className="emojis">
        {EMOJIS.map((em) => (
          <button
            type="button"
            key={em}
            className={v.emoji === em ? 'emo sel' : 'emo'}
            onClick={() => onChange({ emoji: v.emoji === em ? '' : em })}
          >
            {em}
          </button>
        ))}
      </div>
      <div className="seg">
        <button
          type="button"
          className={v.kind === 'timed' ? 'on' : ''}
          disabled={lockKind}
          onClick={() => onChange({ kind: 'timed' })}
        >
          ⏱ 시간 기록 (몇 시~몇 시)
        </button>
        <button
          type="button"
          className={v.kind === 'check' ? 'on' : ''}
          disabled={lockKind}
          onClick={() => onChange({ kind: 'check' })}
        >
          ✅ 한 번 체크
        </button>
      </div>
      {lockKind && <div className="hint">종류는 만든 뒤에는 바꿀 수 없어요.</div>}
    </div>
  );
}

function newHabitFrom(v) {
  return { id: `h-${uid()}`, name: v.name.trim(), emoji: v.emoji, kind: v.kind };
}

/* ───────────── 기록 추가/수정 시트 ───────────── */

const DURATIONS = [15, 30, 45, 60, 90, 120];

function EntrySheet({ habits, draft, isNew, onClose, onSave, onDelete, onCreateHabit }) {
  const [f, setF] = useState(draft);
  const [creating, setCreating] = useState(false);
  const [hv, setHv] = useState({ name: '', emoji: '', kind: 'timed' });
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [last, setLast] = useState('end'); // 시작/끝 중 마지막으로 고친 쪽 (길이 버튼의 기준)
  const [startTouched, setStartTouched] = useState(!isNew); // 새 기록은 시작을 직접 안 고쳤으면 끝 시각을 따라간다

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
      info = '시작과 끝이 같아요';
    } else {
      const next = f.end < f.start;
      const min = toMin(f.end) + (next ? 1440 : 0) - toMin(f.start);
      info = `길이 ${fmtDur(min)}${next ? ` · 다음 날 ${f.end}에 끝` : ''}`;
    }
  } else if (timed && f.start && !f.end) {
    info = '끝 시각을 비우면 "진행 중"으로 저장돼요';
  }

  // 지금 화면의 값으로 계산한 "끝나는 날짜" (끝이 시작보다 빠르면 다음 날)
  const endDayOf = (v) => (v.end && v.start && v.end < v.start ? addDays(v.date, 1) : v.date);

  function changeStart(value, dateValue) {
    setLast('start');
    setStartTouched(true);
    set(dateValue ? { start: value, date: dateValue } : { start: value });
  }

  function changeEnd(value) {
    setLast('end');
    if (isNew && !startTouched && value && f.date && f.start) {
      // 시작을 아직 안 건드렸다면, 끝 시각보다 30분 앞으로 맞춰 둔다
      const endDT = parseStamp(`${endDayOf(f)}T${value}`);
      const startDT = new Date(endDT.getTime() - 30 * 60000);
      set({ end: value, start: timeStr(startDT), date: dayStr(startDT) });
    } else {
      set({ end: value });
    }
  }

  function applyDuration(mins) {
    if (last === 'start' && f.start && f.date) {
      const endDT = new Date(parseStamp(`${f.date}T${f.start}`).getTime() + mins * 60000);
      set({ end: timeStr(endDT) });
      return;
    }
    const endDT = f.end && f.start && f.date ? parseStamp(`${endDayOf(f)}T${f.end}`) : new Date();
    const startDT = new Date(endDT.getTime() - mins * 60000);
    setStartTouched(true);
    set({ date: dayStr(startDT), start: timeStr(startDT), end: timeStr(endDT) });
  }

  function makeHabit() {
    if (!hv.name.trim()) return;
    const h = newHabitFrom(hv);
    onCreateHabit(h);
    set({ habitId: h.id });
    setCreating(false);
    setHv({ name: '', emoji: '', kind: 'timed' });
  }

  function save() {
    if (!habit) return setErr('항목을 골라 주세요.');
    if (!f.date || !f.start) return setErr('날짜와 시작 시각을 넣어 주세요.');
    let end = null;
    if (habit.kind === 'timed' && f.end) {
      if (f.end === f.start) return setErr('시작과 끝 시각이 같아요.');
      const endDate = f.end < f.start ? addDays(f.date, 1) : f.date;
      end = `${endDate}T${f.end}`;
    }
    return onSave({
      id: f.id,
      habitId: habit.id,
      name: habit.name,
      emoji: habit.emoji,
      kind: habit.kind,
      start: `${f.date}T${f.start}`,
      end,
      note: f.note.trim(),
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{isNew ? '기록 추가' : '기록 수정'}</h2>
          <button className="linkbtn" onClick={onClose}>닫기</button>
        </div>

        <div className="label">항목</div>
        <div className="chips">
          {choices.map((h) => (
            <button
              key={h.id}
              className={f.habitId === h.id ? 'chip sel' : 'chip'}
              onClick={() => set({ habitId: h.id })}
            >
              {h.emoji} {h.name}
            </button>
          ))}
          <button className={creating ? 'chip sel' : 'chip dashed'} onClick={() => setCreating(!creating)}>
            ＋ 새 항목
          </button>
        </div>
        {creating && (
          <div className="inline-new">
            <HabitFields v={hv} onChange={(p) => setHv({ ...hv, ...p })} />
            <button className="primary wide" disabled={!hv.name.trim()} onClick={makeHabit}>항목 만들기</button>
          </div>
        )}

        <div className="label">날짜</div>
        <input className="time" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />

        <div className="label">{timed ? '시작' : '시각'}</div>
        <div className="timerow">
          <input className="time" type="time" value={f.start} onChange={(e) => changeStart(e.target.value)} />
          <button className="mini" onClick={() => { const t = new Date(); changeStart(timeStr(t), dayStr(t)); }}>지금</button>
        </div>

        {timed && (
          <>
            <div className="label">끝</div>
            <div className="timerow">
              <input className="time" type="time" value={f.end} onChange={(e) => changeEnd(e.target.value)} />
              <button className="mini" onClick={() => changeEnd(timeStr(new Date()))}>지금</button>
              <button className="mini" onClick={() => set({ end: '' })}>비우기</button>
            </div>
            <div className="label">길이로 빠르게 입력 (마지막에 고친 시각 기준)</div>
            <div className="chips">
              {DURATIONS.map((m) => (
                <button key={m} className="chip" onClick={() => applyDuration(m)}>{fmtDur(m)}</button>
              ))}
            </div>
            {info && <div className="info">{info}</div>}
            <div className="hint">끝이 시작보다 빠르면 다음 날로 계산돼요. (잠: 23:30 → 06:45)</div>
          </>
        )}

        <div className="label">메모 (선택)</div>
        <input
          className="text"
          type="text"
          placeholder="예: OSPF 챕터"
          value={f.note}
          onChange={(e) => set({ note: e.target.value })}
        />

        {err && <div className="err">{err}</div>}
        <button className="primary wide" onClick={save}>저장</button>
        {!isNew && (
          <button
            className={confirmDel ? 'danger wide on' : 'danger wide'}
            onClick={() => (confirmDel ? onDelete(f.id) : setConfirmDel(true))}
          >
            {confirmDel ? '한 번 더 누르면 삭제돼요' : '이 기록 삭제'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────── 항목 추가/수정 시트 ───────────── */

function HabitSheet({ habit, onClose, onSave, onDelete }) {
  const isNew = !habit;
  const [v, setV] = useState(habit || { name: '', emoji: '', kind: 'timed' });
  const [confirmDel, setConfirmDel] = useState(false);

  function save() {
    if (!v.name.trim()) return;
    onSave(isNew ? newHabitFrom(v) : { ...habit, name: v.name.trim(), emoji: v.emoji }, isNew);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{isNew ? '새 항목' : '항목 수정'}</h2>
          <button className="linkbtn" onClick={onClose}>닫기</button>
        </div>
        <HabitFields v={v} onChange={(p) => setV({ ...v, ...p })} lockKind={!isNew} />
        <button className="primary wide" disabled={!v.name.trim()} onClick={save}>저장</button>
        {!isNew && (
          <>
            <button
              className={confirmDel ? 'danger wide on' : 'danger wide'}
              onClick={() => (confirmDel ? onDelete(habit.id) : setConfirmDel(true))}
            >
              {confirmDel ? '한 번 더 누르면 삭제돼요' : '이 항목 삭제'}
            </button>
            <div className="hint">항목을 지워도 이미 쓴 기록은 그대로 남아요.</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────── 통계 ───────────── */

function Stats({ entries, habits, today }) {
  const [range, setRange] = useState(7);

  const rows = useMemo(() => {
    const from = addDays(today, -(range - 1));
    const days = Array.from({ length: range }, (_, i) => addDays(from, i));
    const map = new Map();
    habits.forEach((h) => map.set(h.id, { key: h.id, name: h.name, emoji: h.emoji, kind: h.kind, count: 0, min: 0, per: {} }));
    entries.forEach((e) => {
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
      <header className="topbar"><h1>통계</h1></header>
      <div className="seg">
        <button className={range === 7 ? 'on' : ''} onClick={() => setRange(7)}>최근 7일</button>
        <button className={range === 30 ? 'on' : ''} onClick={() => setRange(30)}>최근 30일</button>
      </div>
      {rows.list.map((r) => {
        const max = Math.max(1, ...rows.days.map((d) => r.per[d] || 0));
        const activeDays = rows.days.filter((d) => r.per[d]).length;
        return (
          <div className="card stat" key={r.key}>
            <div className="stat-head">
              <div className="stat-name">{r.emoji} {r.name}</div>
              <div className="stat-sum">
                {r.kind === 'timed' ? fmtDur(r.min) : `${r.count}번`}
              </div>
            </div>
            <div className="stat-sub">
              {r.count === 0 ? '기록 없음' : `${activeDays}일 기록${r.kind === 'timed' ? ` · ${r.count}번` : ''}`}
            </div>
            <div className="bars" aria-hidden="true">
              {rows.days.map((d) => {
                const v = r.per[d] || 0;
                return (
                  <div className="bar-col" key={d} title={`${dayLabel(d)}`}>
                    <div className={v ? 'bar on' : 'bar'} style={{ height: v ? `${Math.max(12, (v / max) * 100)}%` : '4px' }} />
                  </div>
                );
              })}
            </div>
            <div className="bar-axis">
              <span>{dayLabel(rows.days[0])}</span>
              <span>{dayLabel(rows.days[rows.days.length - 1])}</span>
            </div>
          </div>
        );
      })}
      <p className="hint pad">진행 중인 기록은 끝낸 뒤부터 합계에 들어가요. 자정을 넘긴 기록(잠)은 시작한 날에 넣어요.</p>
    </>
  );
}

/* ───────────── 설정 / 백업 ───────────── */

function Settings({ data, setData, onEditHabit, onMove, showToast }) {
  const fileRef = useRef(null);
  const { habits, entries } = data;

  async function exportAll() {
    const payload = { app: 'daily-log', version: 1, exportedAt: new Date().toISOString(), habits, entries };
    const text = JSON.stringify(payload, null, 2);
    const name = `daily-log-${dayStr(new Date())}.json`;
    const file = new File([text], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        setData((d) => ({ ...d, lastBackup: new Date().toISOString() }));
        showToast('백업 파일을 내보냈어요');
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
    showToast('백업 파일을 내보냈어요');
  }

  function importAll(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const inHabits = (Array.isArray(parsed.habits) ? parsed.habits : []).map(normalizeHabit).filter(Boolean);
        const inEntries = (Array.isArray(parsed.entries) ? parsed.entries : []).map(normalizeEntry).filter(Boolean);
        if (!inHabits.length && !inEntries.length) throw new Error('empty');
        setData((d) => {
          const haveH = new Set(d.habits.map((h) => h.id));
          const haveE = new Set(d.entries.map((e) => e.id));
          return {
            ...d,
            habits: [...d.habits, ...inHabits.filter((h) => !haveH.has(h.id))],
            entries: [...d.entries, ...inEntries.filter((e) => !haveE.has(e.id))],
          };
        });
        const addedE = inEntries.filter((e) => !entries.some((x) => x.id === e.id)).length;
        showToast(`기록 ${addedE}개를 가져왔어요`);
      } catch {
        showToast('파일을 읽지 못했어요');
      }
    };
    reader.readAsText(file);
  }

  const last = data.lastBackup ? new Date(data.lastBackup) : null;

  return (
    <>
      <header className="topbar"><h1>설정</h1></header>

      {data.notice && (
        <div className="notice">
          {data.notice}
          <button className="linkbtn" onClick={() => setData((d) => ({ ...d, notice: null }))}>확인</button>
        </div>
      )}

      <h2 className="sec">내 항목</h2>
      <ul className="list">
        {habits.map((h, i) => (
          <li className="hrow" key={h.id}>
            <button className="hmain" onClick={() => onEditHabit(h)}>
              <span className="hname">{h.emoji} {h.name}</span>
              <span className="hkind">{h.kind === 'check' ? '한 번 체크' : '시간 기록'}</span>
            </button>
            <button className="mini" aria-label="위로" disabled={i === 0} onClick={() => onMove(h.id, -1)}>▲</button>
            <button className="mini" aria-label="아래로" disabled={i === habits.length - 1} onClick={() => onMove(h.id, 1)}>▼</button>
          </li>
        ))}
      </ul>
      <button className="primary wide" onClick={() => onEditHabit(null)}>＋ 항목 추가</button>

      <h2 className="sec">백업</h2>
      <div className="card">
        <p className="hint nomargin">
          기록은 이 기기 안에만 저장돼요. 가끔 백업 파일을 만들어 두세요.
          {last ? ` 마지막 백업: ${dayLabel(dayStr(last))} ${timeStr(last)}` : ' 아직 백업한 적이 없어요.'}
        </p>
        <div className="btnrow">
          <button className="primary" onClick={exportAll}>내보내기</button>
          <button className="ghost" onClick={() => fileRef.current.click()}>가져오기</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importAll} hidden />
        </div>
        <p className="hint">가져오기는 기존 기록을 지우지 않고 없는 것만 더해요. 기록 {entries.length}개 저장 중.</p>
      </div>
    </>
  );
}
