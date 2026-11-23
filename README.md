# Chartink Watcher

Watches several Chartink screeners and shows the matching stocks on one React page,
refreshing automatically.

- **server/** – Node + Express. Loads each screener page, reads its scan query and
  CSRF token, and posts the query to Chartink's `/screener/process` (the same call the
  Chartink site makes). Results are cached for 20 s per scanner.
- **client/** – React (Vite). One card per scanner, auto-refresh, "new" highlight for
  stocks that just entered a scan, a "multi" tag for stocks in more than one scanner,
  and optional desktop alerts.

## Run

```bash
npm run setup   # first time only
npm run dev     # API on :4000, UI on http://localhost:5173
```

Production: `npm run build` then `npm start` and open http://localhost:4000.

## Scanners

Edit `server/scanners.json`, or add/remove scanners from the page. Optional `name`
overrides the title read from Chartink:

```json
[{ "url": "https://chartink.com/screener/copy-above-green-zone-1-hr-ema", "name": "Green zone" }]
```

## Telegram alerts

The server sends a Telegram message when a stock enters any scanner (and, optionally,
when one drops out). It checks every minute during market hours (Mon–Fri 09:10–15:40 IST)
even when no browser is open, as long as the server is running.

1. In Telegram, open **@BotFather**, send `/newbot`, and follow the prompts. Copy the token.
2. Open `server/.env` and set `TELEGRAM_BOT_TOKEN=<your token>`.
3. Send any message to your new bot (or add the bot to a group and post there).
4. Run `npm run telegram:chatid` and copy the `TELEGRAM_CHAT_ID=...` line into `server/.env`.
5. Click **✈️ Telegram on · Test** in the page header (reload the page first). You should get a
   test message.

Set `TELEGRAM_NOTIFY_DROPPED=1` to also get alerts when stocks drop out. Several chats can be
comma-separated in `TELEGRAM_CHAT_ID`. Changes to `.env` apply without a restart.

The screener must be public. Chartink has no official API, so this may break if they
change their site.
