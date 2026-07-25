import httpx
import pytest

from ppt_agent_api.legacy import (
    LegacyApiClient,
    reset_legacy_request_headers,
    set_legacy_request_headers,
)


@pytest.mark.asyncio
async def test_pipeline_sidecar_calls_forward_user_identity_instead_of_internal_identity():
    captured = []

    async def handler(request: httpx.Request):
        captured.append(request)
        return httpx.Response(200, json={"success": True, "data": {"ok": True}})

    client = LegacyApiClient("http://node.local", internal_secret="shared-secret")
    await client._client.aclose()
    client._client = httpx.AsyncClient(
        base_url="http://node.local",
        transport=httpx.MockTransport(handler),
    )
    token = set_legacy_request_headers({"authorization": "Bearer user-token"})
    try:
        await client.request("POST", "/api/projects/ppt-1/generate-outline", {})
    finally:
        reset_legacy_request_headers(token)
        await client.close()

    assert captured[0].headers["authorization"] == "Bearer user-token"
    assert "x-ppt-internal-secret" not in captured[0].headers

