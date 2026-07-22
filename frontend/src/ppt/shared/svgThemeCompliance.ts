import { getThemePack, normalizePptExportTheme, type PptExportTheme } from "./themePacks.js";

export interface SvgThemeComplianceResult {
  ok: boolean;
  issues: string[];
  themeId: PptExportTheme;
  family: "light" | "dark";
}

function normalizeHex(value: string | undefined): string | null {
  if (!value) return null;
  const short = /^#([0-9a-f]{3})$/i.exec(value.trim());
  if (short?.[1]) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return full?.[1] ? `#${full[1].toUpperCase()}` : null;
}

function luminance(hex: string): number {
  const value = normalizeHex(hex);
  if (!value) return 0.5;
  const channels = [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16) / 255);
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function colorDistance(a: string, b: string): number {
  const left = normalizeHex(a);
  const right = normalizeHex(b);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const channel = (hex: string, start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
  const dr = channel(left, 1) - channel(right, 1);
  const dg = channel(left, 3) - channel(right, 3);
  const db = channel(left, 5) - channel(right, 5);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) {
    if (match[1]) result[match[1].toLowerCase()] = match[2] ?? "";
  }
  return result;
}

function numericSize(value: string | undefined, total: number): number {
  if (!value) return 0;
  if (value.trim().endsWith("%")) {
    const percentage = Number.parseFloat(value);
    return Number.isFinite(percentage) ? (percentage / 100) * total : 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawFillFrom(attrs: Record<string, string>): string | null {
  if (attrs.fill) return attrs.fill.trim();
  return /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(attrs.style ?? "")?.[1]?.trim() ?? null;
}

function gradientColors(svg: string): Map<string, string[]> {
  const gradients = new Map<string, string[]>();
  for (const match of svg.matchAll(/<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const id = attributes(match[2] ?? "").id;
    if (!id) continue;
    const colors: string[] = [];
    for (const stop of (match[3] ?? "").matchAll(/<stop\b[^>]*>/gi)) {
      const stopAttrs = attributes(stop[0]);
      const raw = stopAttrs["stop-color"] ?? /(?:^|;)\s*stop-color\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(stopAttrs.style ?? "")?.[1];
      const color = normalizeHex(raw);
      if (color) colors.push(color);
    }
    if (colors.length > 0) gradients.set(id, colors);
  }
  return gradients;
}

/** 只约束画布级/大面积矩形，避免把深色正文文字误判成深色主题。 */
export function validateSvgThemeCompliance(
  svg: string,
  theme: PptExportTheme | string | null | undefined
): SvgThemeComplianceResult {
  const themeId = normalizePptExportTheme(theme);
  const pack = getThemePack(themeId);
  const issues: string[] = [];
  const allowedCanvas = [pack.tokens.bg, pack.tokens.bgSoft].map((color) => normalizeHex(color) ?? color);
  const gradients = gradientColors(svg);

  for (const match of svg.matchAll(/<rect\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const width = numericSize(attrs.width, 1280);
    const height = numericSize(attrs.height, 720);
    const areaRatio = Math.max(0, width * height) / (1280 * 720);
    if (areaRatio < 0.35) continue;

    const rawFill = rawFillFrom(attrs);
    if (!rawFill || attrs["fill-opacity"] === "0" || attrs.opacity === "0") continue;
    const solid = normalizeHex(rawFill);
    const gradientId = /^url\(\s*#([^\s)]+)\s*\)$/i.exec(rawFill)?.[1];
    const colors = solid ? [solid] : gradientId ? gradients.get(gradientId) ?? [] : [];
    for (const fill of colors) {
      const lightness = luminance(fill);
      if (pack.family === "light" && lightness < 0.62) {
        issues.push(`主题 ${themeId} 是浅色主题，但大面积背景使用了深色 ${fill}`);
      }
      if (pack.family === "dark" && lightness > 0.58) {
        issues.push(`主题 ${themeId} 是深色主题，但大面积背景使用了浅色 ${fill}`);
      }
    }
    if (solid && areaRatio >= 0.9 && Math.min(...allowedCanvas.map((color) => colorDistance(solid, color))) > 48) {
      issues.push(`全画布背景 ${solid} 未采用主题 ${themeId} 的背景 token（${allowedCanvas.join(" / ")}）`);
    }
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)], themeId, family: pack.family };
}
