export type { GeminiAdapter, ModelUsageEvent, ModelUsageReporter, ModelUsageStage } from "./types.js";
export {
  buildSlideIrPrompt,
  createMockSlideIr,
  normalizeSlideIr,
  slideIrJsonSchema,
  slideIrSystemPrompt,
  validateSlideIrVisualQuality
} from "./slideIrGeneration.js";
export type { SlideIrVisualQualityResult } from "./slideIrGeneration.js";
export { MockGeminiAdapter } from "./mockGeminiAdapter.js";
export { RealGeminiAdapter } from "./realGeminiAdapter.js";
export { OpenAiCompatibleAdapter } from "./openaiCompatibleAdapter.js";
export type { TokenUsageSnapshot } from "./openaiCompatibleAdapter.js";
export type { ResearchAdapter, ResearchAdapterKind } from "./researchAdapter.js";
export { getResearchAdapter, setResearchAdapter } from "./researchAdapter.js";
export { TavilyResearchAdapter, type TavilyResearchAdapterOptions } from "./tavilyResearchAdapter.js";
export {
  buildDesignRecipeInstruction,
  buildKimiDesignKnowledgeInstruction,
  assembleKimiDesignKnowledge,
  clearKimiDesignKnowledgeCache,
  compileKimiDesignBrief,
  compileKimiDesignBriefForSlide,
  designRecipeMeta,
  formatKimiDesignBrief,
  inspectKimiDesignKnowledgeCatalog,
  selectDesignRecipe,
  validateSvgAgainstDesignRecipe,
  validateSvgSpatialQuality,
  DESIGN_RECIPES,
  SHAPE_GRAMMAR,
  type DesignRecipe,
  type DesignRecipeId,
  type DesignRecipeSelection,
  type DesignZone,
  type KimiCatalogSummary,
  type KimiCompiledDesignBrief,
  type KimiDesignKnowledgeBundle,
  type KimiDesignKnowledgeConstraints,
  type KimiDesignKnowledgeRequest,
  type KimiLayoutArchetype,
  type KimiKnowledgeOutputDialect,
  type SvgSpatialQualityResult,
  type SvgVisualQualityResult
} from "./designKnowledge/index.js";
export {
  parallelMap,
  resolveConcurrency,
  resolveSearchConcurrency,
  type ParallelMapOptions,
  type ParallelMapResult
} from "./parallelMap.js";
export {
  PIPELINE_STAGES,
  roleLabel,
  stageDef,
  type PipelineStageDef,
  type PipelineStageId,
  type StageAgentRole
} from "./stageGraph.js";
export {
  createGrokSidecarOrchestrationBackend,
  createNativeOrchestrationBackend,
  createOrchestrationBackend,
  resolveOrchestrationBackendKind,
  type GrokSidecarConfig,
  type OrchestrationBackend,
  type OrchestrationBackendKind,
  type OrchestrationHookEvent,
  type OrchestrationHookListener,
  type OrchestrationHookPayload,
  type PageFanOutOptions
} from "./orchestration/index.js";
