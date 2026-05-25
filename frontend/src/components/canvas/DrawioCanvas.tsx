/**
 * DrawioCanvas — Renders Draw.io diagrams using the official draw.io embedded editor.
 *
 * Uses embed.diagrams.net iframe for pixel-perfect rendering of mxGraph XML.
 * This is the same proven approach used by DeepDiagram-Pro and draw.io's official docs.
 *
 * Features:
 *  - Perfect rendering of ALL draw.io shapes, styles, and edge routing
 *  - Built-in editing capability (drag, resize, connect)
 *  - Export as PNG/SVG via draw.io's native export
 *  - Download as .drawio file
 *  - Auto-fit diagram to viewport
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useChatStore } from '../../store/chatStore';
import { AlertCircle, Download, Loader2 } from 'lucide-react';

// ─── XML Sanitizer ───

function sanitizeDrawioXml(xml: string): string {
  if (!xml) return xml;
  // Remove <Array .../> self-closing elements (LLM artifact)
  let cleaned = xml.replace(/<Array[^/>]*\/>/g, '');
  // Remove <Array ...>...</Array> elements
  cleaned = cleaned.replace(/<Array[^>]*>[\s\S]*?<\/Array>/g, '');
  // Clean up whitespace
  cleaned = cleaned.replace(/\n\s*\n/g, '\n');
  return cleaned.trim();
}

function cleanXml(code: string): string {
  let xml = code.trim();
  // Strip markdown code fences
  const match = xml.match(/```(?:xml|drawio)?\s*([\s\S]*?)\s*```/i);
  if (match) xml = match[1].trim();
  return sanitizeDrawioXml(xml);
}

// ─── Component ───

export default function DrawioCanvas() {
  const { canvasCode, isStreaming } = useChatStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedXml = useRef(false);

  // draw.io embed URL with viewer-friendly config
  const drawioUrl = "https://embed.diagrams.net/?" + new URLSearchParams({
    embed: '1',
    ui: 'atlas',
    spin: '1',
    modified: 'unsavedChanges',
    proto: 'json',
    configure: '1',
    noSaveBtn: '1',
    noExitBtn: '1',
  }).toString();

  // Handle messages from draw.io iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'string') return;

      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.event === 'configure') {
        // Configure the editor appearance
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify({
          action: 'configure',
          config: {
            compressXml: false,
            defaultFonts: ['Inter', 'system-ui', 'sans-serif'],
          }
        }), '*');
      }

      if (msg.event === 'init') {
        setIframeReady(true);
        setIsLoading(false);
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      }

      if (msg.event === 'export' && msg.data) {
        // Handle export download
        const ext = msg.format === 'xmlsvg' || msg.format === 'svg' ? 'svg' : 'png';
        const a = document.createElement('a');
        a.href = msg.data;
        a.download = `smartdiagram-drawio-${Date.now()}.${ext}`;
        a.click();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Set loading timeout (30s)
  useEffect(() => {
    loadTimeoutRef.current = setTimeout(() => {
      if (!iframeReady) {
        setLoadError('draw.io 编辑器加载超时，请检查网络连接');
        setIsLoading(false);
      }
    }, 30000);
    return () => { if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current); };
  }, [iframeReady]);

  // Load XML into iframe when ready
  useEffect(() => {
    if (!iframeReady || !canvasCode || isStreaming || !iframeRef.current) return;

    const xml = cleanXml(canvasCode);
    if (!xml.startsWith('<')) return;

    hasLoadedXml.current = true;
    const win = iframeRef.current.contentWindow;

    // Load the diagram XML
    win?.postMessage(JSON.stringify({
      action: 'load',
      xml: xml,
      autosave: 0,
    }), '*');

    // Auto-fit after loading
    setTimeout(() => {
      win?.postMessage(JSON.stringify({ action: 'layout', layouts: [] }), '*');
      setTimeout(() => {
        win?.postMessage(JSON.stringify({ action: 'fit', padding: 20 }), '*');
      }, 500);
    }, 800);
  }, [iframeReady, canvasCode, isStreaming]);

  // Download as .drawio file
  const handleDownload = useCallback(() => {
    if (!canvasCode) return;
    const xml = cleanXml(canvasCode);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smartdiagram-drawio-${Date.now()}.drawio`;
    a.click();
    URL.revokeObjectURL(url);
  }, [canvasCode]);

  // Error state
  if (loadError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 p-8">
        <div className="p-4 bg-red-50 rounded-full mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <p className="text-base font-semibold text-slate-800 mb-2">Draw.io 加载失败</p>
        <p className="text-sm text-slate-600 mb-4 max-w-md text-center">{loadError}</p>
        <button
          onClick={() => { setLoadError(null); setIsLoading(true); setIframeReady(false); }}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-slate-50 overflow-hidden">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-50/90">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
          <p className="text-sm text-slate-500">正在加载 Draw.io 编辑器...</p>
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && !isLoading && (
        <div className="absolute top-3 left-3 z-50 flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          正在生成...
        </div>
      )}

      {/* Download button */}
      {hasLoadedXml.current && (
        <div className="absolute top-3 right-3 z-50">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-slate-600 shadow-sm"
            title="下载 .drawio 文件"
          >
            <Download className="w-3 h-3" /> .drawio
          </button>
        </div>
      )}

      {/* draw.io iframe */}
      <iframe
        ref={iframeRef}
        src={drawioUrl}
        className="w-full h-full border-none"
        title="Draw.io Editor"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
