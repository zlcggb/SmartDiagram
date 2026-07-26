import type { DesignRecipe } from "./types.js";

type Point = { x: number; y: number };
type Bounds = { x: number; y: number; w: number; h: number };
type ElementKind = "solid" | "text" | "connector";

type SpatialElement = {
  tag: string;
  groupId: string;
  kind: ElementKind;
  bounds: Bounds;
  segments: Array<readonly [Point, Point]>;
};

type SpatialGroup = {
  id: string;
  order: number;
  layer: number;
  elements: SpatialElement[];
};

type GroupContext = {
  x: number;
  y: number;
  semanticGroupId: string | null;
};

export interface SvgSpatialQualityResult {
  ok: boolean;
  issues: string[];
}

const SAFE_BOUNDS: Bounds = { x: 32, y: 24, w: 1216, h: 672 };
const OVERLAP_TOLERANCE = 8;
const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)([^>]*)>/g;
const ATTR_RE = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const PATH_TOKEN_RE = /-?(?:\d*\.)?\d+(?:e[-+]?\d+)?|[A-Za-z]/gi;

function attributes(source: string) {
  const result = new Map<string, string>();
  for (const match of source.matchAll(ATTR_RE)) {
    result.set((match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? "");
  }
  return result;
}

function numberValue(attrs: Map<string, string>, key: string, fallback = 0) {
  const value = Number.parseFloat(attrs.get(key) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function translateValue(value: string | undefined): Point {
  if (!value) return { x: 0, y: 0 };
  const match = value.match(/translate\(\s*(-?(?:\d*\.)?\d+)(?:[\s,]+(-?(?:\d*\.)?\d+))?\s*\)/i);
  if (!match) return { x: 0, y: 0 };
  return {
    x: Number.parseFloat(match[1] ?? "0") || 0,
    y: Number.parseFloat(match[2] ?? "0") || 0
  };
}

function boxFromPoints(points: Point[]): Bounds | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pointsValue(value: string | undefined, offset: Point): Point[] {
  const values = (value?.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index]! + offset.x, y: values[index + 1]! + offset.y });
  }
  return points;
}

function lineSegments(points: Point[], close = false): Array<readonly [Point, Point]> {
  const segments: Array<readonly [Point, Point]> = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1]!, points[index]!]);
  }
  if (close && points.length > 2) segments.push([points[points.length - 1]!, points[0]!]);
  return segments;
}

function pointAtCubic(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y +
      t ** 3 * end.y
  };
}

function pointAtQuadratic(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 2 * start.x + 2 * inverse * t * control.x + t ** 2 * end.x,
    y: inverse ** 2 * start.y + 2 * inverse * t * control.y + t ** 2 * end.y
  };
}

function pathPointsAndSegments(value: string | undefined, offset: Point) {
  const tokens = value?.match(PATH_TOKEN_RE) ?? [];
  const points: Point[] = [];
  const segments: Array<readonly [Point, Point]> = [];
  let command = "";
  let index = 0;
  let current: Point = { x: offset.x, y: offset.y };
  let subpathStart: Point = current;

  const isCommand = (token: string | undefined) => Boolean(token && /^[A-Za-z]$/.test(token));
  const read = () => Number.parseFloat(tokens[index++] ?? "0") || 0;
  const absolutePoint = (x: number, y: number, relative: boolean): Point => ({
    x: (relative ? current.x : offset.x) + x,
    y: (relative ? current.y : offset.y) + y
  });
  const addLine = (next: Point) => {
    segments.push([current, next]);
    points.push(current, next);
    current = next;
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++]!;
    if (!command) break;
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === "Z") {
      addLine(subpathStart);
      command = "";
      continue;
    }
    if (upper === "M" || upper === "L" || upper === "T") {
      if (index + 1 >= tokens.length || isCommand(tokens[index])) continue;
      const next = absolutePoint(read(), read(), relative);
      if (upper === "M") {
        current = next;
        subpathStart = next;
        points.push(next);
        command = relative ? "l" : "L";
      } else {
        addLine(next);
      }
      continue;
    }
    if (upper === "H") {
      if (isCommand(tokens[index])) continue;
      const valueX = read();
      addLine({ x: relative ? current.x + valueX : offset.x + valueX, y: current.y });
      continue;
    }
    if (upper === "V") {
      if (isCommand(tokens[index])) continue;
      const valueY = read();
      addLine({ x: current.x, y: relative ? current.y + valueY : offset.y + valueY });
      continue;
    }
    if (upper === "C" && index + 5 < tokens.length) {
      const start = current;
      const control1 = absolutePoint(read(), read(), relative);
      const control2 = absolutePoint(read(), read(), relative);
      const end = absolutePoint(read(), read(), relative);
      let previous = start;
      points.push(start, control1, control2, end);
      for (let step = 1; step <= 10; step += 1) {
        const sampled = pointAtCubic(start, control1, control2, end, step / 10);
        segments.push([previous, sampled]);
        previous = sampled;
      }
      current = end;
      continue;
    }
    if ((upper === "S" || upper === "Q") && index + 3 < tokens.length) {
      const start = current;
      const control = absolutePoint(read(), read(), relative);
      const end = absolutePoint(read(), read(), relative);
      let previous = start;
      points.push(start, control, end);
      for (let step = 1; step <= 10; step += 1) {
        const sampled = pointAtQuadratic(start, control, end, step / 10);
        segments.push([previous, sampled]);
        previous = sampled;
      }
      current = end;
      continue;
    }
    if (upper === "A" && index + 6 < tokens.length) {
      const rx = Math.abs(read());
      const ry = Math.abs(read());
      read();
      read();
      read();
      const end = absolutePoint(read(), read(), relative);
      points.push(
        current,
        end,
        { x: current.x - rx, y: current.y - ry },
        { x: current.x + rx, y: current.y + ry },
        { x: end.x - rx, y: end.y - ry },
        { x: end.x + rx, y: end.y + ry }
      );
      segments.push([current, end]);
      current = end;
      continue;
    }

    // Unsupported or malformed command: consume one token to guarantee progress.
    index += 1;
  }

  return { points, segments };
}

function primitiveGeometry(tag: string, attrs: Map<string, string>, offset: Point) {
  const ownTranslate = translateValue(attrs.get("transform"));
  const translated = { x: offset.x + ownTranslate.x, y: offset.y + ownTranslate.y };

  if (tag === "rect") {
    return {
      bounds: {
        x: numberValue(attrs, "x") + translated.x,
        y: numberValue(attrs, "y") + translated.y,
        w: numberValue(attrs, "width"),
        h: numberValue(attrs, "height")
      },
      segments: []
    };
  }
  if (tag === "circle") {
    const radius = numberValue(attrs, "r");
    const centerX = numberValue(attrs, "cx") + translated.x;
    const centerY = numberValue(attrs, "cy") + translated.y;
    return {
      bounds: { x: centerX - radius, y: centerY - radius, w: radius * 2, h: radius * 2 },
      segments: []
    };
  }
  if (tag === "ellipse") {
    const radiusX = numberValue(attrs, "rx");
    const radiusY = numberValue(attrs, "ry");
    const centerX = numberValue(attrs, "cx") + translated.x;
    const centerY = numberValue(attrs, "cy") + translated.y;
    return {
      bounds: { x: centerX - radiusX, y: centerY - radiusY, w: radiusX * 2, h: radiusY * 2 },
      segments: []
    };
  }
  if (tag === "line") {
    const points = [
      { x: numberValue(attrs, "x1") + translated.x, y: numberValue(attrs, "y1") + translated.y },
      { x: numberValue(attrs, "x2") + translated.x, y: numberValue(attrs, "y2") + translated.y }
    ];
    return { bounds: boxFromPoints(points), segments: lineSegments(points) };
  }
  if (tag === "polygon" || tag === "polyline") {
    const points = pointsValue(attrs.get("points"), translated);
    return { bounds: boxFromPoints(points), segments: lineSegments(points, tag === "polygon") };
  }
  if (tag === "path") {
    const geometry = pathPointsAndSegments(attrs.get("d"), translated);
    return { bounds: boxFromPoints(geometry.points), segments: geometry.segments };
  }
  if (tag === "text") {
    const width = numberValue(attrs, "data-w", -1);
    const height = numberValue(attrs, "data-h", -1);
    if (width <= 0 || height <= 0) return { bounds: null, segments: [] };
    const x = numberValue(attrs, "x") + translated.x;
    const y = numberValue(attrs, "y") + translated.y;
    const fontSize = numberValue(attrs, "font-size", 18);
    const anchor = attrs.get("text-anchor") ?? "start";
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    return {
      bounds: { x: left, y: y - fontSize * 1.1, w: width, h: height },
      segments: []
    };
  }
  return { bounds: null, segments: [] };
}

function groupLayer(recipe: DesignRecipe, id: string) {
  if (id === "background-layer") return 0;
  return recipe.zones.find((zone) => zone.id === id)?.layer ?? Number.NaN;
}

function parseSpatialElements(svg: string, recipe: DesignRecipe) {
  const knownGroups = new Set(["background-layer", ...recipe.zones.map((zone) => zone.id)]);
  const groups = new Map<string, SpatialGroup>();
  const contexts: GroupContext[] = [{ x: 0, y: 0, semanticGroupId: null }];
  let order = 0;

  for (const match of svg.matchAll(TAG_RE)) {
    const closing = match[1] === "/";
    const tag = (match[2] ?? "").toLowerCase();
    const rawAttrs = match[3] ?? "";
    const selfClosing = /\/\s*$/.test(rawAttrs);

    if (tag === "g") {
      if (closing) {
        if (contexts.length > 1) contexts.pop();
        continue;
      }
      const parent = contexts[contexts.length - 1]!;
      const attrs = attributes(rawAttrs);
      const ownTranslate = translateValue(attrs.get("transform"));
      const ownId = attrs.get("id");
      const semanticGroupId = ownId && knownGroups.has(ownId) ? ownId : parent.semanticGroupId;
      contexts.push({
        x: parent.x + ownTranslate.x,
        y: parent.y + ownTranslate.y,
        semanticGroupId
      });
      if (semanticGroupId && !groups.has(semanticGroupId)) {
        groups.set(semanticGroupId, {
          id: semanticGroupId,
          order: order++,
          layer: groupLayer(recipe, semanticGroupId),
          elements: []
        });
      }
      if (selfClosing) contexts.pop();
      continue;
    }
    if (closing || !["rect", "circle", "ellipse", "line", "polygon", "polyline", "path", "text"].includes(tag)) {
      continue;
    }

    const context = contexts[contexts.length - 1]!;
    const groupId = context.semanticGroupId;
    if (!groupId) continue;
    const attrs = attributes(rawAttrs);
    const geometry = primitiveGeometry(tag, attrs, context);
    if (!geometry.bounds) continue;
    const group = groups.get(groupId);
    if (!group) continue;
    group.elements.push({
      tag,
      groupId,
      kind: groupId === "connector-layer" ? "connector" : tag === "text" ? "text" : "solid",
      bounds: geometry.bounds,
      segments: geometry.segments
    });
  }

  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function right(box: Bounds) {
  return box.x + box.w;
}

function bottom(box: Bounds) {
  return box.y + box.h;
}

function intersection(left: Bounds, rightBox: Bounds): Bounds | null {
  const x = Math.max(left.x, rightBox.x);
  const y = Math.max(left.y, rightBox.y);
  const maxX = Math.min(right(left), right(rightBox));
  const maxY = Math.min(bottom(left), bottom(rightBox));
  if (maxX <= x || maxY <= y) return null;
  return { x, y, w: maxX - x, h: maxY - y };
}

function containsBounds(container: Bounds, content: Bounds, tolerance = 0) {
  return (
    content.x >= container.x - tolerance &&
    content.y >= container.y - tolerance &&
    right(content) <= right(container) + tolerance &&
    bottom(content) <= bottom(container) + tolerance
  );
}

function pointInside(point: Point, box: Bounds) {
  return point.x >= box.x && point.x <= right(box) && point.y >= box.y && point.y <= bottom(box);
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 <= 0 && o3 * o4 <= 0;
}

function segmentIntersectsBox(segment: readonly [Point, Point], box: Bounds) {
  const [start, end] = segment;
  if (pointInside(start, box) || pointInside(end, box)) return true;
  const topLeft = { x: box.x, y: box.y };
  const topRight = { x: right(box), y: box.y };
  const bottomLeft = { x: box.x, y: bottom(box) };
  const bottomRight = { x: right(box), y: bottom(box) };
  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function allowedOverlap(recipe: DesignRecipe, leftId: string, rightId: string) {
  return recipe.allowedOverlaps.some(
    ([left, right]) =>
      (left === leftId && right === rightId) || (left === rightId && right === leftId)
  );
}

function rangeText(box: Bounds) {
  return `x=${Math.round(box.x)}..${Math.round(right(box))}、y=${Math.round(box.y)}..${Math.round(bottom(box))}`;
}

function isCompactNodeBadgeText(text: SpatialElement, groups: SpatialGroup[]) {
  const group = groups.find((candidate) => candidate.id === text.groupId);
  return Boolean(
    group?.elements.some(
      (element) =>
        element.kind === "solid" &&
        ["circle", "ellipse"].includes(element.tag) &&
        element.bounds.w <= 96 &&
        element.bounds.h <= 96 &&
        containsBounds(element.bounds, text.bounds, 2)
    )
  );
}

function validateSafeBounds(groups: SpatialGroup[], issues: Set<string>) {
  for (const group of groups) {
    if (group.id === "background-layer") continue;
    for (const element of group.elements) {
      const box = element.bounds;
      if (
        box.x < SAFE_BOUNDS.x ||
        box.y < SAFE_BOUNDS.y ||
        right(box) > right(SAFE_BOUNDS) ||
        bottom(box) > bottom(SAFE_BOUNDS)
      ) {
        issues.add(`${group.id} 的 ${element.tag} 超出画布安全区（${rangeText(box)}）`);
        break;
      }
    }
  }
}

function validateLayerOrder(groups: SpatialGroup[], issues: Set<string>) {
  let previous: SpatialGroup | null = null;
  let highestLayer = Number.NEGATIVE_INFINITY;
  for (const group of groups) {
    if (!Number.isFinite(group.layer)) continue;
    if (group.layer < highestLayer && previous) {
      issues.add(
        `${group.id} 的 DOM 顺序违背 layer：layer=${group.layer} 出现在 ${previous.id}（layer=${previous.layer}）之后`
      );
      return;
    }
    if (group.layer > highestLayer) {
      highestLayer = group.layer;
      previous = group;
    }
  }
}

function validateCrossGroupOverlap(groups: SpatialGroup[], recipe: DesignRecipe, issues: Set<string>) {
  const businessGroups = groups.filter((group) => !["background-layer", "connector-layer"].includes(group.id));
  for (let leftIndex = 0; leftIndex < businessGroups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < businessGroups.length; rightIndex += 1) {
      const leftGroup = businessGroups[leftIndex]!;
      const rightGroup = businessGroups[rightIndex]!;
      if (allowedOverlap(recipe, leftGroup.id, rightGroup.id)) continue;

      for (const leftElement of leftGroup.elements) {
        for (const rightElement of rightGroup.elements) {
          const overlap = intersection(leftElement.bounds, rightElement.bounds);
          if (!overlap) continue;
          if (leftElement.kind === "text" && rightElement.kind === "text") {
            if (overlap.w > 2 && overlap.h > 2) {
              issues.add(
                `${leftGroup.id} 与 ${rightGroup.id} 的文字框相互覆盖（${rangeText(overlap)}）`
              );
              break;
            }
          } else if (overlap.w > OVERLAP_TOLERANCE && overlap.h > OVERLAP_TOLERANCE) {
            issues.add(
              `${leftGroup.id} 与 ${rightGroup.id} 在 ${rangeText(overlap)} 相交，请移动或缩小元素并保留 ${recipe.minGutter}px 间距`
            );
            break;
          }
        }
        if ([...issues].some((issue) => issue.includes(leftGroup.id) && issue.includes(rightGroup.id))) break;
      }
    }
  }
}

function validateConnectorTextCrossing(groups: SpatialGroup[], issues: Set<string>) {
  const connector = groups.find((group) => group.id === "connector-layer");
  if (!connector) return;
  const texts = groups
    .filter((group) => !["background-layer", "connector-layer", "visual-anchor"].includes(group.id))
    .flatMap((group) => group.elements.filter((element) => element.kind === "text"))
    .filter((text) => !isCompactNodeBadgeText(text, groups));

  for (const connectorElement of connector.elements) {
    for (const text of texts) {
      if (connectorElement.segments.some((segment) => segmentIntersectsBox(segment, text.bounds))) {
        issues.add(
          `connector-layer 的 ${connectorElement.tag} 穿过 ${text.groupId} 文字框（${rangeText(text.bounds)}），请绕行文字框`
        );
        break;
      }
    }
  }
}

function validateAttachedAccentRails(groups: SpatialGroup[], issues: Set<string>) {
  for (const group of groups) {
    if (!group.id.startsWith("content-zone-")) continue;
    const solids = group.elements.filter((element) => element.kind === "solid");
    const hosts = solids.filter((element) => element.bounds.w >= 160 && element.bounds.h >= 100);
    const rails = solids.filter(
      (element) => element.bounds.w >= 4 && element.bounds.w <= 20 && element.bounds.h >= 70
    );
    for (const host of hosts) {
      const rail = rails.find((candidate) => {
        if (candidate === host) return false;
        const heightRatio = candidate.bounds.h / host.bounds.h;
        const attachedLeft = Math.abs(candidate.bounds.x - host.bounds.x) <= 6;
        const attachedRight = Math.abs(right(candidate.bounds) - right(host.bounds)) <= 6;
        return (
          heightRatio >= 0.7 &&
          candidate.bounds.y >= host.bounds.y - 6 &&
          bottom(candidate.bounds) <= bottom(host.bounds) + 6 &&
          (attachedLeft || attachedRight)
        );
      });
      if (rail) {
        issues.add(
          `${group.id} 检测到附着式整高强调色条（${Math.round(rail.bounds.w)}×${Math.round(rail.bounds.h)}），请改为顶部短细线或标题关键词着色`
        );
        break;
      }
    }
  }
}

export function validateSvgSpatialQuality(svg: string, recipe: DesignRecipe): SvgSpatialQualityResult {
  const groups = parseSpatialElements(svg, recipe);
  const issues = new Set<string>();
  validateSafeBounds(groups, issues);
  validateLayerOrder(groups, issues);
  validateCrossGroupOverlap(groups, recipe, issues);
  validateConnectorTextCrossing(groups, issues);
  validateAttachedAccentRails(groups, issues);
  const issueList = [...issues];
  return { ok: issueList.length === 0, issues: issueList };
}
