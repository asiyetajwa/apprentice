// Weights mode, step 1: the training and validation files for the LoRA fine-tune, from the sample's training
// split plus the agreed teacher cases of a playbook run. Same instructions as the eval (no playbook), so the
// tuned model is scored on exactly the prompt it was trained on. Usage: npx tsx scripts/weights-data.ts run-001
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stableShuffle } from '../src/server/teach.js';
import { sampleTask, studentMessages } from '../src/server/task.js';

const runId = process.argv[2] ?? 'run-001';
const task = sampleTask(resolve('data'));
const kept = readFileSync(`runs/${runId}/synthetic.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text: string; label: string });
const testTexts = new Set(task.test.map((e) => e.text));
if (kept.some((k) => testTexts.has(k.text))) throw new Error('A held-out ticket is in the teacher cases');
const rows = (xs: Array<{ text: string; label: string }>) => xs.map((e) => JSON.stringify({ messages: [...studentMessages(task, e.text), { role: 'assistant', content: e.label }] })).join('\n') + '\n';
const train = stableShuffle([...task.train.map((e) => ({ text: e.text, label: e.label })), ...kept]);
writeFileSync('runs/weights/train.jsonl', rows(train));
writeFileSync('runs/weights/valid.jsonl', rows(task.dev));
console.log(`train ${String(train.length)} rows (${String(task.train.length)} sample + ${String(kept.length)} teacher cases), valid ${String(task.dev.length)} rows`);
