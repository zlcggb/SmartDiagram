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
const convertToMindElixir = (node: any, pathId: string = 'root'): any => ({
  topic: stripHtmlAndDecode(node.content),
  id: pathId,
  children: node.children?.map((c: any, index: number) => convertToMindElixir(c, `${pathId}-${index}`)) || [],
});

/**
 * Recursively restores expanded states from the old instance to the new data node tree
 */
const restoreExpandedStates = (newNode: any, oldInstance: any) => {
  if (!oldInstance) return;
  try {
    const oldData = oldInstance.getData?.();
    if (oldData?.nodeData) {
      const oldNode = oldInstance.getObjById?.(newNode.id, oldData.nodeData);
      if (oldNode && oldNode.expanded === false) {
        newNode.expanded = false;
      }
    }
  } catch (err) {
    // Quietly ignore if node lookup fails
  }
  if (newNode.children) {
    newNode.children.forEach((child: any) => restoreExpandedStates(child, oldInstance));
  }
};

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

  // Ref for double-write avoidance in markdown sync
  const lastRenderedMarkdownRef = useRef('');

  // MiniMap states
  const [miniMapNodes, setMiniMapNodes] = useState<{ id: string; cx: number; cy: number }[]>([]);
  const [miniMapLines, setMiniMapLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [viewBoxRect, setViewBoxRect] = useState<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  const miniMapBoundsRef = useRef({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
  const isDraggingRef = useRef(false);
  const startDragRef = useRef({ x: 0, y: 0, frameX: 0, frameY: 0 });

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
      lastRenderedMarkdownRef.current = markdown; // Record active markdown
      setCanvasCode(markdown);
      requestAnimationFrame(() => { isSyncingRef.current = false; });
    }
  }, [setCanvasCode]);

  // Determine active markdown code: use streamingCode during generation, canvasCode when done
  const codeToRender = (isStreaming && streamingCode) ? streamingCode : canvasCode;

  // ─── MiniMap Update Logic ───
  const updateMiniMap = useCallback(() => {
    if (!mindInstance.current || !containerRef.current) return;

    const container = containerRef.current;
    const mapContainer = container.querySelector('.map-container') as HTMLElement;
    if (!mapContainer) return;

    // Retrieve all node DOMs inside MindElixir
    const topics = mapContainer.querySelectorAll('me-tpc, [data-nodeid]') as NodeListOf<HTMLElement>;
    if (!topics.length) return;

    const scale = mindInstance.current.scaleVal || 1;

    const nodesData: { id: string; x: number; y: number; w: number; h: number }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    const mapRect = mapContainer.getBoundingClientRect();

    topics.forEach((el) => {
      const dataNodeId = el.getAttribute('data-nodeid') || '';
      const id = dataNodeId.startsWith('me') ? dataNodeId.slice(2) : dataNodeId;
      const elRect = el.getBoundingClientRect();

      // De-scaled coordinates relative to map-container
      const x = (elRect.left - mapRect.left) / scale;
      const y = (elRect.top - mapRect.top) / scale;
      const w = elRect.width / scale;
      const h = elRect.height / scale;

      if (id) {
        nodesData.push({ id, x, y, w, h });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + w);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + h);
      }
    });

    if (nodesData.length === 0 || minX === Infinity) return;

    // Apply safe padding to prevent nodes clipping boundary
    const pad = 80;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;

    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;

    const mmW = 160;
    const mmH = 120;
    const scaleX = mmW / boundsWidth;
    const scaleY = mmH / boundsHeight;
    const miniScale = Math.min(scaleX, scaleY);

    const offsetX = (mmW - boundsWidth * miniScale) / 2;
    const offsetY = (mmH - boundsHeight * miniScale) / 2;

    const mappedNodes = nodesData.map(n => ({
      id: n.id,
      cx: (n.x - minX) * miniScale + offsetX,
      cy: (n.y - minY) * miniScale + offsetY,
    }));

    // Reconstruct lines from tree structure
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const buildLines = (node: any) => {
      const fromNode = mappedNodes.find(mn => mn.id === node.id);
      if (fromNode && node.children) {
        node.children.forEach((child: any) => {
          const toNode = mappedNodes.find(mn => mn.id === child.id);
          if (toNode) {
            lines.push({
              x1: fromNode.cx,
              y1: fromNode.cy,
              x2: toNode.cx,
              y2: toNode.cy,
            });
          }
          buildLines(child);
        });
      }
    };

    try {
      const currentData = mindInstance.current.getData();
      if (currentData?.nodeData) {
        buildLines(currentData.nodeData);
      }
    } catch (e) {
      // Quiet fail if data is not fully ready
    }

    // Viewport frame calculation
    const containerRect = container.getBoundingClientRect();
    const viewX = (containerRect.left - mapRect.left) / scale;
    const viewY = (containerRect.top - mapRect.top) / scale;
    const viewW = containerRect.width / scale;
    const viewH = containerRect.height / scale;

    const frameX = (viewX - minX) * miniScale + offsetX;
    const frameY = (viewY - minY) * miniScale + offsetY;
    const frameW = viewW * miniScale;
    const frameH = viewH * miniScale;

    setViewBoxRect({
      x: Math.max(-40, Math.min(mmW + 40, frameX)),
      y: Math.max(-40, Math.min(mmH + 40, frameY)),
      width: Math.max(8, Math.min(mmW * 2, frameW)),
      height: Math.max(8, Math.min(mmH * 2, frameH)),
    });

    setMiniMapNodes(mappedNodes);
    setMiniMapLines(lines);

    miniMapBoundsRef.current = { minX, maxX, minY, maxY };
  }, []);

  // Sync interaction event listeners
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleInteraction = () => {
      requestAnimationFrame(updateMiniMap);
    };

    el.addEventListener('wheel', handleInteraction, { passive: true });
    el.addEventListener('pointermove', handleInteraction);
    el.addEventListener('pointerup', handleInteraction);

    const observer = new ResizeObserver(handleInteraction);
    observer.observe(el);

    return () => {
      el.removeEventListener('wheel', handleInteraction);
      el.removeEventListener('pointermove', handleInteraction);
      el.removeEventListener('pointerup', handleInteraction);
      observer.disconnect();
    };
  }, [updateMiniMap]);

  // Render / re-render when code changes
  useEffect(() => {
    if (!codeToRender || !containerRef.current) return;
    if (isSyncingRef.current) return;

    // Check if new code matches our internal edits to avoid redundant init
    if (codeToRender.trim() === lastRenderedMarkdownRef.current.trim()) {
      return;
    }

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

      // Restore expanded states from old instance if present
      if (mindInstance.current) {
        restoreExpandedStates(data.nodeData, mindInstance.current);
      }

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
          requestAnimationFrame(updateMiniMap);
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

        // Fit after initial layout and refresh minimap
        setTimeout(() => {
          fitWithPadding(me);
          updateMiniMap();
        }, 50);
      } else {
        // Subsequent renders: re-init with new data
        mindInstance.current.init(data);

        // Re-register listener (init clears listeners)
        mindInstance.current.bus.addListener('operation', () => {
          syncToCanvasCode();
          requestAnimationFrame(updateMiniMap);
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
        setTimeout(updateMiniMap, 50);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[MindmapCanvas] Render error:', e);
      // Only set UI error state if NOT streaming to prevent interrupting the stream due to temporary parsing states
      if (!isStreaming) {
        setError(msg);
      }
    }
  }, [isStreaming, codeToRender, syncToCanvasCode, setMindmapInstance, canvasMode, updateMiniMap]);

  // Final fit and center adjustment when streaming concludes
  useEffect(() => {
    if (!isStreaming && mindInstance.current && canvasCode) {
      const timer = setTimeout(() => {
        if (mindInstance.current) {
          fitWithPadding(mindInstance.current);
          updateMiniMap();
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, canvasCode, updateMiniMap]);

  // ─── MiniMap Panning Pointer Events ───
  const handleMiniMapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    startDragRef.current = {
      x: e.clientX,
      y: e.clientY,
      frameX: viewBoxRect.x,
      frameY: viewBoxRect.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleMiniMapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !mindInstance.current || !containerRef.current) return;
    e.stopPropagation();

    const dx = e.clientX - startDragRef.current.x;
    const dy = e.clientY - startDragRef.current.y;

    const newFrameX = startDragRef.current.frameX + dx;
    const newFrameY = startDragRef.current.frameY + dy;

    const mapContainer = containerRef.current.querySelector('.map-container') as HTMLElement;
    if (!mapContainer) return;

    const scale = mindInstance.current.scaleVal || 1;
    const bounds = miniMapBoundsRef.current;

    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    if (boundsWidth <= 0 || boundsHeight <= 0) return;

    const mmW = 160;
    const mmH = 120;
    const scaleX = mmW / boundsWidth;
    const scaleY = mmH / boundsHeight;
    const miniScale = Math.min(scaleX, scaleY);

    if (miniScale <= 0) return;

    // Apply incremental translation to main canvas
    const moveX = -(dx / miniScale) * scale;
    const moveY = -(dy / miniScale) * scale;

    mindInstance.current.move(moveX, moveY);

    startDragRef.current.x = e.clientX;
    startDragRef.current.y = e.clientY;
    startDragRef.current.frameX = newFrameX;
    startDragRef.current.frameY = newFrameY;

    updateMiniMap();
  };

  const handleMiniMapPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

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
        <>
          <div ref={containerRef} className="w-full h-full animate-fadeIn" />

          {/* MiniMap and Floating Controls */}
          {!isStreaming && mindInstance.current && (
            <div className="absolute bottom-5 right-5 z-20 flex flex-col gap-2.5 items-end">
              {/* Zoom & Fit & Collapse Controls */}
              <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border shadow-lg backdrop-blur-md transition-colors duration-300 ${
                canvasMode === 'light' ? 'bg-white/80 border-slate-200 text-slate-600' : 'bg-slate-900/80 border-slate-800/50 text-slate-300'
              }`}>
                <button
                  onClick={() => {
                    if (mindInstance.current) {
                      mindInstance.current.scale(mindInstance.current.scaleVal + 0.1);
                      updateMiniMap();
                    }
                  }}
                  title="放大"
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    if (mindInstance.current) {
                      mindInstance.current.scale(Math.max(0.1, mindInstance.current.scaleVal - 0.1));
                      updateMiniMap();
                    }
                  }}
                  title="缩小"
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    if (mindInstance.current) {
                      fitWithPadding(mindInstance.current);
                      updateMiniMap();
                    }
                  }}
                  title="自适应"
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4" />
                  </svg>
                </button>
                <div className="w-[1px] h-3.5 bg-slate-300 dark:bg-slate-700 mx-1" />
                <button
                  onClick={() => {
                    if (mindInstance.current) {
                      const rootNode = mindInstance.current.getData().nodeData;
                      if (rootNode.children) {
                        rootNode.children.forEach((c: any) => {
                          mindInstance.current.expandNode(mindInstance.current.findEle(c.id), false);
                        });
                      }
                      syncToCanvasCode();
                      updateMiniMap();
                    }
                  }}
                  title="全部折叠"
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    if (mindInstance.current) {
                      mindInstance.current.expandNodeAll(mindInstance.current.findEle('root'), true);
                      syncToCanvasCode();
                      updateMiniMap();
                    }
                  }}
                  title="全部展开"
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
              </div>

              {/* MiniMap Canvas Viewport */}
              <div
                onPointerDown={handleMiniMapPointerDown}
                onPointerMove={handleMiniMapPointerMove}
                onPointerUp={handleMiniMapPointerUp}
                className={`w-40 h-30 rounded-xl border shadow-xl backdrop-blur-md relative overflow-hidden select-none cursor-grab active:cursor-grabbing transition-colors duration-300 ${
                  canvasMode === 'light' ? 'bg-white/95 border-slate-200' : 'bg-slate-900/95 border-slate-800/80'
                }`}
              >
                <svg className="w-full h-full">
                  {/* Lines */}
                  {miniMapLines.map((line, idx) => (
                    <line
                      key={`line-${idx}`}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={canvasMode === 'light' ? '#cbd5e1' : '#334155'}
                      strokeWidth="1.2"
                    />
                  ))}
                  {/* Nodes */}
                  {miniMapNodes.map(node => (
                    <circle
                      key={`node-${node.id}`}
                      cx={node.cx}
                      cy={node.cy}
                      r={node.id === 'root' ? '3.5' : '2'}
                      fill={
                        node.id === 'root'
                          ? '#3b82f6'
                          : canvasMode === 'light'
                          ? '#64748b'
                          : '#94a3b8'
                      }
                      className={node.id === 'root' ? 'shadow-sm shadow-blue-500' : ''}
                    />
                  ))}
                  {/* Viewport Frame */}
                  <rect
                    x={viewBoxRect.x}
                    y={viewBoxRect.y}
                    width={viewBoxRect.width}
                    height={viewBoxRect.height}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="1.5"
                    className="opacity-70 fill-blue-500/10 pointer-events-none"
                  />
                </svg>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
