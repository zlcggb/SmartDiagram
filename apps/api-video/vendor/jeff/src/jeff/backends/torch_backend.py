"""GLiFormer inference on CUDA, MPS, or CPU.

Uses the internal inference path to pass group descriptions and count prompt tokens.
Only the encoder is compiled; the classification head has data-dependent shapes.
"""

from __future__ import annotations

import logging
import os
import time
import warnings
from typing import Any

import torch
from torch.utils.data import DataLoader

from ..core.backend import Group, ScoredText

log = logging.getLogger("jeff.torch")

# The decoder treats 0.0 as unset; a negative threshold returns every label.
ALL_LABELS_THRESHOLD = -1.0

ATTN_KERNELS = ("auto", "flash", "eager")


class TorchBackend:
    name = "torch"

    def __init__(
        self,
        model_path: str,
        device: str | None = None,
        dtype: str | None = None,
        attn_kernel: str = "auto",
        compile_model: bool = False,
        compile_mode: str | None = None,
        pad_multiple: int = 0,
        warmup: bool = False,
        batch_size: int = 16,
    ):
        from gliformer import GLiFormer

        if attn_kernel not in ATTN_KERNELS:
            raise ValueError(f"attn_kernel must be one of {ATTN_KERNELS}, got {attn_kernel!r}")
        self.device = device or _default_device()
        self.model_path = model_path
        self.batch_size = batch_size
        self.pad_multiple = int(pad_multiple)
        self.compiled = False

        kwargs: dict[str, Any] = {}
        if dtype:
            kwargs["dtype"] = dtype
        elif self.device == "cuda":
            kwargs["dtype"] = "bfloat16"
        # The checkpoint config asks for flash; only cuda can run it.
        want_flash = attn_kernel == "flash" or (attn_kernel == "auto" and self.device == "cuda")
        kwargs["_attn_implementation"] = "flash" if want_flash else "eager"

        t0 = time.time()
        with warnings.catch_warnings():
            if not want_flash:
                # The library warns about the flash fallback even when eager was requested.
                warnings.filterwarnings("ignore", message=r"attn_kernel=.*flashdeberta")
            self.model = GLiFormer.from_pretrained(model_path, map_location=self.device, **kwargs)
        self.model.to(self.device).eval()
        self.load_seconds = time.time() - t0

        self.dtype = str(self.model._model_floating_dtype()).replace("torch.", "")
        if not want_flash:
            # The loader flag does not override the checkpoint's ``attn_kernel: flash``.
            _set_attn_kernel(self.model.model, "eager")
        self.attn_kernel = self._effective_attn_kernel()
        if want_flash and self.attn_kernel != "flash":
            log.warning(
                "flash attention requested but not active (kernel=%s); install flashdeberta on a CUDA machine",
                self.attn_kernel,
            )

        collator_cls = self.model.data_collator_class or _resolve_collator(self.model.config)
        self._collator = collator_cls(
            self.model.config,
            data_processor=self.model.data_processor,
            return_tokens=True,
            prepare_labels=False,
        )
        if self.pad_multiple > 1:
            proc = self.model.data_processor
            proc.transformer_tokenizer = _BucketingTokenizer(proc.transformer_tokenizer, self.pad_multiple)

        if compile_model:
            self._compile(compile_mode)
        if warmup:
            self.warmup()
        log.info(
            "torch backend ready: model=%s device=%s dtype=%s attn=%s compiled=%s pad_multiple=%d load=%.1fs",
            model_path,
            self.device,
            self.dtype,
            self.attn_kernel,
            self.compiled,
            self.pad_multiple,
            self.load_seconds,
        )

    # -- setup -----------------------------------------------------------

    def _text_encoder_owner(self) -> tuple[Any, str] | None:
        """(module, attr) holding the HF DeBERTa backbone, or None if the layout differs."""
        trl = getattr(self.model.model, "token_rep_layer", None)
        for owner in (
            getattr(trl, "bert_layer", None),
            getattr(getattr(trl, "text_encoder", None), "bert_layer", None),
        ):
            if owner is not None and isinstance(getattr(owner, "model", None), torch.nn.Module):
                return owner, "model"
        return None

    def _effective_attn_kernel(self) -> str:
        kernels = {str(m.attn_kernel) for m in self.model.model.modules() if hasattr(m, "attn_kernel")}
        if not kernels:
            return "unknown"
        return "flash" if any(k.startswith("flash") for k in kernels) else "eager"

    def _compile(self, mode: str | None):
        found = self._text_encoder_owner()
        if found is None:
            log.warning("torch.compile skipped: could not locate the text encoder module")
            return
        owner, attr = found
        if self.attn_kernel == "flash":
            _exclude_flash_kernels_from_compile()
        # dynamic=None lets Dynamo generalize varying batch/sequence sizes after recompilation.
        self._uncompiled = (owner, attr, getattr(owner, attr))
        setattr(owner, attr, torch.compile(getattr(owner, attr), mode=mode, dynamic=None))
        self.compiled = True

    def _uncompile(self):
        owner, attr, module = self._uncompiled
        setattr(owner, attr, module)
        self.compiled = False

    def warmup(self, seq_lens: tuple[int, ...] = (128, 512), batch_sizes: tuple[int, ...] = (1, 4)):
        """Push representative shapes through once (triggers compilation, allocates caches)."""
        t0 = time.time()
        g = [Group(key="q", labels=("yes", "no"), name="Is this urgent?")]
        try:
            for n in seq_lens:
                text = " ".join(["warmup"] * max(1, n - 32))
                for b in batch_sizes:
                    self.score([text] * b, [g] * b)
        except Exception:
            if not self.compiled:
                raise
            log.exception("compiled encoder failed during warmup; serving the eager encoder instead")
            self._uncompile()
            return self.warmup(seq_lens, batch_sizes)
        if self.device == "cuda":
            torch.cuda.synchronize()
        log.info("warmup done in %.1fs", time.time() - t0)

    def info(self) -> dict[str, Any]:
        return {
            "backend": self.name,
            "model": self.model_path,
            "device": self.device,
            "dtype": self.dtype,
            "attn_kernel": self.attn_kernel,
            "compiled": self.compiled,
            "pad_multiple": self.pad_multiple,
            "load_seconds": round(self.load_seconds, 1),
        }

    # -- inference -------------------------------------------------------

    @torch.inference_mode()
    def score(self, texts: list[str], groups: list[list[Group]]) -> list[ScoredText]:
        m = self.model
        m.eval()
        tokens, _, _ = m.prepare_inputs(texts)
        items = []
        for toks, gs in zip(tokens, groups):
            items.append(
                {
                    "tokenized_text": toks,
                    "classification": [
                        {
                            "name": g.name,
                            "description": g.description,
                            "all_labels": list(g.labels),
                            "true_labels": [],
                        }
                        for g in gs
                    ],
                }
            )

        seq_lens: list[int] = []

        def collate(batch):
            out = self._collator(batch)
            seq_lens.extend(int(x) for x in out["attention_mask"].sum(dim=1).tolist())
            return out

        loader = DataLoader(items, batch_size=self.batch_size, shuffle=False, collate_fn=collate)  # ty: ignore[invalid-argument-type]
        decoded, _ = m._process_multitask_batches(loader, ALL_LABELS_THRESHOLD, True, True, decoder_kwargs=None)
        per_text = decoded.get("classification", [[] for _ in texts])

        results = []
        for gs, groups_out, n_tok in zip(groups, per_text, seq_lens):
            scores: dict[str, list[float]] = {}
            for g, preds in zip(gs, groups_out):
                by_name = {p["class_name"]: float(p["score"]) for p in preds}
                scores[g.key] = [by_name.get(label, 0.0) for label in g.labels]
            results.append(ScoredText(scores=scores, input_tokens=n_tok))
        return results


class _BucketingTokenizer:
    """Pad to a multiple of N; align max_length too, as Hugging Face requires."""

    def __init__(self, tokenizer, multiple: int):
        object.__setattr__(self, "_tok", tokenizer)
        object.__setattr__(self, "_multiple", multiple)

    def __call__(self, *args, **kwargs):
        if kwargs.get("padding") == "longest" and "pad_to_multiple_of" not in kwargs:
            kwargs["pad_to_multiple_of"] = self._multiple
            ml = kwargs.get("max_length")
            if ml is not None and ml % self._multiple:
                kwargs["max_length"] = max(self._multiple, (ml // self._multiple) * self._multiple)
        return self._tok(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._tok, name)

    def __setattr__(self, name, value):
        setattr(self._tok, name, value)

    def __len__(self):
        return len(self._tok)


def _set_attn_kernel(root: torch.nn.Module, kernel: str):
    for m in root.modules():
        if hasattr(m, "attn_kernel"):
            m.attn_kernel = kernel  # ty: ignore[invalid-assignment]


def _exclude_flash_kernels_from_compile():
    """Skip tracing fused Triton kernels that Inductor cannot rebuild."""
    try:
        import gliformer.backbones.deberta_2d as d2
    except ImportError:  # pragma: no cover
        return
    for name in ("flash_attention_disentangled", "flash_attention_bias"):
        fn = getattr(d2, name, None)
        if fn is not None and not getattr(fn, "_jeff_nocompile", False):
            wrapped = torch.compiler.disable(fn, recursive=True)
            wrapped._jeff_nocompile = True
            setattr(d2, name, wrapped)


def _default_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _resolve_collator(config):
    from gliformer.gliformer import resolve_gliformer_collator_class

    return resolve_gliformer_collator_class(config)


def from_env() -> TorchBackend:
    env = os.environ.get
    return TorchBackend(
        model_path=env("JEFF_MODEL", "models/gliformer-large-v1"),
        device=env("JEFF_DEVICE"),
        dtype=env("JEFF_DTYPE"),
        attn_kernel=env("JEFF_ATTN", "auto"),
        compile_model=env("JEFF_COMPILE", "0") == "1",
        compile_mode=env("JEFF_COMPILE_MODE") or None,
        pad_multiple=int(env("JEFF_PAD_MULTIPLE", "0")),
        warmup=env("JEFF_WARMUP", "0") == "1",
        batch_size=int(env("JEFF_MAX_BATCH", "16")),
    )
