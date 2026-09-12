import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceFocusToggle } from "./WorkspaceFocusToggle.js";

test("普通模式提供进入沉浸模式的可访问按钮", () => {
  const html = renderToStaticMarkup(
    <WorkspaceFocusToggle active={false} onToggle={() => undefined} />
  );

  assert.match(html, /aria-label="进入沉浸模式"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /沉浸模式/);
  assert.match(html, /⌘⇧F/);
});

test("沉浸状态明确提供退出入口", () => {
  const html = renderToStaticMarkup(
    <WorkspaceFocusToggle active onToggle={() => undefined} />
  );

  assert.match(html, /aria-label="退出沉浸模式"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /退出沉浸/);
});
