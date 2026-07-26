from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from ..legacy import LegacyApiClient


class PipelineState(TypedDict, total=False):
    project_id: str
    theme: str
    accent_id: str
    surface_id: str
    presentation_style: str
    mode: Literal["draft", "standard", "visual"]
    skip_design: bool
    force: bool
    project_detail: dict[str, Any]
    slides: list[dict[str, Any]]
    slide: dict[str, Any]
    logs: Annotated[list[str], operator.add]
    errors: Annotated[list[str], operator.add]
    page_results: Annotated[list[dict[str, Any]], operator.add]
    current_stage: str
    final_detail: dict[str, Any]


def _emit(stage: str, status: str, message: str, **extra: Any) -> None:
    writer = get_stream_writer()
    writer({"stage": stage, "status": status, "message": message, "node": stage, **extra})


def build_project_pipeline(client: LegacyApiClient, checkpointer: BaseCheckpointSaver | None = None):
    """Compile a deterministic graph whose page stages use true Send-based fan-out/fan-in."""

    async def load_project(state: PipelineState) -> dict[str, Any]:
        _emit("pipeline", "start", "读取项目状态", clearDelta=True)
        detail = await client.get_project(state["project_id"])
        project = detail["project"]
        return {
            "project_detail": detail,
            "slides": detail.get("slides", []),
            "theme": state.get("theme") or project.get("theme") or "white-blue",
            "presentation_style": (
                state.get("presentation_style")
                or project.get("presentationStyle")
                or "consulting"
            ),
            "current_stage": "load_project",
        }

    async def prepare_context(state: PipelineState) -> dict[str, Any]:
        project = state["project_detail"]["project"]
        if project.get("mode") != "topic":
            _emit("brief", "skip", "粘贴资料模式，无需需求访谈")
            return {"current_stage": "prepare_context"}

        if not (project.get("briefJson") or {}).get("summary"):
            _emit("brief", "start", "生成并确认需求问题")
            started = await client.request("POST", f"/api/projects/{state['project_id']}/brief/start", {})
            answers = {
                question["id"]: question.get("placeholder") or "按默认方案推进"
                for question in started.get("questions", [])
            }
            await client.request("POST", f"/api/projects/{state['project_id']}/brief/answer", {"answers": answers})
            _emit("brief", "done", "需求确认完成")

        refreshed = await client.get_project(state["project_id"])
        if not (refreshed["project"].get("researchJson") or {}).get("summary"):
            _emit("research", "start", "开始主题背景调研")
            await client.request("POST", f"/api/projects/{state['project_id']}/research", {})
            _emit("research", "done", "背景调研完成")

        detail = await client.get_project(state["project_id"])
        return {
            "project_detail": detail,
            "slides": detail.get("slides", []),
            "logs": ["需求与研究上下文已准备"],
            "current_stage": "prepare_context",
        }

    async def ensure_outline(state: PipelineState) -> dict[str, Any]:
        detail = await client.get_project(state["project_id"])
        if not detail.get("slides"):
            _emit("outline", "start", "生成演示叙事大纲")
            await client.request("POST", f"/api/projects/{state['project_id']}/generate-outline", {})
            _emit("outline", "done", "演示大纲生成完成")
            message = "大纲已生成"
        else:
            _emit("outline", "skip", "沿用当前大纲")
            message = "沿用当前大纲"
        refreshed = await client.get_project(state["project_id"])
        return {
            "project_detail": refreshed,
            "slides": refreshed.get("slides", []),
            "logs": [message],
            "current_stage": "ensure_outline",
        }

    def fan_out_search(state: PipelineState):
        slides = state.get("slides", [])
        if not slides:
            return "aggregate_search"
        _emit("search", "start", f"并行检索并提炼 {len(slides)} 页参考资料", current=0, total=len(slides))
        return [
            Send(
                "search_page",
                {
                    "project_id": state["project_id"],
                    "slide": slide,
                    "theme": state["theme"],
                    "accent_id": state.get("accent_id", ""),
                    "surface_id": state.get("surface_id", ""),
                    "presentation_style": state.get("presentation_style", ""),
                    "mode": state["mode"],
                    "skip_design": state.get("skip_design", False),
                    "force": state.get("force", False),
                },
            )
            for slide in slides
        ]

    async def search_page(state: PipelineState) -> dict[str, Any]:
        slide = state["slide"]
        try:
            _emit("search", "progress", f"检索中：{slide['title']}", slideId=slide["id"], slideTitle=slide["title"], subStage=slide["title"])
            await client.request("POST", f"/api/projects/{state['project_id']}/slides/{slide['id']}/search", {})
            return {"page_results": [{"stage": "search", "slideId": slide["id"], "ok": True}]}
        except Exception as error:
            return {
                "page_results": [{"stage": "search", "slideId": slide["id"], "ok": False, "message": str(error)}],
                "errors": [f"检索失败：{slide['title']} — {error}"],
            }

    async def aggregate_search(state: PipelineState) -> dict[str, Any]:
        results = [item for item in state.get("page_results", []) if item.get("stage") == "search"]
        failed = sum(1 for item in results if not item.get("ok"))
        _emit("search", "error" if results and failed == len(results) else "done", f"资料检索完成，失败 {failed} 页", current=len(results), total=len(state.get("slides", [])))
        detail = await client.get_project(state["project_id"])
        return {
            "project_detail": detail,
            "slides": detail.get("slides", []),
            "logs": [f"检索完成（失败 {failed} 页）"],
            "current_stage": "aggregate_search",
        }

    def fan_out_draft(state: PipelineState):
        search_results = [item for item in state.get("page_results", []) if item.get("stage") == "search"]
        if search_results and all(not item.get("ok") for item in search_results):
            return "finalize"
        slides = state.get("slides", [])
        if not slides:
            return "finalize"
        _emit("plan", "start", f"并行生成 {len(slides)} 页可编辑初稿", current=0, total=len(slides))
        return [
            Send(
                "draft_page",
                {
                    "project_id": state["project_id"],
                    "slide": slide,
                    "theme": state["theme"],
                    "mode": state["mode"],
                    "skip_design": state.get("skip_design", False),
                    "force": state.get("force", False),
                },
            )
            for slide in slides
        ]

    async def draft_page(state: PipelineState) -> dict[str, Any]:
        slide = state["slide"]
        try:
            _emit("plan", "progress", f"生成初稿：{slide['title']}", slideId=slide["id"], slideTitle=slide["title"], subStage=slide["title"])
            await client.request("POST", f"/api/projects/{state['project_id']}/slides/{slide['id']}/generate-plan", {})
            return {"page_results": [{"stage": "plan", "slideId": slide["id"], "ok": True}]}
        except Exception as error:
            return {
                "page_results": [{"stage": "plan", "slideId": slide["id"], "ok": False, "message": str(error)}],
                "errors": [f"初稿失败：{slide['title']} — {error}"],
            }

    async def aggregate_draft(state: PipelineState) -> dict[str, Any]:
        results = [item for item in state.get("page_results", []) if item.get("stage") == "plan"]
        failed = sum(1 for item in results if not item.get("ok"))
        _emit("plan", "done" if failed < len(results) else "error", f"初稿生成完成，失败 {failed} 页", current=len(results), total=len(state.get("slides", [])))
        detail = await client.get_project(state["project_id"])
        return {
            "project_detail": detail,
            "slides": detail.get("slides", []),
            "logs": [f"初稿完成（失败 {failed} 页）"],
            "current_stage": "aggregate_draft",
        }

    def fan_out_design(state: PipelineState):
        if state.get("skip_design") or state.get("mode") == "draft":
            _emit("design", "skip", "草稿模式跳过视觉设计")
            return "finalize"
        slides = state.get("slides", [])
        if not slides:
            return "finalize"
        _emit("design", "start", f"并行生成 {len(slides)} 页 SVG 设计稿", current=0, total=len(slides))
        return [
            Send(
                "design_page",
                {
                    "project_id": state["project_id"],
                    "slide": slide,
                    "theme": state["theme"],
                    "accent_id": state.get("accent_id", ""),
                    "surface_id": state.get("surface_id", ""),
                    "presentation_style": state.get("presentation_style", ""),
                    "mode": state["mode"],
                    "skip_design": False,
                    "force": state.get("force", False),
                },
            )
            for slide in slides
        ]

    async def design_page(state: PipelineState) -> dict[str, Any]:
        slide = state["slide"]
        try:
            _emit("design", "progress", f"设计中：{slide['title']}", slideId=slide["id"], slideTitle=slide["title"], subStage=slide["title"])
            await client.request(
                "POST",
                f"/api/projects/{state['project_id']}/slides/{slide['id']}/generate-design",
                {
                    "theme": state["theme"],
                    "accentId": state.get("accent_id") or None,
                    "surfaceId": state.get("surface_id") or None,
                    "presentationStyle": state.get("presentation_style") or None,
                    "mode": state["mode"],
                },
            )
            return {"page_results": [{"stage": "design", "slideId": slide["id"], "ok": True}]}
        except Exception as error:
            return {
                "page_results": [{"stage": "design", "slideId": slide["id"], "ok": False, "message": str(error)}],
                "errors": [f"设计失败：{slide['title']} — {error}"],
            }

    async def aggregate_design(state: PipelineState) -> dict[str, Any]:
        results = [item for item in state.get("page_results", []) if item.get("stage") == "design"]
        failed = sum(1 for item in results if not item.get("ok"))
        _emit("design", "done" if failed < len(results) else "error", f"页面设计完成，失败 {failed} 页", current=len(results), total=len(state.get("slides", [])))
        return {"logs": [f"设计完成（失败 {failed} 页）"], "current_stage": "aggregate_design"}

    async def finalize(state: PipelineState) -> dict[str, Any]:
        detail = await client.get_project(state["project_id"])
        status = "error" if state.get("errors") else "done"
        _emit("pipeline", status, "流水线完成" if status == "done" else "流水线完成，但部分页面失败")
        return {"final_detail": detail, "project_detail": detail, "current_stage": "finalize"}

    builder = StateGraph(PipelineState)
    builder.add_node("load_project", load_project)
    builder.add_node("prepare_context", prepare_context)
    builder.add_node("ensure_outline", ensure_outline)
    builder.add_node("search_page", search_page)
    builder.add_node("aggregate_search", aggregate_search)
    builder.add_node("draft_page", draft_page)
    builder.add_node("aggregate_draft", aggregate_draft)
    builder.add_node("design_page", design_page)
    builder.add_node("aggregate_design", aggregate_design)
    builder.add_node("finalize", finalize)
    builder.add_edge(START, "load_project")
    builder.add_edge("load_project", "prepare_context")
    builder.add_edge("prepare_context", "ensure_outline")
    builder.add_conditional_edges("ensure_outline", fan_out_search, ["search_page", "aggregate_search"])
    builder.add_edge("search_page", "aggregate_search")
    builder.add_conditional_edges("aggregate_search", fan_out_draft, ["draft_page", "finalize"])
    builder.add_edge("draft_page", "aggregate_draft")
    builder.add_conditional_edges("aggregate_draft", fan_out_design, ["design_page", "finalize"])
    builder.add_edge("design_page", "aggregate_design")
    builder.add_edge("aggregate_design", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer or InMemorySaver())


GRAPH_DESCRIPTION = {
    "name": "ppt-project-pipeline",
    "patterns": ["StateGraph", "conditional-edges", "Send fan-out/fan-in", "reducers", "custom streaming", "thread checkpoints"],
    "nodes": [
        {"id": "load_project", "role": "state-loader"},
        {"id": "prepare_context", "role": "brief-researcher"},
        {"id": "ensure_outline", "role": "outline-architect"},
        {"id": "search_page", "role": "researcher", "fanOut": True},
        {"id": "aggregate_search", "role": "research-quality-gate"},
        {"id": "draft_page", "role": "draft-writer", "fanOut": True},
        {"id": "aggregate_draft", "role": "draft-quality-gate"},
        {"id": "design_page", "role": "visual-designer", "fanOut": True},
        {"id": "aggregate_design", "role": "design-quality-gate"},
        {"id": "finalize", "role": "run-finalizer"},
    ],
    "edges": [
        ["START", "load_project"],
        ["load_project", "prepare_context"],
        ["prepare_context", "ensure_outline"],
        ["ensure_outline", "Send(search_page × N)"],
        ["search_page × N", "aggregate_search"],
        ["aggregate_search", "Send(draft_page × N)|finalize"],
        ["draft_page × N", "aggregate_draft"],
        ["aggregate_draft", "Send(design_page × N)|finalize"],
        ["design_page × N", "aggregate_design"],
        ["aggregate_design", "finalize"],
        ["finalize", "END"],
    ],
}
