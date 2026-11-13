// 알림(웹 푸시) 도우미: 서비스워커 등록, 구독, 서버에 시각 등록
export const DEFAULT_TIMES = ['13:00', '19:00', '22:00'];

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isStandalone() {
  try {
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// 'unsupported' | 'install' (홈 화면에 추가 필요) | 'denied' | 'ready'
export function pushEnv() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function call(method, key, body) {
  const r = await fetch('/api/push', {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-sync-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* JSON 아님 */
  }
  if (r.ok && j) return j;
  const err = new Error('push');
  err.code = r.status === 401 ? 'auth' : r.status === 404 || (j && j.error === 'not-configured') ? 'noserver' : (j && j.error) || 'error';
  err.status = r.status;
  throw err;
}

export async function getRegistration() {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await getRegistration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

// 알림 켜기: 허락 받기 → 구독 → 서버에 등록. 반환: { cronUrl, lastCron }
export async function enablePush(key, times, lang) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    const e = new Error('denied');
    e.code = 'denied';
    throw e;
  }
  const { publicKey } = await call('GET', null, null);
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    } catch (e) {
      const e2 = new Error('subscribe');
      e2.code = 'subscribe';
      throw e2;
    }
  }
  return call('POST', key, { action: 'subscribe', subscription: sub.toJSON(), times, tz: tz(), lang });
}

export async function updatePush(key, times, lang) {
  const sub = await currentSubscription();
  if (!sub) {
    const e = new Error('nosub');
    e.code = 'nosub';
    throw e;
  }
  return call('POST', key, { action: 'subscribe', subscription: sub.toJSON(), times, tz: tz(), lang });
}

export async function disablePush(key) {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await call('POST', key, { action: 'unsubscribe', endpoint: sub.endpoint });
  } finally {
    try {
      await sub.unsubscribe();
    } catch {
      /* 이미 해제됨 */
    }
  }
}

export async function testPush(key) {
  const sub = await currentSubscription();
  if (!sub) {
    const e = new Error('nosub');
    e.code = 'nosub';
    throw e;
  }
  return call('POST', key, { action: 'test', endpoint: sub.endpoint });
}

export function pushInfo(key) {
  return call('POST', key, { action: 'info' });
}
