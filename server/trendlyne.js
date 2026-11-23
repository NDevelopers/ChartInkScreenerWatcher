// Sector day-change data from Trendlyne's sector analysis page.
// The page is server-rendered (Next.js), so the data sits in the
// <script id="__NEXT_DATA__"> JSON; no API key needed.

import { fetchAllowed } from './market-hours.js';

const URL = 'https://trendlyne.com/equity/sector-industry-analysis/sector/day/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const SECTORS_REFRESH_MS = 15 * 60 * 1000; // fixed: refresh every 15 min

const num = (v) => (typeof v === 'number' ? v : v?.value ?? null);

async function fetchSectors() {
  const res = await fetch(URL, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`Trendlyne returned HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not find sector data on the Trendlyne page');
  const rows = JSON.parse(m[1])?.props?.pageProps?.initialBody?.sector?.tableData;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Trendlyne sector table is empty');

  return rows
    .map((r) => ({
      name: r.stock_column?.stockName,
      url: r.stock_column?.url,
      change: r.day_changeP_mcapw_sec,
      weekChange: r.week_changeP_mcapw_sec ?? null,
      companies: r.companies_count ?? null,
      advances: num(r.advance),
      declines: num(r.decline),
    }))
    .filter((s) => s.name && typeof s.change === 'number');
}

// ---- Index quotes (NIFTY 50 etc.) from the Markets Today page ----

const MARKETS_URL = 'https://trendlyne.com/markets-today/';
export const INDEX_REFRESH_MS = 60 * 1000; // fixed: refresh every 1 min

const text = (s) => s?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const toNum = (s) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function parseIndices(html) {
  const cards = html.split('class="index_details_wrapper_link"').slice(1);
  return cards
    .map((c) => {
      const name = text(c.match(/class="index-name">([\s\S]*?)<\/h3>/)?.[1]);
      const price = toNum(c.match(/class="curent-price[^"]*">([^<]*)</)?.[1]);
      let change = toNum(c.match(/class="LpriceCh[^"]*">([^<]*)</)?.[1]);
      let changePct = toNum(c.match(/class="\s*LpriceChP[^"]*">([^<]*)</)?.[1]);
      // Values are shown unsigned; the direction is in the wrapper class.
      if (/<div class="negative/.test(c)) {
        change = change == null ? null : -Math.abs(change);
        changePct = changePct == null ? null : -Math.abs(changePct);
      }
      const asOf = text(c.match(/class="LpriceTimezone[^"]*">([\s\S]*?)<\/span>/)?.[1]);
      const adv = toNum(c.match(/bar-val pos'>(\d+)</)?.[1]);
      const dec = toNum(c.match(/bar-val neg'>(\d+)</)?.[1]);
      const url = c.match(/href="([^"]+)"/)?.[1];
      return { name, price, change, changePct, asOf, advances: adv, declines: dec, url };
    })
    .filter((x) => x.name && x.price != null);
}

let idxCache = null;
let idxInFlight = null;

/** Index quotes, refreshed at most once a minute. Keeps the last good values on failure. */
export async function getIndices() {
  if (idxCache && Date.now() - idxCache.at < INDEX_REFRESH_MS) return idxCache;
  // Outside 9:00–16:00 IST: no new fetches once we have a value.
  if (idxCache?.lastGoodAt && !fetchAllowed()) return idxCache;
  if (idxInFlight) return idxInFlight;
  idxInFlight = fetch(MARKETS_URL, { headers: { 'user-agent': UA, accept: 'text/html' } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Trendlyne returned HTTP ${res.status}`);
      const indices = parseIndices(await res.text());
      if (!indices.length) throw new Error('Could not find index prices on Trendlyne');
      return { at: Date.now(), lastGoodAt: Date.now(), indices, error: null };
    })
    .catch((err) => ({ at: Date.now(), lastGoodAt: idxCache?.lastGoodAt ?? null, indices: idxCache?.indices || [], error: err.message }))
    .then((r) => {
      idxCache = r;
      idxInFlight = null;
      return r;
    });
  return idxInFlight;
}

let cache = null; // { at, sectors } | { at, error, sectors }
let inFlight = null;

/** All sectors, refreshed at most once every 15 minutes. */
export async function getSectors() {
  if (cache && Date.now() - cache.at < SECTORS_REFRESH_MS) return cache;
  if (cache?.lastGoodAt && !fetchAllowed()) return cache;
  if (inFlight) return inFlight;
  inFlight = fetchSectors()
    .then((sectors) => ({ at: Date.now(), sectors, error: null }))
    // Keep showing the last good list if a refresh fails; retry in 1 min.
    .catch((err) => ({
      at: Date.now() - SECTORS_REFRESH_MS + 60 * 1000,
      sectors: cache?.sectors || [],
      error: err.message,
      lastGoodAt: cache?.lastGoodAt ?? cache?.at ?? null,
    }))
    .then((r) => {
      if (!r.error) r.lastGoodAt = r.at;
      cache = r;
      inFlight = null;
      return r;
    });
  return inFlight;
}
