import { useMemo } from "react";
import {
  fitSvgTextToBounds,
  getThemeSurfacePreset,
  recolorSvgPreview
} from "@ppt-agent/shared";
import { exportThemePreviewBg } from "../../lib/exportMode";

interface SlideThumbnailProps {
  svgPreview?: string | null;
  exportTheme: string;
  themeAccentId?: string | null;
  themeSurfaceId?: string | null;
}

/**
 * 渲染 SVG 缩略图。使用 16:9 固定比例容器 + 缩小的 SVG 内嵌。
 * 未生成设计稿时显示占位灰底。
 */
export function SlideThumbnail({
  svgPreview,
  exportTheme,
  themeAccentId,
  themeSurfaceId
}: SlideThumbnailProps) {
  const themedSvg = useMemo(() => {
    if (!svgPreview) return null;
    try {
      const fitted = fitSvgTextToBounds(svgPreview).svg;
      return recolorSvgPreview(fitted, exportTheme, {
        accentId: themeAccentId ?? undefined
      });
    } catch {
      return svgPreview;
    }
  }, [svgPreview, exportTheme, themeAccentId]);

  const surfaceFilter = getThemeSurfacePreset(themeSurfaceId ?? undefined)
    .previewFilter;
  const bgColor = exportThemePreviewBg(exportTheme);

  if (!themedSvg) {
    return (
      <div
        className="aspect-video w-full rounded-lg bg-[rgba(0,0,0,0.04)]"
        style={{ minHeight: 0 }}
      >
        <div className="flex h-full items-center justify-center">
          <span className="text-[9px] text-[rgba(0,0,0,0.3)]">未生成</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="aspect-video w-full overflow-hidden rounded-lg"
      style={{ background: bgColor, minHeight: 0 }}
    >
      <div
        className="h-full w-full"
        style={{ filter: surfaceFilter, transition: "filter .2s ease" }}
        // 缩略图使用 dangerouslySetInnerHTML 而非 iframe，
        // 避免多个 iframe 的性能开销。pointer-events: none 防止交互干扰。
        dangerouslySetInnerHTML={{
          __html: `<svg xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;overflow:hidden;pointer-events:none" viewBox="0 0 1280 720">${
            themedSvg.replace(
              /^<svg[^>]*>/i,
              ""
            ).replace(/<\/svg>\s*$/i, "")
          }</svg>`
        }}
      />
    </div>
  );
}
