// Runs the whole loop in stub mode (no key, no network) and checks the shape and the guarantees:
// the eval is deterministic, test tickets never leak into training, and shipping needs a real win.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StubTransport, TokenFactory } from '@apprentice/nebius-core';
import { Run, type RunEvent } from '../src/server/run.js';
import { evaluate } from '../src/server/evaluate.js';
import { stubRespond } from '../src/server/stub-brain.js';
import { parseLabel, sampleTask, taskFromUpload } from '../src/server/task.js';

const dataDir = resolve(import.meta.dirname, '..', 'data');
delete process.env.NEBIUS_API_KEY;
delete process.env.TAVILY_API_KEY;

const stubTf = () => new TokenFactory(new StubTransport({ respond: stubRespond, speed: 0 }));

test('the eval harness is deterministic on the bundled dataset', async () => {
  const task = sampleTask(dataDir);
  const a = await evaluate(stubTf(), { task, examples: task.test, model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', label: 'a', step: 'baseline', role: 'student' });
  const b = await evaluate(stubTf(), { task, examples: task.test, model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', label: 'b', step: 'baseline', role: 'student' });
  assert.equal(a.total, 120);
  assert.equal(a.correct, b.correct);
  assert.deepEqual(a.predictions.map((p) => p.pred), b.predictions.map((p) => p.pred));
});

test('labels are read strictly: unknown answers count as wrong', () => {
  const task = sampleTask(dataDir);
  assert.equal(parseLabel(task, ' Refund.'), 'refund');
  assert.equal(parseLabel(task, 'The label is: billing'), 'billing');
  assert.match(parseLabel(task, 'no idea'), /^\(unclear/);
});

test('the full loop runs in stub mode and only ships a real win', async () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'apprentice-'));
  const task = sampleTask(dataDir);
  const events: RunEvent[] = [];
  const run = new Run({ tf: stubTf(), task, runsDir, id: 'run-test', number: 1, pollSeconds: 0, perType: 10, emit: (e) => events.push(e) });
  const s = await run.go();
  assert.equal(s.error, null, s.error ?? '');
  assert.equal(s.mode, 'stub');
  for (const st of ['intake', 'baseline', 'teach', 'train', 'prove'] as const) assert.equal(s.stages[st].status, 'done', st);
  assert.ok(s.baseline && s.tuned && s.reference);
  assert.ok(s.failures.length > 0, 'failure types found');
  assert.ok(s.teach && s.teach.kept > 0 && s.teach.kept <= s.teach.written);
  // Ship follows the numbers, never the other way round.
  assert.equal(s.decision?.ship, s.tuned.correct > s.baseline.correct);
  assert.equal(s.status, s.decision?.ship ? 'shipped' : 'not_shipped');
  // Every call was recorded with a cost, and the run's cost is their sum.
  const calls = readFileSync(join(runsDir, 'run-test', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { costUsd: number; stub: boolean });
  assert.ok(calls.length > 300);
  assert.ok(calls.every((c) => c.stub));
  assert.ok(Math.abs(calls.reduce((t, c) => t + c.costUsd, 0) - s.costUsd) < 1e-9);
  // No held-out ticket ever reaches the training file.
  const train = readFileSync(join(runsDir, 'run-test', 'train.jsonl'), 'utf8');
  for (const t of task.test) assert.ok(!train.includes(JSON.stringify(t.text).slice(1, -1)), `test ticket leaked: ${t.id}`);
  assert.ok(events.some((e) => e.kind === 'log' && /Shipped|Not shipped/.test(e.text ?? '')));
});

test('the playbook method teaches through instructions and only ships a real win', async () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'apprentice-'));
  const task = sampleTask(dataDir);
  const run = new Run({ tf: stubTf(), task, runsDir, id: 'run-pb', number: 1, pollSeconds: 0, perType: 10, method: 'playbook', emit: () => undefined });
  const s = await run.go();
  assert.equal(s.error, null, s.error ?? '');
  assert.equal(s.method, 'playbook');
  assert.equal(s.training, null);
  assert.ok(s.playbook && s.playbook.rules > 0);
  const playbook = readFileSync(join(runsDir, 'run-pb', 'playbook.txt'), 'utf8');
  for (const t of task.test) assert.ok(!playbook.includes(t.text), `test ticket leaked into the playbook: ${t.id}`);
  assert.ok(s.baseline && s.tuned);
  assert.equal(s.decision?.ship, s.tuned.correct > s.baseline.correct);
});

test('uploads are split by label, deterministically', () => {
  const rows = Array.from({ length: 80 }, (_, i) => JSON.stringify({ text: `ticket number ${String(i)} about ${i % 2 ? 'cats' : 'dogs'}`, label: i % 2 ? 'cats' : 'dogs' })).join('\n');
  const a = taskFromUpload('Pets', 'Label the pet.', rows);
  const b = taskFromUpload('Pets', 'Label the pet.', rows);
  assert.deepEqual(a.labels, ['cats', 'dogs']);
  assert.equal(a.train.length + a.dev.length + a.test.length, 80);
  assert.deepEqual(a.test.map((e) => e.text), b.test.map((e) => e.text));
  assert.throws(() => taskFromUpload('x', 'y', rows.split('\n').slice(0, 10).join('\n')), /at least 40/);
});
