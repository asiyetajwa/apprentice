import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';
import { BlurText, Camera, clamp, Cursor, easeOut, popAt, track, type CamKey, type CursorKey } from '../components/motion';
import boxesJson from '../../public/app/boxes.json';

type SceneProps = { duration: number };
type Box = { x: number; y: number; w: number; h: number };
const boxes = boxesJson as unknown as Record<string, Box> & { sizes: Record<string, { w: number; h: number }> };
const B = (key: string): Box => {
  const b = boxes[key];
  if (!b) throw new Error(`No box ${key}`);
  return b;
};
const center = (key: string): [number, number] => {
  const b = B(key);
  return [b.x + b.w / 2, b.y + b.h / 2];
};

/* ------------------------------------------------------------ the browser window */

// Captures are 1600 css px wide and as tall as their page; the window shows a 1600 x 1000 viewport of them,
// 1400 world units wide, and scrolls by sliding the capture up.
const CAP_W = 1600;
const VIEW_H = 1000;
const WIN = { w: 1400, bar: 46 };
const S = WIN.w / CAP_W;
const winH = VIEW_H * S + WIN.bar;
/** World position of a point on a capture (css px) while the window is scrolled to `scroll`. */
const w = (x: number, y: number, scroll = 0) => ({ x: -WIN.w / 2 + x * S, y: -winH / 2 + WIN.bar + (y - scroll) * S });
const maxScroll = (src: string) => Math.max(0, (boxes.sizes[src]?.h ?? VIEW_H) - VIEW_H);

type State = { src: string; at: number; scroll?: [number, number][] };

const Window: React.FC<{ states: State[] }> = ({ states }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        left: -WIN.w / 2,
        top: -winH / 2,
        width: WIN.w,
        height: winH,
        borderRadius: 22,
        overflow: 'hidden',
        background: theme.bg,
        boxShadow: '0 60px 120px rgba(60,60,50,0.24), 0 12px 32px rgba(60,60,50,0.12)',
      }}
    >
      <div style={{ height: WIN.bar, background: '#f1f1ef', borderBottom: '1px solid #dcdcd9', display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
        ))}
        <div style={{ margin: '0 auto', padding: '6px 80px', borderRadius: 9, background: '#fafaf8', border: '1px solid #dcdcd9', color: theme.muted, fontFamily: theme.font, fontSize: 15, fontWeight: 500 }}>
          127.0.0.1:8790  ·  Apprentice
        </div>
      </div>
      <div style={{ position: 'relative', width: WIN.w, height: VIEW_H * S, overflow: 'hidden' }}>
        {states.map((s, i) => {
          const next = states[i + 1];
          const opacity = i === 0 ? 1 : interpolate(frame, [s.at, s.at + 12], [0, 1], { ...clamp, easing: easeOut });
          if (frame < s.at - 1 || (next && frame >= next.at + 14)) return null;
          const keys = s.scroll ?? [[0, 0]];
          const y = track(frame, keys.map((k) => k[0]), keys.map((k) => k[1]));
          const h = (boxes.sizes[s.src]?.h ?? VIEW_H) * S;
          return (
            <Img
              key={s.src}
              src={staticFile(`app/${s.src}.png`)}
              style={{ position: 'absolute', left: 0, top: -y * S, width: WIN.w, height: h, opacity }}
            />
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ camera helpers */

const WIDE = (f: number): CamKey => ({ f, x: 0, y: 0, z: 1.0 });
/** Camera key that frames a box of a capture as close as fits, above the caption pill. */
const read = (f: number, b: Box, scroll = 0, zmax = 1.9, drift = 0): CamKey => {
  const top = 50;
  const bottom = 1080 - 170;
  const z = Math.min(zmax, (bottom - top) / ((b.h + 60) * S), (1920 * 0.9) / ((b.w + 100) * S)) + drift;
  const lift = (1080 / 2 - (top + bottom) / 2) / (z * S);
  return { f, ...w(b.x + b.w / 2, b.y + b.h / 2 + lift, scroll), z };
};
const readKey = (f: number, key: string, scroll = 0, zmax = 1.9, drift = 0) => read(f, B(key), scroll, zmax, drift);
/** The top `h` css px of a box (the newest lines of the agent's feed). */
const topOf = (key: string, h: number): Box => ({ ...B(key), h });
const cur = (f: number, x: number, y: number, scroll = 0, click = false): CursorKey => ({ f, ...w(x, y, scroll), click });
const clickOn = (f: number, key: string, scroll = 0): CursorKey => cur(f, ...center(key), scroll, true);

/** Dark caption pill under the action, with a Saffron dot, for the point the line makes. */
const Callout: React.FC<{ text: string; at: number; outAt: number }> = ({ text, at: start, outAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = popAt(frame, fps, start, 15);
  const out = interpolate(frame, [outAt, outAt + 14], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 60, pointerEvents: 'none' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 32px 16px 24px',
          borderRadius: 999,
          background: theme.ink,
          color: '#fafaf8',
          fontFamily: theme.font,
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          opacity: p * (1 - out),
          transform: `translateY(${String((1 - p) * 24 + out * 12)}px)`,
          boxShadow: '0 20px 50px rgba(40,40,30,0.28)',
        }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 999, background: theme.lit, boxShadow: `0 0 0 6px rgba(232,164,0,0.22)` }} />
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Logo: React.FC<{ size: number }> = ({ size }) => <Img src={staticFile('logo.svg')} style={{ width: size, height: size, display: 'block' }} />;

/* ------------------------------------------------------------ scenes */

export const IntroScene: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = popAt(frame, fps, 4, 13);
  const zoom = interpolate(frame, [0, duration], [1.04, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${String(zoom)})` }}>
      <div style={{ transform: `scale(${String(0.6 + p * 0.4)})`, opacity: p, marginBottom: 38 }}>
        <Logo size={132} />
      </div>
      <BlurText text="Apprentice" at={12} outAt={duration - 18} style={{ fontFamily: theme.font, fontSize: 150, fontWeight: 800, letterSpacing: '-0.045em', color: theme.text, lineHeight: 1 }} />
      <div style={{ height: 28 }} />
      <BlurText text="Teach a small model one job" at={34} outAt={duration - 16} style={{ fontFamily: theme.font, fontSize: 46, fontWeight: 400, color: theme.muted }} />
    </AbsoluteFill>
  );
};

export const JobScene: React.FC<SceneProps> = ({ duration }) => {
  const down = maxScroll('new');
  const scrollStart = 250;
  const scrollEnd = 310;
  const click = 372;
  // Close on the Go panel with the page filling the frame: the Start button sits in the lower third.
  const goCam = (f: number, z: number): CamKey => ({ f, ...w(1100, 964, down), z });
  const cam: CamKey[] = [WIDE(0), WIDE(30), readKey(110, 'new:job', 0, 1.45), readKey(scrollStart, 'new:job', 0, 1.45, 0.03), goCam(scrollEnd + 10, 1.8), goCam(duration, 1.85)];
  const cursor: CursorKey[] = [cur(scrollEnd, 1000, 1240, down), cur(click - 14, ...center('new:start'), down), clickOn(click, 'new:start', down), cur(click + 40, 1100, 1260, down)];
  return (
    <>
      <Camera keys={cam}>
        <Window states={[{ src: 'new', at: 0, scroll: [[scrollStart, 0], [scrollEnd, down]] }]} />
        <Cursor keys={cursor} visibleFrom={scrollEnd} visibleTo={duration} />
      </Camera>
      <Callout text="Your job, your labelled examples" at={130} outAt={scrollStart + 30} />
    </>
  );
};

export const BaselineScene: React.FC<SceneProps> = ({ duration }) => {
  const feedAt = 420;
  // The page scrolls with the camera, so the feed is read mid-window rather than at its bottom edge.
  const down = 260;
  const cam: CamKey[] = [WIDE(0), WIDE(20), readKey(90, 'loop-baseline:stages', 0, 1.5), readKey(feedAt - 30, 'loop-baseline:stages', 0, 1.5, 0.03), read(feedAt + 30, topOf('loop-baseline:feed', 300), down, 1.75), read(duration, topOf('loop-baseline:feed', 300), down, 1.75, 0.05)];
  return (
    <>
      <Camera keys={cam}>
        <Window states={[{ src: 'loop-baseline', at: 0, scroll: [[feedAt - 30, 0], [feedAt + 30, down]] }]} />
      </Camera>
      <Callout text="120 tickets held out, never trained on" at={110} outAt={feedAt - 20} />
      <Callout text="Nano 74%. The bar: Nemotron 3 Ultra at 90%" at={feedAt + 60} outAt={duration - 20} />
    </>
  );
};

export const TeachScene: React.FC<SceneProps> = ({ duration }) => {
  const feedAt = 160;
  const down = 300;
  const cam: CamKey[] = [readKey(0, 'loop-teach:stages', 0, 1.5), readKey(feedAt - 40, 'loop-teach:stages', 0, 1.5, 0.03), read(feedAt + 40, topOf('loop-teach:feed', 420), down, 1.6), read(duration, topOf('loop-teach:feed', 420), down, 1.6, 0.06)];
  return (
    <>
      <Camera keys={cam}>
        <Window states={[{ src: 'loop-teach', at: 0, scroll: [[feedAt - 40, 0], [feedAt + 40, down]] }]} />
      </Camera>
      <Callout text="Five failure types, found in its mistakes" at={feedAt + 70} outAt={560} />
      <Callout text="Kept only where both agree: 123 of 131" at={590} outAt={duration - 20} />
    </>
  );
};

export const TrainScene: React.FC<SceneProps> = ({ duration }) => {
  const cam: CamKey[] = [readKey(0, 'loop-prove:stages', 0, 1.5), readKey(60, 'loop-prove:stages', 0, 1.5), readKey(150, 'loop-prove:loss', 0, 1.9), readKey(duration, 'loop-prove:loss', 0, 1.9, 0.08)];
  return (
    <>
      <Camera keys={cam}>
        <Window states={[{ src: 'loop-prove', at: 0 }]} />
      </Camera>
      <Callout text="A playbook, served per token on Token Factory" at={170} outAt={duration - 20} />
    </>
  );
};

export const ProveScene: React.FC<SceneProps> = ({ duration }) => {
  const done = 40;
  const click = 104;
  const results = click + 8;
  const hero: Box = { ...B('results:dials'), w: 1068 };
  const cam: CamKey[] = [readKey(0, 'loop-prove:stages', 0, 1.5), readKey(done, 'loop-prove:stages', 0, 1.5), readKey(done + 40, 'loop-done:done', 0, 1.45), readKey(click + 6, 'loop-done:done', 0, 1.45), read(results + 40, hero, 0, 1.4), read(duration, hero, 0, 1.4, 0.05)];
  const cursor: CursorKey[] = [cur(done + 20, 1000, 640), cur(click - 12, ...center('loop-done:results')), clickOn(click, 'loop-done:results'), cur(click + 40, 1100, 700)];
  return (
    <>
      <Camera keys={cam}>
        <Window states={[{ src: 'loop-prove', at: 0 }, { src: 'loop-done', at: done }, { src: 'results', at: results }]} />
        <Cursor keys={cursor} visibleFrom={done + 20} visibleTo={click + 50} />
      </Camera>
      <Callout text="Ships only if it wins" at={270} outAt={duration - 20} />
    </>
  );
};

export const ReceiptsScene: React.FC<SceneProps> = ({ duration }) => {
  // Cuts follow the line: costs at "under four cents" (about 1.9 s), the runs at "every run is kept" (about 8.2 s).
  const swap = 120;
  const runsAt = 480;
  const down = maxScroll('results');
  const cam: CamKey[] = [
    WIDE(0),
    readKey(50, 'calls:costs', 0, 1.35),
    read(swap - 20, { ...B('calls:costs'), h: 420 }, 0, 1.35),
    read(swap + 50, B('results:nums'), 0, 1.75),
    read(runsAt - 20, B('results:nums'), 0, 1.75, 0.04),
    // The runs list sits at the foot of the page: frame it so the page still fills the screen below it.
    { f: runsAt + 50, ...w(860, 2010, down), z: 1.35 },
    { f: duration, ...w(860, 2010, down), z: 1.4 },
  ];
  return (
    <>
      <Camera keys={cam}>
        <Window states={[{ src: 'calls', at: 0 }, { src: 'results', at: swap, scroll: [[runsAt - 20, 0], [runsAt + 40, down]] }]} />
      </Camera>
      <Callout text="Every call, with its receipt" at={30} outAt={swap - 10} />
      <Callout text="$0.037 per 1,000 tickets, against $0.196" at={swap + 70} outAt={runsAt - 30} />
    </>
  );
};

/** The $1 challenge: what everything cost, set as one big two-tone number against the dollar. */
export const BudgetScene: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = popAt(frame, fps, 8, 14);
  const fill = interpolate(frame, [40, 160], [0, 0.29], { ...clamp, easing: easeOut });
  const rows: Array<[string, string]> = [
    ['Three live runs, Nemotron teaching Nano', '$0.14'],
    ['LoRA fine-tune, Qwen3 4B', '$0.08'],
    ['Base tests and checks', '$0.07'],
  ];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: theme.font, color: theme.text }}>
      <div style={{ opacity: p, transform: `translateY(${String((1 - p) * 20)}px)`, textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: theme.faint }}>The challenge: one dollar</div>
        <div style={{ fontSize: 210, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1.05, marginTop: 10 }}>
          <span style={{ color: '#a2a29f' }}>$0.</span>
          {String(Math.round(fill * 100)).padStart(2, '0')}
          <span style={{ fontSize: 70, color: theme.faint, letterSpacing: '-0.02em' }}> of $1.00</span>
        </div>
        <div style={{ width: 900, height: 22, borderRadius: 11, margin: '26px auto 0', background: '#dededb', boxShadow: 'inset 4px 4px 9px rgba(0,0,0,0.13), inset -4px -4px 9px rgba(255,255,255,0.85)' }}>
          <div style={{ width: `${String(fill * 100)}%`, height: '100%', borderRadius: 11, background: `linear-gradient(90deg, ${theme.litLight}, ${theme.lit})` }} />
        </div>
        <div style={{ display: 'grid', gap: 12, marginTop: 44, width: 900, marginLeft: 'auto', marginRight: 'auto' }}>
          {rows.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 34, opacity: interpolate(frame, [90 + i * 30, 110 + i * 30], [0, 1], clamp), color: theme.muted }}>
              <span>{k}</span>
              <b style={{ color: theme.text }}>{v}</b>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 30, fontSize: 22, color: theme.faint, opacity: interpolate(frame, [duration - 120, duration - 90], [0, 1], clamp) }}>Every paid call went through a spend guard with a hard stop. $0 on the card.</div>
      </div>
    </AbsoluteFill>
  );
};

export const OutroScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = popAt(frame, fps, 2, 13);
  const words = ['Test.', 'Teach.', 'Prove.', 'Ship.'];
  // Each word lands as it is said, after the pause on "Apprentice" (frames at 60 fps, from the outro take).
  const wordAt = [71, 102, 130, 160];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: theme.font, color: theme.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: p, transform: `translateY(${String((1 - p) * 20)}px)` }}>
        <Logo size={100} />
        <span style={{ fontSize: 112, fontWeight: 800, letterSpacing: '-0.045em' }}>Apprentice</span>
      </div>
      <div style={{ display: 'flex', gap: 30, marginTop: 44 }}>
        {words.map((t, i) => (
          <BlurText key={t} text={t} at={wordAt[i] ?? 0} style={{ fontSize: 54, fontWeight: 700, letterSpacing: '-0.02em', color: i === 3 ? theme.litText : theme.text }} />
        ))}
      </div>
      <div style={{ marginTop: 56, opacity: interpolate(frame, [250, 280], [0, 1], clamp), fontSize: 24, color: theme.muted, letterSpacing: '0.02em' }}>
        NVIDIA Nemotron 3 Ultra and Super  ·  Nebius Token Factory  ·  LoRA fine-tuning  ·  Llama 3.1 8B
      </div>
      <div style={{ position: 'absolute', bottom: 40, opacity: interpolate(frame, [270, 300], [0, 1], clamp), fontSize: 18, color: theme.muted }}>
        Recorded live on Nebius Token Factory, October 24, 2026. Every run, including the weaker ones: docs/RESULTS.md.
      </div>
    </AbsoluteFill>
  );
};
