/**
 * InfographicCanvas — Renders AntV Infographic DSL using @antv/infographic.
 *
 * Features:
 *  - Resource loader for Iconify icons and unDraw illustrations
 *  - Multi-block support with page navigation
 *  - Real-time streaming render (DSL is fault-tolerant)
 *  - PNG/SVG export
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useChatStore } from '../../store/chatStore';
import * as AntVInfographic from '@antv/infographic';
import { AlertCircle } from 'lucide-react';

const Infographic: any = (AntVInfographic as any).Infographic;

// ─── Resource Loader (Iconify icons + unDraw illustrations) ───

const svgTextCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string | null>>();

if ((AntVInfographic as any).registerResourceLoader) {
  (AntVInfographic as any).registerResourceLoader(async (config: any) => {
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
              url = `https://api.iconify.design/${data}.svg`;
            } else if (scene === 'illus') {
              url = `https://raw.githubusercontent.com/balazser/undraw-svg-collection/refs/heads/main/svgs/${data}.svg`;
            } else return null;

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
      return (AntVInfographic as any).loadSVGResource(svgText);
    } catch {
      return null;
    }
  });
}

// ─── Component ───

export default function InfographicCanvas() {
  const { canvasCode, isStreaming } = useChatStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const infographicRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [blocks, setBlocks] = useState<string[]>([]);

  // Split DSL content into infographic blocks
  useEffect(() => {
    if (!canvasCode) {
      setBlocks([]);
      return;
    }

    let dslContent = canvasCode.trim();
    // Strip markdown code fences if present
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
    const matches = [...dslContent.matchAll(codeBlockRegex)];
    let extracted = matches.length > 0
      ? matches.map(m => m[1].trim()).join('\n\n')
      : dslContent;

    // Split by 'infographic' keyword at start of line
    const splitBlocks = extracted
      .split(/(?=^infographic\s)/m)
      .map(b => b.trim())
      .filter(b => b.startsWith('infographic'));

    // Follow latest block during streaming
    if (isStreaming && splitBlocks.length > blocks.length) {
      setActiveBlockIndex(splitBlocks.length - 1);
    }

    setBlocks(splitBlocks);

    // Clamp index if out of bounds
    if (!isStreaming && splitBlocks.length > 0 && activeBlockIndex >= splitBlocks.length) {
      setActiveBlockIndex(splitBlocks.length - 1);
    }
  }, [canvasCode, isStreaming]);

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
    const activeBlock = blocks[activeBlockIndex];
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
      setError(null);
      infographicRef.current.render(activeBlock);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to render infographic';
      if (!isStreaming) setError(msg);
    }
  }, [blocks, activeBlockIndex, isStreaming]);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-white p-8">
        <div className="p-4 bg-red-50 rounded-full mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <p className="text-base font-semibold text-slate-800 mb-2">Infographic Render Failed</p>
        <p className="text-sm text-slate-600 mb-4">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-white flex flex-col">
      <div ref={containerRef} className="flex-1 w-full h-0" />

      {blocks.length > 1 && (
        <div className="h-10 border-t border-slate-100 flex items-center justify-center gap-4 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-1.5 p-1 bg-white rounded-lg border border-slate-200 shadow-sm">
            {blocks.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveBlockIndex(idx)}
                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-medium transition-all ${
                  activeBlockIndex === idx
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
            Page {activeBlockIndex + 1} of {blocks.length}
          </span>
        </div>
      )}
    </div>
  );
}
