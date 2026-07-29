import type {
  ApiResponse,
  BriefJson,
  BriefQuestion,
  CreateBlankSlideInput,
  CreateFactInput,
  CreateProjectInput,
  DesignGenerationMode,
  ExportDto,
  ExportMode,
  FactDto,
  MediaExportDto,
  NarrationOptionsInput,
  NarrationStyleInput,
  PageRenderResult,
  PptExportTheme,
  PresentationStyleId,
  ProjectDetailDto,
  ProjectMaterialDto,
  ProjectDto,
  RenderStrategy,
  ResearchJson,
  SlideDto,
  SlideDesignHistoryDto,
  SlideIrDto,
  SlideNarrationDto,
  SlidePlanDto,
  SlideSearchJson,
  SourceTextDto,
  SpeechScriptRequestInput,
  SvgQualityFailureDto,
  SubtitleLayout,
  SubtitleStyleId,
  TtsPreviewInput,
  UpdateFactInput,
  UpdateProjectInput,
  UpdateSlideInput
} from '@ppt-agent/shared';
import type { PageRenderResultWithGrade } from "./exportMode";
import { collectPageGrades } from "./exportMode";
import { guestProjectRepository } from "./guestProjectStore";
import { isPptApiError, PptApiError, shouldUseGuestProjectFallback } from "./pptApiError";
import { createPptRequestHeaders, isPptGuest } from "./pptRequestContext";
import { readAuthSession } from "@/shared/lib/config/auth";

export { isPptApiError, PptApiError };
import {
  describeModelUsageHttpError,
  parseModelUsageDashboard,
  type ModelUsageEventDto,
} from "./modelUsage";

/** 与业务请求、SSE 进度共用；勿再写第二套 VITE_API_BASE */
export function getApiBase() {
  const raw = import.meta.env?.VITE_API_BASE_URL ?? "/ppt-api";
  return String(raw).replace(/\/$/, "");
}

const API_BASE = getApiBase();

export interface GenerateDesignsResult {
  slides: SlideDto[];
  failures: Array<{
    slideId: string;
    title: string;
    message: string;
    qualityFailure?: SvgQualityFailureDto;
  }>;
  /** 本轮实际生成 SVG 的页数（按策略） */
  generatedSvgCount?: number;
  /** 本轮实际生成 SmartSlide IR 的页数 */
  generatedIrCount?: number;
  /** 本轮跳过 SVG、走 IR ensure 的页数 */
  skippedSvgCount?: number;
}

/** @deprecated 与 shared PageRenderResult 对齐；保留别名避免外部引用断裂 */
export type PageRenderResultDto = PageRenderResult;

/** 导出响应即 ExportDto（含可选 mode / warnings / pageResults；grade 字段本地兼容） */
export type ExportFeedbackDto = ExportDto & {
  pageResults?: PageRenderResultWithGrade[];
};

/** AI 用量摘要（对齐 shared AiUsageDto.counts 求和；兼容易平铺 callCount） */
export interface AiUsageSummary {
  callCount: number;
  label: string;
  provider?: string;
  model: string;
  designModel?: string;
  projectRunCount?: number;
  totalTokens?: number;
  limitTokens?: number;
  isHardLimit?: boolean;
  monthlyUsedTokens?: number;
  monthlyRemainingTokens?: number;
  monthlyUsedPercent?: number;
  monthlyRemainingPercent?: number;
  period?: string;
  estimatedCost?: number;
  currency?: string;
  cachedTokens?: number;
  reasoningTokens?: number;
  unpricedCount?: number;
  events?: ModelUsageEventDto[];
  usageError?: string;
  /** 来自 ppt-agent-engine 的真实 Token 用量 */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    callCount: number;
  };
}

/** 从导出响应收集可展示的提示文案（去重） */
export function collectExportWarnings(record: ExportDto): string[] {
  const items: string[] = [];
  for (const warning of record.warnings ?? []) {
    const text = typeof warning === "string" ? warning.trim() : "";
    if (text) items.push(text);
  }
  for (const page of record.pageResults ?? []) {
    const text = typeof page.warning === "string" ? page.warning.trim() : "";
    if (text) items.push(text);
  }
  return [...new Set(items)];
}

export function collectExportPageGrades(record: ExportFeedbackDto) {
  return collectPageGrades(record.pageResults);
}

function readNumberField(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    }
  }
  return null;
}

/** 对齐 shared AiUsageCounts：extractFacts/outline/plan/ir/svg 求和 */
function sumAiUsageCounts(counts: unknown): number | null {
  if (!counts || typeof counts !== "object") return null;
  const obj = counts as Record<string, unknown>;
  let total = 0;
  let found = false;
  for (const key of ["extractFacts", "outline", "plan", "ir", "svg"] as const) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      total += Math.round(value);
      found = true;
    }
  }
  return found ? total : null;
}

function pickProvider(...sources: Array<Record<string, unknown> | null>): string | undefined {
  for (const source of sources) {
    if (source && typeof source.provider === "string") return source.provider;
  }
  return undefined;
}

/**
 * 从 /api/ai/usage（ok 包 AiUsageDto）或 /api/ai/status（usage 嵌套）提取调用次数。
 * 优先求和 counts；再回落平铺 callCount 等；无有效数字则 null。
 */
export function parseAiUsageSummary(payload: unknown): AiUsageSummary | null {
  if (!payload || typeof payload !== "object") return null;

  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const usage =
    root.usage && typeof root.usage === "object" ? (root.usage as Record<string, unknown>) : null;
  const candidates = [data, usage, root].filter(Boolean) as Record<string, unknown>[];

  // 提取 tokenUsage（来自 AiUsageDto.tokenUsage）
  let tokenUsage: AiUsageSummary["tokenUsage"] | undefined;
  for (const candidate of candidates) {
    const tu = candidate.tokenUsage as Record<string, unknown> | undefined;
    if (tu && typeof tu === "object" && typeof tu.totalTokens === "number" && tu.totalTokens > 0) {
      tokenUsage = {
        promptTokens: typeof tu.promptTokens === "number" ? tu.promptTokens : 0,
        completionTokens: typeof tu.completionTokens === "number" ? tu.completionTokens : 0,
        totalTokens: typeof tu.totalTokens === "number" ? tu.totalTokens : 0,
        callCount: typeof tu.callCount === "number" ? tu.callCount : 0,
      };
      break;
    }
  }

  for (const candidate of candidates) {
    const fromCounts = sumAiUsageCounts(candidate.counts);
    if (fromCounts !== null) {
      return {
        callCount: fromCounts,
        label: `本次会话 AI 调用约 ${fromCounts} 次`,
        provider: pickProvider(root, candidate),
        model: (typeof root.model === "string" ? root.model : undefined) || "AI",
        tokenUsage,
      };
    }
  }

  const flatKeys = ["callCount", "totalCalls", "calls", "requestCount", "aiCallCount"];
  for (const candidate of candidates) {
    const callCount = readNumberField(candidate, flatKeys);
    if (callCount !== null) {
      return {
        callCount,
        label: `本次会话 AI 调用约 ${callCount} 次`,
        provider: pickProvider(root, candidate),
        model: (typeof root.model === "string" ? root.model : undefined) || "AI",
        tokenUsage,
      };
    }
  }

  return null;
}

async function fetchJsonLoose(apiPath: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${API_BASE}${apiPath}`, {
      headers: createPptRequestHeaders(),
      credentials: "include"
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

type Fetcher = typeof fetch;

async function requestWith<T>(
  fetcher: Fetcher,
  apiBase: string,
  apiPath: string,
  options: RequestInit = {}
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = createPptRequestHeaders({
    headers: options.headers,
    includeJsonContentType: options.body !== undefined && !isFormData,
  });

  const response = await fetcher(`${apiBase}${apiPath}`, {
    ...options,
    headers,
    credentials: "include"
  });
  const responseText = await response.text();
  let payload: ApiResponse<T>;
  try {
    payload = JSON.parse(responseText) as ApiResponse<T>;
  } catch {
    if (!response.ok) {
      throw new PptApiError(
        `请求失败（HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}）`,
        response.status
      );
    }
    throw new Error("服务返回了无法解析的响应");
  }
  if (!response.ok || !payload.success) {
    throw new PptApiError(payload.message || "请求失败", response.status, payload.data);
  }
  return payload.data;
}

async function request<T>(apiPath: string, options: RequestInit = {}): Promise<T> {
  return requestWith<T>(fetch, API_BASE, apiPath, options);
}

export async function uploadProjectMaterialRequest(
  projectId: string,
  file: File,
  fetcher: Fetcher = fetch,
  apiBase = API_BASE
): Promise<ProjectMaterialDto> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return requestWith<ProjectMaterialDto>(
    fetcher,
    apiBase,
    `/api/projects/${encodeURIComponent(projectId)}/materials`,
    { method: "POST", body: formData }
  );
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

export const api = {
  async listProjects() {
    if (isPptGuest()) return guestProjectRepository.list();
    return request<ProjectDto[]>("/api/projects");
  },
  createProject(input: CreateProjectInput) {
    return request<ProjectDto>("/api/projects", json("POST", input));
  },
  async getProject(projectId: string) {
    try {
      const detail = await request<ProjectDetailDto>(`/api/projects/${projectId}`);
      if (isPptGuest()) await guestProjectRepository.save(detail).catch(() => undefined);
      return detail;
    } catch (error) {
      if (isPptGuest()) {
        const status = isPptApiError(error) ? error.status : 0;
        if (status === 404) {
          await guestProjectRepository.remove(projectId).catch(() => undefined);
        } else if (shouldUseGuestProjectFallback(status)) {
          const local = await guestProjectRepository.get(projectId).catch(() => null);
          if (local) return local;
        }
      }
      throw error;
    }
  },
  updateProject(projectId: string, input: UpdateProjectInput) {
    return request<ProjectDto>(`/api/projects/${projectId}`, json("PATCH", input));
  },
  saveSourceText(projectId: string, text: string) {
    return request<SourceTextDto>(`/api/projects/${projectId}/source-text`, json("POST", { text }));
  },
  listMaterials(projectId: string) {
    return request<ProjectMaterialDto[]>(`/api/projects/${projectId}/materials`);
  },
  getMaterial(projectId: string, materialId: string) {
    return request<ProjectMaterialDto>(`/api/projects/${projectId}/materials/${materialId}`);
  },
  uploadMaterial(projectId: string, file: File) {
    return uploadProjectMaterialRequest(projectId, file);
  },
  deleteMaterial(projectId: string, materialId: string) {
    return request<{ id: string }>(`/api/projects/${projectId}/materials/${materialId}`, json("DELETE"));
  },
  extractFacts(projectId: string, materialIds?: string[]) {
    return request<FactDto[]>(`/api/projects/${projectId}/extract-facts`, json("POST", { materialIds }));
  },
  createFact(projectId: string, input: CreateFactInput) {
    return request<FactDto>(`/api/projects/${projectId}/facts`, json("POST", input));
  },
  updateFact(projectId: string, factId: string, input: UpdateFactInput) {
    return request<FactDto>(`/api/projects/${projectId}/facts/${factId}`, json("PATCH", input));
  },
  deleteFact(projectId: string, factId: string) {
    return request<{ id: string }>(`/api/projects/${projectId}/facts/${factId}`, json("DELETE"));
  },
  generateOutline(projectId: string) {
    return request<SlideDto[]>(`/api/projects/${projectId}/generate-outline`, json("POST", {}));
  },
  updateSlide(projectId: string, slideId: string, input: UpdateSlideInput) {
    return request<SlideDto>(`/api/projects/${projectId}/slides/${slideId}`, json("PATCH", input));
  },
  listSlideDesignVersions(projectId: string, slideId: string) {
    return request<SlideDesignHistoryDto>(
      `/api/projects/${projectId}/slides/${slideId}/design-versions`
    );
  },
  activateSlideDesignVersion(projectId: string, slideId: string, versionId: string) {
    return request<SlideDto>(
      `/api/projects/${projectId}/slides/${slideId}/design-versions/${versionId}/activate`,
      json("PATCH")
    );
  },
  reorderSlides(projectId: string, slideIds: string[]) {
    return request<SlideDto[]>(`/api/projects/${projectId}/slides/reorder`, json("POST", { slideIds }));
  },
  createBlankSlide(projectId: string, input: Partial<CreateBlankSlideInput> = {}) {
    return request<SlideDto>(
      `/api/projects/${projectId}/slides`,
      json("POST", {
        title: input.title ?? "新增空白页",
        keyMessage: input.keyMessage ?? "请补充本页核心结论",
        partTitle: input.partTitle,
        afterSlideId: input.afterSlideId
      })
    );
  },
  deleteSlide(projectId: string, slideId: string) {
    return request<SlideDto[]>(`/api/projects/${projectId}/slides/${slideId}`, json("DELETE"));
  },
  generateSlidePlan(projectId: string, slideId: string) {
    return request<{ plan: SlidePlanDto; slide: SlideDto }>(`/api/projects/${projectId}/slides/${slideId}/generate-plan`, json("POST", {}));
  },
  generateAllPlans(projectId: string) {
    return request<SlideDto[]>(`/api/projects/${projectId}/generate-all-plans`, json("POST", {}));
  },
  generateSlideIr(projectId: string, slideId: string, theme: PptExportTheme) {
    return request<{ ir: SlideIrDto; slide: SlideDto }>(
      `/api/projects/${projectId}/slides/${slideId}/generate-design`,
      json("POST", { theme, designMode: "slide-ir" })
    );
  },
  async generateAllIr(projectId: string, theme: PptExportTheme) {
    const result = await request<GenerateDesignsResult>(
      `/api/projects/${projectId}/generate-all-designs`,
      json("POST", { theme, designMode: "slide-ir", force: true })
    );
    return result.slides;
  },
  generateSvgPreview(projectId: string, slideId: string, theme: PptExportTheme, options?: { accentId?: string; surfaceId?: string; presentationStyle?: PresentationStyleId }) {
    return request<{ svgPreview: string; slide: SlideDto }>(`/api/projects/${projectId}/slides/${slideId}/generate-svg-preview`, json("POST", { theme, ...options }));
  },
  generateSlideDesign(projectId: string, slideId: string, theme: PptExportTheme, mode: ExportMode = "standard", options?: { accentId?: string; surfaceId?: string; presentationStyle?: PresentationStyleId; designMode?: DesignGenerationMode }) {
    return request<{ svgPreview: string; ir?: SlideIrDto | null; slide: SlideDto }>(
      `/api/projects/${projectId}/slides/${slideId}/generate-design`,
      json("POST", { theme, mode, ...options })
    );
  },
  generateAllDesigns(projectId: string, theme: PptExportTheme, mode: ExportMode = "standard", options?: { accentId?: string; surfaceId?: string; presentationStyle?: PresentationStyleId; designMode?: DesignGenerationMode }) {
    return request<GenerateDesignsResult>(
      `/api/projects/${projectId}/generate-all-designs`,
      json("POST", { theme, force: true, mode, ...options })
    );
  },
  /** mode 为导出策略；draft 模式同时传 draft:true 以兼容旧 API（exportPptxSchema） */
  exportPptx(
    projectId: string,
    theme: PptExportTheme,
    mode: ExportMode = "standard",
    options?: { accentId?: string; slideIds?: string[]; fillMissing?: boolean; svgExportMode?: "fidelity" | "editable" }
  ) {
    const body = {
      theme,
      mode,
      draft: mode === "draft",
      accentId: options?.accentId,
      svgExportMode: options?.svgExportMode ?? "editable",
      slideIds: options?.slideIds,
      // UI 默认不自动补齐；需要流水线式补稿时显式 true
      fillMissing: options?.fillMissing ?? false
    };
    return request<ExportFeedbackDto>(`/api/projects/${projectId}/export-pptx`, json("POST", body));
  },
  /** 按页覆盖 renderStrategy（依赖 updateSlideSchema.renderStrategy） */
  updateSlideRenderStrategy(projectId: string, slideId: string, renderStrategy: RenderStrategy) {
    return request<SlideDto>(`/api/projects/${projectId}/slides/${slideId}`, json("PATCH", { renderStrategy }));
  },
  /**
   * 轻量用量摘要：从 /api/ai/status 获取模型配置，从 /api/billing/me 获取用户额度，
   * 从项目数据推算当前项目 AI 交互次数。
   */
  async getAiUsageSummary(projectId?: string): Promise<AiUsageSummary | null> {
    const status = (await fetchJsonLoose("/api/ai/status")) as Record<string, unknown> | null;
    const modelName = (typeof status?.model === "string" ? status.model : null) ||
                      (typeof status?.provider === "string" ? status.provider : "AI");
    const designModelName = typeof status?.designModel === "string" ? status.designModel : modelName;
    let dashboard = parseModelUsageDashboard({ project_summary: {}, events: [] });
    let usageError: string | undefined;
    try {
      const token = readAuthSession()?.access_token;
      if (!token) {
        usageError = "登录后才会持久化并显示项目调用明细";
      } else {
        const platformBase = String(import.meta.env?.VITE_PLATFORM_API_BASE_URL ?? (import.meta.env?.DEV ? "http://localhost:8000" : "")).replace(/\/$/, "");
        const query = new URLSearchParams({ limit: "100" });
        if (projectId) query.set("project_id", projectId);
        const response = await fetch(`${platformBase}/api/billing/me/model-usage?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        if (!response.ok) throw new Error(describeModelUsageHttpError(response.status));
        dashboard = parseModelUsageDashboard(await response.json());
      }
    } catch (error) {
      usageError = error instanceof Error && error.message
        ? error.message
        : "项目用量明细暂时无法读取，请稍后刷新";
    }

    const project = dashboard.project;
    const label = `${modelName} · 项目 ${project.callCount} 次`;

    return {
      callCount: project.callCount,
      label,
      provider: typeof status?.provider === "string" ? status.provider : undefined,
      model: modelName,
      designModel: designModelName,
      projectRunCount: project.callCount,
      totalTokens: project.totalTokens,
      limitTokens: dashboard.limitTokens,
      isHardLimit: dashboard.isHardLimit,
      monthlyUsedTokens: dashboard.monthlyQuota.usedTokens,
      monthlyRemainingTokens: dashboard.monthlyQuota.remainingTokens,
      monthlyUsedPercent: dashboard.monthlyQuota.usedPercent,
      monthlyRemainingPercent: dashboard.monthlyQuota.remainingPercent,
      period: dashboard.period,
      estimatedCost: project.estimatedCost,
      currency: project.currency,
      cachedTokens: project.cachedTokens,
      reasoningTokens: project.reasoningTokens,
      unpricedCount: project.unpricedCount,
      events: dashboard.events,
      usageError,
      tokenUsage: {
        promptTokens: project.inputTokens,
        completionTokens: project.outputTokens,
        totalTokens: project.totalTokens,
        callCount: project.callCount,
      },
    };
  },
  startBrief(projectId: string) {
    return request<{ questions: BriefQuestion[]; project: ProjectDto }>(
      `/api/projects/${projectId}/brief/start`,
      json("POST", {})
    );
  },
  answerBrief(projectId: string, answers: Record<string, string>) {
    return request<{ brief: BriefJson; project: ProjectDto }>(
      `/api/projects/${projectId}/brief/answer`,
      json("POST", { answers })
    );
  },
  runResearch(projectId: string) {
    return request<{ research: ResearchJson; project: ProjectDto }>(
      `/api/projects/${projectId}/research`,
      json("POST", {})
    );
  },
  searchSlide(projectId: string, slideId: string) {
    return request<{ searchJson: SlideSearchJson; slide: SlideDto }>(
      `/api/projects/${projectId}/slides/${slideId}/search`,
      json("POST", {})
    );
  },
  searchAllSlides(projectId: string) {
    return request<{
      slides: SlideDto[];
      failures: Array<{ slideId: string; title: string; message: string }>;
      /** 本次 fan-out 并发度（LangGraph 风格 max_concurrency） */
      concurrency?: number;
    }>(`/api/projects/${projectId}/search-all`, json("POST", {}));
  },
  runPipeline(projectId: string, input: { theme?: PptExportTheme; accentId?: string; surfaceId?: string; presentationStyle?: PresentationStyleId; mode?: ExportMode; skipDesign?: boolean } = {}) {
    return request<{ detail: ProjectDetailDto; logs: string[] }>(
      `/api/projects/${projectId}/run-pipeline`,
      json("POST", input)
    );
  },
  getMediaStatus() {
    return request<{
      configured: boolean;
      ffmpeg: boolean;
      model: string;
      voice: string;
      languageCode: string;
      voices: string[];
      models: string[];
      ttsConcurrency: number;
      subtitleFonts: Array<{ id: string; label: string; family: string; license: string }>;
    }>("/api/media/status");
  },
  previewTts(input: TtsPreviewInput) {
    return request<{ audioUrl: string; durationMs: number; voice: string; model: string; prompt: string | null }>("/api/media/tts-preview", json("POST", input));
  },
  getNarrations(projectId: string) {
    return request<SlideNarrationDto[]>(`/api/projects/${projectId}/narrations`);
  },
  generateNarrations(projectId: string, input: NarrationOptionsInput = {}) {
    return request<SlideNarrationDto[]>(`/api/projects/${projectId}/narrations/generate`, json("POST", input));
  },
  writeNarrations(projectId: string, input: SpeechScriptRequestInput) {
    return request<SlideNarrationDto[]>(`/api/projects/${projectId}/narrations/write`, json("POST", input));
  },
  writeNarration(projectId: string, slideId: string, input: Omit<SpeechScriptRequestInput, "slideIds">) {
    return request<SlideNarrationDto>(`/api/projects/${projectId}/slides/${slideId}/write-narration`, json("POST", input));
  },
  applyNarrationStyle(projectId: string, input: NarrationStyleInput) {
    return request<SlideNarrationDto[]>(`/api/projects/${projectId}/narrations/style`, json("PATCH", input));
  },
  synthesizeNarrations(projectId: string, input: NarrationOptionsInput = {}) {
    return request<SlideNarrationDto[]>(`/api/projects/${projectId}/narrations/synthesize`, json("POST", input));
  },
  synthesizeNarration(projectId: string, slideId: string, input: NarrationOptionsInput = {}) {
    return request<SlideNarrationDto>(`/api/projects/${projectId}/slides/${slideId}/synthesize`, json("POST", input));
  },
  updateNarration(projectId: string, slideId: string, scriptText: string) {
    return request<SlideNarrationDto>(`/api/projects/${projectId}/slides/${slideId}/narration`, json("PATCH", { scriptText }));
  },
  getMediaExports(projectId: string) {
    return request<MediaExportDto[]>(`/api/projects/${projectId}/media-exports`);
  },
  exportVideo(projectId: string, input: NarrationOptionsInput & { subtitles?: boolean; subtitleFont?: string; subtitleStyle?: SubtitleStyleId; subtitleLayout?: SubtitleLayout } = {}) {
    return request<MediaExportDto>(`/api/projects/${projectId}/export-video`, json("POST", { ...input, width: 1920, height: 1080, fps: 30 }));
  }
};

export function absoluteDownloadUrl(url: string) {
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

/** 触发浏览器下载（导出成功后自动拉文件；兼容相对路径） */
export async function triggerBrowserDownload(url: string, fileName?: string) {
  const response = await fetch(absoluteDownloadUrl(url), {
    headers: createPptRequestHeaders(),
    credentials: "include"
  });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName ?? "";
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
