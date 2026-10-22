// Day-one smoke test: one tiny call to each model through the spend guard; prints answer, tokens, time, cost.
import { readFileSync } from 'node:fs';
import { createTokenFactory } from '@apprentice/nebius-core';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]!] ??= m[2]!;
}
const tf = createTokenFactory({ respond: () => '' });
if (!tf.live) throw new Error('No key: refusing to run the smoke test in stub mode');
const models = (process.argv[2] ?? 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B,Qwen/Qwen3-30B-A3B-Instruct-2507,nvidia/nemotron-3-super-120b-a12b,nvidia/Nemotron-3-Ultra-550b-a55b').split(',');
const extra = process.argv[3] ? (JSON.parse(process.argv[3]) as Record<string, unknown>) : undefined;
for (const model of models) {
  try {
    const out = await tf.chat({ step: 'smoke', role: 'student', model, maxTokens: 300, extraBody: extra, messages: [{ role: 'system', content: 'Answer with one word: the queue for this ticket. Queues: billing, refund, shipping, technical.' }, { role: 'user', content: 'My parcel never arrived.' }] });
    const c = tf.telemetry.calls.at(-1)!;
    console.log(JSON.stringify({ model, text: out.text.slice(0, 120), in: out.tokensIn, out: out.tokensOut, ms: out.latencyMs, usd: Number(c.costUsd.toFixed(6)) }));
  } catch (err) {
    console.log(JSON.stringify({ model, error: (err as Error).message.slice(0, 300) }));
  }
}
