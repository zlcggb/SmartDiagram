import assert from "node:assert/strict";
import test from "node:test";
import { resolveDirectorScope } from "./directorScope.js";

const slides = [
  { id: "slide-1", svgPreview: "<svg />" },
  { id: "slide-2", svgPreview: null },
  { id: "slide-3", svgPreview: "<svg />" },
  { id: "slide-4", svgPreview: "" }
];

test("默认已完成设计稿范围只选择有 SVG 的页面", () => {
  const scope = resolveDirectorScope(slides, { mode: "designed", startPage: 1, endPage: 4 });

  assert.deepEqual(scope.slideIds, ["slide-1", "slide-3"]);
  assert.equal(scope.summary, "第 1、3 页 · 共 2 页");
  assert.equal(scope.exportReady, true);
});

test("自定义范围保留真实页码并识别未完成设计稿", () => {
  const scope = resolveDirectorScope(slides, { mode: "custom", startPage: 2, endPage: 3 });

  assert.deepEqual(scope.slideIds, ["slide-2", "slide-3"]);
  assert.deepEqual(scope.missingDesignPages, [2]);
  assert.equal(scope.summary, "第 2–3 页 · 共 2 页");
  assert.equal(scope.exportReady, false);
});

test("全部页面范围会阻止包含未完成设计稿的视频导出", () => {
  const scope = resolveDirectorScope(slides, { mode: "all", startPage: 1, endPage: 4 });

  assert.deepEqual(scope.slideIds, ["slide-1", "slide-2", "slide-3", "slide-4"]);
  assert.deepEqual(scope.missingDesignPages, [2, 4]);
  assert.equal(scope.exportBlockedReason, "第 2、4 页尚未生成设计稿");
});

test("没有已完成设计稿时返回空范围并禁用批量操作", () => {
  const scope = resolveDirectorScope([{ id: "slide-1", svgPreview: null }], {
    mode: "designed",
    startPage: 1,
    endPage: 1
  });

  assert.deepEqual(scope.slideIds, []);
  assert.equal(scope.summary, "尚无已完成设计稿");
});
