import assert from "node:assert/strict";
import test from "node:test";
import type { SlideDto } from "@ppt-agent/shared";
import { generateExactOutline, normalizeSlidePlan, parseInteractionSseBuffer } from "./realGeminiAdapter.js";
import { buildOutlinePrompt } from "./prompts.js";
import { MockGeminiAdapter } from "./mockGeminiAdapter.js";
import { mockFinalizeBrief } from "./studioHelpers.js";

function rawOutline(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `第 ${index + 1} 页`,
    slideGoal: "说明页面目标",
    keyMessage: "核心结论",
    contentPoints: [],
    sourceFactIds: [],
    recommendedLayout: index === 0 ? "cover" : "generic-cards"
  }));
}

test("大纲少一页时自动重试一次并返回精确页数", async () => {
  let attempts = 0;
  const result = await generateExactOutline(12, new Set(), async () => {
    attempts += 1;
    return rawOutline(attempts === 1 ? 11 : 12);
  });

  assert.equal(attempts, 2);
  assert.equal(result.length, 12);
});

test("连续两次页数不符时明确失败且不接受残缺大纲", async () => {
  let attempts = 0;
  await assert.rejects(
    generateExactOutline(12, new Set(), async () => {
      attempts += 1;
      return rawOutline(11);
    }),
    /要求 12 页.*连续两次仅返回 11 页.*原大纲已保留/
  );
  assert.equal(attempts, 2);
});

test("大纲提示明确要求总页数并包含封面与收尾页", () => {
  const prompt = buildOutlinePrompt(
    { name: "季度复盘", audience: "管理层", purpose: "决策", pageCount: 12, theme: "white-blue" },
    []
  );
  assert.match(prompt, /恰好 12 个数组元素/);
  assert.match(prompt, /12 页包含封面和收尾页/);
});

test("Mock 模式同样严格返回请求页数", async () => {
  const outline = await new MockGeminiAdapter().generateOutline(
    { name: "演示", audience: "团队", purpose: "同步", pageCount: 12, theme: "white-blue" },
    []
  );
  assert.equal(outline.length, 12);
});

test("Mock 需求中的页数区间取上界而不是拼接成异常数字", () => {
  assert.equal(mockFinalizeBrief("演示", { pages: "8-12 页" }).pageCount, 12);
});

test("extracts incremental text deltas from Gemini interaction SSE", () => {
  const first = parseInteractionSseBuffer(
    'event: step.delta\ndata: {"event_type":"step.delta","delta":{"type":"text","text":"<svg"}}\n\n' +
      'event: step.delta\ndata: {"event_type":"step.delta","delta":{"type":"text","text":" viewBox=\\"0 0'
  );

  assert.deepEqual(first.deltas, ["<svg"]);
  assert.match(first.remaining, /viewBox/);

  const second = parseInteractionSseBuffer(
    `${first.remaining} 1280 720\\">"}}\n\nevent: interaction.completed\ndata: {"event_type":"interaction.completed"}\n\n`
  );
  assert.deepEqual(second.deltas, [' viewBox="0 0 1280 720">']);
  assert.equal(second.remaining, "");
});

test("surfaces Gemini SSE error events", () => {
  const parsed = parseInteractionSseBuffer(
    'event: error\ndata: {"event_type":"error","error":{"message":"quota exhausted"}}\n\n'
  );
  assert.equal(parsed.error, "quota exhausted");
});

test("初稿归一化保留完整的内容块标题", () => {
  const slide: SlideDto = {
    id: "slide-1",
    projectId: "project-1",
    sortOrder: 1,
    title: "完整标题",
    slideGoal: "完整页面目标",
    keyMessage: "完整关键结论",
    contentPoints: ["完整内容要点"],
    recommendedLayout: "generic-cards",
    status: "draft",
    isContentLocked: false,
    isLayoutLocked: false,
    sourceFactIds: [],
    generationStatus: "draft"
  };
  const blockTitle = "这是一个超过旧版十六字限制但语义完整的内容块标题";

  const result = normalizeSlidePlan(
    {
      title: slide.title,
      pageGoal: slide.slideGoal,
      keyMessage: slide.keyMessage,
      layoutType: slide.recommendedLayout,
      contentBlocks: [{ type: "bullets", title: blockTitle, items: ["完整内容"] }],
      sourceFactIds: []
    },
    slide,
    new Set()
  );

  assert.equal(result.contentBlocks[0]?.title, blockTitle);
});
