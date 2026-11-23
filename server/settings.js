// Small persisted settings (data/settings.json), changed from the UI.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = path.join(DIR, 'settings.json');

let settings = { telegramPaused: false };
try {
  if (existsSync(FILE)) settings = { ...settings, ...JSON.parse(readFileSync(FILE, 'utf8')) };
} catch (err) {
  console.warn('Could not read settings.json:', err.message);
}

export const getSetting = (key) => settings[key];

export function setSetting(key, value) {
  settings[key] = value;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(settings, null, 2));
}
