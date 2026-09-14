// Nadobot service worker: shows push notifications when the dashboard isn't open.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Nadobot', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // If the dashboard is on screen it already shows an in-app notice, so don't double up.
      if (windows.some((w) => w.visibilityState === 'visible')) return;
      await self.registration.showNotification(data.title || 'Nadobot', {
        body: data.body || '',
        tag: data.tag,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        data: { url: data.url || '/dashboard' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => w.url.startsWith(self.location.origin));
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })()
  );
});
