// Compares playbook designs on the dev split only (never the test), using a finished run's failure types and
// agreed teacher cases. Live, through the spend guard. Usage: npx tsx scripts/playbook-dev.ts run-001 run-002
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTokenFactory, GuardedTransport } from '@apprentice/nebius-core';
import { evaluate } from '../src/server/evaluate.js';
import { buildPlaybook } from '../src/server/run.js';
import { sampleTask } from '../src/server/task.js';
import type { FailureType } from '../src/server/teach.js';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]!] ??= m[2]!;
}
const tf = createTokenFactory({ respond: () => '' });
if (!tf.live) throw new Error('No key');
const guard = (tf.transport as GuardedTransport).guard;
const task = sampleTask(resolve('data'));
const model = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
console.log(`spent before $${guard.spent().toFixed(4)}`);
const base = await evaluate(tf, { task, examples: task.dev, model, label: 'base', step: 'dev-check', role: 'student' });
console.log(`base on dev: ${String(base.correct)}/${String(base.total)}`);
for (const id of process.argv.slice(2)) {
  const failures = JSON.parse(readFileSync(`runs/${id}/failures.json`, 'utf8')) as FailureType[];
  const kept = readFileSync(`runs/${id}/synthetic.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text: string; label: string });
  for (const [name, pb] of [['v1 rules + failing labels', buildPlaybook(failures, kept)], ['v2 rules + every label', buildPlaybook(failures, kept, { everyLabel: task.labels })]] as const) {
    const r = await evaluate(tf, { task, examples: task.dev, model, label: name, step: 'dev-check', role: 'student', playbook: pb });
    console.log(`${id} ${name}: ${String(r.correct)}/${String(r.total)} on dev, playbook ${String(pb.length)} chars`);
  }
}
console.log(`spent after $${guard.spent().toFixed(4)}`);
