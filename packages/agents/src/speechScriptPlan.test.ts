import assert from "node:assert/strict";
import test from "node:test";
import type { SlideDto } from "@ppt-agent/shared";
import { MockGeminiAdapter } from "./mockGeminiAdapter.js";

const slide: SlideDto = {
  id: "slide-1",
  projectId: "project-1",
  sortOrder: 1,
  title: "安全架构梳理",
  slideGoal: "讲清安全边界",
  keyMessage: "职责分离与双库隔离奠定安全基础",
  contentPoints: ["三层安全隔离机制", "优先治理 AI 成本"],
  recommendedLayout: "generic-cards",
  status: "planned",
  isContentLocked: false,
  isLayoutLocked: false,
  sourceFactIds: [],
  generationStatus: "svg-ready"
};

test("mock speech plan selects stable visible text IDs instead of coordinates", async () => {
  const plan = await new MockGeminiAdapter().generateSpeechScriptPlan(slide, {
    index: 0,
    total: 1,
    style: "formal-report",
    visibleTextCandidates: [
      { id: "text-1", text: "安全架构梳理" },
      { id: "text-2", text: "职责分离与双库隔离奠定安全基础" },
      { id: "text-3", text: "三层安全隔离机制" },
      { id: "text-4", text: "优先治理 AI 成本" }
    ]
  });

  assert.match(plan.scriptText, /安全架构梳理/);
  assert.ok(plan.focusTargets.length >= 2);
  assert.ok(plan.focusTargets.every((target) => target.targetTextIds.length > 0));
  assert.ok(plan.focusTargets.every((target) => target.targetTextIds.every((id) => /^text-[1-4]$/.test(id))));
  assert.equal("x" in plan.focusTargets[0]!, false);
});
