/**
 * 质感 / 密度预设（有限枚举）。
 * 即时预览仅做 CSS 滤镜近似；构图级差异仍需「按主题重新生成」。
 * 概念对齐「渲染样式分段控件」产品心智，非第三方源码移植。
 */

export const themeSurfaceIds = ["flat", "soft", "dense", "glass"] as const;
export type ThemeSurfaceId = (typeof themeSurfaceIds)[number];

export interface ThemeSurfacePreset {
  id: ThemeSurfaceId;
  label: string;
  /** 一句话说明 */
  description: string;
  /** 预览 iframe 可用的 CSS filter（不改库存 SVG） */
  previewFilter: string;
  /** true：切换即见预览变化；false：仅作重生提示 */
  instantPreview: boolean;
  /** 注入「重新生成」时的风格提示（可选） */
  regenerateHint: string | null;
}

export const themeSurfacePresets: Record<ThemeSurfaceId, ThemeSurfacePreset> = {
  flat: {
    id: "flat",
    label: "清晰扁平",
    description: "硬边卡片，对比清晰",
    previewFilter: "none",
    instantPreview: true,
    regenerateHint: null
  },
  soft: {
    id: "soft",
    label: "柔和卡片",
    description: "略降对比，柔光感",
    previewFilter: "contrast(0.94) saturate(0.92)",
    instantPreview: true,
    regenerateHint: "柔和圆角卡片、轻阴影、低对比色块"
  },
  dense: {
    id: "dense",
    label: "紧凑报告",
    description: "信息密度更高",
    previewFilter: "contrast(1.05) saturate(0.9)",
    instantPreview: true,
    regenerateHint: "紧凑排版、小字号、少装饰留白；遵守文案预算"
  },
  glass: {
    id: "glass",
    label: "轻玻璃感",
    description: "轻微提亮与通透",
    previewFilter: "brightness(1.04) saturate(1.06) contrast(0.97)",
    instantPreview: true,
    regenerateHint: "半透明卡片、柔边、轻玻璃感（仍须可编译 SVG，禁止 filter/mask）"
  }
};

export const themeSurfaceList: ThemeSurfacePreset[] = themeSurfaceIds.map((id) => themeSurfacePresets[id]);

export function isThemeSurfaceId(value: unknown): value is ThemeSurfaceId {
  return typeof value === "string" && (themeSurfaceIds as readonly string[]).includes(value);
}

export function normalizeThemeSurfaceId(value?: string | null): ThemeSurfaceId {
  if (value && isThemeSurfaceId(value)) return value;
  return "flat";
}

export function getThemeSurfacePreset(value?: string | null): ThemeSurfacePreset {
  return themeSurfacePresets[normalizeThemeSurfaceId(value)];
}
