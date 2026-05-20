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
  const { canvasCode, streamingCode, isStreaming, setCanvasCode, setMindmapInstance, setSelectedNode, canvasMode } = useChatStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const mindInstance = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const isSyncingRef = useRef(false);
  const lastCanvasMode = useRef(canvasMode);

  // Clean up mindmap instance ref in store on unmount
  useEffect(() => {
    return () => {
      setMindmapInstance(null);
      setSelectedNode(null);
    };
  }, [setMindmapInstance, setSelectedNode]);

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

  // Determine active markdown code: use streamingCode during generation, canvasCode when done
  const codeToRender = (isStreaming && streamingCode) ? streamingCode : canvasCode;

  // Render / re-render when code changes
  useEffect(() => {
    if (!codeToRender || !containerRef.current) return;
    if (isSyncingRef.current) return;
    setError(null);

    // 如果背景模式切换了，强制清空并重建 MindElixir 实例以加载正确的主题
    if (lastCanvasMode.current !== canvasMode) {
      if (mindInstance.current) {
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
        mindInstance.current = null;
        setMindmapInstance(null);
      }
      lastCanvasMode.current = canvasMode;
    }

    try {
      // Clean code
      let code = codeToRender.trim();
      if (code.startsWith('```')) {
        // Strip opening backticks and language label (e.g. ```markdown)
        code = code.replace(/^```\w*\n?/, '');
        // Strip trailing backticks if present
        if (code.endsWith('```')) {
          code = code.slice(0, -3).trim();
        } else {
          code = code.trim();
        }
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
      
      // If root is completely empty, skip rendering
      if (!root || (!root.content && (!root.children || root.children.length === 0))) return;

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
          theme: canvasMode === 'light' ? undefined : ((MindElixir as any).dark || undefined),
        });
        me.init(data);
        mindInstance.current = me;
        setMindmapInstance(me); // Share instance for export

        // Listen for edit events to sync back
        me.bus.addListener('operation', () => {
          syncToCanvasCode();
        });

        // Listen for node selection to invoke precise optimization
        (me.bus as any).addListener('select-node', (node: any) => {
          if (node && node.topic) {
            setSelectedNode({
              id: node.id,
              text: node.topic,
              type: 'mindmap',
            });
          }
        });
        (me.bus as any).addListener('unselect-node', () => {
          setSelectedNode(null);
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

        // Re-register node selection listeners
        mindInstance.current.bus.addListener('select-node', (node: any) => {
          if (node && node.topic) {
            setSelectedNode({
              id: node.id,
              text: node.topic,
              type: 'mindmap',
            });
          }
        });
        mindInstance.current.bus.addListener('unselect-node', () => {
          setSelectedNode(null);
        });

        // Do not auto-scale viewport during active streaming to prevent visual jittering/shaking
        if (!isStreaming) {
          fitWithPadding(mindInstance.current);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[MindmapCanvas] Render error:', e);
      // Only set UI error state if NOT streaming to prevent interrupting the stream due to temporary parsing states
      if (!isStreaming) {
        setError(msg);
      }
    }
  }, [isStreaming, codeToRender, syncToCanvasCode, setMindmapInstance, canvasMode]);

  // Final fit and center adjustment when streaming concludes
  useEffect(() => {
    if (!isStreaming && mindInstance.current && canvasCode) {
      const timer = setTimeout(() => {
        if (mindInstance.current) {
          fitWithPadding(mindInstance.current);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, canvasCode]);

  return (
    <div className={`w-full h-full relative transition-colors duration-300 ${canvasMode === 'light' ? 'bg-white' : 'bg-slate-950'}`}>
      {error ? (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
          <div className="p-3 bg-red-950/20 rounded-full mb-3 border border-red-900/30">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-200">MindMap 渲染失败</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">{error}</p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full" />
      )}
    </div>
  );
}
