"""CPU arm on Modal: jeff's FastAPI app with the ONNX Runtime encoder, no GPU.

    modal run deploy/modal_cpu.py::export             # weights -> Volume, then encoder.onnx + encoder.int8.onnx (once)
    modal run deploy/modal_cpu.py::bench              # raw backend latency at JEFF_CPU cores (rows -> stdout)
    modal run deploy/modal_cpu.py                     # bench each config x cpu count -> bench/results/cpu.jsonl
    JEFF_CPU=8 JEFF_QUANT=int8 JEFF_API_KEYS=k1 modal deploy deploy/modal_cpu.py

Environment (all optional): JEFF_CPU (cores per container, default 8),
JEFF_MEMORY_MB (default 8192), JEFF_QUANT (fp32|int8, default int8),
JEFF_MODEL_REPO, JEFF_MIN_CONTAINERS, JEFF_MAX_CONTAINERS, JEFF_MAX_INPUTS,
JEFF_TARGET_INPUTS, plus every server JEFF_* var (forwarded as a Secret).
"""

from __future__ import annotations

import os
import sys

import modal

CPU = float(os.environ.get("JEFF_CPU", "8"))
MEMORY_MB = int(os.environ.get("JEFF_MEMORY_MB", "8192"))
MODEL_REPO = os.environ.get("JEFF_MODEL_REPO", "knowledgator/gliformer-large-v1")
MODEL_DIRNAME = MODEL_REPO.split("/")[-1]
MODELS_MOUNT = "/models"
MIN_CONTAINERS = int(os.environ.get("JEFF_MIN_CONTAINERS", "1")) if "deploy" in sys.argv else 0
MAX_CONTAINERS = int(os.environ.get("JEFF_MAX_CONTAINERS", "8"))
MAX_INPUTS = int(os.environ.get("JEFF_MAX_INPUTS", "32"))
TARGET_INPUTS = int(os.environ.get("JEFF_TARGET_INPUTS", "8"))

SERVER_DEFAULTS: dict[str, str | None] = {
    "JEFF_BACKEND": "onnx",
    "JEFF_QUANT": "int8",
    "JEFF_THREADS": str(int(CPU)),
    "JEFF_MAX_BATCH": "8",
    "JEFF_MAX_WAIT_MS": "10",
    "JEFF_MODEL": f"{MODELS_MOUNT}/{MODEL_DIRNAME}",
    "JEFF_MODEL_NAME": MODEL_DIRNAME,
    "PYTHONPATH": "/root/src",
    "PYTHONUNBUFFERED": "1",
    "OMP_NUM_THREADS": str(int(CPU)),
}
forwarded = {k: v for k, v in os.environ.items() if k.startswith("JEFF_")}
server_env = {**SERVER_DEFAULTS, **forwarded}

app = modal.App(os.environ.get("JEFF_APP_NAME", "jeff-cpu"))
volume = modal.Volume.from_name("jeff-models", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "torch>=2.6",
        "gliformer>=0.1.2",
        "onnx>=1.16",
        "onnxruntime>=1.18",
        "fastapi>=0.115",
        "uvicorn[standard]>=0.30",
        "pydantic>=2.7",
        "httpx>=0.27",
        "huggingface-hub>=0.24",
        "hf-transfer",
        extra_index_url="https://download.pytorch.org/whl/cpu",  # CPU-only torch wheels (no CUDA payload)
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "PYTHONPATH": "/root/src"})
    .add_local_dir("src", remote_path="/root/src")
    .add_local_dir("bench", remote_path="/root/bench")
)


def _ensure_weights():
    volume.reload()
    if not os.path.exists(f"{MODELS_MOUNT}/{MODEL_DIRNAME}/gliner_config.json"):
        from huggingface_hub import snapshot_download

        snapshot_download(MODEL_REPO, local_dir=f"{MODELS_MOUNT}/{MODEL_DIRNAME}", ignore_patterns=["*.gif", "*.md"])
        volume.commit()


@app.function(image=image, volumes={MODELS_MOUNT: volume}, cpu=8, memory=16384, timeout=60 * 60)
def export(force: bool = False):
    """Export encoder.onnx and encoder.int8.onnx into the Volume next to the weights."""
    from pathlib import Path

    from jeff.backends.onnx_export import (
        ENCODER_FILE,
        INT8_FILE,
        export_encoder,
        quantize_int8,
    )

    _ensure_weights()
    out = Path(MODELS_MOUNT) / MODEL_DIRNAME / "onnx"
    if not (out / ENCODER_FILE).exists() or force:
        export_encoder(f"{MODELS_MOUNT}/{MODEL_DIRNAME}", out, int8=False)
    if not (out / INT8_FILE).exists() or force:
        quantize_int8(out / ENCODER_FILE, out / INT8_FILE)
    volume.commit()
    print("exported:", sorted(p.name for p in out.iterdir()))


@app.cls(
    image=image,
    cpu=CPU,
    memory=MEMORY_MB,
    volumes={MODELS_MOUNT: volume},
    secrets=[modal.Secret.from_dict(server_env)],
    min_containers=MIN_CONTAINERS,
    max_containers=MAX_CONTAINERS,
    scaledown_window=300,
    timeout=120,
    startup_timeout=60 * 15,
)
@modal.concurrent(max_inputs=MAX_INPUTS, target_inputs=TARGET_INPUTS)
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
    cpu=CPU,
    memory=MEMORY_MB,
    volumes={MODELS_MOUNT: volume},
    secrets=[modal.Secret.from_dict(server_env)],
    timeout=60 * 60,
)
def bench(
    configs: str = "onnx-int8,onnx-fp32,torch-fp32",
    seq_lens: str = "128,512",
    batch_sizes: str = "1,4,16",
    iters: int = 5,
    drift: bool = True,
):
    """Raw backend latency at JEFF_CPU cores; one row per (config, seq_len, batch)."""
    sys.path.insert(0, "/root/bench")
    import cpu_bench

    _ensure_weights()
    host = f"modal-cpu-{int(CPU)}"
    rows, backends = [], {}
    for cfg in configs.split(","):
        b = cpu_bench.make_backend(cfg, f"{MODELS_MOUNT}/{MODEL_DIRNAME}", int(CPU))
        backends[cfg] = b
        for r in cpu_bench.run_bench(
            b, [int(x) for x in seq_lens.split(",")], [int(x) for x in batch_sizes.split(",")], iters
        ):
            rows.append({"config": cfg, "model": MODEL_DIRNAME, "device_name": host, "threads": int(CPU), **r})
    if drift and "onnx-fp32" in backends and "onnx-int8" in backends:
        rows.append(
            {
                "config": "drift-int8-vs-fp32",
                "model": MODEL_DIRNAME,
                "device_name": host,
                **cpu_bench.score_drift(backends["onnx-fp32"], backends["onnx-int8"]),
            }
        )
    return rows


@app.local_entrypoint()
def main(
    configs: str = "onnx-int8,onnx-fp32,torch-fp32", out: str = "bench/results/cpu.jsonl", force_export: bool = False
):
    """Export missing encoders (or force with --force-export), then benchmark each config."""
    import json

    export.remote(force=force_export)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rows = bench.remote(configs=configs)
    with open(out, "a") as f:
        for r in rows:
            print(r)
            f.write(json.dumps(r) + "\n")
