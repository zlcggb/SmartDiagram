/**
 * DeepDiagram 桌面——以现代 macOS 的材质、层级和操作模式为参考，
 * 但使用属于产品的抽象工作流壁纸和应用 artwork。
 */
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Cloud,
  LogIn,
  MessageSquareText,
  RefreshCw,
  Sparkles
} from "lucide-react";
import {
  FolderIcon,
  MindmapAppIcon,
  MODULE_ICONS,
  SlidesAppIcon
} from "../components/macos/MacOSIcons";
import { useRecentWork } from "../components/shell/useRecentWork";
import { moduleRegistry } from "../modules/registry";
import { usePlatformAuth } from "../store/authStore";
import { useDesktopStore } from "../store/desktopStore";

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CALENDAR_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

type RecentKind = "ppt" | "diagram" | "conversation";

interface RecentShortcut {
  id: string;
  kind: RecentKind;
  title: string;
  summary: string;
  timestamp?: string;
  href: string;
}

interface DesktopIconSpec {
  key: string;
  label: string;
  artwork: ComponentType<{ size?: number }>;
  onOpen: () => void;
}

function greetingForHour(hour: number) {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function historyHref(title: string, conversation = false) {
  const params = new URLSearchParams();
  if (conversation) params.set("historyMode", "conversations");
  params.set("history", title);
  return `/diagram?${params.toString()}`;
}

function sortableTime(value?: string) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function formatRecentTime(value?: string) {
  if (!value) return "最近使用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近使用";

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("zh-CN", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" }
  ).format(date);
}

function wallpaperId(rawId: string, name: string) {
  return `${rawId.replace(/:/g, "")}-${name}`;
}

/** 深色抽象壁纸：将结构节点和流动的工作轨迹融合为 DeepDiagram 的自有图形。 */
function DarkWorkspaceWallpaper() {
  const rawId = useId();
  const backgroundId = wallpaperId(rawId, "background");
  const ribbonOneId = wallpaperId(rawId, "ribbon-one");
  const ribbonTwoId = wallpaperId(rawId, "ribbon-two");
  const glowId = wallpaperId(rawId, "glow");
  const blurId = wallpaperId(rawId, "blur");
  const grainId = wallpaperId(rawId, "grain");

  const stars = useMemo(
    () => Array.from({ length: 28 }, (_, index) => ({
      x: (index * 157 + 83) % 1550,
      y: (index * 79 + 46) % 610,
      radius: 0.7 + (index % 4) * 0.35,
      opacity: 0.16 + (index % 5) * 0.08
    })),
    []
  );

  return (
    <svg
      className="mac-desktop__wallpaper-art"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={backgroundId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#05070d" />
          <stop offset="48%" stopColor="#0a1020" />
          <stop offset="100%" stopColor="#111b31" />
        </linearGradient>
        <linearGradient id={ribbonOneId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2756d8" stopOpacity="0.16" />
          <stop offset="45%" stopColor="#6377ff" stopOpacity="0.76" />
          <stop offset="100%" stopColor="#1ac4d8" stopOpacity="0.24" />
        </linearGradient>
        <linearGradient id={ribbonTwoId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0a2c61" stopOpacity="0.18" />
          <stop offset="55%" stopColor="#1b89c4" stopOpacity="0.52" />
          <stop offset="100%" stopColor="#60e4d0" stopOpacity="0.12" />
        </linearGradient>
        <radialGradient id={glowId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#62a8ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#62a8ff" stopOpacity="0" />
        </radialGradient>
        <filter id={blurId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
        <filter id={grainId}>
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="8" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="table" tableValues="0 0.045" /></feComponentTransfer>
        </filter>
      </defs>

      <rect width="1600" height="1000" fill={`url(#${backgroundId})`} />
      <ellipse cx="1120" cy="230" rx="520" ry="430" fill={`url(#${glowId})`} filter={`url(#${blurId})`} />
      {stars.map((star, index) => (
        <circle
          key={index}
          cx={star.x}
          cy={star.y}
          r={star.radius}
          fill="#dce9ff"
          opacity={star.opacity}
        />
      ))}

      <path
        d="M-120 812C170 548 360 488 572 600c190 101 276 32 408-160 131-191 348-229 742-29v489H-120Z"
        fill={`url(#${ribbonOneId})`}
        filter={`url(#${blurId})`}
      />
      <path
        d="M-160 878c312-176 526-128 708-18 218 132 414 49 607-154 156-165 343-178 613-55v397H-160Z"
        fill={`url(#${ribbonTwoId})`}
        opacity="0.86"
      />
      <path
        d="M-80 873c275-156 486-108 662 3 183 115 377 68 584-133 154-150 323-181 536-99"
        fill="none"
        stroke="#8ec9ff"
        strokeWidth="1.2"
        opacity="0.18"
      />

      {/* 极弱的结构节点，与应用的图表逻辑呼应。 */}
      <g fill="none" stroke="#9abaff" strokeWidth="1" opacity="0.1">
        <path d="m985 174 118 70 139-99 126 91" />
        <path d="m1103 244 42 121 97-220" />
      </g>
      <g fill="#d9e7ff" opacity="0.2">
        <circle cx="985" cy="174" r="4" />
        <circle cx="1103" cy="244" r="5" />
        <circle cx="1145" cy="365" r="4" />
        <circle cx="1242" cy="145" r="4" />
        <circle cx="1368" cy="236" r="4" />
      </g>
      <rect width="1600" height="1000" filter={`url(#${grainId})`} opacity="0.55" />
    </svg>
  );
}

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return (
    <article className="mac-desktop-widget mac-desktop-widget--clock" aria-label="时钟小组件">
      <span className="mac-desktop-widget__label">时钟</span>
      <time className="mac-desktop-clock" dateTime={now.toISOString()}>
        <span>{hours}</span><i>:</i><span>{minutes}</span><small>{seconds}</small>
      </time>
      <p>{now.getMonth() + 1}月{now.getDate()}日 {WEEKDAY_NAMES[now.getDay()]}</p>
    </article>
  );
}

function CalendarWidget() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const dayCount = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: dayCount }, (_, index) => index + 1)
    ];
  }, [month, year]);

  return (
    <article className="mac-desktop-widget mac-desktop-widget--calendar" aria-label={`${year}年${month + 1}月日历`}>
      <header className="mac-desktop-calendar__heading">
        <strong>{month + 1}月</strong><span>{year}</span>
      </header>
      <div className="mac-desktop-calendar__weekdays" aria-hidden="true">
        {CALENDAR_WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mac-desktop-calendar__days">
        {cells.map((day, index) => day === null
          ? <span key={`blank-${index}`} aria-hidden="true" />
          : (
            <span key={day} data-today={day === today || undefined} aria-current={day === today ? "date" : undefined}>
              {day}
            </span>
          ))}
      </div>
    </article>
  );
}

function AccountWidget({ recentCount }: { recentCount: number }) {
  const session = usePlatformAuth((state) => state.session);
  const checking = usePlatformAuth((state) => state.checking);
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const openWindow = useDesktopStore((state) => state.openWindow);
  const hour = new Date().getHours();

  if (session) {
    const displayName = session.user.display_name || session.user.email;
    return (
      <article className="mac-desktop-widget mac-desktop-widget--account">
        <div className="mac-desktop-account__identity">
          <span className="mac-desktop-account__avatar" aria-hidden="true">
            {displayName.trim().charAt(0).toUpperCase()}
          </span>
          <span>
            <small>{greetingForHour(hour)}</small>
            <strong>{displayName}</strong>
          </span>
          <Cloud className="mac-desktop-account__cloud" aria-label="已连接工作区" />
        </div>
        <p>{recentCount ? `已同步 ${recentCount} 个最近工作项` : "工作区已连接，可以开始新项目。"}</p>
        <button type="button" onClick={() => openWindow("recents")}>
          查看全部最近项目 <ArrowUpRight aria-hidden="true" />
        </button>
      </article>
    );
  }

  return (
    <article className="mac-desktop-widget mac-desktop-widget--account mac-desktop-widget--guest">
      <div className="mac-desktop-account__identity">
        <span className="mac-desktop-account__avatar" aria-hidden="true"><Sparkles /></span>
        <span>
          <small>{checking ? "正在恢复工作区" : greetingForHour(hour)}</small>
          <strong>{checking ? "请稍候…" : "欢迎回到 DeepDiagram"}</strong>
        </span>
      </div>
      <p>登录后，PPT、思维导图与历史对话会在同一工作区继续。</p>
      <button type="button" disabled={checking} onClick={openLogin}>
        <LogIn aria-hidden="true" /> 登录账户
      </button>
    </article>
  );
}

function ShortcutArtwork({ kind }: { kind: RecentKind }) {
  if (kind === "ppt") return <SlidesAppIcon size={38} />;
  if (kind === "diagram") return <MindmapAppIcon size={38} />;
  return <MessageSquareText aria-hidden="true" />;
}

function RecentShortcutCard({ item, index }: { item: RecentShortcut; index: number }) {
  const kindLabel = item.kind === "ppt" ? "PPT 项目" : item.kind === "diagram" ? "思维导图" : "历史对话";
  return (
    <Link
      className="mac-desktop-shortcut"
      data-kind={item.kind}
      to={item.href}
      aria-label={`打开${kindLabel}：${item.title}`}
      style={{ "--shortcut-index": index } as CSSProperties}
    >
      <span className="mac-desktop-shortcut__artwork"><ShortcutArtwork kind={item.kind} /></span>
      <span className="mac-desktop-shortcut__copy">
        <small>{kindLabel}</small>
        <strong>{item.title}</strong>
        <span>{item.summary}</span>
      </span>
      <time dateTime={item.timestamp}>{formatRecentTime(item.timestamp)}</time>
      <ArrowUpRight className="mac-desktop-shortcut__open" aria-hidden="true" />
    </Link>
  );
}

function RecentWorkspace({
  authenticated,
  loading,
  shortcuts,
  errors,
  onRefresh
}: {
  authenticated: boolean;
  loading: boolean;
  shortcuts: RecentShortcut[];
  errors: string[];
  onRefresh: () => void;
}) {
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const openWindow = useDesktopStore((state) => state.openWindow);

  return (
    <section className="mac-desktop-workspace" aria-labelledby="mac-desktop-workspace-title">
      <header className="mac-desktop-workspace__header">
        <div>
          <p className="mac-desktop-workspace__eyebrow">
            <span aria-hidden="true" /> 连续工作区
          </p>
          <h1 id="mac-desktop-workspace-title">继续上一次的思路</h1>
          <p>PPT、图表和对话保留在同一条时间线上。</p>
        </div>
        {authenticated ? (
          <div className="mac-desktop-workspace__actions">
            <button type="button" onClick={() => openWindow("recents")}>查看全部</button>
            <button
              type="button"
              className="mac-desktop-workspace__refresh"
              onClick={onRefresh}
              aria-label="刷新最近工作"
              title="刷新最近工作"
            >
              <RefreshCw className={loading ? "is-spinning" : undefined} />
            </button>
          </div>
        ) : null}
      </header>

      {!authenticated ? (
        <div className="mac-desktop-workspace__guest">
          <span aria-hidden="true"><Cloud /></span>
          <div><strong>连接你的工作区</strong><p>登录后即可在桌面直接打开历史项目。</p></div>
          <button type="button" onClick={openLogin}><LogIn /> 登录</button>
        </div>
      ) : null}

      {authenticated && errors.length > 0 ? (
        <button type="button" className="mac-desktop-workspace__notice" onClick={onRefresh}>
          <span>部分工作记录未能同步</span><small>点击重试</small>
        </button>
      ) : null}

      {authenticated && loading && shortcuts.length === 0 ? (
        <div className="mac-desktop-shortcuts mac-desktop-shortcuts--loading" aria-label="正在同步最近工作">
          {Array.from({ length: 3 }, (_, index) => <i key={index} />)}
        </div>
      ) : null}

      {authenticated && shortcuts.length > 0 ? (
        <div className="mac-desktop-shortcuts" aria-live="polite">
          {shortcuts.map((item, index) => <RecentShortcutCard key={item.id} item={item} index={index} />)}
        </div>
      ) : null}

      {authenticated && !loading && shortcuts.length === 0 && errors.length === 0 ? (
        <div className="mac-desktop-workspace__empty">
          <span aria-hidden="true"><Sparkles /></span>
          <strong>新工作区已准备好</strong>
          <p>从右侧打开思维导图或 PPT，第一条记录会出现在这里。</p>
        </div>
      ) : null}
    </section>
  );
}

function DesktopIcon({ spec, selected, onSelect }: {
  spec: DesktopIconSpec;
  selected: boolean;
  onSelect: () => void;
}) {
  const Artwork = spec.artwork;
  return (
    <button
      type="button"
      className="mac-desktop-app"
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        spec.onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") spec.onOpen();
      }}
      title={`${spec.label}（双击打开）`}
    >
      <span className="mac-desktop-app__artwork"><Artwork size={60} /></span>
      <span className="mac-desktop-app__label">{spec.label}</span>
    </button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const widgetsVisible = useDesktopStore((state) => state.widgetsVisible);
  const desktopIconsVisible = useDesktopStore((state) => state.desktopIconsVisible);
  const selectedDesktopIcon = useDesktopStore((state) => state.selectedDesktopIcon);
  const setSelectedDesktopIcon = useDesktopStore((state) => state.setSelectedDesktopIcon);
  const openWindow = useDesktopStore((state) => state.openWindow);
  const recent = useRecentWork(Boolean(session));

  const shortcuts = useMemo<RecentShortcut[]>(() => {
    const projects = [...recent.projects]
      .sort((a, b) => sortableTime(b.updatedAt) - sortableTime(a.updatedAt))
      .slice(0, 2)
      .map((project) => ({
        id: `ppt-${project.id}`,
        kind: "ppt" as const,
        title: project.name || "未命名演示项目",
        summary: project.topic?.trim() || `${project.pageCount} 页 · ${project.reportType}`,
        timestamp: project.updatedAt,
        href: `/ppt/p/${encodeURIComponent(project.id)}/studio`
      }));
    const diagrams = [...recent.diagrams]
      .sort((a, b) => sortableTime(b.updated_at) - sortableTime(a.updated_at))
      .slice(0, 2)
      .map((diagram) => {
        const title = diagram.title?.trim() || "未命名图表";
        return {
          id: `diagram-${diagram.diagram_id}`,
          kind: "diagram" as const,
          title,
          summary: diagram.conversation?.summary?.trim() || "继续编辑图表与结构",
          timestamp: diagram.updated_at,
          href: historyHref(title)
        };
      });
    const conversations = [...recent.conversations]
      .sort((a, b) => sortableTime(b.updated_at) - sortableTime(a.updated_at))
      .slice(0, 2)
      .map((conversation) => {
        const title = conversation.title?.trim() || "未命名对话";
        return {
          id: `conversation-${conversation.conversation_id}`,
          kind: "conversation" as const,
          title,
          summary: conversation.summary?.trim() || `${conversation.message_count ?? 0} 条消息`,
          timestamp: conversation.updated_at,
          href: historyHref(title, true)
        };
      });

    // 按类别交错排列，保证三类工作都是桌面的一等公民。
    const interleaved: Array<RecentShortcut | undefined> = [
      projects[0],
      diagrams[0],
      conversations[0],
      projects[1],
      diagrams[1],
      conversations[1]
    ];
    return interleaved.filter((item): item is RecentShortcut => item !== undefined);
  }, [recent.conversations, recent.diagrams, recent.projects]);

  const desktopIcons = useMemo<DesktopIconSpec[]>(() => [
    ...moduleRegistry.map((module) => ({
      key: module.path,
      label: module.navLabel,
      artwork: MODULE_ICONS[module.path] ?? FolderIcon,
      onOpen: () => navigate(module.path)
    })),
    {
      key: "recents",
      label: "最近项目",
      artwork: FolderIcon,
      onOpen: () => openWindow("recents")
    }
  ], [navigate, openWindow]);

  const errors = Object.values(recent.errors).filter((message): message is string => Boolean(message));

  return (
    <main className="mac-desktop" onClick={() => setSelectedDesktopIcon(null)}>
      <div className="mac-desktop__wallpaper"><DarkWorkspaceWallpaper /></div>
      <div className="mac-desktop__atmosphere" aria-hidden="true" />
      <div className="mac-desktop__scrim" aria-hidden="true" />

      {widgetsVisible ? (
        <aside className="mac-desktop-widgets" aria-label="桌面小组件">
          <div className="mac-desktop-widgets__row"><ClockWidget /><CalendarWidget /></div>
          <AccountWidget recentCount={shortcuts.length} />
        </aside>
      ) : null}

      <RecentWorkspace
        authenticated={Boolean(session)}
        loading={recent.loading}
        shortcuts={shortcuts}
        errors={errors}
        onRefresh={() => void recent.refresh()}
      />

      {desktopIconsVisible ? (
        <nav className="mac-desktop-apps" aria-label="桌面应用">
          {desktopIcons.map((spec) => (
            <DesktopIcon
              key={spec.key}
              spec={spec}
              selected={selectedDesktopIcon === spec.key}
              onSelect={() => setSelectedDesktopIcon(spec.key)}
            />
          ))}
        </nav>
      ) : null}

      <footer className="mac-desktop__status" aria-hidden="true">
        <span />
        <p>工作区已加密·修改会自动保存</p>
      </footer>
    </main>
  );
}
