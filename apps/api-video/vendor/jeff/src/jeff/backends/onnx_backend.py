"""Run the encoder in ONNX Runtime; reuse PyTorch preprocessing, RNN, and head on CPU.

Export with scripts/export_onnx.py, or let OnnxBackend export missing files.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .torch_backend import TorchBackend

log = logging.getLogger("jeff.onnx")

QUANT_FILES = {"fp32": "encoder.onnx", "int8": "encoder.int8.onnx"}


class _OrtEncoder(torch.nn.Module):
    """Drop-in for ``token_rep_layer``: (input_ids, attention_mask) -> token_embeds."""

    def __init__(self, onnx_path: Path, threads: int | None, providers: list[str] | None):
        super().__init__()
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(onnx_path), so, providers=providers or ["CPUExecutionProvider"])
        self.onnx_path = onnx_path
        self.providers = self.session.get_providers()
        self.attn_kernel = "onnx"

    def forward(self, input_ids, attention_mask, **kwargs):
        feeds = {
            "input_ids": input_ids.cpu().numpy().astype(np.int64, copy=False),
            "attention_mask": attention_mask.cpu().numpy().astype(np.int64, copy=False),
        }
        (out,) = self.session.run(None, feeds)
        return torch.from_numpy(out)


class OnnxBackend(TorchBackend):
    name = "onnx"

    def __init__(
        self,
        model_path: str,
        quant: str = "fp32",
        onnx_path: str | None = None,
        threads: int | None = None,
        providers: list[str] | None = None,
        batch_size: int = 16,
        export_if_missing: bool = True,
    ):
        if quant not in QUANT_FILES:
            raise ValueError(f"quant must be one of {tuple(QUANT_FILES)}, got {quant!r}")
        path = Path(onnx_path) if onnx_path else Path(model_path) / "onnx" / QUANT_FILES[quant]
        if not path.exists():
            if not export_if_missing:
                raise FileNotFoundError(f"{path} not found; run scripts/export_onnx.py")
            log.info("%s missing; exporting the encoder now", path)
            from .onnx_export import export_encoder

            export_encoder(model_path, path.parent, int8=quant == "int8")

        super().__init__(model_path, device="cpu", dtype="float32", attn_kernel="eager", batch_size=batch_size)
        t0 = time.time()
        self._ort = _OrtEncoder(path, threads, providers)
        self.model.model.token_rep_layer = self._ort
        if threads:
            torch.set_num_threads(threads)
        self.quant = quant
        self.attn_kernel = "onnx"
        self.onnx_load_seconds = time.time() - t0
        log.info(
            "onnx encoder ready: %s quant=%s providers=%s threads=%s load=%.1fs",
            path,
            quant,
            self._ort.providers,
            threads,
            self.onnx_load_seconds,
        )

    def info(self) -> dict[str, Any]:
        return {
            **super().info(),
            "onnx": str(self._ort.onnx_path),
            "quant": self.quant,
            "providers": self._ort.providers,
            "onnx_load_seconds": round(self.onnx_load_seconds, 1),
        }


def from_env() -> OnnxBackend:
    env = os.environ.get
    return OnnxBackend(
        model_path=env("JEFF_MODEL", "models/gliformer-large-v1"),
        quant=env("JEFF_QUANT", "fp32"),
        onnx_path=env("JEFF_ONNX_PATH") or None,
        threads=int(env("JEFF_THREADS", "0")) or None,
        batch_size=int(env("JEFF_MAX_BATCH", "16")),
    )
