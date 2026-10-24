# Results

Live runs on Nebius Token Factory, October 22 to 24, 2026. All scores are on the same 120 held-out sample tickets (`data/support-tickets/test.jsonl`), never used to teach or train, at temperature 0 with the same prompt and strict label reading. Two thirds of the tickets are hard: mixed intents, misleading keywords and Lumen's house routing rules.

## Before teaching

| Model | Where | Right |
|---|---|---|
| Nemotron 3 Ultra | Token Factory | 108/120 (90.0%) |
| Qwen3 30B-A3B Instruct | Token Factory | 105/120 (87.5%) |
| Qwen3 4B | CPU (`harness/eval.py`) | 89/120 (74.2%) |
| Nemotron 3 Nano | Token Factory | 88/120 (73.3%) |
| Qwen3 1.7B | CPU | 72/120 (60.0%) |

## Playbook mode: Nemotron 3 Nano, live end to end on Token Factory

Three full live runs, each reported as it came. In each, Nemotron 3 Super found failure types in Nano's mistakes on the dev split, Nemotron 3 Ultra wrote cases aimed at them, Super labelled every case blind and only agreed cases were kept, and the playbook (house rules plus worked examples) went into Nano's instructions.

| Run | Date (UTC) | Failure types | Cases kept | Base | Taught | Gain | Cost |
|---|---|---|---|---|---|---|---|
| 1 | Oct 22, 22:51 | 5 | 128 of 135 | 88/120 (73.3%) | 99/120 (82.5%) | +11 | $0.053 |
| 2 | Oct 24, 02:41 | 3 | 78 of 88 | 87/120 (72.5%) | 90/120 (75.0%) | +3 | $0.042 |
| 3 | Oct 24, 02:45 | 5 | 123 of 131 | 89/120 (74.2%) | **104/120 (86.7%)** | **+15** | $0.049 |
| **Mean** | | | | **73.3%** | **81.4%** | **+9.7** | |

Nemotron 3 Ultra scores 108/120 (90.0%) at $0.196 per 1,000 tickets. The taught Nano costs $0.028 to $0.039 per 1,000, depending on the playbook's length. In run 3, feedback went from 0 to 14 of 15 and 4 of 5 failure types were fixed.

What drives the spread: how many failure types Super finds in the dev mistakes. Run 2 found 3, so its playbook held 3 rules and 6 examples. Before run 3 we tested one change on the **dev split only** (adding worked examples for every label, not just the failing ones). It scored 60 against 59 of 64 with run 1's artifacts and 56 against 56 with run 2's, so it was not adopted, and run 3 used the same playbook design as runs 1 and 2. The test split was never used to choose the method.

The film shows run 3, with all three runs visible on screen.

## Weights mode: Qwen3 4B, LoRA fine-tune on Token Factory

Training data: the 230 training tickets plus the 128 agreed teacher cases (358 rows), 64 validation rows. LoRA rank 16, alpha 32, 3 epochs, learning rate 1e-4, batch 8, packing on. Job `ftjob-f724b71da587406ba724ce294a0285e8`: 201,723 tokens trained, about $0.081 at $0.40 per 1M tokens. It waited about 11 hours in Token Factory's queue, then trained in under 3 minutes. Validation loss 1.04 after the first epoch, 0.12 after the third.

The adapter was downloaded through the files API and scored on CPU against its own base.

| | Right | Hard tickets |
|---|---|---|
| Qwen3 4B, base | 89/120 (74.2%) | 68.8% |
| **Qwen3 4B + LoRA adapter** | **92/120 (76.7%)** | 67.5% |

By label (of 15): billing 5 to 14, account_access 11 to 14, product_question 7 to 10, shipping 13 to 15; feedback 11 to 4, refund 15 to 12, technical 15 to 12, cancellation 12 to 11.

A small, mixed gain. The likely cause: with packing on, 358 short rows fill about 9 sequences an epoch, so 3 epochs at batch 8 made only 6 optimizer steps (the checkpoints end at step 6). More steps, through a higher learning rate or more epochs, is the obvious next try.

Note for anyone loading the adapter: Token Factory saves its weights as `model.layers.N...lora_A.weight`, without the `base_model.model.` prefix PEFT expects. PEFT then matches nothing and, because the config sets `init_lora_weights: false`, leaves random LoRA weights in place, which produces garbage. `harness/eval.py` renames the keys before loading.

## The $1 challenge: spend

We set ourselves one dollar of Token Factory trial credit for everything. Charged in total: **$0.291**, through the spend guard (hard stop $0.90), $0 on the card.

| Item | Cost |
|---|---|
| Spike: smoke tests, easy-set evals | $0.027 |
| Base evals on the hard set (Nano, Qwen3 30B, Ultra) | $0.027 |
| Playbook runs 1, 2 and 3 | $0.053 + $0.042 + $0.049 |
| Dev check of two playbook designs | $0.011 |
| LoRA fine-tune of Qwen3 4B (201,723 tokens at $0.40 per 1M) | $0.081 |
| CPU scoring of Qwen3 1.7B and 4B, base and tuned | $0 |
| **Total** | **$0.291** |

The ledger holds the fine-tune at its approved quote ($0.12), so it reads $0.330; the job's trained tokens put the real cost at $0.081.
