"""Integration tests against the real base checkpoint (skipped if absent)."""

import os

import pytest

from jeff.core import Engine, SystemOneRequest
from tests.fixtures import CHOICE_REQ, SCORE_REQ


@pytest.fixture(scope="module")
def engine(base_backend):
    return Engine(base_backend, "gliformer-base-v1")


def test_score_example(engine):
    resp = engine.run(SystemOneRequest.model_validate(SCORE_REQ)).model_dump()
    a = resp["answers"]["bug_severity"]
    assert set(a["probabilities"]) == {"0", "1", "2"}
    assert abs(sum(a["probabilities"].values()) - 1) < 1e-3
    # a crash with a workaround (Chrome) should score above "cosmetic"
    assert a["score"] > 0.8
    assert resp["usage"]["input_tokens"] > 20


def test_choice_and_noul(engine):
    a = engine.run(SystemOneRequest.model_validate(CHOICE_REQ)).model_dump()["answers"]
    assert a["team"]["choice"] == "billing"
    assert a["refund"]["noul"] > 0.5


def test_batch_matches_single(engine):
    reqs = [SystemOneRequest.model_validate(SCORE_REQ), SystemOneRequest.model_validate(CHOICE_REQ)]
    batched = [r.model_dump() for r in engine.run_batch(reqs)]
    singles = [engine.run(r).model_dump() for r in reqs]
    for b, s in zip(batched, singles):
        for k in b["answers"]:
            bp = b["answers"][k].get("probabilities") or {"noul": b["answers"][k]["noul"]}
            sp = s["answers"][k].get("probabilities") or {"noul": s["answers"][k]["noul"]}
            for kk in bp:
                assert abs(bp[kk] - sp[kk]) < 2e-2, (k, kk, bp, sp)


def test_group_description_changes_prompt(base_backend):
    from jeff.core import Group

    g1 = [Group(key="q", labels=("yes", "no"), name="Is this urgent?")]
    g2 = [
        Group(
            key="q",
            labels=("yes", "no"),
            name="Is this urgent?",
            description="Urgent means the customer needs help today.",
        )
    ]
    t = ["Please respond by end of day, our site is down."]
    s1 = base_backend.score(t, [g1])[0]
    s2 = base_backend.score(t, [g2])[0]
    assert s2.input_tokens > s1.input_tokens


def test_pad_multiple_buckets_sequence_length():
    """With pad_multiple set, padded batches land on bucket boundaries (compile-friendly)."""
    from jeff.backends.torch_backend import TorchBackend
    from jeff.core import Group
    from tests.conftest import BASE

    if not BASE.exists():
        pytest.skip("models/gliformer-base-v1 not downloaded")
    b = TorchBackend(str(BASE), device=os.environ.get("JEFF_DEVICE"), pad_multiple=64)
    seen: list[int] = []
    orig = b._collator

    def spy(batch):
        out = orig(batch)
        seen.append(out["input_ids"].shape[1])
        return out

    b._collator = spy
    g = [Group(key="q", labels=("yes", "no"), name="Is this urgent?")]
    b.score(["short text", " ".join(["word"] * 150)], [g, g])
    assert seen and all(n % 64 == 0 for n in seen), seen
    # bucketing pads only; real token counts are unchanged and per-text
    r = b.score(["short text"], [g])[0]
    assert 0 < r.input_tokens < 64


@pytest.fixture(scope="module")
def onnx_backend():
    from tests.conftest import BASE

    if not BASE.exists():
        pytest.skip("models/gliformer-base-v1 not downloaded")
    pytest.importorskip("onnxruntime")
    from jeff.backends.onnx_backend import OnnxBackend

    return OnnxBackend(str(BASE))  # exports models/gliformer-base-v1/onnx/encoder.onnx on first use


def test_onnx_matches_torch(base_backend, onnx_backend):
    """ONNX-encoder scores match the torch reference within 1e-3."""
    from jeff.backends.torch_backend import TorchBackend
    from jeff.core import Group
    from tests.conftest import BASE

    ref = base_backend if base_backend.device == "cpu" else TorchBackend(str(BASE), device="cpu", dtype="float32")
    groups = [
        [
            Group(key="team", labels=("billing", "technical", "sales"), name="Which team should handle this?"),
            Group(key="refund", labels=("yes", "no"), name="Does the customer request a refund?"),
        ],
        [Group(key="sev", labels=("cosmetic", "degraded", "blocking"), name="How severe?")],
    ]
    texts = [
        "I was charged twice and want the duplicate refunded.",
        "The export button crashes in Safari but works in Chrome.",
    ]
    a = ref.score(texts, groups)
    b = onnx_backend.score(texts, groups)
    assert onnx_backend.info()["backend"] == "onnx" and onnx_backend.info()["quant"] == "fp32"
    for x, y in zip(a, b):
        assert x.input_tokens == y.input_tokens
        for k in x.scores:
            for p, q in zip(x.scores[k], y.scores[k]):
                assert abs(p - q) < 1e-3, (k, x.scores[k], y.scores[k])
