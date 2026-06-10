self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(self.registration.showNotification(data.title || 'WohnungsSwipe', {
    body:    data.body  || '',
    icon:    data.icon  || '/icon-192.png',
    badge:   '/icon-192.png',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
