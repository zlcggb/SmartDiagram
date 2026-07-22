export type StudioPipelineStage = "search" | "draft" | "design";

export type StudioPipelineSlideState = {
  searchJson?: unknown | null;
  planJson?: unknown | null;
  svgPreview?: string | null;
};

export function isStudioStageComplete(
  slide: StudioPipelineSlideState | null | undefined,
  stage: StudioPipelineStage
): boolean {
  if (!slide) return false;
  if (stage === "search") return slide.searchJson != null;
  if (stage === "draft") return slide.planJson != null;
  return Boolean(slide.svgPreview?.trim());
}

/** 点击生成设计稿时需要补齐的严格顺序；上游缺失会使已有下游产物失效。 */
export function requiredStudioPipelineStages(
  slide: StudioPipelineSlideState | null | undefined
): StudioPipelineStage[] {
  if (!isStudioStageComplete(slide, "search")) return ["search", "draft", "design"];
  if (!isStudioStageComplete(slide, "draft")) return ["draft", "design"];
  return ["design"];
}

/** 返回调用某阶段前仍缺少的最近前置阶段。 */
export function missingStudioPrerequisite(
  slide: StudioPipelineSlideState | null | undefined,
  target: Exclude<StudioPipelineStage, "search">
): StudioPipelineStage | null {
  if (!isStudioStageComplete(slide, "search")) return "search";
  if (target === "design" && !isStudioStageComplete(slide, "draft")) return "draft";
  return null;
}

export function studioStageLabel(stage: StudioPipelineStage): string {
  if (stage === "search") return "检索素材";
  if (stage === "draft") return "生成初稿";
  return "设计出图";
}
