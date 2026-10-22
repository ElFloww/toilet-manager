import { DatabaseSync } from 'node:sqlite';
import { CLEANLINESS, DANGER_LEVELS, TOILETS, type Snapshot } from '../shared/domain.js';
import { nextParisMidnight, parisDay } from './time.js';

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
      this.db.prepare(`UPDATE toilets SET danger_level = MAX(danger_level, ?),
        danger_until = MAX(COALESCE(danger_until, 0), ?) WHERE id = ?`).run(level.id, until, id);
    } else {
      if (!CLEANLINESS.some(level => level.id === report.level)) throw new Error('État de propreté invalide.');
      this.db.prepare('UPDATE toilets SET cleanliness = ? WHERE id = ?').run(report.level, id);
    }
    return this.snapshot();
  }

  close() { this.db.close(); }
}
