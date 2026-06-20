"""Deterministic renderer for controlled office artifact DSL."""

from html import escape
import re
from typing import Any, TypedDict

from app.services.html_policy import validate_rendered_html_policy


class HtmlArtifactRenderResult(TypedDict):
    html: str
    mime_type: str
    metadata: dict[str, Any]


EMAIL_TEMPLATE_OPTIONS: list[dict[str, str]] = [
    {
        "id": "executive_brief",
        "label": "商务简报",
        "description": "适合客户跟进、内部通知和高管摘要的克制商务邮件。",
    },
    {
        "id": "newsletter_update",
        "label": "资讯简报",
        "description": "适合产品更新、活动邀请和多段内容的品牌简报。",
    },
    {
        "id": "product_launch",
        "label": "产品推广",
        "description": "适合发布、促销和强行动召唤的营销邮件。",
    },
    {
        "id": "blueprint_review",
        "label": "蓝图评审",
        "description": "适合会议纪要、方案评审和行动计划的企业微信风邮件。",
    },
]

_EMAIL_TEMPLATE_THEMES: dict[str, dict[str, Any]] = {
    "executive_brief": {
        "brand_color": "#2563eb",
        "accent_color": "#14b8a6",
        "background": "#eef3f8",
        "surface": "#ffffff",
        "soft_bg": "#f8fafc",
        "text_color": "#0f172a",
        "muted_color": "#526173",
        "border_color": "#d8e2ef",
        "max_width": 660,
    },
    "newsletter_update": {
        "brand_color": "#0f766e",
        "accent_color": "#f59e0b",
        "background": "#ecfdf5",
        "surface": "#ffffff",
        "soft_bg": "#f0fdfa",
        "text_color": "#10201d",
        "muted_color": "#49645f",
        "border_color": "#b7e4d8",
        "max_width": 680,
    },
    "product_launch": {
        "brand_color": "#ea580c",
        "accent_color": "#0f172a",
        "background": "#fff7ed",
        "surface": "#ffffff",
        "soft_bg": "#fffbeb",
        "text_color": "#111827",
        "muted_color": "#5f6368",
        "border_color": "#fed7aa",
        "max_width": 660,
    },
    "blueprint_review": {
        "brand_color": "#0071e3",
        "accent_color": "#34c759",
        "warning_color": "#ff9500",
        "danger_color": "#ff3b30",
        "background": "#f5f5f7",
        "surface": "#ffffff",
        "soft_bg": "#f5f5f7",
        "table_head_bg": "#fafafa",
        "text_color": "#1d1d1f",
        "muted_color": "#86868b",
        "border_color": "#e5e5e5",
        "subtle_border_color": "#f0f0f0",
        "max_width": 680,
        "layout": "blueprint_review",
    },
}

_EMAIL_TEMPLATE_ALIASES = {
    "default": "executive_brief",
    "classic": "executive_brief",
    "business": "executive_brief",
    "letter": "executive_brief",
    "executive": "executive_brief",
    "newsletter": "newsletter_update",
    "digest": "newsletter_update",
    "update": "newsletter_update",
    "marketing": "product_launch",
    "promo": "product_launch",
    "promotion": "product_launch",
    "launch": "product_launch",
    "blueprint": "blueprint_review",
    "blueprint_review": "blueprint_review",
    "review": "blueprint_review",
    "meeting": "blueprint_review",
    "minutes": "blueprint_review",
    "wemail": "blueprint_review",
    "apple": "blueprint_review",
}


def _safe_text(value: Any, *, max_chars: int = 4000) -> str:
    return escape(str(value or "").strip()[:max_chars])


def _safe_color(value: Any, fallback: str = "#2563eb") -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?", text):
        return text
    return fallback


def _safe_width(value: Any, default: int) -> int:
    try:
        width = int(value)
    except (TypeError, ValueError):
        return default
    return max(320, min(width, 960))


def _safe_href(value: Any) -> str:
    href = str(value or "").strip()
    lowered = href.lower()
    if not href:
        return ""
    if (
        lowered.startswith("https://")
        or lowered.startswith("mailto:")
        or (href.startswith("/") and not href.startswith("//"))
        or href.startswith("#")
    ):
        return escape(href, quote=True)
    return ""


def _strip_ordered_marker(value: Any) -> str:
    return re.sub(r"^\s*\d+\s*[\.\．、\)）]\s*", "", str(value or "").strip())


def _as_item_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {"label": _strip_ordered_marker(value)}


def _item_text(item: dict[str, Any], *keys: str, max_chars: int = 240) -> str:
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return _safe_text(_strip_ordered_marker(value), max_chars=max_chars)
    return ""


def _items_from(section: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        value = section.get(key)
        if isinstance(value, list) and value:
            return value
    return []


def _safe_percent(value: Any, fallback: float = 0) -> int:
    text = str(value if value is not None else "").strip().replace("%", "")
    try:
        number = float(text)
    except ValueError:
        number = fallback
    if 0 < number <= 1:
        number *= 100
    return max(0, min(100, int(round(number))))


def _is_blueprint_theme(theme: dict[str, Any]) -> bool:
    return str(theme.get("layout") or "") == "blueprint_review"


def _normalize_email_template_id(value: Any) -> str:
    raw = str(value or "").strip().lower()
    key = re.sub(r"[^a-z0-9]+", "_", raw).strip("_")
    if key in _EMAIL_TEMPLATE_THEMES:
        return key
    return _EMAIL_TEMPLATE_ALIASES.get(key, "executive_brief")


def _email_template_id(payload: dict[str, Any]) -> str:
    style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
    return _normalize_email_template_id(
        payload.get("template") or payload.get("template_id") or style.get("template") or style.get("template_id")
    )


def _email_theme(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
    template_id = _email_template_id(payload)
    theme = dict(_EMAIL_TEMPLATE_THEMES[template_id])
    theme["brand_color"] = _safe_color(style.get("brand_color"), theme["brand_color"])
    theme["max_width"] = _safe_width(style.get("max_width"), int(theme["max_width"]))
    return template_id, theme


def _safe_brand_name(payload: dict[str, Any]) -> str:
    style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
    brand = payload.get("brand")
    raw_brand = brand.get("name") if isinstance(brand, dict) else brand
    return _safe_text(style.get("brand_name") or raw_brand or "SmartDiagram", max_chars=80)


def _payload_sections(payload: dict[str, Any]) -> list[Any]:
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    if not sections:
        return [{"type": "text", "body": payload.get("body") or payload.get("title") or "Draft"}]
    return sections[:18]


def _split_email_sections(payload: dict[str, Any], *, subject: str, preheader: str) -> tuple[dict[str, Any], list[Any]]:
    sections = _payload_sections(payload)
    first = sections[0] if sections else {}
    if isinstance(first, dict) and str(first.get("type") or "").strip().lower() == "hero":
        return first, sections[1:]
    return (
        {
            "type": "hero",
            "heading": payload.get("title") or subject,
            "body": payload.get("body") or preheader or payload.get("audience") or "",
        },
        sections,
    )


def _email_section_card(content: str, *, theme: dict[str, Any], template_id: str, compact: bool = False) -> str:
    border = theme["border_color"]
    soft_bg = theme["soft_bg"]
    surface = theme["surface"]
    if _is_blueprint_theme(theme):
        padding = "20px" if compact else "32px"
        return (
            '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" '
            f'style="border-collapse:separate;width:100%;background:{surface};border:1px solid {border};border-radius:16px;">'
            f'<tr><td style="padding:{padding};">{content}</td></tr></table>'
        )
    padding = "14px 18px" if compact else "18px 22px"
    background = soft_bg if template_id == "product_launch" else surface
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" '
        f'style="border-collapse:separate;width:100%;background:{background};border:1px solid {border};border-radius:14px;">'
        f'<tr><td style="padding:{padding};">{content}</td></tr></table>'
    )


def _email_heading(section: dict[str, Any], *, theme: dict[str, Any], size: int = 18) -> str:
    heading = _safe_text(section.get("heading") or section.get("title"), max_chars=160)
    if not heading:
        return ""
    if _is_blueprint_theme(theme):
        return (
            '<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;">'
            '<tr>'
            f'<td style="width:4px;background:{theme["brand_color"]};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>'
            f'<td style="padding-left:14px;font-size:20px;font-weight:600;line-height:1.35;color:{theme["text_color"]};">{heading}</td>'
            '</tr></table>'
        )
    return f'<h2 style="margin:0 0 10px;font-size:{size}px;line-height:1.35;color:{theme["text_color"]};">{heading}</h2>'


def _email_body(section: dict[str, Any], *, theme: dict[str, Any], max_chars: int = 2200) -> str:
    body = _safe_text(section.get("body") or section.get("text"), max_chars=max_chars)
    if not body:
        return ""
    if _is_blueprint_theme(theme):
        return f'<p style="margin:0;color:{theme["text_color"]};font-size:15px;line-height:1.7;">{body}</p>'
    return f'<p style="margin:0;color:{theme["muted_color"]};font-size:15px;line-height:1.68;">{body}</p>'


def _email_list_items(items: Any, *, theme: dict[str, Any]) -> str:
    if not isinstance(items, list):
        return ""
    if _is_blueprint_theme(theme):
        cells: list[str] = []
        for raw_item in items[:12]:
            item = _as_item_record(raw_item)
            label = _item_text(item, "label", "title", "name", "heading", max_chars=120)
            body = _item_text(item, "body", "description", "detail", "text", "note", max_chars=300)
            if not label and not body:
                continue
            if body:
                content = (
                    f'<p style="margin:0 0 8px;font-size:11px;font-weight:600;color:{theme["muted_color"]};text-transform:uppercase;letter-spacing:.5px;">{label}</p>'
                    f'<p style="margin:0;font-size:14px;color:{theme["text_color"]};line-height:1.6;">{body}</p>'
                )
            else:
                content = f'<p style="margin:0;font-size:14px;color:{theme["text_color"]};line-height:1.65;">{label}</p>'
            cells.append(
                f'<td width="48%" valign="top" style="background:{theme["soft_bg"]};border-radius:12px;padding:20px;">{content}</td>'
            )
        if not cells:
            return ""
        rows = []
        for index in range(0, len(cells), 2):
            row_cells = cells[index : index + 2]
            if len(row_cells) == 1:
                row_cells.append('<td width="48%" valign="top" style="font-size:0;line-height:0;">&nbsp;</td>')
            rows.append(f'<tr>{row_cells[0]}<td width="4%" style="font-size:0;line-height:0;">&nbsp;</td>{row_cells[1]}</tr>')
        return (
            '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;border-spacing:0;">'
            + '<tr><td colspan="3" style="font-size:0;line-height:16px;height:16px;">&nbsp;</td></tr>'.join(rows)
            + "</table>"
        )
    cells: list[str] = []
    for raw_item in items[:12]:
        item = _as_item_record(raw_item)
        label = _item_text(item, "label", "title", "name", "heading", max_chars=120)
        body = _item_text(item, "body", "description", "detail", "text", "note", max_chars=260)
        if not label and not body:
            continue
        body_node = (
            f'<div style="margin-top:6px;color:{theme["muted_color"]};font-size:13px;line-height:1.55;">{body}</div>'
            if body
            else ""
        )
        cells.append(
            '<td valign="top" width="50%" style="padding:6px;">'
            f'<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:{theme["soft_bg"]};border:1px solid {theme["border_color"]};border-radius:12px;">'
            '<tr>'
            f'<td width="5" style="background:{theme["brand_color"]};border-radius:12px 0 0 12px;font-size:0;line-height:0;">&nbsp;</td>'
            '<td style="padding:14px 14px 13px;">'
            f'<div style="color:{theme["text_color"]};font-size:14px;font-weight:700;line-height:1.45;">{label or body}</div>'
            f"{body_node}"
            "</td></tr></table></td>"
        )
    if not cells:
        return ""
    rows = []
    for index in range(0, len(cells), 2):
        row_cells = cells[index : index + 2]
        if len(row_cells) == 1:
            row_cells.append('<td width="50%" style="padding:6px;">&nbsp;</td>')
        rows.append(f"<tr>{''.join(row_cells)}</tr>")
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin:4px -6px 0;">'
        + "".join(rows)
        + "</table>"
    )


def _email_metric_grid(section: dict[str, Any], *, theme: dict[str, Any]) -> str:
    items = _items_from(section, "metrics", "items", "data")
    if not items:
        return ""
    cells: list[str] = []
    for raw_item in items[:6]:
        item = _as_item_record(raw_item)
        label = _item_text(item, "label", "title", "name", max_chars=80)
        value = _item_text(item, "value", "amount", "number", max_chars=80)
        delta = _item_text(item, "delta", "change", "trend", max_chars=80)
        note = _item_text(item, "note", "body", "description", max_chars=140)
        if not label and not value:
            continue
        delta_node = (
            f'<span style="display:inline-block;margin-left:6px;color:{theme["brand_color"]};font-size:12px;font-weight:700;">{delta}</span>'
            if delta
            else ""
        )
        note_node = (
            f'<div style="margin-top:6px;color:{theme["muted_color"]};font-size:12px;line-height:1.45;">{note}</div>'
            if note
            else ""
        )
        if _is_blueprint_theme(theme):
            cells.append(
                '<td valign="top" width="33.333%" style="padding:6px;">'
                f'<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:{theme["soft_bg"]};border:0;border-radius:12px;">'
                '<tr><td style="padding:20px;">'
                f'<div style="margin-bottom:8px;color:{theme["muted_color"]};font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;line-height:1.35;">{label}</div>'
                f'<div style="color:{theme["text_color"]};font-size:24px;font-weight:700;line-height:1.1;">{value or label}{delta_node}</div>'
                f"{note_node}"
                "</td></tr></table></td>"
            )
        else:
            cells.append(
                '<td valign="top" width="33.333%" style="padding:6px;">'
                f'<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:{theme["surface"]};border:1px solid {theme["border_color"]};border-radius:12px;">'
                '<tr><td style="padding:15px 14px;">'
                f'<div style="margin-bottom:8px;color:{theme["muted_color"]};font-size:12px;line-height:1.35;">{label}</div>'
                f'<div style="color:{theme["text_color"]};font-size:24px;font-weight:800;line-height:1.1;">{value or label}{delta_node}</div>'
                f"{note_node}"
                "</td></tr></table></td>"
            )
    if not cells:
        return ""
    rows = []
    for index in range(0, len(cells), 3):
        row_cells = cells[index : index + 3]
        while len(row_cells) < 3:
            row_cells.append('<td width="33.333%" style="padding:6px;">&nbsp;</td>')
        rows.append(f"<tr>{''.join(row_cells)}</tr>")
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin:6px -6px 0;">'
        + "".join(rows)
        + "</table>"
    )


def _email_bar_chart(section: dict[str, Any], *, theme: dict[str, Any]) -> str:
    items = _items_from(section, "data", "items", "metrics")
    if not items:
        return ""
    rows: list[str] = []
    for raw_item in items[:8]:
        item = _as_item_record(raw_item)
        label = _item_text(item, "label", "title", "name", max_chars=120)
        percent = _safe_percent(item.get("value") or item.get("percent") or item.get("score"))
        display = _item_text(item, "display", "delta", "note", max_chars=80) or f"{percent}%"
        if not label:
            continue
        rows.append(
            '<tr>'
            f'<td style="padding:9px 0 4px;color:{theme["text_color"]};font-size:13px;font-weight:700;line-height:1.35;">{label}</td>'
            f'<td align="right" style="padding:9px 0 4px;color:{theme["muted_color"]};font-size:12px;line-height:1.35;">{display}</td>'
            '</tr><tr>'
            '<td colspan="2" style="padding:0 0 8px;">'
            f'<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;background:{theme["soft_bg"]};border-radius:999px;">'
            '<tr>'
            f'<td width="{percent}%" style="background:{theme["brand_color"]};border-radius:999px;font-size:0;line-height:8px;height:8px;">&nbsp;</td>'
            f'<td width="{100 - percent}%" style="font-size:0;line-height:8px;height:8px;">&nbsp;</td>'
            '</tr></table></td></tr>'
        )
    if not rows:
        return ""
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin-top:4px;">'
        + "".join(rows)
        + "</table>"
    )


def _email_timeline(section: dict[str, Any], *, theme: dict[str, Any]) -> str:
    items = _items_from(section, "items", "milestones", "steps")
    if not items:
        return ""
    rows: list[str] = []
    for raw_item in items[:8]:
        item = _as_item_record(raw_item)
        phase = _item_text(item, "phase", "date", "time", "label", max_chars=80)
        title = _item_text(item, "title", "heading", "name", max_chars=140)
        body = _item_text(item, "body", "description", "detail", "note", max_chars=220)
        if not title and not body:
            title = phase
            phase = ""
        body_node = (
            f'<div style="margin-top:4px;color:{theme["muted_color"]};font-size:13px;line-height:1.55;">{body}</div>'
            if body
            else ""
        )
        rows.append(
            '<tr>'
            f'<td valign="top" width="18" style="padding:8px 10px 8px 0;"><span style="display:block;width:10px;height:10px;background:{theme["brand_color"]};border-radius:999px;margin-top:4px;"></span></td>'
            f'<td valign="top" style="padding:8px 0;border-bottom:1px solid {theme.get("subtle_border_color", "#edf2f7")};">'
            f'<div style="color:{theme.get("warning_color", theme["accent_color"])};font-size:12px;font-weight:700;line-height:1.35;">{phase}</div>'
            f'<div style="margin-top:2px;color:{theme["text_color"]};font-size:14px;font-weight:700;line-height:1.45;">{title}</div>'
            f"{body_node}</td></tr>"
        )
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin-top:2px;">'
        + "".join(rows)
        + "</table>"
    )


def _email_comparison(section: dict[str, Any], *, theme: dict[str, Any]) -> str:
    if section.get("rows") or section.get("columns"):
        return _email_table(section, theme=theme)
    items = _items_from(section, "items", "data")
    if not items:
        return ""
    cells: list[str] = []
    for raw_item in items[:4]:
        item = _as_item_record(raw_item)
        label = _item_text(item, "label", "title", "name", max_chars=100)
        body = _item_text(item, "body", "description", "detail", "value", max_chars=260)
        if not label and not body:
            continue
        background = theme["soft_bg"] if _is_blueprint_theme(theme) else theme["surface"]
        border = "0" if _is_blueprint_theme(theme) else f'1px solid {theme["border_color"]}'
        cells.append(
            '<td valign="top" width="50%" style="padding:6px;">'
            f'<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;background:{background};border:{border};border-radius:12px;">'
            '<tr><td style="padding:20px;">'
            f'<div style="color:{theme["brand_color"]};font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;">{label}</div>'
            f'<div style="margin-top:8px;color:{theme["text_color"]};font-size:14px;line-height:1.62;">{body}</div>'
            "</td></tr></table></td>"
        )
    rows = []
    for index in range(0, len(cells), 2):
        row_cells = cells[index : index + 2]
        if len(row_cells) == 1:
            row_cells.append('<td width="50%" style="padding:6px;">&nbsp;</td>')
        rows.append(f"<tr>{''.join(row_cells)}</tr>")
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;margin:4px -6px 0;">'
        + "".join(rows)
        + "</table>"
    )


def _blueprint_status_chip(value: Any, *, theme: dict[str, Any]) -> str:
    raw = str(value or "").strip()
    text = _safe_text(raw, max_chars=80)
    lowered = raw.lower()
    progress_values = {"进行中", "处理中", "in progress", "progress", "ongoing"}
    done_values = {"完成", "已完成", "通过", "done", "completed", "passed", "approved"}
    todo_values = {"待办", "未开始", "todo", "pending", "open"}
    risk_values = {"风险", "高风险", "blocked", "risk", "failed"}
    if raw in done_values or lowered in done_values:
        background, color = "#ecfdf3", theme["accent_color"]
    elif raw in todo_values or lowered in todo_values:
        background, color = theme["soft_bg"], theme["muted_color"]
    elif raw in risk_values or lowered in risk_values:
        background, color = "#fff5f5", theme.get("danger_color", "#ff3b30")
    elif raw in progress_values or lowered in progress_values:
        background, color = "#eaf6ff", theme["brand_color"]
    else:
        return text
    return (
        f'<span style="display:inline-block;padding:4px 10px;background:{background};color:{color};'
        'font-size:11px;font-weight:500;border-radius:10px;">'
        f"{text}</span>"
    )


def _blueprint_email_table(section: dict[str, Any], *, theme: dict[str, Any]) -> str:
    columns = section.get("columns") if isinstance(section.get("columns"), list) else []
    rows = section.get("rows") if isinstance(section.get("rows"), list) else []
    if not columns and not rows:
        return ""
    head = "".join(
        f'<td style="padding:14px 16px;font-size:11px;font-weight:600;color:{theme["muted_color"]};'
        f'text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid {theme.get("subtle_border_color", "#f0f0f0")};"'
        f' width="{max(12, int(100 / max(1, len(columns[:8]) or 1)))}%">{_safe_text(col, max_chars=80)}</td>'
        for col in columns[:8]
    )
    body_rows: list[str] = []
    for row_index, row in enumerate(rows[:12]):
        values = row if isinstance(row, list) else [row]
        is_last = row_index == min(len(rows), 12) - 1
        border = "" if is_last else f'border-bottom:1px solid {theme.get("subtle_border_color", "#f0f0f0")};'
        cells = "".join(
            f'<td style="padding:16px;font-size:14px;color:{theme["text_color"]};line-height:1.5;{border}">'
            f'{_blueprint_status_chip(cell, theme=theme)}</td>'
            for cell in values[:8]
        )
        body_rows.append(f"<tr>{cells}</tr>")
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" '
        f'style="border-collapse:separate;border-spacing:0;width:100%;border:1px solid {theme.get("subtle_border_color", "#f0f0f0")};border-radius:12px;overflow:hidden;margin-top:2px;">'
        + (f'<tr style="background:{theme.get("table_head_bg", "#fafafa")};">{head}</tr>' if head else "")
        + "".join(body_rows)
        + "</table>"
    )


def _email_table(section: dict[str, Any], *, theme: dict[str, Any]) -> str:
    if _is_blueprint_theme(theme):
        return _blueprint_email_table(section, theme=theme)
    table_html = _table(section)
    if not table_html:
        return ""
    return table_html.replace("#dbe3ef", theme["border_color"]).replace("#0f172a", theme["text_color"])


def _email_section_inner(section: dict[str, Any], *, theme: dict[str, Any], section_type: str) -> str:
    heading = _email_heading(section, theme=theme)
    body = _email_body(section, theme=theme)
    if section_type in {"list", "insight_grid", "cards"}:
        return heading + body + _email_list_items(section.get("items"), theme=theme)
    if section_type in {"metric_grid", "metrics", "kpi", "stats"}:
        return heading + body + _email_metric_grid(section, theme=theme)
    if section_type in {"bar_chart", "progress_chart", "chart"}:
        return heading + body + _email_bar_chart(section, theme=theme)
    if section_type in {"timeline", "roadmap"}:
        return heading + body + _email_timeline(section, theme=theme)
    if section_type in {"comparison", "comparison_table"}:
        return heading + body + _email_comparison(section, theme=theme)
    if section_type == "table":
        return heading + body + _email_table(section, theme=theme)
    if section_type == "quote":
        return (
            f'<div style="border-left:4px solid {theme["brand_color"]};padding:2px 0 2px 14px;">'
            f'<p style="margin:0;color:{theme["text_color"]};font-size:15px;line-height:1.68;">'
            f'{_safe_text(section.get("body") or section.get("text"), max_chars=2200)}</p></div>'
        )
    return heading + body


def _render_email_section(section: Any, *, theme: dict[str, Any], template_id: str, index: int) -> str:
    section_padding = "0 0 30px" if _is_blueprint_theme(theme) else "0 34px 14px"
    if not isinstance(section, dict):
        content = f'<p style="margin:0;color:{theme["text_color"]};font-size:14px;line-height:1.65;">{_safe_text(section)}</p>'
        return f'<tr><td style="padding:{section_padding};">{_email_section_card(content, theme=theme, template_id=template_id)}</td></tr>'

    section_type = str(section.get("type") or "text").strip().lower()

    if section_type == "cta":
        label = _safe_text(section.get("label") or section.get("text") or "查看详情", max_chars=80)
        href = _safe_href(section.get("href"))
        align = "center" if template_id == "product_launch" else "left"
        if _is_blueprint_theme(theme):
            align = str(section.get("align") or "left")
        button = (
            f'<a href="{href}" style="display:inline-block;border-radius:999px;background:{theme["brand_color"]};'
            'color:#ffffff;text-decoration:none;padding:12px 20px;font-size:14px;font-weight:700;">'
            f'{label}</a>'
            if href
            else f'<span style="display:inline-block;color:{theme["brand_color"]};font-size:14px;font-weight:700;">{label}</span>'
        )
        cta_padding = "0 0 30px" if _is_blueprint_theme(theme) else "4px 34px 22px"
        return f'<tr><td align="{align}" style="padding:{cta_padding};">{button}</td></tr>'

    content = _email_section_inner(section, theme=theme, section_type=section_type)

    if not content:
        content = f'<p style="margin:0;color:{theme["muted_color"]};font-size:14px;">Draft section {index}</p>'
    return f'<tr><td style="padding:{section_padding};">{_email_section_card(content, theme=theme, template_id=template_id)}</td></tr>'


def _render_email_hero(
    hero: dict[str, Any],
    *,
    subject: str,
    preheader: str,
    brand_name: str,
    theme: dict[str, Any],
    template_id: str,
) -> str:
    heading = _safe_text(hero.get("heading") or hero.get("title") or subject, max_chars=180)
    body = _safe_text(hero.get("body") or hero.get("text") or preheader, max_chars=1200)
    brand = theme["brand_color"]
    accent = theme["accent_color"]
    text = theme["text_color"]
    muted = theme["muted_color"]

    if _is_blueprint_theme(theme):
        badge = _safe_text(
            hero.get("badge") or hero.get("eyebrow") or hero.get("kicker") or f"{brand_name} REVIEW",
            max_chars=80,
        )
        return (
            '<tr><td align="center" style="padding:0 0 50px;">'
            '<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">'
            '<tr><td align="center" style="padding-bottom:12px;">'
            f'<span style="display:inline-block;font-size:11px;font-weight:600;letter-spacing:1px;color:{brand};'
            f'text-transform:uppercase;background:#eaf6ff;padding:6px 14px;border-radius:20px;">{badge}</span>'
            '</td></tr>'
            '<tr><td align="center" style="padding-bottom:12px;">'
            f'<h1 style="margin:0;font-size:36px;font-weight:700;letter-spacing:-.5px;line-height:1.18;color:{text};">{heading}</h1>'
            '</td></tr>'
            '<tr><td align="center">'
            f'<p style="margin:0;font-size:18px;color:{muted};font-weight:400;line-height:1.5;">{body}</p>'
            '</td></tr></table></td></tr>'
        )

    if template_id == "newsletter_update":
        return (
            f'<tr><td style="padding:0;background:{brand};border-radius:16px 16px 0 0;">'
            '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">'
            f'<tr><td style="padding:32px 36px 30px;">'
            f'<div style="margin:0 0 16px;color:#ccfbf1;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">{brand_name} · Newsletter</div>'
            f'<h1 style="margin:0 0 12px;color:#ffffff;font-size:30px;line-height:1.18;">{heading}</h1>'
            f'<p style="margin:0;color:#d1fae5;font-size:15px;line-height:1.7;">{body}</p>'
            '</td></tr></table></td></tr>'
        )
    if template_id == "product_launch":
        return (
            f'<tr><td style="padding:0;background:{accent};border-radius:16px 16px 0 0;">'
            '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">'
            f'<tr><td style="padding:34px 36px 32px;border-top:6px solid {brand};">'
            f'<div style="margin:0 0 14px;color:#fed7aa;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">{brand_name} · Launch</div>'
            f'<h1 style="margin:0 0 12px;color:#ffffff;font-size:32px;line-height:1.14;">{heading}</h1>'
            f'<p style="margin:0;color:#e5e7eb;font-size:15px;line-height:1.7;">{body}</p>'
            '</td></tr></table></td></tr>'
        )
    return (
        '<tr><td style="padding:34px 38px 24px;">'
        f'<div style="margin:0 0 16px;color:{brand};font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;">{brand_name}</div>'
        f'<h1 style="margin:0 0 12px;color:{text};font-size:30px;line-height:1.18;">{heading}</h1>'
        f'<p style="margin:0;color:{muted};font-size:15px;line-height:1.72;">{body}</p>'
        f'<div style="height:3px;width:72px;background:{accent};border-radius:999px;margin-top:22px;"></div>'
        '</td></tr>'
    )


def _render_email_footer(footer: str, *, theme: dict[str, Any], brand_name: str, template_id: str) -> str:
    if _is_blueprint_theme(theme):
        return (
            '<tr><td align="center" style="padding:0 0 4px;">'
            f'<p style="margin:0;font-size:12px;color:{theme["muted_color"]};line-height:1.6;">{footer}</p>'
            '</td></tr>'
        )
    background = theme["soft_bg"] if template_id != "product_launch" else "#111827"
    color = theme["muted_color"] if template_id != "product_launch" else "#d1d5db"
    label_color = theme["brand_color"] if template_id != "product_launch" else "#fed7aa"
    return (
        f'<tr><td style="padding:20px 34px 24px;background:{background};border-radius:0 0 16px 16px;">'
        f'<div style="margin:0 0 6px;color:{label_color};font-size:12px;font-weight:700;">{brand_name}</div>'
        f'<div style="color:{color};font-size:12px;line-height:1.55;">{footer}</div>'
        '</td></tr>'
    )


def _section_heading(section: dict[str, Any]) -> str:
    heading = _safe_text(section.get("heading") or section.get("title"), max_chars=160)
    return f'<h2 style="margin:0 0 10px;font-size:18px;line-height:1.35;color:#0f172a;">{heading}</h2>' if heading else ""


def _list_items(items: Any) -> str:
    if not isinstance(items, list):
        return ""
    nodes = []
    for item in items[:12]:
        nodes.append(
            '<li style="margin:0 0 7px;color:#334155;line-height:1.55;">'
            f"{_safe_text(item, max_chars=240)}</li>"
        )
    return "".join(nodes)


def _table(section: dict[str, Any]) -> str:
    columns = section.get("columns") if isinstance(section.get("columns"), list) else []
    rows = section.get("rows") if isinstance(section.get("rows"), list) else []
    if not columns and not rows:
        return ""
    head = "".join(
        f'<th style="text-align:left;border-bottom:1px solid #dbe3ef;padding:8px 10px;color:#0f172a;font-size:12px;">{_safe_text(col, max_chars=80)}</th>'
        for col in columns[:8]
    )
    body_rows = []
    for row in rows[:12]:
        values = row if isinstance(row, list) else [row]
        body_rows.append(
            "<tr>"
            + "".join(
                f'<td style="border-bottom:1px solid #edf2f7;padding:8px 10px;color:#334155;font-size:12px;line-height:1.45;">{_safe_text(cell, max_chars=160)}</td>'
                for cell in values[:8]
            )
            + "</tr>"
        )
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-top:8px;">'
        + (f"<thead><tr>{head}</tr></thead>" if head else "")
        + f"<tbody>{''.join(body_rows)}</tbody></table>"
    )


def _render_section(section: Any, *, brand_color: str, email_mode: bool) -> str:
    if not isinstance(section, dict):
        body = _safe_text(section)
        return f'<div style="padding:18px 0;color:#334155;line-height:1.6;">{body}</div>'

    section_type = str(section.get("type") or "text").strip().lower()
    heading = _section_heading(section)
    body = _safe_text(section.get("body") or section.get("text"), max_chars=2200)

    if section_type == "hero":
        return (
            f'<div style="padding:26px 0 20px;border-bottom:1px solid #e2e8f0;">'
            f'<div style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{brand_color};">SmartDiagram</div>'
            f'<h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#0f172a;">{_safe_text(section.get("heading") or section.get("title"), max_chars=180)}</h1>'
            f'<p style="margin:0;color:#475569;font-size:15px;line-height:1.65;">{body}</p>'
            f"</div>"
        )
    if section_type == "list":
        return (
            '<div style="padding:18px 0;border-bottom:1px solid #edf2f7;">'
            f"{heading}<ul style=\"margin:0;padding-left:20px;\">{_list_items(section.get('items'))}</ul></div>"
        )
    if section_type == "cta":
        label = _safe_text(section.get("label") or section.get("text") or "查看详情", max_chars=80)
        href = _safe_href(section.get("href"))
        if href:
            return (
                '<div style="padding:20px 0;">'
                f'<a href="{href}" style="display:inline-block;border-radius:8px;background:{brand_color};color:#ffffff;text-decoration:none;padding:11px 18px;font-size:14px;font-weight:700;">{label}</a>'
                "</div>"
            )
        return f'<div style="padding:18px 0;color:{brand_color};font-weight:700;">{label}</div>'
    if section_type == "table":
        return f'<div style="padding:18px 0;border-bottom:1px solid #edf2f7;">{heading}{_table(section)}</div>'
    if section_type == "quote":
        return (
            f'<blockquote style="margin:18px 0;padding:12px 16px;border-left:4px solid {brand_color};background:#f8fafc;color:#334155;line-height:1.6;">'
            f"{body}</blockquote>"
        )

    spacing = "16px 0" if email_mode else "18px 0"
    return f'<div style="padding:{spacing};border-bottom:1px solid #edf2f7;">{heading}<p style="margin:0;color:#334155;line-height:1.65;">{body}</p></div>'


def _render_sections(payload: dict[str, Any], *, brand_color: str, email_mode: bool) -> str:
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    if not sections:
        sections = [{"type": "text", "body": payload.get("body") or payload.get("title") or "Draft"}]
    return "".join(_render_section(section, brand_color=brand_color, email_mode=email_mode) for section in sections[:18])


def render_html_email_artifact(payload: dict[str, Any]) -> HtmlArtifactRenderResult:
    """Render controlled HTML email DSL into client-safe HTML."""

    email = payload.get("email") if isinstance(payload.get("email"), dict) else {}
    template_id, theme = _email_theme(payload)
    brand_name = _safe_brand_name(payload)
    max_width = int(theme["max_width"])
    subject = str(email.get("subject") or payload.get("title") or "Untitled email").strip()[:160]
    preheader = str(email.get("preheader") or "").strip()[:220]
    hero, content_sections = _split_email_sections(payload, subject=subject, preheader=preheader)
    hero_html = _render_email_hero(
        hero,
        subject=subject,
        preheader=preheader,
        brand_name=brand_name,
        theme=theme,
        template_id=template_id,
    )
    sections = "".join(
        _render_email_section(section, theme=theme, template_id=template_id, index=index)
        for index, section in enumerate(content_sections, start=1)
    )
    footer = _safe_text(payload.get("footer") or "此邮件由 SmartDiagram Office Artifact Platform 生成。", max_chars=220)
    preheader_node = (
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{_safe_text(preheader, max_chars=220)}</div>'
        if preheader
        else ""
    )
    body_font = "-apple-system,system-ui,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif"
    outer_padding = "40px 20px 60px" if _is_blueprint_theme(theme) else "28px 12px"
    if _is_blueprint_theme(theme):
        container_style = f"border-collapse:collapse;width:100%;max-width:{max_width}px;"
    else:
        container_style = (
            "border-collapse:separate;width:100%;"
            f"max-width:{max_width}px;background:{theme['surface']};border:1px solid {theme['border_color']};border-radius:16px;"
        )
    html = f"""<!doctype html>
<html lang="{_safe_text(payload.get('language') or 'zh-CN', max_chars=16)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_safe_text(subject, max_chars=160)}</title>
</head>
<body style="margin:0;padding:0;background:{theme["background"]};font-family:{body_font};">
  {preheader_node}
  <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;background:{theme["background"]};">
    <tr>
      <td align="center" style="padding:{outer_padding};">
        <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="{container_style}">
          {hero_html}
          {sections}
          {_render_email_footer(footer, theme=theme, brand_name=brand_name, template_id=template_id)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
    policy = validate_rendered_html_policy(html)
    return {
        "html": html,
        "mime_type": "text/html; charset=utf-8",
        "metadata": {
            "renderer": "office-artifact-email-html",
            "artifact_type": "html_email",
            "template": template_id,
            "subject": subject,
            "preheader": preheader,
            "available_templates": EMAIL_TEMPLATE_OPTIONS,
            "policy": policy,
        },
    }


def render_web_report_artifact(payload: dict[str, Any]) -> HtmlArtifactRenderResult:
    """Render controlled report DSL into static HTML."""

    style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
    brand_color = _safe_color(style.get("brand_color"), "#0f766e")
    max_width = _safe_width(style.get("max_width"), 920)
    title = str(payload.get("title") or "HTML report").strip()[:180]
    subtitle = _safe_text(payload.get("audience") or payload.get("tone") or "Office report", max_chars=160)
    sections = _render_sections(payload, brand_color=brand_color, email_mode=False)
    html = f"""<!doctype html>
<html lang="{_safe_text(payload.get('language') or 'zh-CN', max_chars=16)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_safe_text(title, max_chars=180)}</title>
</head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
  <main style="max-width:{max_width}px;margin:0 auto;padding:40px 22px 56px;">
    <header style="padding:0 0 24px;border-bottom:3px solid {brand_color};">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:{brand_color};">SmartDiagram Report</div>
      <h1 style="margin:10px 0 8px;font-size:34px;line-height:1.15;color:#0f172a;">{_safe_text(title, max_chars=180)}</h1>
      <p style="margin:0;color:#64748b;font-size:14px;">{subtitle}</p>
    </header>
    <section style="background:#ffffff;border:1px solid #dbe3ef;border-radius:12px;margin-top:22px;padding:4px 24px 18px;">
      {sections}
    </section>
  </main>
</body>
</html>"""
    policy = validate_rendered_html_policy(html)
    return {
        "html": html,
        "mime_type": "text/html; charset=utf-8",
        "metadata": {
            "renderer": "office-artifact-report-html",
            "artifact_type": "web_report_html",
            "title": title,
            "policy": policy,
        },
    }


def render_html_artifact(payload: dict[str, Any]) -> HtmlArtifactRenderResult:
    """Render any supported office artifact DSL into HTML."""

    artifact_type = str(payload.get("artifact_type") or "").strip()
    if artifact_type == "html_email":
        return render_html_email_artifact(payload)
    return render_web_report_artifact(payload)
