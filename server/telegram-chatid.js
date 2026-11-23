// Helper: prints the chat ids that have recently messaged your bot.
// 1. Put TELEGRAM_BOT_TOKEN in server/.env
// 2. Send any message to your bot in Telegram (or add it to a group and post there)
// 3. Run: npm run telegram:chatid

import './env.js';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in server/.env first.');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const body = await res.json();
if (!body.ok) {
  console.error('Telegram said:', body.description);
  process.exit(1);
}

const chats = new Map();
for (const u of body.result) {
  const chat = (u.message || u.channel_post || u.my_chat_member || u.edited_message)?.chat;
  if (chat) chats.set(chat.id, chat);
}

if (!chats.size) {
  console.log('No chats found. Send a message to your bot in Telegram, then run this again.');
} else {
  console.log('Chats that messaged your bot:\n');
  for (const c of chats.values()) {
    const label = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username;
    console.log(`  TELEGRAM_CHAT_ID=${c.id}    (${c.type}: ${label})`);
  }
  console.log('\nCopy the line you want into server/.env');
}
