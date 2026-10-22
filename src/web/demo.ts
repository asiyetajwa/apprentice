// Browser-only demo: stands in for the server by replaying a recorded stub run (demo/recording.json) with its
// original timing. It answers the same /api routes the app calls and streams the same events, so the app code
// is unchanged. Built by scripts/build-demo.mjs; the real app never loads this file.

interface Frame { t: number; e: { kind: string; at?: string; run?: DemoRun; call?: { at: string; costUsd: number } } }
interface DemoRun { id: string; number: number; createdAt: string; finishedAt: string | null; status: string; costUsd: number; [k: string]: unknown }
interface Recording { config: unknown; sample: unknown; final: DemoRun; calls: { at: string; costUsd: number }[]; events: { at: string }[]; frames: Frame[] }
interface Live { run: DemoRun; calls: { at: string; costUsd: number }[]; events: { at: string }[]; listeners: Set<(data: string) => void> }

const realFetch = window.fetch.bind(window);
const recording: Promise<Recording> = realFetch('recording.json').then((r) => r.json() as Promise<Recording>);
const runs = new Map<string, Live>();
let seeded = false;

const shift = (iso: string | null, ms: number) => (iso ? new Date(Date.parse(iso) + ms).toISOString() : iso);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const idOf = (n: number) => `run-${String(n).padStart(3, '0')}`;
/** The recording names its endpoint after its own run id; rename it for the run being shown. */
const renamed = (r: DemoRun, id: string): DemoRun => {
  const dep = r.deployment as { name: string } | null | undefined;
  return dep ? { ...r, deployment: { ...dep, name: `apprentice-${id}` } } : r;
};

function seed(rec: Recording): void {
  if (seeded) return;
  seeded = true;
  // One finished run, as if it ended ten minutes ago, so Results has something to show.
  const off = Date.now() - 10 * 60_000 - Date.parse(rec.final.finishedAt ?? rec.final.createdAt);
  const run = { ...renamed(rec.final, idOf(1)), id: idOf(1), number: 1, createdAt: shift(rec.final.createdAt, off)!, finishedAt: shift(rec.final.finishedAt, off) };
  runs.set(run.id, { run, calls: rec.calls.map((c) => ({ ...c, at: shift(c.at, off)! })), events: rec.events.map((e) => ({ ...e, at: shift(e.at, off)! })), listeners: new Set() });
}

function start(rec: Recording): DemoRun {
  const number = Math.max(...[...runs.values()].map((l) => l.run.number)) + 1;
  const id = idOf(number);
  const off = Date.now() - Date.parse(rec.final.createdAt);
  const adopt = (r: DemoRun, calls: { costUsd: number }[]): DemoRun => ({ ...renamed(r, id), id, number, createdAt: shift(r.createdAt, off)!, finishedAt: shift(r.finishedAt, off), costUsd: calls.reduce((t, c) => t + c.costUsd, 0) });
  const firstState = rec.frames.find((f) => f.e.kind === 'state')!.e.run!;
  const streamedLogs = rec.frames.filter((f) => f.e.kind === 'log').length;
  const live: Live = { run: adopt(firstState, []), calls: [], events: rec.events.slice(0, rec.events.length - streamedLogs).map((e) => ({ ...e, at: shift(e.at, off)! })), listeners: new Set() };
  runs.set(id, live);
  for (const { t, e } of rec.frames) {
    window.setTimeout(() => {
      let out: unknown = e;
      if (e.kind === 'call' && e.call) {
        const call = { ...e.call, at: shift(e.call.at, off)! };
        live.calls.push(call);
        out = { ...e, call };
      } else if (e.kind === 'log') {
        const ev = { ...e, at: shift(e.at ?? null, off)! };
        live.events.push(ev);
        out = ev;
      } else if (e.kind === 'state' && e.run) {
        live.run = adopt(e.run, live.calls);
        out = { ...e, run: live.run };
      }
      const data = JSON.stringify(out);
      live.listeners.forEach((l) => l(data));
    }, t);
  }
  return live.run;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.startsWith('/api/') ? url : null;
  if (!path) return realFetch(input, init);
  const rec = await recording;
  seed(rec);
  const parts = path.split('?')[0]!.split('/').filter(Boolean); // api, runs, id, sub
  if (parts[1] === 'config') return json({ ...(rec.config as object), running: [...runs.values()].filter((l) => l.run.status === 'running').map((l) => l.run.id) });
  if (parts[1] === 'sample') return json(rec.sample);
  if (parts[1] !== 'runs') return json({ error: 'Not found' }, 404);
  if (!parts[2]) {
    if ((init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { data?: string };
      if (body.data) return json({ error: 'This browser demo replays the bundled sample. Run Apprentice locally to use your own data.' }, 400);
      if ([...runs.values()].some((l) => l.run.status === 'running')) return json({ error: 'A run is already going. One at a time.' }, 409);
      return json(start(rec), 201);
    }
    return json([...runs.values()].map((l) => l.run).sort((a, b) => b.number - a.number));
  }
  const live = runs.get(parts[2]);
  if (!live) return json({ error: 'No such run' }, 404);
  if (parts[3] === 'calls') return json(live.calls);
  if (parts[3] === 'events') return json(live.events);
  return json(live.run);
};

class DemoEventSource {
  onmessage: ((m: { data: string }) => void) | null = null;
  private readonly live: Live | undefined;
  private readonly listener = (data: string) => this.onmessage?.({ data });
  constructor(url: string) {
    this.live = runs.get(url.split('/')[3] ?? '');
    this.live?.listeners.add(this.listener);
    window.setTimeout(() => this.live && this.listener(JSON.stringify({ at: new Date().toISOString(), kind: 'state', run: this.live.run })), 0);
  }
  close(): void {
    this.live?.listeners.delete(this.listener);
  }
}
(window as unknown as { EventSource: unknown }).EventSource = DemoEventSource;
