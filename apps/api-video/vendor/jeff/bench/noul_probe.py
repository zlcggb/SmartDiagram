"""Measure noul sensitivity to neighboring questions and string/object state.

    uv run python bench/noul_probe.py --model models/gliformer-large-v1
    uv run python bench/noul_probe.py --model models/gliformer-base-v1 --tag base

Write per-variant/context/case results to bench/results/noul_probe.jsonl and print summaries.
"""

from __future__ import annotations

import argparse
import itertools
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jeff.backends.torch_backend import TorchBackend
from jeff.core import Engine, PromptOptions, SystemOneRequest
from jeff.core.schemas import NoulAnswer

# ---------------------------------------------------------------------------
# Cases: a short support-style message plus nouls with unambiguous answers.

CASES: list[dict[str, Any]] = [
    {
        "subject": "Double charge",
        "message": "Hi, I was charged twice for my subscription this month and need the duplicate refunded.",
        "nouls": {
            "Does the customer request a refund?": True,
            "Is the customer reporting a bug in the product?": False,
        },
    },
    {
        "subject": "Export crash",
        "message": "The export button crashes the settings page in Safari. It works in Chrome, but some of our customers only use Safari.",
        "nouls": {
            "Does the customer request a refund?": False,
            "Is the customer reporting a bug in the product?": True,
        },
    },
    {
        "subject": "Site down",
        "message": "Our production site has been down for 40 minutes and we are losing orders. Please respond immediately.",
        "nouls": {"Is this message urgent?": True, "Does the customer request a refund?": False},
    },
    {
        "subject": "Thanks",
        "message": "Just wanted to say the new dashboard is great, no action needed. Have a good weekend!",
        "nouls": {"Is this message urgent?": False, "Is the customer unhappy?": False},
    },
    {
        "subject": "Cancel",
        "message": "Please cancel my account. I have asked three times already and nobody replies. This is unacceptable.",
        "nouls": {"Does the customer want to cancel their account?": True, "Is the customer unhappy?": True},
    },
    {
        "subject": "Pricing question",
        "message": "How much would it cost to add five more seats to our team plan? We might upgrade next quarter.",
        "nouls": {"Does the customer want to cancel their account?": False, "Is this a question about pricing?": True},
    },
    {
        "subject": "Invoice",
        "message": "Could you send me the invoice for August? Our finance team needs it for the books, no rush.",
        "nouls": {"Is this message urgent?": False, "Is this about billing or invoices?": True},
    },
    {
        "subject": "Login broken",
        "message": "I can't log in since this morning, the page says 'invalid token' every time. I need access before my 2pm demo.",
        "nouls": {"Is the customer reporting a bug in the product?": True, "Is this message urgent?": True},
    },
    {
        "subject": "Feature idea",
        "message": "It would be nice if the reports could be exported as CSV as well as PDF. Not a blocker, just an idea.",
        "nouls": {"Is the customer requesting a new feature?": True, "Is the customer unhappy?": False},
    },
    {
        "subject": "Refund status",
        "message": "You said the refund for order 4471 would arrive in 5 days. It has been two weeks. Where is my money?",
        "nouls": {"Does the customer request a refund?": True, "Is the customer unhappy?": True},
    },
    {
        "subject": "Integration",
        "message": "Does your API support webhooks for order events? We are evaluating a few vendors.",
        "nouls": {"Is the customer reporting a bug in the product?": False, "Is this a question about pricing?": False},
    },
    {
        "subject": "Wrong item",
        "message": "I ordered a blue case and got a red one. I don't need it replaced, just refund the difference.",
        "nouls": {"Does the customer request a refund?": True, "Is the customer requesting a new feature?": False},
    },
]

TEAM = {
    "type": "choice",
    "instructions": "Which team should handle this?",
    "criteria": {
        "billing": "Payment or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions",
    },
}
FRUSTRATION = {
    "type": "score",
    "instructions": "How frustrated is the customer?",
    "criteria": ["calm", "annoyed", "angry"],
}

# Context = the other questions in the request and where the noul sits.
CONTEXTS = {
    "alone": lambda noul: {"q": noul},
    "first": lambda noul: {"q": noul, "team": TEAM},
    "first2": lambda noul: {"q": noul, "team": TEAM, "frustration": FRUSTRATION},
    "last": lambda noul: {"team": TEAM, "frustration": FRUSTRATION, "q": noul},
}

STATE_FORMS = ("str", "dict")

VARIANTS = [
    PromptOptions(noul_mode=m, isolate=i, state_format=f)
    for m, i, f in itertools.product(("single", "single_named", "yes_no"), ("none", "nouls"), ("kv", "json", "values"))
]


def variant_key(o: PromptOptions) -> str:
    return f"{o.noul_mode}/{o.isolate}/{o.state_format}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/gliformer-large-v1")
    ap.add_argument("--device", default=None)
    ap.add_argument("--tag", default="large")
    ap.add_argument("--out", default="bench/results/noul_probe.jsonl")
    ap.add_argument("--batch", type=int, default=16)
    args = ap.parse_args()

    backend = TorchBackend(args.model, device=args.device, batch_size=args.batch)
    rows = []
    t0 = time.time()
    for opts in VARIANTS:
        engine = Engine(backend, args.tag, opts)
        reqs, meta = [], []
        for form in STATE_FORMS:
            if form == "str" and opts.state_format != "kv":
                continue  # string states ignore state_format; run them once
            for ci, case in enumerate(CASES):
                state = case["message"] if form == "str" else {"subject": case["subject"], "message": case["message"]}
                for question, expected in case["nouls"].items():
                    noul = {"type": "noul", "instructions": question}
                    for cname, build in CONTEXTS.items():
                        reqs.append(
                            SystemOneRequest.model_validate(
                                {"state": state, "model": "jev-latest", "questions": build(noul)}
                            )
                        )
                        meta.append(
                            {
                                "case": ci,
                                "question": question,
                                "expected": expected,
                                "context": cname,
                                "state_form": form,
                            }
                        )
        for i in range(0, len(reqs), args.batch):
            for m, resp in zip(meta[i : i + args.batch], engine.run_batch(reqs[i : i + args.batch])):
                a = resp.answers["q"]
                assert isinstance(a, NoulAnswer)
                rows.append(
                    {**m, "variant": variant_key(opts), "tag": args.tag, "p": a.noul, "tokens": resp.usage.input_tokens}
                )
        print(f"{variant_key(opts):28s} {len(reqs):4d} requests  {time.time() - t0:6.0f}s", file=sys.stderr)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(summarize(rows))


def summarize(rows: list[dict]) -> str:
    """Per variant: accuracy, MAE to the 0/1 target, and context spread, split by state form."""
    by = {}
    for r in rows:
        by.setdefault(r["variant"], []).append(r)
    lines = [
        f"{'variant':28s} {'form':5s} {'n':>4s} {'acc':>6s} {'mae':>6s} {'spread':>7s} {'worst':>6s}   per-context acc",
    ]
    for variant, rs in by.items():
        for form in STATE_FORMS:
            sub = [r for r in rs if r["state_form"] == form]
            if not sub:
                continue
            acc = statistics.mean(float((r["p"] > 0.5) == r["expected"]) for r in sub)
            mae = statistics.mean(abs(r["p"] - float(r["expected"])) for r in sub)
            # spread: for each (case, question) the max-min of p across contexts
            groups = {}
            for r in sub:
                groups.setdefault((r["case"], r["question"]), []).append(r["p"])
            spreads = [max(v) - min(v) for v in groups.values()]
            ctx = " ".join(
                f"{c}={statistics.mean(float((r['p'] > 0.5) == r['expected']) for r in sub if r['context'] == c):.2f}"
                for c in CONTEXTS
            )
            lines.append(
                f"{variant:28s} {form:5s} {len(sub):4d} {acc:6.2f} {mae:6.3f} {statistics.mean(spreads):7.3f} {max(spreads):6.2f}   {ctx}"
            )
    return "\n".join(lines)


if __name__ == "__main__":
    main()
