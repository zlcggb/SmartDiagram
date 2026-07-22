from __future__ import annotations

from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from ppt_agent_api.workflows.project_pipeline import build_project_pipeline


class FakeLegacyClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.request_bodies: list[tuple[str, Any]] = []
        self.detail: dict[str, Any] = {
            "project": {"id": "p1", "name": "测试", "mode": "paste", "theme": "white-blue"},
            "facts": [],
            "slides": [{"id": "s1", "title": "第一页"}],
            "exports": [],
        }

    async def get_project(self, project_id: str) -> dict[str, Any]:
        self.calls.append(("GET", f"/api/projects/{project_id}"))
        return self.detail

    async def request(self, method: str, path: str, json_body: Any = None) -> Any:
        self.calls.append((method, path))
        self.request_bodies.append((path, json_body))
        if path.endswith("/search"):
            return {"searchJson": {"results": []}, "slide": self.detail["slides"][0]}
        if path.endswith("/generate-plan"):
            return {"plan": {}, "slide": self.detail["slides"][0]}
        if path.endswith("/generate-design"):
            return {"svgPreview": "<svg/>", "slide": self.detail["slides"][0]}
        return self.detail["slides"]


@pytest.mark.asyncio
async def test_pipeline_runs_explicit_research_draft_design_nodes() -> None:
    client = FakeLegacyClient()
    graph = build_project_pipeline(client, InMemorySaver())
    result = await graph.ainvoke(
        {
            "project_id": "p1",
            "theme": "white-blue",
            "accent_id": "cyan",
            "surface_id": "soft",
            "mode": "standard",
            "skip_design": False,
            "force": True,
            "logs": [],
            "errors": [],
            "search_failures": [],
        },
        config={"configurable": {"thread_id": "test-run"}},
    )

    called_paths = [path for _, path in client.calls]
    assert "/api/projects/p1/slides/s1/search" in called_paths
    assert "/api/projects/p1/slides/s1/generate-plan" in called_paths
    assert "/api/projects/p1/slides/s1/generate-design" in called_paths
    design_body = next(body for path, body in client.request_bodies if path.endswith("/generate-design"))
    assert design_body["theme"] == "white-blue"
    assert design_body["accentId"] == "cyan"
    assert design_body["surfaceId"] == "soft"
    assert result["current_stage"] == "finalize"
    assert result["final_detail"]["project"]["id"] == "p1"


@pytest.mark.asyncio
async def test_draft_mode_skips_design_node() -> None:
    client = FakeLegacyClient()
    graph = build_project_pipeline(client, InMemorySaver())
    await graph.ainvoke(
        {
            "project_id": "p1",
            "theme": "white-blue",
            "mode": "draft",
            "skip_design": False,
            "force": False,
            "logs": [],
            "errors": [],
            "search_failures": [],
        },
        config={"configurable": {"thread_id": "draft-run"}},
    )
    assert not any(path.endswith("/generate-design") for _, path in client.calls)
