import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectSchema,
  defaultPresentationStyleId,
  getPresentationStylePreset,
  normalizePresentationStyleId,
  presentationStyleIds,
  presentationStyleList,
  resolvePresentationStyleId,
  updateSlideSchema
} from "./index.js";

test("演示风格目录包含五个稳定预设且默认使用战略咨询", () => {
  assert.deepEqual(presentationStyleIds, [
    "apple-minimal",
    "consulting",
    "data-story",
    "tech-architecture",
    "editorial"
  ]);
  assert.equal(presentationStyleList.length, 5);
  assert.equal(defaultPresentationStyleId, "consulting");
  assert.equal(getPresentationStylePreset("apple-minimal").label, "Apple 极简");
});

test("非法或缺失风格会安全回退到项目默认风格", () => {
  assert.equal(normalizePresentationStyleId(undefined), "consulting");
  assert.equal(normalizePresentationStyleId("unknown"), "consulting");
  assert.equal(resolvePresentationStyleId("data-story"), "data-story");
  assert.equal(resolvePresentationStyleId("data-story", "tech-architecture"), "tech-architecture");
  assert.equal(resolvePresentationStyleId("data-story", null), "data-story");
});

test("项目创建和单页覆盖接口只接受已声明的风格", () => {
  assert.equal(
    createProjectSchema.parse({
      name: "测试项目",
      reportType: "方案",
      audience: "管理层",
      purpose: "决策"
    }).presentationStyle,
    "consulting"
  );
  assert.equal(
    createProjectSchema.parse({
      name: "测试项目",
      reportType: "方案",
      audience: "管理层",
      purpose: "决策",
      presentationStyle: "editorial"
    }).presentationStyle,
    "editorial"
  );
  assert.equal(updateSlideSchema.parse({ presentationStyle: null }).presentationStyle, null);
  assert.equal(
    updateSlideSchema.parse({ presentationStyle: "tech-architecture" }).presentationStyle,
    "tech-architecture"
  );
  assert.equal(updateSlideSchema.safeParse({ presentationStyle: "unknown" }).success, false);
});
