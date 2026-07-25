"""Backend export renderers for diagram versions.

This service gives the export API a stable renderer boundary. It currently
produces deterministic JSON, SVG, PNG, and text-based PDF artifacts locally.
"""

import json
import math
from io import BytesIO
from html import escape
from typing import Any, TypedDict

from PIL import Image, ImageDraw, ImageFont

from app.artifacts.catalog import is_office_artifact
from app.models.diagram import DiagramVersion
from app.services.html_artifact_renderer import render_html_artifact


class RenderUnsupported(Exception):
    """Raised when a format requires an async renderer not available locally."""


class RenderResult(TypedDict):
    content: bytes
    mime_type: str
    extension: str
    metadata: dict[str, Any]


def _diagram_payload(diagram_id: str, version: DiagramVersion) -> dict[str, Any]:
    return {
        "diagram_id": diagram_id,
        "diagram_version_id": version.id,
        "engine_type": version.engine_type,
        "task_type": version.task_type,
        "code": version.code,
        "design_concept": version.design_concept,
        "validation": version.validation_json,
    }


def render_json(diagram_id: str, version: DiagramVersion) -> RenderResult:
    content = json.dumps(_diagram_payload(diagram_id, version), ensure_ascii=False, indent=2).encode("utf-8")
    return {
        "content": content,
        "mime_type": "application/json",
        "extension": "json",
        "metadata": {"renderer": "json", "source": "diagram_version"},
    }


def _lines(text: str, max_lines: int = 28) -> list[str]:
    raw_lines = text.strip().splitlines() or [""]
    clipped = raw_lines[:max_lines]
    if len(raw_lines) > max_lines:
        clipped.append("...")
    return clipped


def _generic_svg(title: str, subtitle: str, body: str) -> bytes:
    body_lines = _lines(body)
    height = max(420, 150 + 24 * len(body_lines))
    text_nodes = []
    y = 138
    for line in body_lines:
        text_nodes.append(
            f'<text x="48" y="{y}" font-size="15" font-family="Menlo, Consolas, monospace" fill="#334155">'
            f"{escape(line[:140])}</text>"
        )
        y += 24
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="{height}" viewBox="0 0 1200 {height}">
  <rect width="1200" height="{height}" fill="#f8fafc"/>
  <rect x="28" y="28" width="1144" height="{height - 56}" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="48" y="76" font-size="30" font-family="Inter, Arial, sans-serif" font-weight="700" fill="#0f172a">{escape(title)}</text>
  <text x="48" y="108" font-size="16" font-family="Inter, Arial, sans-serif" fill="#64748b">{escape(subtitle)}</text>
  {''.join(text_nodes)}
</svg>"""
    return svg.encode("utf-8")


def _flow_svg(version: DiagramVersion) -> bytes | None:
    try:
        payload = json.loads(version.code)
    except json.JSONDecodeError:
        return None
    nodes = payload.get("nodes")
    edges = payload.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return None

    width = 1200
    height = max(500, 160 + len(nodes) * 90)
    node_lookup = {str(node.get("id")): node for node in nodes if isinstance(node, dict)}
    node_shapes = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        position = node.get("position") if isinstance(node.get("position"), dict) else {}
        x = float(position.get("x", 80 + (index % 3) * 340))
        y = float(position.get("y", 120 + (index // 3) * 130))
        label = node.get("data", {}).get("label") if isinstance(node.get("data"), dict) else node.get("id", "")
        node_shapes.append(
            f'<rect x="{x}" y="{y}" width="240" height="64" rx="10" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>'
            f'<text x="{x + 18}" y="{y + 38}" font-size="15" font-family="Inter, Arial" fill="#1e293b">{escape(str(label)[:32])}</text>'
        )

    edge_shapes = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source = node_lookup.get(str(edge.get("source")))
        target = node_lookup.get(str(edge.get("target")))
        if not source or not target:
            continue
        sp = source.get("position") if isinstance(source.get("position"), dict) else {}
        tp = target.get("position") if isinstance(target.get("position"), dict) else {}
        x1 = float(sp.get("x", 80)) + 240
        y1 = float(sp.get("y", 120)) + 32
        x2 = float(tp.get("x", 420))
        y2 = float(tp.get("y", 120)) + 32
        edge_shapes.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>'
        )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"/></marker></defs>
  <rect width="{width}" height="{height}" fill="#f8fafc"/>
  <text x="48" y="64" font-size="28" font-family="Inter, Arial" font-weight="700" fill="#0f172a">React Flow Export</text>
  {''.join(edge_shapes)}
  {''.join(node_shapes)}
</svg>"""
    return svg.encode("utf-8")


def render_svg(diagram_id: str, version: DiagramVersion) -> RenderResult:
    if version.engine_type == "flow":
        svg = _flow_svg(version)
        if svg:
            return {
                "content": svg,
                "mime_type": "image/svg+xml",
                "extension": "svg",
                "metadata": {"renderer": "flow-svg", "source": "diagram_version"},
            }

    title = f"{version.engine_type or 'diagram'} export"
    subtitle = f"Diagram {diagram_id} / Version {version.id}"
    content = _generic_svg(title, subtitle, version.code or version.design_concept)
    return {
        "content": content,
        "mime_type": "image/svg+xml",
        "extension": "svg",
        "metadata": {"renderer": "generic-svg", "source": "diagram_version"},
    }


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _draw_wrapped_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: str,
    max_width: int,
    line_height: int,
    max_lines: int,
) -> int:
    x, y = xy
    lines: list[str] = []
    for paragraph in str(text).splitlines() or [""]:
        current = ""
        for char in paragraph:
            candidate = current + char
            if not current or _text_width(draw, candidate, font) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = char
            if len(lines) >= max_lines:
                break
        if len(lines) >= max_lines:
            break
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if len(lines) == max_lines and len(str(text)) > sum(len(line) for line in lines):
        lines[-1] = lines[-1].rstrip(". ") + "..."

    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _draw_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    fill: str,
) -> None:
    draw.line([start, end], fill=fill, width=3)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    size = 12
    left = (
        end[0] - size * math.cos(angle - math.pi / 6),
        end[1] - size * math.sin(angle - math.pi / 6),
    )
    right = (
        end[0] - size * math.cos(angle + math.pi / 6),
        end[1] - size * math.sin(angle + math.pi / 6),
    )
    draw.polygon([end, left, right], fill=fill)


def _flow_png(version: DiagramVersion) -> bytes | None:
    try:
        payload = json.loads(version.code)
    except json.JSONDecodeError:
        return None
    nodes = payload.get("nodes")
    edges = payload.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return None

    width = 1200
    node_width = 300
    node_height = 78
    height = max(560, 170 + len(nodes) * 116)
    image = Image.new("RGB", (width, height), "#f8fafc")
    draw = ImageDraw.Draw(image)
    title_font = _font(32, bold=True)
    label_font = _font(17, bold=True)
    small_font = _font(13)

    draw.rounded_rectangle((28, 28, width - 28, height - 28), radius=18, fill="#ffffff", outline="#cbd5e1", width=2)
    draw.text((56, 58), "React Flow PNG Export", font=title_font, fill="#0f172a")
    draw.text((58, 102), "SmartDiagram backend renderer", font=small_font, fill="#64748b")

    node_lookup: dict[str, tuple[float, float]] = {}
    all_zero_position = True
    for node in nodes:
        if not isinstance(node, dict):
            continue
        position = node.get("position") if isinstance(node.get("position"), dict) else {}
        if float(position.get("x", 0) or 0) != 0 or float(position.get("y", 0) or 0) != 0:
            all_zero_position = False
            break

    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id"))
        position = node.get("position") if isinstance(node.get("position"), dict) else {}
        if all_zero_position:
            x = (width - node_width) / 2
            y = 150 + index * 112
        else:
            x = max(56, min(width - node_width - 56, float(position.get("x", 80))))
            y = max(145, float(position.get("y", 120)))
        node_lookup[node_id] = (x, y)

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source = node_lookup.get(str(edge.get("source")))
        target = node_lookup.get(str(edge.get("target")))
        if not source or not target:
            continue
        start = (source[0] + node_width / 2, source[1] + node_height)
        end = (target[0] + node_width / 2, target[1])
        _draw_arrow(draw, start, end, "#64748b")

    for index, node in enumerate(nodes, start=1):
        if not isinstance(node, dict):
            continue
        x, y = node_lookup.get(str(node.get("id")), (80, 150 + index * 112))
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        label = data.get("label") or node.get("id") or f"Step {index}"
        draw.rounded_rectangle(
            (x, y, x + node_width, y + node_height),
            radius=14,
            fill="#eff6ff",
            outline="#2563eb",
            width=2,
        )
        draw.ellipse((x + 16, y + 24, x + 46, y + 54), fill="#2563eb")
        draw.text((x + 26 - _text_width(draw, str(index), small_font) / 2, y + 31), str(index), font=small_font, fill="#ffffff")
        _draw_wrapped_text(
            draw,
            (int(x + 58), int(y + 18)),
            str(label),
            label_font,
            "#1e293b",
            max_width=node_width - 78,
            line_height=22,
            max_lines=2,
        )

    return _png_bytes(image)


def render_png(diagram_id: str, version: DiagramVersion) -> RenderResult:
    if version.engine_type == "flow":
        flow_png = _flow_png(version)
        if flow_png:
            return {
                "content": flow_png,
                "mime_type": "image/png",
                "extension": "png",
                "metadata": {"renderer": "flow-pillow-png", "source": "diagram_version"},
            }

    width = 1200
    height = 760
    image = Image.new("RGB", (width, height), "#f8fafc")
    draw = ImageDraw.Draw(image)
    title_font = _font(32, bold=True)
    subtitle_font = _font(15)
    mono_font = _font(15)

    draw.rounded_rectangle((28, 28, width - 28, height - 28), radius=18, fill="#ffffff", outline="#cbd5e1", width=2)
    draw.text((56, 58), f"{version.engine_type or 'Diagram'} PNG Export", font=title_font, fill="#0f172a")
    draw.text((58, 102), f"Diagram {diagram_id} / Version {version.id}", font=subtitle_font, fill="#64748b")
    body = version.code or version.design_concept or ""
    _draw_wrapped_text(
        draw,
        (58, 150),
        body[:4000],
        mono_font,
        "#334155",
        max_width=1080,
        line_height=23,
        max_lines=23,
    )
    return {
        "content": _png_bytes(image),
        "mime_type": "image/png",
        "extension": "png",
        "metadata": {"renderer": "generic-pillow-png", "source": "diagram_version"},
    }


def _pdf_text_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_pdf(diagram_id: str, version: DiagramVersion) -> RenderResult:
    """Render a simple text-based PDF export without external dependencies."""

    lines = [
        f"SmartDiagram {version.engine_type} export",
        f"Diagram: {diagram_id}",
        f"Version: {version.id}",
        "",
        "Design concept:",
        version.design_concept or "-",
        "",
        "Diagram code:",
    ]
    lines.extend((version.code or "").splitlines()[:36])

    stream_parts = ["BT", "/F1 12 Tf", "50 790 Td", "16 TL"]
    for line in lines[:48]:
        stream_parts.append(f"({_pdf_text_escape(line[:110])}) Tj")
        stream_parts.append("T*")
    stream_parts.append("ET")
    stream = "\n".join(stream_parts).encode("latin-1", errors="replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return {
        "content": bytes(output),
        "mime_type": "application/pdf",
        "extension": "pdf",
        "metadata": {"renderer": "text-pdf", "source": "diagram_version"},
    }


def render_html(diagram_id: str, version: DiagramVersion) -> RenderResult:
    """Render an office artifact DSL version into HTML bytes."""

    if not is_office_artifact(version.engine_type):
        raise RenderUnsupported(f"HTML export is only supported for office artifacts, got {version.engine_type}")
    try:
        payload = json.loads(version.code)
    except json.JSONDecodeError as exc:
        raise RenderUnsupported(f"Office artifact JSON parse failed: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise RenderUnsupported("Office artifact export requires a JSON object")
    payload.setdefault("artifact_type", version.engine_type)
    rendered = render_html_artifact(payload)
    policy = rendered["metadata"].get("policy") or {}
    if policy.get("ok") is False:
        raise RenderUnsupported("; ".join(policy.get("errors") or ["Rendered HTML failed policy checks"]))
    return {
        "content": rendered["html"].encode("utf-8"),
        "mime_type": rendered["mime_type"],
        "extension": "html",
        "metadata": {
            **rendered["metadata"],
            "renderer": "office-artifact-html",
            "source": "diagram_version",
            "diagram_id": diagram_id,
        },
    }


def render_export(diagram_id: str, version: DiagramVersion, export_format: str) -> RenderResult:
    """Render a diagram version into a binary export artifact."""

    fmt = export_format.lower()
    if fmt == "json":
        return render_json(diagram_id, version)
    if fmt == "html":
        return render_html(diagram_id, version)
    if fmt == "svg":
        return render_svg(diagram_id, version)
    if fmt == "pdf":
        return render_pdf(diagram_id, version)
    if fmt == "png":
        return render_png(diagram_id, version)
    raise RenderUnsupported(f"Unsupported export format: {export_format}")
