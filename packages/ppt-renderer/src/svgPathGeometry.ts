export type EditableGradient = {
  stops: Array<{ offset: number; color: string; transparency?: number }>;
  /** OOXML angle: degree * 60000 */
  angle: number;
};

export type SvgShapeMetadata = {
  path?: string;
  gradient?: EditableGradient;
};

export type SvgPathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

export interface ParsedSvgPath {
  commands: SvgPathCommand[];
  bbox: { x: number; y: number; w: number; h: number };
}

const META_PREFIX = "SVGCG_";

export function encodeSvgShapeMetadata(meta: SvgShapeMetadata) {
  return `${META_PREFIX}${Buffer.from(JSON.stringify(meta), "utf8").toString("base64url")}`;
}

export function decodeSvgShapeMetadata(name: string): SvgShapeMetadata | null {
  if (!name.startsWith(META_PREFIX)) return null;
  try {
    return JSON.parse(Buffer.from(name.slice(META_PREFIX.length), "base64url").toString("utf8")) as SvgShapeMetadata;
  } catch {
    return null;
  }
}

type CubicSegment = { x1: number; y1: number; x2: number; y2: number; x: number; y: number };

function vectorAngle(ux: number, uy: number, vx: number, vy: number) {
  const dot = ux * vx + uy * vy;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (lengths === 0) return 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / lengths)));
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

/** SVG endpoint arc → 最多 90°/段的三次贝塞尔（SVG 2 实现笔记算法）。 */
function arcToCubicSegments(
  startX: number,
  startY: number,
  rawRx: number,
  rawRy: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  endX: number,
  endY: number
): CubicSegment[] | null {
  let rx = Math.abs(rawRx);
  let ry = Math.abs(rawRy);
  if (rx === 0 || ry === 0 || (startX === endX && startY === endY)) return null;

  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const halfDx = (startX - endX) / 2;
  const halfDy = (startY - endY) / 2;
  const xPrime = cosPhi * halfDx + sinPhi * halfDy;
  const yPrime = -sinPhi * halfDx + cosPhi * halfDy;

  const radiiScale = xPrime ** 2 / rx ** 2 + yPrime ** 2 / ry ** 2;
  if (radiiScale > 1) {
    const scale = Math.sqrt(radiiScale);
    rx *= scale;
    ry *= scale;
  }

  const numerator = Math.max(
    0,
    rx ** 2 * ry ** 2 - rx ** 2 * yPrime ** 2 - ry ** 2 * xPrime ** 2
  );
  const denominator = rx ** 2 * yPrime ** 2 + ry ** 2 * xPrime ** 2;
  const sign = largeArc === sweep ? -1 : 1;
  const factor = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const centerPrimeX = factor * ((rx * yPrime) / ry);
  const centerPrimeY = factor * (-(ry * xPrime) / rx);
  const centerX =
    cosPhi * centerPrimeX - sinPhi * centerPrimeY + (startX + endX) / 2;
  const centerY =
    sinPhi * centerPrimeX + cosPhi * centerPrimeY + (startY + endY) / 2;

  const ux = (xPrime - centerPrimeX) / rx;
  const uy = (yPrime - centerPrimeY) / ry;
  const vx = (-xPrime - centerPrimeX) / rx;
  const vy = (-yPrime - centerPrimeY) / ry;
  const startAngle = vectorAngle(1, 0, ux, uy);
  let delta = vectorAngle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;

  const segmentCount = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const segmentAngle = delta / segmentCount;
  const mapPoint = (unitX: number, unitY: number) => ({
    x: centerX + cosPhi * rx * unitX - sinPhi * ry * unitY,
    y: centerY + sinPhi * rx * unitX + cosPhi * ry * unitY
  });
  const segments: CubicSegment[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const a0 = startAngle + index * segmentAngle;
    const a1 = a0 + segmentAngle;
    const alpha = (4 / 3) * Math.tan((a1 - a0) / 4);
    const p0x = Math.cos(a0);
    const p0y = Math.sin(a0);
    const p1x = Math.cos(a1);
    const p1y = Math.sin(a1);
    const control1 = mapPoint(p0x - alpha * p0y, p0y + alpha * p0x);
    const control2 = mapPoint(p1x + alpha * p1y, p1y - alpha * p1x);
    const end = mapPoint(p1x, p1y);
    segments.push({ x1: control1.x, y1: control1.y, x2: control2.x, y2: control2.y, x: end.x, y: end.y });
  }
  return segments;
}

/** SVG path 解析：M/L/H/V/C/S/Q/T/A/Z（绝对+相对），统一规范化为 PPT 可表达的曲线段。 */
export function parseEditableSvgPath(d: string): ParsedSvgPath | null {
  const tokens = d.match(/[A-Za-z]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
  if (!tokens?.length) return null;

  const commands: SvgPathCommand[] = [];
  const points: Array<{ x: number; y: number }> = [];
  let index = 0;
  let command = "";
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let lastCubicControl: { x: number; y: number } | null = null;
  let lastQuadraticControl: { x: number; y: number } | null = null;

  const isCommand = (value: string | undefined) => Boolean(value && /^[A-Za-z]$/.test(value));
  const read = () => {
    const token = tokens[index];
    if (token === undefined || isCommand(token)) return null;
    index += 1;
    const value = Number.parseFloat(token);
    return Number.isFinite(value) ? value : null;
  };
  const abs = (value: number, axis: "x" | "y", relative: boolean) =>
    relative ? value + (axis === "x" ? cx : cy) : value;

  while (index < tokens.length) {
    const token = tokens[index];
    if (isCommand(token)) {
      command = token ?? "";
      index += 1;
      if (command === "Z" || command === "z") {
        commands.push({ type: "Z" });
        cx = startX;
        cy = startY;
        lastCubicControl = null;
        lastQuadraticControl = null;
        command = "";
        continue;
      }
    }
    if (!command) return null;

    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === "M" || upper === "L") {
      const rawX = read();
      const rawY = read();
      if (rawX === null || rawY === null) return null;
      cx = abs(rawX, "x", relative);
      cy = abs(rawY, "y", relative);
      const type = upper === "M" ? "M" : "L";
      commands.push({ type, x: cx, y: cy });
      points.push({ x: cx, y: cy });
      lastCubicControl = null;
      lastQuadraticControl = null;
      if (upper === "M") {
        startX = cx;
        startY = cy;
        command = relative ? "l" : "L";
      }
      continue;
    }
    if (upper === "H") {
      const value = read();
      if (value === null) return null;
      cx = abs(value, "x", relative);
      commands.push({ type: "L", x: cx, y: cy });
      points.push({ x: cx, y: cy });
      lastCubicControl = null;
      lastQuadraticControl = null;
      continue;
    }
    if (upper === "V") {
      const value = read();
      if (value === null) return null;
      cy = abs(value, "y", relative);
      commands.push({ type: "L", x: cx, y: cy });
      points.push({ x: cx, y: cy });
      lastCubicControl = null;
      lastQuadraticControl = null;
      continue;
    }
    if (upper === "C") {
      const values = [read(), read(), read(), read(), read(), read()];
      if (values.some((value) => value === null)) return null;
      const baseX = cx;
      const baseY = cy;
      const x1 = (values[0] ?? 0) + (relative ? baseX : 0);
      const y1 = (values[1] ?? 0) + (relative ? baseY : 0);
      const x2 = (values[2] ?? 0) + (relative ? baseX : 0);
      const y2 = (values[3] ?? 0) + (relative ? baseY : 0);
      cx = (values[4] ?? 0) + (relative ? baseX : 0);
      cy = (values[5] ?? 0) + (relative ? baseY : 0);
      commands.push({ type: "C", x1, y1, x2, y2, x: cx, y: cy });
      points.push({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: cx, y: cy });
      lastCubicControl = { x: x2, y: y2 };
      lastQuadraticControl = null;
      continue;
    }
    if (upper === "S") {
      const values = [read(), read(), read(), read()];
      if (values.some((value) => value === null)) return null;
      const baseX = cx;
      const baseY = cy;
      const x1 = lastCubicControl ? baseX * 2 - lastCubicControl.x : baseX;
      const y1 = lastCubicControl ? baseY * 2 - lastCubicControl.y : baseY;
      const x2 = (values[0] ?? 0) + (relative ? baseX : 0);
      const y2 = (values[1] ?? 0) + (relative ? baseY : 0);
      cx = (values[2] ?? 0) + (relative ? baseX : 0);
      cy = (values[3] ?? 0) + (relative ? baseY : 0);
      commands.push({ type: "C", x1, y1, x2, y2, x: cx, y: cy });
      points.push({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: cx, y: cy });
      lastCubicControl = { x: x2, y: y2 };
      lastQuadraticControl = null;
      continue;
    }
    if (upper === "Q") {
      const values = [read(), read(), read(), read()];
      if (values.some((value) => value === null)) return null;
      const baseX = cx;
      const baseY = cy;
      const x1 = (values[0] ?? 0) + (relative ? baseX : 0);
      const y1 = (values[1] ?? 0) + (relative ? baseY : 0);
      cx = (values[2] ?? 0) + (relative ? baseX : 0);
      cy = (values[3] ?? 0) + (relative ? baseY : 0);
      commands.push({ type: "Q", x1, y1, x: cx, y: cy });
      points.push({ x: x1, y: y1 }, { x: cx, y: cy });
      lastQuadraticControl = { x: x1, y: y1 };
      lastCubicControl = null;
      continue;
    }
    if (upper === "T") {
      const values = [read(), read()];
      if (values.some((value) => value === null)) return null;
      const baseX = cx;
      const baseY = cy;
      const x1: number = lastQuadraticControl ? baseX * 2 - lastQuadraticControl.x : baseX;
      const y1: number = lastQuadraticControl ? baseY * 2 - lastQuadraticControl.y : baseY;
      cx = (values[0] ?? 0) + (relative ? baseX : 0);
      cy = (values[1] ?? 0) + (relative ? baseY : 0);
      commands.push({ type: "Q", x1, y1, x: cx, y: cy });
      points.push({ x: x1, y: y1 }, { x: cx, y: cy });
      lastQuadraticControl = { x: x1, y: y1 };
      lastCubicControl = null;
      continue;
    }
    if (upper === "A") {
      const values = [read(), read(), read(), read(), read(), read(), read()];
      if (values.some((value) => value === null)) return null;
      const baseX = cx;
      const baseY = cy;
      const endX = (values[5] ?? 0) + (relative ? baseX : 0);
      const endY = (values[6] ?? 0) + (relative ? baseY : 0);
      const segments = arcToCubicSegments(
        baseX,
        baseY,
        values[0] ?? 0,
        values[1] ?? 0,
        values[2] ?? 0,
        Boolean(values[3]),
        Boolean(values[4]),
        endX,
        endY
      );
      if (!segments) {
        commands.push({ type: "L", x: endX, y: endY });
        points.push({ x: endX, y: endY });
      } else {
        for (const segment of segments) {
          commands.push({ type: "C", ...segment });
          points.push(
            { x: segment.x1, y: segment.y1 },
            { x: segment.x2, y: segment.y2 },
            { x: segment.x, y: segment.y }
          );
        }
      }
      cx = endX;
      cy = endY;
      lastQuadraticControl = null;
      lastCubicControl = segments?.length
        ? { x: segments[segments.length - 1]!.x2, y: segments[segments.length - 1]!.y2 }
        : null;
      continue;
    }
    return null;
  }

  if (commands.length < 2 || points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  if (w <= 0 || h <= 0) return null;
  return { commands, bbox: { x, y, w, h } };
}

function pt(value: number, origin: number, span: number, targetSpan: number) {
  return Math.round(((value - origin) / span) * targetSpan);
}

export function buildOoxmlCustomGeometry(d: string, targetWidth = 100000, targetHeight = 100000) {
  const parsed = parseEditableSvgPath(d);
  if (!parsed) return null;
  const { x, y, w, h } = parsed.bbox;
  const pathWidth = Math.max(1, Math.round(targetWidth));
  const pathHeight = Math.max(1, Math.round(targetHeight));
  const parts: string[] = [];
  for (const command of parsed.commands) {
    if (command.type === "M") {
      parts.push(`<a:moveTo><a:pt x="${pt(command.x, x, w, pathWidth)}" y="${pt(command.y, y, h, pathHeight)}"/></a:moveTo>`);
    } else if (command.type === "L") {
      parts.push(`<a:lnTo><a:pt x="${pt(command.x, x, w, pathWidth)}" y="${pt(command.y, y, h, pathHeight)}"/></a:lnTo>`);
    } else if (command.type === "C") {
      parts.push(
        `<a:cubicBezTo><a:pt x="${pt(command.x1, x, w, pathWidth)}" y="${pt(command.y1, y, h, pathHeight)}"/><a:pt x="${pt(command.x2, x, w, pathWidth)}" y="${pt(command.y2, y, h, pathHeight)}"/><a:pt x="${pt(command.x, x, w, pathWidth)}" y="${pt(command.y, y, h, pathHeight)}"/></a:cubicBezTo>`
      );
    } else if (command.type === "Q") {
      parts.push(
        `<a:quadBezTo><a:pt x="${pt(command.x1, x, w, pathWidth)}" y="${pt(command.y1, y, h, pathHeight)}"/><a:pt x="${pt(command.x, x, w, pathWidth)}" y="${pt(command.y, y, h, pathHeight)}"/></a:quadBezTo>`
      );
    } else {
      parts.push("<a:close/>");
    }
  }
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${pathWidth}" b="${pathHeight}"/><a:pathLst><a:path w="${pathWidth}" h="${pathHeight}" fill="norm" stroke="1" extrusionOk="0">${parts.join("")}</a:path></a:pathLst></a:custGeom>`;
}
