// Service worker: shows desktop alerts pushed by the server, even when the
// dashboard tab is asleep or closed (as long as the browser is running).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Chartink Watcher', body: event.data?.text() };
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'Chartink Watcher', {
        body: data.body || '',
        tag: data.tag || 'chartink',
        renotify: true,
        requireInteraction: !!data.added, // new stocks stay on screen until dismissed
        data: { url: data.url || '/' },
      });
      // Let open dashboard tabs refresh right away.
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const t of tabs) t.postMessage({ type: 'scanner-update', url: data.url });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: 'scanner-update', url: event.notification.data?.url });
      } else {
        await self.clients.openWindow('/');
      }
    })()
  );
});
