import { fetch as undiciFetch } from "undici";
import type { ResearchJson, SlideDto, SlideSearchJson, SlideSearchResult } from "@ppt-agent/shared";
import { buildSearchSynthesis } from "./studioHelpers.js";
import type { ResearchAdapter } from "./researchAdapter.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<FetchResponse>;

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
};

type TavilyResponse = {
  query?: unknown;
  answer?: unknown;
  results?: TavilyResult[];
};

export interface TavilyResearchAdapterOptions {
  apiKey: string;
  endpoint?: string;
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
  maxResults?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

function compact(text: string, max = 700) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function validWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sourceName(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function score(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function normalizeResults(response: TavilyResponse): SlideSearchResult[] {
  const normalized: SlideSearchResult[] = [];
  for (const item of Array.isArray(response.results) ? response.results : []) {
    const title = typeof item.title === "string" ? compact(item.title, 160) : "";
    const snippet = typeof item.content === "string" ? compact(item.content, 420) : "";
    const url = validWebUrl(item.url);
    if (!title || !snippet || !url) continue;
    normalized.push({
      title,
      snippet,
      url,
      sourceName: sourceName(url),
      score: score(item.score),
      selected: true
    });
  }
  return normalized;
}

function pageQuery(slide: SlideDto, context: { topic?: string; researchSummary?: string }) {
  return compact(
    [
      context.topic,
      slide.title,
      slide.keyMessage,
      ...(slide.contentPoints ?? []).slice(0, 3),
      "权威资料 数据 实践 案例 方法 风险"
    ]
      .filter(Boolean)
      .join(" "),
    480
  );
}

function researchQuery(topic: string, briefSummary: string) {
  return compact(`${topic} ${briefSummary} 权威背景 关键数据 行业趋势 实践 风险`, 480);
}

export class TavilyResearchAdapter implements ResearchAdapter {
  readonly id = "tavily";
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly searchDepth: "basic" | "advanced" | "fast" | "ultra-fast";
  private readonly maxResults: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: TavilyResearchAdapterOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("TAVILY_API_KEY 未配置");
    }
    this.apiKey = options.apiKey.trim();
    this.endpoint = options.endpoint?.trim() || "https://api.tavily.com/search";
    this.searchDepth = options.searchDepth ?? "advanced";
    this.maxResults = Math.max(1, Math.min(10, options.maxResults ?? 6));
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? 45_000);
    this.fetchImpl = options.fetchImpl ?? (undiciFetch as unknown as FetchLike);
  }

  private async search(query: string): Promise<TavilyResponse> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: this.searchDepth,
        chunks_per_source: this.searchDepth === "advanced" ? 2 : undefined,
        max_results: this.maxResults,
        include_answer: "advanced",
        include_raw_content: false,
        include_images: false,
        safe_search: true
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Tavily 检索失败（HTTP ${response.status}）：${compact(text, 240)}`);
    }
    try {
      return JSON.parse(text) as TavilyResponse;
    } catch {
      throw new Error("Tavily 返回了无法解析的响应");
    }
  }

  async generateResearch(topic: string, briefSummary: string): Promise<ResearchJson> {
    const query = researchQuery(topic, briefSummary);
    const response = await this.search(query);
    const results = normalizeResults(response);
    if (results.length === 0) {
      throw new Error("Tavily 未返回可引用的网页来源");
    }
    const answer = typeof response.answer === "string" ? compact(response.answer, 1_200) : "";
    return {
      summary: answer || results.map((result) => result.snippet).join("；"),
      bullets: results.slice(0, 5).map((result) => result.snippet),
      sources: results.map((result) => ({
        title: result.title,
        snippet: result.snippet,
        url: result.url
      }))
    };
  }

  async searchPage(
    slide: SlideDto,
    context: { topic?: string; researchSummary?: string }
  ): Promise<SlideSearchJson> {
    const query = pageQuery(slide, context);
    const response = await this.search(query);
    const results = normalizeResults(response);
    if (results.length === 0) {
      throw new Error("Tavily 未返回可引用的网页来源");
    }
    const answer = typeof response.answer === "string" ? compact(response.answer, 1_000) : "";
    return {
      mode: "web",
      queries: [typeof response.query === "string" && response.query.trim() ? response.query : query],
      results,
      synthesis: buildSearchSynthesis(slide, results, {
        summary: answer || results[0]?.snippet,
        draftReference: answer || results.map((result) => result.snippet).join("；"),
        keyFindings: results.slice(0, 5).map((result, index) => ({
          statement: result.snippet,
          sourceIndexes: [index + 1]
        })),
        caveats: ["综合文字由检索服务基于网页片段生成；关键数据仍应打开原始来源复核。"]
      }),
      notes: `联网检索 · Tavily · ${results.length} 个可追溯来源`
    };
  }
}
