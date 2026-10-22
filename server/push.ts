/**
 * Notifications Web Push sans dépendance externe.
 * - Chiffrement du message : RFC 8291 (aes128gcm, RFC 8188).
 * - Identification du serveur : VAPID, RFC 8292 (JWT ES256).
 */
import { createECDH, createCipheriv, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  publicKey: string; // point P-256 non compressé, base64url (65 octets)
  privateKey: string; // scalaire P-256, base64url (32 octets)
}

const b64u = (buffer: Buffer | Uint8Array) => Buffer.from(buffer).toString('base64url');
const fromB64u = (text: string) => Buffer.from(text, 'base64url');

/** Services de push des navigateurs autorisés (évite d'envoyer des requêtes vers n'importe quel hôte). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/** Valide un abonnement reçu d'un navigateur ; renvoie null s'il est invalide. */
export function parseSubscription(value: unknown): PushSubscriptionData | null {
  if (!value || typeof value !== 'object') return null;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!PUSH_HOSTS.some(pattern => pattern.test(url.hostname))) return null;
  if (!keys || typeof keys !== 'object') return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]+=*$/.test(p256dh) || !/^[A-Za-z0-9_-]+=*$/.test(auth)) return null;
  const publicKey = fromB64u(p256dh);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04 || fromB64u(auth).length !== 16) return null;
  return { endpoint: url.toString(), keys: { p256dh, auth } };
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x!), fromB64u(jwk.y!)])),
    privateKey: jwk.d!,
  };
}

function vapidPrivateKey(keys: VapidKeys): KeyObject {
  const point = fromB64u(keys.publicKey);
  return createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33, 65)) },
  });
}

/** En-tête Authorization VAPID pour un point de terminaison donné. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidPrivateKey(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/**
 * Chiffre un message pour un abonnement (RFC 8291).
 * `salt` et `senderPrivateKey` ne sont fournis que par les tests (vecteurs de la RFC).
 */
export function encryptPayload(payload: Buffer, subscription: PushSubscriptionData, salt = randomBytes(16), senderPrivateKey?: Buffer): Buffer {
  const userPublicKey = fromB64u(subscription.keys.p256dh);
  const authSecret = fromB64u(subscription.keys.auth);
  const ecdh = createECDH('prime256v1');
  if (senderPrivateKey) ecdh.setPrivateKey(senderPrivateKey);
  else ecdh.generateKeys();
  const senderPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userPublicKey);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), userPublicKey, senderPublicKey]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);
  const contentKey = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(senderPublicKey.length, 20);
  return Buffer.concat([header, senderPublicKey, encrypted]);
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface PushTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array }): Promise<{ status: number }>;
}

export interface SubscriptionStore {
  subscriptions(): PushSubscriptionData[];
  removeSubscription(endpoint: string): void;
}

/** Envoie un message à tous les abonnés ; supprime les abonnements expirés (404 / 410). */
export async function broadcast(store: SubscriptionStore, keys: VapidKeys, subject: string, message: PushMessage, transport: PushTransport = fetch as unknown as PushTransport) {
  const payload = Buffer.from(JSON.stringify(message));
  const results = await Promise.allSettled(store.subscriptions().map(async subscription => {
    const response = await transport(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '3600',
        Urgency: 'normal',
        Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'toilet',
      },
      body: encryptPayload(payload, subscription),
    });
    if (response.status === 404 || response.status === 410) store.removeSubscription(subscription.endpoint);
    else if (response.status >= 400) throw new Error(`Service de push : statut ${response.status}`);
  }));
  const failures = results.filter(result => result.status === 'rejected').length;
  // On ne journalise jamais les adresses d'abonnement, seulement un compte.
  if (failures) console.error(`Notifications : ${failures} envoi(s) en échec sur ${results.length}.`);
  return { sent: results.length - failures, failed: failures };
}
