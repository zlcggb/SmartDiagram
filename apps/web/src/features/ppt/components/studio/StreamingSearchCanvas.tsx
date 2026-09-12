import React, { useMemo, useState } from "react";
import {
  Sparkles,
  Search,
  Code2,
  LayoutDashboard,
  FileText,
  Globe,
  ExternalLink,
  CheckCircle2,
  Cpu,
  Layers
} from "lucide-react";
import { parsePartialSlideSearch, type PartialSlideSearch } from "../../lib/partialSearchParser";

interface StreamingSearchCanvasProps {
  delta?: string;
  message?: string;
}

export const StreamingSearchCanvas: React.FC<StreamingSearchCanvasProps> = ({
  delta = "",
  message = "正在智能检索材料与事实证据…"
}) => {
  const [viewMode, setViewMode] = useState<"visual" | "raw">("visual");

  const parsed: PartialSlideSearch = useMemo(() => {
    return parsePartialSlideSearch(delta);
  }, [delta]);

  const charCount = delta.length;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-blue-200/80 bg-gradient-to-b from-blue-50/40 via-white to-white shadow-sm transition-all">
      {/* 顶部状态栏与视图切换器 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100/80 bg-white/70 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.6)]" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-800">
                {message}
              </span>
              {parsed.mode && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100/70 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                  {parsed.mode === "web" ? (
                    <>
                      <Globe className="h-3 w-3 text-emerald-600" />
                      <span>全网实时检索</span>
                    </>
                  ) : (
                    <>
                      <Cpu className="h-3 w-3 text-indigo-600" />
                      <span>深度专家知识库</span>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-slate-500 sm:inline-block">
            {charCount.toLocaleString()} 字符
          </span>

          <div className="flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
                viewMode === "visual"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>动态看板</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
                viewMode === "raw"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>源码流</span>
            </button>
          </div>
        </div>
      </div>

      {/* 视图内容区 */}
      <div className="p-4 sm:p-5">
        {viewMode === "raw" ? (
          /* 源码流视图 */
          <div className="space-y-2">
            <div className="relative max-h-80 overflow-y-auto rounded-xl border border-slate-200/90 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-400 shadow-inner">
              <pre className="whitespace-pre-wrap break-all">
                {delta || "// 等待模型响应流..."}
              </pre>
              <span className="inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle ml-1" />
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Sparkles className="h-3 w-3 text-blue-500" />
              <span>实时原始 JSON 响应流输出中，可随时切回动态看板查看结构化内容</span>
            </p>
          </div>
        ) : (
          /* 动态可视化看板视图 */
          <div className="space-y-4">
            {/* 1. 检索关键词 / 考点探针 */}
            <div className="rounded-xl border border-blue-100 bg-white/80 p-3.5 shadow-xs">
              <div className="flex items-center justify-between gap-2 pb-2 text-xs font-semibold text-slate-700">
                <div className="flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 text-blue-600" />
                  <span>检索考点与方向探针</span>
                </div>
                {parsed.queries.length > 0 && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                    已发掘 {parsed.queries.length} 个考点
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {parsed.queries.length > 0 ? (
                  parsed.queries.map((query, idx) => (
                    <span
                      key={`q-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200/80 bg-blue-50/70 px-2.5 py-1 text-xs text-blue-900 transition-all hover:bg-blue-100/80"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span>{query}</span>
                    </span>
                  ))
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                    <span className="inline-block h-2 w-2 animate-ping rounded-full bg-blue-400" />
                    <span>正在规划多维度检索探针...</span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 论据与材料卡片流 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-indigo-600" />
                  <span>提取中的核心材料与论据</span>
                </div>
                {parsed.results.length > 0 && (
                  <span className="text-[11px] text-slate-500">
                    实时捕获 {parsed.results.length} 条依据
                  </span>
                )}
              </div>

              {parsed.results.length > 0 ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {parsed.results.map((item, idx) => (
                    <div
                      key={`card-${idx}`}
                      className="group relative flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            #{idx + 1} {item.sourceName || "核心论据"}
                          </span>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-blue-600 transition-colors"
                              title="查看来源"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <h4 className="text-xs font-semibold text-slate-800 leading-snug line-clamp-2">
                          {item.title}
                        </h4>
                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                          {item.snippet}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white/50 p-6 text-center">
                  <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <Sparkles className="h-4 w-4 animate-spin" />
                  </div>
                  <p className="mt-2 text-xs font-medium text-slate-700">正在萃取核心事实与支撑材料…</p>
                  <p className="mt-1 text-[11px] text-slate-400">将多源事实转化为结构化卡片</p>
                </div>
              )}
            </div>

            {/* 3. 正在生成的初稿底稿/结论研判 */}
            {(parsed.synthesis?.summary || parsed.synthesis?.draftReference) && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3.5 shadow-xs">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-900 mb-1.5">
                  <FileText className="h-3.5 w-3.5 text-indigo-600" />
                  <span>研判结论与底稿沉淀</span>
                </div>
                {parsed.synthesis.summary && (
                  <p className="text-xs text-indigo-950/80 leading-relaxed mb-2 font-medium">
                    {parsed.synthesis.summary}
                  </p>
                )}
                {parsed.synthesis.draftReference && (
                  <div className="rounded-lg bg-white/90 p-2.5 text-xs text-slate-700 border border-indigo-100/60 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                    {parsed.synthesis.draftReference}
                    <span className="inline-block h-3 w-1.5 animate-pulse bg-indigo-600 align-middle ml-1" />
                  </div>
                )}
              </div>
            )}

            {/* 底部微动效提示 */}
            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-blue-500" />
                <span>知识正在实时流式结构化，完成后将自动进入排版与设计</span>
              </span>
              {parsed.activeStreamTail && (
                <span className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]">
                  {parsed.activeStreamTail}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
