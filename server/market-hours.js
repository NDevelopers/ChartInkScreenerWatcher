import { getSetting } from './settings.js';

// Window in which the app is allowed to fetch fresh data from Chartink / Trendlyne.
// Outside it, the last fetched data is served from memory.
export const WINDOW = { startMin: 9 * 60, endMin: 16 * 60 }; // 9:00 AM – 4:00 PM IST, Mon–Fri

export function isMarketWindow(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= WINDOW.startMin && mins < WINDOW.endMin;
}

/** Master switch from the UI ("All OFF"): stops all fetching and alerts. */
export const allOff = () => !!getSetting('allOff');

/** True when the app may fetch fresh data: market hours and not switched off. */
export const fetchAllowed = (now) => !allOff() && isMarketWindow(now);
