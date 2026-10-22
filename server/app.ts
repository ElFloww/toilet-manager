import express, { type ErrorRequestHandler } from 'express';
import { CLEANLINESS, DANGER_LEVELS, TOILETS, type Cleanliness } from '../shared/domain.js';
import type { Store } from './store.js';
import { parseSubscription, type PushMessage } from './push.js';
import { reportFeedback } from '../src/feedback.js';

/** Message de notification pour un signalement enregistré. */
export function reportMessage(id: string, report: { kind: 'danger'; level: number } | { kind: 'cleanliness'; level: string }): PushMessage {
  const toilet = TOILETS.find(toilet => toilet.id === id)!;
  const effect = reportFeedback(report.kind, report.level as number | Cleanliness);
  const level = report.kind === 'danger'
    ? DANGER_LEVELS.find(level => level.id === report.level)!.name
    : CLEANLINESS.find(level => level.id === report.level)!.name;
  return {
    title: `${effect.emoji} ${toilet.label} : ${level}`,
    body: `${effect.shout} ${effect.message} (${toilet.name}, ${toilet.room.toLowerCase()})`,
    tag: `wc-${toilet.label}`,
    url: `/?wc=${encodeURIComponent(toilet.id)}`,
  };
}

export function createApp(store: Store, notify: (message: PushMessage) => void = () => {}) {
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
        const report = { kind: 'danger', level: Number(body.level) } as const;
        res.json(store.report(req.params.id, report));
        notify(reportMessage(req.params.id, report));
        return;
      }
      if (body.kind === 'cleanliness' && CLEANLINESS.some(level => level.id === body.level)) {
        const report = { kind: 'cleanliness', level: String(body.level) } as const;
        res.json(store.report(req.params.id, report));
        notify(reportMessage(req.params.id, report));
        return;
      }
    }
    res.status(400).json({ error: 'Type ou niveau de signalement invalide.' });
  });
  app.get('/api/push/key', (_req, res) => res.json({ publicKey: store.vapidKeys().publicKey }));
  app.post('/api/push/subscriptions', (req, res) => {
    const subscription = parseSubscription(req.body);
    if (!subscription) {
      res.status(400).json({ error: 'Abonnement aux notifications invalide ou service de push non pris en charge.' });
      return;
    }
    if (!store.addSubscription(subscription)) {
      res.status(503).json({ error: 'Trop d’appareils abonnés pour le moment.' });
      return;
    }
    res.status(201).json({ subscribed: true });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint: unknown = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 1024) {
      res.status(400).json({ error: 'Adresse d’abonnement invalide.' });
      return;
    }
    store.removeSubscription(endpoint);
    res.status(204).end();
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
