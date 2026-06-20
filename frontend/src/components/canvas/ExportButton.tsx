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
import { ConfirmDialog, NoticeDialog } from '../common/AppDialog';
import { useT } from '../../i18n';
import { renderHtmlArtifact } from './htmlArtifactRenderer';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';
const ENTERPRISE_EXPORT_SCOPES = [
  'diagram:read',
  'diagram:write',
  'artifact:read',
  'artifact:write',
  'tool:diagram',
  'tool:office',
  'knowledge:read',
  'export:basic',
  'export:pdf',
  'export:pptx',
];

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

type ExportFormat = 'png' | 'svg' | 'json' | 'pdf' | 'pptx' | 'html';
type LocalExportFormat = 'png' | 'svg' | 'html';
type BackendExportJob = {
  status: string;
  asset_id?: string | null;
  error_message?: string;
};

function isLocalExportFormat(format: ExportFormat): format is LocalExportFormat {
  return format === 'png' || format === 'svg' || format === 'html';
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function shouldSendEnterpriseDownloadHeaders(url: string) {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const target = new URL(url, window.location.origin);
    if (API_BASE) {
      const apiOrigin = new URL(API_BASE, window.location.origin).origin;
      return target.origin === apiOrigin;
    }
    return target.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function readErrorPayload(response: Response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { detail: raw };
  }
}

export default function ExportButton() {
  const {
    canvasEngine,
    canvasCode,
    canvasDiagramId,
    canvasDiagramVersionId,
    conversationId,
    excalidrawAPI,
    mindmapInstance,
    isStreaming,
  } = useChatStore();
  const { t } = useT();
  const [showMenu, setShowMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ format: ExportFormat; message: string } | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
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
  const hasVersionedExport = Boolean(canvasDiagramId && canvasDiagramVersionId);

  const enterpriseHeaders = () => ({
    'Content-Type': 'application/json',
    'x-tenant-id': 'local',
    'x-user-id': 'anonymous',
    'x-scopes': ENTERPRISE_EXPORT_SCOPES.join(','),
  });

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
    if (!excalidrawAPI) throw new Error(t('export.excalidrawNotReady'));
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
    if (!canvasEl) throw new Error(t('export.chartsCanvasMissing'));

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
    if (!iframe?.contentWindow) throw new Error(t('export.drawioNotReady'));

    const exportFormat = format === 'svg' ? 'xmlsvg' : 'png';

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(t('export.drawioTimeout')));
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
      throw new Error(t('export.mindmapNotReady'));
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
          const blob = await result.toBlob({ type: 'svg' });
          downloadBlob(blob, `Mindmap_${timestamp()}.svg`);
          return;
        }
      } else {
        // Method 1 (Preferred for PNG): @zumer/snapdom with high resolution (scale: 3)
        const container = document.querySelector('.map-container') || mindmapInstance.nodes;
        if (container) {
          const { snapdom } = await import('@zumer/snapdom');
          // Use scale: 3 for ultra-crisp high-res png output
          const result = await snapdom(container, { scale: 3 });
          const blob = await result.toBlob({ type: 'png', scale: 3 });
          downloadBlob(blob, `Mindmap_${timestamp()}.png`);
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

      throw new Error(t('export.noAvailableMethod'));
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
    if (!svgEl) throw new Error(t('export.infographicSvgMissing'));

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

  const exportArtifactHtml = async () => {
    const rendered = renderHtmlArtifact(canvasCode);
    downloadText(rendered.html, `OfficeArtifact_${timestamp()}.html`, 'text/html;charset=utf-8');
  };

  // ── Main export dispatcher ──

  const exportLocal = async (format: LocalExportFormat) => {
    switch (canvasEngine) {
      case 'mermaid':     await exportMermaid(format); break;
      case 'excalidraw':  await exportExcalidraw(format); break;
      case 'charts':      await exportCharts(format); break;
      case 'drawio':      await exportDrawio(format); break;
      case 'mindmap':     await exportMindmap(format); break;
      case 'flow':        await exportFlow(format); break;
      case 'infographic': await exportInfographic(format); break;
      case 'html_email':
      case 'web_report_html':
        if (format !== 'html') throw new Error(t('export.unsupported', { engine: canvasEngine || 'artifact' }));
        await exportArtifactHtml();
        break;
      default:
        throw new Error(t('export.unsupported', { engine: canvasEngine || 'diagram' }));
    }
  };

  const createBackendExportJob = async (format: ExportFormat, confirmed = false): Promise<BackendExportJob> => {
    if (!canvasDiagramId || !canvasDiagramVersionId) {
      throw new Error(t('export.enterpriseVersionRequired'));
    }

    const exportRes = await fetch(`${API_BASE}/api/diagrams/${canvasDiagramId}/versions/${canvasDiagramVersionId}/exports`, {
      method: 'POST',
      headers: enterpriseHeaders(),
      body: JSON.stringify({
        format,
        conversation_id: conversationId,
        scopes: ENTERPRISE_EXPORT_SCOPES,
        confirmed,
        confirmation_reason: confirmed ? 'frontend_user_confirmed' : '',
      }),
    });
    if (!exportRes.ok) {
      const payload = await readErrorPayload(exportRes);
      const detail = payload?.detail || payload;
      if (exportRes.status === 409 && detail?.required_confirmation) {
        const message = detail.message || t('export.confirmRequired', { format: format.toUpperCase() });
        const error = new Error(message) as Error & { requiredConfirmation?: boolean; format?: ExportFormat };
        error.requiredConfirmation = true;
        error.format = format;
        throw error;
      }
      const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
      throw new Error(t('export.jobCreateFailed', { message: message || exportRes.status }));
    }

    return exportRes.json();
  };

  const exportBackend = async (format: ExportFormat, confirmed = false) => {
    const job = await createBackendExportJob(format, confirmed);
    if (job.status !== 'completed' || !job.asset_id) {
      throw new Error(job.error_message || t('export.jobIncomplete'));
    }

    const urlRes = await fetch(`${API_BASE}/api/export-assets/${job.asset_id}/download-url`, {
      headers: enterpriseHeaders(),
    });
    if (!urlRes.ok) {
      const detail = await urlRes.text();
      throw new Error(t('export.downloadUrlFailed', { message: detail || urlRes.status }));
    }

    const { download_url } = await urlRes.json();
    const assetUrl = String(download_url || '');
    const finalUrl = assetUrl.startsWith('/') ? `${API_BASE}${assetUrl}` : assetUrl;
    const assetRes = await fetch(
      finalUrl,
      shouldSendEnterpriseDownloadHeaders(finalUrl) ? { headers: enterpriseHeaders() } : undefined,
    );
    if (!assetRes.ok) {
      const detail = await assetRes.text();
      throw new Error(t('export.assetDownloadFailed', { message: detail || assetRes.status }));
    }

    const blob = await assetRes.blob();
    const filename = filenameFromDisposition(
      assetRes.headers.get('Content-Disposition'),
      `SmartDiagram_${timestamp()}.${format}`,
    );
    downloadBlob(blob, filename);
  };

  const handleExport = async (format: ExportFormat, confirmed = false) => {
    setExporting(true);
    setShowMenu(false);
    try {
      if (hasVersionedExport) {
        await exportBackend(format, confirmed);
        return;
      }

      if (!isLocalExportFormat(format)) {
        throw new Error(t('export.versionRequired'));
      }
      await exportLocal(format);
    } catch (err) {
      console.error('[Export] Failed:', err);
      const exportError = err as Error & { requiredConfirmation?: boolean; format?: ExportFormat };
      if (exportError.requiredConfirmation && exportError.format) {
        setConfirmation({ format: exportError.format, message: exportError.message });
        return;
      }
      if (hasVersionedExport && isLocalExportFormat(format)) {
        console.warn('[Export] Falling back to local canvas export.');
        try {
          await exportLocal(format);
          return;
        } catch (fallbackErr) {
          console.error('[Export] Local fallback failed:', fallbackErr);
        }
      }
      setNotice({ title: t('common.error'), message: t('export.failed', { message: (err as Error).message }) });
    } finally {
      setExporting(false);
    }
  };

  const confirmExport = async () => {
    const pending = confirmation;
    if (!pending) return;
    setConfirmation(null);
    await handleExport(pending.format, true);
  };

  // Determine which formats are available
  const officeArtifact = canvasEngine === 'html_email' || canvasEngine === 'web_report_html';
  const svgSupported = !officeArtifact && (hasVersionedExport || ['mermaid', 'excalidraw', 'drawio', 'infographic', 'flow', 'mindmap'].includes(canvasEngine || ''));

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
            {t('export.exporting')}
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            {t('export.title')}
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
          {officeArtifact ? (
            <button
              onClick={() => handleExport('html')}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer"
            >
              <span className="text-sm">HTML</span>
              {t('export.as', { format: 'HTML' })}
            </button>
          ) : (
            <button
              onClick={() => handleExport('png')}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer"
            >
              <span className="text-sm">PNG</span>
              {t('export.as', { format: 'PNG' })}
            </button>
          )}
          {svgSupported && (
            <button
              onClick={() => handleExport('svg')}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer border-t border-slate-100"
            >
              <span className="text-sm">📐</span>
              {t('export.as', { format: 'SVG' })}
            </button>
          )}
          {hasVersionedExport && (
            <>
              <button
                onClick={() => handleExport('json')}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer border-t border-slate-100"
              >
                <span className="text-sm">JSON</span>
                {t('export.as', { format: 'JSON' })}
              </button>
              {!officeArtifact && (
                <>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer border-t border-slate-100"
                  >
                    <span className="text-sm">PDF</span>
                    {t('export.as', { format: 'PDF' })}
                  </button>
                  <button
                    onClick={() => handleExport('pptx')}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-none cursor-pointer border-t border-slate-100"
                  >
                    <span className="text-sm">PPT</span>
                    {t('export.as', { format: 'PPTX' })}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={t('export.confirmTitle')}
        message={t('export.confirmMessage', { message: confirmation?.message || '' })}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        busy={exporting}
        onConfirm={confirmExport}
        onCancel={() => setConfirmation(null)}
      />
      <NoticeDialog
        open={Boolean(notice)}
        title={notice?.title || t('common.error')}
        message={notice?.message || ''}
        closeLabel={t('common.close')}
        onClose={() => setNotice(null)}
      />
    </div>
  );
}
