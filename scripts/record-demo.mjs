// Records one full stub run from a running Apprentice server (every streamed update with its timing), for the
// browser-only demo build. Usage: node scripts/record-demo.mjs http://127.0.0.1:8790 > demo/recording.json
const base = process.argv[2] ?? 'http://127.0.0.1:8790';
const get = async (p) => (await fetch(base + p)).json();
const config = await get('/api/config');
const sample = await get('/api/sample');
const started = await (await fetch(base + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const t0 = Date.now();
const frames = [];
const res = await fetch(`${base}/api/runs/${started.id}/stream`);
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let done = false;
while (!done) {
  const { value, done: end } = await reader.read();
  if (end) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, i);
    buf = buf.slice(i + 2);
    if (!chunk.startsWith('data: ')) continue;
    const e = JSON.parse(chunk.slice(6));
    frames.push({ t: Date.now() - t0, e });
    if (e.kind === 'state' && e.run && e.run.status !== 'running') done = true;
  }
}
await reader.cancel();
// Thin the state frames: keep one when a stage changes status or title, or at most every 500 ms while
// progress moves. The demo recomputes the running cost from the calls it has replayed.
const shape = (run) => JSON.stringify(Object.values(run.stages).map((s) => [s.status, s.title]).concat([run.status]));
let lastShape = '';
let lastT = -1e9;
const kept = frames.filter(({ t, e }, i) => {
  if (e.kind !== 'state') return true;
  const sh = shape(e.run);
  const isLast = !frames.slice(i + 1).some((f) => f.e.kind === 'state');
  if (sh !== lastShape || t - lastT >= 500 || isLast) {
    lastShape = sh;
    lastT = t;
    return true;
  }
  return false;
});
frames.length = 0;
frames.push(...kept);
const final = await get(`/api/runs/${started.id}`);
process.stdout.write(JSON.stringify({ config, sample, final, calls: await get(`/api/runs/${started.id}/calls`), events: await get(`/api/runs/${started.id}/events`), frames }));
