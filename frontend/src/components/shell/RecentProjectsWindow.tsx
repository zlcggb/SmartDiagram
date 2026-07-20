import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  LogIn,
  MessageSquareText,
  Presentation,
  RefreshCw,
  Workflow
} from "lucide-react";
import { MacWindow } from "./MacWindow";
import { useRecentWork } from "./useRecentWork";

type RecentTab = "projects" | "diagrams" | "conversations";

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

function RecentRow({
  icon,
  title,
  summary,
  timestamp,
  onOpen
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  timestamp?: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="mac-recent-row" onClick={onOpen}>
      <span className="mac-recent-row-icon">{icon}</span>
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
    ? sortedProjects.length
    : tab === "diagrams"
      ? sortedDiagrams.length
      : sortedConversations.length;

  return (
    <MacWindow
      title="最近项目"
      onClose={onClose}
      wide
      modal={false}
      triggerRef={triggerRef}
    >
      {!authenticated ? (
        <div className="mac-recents-guest">
          <span><LogIn aria-hidden="true" /></span>
          <h3>登录后查看最近工作</h3>
          <p>项目、思维导图与历史对话会在这里统一显示，并可直接回到上次位置。</p>
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
                <h3>{tab === "projects" ? "PPT 项目" : tab === "diagrams" ? "思维导图" : "历史对话"}</h3>
                <p>{itemCount ? `共 ${itemCount} 条最近记录` : "你的最近工作会显示在这里"}</p>
              </div>
              <button type="button" className="mac-icon-button" aria-label="刷新最近项目" onClick={() => void recent.refresh()}>
                <RefreshCw className={recent.loading ? "mac-spin" : ""} />
              </button>
            </header>

            {error ? (
              <div className="mac-recents-error">
                <AlertCircle />
                <span><strong>这一类记录暂时不可用</strong><small>{error}</small></span>
                <button type="button" onClick={() => void recent.refresh()}>重试</button>
              </div>
            ) : null}

            <div className="mac-recents-list">
              {tab === "projects" ? sortedProjects.map((project) => (
                <RecentRow
                  key={project.id}
                  icon={<Presentation />}
                  title={project.name}
                  summary={project.topic?.trim() || `${project.pageCount} 页 · ${project.reportType}`}
                  timestamp={project.updatedAt}
                  onOpen={() => openHref(`/ppt/p/${encodeURIComponent(project.id)}/studio`)}
                />
              )) : null}
              {tab === "diagrams" ? sortedDiagrams.map((diagram) => (
                <RecentRow
                  key={diagram.diagram_id}
                  icon={<Workflow />}
                  title={diagram.title || "未命名绘图"}
                  summary={diagram.conversation?.summary?.trim() || "继续编辑思维导图"}
                  timestamp={diagram.updated_at}
                  onOpen={() => openHref(historyHref(diagram.title || "未命名绘图"))}
                />
              )) : null}
              {tab === "conversations" ? sortedConversations.map((conversation) => {
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
                  <strong>还没有记录</strong>
                  <span>开始创建后，最近使用的内容会自动出现在这里。</span>
                </div>
              ) : null}
              {recent.loading && itemCount === 0 ? (
                <div className="mac-recents-loading" aria-label="正在加载">
                  <i /><i /><i />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </MacWindow>
  );
}

function FileEmptyIcon({ tab }: { tab: RecentTab }) {
  if (tab === "projects") return <Presentation aria-hidden="true" />;
  if (tab === "diagrams") return <Workflow aria-hidden="true" />;
  return <MessageSquareText aria-hidden="true" />;
}
