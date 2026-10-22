import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { nextParisMidnight, parisDay } from '../server/time.js';
import { activeDangerLevel, DANGER_LEVELS, statusColor, TOILETS } from '../shared/domain.js';
import { createApp } from '../server/app.js';
import type { AddressInfo } from 'node:net';

test('Paris : minuit exact en été, hiver et changements d’heure', () => {
  const cases = [
    ['2026-10-22T09:00:00Z', '2026-10-22T22:00:00Z'],
    ['2026-01-22T09:00:00Z', '2026-01-22T23:00:00Z'],
    ['2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z'],
    ['2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z'],
    ['2026-12-31T23:00:00Z', '2027-01-01T23:00:00Z'],
  ];
  for (const [now, expected] of cases) {
    assert.equal(new Date(nextParisMidnight(Date.parse(now))).toISOString(), new Date(expected).toISOString());
  }
  assert.equal(parisDay(Date.parse('2026-10-22T22:00:00Z')), '2026-10-23');
});

test('Les cabines sud sont des WC hommes et les rôles nord sont inversés', () => {
  const north = TOILETS.filter(toilet => toilet.zone === 'Nord');
  const south = TOILETS.filter(toilet => toilet.zone === 'Sud');
  assert.equal(north.find(toilet => toilet.label === 'N1')?.room, 'Femmes');
  assert.ok(north.filter(toilet => toilet.label !== 'N1').every(toilet => toilet.room === 'Hommes'));
  assert.ok(south.every(toilet => toilet.room === 'Hommes'));
});

test('La couleur du danger baisse à 60, 30 et 15 minutes restantes', () => {
  const start = Date.parse('2026-10-22T10:00:00Z');
  const until = start + 90 * 60_000;
  const levelAt = (now: number) => activeDangerLevel(4, until, now);
  const colorAt = (now: number) => statusColor({
    ...TOILETS[0], dangerLevel: levelAt(now), dangerUntil: until, cleanliness: 'clean',
  });
  assert.equal(levelAt(start), 4);
  assert.equal(colorAt(start), DANGER_LEVELS[3].color);
  assert.equal(levelAt(until - 60 * 60_000), 3);
  assert.equal(colorAt(until - 60 * 60_000), DANGER_LEVELS[2].color);
  assert.equal(levelAt(until - 30 * 60_000), 2);
  assert.equal(colorAt(until - 30 * 60_000), DANGER_LEVELS[1].color);
  assert.equal(levelAt(until - 15 * 60_000), 1);
  assert.equal(colorAt(until - 15 * 60_000), DANGER_LEVELS[0].color);
  assert.equal(activeDangerLevel(4, until, until), 0);
  assert.equal(activeDangerLevel(3, start + 60 * 60_000, start), 3);
  assert.equal(activeDangerLevel(3, start + 60 * 60_000, start + 30 * 60_000), 2);
  assert.equal(activeDangerLevel(2, start + 30 * 60_000, start + 15 * 60_000), 1);
});

for (const level of DANGER_LEVELS) {
  test(`${level.name} : expiration exacte après ${level.minutes} minutes`, () => {
    let now = Date.parse('2026-10-22T10:00:00Z');
    const store = new Store(':memory:', () => now);
    try {
      const report = store.report('N-H1', { kind: 'danger', level: level.id });
      assert.equal(report.toilets[0].dangerUntil, now + level.minutes * 60_000);
      now += level.minutes * 60_000 - 1;
      assert.equal(store.snapshot().toilets[0].dangerLevel, level.id);
      now += 1;
      assert.equal(store.snapshot().toilets[0].dangerLevel, 0);
      assert.equal(store.snapshot().toilets[0].dangerUntil, null);
    } finally { store.close(); }
  });
}

test('Propreté indépendante, priorité visuelle, alertes non réductibles et nettoyage', () => {
  let now = Date.parse('2026-10-22T10:00:00Z');
  const store = new Store(':memory:', () => now);
  try {
    assert.equal(store.snapshot().toilets.length, 10);
    const radio = store.report('N-H1', { kind: 'danger', level: 4 }).toilets[0];
    now += 60_000;
    const lower = store.report('N-H1', { kind: 'danger', level: 1 }).toilets[0];
    assert.equal(lower.dangerLevel, 4);
    assert.equal(lower.dangerUntil, radio.dangerUntil);
    const dirty = store.report('N-H1', { kind: 'cleanliness', level: 'critical' }).toilets[0];
    assert.equal(statusColor(dirty), '#bf4456');
    assert.equal(dirty.dangerLevel, 4);
    now = radio.dangerUntil!;
    assert.equal(store.snapshot().toilets[0].cleanliness, 'critical');
    assert.equal(store.snapshot().toilets[0].dangerLevel, 0);
    const clean = store.report('N-H1', { kind: 'cleanliness', level: 'clean' }).toilets[0];
    assert.equal(clean.cleanliness, 'clean');
    assert.throws(() => store.report('BAD', { kind: 'danger', level: 1 }));
    assert.throws(() => store.report('N-H1', { kind: 'danger', level: 5 }));
    assert.throws(() => store.report('N-H1', { kind: 'cleanliness', level: 'bad' }));
  } finally { store.close(); }
});

test('Minuit remet absolument tout à zéro et plafonne les alertes', () => {
  let now = Date.parse('2026-10-22T21:59:00Z');
  const store = new Store(':memory:', () => now);
  try {
    store.report('N-H1', { kind: 'cleanliness', level: 'critical' });
    const state = store.report('N-H1', { kind: 'danger', level: 4 });
    assert.equal(state.toilets[0].dangerUntil, Date.parse('2026-10-22T22:00:00Z'));
    now += 59_999;
    assert.equal(store.snapshot().toilets[0].cleanliness, 'critical');
    now += 1;
    assert.ok(store.snapshot().toilets.every(toilet => toilet.dangerLevel === 0 && toilet.dangerUntil === null && toilet.cleanliness === 'clean'));
    const after = store.report('N-H1', { kind: 'danger', level: 1 }).toilets[0];
    assert.equal(after.dangerUntil, now + 15 * 60_000);
  } finally { store.close(); }
});

test('SQLite conserve les états au redémarrage, mais pas après un minuit manqué', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toilet-manager-test-'));
  const file = join(dir, 'test.sqlite');
  let now = Date.parse('2026-10-22T10:00:00Z');
  let store = new Store(file, () => now);
  try {
    store.report('S-F4', { kind: 'cleanliness', level: 'dangerous' });
    store.report('S-F4', { kind: 'danger', level: 2 });
    store.close();
    store = new Store(file, () => now);
    assert.equal(store.snapshot().toilets[9].cleanliness, 'dangerous');
    assert.equal(store.snapshot().toilets[9].dangerLevel, 2);
    store.close();
    now += 2 * 24 * 60 * 60_000;
    store = new Store(file, () => now);
    assert.equal(store.snapshot().toilets[9].cleanliness, 'clean');
    assert.equal(store.snapshot().toilets[9].dangerLevel, 0);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('API : états, validation stricte, erreurs JSON et partage entre clients', async () => {
  const store = new Store(':memory:', () => Date.parse('2026-10-22T10:00:00Z'));
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, id = 'N-H1') => fetch(`${url}/api/toilets/${id}/reports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const response = await fetch(`${url}/api/state`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).toilets.length, 10);
    assert.equal((await post({ kind: 'danger', level: 4 })).status, 200);
    const state = await (await fetch(`${url}/api/state`)).json();
    assert.equal(state.toilets[0].dangerLevel, 4);
    assert.equal((await post({ kind: 'cleanliness', level: 'degraded' })).status, 200);
    for (const body of [null, [], {}, { kind: 'danger', level: '4' }, { kind: 'danger', level: 5 }, { kind: 'cleanliness', level: 'bad' }, { kind: 'danger', level: 1, name: 'secret' }]) {
      const invalid = await post(body);
      assert.equal(invalid.status, 400);
      assert.equal(typeof (await invalid.json()).error, 'string');
    }
    assert.equal((await post({ kind: 'danger', level: 1 }, 'unknown')).status, 404);
    assert.equal((await fetch(`${url}/api/missing`)).status, 404);
    const malformed = await fetch(`${url}/api/toilets/N-H1/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    const oversized = await post({ kind: 'danger', level: 1, extra: 'a'.repeat(3000) });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});
