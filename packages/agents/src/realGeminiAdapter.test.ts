import assert from "node:assert/strict";
import test from "node:test";
import type { SlideDto } from "@ppt-agent/shared";
import { normalizeSlidePlan, parseInteractionSseBuffer } from "./realGeminiAdapter.js";

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
