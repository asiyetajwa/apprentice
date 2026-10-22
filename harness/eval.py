"""Scores a small model, base or with a LoRA adapter, on the held-out tickets, on CPU.

Same prompt as the app (src/server/task.ts studentMessages), temperature 0 (greedy), the same strict label
reading (parseLabel), so these scores sit beside the Token Factory ones on equal terms.

  .venv/bin/python harness/eval.py --model models/Qwen3-1.7B [--adapter runs/adapter] --split test --out runs/x.json
"""

import argparse
import json
import re
import statistics
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def student_messages(task, text):
    labels = "\n".join(f"- {l}: {task['labelHelp'][l]}" if task["labelHelp"].get(l) else f"- {l}" for l in task["labels"])
    return [
        {"role": "system", "content": f"{task['description']}\nAnswer with exactly one label from this list and nothing else:\n{labels}"},
        {"role": "user", "content": text},
    ]


def parse_label(task, reply):
    r = re.sub(r"""^["'`\s]+|["'`.\s]+$""", "", reply.strip().lower())
    if r in task["labels"]:
        return r
    found = sorted(((r.find(l.lower()), l) for l in task["labels"] if r.find(l.lower()) >= 0))
    return found[0][1] if found else f"(unclear: {reply.strip()[:40]})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--adapter")
    ap.add_argument("--data", default="data/support-tickets")
    ap.add_argument("--split", default="test")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    torch.set_num_threads(max(1, torch.get_num_threads()))
    task = json.loads(Path(a.data, "task.json").read_text())
    rows = [json.loads(l) for l in Path(a.data, f"{a.split}.jsonl").read_text().splitlines() if l.strip()]
    if a.limit:
        rows = rows[: a.limit]

    tok = AutoTokenizer.from_pretrained(a.model)
    tok.padding_side = "left"
    model = AutoModelForCausalLM.from_pretrained(a.model, dtype=torch.bfloat16)
    if a.adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, a.adapter)
        model = model.merge_and_unload()
    model.eval()

    prompts = [
        tok.apply_chat_template(student_messages(task, r["text"]), tokenize=False, add_generation_prompt=True, enable_thinking=False)
        for r in rows
    ]
    preds, latencies = [], []
    started = time.time()
    for i in range(0, len(rows), a.batch):
        chunk = prompts[i : i + a.batch]
        t0 = time.time()
        enc = tok(chunk, return_tensors="pt", padding=True)
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=8, do_sample=False, pad_token_id=tok.pad_token_id or tok.eos_token_id)
        replies = tok.batch_decode(out[:, enc["input_ids"].shape[1] :], skip_special_tokens=True)
        per = (time.time() - t0) * 1000 / len(chunk)
        latencies += [per] * len(chunk)
        preds += replies
        print(f"{min(i + a.batch, len(rows))}/{len(rows)}", flush=True)

    predictions, per_label = [], {l: {"correct": 0, "total": 0} for l in task["labels"]}
    for r, reply in zip(rows, preds):
        p = parse_label(task, reply)
        ok = p == r["label"]
        predictions.append({"id": r["id"], "text": r["text"], "gold": r["label"], "pred": p, "ok": ok, "hard": r.get("hard", False)})
        per_label[r["label"]]["total"] += 1
        per_label[r["label"]]["correct"] += int(ok)
    correct = sum(p["ok"] for p in predictions)
    result = {
        "model": a.model + (f" + {a.adapter}" if a.adapter else ""),
        "correct": correct,
        "total": len(rows),
        "accuracy": correct / len(rows) if rows else 0,
        "hardAccuracy": (lambda h: sum(p["ok"] for p in h) / len(h) if h else 0)([p for p in predictions if p["hard"]]),
        "perLabel": per_label,
        "medianLatencyMs": statistics.median(latencies) if latencies else 0,
        "wallSeconds": round(time.time() - started),
        "predictions": predictions,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k not in ("predictions", "perLabel")}))


if __name__ == "__main__":
    main()
