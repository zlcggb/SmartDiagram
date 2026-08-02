import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fitSvgTextToBounds, getThemeSurfacePreset, recolorSvgPreview } from "@ppt-agent/shared";
import { exportThemePreviewBg } from "../../lib/exportMode";

const SVG_WIDTH = 1280;
const SVG_HEIGHT = 720;

interface SelectedSvgText {
  node: SVGTextElement | SVGTSpanElement;
  text: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize: number;
  };
  fontWeight: string;
  fontFamily: string;
  fill: string;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
}

interface SlideSvgCanvasProps {
  svgPreview: string;
  exportTheme: string;
  themeAccentId?: string | null;
  themeSurfaceId?: string | null;
  onSvgChange: (newSvg: string) => void;
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function SlideSvgCanvas({
  svgPreview,
  exportTheme,
  themeAccentId,
  themeSurfaceId,
  onSvgChange,
  readOnly = false,
  className = "",
  style
}: SlideSvgCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [selected, setSelected] = useState<SelectedSvgText | null>(null);
  const [editText, setEditText] = useState("");
  const [svgScale, setSvgScale] = useState(1);

  const themedSvg = useMemo(() => {
    if (!svgPreview) return "";
    try {
      const fitted = fitSvgTextToBounds(svgPreview).svg;
      let svg = recolorSvgPreview(fitted, exportTheme, {
        accentId: themeAccentId ?? undefined
      });
      if (!svg.includes("viewBox")) {
        svg = svg.replace("<svg", `<svg viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" preserveAspectRatio="xMidYMid meet"`);
      }
      return svg;
    } catch {
      return svgPreview;
    }
  }, [svgPreview, exportTheme, themeAccentId]);

  const surfaceFilter = getThemeSurfacePreset(themeSurfaceId ?? undefined).previewFilter;
  const bgColor = exportThemePreviewBg(exportTheme);

  // 监听容器大小，计算真实的自适应缩放比
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setSvgScale(Math.min(width / SVG_WIDTH, height / SVG_HEIGHT));
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (readOnly || !containerRef.current || !svgContainerRef.current) return;

      const target = event.target as Element;
      const textNode = target.closest("text, tspan") as (SVGTextElement | SVGTSpanElement) | null;

      if (!textNode) {
        if (selected) {
          commitEdit();
        }
        return;
      }

      if (selected && selected.node === textNode) return;
      if (selected) {
        commitEdit();
      }

      try {
        // 获取 SVG 内部的原生 1280x720 坐标
        const bbox = textNode.getBBox();

        const rawText = textNode.textContent ?? "";
        const computedStyle = window.getComputedStyle(textNode);
        const attrFontSize = textNode.getAttribute("font-size");
        const rawFontSize = parseFloat(attrFontSize || computedStyle.fontSize || "16") || 16;

        const fontWeight = computedStyle.fontWeight || textNode.getAttribute("font-weight") || "400";
        const fontFamily = computedStyle.fontFamily || textNode.getAttribute("font-family") || "sans-serif";
        const fill = computedStyle.fill !== "none" && computedStyle.fill ? computedStyle.fill : computedStyle.color || "inherit";
        const textAnchor = computedStyle.textAnchor || textNode.getAttribute("text-anchor") || "start";

        const textAlign: "left" | "center" | "right" =
          textAnchor === "middle" ? "center" : textAnchor === "end" ? "right" : "left";

        setSelected({
          node: textNode,
          text: rawText,
          rect: {
            left: bbox.x,
            top: bbox.y,
            width: Math.max(bbox.width, 40),
            height: Math.max(bbox.height, 20),
            fontSize: rawFontSize // 传入未缩放的原生字号，由 CSS Transform 层统一缩放
          },
          fontWeight,
          fontFamily,
          fill,
          textAlign,
          lineHeight: 1.2
        });
        setEditText(rawText);
      } catch {
        // 忽略异常尺寸
      }
    },
    [readOnly, selected]
  );

  useEffect(() => {
    if (!selected) return;
    const node = selected.node;
    const originalOpacity = node.style.opacity;
    node.style.opacity = "0";

    return () => {
      node.style.opacity = originalOpacity;
    };
  }, [selected]);

  const commitEdit = useCallback(() => {
    if (!selected || !svgContainerRef.current) {
      setSelected(null);
      setEditText("");
      return;
    }

    const { node, text: oldText } = selected;
    if (editText.trim() !== oldText.trim()) {
      node.textContent = editText;

      const svgEl = svgContainerRef.current.querySelector("svg");
      if (svgEl) {
        node.style.opacity = "";
        const serializer = new XMLSerializer();
        const updatedSvgStr = serializer.serializeToString(svgEl);
        onSvgChange(updatedSvgStr);
      }
    }

    setSelected(null);
    setEditText("");
  }, [selected, editText, onSvgChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (selected) selected.node.style.opacity = "";
      setSelected(null);
      setEditText("");
    }
  };

  useEffect(() => {
    if (selected && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selected]);

  if (!themedSvg) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 ${className}`} style={style}>
        <span className="text-sm text-gray-400">尚未生成 SVG 预览</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`slide-svg-canvas relative flex items-center justify-center overflow-hidden ${className}`}
      style={{
        ...style,
        background: bgColor
      }}
    >
      <div
        ref={svgContainerRef}
        className="flex h-full w-full items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
        onClick={handleCanvasClick}
        style={{
          filter: surfaceFilter,
          transition: "filter .2s ease",
          cursor: readOnly ? "default" : "text"
        }}
        dangerouslySetInnerHTML={{
          __html: `<svg xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;max-width:100%;max-height:100%;overflow:hidden" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" preserveAspectRatio="xMidYMid meet">${themedSvg.replace(
            /^<svg[^>]*>/i,
            ""
          ).replace(/<\/svg>\s*$/i, "")}</svg>`
        }}
      />

      {/* 重叠层：100% 绝对映射 SVG ViewBox 坐标系 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: SVG_WIDTH,
          height: SVG_HEIGHT,
          marginLeft: -SVG_WIDTH / 2,
          marginTop: -SVG_HEIGHT / 2,
          transform: `scale(${svgScale})`,
          transformOrigin: "center center",
          zIndex: 30
        }}
      >
        {selected && !readOnly && (
          <textarea
            ref={textareaRef}
            className="pointer-events-auto absolute resize-none border border-dashed border-blue-400/80 bg-transparent p-0 outline-none focus:ring-0"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            style={{
              left: selected.rect.left,
              top: selected.rect.top,
              width: selected.rect.width,
              minHeight: selected.rect.height + selected.rect.fontSize,
              fontSize: selected.rect.fontSize,
              fontWeight: selected.fontWeight,
              fontFamily: selected.fontFamily,
              color: selected.fill !== "inherit" ? selected.fill : "inherit",
              textAlign: selected.textAlign,
              lineHeight: selected.lineHeight,
              background: "transparent",
              overflow: "hidden"
            }}
          />
        )}
      </div>
    </div>
  );
}
