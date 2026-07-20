export type ShellArea = "desktop" | "diagram" | "ppt-home" | "ppt-project";

export type ShellAction =
  | "open-about"
  | "open-help"
  | "open-recents"
  | "open-login"
  | "logout"
  | "navigate"
  | "toggle-widgets"
  | "toggle-desktop-icons"
  | "toggle-fullscreen"
  | "diagram-new"
  | "diagram-history"
  | "diagram-theme"
  | "diagram-focus-chat"
  | "diagram-focus-canvas"
  | "ppt-new"
  | "ppt-projects"
  | "edit-undo"
  | "edit-redo"
  | "edit-cut"
  | "edit-copy"
  | "edit-paste"
  | "edit-select-all";

export interface ShellContext {
  area: ShellArea;
  appName: string;
  projectId: string | null;
  pathname: string;
}

export interface ShellMenuItem {
  id: string;
  label?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  href?: string;
  action?: ShellAction;
  separator?: boolean;
}

export interface ShellMenu {
  id: string;
  label: string;
  items: ShellMenuItem[];
}

export interface ShellMenuState {
  authenticated: boolean;
  fullscreen: boolean;
  widgetsVisible?: boolean;
  desktopIconsVisible?: boolean;
  canvasMode?: "light" | "dark";
}

export type SpotlightResultKind = "app" | "ppt" | "diagram" | "conversation" | "login";

export interface SpotlightResult {
  id: string;
  kind: SpotlightResultKind;
  title: string;
  subtitle: string;
  href?: string;
  updatedAt?: string;
}

export interface SpotlightSources {
  authenticated: boolean;
  projects?: Array<{
    id: string;
    name: string;
    topic?: string | null;
    updatedAt?: string;
  }>;
  diagrams?: Array<{
    diagram_id: string;
    title: string;
    updated_at?: string;
    conversation?: { summary?: string };
  }>;
  conversations?: Array<{
    conversation_id: string;
    title?: string;
    summary?: string;
    updated_at?: string;
  }>;
}

const separator = (id: string): ShellMenuItem => ({ id, separator: true });

const navigateItem = (id: string, label: string, href: string, shortcut?: string): ShellMenuItem => ({
  id,
  label,
  href,
  shortcut,
  action: "navigate"
});

function applicationMenu(context: ShellContext, state: ShellMenuState): ShellMenu {
  return {
    id: "application",
    label: context.appName,
    items: [
      {
        id: "about",
        label: "关于 " + context.appName,
        action: "open-about"
      },
      separator("application-account-separator"),
      state.authenticated
        ? { id: "auth", label: "退出登录", action: "logout" }
        : { id: "auth", label: "登录", action: "open-login" }
    ]
  };
}

function goMenu(context: ShellContext): ShellMenu {
  return {
    id: "go",
    label: "前往",
    items: [
      {
        ...navigateItem("go-desktop", "桌面", "/"),
        disabled: context.area === "desktop"
      },
      {
        ...navigateItem("go-diagram", "思维导图", "/diagram"),
        disabled: context.area === "diagram"
      },
      {
        ...navigateItem("go-ppt", "PPT 制作", "/ppt"),
        disabled: context.area === "ppt-home"
      }
    ]
  };
}

function editMenu(): ShellMenu {
  return {
    id: "edit",
    label: "编辑",
    items: [
      { id: "edit-undo", label: "撤销", shortcut: "⌘Z", action: "edit-undo" },
      { id: "edit-redo", label: "重做", shortcut: "⇧⌘Z", action: "edit-redo" },
      separator("edit-history-separator"),
      { id: "edit-cut", label: "剪切", shortcut: "⌘X", action: "edit-cut" },
      { id: "edit-copy", label: "拷贝", shortcut: "⌘C", action: "edit-copy" },
      { id: "edit-paste", label: "粘贴", shortcut: "⌘V", action: "edit-paste" },
      separator("edit-select-separator"),
      { id: "edit-select-all", label: "全选", shortcut: "⌘A", action: "edit-select-all" }
    ]
  };
}

function windowMenu(context: ShellContext): ShellMenu {
  return {
    id: "window",
    label: "窗口",
    items: [
      { id: "window-recents", label: "最近项目…", action: "open-recents" },
      separator("window-navigation-separator"),
      {
        ...navigateItem("window-desktop", "DeepDiagram 桌面", "/"),
        disabled: context.area === "desktop"
      }
    ]
  };
}

function fullscreenItem(state: ShellMenuState): ShellMenuItem {
  return {
    id: "fullscreen",
    label: state.fullscreen ? "退出全屏" : "进入全屏",
    checked: state.fullscreen,
    shortcut: "⌃⌘F",
    action: "toggle-fullscreen"
  };
}

function helpMenu(label: string): ShellMenu {
  return {
    id: "help",
    label: "帮助",
    items: [{ id: "help-open", label, action: "open-help" }]
  };
}

function desktopMenus(context: ShellContext, state: ShellMenuState): ShellMenu[] {
  return [
    applicationMenu(context, state),
    {
      id: "file",
      label: "文件",
      items: [
        navigateItem("open-diagram", "打开思维导图", "/diagram", "⌘1"),
        navigateItem("open-ppt", "打开 PPT 制作", "/ppt", "⌘2"),
        separator("file-recents-separator"),
        { id: "open-recents", label: "最近项目", action: "open-recents", shortcut: "⌘R" }
      ]
    },
    editMenu(),
    {
      id: "view",
      label: "显示",
      items: [
        {
          id: "widgets",
          label: state.widgetsVisible === false ? "显示小组件" : "隐藏小组件",
          checked: state.widgetsVisible !== false,
          action: "toggle-widgets"
        },
        {
          id: "desktop-icons",
          label: state.desktopIconsVisible === false ? "显示桌面图标" : "隐藏桌面图标",
          checked: state.desktopIconsVisible !== false,
          action: "toggle-desktop-icons"
        },
        separator("view-fullscreen-separator"),
        fullscreenItem(state)
      ]
    },
    goMenu(context),
    windowMenu(context),
    helpMenu("键盘操作")
  ];
}

function diagramMenus(context: ShellContext, state: ShellMenuState): ShellMenu[] {
  return [
    applicationMenu(context, state),
    {
      id: "file",
      label: "文件",
      items: [
        {
          id: "diagram-new",
          label: "新建绘图会话",
          shortcut: "⌘N",
          action: "diagram-new"
        },
        {
          id: "diagram-history",
          label: "打开绘图历史",
          shortcut: "⌘O",
          action: "diagram-history"
        }
      ]
    },
    editMenu(),
    {
      id: "view",
      label: "显示",
      items: [
        {
          id: "diagram-theme",
          label: state.canvasMode === "dark" ? "使用浅色画布" : "使用深色画布",
          checked: state.canvasMode === "dark",
          action: "diagram-theme"
        },
        separator("diagram-focus-separator"),
        {
          id: "diagram-focus-chat",
          label: "聚焦对话",
          action: "diagram-focus-chat"
        },
        {
          id: "diagram-focus-canvas",
          label: "聚焦画布",
          action: "diagram-focus-canvas"
        },
        separator("diagram-fullscreen-separator"),
        fullscreenItem(state)
      ]
    },
    goMenu(context),
    windowMenu(context),
    helpMenu("绘图操作说明")
  ];
}

function pptMenus(context: ShellContext, state: ShellMenuState): ShellMenu[] {
  const menus: ShellMenu[] = [
    applicationMenu(context, state),
    {
      id: "file",
      label: "文件",
      items: [
        {
          id: "ppt-new",
          label: "新建演示项目",
          shortcut: "⌘N",
          href: "/ppt#ppt-create-project",
          action: "ppt-new"
        },
        {
          id: "ppt-projects",
          label: "我的项目",
          href: "/ppt#recent-projects",
          action: "ppt-projects"
        }
      ]
    },
    editMenu()
  ];

  if (context.area === "ppt-project" && context.projectId) {
    const root = "/ppt/p/" + encodeURIComponent(context.projectId);
    menus.push({
      id: "project",
      label: "项目",
      items: [
        navigateItem("ppt-intent", "需求", root + "/intent"),
        navigateItem("ppt-structure", "结构", root + "/structure"),
        navigateItem("ppt-studio", "设计", root + "/studio"),
        navigateItem("ppt-exports", "导出", root + "/exports")
      ]
    });
  }

  menus.push(
    {
      id: "view",
      label: "显示",
      items: [fullscreenItem(state)]
    },
    goMenu(context),
    windowMenu(context),
    helpMenu("PPT 工作流说明")
  );
  return menus;
}

export function parseShellContext(pathname: string): ShellContext {
  const normalizedPathname = pathname || "/";
  if (normalizedPathname === "/" || !normalizedPathname.startsWith("/")) {
    return {
      area: "desktop",
      appName: "DeepDiagram Pro",
      projectId: null,
      pathname: normalizedPathname
    };
  }
  if (normalizedPathname === "/diagram" || normalizedPathname.startsWith("/diagram/")) {
    return {
      area: "diagram",
      appName: "思维导图",
      projectId: null,
      pathname: normalizedPathname
    };
  }
  if (normalizedPathname === "/ppt" || normalizedPathname === "/ppt/") {
    return {
      area: "ppt-home",
      appName: "PPT 制作",
      projectId: null,
      pathname: normalizedPathname
    };
  }

  const projectMatch = normalizedPathname.match(/^\/ppt\/p\/([^/]+)(?:\/|$)/);
  if (projectMatch?.[1]) {
    let projectId = projectMatch[1];
    try {
      projectId = decodeURIComponent(projectId);
    } catch {
      // Keep the raw, still-safe route segment when decoding malformed input fails.
    }
    return {
      area: "ppt-project",
      appName: "PPT 制作",
      projectId,
      pathname: normalizedPathname
    };
  }

  return {
    area: normalizedPathname.startsWith("/ppt") ? "ppt-home" : "desktop",
    appName: normalizedPathname.startsWith("/ppt") ? "PPT 制作" : "DeepDiagram Pro",
    projectId: null,
    pathname: normalizedPathname
  };
}

export function buildShellMenus(context: ShellContext, state: ShellMenuState): ShellMenu[] {
  if (context.area === "diagram") return diagramMenus(context, state);
  if (context.area === "ppt-home" || context.area === "ppt-project") {
    return pptMenus(context, state);
  }
  return desktopMenus(context, state);
}

export function nextEnabledMenuIndex(
  items: ShellMenuItem[],
  currentIndex: number,
  direction: 1 | -1
): number {
  if (items.length === 0) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidate = (currentIndex + direction * offset + items.length) % items.length;
    const item = items[candidate];
    if (item && !item.separator && !item.disabled && item.action) return candidate;
  }
  return -1;
}

export function findMenuItemByPrefix(
  items: ShellMenuItem[],
  rawPrefix: string,
  startIndex: number
): number {
  const prefix = rawPrefix.trim().toLocaleLowerCase();
  if (!prefix || items.length === 0) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidate = (startIndex + offset + items.length) % items.length;
    const item = items[candidate];
    if (
      item &&
      !item.separator &&
      !item.disabled &&
      item.action &&
      item.label?.toLocaleLowerCase().startsWith(prefix)
    ) return candidate;
  }
  return -1;
}

export function windowControlAvailability(options: {
  minimizable?: boolean;
  resizable?: boolean;
}): { close: true; minimize: boolean; resize: boolean } {
  return {
    close: true,
    minimize: options.minimizable === true,
    resize: options.resizable === true
  };
}

export function buildCalendarCells(date: Date): Array<number | null> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= dayCount; day += 1) cells.push(day);
  return cells;
}

function includesSpotlightQuery(result: SpotlightResult, query: string): boolean {
  if (!query) return true;
  return (result.title + " " + result.subtitle).toLocaleLowerCase().includes(query);
}

function historyHref(title: string, mode?: "conversations"): string {
  const params = new URLSearchParams();
  if (mode) params.set("historyMode", mode);
  params.set("history", title);
  return "/diagram?" + params.toString();
}

export function buildSpotlightResults(
  rawQuery: string,
  sources: SpotlightSources
): SpotlightResult[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  const apps: SpotlightResult[] = [
    {
      id: "app-diagram",
      kind: "app",
      title: "思维导图",
      subtitle: "AI 对话生成、编辑与导出图表",
      href: "/diagram"
    },
    {
      id: "app-ppt",
      kind: "app",
      title: "PPT 制作",
      subtitle: "从资料到演示文稿的一体化工作台",
      href: "/ppt"
    }
  ];

  if (!sources.authenticated) {
    const guestResults = [
      ...apps,
      {
        id: "command-login",
        kind: "login" as const,
        title: "登录 DeepDiagram Pro",
        subtitle: "同步项目、绘图历史与对话记录"
      }
    ];
    return guestResults.filter((result) => includesSpotlightQuery(result, query));
  }

  const recent: SpotlightResult[] = [
    ...(sources.projects ?? []).map((project): SpotlightResult => ({
      id: "ppt-" + project.id,
      kind: "ppt",
      title: project.name,
      subtitle: project.topic?.trim() || "PPT 项目",
      href: "/ppt/p/" + encodeURIComponent(project.id) + "/studio",
      updatedAt: project.updatedAt
    })),
    ...(sources.diagrams ?? []).map((diagram): SpotlightResult => ({
      id: "diagram-" + diagram.diagram_id,
      kind: "diagram",
      title: diagram.title || "未命名绘图",
      subtitle: diagram.conversation?.summary?.trim() || "思维导图历史",
      href: historyHref(diagram.title || "未命名绘图"),
      updatedAt: diagram.updated_at
    })),
    ...(sources.conversations ?? []).map((conversation): SpotlightResult => {
      const title = conversation.title?.trim() || "未命名对话";
      return {
        id: "conversation-" + conversation.conversation_id,
        kind: "conversation",
        title,
        subtitle: conversation.summary?.trim() || "历史对话",
        href: historyHref(title, "conversations"),
        updatedAt: conversation.updated_at
      };
    })
  ].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? "") || 0;
    const rightTime = Date.parse(right.updatedAt ?? "") || 0;
    return rightTime - leftTime;
  });

  const matchingApps = apps.filter((result) => includesSpotlightQuery(result, query));
  const matchingRecent = recent.filter((result) => includesSpotlightQuery(result, query));
  return [...matchingApps, ...matchingRecent].slice(0, 12);
}

export function dockScaleForDistance(rawDistance: number): number {
  if (!Number.isFinite(rawDistance)) return 1;
  const distance = Math.abs(rawDistance);
  if (distance >= 110) return 1;
  const falloff = Math.cos((distance / 110) * (Math.PI / 2));
  return Math.min(1.25, Math.max(1, 1 + falloff * 0.25));
}
