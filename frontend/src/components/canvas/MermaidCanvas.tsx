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

// 自动对齐/平衡 Mermaid 流式生成中尚未闭合的 opt/alt/loop 等块，避免中间渲染语法报错
function balanceSequenceEndBlocks(code: string): string {
  if (!code.includes('sequenceDiagram') && !code.includes('flowchart') && !code.includes('graph')) {
    return code;
  }
  const lines = code.split('\n');
  let openBlocks = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(opt|alt|loop|par|critical|rect|subgraph)(\s|$)/.test(trimmed)) {
      openBlocks++;
    } else if (trimmed === 'end') {
      openBlocks--;
    }
  }
  if (openBlocks > 0) {
    let balanced = code;
    if (!balanced.endsWith('\n')) {
      balanced += '\n';
    }
    for (let i = 0; i < openBlocks; i++) {
      balanced += 'end\n';
    }
    return balanced;
  }
  return code;
}

export default function MermaidCanvas() {
  const { canvasCode, streamingCode, isStreaming, setCanvasCode, canvasMode, setCanvasMode } = useChatStore();
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

  // Auto-switch Mermaid theme when canvasMode changes
  useEffect(() => {
    setTheme(canvasMode === 'dark' ? 'dark' : 'default');
  }, [canvasMode]);

  // Determine active mermaid code: use streamingCode during generation, canvasCode when done
  const codeToRender = (isStreaming && streamingCode) ? streamingCode : canvasCode;

  // Render mermaid
  useEffect(() => {
    if (!codeToRender) return;
    if (!containerRef.current) return;

    let tempDiv: HTMLDivElement | null = null;

    const render = async () => {
      try {
        let code = codeToRender.trim();

        // Handle streaming code: slice out incomplete trailing line to minimize syntax errors
        if (isStreaming) {
          const lines = code.split('\n');
          // If the last line is likely incomplete (doesn't end with newline in stream), discard it for parsing
          if (!codeToRender.endsWith('\n') && lines.length > 1) {
            code = lines.slice(0, -1).join('\n').trim();
          }
          // 自动补全残缺的闭合块（如 opt/alt/loop 缺少 end），防止流式解析语法错
          code = balanceSequenceEndBlocks(code);
        }

        if (code.startsWith('```')) {
          code = code.replace(/^```\w*\n?/, '');
          if (code.endsWith('```')) {
            code = code.slice(0, -3).trim();
          } else {
            code = code.trim();
          }
        }
        
        if (code.startsWith('[') || code.startsWith('{')) return;
        
        // Skip rendering if there are too few lines to form a valid diagram
        if (code.split('\n').length < 2) return;

        // 创建临时 DOM 节点限制 Mermaid 的渲染行为，防止其在全局 body 产生残留炸弹报错
        tempDiv = document.createElement('div');
        tempDiv.id = `mermaid-temp-holder-${Date.now()}`;
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, code, tempDiv);
        
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null); // Clear errors on success
          
          // Only reset pan & zoom if this is the first rendering pass or final render
          if (!hasRendered || !isStreaming) {
            setHasRendered(true);
            setScale(1);
            setTranslate({ x: 0, y: 0 });
          }
          
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = 'none';
            svgEl.style.height = 'auto';
          }
        }
      } catch (e: any) {
        console.warn('[MermaidCanvas] Intermediate parse/render error (ignored during streaming):', e);
        // Only trigger UI error state if NOT streaming to ensure fluid visual transitions
        if (!isStreaming) {
          setError(e.message || 'Mermaid render failed');
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
  }, [isStreaming, codeToRender, theme, hasRendered]);

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
    <div className={`w-full h-full relative overflow-hidden flex animate-fade-in transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'}`}>
      {/* Left: Code Editor Panel (toggleable) */}
      {showEditor && (
        <div
          style={{
            width: '380px',
            minWidth: '300px',
            display: 'flex',
            flexDirection: 'column',
            borderRight: canvasMode === 'light' ? '1px solid #e2e8f0' : '1px solid #1e293b',
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
            }}
          >
            <span style={{ color: canvasMode === 'light' ? '#1e293b' : '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>
              📝 Mermaid 代码编辑器
            </span>
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
              <p className="font-semibold mb-1 text-slate-200">渲染失败</p>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{error}</pre>
              {canvasCode && (
                <details className="mt-2">
                  <summary className="text-xs text-red-400/80 cursor-pointer hover:text-red-400">查看原始代码</summary>
                  <pre className="text-xs whitespace-pre-wrap mt-1 text-red-300/80 max-h-40 overflow-auto bg-red-950/30 p-2 rounded">{canvasCode}</pre>
                </details>
              )}
              <button
                onClick={() => setShowEditor(true)}
                style={{
                  marginTop: '10px',
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
                打开编辑器修复
              </button>
            </div>
          </div>
        ) : isStreaming && !hasRendered ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">正在渲染 Mermaid 图表...</span>
            </div>
          </div>
        ) : !canvasCode && !streamingCode ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-xs text-slate-500">等待 AI 输入代码以绘制图表...</p>
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

            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.15)' }} />

            {/* Canvas background toggle: Dark / Light */}
            <button
              onClick={() => setCanvasMode(canvasMode === 'dark' ? 'light' : 'dark')}
              title={canvasMode === 'dark' ? '切换为明亮画布背景' : '切换为黑暗画布背景'}
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
