import assert from "node:assert/strict";
import test from "node:test";
import type { FactDto } from "../../shared";
import {
  canContinueFromSource,
  hasCompletedBrief,
  inferBriefQuestionSource,
  intentSteps,
  nextIntentTab
} from "./intentFlow.js";

function fact(canUseInPpt: boolean): FactDto {
  return {
    id: canUseInPpt ? "selected" : "not-selected",
    projectId: "project",
    category: "项目背景",
    content: "事实",
    status: "confirmed",
    confidence: 0.9,
    sourceText: "资料",
    sourceLocation: "第 1 段",
    canUseInPpt,
    createdAt: new Date(0).toISOString()
  };
}

test("意图步骤依次为需求、资料、视觉", () => {
  assert.deepEqual(
    intentSteps.map((step) => step.id),
    ["brief", "source", "visual"]
  );
  assert.equal(nextIntentTab("brief"), "source");
  assert.equal(nextIntentTab("source"), "visual");
  assert.equal(nextIntentTab("visual"), "visual");
});

test("至少有一条已勾选事实才能离开资料阶段", () => {
  assert.equal(canContinueFromSource([]), false);
  assert.equal(canContinueFromSource([fact(false)]), false);
  assert.equal(canContinueFromSource([fact(false), fact(true)]), true);
});

test("旧项目中的五个固定问题会被识别为通用回退", () => {
  const genericQuestions = ["audience", "purpose", "pages", "must", "avoid"].map((id) => ({
    id,
    question: `question-${id}`
  }));
  assert.equal(inferBriefQuestionSource(undefined, genericQuestions), "fallback");
  assert.equal(inferBriefQuestionSource("ai", genericQuestions), "ai");
  assert.equal(inferBriefQuestionSource(undefined, [{ id: "skill_gap", question: "当前的技能缺口是什么？" }]), undefined);
});

test("已有需求字段的旧资料项目不会被新流程锁住", () => {
  assert.equal(
    hasCompletedBrief({ mode: "paste", audience: "项目干系人", purpose: "同步进展", briefJson: null }),
    true
  );
  assert.equal(
    hasCompletedBrief({ mode: "topic", audience: "待确认受众", purpose: "待确认目的", briefJson: null }),
    false
  );
  assert.equal(
    hasCompletedBrief({
      mode: "topic",
      audience: "个人",
      purpose: "学习",
      briefJson: { topic: "主题", questions: [], answers: {}, summary: "已确认摘要" }
    }),
    true
  );
});
