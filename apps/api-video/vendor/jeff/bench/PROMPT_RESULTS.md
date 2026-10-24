# Task-label prompt benchmarks — 2026-09-19

Fresh runs cover all 1,600 saved examples (200 per task), with no sampling: original prompts at T=3.2, task-label prompts at T=3.2, and a task-label run at T=1 for calibration. **4,800 predictions total.**

## Profile

The in-process benchmark now defaults to `--prompt-profile task-labels`:

- SMS spam: `spam` / `not spam`, retaining the question as group name.
- Tweet irony: `ironic` / `not ironic`, with no group name.
- All other prompts, model weights, states, gold labels, decoding, and question isolation are unchanged.

This is a **benchmark-only profile**. The production API still uses its original prompts. `--prompt-profile original` reproduces them. The profile is recorded in each result and run name. HTTP benchmark runs use the target server’s prompts.

## Accuracy

| Task | Metric | Original | Task labels | Saved jev |
|---|---|---:|---:|---:|
| ag_news | Accuracy ↑ | 75.5% | 75.5% | 90.5% |
| amazon | MAE ↓ | 0.600 | 0.600 | 0.467 |
| boolq | AUROC ↑ | 0.750 | 0.750 | 0.954 |
| emotion | Accuracy ↑ | 47.0% | 47.0% | 47.0% |
| irony | AUROC ↑ | 0.714 | 0.763 | 0.958 |
| sms_spam | AUROC ↑ | 0.918 | 0.967 | 0.994 |
| sst2 | AUROC ↑ | 0.991 | 0.991 | 0.996 |
| sst5 | MAE ↓ | 0.611 | 0.611 | 0.489 |

The other six tasks produce identical answer objects in the before/after runs. Jev values are the saved September 18 run on the same items, not fresh requests. Prompts were selected using this benchmark in the preceding audit; these full reruns confirm reproducibility, not performance on a new independent test set.

## Binary-task calibration at unchanged T=3.2

| Task | Accuracy before → after | Brier before → after ↓ | ECE before → after ↓ |
|---|---:|---:|---:|
| sms_spam | 0.860 → 0.905 | 0.124 → 0.071 | 0.113 → 0.070 |
| irony | 0.680 → 0.690 | 0.222 → 0.229 | 0.096 → 0.128 |
| boolq | 0.690 → 0.690 | 0.209 → 0.209 | 0.081 → 0.081 |
| sst2 | 0.960 → 0.960 | 0.036 → 0.036 | 0.072 → 0.072 |

Irony ranking improves, but its probabilities are less calibrated at the unchanged temperature.

The raw T=1 run was also evaluated with `bench/calibrate.py`; see [calibration output](results/prompt_profiles_calibration.md). The global fitted temperature is 3.30, close to the current 3.2. Fitted temperatures are diagnostic, not new production defaults.

## Runtime and checks

All fresh runs used the local large checkpoint, CPU/fp32/eager attention, batch size 16. Per-item latency is amortized batch inference time; these runs do not replace the historical GPU, HTTP, or cost benchmarks.

- 25 targeted tests passed, including profile mapping, binary polarity, isolation, and unchanged original prompts.
- Ruff lint/format checks passed.
- Live SDK tests could not bind a localhost socket in the sandbox; in-process server tests passed.

## Reproduce

Run from the repository root:

```bash
uv run python bench/eval_accuracy.py --results bench/results/prompt_profiles.jsonl jeff \
  --model models/gliformer-large-v1 --device cpu --batch 16 \
  --name prompt-20260919-before --prompt-profile original --temperature 3.2

uv run python bench/eval_accuracy.py --results bench/results/prompt_profiles.jsonl jeff \
  --model models/gliformer-large-v1 --device cpu --batch 16 \
  --name prompt-20260919-after --prompt-profile task-labels --temperature 3.2

uv run python bench/eval_accuracy.py --results bench/results/prompt_profiles.jsonl jeff \
  --model models/gliformer-large-v1 --device cpu --batch 16 \
  --name prompt-20260919-raw --prompt-profile task-labels --temperature 1

uv run python bench/eval_accuracy.py --results bench/results/prompt_profiles.jsonl summarize --full

uv run python bench/calibrate.py --results bench/results/prompt_profiles.jsonl \
  --run prompt-20260919-raw/task-labels/default
```

The results file is append-only; summaries use the last row per run/item. Use `--prompt-profile original` for existing `--variants` sweeps.

[Raw results](results/prompt_profiles.jsonl) · [Metrics and provenance](results/prompt_profiles.meta.json)
