import { fetch as undiciFetch, ProxyAgent } from "undici";
import type {
  ExtractedFactDraft,
  ExtractFactsResult,
  FactDto,
  OutlineSlideDraft,
  PptExportTheme,
  ProjectDto,
  SlideDto,
  SlideIrDto,
  SlideIrElementDto,
  SlidePlanDto
} from "@ppt-agent/shared";
import {
  applyCopyBudgetsToBlockItems,
  applyCopyBudgetsToSlideFields,
  buildIrFromSkeleton,
  factCategories,
  factStatuses,
  getSkeletonFrame,
  normalizePptExportTheme,
  normalizeRecommendedLayout,
  pickDefaultVariant,
  recommendedLayoutEnumValues,
  SlideIrSchema,
  snapIrToSkeleton,
  themeFamily
} from "@ppt-agent/shared";
import {
  buildExtractFactsPrompt,
  buildOutlinePrompt,
  buildSlideIrPrompt,
  buildSlidePlanPrompt,
  buildSvgPreviewPrompt,
  extractFactsSystemPrompt,
  outlineSystemPrompt,
  slideIrSystemPrompt,
  slidePlanSystemPrompt,
  svgPreviewSystemPrompt
} from "./prompts.js";
import { normalizeSlideDesignGuide } from "./studioHelpers.js";
import type { GeminiAdapter, SvgGenerationOptions } from "./types.js";

const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const defaultModel = "gemini-3.1-flash-lite";
const defaultDesignModel = "gemini-3.1-flash-lite";

type JsonObject = Record<string, unknown>;
type FetchOptionsWithDispatcher = NonNullable<Parameters<typeof undiciFetch>[1]>;
type GeminiResponse = Awaited<ReturnType<typeof undiciFetch>>;
type RequestInteractionOptions = {
  model?: string;
  temperature?: number;
  thinkingLevel?: "low" | "medium" | "high";
};

const factDraftSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...factCategories] },
    content: { type: "string" },
    status: { type: "string", enum: [...factStatuses] },
    confidence: { type: "number" },
    sourceText: { type: "string" },
    sourceLocation: { type: "string" },
    canUseInPpt: { type: "boolean" }
  },
  required: ["category", "content", "status", "confidence", "sourceText", "sourceLocation", "canUseInPpt"]
} as const;

export const extractFactsSchema = {
  type: "object",
  properties: {
    facts: { type: "array", items: factDraftSchema },
    risks: { type: "array", items: factDraftSchema },
    uncertainties: { type: "array", items: factDraftSchema },
    nextSteps: { type: "array", items: factDraftSchema }
  },
  required: ["facts", "risks", "uncertainties", "nextSteps"]
} as const;

const outlineSlideSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    slideGoal: { type: "string" },
    keyMessage: { type: "string" },
    contentPoints: { type: "array", items: { type: "string" } },
    sourceFactIds: { type: "array", items: { type: "string" } },
    recommendedLayout: {
      type: "string",
      enum: [...recommendedLayoutEnumValues()]
    },
    partTitle: { type: "string" }
  },
  required: ["title", "slideGoal", "keyMessage", "contentPoints", "sourceFactIds", "recommendedLayout"]
} as const;

export const outlineSchema = {
  type: "array",
  items: outlineSlideSchema
} as const;

export const slidePlanSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    pageGoal: { type: "string" },
    keyMessage: { type: "string" },
    layoutType: { type: "string" },
    contentBlocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["bullets", "timeline", "table", "callout"] },
          title: { type: "string" },
          items: { type: "array", items: { type: "string" } }
        },
        required: ["type", "title", "items"]
      }
    },
    sourceFactIds: { type: "array", items: { type: "string" } },
    /** 视觉指导：建议图形类型、主视觉表达、需强调的数据点 */
    visualHint: {
      type: "object",
      properties: {
        chartType: { type: "string" },
        heroVisual: { type: "string" },
        emphasis: { type: "array", items: { type: "string" } }
      }
    },
    /** 内部设计交接：指定全页和每个正文模块的形状、位置与处理 */
    designGuide: {
      type: "object",
      properties: {
        composition: { type: "string" },
        background: { type: "string" },
        title: { type: "string" },
        keyMessage: { type: "string" },
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              blockIndex: { type: "integer" },
              shape: { type: "string" },
              placement: { type: "string" },
              treatment: { type: "string" }
            },
            required: ["blockIndex", "shape", "placement", "treatment"]
          }
        },
        decoration: { type: "string" }
      },
      required: ["composition", "background", "title", "keyMessage", "blocks"]
    }
  },
  required: ["title", "pageGoal", "keyMessage", "layoutType", "contentBlocks", "sourceFactIds", "designGuide"]
} as const;

export const slideIrJsonSchema = {
  type: "object",
  properties: {
    version: { type: "string" },
    canvas: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["width", "height"]
    },
    title: { type: "string" },
    layout: { type: "string" },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["text", "card", "metric", "table", "timeline", "process", "callout", "decor"] },
          role: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          z: { type: "number" },
          content: {
            type: "object",
            properties: {
              title: { type: "string" },
              text: { type: "string" },
              body: { type: "string" },
              label: { type: "string" },
              value: { type: "string" },
              note: { type: "string" },
              items: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array", items: { type: "string" } } }
            }
          },
          style: { type: "object" },
          editable: { type: "boolean" }
        },
        required: ["id", "type", "role", "x", "y", "w", "h", "z", "content", "style", "editable"]
      }
    }
  },
  required: ["version", "canvas", "title", "layout", "elements"]
} as const;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

function clampConfidence(value: unknown) {
  return clampNumber(value, 0, 1, 0.78);
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }
    const firstBrace = trimmed.indexOf("{");
    const firstBracket = trimmed.indexOf("[");
    const startCandidates = [firstBrace, firstBracket].filter((index) => index >= 0);
    const start = Math.min(...startCandidates);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (Number.isFinite(start) && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Gemini 返回的内容不是合法 JSON。");
  }
}

function outputTextFromInteraction(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }
  const object = payload as JsonObject;
  if (typeof object.output_text === "string") {
    return object.output_text;
  }
  if (typeof object.outputText === "string") {
    return object.outputText;
  }
  const steps = asArray(object.steps);
  return steps
    .flatMap((step) => asArray((step as JsonObject)?.content))
    .map((content) => (content as JsonObject)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

export function parseInteractionSseBuffer(buffer: string) {
  const deltas: string[] = [];
  let error = "";
  let cursor = 0;

  while (cursor < buffer.length) {
    const lfBoundary = buffer.indexOf("\n\n", cursor);
    const crlfBoundary = buffer.indexOf("\r\n\r\n", cursor);
    const candidates = [lfBoundary, crlfBoundary].filter((value) => value >= 0);
    if (candidates.length === 0) break;
    const boundary = Math.min(...candidates);
    const separatorLength = boundary === crlfBoundary ? 4 : 2;
    const block = buffer.slice(cursor, boundary);
    cursor = boundary + separatorLength;

    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;

    try {
      const payload = JSON.parse(data) as JsonObject;
      const eventType = asString(payload.event_type);
      const delta = typeof payload.delta === "object" && payload.delta !== null ? (payload.delta as JsonObject) : {};
      if (eventType === "step.delta" && delta.type === "text" && typeof delta.text === "string") {
        deltas.push(delta.text);
      } else if (eventType === "error") {
        const detail = typeof payload.error === "object" && payload.error !== null ? (payload.error as JsonObject) : {};
        error = asString(detail.message, "Gemini 流式生成失败");
      }
    } catch {
      // Ignore non-JSON keep-alives; a complete malformed event must not block later deltas.
    }
  }

  return { deltas, error, remaining: buffer.slice(cursor) };
}

function normalizeProxyUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function configuredProxyUrl() {
  return normalizeProxyUrl(process.env.GEMINI_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY ?? "");
}

function buildFetchOptions(apiKey: string, body: unknown, stream = false): FetchOptionsWithDispatcher {
  const proxyUrl = configuredProxyUrl();
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      ...(stream ? { Accept: "text/event-stream" } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
    ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {})
  };
}

function explainGeminiNetworkError(error: unknown) {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeObject = typeof cause === "object" && cause !== null ? (cause as { code?: string; message?: string }) : {};
  const detail = causeObject.code || causeObject.message || (error instanceof Error ? error.message : "");
  const proxyHint = configuredProxyUrl()
    ? "当前已配置代理，请确认代理软件正在运行且端口可用。"
    : "当前未配置后端代理，请在 .env 设置 GEMINI_PROXY_URL，例如 GEMINI_PROXY_URL=http://127.0.0.1:7892。";

  return `Gemini API 网络连接失败：后端无法连接 generativelanguage.googleapis.com。${proxyHint}${detail ? ` 底层错误：${detail}` : ""}`;
}

function explainGeminiApiError(status: number, errorText: string) {
  let message = errorText.slice(0, 500);
  let apiStatus = "";

  try {
    const payload = JSON.parse(errorText) as { error?: { message?: string; status?: string } };
    message = payload.error?.message ?? message;
    apiStatus = payload.error?.status ?? "";
  } catch {
    // Keep raw response text.
  }

  if (status === 403 || apiStatus === "PERMISSION_DENIED") {
    return `Gemini 项目无权限：当前 API Key 所属项目无法调用这个模型或 Gemini API。请检查结算、地区和访问权限。原始信息：${message}`;
  }
  if (status === 429 || apiStatus === "RESOURCE_EXHAUSTED") {
    return `Gemini 配额不足或已用完：当前 API Key 的免费额度/请求额度不足。请查看用量和结算，稍后再试或换有额度的项目。原始信息：${message}`;
  }
  if (status === 503 || apiStatus === "UNAVAILABLE") {
    return `Gemini 模型暂时繁忙：当前模型需求过高或暂时不可用。请稍后重试，或把 GEMINI_MODEL 改成 gemini-3.1-flash-lite。原始信息：${message}`;
  }
  if (status === 400 || apiStatus === "INVALID_ARGUMENT") {
    return `Gemini 请求参数无效：请检查模型名、API Key 和结构化输出参数。原始信息：${message}`;
  }
  return `Gemini API 调用失败（${status}）：${message}`;
}

function normalizeFactDraft(value: unknown, fallbackCategory: ExtractedFactDraft["category"]): ExtractedFactDraft {
  const object = (typeof value === "object" && value !== null ? value : {}) as JsonObject;
  const category = factCategories.includes(object.category as ExtractedFactDraft["category"]) ? (object.category as ExtractedFactDraft["category"]) : fallbackCategory;
  const status = factStatuses.includes(object.status as ExtractedFactDraft["status"]) ? (object.status as ExtractedFactDraft["status"]) : "uncertain";
  const content = asString(object.content, asString(object.sourceText, "待补充事实"));

  return {
    category,
    content,
    status,
    confidence: clampConfidence(object.confidence),
    sourceText: asString(object.sourceText, content),
    sourceLocation: asString(object.sourceLocation, "Gemini 提取"),
    canUseInPpt: typeof object.canUseInPpt === "boolean" ? object.canUseInPpt : true
  };
}

export function normalizeFactsResult(value: unknown): ExtractFactsResult {
  const object = (typeof value === "object" && value !== null ? value : {}) as JsonObject;
  return {
    facts: asArray(object.facts).map((item) => normalizeFactDraft(item, "建议与判断")),
    risks: asArray(object.risks).map((item) => normalizeFactDraft(item, "风险问题")),
    uncertainties: asArray(object.uncertainties).map((item) => normalizeFactDraft(item, "待确认事项")),
    nextSteps: asArray(object.nextSteps).map((item) => normalizeFactDraft(item, "下一步计划"))
  };
}

export function normalizeOutline(value: unknown, allowedFactIds: Set<string>, pageCount: number): OutlineSlideDraft[] {
  return asArray(value)
    .slice(0, pageCount)
    .map((item, index) => {
      const object = (typeof item === "object" && item !== null ? item : {}) as JsonObject;
      const layout = asString(object.recommendedLayout, index === 0 ? "cover" : "generic-cards");
      const trimmed = applyCopyBudgetsToSlideFields({
        title: asString(object.title, index === 0 ? "封面" : `第 ${index + 1} 页`),
        slideGoal: asString(object.slideGoal, "说明本页目标"),
        keyMessage: asString(object.keyMessage, "补充本页核心结论"),
        contentPoints: asArray(object.contentPoints).map((point) => asString(point)).filter(Boolean)
      });
      return {
        title: trimmed.title || (index === 0 ? "封面" : `第 ${index + 1} 页`),
        slideGoal: trimmed.slideGoal || "说明本页目标",
        keyMessage: trimmed.keyMessage || "补充本页核心结论",
        contentPoints: trimmed.contentPoints,
        sourceFactIds: asArray(object.sourceFactIds)
          .map((id) => asString(id))
          .filter((id) => allowedFactIds.has(id)),
        recommendedLayout:
          index === 0
            ? "cover"
            : normalizeRecommendedLayout(layout, "generic-cards"),
        partTitle: asString(object.partTitle) || undefined
      };
    });
}

export function normalizeSlidePlan(value: unknown, slide: SlideDto, allowedFactIds: Set<string>): SlidePlanDto {
  const object = (typeof value === "object" && value !== null ? value : {}) as JsonObject;
  const trimmed = applyCopyBudgetsToSlideFields({
    title: asString(object.title, slide.planJson?.title || slide.title),
    slideGoal: asString(object.pageGoal, slide.slideGoal),
    keyMessage: asString(object.keyMessage, slide.keyMessage),
    contentPoints: []
  });
  const layoutType = normalizeRecommendedLayout(
    asString(object.layoutType, slide.recommendedLayout),
    normalizeRecommendedLayout(slide.recommendedLayout)
  );
  const contentBlocks = asArray(object.contentBlocks)
    .map((block) => {
      const blockObject = (typeof block === "object" && block !== null ? block : {}) as JsonObject;
      const type = asString(blockObject.type, "bullets");
      return {
        type: ["summary", "bullets", "timeline", "table", "callout"].includes(type)
          ? (type as SlidePlanDto["contentBlocks"][number]["type"])
          : "bullets" as const,
        title: normalizeBlockTitle(asString(blockObject.title, "内容要点")),
        items: applyCopyBudgetsToBlockItems(asArray(blockObject.items).map((item) => asString(item)).filter(Boolean))
      };
    })
    .filter((block) => block.type !== "summary" && block.items.length > 0)
    .map((block) => ({
      ...block,
      items: block.items.filter(
        (item) => item.trim() !== (trimmed.keyMessage || slide.keyMessage).trim()
      )
    }))
    .filter((block) => block.items.length > 0)
    .slice(0, 4);

  return {
    title: trimmed.title || slide.title,
    pageGoal: trimmed.slideGoal || slide.slideGoal,
    keyMessage: trimmed.keyMessage || slide.keyMessage,
    layoutType,
    contentBlocks,
    sourceFactIds: asArray(object.sourceFactIds)
      .map((id) => asString(id))
      .filter((id) => allowedFactIds.has(id)),
    visualHint: normalizeVisualHint(object.visualHint),
    designGuide: normalizeSlideDesignGuide(object.designGuide, {
      layoutType,
      contentBlocks
    })
  };
}

const VISUAL_CHART_TYPES = ["bar", "line", "pie", "process", "timeline", "table", "metric", "none"];

function normalizeVisualHint(value: unknown): SlidePlanDto["visualHint"] {
  const object = (typeof value === "object" && value !== null ? value : {}) as JsonObject;
  const chartTypeRaw = asString(object.chartType);
  const chartType = VISUAL_CHART_TYPES.includes(chartTypeRaw.toLowerCase()) ? chartTypeRaw.toLowerCase() : undefined;
  const heroVisual = asString(object.heroVisual);
  const emphasis = asArray(object.emphasis).map((item) => asString(item)).filter(Boolean).slice(0, 6);

  if (!chartType && !heroVisual && emphasis.length === 0) {
    return undefined;
  }

  return {
    chartType,
    heroVisual: heroVisual || undefined,
    emphasis: emphasis.length > 0 ? emphasis : undefined
  };
}

function normalizeBlockTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean || "内容要点";
}

function normalizeElement(value: unknown, index: number): SlideIrElementDto {
  const object = (typeof value === "object" && value !== null ? value : {}) as JsonObject;
  const type = asString(object.type, "card");
  const safeType = ["text", "card", "metric", "table", "timeline", "process", "callout", "decor"].includes(type) ? (type as SlideIrElementDto["type"]) : "card";
  const x = clampNumber(object.x, 0, 1240, 80 + (index % 2) * 560);
  const y = clampNumber(object.y, 0, 680, 120 + Math.floor(index / 2) * 170);
  const maxW = Math.max(1, 1280 - x);
  const maxH = Math.max(1, 720 - y);
  const contentObject = (typeof object.content === "object" && object.content !== null ? object.content : {}) as JsonObject;

  return {
    id: asString(object.id, `el-${index + 1}`),
    type: safeType,
    role: asString(object.role, safeType === "decor" ? "decoration" : "content"),
    x,
    y,
    w: clampNumber(object.w, 1, maxW, safeType === "text" ? 720 : 500),
    h: clampNumber(object.h, 1, maxH, safeType === "text" ? 80 : 130),
    z: Math.round(clampNumber(object.z, 0, 100, index)),
    content: {
      ...contentObject,
      title: asString(contentObject.title),
      text: asString(contentObject.text),
      body: asString(contentObject.body),
      label: asString(contentObject.label),
      value: asString(contentObject.value),
      note: asString(contentObject.note),
      items: asArray(contentObject.items).map((item) => asString(item)).filter(Boolean).slice(0, 8),
      rows: asArray(contentObject.rows)
        .map((row) => asArray(row).map((cell) => asString(cell)).filter(Boolean))
        .filter((row) => row.length > 0)
        .slice(0, 6)
    },
    style: typeof object.style === "object" && object.style !== null ? (object.style as SlideIrElementDto["style"]) : {},
    editable: safeType === "decor" ? Boolean(object.editable) : true
  };
}

export function normalizeSlideIr(value: unknown, slide: SlideDto, theme: PptExportTheme = "white-blue"): SlideIrDto {
  const object = (typeof value === "object" && value !== null ? value : {}) as JsonObject;
  const rawElements = asArray(object.elements);
  const family = themeFamily(normalizePptExportTheme(theme));
  const layout = slide.planJson?.layoutType || slide.recommendedLayout;
  const variant = pickDefaultVariant(layout, family, [], `${slide.id ?? slide.title}-${layout}`);
  const frame = getSkeletonFrame(variant.id);

  const elements = rawElements.length > 0 ? rawElements.map(normalizeElement) : fallbackIr(slide, theme).elements;
  const candidate = {
    version: "1.0" as const,
    canvas: { width: 1280 as const, height: 720 as const },
    title: asString(object.title, slide.title),
    layout: asString(object.layout, slide.recommendedLayout),
    elements
  };

  const snapped = frame ? snapIrToSkeleton(candidate, frame) : candidate;
  const result = SlideIrSchema.safeParse(snapped);
  if (!result.success) {
    throw new Error(`Gemini 返回的 Slide IR 不合法：${result.error.issues.map((issue) => issue.message).join("；")}`);
  }
  return result.data;
}

function fallbackIr(slide: SlideDto, theme: PptExportTheme = "white-blue"): SlideIrDto {
  const family = themeFamily(normalizePptExportTheme(theme));
  const fromSkeleton = buildIrFromSkeleton(slide, { themeFamily: family });
  if (fromSkeleton) {
    const parsed = SlideIrSchema.safeParse(fromSkeleton);
    if (parsed.success) return parsed.data;
  }

  const points = slide.planJson?.contentBlocks.flatMap((block) => block.items).filter(Boolean) ?? slide.contentPoints;
  const draftTitle = slide.planJson?.title || slide.title;
  const draftKeyMessage = slide.planJson?.keyMessage || slide.keyMessage;
  return {
    version: "1.0",
    canvas: { width: 1280, height: 720 },
    title: draftTitle,
    layout: slide.recommendedLayout,
    elements: [
      {
        id: "title",
        type: "text",
        role: "title",
        x: 72,
        y: 48,
        w: 880,
        h: 70,
        z: 1,
        editable: true,
        content: { text: draftTitle },
        style: { fontSize: 34, bold: true, color: "#003F7D" }
      },
      {
        id: "message",
        type: "callout",
        role: "key-message",
        x: 72,
        y: 142,
        w: 1136,
        h: 110,
        z: 2,
        editable: true,
        content: { title: "核心结论", body: draftKeyMessage },
        style: { tone: "primary" }
      },
      ...points.slice(0, 4).map((point, index) => ({
        id: `card-${index + 1}`,
        type: "card" as const,
        role: "supporting-point",
        x: 72 + (index % 2) * 578,
        y: 292 + Math.floor(index / 2) * 170,
        w: 538,
        h: 132,
        z: 3 + index,
        editable: true,
        content: { title: `要点 ${index + 1}`, body: point },
        style: { tone: (index % 2 === 0 ? "default" : "accent") as "default" | "accent" }
      }))
    ]
  };
}

export function sanitizeSvgOutput(text: string) {
  const withoutFence = text.replace(/```(?:svg|xml)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFence.indexOf("<svg");
  const end = withoutFence.lastIndexOf("</svg>");
  if (start < 0 || end < 0) {
    throw new Error("Gemini 没有返回完整 SVG。");
  }
  const svg = withoutFence.slice(start, end + "</svg>".length);
  if (!/viewBox=["']0 0 1280 720["']/i.test(svg)) {
    throw new Error("Gemini 返回的 SVG viewBox 不是 0 0 1280 720。");
  }
  return svg;
}

export class RealGeminiAdapter implements GeminiAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly designModel: string;
  private readonly designModels: string[];

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.model = options.model ?? process.env.GEMINI_MODEL ?? defaultModel;
    this.designModel = process.env.GEMINI_DESIGN_MODEL ?? defaultDesignModel;
    this.designModels = [...new Set([this.designModel, this.model, defaultModel])];
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      throw new Error("未配置 GEMINI_API_KEY，请先在后端环境变量中添加 Gemini API Key。");
    }
  }

  private async requestInteraction(input: string, systemInstruction: string, responseFormat?: unknown, options: RequestInteractionOptions = {}): Promise<GeminiResponse> {
    this.ensureConfigured();
    try {
      return await undiciFetch(
        GEMINI_INTERACTIONS_ENDPOINT,
        buildFetchOptions(this.apiKey, {
          model: options.model ?? this.model,
          system_instruction: systemInstruction,
          input,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          generation_config: {
            temperature: options.temperature ?? 0.35,
            thinking_level: options.thinkingLevel ?? "low"
          }
        })
      );
    } catch (error) {
      throw new Error(explainGeminiNetworkError(error));
    }
  }

  private async requestStreamingInteraction(input: string, systemInstruction: string, options: RequestInteractionOptions = {}): Promise<GeminiResponse> {
    this.ensureConfigured();
    try {
      return await undiciFetch(
        `${GEMINI_INTERACTIONS_ENDPOINT}?alt=sse`,
        buildFetchOptions(this.apiKey, {
          model: options.model ?? this.model,
          system_instruction: systemInstruction,
          input,
          stream: true,
          generation_config: {
            temperature: options.temperature ?? 0.35,
            thinking_level: options.thinkingLevel ?? "low"
          }
        }, true)
      );
    } catch (error) {
      throw new Error(explainGeminiNetworkError(error));
    }
  }

  private async readStreamingInteraction(response: GeminiResponse, onToken: (token: string) => void) {
    if (!response.body) throw new Error("Gemini 没有返回流式响应体。");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";

    const consume = (value: string) => {
      const parsed = parseInteractionSseBuffer(value);
      for (const delta of parsed.deltas) {
        output += delta;
        onToken(delta);
      }
      if (parsed.error) throw new Error(`Gemini 流式生成失败：${parsed.error}`);
      return parsed.remaining;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consume(buffer);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(`${buffer}\n\n`);
    return output;
  }

  private async generateJson<T>(input: string, schema: unknown, systemInstruction: string, options: RequestInteractionOptions = {}, onToken?: (token: string) => void): Promise<T> {
    const response = await this.requestInteraction(input, systemInstruction, {
      type: "text",
      mime_type: "application/json",
      schema
    }, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(explainGeminiApiError(response.status, errorText));
    }

    const payload = (await response.json()) as unknown;
    const outputText = outputTextFromInteraction(payload);
    if (!outputText) {
      throw new Error("Gemini 没有返回可用内容。");
    }
    if (onToken) {
      // Gemini interactions 当前非流式；返回后一次性回调，保持接口兼容
      onToken(outputText);
    }
    return parseModelJson(outputText) as T;
  }

  private async generateText(input: string, systemInstruction: string, onToken?: (token: string) => void): Promise<string> {
    const failures: string[] = [];

    for (const model of this.designModels) {
      const requestOptions = { model, temperature: 0.72, thinkingLevel: "low" } as const;
      const response = onToken
        ? await this.requestStreamingInteraction(input, systemInstruction, requestOptions)
        : await this.requestInteraction(input, systemInstruction, undefined, requestOptions);
      if (!response.ok) {
        const errorText = await response.text();
        const message = explainGeminiApiError(response.status, errorText);
        failures.push(`${model}: ${message}`);
        if (![400, 429, 503].includes(response.status)) {
          throw new Error(message);
        }
        continue;
      }
      const outputText = onToken
        ? await this.readStreamingInteraction(response, onToken)
        : outputTextFromInteraction((await response.json()) as unknown);
      if (!outputText) {
        failures.push(`${model}: Gemini 没有返回可用内容。`);
        continue;
      }
      return outputText;
    }

    throw new Error(`Gemini 页面设计生成失败：已尝试 ${this.designModels.join("、")}。${failures.join("；")}`);
  }

  async extractFacts(text: string): Promise<ExtractFactsResult> {
    const result = await this.generateJson<unknown>(buildExtractFactsPrompt(text), extractFactsSchema, extractFactsSystemPrompt);
    return normalizeFactsResult(result);
  }

  async generateOutline(
    project: Pick<ProjectDto, "name" | "audience" | "purpose" | "pageCount" | "theme">,
    confirmedFacts: FactDto[]
  ): Promise<OutlineSlideDraft[]> {
    const allowedFactIds = new Set(confirmedFacts.map((fact) => fact.id));
    const result = await this.generateJson<unknown>(buildOutlinePrompt(project, confirmedFacts), outlineSchema, outlineSystemPrompt);
    return normalizeOutline(result, allowedFactIds, Math.max(1, Math.min(12, project.pageCount || 6)));
  }

  async generateSlidePlan(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", onToken?: (token: string) => void): Promise<SlidePlanDto> {
    const allowedFactIds = new Set(facts.map((fact) => fact.id));
    const result = await this.generateJson<unknown>(buildSlidePlanPrompt(slide, facts, theme), slidePlanSchema, slidePlanSystemPrompt, {}, onToken);
    return normalizeSlidePlan(result, slide, allowedFactIds);
  }

  async generateSlideIr(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", onToken?: (token: string) => void): Promise<SlideIrDto> {
    const result = await this.generateJson<unknown>(buildSlideIrPrompt(slide, facts, theme), slideIrJsonSchema, slideIrSystemPrompt, {
      model: this.designModel,
      temperature: 0.62,
      thinkingLevel: "low"
    }, onToken);
    return normalizeSlideIr(result, slide, theme);
  }

  async generateSvgPreview(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", onToken?: (token: string) => void, options?: SvgGenerationOptions): Promise<string> {
    const result = await this.generateText(buildSvgPreviewPrompt(slide, facts, theme, options?.surfaceId, options?.revisionNotes, options?.accentId), svgPreviewSystemPrompt, onToken);
    return sanitizeSvgOutput(result);
  }

  async startBrief(topic: string) {
    const { mockBriefQuestions } = await import("./studioHelpers.js");
    try {
      const schema = {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                question: { type: "string" },
                placeholder: { type: "string" }
              },
              required: ["id", "question"]
            }
          }
        },
        required: ["questions"]
      };
      const { buildBriefStartPrompt, briefSystemPrompt } = await import("./prompts.js");
      const result = await this.generateJson<{ questions?: Array<{ id?: string; question?: string; placeholder?: string }> }>(
        buildBriefStartPrompt(topic),
        schema,
        briefSystemPrompt
      );
      const questions = (result.questions ?? [])
        .filter((item) => item.id && item.question)
        .map((item) => ({
          id: String(item.id),
          question: String(item.question),
          placeholder: item.placeholder ? String(item.placeholder) : undefined
        }));
      return questions.length > 0
        ? { questions, source: "ai" as const }
        : { questions: mockBriefQuestions(topic), source: "fallback" as const };
    } catch {
      return { questions: mockBriefQuestions(topic), source: "fallback" as const };
    }
  }

  async finalizeBrief(topic: string, answers: Record<string, string>, onToken?: (token: string) => void) {
    const { mockFinalizeBrief } = await import("./studioHelpers.js");
    try {
      const schema = {
        type: "object",
        properties: {
          topic: { type: "string" },
          summary: { type: "string" },
          audience: { type: "string" },
          purpose: { type: "string" },
          pageCount: { type: "number" },
          styleNotes: { type: "string" }
        },
        required: ["summary", "audience", "purpose"]
      };
      const { buildBriefFinalizePrompt, briefSystemPrompt } = await import("./prompts.js");
      const result = await this.generateJson<{
        summary?: string;
        audience?: string;
        purpose?: string;
        pageCount?: number;
        styleNotes?: string;
      }>(buildBriefFinalizePrompt(topic, answers), schema, briefSystemPrompt, {}, onToken);
      const fallback = mockFinalizeBrief(topic, answers);
      return {
        ...fallback,
        summary: result.summary || fallback.summary,
        audience: result.audience || fallback.audience,
        purpose: result.purpose || fallback.purpose,
        pageCount: result.pageCount || fallback.pageCount,
        styleNotes: result.styleNotes || fallback.styleNotes
      };
    } catch {
      return mockFinalizeBrief(topic, answers);
    }
  }

  async generateResearch(topic: string, briefSummary: string, onToken?: (token: string) => void) {
    const { mockResearch } = await import("./studioHelpers.js");
    try {
      const schema = {
        type: "object",
        properties: {
          summary: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                snippet: { type: "string" },
                url: { type: "string" }
              },
              required: ["title", "snippet"]
            }
          }
        },
        required: ["summary", "bullets"]
      };
      const { buildResearchPrompt, researchSystemPrompt } = await import("./prompts.js");
      const result = await this.generateJson<{
        summary?: string;
        bullets?: string[];
        sources?: Array<{ title?: string; snippet?: string; url?: string }>;
      }>(buildResearchPrompt(topic, briefSummary), schema, researchSystemPrompt, {}, onToken);
      const fallback = mockResearch(topic, briefSummary);
      return {
        summary: result.summary || fallback.summary,
        bullets: result.bullets?.filter(Boolean).length ? result.bullets.filter(Boolean) : fallback.bullets,
        sources:
          result.sources?.filter((item) => item.title && item.snippet).map((item) => ({
            title: String(item.title),
            snippet: String(item.snippet)
          })) ?? fallback.sources
      };
    } catch {
      return mockResearch(topic, briefSummary);
    }
  }

  async generatePageSearch(slide: SlideDto, context: { topic?: string; researchSummary?: string }, onToken?: (token: string) => void) {
    const { mockPageSearch, normalizeAiPageSearch } = await import("./studioHelpers.js");
    try {
      const schema = {
        type: "object",
        properties: {
          queries: { type: "array", items: { type: "string" } },
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                snippet: { type: "string" },
                selected: { type: "boolean" }
              },
              required: ["title", "snippet"]
            }
          },
          synthesis: {
            type: "object",
            properties: {
              summary: { type: "string" },
              keyFindings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    statement: { type: "string" },
                    sourceIndexes: { type: "array", items: { type: "integer" } }
                  },
                  required: ["statement", "sourceIndexes"]
                }
              },
              draftReference: { type: "string" },
              caveats: { type: "array", items: { type: "string" } }
            },
            required: ["summary", "keyFindings", "draftReference"]
          },
          notes: { type: "string" }
        },
        required: ["queries", "results", "synthesis"]
      };
      const { buildPageSearchPrompt, pageSearchSystemPrompt } = await import("./prompts.js");
      const result = await this.generateJson<{
        queries?: string[];
        results?: Array<{ title?: string; snippet?: string; selected?: boolean }>;
        synthesis?: {
          summary?: string;
          keyFindings?: Array<{ statement?: string; sourceIndexes?: number[] }>;
          draftReference?: string;
          caveats?: string[];
        };
        notes?: string;
      }>(buildPageSearchPrompt(slide, context), schema, pageSearchSystemPrompt, {}, onToken);
      return normalizeAiPageSearch(slide, result);
    } catch {
      return mockPageSearch(slide);
    }
  }
}
