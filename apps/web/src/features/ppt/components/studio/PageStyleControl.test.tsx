import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PageStyleChangePrompt,
  PageStyleControl
} from "./PageStyleControl.js";

test("labels the style actually applied to the selected page", () => {
  const html = renderToStaticMarkup(
    <PageStyleControl
      appliedStyle="consulting"
      configuredStyle={null}
      pendingStyle="apple-minimal"
      hasPendingChange
      projectStyle="data-story"
      busy={false}
      onChange={() => undefined}
    />
  );

  assert.match(html, /战略咨询/);
  assert.match(html, /已应用/);
  assert.match(html, /待更新/);
  assert.doesNotMatch(html, />Apple 极简<\/span><span[^>]*>已应用/);
});

test("explains a pending style change and offers both complete actions", () => {
  const html = renderToStaticMarkup(
    <PageStyleChangePrompt
      appliedStyle="consulting"
      requestedStyle="apple-minimal"
      busy={false}
      onRegenerate={() => undefined}
      onIgnore={() => undefined}
    />
  );

  assert.match(html, /当前使用“战略咨询”/);
  assert.match(html, /已选择“Apple 极简”/);
  assert.match(html, /按新风格重新生成/);
  assert.match(html, /忽略更改/);
  assert.match(html, /当前设计稿保持不变/);
});
