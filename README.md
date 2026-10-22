# Apprentice

An agent that builds, tests and ships a model.

Give Apprentice one narrow job and some labelled examples. It scores a small open model on examples held out for the test, has NVIDIA Nemotron teach it from its own mistakes, fine-tunes it with LoRA on Nebius Token Factory, and ships the tuned model only if it beats the original on that same held-out test. Every model call is logged with its tokens, time and cost.

## The loop

1. **Intake.** Split the examples into train, dev and a held-out test set.
2. **Baseline.** Score the small model, and score Nemotron 3 Ultra as the bar to chase.
3. **Teach.** Nemotron 3 Super groups the small model's mistakes into failure types. Nemotron 3 Ultra writes new cases aimed at each one, optionally with real wording found by Tavily. The grader labels every case blind, and only the cases both models agree on are kept.
4. **Train.** A LoRA fine-tune on Token Factory.
5. **Prove.** The tuned model takes the same held-out test.
6. **Ship.** The endpoint is kept only if the tuned model wins.

## Run it

```bash
npm install
npm start            # http://127.0.0.1:8790
npm test
```

With no `NEBIUS_API_KEY` the app runs in **stub mode**: answers are simulated so you can see the whole loop with no key and no cost. Copy `.env.example` to `.env` and add a key to run it for real.

## Guarantees

- Held-out examples never reach teaching or training. The tests check this on every run.
- The eval runs at temperature 0 with a fixed prompt, and labels are parsed strictly, so scores repeat.
- Shipping follows the numbers: the tuned model must get more held-out examples right than the base model.

## Layout

- `packages/nebius-core`: Token Factory client, stub transport, model catalogue and call telemetry.
- `src/server`: the loop, the eval, the teacher and grader, and the HTTP API with live updates.
- `src/web`: the web app.
- `data`: a deterministic support ticket dataset (`npm run data` regenerates it).

## Demo film

Built with Remotion in [`film/`](film), the same way as the Pawzoo film: stills of the running app (`npm run capture`), narrated by the ElevenLabs voice Eric over an ElevenLabs Music bed, ending on an ElevenLabs Sound Effects chime. The lines live in [`film/src/apprentice/script.ts`](film/src/apprentice/script.ts); `npm run voiceover` regenerates them (with `ELEVENLABS_API_KEY` set) and `npm run render` cuts the film, each scene stretched to its line. The current cut is recorded in stub mode, and it says so on screen.

## License

MIT
