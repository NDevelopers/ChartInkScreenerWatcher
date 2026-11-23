// Fetches results for a Chartink screener URL.
//
// Chartink has no public API. The screener page embeds the scan query
// ("atlas_query") and a CSRF token; the browser then POSTs that query to
// /screener/process. We do the same from Node (the browser can't, due to CORS).

const BASE = 'https://chartink.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const QUERY_TTL_MS = 10 * 60 * 1000; // re-read the scan definition every 10 min
const SESSION_TTL_MS = 30 * 60 * 1000;

let session = null; // { csrf, cookies, at }
const queryCache = new Map(); // url -> { query, title, at }

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function loadPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Chartink page returned HTTP ${res.status}`);
  const html = await res.text();

  const csrf = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (csrf) session = { csrf, cookies, at: Date.now() };

  const decoded = decodeEntities(html);
  const m = decoded.match(/"atlas_query":"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error('Could not find the scan query on the screener page');
  const query = JSON.parse(`"${m[1]}"`);

  let title = decoded.match(/<title>([^<]*)<\/title>/)?.[1] || url;
  title = title
    .replace(/,\s*Technical Analysis Scanner\s*$/i, '')
    .replace(/^(\s*copy\s*-\s*)+/i, '') // drop any number of leading "Copy - " prefixes
    .trim();

  const entry = { query, title, at: Date.now() };
  queryCache.set(url, entry);
  return entry;
}

async function getScanDefinition(url) {
  const cached = queryCache.get(url);
  if (cached && Date.now() - cached.at < QUERY_TTL_MS && session) return cached;
  return loadPage(url);
}

async function postProcess(url, query) {
  return fetch(`${BASE}/screener/process`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'x-csrf-token': session.csrf,
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie: session.cookies,
      referer: url,
      origin: BASE,
    },
    body: new URLSearchParams({ scan_clause: query }).toString(),
  });
}

// Stocks that matched on recent bars (what Chartink shows in the backtest
// section under the results). Returns [{ time, stocks: [{symbol, cap, sector}] }]
// for the last `days` distinct trading days, newest bar first.
async function fetchRecent(url, query, days) {
  const res = await fetch(`${BASE}/backtest/process`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'x-csrf-token': session.csrf,
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie: session.cookies,
      referer: url,
      origin: BASE,
    },
    body: new URLSearchParams({ max_rows: '160', scan_clause: query }).toString(),
  });
  if (!res.ok) throw new Error(`Chartink backtest returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.scan_error) throw new Error(body.scan_error);

  const meta = body.metaData?.[0] || {};
  const times = meta.tradeTimes || [];
  const lists = body.aggregatedStockList || [];
  // Each bar's list is flat: symbol, cap, then one value per group (e.g. sector).
  const stride = 2 + (meta.groups?.length || 0);

  const dayKey = (t) => new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST date
  const keepDays = [...new Set(times.map(dayKey))].slice(-days);

  const all = [];
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    if (!list?.length) continue;
    const stocks = [];
    for (let k = 0; k + 1 < list.length; k += stride) {
      stocks.push({ symbol: list[k], cap: list[k + 1], sector: list[k + 2] ?? null });
    }
    all.push({ time: times[i], stocks });
  }
  all.reverse(); // newest first

  const inWindow = all.filter((b) => keepDays.includes(dayKey(b.time)));
  if (inWindow.length) return { bars: inWindow, mode: 'window' };
  // Nothing in the window (e.g. a holiday/short session ate a day): show the latest matches instead.
  return { bars: all.slice(0, 3), mode: 'latest' };
}

export async function runScanner(url, { recentDays = 3 } = {}) {
  let def = await getScanDefinition(url);
  if (!session || Date.now() - session.at > SESSION_TTL_MS) def = await loadPage(url);

  let res = await postProcess(url, def.query);
  if (res.status === 419 || res.status === 401 || res.status === 403) {
    // CSRF/session expired: refresh and retry once.
    def = await loadPage(url);
    res = await postProcess(url, def.query);
  }
  if (!res.ok) throw new Error(`Chartink returned HTTP ${res.status}`);

  const body = await res.json();
  if (body.scan_error) throw new Error(body.scan_error);
  if (body.under_maintenance) throw new Error(body.under_maintenance);

  // Recent matches are a nice-to-have: don't fail the whole scanner if they error.
  let recent = [];
  let recentMode = 'window';
  let recentError = null;
  try {
    ({ bars: recent, mode: recentMode } = await fetchRecent(url, def.query, recentDays));
  } catch (err) {
    recentError = err.message;
  }

  return {
    title: def.title,
    recent,
    recentMode,
    recentError,
    stocks: (body.data || []).map((s) => ({
      symbol: s.nsecode || s.bsecode,
      name: s.name,
      bsecode: s.bsecode,
      close: s.close,
      change: s.per_chg,
      volume: s.volume,
    })),
  };
}
