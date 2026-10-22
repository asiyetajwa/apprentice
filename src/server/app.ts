// The Apprentice server: starts runs, streams their progress, and serves the saved results.
// One run at a time; finished runs are read back from runs/<id>/run.json.

import express from 'express';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTokenFactory, modelFor } from '@apprentice/nebius-core';
import { Run, type RunEvent, type RunState } from './run.js';
import { stubRespond } from './stub-brain.js';
import { sampleTask, taskFromUpload, type Task } from './task.js';

export interface AppOptions {
  dataDir: string;
  runsDir: string;
  webDir?: string;
  /** Stub pacing: 1 is a watchable demo, 0 is instant. */
  stubSpeed?: number;
  pollSeconds?: number;
  perType?: number;
}

export function createApp(o: AppOptions) {
  mkdirSync(o.runsDir, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const listeners = new Map<string, Set<(e: RunEvent) => void>>();
  const live = new Map<string, Run>();

  const readRun = (id: string): RunState | null => {
    if (live.has(id)) return live.get(id)!.state;
    const p = join(o.runsDir, id, 'run.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as RunState) : null;
  };
  const allRuns = (): RunState[] =>
    readdirSync(o.runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => readRun(d.name))
      .filter((r): r is RunState => r !== null)
      .sort((a, b) => b.number - a.number);

  app.get('/api/config', (_req, res) => {
    const probe = createTokenFactory({ respond: stubRespond });
    res.json({
      mode: probe.live ? 'live' : 'stub',
      tavily: Boolean(process.env.TAVILY_API_KEY?.trim()),
      models: { student: modelFor('student'), teacher: modelFor('teacher'), grader: modelFor('grader') },
      running: [...live.keys()],
    });
  });

  app.get('/api/sample', (_req, res) => {
    const t = sampleTask(o.dataDir);
    res.json({ name: t.name, description: t.description, labels: t.labels, labelHelp: t.labelHelp, counts: { train: t.train.length, dev: t.dev.length, test: t.test.length }, preview: t.test.slice(0, 5) });
  });

  app.get('/api/runs', (_req, res) => res.json(allRuns()));

  app.get('/api/runs/:id', (req, res) => {
    const r = readRun(req.params.id);
    if (!r) return void res.status(404).json({ error: 'No such run' });
    res.json(r);
  });

  /** Every model call the run made, with tokens, time and cost. */
  app.get('/api/runs/:id/calls', (req, res) => {
    const p = join(o.runsDir, req.params.id, 'calls.jsonl');
    if (!existsSync(p)) return void res.json([]);
    res.json(readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown));
  });

  app.get('/api/runs/:id/events', (req, res) => {
    const p = join(o.runsDir, req.params.id, 'events.jsonl');
    if (!existsSync(p)) return void res.json([]);
    res.json(readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown));
  });

  /** Per-example predictions for one eval: base, tuned or reference. */
  app.get('/api/runs/:id/eval/:which', (req, res) => {
    const file = { base: 'eval-base.json', tuned: 'eval-tuned.json', reference: 'eval-reference.json' }[req.params.which];
    const p = file && join(o.runsDir, req.params.id, file);
    if (!p || !existsSync(p)) return void res.status(404).json({ error: 'Not available yet' });
    res.type('json').send(readFileSync(p, 'utf8'));
  });

  app.get('/api/runs/:id/stream', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (e: RunEvent) => res.write(`data: ${JSON.stringify(e.kind === 'state' ? { ...e, run: readRun(req.params.id) } : e)}\n\n`);
    send({ at: new Date().toISOString(), kind: 'state' });
    const set = listeners.get(req.params.id) ?? new Set();
    set.add(send);
    listeners.set(req.params.id, set);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(send);
    });
  });

  app.post('/api/runs', (req, res) => {
    if (live.size) return void res.status(409).json({ error: 'A run is already going. One at a time.' });
    const body = (req.body ?? {}) as { sample?: boolean; name?: string; description?: string; data?: string; labelHelp?: Record<string, string> };
    let task: Task;
    try {
      task = body.data ? taskFromUpload(body.name || 'My task', body.description || 'Label each example.', body.data, body.labelHelp) : sampleTask(o.dataDir);
    } catch (err) {
      return void res.status(400).json({ error: (err as Error).message });
    }
    const number = allRuns().reduce((n, r) => Math.max(n, r.number), 0) + 1;
    const id = `run-${String(number).padStart(3, '0')}`;
    const tf = createTokenFactory({ respond: stubRespond, speed: o.stubSpeed ?? 1, trainSeconds: 40 });
    const run = new Run({
      tf,
      task,
      runsDir: o.runsDir,
      id,
      number,
      perType: o.perType,
      pollSeconds: o.pollSeconds,
      emit: (e) => listeners.get(id)?.forEach((l) => l(e)),
    });
    live.set(id, run);
    void run.go().finally(() => live.delete(id));
    res.status(201).json(run.state);
  });

  if (o.webDir && existsSync(o.webDir)) {
    app.use(express.static(o.webDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(o.webDir!, 'index.html')));
  }
  return app;
}
