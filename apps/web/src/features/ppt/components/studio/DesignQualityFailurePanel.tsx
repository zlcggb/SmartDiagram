import { useMemo, useState } from "react";
import { AlertTriangle, Code2, Eye, X } from "lucide-react";
import type { SvgQualityFailureDto } from "@ppt-agent/shared";
import { highlightRejectedSvg } from "./designQualityFailure";

type FailureView = "preview" | "code";

const TEXT_TAG_RE = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;

function plainSvgText(value: string) {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function issueRows(svg: string, issues: string[]) {
  const textNodes = [...svg.matchAll(TEXT_TAG_RE)].map((match) =>
    plainSvgText(match[1] ?? "")
  );
  return issues.flatMap((issue, issueIndex) => {
    const indexes = [
      ...issue.matchAll(/第\s*(\d+)\s*个\s*text/gu)
    ].map((match) => Number(match[1]));
    if (indexes.length === 0) {
      return [{ key: `issue-${issueIndex}`, label: `检查项 ${issueIndex + 1}`, issue }];
    }
    return indexes.map((index) => ({
      key: `issue-${issueIndex}-text-${index}`,
      label: `文字 ${index} · ${textNodes[index - 1]?.slice(0, 32) || "未识别文字内容"}`,
      issue
    }));
  });
}

export function DesignQualityFailurePanel({
  failure,
  onDismiss
}: {
  failure: SvgQualityFailureDto;
  onDismiss: () => void;
}) {
  const [view, setView] = useState<FailureView>("preview");
  const rows = useMemo(
    () => issueRows(failure.svgPreview, failure.issues),
    [failure.issues, failure.svgPreview]
  );
  const highlightedSvg = useMemo(
    () => highlightRejectedSvg(failure.svgPreview, failure.issues),
    [failure.issues, failure.svgPreview]
  );
  const previewDocument = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>` +
      "html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff8f5;overflow:hidden}" +
      "svg{display:block;width:100%;height:100%;overflow:hidden}" +
      'text[data-quality-issue="true"]{paint-order:stroke;stroke:#ef4444;stroke-width:5px;stroke-opacity:.5}' +
      "</style></head><body>" +
      highlightedSvg +
      "</body></html>",
    [highlightedSvg]
  );

  return (
    <section
      className="mb-4 overflow-hidden rounded-xl border border-amber-300 bg-amber-50/70"
      aria-label="未采用设计稿的质量诊断"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-200 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-amber-950">新稿未采用</h3>
            <p className="mt-0.5 text-xs leading-5 text-amber-800">
              已自动尝试 {failure.attemptCount} 次，仍有 {rows.length} 处需要调整；当前正式版本未被覆盖。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="inline-flex rounded-lg border border-amber-200 bg-white/80 p-0.5"
            role="tablist"
            aria-label="失败稿查看方式"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "preview"}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                view === "preview" ? "bg-amber-900 text-white" : "text-amber-900"
              }`}
              onClick={() => setView("preview")}
            >
              <Eye className="h-3.5 w-3.5" />
              问题预览
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "code"}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                view === "code" ? "bg-amber-900 text-white" : "text-amber-900"
              }`}
              onClick={() => setView("code")}
            >
              <Code2 className="h-3.5 w-3.5" />
              失败源码
            </button>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-amber-800 hover:bg-amber-100"
            aria-label="关闭质量诊断"
            title="关闭质量诊断"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_250px]">
        {view === "preview" ? (
          failure.svgPreview ? (
            <iframe
              title="未采用设计稿问题预览"
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[320px] w-full rounded-lg border border-amber-200 bg-white"
              srcDoc={previewDocument}
            />
          ) : (
            <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-amber-300 bg-white text-sm text-amber-800">
              服务未返回失败候选稿，请重新生成后查看。
            </div>
          )
        ) : (
          <pre className="h-[320px] overflow-auto rounded-lg border border-amber-200 bg-slate-950 px-4 py-3 font-mono text-[11px] leading-5 text-slate-100">
            {failure.svgPreview || "<!-- 未返回失败候选 SVG -->"}
          </pre>
        )}

        <div className="max-h-[320px] space-y-2 overflow-auto">
          {rows.map((row) => (
            <div key={row.key} className="rounded-lg border border-amber-200 bg-white px-3 py-2">
              <p className="text-xs font-semibold text-slate-900">{row.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{row.issue}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
