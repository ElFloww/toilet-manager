import express, { type ErrorRequestHandler } from 'express';
import { CLEANLINESS, DANGER_LEVELS, TOILETS } from '../shared/domain.js';
import type { Store } from './store.js';

export function createApp(store: Store) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  app.get('/api/state', (_req, res) => res.json(store.snapshot()));
  app.post('/api/toilets/:id/reports', (req, res) => {
    if (!TOILETS.some(toilet => toilet.id === req.params.id)) {
      res.status(404).json({ error: 'Ces toilettes n’existent pas.' });
      return;
    }
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Le signalement doit être un objet JSON.' });
      return;
    }
    if (Object.keys(body).some(key => key !== 'kind' && key !== 'level')) {
      res.status(400).json({ error: 'Seuls le type et le niveau du signalement sont acceptés.' });
      return;
    }
    if ('kind' in body && 'level' in body) {
      if (body.kind === 'danger' && DANGER_LEVELS.some(level => level.id === body.level)) {
        res.json(store.report(req.params.id, { kind: 'danger', level: Number(body.level) }));
        return;
      }
      if (body.kind === 'cleanliness' && CLEANLINESS.some(level => level.id === body.level)) {
        res.json(store.report(req.params.id, { kind: 'cleanliness', level: String(body.level) }));
        return;
      }
    }
    res.status(400).json({ error: 'Type ou niveau de signalement invalide.' });
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Route API introuvable.' }); });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Corps JSON invalide ou trop volumineux.' });
      return;
    }
    console.error('Erreur interne Toilet Manager :', error.message);
    res.status(500).json({ error: 'Le serveur ne peut pas traiter cette demande.' });
  };
  app.use(handleError);
  return app;
}
