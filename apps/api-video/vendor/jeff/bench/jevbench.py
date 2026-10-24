"""Run JevBench (github.com/fstandhartinger/jevbench) public tiers against a jev-compatible endpoint.

    uv run python bench/jevbench.py run --url http://localhost:8000 --name jeff-local-mps --endpoint-kind cpu
    uv run python bench/jevbench.py run --url https://...modal.run --key k1 --name jeff-l4 --endpoint-kind gpu \
        --price-in-per-m 0.030
    uv run python bench/jevbench.py run --url https://api.typesafe.ai --key-env TYPESAFE_API_KEY --name jev \
        --endpoint-kind api --price-in-per-m 0.042
    uv run python bench/jevbench.py summarize

`run` clones jevbench at JEVBENCH_COMMIT into bench/.jevbench/repo (once), runs the three public tiers
(easy 48, standard/original 72, hard 111 decisions) one request at a time through jevbench's own
`typesafe` adapter, and stores per-item records in bench/results/jevbench/<name>/<tier>.jsonl. Raw
responses and the budget ledger stay in bench/.jevbench/runs/<name> (gitignored).

`summarize` scores every stored run with jevbench's own code (jevbench.summarize, jevbench.composite_v12)
and prints markdown. The JevBench Score needs four axes: Intelligence is renormalised over the public
tiers because the judge tier is not published; Calibration uses the hard tier (ECE and fidelity to the
gold distributions of the probability items); Speed uses the standard tier (jevbench uses the 242-item
standard+judge run) with jevbench's endpoint-kind adjustment; Cost is measured tokens x --price-in-per-m
(jeff has no tariff: pass the Modal-derived per-token cost from bench/RESULTS.md as a labelled estimate).
Published systems are shown on the same public items from jevbench's per-task artifact.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JEVBENCH_URL = "https://github.com/fstandhartinger/jevbench"
JEVBENCH_COMMIT = "e105a48f8cdb7f3babb3594424f73e5d7bdc97b9"  # v1.2.2, 2026-09-19 (adds jeff)
CACHE = ROOT / "bench" / ".jevbench"
REPO = CACHE / "repo"
OUT = ROOT / "bench" / "results" / "jevbench"
TIERS = {"easy": "easy", "standard": "original", "hard": "hard"}  # jevbench tier -> public dataset file
ENDPOINT_KINDS = ("api", "gpu", "cpu", "demo")
PUBLISHED = [
    "classifier-dev-fast",
    "jev-1.13.0",
    "djev",
    "semif-qwen3.5-4b",
    "laya",
    "jeff",
    "open-jev-deberta-v3-large",
]


def ensure_repo() -> Path:
    if not (REPO / "jevbench" / "cli.py").exists():
        REPO.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", JEVBENCH_URL, str(REPO)], check=True)
    head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
    if head.stdout.strip() != JEVBENCH_COMMIT:
        subprocess.run(["git", "-C", str(REPO), "fetch", "-q", "origin"], check=True)
        subprocess.run(["git", "-C", str(REPO), "checkout", "-q", JEVBENCH_COMMIT], check=True)
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    return REPO


def cmd_run(args: argparse.Namespace) -> int:
    repo = ensure_repo()
    run_dir = OUT / args.name
    scratch = CACHE / "runs" / args.name
    if run_dir.exists() or scratch.exists():
        if not args.force:
            print(f"{run_dir} exists; pick another --name or pass --force", file=sys.stderr)
            return 2
        shutil.rmtree(run_dir, ignore_errors=True)
        shutil.rmtree(scratch, ignore_errors=True)
    run_dir.mkdir(parents=True)
    scratch.mkdir(parents=True)

    env = dict(os.environ)
    key_env = args.key_env
    if args.key:
        key_env = "JEFF_JEVBENCH_KEY"
        env[key_env] = args.key
    if key_env and not env.get(key_env):
        print(f"env var {key_env} is empty; pass --key, --key-env, or --key-env '' for no auth", file=sys.stderr)
        return 2

    started = dt.datetime.now(dt.UTC).isoformat()
    manifests = {}
    for tier in args.tiers.split(","):
        ds = repo / "datasets" / "public" / f"{TIERS[tier]}.jsonl"
        cmd = [
            sys.executable,
            "-m",
            "jevbench.cli",
            "run",
            "--tasks",
            str(ds),
            "--adapter",
            "typesafe",
            "--endpoint",
            args.url,
            "--key-env",
            key_env,
            "--model",
            args.model,
            "--cost-basis",
            args.cost_basis,
            "--results",
            str(run_dir / f"{tier}.jsonl"),
            "--raw-dir",
            str(scratch / tier / "raw"),
            "--ledger",
            str(scratch / "ledger.jsonl"),
            "--manifest",
            str(scratch / f"{tier}.manifest.json"),
            "--cap-usd",
            str(args.cap_usd),
            "--reserve-usd",
            str(args.reserve_usd),
            "--delay-s",
            str(args.delay_s),
        ]
        if args.price_in_per_m is not None:
            cmd += ["--price-in-per-m", str(args.price_in_per_m), "--price-out-per-m", str(args.price_out_per_m)]
        print(f"[jevbench.py] {tier}: {ds.name}", flush=True)
        rc = subprocess.run(cmd, cwd=repo, env=env, check=False).returncode
        if rc not in (0, 3):
            print(f"jevbench run failed for {tier} (rc={rc})", file=sys.stderr)
            return rc
        manifests[tier] = json.loads((scratch / f"{tier}.manifest.json").read_text())

    manifest = {
        "name": args.name,
        "url": args.url,
        "endpoint_kind": args.endpoint_kind,
        "model": args.model,
        "auth": bool(key_env),
        "cost_basis": args.cost_basis,
        "price_in_per_m": args.price_in_per_m,
        "price_out_per_m": args.price_out_per_m,
        "price_note": args.price_note,
        "jevbench_commit": JEVBENCH_COMMIT,
        "started_utc": started,
        "finished_utc": dt.datetime.now(dt.UTC).isoformat(),
        "tiers": {
            t: {k: m[k] for k in ("dataset_hash", "n_planned", "n_attempted", "resolved_models")}
            for t, m in manifests.items()
        },
        "note": args.note,
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"[jevbench.py] wrote {run_dir}")
    return 0


# --- summarize -------------------------------------------------------------------------------------------


def _records(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def score_run(run_dir: Path) -> dict:
    from jevbench import composite_v12 as C  # ty: ignore[unresolved-import]  (cloned by ensure_repo)
    from jevbench.summarize import summarize  # ty: ignore[unresolved-import]
    from jevbench.tasks import load_jsonl  # ty: ignore[unresolved-import]

    manifest = json.loads((run_dir / "manifest.json").read_text())
    tiers: dict[str, dict] = {}
    all_records: list[dict] = []
    for tier, ds in TIERS.items():
        path = run_dir / f"{tier}.jsonl"
        if not path.exists():
            continue
        tasks = load_jsonl(str(REPO / "datasets" / "public" / f"{ds}.jsonl"))
        records = _records(path)
        s = summarize(tasks, records)
        entry = {
            "n": len(tasks),
            "attempted": len(records),
            "failed": sum(1 for r in records if not r["ok"]),
            "correct": s["n_correct"],
            "accuracy": s["n_correct"] / len(tasks),  # unattempted count as wrong
            "brier": s["brier_mean"],
            "ece": s["ece"]["ece"] if s["ece"] else None,
            "p50_s": s["latency"]["p50_s"],
            "p95_s": s["latency"]["p95_s"],
            "first_s": records[0]["latency_s"] if records else None,
            "by_family": {f: (v["n_correct"], v["n_scorable"]) for f, v in s["per_family"].items()},
            "input_tokens": statistics.mean(r["usage"].get("input_tokens", 0) for r in records if r["ok"])
            if any(r["ok"] for r in records)
            else None,
        }
        if tier == "hard":
            by = {t.id: t for t in tasks}
            tvds = []
            for r in records:
                gold = by[r["task_id"]].provenance.get("gold_probs")
                if gold and r.get("probs"):
                    tvds.append(C.tvd(r["probs"], gold, by[r["task_id"]].labels))
            mean_tvd = statistics.mean(tvds) if tvds else None
            entry["mean_tvd"] = mean_tvd
            entry["fidelity"] = None if mean_tvd is None else 100 * (1 - mean_tvd)
        tiers[tier] = entry
        all_records += records

    costs = [r["cost_usd"] for r in all_records]
    usd_per_1000 = sum(costs) * 1000 / len(costs) if costs and all(c is not None for c in costs) else None
    kind = manifest["endpoint_kind"]
    hard = tiers.get("hard") or {}
    std = tiers.get("standard") or {}
    axes = {
        "intelligence": C.intelligence({t: v["accuracy"] for t, v in tiers.items()}),
        "calibration": C.calibration(hard.get("ece"), hard.get("mean_tvd")) if hard else None,
        "speed": C.speed(std.get("p50_s"), std.get("p95_s"), kind) if std else None,
        "cost": C.cost(usd_per_1000) if usd_per_1000 else None,
    }
    complete = all(v is not None for v in axes.values())
    return {
        "name": manifest["name"],
        "manifest": manifest,
        "tiers": tiers,
        "axes": axes,
        "usd_per_1000": usd_per_1000,
        "kind": kind,
        "p50_adj": C.adjusted_latency(std.get("p50_s"), kind) if std else None,
        "p95_adj": C.adjusted_latency(std.get("p95_s"), kind) if std else None,
        "jevbench_score": C.jevbench_score(axes) if complete else None,
        "presets": {n: C.preset_score(axes, w) for n, w in C.PRESETS.items()} if complete else {},
    }


def official_rows() -> list[dict]:
    return json.loads((REPO / "results" / "v1.2" / "jevbench-v1.2-results.json").read_text())["systems"]


def published_rows() -> list[dict]:
    """Published systems scored on the same public items (jevbench's per-task artifact) plus their official row."""
    per_task = json.loads((REPO / "results" / "v1.2" / "jevbench-v1.2-per-task.json").read_text())
    results = json.loads((REPO / "results" / "v1.2" / "jevbench-v1.2-results.json").read_text())
    official = {s["key"]: s for s in results["systems"]}
    tier_of = {t["id"]: t["tier"] for t in per_task["tasks"]}
    rows = []
    for key in PUBLISHED:
        sysrow = per_task["systems"].get(key)
        if not sysrow:
            continue
        counts: dict[str, list[int]] = {t: [0, 0] for t in TIERS}
        for tid, (outcome, _p) in sysrow["public_tasks"].items():
            tier = tier_of[tid]
            if tier in counts:
                counts[tier][1] += 1
                counts[tier][0] += outcome == "c"
        rows.append({"key": key, "display": sysrow["display"], "public": counts, "official": official.get(key)})
    return rows


def _pct(x):
    return "" if x is None else f"{100 * x:.1f}%"


def _f(x, nd=3):
    return "" if x is None else f"{x:.{nd}f}"


def _ms(x):
    return "" if x is None else f"{1000 * x:.0f}"


def cmd_summarize(args: argparse.Namespace) -> int:
    ensure_repo()
    runs = [score_run(p) for p in sorted(OUT.iterdir()) if (p / "manifest.json").exists()]
    if not runs:
        print("no runs in", OUT, file=sys.stderr)
        return 1
    print(f"## JevBench public tiers (jevbench @ {JEVBENCH_COMMIT[:7]}, one request at a time)\n")
    print(
        "| run | endpoint | easy (48) | standard (72) | hard (111) | hard Brier | hard ECE | hard fidelity | std p50 ms | std p95 ms | hard p50 ms | first ms | $/1k decisions |"
    )
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in runs:
        t = r["tiers"]
        h = t.get("hard", {})
        print(
            f"| {r['name']} | {r['kind']} | {_pct(t.get('easy', {}).get('accuracy'))} | {_pct(t.get('standard', {}).get('accuracy'))} | "
            f"{_pct(h.get('accuracy'))} | {_f(h.get('brier'))} | {_f(h.get('ece'))} | {_f(h.get('fidelity'), 1)} | "
            f"{_ms(t.get('standard', {}).get('p50_s'))} | {_ms(t.get('standard', {}).get('p95_s'))} | {_ms(h.get('p50_s'))} | "
            f"{_ms(t.get('easy', {}).get('first_s'))} | {_f(r['usd_per_1000'], 4)} |"
        )
    print()
    print("### Published systems on the same public items (jevbench results/v1.2 per-task artifact)\n")
    print("| system | easy (48) | standard (72) | hard (111) | official hard (220) | official JevBench Score (rank) |")
    print("|---|---:|---:|---:|---:|---:|")
    ranked = sorted((r for r in official_rows() if r["ranked"]), key=lambda r: -r["jevbench_score"])
    rank = {r["key"]: i + 1 for i, r in enumerate(ranked)}
    for p in published_rows():
        c = p["public"]
        off = p["official"] or {}
        print(
            f"| {p['display']} | {_pct(c['easy'][0] / c['easy'][1])} | {_pct(c['standard'][0] / c['standard'][1])} | "
            f"{_pct(c['hard'][0] / c['hard'][1])} | {_pct((off.get('tiers') or {}).get('hard'))} | "
            f"{_f(off.get('jevbench_score'), 1)}{f' (#{rank[p["key"]]})' if p['key'] in rank else ''} |"
        )
    print()
    print("### JevBench Score axes (composite_v12; Intelligence without the unpublished judge tier)\n")
    print("| run | Intelligence | Calibration | Speed (adj. p50/p95 ms) | Cost | JevBench Score | Intelligence only |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for r in runs:
        a = r["axes"]
        print(
            f"| {r['name']} | {_f(a['intelligence'], 1)} | {_f(a['calibration'], 1)} | "
            f"{_f(a['speed'], 1)} ({_ms(r['p50_adj'])}/{_ms(r['p95_adj'])}) | {_f(a['cost'], 1)} | "
            f"{_f(r['jevbench_score'], 1)} | {_f(r['presets'].get('Intelligence only'), 1)} |"
        )
    print()
    print("### Hard tier by family (correct / n)\n")
    fams = sorted({f for r in runs for f in r["tiers"].get("hard", {}).get("by_family", {})})
    print("| family | " + " | ".join(r["name"] for r in runs) + " |")
    print("|---|" + "---:|" * len(runs))
    for f in fams:
        cells = []
        for r in runs:
            c, n = r["tiers"].get("hard", {}).get("by_family", {}).get(f, (None, None))
            cells.append("" if c is None else f"{c}/{n}")
        print(f"| {f} | " + " | ".join(cells) + " |")
    print()
    for r in runs:
        m = r["manifest"]
        print(
            f"- `{r['name']}`: {m['url']} ({m['endpoint_kind']}), model `{m['model']}`, price "
            f"{m['price_in_per_m']}/M in, {m['price_out_per_m']}/M out. {m.get('price_note') or ''} {m.get('note') or ''}".rstrip()
        )
    if args.json:
        Path(args.json).write_text(
            json.dumps([{k: v for k, v in r.items() if k != "manifest"} for r in runs], indent=2) + "\n"
        )
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("--url", required=True)
    p.add_argument("--name", required=True, help="run directory name under bench/results/jevbench/")
    p.add_argument(
        "--endpoint-kind",
        choices=ENDPOINT_KINDS,
        required=True,
        help="jevbench speed adjustment: api = production (none); gpu/cpu = own server (x2 + 0.15 s); demo = x2",
    )
    p.add_argument("--key", default=None, help="bearer key (kept in the environment for the child process)")
    p.add_argument("--key-env", default="", help="env var holding the bearer key; empty sends no Authorization header")
    p.add_argument("--model", default="jev-latest")
    p.add_argument("--tiers", default=",".join(TIERS))
    p.add_argument("--cost-basis", default="self_hosted_estimate")
    p.add_argument("--price-in-per-m", type=float, default=None)
    p.add_argument("--price-out-per-m", type=float, default=0.0)
    p.add_argument("--price-note", default=None, help="where the price comes from (printed with the results)")
    p.add_argument("--cap-usd", type=float, default=5.0)
    p.add_argument("--reserve-usd", type=float, default=0.0)
    p.add_argument("--delay-s", type=float, default=0.0)
    p.add_argument("--note", default=None)
    p.add_argument("--force", action="store_true", help="replace an existing run of the same name")
    p.set_defaults(fn=cmd_run)
    s = sub.add_parser("summarize")
    s.add_argument("--json", default=None, help="also write the scored runs as JSON")
    s.set_defaults(fn=cmd_summarize)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
