// Day-one spike: base evals on the 120 held-out sample tickets, live, through the spend guard.
// Writes runs/spike/<model>.json and prints accuracy, median latency and cost per model.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTokenFactory, GuardedTransport } from '@apprentice/nebius-core';
import { evaluate } from '../src/server/evaluate.js';
import { sampleTask } from '../src/server/task.js';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]!] ??= m[2]!;
}
const tf = createTokenFactory({ respond: () => '' });
if (!tf.live) throw new Error('No key: refusing to run the spike in stub mode');
const guard = (tf.transport as GuardedTransport).guard;
const task = sampleTask(resolve('data'));
const noThink = { chat_template_kwargs: { enable_thinking: false } };
const models: Array<[string, Record<string, unknown> | undefined]> = (process.argv[2] ?? 'Qwen/Qwen3-30B-A3B-Instruct-2507,nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B,nvidia/Nemotron-3-Ultra-550b-a55b')
  .split(',')
  .map((m) => [m, m.startsWith('nvidia/') ? noThink : undefined]);
mkdirSync('runs/spike', { recursive: true });
console.log(`spent before: $${guard.spent().toFixed(4)} of $${guard.capUsd.toFixed(2)}`);
for (const [model, extraBody] of models) {
  const started = Date.now();
  const r = await evaluate(tf, { task, examples: task.test, model, label: model, step: 'spike', role: 'student', extraBody, concurrency: 4 });
  writeFileSync(`runs/spike/${model.replace('/', '__')}.json`, JSON.stringify(r, null, 2));
  const unclear = r.predictions.filter((p) => p.pred.startsWith('(unclear')).length;
  console.log(JSON.stringify({ model, correct: `${String(r.correct)}/${String(r.total)}`, accuracy: Number(r.accuracy.toFixed(3)), unclear, medianMs: r.medianLatencyMs, wallS: Math.round((Date.now() - started) / 1000), usd: Number(r.costUsd.toFixed(5)), per1k: Number(r.costPer1k.toFixed(4)) }));
  console.log('  per label:', Object.entries(r.perLabel).map(([l, s]) => `${l} ${String(s.correct)}/${String(s.total)}`).join(', '));
}
console.log(`spent after: $${guard.spent().toFixed(4)} of $${guard.capUsd.toFixed(2)}`);
