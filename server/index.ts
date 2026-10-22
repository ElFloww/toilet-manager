import express from 'express';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Store } from './store.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(dataDir, { recursive: true });
const store = new Store(resolve(dataDir, 'toilets.sqlite'));
const app = createApp(store);
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
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
