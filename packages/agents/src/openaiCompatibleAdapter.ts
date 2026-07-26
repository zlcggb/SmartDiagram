import { randomUUID } from "node:crypto";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { Response } from "undici";
import type {
  ExtractFactsResult,
  FactDto,
  OutlineSlideDraft,
  PptExportTheme,
  ProjectDto,
  SlideDto,
  SlidePlanDto,
  SpeechWritingStyleId
} from "@ppt-agent/shared";
import {
  buildExtractFactsPrompt,
  buildOutlinePrompt,
  buildSlidePlanPrompt,
  buildSpeechScriptPrompt,
  buildSvgPreviewPrompt,
  extractFactsSystemPrompt,
  outlineSystemPrompt,
  slidePlanSystemPrompt,
  speechScriptSystemPrompt,
  svgPreviewSystemPrompt
} from "./prompts.js";
import {
  extractFactsSchema,
  normalizeFactsResult,
  normalizeOutline,
  normalizeSlidePlan,
  outlineSchema,
  parseModelJson,
  sanitizeSvgOutput,
  slidePlanSchema
} from "./realGeminiAdapter.js";
import type { GeminiAdapter, ModelUsageEvent, ModelUsageReporter, SvgGenerationOptions } from "./types.js";

type JsonObject = Record<string, unknown>;
type FetchOptionsWithDispatcher = NonNullable<Parameters<typeof undiciFetch>[1]>;

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function configuredProxyUrl() {
  const raw = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || process.env.GEMINI_PROXY_URL || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

function resolveApiKey() {
  return (
    process.env.OPENAI_COMPATIBLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();
}

function resolveBaseUrl() {
  const raw = (
    process.env.OPENAI_COMPATIBLE_BASE_URL ||
    process.env.TRADINGAGENTS_LLM_BACKEND_URL ||
    process.env.OPENAI_BASE_URL ||
    ""
  ).trim();
  return raw ? trimSlash(raw) : "";
}

function resolveModel() {
  return (
    process.env.OPENAI_COMPATIBLE_MODEL ||
    process.env.TRADINGAGENTS_DEEP_THINK_LLM ||
    process.env.GEMINI_MODEL ||
    "gemini-3-flash-agent"
  ).trim();
}

function resolveDesignModel() {
  return (
    process.env.OPENAI_COMPATIBLE_DESIGN_MODEL ||
    process.env.GEMINI_DESIGN_MODEL ||
    resolveModel()
  ).trim();
}

function resolveTemperature() {
  const raw = process.env.OPENAI_COMPATIBLE_TEMPERATURE;
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 1 : parsed;
}

type EffortLevel = "low" | "high" | "max" | "none";

type EffortStage = "facts" | "brief" | "research" | "outline" | "search" | "plan" | "svg" | "main";

function normalizeEffortLevel(raw: string | undefined): EffortLevel | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "low" || value === "minimum" || value === "light") return "low";
  if (value === "medium" || value === "high") return "high";
  if (value === "ultra" || value === "max" || value === "xhigh") return "max";
  if (value === "none") return "none";
  return undefined;
}

function resolveEffortField() {
  return process.env.OPENAI_COMPATIBLE_EFFORT_FIELD?.trim() || "reasoning_effort";
}

function resolveEffortForStage(stage: EffortStage | "main"): EffortLevel {
  if (stage !== "main") {
    const stageSpecific = normalizeEffortLevel(process.env[`OPENAI_COMPATIBLE_${stage.toUpperCase()}_EFFORT`]);
    if (stageSpecific) return stageSpecific;
  }

  if (stage === "svg") {
    const designEffort = normalizeEffortLevel(process.env.OPENAI_COMPATIBLE_DESIGN_EFFORT);
    if (designEffort) return designEffort;
  }

  if (stage !== "svg") {
    const mainEffort = normalizeEffortLevel(process.env.OPENAI_COMPATIBLE_MAIN_EFFORT);
    if (mainEffort) return mainEffort;
  }

  return normalizeEffortLevel(process.env.OPENAI_COMPATIBLE_EFFORT) ?? "low";
}

function chatCompletionsUrl(baseUrl: string) {
  if (/\/chat\/completions$/i.test(baseUrl)) {
    return baseUrl;
  }
  return `${baseUrl}/chat/completions`;
}

function explainNetworkError(error: unknown) {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeObject = typeof cause === "object" && cause !== null ? (cause as { code?: string; message?: string }) : {};
  const detail = causeObject.code || causeObject.message || (error instanceof Error ? error.message : "");
  return `OpenAI 兼容接口网络失败：无法连接 ${resolveBaseUrl() || "LLM 后端"}。${detail ? ` 底层错误：${detail}` : ""}`;
}

function explainApiError(status: number, errorText: string) {
  let message = errorText.slice(0, 500);
  try {
    const payload = JSON.parse(errorText) as { error?: { message?: string } };
    message = payload.error?.message ?? message;
  } catch {
    // keep raw
  }
  if (status === 401 || status === 403) {
    return `OpenAI 兼容接口鉴权失败（${status}）：请检查 OPENAI_COMPATIBLE_API_KEY。原始信息：${message}`;
  }
  if (status === 429) {
    return `OpenAI 兼容接口限流（429）：请稍后重试。原始信息：${message}`;
  }
  return `OpenAI 兼容接口调用失败（${status}）：${message}`;
}

/** Token usage extracted from a single API response */
export interface TokenUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export function extractUsageFromPayload(payload: unknown): TokenUsageSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as JsonObject;
  const usage = obj.usage as JsonObject | undefined;
  if (!usage) return null;
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const total = typeof usage.total_tokens === "number" ? usage.total_tokens : prompt + completion;
  const promptDetails = usage.prompt_tokens_details as JsonObject | undefined;
  const completionDetails = usage.completion_tokens_details as JsonObject | undefined;
  const cached = typeof promptDetails?.cached_tokens === "number" ? promptDetails.cached_tokens : 0;
  const reasoning = typeof completionDetails?.reasoning_tokens === "number" ? completionDetails.reasoning_tokens : 0;
  if (prompt === 0 && completion === 0 && total === 0) return null;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: Math.max(0, Math.min(prompt, cached)),
    reasoningTokens: Math.max(0, reasoning),
    totalTokens: total
  };
}

function contentFromChatPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }
  const object = payload as JsonObject;
  const choices = Array.isArray(object.choices) ? object.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const message = first?.message as JsonObject | undefined;
  if (typeof message?.content === "string") {
    return message.content;
  }
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && typeof (part as JsonObject).text === "string") {
          return String((part as JsonObject).text);
        }
        return "";
      })
      .join("");
  }
  if (typeof object.output_text === "string") {
    return object.output_text;
  }
  return "";
}

function textFromDelta(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "object" && part !== null && typeof (part as JsonObject).text === "string") {
        return String((part as JsonObject).text);
      }
      return "";
    })
    .join("");
}

export function parseOpenAiChatSseBuffer(buffer: string) {
  const deltas: string[] = [];
  let usagePayload: JsonObject | null = null;
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
      .filter((line) => line.trimStart().startsWith("data:"))
      .map((line) => line.trimStart().slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;

    try {
      const chunk = JSON.parse(data) as JsonObject;
      // 捕获流式响应中的 usage（OpenAI 在最后一个 chunk 发送）
      if (chunk.usage && typeof chunk.usage === "object") {
        usagePayload = chunk as JsonObject;
      }
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      const first = choices[0] as JsonObject | undefined;
      const deltaObject = first?.delta as JsonObject | undefined;
      const content = textFromDelta(deltaObject?.content ?? first?.text);
      if (content) deltas.push(content);
    } catch {
      // Ignore non-JSON keep-alives. Incomplete JSON remains in `remaining` until an SSE boundary arrives.
    }
  }
  return { deltas, remaining: buffer.slice(cursor), usagePayload };
}

function replayDelayMs(deltaCount: number) {
  if (deltaCount <= 1) return 0;
  const targetDuration = Number(process.env.OPENAI_COMPATIBLE_STREAM_REPLAY_MS || 2600);
  const safeTarget = Number.isFinite(targetDuration) ? Math.max(400, Math.min(8000, targetDuration)) : 2600;
  return Math.max(12, Math.min(220, Math.round(safeTarget / deltaCount)));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class OpenAiCompatibleAdapter implements GeminiAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly designModel: string;
  private readonly reporter?: ModelUsageReporter;
  private readonly fetcher: typeof undiciFetch;

  /** 累计 Token 用量（进程生命周期内） */
  private _totalPromptTokens = 0;
  private _totalCompletionTokens = 0;
  private _totalTokens = 0;
  private _callCountWithUsage = 0;

  constructor(options: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    designModel?: string;
    reporter?: ModelUsageReporter;
    fetcher?: typeof undiciFetch;
  } = {}) {
    this.apiKey = options.apiKey ?? resolveApiKey();
    this.baseUrl = options.baseUrl ?? resolveBaseUrl();
    this.model = options.model ?? resolveModel();
    this.designModel = options.designModel ?? resolveDesignModel();
    this.reporter = options.reporter;
    this.fetcher = options.fetcher ?? undiciFetch;
  }

  /** 累加一次 API 返回的 usage */
  private _accumulateUsage(u: TokenUsageSnapshot | null) {
    if (!u) return;
    this._totalPromptTokens += u.promptTokens;
    this._totalCompletionTokens += u.completionTokens;
    this._totalTokens += u.totalTokens;
    this._callCountWithUsage += 1;
  }

  /** 获取累计 Token 用量快照 */
  getTokenUsage(): { promptTokens: number; completionTokens: number; totalTokens: number; callCount: number } {
    return {
      promptTokens: this._totalPromptTokens,
      completionTokens: this._totalCompletionTokens,
      totalTokens: this._totalTokens,
      callCount: this._callCountWithUsage,
    };
  }

  private async reportUsage(input: {
    model: string;
    stage: EffortStage | "main";
    status: "succeeded" | "failed";
    usage: TokenUsageSnapshot | null;
    startedAt: Date;
    httpStatus?: number;
    error?: unknown;
  }) {
    if (!this.reporter) return;
    const endedAt = new Date();
    const usage = input.usage;
    const error = input.error instanceof Error ? input.error : null;
    const event: ModelUsageEvent = {
      externalEventId: randomUUID(),
      provider: "openai-compatible",
      model: input.model,
      stage: input.stage,
      status: input.status,
      inputTokens: usage?.promptTokens ?? 0,
      outputTokens: usage?.completionTokens ?? 0,
      cachedTokens: usage?.cachedTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      usageAvailable: usage !== null,
      durationMs: Math.max(0, endedAt.getTime() - input.startedAt.getTime()),
      httpStatus: input.httpStatus,
      errorCode: error?.name,
      errorMessage: error?.message.slice(0, 500),
      startedAt: input.startedAt.toISOString(),
      endedAt: endedAt.toISOString()
    };
    try {
      await this.reporter(event);
    } catch {
      // Usage reporting is observational and must not discard a successful generation.
    }
  }

  private async requestChatAttempt(
    body: JsonObject,
    stage: EffortStage | "main",
    onToken?: (token: string) => void
  ): Promise<{ ok: true; text: string } | { ok: false; status: number; errorText: string }> {
    const startedAt = new Date();
    const model = typeof body.model === "string" ? body.model : this.model;
    try {
      const response = await this.fetcher(chatCompletionsUrl(this.baseUrl), this.buildFetchOptions(body));
      if (!response.ok) {
        const errorText = await response.text();
        let usage: TokenUsageSnapshot | null = null;
        try {
          usage = extractUsageFromPayload(JSON.parse(errorText));
        } catch {
          // Most error payloads do not expose token usage.
        }
        await this.reportUsage({
          model,
          stage,
          status: "failed",
          usage,
          startedAt,
          httpStatus: response.status,
          error: new Error(explainApiError(response.status, errorText))
        });
        return { ok: false, status: response.status, errorText };
      }

      if (onToken) {
        const streamed = await this.readStream(response, onToken);
        this._accumulateUsage(streamed.usage);
        await this.reportUsage({
          model,
          stage,
          status: "succeeded",
          usage: streamed.usage,
          startedAt,
          httpStatus: response.status
        });
        return { ok: true, text: streamed.text };
      }
      const payload = await response.json();
      const usage = extractUsageFromPayload(payload);
      this._accumulateUsage(usage);
      await this.reportUsage({
        model,
        stage,
        status: "succeeded",
        usage,
        startedAt,
        httpStatus: response.status
      });
      return { ok: true, text: contentFromChatPayload(payload) };
    } catch (error) {
      await this.reportUsage({ model, stage, status: "failed", usage: null, startedAt, error });
      throw error;
    }
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      throw new Error("未配置 OPENAI_COMPATIBLE_API_KEY（或 OPENAI_API_KEY）。");
    }
    if (!this.baseUrl) {
      throw new Error("未配置 OPENAI_COMPATIBLE_BASE_URL（或 TRADINGAGENTS_LLM_BACKEND_URL）。");
    }
  }

  private buildFetchOptions(body: unknown): FetchOptionsWithDispatcher {
    const proxyUrl = configuredProxyUrl();
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
      ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {})
    };
  }

  private async chat(
    systemInstruction: string,
    userInput: string,
    options: {
      model?: string;
      temperature?: number;
      json?: boolean;
      stage?: EffortStage;
      effort?: EffortLevel;
      effortField?: string;
    } = {},
    onToken?: (token: string) => void
  ) {
    this.ensureConfigured();
    const body: JsonObject = {
      model: options.model ?? this.model,
      temperature: options.temperature ?? resolveTemperature(),
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userInput }
      ]
    };
    const effortField = options.effortField ?? resolveEffortField();
    const effort = options.effort ?? resolveEffortForStage(options.stage ?? "main");
    if (effort) {
      body[effortField] = effort;
    }
    if (options.json && !onToken) {
      body.response_format = { type: "json_object" };
    }
    if (onToken) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    try {
      const stage = options.stage ?? "main";
      const first = await this.requestChatAttempt(body, stage, onToken);
      if (first.ok) return first.text;
      // 部分网关不支持 response_format，去掉后重试一次（仅非流式）。两次尝试分别记账。
      if (options.json && !onToken && (first.status === 400 || first.status === 422)) {
        const retryBody = { ...body };
        delete retryBody.response_format;
        const retry = await this.requestChatAttempt(retryBody, stage);
        if (retry.ok) return retry.text;
        throw new Error(explainApiError(retry.status, retry.errorText));
      }
      throw new Error(explainApiError(first.status, first.errorText));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("OpenAI 兼容")) {
        throw error;
      }
      throw new Error(explainNetworkError(error));
    }
  }

  private async readStream(response: Response, onToken: (token: string) => void): Promise<{ text: string; usage: TokenUsageSnapshot | null }> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("OpenAI 兼容接口没有返回可读取的流。");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let lastUsage: TokenUsageSnapshot | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += decoder.decode();

      const parsed = parseOpenAiChatSseBuffer(buffer);
      buffer = parsed.remaining;
      // 尝试从 SSE 流中的 usage chunk 提取 token 用量
      if (parsed.usagePayload) {
        lastUsage = extractUsageFromPayload(parsed.usagePayload);
      }
      const delayMs = replayDelayMs(parsed.deltas.length);
      for (const [index, delta] of parsed.deltas.entries()) {
        onToken(delta);
        fullText += delta;
        if (delayMs > 0 && index < parsed.deltas.length - 1) await wait(delayMs);
      }
      if (done) break;
    }
    return { text: fullText, usage: lastUsage };
  }

  private async generateJson<T>(
    input: string,
    schema: unknown,
    systemInstruction: string,
    options: {
      model?: string;
      temperature?: number;
      stage?: EffortStage;
      effort?: EffortLevel;
      effortField?: string;
    } = {},
    onToken?: (token: string) => void
  ): Promise<T> {
    const schemaHint = `\n\n请严格输出 JSON（不要 Markdown 代码块以外的解释）。JSON Schema 约束如下：\n${JSON.stringify(schema)}`;
    const text = await this.chat(`${systemInstruction}${schemaHint}`, input, {
      model: options.model,
      temperature: options.temperature ?? resolveTemperature(),
      json: true,
      stage: options.stage,
      effort: options.effort,
      effortField: options.effortField
    }, onToken);
    if (!text.trim()) {
      throw new Error("OpenAI 兼容接口没有返回可用内容。");
    }
    return parseModelJson(text) as T;
  }

  private async generateText(input: string, systemInstruction: string, options: { stage?: EffortStage; effort?: EffortLevel; effortField?: string } = {}, onToken?: (token: string) => void): Promise<string> {
    const models = [...new Set([this.designModel, this.model])];
    const failures: string[] = [];
    for (const model of models) {
      try {
        const text = await this.chat(systemInstruction, input, {
          model,
          temperature: resolveTemperature(),
          json: false,
          stage: options.stage,
          effort: options.effort,
          effortField: options.effortField
        }, onToken);
        if (!text.trim()) {
          failures.push(`${model}: 空响应`);
          continue;
        }
        return text;
      } catch (error) {
        failures.push(`${model}: ${error instanceof Error ? error.message : "未知错误"}`);
      }
    }
    throw new Error(`页面设计生成失败：${failures.join("；")}`);
  }

  async extractFacts(text: string): Promise<ExtractFactsResult> {
    const result = await this.generateJson<unknown>(buildExtractFactsPrompt(text), extractFactsSchema, extractFactsSystemPrompt, { stage: "facts" });
    return normalizeFactsResult(result);
  }

  async generateOutline(
    project: Pick<ProjectDto, "name" | "audience" | "purpose" | "pageCount" | "theme">,
    confirmedFacts: FactDto[],
    onToken?: (token: string) => void
  ): Promise<OutlineSlideDraft[]> {
    const allowedFactIds = new Set(confirmedFacts.map((fact) => fact.id));
    const result = await this.generateJson<unknown>(buildOutlinePrompt(project, confirmedFacts), outlineSchema, outlineSystemPrompt, { stage: "outline" }, onToken);
    return normalizeOutline(result, allowedFactIds, Math.max(1, Math.min(12, project.pageCount || 6)));
  }

  async generateSlidePlan(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", onToken?: (token: string) => void): Promise<SlidePlanDto> {
    const allowedFactIds = new Set(facts.map((fact) => fact.id));
    const result = await this.generateJson<unknown>(buildSlidePlanPrompt(slide, facts, theme), slidePlanSchema, slidePlanSystemPrompt, { stage: "plan" }, onToken);
    return normalizeSlidePlan(result, slide, allowedFactIds);
  }



  async generateSvgPreview(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", onToken?: (token: string) => void, options?: SvgGenerationOptions): Promise<string> {
    const result = await this.generateText(
      buildSvgPreviewPrompt(
        slide,
        facts,
        theme,
        options?.surfaceId,
        options?.revisionNotes,
        options?.accentId,
        options?.previousSvg,
        options?.presentationStyle
      ),
      svgPreviewSystemPrompt,
      { stage: "svg" },
      onToken
    );
    return sanitizeSvgOutput(result);
  }

  async generateSpeechScript(
    slide: SlideDto,
    context: { index: number; total: number; prevTitle?: string; nextTitle?: string; style: SpeechWritingStyleId },
    onToken?: (token: string) => void
  ): Promise<string> {
    // 演讲稿必须走主模型；generateText 会优先尝试 designModel，不能复用。
    const result = await this.chat(
      speechScriptSystemPrompt(context.style),
      buildSpeechScriptPrompt(slide, context),
      {
        model: this.model,
        temperature: resolveTemperature(),
        json: false,
        stage: "main"
      },
      onToken
    );
    return result.replace(/\r\n/g, "\n").replace(/^#+\s.*$/gm, "").replace(/\*\*/g, "").trim();
  }

  async startBrief(topic: string) {
    const { mockBriefQuestions } = await import("./studioHelpers.js");
    try {
      const schema = {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 3,
            maxItems: 5,
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
      const result = await this.generateJson<{
        questions?: Array<{ id?: string; question?: string; placeholder?: string }>;
      }>(buildBriefStartPrompt(topic), schema, briefSystemPrompt, { stage: "brief" });
      const questions = (result.questions ?? [])
        .filter((item) => item.id && item.question)
        .slice(0, 5)
        .map((item) => ({
          id: String(item.id),
          question: String(item.question),
          placeholder: item.placeholder ? String(item.placeholder) : undefined
        }));
      return questions.length >= 3
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
      }>(buildBriefFinalizePrompt(topic, answers), schema, briefSystemPrompt, { stage: "brief" }, onToken);
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
              properties: { title: { type: "string" }, snippet: { type: "string" }, url: { type: "string" } },
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
      }>(buildResearchPrompt(topic, briefSummary), schema, researchSystemPrompt, { stage: "research" }, onToken);
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
      }>(buildPageSearchPrompt(slide, context), schema, pageSearchSystemPrompt, { stage: "search" }, onToken);
      return normalizeAiPageSearch(slide, result);
    } catch {
      return mockPageSearch(slide);
    }
  }
}
