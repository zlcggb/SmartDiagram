import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStudioPortal } from "./WorkspaceStudioPortal.js";

test("顶部宿主尚未挂载时仍在工作区显示完整工具栏", () => {
  const html = renderToStaticMarkup(
    <WorkspaceStudioPortal>
      <button type="button">生成本页</button>
    </WorkspaceStudioPortal>
  );

  assert.match(html, /studio-command-bar-fallback/);
  assert.match(html, /生成本页/);
});
