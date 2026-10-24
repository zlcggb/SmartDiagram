import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DEFAULT_MODULE_ROUTES,
  matchModulePath,
  parseDesktopPreferences,
  parseModuleRoutes,
  resolveModuleRoute
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
      dockAutoHide: false
    }
  );
});

test("数组和非对象 JSON 不会污染偏好", () => {
  assert.deepEqual(parseDesktopPreferences("[]"), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(parseDesktopPreferences("true"), DEFAULT_DESKTOP_PREFERENCES);
});

test("matchModulePath 准确识别业务模块前缀", () => {
  assert.equal(matchModulePath("/"), null);
  assert.equal(matchModulePath("/diagram"), "/diagram");
  assert.equal(matchModulePath("/diagram/sub"), "/diagram");
  assert.equal(matchModulePath("/recruit/candidates/123"), "/recruit");
  assert.equal(matchModulePath("/ppt/p/abc/studio"), "/ppt");
  assert.equal(matchModulePath("/video"), "/video");
  assert.equal(matchModulePath("/video/history"), "/video");
  assert.equal(matchModulePath("/video-extra"), null);
});

test("parseModuleRoutes 恢复各模块停留子路径并过滤非法值", () => {
  assert.deepEqual(parseModuleRoutes(null), DEFAULT_MODULE_ROUTES);
  assert.deepEqual(parseModuleRoutes("{broken"), DEFAULT_MODULE_ROUTES);
  assert.deepEqual(
    parseModuleRoutes(
      JSON.stringify({
        "/video": "/video?analysis=bb2dc8837f58467292976b7f53e65efd",
        "/ppt": "/ppt/p/proj-1/studio",
        "/recruit": "/other-app",
        "/diagram": 123
      })
    ),
    {
      "/diagram": "/diagram",
      "/recruit": "/recruit",
      "/ppt": "/ppt/p/proj-1/studio",
      "/video": "/video?analysis=bb2dc8837f58467292976b7f53e65efd"
    }
  );
});

test("resolveModuleRoute 返回已记忆的子路径或默认根路径", () => {
  const routes = {
    ...DEFAULT_MODULE_ROUTES,
    "/video": "/video?analysis=123",
    "/ppt": "/ppt/p/abc/structure"
  };
  assert.equal(resolveModuleRoute("/video", routes), "/video?analysis=123");
  assert.equal(resolveModuleRoute("/ppt", routes), "/ppt/p/abc/structure");
  assert.equal(resolveModuleRoute("/diagram", routes), "/diagram");
  assert.equal(resolveModuleRoute("/", routes), "/");
});
