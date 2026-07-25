import type { SlideDto } from "@ppt-agent/shared";
import { DESIGN_RECIPES, getDesignRecipe } from "./templates.js";
import type { DesignRecipe, DesignRecipeSelection, RecipeSelectionContext } from "./types.js";

function buildContext(slide: SlideDto): RecipeSelectionContext {
  const blocks = slide.planJson?.contentBlocks?.filter((block) => block.type !== "summary") ?? [];
  return {
    slide,
    blockCount: blocks.length || Math.min(Math.max(slide.contentPoints.length, 1), 5),
    text: [
      slide.title,
      slide.slideGoal,
      slide.keyMessage,
      slide.recommendedLayout,
      slide.planJson?.layoutType,
      slide.planJson?.visualHint?.heroVisual,
      ...blocks.flatMap((block) => [block.title, ...block.items])
    ]
      .filter(Boolean)
      .join(" "),
    layout: slide.planJson?.layoutType || slide.recommendedLayout || "generic-cards",
    chartType: slide.planJson?.visualHint?.chartType || "none"
  };
}

function scoreRecipe(recipe: DesignRecipe, context: RecipeSelectionContext) {
  let score = 0;
  const signals: string[] = [];
  const normalizedLayout = context.layout.toLowerCase();
  const normalizedText = context.text.toLowerCase();

  if (context.blockCount >= recipe.minBlocks && context.blockCount <= recipe.maxBlocks) {
    score += 18;
    signals.push(`正文模块数 ${context.blockCount} 匹配`);
  } else {
    score -= Math.min(Math.abs(context.blockCount - recipe.minBlocks) * 8, 24);
  }

  for (const hint of recipe.layoutHints) {
    if (normalizedLayout.includes(hint.toLowerCase())) {
      score += 24;
      signals.push(`版式语义 ${hint}`);
      break;
    }
  }

  const semanticMatches = recipe.semanticTags.filter((tag) => normalizedText.includes(tag.toLowerCase()));
  score += Math.min(semanticMatches.length * 7, 28);
  if (semanticMatches.length) signals.push(`内容语义 ${semanticMatches.slice(0, 4).join("/")}`);

  if (["bar", "line", "pie", "metric"].includes(context.chartType) && recipe.id === "evidence-dashboard") {
    score += 60;
    signals.push(`图形类型 ${context.chartType}`);
  }
  if (["process", "timeline"].includes(context.chartType) && recipe.id === "stepped-roadmap") {
    score += 60;
    signals.push(`图形类型 ${context.chartType}`);
  }
  if (context.chartType === "table" && recipe.id === "matrix-contrast") {
    score += 60;
    signals.push("图形类型 table");
  }

  // 两个互补模块优先构成关系，而不是退化为两张卡片。
  if (context.blockCount === 2 && recipe.id === "dual-engine-bridge") {
    score += 30;
    signals.push("双模块关系优先");
  }
  if (context.blockCount === 2 && recipe.id === "matrix-contrast" && /对比|vs|区别|现状|目标|优劣/.test(context.text)) {
    score += 36;
    signals.push("存在明确对照语义");
  }
  if (context.blockCount <= 2 && ["cover", "statement", "transition", "closing"].some((term) => normalizedLayout.includes(term))) {
    if (recipe.id === "editorial-hero-split" || recipe.id === "quote-monument") score += 36;
  }
  if (context.blockCount >= 3 && /架构|系统|生态|平台|agent|组件|图谱/i.test(context.text) && recipe.id === "radial-ecosystem") {
    score += 32;
    signals.push("系统关系语义");
  }

  return { score, signals };
}

export function selectDesignRecipe(slide: SlideDto): DesignRecipeSelection {
  const context = buildContext(slide);
  const ranked = DESIGN_RECIPES.map((recipe) => ({ recipe, ...scoreRecipe(recipe, context) })).sort(
    (a, b) => b.score - a.score
  );
  const winner = ranked[0] ?? { recipe: getDesignRecipe("asymmetric-card-stack"), score: 0, signals: [] };
  return {
    recipe: winner.recipe,
    score: winner.score,
    signals: winner.signals,
    reason: winner.signals.length > 0 ? winner.signals.join("；") : "使用通用不对称信息层级"
  };
}

