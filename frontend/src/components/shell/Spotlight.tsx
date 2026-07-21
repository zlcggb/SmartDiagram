import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  FileClock,
  FolderOpen,
  LayoutGrid,
  LogIn,
  MessageSquareText,
  Search,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { MindmapAppIcon, SlidesAppIcon } from "../macos/MacOSIcons";
import { buildSpotlightResults, type SpotlightResult } from "./shellModel";
import { useRecentWork } from "./useRecentWork";

interface SpotlightProps {
  open: boolean;
  authenticated: boolean;
  onClose: () => void;
  onLogin: () => void;
}

type SpotlightMode = "all" | "apps" | "projects" | "diagrams" | "conversations";

const SPOTLIGHT_MODES: Array<{
  id: Exclude<SpotlightMode, "all">;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "apps", label: "应用", icon: LayoutGrid },
  { id: "projects", label: "PPT 项目", icon: FolderOpen },
  { id: "diagrams", label: "思维导图", icon: Workflow },
  { id: "conversations", label: "历史对话", icon: MessageSquareText }
];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function resultIcon(result: SpotlightResult) {
  if (result.kind === "ppt" || (result.kind === "app" && result.href === "/ppt")) {
    return <SlidesAppIcon size={34} />;
  }
  if (result.kind === "diagram" || (result.kind === "app" && result.href === "/diagram")) {
    return <MindmapAppIcon size={34} />;
  }
  if (result.kind === "conversation") return <MessageSquareText />;
  if (result.kind === "login") return <LogIn />;
  return <FileClock />;
}

function resultMatchesMode(result: SpotlightResult, mode: SpotlightMode): boolean {
  if (mode === "all") return true;
  if (result.kind === "login") return true;
  if (mode === "apps") return result.kind === "app";
  if (mode === "projects") return result.kind === "ppt" || result.href === "/ppt";
  if (mode === "diagrams") return result.kind === "diagram" || result.href === "/diagram";
  return result.kind === "conversation";
}

function modePlaceholder(mode: SpotlightMode): string {
  if (mode === "apps") return "搜索应用";
  if (mode === "projects") return "搜索 PPT 项目";
  if (mode === "diagrams") return "搜索思维导图";
  if (mode === "conversations") return "搜索历史对话";
  return "Spotlight 搜索";
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
  const listboxId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SpotlightMode>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const recent = useRecentWork(open && authenticated);
  const allResults = useMemo(
    () => buildSpotlightResults(query, {
      authenticated,
      projects: mode === "all" || mode === "projects" ? recent.projects : [],
      diagrams: mode === "all" || mode === "diagrams" ? recent.diagrams : [],
      conversations: mode === "all" || mode === "conversations" ? recent.conversations : []
    }),
    [authenticated, mode, query, recent.projects, recent.diagrams, recent.conversations]
  );
  const results = useMemo(
    () => allResults.filter((result) => resultMatchesMode(result, mode)),
    [allResults, mode]
  );
  const expanded = query.trim().length > 0 || mode !== "all";
  const resolvedActiveIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const restoreTarget = previousFocusRef.current;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current = null;
      window.requestAnimationFrame(() => {
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !expanded || results.length === 0) return;
    optionRefs.current[resolvedActiveIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, open, resolvedActiveIndex, results.length]);

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

  const selectMode = (nextMode: Exclude<SpotlightMode, "all">) => {
    setMode((current) => current === nextMode ? "all" : nextMode);
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      const focusable = dialogRef.current ? focusableElements(dialogRef.current) : [];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex]?.focus();
      return;
    }
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!expanded) {
        setMode("apps");
        setActiveIndex(0);
      } else {
        setActiveIndex(results.length ? (resolvedActiveIndex + 1) % results.length : 0);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) {
        setMode("apps");
        setActiveIndex(Math.max(results.length - 1, 0));
      } else {
        setActiveIndex(results.length
          ? (resolvedActiveIndex - 1 + results.length) % results.length
          : 0);
      }
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault();
      activate(results[resolvedActiveIndex]);
    }
  };

  const sourceUnavailable = Object.keys(recent.errors).length > 0;
  const activeModeLabel = SPOTLIGHT_MODES.find((item) => item.id === mode)?.label;

  return createPortal(
    <div
      className="mac-spotlight-backdrop mac-shell"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="mac-spotlight"
        data-expanded={expanded || undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Spotlight 搜索"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="mac-spotlight-bar">
          <label className="mac-spotlight-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder={modePlaceholder(mode)}
              aria-label="搜索"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={expanded ? listboxId : undefined}
              aria-activedescendant={expanded && results.length
                ? `${listboxId}-option-${resolvedActiveIndex}`
                : undefined}
              autoComplete="off"
            />
          </label>

          <div className="mac-spotlight-modes" role="group" aria-label="搜索范围">
            {SPOTLIGHT_MODES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  aria-pressed={mode === item.id}
                  title={item.label}
                  onClick={() => selectMode(item.id)}
                >
                  <Icon aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>

        {expanded ? (
          <section className="mac-spotlight-panel">
            <div className="mac-spotlight-meta">
              <span>{activeModeLabel || "最佳匹配"}</span>
              {sourceUnavailable ? <span>部分历史暂不可用</span> : null}
            </div>

            <div id={listboxId} className="mac-spotlight-results" role="listbox" aria-label="搜索结果">
              {results.map((result, index) => (
                <button
                  key={result.id}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={resolvedActiveIndex === index}
                  className="mac-spotlight-result"
                  data-active={resolvedActiveIndex === index || undefined}
                  onFocus={() => setActiveIndex(index)}
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
                  <strong>{query.trim() ? `没有找到“${query}”` : `还没有${activeModeLabel || "相关内容"}`}</strong>
                  <span>试试项目名、绘图标题或对话关键词。</span>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
