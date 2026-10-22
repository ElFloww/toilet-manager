/* Service worker de Toilet Manager : notifications push et fonctionnement hors ligne minimal. */
const CACHE = 'toilet-manager-v2';
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
  try { message = { ...message, ...event.data.json() }; }
  catch {
    // Message non JSON : on affiche son texte tel quel plutôt que le texte par défaut.
    try { const text = event.data.text(); if (text) message.body = text; } catch { /* message par défaut */ }
  }
  // Sur iOS et Chrome, une notification doit toujours être affichée en réponse à un push (sinon l'abonnement est révoqué).
  event.waitUntil(self.registration.showNotification(String(message.title).slice(0, 120), {
    body: String(message.body).slice(0, 300),
    tag: String(message.tag),
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    lang: 'fr',
    timestamp: Date.now(),
    vibrate: [80, 40, 80, 40, 220],
    data: { url: message.url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = new URL('/', self.location.origin).href;
  try {
    const requested = new URL(event.notification.data?.url || '/', self.location.origin);
    if (requested.origin === self.location.origin) target = requested.href;
  } catch { /* adresse invalide : accueil */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.focus();
        client.postMessage({ type: 'open', url: target });
        return;
      } catch { /* fenêtre morte ou focus refusé : on en ouvre une nouvelle */ }
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
