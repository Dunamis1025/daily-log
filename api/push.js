// 일과 기록 알림 (Vercel 서버리스 함수)
// - 폰/아이패드(홈 화면에 추가한 앱)가 "알림 받기"를 누르면 이 서버에 구독 정보와 받고 싶은 시각을 등록함.
// - 외부 무료 타이머(cron-job.org 등)가 5분마다 `GET /api/push?cron=1&token=...` 을 부르면,
//   그 시각이 된 기기에 "뭐 했어요?" 알림을 보냄.
// - 알림 서명 키(VAPID)는 처음 쓸 때 서버가 만들어 Redis에 저장함 → Vercel에 따로 넣을 값 없음.
// - 인증: 앱에서 부르는 요청은 동기화와 같은 x-sync-key (SYNC_KEY). 타이머용 token은 SYNC_KEY에서 계산한 별도 값.
//
// 환경변수: SYNC_KEY, KV_REST_API_URL / KV_REST_API_TOKEN (동기화와 같은 것을 씀)

const crypto = require('crypto');

const HASH = 'dailylog:push'; // id(구독 주소의 해시) -> {sub, times, tz, lang, u}
const META = 'dailylog:push:meta'; // vapid 키 (JSON)
const LASTCRON = 'dailylog:push:lastcron';
const MAX_SUBS = 20;
const MAX_TIMES = 6;
const GRACE_MIN = 20; // 정해진 시각 뒤 20분 안에는 (타이머가 한두 번 놓쳐도) 보냄. 같은 시각은 하루 한 번만.

// 구독 주소로 요청을 보내는 서버라서, 알려진 푸시 서비스 주소만 받음 (엉뚱한 주소로 요청이 가는 것을 막음)
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.apple.com', // web.push.apple.com 등
  'notify.windows.com',
];

let wp = null;
function webpush() {
  if (!wp) wp = require('web-push');
  return wp;
}

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

function cronToken(secret) {
  return crypto.createHmac('sha256', secret).update('dailylog-cron').digest('hex').slice(0, 40);
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

const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

function hostAllowed(endpoint) {
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

function cleanSub(s) {
  if (!s || typeof s !== 'object') return null;
  const { endpoint, keys } = s;
  if (typeof endpoint !== 'string' || endpoint.length > 600 || !hostAllowed(endpoint)) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

function cleanTimes(arr) {
  if (!Array.isArray(arr) || arr.length > MAX_TIMES) return null;
  const out = [];
  for (const x of arr) {
    if (typeof x !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  return out.sort();
}

function cleanTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// 그 시간대의 지금 (날짜, 자정부터 몇 분)
function localNow(tz, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')) };
}

const MSG = {
  ko: ['뭐 했어요? 지금 바로 적어 볼까요?', '방금 한 일, 잊기 전에 적어 둘까요?', '오늘 뭐 했는지 한 줄만 남겨 볼까요?'],
  en: ['What did you do? Log it now?', 'Jot down what you just did before you forget.', 'Leave a quick line about your day?'],
};
const TITLE = { ko: '일과 기록', en: 'Daily Log' };
const TEST_MSG = { ko: '알림이 잘 와요! 🎉', en: 'Notifications work! 🎉' };

async function getVapid(conf) {
  let [raw] = await pipeline(conf, [['HGET', META, 'vapid']]);
  if (!raw) {
    const k = webpush().generateVAPIDKeys();
    await pipeline(conf, [['HSETNX', META, 'vapid', JSON.stringify(k)]]); // 동시에 두 번 만들어도 먼저 들어간 하나만 남음
    [raw] = await pipeline(conf, [['HGET', META, 'vapid']]);
  }
  return JSON.parse(raw);
}

async function sendOne(vapid, subject, sub, payload) {
  return webpush().sendNotification(sub, JSON.stringify(payload), {
    TTL: 3600,
    urgency: 'normal',
    vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  });
}

module.exports = async function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  const secret = process.env.SYNC_KEY;
  const conf = redisConf();
  if (!secret || !conf) return send(500, { error: 'not-configured' });

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const subject = process.env.VAPID_SUBJECT || `https://${host}`;
  const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {
    /* ── GET: 타이머가 부르는 발송 / 공개키 ── */
    if (req.method === 'GET') {
      if (query.cron) {
        if (!safeEqual(query.token || '', cronToken(secret))) return send(401, { error: 'auth' });
        const nowMs = Date.now();
        const [flat] = await pipeline(conf, [['HGETALL', HASH], ['SET', LASTCRON, String(nowMs)]]);
        const vapid = await getVapid(conf);
        const now = new Date(nowMs);
        const jobs = [];
        let checked = 0;
        for (let i = 0; i < (flat || []).length; i += 2) {
          const id = flat[i];
          let rec;
          try {
            rec = JSON.parse(flat[i + 1]);
          } catch {
            continue;
          }
          checked += 1;
          const ln = localNow(rec.tz, now);
          for (const t of rec.times || []) {
            const m = toMin(t);
            if (ln.min >= m && ln.min < m + GRACE_MIN) jobs.push({ id, rec, t, date: ln.date });
          }
        }
        let sent = 0;
        let removed = 0;
        await Promise.all(
          jobs.map(async (j) => {
            const [ok] = await pipeline(conf, [['SET', `dailylog:push:sent:${j.id}:${j.date}:${j.t}`, '1', 'NX', 'EX', '172800']]);
            if (ok !== 'OK') return; // 이미 보냄
            const lang = j.rec.lang === 'en' ? 'en' : 'ko';
            const bodies = MSG[lang];
            try {
              await sendOne(vapid, subject, j.rec.sub, {
                title: TITLE[lang], body: bodies[Math.floor(Math.random() * bodies.length)], url: '/?add=1', tag: 'dailylog-nudge',
              });
              sent += 1;
            } catch (e) {
              if (e && (e.statusCode === 404 || e.statusCode === 410)) {
                await pipeline(conf, [['HDEL', HASH, j.id]]);
                removed += 1;
              }
            }
          })
        );
        return send(200, { ok: true, checked, due: jobs.length, sent, removed });
      }
      const v = await getVapid(conf);
      return send(200, { publicKey: v.publicKey });
    }

    if (req.method !== 'POST') return send(405, { error: 'method' });
    if (!safeEqual(req.headers['x-sync-key'] || '', secret)) return send(401, { error: 'auth' });
    const body = readBody(req);
    if (!body) return send(400, { error: 'bad-body' });

    const cronUrl = `https://${host}/api/push?cron=1&token=${cronToken(secret)}`;
    const [lastRaw] = await pipeline(conf, [['GET', LASTCRON]]);
    const lastCron = lastRaw ? Number(lastRaw) : null;

    if (body.action === 'info') return send(200, { ok: true, cronUrl, lastCron });

    if (body.action === 'subscribe') {
      const sub = cleanSub(body.subscription);
      const times = cleanTimes(body.times);
      const tz = cleanTz(body.tz);
      if (!sub) return send(400, { error: 'bad-sub' });
      if (!times) return send(400, { error: 'bad-times' });
      if (!tz) return send(400, { error: 'bad-tz' });
      const id = idOf(sub.endpoint);
      const [len, has] = await pipeline(conf, [['HLEN', HASH], ['HEXISTS', HASH, id]]);
      if (!has && Number(len) >= MAX_SUBS) return send(429, { error: 'too-many' });
      const rec = { sub, times, tz, lang: body.lang === 'en' ? 'en' : 'ko', u: Date.now() };
      await pipeline(conf, [['HSET', HASH, id, JSON.stringify(rec)]]);
      return send(200, { ok: true, cronUrl, lastCron });
    }

    if (body.action === 'unsubscribe') {
      if (typeof body.endpoint !== 'string') return send(400, { error: 'bad-sub' });
      await pipeline(conf, [['HDEL', HASH, idOf(body.endpoint)]]);
      return send(200, { ok: true });
    }

    if (body.action === 'test') {
      if (typeof body.endpoint !== 'string') return send(400, { error: 'bad-sub' });
      const id = idOf(body.endpoint);
      const [raw] = await pipeline(conf, [['HGET', HASH, id]]);
      if (!raw) return send(404, { error: 'not-subscribed' });
      const rec = JSON.parse(raw);
      const lang = rec.lang === 'en' ? 'en' : 'ko';
      const vapid = await getVapid(conf);
      try {
        await sendOne(vapid, subject, rec.sub, { title: TITLE[lang], body: TEST_MSG[lang], url: '/?add=1', tag: 'dailylog-test' });
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await pipeline(conf, [['HDEL', HASH, id]]);
          return send(410, { error: 'gone' });
        }
        return send(502, { error: 'push-failed', status: (e && e.statusCode) || 0 });
      }
      return send(200, { ok: true });
    }

    return send(400, { error: 'bad-action' });
  } catch (e) {
    return send(502, { error: 'store' });
  }
};

// 시험용: 진짜 web-push 대신 가짜를 끼워 넣을 수 있게
module.exports.__setWebPush = (m) => {
  wp = m;
};
module.exports.__localNow = localNow;
