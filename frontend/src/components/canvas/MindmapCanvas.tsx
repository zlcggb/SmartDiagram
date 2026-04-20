/**
 * MindmapCanvas — renders mind maps from Markdown heading format.
 *
 * Adapted from the working DeepDiagram-Pro/frontend MindmapAgent.tsx:
 *   - markmap-lib Transformer parses Markdown → tree
 *   - convertToMindElixir() converts to mind-elixir format
 *   - fitWithPadding() calculates true bounding box for precise zoom-to-fit
 *   - Editing enabled with sync back to canvasCode
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import MindElixir from 'mind-elixir';
import 'mind-elixir/style.css';
import { Transformer } from 'markmap-lib';
import { useChatStore } from '../../store/chatStore';

// ─── Helpers (from original DeepDiagram-Pro) ───

/** Strip HTML entities and tags produced by markmap-lib */
const stripHtmlAndDecode = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.documentElement.textContent || '';
};

/** Convert markmap tree node → mind-elixir tree node */
const convertToMindElixir = (node: any): any => ({
  topic: stripHtmlAndDecode(node.content),
  id: Math.random().toString(36).substr(2, 9),
  children: node.children?.map((c: any) => convertToMindElixir(c)) || [],
});

/** Convert MindElixir tree back to Markdown (for canvasCode sync) */
const convertToMarkdown = (node: any, level: number = 1): string => {
  let md = '';
  if (level === 1) {
    md += `# ${node.topic}\n`;
  } else if (level === 2) {
    md += `## ${node.topic}\n`;
  } else if (level === 3) {
    md += `### ${node.topic}\n`;
  } else {
    md += `${'  '.repeat(level - 3)}- ${node.topic}\n`;
  }
  if (node.children) {
    node.children.forEach((child: any) => {
      md += convertToMarkdown(child, level + 1);
    });
  }
  return md;
};

/**
 * Fit mindmap into viewport with padding.
 * First calls scaleFit + toCenter, then measures actual bounding box
 * of rendered .topic elements and applies a second pass if content is clipped.
 */
const fitWithPadding = (me: any) => {
  if (!me || !me.container) return;

  const container = me.container as HTMLElement;
  const mapContainer = container.querySelector('.map-container') as HTMLElement;
  if (!mapContainer) {
    me.scaleFit();
    me.toCenter();
    return;
  }

  // First pass: built-in fit
  me.scaleFit();
  me.toCenter();

  // Second pass: measure actual topic positions and re-adjust if clipped
  requestAnimationFrame(() => {
    const topics = mapContainer.querySelectorAll('.topic');
    if (!topics.length) return;

    const containerRect = container.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    topics.forEach((topic) => {
      const rect = topic.getBoundingClientRect();
      const left = rect.left - containerRect.left;
      const top = rect.top - containerRect.top;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, left + rect.width);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, top + rect.height);
    });

    if (minX === Infinity) return;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const isClipped = minX < 0 || maxX > containerWidth || minY < 0 || maxY > containerHeight;

    if (isClipped) {
      const currentScale = me.scaleVal || 1;
      const paddingRatio = 0.70;
      const requiredScaleX = (containerWidth * paddingRatio) / contentWidth;
      const requiredScaleY = (containerHeight * paddingRatio) / contentHeight;
      const newScale = Math.min(requiredScaleX, requiredScaleY, currentScale) * currentScale;

      me.scale(newScale);

      // Recenter after rescale
      requestAnimationFrame(() => {
        const newContainerRect = container.getBoundingClientRect();
        let nMinX = Infinity, nMaxX = -Infinity, nMinY = Infinity, nMaxY = -Infinity;

        topics.forEach((topic) => {
          const rect = topic.getBoundingClientRect();
          const left = rect.left - newContainerRect.left;
          const top = rect.top - newContainerRect.top;
          nMinX = Math.min(nMinX, left);
          nMaxX = Math.max(nMaxX, left + rect.width);
          nMinY = Math.min(nMinY, top);
          nMaxY = Math.max(nMaxY, top + rect.height);
        });

        const contentCenterX = (nMinX + nMaxX) / 2;
        const contentCenterY = (nMinY + nMaxY) / 2;
        const dx = containerWidth / 2 - contentCenterX;
        const dy = containerHeight / 2 - contentCenterY;

        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          me.move(dx, dy);
        }
      });
    }
  });
};

// ─── Component ───

export default function MindmapCanvas() {
  const { canvasCode, isStreaming, setCanvasCode, setMindmapInstance } = useChatStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const mindInstance = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const isSyncingRef = useRef(false);

  // Clean up mindmap instance ref in store on unmount
  useEffect(() => {
    return () => { setMindmapInstance(null); };
  }, [setMindmapInstance]);

  /** Sync mind-elixir tree back to Markdown canvasCode when user edits */
  const syncToCanvasCode = useCallback(() => {
    if (!mindInstance.current) return;
    const data = mindInstance.current.getData();
    if (data?.nodeData) {
      isSyncingRef.current = true;
      const markdown = convertToMarkdown(data.nodeData);
      setCanvasCode(markdown);
      requestAnimationFrame(() => { isSyncingRef.current = false; });
    }
  }, [setCanvasCode]);

  // Render / re-render when code changes
  useEffect(() => {
    if (isStreaming || !canvasCode || !containerRef.current) return;
    if (isSyncingRef.current) return;
    setError(null);

    try {
      // Clean code
      let code = canvasCode.trim();
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      }
      // Fix double-escaped newlines from LLM output
      if (code.includes('\\n') && !code.includes('\n')) {
        code = code.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      }

      // Skip non-Markdown content (e.g. JSON meant for other agents)
      if (code.startsWith('[') || code.startsWith('{')) return;

      // Parse Markdown → markmap tree → mind-elixir format
      const transformer = new Transformer();
      const { root } = transformer.transform(code);
      const data = { nodeData: convertToMindElixir(root) };

      if (!mindInstance.current) {
        // First render: create new instance
        const me = new MindElixir({
          el: containerRef.current,
          direction: MindElixir.SIDE,
          draggable: true,
          editable: true,
          contextMenu: true,
          toolBar: true,
        });
        me.init(data);
        mindInstance.current = me;
        setMindmapInstance(me); // Share instance for export

        // Listen for edit events to sync back
        me.bus.addListener('operation', () => {
          syncToCanvasCode();
        });

        // Fit after initial layout
        setTimeout(() => fitWithPadding(me), 0);
      } else {
        // Subsequent renders: re-init with new data
        mindInstance.current.init(data);

        // Re-register listener (init clears listeners)
        mindInstance.current.bus.addListener('operation', () => {
          syncToCanvasCode();
        });

        fitWithPadding(mindInstance.current);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[MindmapCanvas] Render error:', e);
      setError(msg);
    }
  }, [isStreaming, canvasCode, syncToCanvasCode, setMindmapInstance]);

  // Final fit when streaming ends
  useEffect(() => {
    if (!isStreaming && mindInstance.current && canvasCode) {
      setTimeout(() => fitWithPadding(mindInstance.current), 100);
    }
  }, [isStreaming, canvasCode]);

  return (
    <div className="w-full h-full relative bg-white">
      {error ? (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
          <div className="p-3 bg-red-50 rounded-full mb-3">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-800">MindMap 渲染失败</p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">{error}</p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full" />
      )}
    </div>
  );
}
