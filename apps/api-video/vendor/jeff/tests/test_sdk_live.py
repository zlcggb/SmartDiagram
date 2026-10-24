"""Drive the official typesafe-sdk against a live jeff server (fake backend)."""

import socket
import threading
import time

import pytest
import uvicorn

from jeff.core import Engine
from jeff.server.app import create_app
from jeff.server.config import Settings
from tests.test_server import FakeBackend


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base_url():
    port = _free_port()
    s = Settings(api_keys=["secret"])
    app = create_app(s, Engine(FakeBackend(), s.model_name))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(timeout=5)


def test_sdk_roundtrip(base_url):
    from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

    client = TypeSafeClient(api_key="secret", base_url=base_url)
    result = client.system_one(
        "I was charged twice. Please help ASAP.",
        {
            "billing": Noul(instructions="Is this about billing?"),
            "tone": Choice(instructions="What is the tone?", criteria={"calm": None, "angry": "hostile"}),
            "urgency": Score(instructions="How urgent is this?", criteria=["low", "medium", "high"]),
        },
    )
    assert 0 <= result.nouls["billing"].noul <= 1
    assert result.choices["tone"].choice == "angry"
    assert result.scores["urgency"].score > 1
    assert (
        result.usage.input_tokens == 84
    )  # 42 per encoder pass from the fake backend; the noul is isolated, so two passes
    models = client.models.list()
    assert any(m.name == "jev-latest" for m in models.models)


def test_sdk_errors(base_url):
    from typesafe_sdk import (
        Noul,
        RetryPolicy,
        TypeSafeAuthenticationError,
        TypeSafeClient,
        TypeSafeUnprocessableEntityError,
    )

    bad = TypeSafeClient(api_key="wrong", base_url=base_url, retry=RetryPolicy(max_retries=0))
    with pytest.raises(TypeSafeAuthenticationError):
        bad.system_one("x", {"q": Noul(instructions="?")})
    good = TypeSafeClient(api_key="secret", base_url=base_url, retry=RetryPolicy(max_retries=0))
    with pytest.raises(TypeSafeUnprocessableEntityError):
        good.system_one("x", {"q": Noul(instructions="?")}, model="not-a-model")
