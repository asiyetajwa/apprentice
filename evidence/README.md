# Evidence

The saved records of every live run behind `docs/RESULTS.md`, so each number can be checked.

- `run-001`, `run-002`, `run-003`: the three playbook runs on Nebius Token Factory. Each holds the run state (`run.json`), the event feed, every model call with tokens, time and cost (`calls.jsonl`), the failure types, the teacher's cases (kept and rejected), the playbook, the specialist's instructions, and the base, reference and taught evals with every prediction.
- `base-evals`: the base scores of Nemotron 3 Nano, Qwen3 30B and Nemotron 3 Ultra on the held-out tickets.
- `weights`: the LoRA fine-tune job and its checkpoints from Token Factory, and the CPU scores of Qwen3 1.7B, Qwen3 4B and Qwen3 4B with the adapter.
