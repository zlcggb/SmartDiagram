/**
 * 渲染前校验器（dashi validate:goal-spec 启发）。
 *
 * 在导出前检查 slides 结构完整性，避免空白页或无效配置进入渲染管线。
 */

import {
  isRecommendedLayout,
  normalizeRecommendedLayout
} from "./layoutRoles.js";
import { copyBudgets } from "./copyBudgets.js";
import type { SlideDto, FactDto } from "./index.js";

export interface ValidationIssue {
  slideId?: string;
  slideTitle?: string;
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: string;
}

/** 渲染前校验 */
export function validateGoalSpec(
  slides: SlideDto[],
  facts: FactDto[],
  options?: { strict?: boolean }
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const strict = options?.strict ?? false;

  // ── 全局校验 ──

  if (slides.length === 0) {
    issues.push({
      level: "error",
      code: "EMPTY_DECK",
      message: "没有任何页面，无法渲染"
    });
  }

  // 检查是否有封面
  const hasCover = slides.some(
    (s) => s.recommendedLayout === "cover" || s.recommendedLayout.includes("cover")
  );
  if (!hasCover && slides.length > 0) {
    issues.push({
      level: "warning",
      code: "NO_COVER",
      message: "缺少封面页，建议第一页使用 cover 角色"
    });
  }

  // 检查重复版式
  const layoutCounts = new Map<string, number>();
  for (const slide of slides) {
    const key = slide.recommendedLayout;
    layoutCounts.set(key, (layoutCounts.get(key) ?? 0) + 1);
  }
  for (const [layout, count] of layoutCounts) {
    if (count > 1 && layout !== "generic-cards") {
      issues.push({
        level: "warning",
        code: "DUPLICATE_LAYOUT",
        message: `版式 "${layout}" 使用了 ${count} 次，建议使用不同剪影拉开页间差异`
      });
    }
  }

  // ── 逐页校验 ──

  const factIdSet = new Set(facts.map((f) => f.id));

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const ctx = { slideId: slide.id, slideTitle: slide.title };

    // 版式合法性
    if (!isRecommendedLayout(slide.recommendedLayout)) {
      const normalized = normalizeRecommendedLayout(slide.recommendedLayout);
      issues.push({
        ...ctx,
        level: "warning",
        code: "UNKNOWN_LAYOUT",
        message: `版式 "${slide.recommendedLayout}" 不在枚举中，将回落到 "${normalized}"`
      });
    }

    // 标题不能为空
    if (!slide.title || slide.title.trim().length === 0) {
      issues.push({
        ...ctx,
        level: "error",
        code: "EMPTY_TITLE",
        message: `第 ${i + 1} 页标题为空`
      });
    }

    // 标题长度
    if (slide.title && slide.title.length > copyBudgets.title.maxChars) {
      issues.push({
        ...ctx,
        level: "warning",
        code: "TITLE_TOO_LONG",
        message: `标题 "${slide.title.slice(0, 20)}…" 超长（${slide.title.length} 字），建议 ≤${copyBudgets.title.maxChars} 字`
      });
    }

    // keyMessage 长度
    if (slide.keyMessage && slide.keyMessage.length > copyBudgets.keyMessage.maxChars) {
      issues.push({
        ...ctx,
        level: "warning",
        code: "KEY_MESSAGE_TOO_LONG",
        message: `核心结论过长（${slide.keyMessage.length} 字），建议 ≤${copyBudgets.keyMessage.maxChars} 字`
      });
    }

    // contentPoints 条数
    if (slide.contentPoints && slide.contentPoints.length > copyBudgets.bulletCount.max * 2) {
      issues.push({
        ...ctx,
        level: "warning",
        code: "TOO_MANY_POINTS",
        message: `内容要点 ${slide.contentPoints.length} 条，建议 ≤${copyBudgets.bulletCount.max} 条`
      });
    }

    // 事实引用检查（严格模式）
    if (strict && slide.sourceFactIds) {
      for (const factId of slide.sourceFactIds) {
        if (!factIdSet.has(factId)) {
          issues.push({
            ...ctx,
            level: "warning",
            code: "ORPHAN_FACT_REF",
            message: `引用的事实 ID "${factId}" 不存在`
          });
        }
      }
    }

    // 策划稿完整性
    if (strict && !slide.planJson && slide.generationStatus !== "draft") {
      issues.push({
        ...ctx,
        level: "warning",
        code: "MISSING_PLAN",
        message: `第 ${i + 1} 页缺少策划稿，导出可能质量不佳`
      });
    }
  }

  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.filter((i) => i.level === "warning").length;

  return {
    valid: errorCount === 0,
    issues,
    summary:
      errorCount === 0 && warnCount === 0
        ? `✅ 校验通过（${slides.length} 页）`
        : `${errorCount > 0 ? "❌" : "⚠️"} ${errorCount} 错误 / ${warnCount} 警告`
  };
}
