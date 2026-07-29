import {
  SlideIrSchema,
  type ChartElement,
  type LineElement,
  type SlideIrDocument,
  type Stroke,
  type TableElement,
  type TextElement
} from "./schema.js";
import { resolveColor } from "./tokens.js";
import { validateSlideIr, type SlideIrIssue } from "./validate.js";

const PX_PER_INCH = 96;

export interface SlideIrPptxInstance {
  ShapeType: Record<"rect" | "roundRect" | "ellipse" | "line", string>;
  ChartType?: Partial<Record<"bar" | "line" | "pie" | "doughnut", string>>;
}

export interface SlideIrPptxSlide {
  background?: { color: string };
  addShape: (shapeType: string, options: Record<string, unknown>) => void;
  addText: (
    text: string | Array<{ text: string; options?: Record<string, unknown> }>,
    options: Record<string, unknown>
  ) => void;
  addImage: (options: Record<string, unknown>) => void;
  addTable?: (rows: unknown[][], options: Record<string, unknown>) => void;
  addChart?: (
    chartType: string,
    series: Array<{ name: string; labels: string[]; values: number[] }>,
    options: Record<string, unknown>
  ) => void;
}

export interface SlideIrPptxCompileResult {
  ok: boolean;
  rendered: number;
  issues: SlideIrIssue[];
  warnings: string[];
}

function c(value: string) {
  return value.replace(/^#/, "");
}

function inches(value: number) {
  return value / PX_PER_INCH;
}

function box(bounds: [number, number, number, number]) {
  return {
    x: inches(bounds[0]),
    y: inches(bounds[1]),
    w: inches(bounds[2]),
    h: inches(bounds[3])
  };
}

function transparency(value?: number) {
  return value == null ? 0 : Math.max(0, Math.min(100, value));
}

function lineOptions(document: SlideIrDocument, stroke?: Stroke) {
  return stroke
    ? {
        color: c(resolveColor(stroke.color, document)),
        width: Math.max(0.25, stroke.width * 0.75),
        transparency: transparency(stroke.transparency),
        dash: stroke.dash === "dash" ? "dash" : stroke.dash === "dot" ? "dot" : "solid"
      }
    : { transparency: 100 };
}

function compileText(
  slide: SlideIrPptxSlide,
  document: SlideIrDocument,
  element: TextElement
) {
  const runs: Array<{ text: string; options?: Record<string, unknown> }> = [];
  for (const [paragraphIndex, paragraph] of element.paragraphs.entries()) {
    for (const [runIndex, run] of paragraph.runs.entries()) {
      runs.push({
        text: run.text,
        options: {
          fontFace:
            run.fontFamily ??
            document.theme.fonts?.body ??
            "Arial",
          fontSize: run.fontSize * 0.75,
          bold: (run.fontWeight ?? 400) >= 600,
          italic: run.italic,
          underline: run.underline ? { style: "sng" } : undefined,
          color: c(resolveColor(run.color, document)),
          charSpacing: run.letterSpacing,
          breakLine:
            runIndex === paragraph.runs.length - 1 &&
            paragraphIndex < element.paragraphs.length - 1
        }
      });
    }
  }
  const firstParagraph = element.paragraphs[0];
  slide.addText(runs, {
    ...box(element.bounds),
    margin: 0,
    rotate: element.rotation,
    transparency:
      element.opacity == null
        ? 0
        : Math.round((1 - element.opacity) * 100),
    valign:
      element.verticalAlign === "middle"
        ? "mid"
        : element.verticalAlign === "bottom"
          ? "bottom"
          : "top",
    align: firstParagraph?.align ?? "left",
    breakLine: false,
    fit: element.autoFit === "clip" ? "resize" : "shrink",
    objectName: `SmartSlide text ${element.id}`
  });
}

function compileLine(
  pptx: SlideIrPptxInstance,
  slide: SlideIrPptxSlide,
  document: SlideIrDocument,
  element: LineElement
) {
  for (let index = 0; index < element.points.length - 1; index += 1) {
    const start = element.points[index]!;
    const end = element.points[index + 1]!;
    slide.addShape(pptx.ShapeType.line, {
      x: inches(start[0]),
      y: inches(start[1]),
      w: inches(end[0] - start[0]),
      h: inches(end[1] - start[1]),
      line: {
        ...lineOptions(document, element.stroke),
        beginArrowType:
          index === 0 && element.markerStart === "arrow"
            ? "triangle"
            : index === 0 && element.markerStart === "circle"
              ? "oval"
              : "none",
        endArrowType:
          index === element.points.length - 2 && element.markerEnd === "arrow"
            ? "triangle"
            : index === element.points.length - 2 && element.markerEnd === "circle"
              ? "oval"
              : "none"
      },
      objectName: `SmartSlide line ${element.id}-${index + 1}`
    });
  }
}

function compileTable(
  slide: SlideIrPptxSlide,
  document: SlideIrDocument,
  element: TableElement,
  warnings: string[]
) {
  if (!slide.addTable) {
    warnings.push(`表格「${element.id}」：当前 PPTX 运行时不支持 addTable`);
    return false;
  }
  const rows = element.rows.map((row) =>
    row.map((cell) => ({
      text: cell.text,
      options: {
        fill: cell.fill
          ? {
              color: c(resolveColor(cell.fill.color, document)),
              transparency: transparency(cell.fill.transparency)
            }
          : undefined,
        color: c(resolveColor(cell.color ?? "$text", document)),
        fontSize: (cell.fontSize ?? 17) * 0.75,
        bold: (cell.fontWeight ?? 400) >= 600,
        align: cell.align ?? "left",
        margin: 0.08
      }
    }))
  );
  const total = element.columns.reduce((sum, value) => sum + value, 0);
  slide.addTable(rows, {
    ...box(element.bounds),
    colW: element.columns.map(
      (width) => inches((width / total) * element.bounds[2])
    ),
    border: lineOptions(document, element.border),
    fill: { color: c(resolveColor("$surface", document)) },
    color: c(resolveColor("$text", document)),
    fontFace: document.theme.fonts?.body ?? "Arial",
    fontSize: 12,
    margin: 0.08,
    objectName: `SmartSlide table ${element.id}`
  });
  return true;
}

function compileChart(
  pptx: SlideIrPptxInstance,
  slide: SlideIrPptxSlide,
  document: SlideIrDocument,
  element: ChartElement,
  warnings: string[]
) {
  if (!slide.addChart || !pptx.ChartType?.[element.chartType]) {
    warnings.push(`图表「${element.id}」：当前 PPTX 运行时不支持 ${element.chartType}`);
    return false;
  }
  slide.addChart(
    pptx.ChartType[element.chartType]!,
    element.series.map((series) => ({
      name: series.name,
      labels: element.categories,
      values: series.values
    })),
    {
      ...box(element.bounds),
      showLegend: element.showLegend ?? false,
      showValue: element.showValues ?? false,
      showTitle: Boolean(element.title),
      title: element.title,
      chartColors: element.series.map((series, index) =>
        c(
          resolveColor(
            series.color ??
              (["$primary", "$accent", "$success", "$warning", "$danger"][
                index % 5
              ] as `\$${string}`),
            document
          )
        )
      ),
      showCatName: false,
      showSerName: false,
      showPercent: element.chartType === "pie" || element.chartType === "doughnut",
      catAxisLabelFontFace: document.theme.fonts?.body ?? "Arial",
      valAxisLabelFontFace: document.theme.fonts?.body ?? "Arial",
      objectName: `SmartSlide chart ${element.id}`
    }
  );
  return true;
}

export function compileSlideIrToPptx(
  pptx: SlideIrPptxInstance,
  slide: SlideIrPptxSlide,
  input: SlideIrDocument
): SlideIrPptxCompileResult {
  const parsed = SlideIrSchema.safeParse(input);
  if (!parsed.success) {
    const validation = validateSlideIr(input);
    return {
      ok: false,
      rendered: 0,
      issues: validation.issues,
      warnings: []
    };
  }
  const document = parsed.data;
  const validation = validateSlideIr(document);
  if (!validation.ok) {
    return {
      ok: false,
      rendered: 0,
      issues: validation.issues,
      warnings: []
    };
  }

  const warnings: string[] = [];
  let rendered = 0;
  slide.background = { color: c(resolveColor(document.background.color, document)) };
  for (const element of document.elements) {
    if (element.type === "text") {
      compileText(slide, document, element);
      rendered += 1;
      continue;
    }
    if (element.type === "shape") {
      const shapeType =
        element.shape === "ellipse"
          ? pptx.ShapeType.ellipse
          : element.shape === "roundRect"
            ? pptx.ShapeType.roundRect
            : pptx.ShapeType.rect;
      slide.addShape(shapeType, {
        ...box(element.bounds),
        rotate: element.rotation,
        fill: element.fill
          ? {
              color: c(resolveColor(element.fill.color, document)),
              transparency: transparency(element.fill.transparency)
            }
          : { color: "FFFFFF", transparency: 100 },
        line: lineOptions(document, element.stroke),
        radius: element.radius ? inches(element.radius) : undefined,
        objectName: `SmartSlide shape ${element.id}`
      });
      rendered += 1;
      continue;
    }
    if (element.type === "line") {
      compileLine(pptx, slide, document, element);
      rendered += element.points.length - 1;
      continue;
    }
    if (element.type === "image") {
      if (element.source.kind === "asset") {
        warnings.push(`图片「${element.id}」尚未解析资产 ${element.source.value}`);
        continue;
      }
      slide.addImage({
        ...(element.source.kind === "data"
          ? { data: element.source.value }
          : { path: element.source.value }),
        ...box(element.bounds),
        sizing: element.fit ?? "contain",
        altText: element.alt,
        objectName: `SmartSlide image ${element.id}`
      });
      rendered += 1;
      continue;
    }
    if (element.type === "table") {
      if (compileTable(slide, document, element, warnings)) rendered += 1;
      continue;
    }
    if (compileChart(pptx, slide, document, element, warnings)) rendered += 1;
  }
  return {
    ok: rendered > 0,
    rendered,
    issues: validation.issues,
    warnings
  };
}

