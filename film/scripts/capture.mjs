// Captures every state the Apprentice film shows, from the running app, at 1600 css px wide @2x, and records the
// on-screen box of each element the camera reads or the cursor clicks (public/app/boxes.json), the way the Pawzoo
// film does. Each capture is the whole page: the viewport is resized to the page's height first, so the sticky
// rail and every panel sit where they would on a tall screen.
//
// Start a fresh Apprentice in stub mode first (an empty runs folder, so this is Run 01), then: npm run capture
//   APPRENTICE_RUNS_DIR=/tmp/film-runs PORT=8794 npm start      (in the repo root)
//   APPRENTICE_URL=http://127.0.0.1:8794 npm run capture        (in film/)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.APPRENTICE_URL ?? 'http://127.0.0.1:8790';
const OUT = new URL('../public/app/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const W = 1600;
const VIEW_H = 1000;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: W, height: VIEW_H }, deviceScaleFactor: 2, colorScheme: 'light' });
const boxes = { width: W };
const sizes = {};

async function boxOf(key, selector) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`No box for ${key} (${selector})`);
  boxes[key] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

async function shot(name, keys = {}) {
  await page.setViewportSize({ width: W, height: VIEW_H });
  await page.evaluate(() => window.scrollTo(0, 0));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: W, height });
  await page.waitForTimeout(150);
  for (const [key, sel] of Object.entries(keys)) await boxOf(`${name}:${key}`, sel);
  await page.screenshot({ path: `${OUT}${name}.png` });
  sizes[name] = { w: W, h: height };
  console.log('captured', name, height);
}

const run = async () => (await (await fetch(`${BASE}/api/runs/run-001`)).json());
async function waitFor(test, label) {
  for (let i = 0; i < 1200; i++) {
    const r = await run().catch(() => null);
    if (r && test(r)) return r;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const loopKeys = { stages: '#stages', feed: '#feed', loss: '#loss', calls: '#calls', top: '.top' };

await page.goto(`${BASE}/#/new`);
await page.waitForSelector('#start');
await page.waitForTimeout(1200);
await shot('new', { start: '#start', job: '.form', models: '.models', go: '.go' });

await page.setViewportSize({ width: W, height: VIEW_H });
await page.click('#start');
await page.waitForSelector('#stages');
await waitFor((r) => r.stage === 'baseline' && (r.stages.baseline.progress ?? 0) >= 0.5, 'baseline');
await page.waitForTimeout(300);
await shot('loop-baseline', loopKeys);
await waitFor((r) => r.stage === 'teach' && (r.stages.teach.progress ?? 0) >= 0.6, 'teach');
await page.waitForTimeout(300);
await shot('loop-teach', loopKeys);
await waitFor((r) => r.stage === 'train' && (r.training?.checkpoints?.length ?? 0) >= 2, 'train');
await page.waitForTimeout(400);
await shot('loop-train', loopKeys);
await waitFor((r) => r.stage === 'prove' && r.stages.prove.status === 'live', 'prove');
await page.waitForTimeout(400);
await shot('loop-prove', loopKeys);
await waitFor((r) => r.status !== 'running', 'finish');
await page.waitForTimeout(800);
await shot('loop-done', { ...loopKeys, done: '.done-row', results: '.done-row .btn' });

await page.goto(`${BASE}/#/`);
await page.waitForSelector('.hero');
await page.waitForTimeout(1200);
await shot('results', {
  dials: '.dials',
  headline: '.headline',
  nums: '.nums',
  verdict: '.verdict',
  stages: '.stages',
  grid: '.grid',
  bars: '.grid > .panel:nth-child(1)',
  loss: '.grid > .panel:nth-child(2)',
  fails: '.grid > .panel:nth-child(3)',
  receipt: '.grid > .panel:nth-child(4)',
  runs: '#history',
});

await page.goto(`${BASE}/#/calls`);
await page.waitForSelector('table.calls');
await page.waitForTimeout(1000);
await shot('calls', { costs: '.cost-row', table: 'table.calls' });

writeFileSync(`${OUT}boxes.json`, JSON.stringify({ ...boxes, sizes, run: await run() }, null, 2));
console.log('wrote public/app/boxes.json');
await browser.close();
