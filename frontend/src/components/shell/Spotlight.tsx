import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Clock3,
  FileClock,
  LogIn,
  MessageSquareText,
  Presentation,
  Search,
  Workflow
} from "lucide-react";
import { buildSpotlightResults, type SpotlightResult } from "./shellModel";
import { useRecentWork } from "./useRecentWork";

interface SpotlightProps {
  open: boolean;
  authenticated: boolean;
  onClose: () => void;
  onLogin: () => void;
}

function resultIcon(result: SpotlightResult) {
  if (result.kind === "ppt") return <Presentation />;
  if (result.kind === "diagram") return <Workflow />;
  if (result.kind === "conversation") return <MessageSquareText />;
  if (result.kind === "login") return <LogIn />;
  return result.href === "/ppt" ? <Presentation /> : <Workflow />;
}

function formatRecentTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function Spotlight({ open, authenticated, onClose, onLogin }: SpotlightProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const recent = useRecentWork(open && authenticated);
  const results = useMemo(
    () => buildSpotlightResults(query, {
      authenticated,
      projects: recent.projects,
      diagrams: recent.diagrams,
      conversations: recent.conversations
    }),
    [authenticated, query, recent.projects, recent.diagrams, recent.conversations]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(results.length - 1, 0)));
  }, [results.length]);

  if (!open || typeof document === "undefined") return null;

  const activate = (result: SpotlightResult | undefined) => {
    if (!result) return;
    onClose();
    if (result.kind === "login") {
      onLogin();
      return;
    }
    if (result.href) navigate(result.href);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current - 1 + results.length) % results.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(results[activeIndex]);
    }
  };

  const sourceUnavailable = Object.keys(recent.errors).length > 0;

  return createPortal(
    <div
      className="mac-spotlight-backdrop mac-shell"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="mac-spotlight"
        role="dialog"
        aria-modal="true"
        aria-label="Spotlight 搜索"
        onKeyDown={handleKeyDown}
      >
        <label className="mac-spotlight-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="搜索应用、项目、绘图和对话"
            aria-label="搜索"
            autoComplete="off"
          />
          <kbd>⌘ K</kbd>
        </label>

        <div className="mac-spotlight-meta">
          <span>{query ? "搜索结果" : "应用与最近使用"}</span>
          {recent.loading ? <span><Clock3 /> 正在同步…</span> : null}
        </div>

        <div className="mac-spotlight-results" role="listbox" aria-label="搜索结果">
          {results.map((result, index) => (
            <button
              key={result.id}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className="mac-spotlight-result"
              data-active={activeIndex === index || undefined}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => activate(result)}
            >
              <span className="mac-spotlight-result-icon" data-kind={result.kind}>
                {resultIcon(result)}
              </span>
              <span className="mac-spotlight-result-copy">
                <strong>{result.title}</strong>
                <small>{result.subtitle}</small>
              </span>
              {result.updatedAt ? (
                <time dateTime={result.updatedAt}>{formatRecentTime(result.updatedAt)}</time>
              ) : (
                <span className="mac-spotlight-open">打开</span>
              )}
            </button>
          ))}
          {results.length === 0 ? (
            <div className="mac-spotlight-empty">
              <FileClock aria-hidden="true" />
              <strong>没有找到“{query}”</strong>
              <span>试试项目名、绘图标题或对话关键词。</span>
            </div>
          ) : null}
        </div>

        <footer className="mac-spotlight-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 打开</span>
          <span><kbd>esc</kbd> 关闭</span>
          {sourceUnavailable ? <em>部分历史暂不可用</em> : null}
        </footer>
      </div>
    </div>,
    document.body
  );
}
