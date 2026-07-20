import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarCells,
  buildSpotlightResults,
  buildShellMenus,
  dockScaleForDistance,
  findMenuItemByPrefix,
  nextEnabledMenuIndex,
  parseShellContext,
  windowControlAvailability
} from "./shellModel.ts";

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
    "编辑",
    "显示",
    "前往",
    "窗口",
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

test("标准编辑与窗口菜单在不同模块保持稳定且都有真实命令", () => {
  for (const pathname of ["/", "/diagram", "/ppt", "/ppt/p/p-1/studio"]) {
    const menus = buildShellMenus(parseShellContext(pathname), {
      authenticated: true,
      fullscreen: false
    });
    const edit = menus.find((menu) => menu.label === "编辑");
    const windowMenu = menus.find((menu) => menu.label === "窗口");
    assert.deepEqual(edit?.items.filter((item) => !item.separator).map((item) => item.action), [
      "edit-undo",
      "edit-redo",
      "edit-cut",
      "edit-copy",
      "edit-paste",
      "edit-select-all"
    ]);
    assert.equal(windowMenu?.items.every((item) => item.separator || Boolean(item.action)), true);
  }
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

test("键盘菜单跳过分隔符与禁用项目并循环", () => {
  const items = [
    { id: "a", label: "A", action: "open-help" as const },
    { id: "separator", separator: true },
    { id: "disabled", label: "Disabled", action: "open-help" as const, disabled: true },
    { id: "b", label: "B", action: "open-help" as const }
  ];
  assert.equal(nextEnabledMenuIndex(items, 0, 1), 3);
  assert.equal(nextEnabledMenuIndex(items, 3, 1), 0);
  assert.equal(nextEnabledMenuIndex(items, 0, -1), 3);
});

test("窗口控制点只启用真实支持的能力", () => {
  assert.deepEqual(windowControlAvailability({}), {
    close: true,
    minimize: false,
    resize: false
  });
  assert.deepEqual(windowControlAvailability({ minimizable: true, resizable: true }), {
    close: true,
    minimize: true,
    resize: true
  });
});

test("真实月历保留月初空位并支持闰年", () => {
  const cells = buildCalendarCells(new Date(2024, 1, 15));
  assert.equal(cells.filter((cell) => cell === null).length, 4);
  assert.equal(cells.at(-1), 29);
});

test("Spotlight 将查询匹配到真实 PPT、绘图与对话记录", () => {
  const results = buildSpotlightResults("年度", {
    authenticated: true,
    projects: [
      {
        id: "ppt-1",
        name: "年度经营复盘",
        topic: "董事会汇报",
        updatedAt: "2026-07-21T10:00:00Z"
      }
    ],
    diagrams: [
      {
        diagram_id: "diagram-1",
        title: "年度战略地图",
        updated_at: "2026-07-21T11:00:00Z"
      }
    ],
    conversations: [
      {
        conversation_id: "conversation-1",
        title: "年度方案讨论",
        summary: "继续完善方案",
        updated_at: "2026-07-21T12:00:00Z"
      }
    ]
  });

  assert.deepEqual(results.map((result) => result.kind), [
    "conversation",
    "diagram",
    "ppt"
  ]);
  assert.equal(results[1]?.href, "/diagram?history=%E5%B9%B4%E5%BA%A6%E6%88%98%E7%95%A5%E5%9C%B0%E5%9B%BE");
  assert.equal(results[0]?.href.includes("historyMode=conversations"), true);
});

test("访客 Spotlight 只展示应用入口与登录命令", () => {
  const results = buildSpotlightResults("", {
    authenticated: false,
    projects: [{ id: "private", name: "不应泄露", updatedAt: "2026-07-21T10:00:00Z" }],
    diagrams: [{ diagram_id: "private", title: "不应泄露" }],
    conversations: [{ conversation_id: "private", title: "不应泄露" }]
  });

  assert.deepEqual(results.map((result) => result.kind), ["app", "app", "login"]);
  assert.equal(results.some((result) => result.title === "不应泄露"), false);
});

test("空查询时应用在前，最近工作按更新时间排序", () => {
  const results = buildSpotlightResults("", {
    authenticated: true,
    projects: [{ id: "ppt-1", name: "旧项目", updatedAt: "2026-07-20T10:00:00Z" }],
    diagrams: [{ diagram_id: "diagram-1", title: "新绘图", updated_at: "2026-07-21T10:00:00Z" }],
    conversations: []
  });

  assert.deepEqual(results.slice(0, 2).map((result) => result.title), ["思维导图", "PPT 制作"]);
  assert.deepEqual(results.slice(2).map((result) => result.title), ["新绘图", "旧项目"]);
});

test("Dock 缩放曲线克制、平滑并始终落在安全范围", () => {
  assert.equal(dockScaleForDistance(0), 1.25);
  assert.equal(dockScaleForDistance(110), 1);
  assert.equal(dockScaleForDistance(500), 1);
  assert.equal(dockScaleForDistance(Number.NaN), 1);
  for (const distance of [-50, 20, 55, 90, 109]) {
    const scale = dockScaleForDistance(distance);
    assert.ok(scale >= 1 && scale <= 1.25);
  }
});

test("菜单前缀检索跳过禁用项并从当前位置循环查找", () => {
  const items = [
    { id: "copy", label: "拷贝", action: "edit-copy" as const },
    { id: "disabled", label: "粘贴旧版", action: "edit-paste" as const, disabled: true },
    { id: "paste", label: "粘贴", action: "edit-paste" as const },
    { id: "select", label: "全选", action: "edit-select-all" as const }
  ];
  assert.equal(findMenuItemByPrefix(items, "粘", 0), 2);
  assert.equal(findMenuItemByPrefix(items, "拷", 2), 0);
  assert.equal(findMenuItemByPrefix(items, "不存在", 0), -1);
});
