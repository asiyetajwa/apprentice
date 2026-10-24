# Qwen3 4B LoRA adapter: Lumen support ticket routing

Trained by Apprentice on Nebius Token Factory (job `ftjob-f724b71da587406ba724ce294a0285e8`, October 23, 2026) on 358 rows: the sample's 230 training tickets plus 128 cases written by NVIDIA Nemotron 3 Ultra and checked blind by Nemotron 3 Super. LoRA rank 16, alpha 32, 3 epochs, learning rate 1e-4.

On the 120 held-out tickets: base Qwen3 4B 89/120 (74.2%), with this adapter 92/120 (76.7%). Full results: `docs/RESULTS.md` on `main`.

The weight names here carry the `base_model.model.` prefix, so it loads directly:

```python
from transformers import AutoModelForCausalLM
from peft import PeftModel
model = PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained("Qwen/Qwen3-4B"), "qwen3-4b-lumen-tickets")
```

Use the same instructions as `studentMessages` in `src/server/task.ts`, with thinking off.

MIT license, like the rest of Apprentice. The base model's own license (Apache 2.0) applies to Qwen3 4B.
