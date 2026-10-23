import express, { type ErrorRequestHandler } from 'express';
import { CLEANLINESS, DANGER_LEVELS, TOILETS, type Cleanliness } from '../shared/domain.js';
import type { Store } from './store.js';
import { parseSubscription, type PushMessage, type PushTarget } from './push.js';
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

/** Envoie une notification ; renvoie le bilan de l'envoi quand il est connu. */
export type Notifier = (message: PushMessage, target?: PushTarget) => Promise<{ sent: number; failed: number }> | void;

/** Message de notification quand une cabine est remise à zéro. */
export function resetMessage(id: string): PushMessage {
  const toilet = TOILETS.find(toilet => toilet.id === id)!;
  return {
    title: `✅ ${toilet.label} : finalement tout va bien`,
    body: `Fausse alerte : ${toilet.name} (${toilet.room.toLowerCase()}) est propre et l’air est frais.`,
    tag: `wc-${toilet.label}`,
    url: `/?wc=${encodeURIComponent(toilet.id)}`,
  };
}

export const TEST_MESSAGE: PushMessage = {
  title: '🔔 Alertes activées',
  body: 'Tout fonctionne : vous recevrez une notification à chaque changement d’état d’une cabine.',
  tag: 'test',
  url: '/',
};

export function createApp(store: Store, notify: Notifier = () => {}, clock: () => number = Date.now) {
  const lastTest = new Map<string, number>();
  /** Notifie les autres appareils d'un signalement et journalise le bilan (nombre d'envois, jamais d'adresse). */
  const announce = (message: PushMessage, exclude: string | undefined) => {
    void Promise.resolve(notify(message, { exclude })).then(result => {
      if (result) console.log(`Signalement ${message.tag} : ${result.sent} notification(s) envoyée(s), ${result.failed} échec(s).`);
    });
  };
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
    if (Object.keys(body).some(key => key !== 'kind' && key !== 'level' && key !== 'endpoint')) {
      res.status(400).json({ error: 'Seuls le type et le niveau du signalement sont acceptés.' });
      return;
    }
    // Adresse push de l'appareil qui signale : sert uniquement à ne pas le notifier de son propre signalement.
    // Elle n'est ni enregistrée ni liée au signalement.
    const own = 'endpoint' in body && typeof body.endpoint === 'string' && body.endpoint.length <= 1024 ? body.endpoint : undefined;
    if ('kind' in body && 'level' in body) {
      if (body.kind === 'danger' && DANGER_LEVELS.some(level => level.id === body.level)) {
        const report = { kind: 'danger', level: Number(body.level) } as const;
        res.json(store.report(req.params.id, report));
        announce(reportMessage(req.params.id, report), own);
        return;
      }
      if (body.kind === 'cleanliness' && CLEANLINESS.some(level => level.id === body.level)) {
        const report = { kind: 'cleanliness', level: String(body.level) } as const;
        res.json(store.report(req.params.id, report));
        announce(reportMessage(req.params.id, report), own);
        return;
      }
    }
    res.status(400).json({ error: 'Type ou niveau de signalement invalide.' });
  });
  app.post('/api/toilets/:id/reset', (req, res) => {
    if (!TOILETS.some(toilet => toilet.id === req.params.id)) {
      res.status(404).json({ error: 'Ces toilettes n’existent pas.' });
      return;
    }
    const endpoint: unknown = req.body?.endpoint;
    const own = typeof endpoint === 'string' && endpoint.length <= 1024 ? endpoint : undefined;
    res.json(store.reset(req.params.id));
    announce(resetMessage(req.params.id), own);
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
  app.post('/api/push/test', async (req, res) => {
    const endpoint: unknown = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 1024) {
      res.status(400).json({ error: 'Adresse d’abonnement invalide.' });
      return;
    }
    if (!store.hasSubscription(endpoint)) {
      res.status(404).json({ error: 'Cet appareil n’est pas (ou plus) abonné aux alertes.' });
      return;
    }
    const now = clock();
    if (now - (lastTest.get(endpoint) ?? 0) < 10_000) {
      res.status(429).json({ error: 'Un test vient d’être envoyé : patientez quelques secondes.' });
      return;
    }
    lastTest.set(endpoint, now);
    if (lastTest.size > 500) lastTest.clear();
    const result = await notify(TEST_MESSAGE, { only: endpoint });
    if (result && result.failed > 0) {
      res.status(502).json({ error: 'Le service de notifications du navigateur a refusé le message. Désactivez puis réactivez les alertes.' });
      return;
    }
    res.json({ sent: true });
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
