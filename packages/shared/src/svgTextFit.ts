export type SvgTextFitResult = {
  svg: string;
  adjustedTextCount: number;
};

const TEXT_TAG_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
const SVG_CONTENT_TAG_RE = /<(\/?)g\b([^>]*)>|<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
const TSPAN_TAG_RE = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi;
const CANVAS_SAFE_MARGIN_X = 32;
const MIN_AUTO_FIT_FONT_SIZE = 12;

function numericAttr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${name}=["'](-?\\d+(?:\\.\\d+)?)["']`, "i"));
  return match ? Number(match[1]) : null;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Browser SVG text does not wrap at data-w by itself. Estimate the visual width
 * closely enough to decide when generated copy must be turned into tspans.
 */
function estimatedTextWidth(value: string, fontSize: number) {
  let units = 0;
  for (const char of Array.from(value)) {
    if (/\s/u.test(char)) units += 0.32;
    else if (/[\u0000-\u00ff]/u.test(char)) units += /[A-ZMW@#%]/u.test(char) ? 0.72 : 0.56;
    else if (/[，。；：、！？（）《》【】“”‘’]/u.test(char)) units += 0.58;
    else units += 1;
  }
  return units * fontSize;
}

function splitTokens(value: string) {
  return value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[A-Za-z0-9_./+:#-]+|\s+|./gu) ?? [];
}

function plainText(value: string) {
  return decodeXmlText(value.replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim();
}

function textLines(inner: string) {
  const spans = [...inner.matchAll(TSPAN_TAG_RE)];
  if (spans.length === 0) return [plainText(inner)].filter(Boolean);

  const lines: string[] = [];
  let activeY: number | null = null;
  for (const [index, span] of spans.entries()) {
    const attrs = span[1] ?? "";
    const value = plainText(span[2] ?? "");
    if (!value) continue;
    const dy = numericAttr(attrs, "dy");
    const y = numericAttr(attrs, "y");
    const yChanged =
      y !== null &&
      index > 0 &&
      (activeY === null || Math.abs(y - activeY) > 0.5);
    // x only resets the horizontal cursor; dy=0 also stays on the same baseline.
    // Counting either as a new row creates false height-overflow failures for
    // inline "label + body" tspans.
    const explicitLineStart = index === 0 || (dy !== null && dy > 0.5) || yChanged;
    if (explicitLineStart || lines.length === 0) lines.push(value);
    else lines[lines.length - 1] = `${lines[lines.length - 1]}${value}`;
    if (y !== null) activeY = y;
    else if (dy !== null && activeY !== null) activeY += dy;
  }
  return lines;
}

function translateAttr(attrs: string) {
  const match = attrs.match(/\btransform=["']\s*translate\(\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*\)\s*["']/i);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

function wrapText(value: string, maxWidth: number, fontSize: number) {
  const lines: string[] = [];
  let current = "";
  const tokens = splitTokens(value.trim());

  for (const token of tokens) {
    const candidate = `${current}${token}`;
    if (current && estimatedTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current.trimEnd());
      current = "";
    }

    const nextToken = token.trimStart();
    if (estimatedTextWidth(nextToken, fontSize) <= maxWidth) {
      current = nextToken;
      continue;
    }

    const oversizedToken = Array.from(nextToken);
    for (const char of oversizedToken) {
      const charCandidate = `${current}${char}`;
      if (!current || estimatedTextWidth(charCandidate, fontSize) <= maxWidth) {
        current = charCandidate;
      } else {
        lines.push(current.trimEnd());
        current = char.trimStart();
      }
    }
  }

  if (current || lines.length === 0) lines.push(current.trim());
  return lines;
}

function addAutoFitMarker(attrs: string) {
  return /\bdata-auto-fit=/i.test(attrs) ? attrs : `${attrs} data-auto-fit="wrap"`;
}

function setNumericAttr(attrs: string, name: string, value: number) {
  const formatted = Number(value.toFixed(2)).toString();
  const pattern = new RegExp(`\\b${name}=(["'])-?\\d+(?:\\.\\d+)?\\1`, "i");
  if (pattern.test(attrs)) return attrs.replace(pattern, `${name}="${formatted}"`);
  return `${attrs} ${name}="${formatted}"`;
}

function estimatedTextHeight(lineCount: number, fontSize: number) {
  if (lineCount <= 0) return 0;
  return fontSize * 1.1 + Math.max(0, lineCount - 1) * fontSize * 1.28;
}

/**
 * Converts overflowing single-node SVG text into explicit tspans. data-w and
 * data-h are already part of the generation contract and become real preview
 * constraints here instead of export-only metadata.
 */
export function fitSvgTextToBounds(svg: string): SvgTextFitResult {
  let adjustedTextCount = 0;
  const fitted = svg.replace(TEXT_TAG_RE, (full, attrs: string, inner: string) => {
    const dataW = numericAttr(attrs, "data-w");
    const dataH = numericAttr(attrs, "data-h");
    const fontSize = numericAttr(attrs, "font-size") ?? 18;
    const x = numericAttr(attrs, "x");
    if (!dataW || !dataH || x === null || dataW <= 0 || dataH <= 0 || fontSize <= 0) return full;

    const sourceLines = textLines(inner);
    const hasOverflow =
      sourceLines.some((line) => estimatedTextWidth(line, fontSize) > dataW) ||
      estimatedTextHeight(sourceLines.length, fontSize) > dataH;
    if (!hasOverflow) return full;

    const plain = plainText(inner);
    if (!plain) return full;

    const minimumFontSize = Math.min(fontSize, MIN_AUTO_FIT_FONT_SIZE);
    let fittedFontSize = fontSize;
    let lines = wrapText(plain, dataW, fittedFontSize);
    for (let candidate = Math.floor(fontSize); candidate >= minimumFontSize; candidate -= 1) {
      const candidateLines = wrapText(plain, dataW, candidate);
      fittedFontSize = candidate;
      lines = candidateLines;
      if (
        candidateLines.every((line) => estimatedTextWidth(line, candidate) <= dataW * 1.02) &&
        estimatedTextHeight(candidateLines.length, candidate) <= dataH
      ) {
        break;
      }
    }

    const lineHeight = fittedFontSize * 1.28;
    const nextAttrs = addAutoFitMarker(setNumericAttr(attrs, "font-size", fittedFontSize));
    adjustedTextCount += 1;

    if (lines.length === 1) {
      return `<text${nextAttrs}>${escapeXmlText(lines[0] ?? "")}</text>`;
    }

    const tspans = lines
      .map((line, index) => {
        const dy = index === 0 ? 0 : Number(lineHeight.toFixed(2));
        return `<tspan x="${x}" dy="${dy}">${escapeXmlText(line)}</tspan>`;
      })
      .join("");
    return `<text${nextAttrs}>${tspans}</text>`;
  });

  return { svg: fitted, adjustedTextCount };
}

/** Quality-gate issues for the text-box contract used by preview and PPT export. */
export function getSvgTextBoxIssues(svg: string) {
  const issues: string[] = [];
  let index = 0;
  const transforms = [{ x: 0, y: 0 }];
  for (const match of svg.matchAll(SVG_CONTENT_TAG_RE)) {
    if (match[1] !== undefined) {
      if (match[1] === "/") {
        if (transforms.length > 1) transforms.pop();
      } else {
        const parent = transforms[transforms.length - 1] ?? { x: 0, y: 0 };
        const own = translateAttr(match[2] ?? "");
        transforms.push({ x: parent.x + own.x, y: parent.y + own.y });
      }
      continue;
    }

    index += 1;
    const attrs = match[3] ?? "";
    const inner = match[4] ?? "";
    const dataW = numericAttr(attrs, "data-w");
    const dataH = numericAttr(attrs, "data-h");
    if (dataW === null || dataH === null) {
      issues.push(`第 ${index} 个 text 缺少 data-w/data-h`);
    } else if (dataW <= 0 || dataH <= 0) {
      issues.push(`第 ${index} 个 text 的 data-w/data-h 必须大于 0`);
    } else {
      const fontSize = numericAttr(attrs, "font-size") ?? 18;
      const lines = textLines(inner);
      if (lines.some((line) => estimatedTextWidth(line, fontSize) > dataW * 1.02)) {
        issues.push(`第 ${index} 个 text 同一行内容超过 data-w`);
      }
      if (estimatedTextHeight(lines.length, fontSize) > dataH * 1.02) {
        issues.push(`第 ${index} 个 text 内容高度超过 data-h`);
      }

      const x = numericAttr(attrs, "x");
      if (x !== null) {
        const transform = transforms[transforms.length - 1] ?? { x: 0, y: 0 };
        const anchor = attrs.match(/\btext-anchor=["'](start|middle|end)["']/i)?.[1] ?? "start";
        const anchoredLeft = anchor === "middle" ? x - dataW / 2 : anchor === "end" ? x - dataW : x;
        const left = transform.x + anchoredLeft;
        const right = left + dataW;
        if (left < CANVAS_SAFE_MARGIN_X || right > 1280 - CANVAS_SAFE_MARGIN_X) {
          issues.push(`第 ${index} 个 text 超出画布横向安全区（${Math.round(left)}-${Math.round(right)}）`);
        }
      }
    }
  }
  return issues;
}
