import fs from "node:fs";
import path from "node:path";
import PptxGenJSDefault from "pptxgenjs";
import { Resvg } from "@resvg/resvg-js";
import type {
  ExportMode,
  FactDto,
  ProjectDto,
  RenderStrategy,
  SlideDto,
  SlideIrElementDto
} from "@ppt-agent/shared";
import {
  effectiveRenderStrategy,
  fitSvgTextToBounds,
  getBannedSvgFeatures,
  normalizePptExportTheme,
  normalizeRecommendedLayout,
  recolorSvgPreview,
  themeFamily,
  type RecommendedLayout
} from "@ppt-agent/shared";
import type { PageRenderResult, RenderProjectPptxInput, RenderProjectPptxResult } from "./exportTypes.js";
import { tryRenderSvgSlide } from "./svgCompile.js";
import { postprocessEditableSvgGeometry } from "./pptxPostprocess.js";

export type { PageRenderResult, RenderProjectPptxInput, RenderProjectPptxResult } from "./exportTypes.js";
export { compileSvgPreviewToSlide, tryRenderSvgSlide } from "./svgCompile.js";
export type { SvgCompileResult } from "./svgCompile.js";
export { renderSlidePng } from "./slideImage.js";
export { renderSubtitleOverlayPng } from "./subtitleOverlay.js";
export type { SubtitleOverlayOptions, SubtitleStyle } from "./subtitleOverlay.js";
export type { RenderSlidePngOptions } from "./slideImage.js";

const W = 13.333;
const H = 7.5;
const fontFace = "Microsoft YaHei";

const deckTokens = {
  bg: "#F4F7FB",
  card: "#FFFFFF",
  navy: "#06345F",
  deepNavy: "#021D3A",
  ink: "#14202B",
  muted: "#667085",
  line: "#D7E2EF",
  softBlue: "#EAF4FF",
  softCyan: "#E8FAFF",
  softGreen: "#ECFDF3",
  softAmber: "#FFF7E8",
  softRed: "#FFF1F0",
  blue: "#0066CC",
  cyan: "#00A6D6",
  violet: "#6D5DF6",
  green: "#12B76A",
  amber: "#F79009",
  red: "#D92D20"
} as const;

const pageAccents = [deckTokens.blue, deckTokens.cyan, deckTokens.violet, deckTokens.green, deckTokens.amber, deckTokens.red];

type PptxSlide = {
  background?: { color: string };
  addImage: (options: Record<string, unknown>) => void;
  addShape: (shapeType: string, options: Record<string, unknown>) => void;
  addText: (
    text: string | Array<{ text: string; options?: Record<string, unknown> }>,
    options: Record<string, unknown>
  ) => void;
};

type PptxInstance = {
  ShapeType: Record<"rect" | "roundRect" | "line" | "ellipse", string>;
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, string>;
  addSlide: () => PptxSlide;
  writeFile: (options: { fileName: string }) => Promise<unknown>;
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CardTone = "primary" | "default" | "accent" | "success" | "warning" | "risk";
type CardVariant = "default" | "hero" | "compact";
type PptExportTheme = import("@ppt-agent/shared").PptExportTheme;

function normalizePptTheme(value?: string): PptExportTheme {
  return normalizePptExportTheme(value);
}

/**
 * 图片保真路径：用 resvg 先把最终 SVG 渲染为 1280×720 PNG，再整页嵌入。
 * 不直接嵌 SVG：部分 WPS/Quick Look 会读取到不兼容的 SVG fallback 而显示红叉。
 */
export function tryRenderSvgImageSlide(slide: PptxSlide, svgPreview?: string | null): boolean {
  if (!svgPreview || !/viewBox=["']0 0 1280 720["']/i.test(svgPreview)) {
    return false;
  }
  if (getBannedSvgFeatures(svgPreview).length > 0) {
    return false;
  }

  try {
    const png = new Resvg(svgPreview, {
      fitTo: { mode: "width", value: 1280 },
      font: {
        loadSystemFonts: true,
        defaultFontFamily: fontFace
      }
    })
      .render()
      .asPng();
    const data = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    slide.addImage({
      data,
      x: 0,
      y: 0,
      w: W,
      h: H,
      objectName: "PPT Agent fidelity image",
      altText: "Pixel-perfect slide image"
    });
    return true;
  } catch {
    return false;
  }
}

/** IR/主题模板按 light/dark 族分流；ThemePack 色差主要走 SVG recolor */
function isDarkExportTheme(theme: PptExportTheme): boolean {
  return themeFamily(theme) === "dark";
}

function c(hex: string) {
  return hex.replace("#", "");
}

function short(value: string, length = 110) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean;
}

function multilineShort(value: string, length = 180) {
  const clean = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean;
}

function pxBox(element: SlideIrElementDto): Box {
  return {
    x: (element.x / 1280) * W,
    y: (element.y / 720) * H,
    w: (element.w / 1280) * W,
    h: (element.h / 720) * H
  };
}

function factsForSlide(slide: SlideDto, facts: FactDto[]) {
  const linked = facts.filter((fact) => slide.sourceFactIds.includes(fact.id));
  return linked.length > 0 ? linked : facts.filter((fact) => fact.canUseInPpt).slice(0, 5);
}

function itemsForSlide(slide: SlideDto, facts: FactDto[], max = 6) {
  const planItems = slide.planJson?.contentBlocks.flatMap((block) => block.items) ?? [];
  return [...slide.contentPoints, ...planItems, ...facts.map((fact) => fact.content)].filter(Boolean).slice(0, max);
}

function isActionSlide(slide: SlideDto) {
  return /action|行动|下一步|计划|清单/i.test(`${slide.title} ${slide.recommendedLayout} ${slide.planJson?.layoutType ?? ""}`);
}

function planTableRows(slide: SlideDto) {
  const tableBlock = slide.planJson?.contentBlocks.find((block) => block.type === "table" && block.items.length > 0);
  if (!tableBlock) {
    return [];
  }
  return tableBlock.items
    .map((item) => item.split("|").map((cell) => cell.trim()).filter(Boolean))
    .filter((row) => row.length > 0);
}

function planCalloutItems(slide: SlideDto) {
  return slide.planJson?.contentBlocks.find((block) => block.type === "callout" && block.items.length > 0)?.items ?? [];
}

function toneFill(tone: CardTone) {
  if (tone === "primary") return deckTokens.softBlue;
  if (tone === "accent") return deckTokens.softCyan;
  if (tone === "success") return deckTokens.softGreen;
  if (tone === "warning") return deckTokens.softAmber;
  if (tone === "risk") return deckTokens.softRed;
  return deckTokens.card;
}

function toneColor(tone: CardTone) {
  if (tone === "success") return deckTokens.green;
  if (tone === "warning") return deckTokens.amber;
  if (tone === "risk") return deckTokens.red;
  if (tone === "accent") return deckTokens.cyan;
  return deckTokens.blue;
}

function elementTone(element: SlideIrElementDto): CardTone {
  const tone = element.style.tone;
  return tone === "primary" || tone === "accent" || tone === "success" || tone === "warning" || tone === "risk" || tone === "default" ? tone : "default";
}

function styleColor(element: SlideIrElementDto, fallback: string) {
  return typeof element.style.color === "string" ? element.style.color : fallback;
}

function styleFill(element: SlideIrElementDto, fallback: string) {
  return typeof element.style.fill === "string" ? element.style.fill : fallback;
}

function styleStroke(element: SlideIrElementDto, fallback: string) {
  return typeof element.style.stroke === "string" ? element.style.stroke : fallback;
}

function contentTitle(element: SlideIrElementDto, fallback = "") {
  return element.content.title || element.content.label || fallback;
}

function contentBody(element: SlideIrElementDto) {
  return (
    element.content.body ||
    element.content.text ||
    element.content.value ||
    element.content.note ||
    element.content.items?.join("\n") ||
    element.content.rows?.map((row) => row.join("  ")).join("\n") ||
    ""
  );
}

function contentItems(element: SlideIrElementDto) {
  if (element.content.items?.length) {
    return element.content.items.filter((item) => item.trim().length > 0);
  }

  const body = contentBody(element);
  const bulletLines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-•]\s+/.test(line) || /^\d+[.、]\s*/.test(line))
    .map((line) => line.replace(/^[-•]\s+/, "").replace(/^\d+[.、]\s*/, "").trim())
    .filter(Boolean);

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  return body
    .split(/；|;|。(?=\S)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function bulletText(element: SlideIrElementDto) {
  const items = contentItems(element);
  return items.length > 1 ? items.map((item) => `• ${item}`).join("\n") : contentBody(element);
}

function parseMarkdownTable(value: string | undefined) {
  if (!value) {
    return [];
  }
  const rows = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim())
    )
    .filter((row) => row.length > 0 && !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
  return rows.length >= 2 ? rows : [];
}

function cardShadow() {
  return { type: "outer", color: "C7D3E1", opacity: 0.16, blur: 1.2, angle: 45, distance: 1 };
}

function pageAccent(page: number) {
  return pageAccents[(page - 1) % pageAccents.length] ?? deckTokens.blue;
}

function addSlideBackdrop(pptx: PptxInstance, slide: PptxSlide, page: number) {
  const accent = pageAccent(page);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: c(deckTokens.bg) },
    line: { transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: 0.1,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 11.68,
    y: 0.34,
    w: 0.64,
    h: 0.08,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
}

function addFooter(pptx: PptxInstance, slide: PptxSlide, page: number) {
  slide.addShape(pptx.ShapeType.line, {
    x: 0.62,
    y: 6.88,
    w: 12.05,
    h: 0,
    line: { color: c(deckTokens.line), width: 0.7 }
  });
  slide.addText("PPT Agent Engine", {
    x: 0.68,
    y: 6.98,
    w: 4.2,
    h: 0.22,
    fontFace,
    fontSize: 8.5,
    color: c(deckTokens.muted),
    margin: 0
  });
  slide.addText(String(page).padStart(2, "0"), {
    x: 12.06,
    y: 6.94,
    w: 0.6,
    h: 0.28,
    fontFace,
    fontSize: 10,
    bold: true,
    align: "right",
    color: c(pageAccent(page)),
    margin: 0
  });
}

function addEditableCard(
  pptx: PptxInstance,
  slide: PptxSlide,
  box: Box,
  title: string,
  body: string,
  tone: CardTone = "default",
  variant: CardVariant = "default",
  accentOverride?: string
) {
  const accent = accentOverride || toneColor(tone);
  const isHero = variant === "hero";
  const fill = isHero ? deckTokens.navy : toneFill(tone);
  const titleColor = isHero ? "FFFFFF" : accent;
  const bodyColor = isHero ? "DCEBFF" : deckTokens.ink;

  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: c(fill) },
    line: { color: c(isHero ? deckTokens.deepNavy : tone === "default" ? deckTokens.line : accent), width: isHero ? 0 : 0.8 },
    radius: 0.14,
    shadow: cardShadow()
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: box.x + 0.18,
    y: box.y + 0.18,
    w: Math.min(0.72, Math.max(0.28, box.w * 0.14)),
    h: 0.07,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });

  if (title) {
    slide.addText(short(title, 36), {
      x: box.x + 0.2,
      y: box.y + 0.32,
      w: box.w - 0.4,
      h: 0.28,
      fontFace,
      fontSize: variant === "compact" ? 9.6 : box.h > 1.7 ? 11.8 : 10.4,
      bold: true,
      color: c(titleColor),
      margin: 0
    });
  }

  if (body.trim()) {
    slide.addText(multilineShort(body, box.h > 1.7 ? 220 : 130), {
      x: box.x + 0.2,
      y: box.y + (title ? 0.74 : 0.32),
      w: box.w - 0.4,
      h: Math.max(0.28, box.h - (title ? 0.92 : 0.5)),
      fontFace,
      fontSize: variant === "compact" ? 8.8 : box.h > 1.7 ? 11.2 : 9.8,
      color: c(bodyColor),
      fit: "shrink",
      valign: "top",
      breakLine: false,
      margin: 0.02
    });
  }
}

function addMetricCard(pptx: PptxInstance, slide: PptxSlide, box: Box, label: string, value: string, note: string, tone: CardTone = "primary") {
  const accent = toneColor(tone);
  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: c(deckTokens.card) },
    line: { color: c(accent), width: 1 },
    radius: 0.14,
    shadow: cardShadow()
  });
  slide.addText(short(value, 18), {
    x: box.x + 0.22,
    y: box.y + 0.18,
    w: box.w - 0.44,
    h: Math.min(0.62, box.h * 0.36),
    fontFace,
    fontSize: Math.max(18, Math.min(30, box.h * 15)),
    bold: true,
    color: c(accent),
    margin: 0
  });
  slide.addText(short(label, 30), {
    x: box.x + 0.24,
    y: box.y + Math.min(0.82, box.h * 0.48),
    w: box.w - 0.48,
    h: 0.24,
    fontFace,
    fontSize: 9.5,
    bold: true,
    color: c(deckTokens.navy),
    margin: 0
  });
  if (note && box.h >= 1.18) {
    slide.addText(short(note, 60), {
      x: box.x + 0.24,
      y: box.y + Math.min(1.12, box.h * 0.66),
      w: box.w - 0.48,
      h: Math.max(0.24, box.h - 1.2),
      fontFace,
      fontSize: 8.8,
      color: c(deckTokens.muted),
      fit: "shrink",
      margin: 0.02
    });
  }
}

function addTextElement(slide: PptxSlide, element: SlideIrElementDto) {
  const box = pxBox(element);
  const fontSize = typeof element.style.fontSize === "number" ? element.style.fontSize * 0.52 : element.role === "title" ? 22 : 12;
  const text = element.content.items?.length ? bulletText(element) : contentBody(element) || element.content.title || element.content.label || "";
  slide.addText(element.role === "title" ? short(text, 42) : multilineShort(text, 220), {
    ...box,
    fontFace,
    fontSize,
    bold: element.style.bold ?? element.role === "title",
    color: c(styleColor(element, element.role === "title" ? deckTokens.navy : deckTokens.ink)),
    align: element.style.align ?? "left",
    fit: "shrink",
    margin: 0.02
  });
}

function addTableLike(pptx: PptxInstance, slide: PptxSlide, element: SlideIrElementDto) {
  const box = pxBox(element);
  const title = contentTitle(element);
  const tableBox = title
    ? { x: box.x + 0.18, y: box.y + 0.72, w: box.w - 0.36, h: Math.max(0.4, box.h - 0.92) }
    : box;
  const markdownRows = parseMarkdownTable(element.content.value || element.content.body || element.content.text);
  const rows = element.content.rows?.length
    ? element.content.rows
    : markdownRows.length
      ? markdownRows
      : element.content.items?.length
        ? element.content.items.map((item) => [item])
        : [[contentBody(element)]];
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, Math.max(...rows.map((row) => row.length)));
  const rowH = tableBox.h / rowCount;
  const colW = tableBox.w / colCount;

  if (title) {
    addEditableCard(pptx, slide, box, title, "", elementTone(element), "compact");
  }

  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const x = tableBox.x + colIndex * colW;
      const y = tableBox.y + rowIndex * rowH;
      const isHeader = rowIndex === 0 && colCount > 1;
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: colW,
        h: rowH,
        fill: { color: isHeader ? c(deckTokens.navy) : rowIndex % 2 === 0 ? "F8FBFF" : "FFFFFF" },
        line: { color: c(deckTokens.line), width: 0.5 }
      });
      slide.addText(short(row[colIndex] ?? "", 46), {
        x: x + 0.06,
        y: y + 0.06,
        w: Math.max(0.1, colW - 0.12),
        h: Math.max(0.1, rowH - 0.12),
        fontFace,
        fontSize: isHeader ? 8.8 : 8.2,
        bold: isHeader,
        color: isHeader ? "FFFFFF" : c(deckTokens.ink),
        fit: "shrink",
        margin: 0
      });
    }
  });
}

function addTableGrid(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, rows: string[][]) {
  addEditableCard(pptx, slide, box, title, "", "default", "compact");
  const tableBox = { x: box.x + 0.18, y: box.y + 0.72, w: box.w - 0.36, h: Math.max(0.4, box.h - 0.92) };
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, Math.max(...rows.map((row) => row.length)));
  const rowH = tableBox.h / rowCount;
  const colW = tableBox.w / colCount;

  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const x = tableBox.x + colIndex * colW;
      const y = tableBox.y + rowIndex * rowH;
      const isHeader = rowIndex === 0;
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: colW,
        h: rowH,
        fill: { color: isHeader ? c(deckTokens.navy) : rowIndex % 2 === 0 ? "F8FBFF" : "FFFFFF" },
        line: { color: c(deckTokens.line), width: 0.5 }
      });
      slide.addText(short(row[colIndex] ?? "", 52), {
        x: x + 0.06,
        y: y + 0.06,
        w: Math.max(0.1, colW - 0.12),
        h: Math.max(0.1, rowH - 0.12),
        fontFace,
        fontSize: isHeader ? 9 : 8.4,
        bold: isHeader,
        color: isHeader ? "FFFFFF" : c(deckTokens.ink),
        fit: "shrink",
        margin: 0
      });
    }
  });
}

function addTimelineLike(pptx: PptxInstance, slide: PptxSlide, element: SlideIrElementDto) {
  const box = pxBox(element);
  const items = contentItems(element).slice(0, 6);
  if (items.length === 0) {
    return;
  }
  addEditableCard(pptx, slide, box, contentTitle(element, "关键节点"), "", elementTone(element), "compact");
  const accent = toneColor(elementTone(element));
  const y = box.y + box.h * 0.5;
  slide.addShape(pptx.ShapeType.line, {
    x: box.x + 0.38,
    y,
    w: Math.max(0.1, box.w - 0.76),
    h: 0,
    line: { color: c(accent), width: 1.8 }
  });
  items.forEach((item, index) => {
    const step = items.length === 1 ? 0 : (box.w - 1.1) / (items.length - 1);
    const x = box.x + 0.44 + index * step;
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y: y - 0.14,
      w: 0.28,
      h: 0.28,
      fill: { color: c(accent) },
      line: { color: c(accent) }
    });
    slide.addText(short(item, 52), {
      x: x - 0.4,
      y: y + (index % 2 === 0 ? 0.24 : -0.82),
      w: 1.28,
      h: 0.56,
      fontFace,
      fontSize: 7.8,
      color: c(deckTokens.ink),
      fit: "shrink",
      align: "center",
      margin: 0
    });
  });
}

function addProcessLike(pptx: PptxInstance, slide: PptxSlide, element: SlideIrElementDto) {
  const box = pxBox(element);
  const items = contentItems(element).slice(0, 5);
  if (items.length === 0) {
    return;
  }
  const gap = 0.18;
  const cardW = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, index) => {
    const cardBox = { x: box.x + index * (cardW + gap), y: box.y, w: cardW, h: box.h };
    addEditableCard(pptx, slide, cardBox, `步骤 ${index + 1}`, item, index === 0 ? "primary" : "default", "compact");
    if (index < items.length - 1) {
      slide.addShape(pptx.ShapeType.line, {
        x: cardBox.x + cardBox.w + 0.03,
        y: cardBox.y + cardBox.h / 2,
        w: gap - 0.06,
        h: 0,
        line: { color: c(deckTokens.blue), width: 1.1, beginArrowType: "none", endArrowType: "triangle" }
      });
    }
  });
}

function addDecor(pptx: PptxInstance, slide: PptxSlide, element: SlideIrElementDto) {
  const box = pxBox(element);
  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: c(styleFill(element, "#FFFFFF")), transparency: 12 },
    line: { color: c(styleStroke(element, deckTokens.line)), transparency: 35 },
    radius: 0.08
  });
}

function renderIrElement(pptx: PptxInstance, slide: PptxSlide, element: SlideIrElementDto) {
  const box = pxBox(element);
  const tone = elementTone(element);
  if (element.type === "text") {
    addTextElement(slide, element);
    return;
  }
  if (element.type === "metric") {
    addMetricCard(pptx, slide, box, element.content.label || contentTitle(element, "指标"), element.content.value || contentBody(element), element.content.note || "", tone);
    return;
  }
  if (element.type === "table") {
    addTableLike(pptx, slide, element);
    return;
  }
  if (element.type === "timeline") {
    addTimelineLike(pptx, slide, element);
    return;
  }
  if (element.type === "process") {
    addProcessLike(pptx, slide, element);
    return;
  }
  if (element.type === "decor") {
    addDecor(pptx, slide, element);
    return;
  }

  const variant = element.type === "callout" || /hero|key|summary/i.test(element.role) ? "hero" : "default";
  addEditableCard(pptx, slide, box, contentTitle(element, element.type === "callout" ? "重点提示" : "内容卡片"), bulletText(element), tone, variant);
}

function renderIrSlide(pptx: PptxInstance, slide: PptxSlide, outline: SlideDto) {
  const ir = outline.irJson;
  if (!ir) {
    return false;
  }
  ir.elements
    .slice()
    .sort((a, b) => a.z - b.z)
    .forEach((element) => renderIrElement(pptx, slide, element));
  return true;
}

function renderActionSlide(pptx: PptxInstance, slide: PptxSlide, outline: SlideDto) {
  const rows = planTableRows(outline);
  if (rows.length === 0) {
    return false;
  }

  slide.addText(short(outline.planJson?.title || outline.title, 46), {
    x: 0.42,
    y: 0.48,
    w: 11.6,
    h: 0.54,
    fontFace,
    fontSize: 22,
    bold: true,
    color: c(deckTokens.navy),
    margin: 0
  });
  slide.addText(short(outline.planJson?.contentBlocks[0]?.title || outline.partTitle || "", 90), {
    x: 0.43,
    y: 1.12,
    w: 10.8,
    h: 0.28,
    fontFace,
    fontSize: 10.5,
    color: c(deckTokens.ink),
    margin: 0
  });

  addEditableCard(
    pptx,
    slide,
    { x: 0.43, y: 1.7, w: 12.05, h: 0.9 },
    "核心目标",
    outline.planJson?.keyMessage || outline.keyMessage,
    "primary",
    "hero"
  );

  addTableGrid(pptx, slide, { x: 0.43, y: 2.98, w: 8.25, h: 3.6 }, "行动项执行矩阵", rows);

  const tips = planCalloutItems(outline);
  addEditableCard(
    pptx,
    slide,
    { x: 9.05, y: 2.98, w: 3.43, h: 1.66 },
    "执行提示",
    tips.map((item) => `• ${item}`).join("\n"),
    "accent",
    "hero"
  );
  addEditableCard(
    pptx,
    slide,
    { x: 9.05, y: 4.92, w: 3.43, h: 1.66 },
    "会后跟进",
    "• 对排期冲突即时反馈\n• 风险闭环会议按各方时间确认\n• 输出责任人和完成时间",
    "default"
  );

  return true;
}

function techBullet(items: string[], length = 38) {
  return items.filter(Boolean).map((item) => `• ${short(item, length)}`).join("\n");
}

function factBullets(facts: FactDto[], pattern: RegExp, max = 4) {
  return techBullet(facts.filter((fact) => pattern.test(`${fact.category} ${fact.content}`)).slice(0, max).map((fact) => fact.content));
}

function planBlockBullets(slide: SlideDto, pattern: RegExp) {
  const block = slide.planJson?.contentBlocks.find((item) => pattern.test(item.title));
  return block ? techBullet(block.items) : "";
}

function blockByTitle(slide: SlideDto, pattern: RegExp) {
  return slide.planJson?.contentBlocks.find((item) => pattern.test(item.title));
}

function meaningfulPoints(slide: SlideDto, facts: FactDto[], max = 8) {
  const planItems = slide.planJson?.contentBlocks.flatMap((block) => block.items) ?? [];
  const candidates = [...slide.contentPoints, ...planItems, ...facts.map((fact) => fact.content)];
  const seen = new Set<string>();
  return candidates
    .map((item) => item.replace(/^下一步计划[:：]\s*/, "").trim())
    .filter((item) => item.length > 0 && !/[:：]\s*$/.test(item))
    .filter((item) => /[A-Za-z0-9\u4e00-\u9fff]/.test(item))
    .filter((item) => {
      const key = item.replace(/\s+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function bestClaim(slide: SlideDto, facts: FactDto[]) {
  const key = slide.keyMessage.trim();
  if (key.length >= 8 && !/[:：]\s*$/.test(key)) {
    return key;
  }
  return meaningfulPoints(slide, facts, 1)[0] ?? slide.slideGoal ?? key;
}

function bodyFromPoints(slide: SlideDto, facts: FactDto[], max = 4) {
  const body = techBullet(meaningfulPoints(slide, facts, max));
  return body || bestClaim(slide, facts);
}

function groupedBodies(slide: SlideDto, facts: FactDto[], groups: number, maxPerGroup = 3) {
  const source = meaningfulPoints(slide, facts, groups * maxPerGroup);
  const buckets = Array.from({ length: groups }, () => [] as string[]);
  source.forEach((item, index) => {
    const bucket = buckets[index % groups];
    if (bucket) {
      bucket.push(item);
    }
  });
  return buckets.map((bucket) => techBullet(bucket));
}

function matrixRowsFromPoints(slide: SlideDto, facts: FactDto[], kind: "risk" | "action") {
  const existingRows = planTableRows(slide);
  if (existingRows.length > 0) {
    return existingRows;
  }

  const points = meaningfulPoints(slide, facts, 4);
  if (kind === "risk") {
    const riskLabels = ["交付风险", "进度影响", "客户确认", "资源支持"];
    const actions = ["纳入风险闭环", "预留调整窗口", "明确责任人与时限", "会后持续跟进"];
    return [
      ["风险项", "影响判断", "应对动作"],
      ...points.map((point, index) => [riskLabels[index] ?? "待跟进", short(point, 34), actions[index] ?? "持续跟进"])
    ];
  }

  const times = ["下周一", "下周三", "周五前", "待定"];
  const owners = ["项目组", "项目组", "客户/项目组", "项目经理"];
  return [
    ["时间节点", "责任方", "行动内容"],
    ...points.map((point, index) => [times[index] ?? "待定", owners[index] ?? "项目组", short(point, 42)])
  ];
}

function timelineItemsFromSlide(slide: SlideDto, facts: FactDto[]) {
  return meaningfulPoints(slide, facts, 4);
}

function actionRowsFromPlan(slide: SlideDto) {
  return planTableRows(slide);
}

function techAccent(page: number) {
  return pageAccent(page);
}

function addDarkBackdrop(pptx: PptxInstance, slide: PptxSlide, page: number) {
  const accent = techAccent(page);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: "06111F" },
    line: { transparency: 100 }
  });
  for (let x = 0.35; x < W; x += 0.62) {
    slide.addShape(pptx.ShapeType.line, {
      x,
      y: 0.26,
      w: 0,
      h: 6.85,
      line: { color: "123552", transparency: 62, width: 0.25 }
    });
  }
  for (let y = 0.36; y < H; y += 0.52) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.22,
      y,
      w: 12.9,
      h: 0,
      line: { color: "123552", transparency: 66, width: 0.25 }
    });
  }
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: 0.08,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 11.15,
    y: 0.38,
    w: 0.94,
    h: 0.06,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.48,
    y: 6.9,
    w: 12.35,
    h: 0,
    line: { color: c(accent), transparency: 42, width: 0.5 }
  });
}

function addDarkTitle(slide: PptxSlide, title: string, subtitle: string, page: number) {
  const accent = techAccent(page);
  slide.addText(short(title, 46), {
    x: 0.46,
    y: 0.42,
    w: 10.6,
    h: 0.48,
    fontFace,
    fontSize: 24,
    bold: true,
    color: "F2FAFF",
    margin: 0
  });
  if (subtitle) {
    slide.addText(short(subtitle, 96), {
      x: 0.48,
      y: 0.98,
      w: 10.4,
      h: 0.25,
      fontFace,
      fontSize: 9.4,
      color: "9DB7CA",
      margin: 0
    });
  }
  slide.addShape("rect", {
    x: 0.49,
    y: 1.3,
    w: 0.72,
    h: 0.055,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
}

function addDarkFooter(slide: PptxSlide, page: number) {
  slide.addText("PPT Agent Engine", {
    x: 0.5,
    y: 7.04,
    w: 3.2,
    h: 0.2,
    fontFace,
    fontSize: 7.6,
    color: "6C879B",
    margin: 0
  });
  slide.addText(String(page).padStart(2, "0"), {
    x: 12.17,
    y: 6.99,
    w: 0.5,
    h: 0.22,
    fontFace,
    fontSize: 10,
    bold: true,
    color: c(techAccent(page)),
    align: "right",
    margin: 0
  });
}

function addDarkPanel(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, body: string, page: number, variant: "dark" | "light" | "hot" = "dark") {
  const accent = techAccent(page);
  const isLight = variant === "light";
  const fill = isLight ? "F8FBFF" : variant === "hot" ? "082A4C" : "071C33";
  const line = isLight ? "D3E3F0" : variant === "hot" ? accent : "174D74";
  const titleColor = isLight ? accent : "FFFFFF";
  const bodyColor = isLight ? "172C3D" : "D8E9F7";
  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: fill },
    line: { color: c(line), transparency: isLight ? 0 : 12, width: 0.75 },
    radius: 0.12,
    shadow: { type: "outer", color: "000000", opacity: 0.24, blur: 1.2, angle: 45, distance: 1 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: box.x + 0.18,
    y: box.y + 0.18,
    w: 0.56,
    h: 0.06,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
  slide.addText(short(title, 36), {
    x: box.x + 0.18,
    y: box.y + 0.34,
    w: box.w - 0.36,
    h: 0.27,
    fontFace,
    fontSize: 10.8,
    bold: true,
    color: c(titleColor),
    margin: 0
  });
  if (body.trim()) {
    slide.addText(multilineShort(body, box.h > 1.7 ? 280 : 150), {
      x: box.x + 0.18,
      y: box.y + 0.74,
      w: box.w - 0.36,
      h: Math.max(0.24, box.h - 0.9),
      fontFace,
      fontSize: box.h > 1.7 ? 10 : 8.8,
      color: c(bodyColor),
      fit: "shrink",
      valign: "top",
      margin: 0.02
    });
  }
}

function addDarkMetric(pptx: PptxInstance, slide: PptxSlide, box: Box, value: string, label: string, note: string, page: number) {
  const accent = techAccent(page);
  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: "081F38" },
    line: { color: c(accent), width: 1.1 },
    radius: 0.12,
    shadow: { type: "outer", color: "000000", opacity: 0.2, blur: 1.1, angle: 45, distance: 1 }
  });
  slide.addText(value, {
    x: box.x + 0.16,
    y: box.y + 0.16,
    w: box.w - 0.32,
    h: 0.42,
    fontFace,
    fontSize: 21,
    bold: true,
    color: c(accent),
    margin: 0
  });
  slide.addText(label, {
    x: box.x + 0.18,
    y: box.y + 0.68,
    w: box.w - 0.36,
    h: 0.24,
    fontFace,
    fontSize: 8.6,
    bold: true,
    color: "FFFFFF",
    margin: 0
  });
  if (note) {
    slide.addText(short(note, 58), {
      x: box.x + 0.18,
      y: box.y + 0.98,
      w: box.w - 0.36,
      h: Math.max(0.2, box.h - 1.04),
      fontFace,
      fontSize: 7.2,
      color: "A9C4DA",
      fit: "shrink",
      margin: 0
    });
  }
}

function addDarkTable(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, rows: string[][], page: number) {
  addDarkPanel(pptx, slide, box, title, "", page, "light");
  const tableBox = { x: box.x + 0.18, y: box.y + 0.72, w: box.w - 0.36, h: Math.max(0.4, box.h - 0.92) };
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, Math.max(...rows.map((row) => row.length)));
  const rowH = tableBox.h / rowCount;
  const colW = tableBox.w / colCount;
  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const isHeader = rowIndex === 0;
      const x = tableBox.x + colIndex * colW;
      const y = tableBox.y + rowIndex * rowH;
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: colW,
        h: rowH,
        fill: { color: isHeader ? c(techAccent(page)) : rowIndex % 2 === 0 ? "EEF6FF" : "FFFFFF" },
        line: { color: "D6E6F4", width: 0.5 }
      });
      slide.addText(short(row[colIndex] ?? "", 54), {
        x: x + 0.06,
        y: y + 0.06,
        w: Math.max(0.1, colW - 0.12),
        h: Math.max(0.1, rowH - 0.12),
        fontFace,
        fontSize: isHeader ? 8.6 : 8,
        bold: isHeader,
        color: isHeader ? "FFFFFF" : "14202B",
        fit: "shrink",
        margin: 0
      });
    }
  });
}

function addDarkTimeline(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, items: string[], page: number) {
  addDarkPanel(pptx, slide, box, title, "", page, "dark");
  const accent = techAccent(page);
  const y = box.y + box.h * 0.54;
  slide.addShape(pptx.ShapeType.line, {
    x: box.x + 0.5,
    y,
    w: box.w - 1,
    h: 0,
    line: { color: c(accent), width: 1.7 }
  });
  items.slice(0, 4).forEach((item, index) => {
    const step = items.length <= 1 ? 0 : (box.w - 1.1) / (Math.min(items.length, 4) - 1);
    const x = box.x + 0.44 + step * index;
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y: y - 0.16,
      w: 0.32,
      h: 0.32,
      fill: { color: c(accent) },
      line: { color: "FFFFFF", transparency: 12, width: 0.5 }
    });
    slide.addText(short(item, 48), {
      x: x - 0.36,
      y: y + (index % 2 === 0 ? 0.28 : -0.8),
      w: 1.25,
      h: 0.5,
      fontFace,
      fontSize: 7.6,
      color: "D8E8F7",
      fit: "shrink",
      align: "center",
      margin: 0
    });
  });
}

function whiteBlueAccent(page: number) {
  return pageAccents[(page - 1) % 3] ?? deckTokens.blue;
}

function addWhiteBlueBackdrop(pptx: PptxInstance, slide: PptxSlide, page: number) {
  const accent = whiteBlueAccent(page);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: "ECF3F8" },
    line: { transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.18,
    y: 0.18,
    w: W - 0.36,
    h: H - 0.36,
    fill: { color: "ECF3F8", transparency: 100 },
    line: { color: "D9E6F0", width: 0.7 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 10.92,
    y: 0.42,
    w: 0.78,
    h: 0.06,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
}

function addWhiteBlueTitle(slide: PptxSlide, title: string, subtitle: string, page: number) {
  const accent = whiteBlueAccent(page);
  slide.addText(short(title, 44), {
    x: 0.58,
    y: 0.46,
    w: 9.5,
    h: 0.56,
    fontFace,
    fontSize: 25,
    bold: true,
    color: "081427",
    margin: 0
  });
  if (subtitle) {
    slide.addText(short(subtitle, 92), {
      x: 0.6,
      y: 1.06,
      w: 10.2,
      h: 0.24,
      fontFace,
      fontSize: 9.2,
      color: "5D6B7A",
      margin: 0
    });
  }
  slide.addShape("rect", {
    x: 0.6,
    y: 1.38,
    w: 0.78,
    h: 0.05,
    fill: { color: c(accent) },
    line: { transparency: 100 }
  });
}

function addWhiteBlueFooter(slide: PptxSlide, page: number) {
  slide.addText("PPT Agent Engine", {
    x: 0.62,
    y: 7.02,
    w: 3.0,
    h: 0.2,
    fontFace,
    fontSize: 7.4,
    color: "7A8A9A",
    margin: 0
  });
  slide.addText(String(page).padStart(2, "0"), {
    x: 12.15,
    y: 6.96,
    w: 0.5,
    h: 0.24,
    fontFace,
    fontSize: 10,
    bold: true,
    color: c(whiteBlueAccent(page)),
    align: "right",
    margin: 0
  });
}

function addWhiteBluePanel(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, body: string, page: number, variant: "default" | "blue" | "soft" = "default") {
  const accent = whiteBlueAccent(page);
  const isBlue = variant === "blue";
  const compact = box.h < 1.25;
  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: isBlue ? "005AA6" : variant === "soft" ? "F8FBFE" : "FFFFFF" },
    line: { color: isBlue ? "005AA6" : "DCE8F2", width: 0.9 },
    radius: 0.2,
    shadow: { type: "outer", color: "B9C8D6", opacity: 0.18, blur: 1.1, angle: 45, distance: 1 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: box.x + 0.22,
    y: box.y + 0.22,
    w: 0.58,
    h: 0.055,
    fill: { color: isBlue ? "FFFFFF" : c(accent) },
    line: { transparency: 100 }
  });
  slide.addText(short(title, 34), {
    x: box.x + 0.22,
    y: box.y + (compact ? 0.34 : 0.42),
    w: box.w - 0.44,
    h: 0.28,
    fontFace,
    fontSize: 10.8,
    bold: true,
    color: isBlue ? "FFFFFF" : c(accent),
    margin: 0
  });
  if (body.trim()) {
    slide.addText(multilineShort(body, box.h > 1.7 ? 240 : compact ? 96 : 120), {
      x: box.x + 0.22,
      y: box.y + (compact ? 0.62 : 0.84),
      w: box.w - 0.44,
      h: Math.max(0.24, box.h - (compact ? 0.7 : 1.02)),
      fontFace,
      fontSize: box.h > 1.7 ? 9.8 : compact ? 8.2 : 8.6,
      color: isBlue ? "EAF5FF" : "1D2B3A",
      fit: "shrink",
      valign: "top",
      margin: 0.02
    });
  }
}

function addWhiteBlueMetric(pptx: PptxInstance, slide: PptxSlide, box: Box, value: string, label: string, note: string, page: number, large = false) {
  const accent = whiteBlueAccent(page);
  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    fill: { color: "005AA6" },
    line: { color: "005AA6", width: 0.8 },
    radius: 0.22,
    shadow: { type: "outer", color: "A9BCCF", opacity: 0.2, blur: 1.2, angle: 45, distance: 1 }
  });
  if (large) {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: box.x + box.w * 0.17,
      y: box.y + box.h * 0.08,
      w: box.w * 0.66,
      h: box.w * 0.66,
      fill: { color: "005AA6", transparency: 100 },
      line: { color: "FFFFFF", transparency: 82, width: 1.1 }
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: box.x + box.w * 0.28,
      y: box.y + box.h * 0.18,
      w: box.w * 0.44,
      h: box.w * 0.44,
      fill: { color: "005AA6", transparency: 100 },
      line: { color: "FFFFFF", transparency: 78, width: 1.1 }
    });
  }
  slide.addText(value, {
    x: box.x + 0.2,
    y: box.y + (large ? 0.82 : 0.18),
    w: box.w - 0.4,
    h: large ? 1.08 : 0.46,
    fontFace,
    fontSize: large ? 55 : 22,
    bold: true,
    color: "FFFFFF",
    align: "center",
    margin: 0
  });
  slide.addText(label, {
    x: box.x + 0.2,
    y: box.y + (large ? 2.02 : 0.72),
    w: box.w - 0.4,
    h: 0.28,
    fontFace,
    fontSize: large ? 12 : 8.5,
    bold: true,
    color: "FFFFFF",
    align: "center",
    margin: 0
  });
  if (note) {
    slide.addShape(pptx.ShapeType.rect, {
      x: box.x + box.w * 0.36,
      y: box.y + box.h - 0.48,
      w: box.w * 0.28,
      h: 0.04,
      fill: { color: "8FC4F0" },
      line: { transparency: 100 }
    });
    slide.addText(short(note, 36), {
      x: box.x + 0.24,
      y: box.y + box.h - 0.34,
      w: box.w - 0.48,
      h: 0.22,
      fontFace,
      fontSize: 8.5,
      bold: true,
      color: "FFFFFF",
      align: "center",
      margin: 0
    });
  } else if (!large) {
    slide.addShape(pptx.ShapeType.rect, {
      x: box.x + 0.22,
      y: box.y + box.h - 0.28,
      w: box.w - 0.44,
      h: 0.04,
      fill: { color: c(accent), transparency: 18 },
      line: { transparency: 100 }
    });
  }
}

function addWhiteBlueTable(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, rows: string[][], page: number) {
  addWhiteBluePanel(pptx, slide, box, title, "", page);
  const tableBox = { x: box.x + 0.22, y: box.y + 0.82, w: box.w - 0.44, h: Math.max(0.4, box.h - 1.02) };
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, Math.max(...rows.map((row) => row.length)));
  const rowH = tableBox.h / rowCount;
  const colW = tableBox.w / colCount;
  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const isHeader = rowIndex === 0;
      const x = tableBox.x + colIndex * colW;
      const y = tableBox.y + rowIndex * rowH;
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: colW,
        h: rowH,
        fill: { color: isHeader ? c(whiteBlueAccent(page)) : rowIndex % 2 === 0 ? "F4F8FC" : "FFFFFF" },
        line: { color: "D7E5F0", width: 0.45 }
      });
      slide.addText(short(row[colIndex] ?? "", 46), {
        x: x + 0.06,
        y: y + 0.06,
        w: Math.max(0.1, colW - 0.12),
        h: Math.max(0.1, rowH - 0.12),
        fontFace,
        fontSize: isHeader ? 8.4 : 7.8,
        bold: isHeader,
        color: isHeader ? "FFFFFF" : "1B2B3A",
        fit: "shrink",
        margin: 0
      });
    }
  });
}

function addWhiteBlueTimeline(pptx: PptxInstance, slide: PptxSlide, box: Box, title: string, items: string[], page: number) {
  addWhiteBluePanel(pptx, slide, box, title, "", page);
  const accent = whiteBlueAccent(page);
  const y = box.y + box.h * 0.56;
  slide.addShape(pptx.ShapeType.line, {
    x: box.x + 0.55,
    y,
    w: box.w - 1.1,
    h: 0,
    line: { color: c(accent), width: 1.6 }
  });
  items.slice(0, 4).forEach((item, index) => {
    const step = items.length <= 1 ? 0 : (box.w - 1.2) / (Math.min(items.length, 4) - 1);
    const x = box.x + 0.47 + step * index;
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y: y - 0.15,
      w: 0.3,
      h: 0.3,
      fill: { color: c(accent) },
      line: { color: "FFFFFF", width: 1 }
    });
    slide.addText(short(item, 38), {
      x: x - 0.42,
      y: y + (index % 2 === 0 ? 0.3 : -0.76),
      w: 1.35,
      h: 0.48,
      fontFace,
      fontSize: 7.4,
      color: "203246",
      fit: "shrink",
      align: "center",
      margin: 0
    });
  });
}

function resolvedSlideLayout(outline: SlideDto, index: number): RecommendedLayout {
  if (index === 0) return "cover";
  return normalizeRecommendedLayout(outline.planJson?.layoutType || outline.recommendedLayout);
}

function renderWhiteBlueSlide(pptx: PptxInstance, slide: PptxSlide, project: ProjectDto, outline: SlideDto, facts: FactDto[], index: number) {
  const page = index + 1;
  const layout = resolvedSlideLayout(outline, index);
  const claim = bestClaim(outline, facts);
  const points = meaningfulPoints(outline, facts, 8);
  const textBag = points.join(" ");
  const hourMetric = textBag.match(/\d+\s*(?:小时|h)/i)?.[0] ?? `${project.pageCount}页`;
  const percentMetric = textBag.match(/\d+\s*%/)?.[0] ?? "可控";
  const dayMetric = textBag.match(/\d+\s*天/)?.[0] ?? "本周";
  const bodies = groupedBodies(outline, facts, 3, 2);

  addWhiteBlueBackdrop(pptx, slide, page);

  if (layout === "cover") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.58,
      y: 0.72,
      w: 6.78,
      h: 3.58,
      fill: { color: "FFFFFF" },
      line: { color: "DCE8F2", width: 0.9 },
      radius: 0.22,
      shadow: { type: "outer", color: "C4D1DE", opacity: 0.16, blur: 1.2, angle: 45, distance: 1 }
    });
    slide.addText(short(project.reportType || "Project Report", 26), {
      x: 1.0,
      y: 1.12,
      w: 2.7,
      h: 0.34,
      fontFace,
      fontSize: 11,
      bold: true,
      color: c(whiteBlueAccent(page)),
      margin: 0
    });
    slide.addText(short(outline.title || project.name, 34), {
      x: 0.98,
      y: 1.7,
      w: 5.7,
      h: 1.0,
      fontFace,
      fontSize: 28,
      bold: true,
      color: "081427",
      fit: "shrink",
      margin: 0
    });
    slide.addText(short(claim, 70), {
      x: 1.02,
      y: 3.06,
      w: 5.6,
      h: 0.42,
      fontFace,
      fontSize: 14,
      bold: true,
      color: "4D5B6C",
      fit: "shrink",
      margin: 0
    });
    addWhiteBlueMetric(pptx, slide, { x: 7.7, y: 0.72, w: 3.35, h: 3.58 }, hourMetric.replace(/\s+/g, ""), "核心指标", "实践重塑", page, true);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 4.58, w: 3.02, h: 1.58 }, "汇报对象", project.audience, page);
    addWhiteBluePanel(pptx, slide, { x: 3.9, y: 4.58, w: 3.02, h: 1.58 }, "汇报重点", project.purpose, page);
    addWhiteBluePanel(pptx, slide, { x: 7.22, y: 4.58, w: 3.02, h: 1.58 }, "页数结构", `${project.pageCount} 页`, page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "toc") {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 4.2, h: 4.2 }, "本篇叙事", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 5.1, y: 1.64, w: 7.3, h: 4.2 }, "章节导航", techBullet(points.slice(0, 7)) || bodyFromPoints(outline, facts, 6), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "statement" || layout === "observation") {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.72, w: 11.82, h: 2.55 }, layout === "statement" ? "核心判断" : "核心洞察", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 4.5, w: 5.75, h: 1.55 }, "支撑一", bodies[0] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBluePanel(pptx, slide, { x: 6.65, y: 4.5, w: 5.75, h: 1.55 }, "支撑二", bodies[1] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "transition") {
    addWhiteBluePanel(pptx, slide, { x: 1.4, y: 2.1, w: 10.5, h: 2.4 }, "章节", outline.title, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 1.4, y: 4.7, w: 10.5, h: 1.2 }, "预告", claim, page, "soft");
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "metrics" || layout === "distribution") {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.85 }, "核心结论", claim, page, "blue");
    addWhiteBlueMetric(pptx, slide, { x: 0.58, y: 2.75, w: 2.7, h: 3.3 }, hourMetric, "指标一", bodies[0] || "", page, true);
    addWhiteBlueMetric(pptx, slide, { x: 3.5, y: 2.75, w: 2.7, h: 3.3 }, percentMetric, "指标二", bodies[1] || "", page, true);
    addWhiteBlueMetric(pptx, slide, { x: 6.42, y: 2.75, w: 2.7, h: 3.3 }, dayMetric, "指标三", bodies[2] || "", page, true);
    addWhiteBluePanel(pptx, slide, { x: 9.34, y: 2.75, w: 3.06, h: 3.3 }, "解读", bodyFromPoints(outline, facts, 4), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "status-cards") {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.72, w: 7.3, h: 1.28 }, "核心结论", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 8.18, y: 1.72, w: 1.46, h: 1.28 }, percentMetric, "总体状态", page, "soft");
    addWhiteBluePanel(pptx, slide, { x: 9.92, y: 1.72, w: 1.46, h: 1.28 }, dayMetric, "关键节点", page, "soft");
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 3.36, w: 3.45, h: 2.46 }, "客户关注", bodies[0] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBluePanel(pptx, slide, { x: 4.38, y: 3.36, w: 3.45, h: 2.46 }, "当前状态", bodies[1] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBluePanel(pptx, slide, { x: 8.18, y: 3.36, w: 3.45, h: 2.46 }, "汇报口径", bodies[2] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "progress-cards") {
    const progressBodies = groupedBodies(outline, facts, 3, 3);
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.9 }, "核心结论", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 3.0, w: 3.55, h: 2.66 }, "进展一", progressBodies[0] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBluePanel(pptx, slide, { x: 4.42, y: 3.0, w: 3.55, h: 2.66 }, "进展二", progressBodies[1] || bodyFromPoints(outline, facts, 2), page);
    addWhiteBluePanel(pptx, slide, { x: 8.26, y: 3.0, w: 2.0, h: 1.18 }, "进度", progressBodies[2] || bodyFromPoints(outline, facts, 1), page);
    addWhiteBlueMetric(pptx, slide, { x: 8.26, y: 4.5, w: 1.58, h: 1.16 }, hourMetric, "稳定性", "", page);
    addWhiteBlueMetric(pptx, slide, { x: 10.14, y: 4.5, w: 1.58, h: 1.16 }, percentMetric, "完成率", "", page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "comparison" || layout === "case-study") {
    const leftTitle = layout === "comparison" ? "对照 A" : "背景与挑战";
    const rightTitle = layout === "comparison" ? "对照 B" : "做法与结果";
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.85 }, "核心结论", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 2.75, w: 5.75, h: 3.3 }, leftTitle, bodies[0] || bodyFromPoints(outline, facts, 3), page);
    addWhiteBluePanel(pptx, slide, { x: 6.65, y: 2.75, w: 5.75, h: 3.3 }, rightTitle, bodies[1] || bodyFromPoints(outline, facts, 3), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "timeline" || layout === "process" || layout === "trend") {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.9 }, "核心结论", claim, page, "blue");
    addWhiteBlueTimeline(pptx, slide, { x: 0.58, y: 3.0, w: 7.35, h: 2.7 }, layout === "trend" ? "阶段节点" : "关键节点", timelineItemsFromSlide(outline, facts), page);
    addWhiteBluePanel(pptx, slide, { x: 8.24, y: 3.0, w: 4.16, h: 2.7 }, layout === "trend" ? "趋势解读" : "推进依据", bodyFromPoints(outline, facts, 4), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "risk-table") {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.9 }, "核心结论", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 3.0, w: 4.5, h: 2.85 }, "风险概览", bodyFromPoints(outline, facts, 4), page);
    addWhiteBlueTable(pptx, slide, { x: 5.42, y: 3.0, w: 6.98, h: 2.85 }, "风险应对矩阵", matrixRowsFromPoints(outline, facts, "risk"), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "action-list" || isActionSlide(outline)) {
    addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.9 }, "核心目标", claim, page, "blue");
    addWhiteBlueTable(pptx, slide, { x: 0.58, y: 3.0, w: 7.58, h: 2.92 }, "行动项执行矩阵", matrixRowsFromPoints(outline, facts, "action"), page);
    addWhiteBluePanel(pptx, slide, { x: 8.48, y: 3.0, w: 3.92, h: 1.28 }, "执行提示", techBullet(planCalloutItems(outline).slice(0, 3)) || bodyFromPoints(outline, facts, 3), page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 8.48, y: 4.64, w: 3.92, h: 1.28 }, "会后跟进", bodyFromPoints(outline, facts, 3), page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  if (layout === "closing") {
    addWhiteBlueTitle(slide, outline.title, "收束", page);
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.8, w: 11.82, h: 2.4 }, "最终结论", claim, page, "blue");
    addWhiteBluePanel(pptx, slide, { x: 0.58, y: 4.45, w: 11.82, h: 1.6 }, "希望对方", bodyFromPoints(outline, facts, 3) || project.purpose, page);
    addWhiteBlueFooter(slide, page);
    return true;
  }

  // generic-cards：主次 Bento，避免完全等权三卡
  addWhiteBlueTitle(slide, outline.title, outline.slideGoal, page);
  addWhiteBluePanel(pptx, slide, { x: 0.58, y: 1.64, w: 11.82, h: 0.9 }, "核心结论", claim, page, "blue");
  addWhiteBluePanel(pptx, slide, { x: 0.58, y: 2.8, w: 7.2, h: 3.05 }, "主焦点", bodies[0] || bodyFromPoints(outline, facts, 3), page);
  addWhiteBluePanel(pptx, slide, { x: 8.05, y: 2.8, w: 4.35, h: 1.42 }, "要点二", bodies[1] || bodyFromPoints(outline, facts, 2), page);
  addWhiteBluePanel(pptx, slide, { x: 8.05, y: 4.43, w: 4.35, h: 1.42 }, "要点三", bodies[2] || bodyFromPoints(outline, facts, 2), page);
  addWhiteBlueFooter(slide, page);
  return true;
}

function renderDarkTechSlide(pptx: PptxInstance, slide: PptxSlide, project: ProjectDto, outline: SlideDto, facts: FactDto[], index: number) {
  const page = index + 1;
  const layout = resolvedSlideLayout(outline, index);
  const claim = bestClaim(outline, facts);
  const points = meaningfulPoints(outline, facts, 8);
  const textBag = points.join(" ");
  const hourMetric = textBag.match(/\d+\s*(?:小时|h)/i)?.[0] ?? `${project.pageCount}页`;
  const percentMetric = textBag.match(/\d+\s*%/)?.[0] ?? "可控";
  const dayMetric = textBag.match(/\d+\s*天/)?.[0] ?? "本周";
  const bodies = groupedBodies(outline, facts, 3, 2);

  addDarkBackdrop(pptx, slide, page);

  if (layout === "cover") {
    addDarkTitle(slide, outline.title || project.name, `汇报对象：${project.audience}`, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.72, w: 7.45, h: 2.05 }, "核心结论", claim, page, "hot");
    addDarkMetric(pptx, slide, { x: 8.28, y: 1.72, w: 1.36, h: 1.02 }, hourMetric, "关键范围", "", page);
    addDarkMetric(pptx, slide, { x: 9.85, y: 1.72, w: 1.36, h: 1.02 }, percentMetric, "进度状态", "", page);
    addDarkMetric(pptx, slide, { x: 11.42, y: 1.72, w: 1.36, h: 1.02 }, dayMetric, "关注节点", "", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 4.08, w: 5.95, h: 1.88 }, "汇报范围", bodyFromPoints(outline, facts, 3), page, "light");
    addDarkPanel(pptx, slide, { x: 6.75, y: 4.08, w: 6.03, h: 1.88 }, "关键关注", factBullets(facts, /风险|确认|延期|计划|资源|节点/, 3) || bodyFromPoints(outline, facts, 3), page, "dark");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "toc") {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.4, w: 4.3, h: 4.5 }, "本篇叙事", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 5.1, y: 1.4, w: 7.7, h: 4.5 }, "章节导航", techBullet(points.slice(0, 7)) || bodyFromPoints(outline, facts, 6), page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "statement" || layout === "observation") {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.5, w: 12.23, h: 2.4 }, layout === "statement" ? "核心判断" : "核心洞察", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 4.15, w: 5.95, h: 1.75 }, "支撑一", bodies[0] || bodyFromPoints(outline, facts, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 6.75, y: 4.15, w: 6.03, h: 1.75 }, "支撑二", bodies[1] || bodyFromPoints(outline, facts, 2), page, "dark");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "transition") {
    addDarkPanel(pptx, slide, { x: 1.2, y: 2.0, w: 10.9, h: 2.3 }, "章节", outline.title, page, "hot");
    addDarkPanel(pptx, slide, { x: 1.2, y: 4.55, w: 10.9, h: 1.2 }, "预告", claim, page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "metrics" || layout === "distribution") {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.34, w: 12.23, h: 0.85 }, "核心结论", claim, page, "hot");
    addDarkMetric(pptx, slide, { x: 0.55, y: 2.45, w: 2.85, h: 3.45 }, hourMetric, "指标一", bodies[0] || "", page);
    addDarkMetric(pptx, slide, { x: 3.6, y: 2.45, w: 2.85, h: 3.45 }, percentMetric, "指标二", bodies[1] || "", page);
    addDarkMetric(pptx, slide, { x: 6.65, y: 2.45, w: 2.85, h: 3.45 }, dayMetric, "指标三", bodies[2] || "", page);
    addDarkPanel(pptx, slide, { x: 9.7, y: 2.45, w: 3.08, h: 3.45 }, "解读", bodyFromPoints(outline, facts, 4), page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "status-cards") {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.34, w: 12.23, h: 0.92 }, "核心结论", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.62, w: 4.05, h: 2.95 }, "客户关注", bodies[0] || bodyFromPoints(outline, facts, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 4.86, y: 2.62, w: 4.05, h: 2.95 }, "当前状态", bodies[1] || bodyFromPoints(outline, facts, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 9.17, y: 2.62, w: 3.61, h: 1.35 }, "汇报口径", bodies[2] || bodyFromPoints(outline, facts, 2), page, "dark");
    addDarkMetric(pptx, slide, { x: 9.17, y: 4.28, w: 1.66, h: 1.28 }, percentMetric, "总体状态", "", page);
    addDarkMetric(pptx, slide, { x: 11.04, y: 4.28, w: 1.74, h: 1.28 }, dayMetric, "关键节点", "", page);
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "progress-cards") {
    const progressBodies = groupedBodies(outline, facts, 3, 3);
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.34, w: 12.23, h: 0.94 }, "核心结论", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.62, w: 3.88, h: 3.26 }, "进展一", progressBodies[0] || bodyFromPoints(outline, facts, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 4.72, y: 2.62, w: 3.88, h: 3.26 }, "进展二", progressBodies[1] || bodyFromPoints(outline, facts, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 8.89, y: 2.62, w: 3.89, h: 1.45 }, "进度指标", progressBodies[2] || bodyFromPoints(outline, facts, 2), page, "light");
    addDarkMetric(pptx, slide, { x: 8.89, y: 4.34, w: 1.92, h: 1.36 }, hourMetric, "稳定性", "", page);
    addDarkMetric(pptx, slide, { x: 11.02, y: 4.34, w: 1.76, h: 1.36 }, percentMetric, "完成率", "", page);
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "comparison" || layout === "case-study") {
    const leftTitle = layout === "comparison" ? "对照 A" : "背景与挑战";
    const rightTitle = layout === "comparison" ? "对照 B" : "做法与结果";
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.34, w: 12.23, h: 0.85 }, "核心结论", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.45, w: 5.95, h: 3.45 }, leftTitle, bodies[0] || bodyFromPoints(outline, facts, 3), page, "light");
    addDarkPanel(pptx, slide, { x: 6.75, y: 2.45, w: 6.03, h: 3.45 }, rightTitle, bodies[1] || bodyFromPoints(outline, facts, 3), page, "dark");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "timeline" || layout === "process" || layout === "trend") {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.34, w: 12.23, h: 0.94 }, "核心结论", claim, page, "hot");
    addDarkTimeline(pptx, slide, { x: 0.55, y: 2.62, w: 7.55, h: 3.25 }, layout === "trend" ? "阶段节点" : "关键节点", timelineItemsFromSlide(outline, facts), page);
    addDarkPanel(pptx, slide, { x: 8.42, y: 2.62, w: 4.36, h: 3.25 }, layout === "trend" ? "趋势解读" : "推进依据", bodyFromPoints(outline, facts, 4), page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "risk-table") {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心结论", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.62, w: 5.2, h: 3.3 }, "风险概览", bodyFromPoints(outline, facts, 4), page, "light");
    addDarkTable(pptx, slide, { x: 6.05, y: 2.62, w: 6.73, h: 3.3 }, "风险应对矩阵", matrixRowsFromPoints(outline, facts, "risk"), page);
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "action-list" || isActionSlide(outline)) {
    addDarkTitle(slide, outline.title, outline.slideGoal, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心目标", claim, page, "hot");
    addDarkTable(pptx, slide, { x: 0.55, y: 2.62, w: 7.88, h: 3.35 }, "行动项执行矩阵", matrixRowsFromPoints(outline, facts, "action"), page);
    const tips = planCalloutItems(outline);
    addDarkPanel(pptx, slide, { x: 8.75, y: 2.62, w: 4.03, h: 1.52 }, "执行提示", techBullet(tips.slice(0, 3)) || bodyFromPoints(outline, facts, 3), page, "dark");
    addDarkPanel(pptx, slide, { x: 8.75, y: 4.48, w: 4.03, h: 1.49 }, "会后跟进", bodyFromPoints(outline, facts, 3), page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (layout === "closing") {
    addDarkTitle(slide, outline.title, "收束", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.7, w: 12.23, h: 2.4 }, "最终结论", claim, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 4.35, w: 12.23, h: 1.55 }, "希望对方", bodyFromPoints(outline, facts, 3) || project.purpose, page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  addDarkTitle(slide, outline.title, outline.slideGoal, page);
  addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心结论", claim, page, "hot");
  addDarkPanel(pptx, slide, { x: 0.55, y: 2.5, w: 7.4, h: 3.4 }, "主焦点", bodies[0] || bodyFromPoints(outline, facts, 3), page, "light");
  addDarkPanel(pptx, slide, { x: 8.2, y: 2.5, w: 4.58, h: 1.55 }, "要点二", bodies[1] || bodyFromPoints(outline, facts, 2), page, "dark");
  addDarkPanel(pptx, slide, { x: 8.2, y: 4.25, w: 4.58, h: 1.65 }, "要点三", bodies[2] || bodyFromPoints(outline, facts, 2), page, "light");
  addDarkFooter(slide, page);
  return true;
}

function renderLegacyDarkTechSlide(pptx: PptxInstance, slide: PptxSlide, project: ProjectDto, outline: SlideDto, facts: FactDto[], index: number) {
  const page = index + 1;
  addDarkBackdrop(pptx, slide, page);

  if (page === 1) {
    addDarkTitle(slide, `${project.name}项目周报`, `汇报对象：${project.audience}`, page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.72, w: 7.45, h: 2.05 }, "核心结论", outline.keyMessage || project.purpose, page, "hot");
    addDarkMetric(pptx, slide, { x: 8.28, y: 1.72, w: 1.36, h: 1.02 }, "72h", "稳定运行", "主屏控制系统测试通过", page);
    addDarkMetric(pptx, slide, { x: 9.85, y: 1.72, w: 1.36, h: 1.02 }, "68%", "施工完成率", "结构与桥架已完成", page);
    addDarkMetric(pptx, slide, { x: 11.42, y: 1.72, w: 1.36, h: 1.02 }, "3天", "素材延迟", "已纳入风险闭环", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 4.08, w: 5.95, h: 1.88 }, "进展信号", factBullets(facts, /进展|完成|通过|认可|68|72/, 3), page, "light");
    addDarkPanel(pptx, slide, { x: 6.75, y: 4.08, w: 6.03, h: 1.88 }, "风险与动作", factBullets(facts, /风险|待确认|延迟|策略|库存/, 3), page, "dark");
    addDarkFooter(slide, page);
    return true;
  }

  if (page === 2) {
    addDarkTitle(slide, "本周核心进展概览", "系统、内容、施工三条线同步推进", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.36, w: 12.23, h: 0.86 }, "核心结论", outline.keyMessage, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.55, w: 3.82, h: 3.28 }, "系统联调", planBlockBullets(outline, /系统|联调/) || factBullets(facts, /联调|72/, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 4.74, y: 2.55, w: 3.82, h: 3.28 }, "内容创作", planBlockBullets(outline, /内容|脚本/) || factBullets(facts, /脚本|场景|认可/, 2), page, "light");
    addDarkPanel(pptx, slide, { x: 8.93, y: 2.55, w: 3.85, h: 1.48 }, "现场施工", "整体施工完成率保持可控", page, "light");
    addDarkMetric(pptx, slide, { x: 8.93, y: 4.34, w: 1.9, h: 1.36 }, "68%", "整体完成率", "弱电桥架与主屏结构安装完成", page);
    addDarkPanel(pptx, slide, { x: 11.02, y: 4.34, w: 1.76, h: 1.36 }, "状态", "按计划推进\n客户认可关键场景", page, "dark");
    addDarkFooter(slide, page);
    return true;
  }

  if (page === 3) {
    addDarkTitle(slide, "项目进度风险管理看板", "聚焦当前主要风险和闭环动作", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心结论", outline.keyMessage, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.62, w: 5.25, h: 3.28 }, "风险概览", planBlockBullets(outline, /风险概览/) || factBullets(facts, /风险|延迟|影响/, 4), page, "light");
    const rows = actionRowsFromPlan(outline);
    addDarkTable(pptx, slide, { x: 6.12, y: 2.62, w: 6.66, h: 3.28 }, "风险应对矩阵", rows.length ? rows : [["应对策略", "关键动作", "预期结果"], ["进度缓冲", "调整测试窗口", "确保联调不受影响"], ["应急补救", "素材替换与复测", "风险闭环"]], page);
    addDarkFooter(slide, page);
    return true;
  }

  if (page === 4) {
    addDarkTitle(slide, "待确认事项与决策需求", "把客户侧确认项变成可推进清单", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心结论", outline.keyMessage, page, "hot");
    addDarkPanel(pptx, slide, { x: 0.55, y: 2.62, w: 6.35, h: 3.3 }, "本周五前待确认事项", planBlockBullets(outline, /确认|事项/) || factBullets(facts, /网络|备件|库存/, 4), page, "light");
    addDarkPanel(pptx, slide, { x: 7.18, y: 2.62, w: 5.6, h: 1.48 }, "关键决策会议", planBlockBullets(outline, /会议|决策/) || "• 协调信息化负责人参会\n• 明确网络策略和库存责任人", page, "dark");
    addDarkPanel(pptx, slide, { x: 7.18, y: 4.44, w: 5.6, h: 1.48 }, "需要客户拍板", "• 远程运维端口开放策略\n• LED 备件库存确认\n• 风险闭环会议时间", page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (page === 5) {
    addDarkTitle(slide, "下周重点工作推进计划", "按时间节点推进评审、替换、复测和确认", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心目标", outline.keyMessage, page, "hot");
    const timeline = blockByTitle(outline, /节点|里程碑|时间/)?.items ?? facts.filter((fact) => /下周|周一|周三|周五|计划/.test(`${fact.category} ${fact.content}`)).slice(0, 4).map((fact) => fact.content);
    addDarkTimeline(pptx, slide, { x: 0.55, y: 2.62, w: 7.78, h: 3.3 }, "关键节点里程碑", timeline, page);
    addDarkPanel(pptx, slide, { x: 8.64, y: 2.62, w: 4.14, h: 3.3 }, "持续跟进事项", planBlockBullets(outline, /持续|跟进/) || factBullets(facts, /网络|备件|库存|风险/, 4), page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  if (page === 6 || isActionSlide(outline)) {
    addDarkTitle(slide, "后续行动计划 (Action Items)", "明确责任方、时间节点与交付动作", page);
    addDarkPanel(pptx, slide, { x: 0.55, y: 1.32, w: 12.23, h: 0.94 }, "核心目标", outline.keyMessage, page, "hot");
    const rows = actionRowsFromPlan(outline);
    addDarkTable(pptx, slide, { x: 0.55, y: 2.62, w: 7.88, h: 3.35 }, "行动项执行矩阵", rows, page);
    const tips = planCalloutItems(outline);
    addDarkPanel(pptx, slide, { x: 8.75, y: 2.62, w: 4.03, h: 1.52 }, "执行提示", techBullet(tips), page, "dark");
    addDarkPanel(pptx, slide, { x: 8.75, y: 4.48, w: 4.03, h: 1.49 }, "会后跟进", "• 对排期冲突即时反馈\n• 按各方时间确认风险闭环会议\n• 输出责任人和完成时间", page, "light");
    addDarkFooter(slide, page);
    return true;
  }

  return false;
}

function renderFallback(pptx: PptxInstance, slide: PptxSlide, project: ProjectDto, outline: SlideDto, facts: FactDto[], index: number) {
  if (index === 0 || outline.recommendedLayout === "cover") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.74,
      y: 0.8,
      w: 11.86,
      h: 5.78,
      fill: { color: "FFFFFF" },
      line: { color: c(deckTokens.line), width: 0.8 },
      radius: 0.18,
      shadow: cardShadow()
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.74,
      y: 0.8,
      w: 0.16,
      h: 5.78,
      fill: { color: c(deckTokens.blue) },
      line: { transparency: 100 }
    });
    slide.addText(short(outline.title || `${project.name} 项目汇报`, 32), {
      x: 1.12,
      y: 1.12,
      w: 9.5,
      h: 0.72,
      fontFace,
      fontSize: 29,
      bold: true,
      color: c(deckTokens.navy),
      margin: 0
    });
    addEditableCard(pptx, slide, { x: 1.12, y: 3.35, w: 4.1, h: 1.28 }, "核心结论", outline.keyMessage || project.purpose, "primary", "hero");
    addEditableCard(pptx, slide, { x: 5.45, y: 3.35, w: 3.35, h: 1.28 }, "汇报对象", project.audience, "default");
    addMetricCard(pptx, slide, { x: 9.22, y: 3.35, w: 2.1, h: 1.28 }, "预计页数", `${project.pageCount}`, "模板兜底", "accent");
    return;
  }

  slide.addText(short(outline.title, 36), {
    x: 0.66,
    y: 0.38,
    w: 9.2,
    h: 0.48,
    fontFace,
    fontSize: 22,
    bold: true,
    color: c(deckTokens.navy),
    margin: 0
  });
  slide.addText(short(outline.slideGoal, 86), {
    x: 0.68,
    y: 0.92,
    w: 10.6,
    h: 0.28,
    fontFace,
    fontSize: 10,
    color: c(deckTokens.muted),
    margin: 0
  });
  addEditableCard(pptx, slide, { x: 0.68, y: 1.34, w: 11.78, h: 0.92 }, "核心结论", outline.keyMessage, "primary", "hero");
  itemsForSlide(outline, facts, 4).forEach((item, itemIndex) => {
    const x = 0.68 + (itemIndex % 2) * 6.0;
    const y = 2.68 + Math.floor(itemIndex / 2) * 1.48;
    addEditableCard(pptx, slide, { x, y, w: 5.72, h: 1.16 }, `要点 ${itemIndex + 1}`, item, itemIndex % 2 === 0 ? "default" : "accent");
  });
}

function degradePathForSlide(outline: SlideDto): "ir" | "theme" {
  return outline.irJson ? "ir" : "theme";
}

function renderThemeOrIrSlide(
  pptx: PptxInstance,
  slide: PptxSlide,
  project: ProjectDto,
  outline: SlideDto,
  linkedFacts: FactDto[],
  index: number,
  exportTheme: PptExportTheme,
  options?: { preferIr?: boolean }
) {
  // IR 优先：有 irJson 时先渲染 IR，避免主题模板永远盖住 IR
  if (options?.preferIr && outline.irJson) {
    slide.background = { color: c(deckTokens.bg) };
    addSlideBackdrop(pptx, slide, index + 1);
    if (renderIrSlide(pptx, slide, outline)) {
      addFooter(pptx, slide, index + 1);
      return;
    }
  }

  const renderedStyled = isDarkExportTheme(exportTheme)
    ? renderDarkTechSlide(pptx, slide, project, outline, linkedFacts, index)
    : renderWhiteBlueSlide(pptx, slide, project, outline, linkedFacts, index);
  if (renderedStyled) {
    return;
  }

  slide.background = { color: c(deckTokens.bg) };
  addSlideBackdrop(pptx, slide, index + 1);

  if (!(isActionSlide(outline) && renderActionSlide(pptx, slide, outline)) && !renderIrSlide(pptx, slide, outline)) {
    renderFallback(pptx, slide, project, outline, linkedFacts, index);
  }

  addFooter(pptx, slide, index + 1);
}

export async function renderProjectPptx(input: RenderProjectPptxInput, outputPath: string): Promise<RenderProjectPptxResult> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const PptxCtor = PptxGenJSDefault as unknown as { new (): PptxInstance };
  const pptx = new PptxCtor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PPT Agent Engine";
  pptx.company = "Internal";
  pptx.subject = input.project.name;
  pptx.title = `${input.project.name} PPT`;
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: fontFace,
    bodyFontFace: fontFace,
    lang: "zh-CN"
  };
  const exportTheme = normalizePptTheme(input.theme ?? input.project.theme);
  const mode: ExportMode = input.mode ?? "standard";
  const svgExportMode = input.svgExportMode ?? "editable";
  const warnings: string[] = [];
  const pageResults: PageRenderResult[] = [];

  input.slides.forEach((outline, index) => {
    const slide = pptx.addSlide();
    const linkedFacts = factsForSlide(outline, input.facts);
    const strategy: RenderStrategy = effectiveRenderStrategy(outline, mode);
    const pageLabel = `第 ${index + 1} 页`;

    // 与网页预览使用同一文字 fit + 换色链路（不改库存原稿）
    const themedSvg = outline.svgPreview
      ? recolorSvgPreview(fitSvgTextToBounds(outline.svgPreview).svg, exportTheme, { accentId: input.accentId })
      : outline.svgPreview;

    // 用户显式选择「图片保真版」时，优先整页嵌入，与页策略解耦。
    if (svgExportMode === "fidelity" && tryRenderSvgImageSlide(slide, themedSvg)) {
      pageResults.push({ slideId: outline.id, strategy, path: "svg-image" });
      return;
    }

    // ir / draft：直接走 IR/主题模板，跳过 SVG 优先
    if (strategy === "ir") {
      let warning: string | undefined;
      if (outline.svgPreview && mode !== "draft") {
        warning = `${pageLabel} 策略为 ir，已跳过 SVG，使用 IR/主题模板导出`;
        warnings.push(warning);
      }
      if (!outline.irJson) {
        warning = `${pageLabel} 策略为 ir 但缺少 irJson，已降级主题模板`;
        warnings.push(warning);
      }
      renderThemeOrIrSlide(pptx, slide, input.project, outline, linkedFacts, index, exportTheme, {
        preferIr: true
      });
      pageResults.push({
        slideId: outline.id,
        strategy,
        path: degradePathForSlide(outline),
        warning
      });
      return;
    }

    // 可编辑版：SVG 拆成 PPT 原生文本/形状。
    if (tryRenderSvgSlide(pptx, slide, themedSvg)) {
      pageResults.push({ slideId: outline.id, strategy, path: "svg" });
      return;
    }

    let warning: string | undefined;
    if (outline.svgPreview) {
      const banned = getBannedSvgFeatures(outline.svgPreview);
      const hasHardTransform = /transform\s*=\s*["'][^"']*(?:matrix|scale\s*\(|rotate\s*\(|skew)/i.test(
        outline.svgPreview
      );
      const reason =
        banned.length > 0
          ? `含禁止特性（${banned.join(", ")}）`
          : hasHardTransform
            ? "含未支持的 transform（matrix/scale/rotate），避免错位导出"
            : "无法转换为足够多的可编辑对象";
      const severity = mode === "visual" && strategy === "svg" ? "严格模式警告" : "已降级";
      warning = `${pageLabel} SVG 编译失败（${reason}），${severity}为 IR/主题模板`;
      warnings.push(warning);
    } else if (strategy === "svg" || strategy === "hybrid") {
      warning = `${pageLabel} 缺少 SVG，已降级为 IR/主题模板`;
      warnings.push(warning);
    }

    renderThemeOrIrSlide(pptx, slide, input.project, outline, linkedFacts, index, exportTheme);
    pageResults.push({
      slideId: outline.id,
      strategy,
      path: degradePathForSlide(outline),
      warning
    });
  });

  await pptx.writeFile({ fileName: outputPath });
  await postprocessEditableSvgGeometry(outputPath);
  return { outputPath, warnings, pageResults };
}
