import {
  SlideIrSchema,
  type Bounds,
  type ChartElement,
  type LineElement,
  type SlideIrDocument,
  type SlideIrElement,
  type TableElement,
  type TextElement
} from "./schema.js";
import { resolveColor } from "./tokens.js";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transparency(value?: number) {
  return value == null ? 1 : Math.max(0, Math.min(1, 1 - value / 100));
}

function elementAttrs(element: SlideIrElement) {
  const opacity = element.opacity == null ? "" : ` opacity="${element.opacity}"`;
  const rotation =
    "bounds" in element && element.rotation
      ? ` transform="rotate(${element.rotation} ${element.bounds[0] + element.bounds[2] / 2} ${element.bounds[1] + element.bounds[3] / 2})"`
      : "";
  return `data-element-id="${escapeXml(element.id)}"${opacity}${rotation}`;
}

function wrapText(text: string, fontSize: number, width: number) {
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const char of text) {
    if (char === "\n") {
      lines.push(current);
      current = "";
      currentWidth = 0;
      continue;
    }
    const charWidth = /[\u2e80-\u9fff]/u.test(char) ? fontSize : fontSize * 0.56;
    if (current && currentWidth + charWidth > width) {
      lines.push(current);
      current = char;
      currentWidth = charWidth;
    } else {
      current += char;
      currentWidth += charWidth;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function textAnchor(align: "left" | "center" | "right" | undefined) {
  if (align === "center") return "middle";
  if (align === "right") return "end";
  return "start";
}

function textX(bounds: Bounds, align: "left" | "center" | "right" | undefined) {
  if (align === "center") return bounds[0] + bounds[2] / 2;
  if (align === "right") return bounds[0] + bounds[2];
  return bounds[0];
}

function renderText(document: SlideIrDocument, element: TextElement) {
  const [x, y, w, h] = element.bounds;
  const lineRows: Array<{
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    color: string;
    italic: boolean;
    underline: boolean;
    align?: "left" | "center" | "right";
    lineHeight: number;
    spaceAfter: number;
  }> = [];
  for (const paragraph of element.paragraphs) {
    const first = paragraph.runs[0]!;
    const text = paragraph.runs.map((run) => run.text).join("");
    const fontSize = first.fontSize;
    for (const line of wrapText(text, fontSize, w)) {
      lineRows.push({
        text: line,
        fontSize,
        fontFamily:
          first.fontFamily ??
          document.theme.fonts?.body ??
          "Arial",
        fontWeight: first.fontWeight ?? 400,
        color: resolveColor(first.color, document),
        italic: first.italic ?? false,
        underline: first.underline ?? false,
        align: paragraph.align,
        lineHeight: fontSize * (paragraph.lineHeight ?? 1.25),
        spaceAfter: paragraph.spaceAfter ?? 0
      });
    }
    const last = lineRows.at(-1);
    if (last) last.spaceAfter = paragraph.spaceAfter ?? 0;
  }
  const contentHeight = lineRows.reduce(
    (sum, row) => sum + row.lineHeight + row.spaceAfter,
    0
  );
  const startY =
    element.verticalAlign === "middle"
      ? y + Math.max(0, (h - contentHeight) / 2)
      : element.verticalAlign === "bottom"
        ? y + Math.max(0, h - contentHeight)
        : y;
  let cursorY = startY;
  const tspans = lineRows.map((row) => {
    cursorY += row.fontSize;
    const markup = `<tspan x="${textX(element.bounds, row.align)}" y="${cursorY}" text-anchor="${textAnchor(row.align)}" font-family="${escapeXml(row.fontFamily)}" font-size="${row.fontSize}" font-weight="${row.fontWeight}" fill="${row.color}"${row.italic ? ' font-style="italic"' : ""}${row.underline ? ' text-decoration="underline"' : ""}>${escapeXml(row.text)}</tspan>`;
    cursorY += row.lineHeight - row.fontSize + row.spaceAfter;
    return markup;
  });
  return `<text ${elementAttrs(element)} x="${x}" y="${y}" data-w="${w}" data-h="${h}">${tspans.join("")}</text>`;
}

function renderLine(document: SlideIrDocument, element: LineElement) {
  const points = element.points.map((point) => point.join(",")).join(" ");
  const color = resolveColor(element.stroke.color, document);
  const dash =
    element.stroke.dash === "dash"
      ? ' stroke-dasharray="12 8"'
      : element.stroke.dash === "dot"
        ? ' stroke-dasharray="3 7"'
        : "";
  const body = `<polyline ${elementAttrs(element)} points="${points}" fill="none" stroke="${color}" stroke-width="${element.stroke.width}" stroke-opacity="${transparency(element.stroke.transparency)}"${dash}/>`;
  const start = element.points[0]!;
  const second = element.points[1]!;
  const end = element.points.at(-1)!;
  const beforeEnd = element.points.at(-2)!;
  return [
    body,
    renderMarker(element.markerStart, start, second, color, element.id, "start"),
    renderMarker(element.markerEnd, end, beforeEnd, color, element.id, "end")
  ].join("");
}

function renderMarker(
  marker: LineElement["markerStart"],
  point: [number, number],
  neighbor: [number, number],
  color: string,
  id: string,
  position: string
) {
  if (!marker || marker === "none") return "";
  if (marker === "circle") {
    return `<circle data-element-id="${escapeXml(id)}-${position}" cx="${point[0]}" cy="${point[1]}" r="6" fill="${color}"/>`;
  }
  const angle = Math.atan2(point[1] - neighbor[1], point[0] - neighbor[0]);
  const length = 14;
  const wing = 6;
  const baseX = point[0] - Math.cos(angle) * length;
  const baseY = point[1] - Math.sin(angle) * length;
  const left = [
    baseX + Math.cos(angle + Math.PI / 2) * wing,
    baseY + Math.sin(angle + Math.PI / 2) * wing
  ];
  const right = [
    baseX + Math.cos(angle - Math.PI / 2) * wing,
    baseY + Math.sin(angle - Math.PI / 2) * wing
  ];
  return `<polygon data-element-id="${escapeXml(id)}-${position}" points="${point[0]},${point[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}" fill="${color}"/>`;
}

function tableColumnWidths(element: TableElement) {
  const total = element.columns.reduce((sum, width) => sum + width, 0);
  return element.columns.map((width) => (width / total) * element.bounds[2]);
}

function renderTable(document: SlideIrDocument, element: TableElement) {
  const [startX, startY, , height] = element.bounds;
  const rowGap = element.rowGap ?? 0;
  const columnGap = element.columnGap ?? 0;
  const widths = tableColumnWidths(element);
  const rowHeight = (height - rowGap * (element.rows.length - 1)) / element.rows.length;
  const borderColor = resolveColor(element.border?.color ?? "$border", document);
  const borderWidth = element.border?.width ?? 1;
  const fragments: string[] = [];
  for (const [rowIndex, row] of element.rows.entries()) {
    let x = startX;
    const y = startY + rowIndex * (rowHeight + rowGap);
    for (const [columnIndex, cell] of row.entries()) {
      const width = (widths[columnIndex] ?? 0) - (columnIndex < row.length - 1 ? columnGap : 0);
      const fill = resolveColor(cell.fill?.color ?? "$surface", document);
      const color = resolveColor(cell.color ?? "$text", document);
      const fontSize = cell.fontSize ?? 17;
      const anchor = textAnchor(cell.align);
      const contentX =
        cell.align === "center"
          ? x + width / 2
          : cell.align === "right"
            ? x + width - 12
            : x + 12;
      fragments.push(
        `<rect x="${x}" y="${y}" width="${width}" height="${rowHeight}" fill="${fill}" fill-opacity="${transparency(cell.fill?.transparency)}" stroke="${borderColor}" stroke-width="${borderWidth}"/>`,
        `<text x="${contentX}" y="${y + rowHeight / 2 + fontSize * 0.35}" data-w="${Math.max(0, width - 24)}" data-h="${rowHeight}" text-anchor="${anchor}" font-family="${escapeXml(document.theme.fonts?.body ?? "Arial")}" font-size="${fontSize}" font-weight="${cell.fontWeight ?? 400}" fill="${color}">${escapeXml(cell.text)}</text>`
      );
      x += widths[columnIndex] ?? 0;
    }
  }
  return `<g ${elementAttrs(element)}>${fragments.join("")}</g>`;
}

const DEFAULT_CHART_COLORS = [
  "$primary",
  "$accent",
  "$success",
  "$warning",
  "$danger"
] as const;

function chartColor(
  document: SlideIrDocument,
  element: ChartElement,
  index: number
) {
  return resolveColor(
    element.series[index]?.color ??
      DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length]!,
    document
  );
}

function renderChart(document: SlideIrDocument, element: ChartElement) {
  const [x, y, w, h] = element.bounds;
  const top = y + (element.title ? 36 : 12);
  const chartHeight = h - (element.showLegend ? 44 : 20) - (element.title ? 36 : 0);
  const fragments: string[] = [];
  if (element.title) {
    fragments.push(
      `<text x="${x}" y="${y + 24}" data-w="${w}" data-h="30" font-family="${escapeXml(document.theme.fonts?.heading ?? "Arial")}" font-size="20" font-weight="700" fill="${resolveColor("$text", document)}">${escapeXml(element.title)}</text>`
    );
  }

  if (element.chartType === "bar") {
    const allValues = element.series.flatMap((series) => series.values);
    const max = Math.max(1, ...allValues.map((value) => Math.abs(value)));
    const groupWidth = w / element.categories.length;
    const barWidth = Math.min(
      42,
      (groupWidth * 0.72) / Math.max(1, element.series.length)
    );
    for (const [seriesIndex, series] of element.series.entries()) {
      const color = chartColor(document, element, seriesIndex);
      series.values.forEach((value, categoryIndex) => {
        const barHeight = (Math.abs(value) / max) * Math.max(10, chartHeight - 36);
        const barX =
          x +
          categoryIndex * groupWidth +
          (groupWidth - barWidth * element.series.length) / 2 +
          seriesIndex * barWidth;
        const barY = top + chartHeight - 24 - barHeight;
        fragments.push(
          `<rect x="${barX}" y="${barY}" width="${Math.max(4, barWidth - 4)}" height="${barHeight}" rx="4" fill="${color}"/>`
        );
        if (element.showValues) {
          fragments.push(
            `<text x="${barX + (barWidth - 4) / 2}" y="${barY - 6}" text-anchor="middle" font-size="12" fill="${resolveColor("$muted", document)}">${value}</text>`
          );
        }
      });
    }
  } else if (element.chartType === "line") {
    const allValues = element.series.flatMap((series) => series.values);
    const min = Math.min(0, ...allValues);
    const max = Math.max(1, ...allValues);
    const range = Math.max(1, max - min);
    for (const [seriesIndex, series] of element.series.entries()) {
      const color = chartColor(document, element, seriesIndex);
      const points = series.values.map((value, index) => [
        x + 18 + (index * (w - 36)) / Math.max(1, series.values.length - 1),
        top + chartHeight - 24 - ((value - min) / range) * (chartHeight - 48)
      ]);
      fragments.push(
        `<polyline points="${points.map((point) => point.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="3"/>`
      );
      for (const point of points) {
        fragments.push(
          `<circle cx="${point[0]}" cy="${point[1]}" r="5" fill="${color}"/>`
        );
      }
    }
  } else {
    const values = element.series[0]!.values.map((value) => Math.max(0, value));
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const cx = x + w / 2;
    const cy = top + chartHeight / 2;
    const radius = Math.max(10, Math.min(w, chartHeight) * 0.36);
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const nextAngle = angle + (value / total) * Math.PI * 2;
      const start = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
      const end = [
        cx + Math.cos(nextAngle) * radius,
        cy + Math.sin(nextAngle) * radius
      ];
      const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
      const innerRadius = element.chartType === "doughnut" ? radius * 0.56 : 0;
      let d = `M ${cx} ${cy} L ${start[0]} ${start[1]} A ${radius} ${radius} 0 ${largeArc} 1 ${end[0]} ${end[1]} Z`;
      if (innerRadius > 0) {
        const innerEnd = [
          cx + Math.cos(nextAngle) * innerRadius,
          cy + Math.sin(nextAngle) * innerRadius
        ];
        const innerStart = [
          cx + Math.cos(angle) * innerRadius,
          cy + Math.sin(angle) * innerRadius
        ];
        d = `M ${start[0]} ${start[1]} A ${radius} ${radius} 0 ${largeArc} 1 ${end[0]} ${end[1]} L ${innerEnd[0]} ${innerEnd[1]} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart[0]} ${innerStart[1]} Z`;
      }
      fragments.push(
        `<path d="${d}" fill="${chartColor(document, element, index)}"/>`
      );
      angle = nextAngle;
    });
  }

  if (element.showLegend) {
    const legendY = y + h - 22;
    element.series.forEach((series, index) => {
      const legendX = x + index * Math.min(150, w / element.series.length);
      fragments.push(
        `<rect x="${legendX}" y="${legendY - 11}" width="12" height="12" rx="3" fill="${chartColor(document, element, index)}"/>`,
        `<text x="${legendX + 18}" y="${legendY}" font-size="13" fill="${resolveColor("$muted", document)}">${escapeXml(series.name)}</text>`
      );
    });
  }
  return `<g ${elementAttrs(element)}>${fragments.join("")}</g>`;
}

function renderElement(document: SlideIrDocument, element: SlideIrElement) {
  if (element.type === "text") return renderText(document, element);
  if (element.type === "line") return renderLine(document, element);
  if (element.type === "table") return renderTable(document, element);
  if (element.type === "chart") return renderChart(document, element);

  const [x, y, w, h] = element.bounds;
  if (element.type === "shape") {
    const fill = element.fill
      ? resolveColor(element.fill.color, document)
      : "none";
    const stroke = element.stroke
      ? resolveColor(element.stroke.color, document)
      : "none";
    if (element.shape === "ellipse") {
      return `<ellipse ${elementAttrs(element)} cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" fill-opacity="${transparency(element.fill?.transparency)}" stroke="${stroke}" stroke-width="${element.stroke?.width ?? 0}"/>`;
    }
    const radius =
      element.shape === "roundRect"
        ? Math.min(element.radius ?? 18, w / 2, h / 2)
        : 0;
    return `<rect ${elementAttrs(element)} x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" fill-opacity="${transparency(element.fill?.transparency)}" stroke="${stroke}" stroke-width="${element.stroke?.width ?? 0}"/>`;
  }

  if (element.source.kind === "data") {
    const preserveAspectRatio =
      element.fit === "stretch"
        ? "none"
        : element.fit === "cover"
          ? "xMidYMid slice"
          : "xMidYMid meet";
    return `<image ${elementAttrs(element)} x="${x}" y="${y}" width="${w}" height="${h}" href="${escapeXml(element.source.value)}" preserveAspectRatio="${preserveAspectRatio}"/>`;
  }
  return `<g ${elementAttrs(element)}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${resolveColor("$surfaceAlt", document)}" stroke="${resolveColor("$border", document)}"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-family="${escapeXml(document.theme.fonts?.body ?? "Arial")}" font-size="16" fill="${resolveColor("$muted", document)}">${escapeXml(element.alt ?? "图片素材")}</text></g>`;
}

export function renderSlideIrToSvg(input: SlideIrDocument): string {
  const document = SlideIrSchema.parse(input);
  const background = resolveColor(document.background.color, document);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${document.canvas.width} ${document.canvas.height}" width="${document.canvas.width}" height="${document.canvas.height}"><rect data-element-id="background" width="${document.canvas.width}" height="${document.canvas.height}" fill="${background}"/>${document.elements.map((element) => renderElement(document, element)).join("")}</svg>`;
}

