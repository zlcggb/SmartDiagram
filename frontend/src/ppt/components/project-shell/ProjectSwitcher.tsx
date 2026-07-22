import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, FolderOpen, LoaderCircle, Plus, Search } from "lucide-react";
import { getThemePack, normalizePptExportTheme, type ProjectDto } from "../../shared";
import { api } from "../../lib/api";

function formatUpdatedAt(value: string) {
  const updatedAt = new Date(value);
  const diffMs = Date.now() - updatedAt.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMinutes < 1) return "刚刚更新";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  return updatedAt.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function projectEntryPath(project: ProjectDto) {
  return `../../p/${project.id}/studio`;
}

export function ProjectSwitcher({ project }: { project: ProjectDto | null }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || projects.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    void api
      .listProjects()
      .then(setProjects)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "项目列表加载失败");
      })
      .finally(() => setLoading(false));
  }, [loading, open, projects.length]);

  useEffect(() => {
    if (!open) return;
    function closeOnPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return projects;
    return projects.filter((item) =>
      [item.name, item.topic, item.reportType].some((value) => value?.toLocaleLowerCase().includes(needle))
    );
  }, [projects, query]);

  return (
    <div ref={rootRef} className="project-switcher">
      <button
        type="button"
        className={`project-switcher__trigger ${open ? "is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="project-switcher__glyph" aria-hidden="true">
          <FolderOpen className="h-[18px] w-[18px]" />
        </span>
        <span className="project-switcher__copy">
          <span className="project-switcher__eyebrow">当前项目</span>
          <span className="project-switcher__name">{project?.name ?? "正在载入项目"}</span>
        </span>
        <ChevronDown className={`project-switcher__chevron ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <section className="project-switcher__popover" aria-label="切换项目">
          <div className="project-switcher__popover-head">
            <div>
              <p className="project-switcher__popover-title">切换项目</p>
              <p className="project-switcher__popover-subtitle">最近更新的工作空间</p>
            </div>
            <Link to="../.." className="project-switcher__new" onClick={() => setOpen(false)}>
              <Plus className="h-4 w-4" />
              新建
            </Link>
          </div>

          <label className="project-switcher__search">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目名称或主题"
              autoFocus
            />
          </label>

          <div className="project-switcher__list">
            {loading ? (
              <div className="project-switcher__state">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在载入项目…
              </div>
            ) : null}
            {error ? <div className="project-switcher__state is-error">{error}</div> : null}
            {!loading && !error && filteredProjects.length === 0 ? (
              <div className="project-switcher__state">没有找到匹配的项目</div>
            ) : null}
            {filteredProjects.map((item) => {
              const theme = getThemePack(normalizePptExportTheme(item.theme));
              const isCurrent = item.id === project?.id;
              return (
                <Link
                  key={item.id}
                  to={projectEntryPath(item)}
                  className={`project-switcher__item ${isCurrent ? "is-current" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <span
                    className="project-switcher__theme"
                    style={{
                      background: `linear-gradient(145deg, ${theme.tokens.bg} 30%, ${theme.tokens.primary})`
                    }}
                    aria-hidden="true"
                  />
                  <span className="project-switcher__item-copy">
                    <span className="project-switcher__item-name">{item.name}</span>
                    <span className="project-switcher__item-meta">
                      AI 顾问项目 · {item.pageCount} 页 · {formatUpdatedAt(item.updatedAt)}
                    </span>
                  </span>
                  {isCurrent ? <Check className="h-4 w-4 text-primary" aria-label="当前项目" /> : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
