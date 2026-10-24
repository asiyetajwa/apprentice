# Results

Live runs on Nebius Token Factory, October 22 and 23, 2026. All scores are on the same 120 held-out sample tickets (`data/support-tickets/test.jsonl`), never used to teach or train, at temperature 0 with the same prompt and strict label reading. Two thirds of the tickets are hard: mixed intents, misleading keywords and Lumen's house routing rules.

## Before teaching

| Model | Where | Right |
|---|---|---|
| Nemotron 3 Ultra | Token Factory | 108/120 (90.0%) |
| Qwen3 30B-A3B Instruct | Token Factory | 105/120 (87.5%) |
| Qwen3 4B | CPU (`harness/eval.py`) | 89/120 (74.2%) |
| Nemotron 3 Nano | Token Factory | 88/120 (73.3%) |
| Qwen3 1.7B | CPU | 72/120 (60.0%) |

## Playbook mode: Nemotron 3 Nano, live end to end on Token Factory

One run (run-001), 64 seconds, $0.053 in model calls. Nemotron 3 Super found 5 failure types in Nano's mistakes on the dev split; Nemotron 3 Ultra wrote 135 cases and Super agreed with 128 of them, labelling blind; the playbook (5 house rules, 10 worked examples) went into Nano's instructions.

| | Right | Cost per 1,000 tickets |
|---|---|---|
| Nemotron 3 Nano, base | 88/120 (73.3%) | $0.012 |
| **Nemotron 3 Nano, taught** | **99/120 (82.5%)** | **$0.039** |
| Nemotron 3 Ultra | 108/120 (90.0%) | $0.196 |

Feedback went from 0 to 7 of 15 and shipping from 13 to 15. The run is reported as it came; the playbook was not adjusted against the test tickets.

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

## Spend

$0.188 charged in total, from the trial credit, through the spend guard (hard stop $0.90): spike $0.027, base evals on the hard set $0.027, the playbook run $0.053, fine-tune about $0.081. $0 on the card.
