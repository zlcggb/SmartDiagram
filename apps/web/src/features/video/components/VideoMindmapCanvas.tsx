import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import MindElixir from 'mind-elixir';
import 'mind-elixir/style.css';
import { Transformer } from 'markmap-lib';
import {
  convertToMindElixir,
  fitWithPadding,
  normalizeMindmapMarkdown,
} from '../lib/mindElixirHelpers';

export interface VideoMindmapCanvasHandle {
  getInstance: () => any;
  refreshLayout: () => void;
}

interface VideoMindmapCanvasProps {
  markdown: string;
  className?: string;
}

interface MiniMapNode {
  id: string;
  cx: number;
  cy: number;
  depth: number;
}

interface MiniMapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  toDepth: number;
}

export const VideoMindmapCanvas = forwardRef<VideoMindmapCanvasHandle, VideoMindmapCanvasProps>(
  function VideoMindmapCanvas({ markdown, className = '' }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mindInstanceRef = useRef<any>(null);
    const lastSizeRef = useRef({ width: 0, height: 0 });
    const [hasInstance, setHasInstance] = useState(false);
    const [layoutReadyTick, setLayoutReadyTick] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const [miniMapNodes, setMiniMapNodes] = useState<MiniMapNode[]>([]);
    const [miniMapLines, setMiniMapLines] = useState<MiniMapLine[]>([]);
    const [viewBoxRect, setViewBoxRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

    const miniMapBoundsRef = useRef({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
    const isDraggingRef = useRef(false);
    const startDragRef = useRef({ x: 0, y: 0, frameX: 0, frameY: 0 });

    const destroyMind = () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
      mindInstanceRef.current = null;
      setHasInstance(false);
    };

    const updateMiniMap = () => {
      const me = mindInstanceRef.current;
      const container = containerRef.current;
      if (!me || !container) return;

      const mapContainer = container.querySelector('.map-container');
      if (!mapContainer) return;

      const topics = mapContainer.querySelectorAll('me-tpc, [data-nodeid]');
      if (!topics.length) return;

      const scale = me.scaleVal || 1;
      const nodesData: Array<{ id: string; x: number; y: number; w: number; h: number; depth: number }> = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const mapRect = mapContainer.getBoundingClientRect();

      topics.forEach((el) => {
        const dataNodeId = el.getAttribute('data-nodeid') || '';
        const id = dataNodeId.startsWith('me') ? dataNodeId.slice(2) : dataNodeId;
        const elRect = el.getBoundingClientRect();
        const x = (elRect.left - mapRect.left) / scale;
        const y = (elRect.top - mapRect.top) / scale;
        const w = elRect.width / scale;
        const h = elRect.height / scale;
        if (id) {
          const depth = id === 'root' ? 0 : id.split('-').length - 1;
          nodesData.push({ id, x, y, w, h, depth });
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x + w);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y + h);
        }
      });

      if (!nodesData.length || minX === Infinity) return;

      const pad = 80;
      minX -= pad;
      maxX += pad;
      minY -= pad;
      maxY += pad;

      const boundsWidth = maxX - minX;
      const boundsHeight = maxY - minY;
      const mmW = 160;
      const mmH = 120;
      const miniScale = Math.min(mmW / boundsWidth, mmH / boundsHeight);
      const offsetX = (mmW - boundsWidth * miniScale) / 2;
      const offsetY = (mmH - boundsHeight * miniScale) / 2;

      const mappedNodes: MiniMapNode[] = nodesData.map((n) => ({
        id: n.id,
        cx: (n.x - minX) * miniScale + offsetX,
        cy: (n.y - minY) * miniScale + offsetY,
        depth: n.depth,
      }));

      const lines: MiniMapLine[] = [];
      const buildLines = (node: any) => {
        const fromNode = mappedNodes.find((mn) => mn.id === node.id);
        if (fromNode && node.children) {
          node.children.forEach((child: any) => {
            const toNode = mappedNodes.find((mn) => mn.id === child.id);
            if (toNode) {
              lines.push({
                x1: fromNode.cx,
                y1: fromNode.cy,
                x2: toNode.cx,
                y2: toNode.cy,
                toDepth: toNode.depth,
              });
            }
            buildLines(child);
          });
        }
      };

      try {
        const currentData = me.getData();
        if (currentData?.nodeData) buildLines(currentData.nodeData);
      } catch {
        // ignore
      }

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
    };

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const onInteraction = () => requestAnimationFrame(updateMiniMap);
      el.addEventListener('wheel', onInteraction, { passive: true });
      el.addEventListener('pointerup', onInteraction);

      const resizeObs = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        const width = rect ? Math.round(rect.width) : el.clientWidth;
        const height = rect ? Math.round(rect.height) : el.clientHeight;
        const prev = lastSizeRef.current;
        lastSizeRef.current = { width, height };

        if (width > 0 && height > 0 && (prev.width === 0 || prev.height === 0)) {
          setLayoutReadyTick((tick) => tick + 1);
        }

        if (mindInstanceRef.current && width > 0 && height > 0) {
          try {
            mindInstanceRef.current.linkDiv?.();
          } catch {
            // ignore
          }
          fitWithPadding(mindInstanceRef.current);
          updateMiniMap();
        }
      });
      resizeObs.observe(el);

      return () => {
        el.removeEventListener('wheel', onInteraction);
        el.removeEventListener('pointerup', onInteraction);
        resizeObs.disconnect();
        destroyMind();
      };
    }, []);

    useEffect(() => {
      setError(null);
      const code = normalizeMindmapMarkdown(markdown);
      if (!code || !containerRef.current) {
        destroyMind();
        return;
      }

      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) {
        return;
      }

      try {
        const transformer = new Transformer();
        const { root } = transformer.transform(code);
        if (!root || (!root.content && (!root.children || root.children.length === 0))) {
          destroyMind();
          return;
        }

        const data = { nodeData: convertToMindElixir(root) };

        if (!mindInstanceRef.current) {
          const me = new MindElixir({
            el: containerRef.current,
            direction: MindElixir.SIDE,
            draggable: true,
            editable: true,
            contextMenu: true,
            toolBar: false,
          });
          me.init(data);
          mindInstanceRef.current = me;
          setHasInstance(true);
          me.bus.addListener('operation', () => requestAnimationFrame(updateMiniMap));
          me.bus.addListener('move', () => requestAnimationFrame(updateMiniMap));
          me.bus.addListener('scale', () => requestAnimationFrame(updateMiniMap));
          setTimeout(() => {
            try {
              me.linkDiv?.();
            } catch {
              // ignore
            }
            fitWithPadding(me);
            updateMiniMap();
          }, 50);
        } else {
          mindInstanceRef.current.init(data);
          mindInstanceRef.current.bus.addListener('operation', () => requestAnimationFrame(updateMiniMap));
          mindInstanceRef.current.bus.addListener('move', () => requestAnimationFrame(updateMiniMap));
          mindInstanceRef.current.bus.addListener('scale', () => requestAnimationFrame(updateMiniMap));
          fitWithPadding(mindInstanceRef.current);
          setTimeout(() => {
            try {
              mindInstanceRef.current?.linkDiv?.();
            } catch {
              // ignore
            }
            if (mindInstanceRef.current) {
              fitWithPadding(mindInstanceRef.current);
            }
            updateMiniMap();
          }, 50);
        }
      } catch (e: any) {
        console.error('[VideoMindmapCanvas]', e);
        setError(e?.message || String(e));
      }
    }, [markdown, layoutReadyTick]);

    useImperativeHandle(ref, () => ({
      getInstance: () => mindInstanceRef.current,
      refreshLayout: () => {
        if (mindInstanceRef.current) {
          try {
            mindInstanceRef.current.linkDiv?.();
          } catch {
            // ignore
          }
          fitWithPadding(mindInstanceRef.current);
          updateMiniMap();
        }
      },
    }));

    const zoomIn = () => {
      const me = mindInstanceRef.current;
      if (!me) return;
      me.scale(me.scaleVal + 0.1);
      updateMiniMap();
    };

    const zoomOut = () => {
      const me = mindInstanceRef.current;
      if (!me) return;
      me.scale(Math.max(0.1, me.scaleVal - 0.1));
      updateMiniMap();
    };

    const fitView = () => {
      const me = mindInstanceRef.current;
      if (!me) return;
      fitWithPadding(me);
      updateMiniMap();
    };

    const collapseAll = () => {
      const me = mindInstanceRef.current;
      if (!me) return;
      const rootNode = me.getData()?.nodeData;
      if (rootNode?.children) {
        rootNode.children.forEach((c: any) => {
          me.expandNode(me.findEle(c.id), false);
        });
      }
      updateMiniMap();
    };

    const expandAll = () => {
      const me = mindInstanceRef.current;
      if (!me) return;
      me.expandNodeAll(me.findEle('root'), true);
      setTimeout(() => {
        fitWithPadding(me);
        updateMiniMap();
      }, 20);
    };

    return (
      <div className={`relative h-full w-full min-h-0 bg-slate-50 ${className}`}>
        {error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <p className="text-sm font-semibold text-slate-700">思维导图渲染失败</p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">{error}</p>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="mindmap-elixir-host h-full w-full min-h-0" />
            {hasInstance && (
              <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2.5">
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white/85 px-2.5 py-1.5 text-slate-600 shadow-lg backdrop-blur-md">
                  <button
                    type="button"
                    className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                    title="放大"
                    onClick={zoomIn}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                    title="缩小"
                    onClick={zoomOut}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                    title="适应画布"
                    onClick={fitView}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4"
                      />
                    </svg>
                  </button>
                  <div className="mx-1 h-3.5 w-px bg-slate-300" />
                  <button
                    type="button"
                    className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                    title="全部折叠"
                    onClick={collapseAll}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                    title="全部展开"
                    onClick={expandAll}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                </div>

                <div
                  className="relative h-[120px] w-40 cursor-grab overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur-md active:cursor-grabbing"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    isDraggingRef.current = true;
                    startDragRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                      frameX: viewBoxRect.x,
                      frameY: viewBoxRect.y,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingRef.current || !mindInstanceRef.current || !containerRef.current) return;
                    e.stopPropagation();
                    const me = mindInstanceRef.current;
                    const dx = e.clientX - startDragRef.current.x;
                    const dy = e.clientY - startDragRef.current.y;
                    const scale = me.scaleVal || 1;
                    const bounds = miniMapBoundsRef.current;
                    const boundsWidth = bounds.maxX - bounds.minX;
                    const boundsHeight = bounds.maxY - bounds.minY;
                    if (boundsWidth <= 0 || boundsHeight <= 0) return;
                    const miniScale = Math.min(160 / boundsWidth, 120 / boundsHeight);
                    if (miniScale <= 0) return;
                    me.move(-(dx / miniScale) * scale, -(dy / miniScale) * scale);
                    startDragRef.current.x = e.clientX;
                    startDragRef.current.y = e.clientY;
                    updateMiniMap();
                  }}
                  onPointerUp={(e) => {
                    isDraggingRef.current = false;
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                >
                  <svg className="h-full w-full">
                    <defs>
                      <pattern id="vidgrab-minimap-grid" width="12" height="12" patternUnits="userSpaceOnUse">
                        <circle cx="1.5" cy="1.5" r="0.75" fill="#cbd5e1" className="opacity-40" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#vidgrab-minimap-grid)" />
                    {miniMapLines.map((line, idx) => (
                      <line
                        key={`l-${idx}`}
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        strokeLinecap="round"
                        stroke={
                          line.toDepth === 1
                            ? 'rgba(99, 102, 241, 0.5)'
                            : line.toDepth === 2
                              ? 'rgba(8, 145, 178, 0.4)'
                              : 'rgba(148, 163, 184, 0.25)'
                        }
                        strokeWidth={line.toDepth === 1 ? 1.2 : line.toDepth === 2 ? 0.9 : 0.6}
                      />
                    ))}
                    {miniMapNodes.map((node) => (
                      <circle
                        key={`n-${node.id}`}
                        cx={node.cx}
                        cy={node.cy}
                        r={node.id === 'root' ? 3.5 : node.depth === 1 ? 2.2 : node.depth === 2 ? 1.6 : 1.2}
                        fill={
                          node.id === 'root'
                            ? '#6366f1'
                            : node.depth === 1
                              ? '#818cf8'
                              : node.depth === 2
                                ? '#06b6d4'
                                : '#94a3b8'
                        }
                      />
                    ))}
                    {viewBoxRect.width > 0 && (
                      <rect
                        x={viewBoxRect.x}
                        y={viewBoxRect.y}
                        width={viewBoxRect.width}
                        height={viewBoxRect.height}
                        rx="3"
                        fill="rgba(99, 102, 241, 0.08)"
                        stroke="rgba(99, 102, 241, 0.7)"
                        strokeWidth="1.2"
                      />
                    )}
                  </svg>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);
