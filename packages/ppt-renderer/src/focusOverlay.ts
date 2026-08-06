import { Resvg } from "@resvg/resvg-js";

/**
 * 聚焦框在逻辑画布（1920×1080）中的归一化坐标。
 * x/y/w/h 均为 0–1 比例值。
 */
export interface FocusBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FocusOverlayOptions {
  width?: number;
  height?: number;
  /** 遮罩半透明黑色不透明度（默认 0.55） */
  dimOpacity?: number;
  /** 聚焦框圆角半径（像素，默认 12） */
  borderRadius?: number;
  /** 聚焦框描边颜色（默认 #E18A3B — 暖橙色） */
  strokeColor?: string;
  /** 聚焦框描边宽度（像素，默认 3） */
  strokeWidth?: number;
}

/**
 * 生成聚焦遮罩 SVG：整个画面用半透明黑色遮盖，
 * 在聚焦框区域挖一个矩形窗口透出原始画面，
 * 并加描边高亮。
 *
 * 使用 fill-rule="evenodd" + 双矩形路径实现：
 * 外圈顺时针 = 填充区；内圈逆时针 = 挖洞。
 * 比 <mask> 更可靠，resvg-js 100% 支持。
 */
export function buildFocusOverlaySvg(box: FocusBox, options: FocusOverlayOptions = {}) {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const dimOpacity = options.dimOpacity ?? 0.55;
  const borderRadius = options.borderRadius ?? 12;
  const strokeColor = options.strokeColor ?? "#E18A3B";
  const strokeWidth = options.strokeWidth ?? 3;

  // 将归一化坐标映射到像素
  const px = Math.round(box.x * width);
  const py = Math.round(box.y * height);
  const pw = Math.round(box.w * width);
  const ph = Math.round(box.h * height);

  // fill-rule="evenodd" 路径：外圈顺时针全画面 + 内圈逆时针窗口 = 挖洞
  // 外圈：M0,0 → 右 → 下 → 左 → 闭合（顺时针）
  // 内圈：从右下角逆时针画矩形（逆时针 = 洞）
  const outer = `M0,0 H${width} V${height} H0 Z`;
  const ix = px;
  const iy = py;
  const ir = ix + pw;
  const ib = iy + ph;
  const inner = `M${ir},${ib} H${ix} V${iy} H${ir} Z`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <path d="${outer} ${inner}" fill="black" fill-opacity="${dimOpacity}" fill-rule="evenodd"/>
  <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${borderRadius}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
</svg>`;
}

/**
 * 渲染聚焦遮罩为透明 PNG Buffer；文件存储由调用方负责。
 */
export function renderFocusOverlayPng(box: FocusBox, options: FocusOverlayOptions = {}) {
  const width = options.width ?? 1920;
  const svg = buildFocusOverlaySvg(box, options);
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false }
  }).render().asPng();
}
