"""CPU arm bench: raw backend latency for torch-cpu / onnx-fp32 / onnx-int8 (and mps locally).

    uv run python bench/cpu_bench.py --model models/gliformer-large-v1 --configs onnx-fp32,onnx-int8,torch-fp32
    uv run python bench/cpu_bench.py --model models/gliformer-base-v1 --configs torch-mps,onnx-int8 --seq-lens 128,512

Rows go to bench/results/cpu.jsonl in the same shape as gpu.jsonl (see
bench/summarize.py). ``--drift`` also reports how far int8 scores move from
fp32 on a few realistic requests. Importable: ``deploy/modal_cpu.py::bench``
calls ``run_bench`` inside a CPU container.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

GROUPS_SPEC = [
    ("team", ("billing", "technical", "sales"), "Which team should handle this?"),
    ("frustration", ("calm", "annoyed", "angry"), "How frustrated is the customer?"),
    ("refund", ("yes", "no"), "Does the customer request a refund?"),
]

DRIFT_TEXTS = [
    "I was charged twice for my subscription this month and support hasn't replied in 3 days. I need this fixed today or I'm cancelling.",
    "The export button crashes Safari every time; works in Chrome.",
    "Hi! Just wondering if you offer discounts for annual plans. Thanks!",
    " ".join(["The service has been flaky all week and our customers are noticing."] * 30),
]


def make_backend(config: str, model: str, threads: int | None, batch_size: int = 32):
    from jeff.backends.torch_backend import TorchBackend

    if config.startswith("onnx-"):
        from jeff.backends.onnx_backend import OnnxBackend

        return OnnxBackend(model, quant=config.split("-", 1)[1], threads=threads, batch_size=batch_size)
    if config == "torch-fp32":
        import torch

        if threads:
            torch.set_num_threads(threads)
        return TorchBackend(model, device="cpu", dtype="float32", attn_kernel="eager", batch_size=batch_size)
    if config == "torch-mps":
        return TorchBackend(model, device="mps", attn_kernel="eager", batch_size=batch_size)
    raise ValueError(config)


def groups():
    from jeff.core import Group

    return [Group(key=k, labels=l, name=n) for k, l, n in GROUPS_SPEC]


def run_bench(backend, seq_lens=(128, 512), batch_sizes=(1, 4, 16), iters=5) -> list[dict]:
    gs = groups()
    rows = []
    for n in seq_lens:
        text = " ".join(["customer support ticket about billing"] * max(1, n // 6))
        for bs in batch_sizes:
            texts, gss = [text] * bs, [gs] * bs
            backend.score(texts, gss)  # warm this shape
            times = []
            for _ in range(iters):
                t0 = time.perf_counter()
                out = backend.score(texts, gss)
                times.append(time.perf_counter() - t0)
            ms = 1000 * statistics.median(times)
            rows.append(
                {
                    "seq_len_target": n,
                    "input_tokens": out[0].input_tokens,
                    "batch": bs,
                    "ms_per_batch": round(ms, 1),
                    "ms_per_text": round(ms / bs, 2),
                    "texts_per_s": round(1000 * bs / ms, 1),
                    "tokens_per_s": round(1000 * bs * out[0].input_tokens / ms),
                }
            )
            print("ROW", json.dumps(rows[-1]), file=sys.stderr)
    return rows


def score_drift(a, b) -> dict:
    """Max / mean absolute difference of raw label scores between two backends."""
    gs = groups()
    ra = a.score(DRIFT_TEXTS, [gs] * len(DRIFT_TEXTS))
    rb = b.score(DRIFT_TEXTS, [gs] * len(DRIFT_TEXTS))
    diffs = [abs(x - y) for sa, sb in zip(ra, rb) for k in sa.scores for x, y in zip(sa.scores[k], sb.scores[k])]
    return {"max_abs": round(max(diffs), 4), "mean_abs": round(statistics.mean(diffs), 4), "n": len(diffs)}


def host_name() -> str:
    return (
        os.environ.get("JEFF_BENCH_HOST")
        or f"local-{platform.system().lower()}-{platform.machine()}-{os.cpu_count()}cpu"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/gliformer-large-v1")
    ap.add_argument("--configs", default="onnx-fp32,onnx-int8,torch-fp32")
    ap.add_argument("--seq-lens", default="128,512")
    ap.add_argument("--batch-sizes", default="1,4,16")
    ap.add_argument("--iters", type=int, default=5)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--drift", action="store_true", help="report int8 vs fp32 score drift (needs both onnx configs)")
    ap.add_argument("--out", default="bench/results/cpu.jsonl")
    args = ap.parse_args()

    model_name = Path(args.model).name
    backends = {}
    with open(args.out, "a") as f:
        for cfg in args.configs.split(","):
            t0 = time.time()
            b = make_backend(cfg, args.model, args.threads or None)
            backends[cfg] = b
            print(f"{cfg}: loaded in {time.time() - t0:.1f}s {b.info()}", file=sys.stderr)
            rows = run_bench(
                b, [int(x) for x in args.seq_lens.split(",")], [int(x) for x in args.batch_sizes.split(",")], args.iters
            )
            f.writelines(
                json.dumps(
                    {
                        "config": cfg,
                        "model": model_name,
                        "device_name": host_name(),
                        "threads": args.threads or os.cpu_count(),
                        **r,
                    }
                )
                + "\n"
                for r in rows
            )
        if args.drift and "onnx-fp32" in backends and "onnx-int8" in backends:
            d = score_drift(backends["onnx-fp32"], backends["onnx-int8"])
            print("DRIFT int8 vs fp32:", d, file=sys.stderr)
            f.write(
                json.dumps({"config": "drift-int8-vs-fp32", "model": model_name, "device_name": host_name(), **d})
                + "\n"
            )


if __name__ == "__main__":
    main()
