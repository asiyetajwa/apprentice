// A task is one narrow job (route a ticket, extract a field) with labelled examples in three splits:
// train (to learn from), dev (checks while tuning) and test (held out, only ever used to score).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from '@apprentice/nebius-core';

export interface Example {
  id: string;
  text: string;
  label: string;
  hard?: boolean;
  /** Where a training example came from: the user's data, the teacher, or the web via Tavily. */
  source?: 'data' | 'teacher' | 'web';
}

export interface Task {
  name: string;
  description: string;
  labels: string[];
  labelHelp: Record<string, string>;
  train: Example[];
  dev: Example[];
  test: Example[];
}

const readJsonl = (path: string): Example[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => ({ ...(JSON.parse(l) as Example), source: 'data' as const }));

/** The bundled demo: 424 support tickets for the fictional Lumen app, eight queues. */
export function sampleTask(dataDir: string): Task {
  const dir = join(dataDir, 'support-tickets');
  const meta = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { name: string; description: string; labels: string[]; labelHelp: Record<string, string> };
  return { ...meta, train: readJsonl(join(dir, 'train.jsonl')), dev: readJsonl(join(dir, 'dev.jsonl')), test: readJsonl(join(dir, 'test.jsonl')) };
}

/**
 * Parses an uploaded CSV (text,label) or JSONL ({"text","label"}) and splits it 60/15/25, deterministically,
 * stratified by label so every queue appears in every split.
 */
export function taskFromUpload(name: string, description: string, raw: string, labelHelp: Record<string, string> = {}): Task {
  const rows = raw.trim().startsWith('{') ? raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { text: string; label: string }) : parseCsv(raw);
  const clean = rows.map((r) => ({ text: String(r.text ?? '').trim(), label: String(r.label ?? '').trim() })).filter((r) => r.text && r.label);
  if (clean.length < 40) throw new Error(`Need at least 40 labelled examples, got ${String(clean.length)}.`);
  const byLabel = new Map<string, typeof clean>();
  for (const r of clean) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]);
  const train: Example[] = [];
  const dev: Example[] = [];
  const test: Example[] = [];
  for (const [, xs] of byLabel) {
    const sorted = [...xs].sort((a, b) => hash(a.text) - hash(b.text));
    const nTest = Math.max(1, Math.round(sorted.length * 0.25));
    const nDev = Math.max(1, Math.round(sorted.length * 0.15));
    sorted.forEach((r, i) => (i < nTest ? test : i < nTest + nDev ? dev : train).push({ id: '', ...r, source: 'data' }));
  }
  const number = (xs: Example[], p: string) => xs.forEach((x, i) => (x.id = `${p}-${String(i + 1).padStart(3, '0')}`));
  number(train, 'train');
  number(dev, 'dev');
  number(test, 'test');
  return { name, description, labels: [...byLabel.keys()].sort(), labelHelp, train, dev, test };
}

function parseCsv(raw: string): Array<{ text: string; label: string }> {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = cells(lines[0]!).map((h) => h.trim().toLowerCase());
  const ti = head.indexOf('text');
  const li = head.indexOf('label');
  if (ti < 0 || li < 0) throw new Error('The CSV needs a header row with "text" and "label" columns.');
  return lines.slice(1).map((l) => {
    const c = cells(l);
    return { text: c[ti] ?? '', label: c[li] ?? '' };
  });
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The one prompt the student sees, before and after training. Training data uses it too, word for word. */
export function studentMessages(task: Task, text: string): ChatMessage[] {
  const labels = task.labels.map((l) => (task.labelHelp[l] ? `- ${l}: ${task.labelHelp[l]}` : `- ${l}`)).join('\n');
  return [
    { role: 'system', content: `${task.description}\nAnswer with exactly one label from this list and nothing else:\n${labels}` },
    { role: 'user', content: text },
  ];
}

/** Reads a label out of a reply: exact first, then the first label named in it. Unknown answers count as wrong. */
export function parseLabel(task: Task, reply: string): string {
  const r = reply.trim().toLowerCase().replace(/^["'`\s]+|["'`.\s]+$/g, '');
  if (task.labels.includes(r)) return r;
  const found = task.labels.map((l) => ({ l, i: r.indexOf(l.toLowerCase()) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
  return found[0]?.l ?? `(unclear: ${reply.trim().slice(0, 40)})`;
}
