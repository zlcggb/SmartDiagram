"""Build committed, label-balanced samples in bench/data/<task>.jsonl for offline eval.

    uv run --group bench python bench/build_evalset.py [--n 200] [--tasks ag_news sst5 ...]

Rows contain id, state, questions (one question, q), and gold
(option key for choice, level index for score, boolean for noul).
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any

from datasets import load_dataset

OUT = Path(__file__).parent / "data"
MAX_CHARS = 2000  # long reviews/passages are truncated; both APIs see the same text


def _trunc(s: str) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= MAX_CHARS else s[:MAX_CHARS].rsplit(" ", 1)[0] + " ..."


# ---------------------------------------------------------------------------
# Include criteria descriptions to exercise the fold_descriptions prompt variant.

AG_LABELS = ["world", "sports", "business", "sci_tech"]
EMOTION_LABELS = ["sadness", "joy", "love", "anger", "fear", "surprise"]

TASKS: dict[str, dict[str, Any]] = {
    "ag_news": {
        "kind": "choice",
        "load": lambda: load_dataset("fancyzhx/ag_news", split="test"),
        "state": lambda r: _trunc(r["text"]),
        "gold": lambda r: AG_LABELS[r["label"]],
        "question": {
            "type": "choice",
            "instructions": "Which topic does this news article belong to?",
            "criteria": {
                "world": "International news, politics, conflicts and world affairs",
                "sports": "Sports events, teams, athletes and results",
                "business": "Companies, markets, the economy and finance",
                "sci_tech": "Science, technology, software, gadgets and research",
            },
        },
    },
    "emotion": {
        "kind": "choice",
        "load": lambda: load_dataset("dair-ai/emotion", "split", split="test"),
        "state": lambda r: _trunc(r["text"]),
        "gold": lambda r: EMOTION_LABELS[r["label"]],
        "question": {
            "type": "choice",
            "instructions": "Which emotion does the writer of this message express?",
            "criteria": {
                "sadness": "Sad, disappointed, hurt, lonely or grieving",
                "joy": "Happy, content, satisfied, amused or proud",
                "love": "Affection, tenderness, caring or romantic feelings",
                "anger": "Angry, irritated, annoyed or resentful",
                "fear": "Afraid, anxious, nervous or worried",
                "surprise": "Surprised, amazed or shocked",
            },
        },
    },
    "sst5": {
        "kind": "score",
        "load": lambda: load_dataset("SetFit/sst5", split="test"),
        "state": lambda r: _trunc(r["text"]),
        "gold": lambda r: int(r["label"]),  # 0 very negative .. 4 very positive
        "question": {
            "type": "score",
            "instructions": "How positive is the sentiment of this movie review sentence?",
            "criteria": ["very negative", "negative", "neutral", "positive", "very positive"],
        },
    },
    "amazon": {
        "kind": "score",
        "load": lambda: load_dataset("SetFit/amazon_reviews_multi_en", split="test"),
        # object state: exercises the kv rendering path on both APIs
        "state": lambda r: {"source": "amazon product review", "review": _trunc(r["text"])},
        "gold": lambda r: int(r["label"]),  # 0 = 1 star .. 4 = 5 stars
        "question": {
            "type": "score",
            "instructions": "How many stars (1-5) did the customer give this product review?",
            "criteria": [
                "1 star: very dissatisfied",
                "2 stars: dissatisfied",
                "3 stars: mixed or neutral",
                "4 stars: satisfied",
                "5 stars: very satisfied",
            ],
        },
    },
    "sms_spam": {
        "kind": "noul",
        "load": lambda: load_dataset("ucirvine/sms_spam", split="train"),
        "state": lambda r: _trunc(r["sms"]),
        "gold": lambda r: bool(r["label"]),  # 1 = spam
        "question": {
            "type": "noul",
            "instructions": "Is this SMS message spam?",
            "criteria": {
                "true": "Unsolicited advertising, scams, prize or subscription bait",
                "false": "A genuine personal or transactional message",
            },
        },
    },
    "sst2": {
        "kind": "noul",
        "load": lambda: load_dataset("stanfordnlp/sst2", split="validation"),
        "state": lambda r: _trunc(r["sentence"]),
        "gold": lambda r: bool(r["label"]),  # 1 = positive
        "question": {"type": "noul", "instructions": "Is the sentiment of this movie review sentence positive?"},
    },
    "irony": {
        "kind": "noul",
        "load": lambda: load_dataset("cardiffnlp/tweet_eval", "irony", split="test"),
        "state": lambda r: _trunc(r["text"]),
        "gold": lambda r: bool(r["label"]),  # 1 = irony
        "question": {
            "type": "noul",
            "instructions": "Is this tweet ironic or sarcastic?",
            "criteria": {
                "true": "The writer means the opposite of what they literally say, or is being sarcastic",
                "false": "The tweet is meant literally",
            },
        },
    },
    # Reading comprehension: the question changes per item, so the eval runner
    # substitutes ``instructions`` from the row (see ``per_item_instructions``).
    "boolq": {
        "kind": "noul",
        "load": lambda: load_dataset("google/boolq", split="validation"),
        "state": lambda r: {"passage": _trunc(r["passage"])},
        "gold": lambda r: bool(r["answer"]),
        "question": {"type": "noul", "instructions": None},
        "per_item_instructions": lambda r: r["question"].strip().rstrip("?").capitalize() + "?",
    },
}


def balanced_sample(rows, gold_fn, n: int, seed: int):
    by = defaultdict(list)
    for i, r in enumerate(rows):
        by[json.dumps(gold_fn(r))].append(i)
    rng = random.Random(seed)
    for idx in by.values():
        rng.shuffle(idx)
    out, k = [], 0
    while len(out) < n and any(by.values()):
        for key in sorted(by):
            if by[key] and len(out) < n:
                out.append(by[key].pop())
        k += 1
    return sorted(out)


def build(name: str, n: int, seed: int):
    t = TASKS[name]
    ds = t["load"]()
    idx = balanced_sample(ds, t["gold"], n, seed)
    path = OUT / f"{name}.jsonl"
    with path.open("w") as f:
        for i in idx:
            r = ds[i]
            q = dict(t["question"])
            if "per_item_instructions" in t:
                q["instructions"] = t["per_item_instructions"](r)
            f.write(
                json.dumps(
                    {
                        "id": f"{name}-{i}",
                        "kind": t["kind"],
                        "state": t["state"](r),
                        "questions": {"q": q},
                        "gold": t["gold"](r),
                    }
                )
                + "\n"
            )
    print(f"{name}: {len(idx)} rows -> {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--tasks", nargs="*", default=list(TASKS))
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    for name in args.tasks:
        try:
            build(name, args.n, args.seed)
        except Exception as e:  # noqa: BLE001 - keep going; report at the end
            print(f"{name}: FAILED {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
