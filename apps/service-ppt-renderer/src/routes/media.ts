import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { buildSafeFocusTargets } from "@ppt-agent/agents";
import { prepareSlideSvgSource, renderSlidePng, renderSubtitleOverlayPng, renderFocusOverlayPng } from "@ppt-agent/ppt-renderer";
import {
  NarrationAlignmentSchema,
  NarrationFocusPlanSchema,
  narrationOptionsSchema,
  narrationStyleSchema,
  speechScriptRequestSchema,
  ttsPreviewSchema,
  updateNarrationSchema,
  videoExportSchema,
  type MediaExportDto,
  type NarrationAlignment,
  type NarrationFocusPlan,
  type SlideDto,
  type SlideNarrationDto,
  type SpeechWritingStyleId,
  type SubtitleLayout
} from "@ppt-agent/shared";
import { createAiAdapter } from "../lib/ai.js";
import { formatSlide } from "../lib/format.js";
import { normalizeConcurrency, runWithConcurrency } from "../lib/concurrency.js";
import { assertDesignedSlides, MediaScopeError, selectScopedSlides } from "../lib/mediaScope.js";
import { createProtectedExportUrl } from "../lib/exportAccess.js";
import { exportsDir } from "../lib/paths.js";
import { prisma } from "../lib/prisma.js";
import { emitProgress } from "../lib/progressEmitter.js";
import { fail, ok } from "../lib/response.js";
import { synthesizeToFile, ttsCatalog, ttsRuntimeStatus } from "../lib/tts.js";
import { resolveSubtitleFont, subtitleFontCatalog } from "../lib/subtitleFonts.js";
import { subtitleCuesToSrt, type SubtitleCue } from "../lib/subtitles.js";
import { assertFfmpegAvailable, concatVideoClips, renderNarratedClip, SUBTITLE_BOTTOM_MARGIN, validateRenderedVideo } from "../lib/video.js";
import { buildAlignmentSegments, buildAudioAlignment, isFocusAlignmentTrusted, isTranscriptAlignmentRuntimeConfigured, MIN_TRANSCRIPT_ALIGNMENT_COVERAGE } from "../lib/audioAlignment.js";
import { extractSvgTextCandidates, resolveFocusTarget } from "../lib/focusResolver.js";

type ProjectParams = { id: string };
type SlideParams = { id: string; slideId: string };
type MediaExportParams = { id: string; exportId: string };
const narrationTemplateVersion = "v3-focus-plan";

function configuredTtsConcurrency() {
  return normalizeConcurrency(process.env.TTS_CONCURRENCY, 3);
}

function safePart(value: string) {
  return value.replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "media";
}

function downloadUrl(filePath?: string | null) {
  return filePath ? createProtectedExportUrl(filePath) : null;
}

function subtitlePathForVideo(videoPath: string) {
  return videoPath.replace(/\.mp4$/iu, ".srt");
}

function focusReportPathForVideo(videoPath: string) {
  return videoPath.replace(/\.mp4$/iu, ".focus.json");
}

function sendAttachment(reply: FastifyReply, filePath: string, contentType: string) {
  const filename = path.basename(filePath);
  const asciiFilename = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const stat = fs.statSync(filePath);
  reply
    .header("Content-Disposition", `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .header("Content-Length", stat.size)
    .header("Cache-Control", "private, no-store")
    .type(contentType);
  return reply.send(fs.createReadStream(filePath));
}

function narrationDto(row: {
  id: string; slideId: string; scriptText: string; ttsText: string; voice: string; model: string;
  prompt: string | null; languageCode: string; audioPath: string | null; audioDurationMs: number | null;
  status: string; createdAt: Date; updatedAt: Date;
  focusPlanJson: string | null; alignmentJson: string | null;
}): SlideNarrationDto {
  const { focusPlanJson, alignmentJson, ...publicRow } = row;
  return {
    ...publicRow,
    focusPlan: parseFocusPlan(focusPlanJson),
    alignment: parseAlignment(alignmentJson),
    audioUrl: downloadUrl(publicRow.audioPath),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseFocusPlan(value?: string | null): NarrationFocusPlan | null {
  if (!value) return null;
  try {
    const parsed = NarrationFocusPlanSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseAlignment(value?: string | null): NarrationAlignment | null {
  if (!value) return null;
  try {
    const parsed = NarrationAlignmentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function preparedSvgForSlide(slide: SlideDto, theme?: string) {
  return slide.svgPreview ? prepareSlideSvgSource(slide.svgPreview, { theme }) : null;
}

function svgHash(source: string) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function manualNarrationHash(scriptText: string, ttsText: string) {
  return `manual:${crypto.createHash("sha256").update(`${scriptText}\0${ttsText}`).digest("hex")}`;
}

function focusPlanForScript(scriptText: string, preparedSvg: string | null): NarrationFocusPlan | null {
  if (!preparedSvg) return null;
  const { candidates } = extractSvgTextCandidates(preparedSvg);
  return {
    version: 1,
    svgHash: svgHash(preparedSvg),
    targets: buildSafeFocusTargets(scriptText, candidates.map(({ id, text }) => ({ id, text })))
  };
}

function mediaExportDto(row: {
  id: string; projectId: string; kind: string; status: string; progress: number; outputPath: string | null;
  optionsJson: string; error: string | null; createdAt: Date; updatedAt: Date;
}): MediaExportDto {
  let options: { subtitles?: boolean; subtitleFont?: string; subtitleStyle?: MediaExportDto["subtitleStyle"]; subtitleLayout?: SubtitleLayout; focus?: boolean } = {};
  try {
    options = JSON.parse(row.optionsJson) as typeof options;
  } catch {
    options = {};
  }
  const subtitlePath = row.outputPath ? subtitlePathForVideo(row.outputPath) : null;
  const focusReportPath = row.outputPath ? focusReportPathForVideo(row.outputPath) : null;
  return {
    id: row.id,
    projectId: row.projectId,
    kind: "video",
    status: row.status,
    progress: row.progress,
    subtitles: Boolean(options.subtitles),
    subtitleFont: options.subtitleFont || null,
    subtitleStyle: options.subtitleStyle || null,
    subtitleLayout: options.subtitleLayout || null,
    focus: Boolean(options.focus),
    focusReportUrl: focusReportPath && fs.existsSync(focusReportPath)
      ? `/api/projects/${row.projectId}/media-exports/${row.id}/focus-report/download`
      : null,
    previewUrl: downloadUrl(row.outputPath),
    downloadUrl: row.outputPath ? `/api/projects/${row.projectId}/media-exports/${row.id}/download` : null,
    subtitleUrl: subtitlePath && fs.existsSync(subtitlePath)
      ? `/api/projects/${row.projectId}/media-exports/${row.id}/subtitles/download`
      : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function sourceHash(slide: SlideDto, style?: string, theme?: string) {
  return crypto.createHash("sha256").update(JSON.stringify({
    narrationTemplateVersion,
    style: style ?? null,
    theme: theme ?? null,
    title: slide.title,
    goal: slide.slideGoal,
    keyMessage: slide.keyMessage,
    contentPoints: slide.contentPoints,
    plan: slide.planJson,
    svgHash: slide.svgPreview ? svgHash(slide.svgPreview) : null
  })).digest("hex");
}

function spokenFragment(value: string) {
  return value
    .replace(/[|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？；：,.!?;:]+$/u, "");
}

export function buildSpeakerScript(slide: SlideDto, index: number, slides: SlideDto[]) {
  const title = spokenFragment(slide.planJson?.title || slide.title);
  const message = spokenFragment(slide.planJson?.keyMessage || slide.keyMessage || "");
  const items = (slide.planJson?.contentBlocks.flatMap((block) => block.items) || slide.contentPoints)
    .filter(Boolean).map(spokenFragment).filter(Boolean).slice(0, 3);
  const opening = index === 0 ? `大家好，今天我们围绕“${title}”展开分享。` : `接下来我们看第${index + 1}页，${title}。`;
  const support = items.length ? `这里重点关注${items.length}点：${items.join("；")}。` : "这一页主要帮助我们建立共同认识。";
  const transition = index < slides.length - 1
    ? `理解这一点之后，我们继续看“${spokenFragment(slides[index + 1]?.title || "下一部分")}”。`
    : "以上就是本次分享的主要内容，谢谢大家。";
  return `${opening}${message ? `核心结论是：${message}。` : ""}${support}${transition}`.replace(/。+/g, "。").slice(0, 480);
}

async function projectSlides(projectId: string) {
  const rows = await prisma.slide.findMany({
    where: { projectId }, orderBy: { sortOrder: "asc" }, include: { slideSources: true }
  });
  return rows.map(formatSlide);
}

async function ensureNarrations(projectId: string, options: ReturnType<typeof narrationOptionsSchema.parse>) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { theme: true } });
  const allSlides = await projectSlides(projectId);
  const slides = selectScopedSlides(allSlides, options.slideIds);
  const runtime = ttsRuntimeStatus();
  for (const slide of slides) {
    const projectIndex = allSlides.findIndex((candidate) => candidate.id === slide.id);
    const hash = sourceHash(slide, undefined, project?.theme);
    const existing = await prisma.slideNarration.findUnique({ where: { slideId: slide.id } });
    const preparedSvg = preparedSvgForSlide(slide, project?.theme);
    if (existing && !options.force && (existing.sourceHash === hash || existing.sourceHash?.startsWith("manual:"))) {
      const persistedPlan = parseFocusPlan(existing.focusPlanJson);
      const currentSvgHash = preparedSvg ? svgHash(preparedSvg) : null;
      if ((!persistedPlan && preparedSvg) || (persistedPlan && persistedPlan.svgHash !== currentSvgHash)) {
        const focusPlan = focusPlanForScript(existing.scriptText, preparedSvg);
        await prisma.slideNarration.update({
          where: { id: existing.id },
          data: { focusPlanJson: focusPlan ? JSON.stringify(focusPlan) : null }
        });
      }
      continue;
    }
    const scriptText = buildSpeakerScript(slide, projectIndex, allSlides);
    const focusPlan = focusPlanForScript(scriptText, preparedSvg);
    await prisma.slideNarration.upsert({
      where: { slideId: slide.id },
      create: {
        slideId: slide.id, scriptText, ttsText: scriptText,
        voice: options.voice || runtime.voice, model: options.model || runtime.model,
        prompt: options.prompt || "用自然、专业、清晰的中文演讲语气朗读",
        languageCode: options.languageCode || runtime.languageCode, sourceHash: hash,
        focusPlanJson: focusPlan ? JSON.stringify(focusPlan) : null, alignmentJson: null, status: "draft"
      },
      update: {
        scriptText, ttsText: scriptText,
        voice: options.voice || existing?.voice || runtime.voice,
        model: options.model || existing?.model || runtime.model,
        prompt: options.prompt ?? existing?.prompt,
        languageCode: options.languageCode || existing?.languageCode || runtime.languageCode,
        sourceHash: hash, focusPlanJson: focusPlan ? JSON.stringify(focusPlan) : null,
        alignmentJson: null, audioPath: null, audioDurationMs: null, status: "draft"
      }
    });
  }
  return prisma.slideNarration.findMany({
    where: { slide: { projectId }, slideId: { in: slides.map((slide) => slide.id) } },
    orderBy: { slide: { sortOrder: "asc" } }
  });
}

/**
 * 用主模型按风格为单页写口播稿并 upsert；模型失败回退模板，保证不空。
 * 返回是否走了模板兜底。跳过逻辑（sourceHash 未变且非 force）返回 "skipped"。
 */
async function writeSlideScriptNarration(
  slide: SlideDto,
  allSlides: SlideDto[],
  style: SpeechWritingStyleId,
  force: boolean,
  theme?: string
): Promise<"written" | "fallback" | "skipped"> {
  const projectIndex = allSlides.findIndex((candidate) => candidate.id === slide.id);
  const hash = sourceHash(slide, style, theme);
  const existing = await prisma.slideNarration.findUnique({ where: { slideId: slide.id } });
  if (existing && existing.sourceHash === hash && !force) return "skipped";
  const runtime = ttsRuntimeStatus();
  let scriptText: string;
  let focusPlan: NarrationFocusPlan | null = null;
  let usedFallback = false;
  const preparedSvg = preparedSvgForSlide(slide, theme);
  const visibleTextCandidates = preparedSvg
    ? extractSvgTextCandidates(preparedSvg).candidates.map(({ id, text }) => ({ id, text }))
    : [];
  try {
    const plan = await createAiAdapter().generateSpeechScriptPlan(slide, {
      index: projectIndex,
      total: allSlides.length,
      prevTitle: allSlides[projectIndex - 1]?.title,
      nextTitle: allSlides[projectIndex + 1]?.title,
      style,
      visibleTextCandidates
    });
    scriptText = plan.scriptText;
    if (!scriptText.trim()) throw new Error("空稿");
    if (preparedSvg) {
      focusPlan = { version: 1, svgHash: svgHash(preparedSvg), targets: plan.focusTargets };
    }
  } catch {
    usedFallback = true;
    scriptText = buildSpeakerScript(slide, projectIndex, allSlides);
    focusPlan = focusPlanForScript(scriptText, preparedSvg);
  }
  await prisma.slideNarration.upsert({
    where: { slideId: slide.id },
    create: {
      slideId: slide.id, scriptText, ttsText: scriptText,
      voice: existing?.voice || runtime.voice, model: existing?.model || runtime.model,
      prompt: existing?.prompt || "用自然、专业、清晰的中文演讲语气朗读",
      languageCode: existing?.languageCode || runtime.languageCode, sourceHash: hash,
      focusPlanJson: focusPlan ? JSON.stringify(focusPlan) : null, alignmentJson: null, status: "draft"
    },
    update: {
      scriptText, ttsText: scriptText,
      sourceHash: hash, focusPlanJson: focusPlan ? JSON.stringify(focusPlan) : null,
      alignmentJson: null, audioPath: null, audioDurationMs: null, status: "draft"
    }
  });
  return usedFallback ? "fallback" : "written";
}

async function ensureAudio(projectId: string, options: ReturnType<typeof narrationOptionsSchema.parse>) {
  const rows = await ensureNarrations(projectId, options);
  const slides = await projectSlides(projectId);
  const pageBySlideId = new Map(slides.map((slide, index) => [slide.id, index + 1]));
  const targets = rows
    .map((row) => ({ row, pageNumber: pageBySlideId.get(row.slideId) ?? 0 }))
    .filter(({ row }) => options.force || !row.audioPath || !fs.existsSync(row.audioPath));
  if (!targets.length) {
    for (const row of rows) {
      if (!row.alignmentJson && row.audioPath && row.audioDurationMs && fs.existsSync(row.audioPath)) {
        const alignment = await buildAudioAlignment({
          audioPath: row.audioPath,
          audioDurationMs: row.audioDurationMs,
          segments: buildAlignmentSegments(row.ttsText, parseFocusPlan(row.focusPlanJson)?.targets ?? []),
          languageCode: row.languageCode
        });
        await prisma.slideNarration.update({ where: { id: row.id }, data: { alignmentJson: JSON.stringify(alignment) } });
      }
    }
    return prisma.slideNarration.findMany({
      where: { slide: { projectId }, slideId: { in: rows.map((row) => row.slideId) } },
      orderBy: { slide: { sortOrder: "asc" } }
    });
  }

  const requestedConcurrency = normalizeConcurrency(options.concurrency, configuredTtsConcurrency());
  let completed = 0;
  emitProgress(projectId, {
    stage: "export", status: "start",
    message: `开始以 ${requestedConcurrency} 路并发生成 ${targets.length} 页配音`,
    current: 0, total: targets.length
  });
  const outcome = await runWithConcurrency(targets, requestedConcurrency, async ({ row }) => {
    try {
      const audioPath = path.join(exportsDir, `${safePart(projectId)}-${safePart(row.slideId)}-${Date.now()}.mp3`);
      const result = await synthesizeToFile(row.ttsText, audioPath, {
        voice: options.voice || row.voice, model: options.model || row.model,
        prompt: options.prompt ?? row.prompt, languageCode: options.languageCode || row.languageCode
      });
      const focusPlan = parseFocusPlan(row.focusPlanJson);
      const alignment = await buildAudioAlignment({
        audioPath,
        audioDurationMs: result.durationMs,
        segments: buildAlignmentSegments(row.ttsText, focusPlan?.targets ?? []),
        languageCode: options.languageCode || row.languageCode
      });
      await prisma.slideNarration.update({
        where: { id: row.id },
        data: { audioPath, audioDurationMs: result.durationMs, alignmentJson: JSON.stringify(alignment), status: "audio-ready" }
      });
    } catch (error) {
      await prisma.slideNarration.update({ where: { id: row.id }, data: { status: "failed" } });
      throw error;
    } finally {
      completed += 1;
      emitProgress(projectId, {
        stage: "export", status: "start",
        message: `${outcomeLabel(completed, targets.length)}（${requestedConcurrency} 路并发）`,
        current: completed, total: targets.length
      });
    }
  });
  if (outcome.failures.length) {
    const pages = outcome.failures.map(({ item }) => item.pageNumber).join("、");
    const firstError = outcome.failures[0]?.error;
    const detail = firstError instanceof Error ? firstError.message : "TTS 调用失败";
    throw new Error(`第 ${pages} 页配音失败：${detail}`);
  }
  return prisma.slideNarration.findMany({
    where: { slide: { projectId }, slideId: { in: rows.map((row) => row.slideId) } },
    orderBy: { slide: { sortOrder: "asc" } }
  });
}

function outcomeLabel(completed: number, total: number) {
  return `已完成配音 ${completed}/${total}`;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.get("/api/media/status", async (_request, reply) => {
    try {
      const [, catalog] = await Promise.all([assertFfmpegAvailable(), ttsCatalog()]);
      return reply.send(ok({
        ...ttsRuntimeStatus(),
        ...catalog,
        ttsConcurrency: configuredTtsConcurrency(),
        subtitleFonts: subtitleFontCatalog(),
        focusAlignment: {
          available: isTranscriptAlignmentRuntimeConfigured(),
          engine: isTranscriptAlignmentRuntimeConfigured() ? "whisper.cpp" : null,
          minimumCoverage: MIN_TRANSCRIPT_ALIGNMENT_COVERAGE
        },
        ffmpeg: true
      }, "媒体运行时可用"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "FFmpeg 不可用";
      return reply.status(503).send(fail(message));
    }
  });

  app.post("/api/media/tts-preview", async (request, reply) => {
    try {
      const input = ttsPreviewSchema.parse(request.body || {});
      const outputPath = path.join(exportsDir, `tts-preview-${safePart(input.voice || "voice")}-${Date.now()}.mp3`);
      const result = await synthesizeToFile(input.text, outputPath, input);
      return reply.send(ok({
        audioUrl: downloadUrl(outputPath),
        durationMs: result.durationMs,
        voice: result.voice,
        model: result.model,
        prompt: result.prompt || null
      }, "试听已生成"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "TTS 试听失败";
      return reply.status(502).send(fail(message));
    }
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:id/narrations", async (request, reply) => {
    const rows = await prisma.slideNarration.findMany({ where: { slide: { projectId: request.params.id } }, orderBy: { slide: { sortOrder: "asc" } } });
    return reply.send(ok(rows.map(narrationDto)));
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:id/narrations/generate", async (request, reply) => {
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send(fail("未找到项目"));
    const options = narrationOptionsSchema.parse(request.body || {});
    try {
      const rows = await ensureNarrations(project.id, options);
      return reply.send(ok(rows.map(narrationDto), `已生成 ${rows.length} 页演讲稿`));
    } catch (error) {
      if (error instanceof MediaScopeError) return reply.status(error.statusCode).send(fail(error.message));
      throw error;
    }
  });

  // 按「写稿风格」调用主模型生成口播稿；模型失败时回退到模板，保证不空。
  app.post<{ Params: ProjectParams }>("/api/projects/:id/narrations/write", async (request, reply) => {
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send(fail("未找到项目"));
    const input = speechScriptRequestSchema.parse(request.body || {});
    try {
      const allSlides = await projectSlides(project.id);
      const slides = selectScopedSlides(allSlides, input.slideIds);
      let fallbackCount = 0;
      // 并发写稿（最多 3 路），每页内部失败回退模板，不影响其他页
      await runWithConcurrency(slides, 3, async (slide) => {
        const result = await writeSlideScriptNarration(slide, allSlides, input.style, input.force, project.theme);
        if (result === "fallback") fallbackCount += 1;
      });
      const rows = await prisma.slideNarration.findMany({
        where: { slide: { projectId: project.id }, slideId: { in: slides.map((slide) => slide.id) } },
        orderBy: { slide: { sortOrder: "asc" } }
      });
      const suffix = fallbackCount > 0 ? `（${fallbackCount} 页模型不可用，已用模板兜底）` : "";
      return reply.send(ok(rows.map(narrationDto), `已按风格生成 ${rows.length} 页演讲稿${suffix}`));
    } catch (error) {
      if (error instanceof MediaScopeError) return reply.status(error.statusCode).send(fail(error.message));
      throw error;
    }
  });

  // 单页按风格重写演讲稿（用于「重新生成」某一页）
  app.post<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/write-narration", async (request, reply) => {
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send(fail("未找到项目"));
    const input = speechScriptRequestSchema.omit({ slideIds: true }).parse(request.body || {});
    const allSlides = await projectSlides(project.id);
    const slide = allSlides.find((candidate) => candidate.id === request.params.slideId);
    if (!slide) return reply.status(404).send(fail("未找到页面"));
    const result = await writeSlideScriptNarration(slide, allSlides, input.style, true, project.theme);
    const row = await prisma.slideNarration.findUnique({ where: { slideId: slide.id } });
    if (!row) return reply.status(500).send(fail("演讲稿生成失败"));
    const suffix = result === "fallback" ? "（模型不可用，已用模板兜底）" : "";
    return reply.send(ok(narrationDto(row), `本页演讲稿已重新生成${suffix}`));
  });

  app.patch<{ Params: ProjectParams }>("/api/projects/:id/narrations/style", async (request, reply) => {
    const input = narrationStyleSchema.parse(request.body || {});
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send(fail("未找到项目"));
    const runtime = ttsRuntimeStatus();
    let selectedSlideIds: string[];
    try {
      const slides = selectScopedSlides(await projectSlides(project.id), input.slideIds);
      selectedSlideIds = slides.map((slide) => slide.id);
    } catch (error) {
      if (error instanceof MediaScopeError) return reply.status(error.statusCode).send(fail(error.message));
      throw error;
    }
    const result = await prisma.slideNarration.updateMany({
      where: { slide: { projectId: project.id }, slideId: { in: selectedSlideIds } },
      data: {
        voice: input.voice || runtime.voice,
        model: input.model || runtime.model,
        prompt: input.prompt,
        languageCode: input.languageCode || runtime.languageCode,
        audioPath: null,
        audioDurationMs: null,
        alignmentJson: null,
        status: "draft"
      }
    });
    if (!result.count) return reply.status(400).send(fail("请先生成演讲稿"));
    const rows = await prisma.slideNarration.findMany({
      where: { slide: { projectId: project.id }, slideId: { in: selectedSlideIds } },
      orderBy: { slide: { sortOrder: "asc" } }
    });
    return reply.send(ok(rows.map(narrationDto), `已将音色风格应用到 ${result.count} 页，请重新生成配音`));
  });

  app.patch<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/narration", async (request, reply) => {
    const input = updateNarrationSchema.parse(request.body || {});
    const slide = await prisma.slide.findFirst({ where: { id: request.params.slideId, projectId: request.params.id } });
    if (!slide) return reply.status(404).send(fail("未找到页面"));
    const runtime = ttsRuntimeStatus();
    const ttsText = input.ttsText || input.scriptText;
    const sourceHash = manualNarrationHash(input.scriptText, ttsText);
    const row = await prisma.slideNarration.upsert({
      where: { slideId: slide.id },
      create: {
        slideId: slide.id, scriptText: input.scriptText, ttsText,
        voice: input.voice || runtime.voice, model: input.model || runtime.model,
        prompt: input.prompt, languageCode: input.languageCode || runtime.languageCode,
        sourceHash, focusPlanJson: null, alignmentJson: null, status: "draft"
      },
      update: {
        scriptText: input.scriptText, ttsText,
        voice: input.voice, model: input.model, prompt: input.prompt,
        languageCode: input.languageCode, audioPath: null, audioDurationMs: null,
        sourceHash, focusPlanJson: null, alignmentJson: null, status: "draft"
      }
    });
    return reply.send(ok(narrationDto(row), "演讲稿已保存，原配音已失效"));
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:id/narrations/synthesize", async (request, reply) => {
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send(fail("未找到项目"));
    const options = narrationOptionsSchema.parse(request.body || {});
    try {
      const rows = await ensureAudio(project.id, options);
      return reply.send(ok(rows.map(narrationDto), `已生成 ${rows.length} 页配音`));
    } catch (error) {
      if (error instanceof MediaScopeError) return reply.status(error.statusCode).send(fail(error.message));
      throw error;
    }
  });

  app.post<{ Params: SlideParams }>("/api/projects/:id/slides/:slideId/synthesize", async (request, reply) => {
    const input = narrationOptionsSchema.parse(request.body || {});
    const row = await prisma.slideNarration.findFirst({
      where: { slideId: request.params.slideId, slide: { projectId: request.params.id } }
    });
    if (!row) return reply.status(404).send(fail("请先生成本页演讲稿"));
    if (row.audioPath && fs.existsSync(row.audioPath) && !input.force) {
      return reply.send(ok(narrationDto(row), "本页配音已存在"));
    }
    const audioPath = path.join(exportsDir, `${safePart(request.params.id)}-${safePart(row.slideId)}-${Date.now()}.mp3`);
    const result = await synthesizeToFile(row.ttsText, audioPath, {
      voice: input.voice || row.voice, model: input.model || row.model,
      prompt: input.prompt ?? row.prompt, languageCode: input.languageCode || row.languageCode
    });
    const alignment = await buildAudioAlignment({
      audioPath,
      audioDurationMs: result.durationMs,
      segments: buildAlignmentSegments(row.ttsText, parseFocusPlan(row.focusPlanJson)?.targets ?? []),
      languageCode: input.languageCode || row.languageCode
    });
    const updated = await prisma.slideNarration.update({
      where: { id: row.id },
      data: { audioPath, audioDurationMs: result.durationMs, alignmentJson: JSON.stringify(alignment), status: "audio-ready" }
    });
    return reply.send(ok(narrationDto(updated), "本页配音已生成"));
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:id/media-exports", async (request, reply) => {
    const rows = await prisma.mediaExport.findMany({ where: { projectId: request.params.id }, orderBy: { createdAt: "desc" } });
    return reply.send(ok(rows.map(mediaExportDto)));
  });

  app.get<{ Params: MediaExportParams }>("/api/projects/:id/media-exports/:exportId/download", async (request, reply) => {
    const record = await prisma.mediaExport.findFirst({
      where: { id: request.params.exportId, projectId: request.params.id }
    });
    if (!record?.outputPath || record.status !== "completed") {
      return reply.status(404).send(fail("视频文件尚未生成"));
    }
    const resolvedPath = path.resolve(record.outputPath);
    const exportRoot = `${path.resolve(exportsDir)}${path.sep}`;
    if (!resolvedPath.startsWith(exportRoot) || !fs.existsSync(resolvedPath)) {
      return reply.status(404).send(fail("视频文件不存在"));
    }
    return sendAttachment(reply, resolvedPath, "video/mp4");
  });

  app.get<{ Params: MediaExportParams }>("/api/projects/:id/media-exports/:exportId/subtitles/download", async (request, reply) => {
    const record = await prisma.mediaExport.findFirst({
      where: { id: request.params.exportId, projectId: request.params.id }
    });
    if (!record?.outputPath || record.status !== "completed") {
      return reply.status(404).send(fail("字幕文件尚未生成"));
    }
    const resolvedPath = path.resolve(subtitlePathForVideo(record.outputPath));
    const exportRoot = `${path.resolve(exportsDir)}${path.sep}`;
    if (!resolvedPath.startsWith(exportRoot) || !fs.existsSync(resolvedPath)) {
      return reply.status(404).send(fail("字幕文件不存在"));
    }
    return sendAttachment(reply, resolvedPath, "application/x-subrip; charset=utf-8");
  });

  app.get<{ Params: MediaExportParams }>("/api/projects/:id/media-exports/:exportId/focus-report/download", async (request, reply) => {
    const record = await prisma.mediaExport.findFirst({
      where: { id: request.params.exportId, projectId: request.params.id }
    });
    if (!record?.outputPath || record.status !== "completed") {
      return reply.status(404).send(fail("聚焦质检报告尚未生成"));
    }
    const resolvedPath = path.resolve(focusReportPathForVideo(record.outputPath));
    const exportRoot = `${path.resolve(exportsDir)}${path.sep}`;
    if (!resolvedPath.startsWith(exportRoot) || !fs.existsSync(resolvedPath)) {
      return reply.status(404).send(fail("聚焦质检报告不存在"));
    }
    return sendAttachment(reply, resolvedPath, "application/json; charset=utf-8");
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:id/export-video", async (request, reply) => {
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send(fail("未找到项目"));
    const options = videoExportSchema.parse(request.body || {});
    let allSlides: SlideDto[];
    let slides: SlideDto[];
    try {
      allSlides = await projectSlides(project.id);
      slides = selectScopedSlides(allSlides, options.slideIds);
      if (!slides.length) throw new MediaScopeError("当前范围没有可导出的页面");
      assertDesignedSlides(allSlides, slides);
    } catch (error) {
      if (error instanceof MediaScopeError) return reply.status(error.statusCode).send(fail(error.message));
      throw error;
    }
    const job = await prisma.mediaExport.create({
      data: { projectId: project.id, status: "running", progress: 1, optionsJson: JSON.stringify(options) }
    });
    try {
      await assertFfmpegAvailable();
      const narrations = await ensureAudio(project.id, options);
      const workDir = path.join(exportsDir, `.video-${job.id}`);
      fs.mkdirSync(workDir, { recursive: true });
      const clips: string[] = [];
      const subtitleFont = options.subtitles ? resolveSubtitleFont(options.subtitleFont) : null;
      const subtitleLayout = options.subtitleLayout;
      const subtitlePlacement = {
        bottomRatio: subtitleLayout?.bottomRatio ?? SUBTITLE_BOTTOM_MARGIN,
        offsetXRatio: subtitleLayout?.offsetXRatio ?? -0.02
      };
      // 条带高度须覆盖字号所需高度（行高 + 内边距），否则小号字在高边距下会被裁掉。
      const fontScale = subtitleLayout?.fontScaleRatio ?? 0.023;
      const bandHeightRatio = Math.max(subtitlePlacement.bottomRatio, fontScale * 2);
      const subtitleCues: SubtitleCue[] = [];
      const focusReport: Array<Record<string, unknown>> = [];
      let timelineMs = 0;
      for (const [index, slide] of slides.entries()) {
        const narration = narrations.find((item) => item.slideId === slide.id);
        const projectPage = allSlides.findIndex((candidate) => candidate.id === slide.id) + 1;
        if (!narration?.audioPath) throw new Error(`第 ${projectPage} 页缺少配音`);
        const imagePath = path.join(workDir, `${index + 1}.png`);
        const clipPath = path.join(workDir, `${index + 1}.mp4`);
        const preparedSvg = preparedSvgForSlide(slide, project.theme);
        renderSlidePng(slide, imagePath, { width: options.width, theme: project.theme, preparedSvg: preparedSvg ?? undefined });
        const durationMs = narration.audioDurationMs || 0;
        if ((options.subtitles || options.focus) && durationMs <= 0) throw new Error(`第 ${projectPage} 页缺少有效配音时长，无法生成导演时间轴`);
        let alignment = parseAlignment(narration.alignmentJson);
        const shouldRefreshAlignment = !alignment
          || (options.focus && isTranscriptAlignmentRuntimeConfigured() && !isFocusAlignmentTrusted(alignment));
        if (shouldRefreshAlignment && durationMs > 0) {
          alignment = await buildAudioAlignment({
            audioPath: narration.audioPath,
            audioDurationMs: durationMs,
            segments: buildAlignmentSegments(narration.ttsText, parseFocusPlan(narration.focusPlanJson)?.targets ?? []),
            languageCode: narration.languageCode
          });
          await prisma.slideNarration.update({
            where: { id: narration.id }, data: { alignmentJson: JSON.stringify(alignment) }
          });
        }
        const localCues = alignment?.cues ?? [];
        const subtitleOverlays = options.subtitles ? localCues.map((cue, cueIndex) => {
          const overlayPath = path.join(workDir, `${index + 1}-subtitle-${cueIndex + 1}.png`);
          renderSubtitleOverlayPng(cue.text, overlayPath, {
            width: options.width,
            fontPath: subtitleFont!.fontPath,
            fontFamily: subtitleFont!.family,
            style: options.subtitleStyle,
            bandHeightRatio,
            fontScaleRatio: fontScale
          });
          return { imagePath: overlayPath, startMs: cue.startMs, endMs: cue.endMs };
        }) : [];
        subtitleCues.push(...(options.subtitles ? localCues.map((cue) => ({
          startMs: cue.startMs + timelineMs,
          endMs: cue.endMs + timelineMs,
          text: cue.text
        })) : []));
        const focusOverlays: Array<{ imagePath: string; startMs: number; endMs: number }> = [];
        const focusPlan = parseFocusPlan(narration.focusPlanJson);
        const hasIntendedFocus = Boolean(focusPlan?.targets.length);
        const trustedFocusAlignment = isFocusAlignmentTrusted(alignment);
        const focusPreflightRejection = !options.focus
          ? null
          : !preparedSvg
            ? "missing_svg"
            : !focusPlan
              ? "missing_focus_plan"
              : focusPlan.svgHash !== svgHash(preparedSvg)
                ? "stale_svg_hash"
                : hasIntendedFocus && !trustedFocusAlignment
                  ? "untrusted_alignment_source"
                  : null;
        if (focusPreflightRejection) {
          focusReport.push({
            slideId: slide.id,
            page: projectPage,
            status: "rejected",
            alignmentSource: alignment?.source ?? null,
            alignmentQuality: alignment?.quality ?? null,
            rejectionReasons: [focusPreflightRejection]
          });
          throw new Error(`第 ${projectPage} 页聚焦导出已阻止：${focusPreflightRejection}`);
        }
        if (options.focus && hasIntendedFocus && preparedSvg && focusPlan) {
          const extracted = extractSvgTextCandidates(preparedSvg);
          const consumedTargetIndexes = new Set<number>();
          for (const [cueIndex, cue] of localCues.entries()) {
            const targets = cue.focusTargetIndexes.flatMap((targetIndex) => focusPlan.targets[targetIndex] ?? []);
            if (!targets.length) continue;
            cue.focusTargetIndexes.forEach((targetIndex) => consumedTargetIndexes.add(targetIndex));
            const resolution = resolveFocusTarget({
              anchors: [...new Set(targets.flatMap(({ anchors }) => anchors))],
              targetTextIds: [...new Set(targets.flatMap(({ targetTextIds }) => targetTextIds))],
              mode: targets.some(({ mode }) => mode === "container") ? "container" : "text"
            }, extracted.candidates, { viewBox: extracted.viewBox });
            focusReport.push({
              slideId: slide.id,
              page: projectPage,
              cueIndex,
              startMs: cue.startMs,
              endMs: cue.endMs,
              timelineStartMs: timelineMs + cue.startMs,
              timelineEndMs: timelineMs + cue.endMs,
              alignmentSource: alignment?.source ?? null,
              alignmentQuality: alignment?.quality ?? null,
              status: resolution.status,
              focusTargetIndexes: cue.focusTargetIndexes,
              anchors: [...new Set(targets.flatMap(({ anchors }) => anchors))],
              matchedCandidateIds: resolution.matchedCandidateIds ?? [],
              score: resolution.score ?? 0,
              box: resolution.box ?? null,
              qa: resolution.qa ?? null,
              rejectionReasons: resolution.rejectionReasons ?? []
            });
            if (resolution.status !== "resolved" || !resolution.box) {
              throw new Error(`第 ${projectPage} 页第 ${cueIndex + 1} 个聚焦事件未通过几何质检：${(resolution.rejectionReasons ?? ["unknown"]).join(", ")}`);
            }
            const normalizedBox = {
              x: (resolution.box.x - extracted.viewBox.x) / extracted.viewBox.w,
              y: (resolution.box.y - extracted.viewBox.y) / extracted.viewBox.h,
              w: resolution.box.w / extracted.viewBox.w,
              h: resolution.box.h / extracted.viewBox.h
            };
            const focusPath = path.join(workDir, `${index + 1}-focus-${cueIndex + 1}.png`);
            fs.writeFileSync(focusPath, renderFocusOverlayPng(normalizedBox, { width: options.width, height: options.height }));
            focusOverlays.push({ imagePath: focusPath, startMs: cue.startMs, endMs: cue.endMs });
          }
          const missingTargetIndexes = focusPlan.targets
            .map((_target, targetIndex) => targetIndex)
            .filter((targetIndex) => !consumedTargetIndexes.has(targetIndex));
          if (missingTargetIndexes.length) {
            throw new Error(`第 ${projectPage} 页有 ${missingTargetIndexes.length} 个聚焦目标未绑定到最终音频时间轴`);
          }
        }
        await renderNarratedClip({
          imagePath,
          audioPath: narration.audioPath,
          outputPath: clipPath,
          width: options.width,
          height: options.height,
          fps: options.fps,
          subtitleOverlays,
          subtitlePlacement,
          focusOverlays
        });
        timelineMs += durationMs;
        clips.push(clipPath);
        const progress = Math.round(((index + 1) / slides.length) * 90);
        await prisma.mediaExport.update({ where: { id: job.id }, data: { progress } });
        emitProgress(project.id, { stage: "export", status: "start", message: `正在合成视频 ${index + 1}/${slides.length}`, current: index + 1, total: slides.length });
      }
      if (options.focus && !focusReport.some((event) => event.status === "resolved")) {
        throw new Error("当前范围没有任何通过对齐与几何质检的聚焦事件");
      }
      const variant = options.subtitles ? "subtitled" : "clean";
      const outputPath = path.join(exportsDir, `${safePart(project.name)}-${variant}-${Date.now()}.mp4`);
      await concatVideoClips(clips, outputPath);
      await validateRenderedVideo(outputPath);
      if (options.subtitles) {
        fs.writeFileSync(subtitlePathForVideo(outputPath), subtitleCuesToSrt(subtitleCues), "utf8");
      }
      if (options.focus) {
        fs.writeFileSync(focusReportPathForVideo(outputPath), JSON.stringify({
          version: 1,
          projectId: project.id,
          generatedAt: new Date().toISOString(),
          events: focusReport
        }, null, 2), "utf8");
      }
      fs.rmSync(workDir, { recursive: true, force: true });
      const completed = await prisma.mediaExport.update({ where: { id: job.id }, data: { status: "completed", progress: 100, outputPath } });
      emitProgress(project.id, { stage: "export", status: "done", message: "演讲视频已生成" });
      return reply.send(ok(mediaExportDto(completed), "演讲视频已生成"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "视频生成失败";
      const failed = await prisma.mediaExport.update({ where: { id: job.id }, data: { status: "failed", error: message } });
      app.log.error(error, "Video export failed");
      return reply.status(502).send(fail(mediaExportDto(failed).error || message));
    }
  });
}
