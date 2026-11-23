// Sends scanner alerts to Telegram through a bot.
// Configure in server/.env:
//   TELEGRAM_BOT_TOKEN=123456:ABC...        (from @BotFather)
//   TELEGRAM_CHAT_ID=123456789              (your chat, or a group/channel id; comma-separate for several)
//   TELEGRAM_NOTIFY_DROPPED=0               (1 = also alert when stocks drop out)

import { loadEnv } from './env.js';
import { getSetting } from './settings.js';

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatIds = () =>
  (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const telegramEnabled = () => {
  loadEnv(); // pick up edits to .env
  return Boolean(token() && chatIds().length);
};
/** Turned off from the UI: keep the config, just don't send alerts. */
export const telegramPaused = () => !!getSetting('telegramPaused');
export const notifyDropped = () => process.env.TELEGRAM_NOTIFY_DROPPED === '1';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct = (n) => (n == null ? '' : ` (${n >= 0 ? '+' : ''}${num(n)}%)`);
const stockLink = (sym) =>
  `<a href="https://chartink.com/stocks/${encodeURIComponent(String(sym).toLowerCase())}.html">${esc(sym)}</a>`;
const istTime = () =>
  new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

async function send(text) {
  if (!telegramEnabled()) return { ok: false, error: 'Telegram is not configured' };
  // Telegram caps messages at 4096 chars.
  if (text.length > 4000) text = text.slice(0, 3990) + '\n…';
  const errors = [];
  for (const chat_id of chatIds()) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) errors.push(`${chat_id}: ${body.description || `HTTP ${res.status}`}`);
    } catch (err) {
      errors.push(`${chat_id}: ${err.message}`);
    }
  }
  if (errors.length) console.warn('Telegram send failed:', errors.join('; '));
  return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true };
}

/** Alert for stocks that entered (and optionally dropped out of) a scanner. */
export function alertChanges({ name, url, added, removed }) {
  if (!telegramEnabled() || telegramPaused()) return;
  const showRemoved = notifyDropped() && removed.length > 0;
  if (!added.length && !showRemoved) return;

  const lines = [];
  if (added.length) {
    lines.push(`🟢 <b>New in ${esc(name)}</b>`);
    for (const s of added) lines.push(`• <b>${stockLink(s.symbol)}</b> ₹${num(s.close)}${pct(s.change)} — ${esc(s.name)}`);
  }
  if (showRemoved) {
    if (lines.length) lines.push('');
    lines.push(`🔴 <b>Dropped from ${esc(name)}</b>`);
    for (const s of removed) lines.push(`• ${stockLink(s.symbol)} — last ₹${num(s.close)}`);
  }
  lines.push('', `<a href="${esc(url)}">Open scanner</a> · ${istTime()}`);

  // Fire and forget: a Telegram problem must never break scanning.
  send(lines.join('\n'));
}

export function sendTest() {
  return send(`✅ <b>Chartink Watcher</b> is connected. You'll get alerts here when stocks enter your scanners.\n${istTime()}`);
}
