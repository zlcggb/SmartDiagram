"""Async load generator for a jeff (or jev) endpoint.

    uv run python bench/load.py --url http://localhost:8000 --key devkey -c 1 8 32 -n 200

Reports p50/p95/p99 latency, req/s and tokens/s per concurrency level, and
optionally appends a JSON line per level to --out for bench/RESULTS.md.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

import httpx

REQ = {
    "state": "I was charged twice for my subscription this month and support hasn't replied in 3 days. "
    "I need this fixed today or I'm cancelling.",
    "model": "jev-latest",
    "questions": {
        "team": {
            "type": "choice",
            "instructions": "Which team should handle this?",
            "criteria": {"billing": None, "technical": None, "sales": None},
        },
        "frustration": {
            "type": "score",
            "instructions": "How frustrated is the customer?",
            "criteria": ["calm", "annoyed", "angry"],
        },
        "refund": {"type": "noul", "instructions": "Does the customer request a refund?"},
    },
}


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    k = min(len(xs) - 1, max(0, round(p / 100 * (len(xs) - 1))))
    return xs[k]


async def run_level(
    url: str, headers: dict, body: dict, concurrency: int, n: int, timeout: float, path: str = "/v1/systemone"
) -> dict:
    lat: list[float] = []
    errors: dict[str, int] = {}
    tokens = 0
    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(timeout=timeout, limits=httpx.Limits(max_connections=concurrency + 4)) as client:
        # warm the connection pool / model once
        await client.post(url + path, json=body, headers=headers)

        async def one():
            nonlocal tokens
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await client.post(url + path, json=body, headers=headers)
                    dt = time.perf_counter() - t0
                    if r.status_code == 200:
                        lat.append(dt)
                        tokens += r.json().get("usage", {}).get("input_tokens", 0)
                    else:
                        errors[str(r.status_code)] = errors.get(str(r.status_code), 0) + 1
                except Exception as e:  # noqa: BLE001
                    errors[type(e).__name__] = errors.get(type(e).__name__, 0) + 1

        t0 = time.perf_counter()
        await asyncio.gather(*(one() for _ in range(n)))
        wall = time.perf_counter() - t0

    ok = len(lat)
    return {
        "concurrency": concurrency,
        "n": n,
        "ok": ok,
        "errors": errors,
        "wall_s": round(wall, 2),
        "rps": round(ok / wall, 1) if wall else 0,
        "tokens_per_s": round(tokens / wall) if wall else 0,
        "p50_ms": round(1000 * statistics.median(lat), 1) if lat else None,
        "p95_ms": round(1000 * pct(lat, 95), 1) if lat else None,
        "p99_ms": round(1000 * pct(lat, 99), 1) if lat else None,
        "mean_ms": round(1000 * statistics.fmean(lat), 1) if lat else None,
    }


def _append(path: str, row: dict):
    with open(path, "a") as f:
        f.write(json.dumps(row) + "\n")


async def main_async(a: argparse.Namespace):
    headers = {"Authorization": f"Bearer {a.key}"} if a.key else {}
    body = json.loads(Path(a.request).read_text()) if a.request else REQ
    rows = []
    for c in a.concurrency:
        row = await run_level(a.url, headers, body, c, max(a.n, c), a.timeout)
        row["label"] = a.label
        rows.append(row)
        print(json.dumps(row))
        if a.out:
            _append(a.out, row)
    if a.stats:
        async with httpx.AsyncClient(timeout=a.timeout) as client:
            r = await client.get(a.url + "/stats", headers=headers)
            print("stats:", r.text)
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://localhost:8000")
    p.add_argument("--key", default="")
    p.add_argument("-c", "--concurrency", type=int, nargs="+", default=[1, 8, 32])
    p.add_argument("-n", type=int, default=200, help="requests per concurrency level")
    p.add_argument("--timeout", type=float, default=120)
    p.add_argument("--request", help="JSON file with a custom request body")
    p.add_argument("--label", default="", help="tag rows (e.g. gpu name) when writing --out")
    p.add_argument("--out", help="append JSONL rows here")
    p.add_argument("--stats", action="store_true", help="print /stats after the run")
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
