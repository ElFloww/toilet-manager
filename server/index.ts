import express from 'express';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Store } from './store.js';
import { broadcast } from './push.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(dataDir, { recursive: true });
const store = new Store(resolve(dataDir, 'toilets.sqlite'));
const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:toilet-manager@example.com';
const vapidKeys = store.vapidKeys();
if (/@example\.(com|org|net)$/.test(vapidSubject) || vapidSubject === 'mailto:toilet-manager@example.com') {
  console.warn('VAPID_SUBJECT utilise une adresse d’exemple : définissez une vraie adresse (mailto:vous@domaine.fr) ; certains services de push (Apple) peuvent refuser les envois.');
}
const app = createApp(store, (message, target) =>
  broadcast(store, vapidKeys, vapidSubject, message, undefined, target)
    .catch(error => {
      console.error('Notifications impossibles :', error instanceof Error ? error.message : error);
      return { sent: 0, failed: 1 };
    }));
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist, {
    setHeaders: (res, path) => {
      if (/[\\/](sw\.js|manifest\.webmanifest)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const timer = setInterval(() => {
  try { store.snapshot(); }
  catch (error) { console.error('Échec de la remise à jour des états :', error); }
}, 1000);
const server = app.listen(Number(process.env.PORT ?? 3001), () => {
  console.log(`Toilet Manager : http://localhost:${process.env.PORT ?? 3001}`);
});
function shutdown() {
  clearInterval(timer);
  server.close(() => { store.close(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
