// Apprentice web app: Results, New Run, the live Loop, Every Call, and About. Plain TypeScript, no framework:
// each view renders from the server's run state; the Loop listens to server-sent events while a run is going.

type Status = 'running' | 'shipped' | 'not_shipped' | 'failed';
type StageId = 'intake' | 'baseline' | 'teach' | 'train' | 'prove' | 'ship';
interface Stage { status: 'waiting' | 'live' | 'done' | 'failed' | 'skipped'; title: string; detail: string; progress: number | null }
interface Evals { model: string; label: string; correct: number; total: number; accuracy: number; perLabel: Record<string, { correct: number; total: number }>; medianLatencyMs: number; costUsd: number; costPer1k: number; mistakes: number }
interface Failure { id: string; name: string; description: string; gold: string; confusedWith: string; count: number }
interface Ckpt { step: number; trainLoss: number | null; validLoss: number | null }
interface Run {
  id: string; number: number; createdAt: string; finishedAt: string | null; mode: 'live' | 'stub'; status: Status; stage: StageId; stages: Record<StageId, Stage>;
  task: { name: string; description: string; labels: string[]; counts: { train: number; dev: number; test: number } };
  models: { student: string; studentLabel: string; teacher: string; teacherLabel: string; grader: string; graderLabel: string };
  baseline: Evals | null; reference: Evals | null; tuned: Evals | null; failures: Failure[]; fixed: string[];
  teach: { written: number; kept: number; rejected: number; web: { query: string; results: number; live: boolean } | null } | null;
  training: { jobId: string; examples: number; status: string; checkpoints: Ckpt[]; fineTunedModel: string | null; minutes: number | null } | null;
  deployment: { name: string; status: string; baseUrl: string } | null; decision: { ship: boolean; reason: string } | null; costUsd: number; error: string | null;
}
interface Call { id: string; at: string; step: string; role: string; model: string; tokensIn: number; tokensOut: number; latencyMs: number; costUsd: number; stub: boolean; ok: boolean; error?: string }
interface Config { mode: 'live' | 'stub'; tavily: boolean; models: Record<'student' | 'teacher' | 'grader', { id: string; label: string; price: { in: number; out: number } }>; running: string[] }
interface Sample { name: string; description: string; labels: string[]; labelHelp: Record<string, string>; counts: { train: number; dev: number; test: number } }
interface LogEvent { at: string; kind: string; stage?: StageId; text?: string; call?: Call; run?: Run }

const main = document.getElementById('main')!;
const STAGES: StageId[] = ['intake', 'baseline', 'teach', 'train', 'prove', 'ship'];
const STAGE_COLOR: Record<StageId, string> = { intake: '#2c6fe0', baseline: '#e8a400', teach: '#ef3e2d', train: '#1fae6a', prove: '#e8a400', ship: '#1fae6a' };
const SWATCH = ['#ef3e2d', '#2c6fe0', '#1fae6a', '#e8a400', '#7c8396', '#f28c28'];

let config: Config;
let runs: Run[] = [];
let stream: EventSource | null = null;

// ---------- helpers

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (x: number | null | undefined) => (x == null ? '...' : `${String(Math.round(x * 100))}%`);
const money = (x: number) => (x === 0 ? '$0' : x < 0.0001 ? '<$0.0001' : x < 0.01 ? `$${x.toFixed(4)}` : x < 1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${String(Math.round(x))} ms`);
const time = (iso: string) => new Date(iso).toISOString().slice(11, 19);
const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toISOString().slice(0, 10) === iso.slice(0, 10);
  return `${today ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${iso.slice(11, 16)} UTC`;
};
const pretty = (l: string) => {
  const short: Record<string, string> = { billing: 'Bill', account_access: 'Login', product_question: 'Plans', feedback: 'Ideas', shipping: 'Ship', technical: 'Tech', cancellation: 'Cancel' };
  return short[l] ?? l.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};
const statusText: Record<Status, string> = { running: 'Running', shipped: 'Shipped', not_shipped: 'Not shipped', failed: 'Stopped' };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  return body;
}

function ring(p: number, color = 'var(--accent)'): string {
  const r = 19;
  const L = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, p));
  return `<div class="ring" aria-hidden="true"><svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="${String(r)}" fill="none" stroke="#eceef3" stroke-width="4"/><circle cx="23" cy="23" r="${String(r)}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${String(L * v)} ${String(L)}" transform="rotate(-90 23 23)"/></svg><b>${String(Math.round(v * 100))}%</b></div>`;
}

const ICON = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12l4 4 10-10"/></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6c0 2.4-5 1.4-5 4 0 1 1 1.6 2.5 1.6s2.5-.5 2.5-1.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  lines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function top(title: string, sub: string, search = false): string {
  const live = config.mode === 'live';
  return `<div class="top"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="right">${search ? `<label class="search">${ICON.search}<input id="q" type="search" placeholder="Search runs" aria-label="Search runs"></label>` : ''}<span class="mode ${live ? '' : 'stub'}" title="${live ? 'Calls go to Nebius Token Factory' : 'No NEBIUS_API_KEY: answers are simulated'}"><i></i>${live ? 'Live on Token Factory' : 'Stub mode'}</span></div></div>`;
}

function stubBanner(r: Run | null): string {
  return r?.mode === 'stub' ? `<p class="banner"><b>Stub mode.</b> Simulated answers, so these numbers show how the loop works, not a real result. Add a Token Factory key to run it for real.</p>` : '';
}

function setNav(route: string): void {
  document.querySelectorAll<HTMLAnchorElement>('.nav').forEach((a) => {
    const on = a.dataset.route === route;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function runsTable(list: Run[]): string {
  if (!list.length) return `<div class="card"><p class="note">No runs yet.</p></div>`;
  return `<div class="history" id="history">${list
    .map((r) => {
      const href = r.status === 'running' ? `#/run/${r.id}` : `#/results/${r.id}`;
      const range = r.baseline && r.tuned ? `${pct(r.baseline.accuracy)} to ${pct(r.tuned.accuracy)}` : r.baseline ? `${pct(r.baseline.accuracy)} so far` : '...';
      return `<a class="hrow" href="${href}" data-name="${esc(r.task.name.toLowerCase())}"><span class="dot">${String(r.number).padStart(2, '0')}</span><b>${esc(r.task.name)}${r.mode === 'stub' ? ' <small style="color:var(--faint);font-weight:500">stub</small>' : ''}</b><span class="hide-sm">${when(r.createdAt)}</span><span class="hide-sm">${range}</span><span class="hide-sm">${money(r.costUsd)} spent</span><span class="pill ${r.status}">${statusText[r.status]}</span></a>`;
    })
    .join('')}</div>`;
}

function wireSearch(): void {
  const q = document.getElementById('q') as HTMLInputElement | null;
  q?.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>('#history .hrow').forEach((row) => (row.hidden = Boolean(v) && !(row.dataset.name ?? '').includes(v)));
  });
}

// ---------- Results

function results(r: Run | null): string {
  if (!r) return emptyState();
  const base = r.baseline;
  const tuned = r.tuned;
  const ref = r.reference;
  const gain = base && tuned ? Math.round((tuned.accuracy - base.accuracy) * 100) : null;
  const shipped = r.decision?.ship;
  const fixed = new Set(r.fixed);
  const labels = r.task.labels;
  const biggest = base && tuned ? [...labels].sort((a, b) => acc(tuned, b) - acc(base, b) - (acc(tuned, a) - acc(base, a)))[0] : undefined;
  const gauge = tuned?.accuracy ?? 0;
  const arc = 251 * gauge;
  const endpoint = r.deployment && shipped ? curl(r) : '';

  return `${top(`${greeting()}`, `Run ${String(r.number).padStart(2, '0')} · ${r.task.name}`, true)}${stubBanner(r)}
  <h2>The Numbers <small>${String(r.task.counts.test)} held-out examples, never trained on</small></h2>
  <div class="stats">
    <div class="stat" style="--edge:var(--grey)"><span class="ic">${ICON.cal}</span>${ring(base?.accuracy ?? 0, '#9aa0ae')}<div class="lbl">Base ${esc(r.models.studentLabel)}</div><div class="val">${pct(base?.accuracy)} <span>right</span></div><div class="foot">Before any training</div></div>
    <div class="stat"><span class="ic">${ICON.check}</span>${ring(tuned?.accuracy ?? 0)}<div class="lbl">Tuned ${esc(r.models.studentLabel)}</div><div class="val">${pct(tuned?.accuracy)}${gain != null ? ` <span>${gain >= 0 ? '+' : ''}${String(gain)}</span>` : ''}</div><div class="foot">Same examples, after training</div></div>
    <div class="stat" style="--edge:var(--green)"><span class="ic">${ICON.coin}</span>${ring(tuned && ref && ref.costPer1k > 0 ? 1 - tuned.costPer1k / ref.costPer1k : 0, 'var(--green)')}<div class="lbl">Cost per 1,000 calls</div><div class="val">${tuned ? money(tuned.costPer1k) : '...'} <span>vs ${ref ? money(ref.costPer1k) : '...'}</span></div><div class="foot">Tuned against ${esc(r.models.teacherLabel)}</div></div>
    <div class="stat" style="--edge:var(--blue)"><span class="ic">${ICON.clock}</span>${ring(Math.min(1, (r.training?.minutes ?? 0) / 30), 'var(--blue)')}<div class="lbl">Training time</div><div class="val">${r.training?.minutes != null ? String(r.training.minutes) : '...'} <span>min</span></div><div class="foot">LoRA on Token Factory</div></div>
  </div>

  <h2>This Run <small>${r.status === 'running' ? `Stage ${String(STAGES.indexOf(r.stage) + 1)} of 6` : esc(r.decision?.reason ?? r.error ?? '')}</small></h2>
  <div class="run-grid">
    <div class="hero ${shipped === false ? 'no' : ''}">
      <div class="kick">Tuned accuracy</div>
      <svg class="gauge" viewBox="0 0 200 110" aria-hidden="true"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="20" stroke-linecap="round"/><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--on-accent)" stroke-width="20" stroke-linecap="round" stroke-dasharray="${String(arc)} 260"/></svg>
      <div class="big">${pct(tuned?.accuracy)}</div>
      <div class="sub">${base && tuned ? `Up from ${pct(base.accuracy)} on examples it never trained on` : 'Waiting for the test'}</div>
      <div class="chip">${shipped ? 'Shipped' : shipped === false ? 'Not shipped' : r.status === 'failed' ? 'Stopped' : 'In progress'}</div>
    </div>
    <div class="pair">
      <div class="stat" style="--edge:#f7cf1d"><span class="ic">${ICON.lines}</span>${ring(r.teach && r.teach.written ? r.teach.kept / r.teach.written : 0, '#c99000')}<div class="lbl">Teacher cases kept</div><div class="val">${r.teach ? String(r.teach.kept) : '...'} <span>of ${r.teach ? String(r.teach.written) : '...'}</span></div><div class="foot">Written by ${esc(r.models.teacherLabel)}, checked by ${esc(r.models.graderLabel)}</div></div>
      <div class="stat" style="--edge:var(--green)"><span class="ic">${ICON.shield}</span>${ring(r.failures.length ? fixed.size / r.failures.length : 0, 'var(--green)')}<div class="lbl">Failure types fixed</div><div class="val">${String(fixed.size)} <span>of ${String(r.failures.length)}</span></div><div class="foot">Found in the base model's mistakes</div></div>
    </div>
    <div class="chart">
      <div class="head"><b>Accuracy by label</b><span class="legend"><span><i style="background:#cfd3dd"></i>Base</span><span><i style="background:var(--accent)"></i>Tuned</span></span></div>
      ${base && tuned && biggest ? `<div class="tip">${esc(pretty(biggest))}: ${pct(acc(base, biggest))} to ${pct(acc(tuned, biggest))}</div>` : ''}
      <div class="bars" role="img" aria-label="Accuracy by label, base against tuned">${labels.map((l) => `<div class="col" title="${esc(l)}: ${pct(base ? acc(base, l) : 0)} to ${pct(tuned ? acc(tuned, l) : 0)}"><i class="base" style="height:${String((base ? acc(base, l) : 0) * 100)}%"></i><i class="tuned" style="height:${String((tuned ? acc(tuned, l) : 0) * 100)}%"></i></div>`).join('')}</div>
      <div class="labels">${labels.map((l) => `<span title="${esc(l)}">${esc(pretty(l))}</span>`).join('')}</div>
    </div>
  </div>

  <div class="two" style="margin-top:22px">
    <div class="card"><h3>Failure types</h3>${
      r.failures.length
        ? `<div class="fails">${r.failures
            .slice(0, 6)
            .map((f, i) => `<div class="fail"><i style="background:${SWATCH[i % SWATCH.length]!}"></i><div><b>${esc(titleCase(f.name))}</b><span>${esc(f.description)}</span></div><em class="${fixed.has(f.id) ? 'ok' : 'left'}">${fixed.has(f.id) ? 'Fixed' : r.tuned ? 'Still there' : `${String(f.count)} seen`}</em></div>`)
            .join('')}</div>`
        : '<p class="note">None yet.</p>'
    }</div>
    <div class="card"><h3>${shipped ? 'Use it' : 'The decision'}</h3>${
      shipped
        ? `<p class="note" style="margin-top:0">${esc(r.decision?.reason ?? '')}</p><div class="code" id="curl"><button class="copy" data-copy="curl">Copy</button>${esc(endpoint)}</div>`
        : `<p class="note" style="margin-top:0">${esc(r.decision?.reason ?? r.error ?? 'The run is still going.')}</p>`
    }
      <dl class="kv" style="margin-top:16px"><dt>Student</dt><dd>${esc(r.models.student)}</dd><dt>Teacher</dt><dd>${esc(r.models.teacher)}</dd><dt>Grader</dt><dd>${esc(r.models.grader)}</dd>${r.training ? `<dt>Fine-tune job</dt><dd>${esc(r.training.jobId)}</dd>` : ''}${r.deployment ? `<dt>Endpoint</dt><dd>${esc(r.deployment.name)}</dd>` : ''}<dt>Total spent</dt><dd>${money(r.costUsd)} <a href="#/calls/${r.id}" style="color:var(--accent-text);font-weight:600">See Every Call</a></dd></dl>
    </div>
  </div>

  <h2>Runs</h2>${runsTable(runs)}`;
}

function acc(e: Evals, label: string): number {
  const s = e.perLabel[label];
  return s && s.total ? s.correct / s.total : 0;
}

function curl(r: Run): string {
  const url = r.deployment?.baseUrl === 'stub' ? 'https://api.tokenfactory.nebius.com/v1' : (r.deployment?.baseUrl ?? '');
  return `curl ${url}/chat/completions \\
  -H "Authorization: Bearer $NEBIUS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${r.deployment?.name ?? ''}", "temperature": 0,
       "messages": [{"role": "user", "content": "..."}]}'`;
}

function emptyState(): string {
  return `${top(greeting(), 'Teach a small model one job')}
  <div class="empty">
    <div class="card">
      <h3 style="font-size:22px;letter-spacing:-.02em">Make a small model a specialist</h3>
      <p>Give Apprentice a narrow job and some labelled examples. An agent tests a small open model, has NVIDIA Nemotron teach it from its own mistakes, fine-tunes it on Nebius Token Factory, and ships it only if it beats the original on examples it has never seen.</p>
      <div class="steps3"><div><b>1. Test</b><span>Score the small model as it is</span></div><div><b>2. Teach and train</b><span>Nemotron writes cases for its mistakes; LoRA fine-tune</span></div><div><b>3. Prove and ship</b><span>Same held-out test; deploy only if it wins</span></div></div>
      <a class="btn" href="#/new">Start a Run</a>
    </div>
    <div class="hero"><div class="kick">Try it</div><div style="margin:auto 0;font:700 46px/1 'Space Grotesk';letter-spacing:-.03em">424</div><div class="sub">support tickets bundled as a sample, ready to run</div><div class="chip">8 labels</div></div>
  </div>`;
}

// ---------- New run

let upload: { name: string; text: string } | null = null;

async function newRun(): Promise<string> {
  const s = await api<Sample>('/api/sample');
  const m = config.models;
  const running = runs.find((r) => r.status === 'running');
  return `${top('New Run', 'Teach a small model one job')}
  <h2>The Job <small>Step 1 of 3</small></h2>
  <div class="form">
    <div class="card"><h3>What should the small model do?</h3>
      <label class="f" for="name">Name</label><input class="input" id="name" value="${esc(s.name)}">
      <label class="f" for="desc">Instructions</label><textarea class="input" id="desc">${esc(s.description)}</textarea>
      <label class="f">Labels <span id="labels-src">(from the sample)</span></label><div class="tags" id="tags">${s.labels.map((l) => `<span class="tag">${esc(l)}</span>`).join('')}</div>
    </div>
    <div class="card"><h3>Examples</h3>
      <label class="drop" id="drop"><input type="file" id="file" accept=".csv,.jsonl,.json,text/csv,application/json"><b>Drop a CSV or JSONL file</b>Columns "text" and "label", at least 40 rows</label>
      <button type="button" class="choice on" id="use-sample"><b>Use the sample</b><span>${String(s.counts.train + s.counts.dev + s.counts.test)} support tickets, ready to run</span></button>
      <div class="split3" id="split"><div><b>${String(s.counts.train)}</b><span>to learn from</span></div><div><b>${String(s.counts.dev)}</b><span>checks while tuning</span></div><div><b>${String(s.counts.test)}</b><span>held out for the test</span></div></div>
    </div>
  </div>
  <h2>The Models <small>Step 2 of 3 · set in .env</small></h2>
  <div class="models">
    <div class="model"><div class="role">Student</div><div class="mn">${esc(m.student.label)}</div><p>The one that learns the job: LoRA fine-tuned on Token Factory, then deployed.</p><code>${esc(m.student.id)}</code></div>
    <div class="model"><div class="role">Teacher</div><div class="mn">${esc(m.teacher.label)}</div><p>Writes new training cases aimed at the student's mistakes${config.tavily ? ', with real wording found on the web by Tavily' : ''}.</p><code>${esc(m.teacher.id)}</code></div>
    <div class="model"><div class="role">Grader</div><div class="mn">${esc(m.grader.label)}</div><p>Names the failure types, then labels every teacher case blind; only agreed cases are kept.</p><code>${esc(m.grader.id)}</code></div>
  </div>
  <h2>Go <small>Step 3 of 3</small></h2>
  <div class="go"><div class="est"><b id="est">${estimate(s.counts.test, s.counts.dev, s.labels.length)}</b><span>Model calls on Token Factory, plus the fine-tuning job. Ships only if the tuned model beats the base model on the held-out test.</span></div>
  ${running ? `<a class="btn ghost" href="#/run/${running.id}">See the Run in Progress</a>` : `<button class="btn" id="start">Start the Run</button>`}</div>
  <p class="err" id="err" hidden></p>`;
}

/** Rough cost of the model calls, from the configured prices and typical token counts per call. */
function estimate(test: number, dev: number, labels: number): string {
  const p = config.models;
  const cost = (price: { in: number; out: number }, calls: number, tin: number, tout: number) => (calls * (price.in * tin + price.out * tout)) / 1e6;
  const total = cost(p.student.price, test * 2 + dev, 220, 4) + cost(p.teacher.price, test, 220, 4) + cost(p.teacher.price, 7, 900, 3200) + cost(p.grader.price, 10, 2200, 500) + labels * 0;
  return config.mode === 'live' ? `About ${money(total)} in model calls` : 'Free in stub mode';
}

function wireNewRun(): void {
  const file = document.getElementById('file') as HTMLInputElement;
  const drop = document.getElementById('drop')!;
  const sample = document.getElementById('use-sample')!;
  const err = document.getElementById('err')!;
  const read = async (f: File) => {
    upload = { name: f.name, text: await f.text() };
    const rows = upload.text.trim().split('\n').length - (f.name.endsWith('.csv') ? 1 : 0);
    sample.classList.remove('on');
    drop.querySelector('b')!.textContent = f.name;
    document.getElementById('labels-src')!.textContent = '(read from your file when the run starts)';
    document.getElementById('split')!.innerHTML = `<div><b>${String(Math.round(rows * 0.6))}</b><span>to learn from</span></div><div><b>${String(Math.round(rows * 0.15))}</b><span>checks while tuning</span></div><div><b>${String(Math.round(rows * 0.25))}</b><span>held out for the test</span></div>`;
  };
  file?.addEventListener('change', () => file.files?.[0] && void read(file.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) void read(f);
  });
  sample.addEventListener('click', () => {
    upload = null;
    void route();
  });
  document.getElementById('start')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    err.hidden = true;
    try {
      const body = upload ? { name: (document.getElementById('name') as HTMLInputElement).value, description: (document.getElementById('desc') as HTMLTextAreaElement).value, data: upload.text } : { sample: true };
      const r = await api<Run>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      upload = null;
      location.hash = `#/run/${r.id}`;
    } catch (ex) {
      err.textContent = (ex as Error).message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}

// ---------- Live loop

let liveCalls: Call[] = [];
let liveEvents: LogEvent[] = [];

function loop(r: Run): string {
  const done = r.status !== 'running';
  return `${top(`Run ${String(r.number).padStart(2, '0')}${done ? '' : ', Live'}`, `${r.task.name} · started ${when(r.createdAt)}`)}${stubBanner(r)}
  <h2>The Loop <small id="stage-note">${done ? statusText[r.status] : `Stage ${String(STAGES.indexOf(r.stage) + 1)} of 6`}</small></h2>
  <div class="stages" id="stages">${stagesHtml(r)}</div>
  <div id="done-bar">${doneBar(r)}</div>
  <div class="livegrid">
    <div class="card"><h3>What the agent is doing</h3><div class="feed" id="feed" aria-live="polite">${feedHtml()}</div></div>
    <div style="display:grid;gap:18px;align-content:start">
      <div class="card"><h3>Training loss</h3><div id="loss">${lossHtml(r)}</div></div>
      <div class="card"><h3>Every call, with its receipt</h3><div class="scroll" id="calls">${callsTable(liveCalls.slice(-8).reverse())}</div><p class="note"><span id="call-count">${String(liveCalls.length)}</span> calls so far · <a href="#/calls/${r.id}" style="color:var(--accent-text);font-weight:600">See All</a></p></div>
    </div>
  </div>`;
}

function stagesHtml(r: Run): string {
  return STAGES.map((id, i) => {
    const s = r.stages[id];
    const mark = s.status === 'done' ? '✓' : s.status === 'live' ? (s.progress != null ? pct(s.progress) : '...') : s.status === 'failed' ? '!' : s.status === 'skipped' ? '–' : '';
    return `<div class="stg ${s.status}" aria-label="${esc(`${s.title}: ${s.status}`)}"><div class="n">${String(i + 1)} ${esc(s.title === titleCase(id) || s.status === 'waiting' ? titleCase(id) : titleCase(id))}</div><span class="st">${mark}</span><div class="t">${esc(s.status === 'waiting' ? 'Waiting' : s.title)}</div><div class="d">${esc(s.detail)}</div>${s.status === 'live' && s.progress != null ? `<div class="bar"><b style="width:${String(Math.round(s.progress * 100))}%"></b></div>` : ''}</div>`;
  }).join('');
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function doneBar(r: Run): string {
  if (r.status === 'running') return '';
  return `<div class="done-bar"><b>${r.status === 'shipped' ? 'Shipped. ' : r.status === 'not_shipped' ? 'Not shipped. ' : 'Stopped. '}${esc(r.decision?.reason ?? r.error ?? '')}</b><a class="btn" href="#/results/${r.id}">See the Results</a></div>`;
}

function feedHtml(): string {
  const logs = liveEvents.filter((e) => e.kind === 'log');
  if (!logs.length) return '<p class="note">Starting...</p>';
  return logs
    .slice()
    .reverse()
    .map((e) => `<div class="ev"><time>${time(e.at)}</time><i style="background:${STAGE_COLOR[e.stage ?? 'intake']}"></i><span>${esc(titleCase(e.text ?? ''))}</span></div>`)
    .join('');
}

function lossHtml(r: Run): string {
  const c = r.training?.checkpoints ?? [];
  if (!c.length) return `<p class="note">${r.training ? 'Waiting for the first epoch.' : 'Starts at the Train stage.'}</p>`;
  const vals = c.flatMap((k) => [k.trainLoss ?? 0, k.validLoss ?? 0]);
  const max = Math.max(...vals, 0.01) * 1.1;
  const x = (i: number) => (c.length === 1 ? 150 : (i / (c.length - 1)) * 300);
  const y = (v: number) => 120 - (v / max) * 110;
  const path = (key: 'trainLoss' | 'validLoss') => c.map((k, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(k[key] ?? 0).toFixed(1)}`).join(' ');
  const dots = (key: 'trainLoss' | 'validLoss', col: string) => c.map((k, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(k[key] ?? 0).toFixed(1)}" r="4" fill="${col}"/>`).join('');
  return `<svg class="loss" viewBox="-6 -6 312 132" preserveAspectRatio="none" role="img" aria-label="Training and validation loss by epoch"><path d="${path('trainLoss')}" fill="none" stroke="var(--accent)" stroke-width="3"/><path d="${path('validLoss')}" fill="none" stroke="#9aa0ae" stroke-width="3" stroke-dasharray="6 6"/>${dots('trainLoss', 'var(--accent)')}${dots('validLoss', '#9aa0ae')}</svg><span class="legend"><span><i style="background:var(--accent)"></i>Training ${c.at(-1)?.trainLoss?.toFixed(2) ?? ''}</span><span><i style="background:#9aa0ae"></i>Validation ${c.at(-1)?.validLoss?.toFixed(2) ?? ''}</span></span>`;
}

function callsTable(calls: Call[]): string {
  if (!calls.length) return '<p class="note">No calls yet.</p>';
  const label = (c: Call) => (c.role === 'student' ? (c.step === 'prove' ? 'Tuned student' : 'Base student') : c.role === 'teacher' ? config.models.teacher.label : config.models.grader.label);
  return `<table class="calls"><thead><tr><th>Model</th><th class="hide-sm">Step</th><th>Tokens</th><th>Time</th><th>Cost</th></tr></thead><tbody>${calls
    .map((c) => `<tr><td>${esc(label(c))}${c.ok ? '' : ' <span style="color:#b42318">failed</span>'}</td><td class="hide-sm">${esc(titleCase(c.step))}</td><td>${(c.tokensIn + c.tokensOut).toLocaleString('en-US')}</td><td>${ms(c.latencyMs)}</td><td>${money(c.costUsd)}</td></tr>`)
    .join('')}</tbody></table>`;
}

let pending = 0;
function scheduleLive(r: Run): void {
  // Calls can arrive dozens a second; repaint at most every 250 ms.
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    const stages = document.getElementById('stages');
    if (!stages) return;
    stages.innerHTML = stagesHtml(r);
    document.getElementById('feed')!.innerHTML = feedHtml();
    document.getElementById('calls')!.innerHTML = callsTable(liveCalls.slice(-8).reverse());
    document.getElementById('call-count')!.textContent = String(liveCalls.length);
    document.getElementById('loss')!.innerHTML = lossHtml(r);
    document.getElementById('done-bar')!.innerHTML = doneBar(r);
    document.getElementById('stage-note')!.textContent = r.status === 'running' ? `Stage ${String(STAGES.indexOf(r.stage) + 1)} of 6` : statusText[r.status];
  }, 250);
}

async function openLoop(id: string): Promise<void> {
  let r = await api<Run>(`/api/runs/${id}`);
  liveCalls = await api<Call[]>(`/api/runs/${id}/calls`);
  liveEvents = await api<LogEvent[]>(`/api/runs/${id}/events`);
  main.innerHTML = loop(r);
  if (r.status !== 'running') return;
  stream = new EventSource(`/api/runs/${id}/stream`);
  stream.onmessage = (m) => {
    const e = JSON.parse(m.data as string) as LogEvent;
    if (e.kind === 'state' && e.run) r = e.run;
    if (e.kind === 'log') liveEvents.push(e);
    if (e.kind === 'call' && e.call) liveCalls.push(e.call);
    scheduleLive(r);
    if (e.kind === 'state' && e.run && e.run.status !== 'running') {
      stream?.close();
      stream = null;
      void refreshRuns();
    }
  };
}

// ---------- Every call

function callsPage(r: Run, calls: Call[]): string {
  const byStep = ['baseline', 'teach', 'train', 'prove'].map((s) => ({ s, xs: calls.filter((c) => c.step === s) })).filter((g) => g.xs.length);
  return `${top('Every Call', `Run ${String(r.number).padStart(2, '0')} · ${calls.length} calls · ${money(r.costUsd)} in total`)}${stubBanner(r)}
  <h2>By step</h2>
  <div class="stats">${byStep
    .map((g) => `<div class="stat" style="--edge:${STAGE_COLOR[g.s as StageId]}"><span class="ic">${ICON.lines}</span><div class="lbl">${titleCase(g.s)}</div><div class="val">${money(g.xs.reduce((t, c) => t + c.costUsd, 0))}</div><div class="foot">${String(g.xs.length)} calls, ${g.xs.reduce((t, c) => t + c.tokensIn + c.tokensOut, 0).toLocaleString('en-US')} tokens</div></div>`)
    .join('')}</div>
  <h2>All calls <small>Newest first</small></h2>
  <div class="card scroll tall"><table class="calls"><thead><tr><th>Time (UTC)</th><th>Model</th><th>Step</th><th>Tokens in</th><th>Tokens out</th><th>Latency</th><th>Cost</th></tr></thead><tbody>${calls
    .slice()
    .reverse()
    .slice(0, 400)
    .map((c) => `<tr><td>${time(c.at)}</td><td>${esc(c.model)}${c.ok ? '' : ` <span style="color:#b42318">${esc(c.error ?? 'failed')}</span>`}</td><td>${esc(titleCase(c.step))}</td><td>${c.tokensIn.toLocaleString('en-US')}</td><td>${c.tokensOut.toLocaleString('en-US')}</td><td>${ms(c.latencyMs)}</td><td>${money(c.costUsd)}</td></tr>`)
    .join('')}</tbody></table>${calls.length > 400 ? '<p class="note">Showing the newest 400.</p>' : ''}</div>`;
}

// ---------- About

function about(): string {
  return `${top('About Apprentice', 'How the loop works')}
  <div class="prose">
    <h3>The job</h3><p>Frontier models are accurate but expensive for narrow, repetitive work. Small open models are cheap but not accurate enough out of the box. Apprentice closes the gap for one job at a time, and proves it.</p>
    <h3>The loop</h3><p><b>Baseline</b> scores the small model on held-out examples, and scores ${esc(config.models.teacher.label)} on the same examples as the bar to chase. <b>Teach</b>: ${esc(config.models.grader.label)} groups the small model's mistakes into failure types; ${esc(config.models.teacher.label)} writes new cases aimed at each one${config.tavily ? ', using real wording found on the web with Tavily' : ''}; the grader labels every case blind and only agreed cases are kept. <b>Train</b>: a LoRA fine-tune on Nebius Token Factory. <b>Prove</b>: the tuned model takes the same held-out test. <b>Ship</b>: the endpoint is kept only if the tuned model wins.</p>
    <h3>The guarantees</h3><p>Held-out examples are never used to teach or train. Every model call is logged with its tokens, time and cost. The eval runs at temperature 0 with the same prompt, so scores are repeatable.</p>
    <h3>Mode</h3><p>${config.mode === 'live' ? 'Live: calls go to Nebius Token Factory.' : 'Stub mode: no NEBIUS_API_KEY, so answers are simulated to show the loop. Add a key to .env to run it for real.'}</p>
  </div>`;
}

// ---------- routing

async function refreshRuns(): Promise<void> {
  runs = await api<Run[]>('/api/runs');
}

async function route(): Promise<void> {
  stream?.close();
  stream = null;
  const [, page = '', id] = location.hash.replace(/^#/, '').split('/');
  try {
    await refreshRuns();
    const latestDone = runs.find((r) => r.status !== 'running') ?? null;
    const running = runs.find((r) => r.status === 'running');
    if (page === '' || page === 'results') {
      setNav('results');
      const r = id ? await api<Run>(`/api/runs/${id}`) : (latestDone ?? running ?? null);
      main.innerHTML = results(r);
      wireSearch();
      document.querySelector('[data-copy]')?.addEventListener('click', (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        void navigator.clipboard.writeText(document.getElementById('curl')!.textContent!.replace(/^Copy/, '')).then(() => (btn.textContent = 'Copied'));
      });
    } else if (page === 'new') {
      setNav('new');
      main.innerHTML = await newRun();
      wireNewRun();
    } else if (page === 'run') {
      setNav('run');
      const target = id ?? running?.id ?? runs[0]?.id;
      if (!target) main.innerHTML = `${top('The Loop', 'No runs yet')}<div class="card" style="margin-top:22px"><p class="note" style="margin-top:0">Start a run to watch the loop.</p><a class="btn" href="#/new">Start a Run</a></div>`;
      else await openLoop(target);
    } else if (page === 'calls') {
      setNav('calls');
      const target = id ?? running?.id ?? runs[0]?.id;
      if (!target) main.innerHTML = `${top('Every Call', 'No runs yet')}`;
      else main.innerHTML = callsPage(await api<Run>(`/api/runs/${target}`), await api<Call[]>(`/api/runs/${target}/calls`));
    } else {
      setNav('about');
      main.innerHTML = about();
    }
  } catch (err) {
    main.innerHTML = `${top('Something went wrong', '')}<p class="err">${esc((err as Error).message)}</p>`;
  }
  main.focus({ preventScroll: true });
}

void (async () => {
  config = await api<Config>('/api/config');
  addEventListener('hashchange', () => void route());
  await route();
})();
