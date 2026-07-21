import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  MessageSquareText,
  Presentation,
  RefreshCw,
  Search,
  Workflow
} from "lucide-react";
import { FinderIcon, MindmapAppIcon, SlidesAppIcon } from "../macos/MacOSIcons";
import { MacWindow } from "./MacWindow";
import { useRecentWork } from "./useRecentWork";

type RecentTab = "projects" | "diagrams" | "conversations";
type RecentView = "list" | "grid";

const RECENT_TABS: RecentTab[] = ["projects", "diagrams", "conversations"];

interface RecentProjectsWindowProps {
  open: boolean;
  authenticated: boolean;
  onClose: () => void;
  onLogin: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}

function historyHref(title: string, conversation = false): string {
  const params = new URLSearchParams();
  if (conversation) params.set("historyMode", "conversations");
  params.set("history", title);
  return "/diagram?" + params.toString();
}

function formatTimestamp(value?: string): string {
  if (!value) return "最近使用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近使用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function includesQuery(query: string, ...values: Array<string | null | undefined>): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

function RecentRow({
  icon,
  artwork = false,
  title,
  summary,
  timestamp,
  onOpen
}: {
  icon: ReactNode;
  artwork?: boolean;
  title: string;
  summary: string;
  timestamp?: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="mac-recent-row" onClick={onOpen}>
      <span className="mac-recent-row-icon" data-artwork={artwork || undefined}>{icon}</span>
      <span className="mac-recent-row-copy">
        <strong>{title}</strong>
        <small>{summary}</small>
      </span>
      <time dateTime={timestamp}>{formatTimestamp(timestamp)}</time>
    </button>
  );
}

export function RecentProjectsWindow({
  open,
  authenticated,
  onClose,
  onLogin,
  triggerRef
}: RecentProjectsWindowProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<RecentTab>("projects");
  const [view, setView] = useState<RecentView>("list");
  const [query, setQuery] = useState("");
  const recent = useRecentWork(open && authenticated);

  const sortedProjects = useMemo(
    () => [...recent.projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [recent.projects]
  );
  const sortedDiagrams = useMemo(
    () => [...recent.diagrams].sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? "")),
    [recent.diagrams]
  );
  const sortedConversations = useMemo(
    () => [...recent.conversations].sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? "")),
    [recent.conversations]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(
    () => sortedProjects.filter((project) => includesQuery(normalizedQuery, project.name, project.topic)),
    [normalizedQuery, sortedProjects]
  );
  const visibleDiagrams = useMemo(
    () => sortedDiagrams.filter((diagram) => includesQuery(
      normalizedQuery,
      diagram.title,
      diagram.conversation?.summary
    )),
    [normalizedQuery, sortedDiagrams]
  );
  const visibleConversations = useMemo(
    () => sortedConversations.filter((conversation) => includesQuery(
      normalizedQuery,
      conversation.title,
      conversation.summary
    )),
    [normalizedQuery, sortedConversations]
  );

  if (!open) return null;

  const openHref = (href: string) => {
    onClose();
    navigate(href);
  };

  const error = tab === "projects"
    ? recent.errors.projects
    : tab === "diagrams"
      ? recent.errors.diagrams
      : recent.errors.conversations;
  const itemCount = tab === "projects"
    ? visibleProjects.length
    : tab === "diagrams"
      ? visibleDiagrams.length
      : visibleConversations.length;
  const tabIndex = RECENT_TABS.indexOf(tab);
  const sectionTitle = tab === "projects" ? "PPT 项目" : tab === "diagrams" ? "思维导图" : "历史对话";
  const guestDescription = tab === "projects"
    ? "登录后查看演示文稿、页数和最近编辑位置。"
    : tab === "diagrams"
      ? "登录后继续编辑最近的思维导图与生成记录。"
      : "登录后回到历史对话，并从上次内容继续。";
  const guestArtwork = tab === "projects"
    ? <SlidesAppIcon size={58} />
    : tab === "diagrams"
      ? <MindmapAppIcon size={58} />
      : <FinderIcon size={58} />;

  return (
    <MacWindow
      title="最近项目"
      onClose={onClose}
      wide
      modal={false}
      triggerRef={triggerRef}
    >
      <div className="mac-recents-shell">
        <div className="mac-recents-toolbar" role="toolbar" aria-label="最近项目工具栏">
          <div className="mac-recents-toolbar__navigation" aria-label="分类导航">
            <button
              type="button"
              aria-label="上一个分类"
              disabled={tabIndex <= 0}
              onClick={() => setTab(RECENT_TABS[tabIndex - 1] ?? tab)}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-label="下一个分类"
              disabled={tabIndex >= RECENT_TABS.length - 1}
              onClick={() => setTab(RECENT_TABS[tabIndex + 1] ?? tab)}
            >
              <ChevronRight />
            </button>
          </div>

          <div className="mac-recents-toolbar__views" role="group" aria-label="显示方式">
            <button type="button" aria-label="列表视图" aria-pressed={view === "list"} disabled={!authenticated} onClick={() => setView("list")}>
              <List />
            </button>
            <button type="button" aria-label="网格视图" aria-pressed={view === "grid"} disabled={!authenticated} onClick={() => setView("grid")}>
              <LayoutGrid />
            </button>
          </div>

          <label className="mac-recents-toolbar__search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              disabled={!authenticated}
              aria-label="搜索最近项目"
              placeholder={authenticated ? "搜索" : "登录后搜索"}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="mac-recents-layout">
        <nav className="mac-recents-sidebar" aria-label="最近项目分类">
          <button type="button" data-active={tab === "projects" || undefined} onClick={() => setTab("projects")}>
            <Presentation />
            <span>PPT 项目</span>
            <small>{sortedProjects.length}</small>
          </button>
          <button type="button" data-active={tab === "diagrams" || undefined} onClick={() => setTab("diagrams")}>
            <Workflow />
            <span>思维导图</span>
            <small>{sortedDiagrams.length}</small>
          </button>
          <button type="button" data-active={tab === "conversations" || undefined} onClick={() => setTab("conversations")}>
            <MessageSquareText />
            <span>历史对话</span>
            <small>{sortedConversations.length}</small>
          </button>
        </nav>

        <section className="mac-recents-content" aria-live="polite">
          <header>
            <div>
              <h3>{sectionTitle}</h3>
              <p>{authenticated
                ? (itemCount
                    ? (normalizedQuery ? `找到 ${itemCount} 条记录` : `共 ${itemCount} 条最近记录`)
                    : (normalizedQuery ? "没有匹配的记录" : "你的最近工作会显示在这里"))
                : "登录后自动同步最近工作"}</p>
            </div>
            {authenticated ? (
              <button type="button" className="mac-icon-button" aria-label="刷新最近项目" onClick={() => void recent.refresh()}>
                <RefreshCw className={recent.loading ? "mac-spin" : ""} />
              </button>
            ) : null}
          </header>

          {!authenticated ? (
            <div className="mac-recents-guest">
              <span className="mac-recents-guest__artwork">{guestArtwork}</span>
              <h3>登录后查看{sectionTitle}</h3>
              <p>{guestDescription}</p>
              <button
                type="button"
                className="mac-primary-button"
                onClick={() => {
                  onClose();
                  onLogin();
                }}
              >
                登录账户
              </button>
            </div>
          ) : (
            <>
              {error ? (
                <div className="mac-recents-error">
                  <AlertCircle />
                  <span><strong>这一类记录暂时不可用</strong><small>{error}</small></span>
                  <button type="button" onClick={() => void recent.refresh()}>重试</button>
                </div>
              ) : null}

              <div className="mac-recents-list" data-view={view}>
                {tab === "projects" ? visibleProjects.map((project) => (
                  <RecentRow
                    key={project.id}
                    icon={<SlidesAppIcon size={34} />}
                    artwork
                    title={project.name}
                    summary={project.topic?.trim() || `${project.pageCount} 页 · ${project.reportType}`}
                    timestamp={project.updatedAt}
                    onOpen={() => openHref(`/ppt/p/${encodeURIComponent(project.id)}/studio`)}
                  />
                )) : null}
                {tab === "diagrams" ? visibleDiagrams.map((diagram) => (
                  <RecentRow
                    key={diagram.diagram_id}
                    icon={<MindmapAppIcon size={34} />}
                    artwork
                    title={diagram.title || "未命名绘图"}
                    summary={diagram.conversation?.summary?.trim() || "继续编辑思维导图"}
                    timestamp={diagram.updated_at}
                    onOpen={() => openHref(historyHref(diagram.title || "未命名绘图"))}
                  />
                )) : null}
                {tab === "conversations" ? visibleConversations.map((conversation) => {
                  const title = conversation.title?.trim() || "未命名对话";
                  return (
                    <RecentRow
                      key={conversation.conversation_id}
                      icon={<MessageSquareText />}
                      title={title}
                      summary={conversation.summary?.trim() || `${conversation.message_count ?? 0} 条消息`}
                      timestamp={conversation.updated_at}
                      onOpen={() => openHref(historyHref(title, true))}
                    />
                  );
                }) : null}

                {!recent.loading && !error && itemCount === 0 ? (
                  <div className="mac-recents-empty">
                    <FileEmptyIcon tab={tab} />
                    <strong>{normalizedQuery ? "没有匹配的记录" : "还没有记录"}</strong>
                    <span>{normalizedQuery ? "试试项目名、主题或对话关键词。" : "开始创建后，最近使用的内容会自动出现在这里。"}</span>
                  </div>
                ) : null}
                {recent.loading && itemCount === 0 ? (
                  <div className="mac-recents-loading" aria-label="正在加载">
                    <i /><i /><i />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
        </div>
      </div>
    </MacWindow>
  );
}

function FileEmptyIcon({ tab }: { tab: RecentTab }) {
  if (tab === "projects") return <Presentation aria-hidden="true" />;
  if (tab === "diagrams") return <Workflow aria-hidden="true" />;
  return <MessageSquareText aria-hidden="true" />;
}
