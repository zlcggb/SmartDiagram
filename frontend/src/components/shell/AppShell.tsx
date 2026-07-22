import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
  type RefObject
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  CircleUserRound,
  Command,
  LogOut,
  Search,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  type LucideIcon
} from "lucide-react";
import LoginScreen from "../auth/LoginScreen";
import { ProfileWindow } from "../profile/ProfileWindow";
import { UserAvatar } from "../profile/UserAvatar";
import { FinderIcon, FolderIcon } from "../macos/MacOSIcons";
import { MODULE_ICONS } from "../macos/moduleIcons";
import { moduleRegistry } from "../../modules/registry";
import { usePlatformAuth } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import { useDesktopStore, type ShellPanel } from "../../store/desktopStore";
import { dispatchDiagramShellCommand, type DiagramShellCommand } from "./shellEvents";
import {
  DOCK_AUTO_HIDE_DELAY_MS,
  DOCK_PEEK_HEIGHT_PX,
  DOCK_REVEAL_ZONE_HEIGHT_PX,
  dockScaleForItem
} from "./dockModel";
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
  NetworkPanel
} from "./SystemPanels";
import { useOnlineStatus } from "./useOnlineStatus";
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

function DesktopMark({ size = 18 }: { size?: number }) {
  return <FinderIcon size={size} />;
}

function UserPanel({
  onClose,
  onOpenProfile,
}: {
  onClose: () => void;
  onOpenProfile: () => void;
}) {
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
      <button type="button" className="mac-user-profile" onClick={onOpenProfile}>
        <UserAvatar user={session.user} size={44} />
        <div>
          <strong>{displayName}</strong>
          <small>{session.user.email}</small>
        </div>
        <ChevronRight aria-hidden="true" />
      </button>
      <div className="mac-user-actions">
        <button type="button" data-danger onClick={() => { onClose(); logout(); }}>
          <LogOut />
          退出登录
        </button>
      </div>
    </section>
  );
}

interface DockItem {
  key: string;
  path: string | null;
  label: string;
  artwork: ComponentType<{ size?: number }> | null;
  icon: LucideIcon | null;
  tileBackground: string;
  dividerBefore?: boolean;
  onActivate?: (trigger: HTMLElement) => void;
}

function Dock({
  alwaysVisible,
  onOpenRecents
}: {
  alwaysVisible: boolean;
  onOpenRecents: (trigger: HTMLElement) => void;
}) {
  const location = useLocation();
  const activeWindow = useDesktopStore((state) => state.activeWindow);
  const [peekVisible, setPeekVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hoveredDockItem, setHoveredDockItem] = useState<string | null>(null);
  const iconRefs = useRef<Record<string, HTMLElement | null>>({});
  const hideTimerRef = useRef<number | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHide = useCallback((delay: number) => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      setPeekVisible(false);
      hideTimerRef.current = null;
    }, delay);
  }, [cancelHide]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (alwaysVisible) return;
    const handleMouseMove = (event: MouseEvent) => {
      if (event.clientY <= window.innerHeight - DOCK_REVEAL_ZONE_HEIGHT_PX) return;
      cancelHide();
      setPeekVisible(true);
      scheduleHide(DOCK_AUTO_HIDE_DELAY_MS);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelHide();
    };
  }, [alwaysVisible, cancelHide, scheduleHide]);

  useEffect(() => {
    const focusDock = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== "F3") {
        return;
      }
      event.preventDefault();
      cancelHide();
      setPeekVisible(true);
      window.requestAnimationFrame(() => {
        iconRefs.current.home?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("keydown", focusDock);
    return () => window.removeEventListener("keydown", focusDock);
  }, [cancelHide]);

  const items: DockItem[] = [
    {
      key: "home",
      path: "/",
      label: "桌面",
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
    }),
    {
      key: "recents",
      path: null,
      label: "最近项目",
      artwork: FolderIcon,
      icon: null,
      tileBackground: "",
      dividerBefore: true,
      onActivate: onOpenRecents
    }
  ];

  const visible = alwaysVisible || peekVisible;
  return (
    <>
      {!alwaysVisible ? (
        <button
          type="button"
          className="mac-dock-reveal-zone"
          style={{
            "--mac-dock-reveal-zone-height": `${DOCK_REVEAL_ZONE_HEIGHT_PX}px`
          } as CSSProperties}
          aria-label="显示程序坞"
          aria-expanded={visible}
          onFocus={() => {
            cancelHide();
            setPeekVisible(true);
          }}
          onBlur={() => scheduleHide(DOCK_AUTO_HIDE_DELAY_MS)}
          onPointerEnter={() => {
            cancelHide();
            setPeekVisible(true);
          }}
          onPointerDown={() => {
            cancelHide();
            setPeekVisible(true);
          }}
          onPointerLeave={() => scheduleHide(DOCK_AUTO_HIDE_DELAY_MS)}
        />
      ) : null}
      <div
        className="mac-dock-stage"
        data-visible={visible || undefined}
        aria-hidden={!visible || undefined}
        style={{ "--mac-dock-peek-height": `${DOCK_PEEK_HEIGHT_PX}px` } as CSSProperties}
      >
        <nav
          className="mac-dock"
          aria-label="程序坞"
          onMouseEnter={() => {
            cancelHide();
            if (!alwaysVisible) setPeekVisible(true);
          }}
          onFocusCapture={cancelHide}
          onBlurCapture={(event) => {
            const nextFocus = event.relatedTarget as Node | null;
            if (!event.currentTarget.contains(nextFocus) && !alwaysVisible) {
              scheduleHide(DOCK_AUTO_HIDE_DELAY_MS);
            }
          }}
          onMouseLeave={() => {
            setHoveredDockItem(null);
            if (!alwaysVisible) scheduleHide(DOCK_AUTO_HIDE_DELAY_MS);
          }}
        >
          {items.map((item) => {
            const routeActive = item.path === "/"
              ? location.pathname === "/"
              : item.path
                ? location.pathname.startsWith(item.path)
                : activeWindow === "recents";
            const running = item.key === "home" || (Boolean(item.path) && item.path !== "/" && routeActive);
            const windowOpen = item.key === "recents" && activeWindow === "recents";
            const Artwork = item.artwork;
            const FallbackIcon = item.icon;
            const scale = dockScaleForItem(item.key, hoveredDockItem, reduceMotion);
            const activateMagnification = () => setHoveredDockItem(item.key);
            const deactivateMagnification = () => {
              setHoveredDockItem((current) => current === item.key ? null : current);
            };
            const content = (
              <>
                <span className="mac-dock-tooltip" role="tooltip">{item.label}</span>
                <span
                  className="mac-dock-artwork"
                  style={{
                    transform: `scale(${scale}) translateY(${Math.min((scale - 1) * -32, 0)}px)`,
                    transitionDuration: hoveredDockItem === item.key ? "120ms" : "220ms"
                  }}
                >
                  {Artwork ? <Artwork size={item.key === "home" ? 60 : 56} /> : FallbackIcon ? (
                    <span className="mac-dock-fallback" style={{ background: item.tileBackground }}>
                      <FallbackIcon />
                    </span>
                  ) : null}
                </span>
                <i className="mac-dock-indicator" aria-hidden="true" />
              </>
            );
            if (item.path) {
              return (
                <NavLink
                  key={item.key}
                  ref={(element) => { iconRefs.current[item.key] = element; }}
                  to={item.path}
                  className="mac-dock-item"
                  data-active={running || undefined}
                  data-open={windowOpen || undefined}
                  data-divider-before={item.dividerBefore || undefined}
                  aria-label={item.label}
                  tabIndex={visible ? undefined : -1}
                  onMouseEnter={activateMagnification}
                  onMouseLeave={deactivateMagnification}
                  onFocus={activateMagnification}
                  onBlur={deactivateMagnification}
                >
                  {content}
                </NavLink>
              );
            }
            return (
              <button
                key={item.key}
                ref={(element) => { iconRefs.current[item.key] = element; }}
                type="button"
                className="mac-dock-item"
                data-active={running || undefined}
                data-open={windowOpen || undefined}
                data-divider-before={item.dividerBefore || undefined}
                aria-label={item.label}
                tabIndex={visible ? undefined : -1}
                onMouseEnter={activateMagnification}
                onMouseLeave={deactivateMagnification}
                onFocus={activateMagnification}
                onBlur={deactivateMagnification}
                onClick={(event) => item.onActivate?.(event.currentTarget)}
              >
                {content}
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

function LoginWindow() {
  const loginOpen = usePlatformAuth((state) => state.loginOpen);
  const closeLogin = usePlatformAuth((state) => state.closeLogin);
  const setSession = usePlatformAuth((state) => state.setSession);
  if (!loginOpen) return null;
  return (
    <MacWindow title="登录桌面" onClose={closeLogin}>
      <div className="mac-login-content">
        <LoginScreen displayMode="modal" onLogin={setSession} />
      </div>
    </MacWindow>
  );
}

function AboutWindow({
  onClose,
  triggerRef
}: {
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <MacWindow
      title="关于桌面"
      onClose={onClose}
      modal={false}
      triggerRef={triggerRef}
    >
      <div className="mac-about-window">
        <DesktopMark size={76} />
        <h3>桌面</h3>
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

function HelpWindow({
  area,
  onClose,
  triggerRef
}: {
  area: ReturnType<typeof parseShellContext>["area"];
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const [query, setQuery] = useState("");
  const shortcuts = [
    { keys: "⌘ K", label: "搜索应用与历史" },
    { keys: "⌘ 1", label: "打开思维导图" },
    { keys: "⌘ 2", label: "打开 PPT 制作" },
    ...(area === "diagram" ? [
      { keys: "⌘ N", label: "新建绘图会话" },
      { keys: "⌘ O", label: "打开绘图历史" }
    ] : []),
    { keys: "⌃ ⌘ F", label: "切换全屏" },
    { keys: "Esc", label: "关闭菜单或浮层" }
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredShortcuts = shortcuts.filter((item) => (
    !normalizedQuery || `${item.label} ${item.keys}`.toLocaleLowerCase().includes(normalizedQuery)
  ));

  return (
    <MacWindow
      title="桌面帮助"
      onClose={onClose}
      modal={false}
      triggerRef={triggerRef}
    >
      <div className="mac-help-window">
        <div className="mac-help-heading">
          <span className="mac-help-heading__artwork"><DesktopMark size={38} /></span>
          <div><h3>键盘操作</h3><p>菜单栏、Dock 和搜索都连接到真实页面功能。</p></div>
        </div>
        <label className="mac-help-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="搜索帮助"
            aria-label="搜索帮助主题"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="mac-shortcut-list">
          {filteredShortcuts.map((item) => (
            <ShortcutRow key={`${item.keys}-${item.label}`} keys={item.keys}>{item.label}</ShortcutRow>
          ))}
          {filteredShortcuts.length === 0 ? <p className="mac-help-empty">没有找到相关帮助主题。</p> : null}
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

const INPUT_SELECTION_TYPES = new Set(["text", "search", "tel", "url", "password"]);
const EDITABLE_INPUT_TYPES = new Set([...INPUT_SELECTION_TYPES, "email"]);

function editableSurfaceFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target instanceof HTMLTextAreaElement) {
    return target.disabled || target.readOnly ? null : target;
  }
  if (target instanceof HTMLInputElement) {
    return target.disabled || target.readOnly || !EDITABLE_INPUT_TYPES.has(target.type) ? null : target;
  }
  if (!target.isContentEditable) return null;
  return target.closest<HTMLElement>("[contenteditable='true']") ?? target;
}

function rangeBelongsTo(target: HTMLElement, range: Range): boolean {
  return target === range.commonAncestorContainer || target.contains(range.commonAncestorContainer);
}

function emitEditableInput(target: HTMLElement) {
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateInputValue(target: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (nativeSetter) nativeSetter.call(target, value);
  else target.value = value;
  emitEditableInput(target);
}

function supportsDirectSelection(
  target: HTMLElement
): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement || (
    target instanceof HTMLInputElement && INPUT_SELECTION_TYPES.has(target.type)
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const bootstrapAuth = usePlatformAuth((state) => state.bootstrapAuth);
  const logout = usePlatformAuth((state) => state.logout);
  const loginOpen = usePlatformAuth((state) => state.loginOpen);
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const closeLogin = usePlatformAuth((state) => state.closeLogin);
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
  const panelRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const windowOpenerRef = useRef<HTMLElement | null>(null);
  const lastEditableRef = useRef<HTMLElement | null>(null);
  const lastEditableRangeRef = useRef<Range | null>(null);

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
    const rememberEditable = (event: FocusEvent) => {
      const editable = editableSurfaceFor(event.target);
      if (editable) lastEditableRef.current = editable;
    };
    const rememberSelection = () => {
      const editable = lastEditableRef.current;
      if (!editable || editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (rangeBelongsTo(editable, range)) lastEditableRangeRef.current = range.cloneRange();
    };
    document.addEventListener("focusin", rememberEditable);
    document.addEventListener("selectionchange", rememberSelection);
    return () => {
      document.removeEventListener("focusin", rememberEditable);
      document.removeEventListener("selectionchange", rememberSelection);
    };
  }, []);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => { closeOverlay(); }, [closeOverlay, location.pathname]);
  useEffect(() => {
    if (loginOpen) closeOverlay();
  }, [closeOverlay, loginOpen]);
  useEffect(() => {
    if (!activeWindow) windowOpenerRef.current = null;
  }, [activeWindow]);
  useEffect(() => {
    if (!activePanel || activePanel === "spotlight") return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (panelRef.current?.contains(target)) return;
      if (target?.closest(".mac-menu-trailing")) return;
      closeOverlay();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [activePanel, closeOverlay]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const closeShellWindow = useCallback(() => {
    windowOpenerRef.current = null;
    closeOverlay();
  }, [closeOverlay]);

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

  const runEditCommand = useCallback(async (item: ShellMenuItem) => {
    const action = item.action;
    const command = action ? EDIT_COMMANDS[action] : undefined;
    const target = lastEditableRef.current;
    if (!action || !command || !target?.isConnected) {
      setNotice("请先在可编辑文本区域中放置光标");
      return;
    }

    target.focus({ preventScroll: true });

    try {
      if (supportsDirectSelection(target)) {
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? start;
        const selectedText = target.value.slice(start, end);

        if (action === "edit-select-all") {
          target.select();
          return;
        }
        if (action === "edit-copy" || action === "edit-cut") {
          if (!selectedText) {
            setNotice("请先选中要处理的文本");
            return;
          }
          if (!navigator.clipboard?.writeText) throw new Error("clipboard-write-unavailable");
          await navigator.clipboard.writeText(selectedText);
          if (action === "edit-cut") {
            target.setRangeText("", start, end, "end");
            emitEditableInput(target);
          }
          setNotice(action === "edit-cut" ? "已剪切到剪贴板" : "已拷贝到剪贴板");
          return;
        }
        if (action === "edit-paste") {
          if (!navigator.clipboard?.readText) throw new Error("clipboard-read-unavailable");
          const text = await navigator.clipboard.readText();
          target.setRangeText(text, start, end, "end");
          emitEditableInput(target);
          setNotice("已从剪贴板粘贴");
          return;
        }
      } else if (target instanceof HTMLInputElement) {
        if (action === "edit-paste") {
          if (!navigator.clipboard?.readText) throw new Error("clipboard-read-unavailable");
          const text = await navigator.clipboard.readText();
          const insertedAtCaret = document.execCommand("insertText", false, text);
          if (!insertedAtCaret) {
            updateInputValue(target, target.value + text);
          }
          setNotice("已从剪贴板粘贴");
          return;
        }
        const supported = typeof document.queryCommandSupported !== "function" || document.queryCommandSupported(command);
        const completed = supported && document.execCommand(command);
        if (!completed) {
          setNotice("当前输入框不支持“" + item.label + "”");
        } else if (action === "edit-copy" || action === "edit-cut") {
          setNotice(action === "edit-cut" ? "已剪切到剪贴板" : "已拷贝到剪贴板");
        }
        return;
      } else {
        const selection = window.getSelection();
        const savedRange = lastEditableRangeRef.current;
        if (selection && savedRange && rangeBelongsTo(target, savedRange)) {
          selection.removeAllRanges();
          selection.addRange(savedRange.cloneRange());
        }

        if (action === "edit-select-all") {
          const range = document.createRange();
          range.selectNodeContents(target);
          selection?.removeAllRanges();
          selection?.addRange(range);
          lastEditableRangeRef.current = range.cloneRange();
          return;
        }

        const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (action === "edit-copy" || action === "edit-cut") {
          const selectedText = activeRange && rangeBelongsTo(target, activeRange)
            ? activeRange.toString()
            : "";
          if (!selectedText) {
            setNotice("请先选中要处理的文本");
            return;
          }
          if (!navigator.clipboard?.writeText) throw new Error("clipboard-write-unavailable");
          await navigator.clipboard.writeText(selectedText);
          if (action === "edit-cut" && activeRange) {
            activeRange.deleteContents();
            activeRange.collapse(true);
            emitEditableInput(target);
          }
          setNotice(action === "edit-cut" ? "已剪切到剪贴板" : "已拷贝到剪贴板");
          return;
        }
        if (action === "edit-paste") {
          if (!navigator.clipboard?.readText) throw new Error("clipboard-read-unavailable");
          const text = await navigator.clipboard.readText();
          const range = activeRange && rangeBelongsTo(target, activeRange)
            ? activeRange
            : document.createRange();
          if (!activeRange || !rangeBelongsTo(target, range)) {
            range.selectNodeContents(target);
            range.collapse(false);
          }
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
          lastEditableRangeRef.current = range.cloneRange();
          emitEditableInput(target);
          setNotice("已从剪贴板粘贴");
          return;
        }
      }

      const supported = typeof document.queryCommandSupported !== "function" || document.queryCommandSupported(command);
      if (!supported || !document.execCommand(command)) {
        setNotice("当前编辑器不支持“" + item.label + "”");
      }
    } catch (reason) {
      const clipboardUnavailable = (
        reason instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(reason.name)
      ) || (
        reason instanceof Error && reason.message.startsWith("clipboard-")
      );
      if (clipboardUnavailable) {
        setNotice(action === "edit-paste"
          ? "浏览器未授权读取剪贴板"
          : "浏览器未授权写入剪贴板");
      } else {
        setNotice("当前编辑器未能完成“" + item.label + "”");
      }
    }
  }, []);

  const handleMenuAction = useCallback((
    item: ShellMenuItem,
    opener: HTMLButtonElement | null
  ) => {
    if (!item.action || item.disabled) return;
    const editCommand = EDIT_COMMANDS[item.action];
    if (editCommand) {
      void runEditCommand(item);
      return true;
    }
    switch (item.action) {
      case "navigate": if (item.href) navigate(item.href); break;
      case "open-about":
        windowOpenerRef.current = opener;
        openWindow("about");
        return true;
      case "open-help":
        windowOpenerRef.current = opener;
        openWindow("help");
        return true;
      case "open-recents":
        windowOpenerRef.current = opener;
        openWindow("recents");
        return true;
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
  }, [canvasMode, closeOverlay, logout, navigate, navigateAndReveal, openLogin, openWindow, runDiagramCommand, runEditCommand, setCanvasMode, toggleDesktopIcons, toggleFullscreen, toggleWidgets]);

  const openShellPanel = useCallback((panel: Exclude<ShellPanel, null>) => {
    if (!loginOpen) openPanel(panel);
  }, [loginOpen, openPanel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const editable = target?.matches("input, textarea, [contenteditable='true']");
      const key = event.key.toLowerCase();
      if (loginOpen) {
        if (event.key === "Escape") closeLogin();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        openShellPanel("spotlight");
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
  }, [activePanel, activeWindow, closeLogin, closeOverlay, context.area, loginOpen, navigate, openShellPanel, openWindow, runDiagramCommand, toggleFullscreen]);

  const userLabel = session?.user.display_name?.trim() || session?.user.email || "登录";
  const isDesktop = context.area === "desktop";
  const dockAlwaysVisible = isDesktop && !dockAutoHide;
  const MenuBarArtwork = context.area === "diagram"
    ? MODULE_ICONS["/diagram"]
    : context.area === "ppt-home" || context.area === "ppt-project"
      ? MODULE_ICONS["/ppt"]
      : FinderIcon;
  const menuBarArtworkSize = isDesktop ? 22 : 18;

  return (
    <div
      className="mac-shell mac-app-shell"
      data-area={context.area}
      data-canvas-mode={context.area === "diagram" ? canvasMode : undefined}
      data-dock-autohide={!dockAlwaysVisible || undefined}
    >
      <MacMenuBar
        menus={menus}
        onAction={handleMenuAction}
        closeSignal={location.key}
        overlayActive={Boolean(activePanel || activeWindow || loginOpen)}
        homeControl={(
          <NavLink to="/" className="mac-brand-control" aria-label="桌面" title="桌面">
            <MenuBarArtwork size={menuBarArtworkSize} />
          </NavLink>
        )}
        trailing={(
          <>
            <button
              ref={userButtonRef}
              type="button"
              className="mac-menu-status-button"
              data-active={activePanel === "network" || undefined}
              aria-label={online ? "网络已连接" : "网络已断开"}
              aria-expanded={activePanel === "network"}
              onClick={() => openShellPanel("network")}
            >
              {online ? <Wifi /> : <WifiOff />}
            </button>
            <button
              type="button"
              className="mac-menu-status-button"
              data-active={activePanel === "control-center" || undefined}
              aria-label="控制中心"
              aria-expanded={activePanel === "control-center"}
              onClick={() => openShellPanel("control-center")}
            >
              <SlidersHorizontal />
            </button>
            <button
              type="button"
              className="mac-menu-status-button"
              data-active={activePanel === "spotlight" || undefined}
              aria-label="Spotlight 搜索"
              aria-expanded={activePanel === "spotlight"}
              onClick={() => openShellPanel("spotlight")}
            >
              <Search />
            </button>
            <MenuBarClock active={activePanel === "calendar"} onClick={() => openShellPanel("calendar")} />
            <button
              type="button"
              className="mac-menu-user-button"
              data-active={activePanel === "user" || undefined}
              aria-label={session ? `账户：${userLabel}` : "登录"}
              aria-expanded={activePanel === "user"}
              onClick={() => openShellPanel("user")}
            >
              <UserAvatar user={session?.user} size={20} label={session ? `账户：${userLabel}` : "登录账户"} />
            </button>
          </>
        )}
      />

      <main className="mac-app-content"><Outlet /></main>

      {activePanel && activePanel !== "spotlight" ? (
        <div ref={panelRef} className="mac-system-popover" data-panel={activePanel}>
          {activePanel === "network" ? <NetworkPanel /> : null}
            {activePanel === "control-center" ? (
              <ControlCenterPanel
                forceDockAutoHide={!isDesktop}
                onError={setNotice}
              />
            ) : null}
          {activePanel === "calendar" ? <CalendarPanel /> : null}
          {activePanel === "user" ? (
            <UserPanel
              onClose={closeOverlay}
              onOpenProfile={() => {
                windowOpenerRef.current = userButtonRef.current;
                openWindow("profile");
              }}
            />
          ) : null}
        </div>
      ) : null}

      <Dock
        key={`${context.area}-${dockAlwaysVisible ? "fixed" : "autohide"}`}
        alwaysVisible={dockAlwaysVisible}
        onOpenRecents={(trigger) => {
          windowOpenerRef.current = trigger;
          openWindow("recents");
        }}
      />
      {activePanel === "spotlight" ? (
        <Spotlight
          open
          authenticated={Boolean(session)}
          onClose={closeOverlay}
          onLogin={openLogin}
        />
      ) : null}
      <RecentProjectsWindow
        open={activeWindow === "recents"}
        authenticated={Boolean(session)}
        onClose={closeShellWindow}
        onLogin={openLogin}
        triggerRef={windowOpenerRef}
      />
      {activeWindow === "about" ? (
        <AboutWindow onClose={closeShellWindow} triggerRef={windowOpenerRef} />
      ) : null}
      {activeWindow === "help" ? (
        <HelpWindow area={context.area} onClose={closeShellWindow} triggerRef={windowOpenerRef} />
      ) : null}
      {activeWindow === "profile" ? (
        <ProfileWindow onClose={closeShellWindow} triggerRef={windowOpenerRef} />
      ) : null}
      <LoginWindow />

      {notice ? <div className="mac-shell-notice" role="status"><Command />{notice}</div> : null}
    </div>
  );
}

export default AppShell;
