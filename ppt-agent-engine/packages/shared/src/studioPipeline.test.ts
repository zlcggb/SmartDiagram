import assert from "node:assert/strict";
import test from "node:test";
import {
  isStudioStageComplete,
  missingStudioPrerequisite,
  requiredStudioPipelineStages
} from "./studioPipeline.js";

test("空白页面生成设计稿时必须依次执行检索、初稿和设计", () => {
  assert.deepEqual(requiredStudioPipelineStages({}), ["search", "draft", "design"]);
});

test("已有检索时只补初稿再生成设计", () => {
  assert.deepEqual(requiredStudioPipelineStages({ searchJson: {} }), ["draft", "design"]);
});

test("已有检索和初稿时可以直接重新生成设计", () => {
  assert.deepEqual(requiredStudioPipelineStages({ searchJson: {}, planJson: {} }), ["design"]);
});

test("初稿存在但检索缺失时仍从检索开始并重做下游阶段", () => {
  assert.deepEqual(requiredStudioPipelineStages({ planJson: {} }), ["search", "draft", "design"]);
});

test("初稿接口要求先有检索，设计接口同时要求检索和初稿", () => {
  assert.equal(missingStudioPrerequisite({}, "draft"), "search");
  assert.equal(missingStudioPrerequisite({}, "design"), "search");
  assert.equal(missingStudioPrerequisite({ searchJson: {} }, "design"), "draft");
  assert.equal(missingStudioPrerequisite({ searchJson: {}, planJson: {} }, "design"), null);
});

test("每个阶段只有在对应产物真实写回后才算完成", () => {
  assert.equal(isStudioStageComplete({}, "search"), false);
  assert.equal(isStudioStageComplete({ searchJson: {} }, "search"), true);
  assert.equal(isStudioStageComplete({ searchJson: {} }, "draft"), false);
  assert.equal(isStudioStageComplete({ planJson: {} }, "draft"), true);
  assert.equal(isStudioStageComplete({ planJson: {} }, "design"), false);
  assert.equal(isStudioStageComplete({ svgPreview: "<svg />" }, "design"), true);
});
