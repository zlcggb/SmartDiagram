"""Export the GLiFormer text encoder to ONNX for the CPU arm (see jeff.backends.onnx_export).

Usage:
    uv run python scripts/export_onnx.py models/gliformer-large-v1            # -> models/.../onnx/encoder.onnx
    uv run python scripts/export_onnx.py models/gliformer-large-v1 --int8     # also encoder.int8.onnx
"""

import argparse
import logging
from pathlib import Path

from jeff.backends.onnx_export import export_encoder


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("model", nargs="?", default="models/gliformer-large-v1")
    ap.add_argument("--out", default=None, help="output dir (default <model>/onnx)")
    ap.add_argument("--int8", action="store_true", help="also write a dynamically int8-quantized copy")
    ap.add_argument("--no-check", action="store_true")
    args = ap.parse_args()
    export_encoder(args.model, Path(args.out) if args.out else None, int8=args.int8, check=not args.no_check)


if __name__ == "__main__":
    main()
