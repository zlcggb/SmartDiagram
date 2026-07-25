import { useMemo } from "react";
import { fitSvgTextToBounds, getThemeSurfacePreset, recolorSvgPreview } from "@ppt-agent/shared";
import DOMPurify from "dompurify";
import { useWorkbenchStore } from "../../store/workbenchStore";

interface LiveSvgPreviewProps {
  slideId: string | null;
}

function tryCompleteSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  if (start < 0) return null;

  let svg = text.slice(start);
  if (!svg.includes("</svg>")) {
    svg = `${svg}</svg>`;
  }

  // 去掉 markdown 代码块残留
  svg = svg.replace(/```(?:svg|xml)?/gi, "").replace(/```/g, "").trim();
  
  // XSS 消毒，保留 SVG 相关的标签，剥离 script 标签
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
}

export function LiveSvgPreview({ slideId }: LiveSvgPreviewProps) {
  const progressStages = useWorkbenchStore((s) => s.progressStages);
  const exportTheme = useWorkbenchStore((s) => s.exportTheme);
  const themeAccentId = useWorkbenchStore((s) => s.themeAccentId);
  const themeSurfaceId = useWorkbenchStore((s) => s.themeSurfaceId);

  const designStage = progressStages["design"];
  const designSlideId = designStage?.slideId ?? null;
  const delta = designStage?.delta ?? "";

  const status = designStage?.status;
  const isOtherSlide = Boolean(slideId && designSlideId && designSlideId !== slideId);

  const renderedSvg = useMemo(() => {
    if (isOtherSlide) return null;
    const svg = tryCompleteSvg(delta);
    if (!svg) return null;

    try {
      const fitted = fitSvgTextToBounds(svg);
      return recolorSvgPreview(fitted.svg, exportTheme, { accentId: themeAccentId });
    } catch {
      return svg;
    }
  }, [delta, exportTheme, isOtherSlide, themeAccentId]);

  const surfacePreviewFilter = getThemeSurfacePreset(themeSurfaceId).previewFilter;

  if (isOtherSlide) {
    return (
      <div className="rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white p-4 shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)]">
        <h3 className="text-xs font-medium text-[rgba(0,0,0,0.9)]">实时设计稿</h3>
        <p className="mt-2 text-xs text-[rgba(0,0,0,0.45)]">正在生成其他页面的设计稿</p>
      </div>
    );
  }

  if (!renderedSvg) {
    const showWaiting = status === "running";
    return (
      <div className="rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white p-4 shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)]">
        <h3 className="text-xs font-medium text-[rgba(0,0,0,0.9)]">实时设计稿</h3>
        <p className="mt-2 text-xs text-[rgba(0,0,0,0.45)]">
          {showWaiting ? "正在等待设计稿流…" : "生成设计稿后，这里会实时展示 SVG 预览"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white p-4 shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)]">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-[rgba(0,0,0,0.9)]">实时设计稿</h3>
        <span className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 text-[10px] text-[rgba(0,0,0,0.6)]">
          {status === "running" ? "生成中" : status === "done" ? "已完成" : status === "error" ? "失败" : "流式预览"}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-[rgba(0,0,0,0.08)] bg-[rgba(0,0,0,0.02)]">
        <iframe
          key={`live-svg-${slideId ?? "none"}`}
          title="live-svg-preview"
          className="h-[180px] w-full bg-transparent"
          srcDoc={`<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:transparent;overflow:hidden}svg{display:block;width:100%;height:100%;overflow:hidden;filter:${surfacePreviewFilter};transition:filter .2s ease}</style></head><body>${renderedSvg}</body></html>`}
        />
      </div>
    </div>
  );
}
