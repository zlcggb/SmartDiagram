import {
  MockGeminiAdapter,
  OpenAiCompatibleAdapter,
  RealGeminiAdapter,
  setResearchAdapter,
  TavilyResearchAdapter
} from "@ppt-agent/agents";
import type { GeminiAdapter } from "@ppt-agent/agents";
import { getAiUsage, wrapAdapterWithUsage } from "./aiUsage.js";

export type AiProvider = "gemini" | "openai-compatible" | "mock";
export type ResearchProvider = "tavily" | "ai-knowledge";

function hasOpenAiCompatibleConfig() {
  const key = Boolean(process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY);
  const base = Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.TRADINGAGENTS_LLM_BACKEND_URL || process.env.OPENAI_BASE_URL);
  return key && base;
}

export function configuredAiProvider(): AiProvider {
  const raw = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (raw === "gemini") return "gemini";
  if (raw === "openai" || raw === "openai-compatible" || raw === "compatible") return "openai-compatible";
  if (raw === "mock") return "mock";
  // 未显式指定时：有兼容网关配置则优先用它，否则有 Gemini Key 用 gemini，否则 mock
  if (hasOpenAiCompatibleConfig()) return "openai-compatible";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "mock";
}

export function configuredResearchProvider(): ResearchProvider {
  const raw = (process.env.RESEARCH_PROVIDER || process.env.RESEARCH_ADAPTER || "").trim().toLowerCase();
  if (raw === "tavily") return "tavily";
  if (raw === "ai" || raw === "llm" || raw === "ai-knowledge" || raw === "llm-simulated") {
    return "ai-knowledge";
  }
  return process.env.TAVILY_API_KEY ? "tavily" : "ai-knowledge";
}

export function configureResearchAdapter() {
  const provider = configuredResearchProvider();
  if (provider !== "tavily") {
    setResearchAdapter(null);
    return provider;
  }
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEARCH_PROVIDER=tavily，但未配置 TAVILY_API_KEY");
  }
  setResearchAdapter(
    new TavilyResearchAdapter({
      apiKey,
      endpoint: process.env.TAVILY_API_URL,
      searchDepth:
        process.env.TAVILY_SEARCH_DEPTH === "basic" ||
        process.env.TAVILY_SEARCH_DEPTH === "fast" ||
        process.env.TAVILY_SEARCH_DEPTH === "ultra-fast"
          ? process.env.TAVILY_SEARCH_DEPTH
          : "advanced",
      maxResults: Number(process.env.TAVILY_MAX_RESULTS || 6)
    })
  );
  return provider;
}

export function aiRuntimeStatus() {
  const provider = configuredAiProvider();
  const researchProvider = configuredResearchProvider();
  const openAiModel =
    process.env.OPENAI_COMPATIBLE_MODEL ||
    process.env.TRADINGAGENTS_DEEP_THINK_LLM ||
    process.env.GEMINI_MODEL ||
    "gemini-3-flash-agent";
  const openAiDesign =
    process.env.OPENAI_COMPATIBLE_DESIGN_MODEL || process.env.GEMINI_DESIGN_MODEL || openAiModel;
  const geminiModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const geminiDesign = process.env.GEMINI_DESIGN_MODEL || geminiModel;
  const usage = getAiUsage();

  return {
    provider,
    researchProvider,
    realSearchEnabled: researchProvider === "tavily" && Boolean(process.env.TAVILY_API_KEY),
    model: provider === "openai-compatible" ? openAiModel : provider === "gemini" ? geminiModel : "mock",
    designModel: provider === "openai-compatible" ? openAiDesign : provider === "gemini" ? geminiDesign : "mock",
    baseUrl:
      provider === "openai-compatible"
        ? process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.TRADINGAGENTS_LLM_BACKEND_URL || process.env.OPENAI_BASE_URL || null
        : provider === "gemini"
          ? "https://generativelanguage.googleapis.com"
          : null,
    geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    openAiCompatibleKeyConfigured: Boolean(process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY),
    openAiCompatibleBaseConfigured: Boolean(
      process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.TRADINGAGENTS_LLM_BACKEND_URL || process.env.OPENAI_BASE_URL
    ),
    geminiProxyConfigured: Boolean(process.env.GEMINI_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY),
    usingMock: provider === "mock",
    usage
  };
}

export function createAiAdapter(): GeminiAdapter {
  const provider = configuredAiProvider();
  const base =
    provider === "openai-compatible"
      ? new OpenAiCompatibleAdapter()
      : provider === "gemini"
        ? new RealGeminiAdapter()
        : new MockGeminiAdapter();
  return wrapAdapterWithUsage(base);
}
