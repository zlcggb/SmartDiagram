"""Design Agent for deterministic diagram readability improvements."""

import json
import re
from typing import Any

from langchain_core.messages import AIMessage

from app.agents.validator_agent import extract_final_code_from_state
from app.services.mermaid_sanitizer import normalize_mermaid_code
from app.state.state import AgentState


CODE_FENCE_RE = re.compile(r"^```(?:json|xml|mermaid)?\s*|\s*```$", re.IGNORECASE)

FLOW_NODE_STYLE_DEFAULTS = {
    "borderRadius": 12,
    "padding": 16,
    "fontSize": 14,
    "minWidth": 160,
}
FLOW_EDGE_STYLE_DEFAULTS = {"stroke": "#1e40af", "strokeWidth": 2}
ECHARTS_PALETTE = [
    "#5470c6",
    "#91cc75",
    "#fac858",
    "#ee6666",
    "#73c0de",
    "#3ba272",
    "#fc8452",
    "#9a60b4",
]
OFFICE_DEFAULT_BRAND_COLORS = {
    "html_email": "#2563eb",
    "web_report_html": "#0f766e",
}
OFFICE_REPORT_WIDTH_BY_DENSITY = {
    "compact": 760,
    "standard": 920,
    "spacious": 960,
}


def _json_loads(content: str) -> Any:
    return json.loads(content)


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _strip_code_fences(content: str) -> str:
    stripped = content.strip()
    stripped = CODE_FENCE_RE.sub("", stripped).strip()
    return stripped


def _engine_preferences(preferences: dict[str, Any] | None, engine: str) -> dict[str, Any]:
    all_preferences = preferences or {}
    style = all_preferences.get("style") if isinstance(all_preferences.get("style"), dict) else {}
    engine_preferences = all_preferences.get(engine) if isinstance(all_preferences.get(engine), dict) else {}
    return {**style, **engine_preferences}


def _office_artifact_preferences(preferences: dict[str, Any] | None, engine: str) -> dict[str, Any]:
    all_preferences = preferences or {}
    style = all_preferences.get("style") if isinstance(all_preferences.get("style"), dict) else {}
    artifact_preferences = (
        all_preferences.get("artifact_preferences")
        if isinstance(all_preferences.get("artifact_preferences"), dict)
        else {}
    )
    nested = artifact_preferences.get(engine) if isinstance(artifact_preferences.get(engine), dict) else {}
    direct = all_preferences.get(engine) if isinstance(all_preferences.get(engine), dict) else {}
    return {**style, **nested, **direct}


def _int_preference(preferences: dict[str, Any], key: str, default: int, *, minimum: int, maximum: int) -> int:
    value = preferences.get(key)
    if isinstance(value, (int, float)):
        return max(minimum, min(maximum, int(value)))
    return default


def _string_preference(preferences: dict[str, Any], key: str, default: str, *, max_chars: int = 80) -> str:
    value = preferences.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()[:max_chars]
    return default


def _hex_color_preference(preferences: dict[str, Any], key: str, default: str) -> str:
    value = _string_preference(preferences, key, default, max_chars=32)
    return value if re.fullmatch(r"#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?", value) else default


def _bool_preference(preferences: dict[str, Any], key: str, default: bool) -> bool:
    value = preferences.get(key)
    return value if isinstance(value, bool) else default


def _palette_preference(preferences: dict[str, Any], default: list[str]) -> list[str]:
    palette = preferences.get("palette")
    if isinstance(palette, list):
        safe_palette = [str(color).strip()[:32] for color in palette if str(color).strip()]
        if safe_palette:
            return safe_palette[:12]
    return default


def _optimize_flow(content: str, preferences: dict[str, Any] | None = None) -> tuple[str, list[str]]:
    payload = _json_loads(content)
    if not isinstance(payload, dict):
        return content, []
    rules: list[str] = []
    flow_preferences = _engine_preferences(preferences, "flow")
    node_style_defaults = {
        **FLOW_NODE_STYLE_DEFAULTS,
        "borderRadius": _int_preference(
            flow_preferences,
            "node_border_radius",
            FLOW_NODE_STYLE_DEFAULTS["borderRadius"],
            minimum=0,
            maximum=32,
        ),
        "padding": _int_preference(
            flow_preferences,
            "node_padding",
            FLOW_NODE_STYLE_DEFAULTS["padding"],
            minimum=4,
            maximum=40,
        ),
        "fontSize": _int_preference(
            flow_preferences,
            "node_font_size",
            FLOW_NODE_STYLE_DEFAULTS["fontSize"],
            minimum=10,
            maximum=24,
        ),
        "minWidth": _int_preference(
            flow_preferences,
            "node_min_width",
            FLOW_NODE_STYLE_DEFAULTS["minWidth"],
            minimum=80,
            maximum=360,
        ),
    }
    edge_style_defaults = {
        **FLOW_EDGE_STYLE_DEFAULTS,
        "stroke": _string_preference(flow_preferences, "edge_color", FLOW_EDGE_STYLE_DEFAULTS["stroke"]),
        "strokeWidth": _int_preference(
            flow_preferences,
            "edge_width",
            FLOW_EDGE_STYLE_DEFAULTS["strokeWidth"],
            minimum=1,
            maximum=8,
        ),
    }
    for node in payload.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        if not isinstance(node.get("position"), dict):
            node["position"] = {"x": 0, "y": 0}
            rules.append("flow.position_defaulted")
        raw_style = node.get("style")
        style = dict(raw_style) if isinstance(raw_style, dict) else {}
        for unsafe_key in ["transform", "rotate"]:
            if unsafe_key in style:
                style.pop(unsafe_key, None)
                rules.append("flow.removed_rotation")
        for key, value in node_style_defaults.items():
            if key not in style:
                style[key] = value
                rule_prefix = "flow.preference" if flow_preferences else "flow.node_style"
                rules.append(f"{rule_prefix}.{key}")
        node["style"] = style
    for edge in payload.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        raw_style = edge.get("style")
        style = dict(raw_style) if isinstance(raw_style, dict) else {}
        for key, value in edge_style_defaults.items():
            if key not in style:
                style[key] = value
                rule_prefix = "flow.preference" if flow_preferences else "flow.edge_style"
                rules.append(f"{rule_prefix}.{key}")
        edge["style"] = style
    return _json_dumps(payload), sorted(set(rules))


def _optimize_charts(content: str, preferences: dict[str, Any] | None = None) -> tuple[str, list[str]]:
    payload = _json_loads(content)
    if not isinstance(payload, dict):
        return content, []
    rules: list[str] = []
    chart_preferences = _engine_preferences(preferences, "charts")
    if "backgroundColor" not in payload:
        payload["backgroundColor"] = _string_preference(chart_preferences, "background", "transparent")
        rules.append("charts.preference.background" if chart_preferences else "charts.background_transparent")
    if "color" not in payload:
        payload["color"] = _palette_preference(chart_preferences, ECHARTS_PALETTE)
        rules.append("charts.preference.palette" if chart_preferences else "charts.semantic_palette")
    if "tooltip" not in payload:
        payload["tooltip"] = {"trigger": "axis", "axisPointer": {"type": "shadow"}}
        rules.append("charts.tooltip_default")
    if "toolbox" not in payload:
        payload["toolbox"] = {"feature": {"saveAsImage": {}, "dataView": {"readOnly": True}}}
        rules.append("charts.toolbox_default")
    series = payload.get("series")
    if isinstance(series, list) and len(series) > 1 and "legend" not in payload:
        payload["legend"] = {"top": 28}
        rules.append("charts.legend_default")
    if any(key in payload for key in ["xAxis", "yAxis"]) and "grid" not in payload:
        payload["grid"] = {"left": 48, "right": 28, "top": 72, "bottom": 48, "containLabel": True}
        rules.append("charts.grid_spacing")
    return _json_dumps(payload), sorted(set(rules))


def _optimize_excalidraw(content: str) -> tuple[str, list[str]]:
    payload = _json_loads(content)
    elements = payload.get("elements") if isinstance(payload, dict) else payload
    if not isinstance(elements, list):
        return content, []
    rules: list[str] = []
    for element in elements:
        if not isinstance(element, dict):
            continue
        for key, value in {"roughness": 0, "opacity": 100, "angle": 0}.items():
            if key not in element:
                element[key] = value
                rules.append(f"excalidraw.{key}_default")
        if element.get("type") in {"rectangle", "diamond"} and "roundness" not in element:
            element["roundness"] = {"type": 3}
            rules.append("excalidraw.roundness_default")
        if element.get("type") == "text":
            if "lineHeight" not in element:
                element["lineHeight"] = 1.25
                rules.append("excalidraw.text_line_height")
            if "fontFamily" not in element:
                element["fontFamily"] = 3
                rules.append("excalidraw.text_font_family")
    return _json_dumps(payload), sorted(set(rules))


def _optimize_mermaid(content: str) -> tuple[str, list[str]]:
    return normalize_mermaid_code(content)


def _optimize_mindmap(content: str) -> tuple[str, list[str]]:
    cleaned = _strip_code_fences(content)
    cleaned = "\n".join(line.rstrip() for line in cleaned.splitlines()).strip()
    rules: list[str] = []
    if cleaned != content.strip():
        rules.append("mindmap.trimmed_code_fences")
    if cleaned and not cleaned.startswith("#"):
        cleaned = f"# Diagram\n\n{cleaned}"
        rules.append("mindmap.added_root_heading")
    return cleaned, rules


def _optimize_infographic(content: str) -> tuple[str, list[str]]:
    payload = _json_loads(content)
    if not isinstance(payload, dict):
        return content, []
    rules: list[str] = []
    if "theme" not in payload:
        payload["theme"] = {
            "palette": ["#2563eb", "#059669", "#f59e0b", "#dc2626", "#7c3aed"],
            "background": "transparent",
        }
        rules.append("infographic.theme_default")
    return _json_dumps(payload), rules


def _optimize_office_artifact(content: str, engine: str, preferences: dict[str, Any] | None = None) -> tuple[str, list[str]]:
    payload = _json_loads(content)
    if not isinstance(payload, dict):
        return content, []
    rules: list[str] = []
    office_preferences = _office_artifact_preferences(preferences, engine)
    style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
    style = dict(style)

    preferred_brand = _hex_color_preference(
        office_preferences,
        "brand_color",
        OFFICE_DEFAULT_BRAND_COLORS.get(engine, "#2563eb"),
    )
    if office_preferences and "brand_color" not in style:
        style["brand_color"] = preferred_brand
        rules.append(f"{engine}.preference.brand_color")

    if engine == "web_report_html":
        density = _string_preference(office_preferences, "layout_density", "", max_chars=32)
        if density in OFFICE_REPORT_WIDTH_BY_DENSITY:
            if "layout_density" not in style:
                style["layout_density"] = density
                rules.append("web_report_html.preference.layout_density")
            if "max_width" not in style:
                style["max_width"] = OFFICE_REPORT_WIDTH_BY_DENSITY[density]
                rules.append("web_report_html.preference.max_width")

    if style:
        payload["style"] = style

    language = _string_preference(office_preferences, "language", "", max_chars=16)
    if language and not payload.get("language"):
        payload["language"] = language
        rules.append(f"{engine}.preference.language")

    tone = _string_preference(office_preferences, "tone", "", max_chars=80)
    if tone and not payload.get("tone"):
        payload["tone"] = tone
        rules.append(f"{engine}.preference.tone")

    if engine == "web_report_html" and _bool_preference(office_preferences, "include_summary", False):
        sections = payload.get("sections")
        if isinstance(sections, list) and sections:
            has_summary = any(
                isinstance(section, dict)
                and str(section.get("type") or "").lower() == "text"
                and "summary" in str(section.get("heading") or section.get("title") or "").lower()
                for section in sections
            )
            if not has_summary:
                sections.insert(
                    1 if str((sections[0] if isinstance(sections[0], dict) else {}).get("type") or "").lower() == "hero" else 0,
                    {
                        "type": "text",
                        "heading": "Executive Summary",
                        "body": "Summarize the most important findings, tradeoffs, and recommended next action.",
                    },
                )
                payload["sections"] = sections[:18]
                rules.append("web_report_html.preference.include_summary")

    return _json_dumps(payload), sorted(set(rules))


def optimize_diagram_design(
    engine_type: str | None,
    content: str,
    preferences: dict[str, Any] | None = None,
) -> tuple[str, list[str], str]:
    """Return optimized code, applied rule ids, and status."""

    engine = engine_type or "general"
    if not content.strip():
        return content, [], "skipped"
    try:
        if engine == "flow":
            optimized, rules = _optimize_flow(content, preferences)
        elif engine == "charts":
            optimized, rules = _optimize_charts(content, preferences)
        elif engine == "excalidraw":
            optimized, rules = _optimize_excalidraw(content)
        elif engine == "mermaid":
            optimized, rules = _optimize_mermaid(content)
        elif engine == "mindmap":
            optimized, rules = _optimize_mindmap(content)
        elif engine == "infographic":
            optimized, rules = _optimize_infographic(content)
        elif engine in {"html_email", "web_report_html"}:
            optimized, rules = _optimize_office_artifact(content, engine, preferences)
        else:
            optimized, rules = content, []
    except Exception:
        return content, [], "failed"
    return optimized, rules, "optimized" if rules or optimized != content else "skipped"


async def design_agent_node(state: AgentState) -> dict:
    """Optimize the latest diagram output before validation and export planning."""

    engine = state.get("engine_type") or state.get("current_engine") or ""
    original_code = extract_final_code_from_state(state)
    memory_context = dict(state.get("memory_context", {}) or {})
    long_term_preferences = memory_context.get("long_term_preferences") or {}
    preferences = long_term_preferences.get("preferences") if isinstance(long_term_preferences, dict) else {}
    optimized_code, applied_rules, status = optimize_diagram_design(engine, original_code, preferences)
    changed = bool(original_code and optimized_code != original_code)
    memory_context["design"] = {
        "status": status,
        "engine_type": engine,
        "changed": changed,
        "applied_rules": applied_rules,
        "designed_code": optimized_code if changed else "",
        "note": (
            f"Design Agent applied {len(applied_rules)} deterministic readability rules."
            if applied_rules
            else "Design Agent found no deterministic changes to apply."
        ),
    }

    permission_context = state.get("permission_context", {}) or {}
    result: dict[str, Any] = {
        "memory_context": memory_context,
        "audit_events": [
            {
                "type": "design.output.optimized",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Design Agent optimized diagram readability and style.",
                "metadata": {
                    "status": status,
                    "engine_type": engine,
                    "changed": changed,
                    "applied_rules": applied_rules,
                },
            }
        ],
        "tool_calls": [
            {
                "tool_name": "design.optimize",
                "status": "succeeded" if status in {"optimized", "skipped"} else "failed",
                "input_summary": f"engine={engine or 'unknown'}",
                "output_summary": f"changed={changed}, rules={len(applied_rules)}",
            }
        ],
    }
    if changed:
        result["messages"] = [
            AIMessage(
                content=(
                    "<design_concept>"
                    "Design Agent applied deterministic readability and style normalization."
                    "</design_concept>"
                    f"<code>{optimized_code}</code>"
                )
            )
        ]
    return result
