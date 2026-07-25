import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

export interface SubtitleOverlayOptions {
  width?: number;
  fontPath: string;
  fontFamily: string;
  fontSize?: number;
  style?: SubtitleStyle;
  /** 字幕条带高度占画面宽度比例，须与合成端底部边距一致（默认 0.065）。 */
  bandHeightRatio?: number;
  /** 基础字号占画面宽度比例（默认 0.0177）：越小字越小。 */
  fontScaleRatio?: number;
}

export type SubtitleStyle = "minimal-outline" | "soft-capsule" | "brand-accent";

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

export function wrapSubtitleOverlayLines(text: string) {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean ? [clean] : [];
}

function visualUnits(value: string) {
  return [...value].reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.35;
    if (/[\x00-\xff]/u.test(character)) return total + 0.58;
    if (/[，。！？、：“”‘’（）《》]/u.test(character)) return total + 0.72;
    return total + 1;
  }, 0);
}

export function buildSubtitleOverlaySvg(text: string, options: SubtitleOverlayOptions) {
  const width = options.width ?? 1920;
  const height = Math.round(width * (options.bandHeightRatio ?? 0.065));
  const baseFontSize = options.fontSize ?? Math.round(width * (options.fontScaleRatio ?? 0.0177));
  const style = options.style ?? "minimal-outline";
  const lines = wrapSubtitleOverlayLines(text);
  const longestLineUnits = Math.max(...lines.map(visualUnits), 1);
  const fontSize = Math.min(baseFontSize, Math.floor((width * 0.78) / longestLineUnits));
  const lineHeight = Math.round(fontSize * 1.28);
  const panelHeight = lines.length * lineHeight + Math.round(fontSize * 0.72);
  const maxLineWidth = Math.max(...lines.map((line) => visualUnits(line) * fontSize), fontSize * 4);
  const panelWidth = Math.round(Math.min(width * 0.82, Math.max(width * 0.14, maxLineWidth + fontSize * 1.9)));
  const panelX = Math.round((width - panelWidth) / 2);
  const panelY = Math.round((height - panelHeight) / 2);
  const firstBaseline = panelY + Math.round((panelHeight - (lines.length - 1) * lineHeight) / 2 + fontSize * 0.34);
  const panel = style === "minimal-outline"
    ? ""
    : `<rect data-role="caption-panel" x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="${Math.round(fontSize * 0.48)}" fill="#101114" fill-opacity="${style === "soft-capsule" ? "0.58" : "0.78"}"/>`;
  const accent = style === "brand-accent"
    ? `<rect data-role="brand-accent" x="${panelX + Math.round(fontSize * 0.48)}" y="${panelY + Math.round(fontSize * 0.34)}" width="${Math.max(4, Math.round(fontSize * 0.13))}" height="${panelHeight - Math.round(fontSize * 0.68)}" rx="3" fill="#F25700"/>`
    : "";
  const textX = style === "brand-accent" ? width / 2 + Math.round(fontSize * 0.16) : width / 2;
  const textStyle = style === "minimal-outline"
    ? `font-weight="600" fill="#FFFFFF" stroke="#111318" stroke-opacity="0.88" stroke-width="3.4" paint-order="stroke fill"`
    : `font-weight="500" fill="#FFFFFF" stroke="#000000" stroke-opacity="0.2" stroke-width="0.8" paint-order="stroke fill"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-style="${style}">
    ${panel}
    ${accent}
    ${lines.map((line, index) => `<text x="${textX}" y="${firstBaseline + index * lineHeight}" text-anchor="middle" font-family="${escapeXml(options.fontFamily)}" font-size="${fontSize}" ${textStyle}>${escapeXml(line)}</text>`).join("\n")}
  </svg>`;
}

export function renderSubtitleOverlayPng(text: string, outputPath: string, options: SubtitleOverlayOptions) {
  const width = options.width ?? 1920;
  const svg = buildSubtitleOverlaySvg(text, options);
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: [options.fontPath],
      loadSystemFonts: false,
      defaultFontFamily: options.fontFamily
    }
  }).render().asPng();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, png);
  return outputPath;
}
