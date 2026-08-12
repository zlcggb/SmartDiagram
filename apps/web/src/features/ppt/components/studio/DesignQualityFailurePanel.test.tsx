import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignQualityFailurePanel } from "./DesignQualityFailurePanel.js";
import { highlightRejectedSvg } from "./designQualityFailure.js";

const rejectedSvg = [
  '<svg viewBox="0 0 1280 720">',
  '<text x="80" y="80" data-w="200" data-h="30">页面标题</text>',
  '<text x="80" y="150" data-w="180" data-h="24">风险闭环</text>',
  "</svg>"
].join("");

test("renders understandable issue locations and access to preview/source", () => {
  const html = renderToStaticMarkup(
    <DesignQualityFailurePanel
      failure={{
        code: "SVG_QUALITY_VALIDATION_FAILED",
        issues: ["文字框边界：第 2 个 text 内容高度超过 data-h"],
        svgPreview: rejectedSvg,
        attemptCount: 2
      }}
      onDismiss={() => undefined}
    />
  );

  assert.match(html, /新稿未采用/);
  assert.match(html, /已自动尝试 2 次/);
  assert.match(html, /文字 2 · 风险闭环/);
  assert.match(html, /问题预览/);
  assert.match(html, /失败源码/);
  assert.match(html, /当前正式版本未被覆盖/);
});

test("marks every referenced text node in the rejected SVG", () => {
  const highlighted = highlightRejectedSvg(rejectedSvg, [
    "文字框边界：第 2 个 text 内容高度超过 data-h"
  ]);

  assert.doesNotMatch(
    highlighted.match(/<text\b[^>]*>页面标题<\/text>/)?.[0] ?? "",
    /data-quality-issue/
  );
  assert.match(
    highlighted.match(/<text\b[^>]*>风险闭环<\/text>/)?.[0] ?? "",
    /data-quality-issue="true"/
  );
});
