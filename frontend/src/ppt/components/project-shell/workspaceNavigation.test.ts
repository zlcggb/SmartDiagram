import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { workspaceNavTarget } from "./workspaceNavigation";

test("项目导航始终保留 /ppt 挂载点和当前项目 ID", () => {
  assert.equal(workspaceNavTarget("project-123", "intent"), "/ppt/p/project-123/intent");
  assert.equal(workspaceNavTarget("project-123", "structure"), "/ppt/p/project-123/structure");
  assert.equal(workspaceNavTarget("project-123", "studio"), "/ppt/p/project-123/studio");
  assert.equal(workspaceNavTarget("project-123", "director"), "/ppt/p/project-123/director");
  assert.equal(workspaceNavTarget(undefined, "director"), "/ppt");
});

test("项目导航组件使用统一路径生成器，不再跳出项目路由", () => {
  const source = fs.readFileSync(new URL("./WorkspaceNav.tsx", import.meta.url), "utf8");

  assert.match(source, /to=\{workspaceNavTarget\(projectId, item\.path\)\}/);
  assert.doesNotMatch(source, /`\.\.\/\$\{item\.path\}`/);
});
