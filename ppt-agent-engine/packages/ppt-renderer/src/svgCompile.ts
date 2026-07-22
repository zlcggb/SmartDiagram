/**
 * SVG → PPTX 编译（P1）
 * - 轻量 XML DOM 解析（无额外依赖）
 * - text + 内联 tspan 多 run；`<g>` 表现属性继承
 * - linearGradient 近似实色、line/path/polygon/polyline 简单箭头
 * - 字体栈解析为 PPT 安全族；字号按 1280×720→英寸换算
 * - 失败返回 false，由调用方降级 IR
 */

import { getBannedSvgFeatures } from "@ppt-agent/shared";
import {
  encodeSvgShapeMetadata,
  parseEditableSvgPath,
  type EditableGradient,
  type SvgShapeMetadata
} from "./svgPathGeometry.js";

const W = 13.333;
const H = 7.5;
const fontFace = "Microsoft YaHei";
/** SVG 用户单位 → pt：720u = 7.5in = 540pt → 1u = 0.75pt（几何正确） */
const FONT_PX_TO_PT = 0.75;
/**
 * 导出保真：对含 CJK 的文本框额外加宽，抵消 pptxgen/OOXML 相对浏览器偏「肥」的中文度量导致的提前换行。
 * 不缩小字号（避免再出现「乱码感」小字）。
 */
const CJK_WRAP_PAD = 1.12;
/** 纯西文短标签也给一点余量，避免 ROADMAP 类徽章贴边裁切 */
const LATIN_WRAP_PAD = 1.04;

const deckTokens = {
  ink: "#14202B",
  line: "#D7E2EF",
  blue: "#0066CC",
  cyan: "#00A6D6",
  violet: "#6D5DF6",
  green: "#12B76A"
} as const;

/** 可从 `<g>` 继承到子元素的表现属性（与浏览器 SVG 对齐） */
const INHERITABLE_ATTRS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "color"
] as const;

const PPT_SAFE_FONTS = new Set([
  "Microsoft YaHei",
  "微软雅黑",
  "SimHei",
  "SimSun",
  "Arial",
  "Calibri",
  "Segoe UI",
  "Helvetica",
  "Times New Roman"
]);

const FONT_FALLBACK_TO_YAHEI = new Set([
  "PingFang SC",
  "PingFangSC",
  "Noto Sans CJK SC",
  "Noto Sans SC",
  "Source Han Sans SC",
  "Hiragino Sans GB",
  "WenQuanYi Micro Hei",
  "STHeiti",
  "Heiti SC",
  "sans-serif",
  "system-ui"
]);

type PptxSlide = {
  addShape: (shapeType: string, options: Record<string, unknown>) => void;
  addText: (
    text: string | Array<{ text: string; options?: Record<string, unknown> }>,
    options: Record<string, unknown>
  ) => void;
};

type PptxInstance = {
  ShapeType: Record<"rect" | "roundRect" | "line" | "ellipse", string>;
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Attrs = Record<string, string>;

interface XmlNode {
  tag: string;
  attrs: Attrs;
  children: Array<XmlNode | string>;
}

interface GradientDef extends EditableGradient {}

type ArrowKind = "none" | "arrow" | "diamond" | "oval" | "triangle";

interface MarkerDef {
  kind: ArrowKind;
}

interface CompileContext {
  pptx: PptxInstance;
  slide: PptxSlide;
  gradients: Map<string, GradientDef>;
  markers: Map<string, MarkerDef>;
  tx: number;
  ty: number;
  /** 从祖先 `<g>` 继承的表现属性 */
  inherited: Attrs;
  /** 命中 matrix/scale/rotate 等未支持 transform 的次数（用于失败降级） */
  unsupportedTransformHits: { count: number };
}

function c(hex: string) {
  return hex.replace("#", "");
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = {};
  const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(raw))) {
    const key = match[1];
    if (!key) continue;
    attrs[key.toLowerCase()] = decodeXmlText(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

/** 轻量 XML 栈式解析：适合可编译 SVG 子集（无命名空间嵌套怪癖） */
function parseXml(xml: string): XmlNode | null {
  const cleaned = xml
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const rootMatch = cleaned.match(/<([A-Za-z_][\w:.-]*)([^>]*)>/);
  if (!rootMatch) return null;

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  const tokenPattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)([^>]*)\/?>|([^<]+)/g;
  let token: RegExpExecArray | null;

  while ((token = tokenPattern.exec(cleaned))) {
    if (token[1] !== undefined) {
      const text = decodeXmlText(token[1]);
      const parent = stack[stack.length - 1];
      if (parent && text) parent.children.push(text);
      continue;
    }

    if (token[2]) {
      const closed = stack.pop();
      if (!closed || closed.tag !== token[2].toLowerCase().replace(/^.*:/, "")) {
        return null;
      }
      if (stack.length === 0) {
        root = closed;
      } else {
        stack[stack.length - 1]?.children.push(closed);
      }
      continue;
    }

    if (token[3]) {
      const rawName = token[3];
      const tag = rawName.toLowerCase().replace(/^.*:/, "");
      const attrs = parseAttrs(token[4] ?? "");
      const selfClosing = /\/\s*>$/.test(token[0] ?? "") || /\/\s*$/.test((token[4] ?? "").trim());
      const node: XmlNode = { tag, attrs, children: [] };
      if (selfClosing) {
        if (stack.length === 0) {
          root = node;
        } else {
          stack[stack.length - 1]?.children.push(node);
        }
      } else {
        stack.push(node);
      }
      continue;
    }

    if (token[5] !== undefined) {
      const text = decodeXmlText(token[5]);
      const parent = stack[stack.length - 1];
      if (!parent || !text) continue;
      if (text.trim().length > 0) {
        parent.children.push(text);
      } else if (parent.children.length > 0) {
        // 保留 tspan 之间的空格，避免 "62%"+"vs" 黏连
        parent.children.push(" ");
      }
    }
  }

  if (stack.length > 0) return null;
  return root;
}

function svgNumber(attrs: Attrs, key: string, fallback = 0) {
  const raw = attrs[key];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw.replace(/px$/i, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function svgLengthToInch(value: number, axis: "x" | "y") {
  return axis === "x" ? (value / 1280) * W : (value / 720) * H;
}

function svgBoxToInches(x: number, y: number, w: number, h: number): Box {
  return {
    x: svgLengthToInch(x, "x"),
    y: svgLengthToInch(y, "y"),
    w: svgLengthToInch(w, "x"),
    h: svgLengthToInch(h, "y")
  };
}

function normalizeHexColor(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value === "none" || value === "transparent") return undefined;
  if (/^#[\da-f]{3}$/i.test(value)) {
    return value
      .slice(1)
      .split("")
      .map((item) => item + item)
      .join("")
      .toUpperCase();
  }
  if (/^#[\da-f]{6}$/i.test(value)) return c(value);
  const rgb = value.match(/^rgb\((\d+)[,\s]+(\d+)[,\s]+(\d+)\)$/i);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  if (value.toLowerCase() === "white") return "FFFFFF";
  if (value.toLowerCase() === "black") return "000000";
  return undefined;
}

function resolveUrlId(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^url\(#([^)]+)\)$/i);
  return match?.[1]?.toLowerCase();
}

function pickGradientColor(grad: GradientDef | undefined, fallback?: string): string | undefined {
  if (!grad || grad.stops.length === 0) return fallback;
  const sorted = [...grad.stops].sort((a, b) => a.offset - b.offset);
  // pptxgenjs 仅 solid：取中点附近 stop，否则起止色中的主色（首个有效）
  const mid = sorted.find((s) => s.offset >= 0.4) ?? sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
  return mid?.color ?? sorted[0]?.color ?? fallback;
}

function svgColor(value: string | undefined, ctx: CompileContext | null, fallback?: string): string | undefined {
  const raw = value?.trim();
  if (!raw || raw === "none" || raw === "transparent") return fallback;
  const gradId = resolveUrlId(raw);
  if (gradId && ctx) {
    const fromDef = pickGradientColor(ctx.gradients.get(gradId));
    if (fromDef) return fromDef;
    if (gradId.includes("accent") || gradId.includes("cyan")) return c(deckTokens.cyan);
    if (gradId.includes("purple") || gradId.includes("violet")) return c(deckTokens.violet);
    if (gradId.includes("green")) return c(deckTokens.green);
    if (gradId.includes("blue")) return c(deckTokens.blue);
    return fallback;
  }
  return normalizeHexColor(raw) ?? fallback;
}

function svgShapeMetadata(attrs: Attrs, ctx: CompileContext, path?: string): SvgShapeMetadata | null {
  const gradId = resolveUrlId(attrs.fill);
  const gradient = gradId ? ctx.gradients.get(gradId) : undefined;
  if (!path && !gradient) return null;
  const shapeTransparency = combinedTransparency(
    svgOpacity(attrs, "fill-opacity"),
    svgOpacity(attrs)
  );
  const adjustedGradient = gradient
    ? {
        ...gradient,
        stops: gradient.stops.map((stop) => ({
          ...stop,
          transparency: combinedTransparency(stop.transparency ?? 0, shapeTransparency)
        }))
      }
    : undefined;
  return { ...(path ? { path } : {}), ...(adjustedGradient ? { gradient: adjustedGradient } : {}) };
}

function metadataName(attrs: Attrs, ctx: CompileContext, path?: string) {
  const metadata = svgShapeMetadata(attrs, ctx, path);
  return metadata ? encodeSvgShapeMetadata(metadata) : undefined;
}

function svgOpacity(attrs: Attrs, key = "opacity") {
  const raw = attrs[key];
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, 100 - parsed * 100));
}

/** SVG opacity 相乘；入参/返回均为 PPT transparency(0..100)。 */
function combinedTransparency(...values: number[]) {
  const alpha = values.reduce((product, transparency) => {
    const normalized = Math.max(0, Math.min(100, transparency));
    return product * (1 - normalized / 100);
  }, 1);
  return Math.max(0, Math.min(100, 100 - alpha * 100));
}

function pickInheritable(attrs: Attrs): Attrs {
  const picked: Attrs = {};
  for (const key of INHERITABLE_ATTRS) {
    if (attrs[key] !== undefined) picked[key] = attrs[key]!;
  }
  return picked;
}

/** 自身属性覆盖祖先继承（对齐浏览器 SVG 表现属性级联） */
function effectiveAttrs(ctx: CompileContext, attrs: Attrs): Attrs {
  return { ...ctx.inherited, ...attrs };
}

/** 将 CSS font-family 栈解析为 pptxgenjs/WPS 较稳妥的单一字体名 */
function resolvePptSafeFont(stack: string | undefined): string {
  if (!stack?.trim()) return fontFace;
  const parts = stack
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  for (const part of parts) {
    if (PPT_SAFE_FONTS.has(part)) {
      return part === "微软雅黑" ? fontFace : part;
    }
    if (FONT_FALLBACK_TO_YAHEI.has(part)) {
      return fontFace;
    }
  }
  // 未知族名：优先栈内含 CJK/YaHei 字样的，否则默认雅黑（避免 Inter/Roboto 导致中文方块）
  const yaheiLike = parts.find((part) => /yahei|微软雅黑|simsun|simhei|cjk|hei|song|kai/i.test(part));
  if (yaheiLike && PPT_SAFE_FONTS.has(yaheiLike)) return yaheiLike;
  return fontFace;
}

function hasUnsupportedTransformFunctions(transform: string): boolean {
  return /(?:matrix|scale|rotate|skewX|skewY)\s*\(/i.test(transform);
}

function parseTranslate(
  transform: string | undefined,
  hits?: { count: number }
): { tx: number; ty: number } {
  if (!transform?.trim()) return { tx: 0, ty: 0 };
  const unsupported = hasUnsupportedTransformFunctions(transform);
  if (unsupported && hits) hits.count += 1;

  const match = transform.match(/translate\(\s*([-\d.]+)(?:[,\s]+([-\d.]+))?\s*\)/i);
  if (!match) {
    // 非 translate 且非已计的 unsupported（如未知写法）
    if (!unsupported && hits) hits.count += 1;
    return { tx: 0, ty: 0 };
  }
  return {
    tx: Number.parseFloat(match[1] ?? "0") || 0,
    ty: Number.parseFloat(match[2] ?? "0") || 0
  };
}

function withElementTransform(ctx: CompileContext, attrs: Attrs): CompileContext {
  if (!attrs.transform) return ctx;
  const { tx, ty } = parseTranslate(attrs.transform, ctx.unsupportedTransformHits);
  if (tx === 0 && ty === 0) return ctx;
  return { ...ctx, tx: ctx.tx + tx, ty: ctx.ty + ty };
}

function childNodes(node: XmlNode): XmlNode[] {
  return node.children.filter((item): item is XmlNode => typeof item !== "string");
}

function collectDefs(node: XmlNode, gradients: Map<string, GradientDef>, markers: Map<string, MarkerDef>) {
  if (node.tag === "lineargradient") {
    const id = (node.attrs.id ?? "").toLowerCase();
    if (!id) return;
    const stops: GradientDef["stops"] = [];
    for (const child of childNodes(node)) {
      if (child.tag !== "stop") continue;
      const color =
        normalizeHexColor(child.attrs["stop-color"] ?? child.attrs.color ?? "") ??
        normalizeHexColor(child.attrs.style?.match(/stop-color\s*:\s*([^;]+)/i)?.[1] ?? "");
      if (!color) continue;
      const stopOpacityRaw =
        child.attrs["stop-opacity"] ?? child.attrs.style?.match(/stop-opacity\s*:\s*([^;]+)/i)?.[1];
      const stopOpacity = stopOpacityRaw === undefined ? 1 : Number.parseFloat(stopOpacityRaw);
      const offsetRaw = child.attrs.offset ?? "0";
      const offset = offsetRaw.endsWith("%")
        ? Number.parseFloat(offsetRaw) / 100
        : Number.parseFloat(offsetRaw);
      stops.push({
        offset: Number.isFinite(offset) ? offset : 0,
        color,
        transparency: Number.isFinite(stopOpacity) ? Math.max(0, Math.min(100, 100 - stopOpacity * 100)) : 0
      });
    }
    const gradientCoord = (raw: string | undefined, fallback: number) => {
      if (!raw) return fallback;
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) return fallback;
      return raw.trim().endsWith("%") ? value / 100 : value;
    };
    const x1 = gradientCoord(node.attrs.x1, 0);
    const y1 = gradientCoord(node.attrs.y1, 0);
    const x2 = gradientCoord(node.attrs.x2, 1);
    const y2 = gradientCoord(node.attrs.y2, 0);
    const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI) * 60000;
    if (stops.length > 0) gradients.set(id, { stops, angle });
    return;
  }

  if (node.tag === "marker") {
    const id = (node.attrs.id ?? "").toLowerCase();
    if (!id) return;
    let kind: ArrowKind = "triangle";
    for (const child of childNodes(node)) {
      if (child.tag === "circle" || child.tag === "ellipse") {
        kind = "oval";
        break;
      }
      if (child.tag === "polygon" || child.tag === "path") {
        const points = child.attrs.points ?? child.attrs.d ?? "";
        const nums = [...points.matchAll(/-?\d+(?:\.\d+)?/g)];
        kind = nums.length >= 8 ? "diamond" : "triangle";
        break;
      }
    }
    markers.set(id, { kind });
    return;
  }

  for (const child of childNodes(node)) {
    collectDefs(child, gradients, markers);
  }
}

function resolveArrow(attrs: Attrs, key: "marker-start" | "marker-end", ctx: CompileContext): ArrowKind {
  const id = resolveUrlId(attrs[key]);
  if (id && ctx.markers.has(id)) {
    return ctx.markers.get(id)?.kind ?? "triangle";
  }
  // stroke 启发：显式 marker 引用但 defs 缺失时仍给三角箭头，避免静默无头
  if (id) return "triangle";
  return "none";
}

/** 画布对角线长度（SVG 用户单位），用于伪线条检测 */
const CANVAS_DIAG = Math.hypot(1280, 720);

/**
 * 仅抽取「可安全编译」的折线点：
 * - 支持 M/L/H/V/Z（含相对 m/l/h/v）
 * - 含 C/Q/A/S/T 等曲线命令时整段跳过（避免控制点被当成折线顶点 → WPS 从角上拉出杂线）
 * - 点数过多视为装饰 path，跳过
 */
function extractSafePolylinePoints(d: string): Array<{ x: number; y: number }> | null {
  const tokens = d.match(/[MmLlHhVvZz]|[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;

  const points: Array<{ x: number; y: number }> = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = "";

  const readNum = (): number | null => {
    const raw = tokens[i];
    if (raw === undefined || /[A-Za-z]/.test(raw)) return null;
    i += 1;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) break;
    if (/^[MmLlHhVvZz]$/.test(token)) {
      cmd = token;
      i += 1;
      if (cmd === "Z" || cmd === "z") {
        if (points.length > 0 && (cx !== startX || cy !== startY)) {
          points.push({ x: startX, y: startY });
        }
        cx = startX;
        cy = startY;
        continue;
      }
    } else if (!cmd) {
      return null;
    }

    if (cmd === "M" || cmd === "m") {
      const x = readNum();
      const y = readNum();
      if (x === null || y === null) return null;
      if (cmd === "m") {
        cx += x;
        cy += y;
      } else {
        cx = x;
        cy = y;
      }
      startX = cx;
      startY = cy;
      points.push({ x: cx, y: cy });
      // 隐式后续坐标按 L/l
      cmd = cmd === "M" ? "L" : "l";
      continue;
    }

    if (cmd === "L" || cmd === "l") {
      const x = readNum();
      const y = readNum();
      if (x === null || y === null) return null;
      if (cmd === "l") {
        cx += x;
        cy += y;
      } else {
        cx = x;
        cy = y;
      }
      points.push({ x: cx, y: cy });
      continue;
    }

    if (cmd === "H" || cmd === "h") {
      const x = readNum();
      if (x === null) return null;
      cx = cmd === "h" ? cx + x : x;
      points.push({ x: cx, y: cy });
      continue;
    }

    if (cmd === "V" || cmd === "v") {
      const y = readNum();
      if (y === null) return null;
      cy = cmd === "v" ? cy + y : y;
      points.push({ x: cx, y: cy });
      continue;
    }

    // 曲线 / 弧：不安全，整段跳过
    return null;
  }

  if (points.length < 2) return null;
  if (points.length > 24) return null;
  return points;
}

/** 是否像「从角上拉到元素」的垃圾线段（WPS 常见伪影） */
function isLikelyArtifactSegment(
  from: { x: number; y: number },
  to: { x: number; y: number }
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return true;
  if (len > CANVAS_DIAG * 0.92) return true;

  const nearOrigin = (p: { x: number; y: number }) => p.x <= 8 && p.y <= 8;
  if (nearOrigin(from) && len > 180) return true;
  if (nearOrigin(to) && len > 180) return true;

  // 贯穿大半画布的长斜线（非短装饰）
  if (len > 900 && Math.abs(dx) > 400 && Math.abs(dy) > 280) return true;
  return false;
}

function hasVisibleStroke(attrs: Attrs): boolean {
  const stroke = (attrs.stroke ?? "").trim().toLowerCase();
  if (!stroke || stroke === "none" || stroke === "transparent") return false;
  const opacity = attrs["stroke-opacity"];
  if (opacity !== undefined) {
    const n = Number.parseFloat(opacity);
    if (Number.isFinite(n) && n <= 0.05) return false;
  }
  return true;
}

function renderRect(ctx: CompileContext, rawAttrs: Attrs) {
  const local = withElementTransform(ctx, rawAttrs);
  const attrs = effectiveAttrs(local, rawAttrs);
  const x = svgNumber(attrs, "x") + local.tx;
  const y = svgNumber(attrs, "y") + local.ty;
  const w = svgNumber(attrs, "width");
  const h = svgNumber(attrs, "height");
  if (w <= 0 || h <= 0) return false;

  const fill = svgColor(attrs.fill, local, "FFFFFF");
  const stroke = svgColor(attrs.stroke, local);
  const rx = svgNumber(attrs, "rx", 0);
  const ry = svgNumber(attrs, "ry", rx);
  const roundedPath = rx > 0 || ry > 0 ? roundedRectPath(x, y, w, h, rx || ry, ry || rx) : undefined;
  local.slide.addShape(rx > 0 ? local.pptx.ShapeType.roundRect : local.pptx.ShapeType.rect, {
    ...svgBoxToInches(x, y, w, h),
    fill: attrs.fill === "none" ? { color: "FFFFFF", transparency: 100 } : { color: fill, transparency: svgOpacity(attrs, "fill-opacity") || svgOpacity(attrs) },
    line: stroke ? shapeLineOptions(attrs, local) : { transparency: 100 },
    radius: Math.min(0.22, Math.max(0, rx / 80)),
    objectName: metadataName(attrs, local, roundedPath)
  });
  return true;
}

/** 使用三次贝塞尔精确表达 SVG rx/ry，避免 PPT roundRect 固定圆角比例失真。 */
function roundedRectPath(x: number, y: number, w: number, h: number, rawRx: number, rawRy: number) {
  const rx = Math.min(Math.max(0, rawRx), w / 2);
  const ry = Math.min(Math.max(0, rawRy), h / 2);
  if (rx <= 0 || ry <= 0) return undefined;
  const k = 0.5522847498307936;
  return [
    `M ${x + rx} ${y}`,
    `L ${x + w - rx} ${y}`,
    `C ${x + w - rx + rx * k} ${y} ${x + w} ${y + ry - ry * k} ${x + w} ${y + ry}`,
    `L ${x + w} ${y + h - ry}`,
    `C ${x + w} ${y + h - ry + ry * k} ${x + w - rx + rx * k} ${y + h} ${x + w - rx} ${y + h}`,
    `L ${x + rx} ${y + h}`,
    `C ${x + rx - rx * k} ${y + h} ${x} ${y + h - ry + ry * k} ${x} ${y + h - ry}`,
    `L ${x} ${y + ry}`,
    `C ${x} ${y + ry - ry * k} ${x + rx - rx * k} ${y} ${x + rx} ${y}`,
    "Z"
  ].join(" ");
}

function renderCircle(ctx: CompileContext, rawAttrs: Attrs) {
  const local = withElementTransform(ctx, rawAttrs);
  const attrs = effectiveAttrs(local, rawAttrs);
  const cx = svgNumber(attrs, "cx") + local.tx;
  const cy = svgNumber(attrs, "cy") + local.ty;
  const r = svgNumber(attrs, "r");
  if (r <= 0) return false;

  const fill = svgColor(attrs.fill, local, deckTokens.blue);
  const stroke = svgColor(attrs.stroke, local);
  local.slide.addShape(local.pptx.ShapeType.ellipse, {
    ...svgBoxToInches(cx - r, cy - r, r * 2, r * 2),
    fill: attrs.fill === "none" ? { color: "FFFFFF", transparency: 100 } : { color: fill, transparency: svgOpacity(attrs, "fill-opacity") || svgOpacity(attrs) },
    line: stroke ? shapeLineOptions(attrs, local) : { transparency: 100 },
    objectName: metadataName(attrs, local)
  });
  return true;
}

function renderEllipse(ctx: CompileContext, rawAttrs: Attrs) {
  const local = withElementTransform(ctx, rawAttrs);
  const attrs = effectiveAttrs(local, rawAttrs);
  const cx = svgNumber(attrs, "cx") + local.tx;
  const cy = svgNumber(attrs, "cy") + local.ty;
  const rx = svgNumber(attrs, "rx");
  const ry = svgNumber(attrs, "ry");
  if (rx <= 0 || ry <= 0) return false;

  const fill = svgColor(attrs.fill, local, deckTokens.blue);
  const stroke = svgColor(attrs.stroke, local);
  local.slide.addShape(local.pptx.ShapeType.ellipse, {
    ...svgBoxToInches(cx - rx, cy - ry, rx * 2, ry * 2),
    fill: attrs.fill === "none" ? { color: "FFFFFF", transparency: 100 } : { color: fill, transparency: svgOpacity(attrs, "fill-opacity") || svgOpacity(attrs) },
    line: stroke ? shapeLineOptions(attrs, local) : { transparency: 100 },
    objectName: metadataName(attrs, local)
  });
  return true;
}

function lineOptions(attrs: Attrs, ctx: CompileContext) {
  const stroke = svgColor(attrs.stroke, ctx, deckTokens.line);
  const begin = resolveArrow(attrs, "marker-start", ctx);
  const end = resolveArrow(attrs, "marker-end", ctx);
  const dashType = svgDashType(attrs);
  return {
    color: stroke,
    transparency: combinedTransparency(svgOpacity(attrs, "stroke-opacity"), svgOpacity(attrs)),
    width: Math.max(0.2, svgNumber(attrs, "stroke-width", 1) * 0.45),
    ...(dashType ? { dashType } : {}),
    ...(begin !== "none" ? { beginArrowType: begin } : {}),
    ...(end !== "none" ? { endArrowType: end } : {})
  };
}

/** SVG dasharray → DrawingML 预设虚线；PPT 不支持任意 dash 数组，按线宽比例选择视觉最接近值。 */
function svgDashType(attrs: Attrs):
  | "solid"
  | "dash"
  | "dashDot"
  | "lgDash"
  | "lgDashDot"
  | "lgDashDotDot"
  | "sysDash"
  | "sysDot"
  | undefined {
  const raw = attrs["stroke-dasharray"]?.trim().toLowerCase();
  if (!raw || raw === "none") return undefined;
  const values = [...raw.matchAll(/[+-]?(?:\d*\.\d+|\d+)/g)]
    .map((match) => Number.parseFloat(match[0]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (values.length === 0 || values.every((value) => value === 0)) return undefined;

  const width = Math.max(0.1, svgNumber(attrs, "stroke-width", 1));
  if (values.length >= 4) {
    const longDash = Math.max(values[0] ?? 0, values[2] ?? 0) / width;
    return longDash >= 6 ? "lgDashDot" : "dashDot";
  }
  const dash = (values[0] ?? width) / width;
  const gap = (values[1] ?? values[0] ?? width) / width;
  if (dash <= 2.1 && gap <= 3) return "sysDot";
  if (dash >= 7) return "lgDash";
  if (dash >= 4.5) return "sysDash";
  return "dash";
}

function shapeLineOptions(attrs: Attrs, ctx: CompileContext) {
  const stroke = svgColor(attrs.stroke, ctx);
  return stroke ? lineOptions(attrs, ctx) : { transparency: 100 };
}

function renderLine(ctx: CompileContext, rawAttrs: Attrs) {
  const local = withElementTransform(ctx, rawAttrs);
  const attrs = effectiveAttrs(local, rawAttrs);
  if (!hasVisibleStroke(attrs) && !resolveUrlId(attrs["marker-start"]) && !resolveUrlId(attrs["marker-end"])) {
    return false;
  }
  const x1 = svgNumber(attrs, "x1") + local.tx;
  const y1 = svgNumber(attrs, "y1") + local.ty;
  const x2 = svgNumber(attrs, "x2") + local.tx;
  const y2 = svgNumber(attrs, "y2") + local.ty;
  if (isLikelyArtifactSegment({ x: x1, y: y1 }, { x: x2, y: y2 })) {
    return false;
  }
  const strokeWidth = Math.min(3.2, Math.max(0.2, svgNumber(attrs, "stroke-width", 1) * 0.45));
  const options = lineOptions(attrs, local);
  local.slide.addShape(local.pptx.ShapeType.line, {
    x: svgLengthToInch(x1, "x"),
    y: svgLengthToInch(y1, "y"),
    w: svgLengthToInch(x2 - x1, "x"),
    h: svgLengthToInch(y2 - y1, "y"),
    line: { ...options, width: strokeWidth }
  });
  return true;
}

function emitPolylineSegments(
  ctx: CompileContext,
  points: Array<{ x: number; y: number }>,
  attrs: Attrs,
  closed: boolean
): number {
  if (points.length < 2) return 0;
  const line = lineOptions(attrs, ctx);
  const strokeWidth = Math.min(3.2, Math.max(0.2, line.width));
  const segments = closed
    ? [...points.map((p, i) => [p, points[(i + 1) % points.length]!] as const)]
    : points.slice(0, -1).map((p, i) => [p, points[i + 1]!] as const);

  let rendered = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const pair = segments[index];
    if (!pair) continue;
    const [from, to] = pair;
    if (!from || !to) continue;
    if (isLikelyArtifactSegment(from, to)) continue;
    const isFirst = index === 0 && !closed;
    const isLast = index === segments.length - 1 && !closed;
    ctx.slide.addShape(ctx.pptx.ShapeType.line, {
      x: svgLengthToInch(from.x, "x"),
      y: svgLengthToInch(from.y, "y"),
      w: svgLengthToInch(to.x - from.x, "x"),
      h: svgLengthToInch(to.y - from.y, "y"),
      line: {
        color: line.color,
        transparency: line.transparency,
        width: strokeWidth,
        ...(isFirst && line.beginArrowType ? { beginArrowType: line.beginArrowType } : {}),
        ...(isLast && line.endArrowType ? { endArrowType: line.endArrowType } : {})
      }
    });
    rendered += 1;
  }
  return rendered;
}

function parsePointsAttr(raw: string | undefined): Array<{ x: number; y: number }> | null {
  if (!raw?.trim()) return null;
  const nums = [...raw.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number.parseFloat(m[0]!));
  if (nums.length < 4 || nums.length % 2 !== 0) return null;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  return points.length >= 2 ? points : null;
}

function renderPolyline(ctx: CompileContext, rawAttrs: Attrs, closed: boolean) {
  const local = withElementTransform(ctx, rawAttrs);
  const attrs = effectiveAttrs(local, rawAttrs);
  const rawPoints = parsePointsAttr(attrs.points);
  if (!rawPoints) return false;

  const d = rawPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .concat(closed ? ["Z"] : [])
    .join(" ");
  if (renderEditablePath(local, attrs, d)) return true;

  const points = rawPoints.map((p) => ({ x: p.x + local.tx, y: p.y + local.ty }));
  return emitPolylineSegments(local, points, attrs, closed) > 0;
}

/** path/polygon 统一写入一个 PPT 可编辑自由形状，保留填充、描边、虚线与端点箭头。 */
function renderEditablePath(local: CompileContext, attrs: Attrs, d: string) {
  const parsed = parseEditableSvgPath(d);
  if (!parsed) return false;
  const fill = svgColor(attrs.fill, local, "FFFFFF");
  const hasFill = Boolean(attrs.fill && attrs.fill !== "none" && attrs.fill !== "transparent");
  local.slide.addShape(local.pptx.ShapeType.rect, {
    ...svgBoxToInches(
      parsed.bbox.x + local.tx,
      parsed.bbox.y + local.ty,
      parsed.bbox.w,
      parsed.bbox.h
    ),
    fill: hasFill
      ? {
          color: fill,
          transparency: combinedTransparency(svgOpacity(attrs, "fill-opacity"), svgOpacity(attrs))
        }
      : { color: "FFFFFF", transparency: 100 },
    line: shapeLineOptions(attrs, local),
    objectName: metadataName(attrs, local, d)
  });
  return true;
}

function renderPath(ctx: CompileContext, rawAttrs: Attrs) {
  const local = withElementTransform(ctx, rawAttrs);
  const attrs = effectiveAttrs(local, rawAttrs);
  const d = attrs.d;
  if (!d) return false;

  // 可编辑优先：把 SVG 曲线原样写成 OOXML custGeom，不再用椭圆/矩形近似。
  if (renderEditablePath(local, attrs, d)) return true;

  // 非法/未知命令不冒充其它形状，避免生成看似完整但错误的图形。
  if (!hasVisibleStroke(attrs)) return false;

  // 复杂曲线描边：跳过（宁可缺装饰，不要垃圾线）
  if (/[CcQqAaSsTt]/.test(d)) {
    return false;
  }

  const rawPoints = extractSafePolylinePoints(d);
  if (!rawPoints) return false;

  const points = rawPoints.map((p) => ({ x: p.x + local.tx, y: p.y + local.ty }));
  const closed = /z/i.test(d);
  return emitPolylineSegments(local, points, attrs, closed) > 0;
}

interface TextRun {
  text: string;
  fill?: string;
  bold?: boolean;
  fontSize?: number;
  breakBefore?: boolean;
  /** tspan 显式定位；用于标题等逐行精确映射 */
  x?: number;
  y?: number;
  dy?: number;
}

function isXmlNode(value: XmlNode | string): value is XmlNode {
  return typeof value !== "string";
}

/** CJK / 全角字符占比（用于字宽与换行余量） */
function cjkRatioOf(text: string): number {
  if (!text) return 0;
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length === 0) return 0;
  let cjk = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk += 1;
    }
  }
  return cjk / chars.length;
}

/** 平均字宽（em）：西文约 0.55，CJK 约 1.0 —— pptxgen 默认偏西文，导出侧按混合比估算 */
function avgCharWidthEm(cjkRatio: number): number {
  return 0.55 * (1 - cjkRatio) + 1.0 * cjkRatio;
}

function collectTextRuns(children: Array<XmlNode | string>, inherited: Attrs, ctx: CompileContext): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      const text = child.replace(/\s+/g, " ");
      // SVG 源码的缩进/换行不是真实文字，否则会在第一个 tspan 前造成假空行。
      if (!text.trim()) continue;
      const weight = inherited["font-weight"] ?? "";
      runs.push({
        text,
        fill: svgColor(inherited.fill || inherited.color, ctx, deckTokens.ink),
        bold: /bold/i.test(weight) || Number.parseInt(weight, 10) >= 600,
        fontSize: svgNumber(inherited, "font-size", 0) || undefined
      });
      continue;
    }

    if (child.tag !== "tspan") {
      // 忽略未知子节点文本外壳
      runs.push(...collectTextRuns(child.children, inherited, ctx));
      continue;
    }

    const merged: Attrs = { ...inherited, ...child.attrs };
    const hasLineBreak = child.attrs.x !== undefined || child.attrs.y !== undefined || child.attrs.dy !== undefined;
    const nested = collectTextRuns(child.children, merged, ctx).map((run) => ({
      ...run,
      x: child.attrs.x !== undefined ? svgNumber(child.attrs, "x") : run.x,
      y: child.attrs.y !== undefined ? svgNumber(child.attrs, "y") : run.y,
      dy: child.attrs.dy !== undefined ? svgNumber(child.attrs, "dy") : run.dy
    }));
    if (nested.length === 0) continue;
    if (hasLineBreak && nested[0]) {
      nested[0] = { ...nested[0], breakBefore: true };
    }
    runs.push(...nested);
  }
  return runs;
}

/**
 * 外层 text 只定义文本区，具体坐标/字号写在 tspan 时，必须逐行生成文本框。
 * 若合并成一个 PPT 文本框，WPS 会重新计算行距和基线，导致封面标题重叠。
 */
function renderAbsolutelyPositionedRuns(
  local: CompileContext,
  attrs: Attrs,
  runs: TextRun[],
  rawDataW: number
) {
  if (runs.length === 0 || !runs.every((run) => run.x !== undefined && run.y !== undefined)) {
    return false;
  }

  const align = attrs["text-anchor"] === "middle" ? "center" : attrs["text-anchor"] === "end" ? "right" : "left";
  const baseFont = resolvePptSafeFont(attrs["font-family"]);
  const dataW = Math.max(24, Math.min(1280, rawDataW));

  for (const run of runs) {
    const fontPx = run.fontSize && run.fontSize > 0 ? run.fontSize : svgNumber(attrs, "font-size", 18);
    const x = (run.x ?? 0) + local.tx;
    const baselineY = (run.y ?? 0) + local.ty;
    const boxX = align === "center" ? x - dataW / 2 : align === "right" ? x - dataW : x;
    const boxTop = baselineY - fontPx * 0.9;
    const boxH = fontPx * 1.25;

    local.slide.addText(run.text, {
      ...svgBoxToInches(Math.max(0, boxX), Math.max(0, boxTop), dataW, boxH),
      fontFace: baseFont,
      fontSize: Math.max(8, Math.min(54, fontPx * FONT_PX_TO_PT)),
      bold: run.bold,
      color: run.fill ?? svgColor(attrs.fill || attrs.color, local, deckTokens.ink),
      align,
      valign: "mid",
      fit: "none",
      margin: 0,
      breakLine: false,
      lang: "zh-CN"
    });
  }
  return true;
}

function renderText(ctx: CompileContext, node: XmlNode) {
  const local = withElementTransform(ctx, node.attrs);
  const attrs = effectiveAttrs(local, node.attrs);
  const runs = collectTextRuns(node.children, attrs, local).filter((run) => run.text.length > 0);
  if (runs.length === 0) return false;
  // 第一个 tspan 是首行，它的 x/y 不应计为「前置换行」。
  if (runs[0]) runs[0] = { ...runs[0], breakBefore: false };

  const plain = runs.map((run) => run.text).join("");
  const compactText = plain.replace(/\s+/g, "");
  if (/^[•·.\-。．]+$/.test(compactText)) return false;

  const fontPxRaw = svgNumber(attrs, "font-size", runs[0]?.fontSize ?? 18);
  const x = (attrs.x !== undefined ? svgNumber(attrs, "x") : runs[0]?.x ?? 0) + local.tx;
  const y = (attrs.y !== undefined ? svgNumber(attrs, "y") : runs[0]?.y ?? 0) + local.ty;
  const cjkRatio = cjkRatioOf(compactText);
  const charEm = avgCharWidthEm(cjkRatio);
  const lineBreaks = runs.filter((r) => r.breakBefore).length;
  const hasExplicitBreaks = lineBreaks > 0;
  const rawDataW = svgNumber(attrs, "data-w", svgNumber(attrs, "width", 420));
  const rawDataHAttr = attrs["data-h"] ?? attrs.height;
  const rawDataHProvided = rawDataHAttr !== undefined && Number.parseFloat(rawDataHAttr) > 0;

  if (renderAbsolutelyPositionedRuns(local, attrs, runs, rawDataW)) {
    return true;
  }

  // 徽章/小框：字号不得撑破 data-h（预览靠 SVG 度量，PPT 无同样 leading）
  let fontPx = fontPxRaw;
  const provisionalH = rawDataHProvided ? svgNumber(attrs, "data-h", fontPxRaw * 1.4) : fontPxRaw * 1.4;
  const isTightBadge = !hasExplicitBreaks && compactText.length <= 28 && provisionalH > 0 && provisionalH <= fontPxRaw * 2.2;
  if (isTightBadge && fontPxRaw * 1.05 > provisionalH) {
    fontPx = Math.max(10, provisionalH / 1.28);
  }

  // 按画布比例换算；超长标题轻微收一点。CJK 正文保持 0.75，靠加宽文本框防提前换行
  const isLongTitle = compactText.length > 16 && fontPx >= 36 && y < 190;
  const fontScale = isLongTitle ? 0.72 : FONT_PX_TO_PT;
  const fontSize = Math.max(8, Math.min(44, fontPx * fontScale));

  const maxW = Math.max(24, 1280 - x - 24);
  const runLines: string[] = [""];
  for (const run of runs) {
    if (run.breakBefore) runLines.push("");
    runLines[runLines.length - 1] = (runLines[runLines.length - 1] ?? "") + run.text;
  }
  const longestLineChars = Math.max(
    ...runLines.map((line) => line.replace(/\s+/g, "").length),
    compactText.length,
    1
  );
  const wrapPad = cjkRatio >= 0.25 ? CJK_WRAP_PAD : LATIN_WRAP_PAD;
  // 短标签：按混合字宽抬下限；长文/多行只保底，宽度以 data-w×保真余量为准（勿把整段撑成单行宽）
  const shortLabel = !hasExplicitBreaks && compactText.length <= 12;
  const contentMinW = shortLabel
    ? Math.max(fontPx * 1.2, Math.min(longestLineChars, 16) * fontPx * charEm + fontPx * 0.3)
    : fontPx * 1.2;
  // 仅当纯西文短标签且 data-w 明显虚高时收窄；CJK / 多行绝不收窄（会提前换行）
  const latinTightW = Math.max(fontPx * 3.2, Math.min(longestLineChars, 24) * fontPx * 0.62 + 28);
  const shouldTightenWidth =
    cjkRatio < 0.15 &&
    !hasExplicitBreaks &&
    compactText.length <= 14 &&
    rawDataW > latinTightW * 2.2;
  const paddedW = (shouldTightenWidth ? latinTightW : rawDataW) * wrapPad;
  const dataW = Math.min(maxW, Math.max(contentMinW, paddedW));

  const estimatedCharsPerLine = Math.max(4, Math.floor(dataW / Math.max(9, fontPx * charEm)));
  const estimatedLineCount = Math.max(1 + lineBreaks, Math.ceil(compactText.length / estimatedCharsPerLine));
  const rawDataH = rawDataHProvided
    ? svgNumber(attrs, "data-h", estimatedLineCount * fontPx * 1.42)
    : estimatedLineCount * fontPx * 1.42;
  const contentMinH = Math.max(fontPx * 1.2, estimatedLineCount * fontPx * 1.18);
  // 信任作者 data-h（徽章垂直居中依赖框高）；未提供时才用估算并软封顶
  const softMaxH = Math.max(contentMinH, estimatedLineCount * fontPx * 2.8 + fontPx * 0.4, fontPx * 3.2);
  const finalH = rawDataHProvided
    ? Math.max(contentMinH, rawDataH)
    : Math.max(contentMinH, Math.min(rawDataH, softMaxH));

  const align = attrs["text-anchor"] === "middle" ? "center" : attrs["text-anchor"] === "end" ? "right" : "left";
  const weight = attrs["font-weight"] ?? "";
  const boxX = align === "center" ? x - dataW / 2 : align === "right" ? x - dataW : x;
  const baseFont = resolvePptSafeFont(attrs["font-family"]);
  const baseBold = /bold/i.test(weight) || Number.parseInt(weight, 10) >= 600;
  const baseColor = svgColor(attrs.fill || attrs.color, local, deckTokens.ink);

  const hasStyledRuns = runs.some(
    (run) =>
      (run.fill && run.fill !== baseColor) ||
      (run.bold !== undefined && run.bold !== baseBold) ||
      run.breakBefore ||
      (run.fontSize !== undefined && run.fontSize > 0 && run.fontSize !== fontPxRaw)
  );

  // 多行顶对齐更接近 SVG tspans；单行/徽章用 middle
  const valign = hasExplicitBreaks || estimatedLineCount >= 3 ? "top" : "middle";
  // 有 padding 的小框：基线约在框垂直中心附近；普通文本：基线 → 顶 ≈ 0.88em（CJK）
  const isPaddedSingle = !hasExplicitBreaks && finalH >= fontPx * 1.75;
  const boxTop = isPaddedSingle ? y - fontPx * 0.38 - finalH / 2 : y - fontPx * (cjkRatio >= 0.3 ? 0.88 : 0.8);
  // 标题区略加左边距感：仅当贴画布左缘且左对齐时微移，避免「贴边」观感
  const edgePadX = align === "left" && boxX < 36 && y < 160 ? 6 : 0;

  const box = svgBoxToInches(Math.max(0, boxX + edgePadX), Math.max(0, boxTop), dataW, finalH);
  const common = {
    ...box,
    fontFace: baseFont,
    fontSize,
    align,
    valign,
    // none：避免写出 normAutofit，WPS/PPT 打开时把过紧文本框压成不可读小字
    fit: "none",
    lang: "zh-CN",
    breakLine: false,
    // pptxgen margin 单位为英寸；徽章给约 2–3pt 内边距
    margin: isTightBadge ? ([0.03, 0.05, 0.03, 0.05] as [number, number, number, number]) : 0
  };

  if (!hasStyledRuns) {
    local.slide.addText(plain, {
      ...common,
      bold: baseBold,
      color: baseColor
    });
    return true;
  }

  const textProps = runs.map((run, index) => {
    const runFontPxRaw = run.fontSize && run.fontSize > 0 ? run.fontSize : fontPxRaw;
    const runFontPx =
      isTightBadge && runFontPxRaw * 1.05 > provisionalH
        ? Math.max(10, provisionalH / 1.28)
        : runFontPxRaw;
    const runFontSize = Math.max(8, Math.min(44, runFontPx * fontScale));
    return {
      text: run.text,
      options: {
        fontFace: baseFont,
        fontSize: runFontSize,
        bold: run.bold ?? baseBold,
        color: run.fill ?? baseColor,
        lang: "zh-CN",
        breakLine: Boolean(run.breakBefore && index > 0)
      }
    };
  });

  local.slide.addText(textProps, common);
  return true;
}

function walk(node: XmlNode, ctx: CompileContext): number {
  if (node.tag === "defs" || node.tag === "style" || node.tag === "title" || node.tag === "desc") {
    return 0;
  }

  let rendered = 0;
  if (node.tag === "g") {
    const { tx, ty } = parseTranslate(node.attrs.transform, ctx.unsupportedTransformHits);
    const nested: CompileContext = {
      ...ctx,
      tx: ctx.tx + tx,
      ty: ctx.ty + ty,
      inherited: { ...ctx.inherited, ...pickInheritable(node.attrs) }
    };
    for (const child of childNodes(node)) {
      rendered += walk(child, nested);
    }
    return rendered;
  }

  if (node.tag === "svg") {
    const nested: CompileContext = {
      ...ctx,
      inherited: { ...ctx.inherited, ...pickInheritable(node.attrs) }
    };
    for (const child of childNodes(node)) {
      rendered += walk(child, nested);
    }
    return rendered;
  }

  if (node.tag === "rect") rendered += renderRect(ctx, node.attrs) ? 1 : 0;
  else if (node.tag === "circle") rendered += renderCircle(ctx, node.attrs) ? 1 : 0;
  else if (node.tag === "ellipse") rendered += renderEllipse(ctx, node.attrs) ? 1 : 0;
  else if (node.tag === "line") rendered += renderLine(ctx, node.attrs) ? 1 : 0;
  else if (node.tag === "path") rendered += renderPath(ctx, node.attrs) ? 1 : 0;
  else if (node.tag === "polyline") rendered += renderPolyline(ctx, node.attrs, false) ? 1 : 0;
  else if (node.tag === "polygon") rendered += renderPolyline(ctx, node.attrs, true) ? 1 : 0;
  else if (node.tag === "text") rendered += renderText(ctx, node) ? 1 : 0;
  else {
    for (const child of childNodes(node)) {
      rendered += walk(child, ctx);
    }
  }
  return rendered;
}

export interface SvgCompileResult {
  ok: boolean;
  rendered: number;
  reason?: string;
}

/**
 * 纯编译逻辑（可测）：解析 SVG → walk 渲染，返回 rendered count。
 * 不强制产品 viewBox / 硬门禁；供对照回归与 tryRenderSvgSlide 复用。
 */
export function compileSvgPreviewToSlide(
  pptx: PptxInstance,
  slide: PptxSlide,
  svgPreview: string,
  options?: { minObjects?: number }
): SvgCompileResult {
  const minObjects = options?.minObjects ?? 4;
  const root = parseXml(svgPreview);
  if (!root) {
    return { ok: false, rendered: 0, reason: "parse_failed" };
  }

  const gradients = new Map<string, GradientDef>();
  const markers = new Map<string, MarkerDef>();
  collectDefs(root, gradients, markers);

  const unsupportedTransformHits = { count: 0 };
  const ctx: CompileContext = {
    pptx,
    slide,
    gradients,
    markers,
    tx: 0,
    ty: 0,
    inherited: {},
    unsupportedTransformHits
  };

  const rendered = walk(root, ctx);
  // matrix/scale/rotate 会导致坐标整体错位（预览正常、导出乱），宁降级 IR
  if (unsupportedTransformHits.count >= 2) {
    return { ok: false, rendered, reason: "unsupported_transform" };
  }
  if (rendered < minObjects) {
    return { ok: false, rendered, reason: "insufficient_objects" };
  }
  return { ok: true, rendered };
}

/** 预检 + 编译；失败返回 false，不抛错 */
export function tryRenderSvgSlide(pptx: PptxInstance, slide: PptxSlide, svgPreview?: string | null): boolean {
  if (!svgPreview || !/viewBox=["']0 0 1280 720["']/i.test(svgPreview)) {
    return false;
  }
  if (getBannedSvgFeatures(svgPreview).length > 0) {
    return false;
  }
  const roughTokenCount = (svgPreview.match(/<(?:text|rect|circle|ellipse|line|path)\b/gi) ?? []).length;
  if (roughTokenCount < 4) {
    return false;
  }

  try {
    return compileSvgPreviewToSlide(pptx, slide, svgPreview).ok;
  } catch {
    return false;
  }
}
