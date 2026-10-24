// One run of the loop: Intake, Baseline, Teach, Train, Prove, Ship. Each stage reports progress as events
// and saves what it made (prompts, synthetic data, evals, job ids) under runs/<id>/, so a run can be
// audited and reproduced. Ship only happens when the tuned model beats the base model on held-out data.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelFor, type CallRecord, type Checkpoint, type TokenFactory } from '@apprentice/nebius-core';
import { evaluate, type EvalResult } from './evaluate.js';
import { findFailureTypes, stableShuffle, writeCases, type FailureType } from './teach.js';
import { searchWeb, type TavilyResult } from './tavily.js';
import { PLAYBOOK_HEADING, studentMessages, type Task } from './task.js';

export const STAGES = ['intake', 'baseline', 'teach', 'train', 'prove', 'ship'] as const;
export type StageId = (typeof STAGES)[number];
export type StageStatus = 'waiting' | 'live' | 'done' | 'failed' | 'skipped';

export interface StageState {
  status: StageStatus;
  title: string;
  detail: string;
  progress: number | null;
}

export type EvalSummary = Omit<EvalResult, 'predictions'> & { mistakes: number };

/** How the student is taught: a playbook in its instructions (served per token), or LoRA weights. */
export type Method = 'playbook' | 'weights';

export interface RunState {
  id: string;
  method: Method;
  number: number;
  createdAt: string;
  finishedAt: string | null;
  mode: 'live' | 'stub';
  status: 'running' | 'shipped' | 'not_shipped' | 'failed';
  stage: StageId;
  stages: Record<StageId, StageState>;
  task: { name: string; description: string; labels: string[]; counts: { train: number; dev: number; test: number } };
  models: { student: string; studentLabel: string; teacher: string; teacherLabel: string; grader: string; graderLabel: string };
  baseline: EvalSummary | null;
  reference: EvalSummary | null;
  tuned: EvalSummary | null;
  failures: FailureType[];
  fixed: string[];
  teach: { written: number; kept: number; rejected: number; web: { query: string; results: number; live: boolean } | null } | null;
  playbook: { rules: number; examples: number; chars: number; text: string } | null;
  training: { jobId: string; trainingFile: string; validationFile: string; examples: number; status: string; checkpoints: Checkpoint[]; fineTunedModel: string | null; minutes: number | null } | null;
  deployment: { name: string; status: string; baseUrl: string } | null;
  decision: { ship: boolean; reason: string } | null;
  costUsd: number;
  error: string | null;
}

export interface RunEvent {
  at: string;
  kind: 'stage' | 'log' | 'progress' | 'call' | 'state';
  stage?: StageId;
  text?: string;
  call?: CallRecord;
}

export interface RunOptions {
  tf: TokenFactory;
  task: Task;
  runsDir: string;
  id: string;
  number: number;
  /** Teacher cases per failure type. */
  perType?: number;
  /** Seconds between fine-tune status polls (Token Factory asks for no more than one every 15 s). */
  pollSeconds?: number;
  /** Defaults to APPRENTICE_METHOD, else playbook when live (Token Factory serves tuned weights only on dedicated endpoints) and weights in stub mode. */
  method?: Method;
  emit: (e: RunEvent) => void;
}

const TITLES: Record<StageId, string> = { intake: 'Intake', baseline: 'Baseline', teach: 'Teach', train: 'Train', prove: 'Prove', ship: 'Ship' };
const pct = (x: number) => `${String(Math.round(x * 100))}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function summary(r: EvalResult): EvalSummary {
  const { predictions, ...rest } = r;
  return { ...rest, mistakes: predictions.filter((p) => !p.ok).length };
}

export class Run {
  readonly state: RunState;
  private dir: string;

  constructor(private o: RunOptions) {
    const method: Method = o.method ?? ((process.env.APPRENTICE_METHOD as Method | undefined) || (o.tf.live ? 'playbook' : 'weights'));
    // The playbook specialist is NVIDIA Nemotron 3 Nano, served per token; weights mode trains a Qwen3 student.
    const student = method === 'playbook' && !process.env.APPRENTICE_STUDENT?.trim() ? modelFor('student', { APPRENTICE_STUDENT: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B' }) : modelFor('student');
    const teacher = modelFor('teacher');
    const grader = modelFor('grader');
    this.dir = join(o.runsDir, o.id);
    mkdirSync(this.dir, { recursive: true });
    this.state = {
      id: o.id,
      method,
      number: o.number,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      mode: o.tf.live ? 'live' : 'stub',
      status: 'running',
      stage: 'intake',
      stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'waiting', title: TITLES[s], detail: '', progress: null }])) as Record<StageId, StageState>,
      task: { name: o.task.name, description: o.task.description, labels: o.task.labels, counts: { train: o.task.train.length, dev: o.task.dev.length, test: o.task.test.length } },
      models: { student: student.id, studentLabel: student.label, teacher: teacher.id, teacherLabel: teacher.label, grader: grader.id, graderLabel: grader.label },
      baseline: null,
      reference: null,
      tuned: null,
      failures: [],
      fixed: [],
      teach: null,
      playbook: null,
      training: null,
      deployment: null,
      decision: null,
      costUsd: 0,
      error: null,
    };
    o.tf.telemetry.onCall((call) => {
      this.state.costUsd += call.costUsd;
      appendFileSync(join(this.dir, 'calls.jsonl'), `${JSON.stringify(call)}\n`);
      o.emit({ at: call.at, kind: 'call', call });
    });
    this.save('task.json', { ...o.task });
    this.persist();
  }

  private save(name: string, data: unknown, jsonl = false): void {
    writeFileSync(join(this.dir, name), jsonl ? (data as unknown[]).map((d) => JSON.stringify(d)).join('\n') + '\n' : JSON.stringify(data, null, 2));
  }

  private persist(): void {
    this.save('run.json', this.state);
    this.o.emit({ at: new Date().toISOString(), kind: 'state' });
  }

  private log(stage: StageId, text: string): void {
    const e: RunEvent = { at: new Date().toISOString(), kind: 'log', stage, text };
    appendFileSync(join(this.dir, 'events.jsonl'), `${JSON.stringify(e)}\n`);
    this.o.emit(e);
  }

  private set(stage: StageId, patch: Partial<StageState>): void {
    Object.assign(this.state.stages[stage], patch);
    if (patch.status === 'live') this.state.stage = stage;
    this.persist();
  }

  async go(): Promise<RunState> {
    try {
      await this.intake();
      await this.baseline();
      await this.teachStage();
      if (this.state.method === 'playbook') {
        const playbook = await this.writePlaybook();
        await this.proveWith(playbook);
      } else {
        await this.train();
        await this.prove();
      }
      await this.ship();
    } catch (err) {
      const msg = (err as Error).message;
      this.state.error = msg;
      this.state.status = 'failed';
      this.set(this.state.stage, { status: 'failed', detail: msg.slice(0, 160) });
      this.log(this.state.stage, `Stopped: ${msg}`);
    }
    this.state.finishedAt = new Date().toISOString();
    this.persist();
    return this.state;
  }

  private async intake(): Promise<void> {
    const { task } = this.o;
    this.set('intake', { status: 'live', detail: 'Checking the examples' });
    const counts = new Map<string, number>();
    for (const e of task.train) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    const missing = task.labels.filter((l) => !counts.get(l));
    if (missing.length) throw new Error(`No training examples for: ${missing.join(', ')}`);
    this.log('intake', `${String(task.train.length)} examples to learn from, ${String(task.dev.length)} checks for tuning, ${String(task.test.length)} held out for the test. ${String(task.labels.length)} labels.`);
    this.log('intake', `Running ${this.state.mode === 'live' ? 'live on Nebius Token Factory' : 'in stub mode: no Token Factory key, answers are simulated'}.`);
    this.set('intake', { status: 'done', title: `${String(task.train.length)} examples`, detail: `${String(task.labels.length)} labels, ${String(task.test.length)} held out` });
  }

  private async baseline(): Promise<void> {
    const { tf, task } = this.o;
    const m = this.state.models;
    this.set('baseline', { status: 'live', detail: `Testing the base ${m.studentLabel}`, progress: 0 });
    const base = await evaluate(tf, {
      task,
      examples: task.test,
      model: m.student,
      label: `Base ${m.studentLabel}`,
      step: 'baseline',
      role: 'student',
      onProgress: (d, c) => this.set('baseline', { progress: d / task.test.length, detail: `${String(c)} of ${String(d)} right so far` }),
    });
    this.save('eval-base.json', base);
    this.state.baseline = summary(base);
    this.log('baseline', `Base ${m.studentLabel} got ${String(base.correct)} of ${String(base.total)} held-out tickets right (${pct(base.accuracy)}).`);

    // The teacher on the same test: the accuracy and cost the small model is chasing.
    this.set('baseline', { detail: `Testing ${m.teacherLabel} for reference`, progress: 0 });
    const ref = await evaluate(tf, {
      task,
      examples: task.test,
      model: m.teacher,
      label: m.teacherLabel,
      step: 'baseline',
      role: 'teacher',
      concurrency: 4,
      onProgress: (d) => this.set('baseline', { progress: d / task.test.length }),
    });
    this.save('eval-reference.json', ref);
    this.state.reference = summary(ref);
    this.log('baseline', `${m.teacherLabel} scored ${pct(ref.accuracy)} at $${ref.costPer1k.toFixed(3)} per 1,000 calls: the bar to chase.`);
    this.set('baseline', { status: 'done', title: `Base: ${pct(base.accuracy)}`, detail: `${String(base.total - base.correct)} mistakes to learn from`, progress: null });
  }

  private async teachStage(): Promise<void> {
    const { tf, task } = this.o;
    const m = this.state.models;
    this.set('teach', { status: 'live', detail: `${m.graderLabel} is reading the mistakes` });
    // Failure types come from the base model's mistakes on the dev split, never from the test.
    const devEval = await evaluate(tf, { task, examples: task.dev, model: m.student, label: 'Base on dev', step: 'teach', role: 'student' });
    const mistakes = devEval.predictions.filter((p) => !p.ok);
    const failures = await findFailureTypes(tf, task, m.grader, mistakes);
    this.state.failures = failures;
    this.save('failures.json', failures);
    this.log('teach', `${m.graderLabel} found ${String(failures.length)} failure types in ${String(mistakes.length)} mistakes on the tuning checks.`);
    for (const f of failures.slice(0, 4)) this.log('teach', `${f.name}: ${f.description}`);

    let web: TavilyResult | null = null;
    try {
      web = await searchWeb(`real customer support messages ${task.name.toLowerCase()} ${failures[0]?.gold ?? ''} examples`);
      if (web) this.log('teach', `Tavily found ${String(web.snippets.length)} real-world examples on the web for the teacher's tone.`);
      else this.log('teach', 'Tavily skipped: no TAVILY_API_KEY.');
    } catch (err) {
      this.log('teach', `Tavily search failed (${(err as Error).message}); teaching without web examples.`);
    }

    this.set('teach', { detail: `${m.teacherLabel} is writing cases`, progress: 0 });
    const examplesById = new Map(task.dev.map((e) => [e.id, e.text]));
    const perType = this.o.perType ?? 24;
    const target = failures.length * perType + Math.max(8, task.labels.length * 2);
    const res = await writeCases(tf, {
      task,
      teacher: m.teacher,
      grader: m.grader,
      failures,
      perType,
      examplesById,
      web: web?.snippets ?? [],
      onProgress: (n) => this.set('teach', { progress: Math.min(1, n / target), detail: `${String(n)} cases written` }),
    });
    this.save('synthetic.jsonl', res.kept, true);
    this.save('synthetic-rejected.jsonl', res.rejected, true);
    this.state.teach = { written: res.written.length, kept: res.kept.length, rejected: res.rejected.length, web: web ? { query: web.query, results: web.snippets.length, live: web.live } : null };
    this.log('teach', `${m.teacherLabel} wrote ${String(res.written.length)} cases; ${m.graderLabel} agreed with ${String(res.kept.length)}. ${String(res.rejected.length)} dropped.`);
    this.set('teach', { status: 'done', title: `${String(res.kept.length)} new cases`, detail: `${String(failures.length)} failure types`, progress: null });
  }

  /** Playbook method: the taught rules and a few agreed cases go into the student's instructions. */
  private async writePlaybook(): Promise<string> {
    this.set('train', { status: 'live', detail: 'Writing the playbook', progress: 0 });
    const kept = (this.state.teach?.kept ?? 0) > 0 ? readJsonl(join(this.dir, 'synthetic.jsonl')) : [];
    const playbook = buildPlaybook(this.state.failures, kept);
    writeFileSync(join(this.dir, 'playbook.txt'), playbook);
    const rules = this.state.failures.length;
    const examples = (playbook.match(/^Ticket: /gm) ?? []).length;
    this.state.playbook = { rules, examples, chars: playbook.length, text: playbook };
    this.log('train', `Wrote a playbook for ${this.state.models.studentLabel}: ${String(rules)} house rules and ${String(examples)} worked examples from the agreed cases.`);
    this.set('train', { status: 'done', title: 'Playbook', detail: `${String(rules)} rules, ${String(examples)} examples`, progress: null });
    return playbook;
  }

  private async proveWith(playbook: string): Promise<void> {
    const { tf, task } = this.o;
    const m = this.state.models;
    this.set('prove', { status: 'live', detail: 'Testing the taught model on the held-out tickets', progress: 0 });
    const tuned = await evaluate(tf, {
      task,
      examples: task.test,
      model: m.student,
      label: `Taught ${m.studentLabel}`,
      step: 'prove',
      role: 'student',
      playbook,
      onProgress: (d, c) => this.set('prove', { progress: d / task.test.length, detail: `${String(c)} of ${String(d)} right so far` }),
    });
    this.save('eval-tuned.json', tuned);
    this.state.tuned = summary(tuned);
    this.state.fixed = fixedTypes(this.state.failures, tuned);
    // The specialist is the same served model with the playbook as its instructions: nothing to deploy.
    this.state.deployment = { name: `${m.student} + playbook`, status: 'active', baseUrl: tf.live ? 'https://api.tokenfactory.nebius.com/v1' : 'stub' };
    this.save('specialist.json', { model: m.student, system: studentMessages(task, '', playbook)[0]!.content });
    this.log('prove', `Taught ${m.studentLabel} got ${String(tuned.correct)} of ${String(tuned.total)} right (${pct(tuned.accuracy)}), up from ${pct(this.state.baseline!.accuracy)}.`);
    this.set('prove', { status: 'done', title: `Taught: ${pct(tuned.accuracy)}`, detail: 'The same held-out tickets', progress: null });
  }

  private async train(): Promise<void> {
    const { tf, task } = this.o;
    const m = this.state.models;
    this.set('train', { status: 'live', detail: 'Building the training file', progress: 0 });
    const synthetic = (this.state.teach?.kept ?? 0) > 0 ? readJsonl(join(this.dir, 'synthetic.jsonl')) : [];
    const rows = (exs: Array<{ text: string; label: string }>) => exs.map((e) => ({ messages: [...studentMessages(task, e.text), { role: 'assistant', content: e.label }] }));
    const trainRows = rows(stableShuffle([...task.train, ...synthetic]));
    const validRows = rows(task.dev);
    const trainJsonl = trainRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const validJsonl = validRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(this.dir, 'train.jsonl'), trainJsonl);
    writeFileSync(join(this.dir, 'valid.jsonl'), validJsonl);
    const trainFile = await tf.transport.uploadFile(`apprentice-${this.state.id}-train.jsonl`, trainJsonl);
    const validFile = await tf.transport.uploadFile(`apprentice-${this.state.id}-valid.jsonl`, validJsonl);
    this.log('train', `Uploaded ${String(trainRows.length)} training and ${String(validRows.length)} validation examples to Token Factory.`);
    const hyperparameters = { n_epochs: 3, learning_rate: 0.0001, batch_size: 8, lora: true as const, lora_r: 16, lora_alpha: 32, lora_dropout: 0.05, warmup_ratio: 0.05, context_length: 8192 };
    const job = await tf.transport.createFineTune({ model: m.student, trainingFile: trainFile.id, validationFile: validFile.id, suffix: `apprentice-${this.state.id}`, hyperparameters, seed: 42 });
    const started = Date.now();
    this.state.training = { jobId: job.id, trainingFile: trainFile.id, validationFile: validFile.id, examples: trainRows.length, status: job.status, checkpoints: [], fineTunedModel: null, minutes: null };
    this.save('job.json', { job, hyperparameters });
    this.log('train', `Fine-tuning ${m.studentLabel} with LoRA (rank 16, 3 epochs) on Token Factory. Job ${job.id}.`);
    this.set('train', { detail: 'Queued on Token Factory' });

    const poll = (this.o.pollSeconds ?? (tf.live ? 15 : 1)) * 1000;
    let current = job;
    let lastCkpt = 0;
    for (;;) {
      await sleep(poll);
      current = await tf.transport.getFineTune(job.id);
      const ckpts = await tf.transport.checkpoints(job.id).catch(() => [] as Checkpoint[]);
      this.state.training.status = current.status;
      this.state.training.checkpoints = ckpts;
      if (ckpts.length > lastCkpt) {
        const c = ckpts[ckpts.length - 1]!;
        this.log('train', `Epoch ${String(ckpts.length)} done: training loss ${c.trainLoss?.toFixed(2) ?? '?'}, validation loss ${c.validLoss?.toFixed(2) ?? '?'}.`);
        lastCkpt = ckpts.length;
      }
      const label = { validating_files: 'Checking the files', queued: 'Queued on Token Factory', running: `Training, epoch ${String(Math.min(3, ckpts.length + 1))} of 3`, succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled' }[current.status];
      this.set('train', { detail: label, progress: current.status === 'running' ? Math.min(0.95, ckpts.length / 3 + 0.1) : current.status === 'succeeded' ? 1 : 0.05 });
      if (current.status === 'succeeded') break;
      if (current.status === 'failed' || current.status === 'cancelled') throw new Error(`Fine-tuning ${current.status}: ${current.error ?? 'no reason given'}`);
    }
    const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
    this.state.training.fineTunedModel = current.fineTunedModel;
    this.state.training.minutes = minutes;
    const last = this.state.training.checkpoints.at(-1);
    this.log('train', `Training finished in ${String(minutes)} min${last?.validLoss != null ? `. Validation loss ${last.validLoss.toFixed(2)}` : ''}.`);
    this.set('train', { status: 'done', title: 'LoRA, 3 epochs', detail: `${String(minutes)} min on Token Factory`, progress: null });
  }

  private async prove(): Promise<void> {
    const { tf, task } = this.o;
    const m = this.state.models;
    const t = this.state.training!;
    this.set('prove', { status: 'live', detail: 'Deploying the tuned model to test it', progress: 0 });
    // A LoRA adapter is served under its own name once deployed; that name is what we test and ship.
    const lastCkpt = t.checkpoints.at(-1);
    const name = `apprentice-${this.state.id}`.toLowerCase();
    const deployed = await tf.transport.deployLora({ name, baseModel: m.student, source: lastCkpt ? `${t.jobId}:${lastCkpt.id}` : t.jobId });
    this.state.deployment = { name: deployed.name, status: deployed.status, baseUrl: tf.live ? 'https://api.tokenfactory.nebius.com/v1' : 'stub' };
    this.log('prove', `Deploying the adapter as "${deployed.name}".`);
    for (let i = 0; this.state.deployment.status !== 'active'; i++) {
      await sleep(tf.live ? 10_000 : 500);
      const d = await tf.transport.getDeployed(deployed.name);
      this.state.deployment.status = d.status;
      if (d.status === 'failed') throw new Error(`Deploying the tuned model failed on Token Factory.`);
      if (i > 90) throw new Error('The tuned model was not ready after 15 minutes.');
    }
    this.set('prove', { detail: 'Testing the tuned model on the held-out tickets' });
    const tuned = await evaluate(tf, {
      task,
      examples: task.test,
      model: deployed.name,
      label: `Tuned ${m.studentLabel}`,
      step: 'prove',
      role: 'student',
      priceAs: m.student,
      onProgress: (d, c) => this.set('prove', { progress: d / task.test.length, detail: `${String(c)} of ${String(d)} right so far` }),
    });
    this.save('eval-tuned.json', tuned);
    this.state.tuned = summary(tuned);
    this.state.fixed = fixedTypes(this.state.failures, tuned);
    this.log('prove', `Tuned ${m.studentLabel} got ${String(tuned.correct)} of ${String(tuned.total)} right (${pct(tuned.accuracy)}), up from ${pct(this.state.baseline!.accuracy)}.`);
    this.set('prove', { status: 'done', title: `Tuned: ${pct(tuned.accuracy)}`, detail: 'The same held-out tickets', progress: null });
  }

  private async ship(): Promise<void> {
    const base = this.state.baseline!;
    const tuned = this.state.tuned!;
    this.set('ship', { status: 'live', detail: 'Comparing tuned with base' });
    const gain = tuned.correct - base.correct;
    const ship = gain > 0;
    const word = this.state.method === 'playbook' ? 'Taught' : 'Tuned';
    const reason = ship
      ? `${word} beats base by ${String(gain)} of ${String(tuned.total)} held-out tickets (${pct(base.accuracy)} to ${pct(tuned.accuracy)}).`
      : `${word} did not beat base (${pct(base.accuracy)} to ${pct(tuned.accuracy)}), so nothing ships.`;
    this.state.decision = { ship, reason };
    this.state.status = ship ? 'shipped' : 'not_shipped';
    this.log('ship', ship ? `Shipped. ${reason} Endpoint: ${this.state.deployment!.name}.` : `Not shipped. ${reason}`);
    this.set('ship', ship ? { status: 'done', title: 'Shipped', detail: this.state.deployment!.name } : { status: 'skipped', title: 'Not shipped', detail: 'It did not win' });
  }
}

/** A failure type is fixed when the taught model now gets most of the test tickets of its true label right. */
function fixedTypes(failures: FailureType[], tuned: EvalResult): string[] {
  return failures
    .filter((f) => {
      const related = tuned.predictions.filter((p) => p.gold === f.gold);
      return related.length > 0 && related.filter((p) => p.ok).length / related.length >= 0.85;
    })
    .map((f) => f.id);
}

/**
 * House rules from the failure types, then worked examples from the agreed teacher cases: up to two per rule, and
 * with `everyLabel`, topped up to two for every label, so a run that finds few failure types still shows the
 * student each queue.
 */
export function buildPlaybook(failures: FailureType[], kept: Array<{ text: string; label: string }>, opts: { everyLabel?: string[] } = {}): string {
  const rules = failures.map((f) => `- ${f.description.replace(/\.?$/, '.')} These go to ${f.gold}, not ${f.confusedWith}.`);
  const used = new Set<string>();
  const examples: Array<{ text: string; label: string }> = [];
  const take = (label: string, n: number) => {
    for (const c of kept.filter((k) => k.label === label && !used.has(k.text)).slice(0, n)) {
      used.add(c.text);
      examples.push(c);
    }
  };
  for (const f of failures) take(f.gold, 2);
  for (const label of opts.everyLabel ?? []) take(label, Math.max(0, 2 - examples.filter((e) => e.label === label).length));
  const shown = examples.slice(0, opts.everyLabel ? 24 : 16);
  return [PLAYBOOK_HEADING, ...rules, ...(shown.length ? ['', 'Worked examples:', ...shown.map((e) => `Ticket: ${e.text}\nLabel: ${e.label}`)] : [])].join('\n');
}

function readJsonl(path: string): Array<{ text: string; label: string }> {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { text: string; label: string });
}
