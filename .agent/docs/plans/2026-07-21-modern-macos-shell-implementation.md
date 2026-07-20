# 现代 macOS 深色壳层实施计划

**目标**：把现有聚合首页与平台壳层改造成高保真、深色、可响应且所有点击都有真实行为的现代 macOS 桌面。

**架构**：将纯命令映射、桌面偏好、绘图历史访问从大型组件中提取为小型可测试模块；AppShell 负责全局菜单、系统面板和 Dock，HomePage 负责壁纸、小组件和桌面图标。模块专属操作通过路由或一个有类型的壳层命令事件桥接到现有 ChatPanel，不复制绘图引擎逻辑。

**技术栈**：React 19、TypeScript 5.9、React Router 6、Zustand 5、Tailwind CSS 4、Node 原生测试、Playwright CLI。

---

## 文件结构映射

### 新增

- frontend/src/components/shell/shellModel.ts：页面上下文、菜单定义、PPT 项目路由解析和纯命令映射。
- frontend/src/components/shell/shellModel.test.ts：菜单映射、路由解析和禁用条件测试。
- frontend/src/components/shell/shellEvents.ts：思维导图模块命令事件的类型和发送函数。
- frontend/src/store/desktopStore.ts：菜单、窗口、桌面偏好和本地持久化。
- frontend/src/store/desktopStore.test.ts：偏好反序列化与默认值测试。
- frontend/src/lib/diagramHistory.ts：绘图与会话历史 DTO、列表请求和错误处理。
- frontend/src/lib/diagramHistory.test.ts：真实请求路径、查询参数、返回值和失败路径测试。
- frontend/src/components/shell/MacMenu.tsx：可访问的菜单按钮与菜单项。
- frontend/src/components/shell/MacWindow.tsx：登录、关于、帮助和最近项目共用的窗口容器。
- frontend/src/components/shell/SystemPanels.tsx：网络状态、控制中心和日期面板。
- frontend/src/components/shell/Spotlight.tsx：应用、PPT 项目和绘图历史全局搜索。
- frontend/src/components/shell/RecentProjectsWindow.tsx：真实 PPT 与绘图历史浏览窗口。

### 修改

- frontend/src/components/shell/AppShell.tsx：组装动态菜单、系统区、全局窗口和 Dock。
- frontend/src/components/chat/ChatPanel.tsx：复用共享历史 API，并监听有类型的壳层命令。
- frontend/src/components/macos/MacOSIcons.tsx：精修应用图标的圆角、高光、描边和阴影。
- frontend/src/pages/HomePage.tsx：替换壁纸，收紧小组件，连接桌面偏好与最近项目窗口。
- frontend/src/index.css：增加统一 macOS tokens、壁纸、菜单、窗口、Dock 和响应式样式。
- frontend/src/ppt/pages/HomePage.tsx：为菜单导航提供稳定的新建区与最近项目锚点。
- frontend/package.json：仅增加可重复执行的 shell 单元测试脚本，不引入新依赖。

---

## 任务 1：建立可测试的壳层命令模型

**文件**：

- 创建：frontend/src/components/shell/shellModel.ts
- 创建：frontend/src/components/shell/shellModel.test.ts
- 修改：frontend/package.json

- [ ] **步骤 1：写失败测试**

测试桌面、思维导图、PPT 首页和 PPT 项目页四种上下文。测试应明确：

    import assert from "node:assert/strict";
    import test from "node:test";
    import { buildShellMenus, parseShellContext } from "./shellModel.js";

    test("桌面菜单只包含可执行命令", () => {
      const context = parseShellContext("/");
      const menus = buildShellMenus(context, { authenticated: false, fullscreen: false });
      assert.deepEqual(menus.map((menu) => menu.label), [
        "DeepDiagram Pro", "文件", "显示", "前往", "帮助"
      ]);
      assert.ok(menus.flatMap((menu) => menu.items).every((item) => item.action || item.separator));
    });

    test("PPT 项目路由生成四个真实工作区入口", () => {
      const menus = buildShellMenus(
        parseShellContext("/ppt/p/project-1/studio"),
        { authenticated: true, fullscreen: false }
      );
      const projectMenu = menus.find((menu) => menu.label === "项目");
      assert.deepEqual(
        projectMenu?.items.filter((item) => item.action).map((item) => item.href),
        [
          "/ppt/p/project-1/intent",
          "/ppt/p/project-1/structure",
          "/ppt/p/project-1/studio",
          "/ppt/p/project-1/exports"
        ]
      );
    });

- [ ] **步骤 2：运行测试并确认失败**

运行：

    cd frontend
    node --experimental-strip-types --test src/components/shell/shellModel.test.ts

预期：失败，提示 shellModel 模块不存在。

- [ ] **步骤 3：实现最小命令模型**

实现以下公开契约：

    export type ShellArea = "desktop" | "diagram" | "ppt-home" | "ppt-project";

    export interface ShellContext {
      area: ShellArea;
      appName: string;
      projectId: string | null;
      pathname: string;
    }

    export interface ShellMenuItem {
      id: string;
      label: string;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      href?: string;
      action?: ShellAction;
      separator?: boolean;
    }

    export function parseShellContext(pathname: string): ShellContext;
    export function buildShellMenus(
      context: ShellContext,
      state: { authenticated: boolean; fullscreen: boolean }
    ): ShellMenu[];

所有项目级 PPT 地址只从 parseShellContext 返回的 projectId 生成；缺少项目 ID 时不生成伪入口。

- [ ] **步骤 4：运行测试并确认通过**

运行同一步骤 2。预期：全部通过。

- [ ] **步骤 5：增加统一测试脚本**

在 frontend/package.json 增加：

    "test:shell": "node --experimental-strip-types --test src/components/shell/*.test.ts src/lib/diagramHistory.test.ts src/store/desktopStore.test.ts"

- [ ] **步骤 6：提交**

    git add frontend/package.json frontend/src/components/shell/shellModel.ts frontend/src/components/shell/shellModel.test.ts
    git commit -m "test: define macOS shell command model"

---

## 任务 2：桌面 UI 状态与偏好持久化

**文件**：

- 创建：frontend/src/store/desktopStore.ts
- 创建：frontend/src/store/desktopStore.test.ts

- [ ] **步骤 1：写失败测试**

覆盖空存储、损坏 JSON、部分字段和完整字段：

    test("损坏偏好回退为安全默认值", () => {
      assert.deepEqual(parseDesktopPreferences("{broken"), DEFAULT_DESKTOP_PREFERENCES);
    });

    test("只接受布尔类型的已知字段", () => {
      assert.deepEqual(
        parseDesktopPreferences(JSON.stringify({
          widgetsVisible: false,
          desktopIconsVisible: "no",
          dockAutoHide: true
        })),
        {
          widgetsVisible: false,
          desktopIconsVisible: true,
          dockAutoHide: true
        }
      );
    });

- [ ] **步骤 2：运行测试并确认失败**

    cd frontend
    node --experimental-strip-types --test src/store/desktopStore.test.ts

预期：模块不存在。

- [ ] **步骤 3：实现 Zustand store 与纯解析器**

公开状态：

    type ShellPanel =
      | "network"
      | "control-center"
      | "calendar"
      | "user"
      | "spotlight"
      | null;

    type ShellWindow = "login" | "recents" | "about" | "help" | null;

    interface DesktopPreferences {
      widgetsVisible: boolean;
      desktopIconsVisible: boolean;
      dockAutoHide: boolean;
    }

store 负责 openPanel、openWindow、closeOverlay、toggleWidgets、toggleIcons、toggleDockAutoHide 和 selectedDesktopIcon。只有 DesktopPreferences 写入 localStorage。

- [ ] **步骤 4：运行测试并确认通过**

运行步骤 2，并执行 npm run build 验证 Zustand 类型。

- [ ] **步骤 5：提交**

    git add frontend/src/store/desktopStore.ts frontend/src/store/desktopStore.test.ts
    git commit -m "feat: add persistent desktop shell state"

---

## 任务 3：提取真实绘图历史 API 与壳层事件

**文件**：

- 创建：frontend/src/lib/diagramHistory.ts
- 创建：frontend/src/lib/diagramHistory.test.ts
- 创建：frontend/src/components/shell/shellEvents.ts
- 修改：frontend/src/components/chat/ChatPanel.tsx

- [ ] **步骤 1：写历史 API 失败测试**

使用替换 globalThis.fetch 的方式验证：

    test("绘图历史请求包含代码和搜索参数", async () => {
      let requested = "";
      globalThis.fetch = async (input) => {
        requested = String(input);
        return new Response(JSON.stringify({ diagrams: [] }), { status: 200 });
      };
      await listDiagramHistory("流程");
      assert.match(requested, /include_code=true/);
      assert.match(requested, /query=/);
    });

    test("非 2xx 响应抛出可展示错误", async () => {
      globalThis.fetch = async () => new Response("无权限", { status: 403 });
      await assert.rejects(() => listConversationHistory(), /无权限/);
    });

- [ ] **步骤 2：运行测试并确认失败**

    cd frontend
    node --experimental-strip-types --test src/lib/diagramHistory.test.ts

预期：模块不存在。

- [ ] **步骤 3：实现共享 DTO 和请求函数**

公开：

    export interface DiagramHistoryItem { ... }
    export interface ConversationHistoryItem { ... }
    export async function listDiagramHistory(query?: string): Promise<DiagramHistoryItem[]>;
    export async function listConversationHistory(query?: string): Promise<ConversationHistoryItem[]>;

请求继续使用 API_BASE 与 enterpriseHeaders，不改变后端契约。

- [ ] **步骤 4：运行测试并确认通过**

运行步骤 2。预期：成功与错误用例全部通过。

- [ ] **步骤 5：增加有类型的模块命令**

shellEvents.ts 只允许：

    export type DiagramShellCommand =
      | "new-conversation"
      | "open-history"
      | "focus-chat"
      | "focus-canvas";

    export function dispatchDiagramShellCommand(command: DiagramShellCommand): void;

使用 CustomEvent，事件名固定为 deepdiagram:diagram-command。

- [ ] **步骤 6：让 ChatPanel 复用共享请求并监听命令**

- 删除 ChatPanel 内重复的历史 DTO 声明。
- loadDiagramHistory 和 loadConversationHistory 改用共享函数。
- useEffect 监听壳层命令；new-conversation 调用现有 startNewConversation，open-history 调用现有 openDiagramHistory。
- 清理时移除监听，避免 StrictMode 重复响应。

- [ ] **步骤 7：回归历史功能**

运行：

    cd frontend
    npm run build

预期：无类型错误，历史面板原有搜索和恢复行为不变。

- [ ] **步骤 8：提交**

    git add frontend/src/lib/diagramHistory.ts frontend/src/lib/diagramHistory.test.ts frontend/src/components/shell/shellEvents.ts frontend/src/components/chat/ChatPanel.tsx
    git commit -m "refactor: share diagram history with platform shell"

---

## 任务 4：实现统一菜单与窗口原语

**文件**：

- 创建：frontend/src/components/shell/MacMenu.tsx
- 创建：frontend/src/components/shell/MacWindow.tsx
- 创建：frontend/src/components/shell/SystemPanels.tsx
- 修改：frontend/src/index.css

- [ ] **步骤 1：写静态渲染失败测试**

在 shellModel.test.ts 旁新增对菜单结构的静态渲染测试，验证：

- 菜单按钮有 aria-haspopup=menu。
- 菜单容器有 role=menu。
- 禁用项目使用 aria-disabled=true。
- 分隔项不渲染为按钮。
- MacWindow 红色关闭点有“关闭”标签，不支持的黄绿控制点不可点击。

- [ ] **步骤 2：运行测试并确认失败**

    cd frontend
    node --experimental-strip-types --test src/components/shell/shellModel.test.ts

预期：组件模块或目标标记不存在。

- [ ] **步骤 3：实现 MacMenu**

要求：

- 支持鼠标点击、Enter、Space、ArrowDown、ArrowUp 和 Escape。
- 打开时聚焦第一个可用菜单项。
- 执行命令后关闭菜单并把焦点还给触发按钮。
- 使用 data-shell-menu 属性提供稳定视觉验证定位。

- [ ] **步骤 4：实现 MacWindow**

要求：

- role=dialog 与 aria-modal=true。
- 标题通过 aria-labelledby 关联。
- 仅红色点默认可点击；minimizable 或 resizable 明确为 true 时才启用黄绿点。
- Escape 关闭并恢复触发元素焦点。

- [ ] **步骤 5：实现网络、控制中心和日期面板**

- 网络状态监听 online 与 offline 事件。
- 控制中心开关调用 desktopStore。
- 全屏开关调用 document.documentElement.requestFullscreen 或 document.exitFullscreen，并捕获拒绝。
- 日期面板使用真实当前日期与月历计算。

- [ ] **步骤 6：加入共享样式**

在 index.css 增加 mac-shell 作用域 tokens、菜单、popover、window 和 focus ring；不影响 Excalidraw 与 PPT 自身作用域。

- [ ] **步骤 7：验证并提交**

    cd frontend
    npm run test:shell
    npm run build

预期：测试与构建通过。

    git add frontend/src/components/shell/MacMenu.tsx frontend/src/components/shell/MacWindow.tsx frontend/src/components/shell/SystemPanels.tsx frontend/src/index.css frontend/src/components/shell/shellModel.test.ts
    git commit -m "feat: add accessible macOS shell primitives"

---

## 任务 5：实现 Spotlight 与真实最近项目窗口

**文件**：

- 创建：frontend/src/components/shell/Spotlight.tsx
- 创建：frontend/src/components/shell/RecentProjectsWindow.tsx
- 修改：frontend/src/components/shell/AppShell.tsx

- [ ] **步骤 1：写搜索聚合失败测试**

在 shellModel.ts 提取纯函数 buildSpotlightResults，并测试：

    test("Spotlight 同时过滤应用、PPT 和绘图标题", () => {
      const result = buildSpotlightResults("年度", {
        projects: [{ id: "p1", name: "年度汇报", updatedAt: "..." }],
        diagrams: [{ diagram_id: "d1", title: "年度流程" }],
        authenticated: true
      });
      assert.deepEqual(result.map((item) => item.kind), ["ppt", "diagram"]);
    });

    test("访客只得到应用和登录入口", () => {
      const result = buildSpotlightResults("", {
        projects: [],
        diagrams: [],
        authenticated: false
      });
      assert.ok(result.some((item) => item.kind === "login"));
      assert.ok(result.every((item) => item.kind === "app" || item.kind === "login"));
    });

- [ ] **步骤 2：运行测试并确认失败**

运行 shellModel.test.ts，预期 buildSpotlightResults 不存在。

- [ ] **步骤 3：实现 Spotlight**

- Meta/Ctrl+K 打开，Escape 关闭。
- 首次打开并行调用 api.listProjects、listDiagramHistory 和 listConversationHistory。
- 各数据源独立保存 loading 与 error，不让一处失败阻塞应用入口。
- ArrowUp、ArrowDown、Enter 操作当前结果。
- PPT 结果导航到 /ppt/p/:id/studio。
- 绘图结果导航到 /diagram 并复用 ChatPanel 的恢复能力；若直接恢复所需 DTO 不完整，则打开绘图历史面板并带入搜索词，而不伪造恢复成功。

- [ ] **步骤 4：实现 RecentProjectsWindow**

- 标签为“PPT 项目”和“绘图历史”。
- PPT 使用 api.listProjects，条目导航到实际 studio。
- 绘图使用共享历史 API，条目可通过共享恢复函数恢复；没有代码快照时进入 /diagram 并打开相应会话历史。
- 加载、空、失败和重试状态分别呈现。

- [ ] **步骤 5：接入 AppShell**

- AppShell 只协调窗口打开状态与数据，不复制搜索过滤逻辑。
- 登录窗口迁入 MacWindow 外壳，但继续复用 LoginScreen。
- 添加关于与帮助窗口的真实内容。

- [ ] **步骤 6：验证并提交**

    cd frontend
    npm run test:shell
    npm run build

    git add frontend/src/components/shell/Spotlight.tsx frontend/src/components/shell/RecentProjectsWindow.tsx frontend/src/components/shell/AppShell.tsx frontend/src/components/shell/shellModel.ts frontend/src/components/shell/shellModel.test.ts
    git commit -m "feat: connect Spotlight and recent work to real data"

---

## 任务 6：重做深色桌面、小组件和图标

**文件**：

- 修改：frontend/src/pages/HomePage.tsx
- 修改：frontend/src/components/macos/MacOSIcons.tsx
- 修改：frontend/src/index.css

- [ ] **步骤 1：写日期与布局纯函数失败测试**

从 HomePage 提取到 shellModel.ts：

    export function buildCalendarCells(date: Date): Array<number | null>;
    export function desktopLayoutForWidth(width: number): "desktop" | "compact" | "launchpad";

测试月初星期偏移、闰年二月、1180 和 768 两个边界。

- [ ] **步骤 2：运行测试并确认失败**

运行 shellModel.test.ts，预期两个函数不存在。

- [ ] **步骤 3：实现深色壁纸**

- 删除白昼或夜晚双分支和雪山湖面 SVG。
- 使用一个固定深色 SVG：石墨黑背景、深海蓝层、两条青蓝软光带、轻颗粒和暗角。
- 所有 SVG id 加固定 mac-shell 前缀，避免页面内渐变 id 冲突。

- [ ] **步骤 4：收紧小组件**

- 桌面尺寸时钟与日历为 148px，账户组件为 312px。
- 统一薄玻璃、细描边和轻阴影。
- 读取 desktopStore.widgetsVisible。
- 登录和已登录状态继续调用 usePlatformAuth。

- [ ] **步骤 5：精修桌面图标**

- 视觉尺寸 56px，点击区不小于 76px × 84px。
- 单击选择、双击或 Enter 打开。
- 最近项目调用 desktopStore.openWindow("recents")。
- 读取 desktopStore.desktopIconsVisible。
- 使用 focus-visible 和语义按钮，避免 role=button div。

- [ ] **步骤 6：精修 SVG 应用图标**

- 统一 13px 至 14px 圆角、高光高度和外轮廓。
- Finder 分界线、思维导图节点和 PPT 图表在 46px 至 56px 尺寸仍清晰。
- SVG 渐变 id 使用 useId 或图标专属前缀，避免重复实例冲突。

- [ ] **步骤 7：实现 Launchpad 响应式首页**

- 1180px 以上完整桌面。
- 768px 至 1179px 紧凑小组件与菜单。
- 768px 以下隐藏桌面定位布局，改为居中应用网格和账户入口。

- [ ] **步骤 8：构建并提交**

    cd frontend
    npm run test:shell
    npm run build

    git add frontend/src/pages/HomePage.tsx frontend/src/components/macos/MacOSIcons.tsx frontend/src/index.css frontend/src/components/shell/shellModel.ts frontend/src/components/shell/shellModel.test.ts
    git commit -m "feat: redesign the desktop in modern macOS dark style"

---

## 任务 7：动态应用菜单、控制区与 Dock

**文件**：

- 修改：frontend/src/components/shell/AppShell.tsx
- 修改：frontend/src/index.css
- 修改：frontend/src/ppt/pages/HomePage.tsx

- [ ] **步骤 1：写 Dock 缩放失败测试**

在 shellModel.ts 增加纯函数：

    export function dockScaleForDistance(distance: number): number;

断言：

- 距离 0 返回 1.25。
- 距离 110 及以上返回 1。
- 任意输入都在 1 到 1.25 之间。

- [ ] **步骤 2：运行测试并确认失败**

运行 shellModel.test.ts，预期 dockScaleForDistance 不存在。

- [ ] **步骤 3：重写 Dock**

- 基础图标 46px，最大放大 1.25，影响半径 110px。
- 最大向上位移 8px。
- 首页默认显示；模块内按 desktopStore.dockAutoHide 控制。
- 自动隐藏时鼠标进入底部 10px 热区显示，离开 Dock 后延迟收起。
- 当前路由显示 4px 指示点。
- tooltip 与视觉变换分离，避免放大时提示位置跳动。

- [ ] **步骤 4：组装动态菜单与命令执行器**

- 使用 parseShellContext 和 buildShellMenus。
- href 命令通过 navigate 执行。
- diagram 命令通过 shellEvents 执行。
- 认证、桌面偏好、全屏和窗口命令调用各自真实 store 或 API。
- 没有 action 的项目不渲染为可点击元素。

- [ ] **步骤 5：稳定 PPT 页面锚点**

- 新建区增加 id=ppt-create-project 与可聚焦容器。
- 最近项目保留 id=recent-projects。
- 从菜单导航到 hash 后，页面 effect 将目标滚入视图并聚焦。

- [ ] **步骤 6：验证并提交**

    cd frontend
    npm run test:shell
    npm run build
    npm run lint

预期：测试和构建通过；lint 不新增错误。

    git add frontend/src/components/shell/AppShell.tsx frontend/src/index.css frontend/src/ppt/pages/HomePage.tsx frontend/src/components/shell/shellModel.ts frontend/src/components/shell/shellModel.test.ts
    git commit -m "feat: make macOS menus and Dock fully functional"

---

## 任务 8：真实浏览器视觉与交互验收

**文件**：

- 修改：以上实现文件中视觉验收发现问题的最小集合
- 产物：output/playwright 下的截图与可选 trace，不纳入提交

- [ ] **步骤 1：启动前置服务**

优先使用已有开发命令：

    npm run dev:frontend

若 5173 已被占用，先确认现有服务是否为本项目，不擅自结束无关进程。

- [ ] **步骤 2：检查 Playwright CLI**

已确认 npx 可用。设置：

    export PWCLI=/Users/zora/.agents/skills/playwright/scripts/playwright_cli.sh

- [ ] **步骤 3：验证 1440×900 桌面**

- 打开 http://127.0.0.1:5173。
- snapshot 后验证菜单、三个桌面图标、两块小组件和 Dock。
- 截图默认桌面。
- 悬停 Dock 中央和边缘图标，截图确认无严重覆盖。
- 依次打开文件菜单、控制中心、日期和 Spotlight，每次重新 snapshot。
- 执行打开思维导图、打开 PPT、返回桌面。

- [ ] **步骤 4：验证 1024×768 紧凑布局**

- 调整视口并截图。
- 确认菜单文字不碰撞右侧系统区。
- 确认小组件、桌面图标与 Dock 不重叠。

- [ ] **步骤 5：验证手机 Launchpad**

- 使用一个 390×844 视口。
- 确认应用入口可点击，系统栏不溢出，Dock 不覆盖模块内容。

- [ ] **步骤 6：验证真实错误状态**

- 在 PPT 后端不可用时，最近项目和 Spotlight 的 PPT 分组显示错误和重试。
- 应用入口仍可用。
- 绘图历史后端不可用时不影响 PPT 项目与应用入口。

- [ ] **步骤 7：修复视觉问题并重新截图**

每发现一个问题，先修复，再重新执行对应视口截图；不交付带已知重叠或无效控件的版本。

- [ ] **步骤 8：最终自动验证**

    cd frontend
    npm run test:shell
    npm run build
    npm run lint

记录测试数量、构建结果和 lint 是否存在项目原有问题。

- [ ] **步骤 9：最终提交**

    git add 仅本次壳层改造涉及的源文件和测试
    git commit -m "fix: polish responsive macOS shell interactions"

---

## 完成定义

- 设计规范中的所有可点击控件都能产生真实、可观察结果。
- 无伪电池、伪蓝牙、伪音量或空菜单按钮。
- 菜单随桌面、思维导图、PPT 首页和 PPT 项目页变化。
- Spotlight 与最近项目使用真实 API，并能局部处理失败。
- Dock 基础 46px、最大 1.25 倍，宽屏与紧凑视口均无严重重叠。
- 1440×900、1024×768、390×844 三种视口完成视觉验收。
- 新增纯逻辑覆盖率不低于 80%，全部 shell 测试、生产构建通过，lint 不新增错误。
