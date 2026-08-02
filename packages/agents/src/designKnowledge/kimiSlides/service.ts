import type {
  PresentationStyleId,
  PptExportTheme,
  SlideDto
} from "@ppt-agent/shared";
import {
  clearKimiKnowledgeCatalogCache,
  loadKimiKnowledgeCatalog,
  resolveKimiSkillRoot
} from "./catalog.js";
import {
  selectKimiCategory,
  selectKimiDesignSystem
} from "./classifier.js";
import {
  assembleKimiPromptBundle,
  unavailableKimiDesignKnowledgeBundle
} from "./promptAssembler.js";
import {
  compileKimiDesignBrief,
  formatKimiDesignBrief
} from "./designBrief.js";
import type {
  KimiCatalogSummary,
  KimiDesignKnowledgeBundle,
  KimiDesignKnowledgeRequest,
  KimiKnowledgeOutputDialect
} from "./types.js";
import { requestFromSlide } from "./types.js";

export function assembleKimiDesignKnowledge(
  request: KimiDesignKnowledgeRequest
): KimiDesignKnowledgeBundle {
  const root = resolveKimiSkillRoot(request.knowledgeRoot);
  if (!root) {
    return unavailableKimiDesignKnowledgeBundle(
      request,
      "未找到 Kimi Slides 知识目录，已回落到内置设计知识"
    );
  }
  try {
    const catalog = loadKimiKnowledgeCatalog(root);
    const category = selectKimiCategory(request, catalog);
    const designSystem = selectKimiDesignSystem(request, catalog, category);
    return assembleKimiPromptBundle(request, catalog, category, designSystem);
  } catch (error) {
    return unavailableKimiDesignKnowledgeBundle(
      request,
      `Kimi Slides 知识服务不可用，已回落到内置设计知识：${error instanceof Error ? error.message : "未知错误"}`
    );
  }
}

export function buildKimiDesignKnowledgeInstruction(
  slide: SlideDto,
  theme: PptExportTheme | string | null | undefined,
  presentationStyle: PresentationStyleId | string | null | undefined,
  outputDialect: KimiKnowledgeOutputDialect
) {
  const request = requestFromSlide(slide, theme, presentationStyle, outputDialect);
  const bundle = assembleKimiDesignKnowledge(request);
  if (bundle.prompt) return bundle.prompt;
  return [
    "# 内置编译设计指令",
    "外置 Kimi Slides 资料不可用；继续执行系统根据页面语义编译出的唯一结构化蓝图。",
    formatKimiDesignBrief(compileKimiDesignBrief(request))
  ].join("\n");
}

export function compileKimiDesignBriefForSlide(
  slide: SlideDto,
  theme: PptExportTheme | string | null | undefined,
  presentationStyle: PresentationStyleId | string | null | undefined,
  outputDialect: KimiKnowledgeOutputDialect = "smartslide"
) {
  return compileKimiDesignBrief(
    requestFromSlide(slide, theme, presentationStyle, outputDialect)
  );
}

export function inspectKimiDesignKnowledgeCatalog(
  knowledgeRoot?: string
): KimiCatalogSummary {
  const root = resolveKimiSkillRoot(knowledgeRoot);
  if (!root) {
    return {
      available: false,
      root: null,
      categories: [],
      designSystems: [],
      warnings: ["未找到 Kimi Slides 知识目录"]
    };
  }
  try {
    const catalog = loadKimiKnowledgeCatalog(root);
    return {
      available: true,
      root,
      categories: catalog.categories.map(({ id, title }) => ({ id, title })),
      designSystems: catalog.designSystems.map(({ id, title }) => ({ id, title })),
      warnings: catalog.warnings
    };
  } catch (error) {
    return {
      available: false,
      root,
      categories: [],
      designSystems: [],
      warnings: [error instanceof Error ? error.message : "知识目录读取失败"]
    };
  }
}

export function clearKimiDesignKnowledgeCache() {
  clearKimiKnowledgeCatalogCache();
}

export { compileKimiDesignBrief, formatKimiDesignBrief };
export {
  selectColorPalettesForScene,
  formatColorPaletteRecommendation,
  SCENE_COLOR_GROUPS
} from "./colorPalettes.js";
export type {
  KimiCompiledDesignBrief,
  KimiLayoutArchetype
} from "./designBrief.js";
export type {
  SceneColorPalette,
  SceneColorGroup
} from "./colorPalettes.js";
export type {
  KimiCatalogSummary,
  KimiDesignKnowledgeBundle,
  KimiDesignKnowledgeConstraints,
  KimiDesignKnowledgeRequest,
  KimiKnowledgeOutputDialect
} from "./types.js";
