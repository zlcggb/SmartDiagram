import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const exportsSpace = readFileSync(new URL("./ExportsSpace.tsx", import.meta.url), "utf8");

test("导演页提供已完成、自定义和全部页面三种范围", () => {
  assert.match(exportsSpace, /已完成设计稿/);
  assert.match(exportsSpace, /自定义范围/);
  assert.match(exportsSpace, /全部页面/);
  assert.match(exportsSpace, /当前范围/);
});

test("所有批量媒体动作都传递当前 slideIds", () => {
  assert.match(exportsSpace, /generateNarrations\([^)]*slideIds/);
  assert.match(exportsSpace, /synthesizeNarrations\([^)]*slideIds/);
  assert.match(exportsSpace, /applyNarrationStyle\([^)]*slideIds/);
  assert.match(exportsSpace, /exportVideo\([^)]*slideIds/);
  assert.match(exportsSpace, /应用到当前范围/);
});

test("导出按钮受范围设计稿完整性保护", () => {
  assert.match(exportsSpace, /scope\.exportReady/);
  assert.match(exportsSpace, /scope\.exportBlockedReason/);
});
