import assert from "node:assert/strict";
import test from "node:test";
import type { SlideDto } from "@ppt-agent/shared";
import { normalizeAiPageSearch } from "./studioHelpers.js";

const slide: SlideDto = {
  id: "slide-1",
  projectId: "project-1",
  sortOrder: 1,
  title: "完整检索材料",
  slideGoal: "说明完整材料",
  keyMessage: "完整关键结论",
  contentPoints: [],
  recommendedLayout: "generic-cards",
  status: "draft",
  isContentLocked: false,
  isLayoutLocked: false,
  sourceFactIds: [],
  generationStatus: "draft"
};

test("AI 检索整理结果保留完整素材和综合结论", () => {
  const snippet = `素材原文：${"完整内容".repeat(90)}。`;
  const summary = `综合结论：${"完整判断".repeat(80)}。`;
  const finding = `关键发现：${"完整证据".repeat(50)}。`;

  const result = normalizeAiPageSearch(slide, {
    queries: ["完整查询"],
    results: [{ title: "来源", snippet }],
    synthesis: {
      summary,
      keyFindings: [{ statement: finding, sourceIndexes: [1] }],
      draftReference: summary
    }
  });

  assert.equal(result.results[0]?.snippet, snippet);
  assert.equal(result.synthesis?.summary, summary);
  assert.equal(result.synthesis?.keyFindings[0]?.statement, finding);
  assert.equal(result.synthesis?.draftReference, summary);
});
