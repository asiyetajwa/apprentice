// The eval harness. Temperature 0, the same prompt, the same held-out examples in the same order, so a
// score is repeatable and base and tuned are compared on equal terms.

import type { TokenFactory } from '@apprentice/nebius-core';
import { parseLabel, studentMessages, type Example, type Task } from './task.js';

export interface Prediction {
  id: string;
  text: string;
  gold: string;
  pred: string;
  ok: boolean;
}

export interface EvalResult {
  model: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number;
  perLabel: Record<string, { correct: number; total: number }>;
  predictions: Prediction[];
  medianLatencyMs: number;
  costUsd: number;
  /** What 1,000 calls like these cost, from the tokens this eval actually used. */
  costPer1k: number;
}

export async function evaluate(
  tf: TokenFactory,
  args: { task: Task; examples: Example[]; model: string; label: string; step: string; role: string; priceAs?: string; extraBody?: Record<string, unknown>; concurrency?: number; onProgress?: (done: number, correct: number) => void },
): Promise<EvalResult> {
  const { task, examples } = args;
  const predictions: Prediction[] = new Array(examples.length);
  const latencies: number[] = [];
  let cost = 0;
  let done = 0;
  let correct = 0;
  let next = 0;
  const before = tf.telemetry.calls.length;

  const worker = async () => {
    while (next < examples.length) {
      const i = next++;
      const ex = examples[i]!;
      const out = await tf.chat({ step: args.step, role: args.role, model: args.model, messages: studentMessages(task, ex.text), temperature: 0, maxTokens: 12, priceAs: args.priceAs, extraBody: args.extraBody });
      const pred = parseLabel(task, out.text);
      const ok = pred === ex.label;
      predictions[i] = { id: ex.id, text: ex.text, gold: ex.label, pred, ok };
      latencies.push(out.latencyMs);
      done++;
      if (ok) correct++;
      args.onProgress?.(done, correct);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency ?? 6, examples.length) }, worker));

  for (const c of tf.telemetry.calls.slice(before)) if (c.model === args.model) cost += c.costUsd;
  const perLabel: EvalResult['perLabel'] = {};
  for (const l of task.labels) perLabel[l] = { correct: 0, total: 0 };
  for (const p of predictions) {
    const slot = (perLabel[p.gold] ??= { correct: 0, total: 0 });
    slot.total++;
    if (p.ok) slot.correct++;
  }
  latencies.sort((a, b) => a - b);
  return {
    model: args.model,
    label: args.label,
    correct,
    total: examples.length,
    accuracy: examples.length ? correct / examples.length : 0,
    perLabel,
    predictions,
    medianLatencyMs: latencies[Math.floor(latencies.length / 2)] ?? 0,
    costUsd: cost,
    costPer1k: examples.length ? (cost / examples.length) * 1000 : 0,
  };
}
