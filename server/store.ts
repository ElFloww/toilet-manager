import { DatabaseSync } from 'node:sqlite';
import { CLEANLINESS, DANGER_LEVELS, TOILETS, type Snapshot } from '../shared/domain.js';
import { nextParisMidnight, parisDay } from './time.js';
import { generateVapidKeys, type PushSubscriptionData, type VapidKeys } from './push.js';

export const MAX_SUBSCRIPTIONS = 2000;

export class Store {
  private db: DatabaseSync;

  constructor(path: string, private clock: () => number = Date.now) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS toilets (
        id TEXT PRIMARY KEY, danger_level INTEGER NOT NULL DEFAULT 0,
        danger_until INTEGER, cleanliness TEXT NOT NULL DEFAULT 'clean'
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL
      );
    `);
    const insert = this.db.prepare('INSERT OR IGNORE INTO toilets (id) VALUES (?)');
    for (const toilet of TOILETS) insert.run(toilet.id);
    this.refresh(this.clock());
  }

  private refresh(now: number) {
    const day = parisDay(now);
    const previous = this.db.prepare("SELECT value FROM metadata WHERE key = 'day'").get() as { value: string } | undefined;
    if (previous?.value !== day) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec("UPDATE toilets SET danger_level = 0, danger_until = NULL, cleanliness = 'clean'");
        this.db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('day', ?)").run(day);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    this.db.prepare('UPDATE toilets SET danger_level = 0, danger_until = NULL WHERE danger_until <= ?').run(now);
  }

  snapshot(): Snapshot {
    const now = this.clock();
    this.refresh(now);
    const rows = this.db.prepare('SELECT * FROM toilets').all();
    return {
      serverTime: now,
      resetsAt: nextParisMidnight(now),
      toilets: TOILETS.map(toilet => {
        const row = rows.find(row => row.id === toilet.id);
        const cleanliness = CLEANLINESS.find(level => level.id === row?.cleanliness);
        const danger = DANGER_LEVELS.find(level => level.id === row?.danger_level);
        if (!row || !cleanliness || (row.danger_level !== 0 && !danger)
          || (row.danger_until !== null && typeof row.danger_until !== 'number')) {
          throw new Error(`État enregistré invalide pour ${toilet.id}.`);
        }
        return { ...toilet, dangerLevel: danger?.id ?? 0, dangerUntil: row.danger_until, cleanliness: cleanliness.id };
      }),
    };
  }

  report(id: string, report: { kind: 'danger'; level: number } | { kind: 'cleanliness'; level: string }): Snapshot {
    if (!TOILETS.some(toilet => toilet.id === id)) throw new Error('Toilettes introuvables.');
    const now = this.clock();
    this.refresh(now);
    if (report.kind === 'danger') {
      const level = DANGER_LEVELS.find(level => level.id === report.level);
      if (!level) throw new Error('Niveau de danger invalide.');
      const until = Math.min(now + level.minutes * 60_000, nextParisMidnight(now));
      // Le dernier signalement remplace le précédent : on peut aussi bien aggraver qu'atténuer l'alerte.
      this.db.prepare('UPDATE toilets SET danger_level = ?, danger_until = ? WHERE id = ?').run(level.id, until, id);
    } else {
      if (!CLEANLINESS.some(level => level.id === report.level)) throw new Error('État de propreté invalide.');
      this.db.prepare('UPDATE toilets SET cleanliness = ? WHERE id = ?').run(report.level, id);
    }
    return this.snapshot();
  }

  /** « Finalement tout va bien » : atmosphère et propreté repartent à zéro pour cette cabine. */
  reset(id: string): Snapshot {
    if (!TOILETS.some(toilet => toilet.id === id)) throw new Error('Toilettes introuvables.');
    this.refresh(this.clock());
    this.db.prepare("UPDATE toilets SET danger_level = 0, danger_until = NULL, cleanliness = 'clean' WHERE id = ?").run(id);
    return this.snapshot();
  }

  /** Clés VAPID du serveur, créées au premier démarrage et conservées dans la base. */
  vapidKeys(): VapidKeys {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = 'vapid'").get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value) as VapidKeys;
    const keys = generateVapidKeys();
    this.db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
    return this.vapidKeys();
  }

  /** Enregistre un abonnement ; renvoie false si la limite est atteinte. Aucun lien avec les signalements. */
  addSubscription(subscription: PushSubscriptionData): boolean {
    const exists = this.db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint);
    if (!exists) {
      const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get() as { count: number };
      if (count >= MAX_SUBSCRIPTIONS) return false;
    }
    this.db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)')
      .run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
    return true;
  }

  hasSubscription(endpoint: string): boolean {
    return this.db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpoint) !== undefined;
  }

  removeSubscription(endpoint: string) {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  subscriptions(): PushSubscriptionData[] {
    return (this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as { endpoint: string; p256dh: string; auth: string }[])
      .map(row => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
  }

  close() { this.db.close(); }
}
