from __future__ import annotations

import json
from collections.abc import AsyncIterable, AsyncIterator
from contextvars import ContextVar, Token
from typing import Any

import httpx


_request_headers: ContextVar[dict[str, str] | None] = ContextVar(
    "ppt_legacy_request_headers",
    default=None,
)


def set_legacy_request_headers(headers: dict[str, str]) -> Token:
    """Attach sanitized end-user headers to internal pipeline sidecar calls."""

    return _request_headers.set(dict(headers))


def reset_legacy_request_headers(token: Token) -> None:
    _request_headers.reset(token)


class LegacyApiError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502, data: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.data = data


class LegacyApiClient:
    """Typed boundary around the transitional Node data/rendering sidecar."""

    def __init__(self, base_url: str, timeout: float = 600.0, internal_secret: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_secret = internal_secret
        # This client only talks to the internal Node sidecar. Inheriting desktop
        # HTTP(S)_PROXY variables can route binary uploads through an unrelated
        # outbound proxy, which may disconnect on Office/PDF payloads.
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout),
            trust_env=False,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def raw_request(
        self,
        method: str,
        path: str,
        *,
        content: bytes | None = None,
        params: Any = None,
        headers: dict[str, str] | None = None,
        internal: bool = True,
    ) -> httpx.Response:
        request_headers = dict(headers or {})
        if internal and self.internal_secret:
            request_headers["x-ppt-internal-secret"] = self.internal_secret
        return await self._client.request(method, path, content=content, params=params, headers=request_headers)

    async def stream_request(
        self,
        method: str,
        path: str,
        *,
        content: bytes | AsyncIterable[bytes] | None = None,
        params: Any = None,
        headers: dict[str, str] | None = None,
        internal: bool = False,
    ) -> httpx.Response:
        request_headers = dict(headers or {})
        if internal and self.internal_secret:
            request_headers["x-ppt-internal-secret"] = self.internal_secret
        request = self._client.build_request(
            method,
            path,
            content=content,
            params=params,
            headers=request_headers,
        )
        return await self._client.send(request, stream=True)

    async def request(self, method: str, path: str, json_body: Any = None) -> Any:
        contextual_headers = _request_headers.get()
        headers = dict(contextual_headers or {})
        if not headers and self.internal_secret:
            headers["x-ppt-internal-secret"] = self.internal_secret
        response = await self._client.request(method, path, json=json_body, headers=headers)
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise LegacyApiError(f"兼容服务返回了非 JSON 响应：{path}", response.status_code) from error
        if response.is_error or not payload.get("success", False):
            raise LegacyApiError(payload.get("message") or f"兼容服务请求失败：{path}", response.status_code, payload.get("data"))
        return payload.get("data")

    async def get_project(self, project_id: str) -> dict[str, Any]:
        return await self.request("GET", f"/api/projects/{project_id}")

    async def stream_progress(self, project_id: str) -> AsyncIterator[str]:
        headers = {"x-ppt-internal-secret": self.internal_secret} if self.internal_secret else None
        async with self._client.stream(
            "GET",
            f"/api/projects/{project_id}/progress",
            timeout=None,
            headers=headers,
        ) as response:
            if response.is_error:
                return
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]
