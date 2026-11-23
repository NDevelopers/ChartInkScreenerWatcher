// Remembers when each stock entered a scanner, and which stocks dropped out
// ("deactivated"). Saved to data/history.json so it survives restarts;
// deactivated entries are kept for KEEP_MS (1 week).

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'history.json');
const KEEP_MS = 7 * 24 * 3600 * 1000;

// { [scannerUrl]: { active: { [symbol]: info }, deactivated: [info] } }
let state = {};
try {
  if (existsSync(FILE)) state = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (err) {
  console.warn('Could not read history.json, starting fresh:', err.message);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(DIR, { recursive: true });
    writeFile(FILE, JSON.stringify(state)).catch((e) => console.warn('history save failed:', e.message));
  }, 500);
}

function prune(h, now) {
  h.deactivated = h.deactivated.filter((d) => now - d.removedAt < KEEP_MS);
}

/**
 * Record a successful scan result. Call only when Chartink answered OK.
 * Returns the stocks that entered / dropped out since the previous result
 * (nothing on the very first result for a scanner).
 */
export function record(url, stocks, now = Date.now()) {
  const firstEver = !state[url];
  const h = (state[url] ||= { active: {}, deactivated: [] });
  const current = new Set();
  const added = [];
  const removed = [];

  for (const s of stocks) {
    current.add(s.symbol);
    const prev = h.active[s.symbol];
    if (!prev && !firstEver) added.push(s);
    h.active[s.symbol] = {
      symbol: s.symbol,
      name: s.name,
      firstSeen: prev?.firstSeen ?? now,
      // Already in the list when tracking started: real entry time unknown.
      initial: prev ? !!prev.initial : firstEver,
      lastSeen: now,
      entryClose: prev?.entryClose ?? s.close,
      close: s.close,
      change: s.change,
    };
    // Back in the list: it's active again, not deactivated.
    h.deactivated = h.deactivated.filter((d) => d.symbol !== s.symbol);
  }

  for (const [sym, info] of Object.entries(h.active)) {
    if (current.has(sym)) continue;
    delete h.active[sym];
    const d = { ...info, removedAt: now };
    h.deactivated.unshift(d);
    removed.push(d);
  }

  prune(h, now);
  save();
  return { added, removed };
}

const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/**
 * A stock that leaves the live list is usually not a real drop: when its candle
 * closes while still matching, Chartink moves it to the "recent matches"
 * (backtest) list at the bottom of the page. It's only a real drop if it left
 * mid-candle and never shows up in those matches.
 * `recent` = [{ time, stocks: [{ symbol }] }] from the same scan.
 */
export function inRecentMatches(d, recent = []) {
  if (!recent.length) return false;
  // Daily/weekly bars start at IST midnight; intraday bars don't.
  const eod = recent.every((b) => (b.time + IST_MS) % DAY_MS === 0);
  // The matching bar can start before the stock showed up live (it appears as
  // the candle completes), so look back one bar's worth (+ margin).
  const from = d.firstSeen - (eod ? 8 * DAY_MS : 2 * 3600 * 1000);
  return recent.some(
    (b) => b.time >= from && b.time <= d.removedAt && b.stocks?.some((s) => (s.symbol ?? s) === d.symbol)
  );
}

/**
 * Mark deactivated stocks that went to Chartink's recent-matches list.
 * Checked again on every scan, since the backtest can lag a minute behind.
 */
export function markMovedToHistory(url, recent) {
  const h = state[url];
  if (!h || !recent?.length) return;
  let changed = false;
  for (const d of h.deactivated) {
    if (!d.movedToHistory && inRecentMatches(d, recent)) {
      d.movedToHistory = true;
      changed = true;
    }
  }
  if (changed) save();
}

export function getHistory(url, now = Date.now()) {
  const h = state[url];
  if (!h) return { active: {}, deactivated: [] };
  prune(h, now);
  return h;
}

export function forget(url) {
  delete state[url];
  save();
}
