// Minimal .env loader: reads server/.env (KEY=value lines) into process.env.
// Variables set in the real environment win. loadEnv() is cheap and re-reads
// the file, so edits to .env apply without restarting the server.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
const realEnv = new Set(Object.keys(process.env));

export function loadEnv() {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || realEnv.has(m[1])) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnv();
