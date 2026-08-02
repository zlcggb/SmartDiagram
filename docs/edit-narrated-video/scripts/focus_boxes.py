#!/usr/bin/env python3
"""Extract PPTX geometry, resolve semantic anchors, and validate focus boxes.

Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import posixpath
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
EMU_PER_INCH = 914400


def q(prefix: str, local: str) -> str:
    return f"{{{NS[prefix]}}}{local}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def as_float(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except ValueError:
        return default


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    return "".join(char for char in value if char.isalnum() or "\u4e00" <= char <= "\u9fff")


def shape_text(element: ET.Element) -> str:
    chunks = [(node.text or "").strip() for node in element.iter(q("a", "t"))]
    return " ".join(chunk for chunk in chunks if chunk)


def direct_child(parent: ET.Element, *names: str) -> ET.Element | None:
    wanted = set(names)
    return next((child for child in parent if local_name(child.tag) in wanted), None)


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h

    @property
    def area(self) -> float:
        return max(0.0, self.w) * max(0.0, self.h)

    def padded(self, amount: float, max_w: float, max_h: float) -> "Box":
        x = max(0.0, self.x - amount)
        y = max(0.0, self.y - amount)
        right = min(max_w, self.right + amount)
        bottom = min(max_h, self.bottom + amount)
        return Box(x, y, max(0.0, right - x), max(0.0, bottom - y))

    def normalized(self, width: float, height: float) -> dict[str, float]:
        return {
            "x": round(self.x / width, 6),
            "y": round(self.y / height, 6),
            "w": round(self.w / width, 6),
            "h": round(self.h / height, 6),
        }

    def contains(self, other: "Box", tolerance: float = 0.0) -> bool:
        return (
            self.x <= other.x + tolerance
            and self.y <= other.y + tolerance
            and self.right >= other.right - tolerance
            and self.bottom >= other.bottom - tolerance
        )

    def intersection(self, other: "Box") -> float:
        width = max(0.0, min(self.right, other.right) - max(self.x, other.x))
        height = max(0.0, min(self.bottom, other.bottom) - max(self.y, other.y))
        return width * height

    @classmethod
    def union(cls, boxes: Iterable["Box"]) -> "Box":
        items = list(boxes)
        if not items:
            raise ValueError("Cannot union an empty box list")
        x = min(item.x for item in items)
        y = min(item.y for item in items)
        right = max(item.right for item in items)
        bottom = max(item.bottom for item in items)
        return cls(x, y, right - x, bottom - y)


@dataclass(frozen=True)
class Transform:
    sx: float = 1.0
    sy: float = 1.0
    tx: float = 0.0
    ty: float = 0.0

    def box(self, raw: Box, rotation_degrees: float = 0.0) -> Box:
        mapped = Box(
            self.tx + raw.x * self.sx,
            self.ty + raw.y * self.sy,
            abs(raw.w * self.sx),
            abs(raw.h * self.sy),
        )
        if abs(rotation_degrees) < 0.01:
            return mapped
        radians = math.radians(rotation_degrees)
        rotated_w = abs(mapped.w * math.cos(radians)) + abs(mapped.h * math.sin(radians))
        rotated_h = abs(mapped.w * math.sin(radians)) + abs(mapped.h * math.cos(radians))
        center_x = mapped.x + mapped.w / 2
        center_y = mapped.y + mapped.h / 2
        return Box(center_x - rotated_w / 2, center_y - rotated_h / 2, rotated_w, rotated_h)


def xfrm_box(xfrm: ET.Element | None) -> tuple[Box | None, float]:
    if xfrm is None:
        return None, 0.0
    off = direct_child(xfrm, "off")
    ext = direct_child(xfrm, "ext")
    if off is None or ext is None:
        return None, 0.0
    raw = Box(
        as_float(off.get("x")),
        as_float(off.get("y")),
        as_float(ext.get("cx")),
        as_float(ext.get("cy")),
    )
    return raw, as_float(xfrm.get("rot")) / 60000.0


def non_visual_identity(element: ET.Element) -> tuple[str, str]:
    node = next((item for item in element.iter() if local_name(item.tag) == "cNvPr"), None)
    if node is None:
        return "unknown", ""
    return node.get("id", "unknown"), node.get("name", "")


def shape_xfrm(element: ET.Element) -> ET.Element | None:
    kind = local_name(element.tag)
    if kind == "graphicFrame":
        return direct_child(element, "xfrm")
    properties = direct_child(element, "spPr", "grpSpPr")
    return direct_child(properties, "xfrm") if properties is not None else None


def geometry_name(element: ET.Element) -> str:
    properties = direct_child(element, "spPr")
    if properties is None:
        return ""
    preset = next((item for item in properties if local_name(item.tag) == "prstGeom"), None)
    return preset.get("prst", "") if preset is not None else ""


def group_transform(element: ET.Element, parent: Transform) -> Transform:
    xfrm = shape_xfrm(element)
    if xfrm is None:
        return parent
    off = direct_child(xfrm, "off")
    ext = direct_child(xfrm, "ext")
    child_off = direct_child(xfrm, "chOff")
    child_ext = direct_child(xfrm, "chExt")
    if None in (off, ext, child_off, child_ext):
        return parent
    off_x, off_y = as_float(off.get("x")), as_float(off.get("y"))
    ext_x, ext_y = as_float(ext.get("cx")), as_float(ext.get("cy"))
    child_x, child_y = as_float(child_off.get("x")), as_float(child_off.get("y"))
    child_w = max(1.0, as_float(child_ext.get("cx"), 1.0))
    child_h = max(1.0, as_float(child_ext.get("cy"), 1.0))
    sx = parent.sx * ext_x / child_w
    sy = parent.sy * ext_y / child_h
    return Transform(sx=sx, sy=sy, tx=parent.tx + parent.sx * off_x - sx * child_x, ty=parent.ty + parent.sy * off_y - sy * child_y)


def table_cells(frame: ET.Element, frame_id: str, frame_box: Box, z_index: int) -> list[dict[str, Any]]:
    table = next((item for item in frame.iter() if local_name(item.tag) == "tbl"), None)
    if table is None:
        return []
    grid = next((item for item in table if local_name(item.tag) == "tblGrid"), None)
    rows = [item for item in table if local_name(item.tag) == "tr"]
    widths = [as_float(item.get("w")) for item in grid] if grid is not None else []
    heights = [as_float(row.get("h")) for row in rows]
    width_total = sum(widths) or 1.0
    height_total = sum(heights) or 1.0
    results: list[dict[str, Any]] = []
    y = frame_box.y
    for row_index, (row, raw_height) in enumerate(zip(rows, heights)):
        row_height = frame_box.h * raw_height / height_total
        cells = [item for item in row if local_name(item.tag) == "tc"]
        x = frame_box.x
        col_index = 0
        for cell_index, cell in enumerate(cells):
            span = max(1, int(as_float(cell.get("gridSpan"), 1)))
            raw_width = sum(widths[col_index:col_index + span]) if widths else width_total / max(1, len(cells))
            cell_width = frame_box.w * raw_width / width_total
            text = shape_text(cell)
            results.append({
                "id": f"{frame_id}:r{row_index + 1}c{cell_index + 1}",
                "sourceId": frame_id,
                "name": f"table row {row_index + 1} cell {cell_index + 1}",
                "type": "tableCell",
                "geometry": "rect",
                "text": text,
                "boxEmu": {"x": x, "y": y, "w": cell_width, "h": row_height},
                "z": z_index,
            })
            x += cell_width
            col_index += span
        y += row_height
    return results


def extract_slide_shapes(root: ET.Element, page: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    tree = next((item for item in root.iter() if local_name(item.tag) == "spTree"), None)
    if tree is None:
        return [], [{"page": page, "reason": "missing spTree"}]
    shapes: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    z_counter = 0

    def visit(parent: ET.Element, transform: Transform) -> None:
        nonlocal z_counter
        for element in parent:
            kind = local_name(element.tag)
            if kind in {"nvGrpSpPr", "grpSpPr"}:
                continue
            if kind == "grpSp":
                visit(element, group_transform(element, transform))
                continue
            if kind not in {"sp", "pic", "graphicFrame", "cxnSp"}:
                continue
            z_counter += 1
            raw_id, name = non_visual_identity(element)
            item_id = f"s{page}:{raw_id}"
            raw_box, rotation = xfrm_box(shape_xfrm(element))
            if raw_box is None:
                unresolved.append({"page": page, "id": item_id, "name": name, "reason": "missing local transform; resolve from layout/master or OCR"})
                continue
            box = transform.box(raw_box, rotation)
            item = {
                "id": item_id,
                "sourceId": item_id,
                "name": name,
                "type": kind,
                "geometry": geometry_name(element),
                "text": shape_text(element),
                "rotationDegrees": round(rotation, 4),
                "boxEmu": {"x": box.x, "y": box.y, "w": box.w, "h": box.h},
                "z": z_counter,
            }
            shapes.append(item)
            if kind == "graphicFrame":
                shapes.extend(table_cells(element, item_id, box, z_counter))

    visit(tree, Transform())
    return shapes, unresolved


def presentation_slide_paths(archive: zipfile.ZipFile) -> list[str]:
    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
    rels = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
    relation_map = {node.get("Id"): node.get("Target") for node in rels if node.get("Id") and node.get("Target")}
    paths: list[str] = []
    for slide_id in presentation.iter(q("p", "sldId")):
        relation = slide_id.get(q("r", "id"))
        target = relation_map.get(relation)
        if not target:
            continue
        paths.append(posixpath.normpath(posixpath.join("ppt", target)))
    return paths


def slide_size(archive: zipfile.ZipFile) -> tuple[float, float]:
    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
    node = next(presentation.iter(q("p", "sldSz")), None)
    if node is None:
        raise ValueError("presentation.xml does not contain p:sldSz")
    return as_float(node.get("cx")), as_float(node.get("cy"))


def extract_command(args: argparse.Namespace) -> None:
    pptx = Path(args.pptx).resolve()
    with zipfile.ZipFile(pptx) as archive:
        slide_w, slide_h = slide_size(archive)
        slides = []
        unresolved = []
        for page, slide_path in enumerate(presentation_slide_paths(archive), start=1):
            root = ET.fromstring(archive.read(slide_path))
            shapes, slide_unresolved = extract_slide_shapes(root, page)
            for item in shapes:
                box = Box(**item["boxEmu"])
                item["box"] = box.normalized(slide_w, slide_h)
                item["boxPx"] = {
                    "x": round(box.x / slide_w * args.width, 2),
                    "y": round(box.y / slide_h * args.height, 2),
                    "w": round(box.w / slide_w * args.width, 2),
                    "h": round(box.h / slide_h * args.height, 2),
                }
            slides.append({"page": page, "source": slide_path, "shapes": shapes})
            unresolved.extend(slide_unresolved)
    result = {
        "version": 1,
        "source": str(pptx),
        "slideSizeEmu": {"width": slide_w, "height": slide_h},
        "slideSizeInches": {"width": round(slide_w / EMU_PER_INCH, 4), "height": round(slide_h / EMU_PER_INCH, 4)},
        "renderSize": {"width": args.width, "height": args.height},
        "slides": slides,
        "unresolved": unresolved,
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"slides": len(slides), "shapes": sum(len(slide["shapes"]) for slide in slides), "unresolved": len(unresolved), "output": str(Path(args.output).resolve())}, ensure_ascii=False))


def box_from_item(item: dict[str, Any]) -> Box:
    return Box(**item["boxPx"])


def adaptive_text_padding(base: Box, selected_ids: set[str], text_shapes: list[dict[str, Any]], padding: float, width: float, height: float) -> Box:
    """Pad a selected text union without swallowing an adjacent text block."""
    left = right = top = bottom = padding
    for item in text_shapes:
        item_id = item["id"]
        if item_id in selected_ids:
            continue
        # A table parent repeats all cell text and geometrically contains every
        # selected cell. It is structural metadata, not unrelated visible copy.
        if item.get("type") == "graphicFrame" and any(value.startswith(f"{item_id}:") for value in selected_ids):
            continue
        other = box_from_item(item)
        horizontal_overlap = max(0.0, min(base.right, other.right) - max(base.x, other.x))
        vertical_overlap = max(0.0, min(base.bottom, other.bottom) - max(base.y, other.y))
        if horizontal_overlap >= min(base.w, other.w) * 0.2:
            if other.bottom <= base.y:
                top = min(top, max(2.0, (base.y - other.bottom) / 2.0))
            elif other.y >= base.bottom:
                bottom = min(bottom, max(2.0, (other.y - base.bottom) / 2.0))
        if vertical_overlap >= min(base.h, other.h) * 0.2:
            if other.right <= base.x:
                left = min(left, max(2.0, (base.x - other.right) / 2.0))
            elif other.x >= base.right:
                right = min(right, max(2.0, (other.x - base.right) / 2.0))
    x = max(0.0, base.x - left)
    y = max(0.0, base.y - top)
    right_edge = min(width, base.right + right)
    bottom_edge = min(height, base.bottom + bottom)
    return Box(x, y, right_edge - x, bottom_edge - y)


def anchor_score(anchor: str, item: dict[str, Any]) -> float:
    needle = normalize_text(anchor)
    haystack = normalize_text(item.get("text", ""))
    if not needle or not haystack:
        return 0.0
    if needle in haystack:
        return 1.0 + min(0.2, len(needle) / max(1, len(haystack)) * 0.2)
    ratio = difflib.SequenceMatcher(None, needle, haystack).ratio()
    needle_chars = set(needle)
    haystack_chars = set(haystack)
    overlap = len(needle_chars & haystack_chars) / max(1, len(needle_chars | haystack_chars))
    return 0.72 * ratio + 0.28 * overlap


def find_smallest_container(shapes: list[dict[str, Any]], union: Box, selected_ids: set[str], mode: str) -> dict[str, Any] | None:
    if mode != "container":
        return None
    candidates = []
    for item in shapes:
        if item["id"] in selected_ids or item["type"] not in {"sp", "pic"}:
            continue
        if item["type"] == "pic" or item.get("geometry") in {"line", "straightConnector1"}:
            continue
        box = box_from_item(item)
        if box.contains(union, tolerance=2.0) and box.area <= union.area * 8.0:
            candidates.append((box.area, item))
    return min(candidates, default=(None, None), key=lambda pair: pair[0])[1]


def resolve_event(event: dict[str, Any], shapes: list[dict[str, Any]], width: float, height: float, default_padding: float) -> tuple[dict[str, Any], dict[str, Any]]:
    text_shapes = [item for item in shapes if normalize_text(item.get("text", ""))]
    selected: list[dict[str, Any]] = []
    requested_ids = event.get("shapeIds") or []
    if requested_ids:
        by_id = {item["id"]: item for item in shapes}
        missing = [item_id for item_id in requested_ids if item_id not in by_id]
        if missing:
            raise ValueError(f"Unknown shapeIds: {missing}")
        selected = [by_id[item_id] for item_id in requested_ids]
    else:
        anchors = event.get("anchors") or []
        if not anchors:
            raise ValueError("Each focus event requires anchors or shapeIds")
        for anchor in anchors:
            ranked = sorted(((anchor_score(anchor, item), item) for item in text_shapes), key=lambda pair: pair[0], reverse=True)
            if not ranked or ranked[0][0] < float(event.get("minScore", 0.58)):
                raise ValueError(f"No reliable shape match for anchor: {anchor!r}")
            selected.append(ranked[0][1])
    selected_by_id = {item["id"]: item for item in selected}
    selected = list(selected_by_id.values())
    base_union = Box.union(box_from_item(item) for item in selected)
    container = find_smallest_container(shapes, base_union, set(selected_by_id), event.get("mode", "text"))
    if container is not None:
        container_box = box_from_item(container)
        selected = [item for item in text_shapes if container_box.contains(box_from_item(item), tolerance=2.0)] or selected
        base_union = Box.union(box_from_item(item) for item in selected)
        focus = container_box.padded(float(event.get("containerPaddingPx", 6)), width, height)
        container_id = container["id"]
    else:
        focus = adaptive_text_padding(
            base_union,
            set(selected_by_id),
            text_shapes,
            float(event.get("paddingPx", default_padding)),
            width,
            height,
        )
        container_id = None
    selected_ids = {item["id"] for item in selected}
    covered_area = sum(focus.intersection(box_from_item(item)) for item in selected)
    selected_area = sum(max(1.0, box_from_item(item).area) for item in selected)
    unrelated = []
    for item in text_shapes:
        if item["id"] in selected_ids:
            continue
        if item.get("type") == "graphicFrame" and any(value.startswith(f"{item['id']}:") for value in selected_ids):
            continue
        item_box = box_from_item(item)
        overlap = focus.intersection(item_box) / max(1.0, item_box.area)
        if overlap >= 0.5:
            unrelated.append({"id": item["id"], "text": item.get("text", ""), "overlap": round(overlap, 4)})
    coverage = min(1.0, covered_area / max(1.0, selected_area))
    tightness = min(1.0, base_union.area / max(1.0, focus.area))
    qa = {
        "coverage": round(coverage, 4),
        "tightness": round(tightness, 4),
        "unrelatedTextHits": unrelated,
        "edgeClipped": focus.x <= 0 or focus.y <= 0 or focus.right >= width or focus.bottom >= height,
    }
    qa["pass"] = (
        coverage >= 0.98
        and tightness >= float(event.get("minTightness", 0.35))
        and (not qa["edgeClipped"] or bool(event.get("allowEdge", False)))
        and (not unrelated or event.get("mode") == "container" or bool(event.get("allowUnrelated", False)))
    )
    resolved = {
        **{key: value for key, value in event.items() if key not in {"anchors", "shapeIds"}},
        "anchors": event.get("anchors", []),
        "targetShapeIds": sorted(selected_ids),
        "containerShapeId": container_id,
        "box": focus.normalized(width, height),
    }
    return resolved, qa


def resolve_command(args: argparse.Namespace) -> None:
    candidates = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    targets = json.loads(Path(args.targets).read_text(encoding="utf-8"))
    width = float(candidates["renderSize"]["width"])
    height = float(candidates["renderSize"]["height"])
    slides_by_page = {slide["page"]: slide for slide in candidates["slides"]}
    output_slides = []
    report_events = []
    for slide_spec in targets.get("slides", []):
        page = int(slide_spec["page"])
        if page not in slides_by_page:
            raise ValueError(f"Unknown slide page: {page}")
        resolved_events = []
        for index, event in enumerate(slide_spec.get("events", [])):
            resolved, qa = resolve_event(event, slides_by_page[page]["shapes"], width, height, float(targets.get("paddingPx", 14)))
            resolved_events.append(resolved)
            report_events.append({"page": page, "event": index + 1, "qa": qa, "resolved": resolved})
        output_slides.append({"page": page, "events": resolved_events})
    result = {"version": 1, "sourceCandidates": str(Path(args.candidates).resolve()), "slides": output_slides}
    report = {
        "version": 1,
        "events": report_events,
        "passed": sum(1 for item in report_events if item["qa"]["pass"]),
        "failed": sum(1 for item in report_events if not item["qa"]["pass"]),
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_path = Path(args.report) if args.report else Path(args.output).with_suffix(".qa.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"events": len(report_events), "passed": report["passed"], "failed": report["failed"], "output": str(Path(args.output).resolve()), "report": str(report_path.resolve())}, ensure_ascii=False))
    if report["failed"] and args.fail_on_qa:
        raise SystemExit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    extract = subparsers.add_parser("extract", help="Extract shape and table-cell geometry from PPTX")
    extract.add_argument("pptx")
    extract.add_argument("--output", required=True)
    extract.add_argument("--width", type=int, default=1920)
    extract.add_argument("--height", type=int, default=1080)
    extract.set_defaults(func=extract_command)
    resolve = subparsers.add_parser("resolve", help="Resolve semantic anchors to deterministic focus boxes")
    resolve.add_argument("--candidates", required=True)
    resolve.add_argument("--targets", required=True)
    resolve.add_argument("--output", required=True)
    resolve.add_argument("--report")
    resolve.add_argument("--fail-on-qa", action="store_true")
    resolve.set_defaults(func=resolve_command)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except (KeyError, ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
