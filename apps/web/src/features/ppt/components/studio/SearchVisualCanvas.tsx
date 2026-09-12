import React, { useState } from "react";
import {
  Globe,
  Cpu,
  Search,
  ExternalLink,
  CheckCircle2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Lightbulb,
  FileCheck,
  Bookmark,
  Layers
} from "lucide-react";
import type { SlideSearchJson, SearchReferenceForDraft } from "@ppt-agent/shared";

interface SearchVisualCanvasProps {
  searchJson?: SlideSearchJson | null;
  draftResearch?: SearchReferenceForDraft | null;
}

export const SearchVisualCanvas: React.FC<SearchVisualCanvasProps> = ({
  searchJson,
  draftResearch
}) => {
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [showFullDraft, setShowFullDraft] = useState(false);
  const [highlightedSourceIndex, setHighlightedSourceIndex] = useState<number | null>(null);

  if (!searchJson && !draftResearch) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
        <p className="text-sm font-medium text-slate-500">尚未检索</p>
        <p className="mt-1 text-xs text-slate-400">点击上方“检索本页”后，提炼的内容会以结构化看板显示在这里。</p>
      </div>
    );
  }

  const mode = searchJson?.mode ?? "ai-knowledge";
  const queries = searchJson?.queries ?? [];
  const results = searchJson?.results ?? [];
  const synthesis = searchJson?.synthesis;
  const caveats = synthesis?.caveats ?? draftResearch?.caveats ?? [];

  const handleCopyDraft = async () => {
    const textToCopy = draftResearch?.draftReference || synthesis?.draftReference || "";
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedDraft(true);
      setTimeout(() => setCopiedDraft(false), 2000);
    } catch {
      // 剪贴板异常回退
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {/* 1. 顶部检索看板 Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-blue-50/30 p-4 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
            <FileCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800">检索与论据看板</h3>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  mode === "web"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border border-indigo-200 bg-indigo-50 text-indigo-700"
                }`}
              >
                {mode === "web" ? (
                  <>
                    <Globe className="h-3 w-3" />
                    <span>全网权威联网检索</span>
                  </>
                ) : (
                  <>
                    <Cpu className="h-3 w-3" />
                    <span>领域专家知识网络</span>
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              已收录 {queries.length} 项考点探针，整理 {results.length} 条论据依据
            </p>
          </div>
        </div>

        {/* 复制底稿按钮 */}
        {(draftResearch?.draftReference || synthesis?.draftReference) && (
          <button
            type="button"
            onClick={handleCopyDraft}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
          >
            {copiedDraft ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-700">已复制底稿</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-slate-500" />
                <span>复制研究底稿</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* 2. 检索方向与考点探针 (Queries 标签云) */}
      {queries.length > 0 && (
        <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
            <Search className="h-3.5 w-3.5 text-blue-600" />
            <span>核心考点与探针方向</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {queries.map((query, idx) => (
              <span
                key={`q-cloud-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/50"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                <span>{query}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 3. 核心研判与综合回答 (Key Findings & Summary) */}
      {(draftResearch?.summary || synthesis?.summary || (synthesis?.keyFindings && synthesis.keyFindings.length > 0)) && (
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/50 via-white to-white p-4 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900">核心研判与综合回答</h4>
          </div>

          {/* 综合摘要 */}
          {(synthesis?.summary || draftResearch?.summary) && (
            <p className="text-xs leading-relaxed font-medium text-slate-800 bg-white/90 p-3 rounded-xl border border-blue-50 shadow-2xs">
              {synthesis?.summary || draftResearch?.summary}
            </p>
          )}

          {/* 结构化结论列表 (带溯源角标) */}
          {synthesis?.keyFindings && synthesis.keyFindings.length > 0 && (
            <div className="space-y-2 pt-1">
              {synthesis.keyFindings.map((finding, idx) => (
                <div
                  key={`finding-${idx}`}
                  className="flex items-start gap-2 text-xs text-slate-700 leading-relaxed"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <span>{finding.statement}</span>
                    {finding.sourceIndexes && finding.sourceIndexes.length > 0 && (
                      <span className="inline-flex items-center gap-1 ml-1.5">
                        {finding.sourceIndexes.map((sIdx) => (
                          <button
                            key={`kf-${idx}-src-${sIdx}`}
                            type="button"
                            onMouseEnter={() => setHighlightedSourceIndex(sIdx)}
                            onMouseLeave={() => setHighlightedSourceIndex(null)}
                            className={`rounded px-1.5 py-0.2 text-[10px] font-mono font-medium transition-colors ${
                              highlightedSourceIndex === sIdx
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-blue-600 hover:bg-blue-100"
                            }`}
                            title={`关联论据 #${sIdx}`}
                          >
                            #{sIdx}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. 核心论据与支撑材料网格 (Results) */}
      {results.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Layers className="h-3.5 w-3.5 text-indigo-600" />
              <span>提取的事实证据与材料 ({results.length})</span>
            </div>
            <span className="text-[11px] text-slate-400">已核验并注入本页逻辑链路</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {results.map((card, index) => {
              const cardIndex = index + 1;
              const isHighlighted = highlightedSourceIndex === cardIndex;

              return (
                <div
                  key={`result-${index}`}
                  className={`relative flex flex-col justify-between rounded-xl border p-3.5 shadow-xs transition-all ${
                    isHighlighted
                      ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20"
                      : "border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                            isHighlighted
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          <Bookmark className="h-2.5 w-2.5" />
                          <span>#{cardIndex}</span>
                        </span>
                        {card.sourceName && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            {card.sourceName}
                          </span>
                        )}
                      </div>

                      {card.url && (
                        <a
                          href={card.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-600 transition-colors"
                          title="查看原始来源网页"
                        >
                          <span className="hidden sm:inline text-[10px]">原链</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <h5 className="text-xs font-semibold text-slate-800 leading-snug">
                      {card.title}
                    </h5>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">
                      {card.snippet}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. 提示/边界事项 Caveats */}
      {caveats.length > 0 && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 shadow-2xs">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span>审阅注意事项</span>
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-800">
            {caveats.map((c, idx) => (
              <li key={`caveat-${idx}`}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 6. 初稿底稿全文 (支持展开折叠) */}
      {(draftResearch?.draftReference || synthesis?.draftReference) && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs">
          <button
            type="button"
            onClick={() => setShowFullDraft(!showFullDraft)}
            className="flex w-full items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>AI 研究参考底稿全文</span>
              <span className="text-[10px] font-normal text-slate-400">
                （供排版与设计阶段作为事实基准）
              </span>
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-[11px]">{showFullDraft ? "收起" : "展开全文"}</span>
              {showFullDraft ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </div>
          </button>

          {showFullDraft && (
            <div className="border-t border-slate-100 bg-slate-50/50 p-4">
              <p className="whitespace-pre-line text-xs leading-relaxed text-slate-700 font-normal selection:bg-blue-100">
                {draftResearch?.draftReference || synthesis?.draftReference}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
