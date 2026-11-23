// Browser push notifications (Web Push). The server sends them, so desktop
// alerts arrive even when the dashboard tab is asleep in the background.
// VAPID keys and subscriptions are kept in server/data/.

import webpush from 'web-push';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const KEYS_FILE = path.join(DATA, 'vapid.json');
const SUBS_FILE = path.join(DATA, 'push-subscriptions.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

let keys = readJson(KEYS_FILE, null);
if (!keys?.publicKey) {
  keys = webpush.generateVAPIDKeys();
  writeJson(KEYS_FILE, keys);
}
webpush.setVapidDetails('mailto:chartink-watcher@localhost', keys.publicKey, keys.privateKey);

let subs = readJson(SUBS_FILE, []);
const saveSubs = () => writeJson(SUBS_FILE, subs);

export const pushPublicKey = () => keys.publicKey;
export const pushCount = () => subs.length;

export function addSubscription(sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Invalid push subscription');
  subs = subs.filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: sub.keys });
  saveSubs();
}

export function removeSubscription(endpoint) {
  subs = subs.filter((s) => s.endpoint !== endpoint);
  saveSubs();
}

/** Send one notification to every subscribed browser. Never throws. */
export async function pushToAll(payload) {
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  const gone = [];
  await Promise.all(
    subs.map((s) =>
      webpush.sendNotification(s, body, { TTL: 15 * 60 }).catch((err) => {
        // 404/410: the browser dropped this subscription.
        if (err.statusCode === 404 || err.statusCode === 410) gone.push(s.endpoint);
        else console.warn('Push failed:', err.statusCode || '', err.message);
      })
    )
  );
  if (gone.length) {
    subs = subs.filter((s) => !gone.includes(s.endpoint));
    saveSubs();
  }
}

/** Desktop alert for stocks that entered / dropped out of a scanner. */
export function pushChanges({ name, url, added, removed }) {
  if (!added.length && !removed.length) return;
  const lines = [];
  if (added.length) lines.push(`▲ Added: ${added.map((s) => s.symbol).join(', ')}`);
  if (removed.length) lines.push(`▼ Dropped: ${removed.map((s) => s.symbol).join(', ')}`);
  pushToAll({ title: `${name} updated`, body: lines.join('\n'), tag: url, url, added: added.length > 0 });
}
