import type { ModelUsageEvent, ModelUsageReporter } from "@ppt-agent/agents";
import { currentModelUsageContext } from "./modelUsageContext.js";

type Fetcher = typeof fetch;

function compactBaseUrl(value: string) {
  return value.trim().replace(/\/+$/u, "");
}

function eventBody(event: ModelUsageEvent, context: NonNullable<ReturnType<typeof currentModelUsageContext>>) {
  return {
    external_event_id: event.externalEventId,
    project_id: context.projectId,
    slide_id: context.slideId,
    source: "ppt",
    stage: event.stage,
    provider: event.provider,
    model: event.model,
    status: event.status,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cached_tokens: event.cachedTokens,
    reasoning_tokens: event.reasoningTokens,
    total_tokens: event.totalTokens,
    usage_available: event.usageAvailable,
    duration_ms: event.durationMs,
    http_status: event.httpStatus,
    error_code: event.errorCode,
    error_message: event.errorMessage,
    output_summary: context.outputSummary ?? `${event.stage} 模型调用`,
    started_at: event.startedAt,
    ended_at: event.endedAt
  };
}

export function createModelUsageReporter(options: {
  baseUrl?: string;
  internalSecret?: string;
  fetcher?: Fetcher;
  attempts?: number;
  timeoutMs?: number;
  onError?: (error: Error) => void;
} = {}): ModelUsageReporter {
  const fetcher = options.fetcher ?? fetch;
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 3));
  const timeoutMs = Math.max(250, Math.min(5_000, options.timeoutMs ?? 1_500));

  return async (event) => {
    const context = currentModelUsageContext();
    const baseUrl = compactBaseUrl(
      options.baseUrl
        ?? process.env.USAGE_LEDGER_URL
        ?? process.env.AUTH_SERVICE_URL
        ?? process.env.MATERIAL_GATEWAY_URL
        ?? "http://127.0.0.1:8000"
    );
    const internalSecret = options.internalSecret ?? process.env.PPT_INTERNAL_API_SECRET ?? "";
    if (!context?.userId || !context.tenantId || !internalSecret) return;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const headers = new Headers({
          "Content-Type": "application/json",
          "X-PPT-Internal-Secret": internalSecret,
          "X-User-Id": context.userId,
          "X-Tenant-Id": context.tenantId
        });
        if (context.authorization) headers.set("Authorization", context.authorization);
        const response = await fetcher(`${baseUrl}/api/billing/model-usage-events`, {
          method: "POST",
          headers,
          body: JSON.stringify(eventBody(event, context)),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (response.ok) return;
        const message = `usage ledger rejected event (${response.status})`;
        if (response.status < 500) throw new Error(message);
        lastError = new Error(message);
      } catch (error) {
        lastError = error;
      }
    }
    const finalError = lastError instanceof Error ? lastError : new Error("usage ledger unavailable");
    if (options.onError) {
      options.onError(finalError);
    } else {
      console.error(`[model-usage] ${finalError.message}`);
    }
    throw finalError;
  };
}
