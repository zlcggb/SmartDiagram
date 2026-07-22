from types import SimpleNamespace

import httpx
import pytest
from starlette.requests import Request
from starlette.responses import StreamingResponse

from ppt_agent_api.legacy import LegacyApiClient
from ppt_agent_api.main import _proxy, app


class TrackingStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.yielded = 0
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            self.yielded += 1
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


class FakeStreamingLegacy:
    def __init__(self, stream: TrackingStream) -> None:
        self.stream = stream
        self.content = None
        self.headers: dict[str, str] | None = None

    async def stream_request(self, method, path, *, content=None, params=None, headers=None):
        self.content = content
        self.headers = headers
        return httpx.Response(
            206,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": "11",
                "Content-Disposition": 'attachment; filename="demo.mp4"',
                "Connection": "close",
            },
            stream=self.stream,
            request=httpx.Request(method, f"http://legacy.test{path}"),
        )


def streaming_request(legacy: FakeStreamingLegacy) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/files/video",
        "raw_path": b"/api/files/video",
        "query_string": b"download=1",
        "headers": [
            (b"host", b"ppt-agent.test"),
            (b"content-length", b"7"),
            (b"x-request-id", b"request-1"),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("ppt-agent.test", 80),
        "app": SimpleNamespace(state=SimpleNamespace(legacy=legacy)),
    }
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": b"payload", "more_body": False}

    return Request(scope, receive)


def multipart_streaming_request(legacy: FakeStreamingLegacy) -> Request:
    boundary = "material-boundary"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/projects/project-1/materials",
        "raw_path": b"/api/projects/project-1/materials",
        "query_string": b"routeMode=auto",
        "headers": [
            (b"host", b"ppt-agent.test"),
            (b"content-length", b"999"),
            (b"content-type", f"multipart/form-data; boundary={boundary}".encode()),
            (b"x-request-id", b"material-request-1"),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("ppt-agent.test", 80),
        "app": SimpleNamespace(state=SimpleNamespace(legacy=legacy)),
    }
    messages = iter(
        [
            {"type": "http.request", "body": b"--material-boundary\r\n", "more_body": True},
            {"type": "http.request", "body": b"binary-material\r\n--material-boundary--\r\n", "more_body": False},
        ]
    )

    async def receive():
        try:
            return next(messages)
        except StopIteration:
            return {"type": "http.disconnect"}

    return Request(scope, receive)


@pytest.mark.asyncio
async def test_graph_description_is_visible_without_legacy_backend() -> None:
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/orchestration/graph")
        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["name"] == "ppt-project-pipeline"
        assert any(node["id"] == "design_page" and node["fanOut"] for node in payload["data"]["nodes"])
        assert "Send fan-out/fan-in" in payload["data"]["patterns"]


@pytest.mark.asyncio
async def test_legacy_stream_request_does_not_preload_upstream_body() -> None:
    stream = TrackingStream([b"hello ", b"world"])

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream, request=request)

    legacy = LegacyApiClient("http://legacy.test")
    await legacy._client.aclose()
    legacy._client = httpx.AsyncClient(
        base_url="http://legacy.test",
        transport=httpx.MockTransport(handler),
    )
    try:
        response = await legacy.stream_request("GET", "/large-file")
        assert stream.yielded == 0

        iterator = response.aiter_raw()
        assert await anext(iterator) == b"hello "
        assert stream.yielded == 1
        assert not stream.closed

        assert await anext(iterator) == b"world"
        await response.aclose()
        assert stream.closed
    finally:
        await legacy.close()


@pytest.mark.asyncio
async def test_legacy_internal_client_ignores_environment_proxies() -> None:
    legacy = LegacyApiClient("http://127.0.0.1:4010")
    try:
        assert legacy._client._trust_env is False
    finally:
        await legacy.close()


@pytest.mark.asyncio
async def test_proxy_streams_request_and_response_and_closes_upstream() -> None:
    stream = TrackingStream([b"hello ", b"world"])
    legacy = FakeStreamingLegacy(stream)

    response = await _proxy(streaming_request(legacy), "/api/files/video")

    assert isinstance(response, StreamingResponse)
    assert response.status_code == 206
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["content-length"] == "11"
    assert response.headers["content-disposition"] == 'attachment; filename="demo.mp4"'
    assert "connection" not in response.headers
    assert legacy.headers == {"x-request-id": "request-1"}
    assert not isinstance(legacy.content, bytes)

    iterator = response.body_iterator
    assert await anext(iterator) == b"hello "
    assert stream.yielded == 1
    assert not stream.closed

    remaining = [chunk async for chunk in iterator]
    assert remaining == [b"world"]
    assert stream.yielded == 2

    assert response.background is not None
    await response.background()
    assert stream.closed


@pytest.mark.asyncio
async def test_proxy_preserves_multipart_content_type_and_streams_binary_body() -> None:
    stream = TrackingStream([b"ok"])
    legacy = FakeStreamingLegacy(stream)

    response = await _proxy(
        multipart_streaming_request(legacy),
        "/api/projects/project-1/materials",
    )

    assert legacy.headers == {
        "content-type": "multipart/form-data; boundary=material-boundary",
        "x-request-id": "material-request-1",
    }
    assert not isinstance(legacy.content, bytes)
    body_chunks = [chunk async for chunk in legacy.content if chunk]
    assert body_chunks == [
        b"--material-boundary\r\n",
        b"binary-material\r\n--material-boundary--\r\n",
    ]

    assert response.background is not None
    await response.background()
    assert stream.closed
