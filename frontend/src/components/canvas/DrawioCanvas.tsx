/**
 * DrawioCanvas — Renders Draw.io diagrams via same-domain reverse proxy.
 *
 * Loading strategy:
 *  - DEV:  direct to localhost:9022 (docker container)
 *  - PROD: /drawio/ path via nginx reverse proxy to drawio container
 *  - If primary fails after 10s, fallback to online embed.diagrams.net
 *
 * Features:
 *  - Perfect rendering of ALL draw.io shapes, styles, and edge routing
 *  - Built-in editing capability (drag, resize, connect)
 *  - Export as PNG/SVG via draw.io's native export
 *  - Download as .drawio file
 *  - Auto-fit diagram to viewport
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useChatStore } from '../../store/chatStore';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { useT } from '../../i18n';

// ─── Constants ───

/** DEV → docker direct; PROD → nginx reverse proxy (same domain, no CORS) */
const PRIMARY_URL = import.meta.env.DEV ? 'http://localhost:9022/' : '/drawio/';
const FALLBACK_URL = 'https://embed.diagrams.net/';
const LOAD_TIMEOUT_MS = 10_000; // 10s — nginx proxy should respond much faster

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

function buildDrawioUrl(base: string): string {
  const params = new URLSearchParams({
    embed: '1',
    ui: 'atlas',
    spin: '1',
    modified: 'unsavedChanges',
    proto: 'json',
    configure: '1',
    noSaveBtn: '1',
    noExitBtn: '1',
  });
  return base + '?' + params.toString();
}

// ─── Component ───

export default function DrawioCanvas() {
  const { canvasCode, isStreaming } = useChatStore();
  const { t } = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedXml = useRef(false);

  const drawioUrl = useMemo(
    () => buildDrawioUrl(useFallback ? FALLBACK_URL : PRIMARY_URL),
    [useFallback]
  );

  // Handle messages from draw.io iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'string') return;

      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.event === 'configure') {
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

  // Loading timeout: primary → fallback → error
  useEffect(() => {
    if (iframeReady) return;

    loadTimeoutRef.current = setTimeout(() => {
      if (iframeReady) return;

      if (!useFallback) {
        // Primary URL failed → switch to online fallback
        console.warn('[DrawioCanvas] Primary URL timeout, falling back to embed.diagrams.net...');
        setUseFallback(true);
        setIframeReady(false);
        setIsLoading(true);
        setLoadError(null);
      } else {
        // Fallback also failed → show error
        setLoadError(t('drawio.loadTimeout'));
        setIsLoading(false);
      }
    }, LOAD_TIMEOUT_MS);

    return () => { if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current); };
  }, [useFallback, iframeReady, t]);

  // Load XML into iframe when ready
  useEffect(() => {
    if (!iframeReady || !canvasCode || isStreaming || !iframeRef.current) return;

    const xml = cleanXml(canvasCode);
    if (!xml.startsWith('<')) return;

    hasLoadedXml.current = true;
    const win = iframeRef.current.contentWindow;

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

  // Retry handler — restart from primary
  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsLoading(true);
    setIframeReady(false);
    setUseFallback(false);
  }, []);

  // Error state
  if (loadError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 p-8">
        <div className="p-4 bg-red-50 rounded-full mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <p className="text-base font-semibold text-slate-800 mb-2">{t('drawio.loadFailed')}</p>
        <p className="text-sm text-slate-600 mb-4 max-w-md text-center">{loadError}</p>
        <button
          onClick={handleRetry}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          {t('common.retry')}
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
          <p className="text-sm text-slate-500">{t('drawio.loading')}</p>
          <p className="text-xs text-slate-400 mt-1">
            {useFallback ? t('drawio.sourceOnline') : t('drawio.sourceLocal')}
          </p>
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && !isLoading && (
        <div className="absolute top-3 left-3 z-50 flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('drawio.generating')}
        </div>
      )}

      {/* Download button */}
      {!isLoading && hasLoadedXml.current && (
        <div className="absolute top-3 right-3 z-50">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-slate-600 shadow-sm"
            title={t('drawio.downloadFile')}
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
