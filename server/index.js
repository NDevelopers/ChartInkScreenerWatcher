import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runScanner } from './chartink.js';
import './env.js';
import { record, getHistory, forget, markMovedToHistory } from './history.js';
import { alertChanges, sendTest, telegramEnabled, telegramPaused, notifyDropped } from './telegram.js';
import { setSetting } from './settings.js';
import { fetchAllowed, allOff } from './market-hours.js';
import { pushChanges, pushPublicKey, addSubscription, removeSubscription, pushToAll, pushCount } from './push.js';
import { getSectors, SECTORS_REFRESH_MS, getIndices, INDEX_REFRESH_MS } from './trendlyne.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(__dirname, 'scanners.json');
const PORT = process.env.PORT || 4000;
const CACHE_MS = 20 * 1000; // don't hit Chartink more than once per 20s per scanner

const app = express();
app.use(express.json());

async function loadScanners() {
  return JSON.parse(await readFile(CONFIG, 'utf8'));
}
async function saveScanners(list) {
  await writeFile(CONFIG, JSON.stringify(list, null, 2) + '\n');
}

const results = new Map(); // url -> { at, data | error }
const inFlight = new Map();

async function getResult(scanner, force) {
  const url = scanner.url;
  const hit = results.get(url);
  // Switched off: never fetch again once we have something to show.
  if (allOff() && hit) return hit;
  // Outside 9:00–16:00 IST keep serving the last result; only a manual refresh (force) fetches.
  if (!force && hit && (Date.now() - hit.at < CACHE_MS || !fetchAllowed())) return hit;
  if (inFlight.has(url)) return inFlight.get(url);

  const p = runScanner(url)
    .then((data) => {
      // Only on success, so an error never looks like "everything dropped out".
      const { added, removed: left } = record(url, data.stocks);
      markMovedToHistory(url, data.recent);
      // Stocks whose candle closed while matching move to Chartink's recent
      // matches; only alert on the ones that really dropped out.
      const removed = left.filter((d) => !d.movedToHistory);
      // Paused scanners keep being tracked, they just don't alert.
      if (!allOff() && !scanner.alertsPaused) {
        alertChanges({ name: scanner.name || data.title, url, added, removed });
        pushChanges({ name: scanner.name || data.title, url, added, removed });
      }
      return { at: Date.now(), data };
    })
    .catch((err) => ({ at: Date.now(), error: err.message, data: hit?.data }))
    .then((r) => {
      results.set(url, r);
      inFlight.delete(url);
      return r;
    });
  inFlight.set(url, p);
  return p;
}

app.get('/api/scanners', async (req, res) => {
  const force = req.query.force === '1';
  const scanners = await loadScanners();
  const out = await Promise.all(
    scanners.map(async (s) => {
      const r = await getResult(s, force);
      markMovedToHistory(s.url, r.data?.recent);
      const h = getHistory(s.url);
      return {
        url: s.url,
        name: s.name || r.data?.title || s.url,
        alertsPaused: !!s.alertsPaused,
        updatedAt: r.at,
        error: r.error || null,
        stocks: (r.data?.stocks || []).map((st) => ({
          ...st,
          firstSeen: h.active[st.symbol]?.firstSeen ?? null,
          entryClose: h.active[st.symbol]?.entryClose ?? null,
          initial: !!h.active[st.symbol]?.initial,
        })),
        deactivated: h.deactivated,
        recent: r.data?.recent || [],
        recentMode: r.data?.recentMode || 'window',
        recentError: r.data?.recentError || null,
      };
    })
  );
  res.json(out);
});

app.post('/api/scanners', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https:\/\/chartink\.com\/screener\/[\w-]+\/?$/.test(url)) {
    return res.status(400).json({ error: 'URL must look like https://chartink.com/screener/<name>' });
  }
  const scanners = await loadScanners();
  if (scanners.some((s) => s.url === url)) return res.status(409).json({ error: 'Already watching this scanner' });
  scanners.push({ url, name: req.body?.name?.trim() || undefined });
  await saveScanners(scanners);
  res.json({ ok: true });
});

// Pause / resume alerts for one scanner: { url, paused: true | false }
app.post('/api/scanners/alerts', async (req, res) => {
  const url = String(req.body?.url || '');
  if (typeof req.body?.paused !== 'boolean') return res.status(400).json({ error: 'Send { url, paused: true | false }' });
  const scanners = await loadScanners();
  const s = scanners.find((x) => x.url === url);
  if (!s) return res.status(404).json({ error: 'Not watching this scanner' });
  if (req.body.paused) s.alertsPaused = true;
  else delete s.alertsPaused;
  await saveScanners(scanners);
  console.log(`Alerts ${req.body.paused ? 'paused' : 'resumed'} for ${url}`);
  res.json({ ok: true, url, alertsPaused: req.body.paused });
});

app.delete('/api/scanners', async (req, res) => {
  const url = String(req.query.url || '');
  const scanners = await loadScanners();
  await saveScanners(scanners.filter((s) => s.url !== url));
  results.delete(url);
  forget(url);
  res.json({ ok: true });
});

// Browser push (desktop alerts that work even when the tab is asleep).
app.get('/api/push/key', (req, res) => res.json({ publicKey: pushPublicKey(), subscribers: pushCount() }));
app.post('/api/push/subscribe', (req, res) => {
  try {
    addSubscription(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/push/unsubscribe', (req, res) => {
  removeSubscription(String(req.body?.endpoint || ''));
  res.json({ ok: true });
});
app.post('/api/push/test', async (req, res) => {
  await pushToAll({ title: 'Chartink Watcher', body: 'Desktop alerts are working ✅', tag: 'test', url: '/' });
  res.json({ ok: true, subscribers: pushCount() });
});

// NIFTY 50 (and other index cards) from Trendlyne Markets Today, refreshed every 1 min.
app.get('/api/indices', async (req, res) => {
  const r = await getIndices();
  res.json({
    updatedAt: r.lastGoodAt,
    refreshMs: INDEX_REFRESH_MS,
    error: r.error,
    nifty: r.indices.find((i) => /^nifty 50$/i.test(i.name)) || null,
    indices: r.indices,
  });
});

// Top sectors by day change (Trendlyne), refreshed every 15 min.
app.get('/api/sectors', async (req, res) => {
  const r = await getSectors();
  const top = Math.min(Number(req.query.top) || 5, 30);
  const byChange = [...r.sectors].sort((a, b) => b.change - a.change);
  res.json({
    updatedAt: r.lastGoodAt ?? null,
    nextRefreshAt: r.at + SECTORS_REFRESH_MS,
    refreshMs: SECTORS_REFRESH_MS,
    error: r.error || null,
    total: r.sectors.length,
    gainers: byChange.slice(0, top),
    losers: byChange.slice(-top).reverse(),
  });
});

// Master switch: turn everything (fetching, Telegram, desktop alerts) off / on.
app.get('/api/power', (req, res) => res.json({ on: !allOff() }));
app.post('/api/power', (req, res) => {
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'Send { "on": true | false }' });
  setSetting('allOff', !req.body.on);
  console.log(`Everything turned ${req.body.on ? 'ON' : 'OFF'}`);
  res.json({ on: req.body.on });
});

const telegramStatus = () => ({
  configured: telegramEnabled(),
  on: telegramEnabled() && !telegramPaused(),
  notifyDropped: notifyDropped(),
});

app.get('/api/telegram', (req, res) => res.json(telegramStatus()));

// Turn Telegram alerts on/off: { on: true | false }
app.post('/api/telegram', (req, res) => {
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'Send { "on": true | false }' });
  setSetting('telegramPaused', !req.body.on);
  console.log(`Telegram alerts turned ${req.body.on ? 'ON' : 'OFF'}`);
  res.json(telegramStatus());
});

app.post('/api/telegram/test', async (req, res) => {
  const r = await sendTest();
  res.status(r.ok ? 200 : 400).json(r);
});

// Keep checking scanners in the background during market hours, so stocks that
// enter and leave a scanner are tracked even when no browser tab is open.
const POLL_MS = 60 * 1000;
setInterval(async () => {
  if (!fetchAllowed()) return;
  try {
    for (const s of await loadScanners()) await getResult(s, false);
  } catch (err) {
    console.warn('background poll failed:', err.message);
  }
}, POLL_MS);

// In production, serve the built React app.
const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res, next) =>
  res.sendFile(path.join(dist, 'index.html'), (err) => err && next())
);

app.listen(PORT, () => console.log(`Chartink watcher API on http://localhost:${PORT}`));
