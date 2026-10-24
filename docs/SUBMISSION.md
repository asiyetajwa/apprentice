# Devpost Submission Draft

Copy each section into the Devpost form. Hackathon: Nebius x NVIDIA. Deadline: Thursday 30 October 2026, 10:00 PDT (20:00 EAT). Track: **Coding and Agentic Engineering**.

## Links

- **Demo video (YouTube, 1:31):** to add once uploaded (file: `film/out/ApprenticeLandscape.mp4`, rendered from the repo)
- **Repository (public, MIT license):** https://github.com/asiyetajwa/apprentice
- **Trained adapter (Qwen3 4B LoRA):** GitHub release `adapter-qwen3-4b-v1` on the repository
- **Thumbnail:** `docs/thumbnail.jpg` (3:2) in the repo; `docs/thumbnail-youtube.jpg` (16:9) for YouTube
- **Results and every run, including the weaker ones:** `docs/RESULTS.md`

Music and sound in the film were generated with ElevenLabs (Music and Sound Effects) on Brian's ElevenLabs account; the narration is the ElevenLabs voice Eric.

## Project name

Apprentice

## Tagline

An agent that teaches a small model one job, proves it on tickets it never saw, and ships it only if it wins. On a $1 budget.

## Built with

TypeScript, Node.js, Express, Nebius Token Factory, NVIDIA Nemotron 3 Ultra, NVIDIA Nemotron 3 Super, NVIDIA Nemotron 3 Nano, Qwen3, LoRA, Python, PyTorch, Hugging Face Transformers, PEFT, Remotion, Playwright, ElevenLabs

## Description

### Inspiration

Most of what teams ask a large model to do every day is one narrow job: route a ticket, tag a document, pick a category. Frontier models do these jobs well and cost a lot at volume; small models are cheap and miss. Closing that gap by hand means writing training data, fine-tuning, and hoping it helped. We wanted an agent that does the whole job and proves the result, and we wanted to show it can be done on almost no money.

### Our challenge: $1

We set ourselves one dollar of Nebius Token Factory credit for everything: three full live teaching runs, a LoRA fine-tune, and every test. The total came to **$0.29**. Every paid call went through a spend guard with a hard stop, and nothing was charged to a card.

### What it does

Give Apprentice a narrow job and labelled examples. It runs a six-stage loop, live on Token Factory, that you can watch:

1. **Intake** splits the examples into train, dev and a held-out test.
2. **Baseline** scores the small model, NVIDIA Nemotron 3 Nano, on the held-out test, and scores Nemotron 3 Ultra on the same test as the bar to chase.
3. **Teach**: Nemotron 3 Super groups Nano's mistakes into failure types. Nemotron 3 Ultra writes new cases aimed at each one. Super labels every case blind, and only the cases both agree on are kept.
4. **Train** writes a playbook (house rules and worked examples) into Nano's instructions, or runs a LoRA fine-tune on Token Factory.
5. **Prove** runs the same held-out test again.
6. **Ship** happens only if the taught model gets more tickets right than the base.

Every call is shown with its tokens, time and cost.

**Results on 120 held-out support tickets** (two thirds of them hard: mixed intents, misleading keywords, house routing rules):

- **Nemotron 3 Nano went from 74% to 87%** in our best live run, four tickets short of Nemotron 3 Ultra's 90%, at **$0.037 per 1,000 tickets against Ultra's $0.196**.
- Across three live runs it gained 11, 3 and 15 tickets (73% to 81% on average). We show all three in the app, the film and the results, including the weak one.
- In weights mode, a LoRA fine-tune of Qwen3 4B on Token Factory took it from 74.2% to 76.7%. The adapter is published.

### How we built it

- **A shared Token Factory core** (`packages/nebius-core`): an OpenAI-compatible client for chat, files, fine-tuning jobs and downloads; call telemetry; a stub transport so the whole app runs offline; and a spend guard.
- **The spend guard** prices every call from Token Factory's own model list, reserves the worst case before sending, writes the real cost from the returned usage to a ledger, and halts on any billing error. It refuses fine-tuning without an approved quote and refuses dedicated endpoints.
- **The loop** (`src/server`): a deterministic eval harness (temperature 0, fixed prompt, strict label reading) and teaching through Nemotron. Every run's prompts, cases, evals and calls are saved, so it can be audited. The web app streams progress live over server-sent events.
- **Weights mode**: training files built from the agreed teacher cases, a guarded LoRA job on Token Factory, the adapter downloaded through the files API, and a CPU harness (PyTorch, Transformers, PEFT) that scores base and tuned with the app's exact prompt.
- **A deterministic dataset**: 414 support tickets for a fictional notes app, eight queues, with test wording that never appears in training.

### Challenges we ran into

- **The planned student was not served per token.** Llama 3.1 8B is tunable on Token Factory but not served per token, so we switched students on day one.
- **No way to test a fine-tune on the platform.** Fine-tuned models are served only on dedicated endpoints, which bill by the hour. That led to playbook mode, where the live specialist is a served model with taught instructions, and to downloading the adapter and testing it on CPU.
- **Reasoning ate short answers.** With thinking on, Nemotron 3 Super spent a 300-token allowance and returned nothing. Turning thinking off gave 2-token answers.
- **An 11-hour queue** for the fine-tune, with no signal, then 3 minutes of training.
- **Downloaded adapters loaded as garbage.** The weight names lack the prefix PEFT expects, so PEFT silently kept random weights and the model scored 0 of 120. We found it and fixed it in the harness.
- **Run-to-run spread.** Teaching depends on which failure types the grader finds. We report every run. We also tested one method change on the dev split only, and kept the test split for final scores.

### Accomplishments that we're proud of

- A taught NVIDIA Nemotron 3 Nano that gets within four tickets of Nemotron 3 Ultra at a fifth of the cost, proven on held-out tickets.
- The whole thing, three live runs and a fine-tune included, for 29 cents of a one-dollar budget, with spending capped in code.
- Honest numbers: every run reported, held-out data guarded by tests, and the method chosen on the dev split.

### What we learned

Teaching through instructions is fast, cheap and servable today: a whole run takes about a minute and five cents. A LoRA fine-tune needs enough optimizer steps to matter; with packing, a small dataset makes very few. And the grader's view of the mistakes drives the result more than anything else.

### What's next for Apprentice

- Fine-tune Nemotron Nano directly once Token Factory supports it, and serve LoRA adapters per token.
- Tavily-grounded teaching cases, using real customer wording from the web.
- More optimizer steps for weights mode, chosen on the dev split.
- Jobs beyond classification: extraction and short-form answers, scored the same way.

## Product feedback (Token Factory and NVIDIA tools)

See `docs/FRICTION_LOG.md`. In short:

- **What helped:** the verbose model list with live prices; per-token Nemotron at prices that make a whole teaching run cost five cents; checkpoint downloads through the files API.
- **What would help most:**
  - per-token serving of LoRA adapters;
  - fine-tuning prices in the API;
  - a "queued" status with an ETA;
  - adapter weights saved with PEFT's standard prefix;
  - documenting `enable_thinking` for Nemotron;
  - structured outputs for Nemotron;
  - a per-project spending cap.
