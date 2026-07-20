import assert from "node:assert/strict";
import test from "node:test";
import { buildShellMenus, parseShellContext } from "./shellModel.ts";

test("识别桌面、绘图、PPT 首页和 PPT 项目上下文", () => {
  assert.deepEqual(parseShellContext("/"), {
    area: "desktop",
    appName: "DeepDiagram Pro",
    projectId: null,
    pathname: "/"
  });
  assert.equal(parseShellContext("/diagram").area, "diagram");
  assert.equal(parseShellContext("/ppt").area, "ppt-home");
  assert.deepEqual(parseShellContext("/ppt/p/project-1/studio"), {
    area: "ppt-project",
    appName: "PPT 制作",
    projectId: "project-1",
    pathname: "/ppt/p/project-1/studio"
  });
});

test("桌面菜单只包含可执行命令或分隔符", () => {
  const context = parseShellContext("/");
  const menus = buildShellMenus(context, {
    authenticated: false,
    fullscreen: false,
    widgetsVisible: true,
    desktopIconsVisible: true,
    canvasMode: "light"
  });

  assert.deepEqual(menus.map((menu) => menu.label), [
    "DeepDiagram Pro",
    "文件",
    "显示",
    "前往",
    "帮助"
  ]);
  assert.ok(
    menus
      .flatMap((menu) => menu.items)
      .every((item) => Boolean(item.action) || item.separator === true)
  );
  assert.equal(
    menus.flatMap((menu) => menu.items).find((item) => item.id === "auth")?.label,
    "登录"
  );
});

test("登录后的应用菜单提供退出登录而不是登录", () => {
  const menus = buildShellMenus(parseShellContext("/"), {
    authenticated: true,
    fullscreen: false
  });
  const authItem = menus.flatMap((menu) => menu.items).find((item) => item.id === "auth");
  assert.equal(authItem?.label, "退出登录");
  assert.equal(authItem?.action, "logout");
});

test("思维导图菜单映射到现有会话与画布能力", () => {
  const menus = buildShellMenus(parseShellContext("/diagram"), {
    authenticated: true,
    fullscreen: false,
    canvasMode: "dark"
  });
  const items = menus.flatMap((menu) => menu.items);

  assert.equal(items.find((item) => item.id === "diagram-new")?.action, "diagram-new");
  assert.equal(items.find((item) => item.id === "diagram-history")?.action, "diagram-history");
  assert.equal(items.find((item) => item.id === "diagram-theme")?.checked, true);
  assert.equal(items.find((item) => item.id === "diagram-focus-canvas")?.action, "diagram-focus-canvas");
});

test("PPT 项目路由生成四个真实工作区入口", () => {
  const menus = buildShellMenus(
    parseShellContext("/ppt/p/project-1/studio"),
    { authenticated: true, fullscreen: false }
  );
  const projectMenu = menus.find((menu) => menu.label === "项目");

  assert.deepEqual(
    projectMenu?.items.filter((item) => item.href).map((item) => item.href),
    [
      "/ppt/p/project-1/intent",
      "/ppt/p/project-1/structure",
      "/ppt/p/project-1/studio",
      "/ppt/p/project-1/exports"
    ]
  );
});

test("PPT 首页不生成缺少项目 ID 的项目菜单", () => {
  const menus = buildShellMenus(
    parseShellContext("/ppt"),
    { authenticated: false, fullscreen: false }
  );
  assert.equal(menus.some((menu) => menu.label === "项目"), false);
});
