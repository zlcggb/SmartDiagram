"""Decode raw per-label scores into jev answers."""

from __future__ import annotations

from collections.abc import Sequence

from .schemas import (
    Answer,
    ChoiceAnswer,
    ChoiceQuestion,
    NoulAnswer,
    NoulQuestion,
    Question,
    ScoreAnswer,
    ScoreQuestion,
)

EPS = 1e-9
# Fit by bench/calibrate.py on gliformer-large-v1. Applies to `probabilities`,
# `confidence` and `noul`; `score` uses the raw (T=1) distribution.
DEFAULT_TEMPERATURE = 3.2


def normalize(scores: Sequence[float], temperature: float = 1.0) -> list[float]:
    """Normalize independent sigmoids; temperature > 1 flattens the distribution.

    This is score renormalization, not a calibrated posterior.
    """
    s = [max(float(x), 0.0) for x in scores]
    if temperature != 1.0:
        s = [x ** (1.0 / temperature) for x in s]
    total = sum(s)
    if total <= EPS:
        return [1.0 / len(s)] * len(s)
    return [x / total for x in s]


def confidence(probs: Sequence[float]) -> float:
    """Distribution peakedness: 0 for uniform, 1 for one-hot. jev does not publish its formula."""
    n = len(probs)
    if n < 2:
        return 1.0
    chance = 1.0 / n
    return round((max(probs) - chance) / (1.0 - chance), 4)


def decode(q: Question, scores: Sequence[float], temperature: float = DEFAULT_TEMPERATURE) -> Answer:
    if isinstance(q, NoulQuestion):
        if len(scores) == 1:  # single-label mode: raw sigmoid is P(yes)
            p = min(max(scores[0], 0.0), 1.0)
            if temperature != 1.0:
                p = normalize([p, 1.0 - p], temperature)[0]
            return NoulAnswer(noul=_r(p))
        p = normalize([scores[0], scores[1]], temperature)[0]
        return NoulAnswer(noul=_r(p))
    if isinstance(q, ChoiceQuestion):
        keys = [k for k, _ in q.options()]
        probs = normalize(scores, temperature)
        best = max(range(len(keys)), key=lambda i: probs[i])
        return ChoiceAnswer(
            choice=keys[best],
            confidence=confidence(probs),
            probabilities={k: _r(p) for k, p in zip(keys, probs)},
        )
    if isinstance(q, ScoreQuestion):
        probs = normalize(scores, temperature)
        # Tempering increases score MAE; keep the raw expectation (matches probabilities only at T=1).
        score = sum(i * p for i, p in enumerate(normalize(scores)))
        return ScoreAnswer(
            score=_r(score),
            confidence=confidence(probs),
            legend=q.legend(),
            probabilities={str(i): _r(p) for i, p in enumerate(probs)},
        )
    raise TypeError(type(q))


def _r(x: float) -> float:
    return round(float(x), 4)
