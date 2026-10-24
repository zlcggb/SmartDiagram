"""Evaluate bench/data/*.jsonl in-process or over a jev-compatible API.

    uv run python bench/eval_accuracy.py jeff --model models/gliformer-large-v1
    uv run python bench/eval_accuracy.py jeff --prompt-profile original --variants default nodesc
    uv run python bench/eval_accuracy.py jev -c 8
    uv run python bench/eval_accuracy.py http --url https://...modal.run --key k1 --name jeff-l4 -c 8
    uv run python bench/eval_accuracy.py summarize

jev reads TYPESAFE_API_KEY from the environment or .env. Results append to
bench/results/accuracy.jsonl. In-process latency is amortized batch time; HTTP
latency is per request. Token counts use each backend's tokenizer.
The in-process default uses task-specific spam/irony labels; --prompt-profile original
reproduces production prompts. HTTP runs always use the target server's prompts.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import statistics
import sys
import time
from collections import defaultdict
from dataclasses import replace
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
DATA = ROOT / "bench" / "data"
OUT = ROOT / "bench" / "results" / "accuracy.jsonl"
JEV_URL = "https://api.typesafe.ai"

# Prompt-rendering variants for the in-process jeff run (PromptOptions kwargs).
VARIANTS: dict[str, dict[str, Any]] = {
    "default": {},
    "nodesc": {"fold_descriptions": False},  # bare option keys, no "key: description"
    "idname": {"instruction_as_name": False},  # group name = question id instead of the instruction
    "noiso": {"isolate": "none"},  # every question shares one prompt (only differs with --multi)
    "isoall": {"isolate": "all"},  # every question gets its own encoder pass
    "single": {"noul_mode": "single"},
    "json": {"state_format": "json"},
}

# Task-specific controls; never used by the production API.
TASK_LABELS = {
    "sms_spam": ("spam", "not spam"),
    "irony": ("ironic", "not ironic"),
}


class _PromptProfileBackend:
    def __init__(self, backend, replacements):
        self.backend = backend
        self.name = backend.name
        self.replacements = replacements

    def score(self, texts, groups):
        return self.backend.score(texts, [[self.replacements.get(g, g) for g in gs] for gs in groups])


def profile_backend(backend, items, opts, profile):
    if profile == "original":
        return backend
    if profile != "task-labels":
        raise ValueError(f"Unknown prompt profile: {profile}")
    from jeff.core import SystemOneRequest, build_groups

    replacements = {}
    for item in items:
        labels = TASK_LABELS.get(item["task"])
        if labels is None:
            continue
        req = SystemOneRequest.model_validate(body_for(item, "benchmark"))
        (group,) = build_groups(req.questions, opts)
        replacements[group] = replace(group, labels=labels, name=None if item["task"] == "irony" else group.name)
    return _PromptProfileBackend(backend, replacements)


# --multi puts these before the labeled question to measure context effects (see noul_probe.py).
DISTRACTORS = {
    "team": {
        "type": "choice",
        "instructions": "Which team should handle this text?",
        "criteria": {
            "billing": "Payments and invoices",
            "technical": "Bugs and integrations",
            "sales": "Pricing and plans",
            "other": None,
        },
    },
    "urgency": {
        "type": "score",
        "instructions": "How urgent is this text?",
        "criteria": ["not urgent", "somewhat urgent", "very urgent"],
    },
    "asks": {"type": "noul", "instructions": "Does the text ask a question?"},
}


def load_items(tasks: list[str] | None, limit: int | None):
    items = []
    for p in sorted(DATA.glob("*.jsonl")):
        if tasks and p.stem not in tasks:
            continue
        rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
        for r in rows[:limit]:
            r["task"] = p.stem
            items.append(r)
    return items


def body_for(item: dict, model: str, multi: bool = False) -> dict:
    questions = {**DISTRACTORS, **item["questions"]} if multi else item["questions"]
    return {"state": item["state"], "model": model, "questions": questions}


def write_rows(rows: list[dict]):
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("a") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


# ---------------------------------------------------------------------------
# Runners


def run_jeff(args):
    from jeff.backends.torch_backend import TorchBackend
    from jeff.core import Engine, PromptOptions, SystemOneRequest

    items = load_items(args.tasks, args.limit)
    backend = TorchBackend(args.model, device=args.device, batch_size=args.batch)
    tag = args.name or Path(args.model).name
    for vname in args.variants:
        opts = PromptOptions(**VARIANTS[vname])
        engine = Engine(
            profile_backend(backend, items, opts, args.prompt_profile),
            tag,
            opts,
            **({"temperature": args.temperature} if args.temperature is not None else {}),
        )
        run = f"{tag}{'+multi' if args.multi else ''}/{args.prompt_profile}/{vname}"
        rows, t_total = [], 0.0
        for i in range(0, len(items), args.batch):
            chunk = items[i : i + args.batch]
            reqs = [SystemOneRequest.model_validate(body_for(it, tag, args.multi)) for it in chunk]
            t0 = time.perf_counter()
            resps = engine.run_batch(reqs)
            dt = (time.perf_counter() - t0) * 1000
            t_total += dt
            for it, resp in zip(chunk, resps):
                d = resp.model_dump()
                rows.append(
                    {
                        "run": run,
                        "system": "jeff",
                        "variant": vname,
                        "prompt_profile": args.prompt_profile,
                        "temperature": engine.temperature,
                        "task": it["task"],
                        "kind": it["kind"],
                        "id": it["id"],
                        "gold": it["gold"],
                        "answer": d["answers"]["q"],
                        "latency_ms": round(dt / len(chunk), 2),  # amortized batch time, not HTTP latency
                        "batch": len(chunk),
                        "input_tokens": d["usage"]["input_tokens"],
                    }
                )
            print(
                f"\r{run}: {i + len(chunk)}/{len(items)}  {t_total / (i + len(chunk)):.0f} ms/item", end="", flush=True
            )
        print()
        write_rows(rows)
        quick_summary(rows)


async def run_http(args, url: str, key: str | None, run: str, system: str, model: str):
    import httpx

    items = load_items(args.tasks, args.limit)
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    sem = asyncio.Semaphore(args.concurrency)
    rows: list[dict] = []
    errors = 0

    async with httpx.AsyncClient(
        timeout=args.timeout, limits=httpx.Limits(max_connections=args.concurrency + 4)
    ) as client:
        await client.get(url + "/v1/models", headers=headers)  # warm the connection

        async def one(it):
            nonlocal errors
            async with sem:
                body = body_for(it, model, args.multi)
                for attempt in range(4):
                    t0 = time.perf_counter()
                    try:
                        r = await client.post(url + "/v1/systemone", json=body, headers=headers)
                    except httpx.HTTPError as e:
                        r = None
                        err = repr(e)
                    dt = (time.perf_counter() - t0) * 1000
                    if r is not None and r.status_code == 200:
                        break
                    if r is not None:
                        err = f"{r.status_code} {r.text[:200]}"
                        if r.status_code in (400, 401, 422):
                            break  # not retryable
                    await asyncio.sleep(0.5 * 2**attempt)
                else:
                    r = None
                if r is None or r.status_code != 200:
                    errors += 1
                    print(f"\n{it['id']}: {err}", file=sys.stderr)
                    return
                d = r.json()
                rows.append(
                    {
                        "run": run,
                        "system": system,
                        "variant": model,
                        "task": it["task"],
                        "kind": it["kind"],
                        "id": it["id"],
                        "gold": it["gold"],
                        "answer": d["answers"]["q"],
                        "latency_ms": round(dt, 2),
                        "server_ms": float(r.headers["x-jeff-server-ms"]) if "x-jeff-server-ms" in r.headers else None,
                        "input_tokens": d["usage"]["input_tokens"],
                        "response_model": d.get("model"),
                    }
                )
                if len(rows) % 25 == 0:
                    print(f"\r{run}: {len(rows)}/{len(items)}", end="", flush=True)

        await asyncio.gather(*(one(it) for it in items))
    print(f"\r{run}: {len(rows)}/{len(items)} done, {errors} errors")
    write_rows(rows)
    quick_summary(rows)


# ---------------------------------------------------------------------------
# Metrics (plain Python; n is small)


def auroc(scores: list[float], labels: list[bool]) -> float:
    pos = [s for s, y in zip(scores, labels) if y]
    neg = [s for s, y in zip(scores, labels) if not y]
    if not pos or not neg:
        return float("nan")
    # Pairwise ranking; ties count as half a win.
    wins = 0.0
    for p in pos:
        for n in neg:
            wins += 1.0 if p > n else 0.5 if p == n else 0.0
    return wins / (len(pos) * len(neg))


def spearman(a: list[float], b: list[float]) -> float:
    def ranks(x):
        order = sorted(range(len(x)), key=lambda i: x[i])
        r = [0.0] * len(x)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and x[order[j + 1]] == x[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return r

    ra, rb = ranks(a), ranks(b)
    ma, mb = statistics.fmean(ra), statistics.fmean(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra))
    vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else float("nan")


def pearson(a, b):
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = math.sqrt(sum((x - ma) ** 2 for x in a))
    vb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return cov / (va * vb) if va and vb else float("nan")


def ece(conf: list[float], correct: list[bool], bins: int = 10) -> float:
    """Expected calibration error of P(predicted class) vs. its accuracy."""
    tot = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, c in enumerate(conf) if (lo <= c < hi) or (b == bins - 1 and c == 1.0)]
        if idx:
            acc = sum(correct[i] for i in idx) / len(idx)
            avg = sum(conf[i] for i in idx) / len(idx)
            tot += len(idx) / len(conf) * abs(acc - avg)
    return tot


def macro_f1(pred: list[str], gold: list[str]) -> float:
    labels = sorted(set(gold) | set(pred))
    f1s = []
    for label in labels:
        tp = sum(p == label and g == label for p, g in zip(pred, gold))
        fp = sum(p == label and g != label for p, g in zip(pred, gold))
        fn = sum(p != label and g == label for p, g in zip(pred, gold))
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * pr * rc / (pr + rc) if pr + rc else 0.0)
    return statistics.fmean(f1s)


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(p / 100 * (len(xs) - 1)))]


def task_metrics(rows: list[dict]) -> dict:
    kind = rows[0]["kind"]
    m = {
        "n": len(rows),
        "p50_ms": round(pct([r["latency_ms"] for r in rows], 50), 1),
        "tokens": round(statistics.fmean(r["input_tokens"] for r in rows)),
    }
    if kind == "choice":
        pred = [r["answer"]["choice"] for r in rows]
        gold = [r["gold"] for r in rows]
        correct = [p == g for p, g in zip(pred, gold)]
        pmax = [max(r["answer"]["probabilities"].values()) for r in rows]
        m.update(
            acc=statistics.fmean(correct), f1=macro_f1(pred, gold), ece=ece(pmax, correct), pmax=statistics.fmean(pmax)
        )
    elif kind == "score":
        s = [r["answer"]["score"] for r in rows]
        g = [float(r["gold"]) for r in rows]
        argmax = [int(max(r["answer"]["probabilities"], key=r["answer"]["probabilities"].get)) for r in rows]
        m.update(
            mae=statistics.fmean(abs(a - b) for a, b in zip(s, g)),
            acc_round=statistics.fmean(round(a) == b for a, b in zip(s, g)),
            acc_argmax=statistics.fmean(a == b for a, b in zip(argmax, g)),
            spearman=spearman(s, g),
            # baseline: always predicting the middle level
            mae_mid=statistics.fmean(abs((len(rows[0]["answer"]["probabilities"]) - 1) / 2 - b) for b in g),
        )
    else:
        p = [r["answer"]["noul"] for r in rows]
        y = [bool(r["gold"]) for r in rows]
        pred = [x >= 0.5 for x in p]
        correct = [a == b for a, b in zip(pred, y)]
        conf = [x if x >= 0.5 else 1 - x for x in p]
        m.update(
            auroc=auroc(p, y),
            acc=statistics.fmean(correct),
            brier=statistics.fmean((x - float(t)) ** 2 for x, t in zip(p, y)),
            ece=ece(conf, correct),
            mean_p=statistics.fmean(p),
        )
    return m


def fmt(x):
    if isinstance(x, float):
        return "nan" if math.isnan(x) else f"{x:.3f}" if abs(x) < 10 else f"{x:.0f}"
    return str(x)


def quick_summary(rows: list[dict]):
    by = defaultdict(list)
    for r in rows:
        by[r["task"]].append(r)
    for task, rs in sorted(by.items()):
        m = task_metrics(rs)
        print(f"  {task:10s} " + "  ".join(f"{k}={fmt(v)}" for k, v in m.items()))


COLS = {
    "choice": ["acc", "f1", "ece", "pmax", "p50_ms", "tokens"],
    "score": ["mae", "mae_mid", "acc_round", "acc_argmax", "spearman", "p50_ms", "tokens"],
    "noul": ["auroc", "acc", "brier", "ece", "mean_p", "p50_ms", "tokens"],
}


def summarize(args):
    rows = [json.loads(line) for line in OUT.read_text().splitlines() if line.strip()]
    if args.runs:
        rows = [r for r in rows if r["run"] in args.runs]
    # last write wins per (run, id)
    latest = {}
    for r in rows:
        latest[(r["run"], r["id"])] = r
    rows = list(latest.values())
    if args.full:
        n_items = max(len([r for r in rows if r["run"] == run]) for run in {r["run"] for r in rows})
        rows = [r for r in rows if _count(rows, r["run"]) == n_items]
    runs = sorted({r["run"] for r in rows})
    by = defaultdict(list)
    for r in rows:
        by[(r["kind"], r["task"], r["run"])].append(r)

    print("# Accuracy eval (bench/eval_accuracy.py)\n")
    print(
        "Latency for `jeff/*` in-process runs is amortized batch time on the local device, not HTTP latency; HTTP runs (jev, http) are client-observed per request.\n"
    )
    for kind in ("choice", "score", "noul"):
        tasks = sorted({t for k, t, _ in by if k == kind})
        if not tasks:
            continue
        cols = COLS[kind]
        print(f"## {kind}\n")
        print("| task | run | " + " | ".join(cols) + " |")
        print("|---|---|" + "---:|" * len(cols))
        for t in tasks:
            for run in runs:
                rs = by.get((kind, t, run))
                if not rs:
                    continue
                m = task_metrics(rs)
                print(f"| {t} | {run} | " + " | ".join(fmt(m.get(c, float("nan"))) for c in cols) + " |")
        print()

    print("## Averages over tasks\n")
    print("| run | choice acc | score mae | noul auroc | noul acc | p50 ms | tokens |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for run in runs:
        agg = defaultdict(list)
        for (kind, t, rn), rs in by.items():
            if rn != run:
                continue
            m = task_metrics(rs)
            if kind == "choice":
                agg["choice acc"].append(m["acc"])
            elif kind == "score":
                agg["score mae"].append(m["mae"])
            else:
                agg["noul auroc"].append(m["auroc"])
                agg["noul acc"].append(m["acc"])
            agg["p50 ms"].append(m["p50_ms"])
            agg["tokens"].append(m["tokens"])
        cells = [
            fmt(statistics.fmean(agg[c])) if agg[c] else ""
            for c in ("choice acc", "score mae", "noul auroc", "noul acc", "p50 ms", "tokens")
        ]
        print(f"| {run} | " + " | ".join(cells) + " |")
    print()

    # Latency over all items per run (HTTP runs only; in-process rows are amortized batch time).
    print("## Latency (client-observed, all items)\n")
    print("| run | n | p50 ms | p95 ms | p99 ms | mean tokens |")
    print("|---|---:|---:|---:|---:|---:|")
    for run in runs:
        rs = [r for r in rows if r["run"] == run]
        if rs[0]["system"] == "jeff":
            continue
        lat = [r["latency_ms"] for r in rs]
        print(
            f"| {run} | {len(rs)} | {pct(lat, 50):.0f} | {pct(lat, 95):.0f} | {pct(lat, 99):.0f} | {statistics.fmean(r['input_tokens'] for r in rs):.0f} |"
        )
    print()

    counts = defaultdict(int)
    for r in rows:
        counts[r["run"]] += 1
    jev_runs = sorted((r for r in runs if r.startswith("jev")), key=lambda r: (-counts[r], "+multi" in r, r))
    if jev_runs:
        ref_run = jev_runs[0]  # the jev run with the most items
        ref = {r["id"]: r for r in rows if r["run"] == ref_run}
        print(f"## Agreement with {ref_run} (same items)\n")
        print("| task | run | choice agree | score corr | score mean abs diff | noul corr | noul agree@0.5 |")
        print("|---|---|---:|---:|---:|---:|---:|")
        for (kind, t, run), rs in sorted(by.items(), key=lambda kv: (kv[0][1], kv[0][2])):
            if run == ref_run:
                continue
            pairs = [(r, ref[r["id"]]) for r in rs if r["id"] in ref]
            if not pairs:
                continue
            cells = ["", "", "", "", ""]
            if kind == "choice":
                cells[0] = fmt(statistics.fmean(a["answer"]["choice"] == b["answer"]["choice"] for a, b in pairs))
            elif kind == "score":
                cells[1] = fmt(
                    pearson([a["answer"]["score"] for a, b in pairs], [b["answer"]["score"] for a, b in pairs])
                )
                cells[2] = fmt(statistics.fmean(abs(a["answer"]["score"] - b["answer"]["score"]) for a, b in pairs))
            else:
                cells[3] = fmt(
                    pearson([a["answer"]["noul"] for a, b in pairs], [b["answer"]["noul"] for a, b in pairs])
                )
                cells[4] = fmt(
                    statistics.fmean((a["answer"]["noul"] >= 0.5) == (b["answer"]["noul"] >= 0.5) for a, b in pairs)
                )
            print(f"| {t} | {run} | " + " | ".join(cells) + " |")
        print()


# ---------------------------------------------------------------------------


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", type=Path, default=OUT, help="results JSONL to append to or summarize")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--tasks", nargs="*", default=None)
        p.add_argument("--limit", type=int, default=None, help="items per task")
        p.add_argument("--name", default=None, help="run name prefix")
        p.add_argument("--multi", action="store_true", help="add three unrelated questions before the labeled one")

    p = sub.add_parser("jeff")
    common(p)
    p.add_argument("--model", default="models/gliformer-large-v1")
    p.add_argument("--device", default=None)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--variants", nargs="*", default=["default"], choices=list(VARIANTS))
    p.add_argument("--temperature", type=float, default=None, help="override jeff.core.answers.DEFAULT_TEMPERATURE")
    p.add_argument(
        "--prompt-profile",
        choices=("original", "task-labels"),
        default="task-labels",
        help="task-labels uses explicit spam/irony labels; original matches production prompts",
    )

    for name in ("http", "jev"):
        p = sub.add_parser(name)
        common(p)
        p.add_argument("--url", default=JEV_URL if name == "jev" else "http://localhost:8000")
        p.add_argument("--key", default=None)
        p.add_argument("--model", default="jev-latest")
        p.add_argument("-c", "--concurrency", type=int, default=8)
        p.add_argument("--timeout", type=float, default=60.0)

    p = sub.add_parser("summarize")
    p.add_argument("--runs", nargs="*", default=None, help="only these runs (default: all)")
    p.add_argument("--full", action="store_true", help="only runs that cover every item (drops --limit subsets)")

    args = ap.parse_args()
    OUT = args.results
    if args.cmd == "jeff":
        if args.prompt_profile == "task-labels" and args.variants != ["default"]:
            ap.error("task-labels supports --variants default; use --prompt-profile original for variant sweeps")
        run_jeff(args)
    elif args.cmd == "jev":
        key = args.key or os.environ.get("TYPESAFE_API_KEY") or _dotenv("TYPESAFE_API_KEY")
        if not key:
            sys.exit("TYPESAFE_API_KEY not set")
        asyncio.run(
            run_http(
                args, args.url, key, args.name or f"jev{'+multi' if args.multi else ''}/{args.model}", "jev", args.model
            )
        )
    elif args.cmd == "http":
        asyncio.run(run_http(args, args.url.rstrip("/"), args.key, args.name or f"http/{args.url}", "http", args.model))
    else:
        summarize(args)


_COUNTS: dict[str, int] = {}


def _count(rows, run):
    if not _COUNTS:
        for r in rows:
            _COUNTS[r["run"]] = _COUNTS.get(r["run"], 0) + 1
    return _COUNTS[run]


def _dotenv(name: str) -> str | None:
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


if __name__ == "__main__":
    main()
