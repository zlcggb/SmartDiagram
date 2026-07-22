/**
 * 自研 ThemePack（概念对齐「主题包 + 有限 token + accent 枚举」产品心智，非任何第三方源码移植）。
 * 约 12 套覆盖常见职场场景；token / 系列色 / accent 预设均为自研。
 */

export const pptExportThemes = [
  "white-blue",
  "soft-product",
  "blue-black",
  "code-surface",
  "glass-brand",
  "chart-report",
  "deep-strategy",
  "cold-research",
  "black-gold",
  "magazine-navy",
  "gold-index",
  "growth-energy"
] as const;

export type PptExportTheme = (typeof pptExportThemes)[number];

/** 主题设计 token：主色 / 辅色 / 背景 / 卡片 / 语义色 */
export interface ThemePackTokens {
  bg: string;
  bgSoft: string;
  card: string;
  title: string;
  body: string;
  muted: string;
  primary: string;
  accent: string;
  accentAlt: string;
  border: string;
  onAccent: string;
  success: string;
  risk: string;
  warning: string;
  /** 图表/多系列色（有限枚举，非无限色盘） */
  series: string[];
}

export interface ThemeAccentPreset {
  id: string;
  label: string;
  hex: string;
}

export interface ThemePackMeta {
  id: PptExportTheme;
  label: string;
  /** 一句话场景 */
  description: string;
  /** 适合场景短标签（Brief/Home 网格） */
  suitableFor: string;
  /** light | dark — 导出模板族与预览底色 */
  family: "light" | "dark";
  /** 普通自动选风时尽量避开（如金融金色） */
  avoidAutoSelect?: boolean;
  tokens: ThemePackTokens;
  /** 页级强调色枚举（有限选项） */
  accentPresets: ThemeAccentPreset[];
}

function accents(...items: Array<[string, string, string]>): ThemeAccentPreset[] {
  return items.map(([id, label, hex]) => ({ id, label, hex }));
}

export const themePacks: Record<PptExportTheme, ThemePackMeta> = {
  "white-blue": {
    id: "white-blue",
    label: "白蓝企业",
    description: "浅底 Bento，适合周报与售前",
    suitableFor: "企业汇报 / 售前",
    family: "light",
    tokens: {
      bg: "#EDF6FB",
      bgSoft: "#F3F8FC",
      card: "#FFFFFF",
      title: "#071426",
      body: "#25313C",
      muted: "#3E536A",
      primary: "#005AA6",
      accent: "#0066CC",
      accentAlt: "#00A6D6",
      border: "#D8E6F2",
      onAccent: "#FFFFFF",
      success: "#12B76A",
      risk: "#D92D20",
      warning: "#F79009",
      series: ["#005AA6", "#00A6D6", "#0F766E", "#F79009", "#64748B"]
    },
    accentPresets: accents(
      ["primary", "企业蓝", "#005AA6"],
      ["cyan", "青蓝", "#0891B2"],
      ["teal", "墨绿", "#0F766E"],
      ["slate", "墨灰", "#334155"]
    )
  },
  "soft-product": {
    id: "soft-product",
    label: "柔拟产品",
    description: "柔光浅灰 + 雾蓝强调，适合产品介绍",
    suitableFor: "产品介绍 / 创业团队",
    family: "light",
    tokens: {
      bg: "#F5F7FA",
      bgSoft: "#EEF2F6",
      card: "#FFFFFF",
      title: "#1A2332",
      body: "#3D4A5C",
      muted: "#6B7A8D",
      primary: "#3B82A0",
      accent: "#5B8FA8",
      accentAlt: "#7C9A6E",
      border: "#D5DEE8",
      onAccent: "#FFFFFF",
      success: "#22A06B",
      risk: "#C9372C",
      warning: "#E2A03C",
      series: ["#3B82A0", "#7C9A6E", "#C4A35A", "#8B7E74", "#5B6B7C"]
    },
    accentPresets: accents(
      ["mist", "雾蓝", "#3B82A0"],
      ["sage", "鼠尾草", "#7C9A6E"],
      ["clay", "陶土", "#B07D62"],
      ["ink", "墨色", "#2C3E50"]
    )
  },
  "blue-black": {
    id: "blue-black",
    label: "蓝黑科技",
    description: "深色看板，适合方案与发布",
    suitableFor: "技术方案 / 发布会",
    family: "dark",
    tokens: {
      bg: "#071C33",
      bgSoft: "#06111F",
      card: "#0E2A47",
      title: "#EAF6FF",
      body: "#C9E7F6",
      muted: "#9FC4D9",
      primary: "#18D6FF",
      accent: "#00A8FF",
      accentAlt: "#38BDF8",
      border: "#1D5F91",
      onAccent: "#071C33",
      success: "#32D583",
      risk: "#F97066",
      warning: "#FDB022",
      series: ["#18D6FF", "#00A8FF", "#38BDF8", "#34D399", "#FDB022"]
    },
    accentPresets: accents(
      ["cyan", "电青", "#18D6FF"],
      ["sky", "天空", "#00A8FF"],
      ["mint", "薄荷", "#2DD4BF"],
      ["amber", "琥珀", "#FBBF24"]
    )
  },
  "code-surface": {
    id: "code-surface",
    label: "代码表面",
    description: "深浅代码风，适合工程与架构",
    suitableFor: "技术方案 / 开发者",
    family: "dark",
    tokens: {
      bg: "#0D1117",
      bgSoft: "#161B22",
      card: "#21262D",
      title: "#E6EDF3",
      body: "#C9D1D9",
      muted: "#8B949E",
      primary: "#3FB950",
      accent: "#58A6FF",
      accentAlt: "#F78166",
      border: "#30363D",
      onAccent: "#0D1117",
      success: "#3FB950",
      risk: "#F85149",
      warning: "#D29922",
      series: ["#3FB950", "#58A6FF", "#F78166", "#A371F7", "#D29922"]
    },
    accentPresets: accents(
      ["green", "终端绿", "#3FB950"],
      ["blue", "链接蓝", "#58A6FF"],
      ["coral", "告警橙", "#F78166"],
      ["violet", "语法紫", "#A371F7"]
    )
  },
  "glass-brand": {
    id: "glass-brand",
    label: "玻璃品牌",
    description: "浅色玻璃感 + 薄荷绿，适合年轻化品牌",
    suitableFor: "消费品牌 / 创意提案",
    family: "light",
    tokens: {
      bg: "#F7FBFA",
      bgSoft: "#EEF8F5",
      card: "#FFFFFF",
      title: "#1B2B28",
      body: "#3A4F4A",
      muted: "#6B837C",
      primary: "#0D9488",
      accent: "#14B8A6",
      accentAlt: "#F472B6",
      border: "#CDE8E1",
      onAccent: "#FFFFFF",
      success: "#10B981",
      risk: "#E11D48",
      warning: "#F59E0B",
      series: ["#0D9488", "#14B8A6", "#F472B6", "#38BDF8", "#F59E0B"]
    },
    accentPresets: accents(
      ["teal", "薄荷绿", "#0D9488"],
      ["rose", "玫瑰", "#E11D48"],
      ["sky", "天空", "#0EA5E9"],
      ["amber", "暖橙", "#F59E0B"]
    )
  },
  "chart-report": {
    id: "chart-report",
    label: "色谱报告",
    description: "中性底 + 多系列色，适合数据报告",
    suitableFor: "数据报告 / 市场分析",
    family: "light",
    tokens: {
      bg: "#F8FAFC",
      bgSoft: "#F1F5F9",
      card: "#FFFFFF",
      title: "#0F172A",
      body: "#334155",
      muted: "#64748B",
      primary: "#2563EB",
      accent: "#0EA5E9",
      accentAlt: "#059669",
      border: "#E2E8F0",
      onAccent: "#FFFFFF",
      success: "#10B981",
      risk: "#EF4444",
      warning: "#F59E0B",
      series: ["#2563EB", "#0EA5E9", "#059669", "#F59E0B", "#DC2626", "#64748B"]
    },
    accentPresets: accents(
      ["blue", "报告蓝", "#2563EB"],
      ["cyan", "数据青", "#0EA5E9"],
      ["emerald", "增长绿", "#059669"],
      ["orange", "警示橙", "#EA580C"]
    )
  },
  "deep-strategy": {
    id: "deep-strategy",
    label: "深色战略",
    description: "近黑底 + 琥珀强调，适合高密度战略",
    suitableFor: "战略分析 / 投资人",
    family: "dark",
    tokens: {
      bg: "#0B0F14",
      bgSoft: "#111827",
      card: "#1A2332",
      title: "#F8FAFC",
      body: "#CBD5E1",
      muted: "#94A3B8",
      primary: "#F59E0B",
      accent: "#FBBF24",
      accentAlt: "#38BDF8",
      border: "#334155",
      onAccent: "#0B0F14",
      success: "#34D399",
      risk: "#F87171",
      warning: "#FBBF24",
      series: ["#F59E0B", "#38BDF8", "#34D399", "#F87171", "#A78BFA"]
    },
    accentPresets: accents(
      ["amber", "战略琥珀", "#F59E0B"],
      ["sky", "洞察蓝", "#38BDF8"],
      ["lime", "机会绿", "#84CC16"],
      ["rose", "风险红", "#F43F5E"]
    )
  },
  "cold-research": {
    id: "cold-research",
    label: "冷白调研",
    description: "冷灰白底 + 墨青强调，适合白皮书/调研",
    suitableFor: "白皮书 / 调研报告",
    family: "light",
    tokens: {
      bg: "#F4F6F8",
      bgSoft: "#EEF1F4",
      card: "#FFFFFF",
      title: "#0F172A",
      body: "#334155",
      muted: "#64748B",
      primary: "#0F766E",
      accent: "#115E59",
      accentAlt: "#0EA5E9",
      border: "#CBD5E1",
      onAccent: "#FFFFFF",
      success: "#059669",
      risk: "#DC2626",
      warning: "#D97706",
      series: ["#0F766E", "#0EA5E9", "#475569", "#D97706", "#DC2626"]
    },
    accentPresets: accents(
      ["teal", "墨青", "#0F766E"],
      ["slate", "冷灰", "#475569"],
      ["sky", "天空", "#0284C7"],
      ["olive", "橄榄", "#4D7C0F"]
    )
  },
  "black-gold": {
    id: "black-gold",
    label: "黑金实验",
    description: "暖白纸面 + 墨黑结构 + 电光黄，适合实验性品牌提案",
    suitableFor: "高端发布 / 品牌提案",
    family: "light",
    tokens: {
      bg: "#FBFAF4",
      bgSoft: "#EFEFF6",
      card: "#FFFFFF",
      title: "#16150F",
      body: "#2A2820",
      muted: "#77746A",
      primary: "#E2E62A",
      accent: "#F4F66C",
      accentAlt: "#B9A8E8",
      border: "#DEDCEA",
      onAccent: "#16150F",
      success: "#1F8A5B",
      risk: "#E63329",
      warning: "#F2E70C",
      series: ["#E2E62A", "#B9A8E8", "#8FB7FF", "#70E7D2", "#FF4D97"]
    },
    accentPresets: accents(
      ["electric", "电光黄", "#E2E62A"],
      ["acid", "酸性黄", "#F4F66C"],
      ["lavender", "实验紫", "#B9A8E8"],
      ["pink", "批注粉", "#FF4D97"]
    )
  },
  "magazine-navy": {
    id: "magazine-navy",
    label: "深蓝杂志",
    description: "杂志深蓝 + 纸白，适合品牌故事",
    suitableFor: "品牌故事 / 人物专题",
    family: "dark",
    tokens: {
      bg: "#0C1B33",
      bgSoft: "#132743",
      card: "#1A3358",
      title: "#F4F7FB",
      body: "#C5D0E0",
      muted: "#8FA0B8",
      primary: "#E8D5B5",
      accent: "#F0E0C0",
      accentAlt: "#7EB8D4",
      border: "#2A4468",
      onAccent: "#0C1B33",
      success: "#6EE7B7",
      risk: "#FCA5A5",
      warning: "#FCD34D",
      series: ["#E8D5B5", "#7EB8D4", "#F4F7FB", "#94A3B8", "#FCA5A5"]
    },
    accentPresets: accents(
      ["paper", "纸白金", "#E8D5B5"],
      ["sky", "杂志青", "#7EB8D4"],
      ["coral", "叙事红", "#E07A5F"],
      ["white", "纯白", "#F4F7FB"]
    )
  },
  "gold-index": {
    id: "gold-index",
    label: "金色指数",
    description: "暮光蓝灰 + 柔沙金，适合投资与指数报告",
    suitableFor: "金融投资 / 指数榜单",
    family: "dark",
    avoidAutoSelect: true,
    tokens: {
      bg: "#1C2740",
      bgSoft: "#33405C",
      card: "#2B3650",
      title: "#F2F3F6",
      body: "#D5D8DE",
      muted: "#9AA0A8",
      primary: "#D7A85B",
      accent: "#E6C878",
      accentAlt: "#6F9BD8",
      border: "#59657C",
      onAccent: "#101216",
      success: "#3FB39A",
      risk: "#D27D58",
      warning: "#D7A85B",
      series: ["#D7A85B", "#6F9BD8", "#46A6D0", "#3FB39A", "#D27D58"]
    },
    accentPresets: accents(
      ["gold", "柔沙金", "#D7A85B"],
      ["blue", "暮光蓝", "#6F9BD8"],
      ["green", "上涨绿", "#3FB39A"],
      ["red", "回撤红", "#D27D58"]
    )
  },
  "growth-energy": {
    id: "growth-energy",
    label: "高能增长",
    description: "暖白底 + 珊瑚主色，适合路演/增长",
    suitableFor: "增长复盘 / 路演",
    family: "light",
    tokens: {
      bg: "#FFF8F5",
      bgSoft: "#FFF1EB",
      card: "#FFFFFF",
      title: "#1C1917",
      body: "#44403C",
      muted: "#78716C",
      primary: "#EA580C",
      accent: "#F97316",
      accentAlt: "#0891B2",
      border: "#FED7AA",
      onAccent: "#FFFFFF",
      success: "#16A34A",
      risk: "#E11D48",
      warning: "#CA8A04",
      series: ["#EA580C", "#0891B2", "#16A34A", "#CA8A04", "#78716C"]
    },
    accentPresets: accents(
      ["coral", "增长橙", "#EA580C"],
      ["cyan", "行动青", "#0891B2"],
      ["green", "达标绿", "#16A34A"],
      ["rose", "紧迫红", "#E11D48"]
    )
  }
};

export const themePackList: ThemePackMeta[] = pptExportThemes.map((id) => themePacks[id]);

export function isPptExportTheme(value: unknown): value is PptExportTheme {
  return typeof value === "string" && (pptExportThemes as readonly string[]).includes(value);
}

/** 未知/历史值回落到 white-blue；兼容旧 unilumin-blue */
export function normalizePptExportTheme(value?: string | null): PptExportTheme {
  if (!value) return "white-blue";
  if (isPptExportTheme(value)) return value;
  if (value === "unilumin-blue" || value === "default") return "white-blue";
  return "white-blue";
}

export function getThemePack(theme: string | null | undefined): ThemePackMeta {
  return themePacks[normalizePptExportTheme(theme)];
}

export function themeFamily(theme: string | null | undefined): "light" | "dark" {
  return getThemePack(theme).family;
}

/** 普通自动选风：跳过 avoidAutoSelect */
export function pickDefaultThemePack(preferred?: string | null): PptExportTheme {
  if (preferred && isPptExportTheme(preferred) && !themePacks[preferred].avoidAutoSelect) {
    return preferred;
  }
  return "white-blue";
}

export function normalizeAccentPresetId(theme: string | null | undefined, accentId?: string | null): string {
  const pack = getThemePack(theme);
  if (accentId && pack.accentPresets.some((p) => p.id === accentId)) return accentId;
  return pack.accentPresets[0]?.id ?? "primary";
}

export function getAccentPresetHex(theme: string | null | undefined, accentId?: string | null): string {
  const pack = getThemePack(theme);
  const id = normalizeAccentPresetId(theme, accentId);
  return pack.accentPresets.find((p) => p.id === id)?.hex ?? pack.tokens.primary;
}

/** 供提示词注入的主题目录 */
export function formatThemePackCatalog(): string {
  return themePackList
    .map(
      (p) =>
        `- ${p.id}（${p.label}）：${p.description}；适合 ${p.suitableFor}；族=${p.family}${
          p.avoidAutoSelect ? "；勿默认自选" : ""
        }`
    )
    .join("\n");
}
