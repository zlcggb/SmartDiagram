import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CircleUserRound,
  Command,
  HelpCircle,
  LogOut,
  Search,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  type LucideIcon
} from "lucide-react";
import LoginScreen from "../auth/LoginScreen";
import { FinderIcon, MODULE_ICONS } from "../macos/MacOSIcons";
import { moduleRegistry } from "../../modules/registry";
import { usePlatformAuth } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import { useDesktopStore } from "../../store/desktopStore";
import { dispatchDiagramShellCommand, type DiagramShellCommand } from "./shellEvents";
import {
  buildShellMenus,
  parseShellContext,
  type ShellMenuItem
} from "./shellModel";
import { MacMenuBar } from "./MacMenuBar";
import { MacWindow } from "./MacWindow";
import {
  CalendarPanel,
  ControlCenterPanel,
  NetworkPanel,
  useOnlineStatus
} from "./SystemPanels";
import { Spotlight } from "./Spotlight";
import { RecentProjectsWindow } from "./RecentProjectsWindow";
import "./macShell.css";

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatMenuBarTime(now: Date) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours();
  const period = hours < 12 ? "上午" : "下午";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${month}月${day}日 ${WEEKDAY_NAMES[now.getDay()]} ${period}${hour12}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function MenuBarClock({ active, onClick }: { active: boolean; onClick: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <button
      type="button"
      className="mac-menu-clock"
      data-active={active || undefined}
      aria-expanded={active}
      aria-label="打开日历"
      onClick={onClick}
    >
      {formatMenuBarTime(now)}
    </button>
  );
}

function DeepDiagramMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="deepdiagram-mark-gradient" x1="2" y1="2" x2="22" y2="22">
          <stop stopColor="#7b80ff" />
          <stop offset="1" stopColor="#30bdeb" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#deepdiagram-mark-gradient)" />
      <path d="M7.2 12 12 7.2 16.8 12 12 16.8 7.2 12Z" fill="none" stroke="white" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="1.8" fill="white" />
    </svg>
  );
}

function UserPanel({ onClose }: { onClose: () => void }) {
  const session = usePlatformAuth((state) => state.session);
  const logout = usePlatformAuth((state) => state.logout);
  const openLogin = usePlatformAuth((state) => state.openLogin);

  if (!session) {
    return (
      <section className="mac-system-panel mac-user-panel">
        <div className="mac-user-panel-empty">
          <span><CircleUserRound /></span>
          <strong>访客模式</strong>
          <small>登录后同步项目、绘图和对话记录。</small>
          <button
            type="button"
            className="mac-primary-button"
            onClick={() => {
              onClose();
              openLogin();
            }}
          >
            登录账户
          </button>
        </div>
      </section>
    );
  }

  const displayName = session.user.display_name?.trim() || session.user.email;
  return (
    <section className="mac-system-panel mac-user-panel">
      <div className="mac-user-profile">
        <span>{displayName.charAt(0).toUpperCase()}</span>
        <div>
          <strong>{displayName}</strong>
          <small>{session.user.email}</small>
        </div>
      </div>
      <div className="mac-user-actions">
        <button type="button" onClick={() => { onClose(); logout(); }}>
          <LogOut />
          退出登录
        </button>
      </div>
    </section>
  );
}

interface DockItem {
  key: string;
  path: string;
  label: string;
  artwork: ComponentType<{ size?: number }> | null;
  icon: LucideIcon | null;
  tileBackground: string;
}

const DOCK_RANGE_PX = 132;
const DOCK_MAX_SCALE = 1.56;

function Dock({ alwaysVisible }: { alwaysVisible: boolean }) {
  const location = useLocation();
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [peekVisible, setPeekVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const iconRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (alwaysVisible) return;
    const handleMouseMove = (event: MouseEvent) => setPeekVisible(event.clientY > window.innerHeight - 14);
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [alwaysVisible]);

  const items: DockItem[] = [
    {
      key: "home",
      path: "/",
      label: "DeepDiagram 桌面",
      artwork: FinderIcon,
      icon: null,
      tileBackground: ""
    },
    ...moduleRegistry.map((module) => {
      const artwork = MODULE_ICONS[module.path] ?? null;
      return {
        key: module.path,
        path: module.path,
        label: module.navLabel,
        artwork,
        icon: artwork ? null : module.icon,
        tileBackground: `linear-gradient(145deg, ${module.accent.gradientFrom}, ${module.accent.gradientTo})`
      };
    })
  ];

  const scaleFor = (key: string) => {
    if (reduceMotion || mouseX === null) return 1;
    const element = iconRefs.current[key];
    if (!element) return 1;
    const dockLeft = (element.offsetParent as HTMLElement | null)?.getBoundingClientRect().left ?? 0;
    const centerX = dockLeft + element.offsetLeft + element.offsetWidth / 2;
    const distance = Math.abs(mouseX - centerX);
    if (distance > DOCK_RANGE_PX) return 1;
    return 1 + Math.cos((distance / DOCK_RANGE_PX) * (Math.PI / 2)) * (DOCK_MAX_SCALE - 1);
  };

  const visible = alwaysVisible || peekVisible;
  return (
    <div className="mac-dock-stage" data-visible={visible || undefined}>
      <nav
        className="mac-dock"
        aria-label="程序坞"
        onMouseMove={(event) => setMouseX(event.clientX)}
        onMouseLeave={() => {
          setMouseX(null);
          if (!alwaysVisible) setPeekVisible(false);
        }}
      >
        {items.map((item) => {
          const active = item.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(item.path);
          const Artwork = item.artwork;
          const FallbackIcon = item.icon;
          const scale = scaleFor(item.key);
          return (
            <NavLink
              key={item.key}
              ref={(element) => { iconRefs.current[item.key] = element; }}
              to={item.path}
              className="mac-dock-item"
              data-active={active || undefined}
              aria-label={item.label}
            >
              <span className="mac-dock-tooltip" role="tooltip">{item.label}</span>
              <span
                className="mac-dock-artwork"
                style={{
                  transform: `scale(${scale}) translateY(${(scale - 1) * -15}px)`,
                  transitionDuration: mouseX === null ? "220ms" : "60ms"
                }}
              >
                {Artwork ? <Artwork size={50} /> : FallbackIcon ? (
                  <span className="mac-dock-fallback" style={{ background: item.tileBackground }}>
                    <FallbackIcon />
                  </span>
                ) : null}
              </span>
              <i className="mac-dock-indicator" aria-hidden="true" />
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function LoginWindow() {
  const loginOpen = usePlatformAuth((state) => state.loginOpen);
  const closeLogin = usePlatformAuth((state) => state.closeLogin);
  const setSession = usePlatformAuth((state) => state.setSession);
  if (!loginOpen) return null;
  return (
    <MacWindow title="登录 DeepDiagram Pro" onClose={closeLogin}>
      <div className="mac-login-content">
        <LoginScreen displayMode="modal" onLogin={setSession} onClose={closeLogin} />
      </div>
    </MacWindow>
  );
}

function AboutWindow({ onClose }: { onClose: () => void }) {
  return (
    <MacWindow title="关于 DeepDiagram Pro" onClose={onClose}>
      <div className="mac-about-window">
        <DeepDiagramMark size={76} />
        <h3>DeepDiagram Pro</h3>
        <p>一个把思维导图、AI 绘图与演示文稿制作汇聚在同一工作空间的创作平台。</p>
        <small>现代 macOS Web Shell · 2026</small>
        <div>
          <NavLink to="/diagram" onClick={onClose}>打开思维导图</NavLink>
          <NavLink to="/ppt" onClick={onClose}>打开 PPT 制作</NavLink>
        </div>
      </div>
    </MacWindow>
  );
}

function ShortcutRow({ keys, children }: { keys: string; children: ReactNode }) {
  return <div className="mac-shortcut-row"><span>{children}</span><kbd>{keys}</kbd></div>;
}

function HelpWindow({ area, onClose }: { area: ReturnType<typeof parseShellContext>["area"]; onClose: () => void }) {
  return (
    <MacWindow title="DeepDiagram 帮助" onClose={onClose}>
      <div className="mac-help-window">
        <div className="mac-help-heading">
          <span><HelpCircle /></span>
          <div><h3>键盘操作</h3><p>菜单栏、Dock 和搜索都连接到真实页面功能。</p></div>
        </div>
        <div className="mac-shortcut-list">
          <ShortcutRow keys="⌘ K">搜索应用与历史</ShortcutRow>
          <ShortcutRow keys="⌘ 1">打开思维导图</ShortcutRow>
          <ShortcutRow keys="⌘ 2">打开 PPT 制作</ShortcutRow>
          {area === "diagram" ? <ShortcutRow keys="⌘ N">新建绘图会话</ShortcutRow> : null}
          {area === "diagram" ? <ShortcutRow keys="⌘ O">打开绘图历史</ShortcutRow> : null}
          <ShortcutRow keys="⌃ ⌘ F">切换全屏</ShortcutRow>
          <ShortcutRow keys="Esc">关闭菜单或浮层</ShortcutRow>
        </div>
      </div>
    </MacWindow>
  );
}

const EDIT_COMMANDS: Partial<Record<NonNullable<ShellMenuItem["action"]>, string>> = {
  "edit-undo": "undo",
  "edit-redo": "redo",
  "edit-cut": "cut",
  "edit-copy": "copy",
  "edit-paste": "paste",
  "edit-select-all": "selectAll"
};

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const bootstrapAuth = usePlatformAuth((state) => state.bootstrapAuth);
  const logout = usePlatformAuth((state) => state.logout);
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const activePanel = useDesktopStore((state) => state.activePanel);
  const activeWindow = useDesktopStore((state) => state.activeWindow);
  const widgetsVisible = useDesktopStore((state) => state.widgetsVisible);
  const desktopIconsVisible = useDesktopStore((state) => state.desktopIconsVisible);
  const dockAutoHide = useDesktopStore((state) => state.dockAutoHide);
  const openPanel = useDesktopStore((state) => state.openPanel);
  const openWindow = useDesktopStore((state) => state.openWindow);
  const closeOverlay = useDesktopStore((state) => state.closeOverlay);
  const toggleWidgets = useDesktopStore((state) => state.toggleWidgets);
  const toggleDesktopIcons = useDesktopStore((state) => state.toggleDesktopIcons);
  const canvasMode = useChatStore((state) => state.canvasMode);
  const setCanvasMode = useChatStore((state) => state.setCanvasMode);
  const online = useOnlineStatus();
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [notice, setNotice] = useState("");

  const context = useMemo(() => parseShellContext(location.pathname), [location.pathname]);
  const menus = useMemo(() => buildShellMenus(context, {
    authenticated: Boolean(session),
    fullscreen,
    widgetsVisible,
    desktopIconsVisible,
    canvasMode
  }), [canvasMode, context, desktopIconsVisible, fullscreen, session, widgetsVisible]);

  useEffect(() => { void bootstrapAuth(); }, [bootstrapAuth]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => { closeOverlay(); }, [closeOverlay, location.pathname]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "浏览器拒绝切换全屏");
    }
  }, []);

  const runDiagramCommand = useCallback((command: DiagramShellCommand) => {
    if (location.pathname.startsWith("/diagram")) {
      dispatchDiagramShellCommand(command);
      return;
    }
    navigate("/diagram");
    window.setTimeout(() => dispatchDiagramShellCommand(command), 80);
  }, [location.pathname, navigate]);

  const navigateAndReveal = useCallback((href: string) => {
    navigate(href);
    const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    if (!hash) return;
    window.setTimeout(() => {
      const target = document.getElementById(hash);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }, 120);
  }, [navigate]);

  const handleMenuAction = useCallback((item: ShellMenuItem) => {
    if (!item.action || item.disabled) return;
    const editCommand = EDIT_COMMANDS[item.action];
    if (editCommand) {
      const supported = typeof document.queryCommandSupported !== "function" || document.queryCommandSupported(editCommand);
      if (!supported || !document.execCommand(editCommand)) setNotice("当前焦点不支持“" + item.label + "”");
      return;
    }
    switch (item.action) {
      case "navigate": if (item.href) navigate(item.href); break;
      case "open-about": openWindow("about"); break;
      case "open-help": openWindow("help"); break;
      case "open-recents": openWindow("recents"); break;
      case "open-login": closeOverlay(); openLogin(); break;
      case "logout": logout(); break;
      case "toggle-widgets": toggleWidgets(); break;
      case "toggle-desktop-icons": toggleDesktopIcons(); break;
      case "toggle-fullscreen": void toggleFullscreen(); break;
      case "diagram-new": runDiagramCommand("new-conversation"); break;
      case "diagram-history": runDiagramCommand("open-history"); break;
      case "diagram-focus-chat": runDiagramCommand("focus-chat"); break;
      case "diagram-focus-canvas": runDiagramCommand("focus-canvas"); break;
      case "diagram-theme": setCanvasMode(canvasMode === "dark" ? "light" : "dark"); break;
      case "ppt-new": navigateAndReveal(item.href || "/ppt#ppt-create-project"); break;
      case "ppt-projects": navigateAndReveal(item.href || "/ppt#recent-projects"); break;
    }
  }, [canvasMode, closeOverlay, logout, navigate, navigateAndReveal, openLogin, openWindow, runDiagramCommand, setCanvasMode, toggleDesktopIcons, toggleFullscreen, toggleWidgets]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.matches("input, textarea, [contenteditable='true']");
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        openPanel("spotlight");
        return;
      }
      if (editable) return;
      if (event.metaKey && key === "1") { event.preventDefault(); navigate("/diagram"); }
      else if (event.metaKey && key === "2") { event.preventDefault(); navigate("/ppt"); }
      else if (event.metaKey && key === "r" && context.area === "desktop") { event.preventDefault(); openWindow("recents"); }
      else if (event.metaKey && key === "n" && context.area === "diagram") { event.preventDefault(); runDiagramCommand("new-conversation"); }
      else if (event.metaKey && key === "o" && context.area === "diagram") { event.preventDefault(); runDiagramCommand("open-history"); }
      else if (event.metaKey && event.ctrlKey && key === "f") { event.preventDefault(); void toggleFullscreen(); }
      else if (event.key === "Escape" && (activePanel || activeWindow)) closeOverlay();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePanel, activeWindow, closeOverlay, context.area, navigate, openPanel, openWindow, runDiagramCommand, toggleFullscreen]);

  const userLabel = session?.user.display_name?.trim() || session?.user.email || "登录";
  const showDock = location.pathname === "/" || !dockAutoHide;

  return (
    <div className="mac-shell mac-app-shell">
      <MacMenuBar
        menus={menus}
        onAction={handleMenuAction}
        homeControl={(
          <NavLink to="/" className="mac-brand-control" aria-label="DeepDiagram 桌面" title="DeepDiagram 桌面">
            <DeepDiagramMark />
          </NavLink>
        )}
        trailing={(
          <>
            <button
              type="button"
              className="mac-menu-status-button"
              data-active={activePanel === "network" || undefined}
              aria-label={online ? "网络已连接" : "网络已断开"}
              aria-expanded={activePanel === "network"}
              onClick={() => openPanel("network")}
            >
              {online ? <Wifi /> : <WifiOff />}
            </button>
            <button
              type="button"
              className="mac-menu-status-button"
              data-active={activePanel === "control-center" || undefined}
              aria-label="控制中心"
              aria-expanded={activePanel === "control-center"}
              onClick={() => openPanel("control-center")}
            >
              <SlidersHorizontal />
            </button>
            <button
              type="button"
              className="mac-menu-status-button"
              data-active={activePanel === "spotlight" || undefined}
              aria-label="Spotlight 搜索"
              aria-expanded={activePanel === "spotlight"}
              onClick={() => openPanel("spotlight")}
            >
              <Search />
            </button>
            <MenuBarClock active={activePanel === "calendar"} onClick={() => openPanel("calendar")} />
            <button
              type="button"
              className="mac-menu-user-button"
              data-active={activePanel === "user" || undefined}
              aria-label={session ? `账户：${userLabel}` : "登录"}
              aria-expanded={activePanel === "user"}
              onClick={() => openPanel("user")}
            >
              {session ? userLabel.charAt(0).toUpperCase() : "登录"}
            </button>
          </>
        )}
      />

      <main className="mac-app-content"><Outlet /></main>

      {activePanel && activePanel !== "spotlight" ? (
        <div className="mac-system-popover" data-panel={activePanel}>
          {activePanel === "network" ? <NetworkPanel /> : null}
          {activePanel === "control-center" ? <ControlCenterPanel onError={setNotice} /> : null}
          {activePanel === "calendar" ? <CalendarPanel /> : null}
          {activePanel === "user" ? <UserPanel onClose={closeOverlay} /> : null}
        </div>
      ) : null}

      <Dock alwaysVisible={showDock} />
      <Spotlight
        open={activePanel === "spotlight"}
        authenticated={Boolean(session)}
        onClose={closeOverlay}
        onLogin={openLogin}
      />
      <RecentProjectsWindow
        open={activeWindow === "recents"}
        authenticated={Boolean(session)}
        onClose={closeOverlay}
        onLogin={openLogin}
      />
      {activeWindow === "about" ? <AboutWindow onClose={closeOverlay} /> : null}
      {activeWindow === "help" ? <HelpWindow area={context.area} onClose={closeOverlay} /> : null}
      <LoginWindow />

      {notice ? <div className="mac-shell-notice" role="status"><Command />{notice}</div> : null}
    </div>
  );
}

export default AppShell;
