"""Fit p_i^(1/T) / sum_j p_j^(1/T) by NLL on saved accuracy results.

Report leave-one-task-out calibration error (ECE) before and after scaling.

    uv run python bench/calibrate.py --run large/default
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

from eval_accuracy import OUT, ece

GRID = [x / 20 for x in range(4, 101)]  # 0.2 .. 5.0


def probs_of(row) -> tuple[list[float], int]:
    """(probabilities in label order, gold index)."""
    a, kind = row["answer"], row["kind"]
    if kind == "noul":
        p = a["noul"]
        return [p, 1 - p], 0 if row["gold"] else 1
    if kind == "choice":
        keys = list(a["probabilities"])
        return [a["probabilities"][k] for k in keys], keys.index(row["gold"])
    keys = sorted(a["probabilities"], key=int)
    return [a["probabilities"][k] for k in keys], int(row["gold"])


def scale(p: list[float], t: float) -> list[float]:
    q = [max(x, 1e-6) ** (1 / t) for x in p]
    s = sum(q)
    return [x / s for x in q]


def nll(items, t) -> float:
    return statistics.fmean(-math.log(max(scale(p, t)[g], 1e-9)) for p, g in items)


def fit(items) -> float:
    return min(GRID, key=lambda t: nll(items, t))


def ece_of(items, t) -> float:
    conf, correct = [], []
    for p, g in items:
        q = scale(p, t)
        k = max(range(len(q)), key=lambda i: q[i])
        conf.append(q[k])
        correct.append(k == g)
    return ece(conf, correct)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="large/default")
    ap.add_argument("--results", type=Path, default=OUT, help="accuracy results JSONL")
    args = ap.parse_args()
    rows = [json.loads(line) for line in args.results.read_text().splitlines() if line.strip()]
    rows = {r["id"]: r for r in rows if r["run"] == args.run}.values()
    by_task = defaultdict(list)
    for r in rows:
        by_task[(r["kind"], r["task"])].append(probs_of(r))

    print(f"# Temperature scaling, run `{args.run}`\n")
    print(
        "| kind | task | n | T (fit on task) | T (other tasks of kind) | T (all other tasks) | ECE raw | ECE @T-kind | ECE @T-all | NLL raw | NLL @T-all |"
    )
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for (kind, task), items in sorted(by_task.items()):
        own = fit(items)
        same_kind = [x for (k, t), v in by_task.items() if k == kind and t != task for x in v]
        others = [x for (k, t), v in by_task.items() if t != task for x in v]
        t_kind = fit(same_kind) if same_kind else float("nan")
        t_all = fit(others)
        print(
            f"| {kind} | {task} | {len(items)} | {own:.2f} | {t_kind:.2f} | {t_all:.2f} | {ece_of(items, 1):.3f} | "
            f"{ece_of(items, t_kind) if same_kind else float('nan'):.3f} | {ece_of(items, t_all):.3f} | {nll(items, 1):.3f} | {nll(items, t_all):.3f} |"
        )
    all_items = [x for v in by_task.values() for x in v]
    print(f"\nGlobal T on all rows: {fit(all_items):.2f}")
    for kind in ("choice", "score", "noul"):
        items = [x for (k, _), v in by_task.items() if k == kind for x in v]
        if items:
            print(f"  {kind}: T = {fit(items):.2f}")


if __name__ == "__main__":
    main()
