import type { PresentationStyleId, SlideDto } from "@ppt-agent/shared";
import { selectDesignRecipe } from "./selector.js";
import { validateSvgSpatialQuality } from "./svgSpatialQuality.js";

export interface SvgVisualQualityResult {
  ok: boolean;
  recipeId: string;
  issues: string[];
}

export function validateSvgAgainstDesignRecipe(
  svg: string,
  slide: SlideDto,
  presentationStyle?: PresentationStyleId | string | null
): SvgVisualQualityResult {
  const recipe = selectDesignRecipe(slide, presentationStyle).recipe;
  const issues: string[] = [];

  for (const groupId of recipe.requiredGroupIds) {
    const groupPattern = new RegExp(`<g\\b[^>]*\\bid=["']${groupId}["']`, "i");
    if (!groupPattern.test(svg)) issues.push(`缺少语义分组 ${groupId}`);
  }

  for (const primitive of recipe.requiredPrimitives) {
    if (!new RegExp(`<${primitive}\\b`, "i").test(svg)) issues.push(`配方要求使用 ${primitive} 图元`);
  }

  const rectCount = (svg.match(/<rect\b/gi) ?? []).length;
  const nonRectCount = (svg.match(/<(?:path|polygon|polyline|circle|ellipse|line)\b/gi) ?? []).length;
  if (rectCount >= 6 && nonRectCount < 3) issues.push("矩形容器过多且缺少关系图形，疑似退化为卡片墙");

  const centeredTexts = (svg.match(/<text\b[^>]*text-anchor=["']middle["']/gi) ?? []).length;
  const textCount = (svg.match(/<text\b/gi) ?? []).length;
  if (textCount >= 6 && centeredTexts / textCount > 0.75) issues.push("超过 75% 文字居中，缺少编辑式信息层级");

  const spatialQuality = validateSvgSpatialQuality(svg, recipe);
  issues.push(...spatialQuality.issues);

  return { ok: issues.length === 0, recipeId: recipe.id, issues };
}
