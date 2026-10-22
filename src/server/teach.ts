// Teach: the grader (Nemotron Super) names the base model's failure types; the teacher (Nemotron Ultra)
// writes new training cases aimed at each one; the grader then labels every case blind, and only cases
// where both agree are kept. No case may copy a held-out test example.

import type { TokenFactory } from '@apprentice/nebius-core';
import type { Prediction } from './evaluate.js';
import { hash, type Example, type Task } from './task.js';
import type { WebSnippet } from './tavily.js';

export interface FailureType {
  id: string;
  name: string;
  description: string;
  /** Gold label and the label the base model wrongly chose. */
  gold: string;
  confusedWith: string;
  exampleIds: string[];
  count: number;
}

const FAILURE_SCHEMA = {
  name: 'failure_types',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['types'],
    properties: {
      types: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'gold', 'confused_with', 'example_ids'],
          properties: {
            name: { type: 'string', description: 'Short plain name, at most 6 words' },
            description: { type: 'string', description: 'One sentence: what the model gets wrong and why' },
            gold: { type: 'string' },
            confused_with: { type: 'string' },
            example_ids: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

export async function findFailureTypes(tf: TokenFactory, task: Task, model: string, mistakes: Prediction[]): Promise<FailureType[]> {
  if (!mistakes.length) return [];
  const list = mistakes.map((m) => ({ id: m.id, text: m.text, correct: m.gold, model_said: m.pred }));
  const out = await tf.json<{ types: Array<{ name: string; description: string; gold: string; confused_with: string; example_ids: string[] }> }>({
    step: 'teach',
    role: 'grader',
    model,
    temperature: 0,
    maxTokens: 2500,
    schema: FAILURE_SCHEMA,
    messages: [
      {
        role: 'system',
        content: `You analyse the mistakes of a small model doing this job: ${task.description}\nLabels: ${task.labels.join(', ')}.\nGroup the mistakes into at most 6 failure types. Each type is one recurring confusion with a clear cause. Use plain, short names a product manager would understand.`,
      },
      { role: 'user', content: JSON.stringify({ mistakes: list }) },
    ],
  });
  const ids = new Set(mistakes.map((m) => m.id));
  return out.types
    .map((t, i) => {
      const exampleIds = t.example_ids.filter((id) => ids.has(id));
      return { id: `ft-${String(i + 1)}`, name: t.name, description: t.description, gold: t.gold, confusedWith: t.confused_with, exampleIds, count: exampleIds.length };
    })
    .filter((t) => task.labels.includes(t.gold) && t.count > 0)
    .sort((a, b) => b.count - a.count);
}

const CASES_SCHEMA = {
  name: 'training_cases',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['cases'],
    properties: { cases: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'label'], properties: { text: { type: 'string' }, label: { type: 'string' } } } } },
  },
};

export interface TeachResult {
  written: Example[];
  kept: Example[];
  rejected: Array<Example & { reason: string }>;
}

export async function writeCases(
  tf: TokenFactory,
  args: { task: Task; teacher: string; grader: string; failures: FailureType[]; perType: number; examplesById: Map<string, string>; web: WebSnippet[]; onProgress?: (written: number) => void },
): Promise<TeachResult> {
  const { task } = args;
  const written: Example[] = [];
  const style = args.web.length ? `\nReal messages people post about this kind of thing, for tone and wording only (do not copy):\n${args.web.map((w) => `- ${w.content.replace(/\s+/g, ' ').slice(0, 280)}`).join('\n')}` : '';
  // Cases for every failure type, plus a small balanced set so no queue is forgotten.
  const targets: Array<{ key: string; brief: string; n: number }> = args.failures.map((f) => ({
    key: f.id,
    brief: `Failure type "${f.name}": ${f.description}\nThe correct label is "${f.gold}"; the small model wrongly says "${f.confusedWith}".\nReal mistakes:\n${f.exampleIds.slice(0, 4).map((id) => `- ${args.examplesById.get(id) ?? ''}`).join('\n')}\nWrite tickets that are truly "${f.gold}" but easy to mistake for "${f.confusedWith}", and some that truly are "${f.confusedWith}", so the boundary is clear.`,
    n: args.perType,
  }));
  targets.push({ key: 'balance', brief: `Write a balanced set across all labels, varied in length, tone and typos.`, n: Math.max(8, task.labels.length * 2) });

  for (const t of targets) {
    const out = await tf.json<{ cases: Array<{ text: string; label: string }> }>({
      step: 'teach',
      role: 'teacher',
      model: args.teacher,
      temperature: 0.8,
      maxTokens: 4000,
      schema: CASES_SCHEMA,
      messages: [
        {
          role: 'system',
          content: `You write training data for a small model doing this job: ${task.description}\nLabels and their meaning:\n${task.labels.map((l) => `- ${l}: ${task.labelHelp[l] ?? l}`).join('\n')}\nWrite realistic, varied customer messages, each with its one correct label. No names, emails or account numbers.${style}`,
        },
        { role: 'user', content: `${t.brief}\nWrite ${String(t.n)} cases.` },
      ],
    });
    for (const c of out.cases) written.push({ id: `syn-${String(written.length + 1).padStart(3, '0')}`, text: c.text.trim(), label: c.label.trim(), source: args.web.length ? 'web' : 'teacher' });
    args.onProgress?.(written.length);
  }

  // Quality gate: the grader labels every case without seeing the teacher's answer.
  const rejected: TeachResult['rejected'] = [];
  const kept: Example[] = [];
  const testTexts = new Set(task.test.map((e) => norm(e.text)));
  const seen = new Set<string>();
  const verdicts = await gradeBlind(tf, task, args.grader, written);
  written.forEach((ex, i) => {
    const n = norm(ex.text);
    if (!task.labels.includes(ex.label)) rejected.push({ ...ex, reason: `unknown label "${ex.label}"` });
    else if (testTexts.has(n)) rejected.push({ ...ex, reason: 'copies a held-out test ticket' });
    else if (seen.has(n)) rejected.push({ ...ex, reason: 'duplicate' });
    else if (verdicts[i] !== ex.label) rejected.push({ ...ex, reason: `grader said "${verdicts[i] ?? '?'}"` });
    else kept.push(ex);
    seen.add(n);
  });
  return { written, kept, rejected };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function gradeBlind(tf: TokenFactory, task: Task, grader: string, cases: Example[]): Promise<string[]> {
  const verdicts: string[] = [];
  const batch = 25;
  for (let i = 0; i < cases.length; i += batch) {
    const slice = cases.slice(i, i + batch);
    const out = await tf.json<{ labels: string[] }>({
      step: 'teach',
      role: 'grader',
      model: grader,
      temperature: 0,
      maxTokens: 800,
      schema: { name: 'labels', schema: { type: 'object', additionalProperties: false, required: ['labels'], properties: { labels: { type: 'array', items: { type: 'string', enum: task.labels } } } } },
      messages: [
        { role: 'system', content: `${task.description}\nLabels:\n${task.labels.map((l) => `- ${l}: ${task.labelHelp[l] ?? l}`).join('\n')}\nLabel each message. Reply with the labels in the same order.` },
        { role: 'user', content: JSON.stringify({ messages: slice.map((c) => c.text) }) },
      ],
    });
    slice.forEach((_, j) => verdicts.push(out.labels[j] ?? ''));
  }
  return verdicts;
}

/** Stable order so the same inputs always build the same training file. */
export function stableShuffle<T extends { text: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => hash(a.text) - hash(b.text));
}
