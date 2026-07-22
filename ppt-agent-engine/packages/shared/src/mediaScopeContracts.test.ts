import assert from "node:assert/strict";
import test from "node:test";
import { narrationOptionsSchema, narrationStyleSchema, videoExportSchema } from "./index.js";

test("媒体批量输入接受明确且非空的 slideIds", () => {
  const slideIds = ["slide-1", "slide-3"];

  assert.deepEqual(narrationOptionsSchema.parse({ slideIds }).slideIds, slideIds);
  assert.deepEqual(narrationStyleSchema.parse({ prompt: "自然朗读", slideIds }).slideIds, slideIds);
  assert.deepEqual(videoExportSchema.parse({ slideIds }).slideIds, slideIds);
});

test("媒体批量输入拒绝空范围和重复页面", () => {
  assert.throws(() => narrationOptionsSchema.parse({ slideIds: [] }));
  assert.throws(() => narrationOptionsSchema.parse({ slideIds: ["slide-1", "slide-1"] }));
});

test("未传 slideIds 时保持全项目兼容行为", () => {
  assert.equal(narrationOptionsSchema.parse({}).slideIds, undefined);
});
