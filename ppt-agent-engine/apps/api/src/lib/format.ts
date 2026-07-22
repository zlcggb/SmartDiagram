import path from "node:path";
import type {
  BriefJson,
  ExportDto,
  ExportMode,
  FactDto,
  PageRenderResult,
  ProjectDto,
  ProjectMode,
  ResearchJson,
  RenderStrategy,
  SlideDto,
  SlideGenerationStatus,
  SlideIrDto,
  SlidePlanDto,
  SlideSearchJson,
  SourceTextDto
} from "@ppt-agent/shared";
import { inferRenderStrategy, renderStrategies, SlideIrSchema } from "@ppt-agent/shared";
import { exportDownloadUrl } from "./paths.js";

type DateLike = Date | string;

function toIso(value: DateLike) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseSlidePlan(value: string | null): SlidePlanDto | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as SlidePlanDto;
  } catch {
    return null;
  }
}

function parseSlideIr(value: string | null): SlideIrDto | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = SlideIrSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function resolveStoredRenderStrategy(
  value: string | null | undefined,
  slide: { title: string; recommendedLayout: string; planJson: SlidePlanDto | null }
): RenderStrategy {
  if (value && (renderStrategies as readonly string[]).includes(value)) {
    return value as RenderStrategy;
  }
  return inferRenderStrategy({
    title: slide.title,
    recommendedLayout: slide.recommendedLayout,
    planJson: slide.planJson
  });
}

function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function formatProject(project: {
  id: string;
  name: string;
  reportType: string;
  audience: string;
  purpose: string;
  pageCount: number;
  theme: string;
  mode?: string | null;
  topic?: string | null;
  briefJson?: string | null;
  researchJson?: string | null;
  createdAt: DateLike;
  updatedAt: DateLike;
}): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    reportType: project.reportType,
    audience: project.audience,
    purpose: project.purpose,
    pageCount: project.pageCount,
    theme: project.theme,
    mode: (project.mode === "topic" ? "topic" : "paste") as ProjectMode,
    topic: project.topic ?? null,
    briefJson: parseJsonObject<BriefJson>(project.briefJson ?? null),
    researchJson: parseJsonObject<ResearchJson>(project.researchJson ?? null),
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt)
  };
}

export function formatSourceText(sourceText: {
  id: string;
  projectId: string;
  content: string;
  createdAt: DateLike;
}): SourceTextDto {
  return {
    id: sourceText.id,
    projectId: sourceText.projectId,
    content: sourceText.content,
    createdAt: toIso(sourceText.createdAt)
  };
}

export function formatFact(fact: {
  id: string;
  projectId: string;
  category: string;
  content: string;
  status: string;
  confidence: number;
  sourceText: string;
  sourceLocation: string;
  canUseInPpt: boolean;
  createdAt: DateLike;
}): FactDto {
  return {
    id: fact.id,
    projectId: fact.projectId,
    category: fact.category as FactDto["category"],
    content: fact.content,
    status: fact.status as FactDto["status"],
    confidence: fact.confidence,
    sourceText: fact.sourceText,
    sourceLocation: fact.sourceLocation,
    canUseInPpt: fact.canUseInPpt,
    createdAt: toIso(fact.createdAt)
  };
}

export function formatSlide(slide: {
  id: string;
  projectId: string;
  sortOrder: number;
  title: string;
  slideGoal: string;
  keyMessage: string;
  contentPoints: string;
  recommendedLayout: string;
  status: string;
  isContentLocked: boolean;
  isLayoutLocked: boolean;
  planJson: string | null;
  irJson: string | null;
  svgPreview: string | null;
  searchJson?: string | null;
  partTitle?: string | null;
  generationStatus: string;
  renderStrategy?: string | null;
  strategyLocked?: boolean | null;
  slideSources?: Array<{ factId: string }>;
}): SlideDto {
  const planJson = parseSlidePlan(slide.planJson);
  return {
    id: slide.id,
    projectId: slide.projectId,
    sortOrder: slide.sortOrder,
    title: slide.title,
    slideGoal: slide.slideGoal,
    keyMessage: slide.keyMessage,
    contentPoints: parseStringArray(slide.contentPoints),
    recommendedLayout: slide.recommendedLayout,
    status: slide.status as SlideDto["status"],
    isContentLocked: slide.isContentLocked,
    isLayoutLocked: slide.isLayoutLocked,
    sourceFactIds: slide.slideSources?.map((source) => source.factId) ?? [],
    planJson,
    irJson: parseSlideIr(slide.irJson),
    svgPreview: slide.svgPreview,
    searchJson: parseJsonObject<SlideSearchJson>(slide.searchJson ?? null),
    partTitle: slide.partTitle ?? null,
    generationStatus: slide.generationStatus as SlideGenerationStatus,
    renderStrategy: resolveStoredRenderStrategy(slide.renderStrategy, {
      title: slide.title,
      recommendedLayout: slide.recommendedLayout,
      planJson
    }),
    strategyLocked: Boolean(slide.strategyLocked)
  };
}

export function formatExport(
  exportRecord: {
    id: string;
    projectId: string;
    versionName: string;
    pptxPath: string;
    createdAt: DateLike;
  },
  extras?: {
    mode?: ExportMode;
    warnings?: string[];
    pageResults?: PageRenderResult[];
  }
): ExportDto {
  const pptxPath = path.normalize(exportRecord.pptxPath);
  return {
    id: exportRecord.id,
    projectId: exportRecord.projectId,
    versionName: exportRecord.versionName,
    pptxPath,
    downloadUrl: exportDownloadUrl(pptxPath),
    createdAt: toIso(exportRecord.createdAt),
    ...(extras?.mode !== undefined ? { mode: extras.mode } : {}),
    ...(extras?.warnings !== undefined ? { warnings: extras.warnings } : {}),
    ...(extras?.pageResults !== undefined ? { pageResults: extras.pageResults } : {})
  };
}
