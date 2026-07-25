import assert from "node:assert/strict";
import test from "node:test";
import type { ModelUsageEvent } from "@ppt-agent/agents";
import { runWithModelUsageContext } from "./modelUsageContext.js";
import { createModelUsageReporter } from "./modelUsageReporter.js";

const event: ModelUsageEvent = {
  externalEventId: "evt-1",
  provider: "openai-compatible",
  model: "model-a",
  stage: "svg",
  status: "succeeded",
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 10,
  reasoningTokens: 5,
  totalTokens: 120,
  usageAvailable: true,
  durationMs: 40,
  httpStatus: 200,
  startedAt: "2026-07-25T08:00:00.000Z",
  endedAt: "2026-07-25T08:00:00.040Z"
};

test("reports authenticated PPT usage with project and slide attribution", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const reporter = createModelUsageReporter({
    baseUrl: "http://billing.local",
    internalSecret: "shared-secret",
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ created: true }), { status: 200 }) as never;
    }
  });

  await runWithModelUsageContext({
    authorization: "Bearer user-token",
    tenantId: "tenant-1",
    userId: "user-1",
    projectId: "ppt-1",
    slideId: "slide-1",
    outputSummary: "第 1 页设计稿"
  }, () => reporter(event));

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://billing.local/api/billing/model-usage-events");
  assert.equal(new Headers(requests[0]?.init.headers).get("authorization"), "Bearer user-token");
  assert.equal(new Headers(requests[0]?.init.headers).get("x-ppt-internal-secret"), "shared-secret");
  const body = JSON.parse(String(requests[0]?.init.body));
  assert.equal(body.project_id, "ppt-1");
  assert.equal(body.slide_id, "slide-1");
  assert.equal(body.input_tokens, 100);
  assert.equal(body.estimated_cost, undefined);
  assert.equal(body.output_summary, "第 1 页设计稿");
});

test("does not report guest or context-free calls to a personal ledger", async () => {
  let calls = 0;
  const reporter = createModelUsageReporter({
    baseUrl: "http://billing.local",
    internalSecret: "shared-secret",
    fetcher: async () => {
      calls += 1;
      return new Response("{}", { status: 200 }) as never;
    }
  });

  await reporter(event);
  await runWithModelUsageContext({ projectId: "guest-project" }, () => reporter(event));

  assert.equal(calls, 0);
});

test("parallel contexts never exchange project attribution", async () => {
  const projectIds: string[] = [];
  const reporter = createModelUsageReporter({
    baseUrl: "http://billing.local",
    internalSecret: "shared-secret",
    fetcher: async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      projectIds.push(JSON.parse(String(init?.body)).project_id);
      return new Response("{}", { status: 200 }) as never;
    }
  });
  const context = (projectId: string) => ({
    authorization: "Bearer token",
    tenantId: "tenant-1",
    userId: "user-1",
    projectId
  });

  await Promise.all([
    runWithModelUsageContext(context("ppt-a"), () => reporter({ ...event, externalEventId: "evt-a" })),
    runWithModelUsageContext(context("ppt-b"), () => reporter({ ...event, externalEventId: "evt-b" }))
  ]);

  assert.deepEqual(projectIds.sort(), ["ppt-a", "ppt-b"]);
});

