import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchVideoDocContent,
  fetchVideoDocsList,
  type VideoDocCategory,
  type VideoDocContentResponse,
} from '../lib/api';
import { extractHeadings, renderMarkdown } from '../lib/markdown';

interface ZoomDiagramState {
  title: string;
  html: string;
}

function formatTime(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VideoDocsPage() {
  const { docPath: routeDocPath } = useParams<{ docPath?: string }>();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<VideoDocCategory[]>([]);
  const [currentDoc, setCurrentDoc] = useState<VideoDocContentResponse>({
    path: '',
    filename: '',
    title: '',
    content: '',
    modified_at: null,
  });
  const [contentLoading, setContentLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [zoomDiagram, setZoomDiagram] = useState<ZoomDiagramState | null>(null);

  const contentScrollRef = useRef<HTMLElement | null>(null);
  const markdownBodyRef = useRef<HTMLDivElement | null>(null);

  const headings = useMemo(() => {
    if (!currentDoc.content) return [];
    return extractHeadings(currentDoc.content);
  }, [currentDoc.content]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        items: (cat.items || []).filter(
          (item) =>
            item.title?.toLowerCase().includes(q) || item.path?.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, searchQuery]);

  const wordCount = currentDoc.content ? currentDoc.content.length : 0;
  const readTimeMin = Math.max(1, Math.ceil(wordCount / 400));

  const loadDocContent = useCallback(async (docPath: string) => {
    if (!docPath) return;
    setContentLoading(true);
    setError('');
    try {
      const data = await fetchVideoDocContent(docPath);
      setCurrentDoc(data);
      if (contentScrollRef.current) {
        contentScrollRef.current.scrollTop = 0;
      }
    } catch (err: any) {
      setError(err?.message || `未找到文档: ${docPath}`);
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const listRes = await fetchVideoDocsList();
        if (cancelled) return;
        setCategories(listRes.categories || []);
        const target = routeDocPath
          ? decodeURIComponent(routeDocPath)
          : listRes.default_doc || '产品发布会说明书与架构全景.md';
        await loadDocContent(target);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || '获取文档列表失败');
          setContentLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeDocPath, loadDocContent]);

  useEffect(() => {
    if (headings.length > 0) {
      setActiveHeadingId(headings[0].id);
    } else {
      setActiveHeadingId('');
    }
  }, [headings]);

  const handleSelectDoc = (path: string) => {
    setMobileNavOpen(false);
    navigate(`/video/docs/${encodeURIComponent(path)}`);
  };

  const scrollToHeading = (id: string) => {
    setActiveHeadingId(id);
    const container = contentScrollRef.current;
    if (!container) return;
    const el = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleContentScroll = () => {
    const container = contentScrollRef.current;
    if (!container || headings.length === 0) return;
    const scrollTop = container.scrollTop + 96;
    for (let i = headings.length - 1; i >= 0; i--) {
      const h = headings[i];
      const el = container.querySelector(`#${CSS.escape(h.id)}`) as HTMLElement | null;
      if (el && el.offsetTop <= scrollTop) {
        setActiveHeadingId(h.id);
        return;
      }
    }
    setActiveHeadingId(headings[0]?.id || '');
  };

  const handleCopyDocContent = async () => {
    if (!currentDoc.content) return;
    try {
      await navigator.clipboard.writeText(currentDoc.content);
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleMarkdownClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // 1. 支持代码块一键复制按钮
    const copyBtn = target.closest('[data-copy-code]') as HTMLButtonElement | null;
    if (copyBtn) {
      e.stopPropagation();
      const rawEncoded = copyBtn.getAttribute('data-copy-code') || '';
      try {
        const decoded = decodeURIComponent(rawEncoded);
        navigator.clipboard?.writeText(decoded);
        const origHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = '<span class="text-emerald-400">✓ 已复制代码</span>';
        window.setTimeout(() => {
          copyBtn.innerHTML = origHtml;
        }, 1800);
      } catch {
        // ignore
      }
      return;
    }

    // 2. 点击 SVG 架构图全屏放大
    const svg = target.closest('svg');
    if (!svg || target.closest('button, a, summary')) return;
    const block = svg.closest('.not-prose');
    const title =
      block?.querySelector('.uppercase')?.textContent?.trim() ||
      currentDoc.title ||
      '架构全景图';
    setZoomDiagram({
      title,
      html: svg.outerHTML,
    });
  };

  const renderedHtml = useMemo(
    () => renderMarkdown(currentDoc.content || ''),
    [currentDoc.content],
  );

  // 自动将文档中的 ```mermaid 围栏块渲染为真实可缩放 SVG 矢量架构图
  useEffect(() => {
    const root = markdownBodyRef.current;
    if (!root || !renderedHtml) return;
    const slots = Array.from(
      root.querySelectorAll<HTMLElement>('.mermaid-render-slot[data-mermaid-source]'),
    );
    if (slots.length === 0) return;

    let cancelled = false;
    import('mermaid')
      .then(async (mMod) => {
        if (cancelled) return;
        const mermaid = mMod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'loose',
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        });
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (slot.dataset.rendered === '1') continue;
          const src = decodeURIComponent(slot.getAttribute('data-mermaid-source') || '');
          if (!src) continue;
          try {
            const id = `vidgrab-doc-mmd-${Date.now()}-${i}`;
            const { svg } = await mermaid.render(id, src);
            if (!cancelled) {
              slot.innerHTML = svg;
              slot.dataset.rendered = '1';
            }
          } catch {
            // 保留原始文本回退
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [renderedHtml]);

  return (
    <div className="relative flex min-h-0 flex-1 w-full overflow-hidden bg-[#f2f2f7] text-slate-900 lg:bg-[#f5f5f7]">
      {/* ================= 1. 左侧分类目录树 ================= */}
      <aside
        className={`fixed top-12 bottom-13 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur-xl transition-transform duration-300 lg:static lg:h-full lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="shrink-0 p-4 pb-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px] font-bold tracking-tight text-slate-900">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0071e3]/10 text-xs text-[#0071e3]">
                📚
              </span>
              <span>技术文档中心 Docs</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
            >
              ✕
            </button>
          </div>

          <div className="relative">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              type="text"
              placeholder="搜索架构、ASR、Jeff 或运维文档…"
              className="w-full rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-1.5 pl-8 text-[12px] text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#0071e3] focus:bg-white focus:ring-2 focus:ring-[#0071e3]/15"
            />
            <span className="pointer-events-none absolute left-2.5 top-2 text-xs text-slate-400">
              🔍
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-4 text-xs">
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="space-y-1">
              <div className="px-2 font-mono text-[10.5px] font-bold tracking-wider text-slate-400 uppercase">
                {cat.title}
              </div>
              <ul className="space-y-0.5">
                {cat.items.map((item) => {
                  const isActive =
                    currentDoc.path === item.path || currentDoc.filename === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        onClick={() => handleSelectDoc(item.path)}
                        className={`group flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[12px] transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#0071e3]/10 font-semibold text-[#0071e3] shadow-2xs'
                            : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
                        }`}
                      >
                        <span className="truncate">{item.title}</span>
                        {isActive && (
                          <span className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0071e3]" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {filteredCategories.length === 0 && (
            <div className="py-8 text-center text-slate-400">未找到匹配的文档</div>
          )}
        </nav>

        <div className="shrink-0 border-t border-slate-200/80 bg-slate-50/70 p-3 space-y-1 text-xs">
          <Link
            to="/video/changelog"
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 transition hover:bg-white hover:text-[#0071e3]"
          >
            <span>🚀</span>
            <span>查看版本演进 (Changelog v2.7.0)</span>
          </Link>
          <Link
            to="/video"
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 transition hover:bg-white hover:text-[#0071e3]"
          >
            <span>🎬</span>
            <span>返回视频学习工作台</span>
          </Link>
        </div>
      </aside>

      {mobileNavOpen && (
        <div
          className="fixed inset-x-0 top-12 bottom-0 z-30 bg-slate-900/25 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* ================= 2. 中间主阅读区 ================= */}
      <main
        ref={contentScrollRef}
        onScroll={handleContentScroll}
        className="flex-1 min-w-0 h-full overflow-y-auto px-4 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10 scroll-smooth"
      >
        <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-10">
          {/* 移动端目录切换按钮 */}
          <div className="mb-4 flex items-center justify-between border-b border-slate-200/70 pb-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800"
            >
              <span>📑</span>
              <span>切换文档目录</span>
            </button>
            <span className="max-w-[200px] truncate text-xs text-slate-500">
              {currentDoc.title}
            </span>
          </div>

          {contentLoading ? (
            <div className="space-y-4 py-10 animate-pulse">
              <div className="h-8 w-2/3 rounded-xl bg-slate-200/70" />
              <div className="h-4 w-1/3 rounded-lg bg-slate-100" />
              <div className="mt-8 space-y-3">
                <div className="h-4 w-full rounded bg-slate-100" />
                <div className="h-4 w-full rounded bg-slate-100" />
                <div className="h-4 w-4/5 rounded bg-slate-100" />
              </div>
            </div>
          ) : error ? (
            <div className="my-8 rounded-2xl border border-rose-200 bg-rose-50/60 p-6 text-center">
              <div className="mb-2 text-3xl">⚠️</div>
              <h2 className="mb-1 text-base font-bold text-rose-600">加载文档失败</h2>
              <p className="mb-4 text-xs text-rose-500">{error}</p>
              <button
                type="button"
                onClick={() => loadDocContent(currentDoc.path || '系统架构与技术全景.md')}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 cursor-pointer"
              >
                重新加载
              </button>
            </div>
          ) : (
            <article className="pb-16">
              {/* 文档头部元数据 */}
              <div className="mb-6 border-b border-slate-200/80 pb-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#0071e3]">
                      Architecture & Spec
                    </span>
                    {currentDoc.modified_at && (
                      <span className="text-xs text-slate-500">
                        最后更新：{formatTime(currentDoc.modified_at)}
                      </span>
                    )}
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                      💡 点击文内任意 SVG 架构图可全屏放大检视
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyDocContent}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs transition hover:bg-slate-100 active:scale-95 cursor-pointer"
                  >
                    <span>{copySuccess ? '✓ 已复制 Markdown' : '📋 复制 Markdown'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>共 {wordCount.toLocaleString()} 字</span>
                  <span>·</span>
                  <span>预计阅读 {readTimeMin} 分钟</span>
                  <span>·</span>
                  <span className="font-mono text-slate-600">
                    docs/video/{currentDoc.filename || currentDoc.path}
                  </span>
                </div>
              </div>

              {/* Markdown + 原生 SVG 渲染区 */}
              <div
                ref={markdownBodyRef}
                onClick={handleMarkdownClick}
                className="video-docs-markdown min-w-0 max-w-none break-words text-[14px] leading-relaxed text-slate-800 [&_svg]:cursor-zoom-in [&_svg]:max-w-full [&_svg]:h-auto"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </article>
          )}
        </div>
      </main>

      {/* ================= 3. 右侧本页大纲导航 ================= */}
      <aside className="hidden xl:flex w-64 shrink-0 flex-col border-l border-slate-200/80 bg-white/80 py-6 px-4">
        <div className="mb-3 flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-wider text-slate-400 uppercase shrink-0">
          <span>📑</span>
          <span>本页大纲 ON THIS PAGE</span>
        </div>

        {headings.length > 0 ? (
          <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 text-xs">
            {headings.map((h, idx) => (
              <button
                key={`${h.id}-${idx}`}
                type="button"
                style={{ paddingLeft: `${Math.max(0, h.level - 1) * 0.7}rem` }}
                onClick={() => scrollToHeading(h.id)}
                className={`block w-full truncate rounded-lg py-1 px-2 text-left text-[12px] transition-colors cursor-pointer ${
                  activeHeadingId === h.id
                    ? 'bg-[#0071e3]/10 font-bold text-[#0071e3]'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {h.title}
              </button>
            ))}
          </nav>
        ) : (
          <p className="flex-1 text-xs italic text-slate-400">当前文档无多级章节大纲</p>
        )}

        <div className="pt-4 border-t border-slate-200/80 shrink-0">
          <button
            type="button"
            onClick={() => contentScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-[#0071e3] cursor-pointer"
          >
            <span>↑</span>
            <span>返回文档顶部</span>
          </button>
        </div>
      </aside>

      {/* ================= SVG 架构图全屏放大检视 Modal ================= */}
      {zoomDiagram && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-md"
          onClick={() => setZoomDiagram(null)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0071e3]/10 text-xs text-[#0071e3]">
                  🏛️
                </span>
                <span className="truncate text-[14px] font-bold text-slate-900">
                  {zoomDiagram.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setZoomDiagram(null)}
                className="rounded-full bg-slate-200/80 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300 cursor-pointer"
              >
                关闭 ESC ✕
              </button>
            </div>
            <div
              className="flex-1 overflow-auto p-6 bg-slate-50/50 [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: zoomDiagram.html }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
