// Weights mode, step 2: LoRA fine-tune on Token Factory, then download the adapter files.
// Runs only through the spend guard, with the approved quote in APPRENTICE_FINETUNE_QUOTE_USD.
// Usage: APPRENTICE_FINETUNE_QUOTE_USD=0.12 npx tsx scripts/weights-train.ts Qwen/Qwen3-4B
//        npx tsx scripts/weights-train.ts --resume <job id>   (watch a submitted job and download its adapter; free)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTokenFactory, GuardedTransport } from '@apprentice/nebius-core';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]!] ??= m[2]!;
}
const model = process.argv[2] ?? 'Qwen/Qwen3-4B';
const key = process.env.NEBIUS_API_KEY!;
const base = 'https://api.tokenfactory.nebius.com/v1';
const tf = createTokenFactory({ respond: () => '' });
if (!tf.live) throw new Error('No key');
const guard = (tf.transport as GuardedTransport).guard;
const out = 'runs/weights';
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const get = async <T>(path: string): Promise<T> => {
  const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${String(r.status)} on ${path}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T;
};

const resume = process.argv[2] === '--resume' ? process.argv[3] : undefined;
let job: { id: string; status: 'validating_files' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' };
if (resume) {
  job = await get<typeof job>(`/fine_tuning/jobs/${resume}`);
  log(`resuming job ${job.id}: ${job.status}`);
} else {
  log(`spent before: $${guard.spent().toFixed(4)} of $${guard.capUsd.toFixed(2)}; quote $${String(guard.fineTuneQuoteUsd)}`);
  const trainFile = await tf.transport.uploadFile('apprentice-weights-train.jsonl', readFileSync(join(out, 'train.jsonl'), 'utf8'));
  const validFile = await tf.transport.uploadFile('apprentice-weights-valid.jsonl', readFileSync(join(out, 'valid.jsonl'), 'utf8'));
  log(`uploaded ${trainFile.id} (${String(trainFile.bytes)} bytes) and ${validFile.id}`);
  const hyperparameters = { n_epochs: 3, learning_rate: 0.0001, batch_size: 8, lora: true as const, lora_r: 16, lora_alpha: 32, lora_dropout: 0.05, warmup_ratio: 0.05, weight_decay: 0, max_grad_norm: 1, packing: true, context_length: 8192 };
  job = await tf.transport.createFineTune({ model, trainingFile: trainFile.id, validationFile: validFile.id, suffix: 'apprentice-lumen-tickets', hyperparameters, seed: 42 });
  writeFileSync(join(out, 'job.json'), JSON.stringify({ job, hyperparameters, model }, null, 2));
  log(`job ${job.id} created: ${job.status}`);
}

const started = Date.now();
let status = job.status;
log(`watching ${job.id}`);
let raw: Record<string, unknown> = {};
while (!['succeeded', 'failed', 'cancelled'].includes(status)) {
  await new Promise((r) => setTimeout(r, 60_000));
  raw = await get<Record<string, unknown>>(`/fine_tuning/jobs/${job.id}`).catch((e: Error) => ({ status, note: e.message }));
  const next = raw.status as typeof status;
  if (next !== status || Number(raw.trained_tokens ?? 0) > 0) log(`${next}, trained tokens ${String(raw.trained_tokens ?? '?')}, ${String(Math.round((Date.now() - started) / 60000))} min`);
  status = next;
}
writeFileSync(join(out, 'job-final.json'), JSON.stringify(raw, null, 2));
if (status !== 'succeeded') throw new Error(`Fine-tune ${status}: ${JSON.stringify(raw.error ?? raw)}`);

const ckpts = await get<{ data: Array<{ id: string; step_number?: number; result_files?: string[]; metrics?: Record<string, unknown> }> }>(`/fine_tuning/jobs/${job.id}/checkpoints`);
writeFileSync(join(out, 'checkpoints.json'), JSON.stringify(ckpts, null, 2));
const last = ckpts.data.sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0)).at(-1);
if (!last?.result_files?.length) throw new Error('No checkpoint files to download');
for (const fid of last.result_files) {
  const meta = await get<{ filename: string; bytes?: number }>(`/files/${fid}`);
  const r = await fetch(`${base}/files/${fid}/content`, { headers: { authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${String(r.status)} downloading ${meta.filename}`);
  const dest = join(out, 'adapter', meta.filename.split('/').slice(1).join('/') || meta.filename);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  log(`downloaded ${dest}`);
}
log(`done in ${String(Math.round((Date.now() - started) / 60000))} min; checkpoint ${last.id}; spent after: $${guard.spent().toFixed(4)}`);
