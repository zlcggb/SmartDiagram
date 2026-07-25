export interface ModelUsageTotals {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: string;
  unpricedCount: number;
}

export interface ModelUsageEventDto {
  id: string;
  projectId?: string;
  slideId?: string;
  source: string;
  stage: string;
  provider: string;
  model: string;
  status: "succeeded" | "failed";
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  usageAvailable: boolean;
  estimatedCost: number;
  currency: string;
  pricingSource: string;
  durationMs: number;
  httpStatus?: number;
  errorMessage?: string;
  outputSummary?: string;
  startedAt?: string;
}

export interface ModelUsageDashboard {
  period: string;
  project: ModelUsageTotals;
  events: ModelUsageEventDto[];
  total: number;
  limitTokens: number;
  isHardLimit: boolean;
  monthlyQuota: TokenQuotaUsage;
}

export interface TokenQuotaUsage {
  usedTokens: number;
  remainingTokens: number;
  usedPercent: number;
  remainingPercent: number;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseTotals(value: unknown): ModelUsageTotals {
  const source = objectValue(value);
  return {
    callCount: Math.round(numberValue(source.model_event_count ?? source.call_count)),
    inputTokens: Math.round(numberValue(source.input_tokens)),
    outputTokens: Math.round(numberValue(source.output_tokens)),
    cachedTokens: Math.round(numberValue(source.cached_tokens)),
    reasoningTokens: Math.round(numberValue(source.reasoning_tokens)),
    totalTokens: Math.round(numberValue(source.total_tokens)),
    estimatedCost: numberValue(source.estimated_cost),
    currency: stringValue(source.currency, "CNY"),
    unpricedCount: Math.round(numberValue(source.unpriced_count)),
  };
}

function parseEvent(value: unknown, index: number): ModelUsageEventDto {
  const source = objectValue(value);
  const status = source.status === "failed" ? "failed" : "succeeded";
  return {
    id: stringValue(source.id ?? source.external_event_id, `usage-${index}`),
    projectId: stringValue(source.project_id) || undefined,
    slideId: stringValue(source.slide_id) || undefined,
    source: stringValue(source.source, "ppt"),
    stage: stringValue(source.stage, "unknown"),
    provider: stringValue(source.provider, "unknown"),
    model: stringValue(source.model, "unknown"),
    status,
    inputTokens: Math.round(numberValue(source.input_tokens)),
    outputTokens: Math.round(numberValue(source.output_tokens)),
    cachedTokens: Math.round(numberValue(source.cached_tokens)),
    reasoningTokens: Math.round(numberValue(source.reasoning_tokens)),
    totalTokens: Math.round(numberValue(source.total_tokens)),
    usageAvailable: source.usage_available === true,
    estimatedCost: numberValue(source.estimated_cost),
    currency: stringValue(source.currency, "CNY"),
    pricingSource: stringValue(source.pricing_source, "unpriced"),
    durationMs: Math.round(numberValue(source.duration_ms)),
    httpStatus: numberValue(source.http_status) || undefined,
    errorMessage: stringValue(source.error_message) || undefined,
    outputSummary: stringValue(source.output_summary) || undefined,
    startedAt: stringValue(source.started_at) || undefined,
  };
}

export function parseModelUsageDashboard(payload: unknown): ModelUsageDashboard {
  const root = objectValue(payload);
  const budget = objectValue(root.budget);
  const monthly = parseTotals(root.summary);
  const limitTokens = Math.round(numberValue(budget.monthly_token_limit));
  const usedTokens = monthly.totalTokens;
  const remainingTokens = limitTokens > 0 ? Math.max(0, limitTokens - usedTokens) : 0;
  const usedPercent = limitTokens > 0
    ? Math.min(100, Math.round((usedTokens / limitTokens) * 10_000) / 100)
    : 0;
  const events = Array.isArray(root.events)
    ? root.events.map((event, index) => parseEvent(event, index))
    : [];
  return {
    period: stringValue(root.period, "当月"),
    project: parseTotals(root.project_summary),
    events,
    total: Math.round(numberValue(root.total)),
    limitTokens,
    isHardLimit: budget.hard_limit_enabled === true,
    monthlyQuota: {
      usedTokens,
      remainingTokens,
      usedPercent,
      remainingPercent: limitTokens > 0 ? Math.round((100 - usedPercent) * 100) / 100 : 0,
    },
  };
}
