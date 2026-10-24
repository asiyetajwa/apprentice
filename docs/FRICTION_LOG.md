# Friction Log and Product Feedback

What building Apprentice on Nebius Token Factory and NVIDIA Nemotron was like, October 22 to 24, 2026. Each entry: what happened, what it cost us, and what would fix it.

## Nebius Token Factory

**1. The model list is excellent.** `GET /v1/models?verbose=true` returns every model's per-token price, context length and features. Our spend guard prices every call from it at run time, so our cost numbers are Token Factory's own, not a hard-coded table. This is the best thing about the platform for anyone building on a budget.

**2. Tunable models and served models are different lists.** Llama 3.1 8B, our first choice of student, is on the fine-tuning list but not served per token, so we could not even score its base. We found out from the live model list, after building around it. A single table of "tunable and served per token" would save a day.

**3. A fine-tuned model can only be served from a dedicated endpoint.** For a hackathon on trial credit, an hourly endpoint is out of reach, so we could not test a tuned model on Token Factory at all. We downloaded the adapter and scored it on CPU instead, and made the playbook path (taught instructions on a served model) our live specialist. Per-token serving of LoRA adapters on their base model would close the loop on the platform.

**4. No fine-tuning price in the docs or the API.** The price ($0.40 per 1M tokens for Qwen3 4B and smaller, $2.80 for Qwen3 30B) is visible only in the console's create-job form. Our rule was "no job without a quote", so a person had to open the console and read it out. A price field on the tunable-models list, or a quote endpoint, would let tools check the cost before submitting.

**5. An 11-hour queue with no signal.** Our Qwen3 4B job was accepted at 22:53 UTC and reported "running", 0 tokens trained and one event ("Job is submitted") for 11 hours. The console showed the same, with ETA "Calculating". Then it trained in under 3 minutes. A "queued" status, a queue position or an ETA would have saved two escalations. It cost nothing while it waited, which we appreciated.

**6. Downloaded adapters do not load in PEFT as they are.** The adapter's weights are saved as `model.layers.N...lora_A.weight`, without the `base_model.model.` prefix PEFT expects. PEFT matches nothing, warns, and because the adapter config sets `init_lora_weights: false` it keeps random LoRA weights: the model answered in garbage across several languages and scored 0 of 120. Renaming the keys fixed it (`harness/eval.py`). Saving with the standard prefix, or a line in the download docs, would spare everyone this.

**7. The training loss reads oddly.** Checkpoints report train loss 9.5, 8.5, 7.8 against validation loss 1.04, 1.12, 0.12. If train loss is summed over a packed batch and validation is a per-token mean, saying so would help people read their own runs.

**8. Packing changes how much training happens.** With packing on (the default), our 358 short examples filled about 9 sequences an epoch, so 3 epochs at batch 8 made 6 optimizer steps. That is likely why the tuned Qwen3 4B gained only 3 tickets. Reporting the number of optimizer steps in the job object would make this visible before you spend.

**9. No spending limit in the console.** The only protection against an overrun on a card-backed account was our own guard, plus the "stop usage when the trial ends" preference. A hard monthly cap per project would let small teams experiment without fear.

## NVIDIA Nemotron on Token Factory

**10. Nemotron 3 Ultra is a strong, affordable teacher.** At $1 in and $3 out per 1M tokens it wrote 88 to 135 targeted cases per run, and Super agreed with 89% to 95% of them when labelling blind. A whole teaching run cost about five cents.

**11. Reasoning by default eats short answers.** Asked for a one-word label with a 300-token allowance, Nemotron 3 Super spent all 300 tokens thinking and returned nothing (billed). With `chat_template_kwargs: {"enable_thinking": false}` every Nemotron answered in 2 tokens. Documenting this switch on the model pages would save a few hours and a few cents for every team.

**12. No structured outputs listed for Nemotron models.** We put the JSON schema in the prompt and parse the reply; it worked every time, but native `json_schema` support would remove a retry path.

**13. Nemotron 3 Nano is a great specialist base.** Cheap ($0.06 in, $0.24 out), fast (about 0.4 s a ticket), and very teachable through instructions: 74% to 87% in our best run. It cannot be fine-tuned on Token Factory today; if it could, it would be our weights-mode student too.
