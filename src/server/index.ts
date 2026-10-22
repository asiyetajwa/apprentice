// Starts Apprentice on http://127.0.0.1:8790. Reads .env from the repo root if present.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

const port = Number(process.env.PORT ?? 8790);
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp({
  dataDir: join(root, 'data'),
  runsDir: process.env.APPRENTICE_RUNS_DIR ?? join(root, 'runs'),
  webDir: join(root, 'dist'),
  stubSpeed: Number(process.env.APPRENTICE_STUB_SPEED ?? 1),
});
app.listen(port, host, () => {
  const live = Boolean(process.env.NEBIUS_API_KEY?.trim());
  console.log(`Apprentice on http://${host}:${String(port)}`);
  console.log(`Token Factory: ${live ? 'live' : 'stub mode (set NEBIUS_API_KEY in .env to go live)'}`);
  console.log(`Tavily: ${process.env.TAVILY_API_KEY?.trim() ? 'on' : 'off (set TAVILY_API_KEY to use real web examples)'}`);
});
