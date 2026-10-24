// Apprentice film: scene order, voiceover lines and minimum on-screen time.
// The screens are stills of the real app during a live run on Nebius Token Factory (scripts/capture.mjs, run 3 of
// three, October 24, 2026). Voiceover: npm run voiceover
// Written for the ear: numbers as words. <break time="0.4s" /> is an ElevenLabs pause tag.

export type SceneId = 'intro' | 'job' | 'baseline' | 'teach' | 'train' | 'prove' | 'receipts' | 'budget' | 'outro';

export type SceneSpec = {
  id: SceneId;
  voiceover: string;
  /** Length in seconds the choreography needs; audio can only extend it. */
  minSeconds: number;
  /** A sound after the line (public/sfx, made with ElevenLabs Sound Effects). */
  after?: { file: string; gap: number; seconds: number; volume: number };
};

export const SCENES: SceneSpec[] = [
  { id: 'intro', voiceover: 'This is Apprentice. An agent that teaches a small open model one job, and proves it learned.', minSeconds: 4.4 },
  { id: 'job', voiceover: 'Give it a narrow job and some labelled examples. Here, routing tricky support tickets into eight queues. Then press start.', minSeconds: 6.6 },
  { id: 'baseline', voiceover: 'First, it tests NVIDIA Nemotron 3 Nano on a hundred and twenty tickets it never learns from. Seventy-four percent. Nemotron 3 Ultra takes the same test, and sets the bar at ninety.', minSeconds: 7.0 },
  { id: 'teach', voiceover: "Next, Nemotron 3 Super sorts Nano's mistakes into failure types. Ultra writes new cases aimed at each one, and the grader labels every case blind. Only the cases they agree on are kept.", minSeconds: 7.6 },
  { id: 'train', voiceover: "Then Apprentice writes a playbook: house rules and worked examples, straight into Nano's instructions. Nothing to deploy. It runs per token on Nebius Token Factory.", minSeconds: 6.0 },
  { id: 'prove', voiceover: 'Now, the same held-out test. Eighty-seven percent, up from seventy-four, and four tickets short of Ultra. It ships only because it won.', minSeconds: 7.4 },
  { id: 'receipts', voiceover: 'Every call comes with a receipt. The taught Nano answers a thousand tickets for under four cents, against twenty cents for Ultra. And every run is kept: across three live runs, it gained eleven, three and fifteen tickets.', minSeconds: 9.0 },
  { id: 'budget', voiceover: 'Our challenge was to prove all of it on one dollar of credit. Three live runs, a LoRA fine-tune of Qwen3 4B, and every test: twenty-nine cents.', minSeconds: 6.4 },
  { id: 'outro', voiceover: 'Apprentice. <break time="0.4s" /> Test it, teach it, prove it, then ship it.', minSeconds: 5.4, after: { file: 'sfx/chime.mp3', gap: 0.3, seconds: 1.4, volume: 0.35 } },
];
