export interface FocusBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SvgTextCandidate {
  id: string;
  text: string;
  box: FocusBox;
}

export interface FocusTargetInput {
  anchors: string[];
  targetTextIds: string[];
  mode: "text" | "container";
  allowEdge?: boolean;
}

export interface FocusResolution {
  status: "resolved" | "rejected";
  box?: FocusBox;
  matchedCandidateIds?: string[];
  score?: number;
  qa?: {
    selectedTextCoverage: number;
    tightness: number;
    unrelatedTextIds: string[];
  };
  rejectionReasons?: string[];
}

interface Translate {
  x: number;
  y: number;
}

function attributes(source: string) {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (match[1]) result[match[1]] = match[2] ?? match[3] ?? "";
  }
  return result;
}

function numeric(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function translate(transform: string | undefined): Translate {
  const total = { x: 0, y: 0 };
  if (!transform) return total;
  for (const match of transform.matchAll(/translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)/g)) {
    total.x += Number(match[1] ?? 0);
    total.y += Number(match[2] ?? 0);
  }
  return total;
}

function decodeCodePoint(raw: string, radix: number) {
  const value = Number.parseInt(raw, radix);
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}

function decodeXml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => decodeCodePoint(code, 16))
    .replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(code, 10));
}

function visibleText(inner: string) {
  return decodeXml(
    inner
      .replace(/<\/tspan\s*>\s*<tspan\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function parseViewBox(svg: string): FocusBox {
  const svgTag = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const attrs = attributes(svgTag);
  const values = attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (values?.length === 4 && values.every(Number.isFinite) && values[2]! > 0 && values[3]! > 0) {
    return { x: values[0]!, y: values[1]!, w: values[2]!, h: values[3]! };
  }
  return {
    x: 0,
    y: 0,
    w: numeric(attrs.width) ?? 1280,
    h: numeric(attrs.height) ?? 720
  };
}

/** Extract only text with renderer-authored geometry. Never infer width from character count. */
export function extractSvgTextCandidates(svg: string) {
  const candidates: SvgTextCandidate[] = [];
  const stack: Translate[] = [{ x: 0, y: 0 }];
  const tokens = svg.matchAll(/<g\b[^>]*>|<\/g\s*>|<text\b[^>]*>[\s\S]*?<\/text\s*>/gi);

  for (const token of tokens) {
    const source = token[0];
    if (/^<\/g/i.test(source)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (/^<g\b/i.test(source)) {
      const parent = stack.at(-1)!;
      const local = translate(attributes(source).transform);
      stack.push({ x: parent.x + local.x, y: parent.y + local.y });
      continue;
    }

    const open = source.match(/^<text\b([^>]*)>/i);
    if (!open) continue;
    const attrs = attributes(open[1] ?? "");
    const firstTspan = source.match(/<tspan\b([^>]*)>/i);
    const tspanAttrs = firstTspan ? attributes(firstTspan[1] ?? "") : {};
    const width = numeric(attrs["data-w"]);
    const height = numeric(attrs["data-h"]);
    const rawX = numeric(attrs.x) ?? numeric(tspanAttrs.x);
    const rawY = numeric(attrs.y) ?? numeric(tspanAttrs.y);
    if (width === null || height === null || rawX === null || rawY === null || width <= 0 || height <= 0) continue;

    const parent = stack.at(-1)!;
    const local = translate(attrs.transform);
    const baselineX = rawX + parent.x + local.x;
    const baselineY = rawY + parent.y + local.y;
    const fontSize = numeric(attrs["font-size"]) ?? numeric(tspanAttrs["font-size"]) ?? 16;
    const anchor = attrs["text-anchor"] ?? tspanAttrs["text-anchor"] ?? "start";
    const x = anchor === "middle" ? baselineX - width / 2 : anchor === "end" ? baselineX - width : baselineX;
    const text = visibleText(source.replace(/^<text\b[^>]*>/i, "").replace(/<\/text\s*>$/i, ""));
    if (!text) continue;
    candidates.push({
      id: attrs.id?.trim() || `text-${candidates.length + 1}`,
      text,
      box: { x, y: baselineY - fontSize * 1.1, w: width, h: height }
    });
  }

  return { viewBox: parseViewBox(svg), candidates };
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function grams(value: string) {
  const normalizedValue = normalized(value);
  if (normalizedValue.length < 2) return new Set(normalizedValue ? [normalizedValue] : []);
  return new Set(Array.from({ length: normalizedValue.length - 1 }, (_, index) => normalizedValue.slice(index, index + 2)));
}

function semanticScore(anchor: string, candidate: string) {
  const left = normalized(anchor);
  const right = normalized(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const a = grams(left);
  const b = grams(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function unionBox(boxes: FocusBox[]): FocusBox {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

function area(box: FocusBox) {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function intersectionArea(left: FocusBox, right: FocusBox) {
  return Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
}

export function resolveFocusTarget(
  target: FocusTargetInput,
  candidates: SvgTextCandidate[],
  options: {
    viewBox?: FocusBox;
    padding?: number;
    minScore?: number;
    ambiguityDelta?: number;
    minCoverage?: number;
    minTightness?: number;
  } = {}
): FocusResolution {
  if (target.mode === "container") {
    return {
      status: "rejected",
      rejectionReasons: ["container_geometry_unavailable"]
    };
  }
  const minScore = options.minScore ?? 0.58;
  const ambiguityDelta = options.ambiguityDelta ?? 0.05;
  const minCoverage = options.minCoverage ?? 0.98;
  const minTightness = options.minTightness ?? 0.35;
  const padding = Math.max(0, options.padding ?? 10);
  const viewBox = options.viewBox ?? { x: 0, y: 0, w: 1280, h: 720 };
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const explicit = [...new Set(target.targetTextIds)].flatMap((id) => byId.get(id) ?? []);
  const explicitScores = explicit.map((candidate) => ({
    candidate,
    score: Math.max(0, ...target.anchors.map((anchor) => semanticScore(anchor, candidate.text)))
  }));
  let selected = explicitScores.filter((entry) => entry.score >= minScore).map(({ candidate }) => candidate);
  let score = explicitScores.length ? Math.min(...explicitScores.map((entry) => entry.score)) : 0;
  const rejectionReasons: string[] = [];

  if (explicit.length && selected.length !== explicit.length) {
    rejectionReasons.push("explicit_id_anchor_mismatch");
  }

  if (!explicit.length) {
    const ranked = candidates
      .map((candidate) => ({ candidate, score: Math.max(0, ...target.anchors.map((anchor) => semanticScore(anchor, candidate.text))) }))
      .sort((left, right) => right.score - left.score);
    score = ranked[0]?.score ?? 0;
    if (score < minScore) rejectionReasons.push("match_score_below_minimum");
    if (ranked[1] && score >= minScore && score - ranked[1].score < ambiguityDelta) rejectionReasons.push("ambiguous_match");
    if (!rejectionReasons.length && ranked[0]) selected = [ranked[0].candidate];
  }

  if (!selected.length || rejectionReasons.length) {
    return { status: "rejected", score, rejectionReasons: rejectionReasons.length ? rejectionReasons : ["no_matching_text"] };
  }

  const selectedUnion = unionBox(selected.map(({ box }) => box));
  const box = {
    x: selectedUnion.x - padding,
    y: selectedUnion.y - padding,
    w: selectedUnion.w + padding * 2,
    h: selectedUnion.h + padding * 2
  };
  const selectedArea = selected.reduce((sum, candidate) => sum + area(candidate.box), 0);
  const selectedTextCoverage = selectedArea
    ? selected.reduce((sum, candidate) => sum + intersectionArea(box, candidate.box), 0) / selectedArea
    : 0;
  const tightness = area(box) ? Math.min(1, selectedArea / area(box)) : 0;
  const selectedIds = new Set(selected.map(({ id }) => id));
  const unrelatedTextIds = target.mode === "text"
    ? candidates
        .filter((candidate) => !selectedIds.has(candidate.id) && area(candidate.box) > 0)
        .filter((candidate) => intersectionArea(box, candidate.box) / area(candidate.box) >= 0.5)
        .map(({ id }) => id)
    : [];

  if (selectedTextCoverage < minCoverage) rejectionReasons.push("coverage_below_minimum");
  if (tightness < minTightness) rejectionReasons.push("tightness_below_minimum");
  const right = viewBox.x + viewBox.w;
  const bottom = viewBox.y + viewBox.h;
  if (!target.allowEdge && (box.x <= viewBox.x || box.y <= viewBox.y || box.x + box.w >= right || box.y + box.h >= bottom)) {
    rejectionReasons.push("touches_slide_edge");
  }
  if (unrelatedTextIds.length) rejectionReasons.push("contains_unrelated_text");

  const qa = { selectedTextCoverage, tightness, unrelatedTextIds };
  if (rejectionReasons.length) return { status: "rejected", box, matchedCandidateIds: [...selectedIds], score, qa, rejectionReasons };
  return { status: "resolved", box, matchedCandidateIds: [...selectedIds], score, qa };
}
