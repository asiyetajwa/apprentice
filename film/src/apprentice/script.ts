// Apprentice film: scene order, voiceover lines and minimum on-screen time.
// The screens are stills of the real app in stub mode (scripts/capture.mjs). Voiceover: npm run voiceover
// Written for the ear: numbers as words, "Llama three point one, eight B". <break time="0.4s" /> is an ElevenLabs pause tag.

export type SceneId = 'intro' | 'job' | 'baseline' | 'teach' | 'train' | 'prove' | 'receipts' | 'outro';

export type SceneSpec = {
  id: SceneId;
  voiceover: string;
  /** Length in seconds the choreography needs; audio can only extend it. */
  minSeconds: number;
  /** A sound after the line (public/sfx, made with ElevenLabs Sound Effects). */
  after?: { file: string; gap: number; seconds: number; volume: number };
};

export const SCENES: SceneSpec[] = [
  { id: 'intro', voiceover: 'This is Apprentice. An agent that teaches a small open model one job, and then proves it learned.', minSeconds: 4.4 },
  { id: 'job', voiceover: 'Give it a narrow job and some labelled examples. Here, routing support tickets into eight queues. Then press start.', minSeconds: 6.6 },
  { id: 'baseline', voiceover: 'First, it tests Llama three point one, eight B, on a hundred and twenty tickets it will never train on. It gets seventy-three percent. Nemotron 3 Ultra takes the same test, and sets the bar to chase.', minSeconds: 7.0 },
  { id: 'teach', voiceover: "Next, Nemotron 3 Super sorts the small model's mistakes into failure types. Nemotron 3 Ultra writes new cases aimed at each one, and the grader labels every case blind. Only the cases they agree on are kept.", minSeconds: 7.6 },
  { id: 'train', voiceover: 'Then it fine-tunes the small model with LoRA, on Nebius Token Factory, and you can watch the loss fall.', minSeconds: 5.6 },
  { id: 'prove', voiceover: 'Now, the same held-out test. Eighty-nine percent, up from seventy-three. Apprentice ships the model only because it won.', minSeconds: 7.4 },
  { id: 'receipts', voiceover: 'And every call comes with a receipt. The tuned model answers a thousand tickets for under half a cent, against about twenty-one cents for Nemotron Ultra.', minSeconds: 7.0 },
  { id: 'outro', voiceover: 'Apprentice. <break time="0.4s" /> Test it, teach it, prove it, then ship it.', minSeconds: 5.4, after: { file: 'sfx/chime.mp3', gap: 0.3, seconds: 1.4, volume: 0.35 } },
];
