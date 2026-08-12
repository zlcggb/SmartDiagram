/**
 * MermaidCanvas — renders Mermaid.js diagrams with:
 * - Theme switcher (default, dark, forest, neutral)
 * - Inline code editor toggle for manual editing
 * - Pan & zoom
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { RefreshCw } from 'lucide-react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import { useT } from '@/app/i18n';
import { normalizeMermaidCode, stabilizeMermaidFlowchartEdgeLabels, balanceBlocks } from '@/shared/lib/mermaidSanitizer';

const THEMES = [
  { id: 'default', labelKey: 'mermaid.theme.default', icon: '🎨' },
  { id: 'forest', labelKey: 'mermaid.theme.forest', icon: '🌲' },
  { id: 'dark', labelKey: 'mermaid.theme.dark', icon: '🌙' },
  { id: 'neutral', labelKey: 'mermaid.theme.neutral', icon: '◻️' },
] as const;

type ThemeId = (typeof THEMES)[number]['id'];



export default function MermaidCanvas() {
  const {
    canvasCode,
    streamingCode,
    isStreaming,
    setCanvasCode,
    canvasMode,
    setCanvasMode,
    canvasTask,
    canvasEngine,
    canvasDiagramId,
    canvasDiagramVersionId,
    canvasRenderRevision,
    requestCanvasRenderRetry,
  } = useChatStore();
  const { t } = useT();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRendered, setHasRendered] = useState(false);
  const [theme, setTheme] = useState<ThemeId>('default');
  const [showEditor, setShowEditor] = useState(false);
  const [editorCode, setEditorCode] = useState('');

  // Pan & zoom state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  // Sync editor code when canvasCode changes
  useEffect(() => {
    if (canvasCode) {
      let code = canvasCode.trim();
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      }
      setTimeout(() => setEditorCode(code), 0);
    }
  }, [canvasCode]);

  // Re-initialize mermaid when theme changes
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'loose',
      fontFamily: '"Inter", "SF Pro Display", -apple-system, sans-serif',
      flowchart: { curve: 'basis', padding: 15 },
      sequence: { actorMargin: 50, messageMargin: 40 },
    });
  }, [theme]);

  // Auto-switch Mermaid theme when canvasMode changes
  useEffect(() => {
    setTimeout(() => setTheme(canvasMode === 'dark' ? 'dark' : 'default'), 0);
  }, [canvasMode]);

  // Determine active mermaid code: use streamingCode during generation, canvasCode when done
  const codeToRender = (isStreaming && streamingCode) ? streamingCode : canvasCode;

  const handleAutoRepairRetry = useCallback(() => {
    const source = codeToRender || editorCode || canvasCode;
    if (!source.trim()) return;
    setError(null);
    setHasRendered(false);
    window.dispatchEvent(new CustomEvent('send-ai-message', {
      detail: {
        text: [
          '@mermaid 请修复当前 Mermaid 图表并重新渲染。',
          '要求：保留原业务内容、关键节点、分层结构和关系，不要降级为空图，不要删除核心节点，不要只改配色。',
          '请针对 Mermaid 语法错误和布局渲染错误进行修复。不要使用 flowchart 边标签语法（例如 A -->|"关系"| B），请把关系文字改成独立关系节点，输出完整可渲染的 Mermaid 代码。',
          error ? `当前渲染错误：${error}` : '',
        ].filter(Boolean).join('\n'),
        currentCode: source,
        currentTask: canvasTask,
        currentEngine: canvasEngine || 'mermaid',
        currentDiagramId: canvasDiagramId,
        currentDiagramVersionId: canvasDiagramVersionId,
      },
    }));
  }, [
    canvasCode,
    canvasDiagramId,
    canvasDiagramVersionId,
    canvasEngine,
    canvasTask,
    codeToRender,
    editorCode,
    error,
  ]);

  // Render mermaid
  useEffect(() => {
    if (!codeToRender) return;
    if (!containerRef.current) return;

    let tempDiv: HTMLDivElement | null = null;

    const render = async () => {
      try {
        let code = normalizeMermaidCode(codeToRender);

        // Handle streaming code: slice out incomplete trailing line to minimize syntax errors
        if (isStreaming) {
          const lines = code.split('\n');
          // If the last line is likely incomplete (doesn't end with newline in stream), discard it for parsing
          if (!codeToRender.endsWith('\n') && lines.length > 1) {
            code = lines.slice(0, -1).join('\n').trim();
          }
          // 自动补全残缺的闭合块（如 opt/alt/loop 缺少 end），防止流式解析语法错
          code = balanceBlocks(code);
        }

        if (code.startsWith('[') || code.startsWith('{')) return;
        
        // Skip rendering if there are too few lines to form a valid diagram
        if (code.split('\n').length < 2) return;

        const stabilizedCode = stabilizeMermaidFlowchartEdgeLabels(code);
        const candidateCodes = stabilizedCode && stabilizedCode !== code
          ? [stabilizedCode, code]
          : [code];

        let svg = '';
        let renderedCode = code;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < candidateCodes.length; attempt++) {
          const candidateCode = candidateCodes[attempt];
          try {
            // 创建临时 DOM 节点限制 Mermaid 的渲染行为，防止其在全局 body 产生残留炸弹报错
            // 注意：不能用 display:none — Mermaid v11 内部需要容器参与布局计算（getBBox/firstChild），
            // display:none 会导致 "Cannot read properties of null" 崩溃
            tempDiv = document.createElement('div');
            tempDiv.id = `mermaid-temp-holder-${Date.now()}-${attempt}`;
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            tempDiv.style.top = '-9999px';
            tempDiv.style.visibility = 'hidden';
            document.body.appendChild(tempDiv);

            const id = `mermaid-${Date.now()}-${attempt}`;
            const rendered = await mermaid.render(id, candidateCode, tempDiv);
            svg = rendered.svg;
            renderedCode = candidateCode;
            break;
          } catch (renderError) {
            lastError = renderError;
          } finally {
            if (tempDiv && document.body.contains(tempDiv)) {
              document.body.removeChild(tempDiv);
            }
            tempDiv = null;
          }
        }

        if (!svg) {
          throw lastError || new Error('Mermaid render failed');
        }
        
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          if (!isStreaming && renderedCode !== code) {
            setCanvasCode(renderedCode);
            setEditorCode(renderedCode);
          }
          setError(null); // Clear errors on success
          
          // Only reset pan & zoom if this is the first rendering pass or final render
          if (!hasRendered || !isStreaming) {
            setHasRendered(true);
            setScale(1);
            setTranslate({ x: 0, y: 0 });
          }
          
          const svgEl = containerRef.current.querySelector('svg');
          if (!svgEl) {
            throw new Error('Mermaid returned an empty SVG');
          }
          const visibleElementCount = svgEl.querySelectorAll('g,path,rect,text,polygon,circle,ellipse,line').length;
          if (visibleElementCount === 0) {
            throw new Error('Mermaid SVG has no visible elements');
          }
          svgEl.style.maxWidth = 'none';
          svgEl.style.height = 'auto';
        }
      } catch (error: unknown) {
        console.warn('[MermaidCanvas] Intermediate parse/render error (ignored during streaming):', error);
        // Only trigger UI error state if NOT streaming to ensure fluid visual transitions
        if (!isStreaming) {
          setError(error instanceof Error ? error.message : 'Mermaid render failed');
          // 清空残留的半渲染 SVG，防止错误状态下显示空白
          if (containerRef.current) containerRef.current.innerHTML = '';
        }
      } finally {
        // 销毁临时挂载节点
        if (tempDiv && document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        // 双重保障：强制清除 Mermaid 偶尔在 body 遗留的 dmermaid 临时容器，杜绝红炸弹在全局堆积
        const rogueDivs = document.querySelectorAll('div[id^="dmermaid"]');
        rogueDivs.forEach(div => div.remove());
      }
    };
    render();
  // hasRendered 仅在 effect 内部用于条件判断（是否重置 pan/zoom），不应作为触发依赖
  }, [isStreaming, codeToRender, theme, canvasRenderRevision, hasRendered, setCanvasCode]);

  // Reset when canvas is cleared
  useEffect(() => {
    if (!canvasCode) {
      setTimeout(() => {
        setHasRendered(false);
        setError(null);
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }, 0);
    }
  }, [canvasCode]);

  // Apply editor changes — 始终强制重渲染，即使代码值未变也能从错误状态恢复
  const handleApplyEdit = useCallback(() => {
    if (editorCode.trim()) {
      setError(null);
      setHasRendered(false);
      setCanvasCode(editorCode.trim());
      requestCanvasRenderRetry();
    }
  }, [editorCode, setCanvasCode, requestCanvasRenderRetry]);

  // Keyboard shortcut: Cmd/Ctrl+Enter to apply
  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleApplyEdit();
    }
  }, [handleApplyEdit]);

  // Wheel zoom — must use non-passive listener for preventDefault()
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.min(Math.max(prev * delta, 0.1), 5));
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
    (e.target as HTMLElement).style.cursor = 'grabbing';
  }, [translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setTranslate({
      x: translateStart.current.x + (e.clientX - panStart.current.x),
      y: translateStart.current.y + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    setIsPanning(false);
    (e.target as HTMLElement).style.cursor = 'grab';
  }, []);

  const handleFitView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  return (
    <div className={`w-full h-full relative overflow-hidden flex animate-fade-in transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'}`}>
      {/* Left: Code Editor Panel (toggleable) — on mobile: fullscreen overlay */}
      {showEditor && (
        <div
          style={{
            ...(isMobile ? {
              position: 'absolute' as const,
              inset: 0,
              zIndex: 30,
              width: '100%',
            } : {
              width: '380px',
              minWidth: '300px',
            }),
            display: 'flex',
            flexDirection: 'column' as const,
            borderRight: isMobile ? 'none' : (canvasMode === 'light' ? '1px solid #e2e8f0' : '1px solid #1e293b'),
            background: canvasMode === 'light' ? '#f8fafc' : '#0f172a',
          }}
        >
          {/* Editor header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: canvasMode === 'light' ? '1px solid #e2e8f0' : '1px solid #1e293b',
              background: canvasMode === 'light' ? '#f1f5f9' : '#0b0f19',
              gap: '8px',
            }}
          >
            <span style={{ color: canvasMode === 'light' ? '#1e293b' : '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>
              {t('mermaid.editorTitle')}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                onClick={handleApplyEdit}
                style={{
                  fontSize: '11px',
                  padding: '4px 12px',
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {t('mermaid.renderAction')}
              </button>
              <button
                onClick={() => setShowEditor(false)}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  background: canvasMode === 'light' ? '#e2e8f0' : '#334155',
                  color: canvasMode === 'light' ? '#334155' : '#e2e8f0',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                title={t('mermaid.closeEditor')}
              >
                {t('mermaid.closeEditor')}
              </button>
            </div>
          </div>
          {/* Editor textarea */}
          <textarea
            value={editorCode}
            onChange={(e) => setEditorCode(e.target.value)}
            onKeyDown={handleEditorKeyDown}
            spellCheck={false}
            style={{
              flex: 1,
              padding: '12px',
              fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
              fontSize: '13px',
              lineHeight: '1.6',
              background: canvasMode === 'light' ? '#f8fafc' : '#090d16',
              color: canvasMode === 'light' ? '#1e293b' : '#e2e8f0',
              border: 'none',
              outline: 'none',
              resize: 'none',
              tabSize: 2,
            }}
          />
        </div>
      )}

      {/* Right: Diagram area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: canvasMode === 'dark' ? '#090d16' : '#f8fafc',
          transition: 'background 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {error ? (
          <div className="w-full h-full flex items-center justify-center p-8">
            <div className="text-red-400 text-sm bg-red-950/20 p-4 rounded-lg border border-red-900/30 max-w-lg shadow-lg">
              <p className="font-semibold mb-1 text-slate-200">{t('mermaid.renderFailed')}</p>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{error}</pre>
              {canvasCode && (
                <details className="mt-2">
                  <summary className="text-xs text-red-400/80 cursor-pointer hover:text-red-400">{t('mermaid.viewSource')}</summary>
                  <pre className="text-xs whitespace-pre-wrap mt-1 text-red-300/80 max-h-40 overflow-auto bg-red-950/30 p-2 rounded">{canvasCode}</pre>
                </details>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAutoRepairRetry}
                  className="inline-flex items-center gap-1.5 rounded bg-red-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-red-600"
                  title={t('mermaid.autoRepairRetryTitle')}
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('mermaid.autoRepairRetry')}
                </button>
                <button
                  onClick={() => setShowEditor(true)}
                  style={{
                    fontSize: '11px',
                    padding: '4px 12px',
                    background: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {t('mermaid.openEditorFix')}
                </button>
              </div>
            </div>
          </div>
        ) : isStreaming && !hasRendered ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">{t('mermaid.rendering')}</span>
            </div>
          </div>
        ) : !canvasCode && !streamingCode ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-xs text-slate-500">{t('mermaid.waitingForCode')}</p>
          </div>
        ) : null}

        {/* Zoomable/pannable SVG container */}
        <div
          ref={svgWrapperRef}
          className="absolute inset-0 overflow-hidden"
          style={{
            display: (codeToRender && !error) ? 'block' : 'none',
            cursor: 'grab',
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
              transition: isPanning ? 'none' : 'transform 0.1s ease-out',
            }}
          />
        </div>

        {/* Top toolbar: Theme selector + Editor toggle */}
        {hasRendered && !error && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              background: canvasMode === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(8px)',
              borderRadius: '8px',
              boxShadow: canvasMode === 'light' ? '0 4px 12px rgba(0,0,0,0.08)' : '0 4px 12px rgba(0,0,0,0.3)',
              border: canvasMode === 'light' ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.08)',
              padding: '4px',
            }}
          >
            {/* Editor toggle */}
            <button
              onClick={() => setShowEditor(!showEditor)}
              title={showEditor ? t('mermaid.closeEditor') : t('mermaid.openEditor')}
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                background: showEditor ? '#dbeafe' : 'transparent',
                color: showEditor ? '#2563eb' : '#6b7280',
              }}
            >
              {'</>'}
            </button>

            <div style={{ width: '1px', height: '20px', background: '#e5e7eb' }} />

            {/* Theme buttons */}
            {THEMES.map((themeOption) => (
              <button
                key={themeOption.id}
                onClick={() => setTheme(themeOption.id)}
                title={t(themeOption.labelKey)}
                style={{
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  border: theme === themeOption.id ? '2px solid #3b82f6' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: '14px',
                  background: theme === themeOption.id ? '#eff6ff' : 'transparent',
                }}
              >
                {themeOption.icon}
              </button>
            ))}

            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.15)' }} />

            {/* Canvas background toggle: Dark / Light */}
            <button
              onClick={() => setCanvasMode(canvasMode === 'dark' ? 'light' : 'dark')}
              title={canvasMode === 'dark' ? t('mermaid.switchToLightCanvas') : t('mermaid.switchToDarkCanvas')}
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                background: 'transparent',
                color: '#94a3b8',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#f8fafc')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
              {canvasMode === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        )}

        {/* Zoom controls */}
        {hasRendered && !error && (
          <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 p-1">
            <button
              onClick={() => setScale((s) => Math.min(s * 1.2, 5))}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 text-lg font-bold"
              title={t('common.zoomIn')}
            >+</button>
            <button
              onClick={() => setScale((s) => Math.max(s * 0.8, 0.1))}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 text-lg font-bold"
              title={t('common.zoomOut')}
            >−</button>
            <div className="w-px h-5 bg-gray-200" />
            <button
              onClick={handleFitView}
              className="px-2 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-xs"
              title={t('common.fitView')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
            <span className="text-[10px] text-gray-400 px-1 min-w-[36px] text-center">{Math.round(scale * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
