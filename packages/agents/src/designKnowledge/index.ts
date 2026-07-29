export { buildDesignRecipeInstruction, designRecipeMeta } from "./assembler.js";
export { selectDesignRecipe } from "./selector.js";
export { DESIGN_RECIPES, getDesignRecipe } from "./templates.js";
export { SHAPE_GRAMMAR, SVG_EDITABILITY_CONTRACT, VISUAL_ANTI_PATTERNS } from "./shapeGrammar.js";
export { validateSvgAgainstDesignRecipe, type SvgVisualQualityResult } from "./visualQuality.js";
export { validateSvgSpatialQuality, type SvgSpatialQualityResult } from "./svgSpatialQuality.js";
export {
  assembleKimiDesignKnowledge,
  buildKimiDesignKnowledgeInstruction,
  clearKimiDesignKnowledgeCache,
  compileKimiDesignBrief,
  compileKimiDesignBriefForSlide,
  formatKimiDesignBrief,
  inspectKimiDesignKnowledgeCatalog
} from "./kimiSlides/service.js";
export type {
  KimiCompiledDesignBrief,
  KimiCatalogSummary,
  KimiDesignKnowledgeBundle,
  KimiDesignKnowledgeConstraints,
  KimiDesignKnowledgeRequest,
  KimiLayoutArchetype,
  KimiKnowledgeOutputDialect
} from "./kimiSlides/service.js";
export type { DesignRecipe, DesignRecipeId, DesignRecipeSelection, DesignZone } from "./types.js";
