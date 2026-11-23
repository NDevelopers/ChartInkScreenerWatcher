// Sound + desktop notification helpers.

let ctx = null;
function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow sound after the user has interacted with the page once.
// Unlock the audio context on the first click/keypress anywhere.
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      audio();
    } catch {}
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function tone(freq, start, dur) {
  const a = audio();
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = a.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Rising chime when stocks were added, falling one when only removed. */
export function playChime(kind) {
  try {
    if (kind === 'added') {
      tone(660, 0, 0.18);
      tone(880, 0.16, 0.18);
      tone(1320, 0.32, 0.3);
    } else {
      tone(700, 0, 0.2);
      tone(470, 0.18, 0.3);
    }
  } catch {
    // Audio not available / not yet unlocked: ignore.
  }
}

// ---- Server push (works while the tab sleeps) ----

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let pushActive = false;

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/**
 * Register the service worker and make sure this browser is subscribed with the server.
 * Only asks for permission when `ask` is true (must be called from a click).
 * Returns 'on' | 'default' | 'denied' | 'unsupported' | 'error: …'.
 */
export async function setupPush(ask = false) {
  if (!pushSupported()) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default' && ask) perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await fetch('/api/push/key').then((r) => r.json());
    let sub = await reg.pushManager.getSubscription();
    // Server keys changed (e.g. data folder wiped): subscribe again.
    if (sub && sub.options?.applicationServerKey) {
      const current = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (current !== publicKey.replace(/=+$/, '')) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    pushActive = true;
    return 'on';
  } catch (e) {
    pushActive = false;
    return `error: ${e.message}`;
  }
}

export function desktopNotify(title, body) {
  // With push on, the server already sent this alert; don't show it twice.
  if (pushActive) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: title });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}
