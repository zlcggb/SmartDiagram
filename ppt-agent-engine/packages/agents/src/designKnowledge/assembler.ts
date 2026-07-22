import type { SlideDto } from "@ppt-agent/shared";
import { SHAPE_GRAMMAR, SVG_EDITABILITY_CONTRACT, VISUAL_ANTI_PATTERNS } from "./shapeGrammar.js";
import { selectDesignRecipe } from "./selector.js";

export function buildDesignRecipeInstruction(slide: SlideDto) {
  const selection = selectDesignRecipe(slide);
  const recipe = selection.recipe;
  const zones = recipe.zones
    .map(
      (zone) =>
        `- <g id="${zone.id}">：x=${zone.x}, y=${zone.y}, w=${zone.w}, h=${zone.h}, z=${zone.layer}；${zone.instruction}`
    )
    .join("\n");

  return [
    "# 本页视觉配方（SVG 阶段最高优先级）",
    `配方：${recipe.id} / ${recipe.label}`,
    `选择原因：${selection.reason}。`,
    `叙事结构：${recipe.story}`,
    `标志性母题：${recipe.signatureMotif}`,
    "",
    "## 坐标区与语义分组",
    zones,
    "可在每个区内调整内部几何，但不得把这些区域退化为等宽卡片栅格。未使用的可选 content-zone 保持留白，不得补写文案。",
    "",
    "## 形状组装程序（按顺序执行）",
    `1. 背景层：${recipe.backgroundProgram.join("；")}。`,
    `2. 标题层：${recipe.titleProgram.join("；")}。`,
    `3. 核心结论：${recipe.keyMessageProgram.join("；")}。`,
    `4. 正文模块：${recipe.contentProgram.join("；")}。`,
    `5. 关系层：${recipe.connectorProgram.join("；")}。`,
    `6. 形状语法 layeredPanel：${SHAPE_GRAMMAR.layeredPanel.join("；")}。`,
    `7. 形状语法 ambientBackground：${SHAPE_GRAMMAR.ambientBackground.join("；")}。`,
    recipe.requiredPrimitives.includes("path") || recipe.requiredPrimitives.includes("circle")
      ? `8. 形状语法 visualNexus：${SHAPE_GRAMMAR.visualNexus.join("；")}。`
      : "",
    "",
    "## 输出结构门禁",
    `必须存在的分组 id：${recipe.requiredGroupIds.join("、")}。`,
    `必须实际使用的非矩形图元：${recipe.requiredPrimitives.join("、")}。`,
    ...SVG_EDITABILITY_CONTRACT.map((rule) => `- ${rule}`),
    "",
    "## 本配方禁止项",
    ...recipe.forbidden.map((rule) => `- ${rule}`),
    ...VISUAL_ANTI_PATTERNS.map((rule) => `- 禁止${rule}`),
    "这不是风格建议，而是本页的实际绘制程序；完成后逐项核对分组、坐标、形状和连接关系。"
  ]
    .filter(Boolean)
    .join("\n");
}

export function designRecipeMeta(slide: SlideDto) {
  const selection = selectDesignRecipe(slide);
  return {
    id: selection.recipe.id,
    label: selection.recipe.label,
    reason: selection.reason,
    requiredGroupIds: selection.recipe.requiredGroupIds,
    requiredPrimitives: selection.recipe.requiredPrimitives
  };
}

