/**
 * Goal Spec — 声明式 Deck 描述契约（dashi goal.json 启发，自研落地）。
 *
 * 用途：
 * 1. 项目状态的可序列化快照（版本管理 / 离线复现）
 * 2. 批量渲染管线的输入格式
 * 3. 与 dashi-ppt-skill 生态的双向转换桥梁
 *
 * 不同于 dashi 的 goal.json（面向模板编排），engine 的 GoalSpec
 * 携带 AI 生成的 planJson/irJson/svgPreview，支持 Hybrid 导出。
 */

import { z } from "zod";
import { pptExportThemes } from "./themePacks.js";
import { normalizePptExportTheme, type PptExportTheme } from "./themePacks.js";

/**
 * 内联定义（避免从 index.js 循环导入）。
 * 与 index.ts 中 RenderStrategySchema / SlideGenerationStatusSchema 保持一致。
 */
const renderStrategies = ["ir", "svg", "hybrid"] as const;
const RenderStrategySchema = z.enum(renderStrategies);

const slideGenerationStatuses = [
  "draft", "planned", "search-ready", "draft-ready",
  "ir-ready", "svg-ready", "error"
] as const;
const SlideGenerationStatusSchema = z.enum(slideGenerationStatuses);

const PptExportThemeSchema = z.enum(pptExportThemes);

/** 单页 Goal 描述 */
export const GoalSlideSchema = z.object({
  /** 页面 ID（对应 Prisma Slide.id；新建时可省略） */
  id: z.string().optional(),
  /** 排序 */
  sortOrder: z.coerce.number().int().default(0),
  /** 页标题 */
  title: z.string().min(1),
  /** 本页目标 */
  slideGoal: z.string().default(""),
  /** 核心结论 */
  keyMessage: z.string().default(""),
  /** 内容要点 */
  contentPoints: z.array(z.string()).default([]),
  /** 推荐版式（engine recommendedLayout 枚举） */
  recommendedLayout: z.string().min(1),
  /** 章节标签 */
  partTitle: z.string().nullable().optional(),
  /** 引用事实 ID */
  sourceFactIds: z.array(z.string()).default([]),
  /** 渲染策略 */
  renderStrategy: RenderStrategySchema.optional(),
  /** 生成状态 */
  generationStatus: SlideGenerationStatusSchema.optional(),

  // ── dashi 兼容：props 填文案 ──
  /** 类 dashi props：自由键值文案填充（面向模板编排器） */
  props: z.record(z.unknown()).optional(),
  /** dashi layout key（如 theme01_page030）；engine 内部用 recommendedLayout */
  dashiLayout: z.string().optional(),

  // ── engine 扩展：AI 产物 ──
  /** 策划稿 */
  planJson: z.any().optional(),
  /** Slide IR */
  irJson: z.any().optional(),
  /** SVG 预览 */
  svgPreview: z.string().optional(),
  /** 检索资料卡 */
  searchJson: z.any().optional()
});

/** 完整 Goal Spec */
export const GoalSpecSchema = z.object({
  /** Deck 标题 */
  title: z.string().min(1),
  /** 制作目的 */
  goal: z.string().min(1),
  /** 受众 */
  audience: z.string().default("待确认"),
  /** 负责人 / 团队 */
  owner: z.string().default(""),
  /** 可复现随机种子（类 dashi randomSeed） */
  randomSeed: z.string().optional(),
  /** 目标页数 */
  pageCount: z.coerce.number().int().min(1).max(30).default(8),
  /** 主题包 */
  themePack: PptExportThemeSchema.default("white-blue"),
  /** 幻灯片列表 */
  slides: z.array(GoalSlideSchema).default([]),

  // ── 元数据 ──
  /** 版本标识 */
  version: z.string().default("1.0"),
  /** 生成时间 */
  createdAt: z.string().optional(),
  /** 对应 engine 项目 ID */
  projectId: z.string().optional(),

  // ── dashi 兼容 ──
  /** dashi 顶层文字覆盖（面向模板编排器） */
  text: z.record(z.string()).optional(),
  /** 预览配置（如 themeSwitcher） */
  preview: z.record(z.unknown()).optional(),
  /** Deck 语言 */
  language: z.string().optional()
});

export type GoalSlide = z.infer<typeof GoalSlideSchema>;
export type GoalSpec = z.infer<typeof GoalSpecSchema>;

// ── 序列化 / 反序列化工具 ──

import type { ProjectDto, SlideDto, FactDto } from "./index.js";

/** 从 engine 项目状态导出 GoalSpec */
export function projectToGoalSpec(
  project: ProjectDto,
  slides: SlideDto[],
  _facts?: FactDto[]
): GoalSpec {
  return {
    title: project.name,
    goal: project.purpose,
    audience: project.audience,
    owner: "",
    pageCount: project.pageCount,
    themePack: normalizePptExportTheme(project.theme),
    version: "1.0",
    createdAt: new Date().toISOString(),
    projectId: project.id,
    slides: slides
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((slide) => ({
        id: slide.id,
        sortOrder: slide.sortOrder,
        title: slide.title,
        slideGoal: slide.slideGoal,
        keyMessage: slide.keyMessage,
        contentPoints: slide.contentPoints,
        recommendedLayout: slide.recommendedLayout,
        partTitle: slide.partTitle,
        sourceFactIds: slide.sourceFactIds,
        renderStrategy: slide.renderStrategy,
        generationStatus: slide.generationStatus,
        planJson: slide.planJson,
        irJson: slide.irJson,
        svgPreview: slide.svgPreview ?? undefined,
        searchJson: slide.searchJson
      }))
  };
}

/** 从 GoalSpec 生成 dashi 兼容的 goal.json（用于 dashi 渲染管线） */
export function goalSpecToDashiGoal(spec: GoalSpec): Record<string, unknown> {
  const dashiThemeMap: Partial<Record<PptExportTheme, string>> = {
    "white-blue": "theme01",
    "soft-product": "theme01",
    "blue-black": "theme02",
    "code-surface": "theme03",
    "glass-brand": "theme04",
    "chart-report": "theme05",
    "deep-strategy": "theme06",
    "cold-research": "theme07",
    "black-gold": "theme08",
    "magazine-navy": "theme09",
    "gold-index": "theme10",
    "growth-energy": "theme11"
  };

  return {
    title: spec.title,
    goal: spec.goal,
    audience: spec.audience,
    owner: spec.owner,
    randomSeed: spec.randomSeed ?? `${spec.themePack}-${Date.now()}`,
    pageCount: spec.pageCount,
    themePack: dashiThemeMap[spec.themePack] ?? "theme01",
    language: spec.language,
    slides: spec.slides.map((slide) => ({
      layout: slide.dashiLayout ?? slide.recommendedLayout,
      props: slide.props ?? {
        title: slide.title,
        kicker: slide.partTitle ?? "",
        lead: slide.keyMessage
      }
    }))
  };
}

/** 校验 GoalSpec JSON 并返回类型安全结果 */
export function parseGoalSpec(input: unknown): { success: true; data: GoalSpec } | { success: false; errors: string[] } {
  const result = GoalSpecSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  };
}
