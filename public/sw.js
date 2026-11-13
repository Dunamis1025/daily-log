/* 일과 기록 서비스워커: 알림 받기 전용 (화면 캐시는 하지 않음 → 예전 화면이 남는 일 없음) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = {};
  }
  e.waitUntil(
    self.registration.showNotification(d.title || '일과 기록', {
      body: d.body || '',
      tag: d.tag || 'dailylog',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url || '/?add=1' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/?add=1';
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of list) {
        if ('focus' in c) {
          await c.focus();
          c.postMessage({ type: 'open-add' }); // 이미 열려 있으면 그대로 "뭐 했어요?" 창을 열어 줌
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
