import type { PresentationStyleId, PptExportTheme, SlideDto } from "@ppt-agent/shared";

export type KimiKnowledgeOutputDialect = "svg" | "smartslide";

export interface KimiDesignKnowledgeRequest {
  topic?: string;
  title?: string;
  pageType?: string;
  slideGoal?: string;
  theme?: PptExportTheme | string | null;
  presentationStyle?: PresentationStyleId | string | null;
  contentBlocks?: unknown[];
  visualHint?: unknown;
  outputDialect: KimiKnowledgeOutputDialect;
  maxPromptChars?: number;
  knowledgeRoot?: string;
}

export interface KimiKnowledgeCatalogEntry {
  id: string;
  title: string;
  absolutePath: string;
  relativePath: string;
  content: string;
}

export interface KimiKnowledgeCatalog {
  root: string;
  generalRules: string;
  fontRules: string;
  categories: KimiKnowledgeCatalogEntry[];
  designSystems: KimiKnowledgeCatalogEntry[];
  warnings: string[];
}

export interface KimiKnowledgeSelection {
  entry: KimiKnowledgeCatalogEntry;
  score: number;
  signals: string[];
}

export interface KimiDesignKnowledgeConstraints {
  density: "low" | "medium" | "high";
  focalPoints: number;
  maxMainGroups: number;
  forbiddenPatterns: string[];
}

export interface KimiDesignKnowledgeBundle {
  available: boolean;
  category: {
    id: string;
    title: string;
    score: number;
    signals: string[];
  } | null;
  designSystem: {
    id: string;
    title: string;
    score: number;
    signals: string[];
  } | null;
  prompt: string;
  constraints: KimiDesignKnowledgeConstraints;
  sources: string[];
  fingerprint: string;
  warnings: string[];
}

export interface KimiCatalogSummary {
  available: boolean;
  root: string | null;
  categories: Array<{ id: string; title: string }>;
  designSystems: Array<{ id: string; title: string }>;
  warnings: string[];
}

export function requestFromSlide(
  slide: SlideDto,
  theme: PptExportTheme | string | null | undefined,
  presentationStyle: PresentationStyleId | string | null | undefined,
  outputDialect: KimiKnowledgeOutputDialect
): KimiDesignKnowledgeRequest {
  return {
    topic: [
      slide.title,
      slide.keyMessage,
      ...(slide.contentPoints ?? [])
    ].filter(Boolean).join(" "),
    title: slide.planJson?.title || slide.title,
    pageType: slide.recommendedLayout || slide.planJson?.layoutType || "content",
    slideGoal: slide.slideGoal,
    theme,
    presentationStyle,
    contentBlocks: slide.planJson?.contentBlocks ?? [],
    visualHint: slide.planJson?.visualHint,
    outputDialect
  };
}
