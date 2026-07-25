import type { ExportMode, PageRenderResult, PptExportTheme, RenderStrategy, SlideDto } from "@ppt-agent/shared";
import { getThemePack, inferRenderStrategy, renderStrategies, themePackList } from "@ppt-agent/shared";

export type { ExportMode, RenderStrategy };

/** @deprecated 使用 ExportMode（来自 @ppt-agent/shared） */
export type PptExportMode = ExportMode;

export type EditableGrade = "A" | "B" | "C";

/** UI 已不再暴露 draft/standard/visual；保留供内部 API 兼容 */
export const exportModeOptions: Array<{
  id: ExportMode;
  label: string;
  description: string;
}> = [
  { id: "draft", label: "快速草稿", description: "不强制 SVG，优先 IR/模板，速度快" },
  { id: "standard", label: "标准版", description: "按页策略导出；缺设计可降级（推荐）" },
  { id: "visual", label: "高视觉版", description: "按策略尽量 SVG；失败再降级 IR" }
];

/** 右侧主题面板：ThemePack 列表（自研 token，非外部主题文件） */
export const exportThemeOptions: Array<{
  id: PptExportTheme;
  label: string;
  description: string;
  suitableFor: string;
  /** 主色 hex，UI 用 inline style */
  accentHex: string;
  family: "light" | "dark";
  previewBg: string;
  avoidAutoSelect?: boolean;
  accentPresets: Array<{ id: string; label: string; hex: string }>;
}> = themePackList.map((pack) => ({
  id: pack.id,
  label: pack.label,
  description: pack.description,
  suitableFor: pack.suitableFor,
  accentHex: pack.tokens.primary,
  family: pack.family,
  previewBg: pack.tokens.bg,
  avoidAutoSelect: pack.avoidAutoSelect,
  accentPresets: pack.accentPresets
}));

export function exportThemeLabel(theme: PptExportTheme | string) {
  return getThemePack(theme).label;
}

export function exportThemePreviewBg(theme: PptExportTheme | string) {
  return getThemePack(theme).tokens.bg;
}

export const strategySwitchOptions: Array<{
  id: RenderStrategy;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  { id: "svg", label: "SVG 优先", shortLabel: "SVG", hint: "视觉优先" },
  { id: "theme", label: "主题优先", shortLabel: "主题", hint: "原生兼容" }
];

const strategyLabels: Record<RenderStrategy, string> = {
  theme: "主题优先",
  svg: "SVG 优先"
};

const gradeHints: Record<EditableGrade, string> = {
  A: "文本与形状均可改（接近 L1）",
  B: "主体可改，装饰可能受限（接近 L2）",
  C: "整页视觉保真或模板页，内容不可拆分编辑"
};

/**
 * 导出页结果：权威字段为 shared PageRenderResult（path / editableGrade）。
 * grade 为历史别名兼容，勿再引入 used（已统一为 path）。
 */
export type PageRenderResultWithGrade = PageRenderResult & {
  editableGrade?: string | null;
  grade?: string | null;
};

/** 若 slide 带 renderStrategy 则用服务端值；否则前端启发式 */
export function resolveRenderStrategy(slide: SlideDto): {
  strategy: RenderStrategy;
  fromServer: boolean;
} {
  const server = slide.renderStrategy;
  if (server && (renderStrategies as readonly string[]).includes(server)) {
    return { strategy: server, fromServer: true };
  }
  return { strategy: inferRenderStrategy(slide), fromServer: false };
}

/** 始终展示 ir/svg/hybrid 中文标签；无服务端字段时用推断结果，不再显示「自动」 */
export function renderStrategyHint(slide: SlideDto): string {
  const { strategy } = resolveRenderStrategy(slide);
  return strategyLabels[strategy];
}

export function exportModeBusyLabel(mode: ExportMode): string {
  if (mode === "draft") return "导出快速草稿 PPTX 中";
  if (mode === "visual") return "导出高视觉版 PPTX 中";
  return "导出标准版 PPTX 中";
}

/** 是否已有可导出的设计产物（SVG 或 IR）；无则导出只会走主题模板 */
export function isSlideDesignReady(slide: Pick<SlideDto, "svgPreview">) {
  return Boolean(slide.svgPreview);
}

export function normalizeEditableGrade(raw: unknown): EditableGrade | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase();
  if (key === "A" || key === "B" || key === "C") return key;
  return null;
}

/** 从单页导出结果读取可编辑等级；字段缺失则 null */
export function resolveEditableGrade(page: PageRenderResultWithGrade): EditableGrade | null {
  return normalizeEditableGrade(page.editableGrade) ?? normalizeEditableGrade(page.grade);
}

export function editableGradeHint(grade: EditableGrade): string {
  return gradeHints[grade];
}

export function collectPageGrades(
  pageResults: PageRenderResultWithGrade[] | undefined | null
): Array<{ slideId: string; grade: EditableGrade; hint: string }> {
  if (!pageResults?.length) return [];
  const items: Array<{ slideId: string; grade: EditableGrade; hint: string }> = [];
  for (const page of pageResults) {
    const grade = resolveEditableGrade(page);
    if (!grade) continue;
    items.push({
      slideId: page.slideId,
      grade,
      hint: editableGradeHint(grade)
    });
  }
  return items;
}
