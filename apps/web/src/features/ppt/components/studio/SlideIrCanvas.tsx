import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  renderSlideIrToSvg,
  SMARTSLIDE_WIDTH,
  SMARTSLIDE_HEIGHT
} from "@ppt-agent/slide-ir";
import type { SlideIrDocument, TextElement } from "@ppt-agent/slide-ir";

interface SelectedTextElement {
  elementId: string;
  element: TextElement;
  text: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize: number;
    color: string;
    fontFamily: string;
    fontWeight: string | number;
    lineHeight: number;
  };
}

interface SlideIrCanvasProps {
  irDoc: SlideIrDocument;
  onIrChange: (updated: SlideIrDocument) => void;
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function SlideIrCanvas({
  irDoc,
  onIrChange,
  readOnly = false,
  className = "",
  style
}: SlideIrCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<SelectedTextElement | null>(null);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [svgScale, setSvgScale] = useState(1);

  const svgMarkup = useMemo(() => {
    try {
      let svg = renderSlideIrToSvg(irDoc);
      if (!svg.includes("viewBox")) {
        svg = svg.replace("<svg", `<svg viewBox="0 0 ${SMARTSLIDE_WIDTH} ${SMARTSLIDE_HEIGHT}" preserveAspectRatio="xMidYMid meet"`);
      }
      return svg;
    } catch {
      return null;
    }
  }, [irDoc]);

  // 监听容器大小，计算真实的自适应缩放比
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setSvgScale(Math.min(width / SMARTSLIDE_WIDTH, height / SMARTSLIDE_HEIGHT));
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const findTextElement = useCallback(
    (elementId: string): TextElement | null => {
      const el = irDoc.elements.find(
        (e) => e.id === elementId && e.type === "text"
      );
      return (el as TextElement) ?? null;
    },
    [irDoc]
  );

  const extractText = (element: TextElement): string => {
    return element.paragraphs
      .map((p) => p.runs.map((r) => r.text).join(""))
      .join("\n");
  };

  useEffect(() => {
    const wrapper = svgWrapperRef.current;
    if (!wrapper) return;

    const hiddenNodes = wrapper.querySelectorAll<SVGElement>('[data-editing-hidden="true"]');
    hiddenNodes.forEach((node) => {
      node.style.opacity = "";
      node.removeAttribute("data-editing-hidden");
    });

    if (selected) {
      const targetNode = wrapper.querySelector<SVGElement>(`[data-element-id="${selected.elementId}"]`);
      if (targetNode) {
        targetNode.style.opacity = "0";
        targetNode.setAttribute("data-editing-hidden", "true");
      }
    }
  }, [selected, svgMarkup]);

  function handleCanvasClick(event: React.MouseEvent) {
      if (readOnly || !svgWrapperRef.current) return;

      const target = event.target as SVGElement;
      const targetDom = target.closest("[data-element-id]") as SVGGraphicsElement | null;
      const elementId = targetDom?.getAttribute("data-element-id");

      if (!elementId || !targetDom) {
        if (selected) commitEdit();
        return;
      }

      const textEl = findTextElement(elementId);
      if (!textEl) return;

      if (selected && selected.elementId !== elementId) {
        commitEdit();
      }

      // 获取 SVG ViewBox 坐标系下的真实 BBox
      const bbox = { x: textEl.bounds[0], y: textEl.bounds[1], width: textEl.bounds[2], height: textEl.bounds[3] };
      try {
        const actualBBox = targetDom.getBBox();
        if (actualBBox.width > 0 && actualBBox.height > 0) {
          // 纵向位置以 BBox 为准，这样能完美处理 verticalAlign 导致的偏移
          bbox.y = actualBBox.y;
          // 高度取包裹框高度与设定高度的较大值
          bbox.height = Math.max(actualBBox.height, textEl.bounds[3]);
        }
      } catch {
        // Fallback to IR bounds
      }

      const firstRun = textEl.paragraphs[0]?.runs[0];
      const rawFontSize = firstRun?.fontSize ?? 16;
      
      const compStyle = window.getComputedStyle(targetDom);
      const color =
        firstRun?.color && firstRun.color.startsWith("#")
          ? firstRun.color
          : compStyle.fill !== "none" && compStyle.fill
            ? compStyle.fill
            : compStyle.color || "#000000";

      const fontFamily = firstRun?.fontFamily || compStyle.fontFamily || "system-ui, sans-serif";
      const fontWeight = firstRun?.fontWeight || compStyle.fontWeight || 400;
      const lineHeight = textEl.paragraphs[0]?.lineHeight ?? 1.25;

      const text = extractText(textEl);
      setSelected({
        elementId,
        element: textEl,
        text,
        rect: {
          left: bbox.x,
          top: bbox.y,
          width: textEl.bounds[2], // 宽度严格遵循排版边界
          height: bbox.height,
          fontSize: rawFontSize, // ViewBox 原生字号
          color,
          fontFamily,
          fontWeight,
          lineHeight
        }
      });
      setEditText(text);
  }

  function commitEdit() {
    if (!selected) return;

    if (editText === selected.text) {
      setSelected(null);
      setEditText("");
      return;
    }

    const updatedElements = irDoc.elements.map((el) => {
      if (el.id !== selected.elementId || el.type !== "text") return el;
      const textEl = el as TextElement;

      const newLines = editText.split("\n");
      const updatedParagraphs = textEl.paragraphs.map((p, pIdx) => {
        const lineText = newLines[pIdx] ?? "";
        if (!lineText && pIdx >= newLines.length) return p;
        return {
          ...p,
          runs: p.runs.length === 1
            ? [{ ...p.runs[0]!, text: lineText || " " }]
            : [
                { ...p.runs[0]!, text: lineText || " " },
                ...p.runs.slice(1).map((r) => ({ ...r, text: "" }))
              ].filter((r) => r.text)
        };
      });

      if (newLines.length > textEl.paragraphs.length) {
        const templateParagraph =
          textEl.paragraphs[textEl.paragraphs.length - 1]!;
        const templateRun = templateParagraph.runs[0]!;
        for (let i = textEl.paragraphs.length; i < newLines.length; i++) {
          updatedParagraphs.push({
            ...templateParagraph,
            runs: [{ ...templateRun, text: newLines[i] || " " }]
          });
        }
      }

      return {
        ...textEl,
        paragraphs: updatedParagraphs.slice(0, newLines.length)
      };
    });

    const updated: SlideIrDocument = {
      ...irDoc,
      elements: updatedElements
    };

    onIrChange(updated);
    setSelected(null);
    setEditText("");
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSelected(null);
      setEditText("");
    }
  };

  useEffect(() => {
    if (selected && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selected]);

  if (!svgMarkup) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 ${className}`} style={style}>
        <span className="text-sm text-gray-400">无法渲染预览</span>
      </div>
    );
  }

  const align = selected?.element.paragraphs[0]?.align ?? "left";

  return (
    <div
      ref={containerRef}
      className={`slide-ir-canvas relative flex items-center justify-center overflow-hidden ${className}`}
      style={style}
    >
      <div
        ref={svgWrapperRef}
        className="flex h-full w-full items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
        onClick={handleCanvasClick}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
        style={{ cursor: readOnly ? "default" : "text" }}
      />

      {/* 重叠层：100% 绝对映射 SVG ViewBox 坐标系 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: SMARTSLIDE_WIDTH,
          height: SMARTSLIDE_HEIGHT,
          marginLeft: -SMARTSLIDE_WIDTH / 2,
          marginTop: -SMARTSLIDE_HEIGHT / 2,
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
              minHeight: selected.rect.height + selected.rect.fontSize, // 确保足够高
              fontSize: selected.rect.fontSize,
              fontWeight: selected.rect.fontWeight,
              fontFamily: selected.rect.fontFamily,
              color: selected.rect.color,
              textAlign: align,
              lineHeight: selected.rect.lineHeight,
              background: "transparent",
              overflow: "hidden"
            }}
          />
        )}
      </div>
    </div>
  );
}
