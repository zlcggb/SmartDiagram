import { useMemo, useState, useRef, useEffect } from "react";
import { Sparkles, Code2, LayoutDashboard, Compass, Lightbulb, CheckCircle2 } from "lucide-react";
import { parsePartialSlidePlan } from "../../lib/partialJsonParser";

interface StreamingDraftCanvasProps {
  /** 当前 SSE 推送的累积流式字符串 */
  delta: string;
  /** 阶段提示文字，如「正在策划…」 */
  message?: string;
  /** 当前页面的备选标题（用于初始占位） */
  fallbackTitle?: string;
}

export function StreamingDraftCanvas({
  delta,
  message,
  fallbackTitle
}: StreamingDraftCanvasProps) {
  const [viewMode, setViewMode] = useState<"card" | "raw">("card");
  const codeEndRef = useRef<HTMLDivElement>(null);

  const partial = useMemo(() => parsePartialSlidePlan(delta), [delta]);

  useEffect(() => {
    if (viewMode === "raw") {
      codeEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [delta, viewMode]);

  const displayTitle = partial.title || fallbackTitle || "正在构思本页标题…";
  const isTitleStreaming = Boolean(partial.title);

  return (
    <div className="streaming-draft-canvas mt-5 overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.1)] bg-white/95 shadow-sm transition-all">
      {/* 顶部流式控制栏 */}
      <div className="flex flex-wrap items-center justify-between border-b border-[rgba(0,0,0,0.08)] bg-gradient-to-r from-blue-50/60 via-indigo-50/40 to-white px-5 py-3.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[rgba(0,0,0,0.85)]">
              {message || "AI 正在实时策划与排版初稿…"}
            </span>
            <span className="rounded-full bg-blue-100/70 px-2 py-0.5 font-mono text-[10px] font-medium text-blue-800">
              {delta.length.toLocaleString()} 字符
            </span>
          </div>
        </div>

        {/* 视图切换：排版预览 vs 源码流 */}
        <div className="flex items-center gap-1 rounded-lg bg-[rgba(0,0,0,0.05)] p-0.5">
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              viewMode === "card"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-[rgba(0,0,0,0.55)] hover:text-[rgba(0,0,0,0.9)]"
            }`}
            onClick={() => setViewMode("card")}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>实时排版</span>
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              viewMode === "raw"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-[rgba(0,0,0,0.55)] hover:text-[rgba(0,0,0,0.9)]"
            }`}
            onClick={() => setViewMode("raw")}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>源码流</span>
          </button>
        </div>
      </div>

      {/* 主体渲染区 */}
      {viewMode === "raw" ? (
        /* 源码流视图 */
        <div className="relative h-[480px] overflow-auto bg-[#1e1e24] p-4 font-mono text-xs leading-relaxed text-[#dcdfe4]">
          <div className="sticky top-0 mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-[10px] text-gray-400">
            <span>STREAMING JSON OUTPUT</span>
            <span className="text-blue-400">LIVE</span>
          </div>
          <pre className="whitespace-pre-wrap break-all">{delta || "// 等待模型返回 Token 流…"}</pre>
          <span className="inline-block h-4 w-1.5 animate-pulse bg-blue-400 align-middle ml-1" />
          <div ref={codeEndRef} />
        </div>
      ) : (
        /* 实时动态排版卡片视图 */
        <div className="p-6 space-y-6">
          {/* 1. 标题区 */}
          <div className="space-y-1.5 border-b border-[rgba(0,0,0,0.06)] pb-4">
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-blue-600 uppercase">
              <Sparkles className="h-3 w-3 animate-spin" style={{ animationDuration: "3s" }} />
              <span>本页主标题</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[rgba(0,0,0,0.92)]">
              {displayTitle}
              {isTitleStreaming ? (
                <span className="ml-1 inline-block h-5 w-2 animate-pulse bg-blue-600 align-middle" />
              ) : null}
            </h1>
          </div>

          {/* 2. 核心结论横幅 */}
          {partial.keyMessage ? (
            <div className="flex items-start gap-3 rounded-xl border border-blue-200/70 bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-blue-50/30 p-4 shadow-xs">
              <Lightbulb className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-blue-900 mb-0.5">核心观点结论</div>
                <p className="text-sm font-medium leading-relaxed text-blue-950">
                  {partial.keyMessage}
                </p>
              </div>
            </div>
          ) : (
            /* 结论骨架等待条 */
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-3.5 text-xs text-gray-400 animate-pulse">
              <span className="h-4 w-4 rounded-full bg-gray-200" />
              <span>正在推导核心观点与关键结论…</span>
            </div>
          )}

          {/* 3. 内容模块卡片网格 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[rgba(0,0,0,0.7)]">
                内容模块 ({partial.contentBlocks.length} 个已构思)
              </span>
              {partial.layoutType ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-[rgba(0,0,0,0.08)] bg-[rgba(0,0,0,0.03)] px-2 py-0.5 text-[11px] font-medium text-[rgba(0,0,0,0.65)]">
                  <Compass className="h-3 w-3 text-blue-600" />
                  <span>建议版式：{partial.layoutType}</span>
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {partial.contentBlocks.map((block, idx) => (
                <div
                  key={idx}
                  className="flex flex-col rounded-xl border border-[rgba(0,0,0,0.1)] bg-white p-4 shadow-xs transition hover:shadow-md"
                >
                  <div className="mb-2.5 flex items-center justify-between border-b border-[rgba(0,0,0,0.05)] pb-2">
                    <h3 className="text-sm font-semibold text-[rgba(0,0,0,0.85)]">
                      {block.title}
                    </h3>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                      模块 {idx + 1}
                    </span>
                  </div>

                  <ul className="flex-1 space-y-2 text-xs leading-relaxed text-[rgba(0,0,0,0.75)]">
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-500 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* 正在生成的下一卡片骨架提示 */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-blue-200/80 bg-blue-50/20 p-6 text-center text-xs text-blue-600/80 animate-pulse">
                <Sparkles className="h-5 w-5 mb-2 text-blue-500" />
                <span className="font-medium">
                  {partial.contentBlocks.length === 0
                    ? "正在策划生成第一组内容模块…"
                    : "正在构思下一模块要点…"}
                </span>
                <span className="mt-1 text-[11px] text-gray-400">大模型实时构建中</span>
              </div>
            </div>
          </div>

          {/* 4. 设计交接与视觉指南 */}
          {partial.designGuide ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 text-xs text-emerald-950">
              <div className="font-semibold text-emerald-900 mb-1 flex items-center gap-1.5">
                <Compass className="h-3.5 w-3.5 text-emerald-600" />
                <span>AI 视觉构想指南</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-emerald-900/85">
                {partial.designGuide.composition ? (
                  <div>
                    <span className="font-medium">构图：</span>
                    {partial.designGuide.composition}
                  </div>
                ) : null}
                {partial.designGuide.background ? (
                  <div>
                    <span className="font-medium">背景色彩：</span>
                    {partial.designGuide.background}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
