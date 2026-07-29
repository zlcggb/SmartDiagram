import { SlideIrSchema, type Bounds, type LineElement, type SlideIrDocument, type TextElement } from "./schema.js";
import { collectColorReferences } from "./tokens.js";

export type SlideIrIssueSeverity = "error" | "warning";

export interface SlideIrIssue {
  severity: SlideIrIssueSeverity;
  code: string;
  path: string;
  message: string;
  elementId?: string;
}

export interface SlideIrValidationResult {
  ok: boolean;
  issues: SlideIrIssue[];
}

function issue(
  severity: SlideIrIssueSeverity,
  code: string,
  path: string,
  message: string,
  elementId?: string
): SlideIrIssue {
  return { severity, code, path, message, elementId };
}

function boundsInsideCanvas(bounds: Bounds, width: number, height: number) {
  const [x, y, w, h] = bounds;
  return x >= 0 && y >= 0 && x + w <= width && y + h <= height;
}

function pointInsideCanvas(point: [number, number], width: number, height: number) {
  return point[0] >= 0 && point[1] >= 0 && point[0] <= width && point[1] <= height;
}

export function estimateTextElementHeight(element: TextElement) {
  const width = Math.max(1, element.bounds[2]);
  let height = 0;
  for (const paragraph of element.paragraphs) {
    const fontSize = Math.max(...paragraph.runs.map((run) => run.fontSize));
    const text = paragraph.runs.map((run) => run.text).join("");
    const approximateWidth = [...text].reduce(
      (sum, char) => sum + (/[\u2e80-\u9fff]/u.test(char) ? fontSize : fontSize * 0.56),
      0
    );
    const lines = Math.max(1, Math.ceil(approximateWidth / width));
    height += lines * fontSize * (paragraph.lineHeight ?? 1.25);
    height += paragraph.spaceAfter ?? 0;
  }
  return height;
}

function pointInBounds(point: [number, number], bounds: Bounds) {
  const [x, y, w, h] = bounds;
  return point[0] >= x && point[0] <= x + w && point[1] >= y && point[1] <= y + h;
}

function orientation(
  a: [number, number],
  b: [number, number],
  c: [number, number]
) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 <= 0 && o3 * o4 <= 0;
}

function segmentIntersectsBounds(
  start: [number, number],
  end: [number, number],
  bounds: Bounds
) {
  if (pointInBounds(start, bounds) || pointInBounds(end, bounds)) return true;
  const [x, y, w, h] = bounds;
  const topLeft: [number, number] = [x, y];
  const topRight: [number, number] = [x + w, y];
  const bottomRight: [number, number] = [x + w, y + h];
  const bottomLeft: [number, number] = [x, y + h];
  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function lineCrossesText(line: LineElement, text: TextElement) {
  for (let index = 0; index < line.points.length - 1; index += 1) {
    const start = line.points[index];
    const end = line.points[index + 1];
    if (start && end && segmentIntersectsBounds(start, end, text.bounds)) {
      return true;
    }
  }
  return false;
}

export function validateSlideIr(input: unknown): SlideIrValidationResult {
  const parsed = SlideIrSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((zodIssue) =>
        issue(
          "error",
          "schema",
          zodIssue.path.join(".") || "root",
          zodIssue.message
        )
      )
    };
  }

  const document = parsed.data;
  const issues: SlideIrIssue[] = [];
  const ids = new Set<string>();
  for (const [index, element] of document.elements.entries()) {
    const path = `elements.${index}`;
    if (ids.has(element.id)) {
      issues.push(
        issue(
          "error",
          "duplicate-element-id",
          `${path}.id`,
          `元素 id「${element.id}」重复`,
          element.id
        )
      );
    }
    ids.add(element.id);

    if ("bounds" in element) {
      if (!boundsInsideCanvas(element.bounds, document.canvas.width, document.canvas.height)) {
        issues.push(
          issue(
            "error",
            "out-of-bounds",
            `${path}.bounds`,
            `元素「${element.id}」超出 1280×720 画布`,
            element.id
          )
        );
      }
    } else if (
      element.points.some(
        (point) => !pointInsideCanvas(point, document.canvas.width, document.canvas.height)
      )
    ) {
      issues.push(
        issue(
          "error",
          "out-of-bounds",
          `${path}.points`,
          `线条「${element.id}」端点超出画布`,
          element.id
        )
      );
    }

    if (element.type === "text") {
      const estimatedHeight = estimateTextElementHeight(element);
      if (estimatedHeight > element.bounds[3] * 1.08) {
        issues.push(
          issue(
            element.autoFit === "shrink" ? "warning" : "error",
            "text-overflow",
            `${path}.paragraphs`,
            `文本估算高度 ${Math.ceil(estimatedHeight)} 超过文本框 ${element.bounds[3]}`,
            element.id
          )
        );
      }
      const minFontSize = Math.min(
        ...element.paragraphs.flatMap((paragraph) =>
          paragraph.runs.map((run) => run.fontSize)
        )
      );
      if (minFontSize < 14) {
        issues.push(
          issue(
            "warning",
            "small-text",
            `${path}.paragraphs`,
            `元素「${element.id}」字号 ${minFontSize} 偏小`,
            element.id
          )
        );
      }
    }

    if (
      element.type === "table" &&
      element.rows.some((row) => row.length !== element.columns.length)
    ) {
      issues.push(
        issue(
          "error",
          "table-column-mismatch",
          `${path}.rows`,
          `表格「${element.id}」行列数与 columns 不一致`,
          element.id
        )
      );
    }

    if (
      element.type === "chart" &&
      element.series.some((series) => series.values.length !== element.categories.length)
    ) {
      issues.push(
        issue(
          "error",
          "chart-data-mismatch",
          `${path}.series`,
          `图表「${element.id}」序列长度与 categories 不一致`,
          element.id
        )
      );
    }
  }

  for (const reference of collectColorReferences(document)) {
    if (!document.theme.tokens[reference.slice(1)]) {
      issues.push(
        issue(
          "error",
          "unknown-token",
          "theme.tokens",
          `颜色引用 ${reference} 未定义`
        )
      );
    }
  }

  const textElements = document.elements.filter(
    (element): element is TextElement => element.type === "text"
  );
  const lineElements = document.elements.filter(
    (element): element is LineElement => element.type === "line"
  );
  for (const line of lineElements) {
    for (const text of textElements) {
      if (lineCrossesText(line, text)) {
        issues.push(
          issue(
            "warning",
            "connector-crosses-text",
            `elements.${document.elements.indexOf(line)}.points`,
            `线条「${line.id}」穿过文字框「${text.id}」`,
            line.id
          )
        );
      }
    }
  }

  return {
    ok: !issues.some((entry) => entry.severity === "error"),
    issues
  };
}
