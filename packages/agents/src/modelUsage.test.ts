import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleAdapter, extractUsageFromPayload } from "./openaiCompatibleAdapter.js";
import { extractGeminiUsageFromPayload } from "./realGeminiAdapter.js";
import type { ModelUsageEvent } from "./types.js";

test("extracts input, output, cached, and reasoning tokens from one response", () => {
  assert.deepEqual(
    extractUsageFromPayload({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
        prompt_tokens_details: { cached_tokens: 25 },
        completion_tokens_details: { reasoning_tokens: 12 }
      }
    }),
    {
      promptTokens: 120,
      completionTokens: 40,
      cachedTokens: 25,
      reasoningTokens: 12,
      totalTokens: 160
    }
  );
});

test("extracts Gemini usage metadata without estimating missing fields", () => {
  assert.deepEqual(
    extractGeminiUsageFromPayload({
      usageMetadata: {
        promptTokenCount: 80,
        candidatesTokenCount: 20,
        cachedContentTokenCount: 15,
        thoughtsTokenCount: 7,
        totalTokenCount: 100
      }
    }),
    {
      promptTokens: 80,
      completionTokens: 20,
      cachedTokens: 15,
      reasoningTokens: 7,
      totalTokens: 100
    }
  );
});

test("emits an exact event for a successful non-streaming provider request", async () => {
  const events: ModelUsageEvent[] = [];
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    model: "model-a",
    reporter: (event) => { events.push(event); },
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: "done" } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
    }), { status: 200 }) as never
  });

  const result = await (adapter as unknown as {
    chat: (system: string, user: string, options: { stage: "outline" }) => Promise<string>;
  }).chat("system", "user", { stage: "outline" });

  assert.equal(result, "done");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.provider, "openai-compatible");
  assert.equal(events[0]?.model, "model-a");
  assert.equal(events[0]?.stage, "outline");
  assert.equal(events[0]?.status, "succeeded");
  assert.equal(events[0]?.inputTokens, 11);
  assert.equal(events[0]?.outputTokens, 7);
  assert.equal(events[0]?.usageAvailable, true);
});

test("parallel requests emit isolated token events", async () => {
  const events: ModelUsageEvent[] = [];
  let call = 0;
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    model: "model-a",
    reporter: (event) => { events.push(event); },
    fetcher: async () => {
      call += 1;
      const current = call;
      await new Promise((resolve) => setTimeout(resolve, current === 1 ? 15 : 1));
      return new Response(JSON.stringify({
        choices: [{ message: { content: `done-${current}` } }],
        usage: { prompt_tokens: current * 10, completion_tokens: current, total_tokens: current * 11 }
      }), { status: 200 }) as never;
    }
  });
  const chat = (adapter as unknown as {
    chat: (system: string, user: string, options: { stage: "plan" | "svg" }) => Promise<string>;
  }).chat.bind(adapter);

  await Promise.all([
    chat("system", "one", { stage: "plan" }),
    chat("system", "two", { stage: "svg" })
  ]);

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => [event.stage, event.inputTokens, event.outputTokens]).sort(),
    [["plan", 10, 1], ["svg", 20, 2]].sort()
  );
});

test("failed provider attempts are recorded without prompt or response bodies", async () => {
  const events: ModelUsageEvent[] = [];
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    model: "model-a",
    reporter: (event) => { events.push(event); },
    fetcher: async () => new Response('{"error":{"message":"bad request"}}', { status: 500 }) as never
  });

  await assert.rejects(
    (adapter as unknown as { chat: (a: string, b: string, c: { stage: "facts" }) => Promise<string> })
      .chat("secret prompt", "secret input", { stage: "facts" })
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, "failed");
  assert.equal(events[0]?.httpStatus, 500);
  assert.equal("prompt" in (events[0] as unknown as Record<string, unknown>), false);
  assert.equal("output" in (events[0] as unknown as Record<string, unknown>), false);
});

test("generateSpeechScript uses the main model, not the design model", async () => {
  const events: ModelUsageEvent[] = [];
  const requestedModels: string[] = [];
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    model: "gpt-5.3-codex-spark",
    designModel: "gemini-3.6-flash-high",
    reporter: (event) => { events.push(event); },
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (body.model) requestedModels.push(body.model);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "这一页先讲架构边界，再落到安全管控。" } }],
        usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 }
      }), { status: 200 }) as never;
    }
  });

  const script = await adapter.generateSpeechScript(
    {
      id: "slide-1",
      projectId: "project-1",
      sortOrder: 1,
      title: "架构安全梳理",
      slideGoal: "讲清边界",
      keyMessage: "主系统与引擎职责分离",
      contentPoints: ["鉴权", "配额"],
      recommendedLayout: "generic-cards",
      status: "draft",
      isContentLocked: false,
      isLayoutLocked: false,
      sourceFactIds: [],
      generationStatus: "draft"
    },
    { index: 0, total: 1, style: "formal-report" }
  );

  assert.match(script, /架构边界/);
  assert.deepEqual(requestedModels, ["gpt-5.3-codex-spark"]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.model, "gpt-5.3-codex-spark");
  assert.equal(events[0]?.stage, "main");
  assert.equal(events[0]?.status, "succeeded");
});
