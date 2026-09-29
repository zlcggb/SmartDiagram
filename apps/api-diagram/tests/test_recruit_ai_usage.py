import asyncio

from app.services import recruit_ai_usage as usage


class _FakeLLM:
    model_name = "gpt-test"


def test_run_scopes_models_and_sums_usage(monkeypatch):
    monkeypatch.setenv("RESUME_OCR_MODEL", "env-ocr")

    async def scenario():
        usage.begin_ai_run({"screening": "saved-eval", "ocr": ""})
        assert usage.role_model("screening") == "saved-eval"
        assert usage.role_model("ocr") == "env-ocr"
        streamed = usage.add_usage(None, {"input_tokens": 100, "output_tokens": 0, "total_tokens": 100})
        streamed = usage.add_usage(streamed, {"input_tokens": 0, "output_tokens": 40, "total_tokens": 40})
        usage.record_usage("screening", _FakeLLM(), streamed)
        async def ocr_call():
            usage.record_usage("ocr", _FakeLLM(), None, output_text="张三", images=1)

        await asyncio.gather(ocr_call())
        return usage.usage_summary()

    summary = asyncio.run(scenario())
    assert summary["calls"][0] == {
        "role": "screening", "model": "gpt-test", "input_tokens": 100, "output_tokens": 40, "total_tokens": 140, "estimated": False,
    }
    assert summary["calls"][1]["estimated"] and summary["calls"][1]["output_tokens"] == 2
    assert summary["total_tokens"] == 140 + summary["calls"][1]["total_tokens"]


def test_no_run_records_nothing():
    async def scenario():
        usage.record_usage("screening", _FakeLLM(), {"input_tokens": 1})
        return usage.usage_summary()

    assert asyncio.run(scenario()) is None
