import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { SlideDto } from "@ppt-agent/shared";
import { fitSvgTextToBounds, normalizePptExportTheme, recolorSvgPreview, themeFamily } from "@ppt-agent/shared";

export interface RenderSlidePngOptions {
  width?: number;
  theme?: string;
  accentId?: string | null;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

function wrapText(value: string, maxChars: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  for (let index = 0; index < clean.length; index += maxChars) lines.push(clean.slice(index, index + maxChars));
  return lines.length ? lines : [""];
}

function fallbackSvg(slide: SlideDto, theme?: string) {
  const dark = themeFamily(normalizePptExportTheme(theme)) === "dark";
  const bg = dark ? "#071426" : "#F4F7FB";
  const card = dark ? "#10243D" : "#FFFFFF";
  const title = dark ? "#FFFFFF" : "#08213A";
  const body = dark ? "#D9E8F7" : "#334155";
  const accent = dark ? "#35D0FF" : "#0066CC";
  const keyLines = wrapText(slide.planJson?.keyMessage || slide.keyMessage, 32).slice(0, 3);
  const items = (slide.planJson?.contentBlocks.flatMap((block) => block.items) || slide.contentPoints).slice(0, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="${bg}"/>
  <rect x="64" y="56" width="10" height="72" rx="5" fill="${accent}"/>
  <text x="96" y="105" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="42" font-weight="700" fill="${title}">${escapeXml(slide.planJson?.title || slide.title)}</text>
  <rect x="64" y="156" width="1152" height="180" rx="24" fill="${card}" stroke="${accent}" stroke-opacity="0.22"/>
  ${keyLines.map((line, index) => `<text x="96" y="${215 + index * 48}" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="30" font-weight="600" fill="${title}">${escapeXml(line)}</text>`).join("\n")}
  ${items.map((item, index) => `<g><circle cx="92" cy="${398 + index * 54}" r="7" fill="${accent}"/><text x="116" y="${407 + index * 54}" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="23" fill="${body}">${escapeXml(wrapText(item, 48)[0] || "")}</text></g>`).join("\n")}
  <text x="1160" y="675" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="${body}" opacity="0.55">PPT Agent</text>
</svg>`;
}

export function renderSlidePng(slide: SlideDto, outputPath: string, options: RenderSlidePngOptions = {}) {
  const width = options.width ?? 1920;
  const source = slide.svgPreview
    ? recolorSvgPreview(fitSvgTextToBounds(slide.svgPreview).svg, normalizePptExportTheme(options.theme), {
        accentId: options.accentId
      })
    : fallbackSvg(slide, options.theme);
  const png = new Resvg(source, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Microsoft YaHei" }
  }).render().asPng();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, png);
  return outputPath;
}
