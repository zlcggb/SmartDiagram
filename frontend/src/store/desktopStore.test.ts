import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  parseDesktopPreferences
} from "./desktopStore.ts";

test("空值与损坏偏好回退为安全默认值", () => {
  assert.deepEqual(parseDesktopPreferences(null), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(parseDesktopPreferences(""), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(parseDesktopPreferences("{broken"), DEFAULT_DESKTOP_PREFERENCES);
});

test("只接受布尔类型的已知字段", () => {
  assert.deepEqual(
    parseDesktopPreferences(JSON.stringify({
      widgetsVisible: false,
      desktopIconsVisible: "no",
      dockAutoHide: true,
      unknown: false
    })),
    {
      widgetsVisible: false,
      desktopIconsVisible: true,
      dockAutoHide: true
    }
  );
});

test("部分合法偏好与默认值合并", () => {
  assert.deepEqual(
    parseDesktopPreferences(JSON.stringify({ desktopIconsVisible: false })),
    {
      widgetsVisible: true,
      desktopIconsVisible: false,
      dockAutoHide: true
    }
  );
});

test("数组和非对象 JSON 不会污染偏好", () => {
  assert.deepEqual(parseDesktopPreferences("[]"), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(parseDesktopPreferences("true"), DEFAULT_DESKTOP_PREFERENCES);
});
