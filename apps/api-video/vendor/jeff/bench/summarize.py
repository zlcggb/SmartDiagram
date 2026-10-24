"""Render bench/results/gpu.jsonl (from `modal run deploy/modal_gpu.py`) as markdown tables.

uv run python bench/summarize.py [bench/results/gpu.jsonl]
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


def _rows(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


# Modal on-demand GPU prices, USD/hour (modal.com/pricing, Sep 2026; update when they change).
PRICE_PER_HOUR = {
    "NVIDIA L4": 0.80,
    "NVIDIA A10": 1.10,
    "NVIDIA A10G": 1.10,
    "NVIDIA A100-SXM4-40GB": 2.10,
    "NVIDIA H100 80GB HBM3": 3.95,
}
JEV_PRICE_PER_M = 0.042
# Modal CPU containers: per physical core-hour and per GiB-hour (modal.com/pricing, Sep 2026).
CPU_PRICE_PER_CORE_HOUR = 0.192
MEM_PRICE_PER_GIB_HOUR = 0.024


def http_tables(path: str = "bench/results/http_modal.jsonl"):
    rows = _rows(path)
    print("## HTTP load tests (bench/load.py)\n")
    runs = []
    for r in rows:
        if r["run"] not in runs:
            runs.append(r["run"])
    for run in runs:
        print(f"### {run}\n")
        print("| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |")
        print("|---:|---:|---:|---:|---:|---|")
        for r in rows:
            if r["run"] == run:
                print(
                    f"| {r['concurrency']} | {r['rps']} | {r['p50_ms']} | {r['p95_ms']} | {r['p99_ms']} | {r['errors'] or ''} |"
                )
        print()


def main(path: str = "bench/results/gpu.jsonl"):
    rows = _rows(path)
    by = defaultdict(list)
    for r in rows:
        by[(r["device_name"], r["config"])].append(r)

    print("## Raw backend latency (no HTTP), gliformer-large-v1, bf16\n")
    print("Median of 10 calls after a warm call. `seq` = prompt+text tokens per request (3 questions).\n")
    for (dev, cfg), rs in sorted(by.items()):
        print(f"### {dev} — {cfg}\n")
        print("| seq | batch | ms/batch | ms/text | texts/s | tokens/s |")
        print("|---:|---:|---:|---:|---:|---:|")
        for r in sorted(rs, key=lambda r: (r["input_tokens"], r["batch"])):
            print(
                f"| {r['input_tokens']} | {r['batch']} | {r['ms_per_batch']} | {r['ms_per_text']} | {r['texts_per_s']} | {r['tokens_per_s']} |"
            )
        print()

    print("## Cost at peak throughput (flash, best batch)\n")
    print(f"jev list price: ${JEV_PRICE_PER_M}/M input tokens.\n")
    print("| GPU | $/h | peak tokens/s | $/M tokens | vs jev | bs=1 latency @149 tok |")
    print("|---|---:|---:|---:|---:|---:|")
    for dev in sorted({d for d, _ in by}):
        rs = by.get((dev, "flash"))
        if not rs:
            continue
        peak = max(r["tokens_per_s"] for r in rs)
        bs1 = min(r["ms_per_batch"] for r in rs if r["batch"] == 1)
        price = PRICE_PER_HOUR.get(dev)
        if price is None:
            print(f"| {dev} | ? | {peak} | ? | ? | {bs1} ms |")
            continue
        per_m = price / (peak * 3600 / 1e6)
        print(f"| {dev} | {price:.2f} | {peak} | {per_m:.4f} | {JEV_PRICE_PER_M / per_m:.0f}x cheaper | {bs1} ms |")


def cpu_tables(path: str = "bench/results/cpu.jsonl"):
    if not Path(path).exists():
        return
    rows = _rows(path)
    print("## CPU arm: raw backend latency (bench/cpu_bench.py)\n")
    print(
        "Median of 5 calls after a warm call, same 3-question request. `torch-fp32` is eager PyTorch on CPU; `onnx-*` runs the DeBERTa encoder in ONNX Runtime (rest in torch).\n"
    )
    by = defaultdict(list)
    drift = []
    for r in rows:
        if r["config"].startswith("drift"):
            drift.append(r)
        else:
            by[(r["model"], r["device_name"], r["config"])].append(r)
    for (model, dev, cfg), rs in sorted(by.items()):
        print(f"### {model} — {dev} — {cfg} ({rs[0].get('threads')} threads)\n")
        print("| seq | batch | ms/batch | ms/text | texts/s | tokens/s |")
        print("|---:|---:|---:|---:|---:|---:|")
        for r in sorted(rs, key=lambda r: (r["input_tokens"], r["batch"])):
            print(
                f"| {r['input_tokens']} | {r['batch']} | {r['ms_per_batch']} | {r['ms_per_text']} | {r['texts_per_s']} | {r['tokens_per_s']} |"
            )
        print()
    if drift:
        print("### int8 vs fp32 raw score drift\n")
        print("| model | host | max abs | mean abs | n scores |")
        print("|---|---|---:|---:|---:|")
        for r in drift:
            print(f"| {r['model']} | {r['device_name']} | {r['max_abs']} | {r['mean_abs']} | {r['n']} |")
        print()
    modal_rows = [(k, rs) for k, rs in by.items() if k[1].startswith("modal-cpu-")]
    if modal_rows:
        print("### Cost at peak throughput on Modal CPU containers\n")
        print("| model | container | config | peak tokens/s | $/h | $/M tokens | vs jev | bs=1 latency @149 tok |")
        print("|---|---|---|---:|---:|---:|---:|---:|")
        for (model, dev, cfg), rs in sorted(modal_rows):
            cores = int(dev.rsplit("-", 1)[1])
            gib = 8  # deploy default JEFF_MEMORY_MB=8192
            price = cores * CPU_PRICE_PER_CORE_HOUR + gib * MEM_PRICE_PER_GIB_HOUR
            peak = max(r["tokens_per_s"] for r in rs)
            bs1 = min((r["ms_per_batch"] for r in rs if r["batch"] == 1 and r["seq_len_target"] == 128), default=None)
            per_m = price / (peak * 3600 / 1e6)
            ratio = JEV_PRICE_PER_M / per_m
            vs = f"{ratio:.1f}x cheaper" if ratio >= 1 else f"{1 / ratio:.0f}x more expensive"
            print(f"| {model} | {dev} | {cfg} | {peak} | {price:.2f} | {per_m:.4f} | {vs} | {bs1} ms |")
        print()


if __name__ == "__main__":
    main(*sys.argv[1:])
    http_tables()
    cpu_tables()
