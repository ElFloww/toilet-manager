/** Côté navigateur : application installable et abonnement aux notifications push. */

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on' | 'busy';

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => {
        // Une appli installée reste ouverte des jours : on cherche une nouvelle version à chaque retour au premier plan.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
        });
      })
      .catch(error => console.error('Service worker non enregistré :', error));
  });
}

/** Préférence locale « alertes voulues » : évite de réabonner automatiquement quelqu'un qui les a coupées. */
const WANTED_KEY = 'tm-alerts';
function wanted(): boolean | null {
  try { const value = localStorage.getItem(WANTED_KEY); return value === null ? null : value === 'on'; } catch { return null; }
}
function setWanted(value: boolean) {
  try { localStorage.setItem(WANTED_KEY, value ? 'on' : 'off'); } catch { /* navigation privée : sans importance */ }
}

/** Le service worker peut ne jamais devenir actif (échec d'installation) : on n'attend pas indéfiniment. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Le service worker n’est pas prêt : rechargez la page et réessayez.')), 8000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), char => char.charCodeAt(0));
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Object.assign(new Error(data?.error ?? `Le serveur a répondu avec l’erreur ${response.status}.`), { status: response.status });
  }
}

/** Abonnement du navigateur, valable pour la clé actuelle du serveur (sinon recréé). */
async function ensureSubscription(registration: ServiceWorkerRegistration, create: boolean): Promise<PushSubscription | null> {
  const { publicKey } = await (await fetch('/api/push/key')).json() as { publicKey: string };
  const expected = base64UrlToBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    // Clé serveur différente (base réinitialisée) : on repart d'un abonnement neuf.
    const current = subscription.options.applicationServerKey;
    if (!current || new Uint8Array(current).join() !== expected.join()) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  if (!subscription && create) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected });
  return subscription;
}

/** Demande l'autorisation, s'abonne et enregistre l'abonnement sur le serveur. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const registration = await readyRegistration();
  const subscription = await ensureSubscription(registration, true);
  await post('/api/push/subscriptions', subscription!.toJSON());
  setWanted(true);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  setWanted(false);
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await post('/api/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return 'off';
}

/**
 * Au lancement et à chaque retour au premier plan : réenregistre l'abonnement sur le serveur.
 * Répare tout seul une base serveur réinitialisée, un abonnement purgé après une erreur d'envoi,
 * ou un abonnement que le navigateur a renouvelé. Ne réabonne jamais quelqu'un qui a coupé les alertes.
 */
export async function syncPush(): Promise<PushState> {
  if (!pushSupported()) return currentPushState();
  if (Notification.permission !== 'granted') return currentPushState();
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'off';
  if (wanted() === false) return currentPushState(); // alertes coupées volontairement : on ne touche à rien
  const subscription = await ensureSubscription(registration, wanted() === true);
  if (!subscription) return 'off';
  await post('/api/push/subscriptions', subscription.toJSON());
  if (wanted() === null) setWanted(true);
  return 'on';
}

/** Adresse push de cet appareil, envoyée avec un signalement pour ne pas notifier son auteur. */
export async function ownEndpoint(): Promise<string | undefined> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return undefined;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription())?.endpoint;
  } catch { return undefined; }
}

/** Envoie une notification de test à cet appareil ; réabonne l'appareil si le serveur ne le connaît plus. */
export async function sendTestPush(): Promise<void> {
  const send = async () => {
    const endpoint = await ownEndpoint();
    if (!endpoint) throw new Error('Cet appareil n’est pas abonné aux alertes.');
    await post('/api/push/test', { endpoint });
  };
  try { await send(); }
  catch (cause) {
    if ((cause as { status?: number }).status !== 404) throw cause;
    await syncPush();
    await send();
  }
}

/** Évènement d'installation (Chrome / Edge / Android). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
