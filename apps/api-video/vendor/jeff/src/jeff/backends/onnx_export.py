"""Export the encoder to ONNX via scripts/export_onnx.py.

The RNN and head stay in PyTorch because their shapes depend on Python group layout.
"""

from __future__ import annotations

import logging
import re
import time
import warnings
from pathlib import Path

import torch

log = logging.getLogger("jeff.export")

OPSET = 17
ENCODER_FILE = "encoder.onnx"
INT8_FILE = "encoder.int8.onnx"


class _EncoderWrapper(torch.nn.Module):
    def __init__(self, encoder: torch.nn.Module):
        super().__init__()
        self.encoder = encoder

    def forward(self, input_ids, attention_mask):
        return self.encoder(input_ids, attention_mask)


def export_encoder(model_path: str, out_dir: Path | None = None, int8: bool = False, check: bool = True) -> Path:
    from .torch_backend import TorchBackend

    out_dir = out_dir or Path(model_path) / "onnx"
    out_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = out_dir / ENCODER_FILE

    backend = TorchBackend(model_path, device="cpu", dtype="float32", attn_kernel="eager")
    encoder = _EncoderWrapper(backend.model.model.token_rep_layer).eval()

    ids = torch.randint(5, 1000, (2, 48))
    mask = torch.ones(2, 48, dtype=torch.long)
    mask[1, 40:] = 0
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        torch.onnx.export(
            encoder,
            (ids, mask),
            str(onnx_path),
            input_names=["input_ids", "attention_mask"],
            output_names=["token_embeds"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "seq"},
                "attention_mask": {0: "batch", 1: "seq"},
                "token_embeds": {0: "batch", 1: "seq"},
            },
            opset_version=OPSET,
            dynamo=False,
        )
    log.info("exported %s in %.1fs (%.0f MB)", onnx_path, time.time() - t0, _size_mb(onnx_path))

    if check:
        import numpy as np
        import onnxruntime as ort

        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        ids2 = torch.randint(5, 1000, (3, 91))
        mask2 = torch.ones(3, 91, dtype=torch.long)
        mask2[2, 60:] = 0
        with torch.inference_mode():
            ref = encoder(ids2, mask2).numpy()
        out = sess.run(None, {"input_ids": ids2.numpy(), "attention_mask": mask2.numpy()})[0]
        diff = float(np.abs(ref - out).max())
        log.info("parity vs torch on an unseen shape: max abs diff %.2e", diff)
        if diff > 1e-3:
            raise RuntimeError(f"ONNX encoder diverges from torch: max abs diff {diff}")

    if int8:
        quantize_int8(onnx_path, out_dir / INT8_FILE)
    return onnx_path


# Keep FFN output projections fp32: post-GELU outliers amplify quantization error (bench/RESULTS.md).
FP32_NODE_PATTERNS = (re.compile(r"/(?!.*attention/).*output/dense/MatMul$"),)


def quantize_int8(src: Path, dst: Path, exclude_patterns=FP32_NODE_PATTERNS, reduce_range: bool = True) -> Path:
    """Quantize MatMul/Gemm to dynamic int8, leaving exclude_patterns in fp32.

    reduce_range uses 7-bit weights to avoid u8s8 accumulator overflow on x86 without VNNI.
    """
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    graph = onnx.load(str(src), load_external_data=False).graph
    excluded = [
        n.name
        for n in graph.node
        if n.op_type in ("MatMul", "Gemm") and any(p.search(n.name) for p in exclude_patterns)
    ]
    t0 = time.time()
    root = logging.getLogger()
    level = root.level
    root.setLevel(logging.ERROR)  # the quantizer logs one benign line per skipped tensor
    try:
        quantize_dynamic(
            str(src),
            str(dst),
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["MatMul", "Gemm"],
            per_channel=True,
            reduce_range=reduce_range,
            nodes_to_exclude=excluded,
        )
    finally:
        root.setLevel(level)
    log.info("kept %d MatMuls in fp32 (FFN output projections)", len(excluded))
    inferred = src.with_name(src.stem + "-inferred.onnx")  # shape-inference scratch file ORT leaves behind
    if inferred.exists():
        inferred.unlink()
    log.info("quantized %s in %.1fs (%.0f MB)", dst, time.time() - t0, _size_mb(dst))
    return dst


def _size_mb(p: Path) -> float:
    total = p.stat().st_size
    ext = p.with_suffix(p.suffix + ".data")  # external data file, if the exporter split weights out
    if ext.exists():
        total += ext.stat().st_size
    return total / 1e6
