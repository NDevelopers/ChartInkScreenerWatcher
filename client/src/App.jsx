import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playChime, desktopNotify, setupPush } from './alerts.js';

const INTERVALS = [
  { label: '30 sec', ms: 30_000 },
  { label: '1 min', ms: 60_000 },
  { label: '2 min', ms: 120_000 },
  { label: '5 min', ms: 300_000 },
  { label: 'Off', ms: 0 },
];

const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('en-IN') : '–');

// Bar time in IST. Daily/weekly bars start at midnight, so show only the date for those.
function fmtBar(t) {
  const d = new Date(t);
  const opts = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' };
  const date = d.toLocaleDateString('en-IN', opts);
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  return /^12:00\s*am$/i.test(time) ? date : `${date}, ${time}`;
}

function RecentTable({ recent }) {
  return (
    <table className="recent">
      <thead>
        <tr>
          <th>Matched at</th>
          <th>Symbol</th>
          <th>Cap</th>
          <th>Sector</th>
        </tr>
      </thead>
      <tbody>
        {recent.flatMap((bar) =>
          bar.stocks.map((st, i) => (
            <tr key={`${bar.time}-${st.symbol}`} className={i === 0 ? 'bar-start' : ''}>
              <td className="when">{i === 0 ? fmtBar(bar.time) : ''}</td>
              <td>
                <a
                  href={`https://chartink.com/stocks/${encodeURIComponent(String(st.symbol).toLowerCase())}.html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {st.symbol}
                </a>
              </td>
              <td className="name">{st.cap}</td>
              <td className="name">{st.sector}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function RecentSection({ scanner }) {
  const { recent, recentMode, recentError } = scanner;
  const count = recent.reduce((n, b) => n + b.stocks.length, 0);
  // Weekly scanners return one bar per week, so "last 3 days" really means last 3 weeks.
  const weekly = recent.length > 1 && Math.abs(recent[0].time - recent[1].time) >= 5 * 864e5;
  const period =
    recentMode === 'latest' ? 'most recent (none in last 3 days)' : weekly ? 'last 3 weeks' : 'last 3 days';
  if (recentError) return <div className="banner error small">Recent matches unavailable: {recentError}</div>;
  if (!count) return <p className="empty small">No recent matches on Chartink.</p>;

  return (
    <details className="recent-wrap" open>
      <summary>
        Recent matches, {period} ({count})
      </summary>
      <RecentTable recent={recent} />
    </details>
  );
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const fmtStamp = (t) =>
  new Date(t).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function DeactivatedSection({ deactivated: all, justRemoved = [] }) {
  // Stocks whose candle closed while matching are listed under recent matches
  // (like on Chartink), not here. Only real drop-outs are shown.
  const deactivated = (all || []).filter((d) => !d.movedToHistory);
  if (!deactivated.length) return null;
  return (
    <details className="recent-wrap" open>
      <summary>Dropped out, last 7 days ({deactivated.length})</summary>
      <table className="recent">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Entered</th>
            <th>Dropped</th>
            <th className="num">Stayed</th>
            <th className="num">Last price</th>
          </tr>
        </thead>
        <tbody>
          {deactivated.map((d) => (
            <tr
              key={`${d.symbol}-${d.removedAt}`}
              className={
                justRemoved.includes(d.symbol) || Date.now() - d.removedAt < HIGHLIGHT_MS ? 'dropped-recent' : ''
              }
            >
              <td>
                <a
                  href={`https://chartink.com/stocks/${encodeURIComponent(String(d.symbol).toLowerCase())}.html`}
                  target="_blank"
                  rel="noreferrer"
                  title={d.name}
                >
                  {d.symbol}
                </a>
              </td>
              <td className="name">{fmtStamp(d.firstSeen)}</td>
              <td className="name">{fmtStamp(d.removedAt)}</td>
              <td className="num name">{fmtDuration(d.lastSeen - d.firstSeen)}</td>
              <td className="num">{fmtNum(d.close)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const DEFAULT_VIDEO = 'https://www.youtube.com/watch?v=i__VlyPgAno';

// Accepts watch?v=, youtu.be/, /live/, /shorts/ and /embed/ links, or a bare 11-char id.
function youtubeId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function VideoPanel() {
  const [url, setUrl] = useState(() => localStorage.getItem('videoUrl') || DEFAULT_VIDEO);
  const [draft, setDraft] = useState(url);
  const [open, setOpen] = useState(() => localStorage.getItem('videoOpen') !== '0');
  const id = youtubeId(url);

  useEffect(() => localStorage.setItem('videoOpen', open ? '1' : '0'), [open]);

  function apply(e) {
    e.preventDefault();
    if (!youtubeId(draft)) return alert('That does not look like a YouTube link.');
    setUrl(draft.trim());
    localStorage.setItem('videoUrl', draft.trim());
  }

  return (
    <section className="card video-card">
      <div className="card-head">
        <h2>Video</h2>
        <button className="ghost small" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          {id && (
            <div className="video-frame">
              <iframe
                src={`https://www.youtube.com/embed/${id}?autoplay=1&mute=1`}
                title="YouTube video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          )}
          <form className="add video-form" onSubmit={apply}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="YouTube link" />
            <button type="submit" disabled={!draft.trim() || draft.trim() === url}>
              Play
            </button>
          </form>
        </>
      )}
    </section>
  );
}

const fmtSigned = (n) => (n == null ? '–' : `${n > 0 ? '+' : ''}${fmtNum(n)}%`);
const signClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

// Master switch ("All ON/OFF"), shared with the panels' timers.
const power = { on: true };
const autoRefreshAllowed = () => power.on && isMarketWindow();

// Auto-refresh only runs 9:00 AM – 4:00 PM IST, Mon–Fri (matches server/market-hours.js).
function isMarketWindow(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 && mins < 16 * 60;
}
function useMarketWindow() {
  const [open, setOpen] = useState(isMarketWindow);
  useEffect(() => {
    const t = setInterval(() => setOpen(isMarketWindow()), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  return open;
}

// NIFTY 50 price and day change (source: Trendlyne Markets Today). Fixed 1-minute refresh.
function NiftyTicker() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/indices')
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(() => autoRefreshAllowed() && load(), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const n = data?.nifty;
  if (!n) return <span className="nifty muted">NIFTY 50 {error || data?.error ? '· unavailable' : '…'}</span>;
  const cls = signClass(n.change);
  const stale = error || data.error;
  return (
    <a
      className={`nifty ${cls}-bg`}
      href={n.url}
      target="_blank"
      rel="noreferrer"
      title={`As of ${n.asOf}${n.advances != null ? ` · ${n.advances} up / ${n.declines} down` : ''}${
        stale ? ` · last refresh failed: ${stale}` : ''
      } · refreshes every 1 min (Trendlyne)`}
    >
      <span className="nifty-name">NIFTY 50</span>
      <strong className="nifty-price">{fmtNum(n.price)}</strong>
      <span className={cls}>
        {n.change > 0 ? '▲' : n.change < 0 ? '▼' : ''} {fmtNum(Math.abs(n.change))} ({fmtSigned(n.changePct)})
      </span>
      {stale && <span className="nifty-stale">⚠</span>}
    </a>
  );
}

// Top sectors by day change (source: Trendlyne). Fixed 15-minute refresh.
function SectorsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [side, setSide] = useState(() => localStorage.getItem('sectorSide') || 'gainers');

  useEffect(() => localStorage.setItem('sectorSide', side), [side]);

  useEffect(() => {
    let timer;
    let first = true;
    const load = async () => {
      // After the first load, only fetch during market hours; check again in a minute.
      if (!first && !autoRefreshAllowed()) {
        timer = setTimeout(load, 60 * 1000);
        return;
      }
      first = false;
      let wait = 15 * 60 * 1000;
      try {
        const res = await fetch('/api/sectors?top=5');
        const body = await res.json();
        setData(body);
        setError(null);
        // Ask again just after the server's next refresh.
        if (body.nextRefreshAt) wait = Math.max(30 * 1000, body.nextRefreshAt - Date.now() + 5000);
      } catch (e) {
        setError(e.message);
        wait = 60 * 1000;
      }
      timer = setTimeout(load, wait);
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  const rows = data?.[side] || [];
  return (
    <section className="card sectors-card">
      <div className="card-head">
        <div>
          <h2>Top 5 sectors · day change</h2>
          <div className="meta">
            <a href="https://trendlyne.com/equity/sector-industry-analysis/sector/day/" target="_blank" rel="noreferrer">
              Trendlyne
            </a>
            {data?.updatedAt && <> · updated {fmtStamp(data.updatedAt)}</>} · refreshes every 15 min
          </div>
        </div>
        <div className="seg">
          <button className={side === 'gainers' ? 'seg-on' : 'ghost'} onClick={() => setSide('gainers')}>
            Gainers
          </button>
          <button className={side === 'losers' ? 'seg-on' : 'ghost'} onClick={() => setSide('losers')}>
            Losers
          </button>
        </div>
      </div>
      {(error || data?.error) && <div className="banner error small">{error || data.error}</div>}
      {!data && !error && <p className="empty small">Loading sectors…</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Sector</th>
              <th className="num">Day %</th>
              <th className="num">Week %</th>
              <th className="num" title="Advances / Declines">Adv / Dec</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.name}>
                <td className="name">{i + 1}</td>
                <td className="sector-name">
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                </td>
                <td className={`num ${signClass(s.change)}`}>
                  <strong>{fmtSigned(s.change)}</strong>
                </td>
                <td className={`num ${signClass(s.weekChange)}`}>{fmtSigned(s.weekChange)}</td>
                <td className="num">
                  <span className="up">{s.advances ?? '–'}</span> / <span className="down">{s.declines ?? '–'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Rows stay highlighted this long after a stock enters / drops out.
const HIGHLIGHT_MS = 15 * 60 * 1000;

let toastSeq = 0;

export default function App() {
  const [scanners, setScanners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const marketOpen = useMarketWindow();
  const [allOn, setAllOn] = useState(true);
  power.on = allOn;
  useEffect(() => {
    fetch('/api/power')
      .then((r) => r.json())
      .then((p) => setAllOn(p.on))
      .catch(() => {});
  }, []);
  const [intervalMs, setIntervalMs] = useState(() => Number(localStorage.getItem('intervalMs') ?? 60_000));
  const [newUrl, setNewUrl] = useState('');
  const [sound, setSound] = useState(() => localStorage.getItem('sound') !== '0');
  const [notifPerm, setNotifPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  // Unacknowledged changes per scanner: url -> { added: [], removed: [], at }
  const [changes, setChanges] = useState({});
  const [toasts, setToasts] = useState([]);
  const prev = useRef(null); // url -> Set of symbols from last refresh
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => localStorage.setItem('sound', sound ? '1' : '0'), [sound]);

  const [telegram, setTelegram] = useState(null); // { configured, on, notifyDropped }
  useEffect(() => {
    fetch('/api/telegram')
      .then((r) => r.json())
      .then(setTelegram)
      .catch(() => {});
  }, []);

  async function togglePower() {
    const on = !allOn;
    if (!on && !confirm('Turn everything OFF?\n\nNo scanning, no NIFTY/sector refresh, no Telegram or desktop alerts until you turn it back ON.')) return;
    try {
      const res = await fetch('/api/power', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const p = await res.json();
      power.on = p.on;
      setAllOn(p.on);
      if (p.on) refresh();
    } catch (e) {
      alert(`Could not switch: ${e.message}`);
    }
  }

  async function toggleTelegram() {
    try {
      const res = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ on: !telegram.on }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setTelegram(await res.json());
    } catch (e) {
      alert(`Could not change Telegram alerts: ${e.message}`);
    }
  }

  const pushToast = useCallback((t) => {
    const id = ++toastSeq;
    setToasts((list) => [...list.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 12_000);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/scanners${force ? '?force=1' : ''}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();

        const diffs = [];
        for (const s of data) {
          const before = prev.current?.[s.url];
          if (!before || s.error) continue; // first load / failed fetch: nothing to compare
          const now = new Set(s.stocks.map((x) => x.symbol));
          const added = [...now].filter((sym) => !before.has(sym));
          const movedToHistory = new Set((s.deactivated || []).filter((d) => d.movedToHistory).map((d) => d.symbol));
          const removed = [...before].filter((sym) => !now.has(sym) && !movedToHistory.has(sym));
          if (added.length || removed.length) diffs.push({ url: s.url, name: s.name, added, removed });
        }
        prev.current = Object.fromEntries(data.map((s) => [s.url, new Set(s.stocks.map((x) => x.symbol))]));

        if (diffs.length) {
          setChanges((c) => {
            const next = { ...c };
            for (const d of diffs) {
              const old = next[d.url] || { added: [], removed: [] };
              // A stock that came back cancels its "removed" mark, and vice versa.
              next[d.url] = {
                added: [...new Set([...old.added.filter((x) => !d.removed.includes(x)), ...d.added])],
                removed: [...new Set([...old.removed.filter((x) => !d.added.includes(x)), ...d.removed])],
                at: Date.now(),
              };
            }
            return next;
          });
          for (const d of diffs) {
            pushToast(d);
            const parts = [];
            if (d.added.length) parts.push(`Added: ${d.added.join(', ')}`);
            if (d.removed.length) parts.push(`Dropped: ${d.removed.join(', ')}`);
            desktopNotify(`${d.name} updated`, parts.join('\n'));
          }
          if (soundRef.current) playChime(diffs.some((d) => d.added.length) ? 'added' : 'removed');
        }

        setScanners(data);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  const unseen = Object.keys(changes).length;
  useEffect(() => {
    document.title = unseen ? `(${unseen}) Chartink Watcher` : 'Chartink Watcher';
  }, [unseen]);

  const markSeen = (url) =>
    setChanges((c) => {
      const next = { ...c };
      delete next[url];
      return next;
    });

  function scrollToCard(url) {
    document.getElementById(`card-${encodeURIComponent(url)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Desktop alerts via server push: re-check the subscription on every load.
  useEffect(() => {
    if (notifPerm === 'granted') setupPush(false).then(setNotifPerm);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Browsers pause timers in background / sleeping tabs. Catch up as soon as the
  // tab is visible again, and whenever the server pushes a scanner update.
  const lastRefresh = useRef(0);
  useEffect(() => {
    lastRefresh.current = Date.now();
  }, [scanners]);
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 15 * 1000) refresh();
    };
    const onMessage = (e) => e.data?.type === 'scanner-update' && refresh();
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('focus', catchUp);
    window.addEventListener('online', catchUp);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('focus', catchUp);
      window.removeEventListener('online', catchUp);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem('intervalMs', String(intervalMs));
    if (!intervalMs) return;
    const id = setInterval(() => autoRefreshAllowed() && refresh(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, refresh]);

  // Symbols that appear in more than one scanner.
  const common = useMemo(() => {
    const count = new Map();
    for (const s of scanners) for (const st of s.stocks) count.set(st.symbol, (count.get(st.symbol) || 0) + 1);
    return new Set([...count].filter(([, c]) => c > 1).map(([sym]) => sym));
  }, [scanners]);

  async function addScanner(e) {
    e.preventDefault();
    const res = await fetch('/api/scanners', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: newUrl.trim() }),
    });
    const body = await res.json();
    if (!res.ok) return alert(body.error);
    setNewUrl('');
    refresh(true);
  }

  async function removeScanner(url) {
    if (!confirm('Stop watching this scanner?')) return;
    await fetch(`/api/scanners?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="app">
      <header>
        <div className="title-wrap">
          <h1>Chartink Watcher</h1>
          <NiftyTicker />
        </div>
        <div className="controls">
          <button
            className={`power ${allOn ? 'power-on' : 'power-off'}`}
            onClick={togglePower}
            title={allOn ? 'Turn everything off: scanning, NIFTY/sectors refresh, Telegram and desktop alerts' : 'Turn everything back on'}
          >
            ⏻ {allOn ? 'All ON' : 'All OFF'}
          </button>
          <label>
            Auto-refresh{' '}
            <select value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))}>
              {INTERVALS.map((i) => (
                <option key={i.ms} value={i.ms}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => refresh(true)} disabled={loading || !allOn}>
            {loading ? 'Refreshing…' : 'Refresh now'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              setSound(!sound);
              if (!sound) playChime('added'); // preview, and unlocks audio
            }}
            title="Play a sound when a scanner's list changes"
          >
            {sound ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
          {telegram &&
            (telegram.configured ? (
              <button
                className={`ghost toggle ${telegram.on ? 'toggle-on' : 'toggle-off'}`}
                onClick={toggleTelegram}
                title={telegram.on ? 'Click to stop Telegram alerts' : 'Click to start Telegram alerts'}
              >
                ✈️ Telegram {telegram.on ? 'ON' : 'OFF'}
              </button>
            ) : (
              <span className="meta" title="Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to server/.env">
                Telegram off
              </span>
            ))}
          {notifPerm === 'default' && (
            <button className="ghost" onClick={() => setupPush(true).then(setNotifPerm)}>
              Enable desktop alerts
            </button>
          )}
          {notifPerm === 'on' && (
            <button
              className="ghost toggle-on"
              title="Desktop alerts come from the server, so they still arrive when this tab is in the background. Click to send a test alert."
              onClick={() => fetch('/api/push/test', { method: 'POST' })}
            >
              🔔 Desktop alerts on
            </button>
          )}
          {notifPerm === 'denied' && (
            <span className="meta" title="Allow notifications for this site in your browser settings">
              Desktop alerts blocked
            </span>
          )}
          {String(notifPerm).startsWith('error') && (
            <button className="ghost" title={notifPerm} onClick={() => setupPush(true).then(setNotifPerm)}>
              ⚠ Desktop alerts failed – retry
            </button>
          )}
          {allOn && !marketOpen && (
            <span className="market-closed" title="Scanners, sectors and NIFTY 50 auto-refresh only 9:00 AM – 4:00 PM IST, Mon–Fri. 'Refresh now' still works.">
              ⏸ Market closed · auto-refresh paused till 9:00 AM IST
            </span>
          )}
        </div>
      </header>

      {error && <div className="banner error">Could not reach the server: {error}</div>}
      {!allOn && (
        <div className="banner off">
          <strong>⏻ Everything is OFF.</strong> No scanning, no NIFTY / sector refresh, no Telegram or desktop alerts.
          The page shows the last data. Click <strong>All OFF</strong> to turn it back on.
        </div>
      )}

      <div className="top-row">
        <VideoPanel />
        <SectorsPanel />
      </div>

      {common.size > 0 && (
        <div className="banner common">
          <strong>In multiple scanners:</strong> {[...common].join(', ')}
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.added.length ? 'toast-added' : 'toast-removed'}`}
            onClick={() => {
              scrollToCard(t.url);
              setToasts((l) => l.filter((x) => x.id !== t.id));
            }}
          >
            <strong>{t.name}</strong>
            {t.added.length > 0 && <div className="plus">▲ Added: {t.added.join(', ')}</div>}
            {t.removed.length > 0 && <div className="minus">▼ Dropped: {t.removed.join(', ')}</div>}
          </div>
        ))}
      </div>

      <div className="grid">
        {scanners.map((s) => (
          <section
            key={s.url}
            id={`card-${encodeURIComponent(s.url)}`}
            className={`card ${changes[s.url] ? (changes[s.url].added.length ? 'changed-added' : 'changed-removed') : ''}`}
          >
            {changes[s.url] && (
              <div className="change-strip">
                <span>
                  {changes[s.url].added.length > 0 && (
                    <span className="plus">▲ Added: {changes[s.url].added.join(', ')}</span>
                  )}
                  {changes[s.url].removed.length > 0 && (
                    <span className="minus">▼ Dropped: {changes[s.url].removed.join(', ')}</span>
                  )}
                  <span className="meta"> · {fmtTime(changes[s.url].at)}</span>
                </span>
                <button className="small" onClick={() => markSeen(s.url)}>
                  Seen
                </button>
              </div>
            )}
            <div className="card-head">
              <div>
                <h2>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                </h2>
                <span className="meta">
                  {s.stocks.length} stocks · updated {fmtTime(s.updatedAt)}
                </span>
              </div>
              <button className="ghost small" onClick={() => removeScanner(s.url)} title="Remove">
                ✕
              </button>
            </div>
            {s.error && <div className="banner error small">{s.error}</div>}
            {s.stocks.length === 0 ? (
              <p className="empty">No stocks match right now.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th className="num">In for</th>
                    <th className="num">Price</th>
                    <th className="num">% Chg</th>
                    <th className="num">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {s.stocks.map((st) => {
                    const isNew =
                      changes[s.url]?.added.includes(st.symbol) ||
                      (st.firstSeen && !st.initial && s.updatedAt - st.firstSeen < HIGHLIGHT_MS);
                    return (
                    <tr key={st.symbol} className={isNew ? 'new' : ''}>
                      <td>
                        <a
                          href={`https://chartink.com/stocks/${encodeURIComponent(String(st.symbol).toLowerCase())}.html`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {st.symbol}
                        </a>
                        {common.has(st.symbol) && <span className="tag">multi</span>}
                        {isNew && <span className="tag new">new</span>}
                      </td>
                      <td className="name">{st.name}</td>
                      <td className="num name" title={st.firstSeen ? `Since ${fmtStamp(st.firstSeen)}` : ''}>
                        {st.firstSeen ? fmtDuration(s.updatedAt - st.firstSeen) : '–'}
                      </td>
                      <td className="num">{fmtNum(st.close)}</td>
                      <td className={`num ${st.change >= 0 ? 'up' : 'down'}`}>{fmtNum(st.change)}%</td>
                      <td className="num">{fmtNum(st.volume)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <DeactivatedSection deactivated={s.deactivated} justRemoved={changes[s.url]?.removed} />
            <RecentSection scanner={s} />
          </section>
        ))}
      </div>

      <form className="add" onSubmit={addScanner}>
        <input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="https://chartink.com/screener/your-scanner"
        />
        <button type="submit" disabled={!newUrl.trim()}>
          Add scanner
        </button>
      </form>
    </div>
  );
}
