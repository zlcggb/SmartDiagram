from datetime import datetime

from app.services.model_usage_service import (
    calculate_model_usage_cost,
    normalize_usage_event_payload,
    parse_model_pricing,
)


def test_pricing_uses_non_cached_input_and_server_rates():
    pricing = parse_model_pricing(
        '{"model-a":{"input":10,"output":20,"cache":2,"currency":"CNY"}}'
    )

    result = calculate_model_usage_cost(
        model="model-a",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cached_tokens=250_000,
        pricing=pricing,
    )

    assert result == {
        "estimated_cost": 18.0,
        "currency": "CNY",
        "pricing_source": "configured",
    }


def test_unknown_model_is_explicitly_unpriced():
    result = calculate_model_usage_cost(
        model="unknown",
        input_tokens=100,
        output_tokens=20,
        cached_tokens=0,
        pricing={},
    )

    assert result == {
        "estimated_cost": 0.0,
        "currency": "CNY",
        "pricing_source": "unpriced",
    }


def test_payload_normalization_clamps_tokens_and_drops_full_content():
    payload = normalize_usage_event_payload(
        {
            "external_event_id": "evt-1",
            "project_id": "ppt-1",
            "slide_id": "slide-1",
            "source": "ppt",
            "stage": "svg",
            "provider": "openai-compatible",
            "model": "model-a",
            "status": "succeeded",
            "input_tokens": 120,
            "output_tokens": 30,
            "cached_tokens": 200,
            "reasoning_tokens": -4,
            "total_tokens": 150,
            "duration_ms": 42.8,
            "output_summary": "x" * 400,
            "prompt": "must never be persisted",
            "output": "must never be persisted",
            "started_at": "2026-07-25T08:00:00",
            "ended_at": "2026-07-25T08:00:01",
        }
    )

    assert payload["cached_tokens"] == 120
    assert payload["reasoning_tokens"] == 0
    assert payload["duration_ms"] == 43
    assert len(payload["output_summary"]) == 240
    assert "prompt" not in payload
    assert "output" not in payload
    assert isinstance(payload["started_at"], datetime)


def test_payload_requires_a_stable_external_event_id():
    try:
        normalize_usage_event_payload({"external_event_id": ""})
    except ValueError as error:
        assert str(error) == "external_event_id_required"
    else:
        raise AssertionError("missing event id must be rejected")


def test_provider_utc_timestamps_are_normalized_for_naive_database_columns():
    payload = normalize_usage_event_payload(
        {
            "external_event_id": "evt-zulu",
            "started_at": "2026-07-25T08:00:00.000Z",
            "ended_at": "2026-07-25T08:00:01+00:00",
        }
    )

    assert payload["started_at"].tzinfo is None
    assert payload["ended_at"].tzinfo is None
    assert payload["started_at"] == datetime(2026, 7, 25, 8, 0, 0)
