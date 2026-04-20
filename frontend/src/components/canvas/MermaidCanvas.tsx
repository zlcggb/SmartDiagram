/**
 * MermaidCanvas — renders Mermaid.js diagrams with:
 * - Theme switcher (default, dark, forest, neutral)
 * - Inline code editor toggle for manual editing
 * - Pan & zoom
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { useChatStore } from '../../store/chatStore';

const THEMES = [
  { id: 'default', label: '默认', icon: '🎨' },
  { id: 'forest', label: '森林', icon: '🌲' },
  { id: 'dark', label: '暗色', icon: '🌙' },
  { id: 'neutral', label: '简约', icon: '◻️' },
] as const;

type ThemeId = (typeof THEMES)[number]['id'];

export default function MermaidCanvas() {
  const { canvasCode, isStreaming, setCanvasCode } = useChatStore();
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
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  // Sync editor code when canvasCode changes
  useEffect(() => {
    if (canvasCode) {
      let code = canvasCode.trim();
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      }
      setEditorCode(code);
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

  // Render mermaid
  useEffect(() => {
    if (!canvasCode || isStreaming) return;
    if (!containerRef.current) return;

    setError(null);
    const render = async () => {
      try {
        let code = canvasCode.trim();
        if (code.startsWith('```')) {
          code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
        }
        if (code.startsWith('[') || code.startsWith('{')) return;

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, code);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setHasRendered(true);
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = 'none';
            svgEl.style.height = 'auto';
          }
        }
      } catch (e: any) {
        console.error('[MermaidCanvas] Render error:', e);
        setError(e.message || 'Mermaid render failed');
      }
    };
    render();
  }, [isStreaming, canvasCode, theme]);

  // Reset when canvas is cleared
  useEffect(() => {
    if (!canvasCode) {
      setHasRendered(false);
      setError(null);
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
  }, [canvasCode]);

  // Apply editor changes
  const handleApplyEdit = useCallback(() => {
    if (editorCode.trim()) {
      setCanvasCode(editorCode.trim());
    }
  }, [editorCode, setCanvasCode]);

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
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    (e.target as HTMLElement).style.cursor = 'grabbing';
  }, [translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setTranslate({
      x: translateStart.current.x + (e.clientX - panStart.current.x),
      y: translateStart.current.y + (e.clientY - panStart.current.y),
    });
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false;
    (e.target as HTMLElement).style.cursor = 'grab';
  }, []);

  const handleFitView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  return (
    <div className="w-full h-full relative bg-white overflow-hidden flex">
      {/* Left: Code Editor Panel (toggleable) */}
      {showEditor && (
        <div
          style={{
            width: '380px',
            minWidth: '300px',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #e5e7eb',
            background: '#1e1e2e',
          }}
        >
          {/* Editor header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: '1px solid #313244',
              background: '#181825',
            }}
          >
            <span style={{ color: '#cdd6f4', fontSize: '12px', fontWeight: 600 }}>
              📝 Mermaid 代码编辑器
            </span>
            <button
              onClick={handleApplyEdit}
              style={{
                fontSize: '11px',
                padding: '4px 12px',
                background: '#a6e3a1',
                color: '#1e1e2e',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ▶ 渲染 (⌘↵)
            </button>
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
              background: '#1e1e2e',
              color: '#cdd6f4',
              border: 'none',
              outline: 'none',
              resize: 'none',
              tabSize: 2,
            }}
          />
        </div>
      )}

      {/* Right: Diagram area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {error ? (
          <div className="w-full h-full flex items-center justify-center p-8">
            <div className="text-red-500 text-sm bg-red-50 p-4 rounded-lg border border-red-200 max-w-lg">
              <p className="font-medium mb-1">渲染失败</p>
              <pre className="text-xs whitespace-pre-wrap">{error}</pre>
              {canvasCode && (
                <details className="mt-2">
                  <summary className="text-xs text-red-400 cursor-pointer">查看原始代码</summary>
                  <pre className="text-xs whitespace-pre-wrap mt-1 text-red-300 max-h-40 overflow-auto">{canvasCode}</pre>
                </details>
              )}
              <button
                onClick={() => setShowEditor(true)}
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  padding: '4px 12px',
                  background: '#fee2e2',
                  color: '#dc2626',
                  border: '1px solid #fca5a5',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                打开编辑器修复
              </button>
            </div>
          </div>
        ) : isStreaming ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <span>正在生成 Mermaid 图表...</span>
            </div>
          </div>
        ) : !canvasCode ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-gray-400">Mermaid diagram will appear here...</p>
          </div>
        ) : null}

        {/* Zoomable/pannable SVG container */}
        <div
          ref={svgWrapperRef}
          className="absolute inset-0 overflow-hidden"
          style={{
            display: (canvasCode && !isStreaming && !error) ? 'block' : 'none',
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
              transition: isPanning.current ? 'none' : 'transform 0.1s ease-out',
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
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(8px)',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb',
              padding: '4px',
            }}
          >
            {/* Editor toggle */}
            <button
              onClick={() => setShowEditor(!showEditor)}
              title={showEditor ? '关闭编辑器' : '打开代码编辑器'}
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
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                title={t.label}
                style={{
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  border: theme === t.id ? '2px solid #3b82f6' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: '14px',
                  background: theme === t.id ? '#eff6ff' : 'transparent',
                }}
              >
                {t.icon}
              </button>
            ))}
          </div>
        )}

        {/* Zoom controls */}
        {hasRendered && !error && (
          <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 p-1">
            <button
              onClick={() => setScale((s) => Math.min(s * 1.2, 5))}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 text-lg font-bold"
              title="放大"
            >+</button>
            <button
              onClick={() => setScale((s) => Math.max(s * 0.8, 0.1))}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600 text-lg font-bold"
              title="缩小"
            >−</button>
            <div className="w-px h-5 bg-gray-200" />
            <button
              onClick={handleFitView}
              className="px-2 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-xs"
              title="适应视图"
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
