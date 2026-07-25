import {
  getAccentPresetHex,
  getThemePack,
  normalizeAccentPresetId,
  normalizePptExportTheme,
  pptExportThemes,
  type PptExportTheme
} from "./themePacks.js";

/** 与 pptExportThemes 对齐 */
export type RecolorTheme = PptExportTheme;

/** 角色色：用于主题间近似换色（非 AI 重生成） */
export type ThemeColorRole =
  | "bg"
  | "bgSoft"
  | "card"
  | "title"
  | "body"
  | "muted"
  | "accent"
  | "accentAlt"
  | "border"
  | "onAccent";

type ThemePalette = Record<ThemeColorRole, string>;

function paletteFromPack(theme: RecolorTheme, accentOverrideHex?: string | null): ThemePalette {
  const t = getThemePack(theme).tokens;
  const accent = accentOverrideHex?.trim() || t.primary;
  return {
    bg: t.bg,
    bgSoft: t.bgSoft,
    card: t.card,
    title: t.title,
    body: t.body,
    muted: t.muted,
    accent,
    accentAlt: t.accentAlt,
    border: t.border,
    onAccent: t.onAccent
  };
}

/** AI/Tailwind 常见漂移色：企业蓝大色块经常写死这些，不在 token 精确列表里 */
const COMMON_ACCENT_DRIFT = [
  "#003F7D",
  "#0B4F8C",
  "#0B66C3",
  "#1E3A8A",
  "#1E40AF",
  "#1D4ED8",
  "#2563EB",
  "#3B82F6",
  "#0284C7",
  "#0369A1",
  "#0EA5E9",
  "#38BDF8"
];

const COMMON_LIGHT_BG_DRIFT = [
  "#FAFBFC",
  "#F8FAFC",
  "#F9FAFB",
  "#F7FAFC",
  "#F5F7FA",
  "#EEF2F6",
  "#F1F5F9"
];

/** 提示词 / mock 里常见的同角色别名，便于命中 AI 写死的色值 */
const paletteAliases: Record<RecolorTheme, Partial<Record<ThemeColorRole, string[]>>> = {
  "white-blue": {
    bg: ["#EEF6FB", "#F4F7FB", "#EAF4FF", "#F7FAFC", "#EDF6FB", ...COMMON_LIGHT_BG_DRIFT],
    bgSoft: ["#F3F8FC", "#F5F9FC"],
    card: ["#FFFFFF", "#FEFEFE"],
    title: ["#071426", "#14202B", "#021D3A", "#0F172A", "#111827"],
    body: ["#25313C", "#3E536A", "#667085", "#334155"],
    muted: ["#667085", "#94A3B8"],
    accent: ["#005AA6", "#0066CC", "#0B66C3", "#00A6D6", ...COMMON_ACCENT_DRIFT],
    accentAlt: ["#0066CC", "#0B66C3", "#6D5DF6", "#00A6D6"],
    border: ["#D8E6F2", "#D9E8F2", "#D9E2EC", "#D7E2EF", "#E2E8F0"],
    onAccent: ["#FFFFFF"]
  },
  "soft-product": {
    bg: ["#F5F7FA", "#EEF2F6", "#F8FAFC", ...COMMON_LIGHT_BG_DRIFT],
    bgSoft: ["#EEF2F6", "#E8EEF4"],
    card: ["#FFFFFF"],
    title: ["#1A2332", "#1E293B", "#0F172A"],
    body: ["#3D4A5C", "#475569"],
    muted: ["#6B7A8D", "#94A3B8"],
    accent: ["#3B82A0", "#5B8FA8", "#2C3E50", ...COMMON_ACCENT_DRIFT],
    accentAlt: ["#7C9A6E", "#B07D62"],
    border: ["#D5DEE8", "#CBD5E1"],
    onAccent: ["#FFFFFF"]
  },
  "blue-black": {
    bg: ["#071C33", "#06111F", "#071A2E", "#021D3A", "#0A1628"],
    bgSoft: ["#06111F", "#04101C"],
    card: ["#0E2A47", "#0C2440", "#102F4F", "#1E3A5F"],
    title: ["#EAF6FF", "#F0F9FF", "#FFFFFF"],
    body: ["#C9E7F6", "#B8D9EC", "#D7EEF8"],
    muted: ["#9FC4D9", "#7FA8C0"],
    accent: ["#18D6FF", "#00A8FF", "#22D3EE", "#38BDF8"],
    accentAlt: ["#00A8FF", "#38BDF8"],
    border: ["#1D5F91", "#164E78", "#1E3A5F"],
    onAccent: ["#FFFFFF", "#071C33"]
  },
  "code-surface": {
    bg: ["#0D1117", "#161B22", "#010409"],
    bgSoft: ["#161B22", "#21262D"],
    card: ["#21262D", "#30363D"],
    title: ["#E6EDF3", "#FFFFFF"],
    body: ["#C9D1D9", "#ADBAC7"],
    muted: ["#8B949E", "#6E7681"],
    accent: ["#3FB950", "#58A6FF", "#2EA043"],
    accentAlt: ["#58A6FF", "#F78166", "#A371F7"],
    border: ["#30363D", "#21262D"],
    onAccent: ["#0D1117", "#FFFFFF"]
  },
  "glass-brand": {
    bg: ["#F7FBFA", "#EEF8F5", "#F0FDFA", ...COMMON_LIGHT_BG_DRIFT],
    bgSoft: ["#EEF8F5", "#CCFBF1"],
    card: ["#FFFFFF"],
    title: ["#1B2B28", "#134E4A", "#0F172A"],
    body: ["#3A4F4A", "#475569"],
    muted: ["#6B837C", "#94A3B8"],
    accent: ["#0D9488", "#14B8A6", "#0F766E", "#2DD4BF"],
    accentAlt: ["#F472B6", "#0EA5E9"],
    border: ["#CDE8E1", "#99F6E4"],
    onAccent: ["#FFFFFF"]
  },
  "chart-report": {
    bg: ["#F8FAFC", "#F1F5F9", ...COMMON_LIGHT_BG_DRIFT],
    bgSoft: ["#F1F5F9", "#E2E8F0"],
    card: ["#FFFFFF", "#FEFEFE"],
    title: ["#0F172A", "#1E293B"],
    body: ["#334155", "#475569"],
    muted: ["#64748B"],
    accent: ["#2563EB", "#3B82F6", "#1D4ED8", "#0EA5E9", ...COMMON_ACCENT_DRIFT],
    accentAlt: ["#059669", "#0EA5E9"],
    border: ["#E2E8F0", "#CBD5E1"],
    onAccent: ["#FFFFFF"]
  },
  "deep-strategy": {
    bg: ["#0B0F14", "#111827", "#030712"],
    bgSoft: ["#111827", "#1F2937"],
    card: ["#1A2332", "#1F2937"],
    title: ["#F8FAFC", "#FFFFFF"],
    body: ["#CBD5E1", "#E2E8F0"],
    muted: ["#94A3B8", "#64748B"],
    accent: ["#F59E0B", "#FBBF24", "#D97706"],
    accentAlt: ["#38BDF8", "#0EA5E9"],
    border: ["#334155", "#475569"],
    onAccent: ["#0B0F14", "#111827"]
  },
  "cold-research": {
    bg: ["#F4F6F8", "#F8FAFC", "#EEF1F4"],
    bgSoft: ["#EEF1F4", "#E2E8F0"],
    card: ["#FFFFFF"],
    title: ["#0F172A", "#1E293B"],
    body: ["#334155", "#475569"],
    muted: ["#64748B", "#94A3B8"],
    accent: ["#0F766E", "#115E59", "#0D9488"],
    accentAlt: ["#0EA5E9", "#0284C7"],
    border: ["#CBD5E1", "#E2E8F0"],
    onAccent: ["#FFFFFF"]
  },
  "black-gold": {
    bg: ["#FBFAF4", "#EFEFF6", "#1B160F", "#15110C"],
    bgSoft: ["#EFEFF6", "#E7E6EE", "#251E14", "#1E1810"],
    card: ["#FFFFFF", "#FEFEFE", "#33291C", "#292116"],
    title: ["#16150F", "#100F0A", "#1B160F"],
    body: ["#2A2820", "#221F18", "#E8DDC9"],
    muted: ["#77746A", "#BCB9C9", "#B8A98E"],
    accent: ["#E2E62A", "#ECEF35", "#F4F66C", "#F2E70C", "#C9A45E", "#E8C97A"],
    accentAlt: ["#B9A8E8", "#8FB7FF", "#70E7D2", "#FF4D97", "#A98545"],
    border: ["#DEDCEA", "#E7E6EE", "#6B5838", "#5C4B31"],
    onAccent: ["#16150F", "#100F0A", "#1A1207"]
  },
  "magazine-navy": {
    bg: ["#0C1B33", "#132743", "#0A1628"],
    bgSoft: ["#132743", "#1A3358"],
    card: ["#1A3358", "#23406A"],
    title: ["#F4F7FB", "#FFFFFF"],
    body: ["#C5D0E0", "#E2E8F0"],
    muted: ["#8FA0B8", "#94A3B8"],
    accent: ["#E8D5B5", "#F0E0C0", "#7EB8D4"],
    accentAlt: ["#7EB8D4", "#E07A5F"],
    border: ["#2A4468", "#334155"],
    onAccent: ["#0C1B33"]
  },
  "gold-index": {
    bg: ["#1C2740", "#0D0E11", "#13161D", "#201A10", "#17130D"],
    bgSoft: ["#33405C", "#16181D", "#2A2215", "#211B12"],
    card: ["#2B3650", "#191B1F", "#392F1F", "#2B2418"],
    title: ["#F2F3F6", "#F4F4F2", "#FFF8E8", "#FFFFFF"],
    body: ["#D5D8DE", "#CDCECB", "#E9DEC8", "#E7E5E4"],
    muted: ["#9AA0A8", "#7E8694", "#B9AA90", "#A8A29E"],
    accent: ["#D7A85B", "#E6C878", "#B5852F", "#D1A74F", "#F0CB73"],
    accentAlt: ["#6F9BD8", "#5479E8", "#5B80EA", "#B68A48", "#5B8DEF"],
    border: ["#59657C", "#3B3F45", "#78643F", "#3A3F4B"],
    onAccent: ["#101216", "#0D0E11", "#1B1308"]
  },
  "growth-energy": {
    bg: ["#FFF8F5", "#FFF7ED", "#FFF1EB"],
    bgSoft: ["#FFF1EB", "#FFEDD5"],
    card: ["#FFFFFF"],
    title: ["#1C1917", "#292524"],
    body: ["#44403C", "#57534E"],
    muted: ["#78716C", "#A8A29E"],
    accent: ["#EA580C", "#F97316", "#C2410C"],
    accentAlt: ["#0891B2", "#0E7490"],
    border: ["#FED7AA", "#FDBA74"],
    onAccent: ["#FFFFFF"]
  }
};

function normalizeHex(raw: string): string | null {
  const value = raw.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short?.[1]) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  if (full?.[1]) return `#${full[1].toUpperCase()}`;
  return null;
}

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: Number.parseInt(n.slice(1, 3), 16),
    g: Number.parseInt(n.slice(3, 5), 16),
    b: Number.parseInt(n.slice(5, 7), 16)
  };
}

function luminance(hex: string): number {
  const rgb = parseRgb(hex);
  if (!rgb) return 0.5;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** 相对饱和度 0–1，用于把「品牌色块」与灰阶文字分开 */
function saturation(hex: string): number {
  const rgb = parseRgb(hex);
  if (!rgb) return 0;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function colorDistance(a: string, b: string): number {
  const ra = parseRgb(a);
  const rb = parseRgb(b);
  if (!ra || !rb) return Number.POSITIVE_INFINITY;
  const dr = ra.r - rb.r;
  const dg = ra.g - rb.g;
  const db = ra.b - rb.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function paletteFor(theme: RecolorTheme, accentOverrideHex?: string | null): ThemePalette {
  return paletteFromPack(theme, accentOverrideHex);
}

function roleSwatches(theme: RecolorTheme): Array<{ role: ThemeColorRole; hex: string }> {
  const base = paletteFor(theme);
  const aliases = paletteAliases[theme];
  const items: Array<{ role: ThemeColorRole; hex: string }> = [];
  (Object.keys(base) as ThemeColorRole[]).forEach((role) => {
    items.push({ role, hex: base[role] });
    for (const alt of aliases[role] ?? []) {
      const n = normalizeHex(alt);
      if (n) items.push({ role, hex: n });
    }
  });
  return items;
}

/** 全主题色票：避免「只按误判的 sourceTheme 匹配」导致大色块漏换 */
let globalSwatchesCache: Array<{ role: ThemeColorRole; hex: string; theme: RecolorTheme }> | null = null;

function globalRoleSwatches(): Array<{ role: ThemeColorRole; hex: string; theme: RecolorTheme }> {
  if (globalSwatchesCache) return globalSwatchesCache;
  const items: Array<{ role: ThemeColorRole; hex: string; theme: RecolorTheme }> = [];
  for (const theme of pptExportThemes) {
    for (const swatch of roleSwatches(theme)) {
      items.push({ ...swatch, theme });
    }
  }
  globalSwatchesCache = items;
  return items;
}

function extractSvgHexColors(svg: string): string[] {
  const found: string[] = [];
  const re = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const hex = normalizeHex(m[0]);
    if (hex) found.push(hex);
  }
  return found;
}

/**
 * 从 SVG 推断生成时主题：背景 + 全色投票，避免纯白底误判成 chart-report/glass。
 */
export function detectSvgTheme(svg: string): RecolorTheme {
  const bgMatch =
    svg.match(/<rect[^>]*\bwidth=["']1280["'][^>]*\bheight=["']720["'][^>]*\bfill=["']([^"']+)["']/i) ??
    svg.match(/<rect[^>]*\bheight=["']720["'][^>]*\bwidth=["']1280["'][^>]*\bfill=["']([^"']+)["']/i) ??
    svg.match(/<svg[^>]*>\s*<rect[^>]*\bfill=["']([^"']+)["']/i);

  const scores = new Map<RecolorTheme, number>();
  const bump = (theme: RecolorTheme, weight: number) => {
    scores.set(theme, (scores.get(theme) ?? 0) + weight);
  };

  const fill = bgMatch?.[1] ? normalizeHex(bgMatch[1]) : null;
  if (fill) {
    let bestBg: { theme: RecolorTheme; d: number } | null = null;
    for (const theme of pptExportThemes) {
      const d = colorDistance(fill, paletteFor(theme).bg);
      if (!bestBg || d < bestBg.d) bestBg = { theme, d };
    }
    if (bestBg && bestBg.d < 72) bump(bestBg.theme, 4);
    else bump(luminance(fill) < 0.35 ? "blue-black" : "white-blue", 2);
  }

  for (const hex of extractSvgHexColors(svg)) {
    let best: { theme: RecolorTheme; d: number } | null = null;
    for (const swatch of globalRoleSwatches()) {
      const d = colorDistance(hex, swatch.hex);
      if (!best || d < best.d) best = { theme: swatch.theme, d };
    }
    if (best && best.d <= 40) bump(best.theme, 1);
  }

  let winner: RecolorTheme = "white-blue";
  let top = -1;
  for (const theme of pptExportThemes) {
    const s = scores.get(theme) ?? 0;
    if (s > top) {
      top = s;
      winner = theme;
    }
  }
  return top > 0 ? winner : fill && luminance(fill) < 0.35 ? "blue-black" : "white-blue";
}

function closestRoleInTheme(hex: string, theme: RecolorTheme, maxDistance: number): ThemeColorRole | null {
  let best: { role: ThemeColorRole; d: number } | null = null;
  for (const swatch of roleSwatches(theme)) {
    const d = colorDistance(hex, swatch.hex);
    if (!best || d < best.d) best = { role: swatch.role, d };
  }
  if (!best || best.d > maxDistance) return null;
  return best.role;
}

/**
 * 跨主题角色分类：先全库近邻，再按亮度/饱和度启发式兜底。
 * 解决 AI 自由蓝（如 #1E3A8A）在 sourceTheme 色板里匹配失败、换色「假生效」。
 */
function classifyHexToRole(hex: string, preferredSource?: RecolorTheme | null): ThemeColorRole | null {
  if (preferredSource) {
    const fromSource = closestRoleInTheme(hex, preferredSource, 64);
    if (fromSource) return fromSource;
  }

  let best: { role: ThemeColorRole; d: number } | null = null;
  for (const swatch of globalRoleSwatches()) {
    const d = colorDistance(hex, swatch.hex);
    if (!best || d < best.d) best = { role: swatch.role, d };
  }
  if (best && best.d <= 64) return best.role;

  const lum = luminance(hex);
  const sat = saturation(hex);

  // 纯白在启发式里偏 bg；真正替换时由 mapHexToTarget 按目标族分流
  if (lum >= 0.97 && sat < 0.08) return "bg";
  if (lum >= 0.93 && sat < 0.12) return "card";
  if (lum >= 0.82 && sat < 0.22) return "bg";

  // 深色画布 vs 深品牌色块
  if (lum < 0.12) return sat < 0.45 ? "bg" : "accent";
  if (lum < 0.28 && sat >= 0.35) return "accent";

  // 中高饱和 → 强调色（用户眼中的「大色块」）
  if (sat >= 0.28 && lum > 0.1 && lum < 0.88) {
    if (best && best.d <= 110 && best.role === "accentAlt") return "accentAlt";
    return "accent";
  }

  // 灰阶文字
  if (sat < 0.22) {
    if (lum < 0.28) return "title";
    if (lum < 0.5) return "body";
    if (lum < 0.72) return "muted";
    return "border";
  }

  return best && best.d <= 110 ? best.role : "accent";
}

function mapHexToTarget(
  hex: string,
  target: RecolorTheme,
  targetPalette: ThemePalette,
  preferredSource?: RecolorTheme | null
): string {
  // 纯白：跨主题换色中主要来自浅色卡片；深色目标应映射为 card，否则会与背景合并。
  if (hex === "#FFFFFF" || hex === "#FEFEFE") {
    return getThemePack(target).family === "dark" ? targetPalette.card : targetPalette.bg;
  }
  const role = classifyHexToRole(hex, preferredSource);
  if (!role) return hex;
  return targetPalette[role];
}

export interface RecolorOptions {
  /** accent 预设 id；会覆盖目标主题的 primary 角色色 */
  accentId?: string | null;
  /** 直接指定 accent hex（优先于 accentId） */
  accentHex?: string | null;
}

/**
 * 将 SVG 内硬编码色值近似映射到目标主题色板。
 * 真正改写 fill/stroke 等处的 #hex（非 CSS filter）；预览与导出共用。
 */
export function recolorSvgPreview(
  svg: string,
  targetTheme: RecolorTheme | string,
  options?: RecolorOptions
): string {
  if (!svg.trim()) return svg;
  const target = normalizePptExportTheme(targetTheme);
  const accentHex =
    options?.accentHex?.trim() ||
    (options?.accentId ? getAccentPresetHex(target, normalizeAccentPresetId(target, options.accentId)) : null);
  const sourceTheme = detectSvgTheme(svg);
  const targetPalette = paletteFor(target, accentHex);
  const defaultPrimary = normalizeHex(getThemePack(target).tokens.primary);
  const overrideAccent = accentHex ? normalizeHex(accentHex) : null;

  // 同主题仅换 accent：凡判定为 accent 角色的色（含 AI 漂移蓝）一律换成预设
  if (sourceTheme === target) {
    if (!overrideAccent || (defaultPrimary && overrideAccent === defaultPrimary)) return svg;
    return svg.replace(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi, (raw) => {
      const hex = normalizeHex(raw);
      if (!hex) return raw;
      if (hex === "#FFFFFF" || hex === "#FEFEFE") return raw;
      const role = classifyHexToRole(hex, sourceTheme);
      if (role === "accent") return overrideAccent;
      return raw;
    });
  }

  return svg.replace(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi, (raw) => {
    const hex = normalizeHex(raw);
    if (!hex) return raw;
    return mapHexToTarget(hex, target, targetPalette, sourceTheme);
  });
}
