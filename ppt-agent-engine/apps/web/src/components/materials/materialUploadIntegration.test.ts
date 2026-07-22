import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceRoot = new URL("../../", import.meta.url);

function source(path: string) {
  return readFileSync(new URL(path, sourceRoot), "utf8");
}

test("首页保留 File 并通过统一上传器在建项目后上传", () => {
  const home = source("pages/HomePage.tsx");
  assert.match(home, /MaterialUploader/);
  assert.match(home, /useMaterialUploads/);
  assert.match(home, /uploadAll/);
  assert.doesNotMatch(home, /file\.text\(\)/);
  assert.doesNotMatch(home, /TextAttachment/);
});

test("资料页不再加载 browser officeparser 或把附件拼入 textarea", () => {
  const sourceTab = source("components/intent/SourceTab.tsx");
  assert.match(sourceTab, /MaterialUploader/);
  assert.match(sourceTab, /materials/);
  assert.match(sourceTab, /hasBlockingErrors/);
  assert.doesNotMatch(sourceTab, /extractMaterialFile/);
  assert.doesNotMatch(sourceTab, /appendMaterialText/);
  assert.doesNotMatch(sourceTab, /officeparser/);
});

test("API 与 store 暴露独立材料列表和上传动作", () => {
  const api = source("lib/api.ts");
  const store = source("store/workbenchStore.ts");
  assert.match(api, /uploadMaterial/);
  assert.match(api, /listMaterials/);
  assert.match(api, /deleteMaterial/);
  assert.match(store, /materials:/);
  assert.match(store, /uploadMaterial/);
  assert.match(store, /deleteMaterial/);
});

test("资料状态轮询等待上一轮完成，不使用可能重叠的 setInterval", () => {
  const sourceTab = source("components/intent/SourceTab.tsx");
  assert.doesNotMatch(sourceTab, /setInterval/);
  assert.match(sourceTab, /setTimeout/);
  assert.match(sourceTab, /await loadMaterials/);
});

test("首页资料使用有界的单行紧凑托盘，不会把底部操作区持续往下挤", () => {
  const home = source("pages/HomePage.tsx");
  const css = source("styles.css");

  assert.ok(home.indexOf("home-material-uploader") < home.indexOf("home-composer__bar"));
  assert.match(
    css,
    /\.home-material-uploader \.material-uploader__list\s*\{[^}]*max-height:[^;}]+;[^}]*overflow-y:\s*auto/s
  );
  assert.match(
    css,
    /\.home-material-uploader \.material-upload-item\s*\{[^}]*align-items:\s*center[^}]*padding:\s*(?:[0-6](?:\.\d+)?(?:px|rem))/s
  );
  assert.match(
    css,
    /\.home-material-uploader \.material-upload-item__body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
  );
});
