import path from "node:path";
import type { FastifyInstance } from "fastify";
import { renderProjectPptx } from "@ppt-agent/ppt-renderer";
import {
  briefAnswerSchema,
  createBlankSlideSchema,
  createFactSchema,
  createProjectSchema,
  effectiveRenderStrategy,
  exportPptxSchema,
  extractFactsRequestSchema,
  fitSvgTextToBounds,
  getBannedSvgFeatures,
  getSvgTextBoxIssues,
  inferRenderStrategy,
  getThemePack,
  missingStudioPrerequisite,
  normalizePresentationStyleId,
  normalizePptExportTheme,
  reorderSlidesSchema,
  renderStrategies,
  shouldGenerateSvgForMode,
  sourceTextSchema,
  studioStageLabel,
  updateFactSchema,
  updateProjectSchema,
  updateSlideSchema,
  validateSvgThemeCompliance,
  withEditableGrades
} from "@ppt-agent/shared";
import type {
  ExportMode,
  FactDto,
  PageRenderResult,
  PresentationStyleId,
  ProjectDetailDto,
  PptExportTheme,
  RenderStrategy,
  SlideDto,
  SvgQualityFailureDto,
  ThemeSurfaceId
} from "@ppt-agent/shared";
import { createAiAdapter } from "../lib/ai.js";
import { buildExportUsageSummary, recordExportUsageSummary } from "../lib/aiUsage.js";
import {
  buildConfirmedBrief,
  buildFactExtractionContext,
  selectAllExtractedFacts
} from "../lib/intentContext.js";
import { formatExport, formatFact, formatProject, formatSlide, formatSourceText } from "../lib/format.js";
import { exportsDir } from "../lib/paths.js";
import { prisma } from "../lib/prisma.js";
import { fail, ok } from "../lib/response.js";
import {
  getResearchAdapter,
  resolveConcurrency,
  resolveSearchConcurrency,
  validateSvgAgainstDesignRecipe
} from "@ppt-agent/agents";
import { getOrchestrationBackend } from "../lib/orchestration.js";
import { emitProgress, emitSlideProgress, type ProgressEvent } from "../lib/progressEmitter.js";
import { createKnowledgeGateway, KnowledgeGatewayError } from "../lib/knowledgeGateway.js";
import {
  MaterialsNotReadyError,
  assertMaterialsReady,
  buildContextBundle,
  extractResolvedFactsFromContext,
  loadMaterialContextSources,
  parseFactEvidenceJson
} from "../lib/materialContext.js";
import {
  formatProjectMaterialGatewayFailure,
  formatStoredProjectMaterial
} from "./materials.js";
import { getPptPrincipal } from "../lib/pptAuthorization.js";
import { projectOwnerData, projectOwnerWhere } from "../lib/pptAccess.js";
import {
  clearSlideDesignVersions,
  persistSlideDesignVersion
} from "../lib/slideDesignVersions.js";
import {
  resolveSvgGenerationFailure,
  SvgQualityValidationError
} from "../lib/svgGenerationError.js";

const adapter = createAiAdapter();
const orchestration = getOrchestrationBackend();
const knowledgeGateway = createKnowledgeGateway();

type IdParams = { id: string };
type FactParams = { id: string; factId: string };
type SlideParams = { id: string; slideId: string };
type DesignGenerationOptions = {
  accentId?: string | null;
  surfaceId?: ThemeSurfaceId | string | null;
  presentationStyle?: PresentationStyleId | string | null;
};

async function resolveEffectivePresentationStyle(
  projectId: string,
  slideStyle?: PresentationStyleId | string | null,
  requestedStyle?: PresentationStyleId | string | null
) {
  if (slideStyle) return normalizePresentationStyleId(slideStyle);
  if (requestedStyle) return normalizePresentationStyleId(requestedStyle);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { presentationStyle: true }
  });
  return normalizePresentationStyleId(project?.presentationStyle);
}

function asJsonPoints(points: string[]) {
  return JSON.stringify(points.filter((point) => point.trim().length > 0));
}

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "project";
}

function aiFailMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "AI 服务暂时不可用";
  return `AI 生成失败：${message}`;
}

function formatFactWithEvidence(
  fact: Parameters<typeof formatFact>[0] & { evidenceJson?: string | null }
): FactDto {
  const formatted = formatFact(fact);
  const evidence = parseFactEvidenceJson(fact.evidenceJson);
  return evidence.length > 0 ? { ...formatted, evidence } : formatted;
}

function materialContextBatchChars() {
  const configured = Number(process.env.MATERIAL_CONTEXT_BATCH_CHARS ?? 48_000);
  return Number.isFinite(configured) ? Math.max(8_000, Math.min(120_000, Math.trunc(configured))) : 48_000;
}

/** 在慢速 AI 调用期间周期性发送 progress 心跳，避免前端长时间静止 */
function emitProgressHeartbeat(
  projectId: string,
  stage: "brief" | "research" | "outline" | "search" | "plan" | "design" | "ir" | "export" | "pipeline",
  messages: string[],
  intervalMs = 2500
) {
  let index = 0;
  const timer = setInterval(() => {
    const message = messages[index % messages.length] ?? "处理中…";
    emitProgress(projectId, { stage, status: "progress", message });
    index += 1;
  }, intervalMs);
  return { clear: () => clearInterval(timer) };
}

/** 把流式 token 攒成小片段再推给前端，避免 SSE 过于频繁 */
function createStreamingTokenHandler(
  projectId: string,
  stage: ProgressEvent["stage"],
  throttleMs = 200,
  options: { subStage?: string; slideId?: string; slideTitle?: string } = {}
) {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (buffer) {
      emitProgress(projectId, {
        stage,
        status: "progress",
        message: "生成中…",
        delta: buffer,
        subStage: options.subStage,
        slideId: options.slideId,
        slideTitle: options.slideTitle
      });
      buffer = "";
    }
    timer = null;
  }

  return {
    onToken: (token: string) => {
      buffer += token;
      if (!timer) {
        timer = setTimeout(flush, throttleMs);
      }
    },
    flush
  };
}

function linkedFactsForSlide(slide: SlideDto, facts: FactDto[]) {
  const linked = facts.filter((fact) => slide.sourceFactIds.includes(fact.id));
  return linked.length > 0 ? linked : facts.filter((fact) => fact.canUseInPpt).slice(0, 6);
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeSvgText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizedCorpus(slide: SlideDto, facts: FactDto[]) {
  return JSON.stringify({
    title: slide.title,
    slideGoal: slide.slideGoal,
    keyMessage: slide.keyMessage,
    contentPoints: slide.contentPoints,
    planJson: slide.planJson,
    facts: facts.map((fact) => fact.content)
  }).replace(/\s+/g, "");
}

function milestoneTextFromFacts(facts: FactDto[]) {
  const corpus = facts.map((fact) => fact.content).join("\n");
  const match = corpus.match(/\d{1,2}\s*月\s*\d{1,2}\s*日/);
  return match?.[0].replace(/\s+/g, "") ?? "";
}

function collectSvgTexts(svgPreview: string) {
  return [...svgPreview.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => stripXmlTags(match[1] ?? ""))
    .filter(Boolean);
}

function validateSvgPreview(
  svgPreview: string,
  slide: SlideDto,
  theme: PptExportTheme,
  presentationStyle?: PresentationStyleId | string | null
) {
  const issues: string[] = [];
  if (!/viewBox=["']0 0 1280 720["']/i.test(svgPreview)) {
    issues.push("SVG viewBox 必须是 0 0 1280 720");
  }

  const banned = getBannedSvgFeatures(svgPreview);
  if (banned.length > 0) {
    issues.push(`含禁止的可编译特性：${banned.join(", ")}`);
  }

  const textBoxIssues = getSvgTextBoxIssues(svgPreview);
  if (textBoxIssues.length > 0) {
    issues.push(
      ...textBoxIssues
        .slice(0, 8)
        .map((issue) => `文字框边界：${issue}`)
    );
  }

  const visualQuality = validateSvgAgainstDesignRecipe(
    svgPreview,
    slide,
    presentationStyle
  );
  issues.push(...visualQuality.issues.map((issue) => `视觉配方 ${visualQuality.recipeId}：${issue}`));

  const themeQuality = validateSvgThemeCompliance(svgPreview, theme);
  issues.push(...themeQuality.issues.map((issue) => `主题契约：${issue}`));

  const texts = collectSvgTexts(svgPreview);
  if (texts.length < 3) {
    issues.push("页面正文过少，无法形成完整 PPT 页面");
  }

  if (texts.some((text) => /(\.\.\.|…)$/.test(text.trim()))) {
    issues.push("页面存在疑似截断文本");
  }

  const repeated = new Set<string>();
  const seen = new Set<string>();
  for (const text of texts) {
    const normalized = text.replace(/\s+/g, "");
    if (normalized.length < 10) {
      continue;
    }
    if (seen.has(normalized)) {
      repeated.add(text);
    }
    seen.add(normalized);
  }
  if (repeated.size > 0) {
    issues.push("页面存在重复文本或重复事实");
  }

  return issues;
}

function sanitizeSvgPreviewText(svgPreview: string, slide: SlideDto, facts: FactDto[]) {
  const corpus = normalizedCorpus(slide, facts);
  const milestone = milestoneTextFromFacts(facts);

  return svgPreview.replace(/(<text\b[^>]*>)([\s\S]*?)(<\/text>)/gi, (full, open: string, inner: string, close: string) => {
    const plain = stripXmlTags(inner);
    const normalizedPlain = plain.replace(/\s+/g, "");
    let next = plain;

    if (/20\d{2}[.\-/年]/.test(plain) && !corpus.includes(normalizedPlain)) {
      next = plain.replace(/\s*[|—-]\s*.*20\d{2}.*$/g, "").replace(/\s*#\S+/g, "").trim() || "项目周报";
    }

    if (/#\S+/.test(next) && !corpus.includes(next.replace(/\s+/g, ""))) {
      next = next.replace(/\s*#\S+/g, "").trim() || "项目周报";
    }

    if (/^[A-Za-z][A-Za-z0-9\s|:/#().-]{10,}$/.test(next) && !corpus.includes(next.replace(/\s+/g, ""))) {
      next = "";
    }

    if (/倒计时|距离.*节点/.test(next) && !/倒计时|距离.*节点/.test(corpus)) {
      next = milestone ? "试运行节点" : "关键节点";
    }

    if (/^\d+\s*页$/.test(next.trim()) && !corpus.includes(normalizedPlain)) {
      next = milestone || slide.keyMessage || "待确认";
    }

    return next === plain ? full : `${open}${escapeSvgText(next)}${close}`;
  });
}

async function generateValidatedSvgPreview(
  slide: SlideDto,
  facts: FactDto[],
  theme: PptExportTheme,
  onToken?: (token: string) => void,
  options?: DesignGenerationOptions
) {
  const presentationStyle = normalizePresentationStyleId(
    slide.presentationStyle ?? options?.presentationStyle
  );
  let lastIssues: string[] = [];
  let previousSvg: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rawSvgPreview = await adapter.generateSvgPreview(slide, facts, theme, onToken, {
      revisionNotes: attempt > 0 ? lastIssues : undefined,
      previousSvg: attempt > 0 ? previousSvg : undefined,
      accentId: options?.accentId,
      surfaceId: options?.surfaceId,
      presentationStyle
    });
    const sanitizedSvgPreview = sanitizeSvgPreviewText(rawSvgPreview, slide, facts);
    const { svg: svgPreview } = fitSvgTextToBounds(sanitizedSvgPreview);
    const issues = validateSvgPreview(
      svgPreview,
      slide,
      theme,
      presentationStyle
    );
    if (issues.length === 0) {
      return svgPreview;
    }
    lastIssues = issues;
    previousSvg = svgPreview;
  }
  throw new SvgQualityValidationError(lastIssues, previousSvg ?? "", 2);
}

async function generatePlanForSlide(slide: SlideDto, facts: FactDto[], theme?: string | null) {
  return slide.planJson ?? (await adapter.generateSlidePlan(slide, facts, normalizePptExportTheme(theme)));
}

function isValidRenderStrategy(value: string | null | undefined): value is RenderStrategy {
  return Boolean(value && (renderStrategies as readonly string[]).includes(value));
}

function computeRenderStrategy(slide: {
  title?: string | null;
  recommendedLayout?: string | null;
  planJson?: { layoutType?: string | null } | null;
  renderStrategy?: RenderStrategy | null;
}): RenderStrategy {
  return inferRenderStrategy(slide);
}

/**
 * 解析下一版策略：
 * - strategyLocked + 已有策略 → 保留（不被 layout/plan 重算覆盖）
 * - 否则按 hint 重新推断（不带旧策略，避免永远钉死自动推断值）
 */
function resolveNextStrategy(
  slide: { renderStrategy?: RenderStrategy | null; strategyLocked?: boolean | null },
  hint: {
    title?: string | null;
    recommendedLayout?: string | null;
    planJson?: { layoutType?: string | null } | null;
  }
): RenderStrategy {
  if (slide.strategyLocked && isValidRenderStrategy(slide.renderStrategy)) {
    return slide.renderStrategy;
  }
  return inferRenderStrategy(hint);
}

async function persistRenderStrategy(slideId: string, strategy: RenderStrategy): Promise<void> {
  await prisma.slide.update({
    where: { id: slideId },
    data: { renderStrategy: strategy }
  });
}

async function ensureSlidePlan(
  slide: SlideDto,
  facts: FactDto[],
  theme: PptExportTheme
): Promise<SlideDto> {
  const strategy = resolveNextStrategy(slide, slide);

  if (slide.planJson) {
    await persistRenderStrategy(slide.id, strategy).catch(() => undefined);
    return { ...slide, renderStrategy: strategy };
  }

  try {
    const slideFacts = linkedFactsForSlide(slide, facts);
    const plan = await generatePlanForSlide(slide, slideFacts, theme);
    const nextStrategy = resolveNextStrategy(slide, { ...slide, planJson: plan });
    const updatedSlide = await prisma.slide.update({
      where: { id: slide.id },
      data: {
        planJson: JSON.stringify(plan),
        status: "planned",
        generationStatus: slide.svgPreview ? "svg-ready" : "draft-ready",
        renderStrategy: nextStrategy
      },
      include: { slideSources: true }
    });
    return formatSlide(updatedSlide);
  } catch {
    if (!slide.renderStrategy) {
      await persistRenderStrategy(slide.id, strategy).catch(() => undefined);
      return { ...slide, renderStrategy: strategy };
    }
    return slide;
  }
}

async function generateEditableSvgDesign(
  projectId: string,
  slide: SlideDto,
  facts: FactDto[],
  theme: PptExportTheme,
  options?: DesignGenerationOptions
) {
  if (slide.projectId !== projectId) {
    throw new Error("页面不属于当前项目，无法生成设计。");
  }

  const slideFacts = linkedFactsForSlide(slide, facts);
  const presentationStyle = await resolveEffectivePresentationStyle(
    projectId,
    slide.presentationStyle,
    options?.presentationStyle
  );
  let slideForDesign = slide;

  const plan = await generatePlanForSlide(slideForDesign, slideFacts, theme);
  if (!slideForDesign.planJson) {
    const plannedSlide = await prisma.slide.update({
      where: { id: slideForDesign.id },
      data: {
        planJson: JSON.stringify(plan),
        status: "planned",
        generationStatus: "draft-ready"
      },
      include: { slideSources: true }
    });
    slideForDesign = formatSlide(plannedSlide);
  }

  const slideWithPlan = { ...slideForDesign, planJson: plan };

  const designStreamHandler = createStreamingTokenHandler(projectId, "design", 200, {
    slideId: slideForDesign.id,
    slideTitle: slideForDesign.title,
    subStage: slideForDesign.title
  });
  let svgPreview: string;
  try {
    emitProgress(projectId, { stage: "design", status: "start", message: `正在设计「${slideForDesign.title}」…`, slideId: slideForDesign.id, slideTitle: slideForDesign.title, subStage: slideForDesign.title, clearDelta: true });
    svgPreview = await generateValidatedSvgPreview(
      slideWithPlan,
      slideFacts,
      theme,
      designStreamHandler.onToken,
      { ...options, presentationStyle }
    );
    designStreamHandler.flush();
    emitProgress(projectId, { stage: "design", status: "done", message: `设计完成：${slideForDesign.title}`, slideId: slideForDesign.id, slideTitle: slideForDesign.title, subStage: slideForDesign.title });
  } catch (error) {
    designStreamHandler.flush();
    emitProgress(projectId, {
      stage: "design",
      status: "error",
      message: aiFailMessage(error),
      slideId: slideForDesign.id,
      slideTitle: slideForDesign.title,
      subStage: slideForDesign.title
    });
    throw error;
  }

  const updatedSlide = await persistSlideDesignVersion({
    projectId,
    slideId: slideForDesign.id,
    svgPreview,
    source: "ai",
    theme,
    accentId: options?.accentId,
    surfaceId: options?.surfaceId,
    presentationStyle,
    slidePatch: {
      planJson: JSON.stringify(plan),
      status: "planned",
      generationStatus: "svg-ready",
      renderStrategy: "svg",
      strategyLocked: false
    }
  });

  return formatSlide(updatedSlide);
}

function exportModeLabel(mode: ExportMode) {
  if (mode === "draft") return "快速草稿";
  if (mode === "visual") return "高视觉版";
  return "标准版";
}

async function prepareSlidesForExport(
  projectId: string,
  slides: SlideDto[],
  facts: FactDto[],
  theme: PptExportTheme,
  mode: ExportMode,
  log: { warn: (error: unknown, msg: string) => void; error: (error: unknown, msg: string) => void },
  fillMissing = false
) {
  const prepared: SlideDto[] = [];
  const notes: string[] = [];
  let svgAttempts = 0;
  let svgFailures = 0;

  for (const [index, slide] of slides.entries()) {
    const pageLabel = `第 ${index + 1} 页`;
    const baseStrategy = resolveNextStrategy(slide, slide);
    const strategy = effectiveRenderStrategy({ ...slide, renderStrategy: baseStrategy }, mode);

    // 导出前写回策略（锁定页保留；未锁定可按 layout 补齐）
    await persistRenderStrategy(slide.id, baseStrategy).catch(() => undefined);

    // 显式导出：不自动生成缺失稿，避免「点导出却跑完全部策划/出图」
    if (!fillMissing) {
      prepared.push({ ...slide, renderStrategy: baseStrategy });
      if (!slide.svgPreview) {
        notes.push(`${pageLabel} 尚未生成设计稿，将走主题模板（未自动补齐）`);
      } else if (!slide.svgPreview && mode === "standard") {
        notes.push(`${pageLabel} 无 SVG，标准导出将走已有 IR/主题模板`);
      }
      continue;
    }

    if (mode === "draft") {
      const withPlan = await ensureSlidePlan(slide, facts, theme);
      prepared.push({ ...withPlan, renderStrategy: withPlan.renderStrategy ?? baseStrategy });
      if (!withPlan.svgPreview) {
        notes.push(`${pageLabel} 草稿模式未生成设计稿，将走主题模板`);
      }
      continue;
    }

    let current: SlideDto = { ...slide, renderStrategy: baseStrategy };
    const bannedExisting = current.svgPreview ? getBannedSvgFeatures(current.svgPreview) : [];
    // visual：尽量补 SVG；standard：缺/违规 SVG 时不强制调设计模型（降级 IR），与 generate-* 分流一致
    const shouldGenerateSvg =
      mode === "visual" && shouldGenerateSvgForMode(current, mode) && (!current.svgPreview || bannedExisting.length > 0);

    if (shouldGenerateSvg) {
      svgAttempts += 1;
      try {
        current = await generateEditableSvgDesign(projectId, current, facts, theme);
      } catch (error) {
        svgFailures += 1;
        const message = error instanceof Error ? error.message : "未知错误";
        notes.push(`${pageLabel} SVG 生成失败，将走主题模板：${message}`);
        log.warn(error, `Export visual SVG generate failed for slide ${slide.id}`);
        current = await ensureSlidePlan(current, facts, theme);
      }
    } else if (!current.svgPreview && mode === "standard") {
      current = await ensureSlidePlan(current, facts, theme);
      notes.push(`${pageLabel} 无 SVG，标准导出将走主题模板`);
    } else if (bannedExisting.length > 0 && mode === "standard") {
      current = await ensureSlidePlan(current, facts, theme);
      notes.push(`${pageLabel} SVG 含禁止特性（${bannedExisting.join(", ")}），标准导出将降级`);
    } else if (!current.planJson) {
      current = await ensureSlidePlan(current, facts, theme);
    }

    prepared.push({ ...current, renderStrategy: current.renderStrategy ?? baseStrategy });
  }

  return { prepared, notes, svgAttempts, svgFailures };
}

async function projectDetail(projectId: string): Promise<ProjectDetailDto | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      sourceTexts: { orderBy: { createdAt: "desc" }, take: 1 },
      facts: { orderBy: { createdAt: "asc" } },
      slides: { orderBy: { sortOrder: "asc" }, include: { slideSources: true } },
      exports: { orderBy: { createdAt: "desc" } },
      materials: { orderBy: { createdAt: "asc" } }
    }
  });

  if (!project) {
    return null;
  }

  return {
    project: formatProject(project),
    latestSourceText: project.sourceTexts[0] ? formatSourceText(project.sourceTexts[0]) : null,
    facts: project.facts.map(formatFactWithEvidence),
    slides: project.slides.map(formatSlide),
    exports: project.exports.map((item) => formatExport(item)),
    materials: project.materials.map((item) => formatStoredProjectMaterial(item))
  };
}

async function findProjectOr404(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  return project ? formatProject(project) : null;
}

async function getProjectFacts(projectId: string): Promise<FactDto[]> {
  const facts = await prisma.fact.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" }
  });
  return facts.map(formatFactWithEvidence);
}

async function getProjectSlides(projectId: string) {
  const slides = await prisma.slide.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    include: { slideSources: true }
  });
  return slides.map(formatSlide);
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async (request, reply) => {
    try {
      const principal = getPptPrincipal(request);
      if (principal.kind === "internal") {
        return reply.status(403).send(fail("内部服务不能列出项目"));
      }
      // 访客历史由浏览器 IndexedDB 提供；服务端只保存短期运行副本。
      if (principal.kind === "guest") {
        return reply.send(ok([]));
      }
      const projects = await prisma.project.findMany({
        where: projectOwnerWhere(principal),
        orderBy: { updatedAt: "desc" },
        take: 40
      });
      return reply.send(ok(projects.map(formatProject)));
    } catch (error) {
      app.log.error(error, "List projects failed");
      return reply.status(503).send(fail("项目列表加载失败，请检查数据库连接。"));
    }
  });

  app.post("/api/projects", async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    try {
      const principal = getPptPrincipal(request);
      if (principal.kind === "internal") {
        return reply.status(403).send(fail("内部服务不能创建项目"));
      }
      if (principal.kind === "guest") {
        await prisma.project.deleteMany({
          where: { ownerType: "guest", expiresAt: { lte: new Date() } }
        });
      }
      const project = await prisma.project.create({
        data: {
          ...projectOwnerData(principal),
          name: input.name,
          reportType: input.reportType,
          audience: input.audience,
          purpose: input.purpose,
          pageCount: input.pageCount,
          theme: input.theme,
          presentationStyle: input.presentationStyle,
          mode: input.mode,
          topic: input.topic ?? (input.mode === "topic" ? input.name : null)
        }
      });
      return reply.send(ok(formatProject(project), "项目已创建"));
    } catch (error) {
      app.log.error(error, "Create project failed");
      return reply.status(503).send(fail("项目创建失败：数据库未初始化或无法打开，请检查后端数据库配置。"));
    }
  });

  app.get<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    return reply.send(ok(detail));
  });

  app.patch<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
    const input = updateProjectSchema.parse(request.body);
    const project = await prisma.project.update({
      where: { id: request.params.id },
      data: input
    });
    return reply.send(ok(formatProject(project), "项目信息已更新"));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/source-text", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }

    const input = sourceTextSchema.parse(request.body);
    const sourceText = await prisma.sourceText.create({
      data: {
        projectId: request.params.id,
        content: input.text
      }
    });
    return reply.send(ok(formatSourceText(sourceText), "资料已保存"));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/extract-facts", async (request, reply) => {
    const parsedBody = extractFactsRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send(fail(parsedBody.error.issues[0]?.message ?? "事实提取参数无效"));
    }
    const body = parsedBody.data;
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }

    const sourceText = body.text
      ? await prisma.sourceText.create({ data: { projectId: request.params.id, content: body.text } })
      : await prisma.sourceText.findFirst({ where: { projectId: request.params.id }, orderBy: { createdAt: "desc" } });

    const storedMaterials = body.materialIds?.length === 0
      ? []
      : await prisma.projectMaterial.findMany({
          where: {
            projectId: request.params.id,
            ...(body.materialIds ? { id: { in: body.materialIds } } : {})
          },
          orderBy: { createdAt: "asc" }
        });
    if (body.materialIds && body.materialIds.length > 0 && storedMaterials.length !== new Set(body.materialIds).size) {
      return reply.status(404).send(fail("部分所选资料不存在或不属于当前项目"));
    }

    if (!sourceText && storedMaterials.length === 0) {
      return reply.status(400).send(fail("请先输入项目资料"));
    }

    const materials = await Promise.all(
      storedMaterials.map(async (material) => {
        try {
          const knowledge = await knowledgeGateway.getDocument(material.knowledgeDocumentId, {
            projectId: request.params.id,
            requestHeaders: request.headers
          });
          return formatStoredProjectMaterial(material, knowledge);
        } catch (error) {
          return formatProjectMaterialGatewayFailure(material, error);
        }
      })
    );

    try {
      assertMaterialsReady(materials);
    } catch (error) {
      if (error instanceof MaterialsNotReadyError) {
        const summary = error.materials
          .map((material) => `${material.filename}：${material.errorMessage || material.status}`)
          .join("；");
        return reply.status(409).send(fail(`资料尚未就绪：${summary}`));
      }
      throw error;
    }

    let drafts;
    try {
      const materialSources = await loadMaterialContextSources({
        gateway: knowledgeGateway,
        materials,
        projectId: request.params.id,
        requestHeaders: request.headers
      });
      const bundle = buildContextBundle({
        projectId: request.params.id,
        sourceText: sourceText ? { id: sourceText.id, content: sourceText.content } : null,
        materials: materialSources
      });
      drafts = await extractResolvedFactsFromContext({
        bundle,
        maxChars: materialContextBatchChars(),
        extract: (serializedContext) =>
          adapter.extractFacts(buildFactExtractionContext(project, serializedContext))
      });
    } catch (error) {
      if (error instanceof KnowledgeGatewayError && error.statusCode === 409) {
        return reply.status(409).send(fail(error.message));
      }
      app.log.error(error, "Extract facts failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }
    const selectedDrafts = selectAllExtractedFacts(drafts);
    const createdFacts = await prisma.$transaction(async (tx) => {
      await tx.slide.deleteMany({ where: { projectId: request.params.id } });
      await tx.fact.deleteMany({ where: { projectId: request.params.id } });

      return Promise.all(
        selectedDrafts.map((draft) =>
          tx.fact.create({
            data: {
              projectId: request.params.id,
              category: draft.category,
              content: draft.content,
              status: draft.status,
              confidence: draft.confidence,
              sourceText: draft.sourceText,
              sourceLocation: draft.sourceLocation,
              evidenceJson: draft.evidence.length > 0 ? JSON.stringify(draft.evidence) : null,
              canUseInPpt: draft.canUseInPpt
            }
          })
        )
      );
    });

    return reply.send(ok(createdFacts.map(formatFactWithEvidence), "事实已提取"));
  });

  app.get<{ Params: IdParams }>("/api/projects/:id/facts", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }
    return reply.send(ok(await getProjectFacts(request.params.id)));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/facts", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }

    const input = createFactSchema.parse(request.body);
    const fact = await prisma.fact.create({
      data: {
        projectId: request.params.id,
        ...input
      }
    });
    return reply.send(ok(formatFact(fact), "事实已新增"));
  });

  app.patch<{ Params: FactParams }>("/api/projects/:id/facts/:factId", async (request, reply) => {
    const input = updateFactSchema.parse(request.body);
    const existing = await prisma.fact.findFirst({
      where: {
        id: request.params.factId,
        projectId: request.params.id
      }
    });
    if (!existing) {
      return reply.status(404).send(fail("未找到事实"));
    }

    const fact = await prisma.fact.update({
      where: { id: request.params.factId },
      data: input
    });
    return reply.send(ok(formatFact(fact), "事实已更新"));
  });

  app.delete<{ Params: FactParams }>("/api/projects/:id/facts/:factId", async (request, reply) => {
    await prisma.fact.deleteMany({
      where: {
        id: request.params.factId,
        projectId: request.params.id
      }
    });
    return reply.send(ok({ id: request.params.factId }, "事实已删除"));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/generate-outline", async (request, reply) => {
    const force = ((request.body ?? {}) as { force?: unknown }).force === true;
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }

    const confirmedFacts = detail.facts.filter((fact) => fact.status === "confirmed" && fact.canUseInPpt);
    const canUseFacts = detail.facts.filter((fact) => fact.canUseInPpt);
    const confirmedAnyFacts = detail.facts.filter((fact) => fact.status === "confirmed");
    const usableFacts =
      confirmedFacts.length > 0
        ? confirmedFacts
        : canUseFacts.length > 0
          ? canUseFacts
          : confirmedAnyFacts.length > 0
            ? confirmedAnyFacts
            : detail.facts;
    if (usableFacts.length === 0) {
      // 主题模式：无事实时用调研要点作为大纲上下文（不写入 Fact 表）
      if (detail.project.mode !== "topic" || !detail.project.researchJson?.bullets?.length) {
        return reply.status(400).send(fail("请先确认至少一条可进入 PPT 的事实，或先完成主题调研"));
      }
    }

    const outlineFacts =
      usableFacts.length > 0
        ? usableFacts
        : (detail.project.researchJson?.bullets ?? []).map((content, index) => ({
            id: `research-${index}`,
            projectId: detail.project.id,
            category: "建议与判断" as const,
            content,
            status: "suggestion" as const,
            confidence: 0.7,
            sourceText: content,
            sourceLocation: "主题调研",
            canUseInPpt: true,
            createdAt: new Date().toISOString()
          }));

    // 按 sortOrder 快照：非 force 时保留锁定策略（及约定：已锁定的非空策略）
    const previousSlides = await prisma.slide.findMany({
      where: { projectId: request.params.id },
      orderBy: { sortOrder: "asc" },
      select: { renderStrategy: true, strategyLocked: true }
    });

    let outline;
    const streamHandler = createStreamingTokenHandler(request.params.id, "outline", 200);
    try {
      emitProgress(request.params.id, { stage: "outline", status: "start", message: "正在生成大纲架构…", clearDelta: true });
      outline = await adapter.generateOutline(detail.project, outlineFacts, streamHandler.onToken);
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "outline", status: "done", message: `大纲生成完成（${outline.length} 页）` });
    } catch (error) {
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "outline", status: "error", message: aiFailMessage(error) });
      app.log.error(error, "Generate outline failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }

    let preservedCount = 0;
    await prisma.$transaction(async (tx) => {
      await tx.slide.deleteMany({ where: { projectId: request.params.id } });
      for (const [index, slide] of outline.entries()) {
        const inferred = computeRenderStrategy({
          title: slide.title,
          recommendedLayout: slide.recommendedLayout
        });
        const previous = previousSlides[index];
        const shouldPreserve =
          !force &&
          Boolean(previous?.strategyLocked) &&
          isValidRenderStrategy(previous?.renderStrategy);
        const renderStrategy = shouldPreserve ? previous!.renderStrategy! : inferred;
        const strategyLocked = shouldPreserve;
        if (shouldPreserve) {
          preservedCount += 1;
        }
        const createdSlide = await tx.slide.create({
          data: {
            projectId: request.params.id,
            sortOrder: index + 1,
            title: slide.title,
            slideGoal: slide.slideGoal,
            keyMessage: slide.keyMessage,
            contentPoints: asJsonPoints(slide.contentPoints),
            recommendedLayout: slide.recommendedLayout,
            partTitle: slide.partTitle ?? null,
            renderStrategy,
            strategyLocked,
            status: "draft",
            generationStatus: "draft"
          }
        });
        for (const factId of slide.sourceFactIds) {
          if (String(factId).startsWith("research-")) {
            continue;
          }
          await tx.slideSource.create({
            data: {
              slideId: createdSlide.id,
              factId,
              usageType: "supporting"
            }
          });
        }
      }
    });

    const message =
      preservedCount > 0
        ? `大纲已生成（保留 ${preservedCount} 页锁定策略${force ? "" : "；force=true 可覆盖"}）`
        : "大纲已生成";
    return reply.send(ok(await getProjectSlides(request.params.id), message));
  });

  app.get<{ Params: IdParams }>("/api/projects/:id/slides", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }
    return reply.send(ok(await getProjectSlides(request.params.id)));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/slides", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }

    const input = createBlankSlideSchema.parse(request.body ?? {});
    const existing = await prisma.slide.findMany({
      where: { projectId: request.params.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true, partTitle: true }
    });

    let insertAt = existing.length;
    let partTitle = input.partTitle?.trim() || null;

    if (input.afterSlideId) {
      const afterIdx = existing.findIndex((slide) => slide.id === input.afterSlideId);
      if (afterIdx < 0) {
        return reply.status(404).send(fail("插入锚点页面不存在"));
      }
      insertAt = afterIdx + 1;
      if (!partTitle) {
        partTitle = existing[afterIdx]?.partTitle?.trim() || null;
      }
    }

    const renderStrategy = computeRenderStrategy({
      title: input.title,
      recommendedLayout: "blank-card"
    });

    const slide = await prisma.$transaction(async (tx) => {
      const created = await tx.slide.create({
        data: {
          projectId: request.params.id,
          sortOrder: insertAt + 1,
          title: input.title,
          slideGoal: "补充本页页面目标",
          keyMessage: input.keyMessage,
          contentPoints: "[]",
          recommendedLayout: "blank-card",
          partTitle,
          renderStrategy,
          status: "draft",
          generationStatus: "draft"
        },
        include: { slideSources: true }
      });

      const orderedIds = existing.map((item) => item.id);
      orderedIds.splice(insertAt, 0, created.id);
      await Promise.all(
        orderedIds.map((slideId, index) =>
          tx.slide.update({
            where: { id: slideId },
            data: { sortOrder: index + 1 }
          })
        )
      );

      return created;
    });

    return reply.send(ok(formatSlide(slide), "空白页已新增"));
  });

  app.patch<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId", async (request, reply) => {
    const input = updateSlideSchema.parse(request.body);
    const metaChanged =
      input.title !== undefined ||
      input.slideGoal !== undefined ||
      input.keyMessage !== undefined ||
      input.contentPoints !== undefined ||
      input.recommendedLayout !== undefined;
    const planEdited = input.planJson !== undefined;
    const searchEdited = input.searchJson !== undefined;
    const svgEdited = input.svgPreview !== undefined;
    // 改页意图 → 清空初稿+设计；改初稿 → 仅清空设计；勾选检索卡不自动清稿
    const shouldInvalidatePlan = metaChanged && !planEdited;
    const shouldInvalidateDesign = metaChanged || planEdited;
    const existing = await prisma.slide.findFirst({
      where: {
        id: request.params.slideId,
        projectId: request.params.id
      }
    });
    if (!existing) {
      return reply.status(404).send(fail("未找到页面"));
    }

    const editedSvg = input.svgPreview?.trim();
    if (svgEdited) {
      if (!editedSvg || !/^<svg\b[\s\S]*<\/svg>$/i.test(editedSvg)) {
        return reply.status(400).send(fail("SVG 源码不完整，请保留 <svg> 根节点和 </svg> 结束标签。"));
      }
      if (!/viewBox=["']0 0 1280 720["']/i.test(editedSvg)) {
        return reply.status(400).send(fail("SVG viewBox 必须保持为 0 0 1280 720。"));
      }
      const banned = getBannedSvgFeatures(editedSvg);
      if (banned.length > 0 || /\son[a-z]+\s*=|javascript\s*:/i.test(editedSvg)) {
        return reply.status(400).send(fail(`SVG 含不允许的内容${banned.length > 0 ? `：${banned.join("、")}` : ""}。`));
      }
    }

    // 手动设置 renderStrategy → 默认锁定；显式传 strategyLocked 可覆盖
    const nextLocked =
      input.strategyLocked ??
      (input.renderStrategy !== undefined ? true : Boolean(existing.strategyLocked));

    const nextStrategy =
      input.renderStrategy ??
      resolveNextStrategy(
        {
          renderStrategy: isValidRenderStrategy(existing.renderStrategy) ? existing.renderStrategy : null,
          strategyLocked: nextLocked
        },
        {
          title: input.title ?? existing.title,
          recommendedLayout: input.recommendedLayout ?? existing.recommendedLayout
        }
      );

    const {
      renderStrategy: _ignoredStrategy,
      strategyLocked: _ignoredLocked,
      planJson: planPayload,
      searchJson: searchPayload,
      svgPreview: _ignoredSvgPreview,
      designVersionMeta,
      ...restInput
    } = input;
    const slidePatch = {
      ...restInput,
      contentPoints: input.contentPoints ? asJsonPoints(input.contentPoints) : undefined,
      searchJson: searchEdited ? JSON.stringify(searchPayload) : undefined,
      planJson: planEdited
        ? JSON.stringify(planPayload)
        : shouldInvalidatePlan
          ? null
          : undefined,
      generationStatus: svgEdited
        ? "svg-ready"
        : planEdited
          ? "draft-ready"
          : shouldInvalidatePlan
            ? "draft"
            : undefined,
      status: planEdited ? "planned" : shouldInvalidatePlan ? "draft" : input.status,
      renderStrategy: svgEdited ? "svg" : nextStrategy,
      strategyLocked: svgEdited ? false : nextLocked
    };
    const slide = svgEdited
      ? await persistSlideDesignVersion({
          projectId: request.params.id,
          slideId: request.params.slideId,
          svgPreview: editedSvg!,
          source: "manual",
          theme: designVersionMeta?.theme,
          accentId: designVersionMeta?.accentId,
          surfaceId: designVersionMeta?.surfaceId,
          presentationStyle: designVersionMeta?.presentationStyle,
          slidePatch
        })
      : shouldInvalidateDesign
        ? await clearSlideDesignVersions(
            request.params.id,
            request.params.slideId,
            slidePatch
          )
        : await prisma.slide.update({
            where: { id: request.params.slideId },
            data: slidePatch,
            include: { slideSources: true }
          });
    return reply.send(ok(formatSlide(slide), "页面已更新"));
  });

  app.delete<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId", async (request, reply) => {
    await prisma.slide.deleteMany({
      where: {
        id: request.params.slideId,
        projectId: request.params.id
      }
    });
    const remaining = await prisma.slide.findMany({
      where: { projectId: request.params.id },
      orderBy: { sortOrder: "asc" }
    });
    await prisma.$transaction(
      remaining.map((slide, index) =>
        prisma.slide.update({
          where: { id: slide.id },
          data: { sortOrder: index + 1 }
        })
      )
    );
    return reply.send(ok(await getProjectSlides(request.params.id), "页面已删除"));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/slides/reorder", async (request, reply) => {
    const input = reorderSlidesSchema.parse(request.body);
    await prisma.$transaction(
      input.slideIds.map((slideId, index) =>
        prisma.slide.updateMany({
          where: { id: slideId, projectId: request.params.id },
          data: { sortOrder: index + 1 }
        })
      )
    );
    return reply.send(ok(await getProjectSlides(request.params.id), "页面顺序已更新"));
  });

  app.post<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/generate-plan", async (request, reply) => {
    const slideRecord = await prisma.slide.findFirst({
      where: { id: request.params.slideId, projectId: request.params.id },
      include: { slideSources: true }
    });
    if (!slideRecord) {
      return reply.status(404).send(fail("未找到页面"));
    }

    const facts = await getProjectFacts(request.params.id);
    const project = await prisma.project.findUnique({ where: { id: request.params.id }, select: { theme: true } });
    const slide = formatSlide(slideRecord);
    const missingPrerequisite = missingStudioPrerequisite(slide, "draft");
    if (missingPrerequisite) {
      return reply
        .status(409)
        .send(fail(`生成初稿前请先完成${studioStageLabel(missingPrerequisite)}。`));
    }
    const streamHandler = createStreamingTokenHandler(request.params.id, "plan", 200, {
      slideId: slide.id,
      slideTitle: slide.title,
      subStage: slide.title
    });
    let plan;
    try {
      emitProgress(request.params.id, { stage: "plan", status: "start", message: `正在策划「${slide.title}」…`, slideId: slide.id, slideTitle: slide.title, subStage: slide.title, clearDelta: true });
      plan = await adapter.generateSlidePlan(slide, facts, normalizePptExportTheme(project?.theme), streamHandler.onToken);
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "plan", status: "done", message: `策划完成：${slide.title}`, slideId: slide.id, slideTitle: slide.title, subStage: slide.title });
    } catch (error) {
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "plan", status: "error", message: aiFailMessage(error), slideId: slide.id, slideTitle: slide.title, subStage: slide.title });
      app.log.error(error, "Generate slide plan failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }
    const renderStrategy = resolveNextStrategy(slide, {
      title: plan.title || slide.title,
      recommendedLayout: slide.recommendedLayout,
      planJson: plan
    });
    const updatedSlide = await clearSlideDesignVersions(
      request.params.id,
      slide.id,
      {
        planJson: JSON.stringify(plan),
        status: "planned",
        generationStatus: "draft-ready",
        renderStrategy
      }
    );

    return reply.send(ok({ plan, slide: formatSlide(updatedSlide) }, "策划稿已生成"));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/generate-all-plans", async (request, reply) => {
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    if (detail.slides.length === 0) {
      return reply.status(400).send(fail("请先生成便利贴大纲，再生成策划稿。"));
    }

    // 类 grok-build subagent fan-out：每页一个 Planner worker，有限并发
    const candidates = detail.slides.filter((slide) => !(slide.isContentLocked && slide.planJson));
    if (candidates.length === 0) {
      return reply.send(ok(await getProjectSlides(request.params.id), "所有页面策划稿已是最新"));
    }

    const concurrency = resolveConcurrency(["PLAN_CONCURRENCY", "AI_CONCURRENCY"], 3);
    const theme = normalizePptExportTheme(detail.project.theme);
    const total = candidates.length;
    let doneCount = 0;
    let generatedCount = 0;

    emitProgress(request.params.id, {
      stage: "plan",
      status: "start",
      message: `批量策划启动（并发 ${concurrency}，共 ${total} 页）…`,
      current: 0,
      total
    });

    try {
      const mapped = await orchestration.mapPages(
        candidates,
        async (slide, _index, emitToken) => {
          const slideFacts = linkedFactsForSlide(slide, detail.facts);
          const perPageBuffer: string[] = [];
          const plan = await adapter.generateSlidePlan(slide, slideFacts, theme, (token) => {
            perPageBuffer.push(token);
            emitToken(token);
          });
          // 批量任务避免多页 token 混叠：每页完成后整段 emit 一次
          if (perPageBuffer.length > 0) {
            emitProgress(request.params.id, {
              stage: "plan",
              status: "progress",
              message: `「${slide.title}」策划完成`,
              delta: perPageBuffer.join(""),
              subStage: slide.title,
              slideId: slide.id,
              slideTitle: slide.title
            });
          }
          const renderStrategy = resolveNextStrategy(slide, {
            title: plan.title || slide.title,
            recommendedLayout: slide.recommendedLayout,
            planJson: plan
          });
          await clearSlideDesignVersions(
            request.params.id,
            slide.id,
            {
              planJson: JSON.stringify(plan),
              status: "planned",
              generationStatus: "draft-ready",
              renderStrategy
            }
          );
          return plan;
        },
        {
          concurrency,
          stage: "plan",
          role: "planner",
          onItemDone: ({ item, ok }) => {
            doneCount += 1;
            if (ok) generatedCount += 1;
            emitSlideProgress(request.params.id, "plan", item.title, item.id, doneCount, total);
          }
        }
      );

      const hardFail = mapped.find((row) => !row.ok);
      if (hardFail && generatedCount === 0) {
        const message =
          hardFail.ok === false && hardFail.error instanceof Error
            ? hardFail.error.message
            : "批量策划失败";
        throw new Error(message);
      }
    } catch (error) {
      app.log.error(error, "Generate all slide plans failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }

    emitProgress(request.params.id, {
      stage: "plan",
      status: "done",
      message: generatedCount === 0 ? "所有页面策划稿已是最新" : `已生成 ${generatedCount} 页策划稿（并发 ${concurrency}）`,
      current: total,
      total
    });

    return reply.send(
      ok(
        await getProjectSlides(request.params.id),
        generatedCount === 0 ? "所有页面策划稿已是最新" : `已生成 ${generatedCount} 页策划稿`
      )
    );
  });

  app.post<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/generate-svg-preview", async (request, reply) => {
    const input = exportPptxSchema.parse(request.body ?? {});
    const slideRecord = await prisma.slide.findFirst({
      where: { id: request.params.slideId, projectId: request.params.id },
      include: { slideSources: true }
    });
    if (!slideRecord) {
      return reply.status(404).send(fail("未找到页面"));
    }

    const slide = formatSlide(slideRecord);
    if (!slide.planJson) {
      return reply.status(400).send(fail("请先生成页面策划稿，再生成 SVG 预览。"));
    }

    const designStreamHandler = createStreamingTokenHandler(request.params.id, "design", 200, {
      slideId: slide.id,
      slideTitle: slide.title,
      subStage: slide.title
    });
    try {
      const facts = await getProjectFacts(request.params.id);
      emitProgress(request.params.id, { stage: "design", status: "start", message: `正在生成「${slide.title}」的 SVG 预览…`, slideId: slide.id, slideTitle: slide.title, subStage: slide.title, clearDelta: true });
      const linkedFacts = linkedFactsForSlide(slide, facts);
      const presentationStyle = await resolveEffectivePresentationStyle(
        request.params.id,
        slide.presentationStyle,
        input.presentationStyle
      );
      const svgPreview = await generateValidatedSvgPreview(
        slide,
        linkedFacts,
        input.theme,
        designStreamHandler.onToken,
        { ...input, presentationStyle }
      );
      designStreamHandler.flush();
      const updatedSlide = await persistSlideDesignVersion({
        projectId: request.params.id,
        slideId: slide.id,
        svgPreview,
        source: "ai",
        theme: input.theme,
        accentId: input.accentId,
        surfaceId: input.surfaceId,
        presentationStyle,
        slidePatch: {
          generationStatus: "svg-ready",
          renderStrategy: "svg",
          strategyLocked: false
        }
      });
      emitProgress(request.params.id, { stage: "design", status: "done", message: `SVG 预览已生成：${slide.title}`, slideId: slide.id, slideTitle: slide.title, subStage: slide.title });

      return reply.send(ok({ svgPreview, slide: formatSlide(updatedSlide) }, "SVG 预览已生成"));
    } catch (error) {
      designStreamHandler.flush();
      emitProgress(request.params.id, {
        stage: "design",
        status: "error",
        message: aiFailMessage(error),
        slideId: slide.id,
        slideTitle: slide.title,
        subStage: slide.title
      });
      app.log.error(error, "Generate SVG preview failed");
      const qualityFailure = resolveSvgGenerationFailure(error);
      return reply
        .status(qualityFailure?.statusCode ?? 502)
        .send(
          fail(
            qualityFailure?.message ?? aiFailMessage(error),
            qualityFailure?.data ?? null
          )
        );
    }
  });

  app.post<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/generate-design", async (request, reply) => {
    const input = exportPptxSchema.parse(request.body ?? {});
    const slideRecord = await prisma.slide.findFirst({
      where: { id: request.params.slideId, projectId: request.params.id },
      include: { slideSources: true }
    });
    if (!slideRecord) {
      return reply.status(404).send(fail("未找到页面"));
    }

    const slide = formatSlide(slideRecord);
    const missingPrerequisite = missingStudioPrerequisite(slide, "design");
    if (missingPrerequisite) {
      return reply
        .status(409)
        .send(fail(`生成设计稿前请先完成${studioStageLabel(missingPrerequisite)}。`));
    }

    try {
      const facts = await getProjectFacts(request.params.id);
      const mode = input.mode;

      // 只有显式草稿导出跳过 SVG；设计工作区始终生成 SVG。
      if (mode === "draft") {
        let current = slide;
        if (!current.planJson) {
          const slideFacts = linkedFactsForSlide(current, facts);
          const plan = await generatePlanForSlide(current, slideFacts, input.theme);
          const renderStrategy = resolveNextStrategy(current, { ...current, planJson: plan });
          const planned = await prisma.slide.update({
            where: { id: current.id },
            data: {
              planJson: JSON.stringify(plan),
              status: "planned",
              generationStatus: "draft-ready",
              renderStrategy
            },
            include: { slideSources: true }
          });
          current = formatSlide(planned);
        } else {
          const kept = resolveNextStrategy(current, current);
          await persistRenderStrategy(current.id, kept).catch(() => undefined);
          current = { ...current, renderStrategy: kept };
        }

        return reply.send(
          ok(
            { svgPreview: current.svgPreview ?? "", slide: current, skippedSvg: true },
            "草稿模式已跳过 SVG，已准备策划"
          )
        );
      }

      const updatedSlide = await generateEditableSvgDesign(request.params.id, slide, facts, input.theme, input);
      return reply.send(ok({ svgPreview: updatedSlide.svgPreview ?? "", slide: updatedSlide }, "SVG 页面设计已生成"));
    } catch (error) {
      await prisma.slide.updateMany({
        where: { id: request.params.slideId, projectId: request.params.id },
        data: { generationStatus: "error" }
      });
      app.log.error(error, "Generate slide SVG design failed");
      const qualityFailure = resolveSvgGenerationFailure(error);
      return reply
        .status(qualityFailure?.statusCode ?? 502)
        .send(
          fail(
            qualityFailure?.message ?? aiFailMessage(error),
            qualityFailure?.data ?? null
          )
        );
    }
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/generate-all-designs", async (request, reply) => {
    const input = exportPptxSchema.parse(request.body ?? {});
    const force = ((request.body ?? {}) as { force?: unknown }).force === true;
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    if (detail.slides.length === 0) {
      return reply.status(400).send(fail("请先生成便利贴大纲，再生成 SVG 页面设计。"));
    }

    const failures: Array<{
      slideId: string;
      title: string;
      message: string;
      qualityFailure?: SvgQualityFailureDto;
    }> = [];
    let skippedSvgCount = 0;
    let generatedSvgCount = 0;

    for (const slide of detail.slides) {
      // 只有显式草稿导出跳过 SVG；设计工作区始终生成 SVG。
      if (input.mode === "draft") {
        try {
          await ensureSlidePlan(slide, detail.facts, input.theme);
          skippedSvgCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          failures.push({ slideId: slide.id, title: slide.title, message });
          app.log.error(error, `Ensure Plan for skipped-SVG slide failed ${slide.id}`);
        }
        continue;
      }

      const bannedExisting = slide.svgPreview ? getBannedSvgFeatures(slide.svgPreview) : [];
      const needsSvg =
        force || !slide.svgPreview || (input.mode === "visual" && bannedExisting.length > 0);
      if (!needsSvg) {
        continue;
      }

      const missingPrerequisite = missingStudioPrerequisite(slide, "design");
      if (missingPrerequisite) {
        failures.push({
          slideId: slide.id,
          title: slide.title,
          message: `请先完成${studioStageLabel(missingPrerequisite)}`
        });
        continue;
      }

      try {
        await generateEditableSvgDesign(request.params.id, slide, detail.facts, input.theme, input);
        generatedSvgCount += 1;
      } catch (error) {
        const qualityFailure = resolveSvgGenerationFailure(error);
        const message =
          qualityFailure?.message ??
          (error instanceof Error ? error.message : "未知错误");
        failures.push({
          slideId: slide.id,
          title: slide.title,
          message,
          qualityFailure: qualityFailure?.data
        });
        await prisma.slide.updateMany({
          where: { id: slide.id, projectId: request.params.id },
          data: { generationStatus: "error" }
        });
        app.log.error(error, `Generate SVG design failed for slide ${slide.id}`);
      }
    }

    const slides = await getProjectSlides(request.params.id);
    let message = "全部 SVG 页面设计已生成";
    if (input.mode === "draft") {
      message =
        skippedSvgCount > 0
          ? `草稿模式已跳过 SVG（${skippedSvgCount} 页），已准备策划`
          : "草稿模式无需生成 SVG";
    } else if (failures.length > 0) {
      message = `部分页面设计失败：${failures.length} 页，请查看失败原因后重试。`;
    } else if (generatedSvgCount === 0) {
      message = "页面设计已是最新";
    }

    return reply.send(ok({ slides, failures, skippedSvgCount, generatedSvgCount }, message));
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/export-pptx", async (request, reply) => {
    const exportInput = exportPptxSchema.parse(request.body ?? {});
    const mode: ExportMode = exportInput.mode;
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    if (detail.slides.length === 0) {
      return reply.status(400).send(fail("请先生成大纲，再导出 PPTX"));
    }

    let sourceSlides = detail.slides;
    if (exportInput.slideIds?.length) {
      const wanted = new Set(exportInput.slideIds);
      sourceSlides = detail.slides.filter((slide) => wanted.has(slide.id));
      if (sourceSlides.length === 0) {
        return reply.status(400).send(fail("指定的页面不存在，无法导出"));
      }
    }

    const project = await prisma.project.update({
      where: { id: request.params.id },
      data: { theme: exportInput.theme }
    });

    let slidesForExport = sourceSlides;
    let prepareNotes: string[] = [];
    try {
      const prepared = await prepareSlidesForExport(
        request.params.id,
        sourceSlides,
        detail.facts,
        exportInput.theme,
        mode,
        app.log,
        exportInput.fillMissing
      );
      slidesForExport = prepared.prepared;
      prepareNotes = prepared.notes;

      // visual：单页 SVG 失败已降级；仅当「所有页都既无可用 SVG、又无 IR、且补 SVG 全部失败」才整份失败
      if (
        mode === "visual" &&
        prepared.svgAttempts > 0 &&
        prepared.svgFailures === prepared.svgAttempts &&
        slidesForExport.every(
          (slide) =>
            !slide.svgPreview || getBannedSvgFeatures(slide.svgPreview).length > 0
        )
      ) {
        return reply
          .status(502)
          .send(fail("高视觉导出失败：所有页面 SVG 生成均失败。"));
      }
    } catch (error) {
      app.log.error(error, "Prepare slides before export failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }

    const filename = `${safeFilePart(detail.project.name)}-${Date.now()}.pptx`;
    const outputPath = path.join(exportsDir, filename);
    let renderWarnings: string[] = [];
    let pageResults: PageRenderResult[] = [];
    try {
      const rendered = await renderProjectPptx(
        {
          project: formatProject(project),
          slides: slidesForExport,
          facts: detail.facts,
          theme: exportInput.theme,
          accentId: exportInput.accentId,
          mode,
          svgExportMode: exportInput.svgExportMode
        },
        outputPath
      );
      renderWarnings = rendered.warnings;
      pageResults = withEditableGrades(rendered.pageResults);
    } catch (error) {
      app.log.error(error, "Render project PPTX failed");
      return reply.status(502).send(fail(error instanceof Error ? error.message : "PPTX 渲染失败"));
    }

    const exportRecord = await prisma.export.create({
      data: {
        projectId: request.params.id,
        versionName: `${exportModeLabel(mode)} ${new Date().toLocaleString("zh-CN")}`,
        pptxPath: outputPath
      }
    });

    const warnings = [...prepareNotes, ...renderWarnings];
    recordExportUsageSummary(
      buildExportUsageSummary({
        projectId: request.params.id,
        mode,
        pageResults,
        warningCount: warnings.length
      })
    );
    const themeLabel = getThemePack(exportInput.theme).label;
    const warningHint = warnings.length > 0 ? `（${warnings.length} 条降级/提示）` : "";
    if (warnings.length > 0) {
      app.log.warn({ prepareNotes, renderWarnings, pageResults }, "PPTX export completed with degradations");
    }
    return reply.send(
      ok(
        formatExport(exportRecord, { mode, warnings, pageResults }),
        `PPTX 已按${themeLabel}风格导出：${exportModeLabel(mode)}${warningHint}`
      )
    );
  });

  app.get<{ Params: IdParams }>("/api/projects/:id/exports", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const exportRecords = await prisma.export.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: "desc" }
    });
    return reply.send(ok(exportRecords.map((record) => formatExport(record))));
  });

  // --- Studio: Brief / Research / Page Search / Pipeline ---

  app.post<{ Params: IdParams }>("/api/projects/:id/brief/start", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const topic = project.topic || project.name;
    const latestSource = await prisma.sourceText.findFirst({
      where: { projectId: request.params.id },
      orderBy: { createdAt: "desc" }
    });
    try {
      const briefResult = await adapter.startBrief(topic);
      const baseQuestions = briefResult.questions;
      const questions = latestSource?.content
        ? [
            ...baseQuestions.slice(0, 2),
            {
              id: "material_priority",
              question: "参考资料中哪些结论、数字或表述必须原样保留？",
              placeholder: "例如：预算、节点、正式口径或关键结论"
            },
            {
              id: "material_gap",
              question: "现有资料还缺哪些信息，或有哪些内容需要谨慎处理？",
              placeholder: "例如：数据待核验 / 竞品信息不完整 / 暂不披露"
            },
            ...baseQuestions.slice(2)
          ]
        : baseQuestions;
      const briefJson = {
        topic,
        questions,
        answers: project.briefJson?.answers ?? {},
        questionSource: briefResult.source,
        summary: project.briefJson?.summary,
        audience: project.audience,
        purpose: project.purpose,
        pageCount: project.pageCount
      };
      const updated = await prisma.project.update({
        where: { id: request.params.id },
        data: { briefJson: JSON.stringify(briefJson), topic }
      });
      return reply.send(ok({ questions, project: formatProject(updated) }, "需求问题已生成"));
    } catch (error) {
      app.log.error(error, "Brief start failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/brief/answer", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const input = briefAnswerSchema.parse(request.body ?? {});
    const topic = project.topic || project.name;
    const brief = buildConfirmedBrief(project, input.answers);
    try {
      emitProgress(request.params.id, { stage: "brief", status: "start", message: "正在保存需求…", clearDelta: true });
      const updated = await prisma.project.update({
        where: { id: request.params.id },
        data: {
          briefJson: JSON.stringify(brief),
          audience: brief.audience || project.audience,
          purpose: brief.purpose || project.purpose,
          pageCount: brief.pageCount || project.pageCount,
          topic
        }
      });
      emitProgress(request.params.id, { stage: "brief", status: "done", message: "需求确认完成" });
      return reply.send(ok({ brief, project: formatProject(updated) }, "需求已确认"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      emitProgress(request.params.id, { stage: "brief", status: "error", message: `需求保存失败：${message}` });
      app.log.error(error, "Brief save failed");
      return reply.status(500).send(fail(`需求保存失败：${message}`));
    }
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/research", async (request, reply) => {
    const project = await findProjectOr404(request.params.id);
    if (!project) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const topic = project.topic || project.name;
    const summary = project.briefJson?.summary || `${project.audience} / ${project.purpose}`;
    const streamHandler = createStreamingTokenHandler(request.params.id, "research", 200);
    try {
      emitProgress(request.params.id, { stage: "research", status: "start", message: "正在进行背景调研…", clearDelta: true });
      const researchAdapter = getResearchAdapter();
      const research = researchAdapter
        ? await researchAdapter.generateResearch(topic, summary)
        : await adapter.generateResearch(topic, summary, streamHandler.onToken);
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "research", status: "done", message: "背景调研完成" });
      const updated = await prisma.project.update({
        where: { id: request.params.id },
        data: { researchJson: JSON.stringify(research) }
      });
      return reply.send(ok({ research, project: formatProject(updated) }, "背景调研已完成"));
    } catch (error) {
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "research", status: "error", message: aiFailMessage(error) });
      app.log.error(error, "Research failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }
  });

  app.post<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/search", async (request, reply) => {
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const slide = detail.slides.find((item) => item.id === request.params.slideId);
    if (!slide) {
      return reply.status(404).send(fail("未找到页面"));
    }
    const streamHandler = createStreamingTokenHandler(request.params.id, "search", 200, {
      slideId: slide.id,
      slideTitle: slide.title,
      subStage: slide.title
    });
    try {
      const researchAdapter = getResearchAdapter();
      emitProgress(request.params.id, { stage: "search", status: "start", message: `正在检索「${slide.title}」…`, slideId: slide.id, slideTitle: slide.title, subStage: slide.title, clearDelta: true });
      const searchJson = researchAdapter
        ? await researchAdapter.searchPage(slide, {
            topic: detail.project.topic || detail.project.name,
            researchSummary: detail.project.researchJson?.summary
          })
        : await adapter.generatePageSearch(slide, {
            topic: detail.project.topic || detail.project.name,
            researchSummary: detail.project.researchJson?.summary
          }, streamHandler.onToken);
      streamHandler.flush();
      const updated = await prisma.slide.update({
        where: { id: slide.id },
        data: {
          searchJson: JSON.stringify(searchJson),
          generationStatus: "search-ready"
        },
        include: { slideSources: true }
      });
      emitProgress(request.params.id, { stage: "search", status: "done", message: `检索完成：${slide.title}`, slideId: slide.id, slideTitle: slide.title, subStage: slide.title });
      return reply.send(ok({ searchJson, slide: formatSlide(updated) }, "本页检索已完成"));
    } catch (error) {
      streamHandler.flush();
      emitProgress(request.params.id, { stage: "search", status: "error", message: aiFailMessage(error), slideId: slide.id, slideTitle: slide.title, subStage: slide.title });
      app.log.error(error, "Page search failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/search-all", async (request, reply) => {
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    if (detail.slides.length === 0) {
      return reply.status(400).send(fail("请先生成大纲"));
    }

    // LangGraph 风格 fan-out：每页一个检索 worker，有限并发（默认 3）
    const concurrency = resolveSearchConcurrency();
    const researchAdapter = getResearchAdapter();
    const topic = detail.project.topic || detail.project.name;
    const researchSummary = detail.project.researchJson?.summary;
    const total = detail.slides.length;
    let doneCount = 0;

    emitProgress(request.params.id, {
      stage: "search",
      status: "start",
      message: `全部检索启动（并发 ${concurrency}，共 ${total} 页）`,
      current: 0,
      total
    });

    const mapped = await orchestration.mapPages(
      detail.slides,
      async (slide, _index, emitToken) => {
        const perPageBuffer: string[] = [];
        const searchJson = researchAdapter
          ? await researchAdapter.searchPage(slide, { topic, researchSummary })
          : await adapter.generatePageSearch(slide, { topic, researchSummary }, (token) => {
              perPageBuffer.push(token);
              emitToken(token);
            });
        if (perPageBuffer.length > 0) {
          emitProgress(request.params.id, {
            stage: "search",
            status: "progress",
            message: `「${slide.title}」检索完成`,
            delta: perPageBuffer.join(""),
            subStage: slide.title,
            slideId: slide.id,
            slideTitle: slide.title
          });
        }
        await prisma.slide.update({
          where: { id: slide.id },
          data: { searchJson: JSON.stringify(searchJson), generationStatus: "search-ready" }
        });
        return searchJson;
      },
      {
        concurrency,
        stage: "search",
        role: "researcher",
        onItemStart: ({ item }) => {
          emitProgress(request.params.id, {
            stage: "search",
            status: "progress",
            message: `检索中：${item.title}`,
            current: doneCount,
            total,
            slideId: item.id,
            slideTitle: item.title
          });
        },
        onItemDone: ({ item, ok }) => {
          doneCount += 1;
          emitSlideProgress(request.params.id, "search", item.title, item.id, doneCount, total);
          if (!ok) {
            emitProgress(request.params.id, {
              stage: "search",
              status: "error",
              message: `检索失败：${item.title}`,
              current: doneCount,
              total,
              slideId: item.id,
              slideTitle: item.title
            });
          }
        }
      }
    );

    const failures = mapped
      .filter((row) => !row.ok)
      .map((row) => ({
        slideId: row.item.id,
        title: row.item.title,
        message: row.ok === false && row.error instanceof Error ? row.error.message : "未知错误"
      }));

    emitProgress(request.params.id, {
      stage: "search",
      status: failures.length === total ? "error" : "done",
      message: failures.length
        ? `全部检索结束：成功 ${total - failures.length} / 失败 ${failures.length}`
        : `全部检索完成（并发 ${concurrency}）`,
      current: total,
      total
    });

    return reply.send(
      ok(
        {
          slides: await getProjectSlides(request.params.id),
          failures,
          concurrency
        },
        failures.length ? `部分页面检索失败：${failures.length} 页` : "全部页面检索已完成"
      )
    );
  });

  app.post<{ Params: IdParams }>("/api/projects/:id/run-pipeline", async (request, reply) => {
    const detail = await projectDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send(fail("未找到项目"));
    }
    const body = (request.body ?? {}) as { theme?: string; mode?: string; skipDesign?: boolean };
    const theme = normalizePptExportTheme(body.theme ?? detail.project.theme);
    const mode = (body.mode === "draft" || body.mode === "visual" ? body.mode : "standard") as ExportMode;
    const logs: string[] = [];
    emitProgress(request.params.id, { stage: "pipeline", status: "start", message: "流水线启动" });

    try {
      if (detail.project.mode === "topic") {
        if (!detail.project.briefJson?.summary) {
          const topic = detail.project.topic || detail.project.name;
          const generatedQuestions = detail.project.briefJson?.questions?.length
            ? null
            : await adapter.startBrief(topic);
          const questions = detail.project.briefJson?.questions?.length
            ? detail.project.briefJson.questions
            : generatedQuestions?.questions ?? [];
          const questionSource = detail.project.briefJson?.questionSource ?? generatedQuestions?.source;
          const answers = detail.project.briefJson?.answers ?? {};
          for (const q of questions) {
            if (!answers[q.id]) answers[q.id] = q.placeholder || "按默认推进";
          }
          const streamHandler = createStreamingTokenHandler(request.params.id, "brief", 200);
          const generatedBrief = await adapter.finalizeBrief(topic, answers, streamHandler.onToken);
          const brief = { ...generatedBrief, questions, questionSource };
          streamHandler.flush();
          await prisma.project.update({
            where: { id: detail.project.id },
            data: {
              briefJson: JSON.stringify(brief),
              audience: brief.audience || detail.project.audience,
              purpose: brief.purpose || detail.project.purpose,
              pageCount: brief.pageCount || detail.project.pageCount
            }
          });
          logs.push("需求确认完成");
          emitProgress(request.params.id, { stage: "brief", status: "done", message: "需求确认完成" });
        }
        if (!detail.project.researchJson?.summary) {
          const project = await findProjectOr404(request.params.id);
          const streamHandler = createStreamingTokenHandler(request.params.id, "research", 200);
          const researchAdapter = getResearchAdapter();
          const research = researchAdapter
            ? await researchAdapter.generateResearch(
                project!.topic || project!.name,
                project!.briefJson?.summary || ""
              )
            : await adapter.generateResearch(
                project!.topic || project!.name,
                project!.briefJson?.summary || "",
                streamHandler.onToken
              );
          streamHandler.flush();
          await prisma.project.update({
            where: { id: request.params.id },
            data: { researchJson: JSON.stringify(research) }
          });
          logs.push("背景调研完成");
          emitProgress(request.params.id, { stage: "research", status: "done", message: "背景调研完成" });
        }
      }

      let slides = await getProjectSlides(request.params.id);
      if (slides.length === 0) {
        // 触发大纲：复用 generate-outline 逻辑较重，这里直接内联调用
        const fresh = await projectDetail(request.params.id);
        const researchBullets = fresh?.project.researchJson?.bullets ?? [];
        const facts =
          fresh!.facts.filter((f) => f.canUseInPpt).length > 0
            ? fresh!.facts.filter((f) => f.canUseInPpt)
            : researchBullets.map((content, index) => ({
                id: `research-${index}`,
                projectId: fresh!.project.id,
                category: "建议与判断" as const,
                content,
                status: "suggestion" as const,
                confidence: 0.7,
                sourceText: content,
                sourceLocation: "主题调研",
                canUseInPpt: true,
                createdAt: new Date().toISOString()
              }));
        if (facts.length === 0) {
          return reply.status(400).send(fail("流水线缺少事实或调研要点，无法生成大纲"));
        }
        const outlineStreamHandler = createStreamingTokenHandler(request.params.id, "outline", 200);
        const outline = await adapter.generateOutline(fresh!.project, facts, outlineStreamHandler.onToken);
        outlineStreamHandler.flush();
        await prisma.$transaction(async (tx) => {
          await tx.slide.deleteMany({ where: { projectId: request.params.id } });
          for (const [index, slide] of outline.entries()) {
            await tx.slide.create({
              data: {
                projectId: request.params.id,
                sortOrder: index + 1,
                title: slide.title,
                slideGoal: slide.slideGoal,
                keyMessage: slide.keyMessage,
                contentPoints: asJsonPoints(slide.contentPoints),
                recommendedLayout: slide.recommendedLayout,
                partTitle: slide.partTitle ?? null,
                renderStrategy: computeRenderStrategy({
                  title: slide.title,
                  recommendedLayout: slide.recommendedLayout
                }),
                status: "draft",
                generationStatus: "draft"
              }
            });
          }
        });
        logs.push(`大纲已生成 ${outline.length} 页`);
        emitProgress(request.params.id, { stage: "outline", status: "done", message: `大纲生成完成（${outline.length} 页）` });
        slides = await getProjectSlides(request.params.id);
      }

      for (const slide of slides) {
        if (!slide.searchJson) {
          const researchAdapter = getResearchAdapter();
          const searchStreamHandler = createStreamingTokenHandler(request.params.id, "search", 200, {
            slideId: slide.id,
            slideTitle: slide.title,
            subStage: slide.title
          });
          const searchJson = researchAdapter
            ? await researchAdapter.searchPage(slide, {
                topic: detail.project.topic || detail.project.name,
                researchSummary: (await findProjectOr404(request.params.id))?.researchJson?.summary
              })
            : await adapter.generatePageSearch(slide, {
                topic: detail.project.topic || detail.project.name,
                researchSummary: (await findProjectOr404(request.params.id))?.researchJson?.summary
              }, searchStreamHandler.onToken);
          searchStreamHandler.flush();
          await prisma.slide.update({
            where: { id: slide.id },
            data: { searchJson: JSON.stringify(searchJson), generationStatus: "search-ready" }
          });
        }
      }
      logs.push("按页检索完成");
      emitProgress(request.params.id, { stage: "search", status: "done", message: "按页检索完成" });

      slides = await getProjectSlides(request.params.id);
      const facts = await getProjectFacts(request.params.id);
      const pipelineTheme = normalizePptExportTheme(detail.project.theme);
      for (const slide of slides) {
        if (!slide.planJson) {
          const planStreamHandler = createStreamingTokenHandler(request.params.id, "plan", 200, {
            slideId: slide.id,
            slideTitle: slide.title,
            subStage: slide.title
          });
          const plan = await adapter.generateSlidePlan(slide, linkedFactsForSlide(slide, facts), pipelineTheme, planStreamHandler.onToken);
          planStreamHandler.flush();
          await prisma.slide.update({
            where: { id: slide.id },
            data: {
              planJson: JSON.stringify(plan),
              status: "planned",
              generationStatus: "draft-ready"
            }
          });
        }
      }
      logs.push("初稿策划完成");
      emitProgress(request.params.id, { stage: "plan", status: "done", message: "初稿策划完成" });

      if (!body.skipDesign && mode !== "draft") {
        slides = await getProjectSlides(request.params.id);
        for (const slide of slides) {
          if (slide.svgPreview) continue;
          try {
            await generateEditableSvgDesign(request.params.id, slide, facts, theme);
          } catch (error) {
            logs.push(`设计失败：${slide.title} — ${error instanceof Error ? error.message : "未知错误"}`);
          }
        }
        logs.push("SVG 设计稿生成完成");
        emitProgress(request.params.id, { stage: "design", status: "done", message: "设计稿生成完成" });
      }

      emitProgress(request.params.id, { stage: "pipeline", status: "done", message: "流水线完成" });
      const finalDetail = await projectDetail(request.params.id);
      return reply.send(ok({ detail: finalDetail, logs }, "流水线已跑完"));
    } catch (error) {
      app.log.error(error, "Pipeline failed");
      return reply.status(502).send(fail(aiFailMessage(error)));
    }
  });
}
