import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCopyBudgetsToBlockItems,
  applyCopyBudgetsToSlideFields,
  softTrimCopy
} from "./copyBudgets.js";

const completeKeyMessage =
  "拒绝死记硬背，通过 AI 应用实战案例，直观理解 DTO、Entity、Value Object 与 Protocol 在完整业务链路中的协作关系。";
const completeBullet =
  "目标：通过案例、图像和完整的数据流说明四种模型各自负责什么，以及它们如何共同完成业务请求。";

test("文案清理只整理空白，不再按旧字符预算截断", () => {
  assert.equal(softTrimCopy(`  ${completeKeyMessage}  `, 24), completeKeyMessage);
});

test("大纲字段保留 AI 返回的完整关键结论和内容要点", () => {
  const result = applyCopyBudgetsToSlideFields({
    title: "从 AI 实战理解核心数据模型及其完整协作方式",
    keyMessage: completeKeyMessage,
    slideGoal: completeKeyMessage,
    contentPoints: [completeBullet]
  });

  assert.equal(result.keyMessage, completeKeyMessage);
  assert.equal(result.slideGoal, completeKeyMessage);
  assert.equal(result.contentPoints[0], completeBullet);
  assert.ok(!result.title.endsWith("…"));
});

test("初稿内容块条目保留完整句子", () => {
  assert.deepEqual(applyCopyBudgetsToBlockItems([completeBullet]), [completeBullet]);
});
