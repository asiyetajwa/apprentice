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

let config: Config;
let runs: Run[] = [];
let stream: EventSource | null = null;

// ---------- helpers

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (x: number | null | undefined) => (x == null ? '...' : `${String(Math.round(x * 100))}%`);
const money = (x: number) => (x === 0 ? '$0' : x < 0.0001 ? '<$0.0001' : x < 0.01 ? `$${x.toFixed(4)}` : x < 1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${String(Math.round(x))} ms`);
const time = (iso: string) => new Date(iso).toISOString().slice(11, 19);
const hhmm = (iso: string) => iso.slice(11, 16);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(/,/g, '');
const when = (iso: string) => {
  const today = new Date().toISOString().slice(0, 10) === iso.slice(0, 10);
  return `${today ? 'Today' : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${hhmm(iso)} UTC`;
};
const pretty = (l: string) => {
  const short: Record<string, string> = { billing: 'Bill', account_access: 'Login', product_question: 'Plans', feedback: 'Ideas', shipping: 'Ship', technical: 'Tech', cancellation: 'Cancel' };
  return short[l] ?? l.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const runNo = (r: Run) => `Run ${String(r.number).padStart(2, '0')}`;
const statusText: Record<Status, string> = { running: 'Running', shipped: 'Shipped', not_shipped: 'Not shipped', failed: 'Stopped' };

/** Two-tone number: the leading part that carries no information (zeros, "$0.") is set light. */
function twoTone(s: string): string {
  const m = /^(\$?0?\.?0*)(.+)$/.exec(s);
  return m && m[1] ? `<em>${esc(m[1])}</em>${esc(m[2])}` : esc(s);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  return body;
}

const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12l4 4 10-10"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>',
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 8v4l2.5 1.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  target: '<svg class="target" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
};

function top(title: string, sub: string, search = false): string {
  const live = config.mode === 'live';
  return `<div class="top"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="right">${search ? `<label class="search well">${ICON.search}<input id="q" type="search" placeholder="Search runs" aria-label="Search runs"></label>` : ''}<span class="mode raised ${live ? '' : 'stub'}" title="${live ? 'Calls go to Nebius Token Factory' : 'No NEBIUS_API_KEY: answers are simulated'}"><i></i>${live ? 'Live on Token Factory' : 'Stub mode'}</span></div></div>`;
}

function stubBanner(r: Run | null): string {
  return r?.mode === 'stub' ? `<p class="banner well"><b>Stub mode.</b> Simulated answers, so these numbers show how the loop works, not a real result. Add a Token Factory key to run it for real.</p>` : '';
}

function setNav(route: string): void {
  document.querySelectorAll<HTMLAnchorElement>('.nav').forEach((a) => {
    const on = a.dataset.route === route;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function dome(cls: string, p: number | null, value: string, label: string, ticks = false, grey = false): string {
  const v = p == null ? 0 : Math.max(0, Math.min(1, p));
  return `<div class="dome ${cls}${grey ? ' grey' : ''}" style="--p:${String(Math.round(v * 1000) / 10)}%"><i class="arc"></i>${ticks ? '<span class="tick t0">100</span><span class="tick t1">75</span><span class="tick t2">50</span><span class="tick t3">25</span>' : ''}<div class="disc"><i class="pip"></i><b>${esc(value)}</b><span>${esc(label)}</span></div></div>`;
}

function runsTable(list: Run[]): string {
  if (!list.length) return `<div class="panel raised"><p class="note" style="margin:0">No runs yet.</p></div>`;
  return `<div class="history" id="history">${list
    .map((r) => {
      const href = r.status === 'running' ? `#/run/${r.id}` : `#/results/${r.id}`;
      const range = r.baseline && r.tuned ? `${pct(r.baseline.accuracy)} to ${pct(r.tuned.accuracy)}` : r.baseline ? `${pct(r.baseline.accuracy)} so far` : '...';
      return `<a class="hrow raised" href="${href}" data-name="${esc(r.task.name.toLowerCase())}"><span class="key pressed">${String(r.number).padStart(2, '0')}</span><b>${esc(r.task.name)}${r.mode === 'stub' ? ' <small>stub</small>' : ''}</b><span class="hide-sm">${when(r.createdAt)}</span><span class="hide-sm">${range}</span><span class="hide-sm">${money(r.costUsd)} spent</span><span class="tag-s pressed ${r.status}"><i></i>${statusText[r.status]}</span></a>`;
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

function acc(e: Evals, label: string): number {
  const s = e.perLabel[label];
  return s && s.total ? s.correct / s.total : 0;
}

// ---------- Results

function results(r: Run | null): string {
  if (!r) return emptyState();
  const base = r.baseline;
  const tuned = r.tuned;
  const ref = r.reference;
  const shipped = r.decision?.ship;
  const fixed = new Set(r.fixed);
  const labels = r.task.labels;
  const biggest = base && tuned ? [...labels].sort((a, b) => acc(tuned, b) - acc(base, b) - (acc(tuned, a) - acc(base, a)))[0] : undefined;
  const stageNo = `Stage ${String(STAGES.indexOf(r.stage) + 1)} of 6`;
  const whenLine = shipped ? `Shipped at ${hhmm(r.finishedAt ?? r.createdAt)} UTC` : shipped === false ? 'Not shipped' : r.status === 'failed' ? 'Stopped' : `Running: ${stageNo.toLowerCase()}`;
  const verdict = shipped
    ? `<div class="verdict raised"><i>${ICON.check}</i>${esc(r.decision?.reason ?? 'Shipped')}</div>`
    : shipped === false || r.status === 'failed'
      ? `<div class="verdict raised no"><i>${ICON.cross}</i>${esc(r.decision?.reason ?? r.error ?? 'Stopped')}</div>`
      : `<div class="verdict raised wait"><i>${ICON.wait}</i><span>Still running. <a class="link" href="#/run/${r.id}">Watch the Loop</a></span></div>`;
  const mins = r.training?.minutes;

  return `${top(day(r.createdAt), `${runNo(r)} · ${hhmm(r.createdAt)} UTC`, true)}${stubBanner(r)}
  <section class="hero">
    <div class="dials" aria-label="Tuned ${pct(tuned?.accuracy)}, base ${pct(base?.accuracy)}">
      ${dome('d1', tuned?.accuracy ?? null, pct(tuned?.accuracy), 'Tuned', true)}
      ${ICON.target}
      ${dome('d2', base?.accuracy ?? null, pct(base?.accuracy), 'Base', false, true)}
    </div>
    <div class="headline">
      <div class="kick">Tuned ${esc(r.models.studentLabel)}</div>
      <h1>${esc(r.task.name)}</h1>
      <div class="when">${esc(whenLine)}</div>
      <div class="nums">
        <div class="num"><span>Held-out test</span><b>${tuned ? `<em>${String(tuned.correct)} / </em>${String(tuned.total)}` : '...'}</b><small>${base ? `Up from ${String(base.correct)} right` : 'Not scored yet'}</small></div>
        <div class="num"><span>Per 1,000 calls</span><b>${tuned ? twoTone(money(tuned.costPer1k)) : '...'}</b><small>${ref ? `${esc(r.models.teacherLabel)}: ${money(ref.costPer1k)}` : `Against ${esc(r.models.teacherLabel)}`}</small></div>
        <div class="num"><span>Training</span><b>${mins != null ? `${mins < 10 ? '<em>0</em>' : ''}${String(mins)} min` : '...'}</b><small>LoRA on Token Factory</small></div>
      </div>
      ${verdict}
    </div>
  </section>

  <h2>The Loop <small>${r.status === 'running' ? stageNo : 'All stages finished'}</small></h2>
  <div class="stages">${stagesHtml(r)}</div>

  <h2>What Changed <small>${String(r.task.counts.test)} held-out examples, never trained on</small></h2>
  <div class="grid">
    <div class="panel raised">
      <h3>Accuracy by label<span class="legend"><span><i style="background:#c6c6c3"></i>Base</span><span><i style="background:var(--lit)"></i>Tuned</span></span></h3>
      <div class="bars well" role="img" aria-label="Accuracy by label, base against tuned">${labels.map((l) => `<div class="col" title="${esc(l)}: ${pct(base ? acc(base, l) : 0)} to ${pct(tuned ? acc(tuned, l) : 0)}"><i class="b" style="height:${String((base ? acc(base, l) : 0) * 100)}%"></i><i class="t" style="height:${String((tuned ? acc(tuned, l) : 0) * 100)}%"></i></div>`).join('')}</div>
      <div class="lbls">${labels.map((l) => `<span title="${esc(l)}">${esc(pretty(l))}</span>`).join('')}</div>
      ${base && tuned && biggest ? `<p class="tip">Biggest change: <b>${esc(pretty(biggest))}</b>, ${pct(acc(base, biggest))} to ${pct(acc(tuned, biggest))}</p>` : ''}
    </div>
    <div class="panel raised"><h3>Training loss</h3>${lossWindow(r)}</div>
    <div class="panel raised"><h3>Failure types</h3>${
      r.failures.length
        ? `<div class="fails">${r.failures
            .slice(0, 6)
            .map((f) => {
              const ok = fixed.has(f.id);
              return `<div class="fail well"><span class="key raised ${ok ? 'ok' : ''}">${ok ? ICON.check : ICON.dot}</span><div><b>${esc(titleCase(f.name))}</b><span>${esc(f.description)}</span></div><em class="${ok ? 'ok' : ''}">${ok ? 'Fixed' : r.tuned ? 'Still there' : `${String(f.count)} seen`}</em></div>`;
            })
            .join('')}</div>`
        : '<p class="note" style="margin:0">None yet.</p>'
    }</div>
    <div class="panel raised"><h3>Receipt</h3>
      <dl class="receipt">
        ${r.deployment && shipped ? `<div><dt>Endpoint</dt><dd>${esc(r.deployment.name)}</dd></div>` : ''}
        <div><dt>Student</dt><dd>${esc(r.models.studentLabel)}</dd></div>
        <div><dt>Teacher</dt><dd>${esc(r.models.teacherLabel)}</dd></div>
        <div><dt>Grader</dt><dd>${esc(r.models.graderLabel)}</dd></div>
        ${r.teach ? `<div><dt>Teacher cases kept</dt><dd>${String(r.teach.kept)} of ${String(r.teach.written)}</dd></div>` : ''}
        ${r.training ? `<div><dt>Fine-tune job</dt><dd>${esc(r.training.jobId)}</dd></div>` : ''}
        <div><dt>Total spent</dt><dd>${money(r.costUsd)} · <a class="link" href="#/calls/${r.id}">Every Call</a></dd></div>
      </dl>
      ${r.deployment && shipped ? `<div class="code" id="curl"><button class="copy" data-copy="curl">Copy</button>${esc(curl(r))}</div>` : ''}
    </div>
  </div>

  <h2>Runs</h2>${runsTable(runs)}`;
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
  return `${top(day(new Date().toISOString()), 'Teach a small model one job')}
  <section class="welcome">
    <div class="dials">${dome('d1', 1, '424', 'Tickets')}</div>
    <div class="headline">
      <div class="kick">Apprentice</div>
      <h1>Make a small model a specialist</h1>
      <p>Give Apprentice a narrow job and some labelled examples. An agent tests a small open model, has NVIDIA Nemotron teach it from its own mistakes, fine-tunes it on Nebius Token Factory, and ships it only if it beats the original on examples it has never seen.</p>
      <div class="steps3"><div class="raised"><b>1. Test</b><span>Score the small model as it is</span></div><div class="raised"><b>2. Teach and train</b><span>Nemotron writes cases for its mistakes, then a LoRA fine-tune</span></div><div class="raised"><b>3. Prove and ship</b><span>Same held-out test, deploy only if it wins</span></div></div>
      <a class="btn" href="#/new">Start a Run</a>
    </div>
  </section>`;
}

// ---------- New run

let upload: { name: string; text: string } | null = null;

function splitHtml(train: number, dev: number, test: number): string {
  return `<div class="well"><b>${String(train)}</b><span>to learn from</span></div><div class="well"><b>${String(dev)}</b><span>checks while tuning</span></div><div class="well"><b>${String(test)}</b><span>held out for the test</span></div>`;
}

async function newRun(): Promise<string> {
  const s = await api<Sample>('/api/sample');
  const m = config.models;
  const running = runs.find((r) => r.status === 'running');
  return `${top('New Run', 'Teach a small model one job')}
  <h2>The Job <small>Step 1 of 3</small></h2>
  <div class="form">
    <div class="panel raised"><h3>What should the small model do?</h3>
      <label class="f" for="name">Name</label><input class="input" id="name" value="${esc(s.name)}">
      <label class="f" for="desc">Instructions</label><textarea class="input" id="desc">${esc(s.description)}</textarea>
      <label class="f">Labels <span id="labels-src">(from the sample)</span></label><div class="tags" id="tags">${s.labels.map((l) => `<span class="tag raised">${esc(l)}</span>`).join('')}</div>
    </div>
    <div class="panel raised"><h3>Examples</h3>
      <label class="drop well" id="drop"><input type="file" id="file" accept=".csv,.jsonl,.json,text/csv,application/json"><b>Drop a CSV or JSONL file</b>Columns "text" and "label", at least 40 rows</label>
      <button type="button" class="choice raised on" id="use-sample"><i class="dot"></i><span><b>Use the sample</b>${String(s.counts.train + s.counts.dev + s.counts.test)} support tickets, ready to run</span></button>
      <div class="split3" id="split">${splitHtml(s.counts.train, s.counts.dev, s.counts.test)}</div>
    </div>
  </div>
  <h2>The Models <small>Step 2 of 3 · set in .env</small></h2>
  <div class="models">
    <div class="panel raised model"><div class="role">Student</div><div class="mn">${esc(m.student.label)}</div><p>The one that learns the job: LoRA fine-tuned on Token Factory, then deployed.</p><code class="well">${esc(m.student.id)}</code></div>
    <div class="panel raised model"><div class="role">Teacher</div><div class="mn">${esc(m.teacher.label)}</div><p>Writes new training cases aimed at the student's mistakes${config.tavily ? ', with real wording found on the web by Tavily' : ''}.</p><code class="well">${esc(m.teacher.id)}</code></div>
    <div class="panel raised model"><div class="role">Grader</div><div class="mn">${esc(m.grader.label)}</div><p>Names the failure types, then labels every teacher case blind. Only agreed cases are kept.</p><code class="well">${esc(m.grader.id)}</code></div>
  </div>
  <h2>Go <small>Step 3 of 3</small></h2>
  <div class="panel raised go"><div class="est"><b id="est">${estimate(s.counts.test, s.counts.dev)}</b><span>Model calls on Token Factory, plus the fine-tuning job. Ships only if the tuned model beats the base model on the held-out test.</span></div>
  ${running ? `<a class="btn ghost" href="#/run/${running.id}">See the Run in Progress</a>` : `<button class="btn" id="start">Start the Run</button>`}</div>
  <p class="err" id="err" hidden></p>`;
}

/** Rough cost of the model calls, from the configured prices and typical token counts per call. */
function estimate(test: number, dev: number): string {
  const p = config.models;
  const cost = (price: { in: number; out: number }, calls: number, tin: number, tout: number) => (calls * (price.in * tin + price.out * tout)) / 1e6;
  const total = cost(p.student.price, test * 2 + dev, 220, 4) + cost(p.teacher.price, test, 220, 4) + cost(p.teacher.price, 7, 900, 3200) + cost(p.grader.price, 10, 2200, 500);
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
    document.getElementById('split')!.innerHTML = splitHtml(Math.round(rows * 0.6), Math.round(rows * 0.15), Math.round(rows * 0.25));
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
  return `${top(`${runNo(r)}${done ? '' : ', Live'}`, `${r.task.name} · started ${when(r.createdAt)}`)}${stubBanner(r)}
  <h2>The Loop <small id="stage-note">${done ? statusText[r.status] : `Stage ${String(STAGES.indexOf(r.stage) + 1)} of 6`}</small></h2>
  <div class="stages" id="stages">${stagesHtml(r)}</div>
  <div id="done-bar">${doneBar(r)}</div>
  <div class="livegrid">
    <div class="panel raised"><h3>What the agent is doing</h3><div class="feed well" id="feed" aria-live="polite">${feedHtml()}</div></div>
    <div class="side-stack">
      <div class="panel raised"><h3>Training loss</h3><div id="loss">${lossWindow(r)}</div></div>
      <div class="panel raised"><h3>Every call, with its receipt</h3><div class="scroll" id="calls">${callsTable(liveCalls.slice(-8).reverse())}</div><p class="note"><span id="call-count">${String(liveCalls.length)}</span> calls so far · <a class="link" href="#/calls/${r.id}">See All</a></p></div>
    </div>
  </div>`;
}

function stagesHtml(r: Run): string {
  return STAGES.map((id, i) => {
    const s = r.stages[id];
    const live = s.status === 'live';
    const inner = s.status === 'done' ? ICON.check : live ? (s.progress != null ? pct(s.progress) : '...') : s.status === 'failed' ? '!' : s.status === 'skipped' ? '–' : String(i + 1);
    const p = live && s.progress != null ? `--p:${String(Math.round(s.progress * 100))}%` : live ? '--p:12%' : '';
    return `<div class="stage ${s.status}" title="${esc(s.detail)}"><span class="key ${live ? 'pressed' : 'raised'}" style="${p}" role="img" aria-label="${esc(`${titleCase(id)}: ${s.status}`)}">${inner}</span><b>${titleCase(id)}</b><span>${esc(s.status === 'waiting' ? 'Waiting' : live && s.detail ? s.detail : s.title)}</span></div>`;
  }).join('');
}

function doneBar(r: Run): string {
  if (r.status === 'running') return '';
  return `<div class="done-row raised"><span>${r.status === 'shipped' ? 'Shipped. ' : r.status === 'not_shipped' ? 'Not shipped. ' : 'Stopped. '}${esc(r.decision?.reason ?? r.error ?? '')}</span><a class="btn" href="#/results/${r.id}">See the Results</a></div>`;
}

function feedHtml(): string {
  const logs = liveEvents.filter((e) => e.kind === 'log');
  if (!logs.length) return '<p class="note">Starting...</p>';
  return logs
    .slice()
    .reverse()
    .map((e) => `<div class="ev"><time>${time(e.at)}</time><i></i><span>${esc(titleCase(e.text ?? ''))}</span></div>`)
    .join('');
}

function lossWindow(r: Run): string {
  const c = r.training?.checkpoints ?? [];
  if (!c.length) return `<div class="window"><span class="empty-cap">${r.training ? 'Waiting for the first epoch' : 'Starts at the Train stage'}</span></div>`;
  const vals = c.flatMap((k) => [k.trainLoss ?? 0, k.validLoss ?? 0]);
  const max = Math.max(...vals, 0.01) * 1.1;
  const x = (i: number) => (c.length === 1 ? 150 : (i / (c.length - 1)) * 300);
  const y = (v: number) => 120 - (v / max) * 110;
  const path = (key: 'trainLoss' | 'validLoss') => c.map((k, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(k[key] ?? 0).toFixed(1)}`).join(' ');
  const last = c.length - 1;
  const dots = c.map((k, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(k.trainLoss ?? 0).toFixed(1)}" r="5" fill="${i === last ? 'var(--lit)' : '#f3f3f0'}"/>`).join('');
  return `<div class="window"><div class="cap"><span>Training ${c[last]?.trainLoss?.toFixed(2) ?? ''}</span><span>Validation ${c[last]?.validLoss?.toFixed(2) ?? ''}</span></div><svg viewBox="0 0 300 120" preserveAspectRatio="none" role="img" aria-label="Training and validation loss by epoch"><path d="${path('validLoss')}" fill="none" stroke="#9c9c99" stroke-width="3" stroke-dasharray="7 7" vector-effect="non-scaling-stroke"/><path d="${path('trainLoss')}" fill="none" stroke="#f3f3f0" stroke-width="3" vector-effect="non-scaling-stroke"/>${dots}</svg></div>`;
}

function callsTable(calls: Call[]): string {
  if (!calls.length) return '<p class="note" style="margin:0">No calls yet.</p>';
  const label = (c: Call) => (c.role === 'student' ? (c.step === 'prove' ? 'Tuned student' : 'Base student') : c.role === 'teacher' ? config.models.teacher.label : config.models.grader.label);
  return `<table class="calls"><thead><tr><th>Model</th><th class="hide-sm">Step</th><th>Tokens</th><th>Time</th><th>Cost</th></tr></thead><tbody>${calls
    .map((c) => `<tr><td>${esc(label(c))}${c.ok ? '' : ' <span class="bad">failed</span>'}</td><td class="hide-sm">${esc(titleCase(c.step))}</td><td>${(c.tokensIn + c.tokensOut).toLocaleString('en-US')}</td><td>${ms(c.latencyMs)}</td><td>${money(c.costUsd)}</td></tr>`)
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
    document.getElementById('loss')!.innerHTML = lossWindow(r);
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
  return `${top('Every Call', `${runNo(r)} · ${String(calls.length)} calls · ${money(r.costUsd)} in total`)}${stubBanner(r)}
  <h2>By Step</h2>
  <div class="cost-row">${byStep
    .map((g) => `<div class="num"><span>${titleCase(g.s)}</span><b>${twoTone(money(g.xs.reduce((t, c) => t + c.costUsd, 0)))}</b><small>${String(g.xs.length)} calls, ${g.xs.reduce((t, c) => t + c.tokensIn + c.tokensOut, 0).toLocaleString('en-US')} tokens</small></div>`)
    .join('')}</div>
  <h2>All Calls <small>Newest first</small></h2>
  <div class="panel raised"><div class="scroll tall"><table class="calls"><thead><tr><th>Time (UTC)</th><th>Model</th><th class="hide-sm">Step</th><th class="hide-sm">Tokens in</th><th class="hide-sm">Tokens out</th><th>Latency</th><th>Cost</th></tr></thead><tbody>${calls
    .slice()
    .reverse()
    .slice(0, 400)
    .map((c) => `<tr><td>${time(c.at)}</td><td>${esc(c.model)}${c.ok ? '' : ` <span class="bad">${esc(c.error ?? 'failed')}</span>`}</td><td class="hide-sm">${esc(titleCase(c.step))}</td><td class="hide-sm">${c.tokensIn.toLocaleString('en-US')}</td><td class="hide-sm">${c.tokensOut.toLocaleString('en-US')}</td><td>${ms(c.latencyMs)}</td><td>${money(c.costUsd)}</td></tr>`)
    .join('')}</tbody></table></div>${calls.length > 400 ? '<p class="note">Showing the newest 400.</p>' : ''}</div>`;
}

// ---------- About

function about(): string {
  return `${top('About Apprentice', 'How the loop works')}
  <div class="panel raised prose" style="margin-top:34px">
    <h3>The job</h3><p>Frontier models are accurate but expensive for narrow, repetitive work. Small open models are cheap but not accurate enough out of the box. Apprentice closes the gap for one job at a time, and proves it.</p>
    <h3>The loop</h3><p><b>Baseline</b> scores the small model on held-out examples, and scores ${esc(config.models.teacher.label)} on the same examples as the bar to chase. <b>Teach</b>: ${esc(config.models.grader.label)} groups the small model's mistakes into failure types, ${esc(config.models.teacher.label)} writes new cases aimed at each one${config.tavily ? ', using real wording found on the web with Tavily' : ''}, and the grader labels every case blind so only agreed cases are kept. <b>Train</b>: a LoRA fine-tune on Nebius Token Factory. <b>Prove</b>: the tuned model takes the same held-out test. <b>Ship</b>: the endpoint is kept only if the tuned model wins.</p>
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
      if (!target) main.innerHTML = `${top('The Loop', 'No runs yet')}<div class="panel raised" style="margin-top:34px"><p class="note" style="margin:0 0 18px">Start a run to watch the loop.</p><a class="btn" href="#/new">Start a Run</a></div>`;
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
