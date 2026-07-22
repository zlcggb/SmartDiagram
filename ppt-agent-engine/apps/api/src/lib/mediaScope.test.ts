import assert from "node:assert/strict";
import test from "node:test";
import { assertDesignedSlides, selectScopedSlides } from "./mediaScope.js";

const slides = [
  { id: "slide-1", svgPreview: "<svg />", title: "封面" },
  { id: "slide-2", svgPreview: null, title: "问题" },
  { id: "slide-3", svgPreview: "  ", title: "方案" }
];

test("后端按项目顺序选择请求范围而不是信任请求顺序", () => {
  assert.deepEqual(
    selectScopedSlides(slides, ["slide-3", "slide-1"]).map((slide) => slide.id),
    ["slide-1", "slide-3"]
  );
});

test("未传范围时兼容选择全部页面", () => {
  assert.deepEqual(selectScopedSlides(slides).map((slide) => slide.id), ["slide-1", "slide-2", "slide-3"]);
});

test("后端拒绝不属于当前项目的页面", () => {
  assert.throws(() => selectScopedSlides(slides, ["slide-1", "foreign-slide"]), /不属于当前项目/);
});

test("视频导出明确列出尚未生成设计稿的原始页码", () => {
  assert.throws(() => assertDesignedSlides(slides), /第 2、3 页/);
  assert.doesNotThrow(() => assertDesignedSlides([slides[0]!]));
});
