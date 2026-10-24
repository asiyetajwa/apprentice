# Apprentice

An agent that teaches a small open model one job, proves it learned on examples it never saw, and ships it only if it wins.

Give Apprentice a narrow job and some labelled examples. It tests a small model, has NVIDIA Nemotron teach it from its own mistakes, and checks the result on the same held-out test. Everything runs on Nebius Token Factory, and every model call comes with a receipt: tokens, time and cost.

**Our challenge: prove it all on $1 of credit.** Three live teaching runs, a LoRA fine-tune of Qwen3 4B and every test cost **$0.29** in total. See [`docs/RESULTS.md`](docs/RESULTS.md).

## Results, live on Nebius Token Factory

On 120 held-out support tickets (two thirds of them hard: mixed intents, misleading keywords, house routing rules):

| | Right | Cost per 1,000 tickets |
|---|---|---|
| NVIDIA Nemotron 3 Nano, base | 74% (89/120) | $0.012 |
| **Nemotron 3 Nano, taught by Apprentice (run 3)** | **87% (104/120)** | **$0.037** |
| Nemotron 3 Ultra, the bar | 90% (108/120) | $0.196 |

The taught Nano gets within four tickets of Ultra at a fifth of the cost. Across three live runs it gained 11, 3 and 15 tickets (73% to 81% on average); every run shipped because every run beat its base. All three are in the results, including the weak one.

## The loop

1. **Intake.** Split the examples into train, dev and a held-out test.
2. **Baseline.** Score the small model, and score Nemotron 3 Ultra on the same test as the bar to chase.
3. **Teach.** Nemotron 3 Super groups the small model's mistakes on the dev split into failure types. Nemotron 3 Ultra writes new cases aimed at each one. Super labels every case blind, and only the cases both models agree on are kept. No case may copy a held-out ticket.
4. **Train**, one of two ways:
   - **Playbook** (the default when live): the failure types become house rules, and agreed cases become worked examples, in the student's instructions. The specialist is Nemotron 3 Nano with its playbook, served per token on Token Factory. Nothing to deploy.
   - **Weights**: a LoRA fine-tune on Token Factory (`scripts/weights-*.ts`), the adapter downloaded and scored with `harness/eval.py`. Token Factory serves fine-tuned models only on dedicated endpoints, so this path ships the adapter, not an endpoint.
5. **Prove.** The taught model takes the same held-out test.
6. **Ship.** Only if it gets more held-out tickets right than the base model.

## How it uses Nebius and NVIDIA

- **Token Factory, per token**: every chat call (student, teacher, grader), the fine-tuning job, file upload and adapter download. Prices come from Token Factory's own model list at run time.
- **NVIDIA Nemotron 3 Ultra** writes the teaching cases and sets the bar; **Nemotron 3 Super** finds the failure types and grades blind; **Nemotron 3 Nano** is the shipped specialist. Nemotron models are asked with thinking off for short answers, and the JSON schema goes in the prompt because Token Factory lists no structured outputs for them.
- **Qwen3 4B** is the weights-mode student: LoRA-tunable on Token Factory at $0.40 per 1M tokens.
- **Tavily** (optional): with `TAVILY_API_KEY` set, the teacher gets real wording found on the web. Our runs had no key, so the results above do not use it.

## Cost model and the spend guard

Every paid call goes through a spend guard in `packages/nebius-core`. It prices each call from Token Factory's published prices, reserves its worst case (input estimate plus the full output allowance) before sending it, writes the real cost from the returned usage to a ledger, and refuses anything that would pass `APPRENTICE_BUDGET_USD`. A billing or balance error halts every later call. Fine-tuning needs an approved quote (`APPRENTICE_FINETUNE_QUOTE_USD`), and deploying to a dedicated endpoint is refused, because it bills by the hour.

A full live playbook run costs about $0.05: about $0.025 is the Ultra reference test, the rest is teaching and testing the student.

## Run it

```bash
npm install
npm start            # http://127.0.0.1:8790
npm test             # 8 tests, no key needed
```

Without `NEBIUS_API_KEY` the app runs in **stub mode**: simulated answers, so you can see the whole loop with no key and no cost. Copy `.env.example` to `.env`, add a key and a budget, and it runs live.

Weights mode:

```bash
npx tsx scripts/weights-data.ts run-001                                  # training files from a run's agreed cases
APPRENTICE_FINETUNE_QUOTE_USD=0.12 npx tsx scripts/weights-train.ts Qwen/Qwen3-4B
python3 -m venv .venv && .venv/bin/pip install -r harness/requirements.txt
.venv/bin/python harness/eval.py --model <Qwen3-4B dir> --adapter runs/weights/adapter --out runs/cpu/tuned.json
```

The trained adapter is published as a GitHub release (`adapter-qwen3-4b-v1`).

## Guarantees

- Held-out tickets never reach teaching, the playbook or training. The tests check this on every run.
- Every eval runs at temperature 0 with a fixed prompt and strict label reading, so a score is repeatable and base and taught are compared on equal terms.
- Shipping follows the numbers.
- Spending is capped in code.

## Layout

- `packages/nebius-core`: Token Factory client, spend guard, stub transport, model catalogue and call telemetry.
- `src/server`: the loop, the eval, the teacher and grader, and the HTTP API with live updates.
- `src/web`: the web app. `npm run demo` builds a browser-only replay of a recorded live run.
- `harness`: CPU scoring for a base model or a LoRA adapter, with the app's exact prompt.
- `scripts`: smoke test, live evals, weights mode.
- `data`: the deterministic support ticket dataset (`npm run data` regenerates it).
- `docs`: results, friction log, Devpost text, video script, thumbnails.

## Demo film

Built with Remotion in [`film/`](film), from stills of the app during live run 3 (`npm run capture`), narrated by the ElevenLabs voice Eric over an ElevenLabs Music bed. `npm run voiceover` regenerates the lines (with `ELEVENLABS_API_KEY` set) and `npm run render` cuts the film.

## License

MIT
