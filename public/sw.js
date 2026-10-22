/* Service worker de Toilet Manager : notifications push et fonctionnement hors ligne minimal. */
const CACHE = 'toilet-manager-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (l'état doit être frais), cache en secours. L'API n'est jamais mise en cache.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(api|@|src|node_modules)\b/.test(url.pathname)) return; // API et fichiers de dev Vite : jamais en cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request.mode === 'navigate' ? '/' : event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request.mode === 'navigate' ? '/' : event.request).then(cached => cached || Response.error())),
  );
});

self.addEventListener('push', event => {
  let message = { title: 'Toilet Manager', body: 'Une cabine vient d’être mise à jour.', tag: 'toilet-manager', url: '/' };
  try { message = { ...message, ...event.data.json() }; } catch { /* message par défaut */ }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    tag: message.tag,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    lang: 'fr',
    vibrate: [80, 40, 80, 40, 220],
    data: { url: message.url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: 'open', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// Le navigateur a renouvelé l'abonnement : on prévient le serveur.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const { publicKey } = await (await fetch('/api/push/key')).json();
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });
    if (event.oldSubscription) {
      await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }) });
    }
  })());
});
