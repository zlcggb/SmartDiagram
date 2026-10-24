"""GPU arm on Modal: jeff's FastAPI app in front of GLiFormer on a CUDA GPU.

    modal run deploy/modal_gpu.py::download            # weights -> Volume "jeff-models" (once)
    modal run deploy/modal_gpu.py::bench               # raw backend latency on JEFF_GPU
    JEFF_GPU=L4 JEFF_API_KEYS=k1 modal deploy deploy/modal_gpu.py
    modal serve deploy/modal_gpu.py                    # ephemeral URL for load tests

Environment at deploy/run time (all optional): JEFF_GPU (default L4), JEFF_MODEL_REPO,
JEFF_MIN_CONTAINERS (default 1), JEFF_MAX_INPUTS (concurrent requests per
container, default 64) and every server JEFF_* var (API keys, batcher, compile
options), which is forwarded into the container as a Secret.
"""

from __future__ import annotations

import os
import sys
import time

import modal

GPU = os.environ.get("JEFF_GPU", "L4")
MODEL_REPO = os.environ.get("JEFF_MODEL_REPO", "knowledgator/gliformer-large-v1")
MODEL_DIRNAME = MODEL_REPO.split("/")[-1]
MODELS_MOUNT = "/models"
# Keep warm containers only for deploy, not benchmarks or ephemeral servers.
MIN_CONTAINERS = int(os.environ.get("JEFF_MIN_CONTAINERS", "1")) if "deploy" in sys.argv else 0
MAX_INPUTS = int(os.environ.get("JEFF_MAX_INPUTS", "64"))
# Scale early: measured ingress caps at ~50 req/s per container (bench/RESULTS.md).
TARGET_INPUTS = int(os.environ.get("JEFF_TARGET_INPUTS", "16"))
MAX_CONTAINERS = int(os.environ.get("JEFF_MAX_CONTAINERS", "8"))

# Local env overrides these defaults. Compilation was slower than flash alone (bench/RESULTS.md).
SERVER_DEFAULTS: dict[str, str | None] = {
    "JEFF_BACKEND": "torch",
    "JEFF_DEVICE": "cuda",
    "JEFF_ATTN": "auto",
    "JEFF_COMPILE": "0",
    "JEFF_PAD_MULTIPLE": "0",
    "JEFF_WARMUP": "1",
    "JEFF_MAX_BATCH": "32",
    "JEFF_MAX_WAIT_MS": "10",
    "JEFF_MODEL": f"{MODELS_MOUNT}/{MODEL_DIRNAME}",
    "JEFF_MODEL_NAME": MODEL_DIRNAME,
    "PYTHONPATH": "/root/src",
    "PYTHONUNBUFFERED": "1",
}
forwarded = {k: v for k, v in os.environ.items() if k.startswith("JEFF_")}
server_env = {**SERVER_DEFAULTS, **forwarded}

app = modal.App(
    os.environ.get("JEFF_APP_NAME", "jeff-gpu")
)  # override for side runs so they do not replace the served URL
volume = modal.Volume.from_name("jeff-models", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "torch>=2.6",
        "flashdeberta>=0.0.7",
        "gliformer>=0.1.2",
        "fastapi>=0.115",
        "uvicorn[standard]>=0.30",
        "pydantic>=2.7",
        "httpx>=0.27",
        "huggingface-hub>=0.24",
        "hf-transfer",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .add_local_dir("src", remote_path="/root/src")
    .add_local_dir("bench", remote_path="/root/bench", ignore=["results/**", "data/**", "__pycache__/**"])
)


@app.function(image=image, volumes={MODELS_MOUNT: volume}, timeout=60 * 30)
def download(repo: str = MODEL_REPO, force: bool = False):
    """Cache weights in the shared Volume."""
    from huggingface_hub import snapshot_download

    target = f"{MODELS_MOUNT}/{repo.split('/')[-1]}"
    if os.path.exists(f"{target}/gliner_config.json") and not force:
        print("already present:", target)
        return target
    snapshot_download(repo, local_dir=target, ignore_patterns=["*.gif", "*.md"])
    volume.commit()
    print("downloaded to", target)
    return target


def _ensure_weights():
    """Reload the Volume and download missing weights."""
    volume.reload()
    if not os.path.exists(f"{MODELS_MOUNT}/{MODEL_DIRNAME}/gliner_config.json"):
        from huggingface_hub import snapshot_download

        snapshot_download(MODEL_REPO, local_dir=f"{MODELS_MOUNT}/{MODEL_DIRNAME}", ignore_patterns=["*.gif", "*.md"])
        volume.commit()


@app.cls(
    image=image,
    gpu=GPU,
    volumes={MODELS_MOUNT: volume},
    secrets=[modal.Secret.from_dict(server_env)],
    min_containers=MIN_CONTAINERS,
    max_containers=MAX_CONTAINERS,
    scaledown_window=300,
    timeout=120,
    startup_timeout=60 * 15,  # weight download + warmup
)
@modal.concurrent(max_inputs=MAX_INPUTS, target_inputs=TARGET_INPUTS)  # concurrent requests feed the dynamic batcher
class Server:
    @modal.enter()
    def load(self):
        from jeff.server.app import _load_engine, create_app
        from jeff.server.config import Settings

        _ensure_weights()
        self.settings = Settings()
        self.engine = _load_engine(self.settings)
        self.app = create_app(self.settings, engine=self.engine)

    @modal.asgi_app()
    def web(self):
        return self.app


@app.function(
    image=image,
    gpu=GPU,
    volumes={MODELS_MOUNT: volume},
    secrets=[modal.Secret.from_dict(server_env)],
    timeout=60 * 30,
)
def bench(seq_lens: str = "128,512,1024", batch_sizes: str = "1,4,16,32", iters: int = 10, env: str = ""):
    """Measure backend latency per sequence length and batch size, without HTTP.

    env accepts comma-separated overrides, e.g. JEFF_COMPILE=0,JEFF_ATTN=flash.
    """
    import json
    import statistics

    import torch

    from jeff.backends.torch_backend import from_env
    from jeff.core import Group

    _ensure_weights()
    for kv in filter(None, env.split(",")):
        k, v = kv.split("=", 1)
        os.environ[k] = v
    if os.environ.get("JEFF_DEBUG_COMPILE") == "1":
        torch._logging.set_logs(recompiles=True, graph_breaks=True)
    b = from_env()
    props = torch.cuda.get_device_properties(0)
    header = {"gpu": GPU, "device_name": props.name, "env": env, **b.info()}
    print("HEADER", json.dumps(header))
    groups = [
        Group(key="team", labels=("billing", "technical", "sales"), name="Which team should handle this?"),
        Group(key="frustration", labels=("calm", "annoyed", "angry"), name="How frustrated is the customer?"),
        Group(key="refund", labels=("Does the customer request a refund?",)),
    ]
    rows = []
    for n in (int(x) for x in seq_lens.split(",")):
        text = " ".join(["customer support ticket about billing"] * max(1, n // 6))
        for bs in (int(x) for x in batch_sizes.split(",")):
            texts: list[str] = [text] * bs
            gs = [groups] * bs
            b.score(texts, gs)  # warm this shape
            torch.cuda.synchronize()
            times = []
            for _ in range(iters):
                t0 = time.perf_counter()
                out = b.score(texts, gs)
                torch.cuda.synchronize()
                times.append(time.perf_counter() - t0)
            ms = 1000 * statistics.median(times)
            row = {
                "gpu": GPU,
                "env": env,
                "seq_len_target": n,
                "input_tokens": out[0].input_tokens,
                "batch": bs,
                "ms_per_batch": round(ms, 1),
                "ms_per_text": round(ms / bs, 2),
                "texts_per_s": round(1000 * bs / ms, 1),
                "tokens_per_s": round(1000 * bs * out[0].input_tokens / ms),
            }
            rows.append(row)
            print("ROW", json.dumps(row))
    return {"header": header, "rows": rows}


CONFIGS = {
    "flash": "JEFF_COMPILE=0,JEFF_ATTN=flash",
    "eager": "JEFF_COMPILE=0,JEFF_ATTN=eager",
    "flash+compile": "JEFF_COMPILE=1,JEFF_ATTN=flash",
    "eager+compile": "JEFF_COMPILE=1,JEFF_ATTN=eager",
    "flash+compile+debug": "JEFF_COMPILE=1,JEFF_ATTN=flash,JEFF_DEBUG_COMPILE=1",
    "flash-fp16": "JEFF_COMPILE=0,JEFF_ATTN=flash,JEFF_DTYPE=float16",
}


@app.function(
    image=image, gpu=GPU, volumes={MODELS_MOUNT: volume}, secrets=[modal.Secret.from_dict(server_env)], timeout=60 * 30
)
def dtype_check(dtypes: str = "bfloat16,float16"):
    """Compare raw label scores across dtypes."""
    import json

    from jeff.backends.torch_backend import TorchBackend
    from jeff.core import Group

    _ensure_weights()
    groups = [
        Group(key="team", labels=("billing", "technical", "sales"), name="Which team should handle this?"),
        Group(key="frustration", labels=("calm", "annoyed", "angry"), name="How frustrated is the customer?"),
        Group(key="refund", labels=("Does the customer request a refund?",)),
        Group(key="sev", labels=("cosmetic", "degraded", "blocking"), name="How severe is the bug?"),
    ]
    texts: list[str] = [
        "I was charged twice for my subscription this month and support hasn't replied in 3 days. I need this fixed today or I'm cancelling.",
        "The export button crashes Safari every time; works in Chrome.",
        "Hi! Just wondering if you offer discounts for annual plans. Thanks!",
        " ".join(["The service has been flaky all week and our customers are noticing."] * 30),
    ]
    out = {}
    for dt in dtypes.split(","):
        b = TorchBackend(os.environ["JEFF_MODEL"], device="cuda", dtype=dt, attn_kernel="flash")
        out[dt] = [r.scores for r in b.score(texts, [groups] * len(texts))]
        del b
    base = dtypes.split(",")[0]
    report = {}
    for dt, scores in out.items():
        if dt == base:
            continue
        diffs = [abs(a - b) for sa, sb in zip(out[base], scores) for k in sa for a, b in zip(sa[k], sb[k])]
        report[dt] = {
            "vs": base,
            "max_abs_diff": round(max(diffs), 4),
            "mean_abs_diff": round(sum(diffs) / len(diffs), 5),
            "n": len(diffs),
        }
    print("DTYPE", json.dumps(report))
    return report


@app.function(
    image=image, gpu=GPU, volumes={MODELS_MOUNT: volume}, secrets=[modal.Secret.from_dict(server_env)], timeout=60 * 30
)
def profile(seq_len: int = 128, batch: int = 1, iters: int = 20):
    """Profile forward time, preprocessing/decoding overhead, and CPU/CUDA work."""
    import json
    import statistics

    import torch
    from torch.profiler import ProfilerActivity
    from torch.profiler import profile as tprofile

    from jeff.backends.torch_backend import from_env
    from jeff.core import Group

    _ensure_weights()
    b = from_env()
    groups = [
        Group(key="team", labels=("billing", "technical", "sales"), name="Which team should handle this?"),
        Group(key="frustration", labels=("calm", "annoyed", "angry"), name="How frustrated is the customer?"),
        Group(key="refund", labels=("Does the customer request a refund?",)),
    ]
    text = " ".join(["customer support ticket about billing"] * max(1, seq_len // 6))
    texts: list[str] = [text] * batch
    gs = [groups] * batch
    for _ in range(3):
        b.score(texts, gs)
    torch.cuda.synchronize()

    # 1) stage timing by wrapping the pieces score() uses
    m = b.model
    _prep, fwd, total = [], [], []
    orig_forward = m.model.forward

    def timed_forward(*a, **k):
        torch.cuda.synchronize()
        t0 = time.perf_counter()
        r = orig_forward(*a, **k)
        torch.cuda.synchronize()
        fwd.append(time.perf_counter() - t0)
        return r

    m.model.forward = timed_forward
    for _ in range(iters):
        t0 = time.perf_counter()
        b.score(texts, gs)
        torch.cuda.synchronize()
        total.append(time.perf_counter() - t0)
    m.model.forward = orig_forward
    stage = {
        "seq_len": seq_len,
        "batch": batch,
        "total_ms": round(1000 * statistics.median(total), 1),
        "model_forward_ms": round(1000 * statistics.median(fwd), 1),
        "outside_forward_ms": round(1000 * (statistics.median(total) - statistics.median(fwd)), 1),
    }

    # 2) CPU vs CUDA inside the forward
    with tprofile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
        for _ in range(5):
            b.score(texts, gs)
        torch.cuda.synchronize()
    ka = prof.key_averages()
    cuda_total = sum(getattr(e, "device_time_total", getattr(e, "cuda_time_total", 0)) for e in ka) / 5 / 1000
    n_kernels = (
        sum(e.count for e in ka if getattr(e, "device_time_total", getattr(e, "cuda_time_total", 0)) > 0 and e.count)
        / 5
    )
    stage["cuda_busy_ms_per_call"] = round(cuda_total, 1)
    stage["cuda_ops_per_call"] = int(n_kernels)
    print("PROFILE", json.dumps(stage))
    print(ka.table(sort_by="cuda_time_total", row_limit=15))
    print(ka.table(sort_by="cpu_time_total", row_limit=15))
    return stage


@app.function(image=image, timeout=60 * 30)
def loadtest(
    url: str,
    key: str = "",
    concurrency: str = "1,8,32,64,128",
    n: int = 300,
    label: str = "",
    path: str = "/v1/systemone",
):
    """Run bench/load.py inside Modal to exclude client WAN latency."""
    import asyncio
    import json
    import sys

    sys.path.insert(0, "/root/bench")
    import load  # bench/load.py

    headers = {"Authorization": f"Bearer {key}"} if key else {}
    rows = []
    for c in (int(x) for x in concurrency.split(",")):
        row = asyncio.run(load.run_level(url, headers, load.REQ, c, max(n, c), 120, path=path))
        row["label"] = label
        print("ROW", json.dumps(row))
        rows.append(row)
    return rows


@app.local_entrypoint()
def main(configs: str = "flash,eager,flash+compile", out: str = "bench/results/gpu.jsonl"):
    """Download weights if missing, then benchmark each config on JEFF_GPU."""
    import json

    download.remote()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for name in configs.split(","):
        res = bench.remote(env=CONFIGS[name])
        print(name, res["header"])
        with open(out, "a") as f:
            for r in res["rows"]:
                print(r)
                f.write(json.dumps({"config": name, **r, "device_name": res["header"]["device_name"]}) + "\n")


@app.function(image=image, timeout=600)
def ping(url: str, n: int = 10):
    """Compare health-check and single-question latency over a persistent connection inside Modal."""
    import json

    import httpx

    body = {
        "state": "I was charged twice, please refund me.",
        "model": "jev-latest",
        "questions": {"refund": {"type": "noul", "instructions": "Does the customer request a refund?"}},
    }
    with httpx.Client(timeout=60) as c:
        c.get(url + "/healthz")
        for path, payload in (("/healthz", None), ("/v1/systemone", body)):
            rows = []
            for _ in range(n):
                t0 = time.perf_counter()
                r = c.post(url + path, json=payload) if payload is not None else c.get(url + path)
                rows.append(
                    (
                        round(1000 * (time.perf_counter() - t0), 1),
                        r.headers.get("x-jeff-server-ms"),
                        r.headers.get("x-jeff-batcher-ms"),
                    )
                )
            print("PING", path, json.dumps(rows))
