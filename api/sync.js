// 일과 기록 동기화 (Vercel 서버리스 함수)
// - 폰/아이패드가 같은 "동기화 암호"를 넣으면 같은 기록을 공유함. 로그인 계정은 없음.
// - 저장소는 Upstash Redis (Vercel Storage에서 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN 이 자동으로 들어옴)
// - 브라우저에는 키를 두지 않음 (REACT_APP_ 접두사 쓰지 말 것!)
//
// 환경변수 (Vercel > Project > Settings > Environment Variables)
//   SYNC_KEY                         (필수) 동기화 암호. 앱 설정에 똑같이 입력.
//   KV_REST_API_URL / KV_REST_API_TOKEN  (Upstash 연결 시 자동)  — UPSTASH_REDIS_REST_URL / _TOKEN 이름도 읽음
//
// 방식: 항목(기록·항목·문구·일기) 하나하나가 "수정 시각 u"를 가짐 → 더 늦게 고친 쪽이 이김.
//       서버는 쓸 때마다 번호(s)를 매겨서, 기기는 "마지막으로 받은 번호 이후"의 변경분만 받아감.
//       삭제는 v:null 로 남겨서 다른 기기에도 전달됨.

const crypto = require('crypto');

const HASH = 'dailylog:rec'; // key -> {v,u,s}
const IDX = 'dailylog:idx'; // 번호(s) 순서 목록
const SEQ = 'dailylog:seq'; // 번호표

const KEY_RE = /^[hped]:[A-Za-z0-9_.:-]{1,80}$/;
const MAX_CHANGES = 500;
const MAX_VALUE_BYTES = 12000;
const PAGE = 400;

function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(conf, cmds) {
  const r = await fetch(`${conf.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`redis http ${r.status}`);
  const arr = await r.json();
  return arr.map((x) => {
    if (x && x.error) throw new Error(`redis: ${x.error}`);
    return x ? x.result : null;
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  if (req.method !== 'POST') return send(405, { error: 'method' });

  const secret = process.env.SYNC_KEY;
  const conf = redisConf();
  if (!secret || !conf) return send(500, { error: 'not-configured' });
  if (!safeEqual(req.headers['x-sync-key'] || '', secret)) return send(401, { error: 'auth' });

  const body = readBody(req);
  if (!body) return send(400, { error: 'bad-body' });

  const since = Number.isFinite(Number(body.since)) && Number(body.since) > 0 ? Math.floor(Number(body.since)) : 0;
  const rawChanges = Array.isArray(body.changes) ? body.changes : [];
  if (rawChanges.length > MAX_CHANGES) return send(400, { error: 'too-many' });

  // 들어온 변경분 검사 (같은 key가 여러 번이면 u가 큰 것만)
  const byKey = new Map();
  for (const c of rawChanges) {
    if (!c || typeof c.key !== 'string' || !KEY_RE.test(c.key)) continue;
    if (!Number.isFinite(c.u) || c.u <= 0) continue;
    if (c.v !== null && (typeof c.v !== 'object' || Array.isArray(c.v))) continue;
    if (JSON.stringify(c.v).length > MAX_VALUE_BYTES) continue;
    const prev = byKey.get(c.key);
    if (!prev || c.u > prev.u) byKey.set(c.key, { key: c.key, v: c.v, u: c.u });
  }
  const changes = [...byKey.values()];

  try {
    // 1) 쓰기: 서버에 있는 것보다 더 늦게 고친 것만 받아들임
    if (changes.length) {
      const [existing] = await pipeline(conf, [['HMGET', HASH, ...changes.map((c) => c.key)]]);
      const winners = changes.filter((c, i) => {
        let cur = null;
        try {
          cur = existing[i] ? JSON.parse(existing[i]) : null;
        } catch {
          cur = null;
        }
        return !cur || c.u > cur.u;
      });
      if (winners.length) {
        const [last] = await pipeline(conf, [['INCRBY', SEQ, String(winners.length)]]);
        const base = Number(last) - winners.length;
        const cmds = [];
        winners.forEach((c, i) => {
          const s = base + i + 1;
          cmds.push(['HSET', HASH, c.key, JSON.stringify({ v: c.v, u: c.u, s })]);
          cmds.push(['ZADD', IDX, String(s), c.key]);
        });
        await pipeline(conf, cmds);
      }
    }

    // 2) 읽기: since 번호 이후에 바뀐 것
    const [seqRaw] = await pipeline(conf, [['GET', SEQ]]);
    const seq0 = Number(seqRaw) || 0;
    const [keys] = await pipeline(conf, [['ZRANGEBYSCORE', IDX, `(${since}`, '+inf', 'LIMIT', '0', String(PAGE + 1)]]);
    const more = keys.length > PAGE;
    const use = keys.slice(0, PAGE);
    const records = [];
    if (use.length) {
      const [vals] = await pipeline(conf, [['HMGET', HASH, ...use]]);
      vals.forEach((s, i) => {
        if (!s) return;
        try {
          const o = JSON.parse(s);
          records.push({ key: use[i], v: o.v, u: o.u, s: o.s });
        } catch {
          /* 깨진 항목은 건너뜀 */
        }
      });
    }
    const lastS = records.length ? records[records.length - 1].s : since;
    const next = more ? lastS : Math.max(seq0, lastS);
    return send(200, { records, next, more });
  } catch (err) {
    return send(502, { error: 'store', detail: String(err && err.message ? err.message : err).slice(0, 200) });
  }
};
