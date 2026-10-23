import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, generateKeyPairSync, createECDH } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { broadcast, encryptPayload, generateVapidKeys, parseSubscription, vapidAuthorization, type PushMessage, type PushSubscriptionData } from '../server/push.js';
import { MAX_SUBSCRIPTIONS, Store } from '../server/store.js';
import { createApp, reportMessage, TEST_MESSAGE, type Notifier } from '../server/app.js';

function browserSubscription(host = 'fcm.googleapis.com', id = 'abc'): PushSubscriptionData {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://${host}/fcm/send/${id}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') },
  };
}

test('Le chiffrement du message suit le vecteur de test de la RFC 8291', () => {
  const out = encryptPayload(Buffer.from('When I grow up, I want to be a watermelon'), {
    endpoint: 'https://fcm.googleapis.com/x',
    keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
  }, Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  assert.equal(out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('Le jeton VAPID est un JWT ES256 valide limité à l’origine du service de push', () => {
  const keys = generateVapidKeys();
  const now = Date.parse('2026-10-22T10:00:00Z');
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:a@b.fr', now);
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
  assert.equal(key, keys.publicKey);
  const [h, c, s] = token.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:a@b.fr' });
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'ES256');
  const point = Buffer.from(keys.publicKey, 'base64url');
  const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('Seuls les abonnements bien formés vers un vrai service de push sont acceptés', () => {
  const good = browserSubscription();
  assert.deepEqual(parseSubscription(good), good);
  assert.ok(parseSubscription(browserSubscription('updates.push.services.mozilla.com')));
  assert.ok(parseSubscription(browserSubscription('web.push.apple.com')));
  assert.equal(parseSubscription(browserSubscription('evil.example.com')), null);
  assert.equal(parseSubscription(browserSubscription('127.0.0.1')), null);
  assert.equal(parseSubscription({ ...good, endpoint: 'http://fcm.googleapis.com/x' }), null);
  assert.equal(parseSubscription({ ...good, endpoint: 'https://fcm.googleapis.com:8443/x' }), null);
  assert.equal(parseSubscription({ ...good, endpoint: 'https://u:p@fcm.googleapis.com/x' }), null);
  assert.equal(parseSubscription({ ...good, keys: { ...good.keys, auth: 'court' } }), null);
  assert.equal(parseSubscription({ ...good, keys: { ...good.keys, p256dh: 'AAAA' } }), null);
  assert.equal(parseSubscription({ endpoint: good.endpoint }), null);
  assert.equal(parseSubscription(null), null);
  assert.equal(parseSubscription('x'), null);
});

function withStore(run: (store: Store) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'toilet-manager-push-'));
  const store = new Store(join(dir, 'test.sqlite'));
  return Promise.resolve(run(store)).finally(() => { store.close(); rmSync(dir, { recursive: true }); });
}

test('Le store conserve les clés VAPID et gère les abonnements dans la limite fixée', () => withStore(store => {
  assert.deepEqual(store.vapidKeys(), store.vapidKeys());
  const first = browserSubscription();
  assert.equal(store.addSubscription(first), true);
  assert.equal(store.addSubscription(first), true);
  assert.equal(store.subscriptions().length, 1);
  store.removeSubscription(first.endpoint);
  assert.equal(store.subscriptions().length, 0);
  for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) assert.ok(store.addSubscription(browserSubscription('fcm.googleapis.com', String(i))));
  assert.equal(store.addSubscription(browserSubscription('fcm.googleapis.com', 'trop')), false);
  assert.equal(store.addSubscription(browserSubscription('fcm.googleapis.com', '0')), true);
}));

test('L’envoi chiffre pour chaque abonné et supprime ceux qui ont expiré', () => withStore(async store => {
  const subs = ['ok', 'gone', 'missing', 'fail'].map(id => browserSubscription('fcm.googleapis.com', id));
  subs.forEach(sub => store.addSubscription(sub));
  const statuses: Record<string, number> = { ok: 201, gone: 410, missing: 404, fail: 500 };
  const calls: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const message: PushMessage = { title: 'T', body: 'B', tag: 'wc-N1', url: '/?wc=N-H1' };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await broadcast(store, store.vapidKeys(), 'mailto:a@b.fr', message, async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: statuses[url.split('/').pop()!] };
    }, {}, { retryDelayMs: 0 });
    assert.deepEqual(result, { sent: 3, failed: 1 });
  } finally { console.error = originalError; }
  assert.equal(calls.length, 5); // l'envoi en erreur 500 est retenté une fois
  assert.ok(calls.every(call => call.headers['Content-Encoding'] === 'aes128gcm' && call.headers.Authorization.startsWith('vapid t=') && call.headers.Urgency === 'high'));
  assert.ok(calls.every(call => call.body.length > 86));
  assert.deepEqual(store.subscriptions().map(sub => sub.endpoint.split('/').pop()).sort(), ['fail', 'ok']);
}));

test('Un envoi qui échoue une fois (réseau, 429, 5xx) est retenté et réussit', () => withStore(async store => {
  const flaky = ['net', 'busy'].map(id => browserSubscription('fcm.googleapis.com', id));
  flaky.forEach(sub => store.addSubscription(sub));
  const attempts: Record<string, number> = {};
  const result = await broadcast(store, store.vapidKeys(), 'mailto:a@b.fr', { title: 'T', body: 'B', tag: 'x', url: '/' }, async url => {
    const id = url.split('/').pop()!;
    attempts[id] = (attempts[id] ?? 0) + 1;
    if (attempts[id] === 1) { if (id === 'net') throw new Error('ECONNRESET'); return { status: 429 }; }
    return { status: 201 };
  }, {}, { retryDelayMs: 0 });
  assert.deepEqual(result, { sent: 2, failed: 0 });
  assert.deepEqual(attempts, { net: 2, busy: 2 });
}));

test('L’envoi peut exclure l’auteur du signalement ou viser un seul appareil', () => withStore(async store => {
  const subs = ['a', 'b', 'c'].map(id => browserSubscription('fcm.googleapis.com', id));
  subs.forEach(sub => store.addSubscription(sub));
  const message: PushMessage = { title: 'T', body: 'B', tag: 'x', url: '/' };
  const reached: string[] = [];
  const transport = async (url: string) => { reached.push(url.split('/').pop()!); return { status: 201 }; };
  await broadcast(store, store.vapidKeys(), 'mailto:a@b.fr', message, transport, { exclude: subs[1].endpoint });
  assert.deepEqual(reached.sort(), ['a', 'c']);
  reached.length = 0;
  await broadcast(store, store.vapidKeys(), 'mailto:a@b.fr', message, transport, { only: subs[2].endpoint });
  assert.deepEqual(reached, ['c']);
}));

test('Le message de notification décrit le signalement', () => {
  const message = reportMessage('N-H1', { kind: 'danger', level: 4 });
  assert.match(message.title, /N\d : /);
  assert.equal(message.url, '/?wc=N-H1');
  assert.match(message.tag, /^wc-N\d$/);
  assert.ok(message.body.length > 10);
  assert.ok(reportMessage('S-F4', { kind: 'cleanliness', level: 'critical' }).title.includes('S'));
});

test('L’API enregistre les abonnements et notifie à chaque signalement valide', () => withStore(async store => {
  const sent: PushMessage[] = [];
  const server = createApp(store, message => { sent.push(message); }).listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const key = await (await fetch(`${base}/api/push/key`)).json() as { publicKey: string };
    assert.equal(key.publicKey, store.vapidKeys().publicKey);

    const sub = browserSubscription();
    assert.equal((await post('/api/push/subscriptions', sub)).status, 201);
    assert.equal((await post('/api/push/subscriptions', { ...sub, endpoint: 'https://evil.example.com/x' })).status, 400);
    assert.equal(store.subscriptions().length, 1);

    assert.equal((await post('/api/toilets/N-H1/reports', { kind: 'danger', level: 2 })).status, 200);
    assert.equal((await post('/api/toilets/N-H1/reports', { kind: 'cleanliness', level: 'degraded' })).status, 200);
    assert.equal(sent.length, 2);
    assert.equal((await post('/api/toilets/N-H1/reports', { kind: 'danger', level: 42 })).status, 400);
    assert.equal((await post('/api/toilets/inconnu/reports', { kind: 'danger', level: 1 })).status, 404);
    assert.equal(sent.length, 2);

    assert.equal((await post('/api/push/unsubscribe', { endpoint: sub.endpoint })).status, 204);
    assert.equal(store.subscriptions().length, 0);
    assert.equal((await post('/api/push/unsubscribe', {})).status, 400);
  } finally { server.close(); }
}));

test('Le signalement n’envoie pas de notification à son auteur, et le test ne vise que l’appareil abonné', () => withStore(async store => {
  const calls: { message: PushMessage; target?: { exclude?: string; only?: string } }[] = [];
  let outcome = { sent: 1, failed: 0 };
  const notify: Notifier = async (message, target) => { calls.push({ message, target }); return outcome; };
  let now = 1_000_000;
  const server = createApp(store, notify, () => now).listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const sub = browserSubscription();
    await post('/api/push/subscriptions', sub);

    assert.equal((await post('/api/toilets/N-H1/reports', { kind: 'danger', level: 1, endpoint: sub.endpoint })).status, 200);
    assert.equal(calls[0].target?.exclude, sub.endpoint);
    assert.equal((await post('/api/toilets/N-H1/reports', { kind: 'danger', level: 1, extra: 1 })).status, 400);
    assert.equal(store.subscriptions().length, 1, 'l’adresse du signalant n’est pas enregistrée par le signalement');

    assert.equal((await post('/api/push/test', { endpoint: 'https://fcm.googleapis.com/inconnu' })).status, 404);
    assert.equal((await post('/api/push/test', {})).status, 400);
    assert.equal((await post('/api/push/test', { endpoint: sub.endpoint })).status, 200);
    assert.deepEqual(calls.at(-1), { message: TEST_MESSAGE, target: { only: sub.endpoint } });
    assert.equal((await post('/api/push/test', { endpoint: sub.endpoint })).status, 429);
    now += 11_000;
    outcome = { sent: 0, failed: 1 };
    assert.equal((await post('/api/push/test', { endpoint: sub.endpoint })).status, 502);
  } finally { server.close(); }
}));
