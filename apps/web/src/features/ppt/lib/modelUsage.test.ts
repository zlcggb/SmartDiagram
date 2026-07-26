import assert from "node:assert/strict";
import test from "node:test";

import {
  describeModelUsageHttpError,
  parseModelUsageDashboard,
  projectUsageIndicator,
} from "./modelUsage.ts";

test("parses project totals and preserves each model call", () => {
  const result = parseModelUsageDashboard({
    period: "2026-07",
    summary: {
      total_tokens: 125_000,
    },
    project_summary: {
      call_count: 2,
      input_tokens: 1200,
      output_tokens: 300,
      cached_tokens: 200,
      reasoning_tokens: 50,
      total_tokens: 1500,
      estimated_cost: 0.0432,
      currency: "CNY",
      unpriced_count: 0,
      model_event_count: 2,
    },
    events: [
      {
        id: "evt-2",
        stage: "svg",
        provider: "gemini",
        model: "gemini-3.6-flash-high",
        status: "succeeded",
        input_tokens: 700,
        output_tokens: 200,
        cached_tokens: 100,
        reasoning_tokens: 0,
        total_tokens: 900,
        usage_available: true,
        estimated_cost: 0.0012,
        currency: "CNY",
        pricing_source: "configured",
        duration_ms: 820,
        output_summary: "已生成 SVG",
        started_at: "2026-07-25T08:10:00Z",
      },
      {
        id: "evt-1",
        stage: "outline",
        provider: "openai-compatible",
        model: "gpt-5.3-codex-spark",
        status: "failed",
        input_tokens: 500,
        output_tokens: 100,
        cached_tokens: 100,
        reasoning_tokens: 50,
        total_tokens: 600,
        usage_available: true,
        estimated_cost: 0.042,
        currency: "CNY",
        pricing_source: "configured",
        duration_ms: 1200,
        error_message: "upstream timeout",
        started_at: "2026-07-25T08:09:00Z",
      },
    ],
    total: 2,
    budget: {
      monthly_token_limit: 5_000_000,
      hard_limit_enabled: true,
    },
  });

  assert.deepEqual(result.project, {
    callCount: 2,
    inputTokens: 1200,
    outputTokens: 300,
    cachedTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1500,
    estimatedCost: 0.0432,
    currency: "CNY",
    unpricedCount: 0,
  });
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0]?.model, "gemini-3.6-flash-high");
  assert.equal(result.events[0]?.estimatedCost, 0.0012);
  assert.equal(result.events[1]?.status, "failed");
  assert.equal(result.events[1]?.errorMessage, "upstream timeout");
  assert.equal(result.limitTokens, 5_000_000);
  assert.equal(result.isHardLimit, true);
  assert.deepEqual(result.monthlyQuota, {
    usedTokens: 125_000,
    remainingTokens: 4_875_000,
    usedPercent: 2.5,
    remainingPercent: 97.5,
  });
});

test("normalizes missing and invalid values to safe display defaults", () => {
  const result = parseModelUsageDashboard({
    project_summary: { call_count: "3", total_tokens: -5 },
    events: [{ id: "x", model: "m", estimated_cost: "0.5" }],
  });

  assert.equal(result.project.callCount, 3);
  assert.equal(result.project.totalTokens, 0);
  assert.equal(result.events[0]?.estimatedCost, 0.5);
  assert.equal(result.events[0]?.status, "succeeded");
  assert.equal(result.events[0]?.usageAvailable, false);
  assert.deepEqual(result.monthlyQuota, {
    usedTokens: 0,
    remainingTokens: 0,
    usedPercent: 0,
    remainingPercent: 0,
  });
});

test("caps quota percentages when monthly usage exceeds the limit", () => {
  const result = parseModelUsageDashboard({
    summary: { total_tokens: 1200 },
    budget: { monthly_token_limit: 1000 },
  });

  assert.deepEqual(result.monthlyQuota, {
    usedTokens: 1200,
    remainingTokens: 0,
    usedPercent: 100,
    remainingPercent: 0,
  });
});

test("distinguishes unavailable usage statistics from a real zero", () => {
  assert.deepEqual(projectUsageIndicator(null), {
    label: "项目 --",
    hasError: false,
  });
  assert.deepEqual(projectUsageIndicator({
    projectRunCount: 0,
    usageError: "用量服务路由不可用（HTTP 404）",
  }), {
    label: "统计异常",
    hasError: true,
  });
  assert.deepEqual(projectUsageIndicator({ projectRunCount: 0 }), {
    label: "项目 0 次",
    hasError: false,
  });
});

test("turns model usage HTTP failures into actionable messages", () => {
  assert.equal(describeModelUsageHttpError(401), "登录状态已失效，请重新登录");
  assert.equal(describeModelUsageHttpError(404), "用量服务路由不可用（HTTP 404）");
  assert.equal(describeModelUsageHttpError(503), "项目用量服务暂时不可用（HTTP 503）");
});
