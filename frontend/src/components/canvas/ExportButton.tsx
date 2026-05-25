/**
 * ExportButton — inline toolbar export button with dropdown.
 * Uses each diagram library's native export API:
 *
 * - Mermaid: mermaid.render() from canvasCode → SVG string
 * - ECharts: canvas.toBlob() from chart's <canvas> element
 * - Excalidraw: @excalidraw/excalidraw exportToBlob/exportToSvg
 * - DrawIO: iframe postMessage export protocol
 * - Mindmap: mind-elixir exportPng/exportSvg official API
 * - Flow: ReactFlow viewport → html2canvas
 * - Infographic: DOM SVG extraction from container
 */

import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';

/** Download a blob as a file */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download text content as a file */
function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

/** Convert an SVG string to PNG blob via offscreen canvas.
 *  Parses viewBox to get true diagram dimensions — fixes partial export
 *  when SVG lacks explicit width/height attributes.
 */
async function svgStringToPng(svgString: string, scale = 2): Promise<Blob> {
  // Parse SVG to extract/set proper dimensions
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error('Invalid SVG');

  // Extract dimensions from viewBox if width/height are missing or percentage-based
  let w = 0, h = 0;
  const viewBox = svgEl.getAttribute('viewBox');
  const attrW = svgEl.getAttribute('width');
  const attrH = svgEl.getAttribute('height');

  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) { w = parts[2]; h = parts[3]; }
  }

  // Use explicit pixel width/height if available and not percentage
  if (attrW && !attrW.includes('%') && parseFloat(attrW) > 0) w = parseFloat(attrW);
  if (attrH && !attrH.includes('%') && parseFloat(attrH) > 0) h = parseFloat(attrH);

  // Fallback
  if (!w || !h) { w = 1920; h = 1080; }

  // Inject explicit width/height and remove max-width CSS that clips rendering
  svgEl.setAttribute('width', String(w));
  svgEl.setAttribute('height', String(h));
  svgEl.style.maxWidth = 'none';
  svgEl.style.width = `${w}px`;
  svgEl.style.height = `${h}px`;

  const fixedSvg = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([fixedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
}

type ExportFormat = 'png' | 'svg';

export default function ExportButton() {
  const { canvasEngine, canvasCode, excalidrawAPI, mindmapInstance, isStreaming } = useChatStore();
  const [showMenu, setShowMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Don't render if no diagram
  if (!canvasCode || isStreaming) return null;

  const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  // ── Export handlers per agent ──

  const exportMermaid = async (format: ExportFormat) => {
    // Use mermaid.render() to generate SVG from source code, not DOM scraping
    const mermaid = (await import('mermaid')).default;
    let code = canvasCode.trim();
    if (code.startsWith('```')) {
      code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
    }
    const { svg } = await mermaid.render(`export-${Date.now()}`, code);
    if (format === 'svg') {
      downloadText(svg, `Mermaid_${timestamp()}.svg`, 'image/svg+xml');
    } else {
      const blob = await svgStringToPng(svg);
      downloadBlob(blob, `Mermaid_${timestamp()}.png`);
    }
  };

  const exportExcalidraw = async (format: ExportFormat) => {
    if (!excalidrawAPI) throw new Error('Excalidraw API 未就绪');
    const elements = excalidrawAPI.getSceneElements();
    const appState = { ...excalidrawAPI.getAppState(), exportBackground: true };
    const files = excalidrawAPI.getFiles();

    if (format === 'svg') {
      const { exportToSvg } = await import('@excalidraw/excalidraw');
      const svg = await exportToSvg({ elements, appState, files });
      const svgStr = new XMLSerializer().serializeToString(svg as unknown as SVGElement);
      downloadText(svgStr, `Excalidraw_${timestamp()}.svg`, 'image/svg+xml');
    } else {
      const { exportToBlob } = await import('@excalidraw/excalidraw');
      const blob = await exportToBlob({ elements, appState, files, mimeType: 'image/png' });
      downloadBlob(blob, `Excalidraw_${timestamp()}.png`);
    }
  };

  const exportCharts = async (_format: ExportFormat) => {
    // ECharts renders to <canvas> — grab it directly
    const canvasContainer = document.querySelector('[data-canvas]');
    const canvasEl = canvasContainer?.querySelector('canvas');
    if (!canvasEl) throw new Error('找不到 ECharts 画布');

    // Try echarts getConnectedDataURL if instance is accessible
    const echartsModule = await import('echarts');
    const instance = echartsModule.getInstanceByDom(canvasEl.parentElement as HTMLElement);
    if (instance) {
      const dataUrl = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `Charts_${timestamp()}.png`;
      a.click();
    } else {
      // Fallback: direct canvas export
      canvasEl.toBlob((blob) => {
        if (blob) downloadBlob(blob, `Charts_${timestamp()}.png`);
      }, 'image/png');
    }
  };

  const exportDrawio = async (format: ExportFormat) => {
    // DrawIO uses iframe postMessage protocol for export
    const iframe = document.querySelector('iframe[src*="diagrams.net"]') as HTMLIFrameElement;
    if (!iframe?.contentWindow) throw new Error('Draw.io iframe 未就绪');

    const exportFormat = format === 'svg' ? 'xmlsvg' : 'png';

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Draw.io 导出超时'));
      }, 10000);

      const handler = (event: MessageEvent) => {
        if (!event.data || typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'export' && msg.data) {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            const ext = format === 'svg' ? 'svg' : 'png';
            const a = document.createElement('a');
            a.href = msg.data;
            a.download = `DrawIO_${timestamp()}.${ext}`;
            a.click();
            resolve();
          }
        } catch { /* ignore */ }
      };

      window.addEventListener('message', handler);
      iframe.contentWindow!.postMessage(JSON.stringify({
        action: 'export',
        format: exportFormat,
        spin: 'Exporting...',
      }), '*');
    });
  };

  const exportMindmap = async (format: ExportFormat) => {
    if (!mindmapInstance) {
      throw new Error('Mindmap 实例未就绪，请稍后重试');
    }

    // 1. Temporarily restore scale to 1.0 to ensure correct sizing and prevent clipping
    // (mind-elixir calculates export size based on current DOM clientWidth/clientHeight)
    const savedScale = mindmapInstance.scaleVal || 1;
    try {
      if (typeof mindmapInstance.scale === 'function') {
        mindmapInstance.scale(1.0);
      }
    } catch (e) {
      console.warn('[Export] Failed to reset scale:', e);
    }

    // Wait a brief tick for DOM layout update
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      if (format === 'svg') {
        // Method 1 (Preferred for SVG): Native exportSvg with proper layout
        if (typeof mindmapInstance.exportSvg === 'function') {
          const blob = mindmapInstance.exportSvg();
          if (blob) {
            downloadBlob(blob, `Mindmap_${timestamp()}.svg`);
            return;
          }
        }

        // Fallback for SVG: @zumer/snapdom
        const container = document.querySelector('.map-container') || mindmapInstance.nodes;
        if (container) {
          const { snapdom } = await import('@zumer/snapdom');
          const result = await snapdom(container);
          const svgStr = await result.toSvg();
          downloadText(svgStr, `Mindmap_${timestamp()}.svg`, 'image/svg+xml');
          return;
        }
      } else {
        // Method 1 (Preferred for PNG): @zumer/snapdom with high resolution (scale: 3)
        const container = document.querySelector('.map-container') || mindmapInstance.nodes;
        if (container) {
          const { snapdom } = await import('@zumer/snapdom');
          // Use scale: 3 for ultra-crisp high-res png output
          const result = await snapdom(container, { scale: 3 });
          await result.download({ format: 'png', filename: `Mindmap_${timestamp()}` });
          return;
        }

        // Fallback for PNG: Native exportPng
        if (typeof mindmapInstance.exportPng === 'function') {
          const blob = await mindmapInstance.exportPng();
          if (blob) {
            downloadBlob(blob, `Mindmap_${timestamp()}.png`);
            return;
          }
        }
      }

      throw new Error('未找到可用的导出方法');
    } catch (error) {
      console.error('[Export] Mindmap export failed:', error);
      throw error;
    } finally {
      // 2. Always restore the user's original zoom scale
      try {
        if (typeof mindmapInstance.scale === 'function') {
          mindmapInstance.scale(savedScale);
        }
      } catch (e) {
        console.warn('[Export] Failed to restore scale:', e);
      }
    }
  };

  const exportFlow = async (format: ExportFormat) => {
    // Delegate to FlowCanvas via custom event — it uses useReactFlow() + html-to-image
    // which is the official ReactFlow export approach
    return new Promise<void>((resolve) => {
      window.dispatchEvent(new CustomEvent('flow-export', { detail: { format } }));
      // Give it a moment to complete (fire-and-forget pattern)
      setTimeout(resolve, 1500);
    });
  };

  const exportInfographic = async (format: ExportFormat) => {
    // Infographic renders SVG via @antv/infographic — extract from DOM
    const container = document.querySelector('[data-canvas]');
    const svgEl = container?.querySelector('svg');
    if (!svgEl) throw new Error('找不到信息图 SVG');

    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const svgStr = new XMLSerializer().serializeToString(clone);

    if (format === 'svg') {
      downloadText(svgStr, `Infographic_${timestamp()}.svg`, 'image/svg+xml');
    } else {
      const blob = await svgStringToPng(svgStr);
      downloadBlob(blob, `Infographic_${timestamp()}.png`);
    }
  };

  // ── Main export dispatcher ──

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    setShowMenu(false);
    try {
      switch (canvasEngine) {
        case 'mermaid':     await exportMermaid(format); break;
        case 'excalidraw':  await exportExcalidraw(format); break;
        case 'charts':      await exportCharts(format); break;
        case 'drawio':      await exportDrawio(format); break;
        case 'mindmap':     await exportMindmap(format); break;
        case 'flow':        await exportFlow(format); break;
        case 'infographic': await exportInfographic(format); break;
        default:
          alert(`暂不支持 ${canvasEngine} 类型的导出`);
      }
    } catch (err) {
      console.error('[Export] Failed:', err);
      alert(`导出失败: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // Determine which formats are available
  const svgSupported = ['mermaid', 'excalidraw', 'drawio', 'infographic', 'flow', 'mindmap'].includes(canvasEngine || '');

  return (
    <div ref={menuRef} style={{ position: 'relative', zIndex: 100 }}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                   bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 
                   transition-all text-slate-600 disabled:opacity-50 disabled:cursor-wait
                   shadow-sm hover:shadow"
      >
        {exporting ? (
          <>
            <span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
            导出中
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            导出
            <ChevronDown className="w-3 h-3 opacity-50" />
          </>
        )}
      </button>

      {showMenu && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: '#fff',
            borderRadius: '10px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
            border: '1px solid #e5e7eb',
            overflow: 'hidden',
            minWidth: '150px',
            zIndex: 200,
          }}
        >
          <button
            onClick={() => handleExport('png')}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer"
          >
            <span className="text-sm">🖼️</span>
            导出为 PNG
          </button>
          {svgSupported && (
            <button
              onClick={() => handleExport('svg')}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer border-t border-slate-100"
            >
              <span className="text-sm">📐</span>
              导出为 SVG
            </button>
          )}
        </div>
      )}
    </div>
  );
}
