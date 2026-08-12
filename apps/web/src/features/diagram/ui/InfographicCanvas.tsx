/**
 * InfographicCanvas — Renders AntV Infographic DSL using @antv/infographic.
 *
 * Features:
 *  - Resource loader for Iconify icons and unDraw illustrations
 *  - Multi-block support with page navigation
 *  - Real-time streaming render (DSL is fault-tolerant)
 *  - PNG/SVG export
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { Infographic, loadSVGResource, registerResourceLoader } from '@antv/infographic';
import { AlertCircle } from 'lucide-react';
import { useT } from '@/app/i18n';
import { iconifyResourceUrl } from '../model/infographicResources';

// ─── Resource Loader (Iconify icons + unDraw illustrations) ───

const svgTextCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string | null>>();

registerResourceLoader(async (config) => {
    const { data, scene } = config;
    try {
      const key = `${scene}::${data}`;
      let svgText: string | null = null;

      if (svgTextCache.has(key)) {
        svgText = svgTextCache.get(key) || null;
      } else if (pendingRequests.has(key)) {
        svgText = (await pendingRequests.get(key)) || null;
      } else {
        const fetchPromise = (async () => {
          try {
            let url;
            if (scene === 'icon') {
              url = iconifyResourceUrl(data);
            } else if (scene === 'illus') {
              url = `https://raw.githubusercontent.com/balazser/undraw-svg-collection/refs/heads/main/svgs/${data}.svg`;
            } else return null;

            if (!url) return null;
            const response = await fetch(url, { referrerPolicy: 'no-referrer' });
            if (!response.ok) return null;
            const text = await response.text();
            if (!text || !text.trim().startsWith('<svg')) return null;

            svgTextCache.set(key, text);
            return text;
          } catch {
            return null;
          }
        })();

        pendingRequests.set(key, fetchPromise);
        try {
          svgText = await fetchPromise;
        } finally {
          pendingRequests.delete(key);
        }
      }

      if (!svgText) return null;
      return loadSVGResource(svgText) as unknown as SVGSymbolElement | null;
    } catch {
      return null;
    }
});

// ─── Component ───

export default function InfographicCanvas() {
  const { canvasCode, isStreaming, canvasMode } = useChatStore();
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const infographicRef = useRef<Infographic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);

  // Pan & zoom state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  // Split DSL content into infographic blocks
  const blocks = useMemo(() => {
    if (!canvasCode) return [];
    const dslContent = canvasCode.trim();
    // Strip markdown code fences if present
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
    const matches = [...dslContent.matchAll(codeBlockRegex)];
    const extracted = matches.length > 0
      ? matches.map(m => m[1].trim()).join('\n\n')
      : dslContent;

    // Split by 'infographic' keyword at start of line
    return extracted
      .split(/(?=^infographic\s)/m)
      .map(b => b.trim())
      .filter(b => b.startsWith('infographic'));
  }, [canvasCode]);
  const displayedBlockIndex = blocks.length === 0
    ? 0
    : isStreaming
      ? blocks.length - 1
      : Math.min(activeBlockIndex, blocks.length - 1);

  // Export handler (exposed via custom event for toolbar)
  const handleExport = useCallback(async (type: 'png' | 'svg') => {
    if (!containerRef.current) return;
    const svgElement = containerRef.current.querySelector('svg');
    if (!svgElement) return;

    const filename = `smartdiagram-infographic-${Date.now()}`;
    const svgData = new XMLSerializer().serializeToString(svgElement);

    if (type === 'svg') {
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        canvas.width = img.width * 2;
        canvas.height = img.height * 2;
        ctx?.scale(2, 2);
        ctx?.drawImage(img, 0, 0);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${filename}.png`;
        a.click();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  }, []);

  // Expose export function via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type) handleExport(detail.type);
    };
    window.addEventListener('infographic-export', handler);
    return () => window.removeEventListener('infographic-export', handler);
  }, [handleExport]);

  // Render the active infographic block
  useEffect(() => {
    const activeBlock = blocks[displayedBlockIndex];
    if (!activeBlock || !containerRef.current) {
      if (infographicRef.current) {
        infographicRef.current.destroy();
        infographicRef.current = null;
      }
      return;
    }

    if (!infographicRef.current) {
      const instance = new Infographic({
        container: containerRef.current,
        width: '100%',
        height: '100%',
      });
      infographicRef.current = instance;
    }

    try {
      infographicRef.current.render(activeBlock);
      setTimeout(() => {
        setError(null);
        // Reset view on new block rendering (but not on stream updates to keep zoom state)
        if (!isStreaming) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
        }
      }, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to render infographic';
      if (!isStreaming) setTimeout(() => setError(msg), 0);
    }
  }, [blocks, displayedBlockIndex, isStreaming]);

  // Wheel zoom — must use non-passive listener for preventDefault()
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.min(Math.max(prev * delta, 0.15), 5));
  }, []);

  useEffect(() => {
    const el = svgWrapperRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
  }, [translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setTranslate({
      x: translateStart.current.x + (e.clientX - panStart.current.x),
      y: translateStart.current.y + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleFitView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 p-8">
        <div className="p-4 bg-red-50 rounded-full mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <p className="text-base font-semibold text-slate-800 mb-2">{t('infographic.renderFailed')}</p>
        <p className="text-sm text-slate-600 mb-4">{error}</p>
      </div>
    );
  }

  return (
    <div className={`w-full h-full relative flex flex-col overflow-hidden transition-colors duration-300 ${
      canvasMode === 'dark' ? 'bg-slate-950' : 'bg-slate-50'
    }`}>
      {/* Zoomable / Pannable wrapper */}
      <div
        ref={svgWrapperRef}
        className="flex-1 w-full relative overflow-hidden"
        style={{
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          ref={containerRef}
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.15s ease-out',
          }}
        />
      </div>

      {/* Zoom controls */}
      {blocks.length > 0 && !error && (
        <div className={`absolute bottom-14 right-4 flex items-center gap-1 backdrop-blur rounded-lg shadow-lg border p-1 z-10 ${
          canvasMode === 'dark' 
            ? 'bg-slate-900/90 border-slate-800 text-slate-300' 
            : 'bg-white/90 border-slate-200 text-slate-600'
        }`}>
          <button
            onClick={() => setScale((s) => Math.min(s * 1.2, 5))}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-lg font-bold transition-colors"
            title={t('common.zoomIn')}
          >+</button>
          <button
            onClick={() => setScale((s) => Math.max(s * 0.8, 0.15))}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-lg font-bold transition-colors"
            title={t('common.zoomOut')}
          >−</button>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-800" />
          <button
            onClick={handleFitView}
            className="px-2 h-8 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs transition-colors"
            title={t('common.fitView')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <span className="text-[10px] opacity-60 px-1 min-w-[36px] text-center font-mono">{Math.round(scale * 100)}%</span>
        </div>
      )}

      {/* Pages selector footer */}
      {blocks.length > 1 && (
        <div className={`h-12 border-t flex items-center justify-center gap-4 shrink-0 z-10 ${
          canvasMode === 'dark' 
            ? 'bg-slate-900/60 border-slate-800/80' 
            : 'bg-slate-50/50 border-slate-100'
        }`}>
          <div className={`flex items-center gap-1.5 p-1 rounded-lg border shadow-sm ${
            canvasMode === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            {blocks.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveBlockIndex(idx)}
                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-medium transition-all ${
                  displayedBlockIndex === idx
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            {t('infographic.pageIndicator', { current: displayedBlockIndex + 1, total: blocks.length })}
          </span>
        </div>
      )}
    </div>
  );
}
