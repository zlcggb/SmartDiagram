/**
 * CanvasPanel — Hero workspace (LEFT panel).
 * Routes to the correct canvas component based on canvasEngine.
 * ALL styles are pure Tailwind v4 utility classes.
 */

import { Suspense, lazy, useRef, useEffect, useState } from 'react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ReactFlowProvider } from 'reactflow';
import ExportButton from '@/features/diagram/ui/ExportButton';
import SaveButton from '@/features/diagram/ui/SaveButton';
import {
  VISIBLE_DIAGRAM_AGENTS,
  getTaskDisplayName,
  getAgentEngineName,
  getAgentMeta,
} from '@/shared/lib/config/diagramAgents';
import { useT } from '@/app/i18n';
import { SmartDiagramIconMark } from '@/components/brand/AppIconMarks';
import type { DiagramEngineType, DiagramTaskType } from '@/types/diagram';

const ExcalidrawCanvas = lazy(() => import('@/features/diagram/ui/ExcalidrawCanvas'));
const MermaidCanvas = lazy(() => import('@/features/diagram/ui/MermaidCanvas'));
const FlowCanvas = lazy(() => import('@/features/diagram/ui/FlowCanvas'));
const MindmapCanvas = lazy(() => import('@/features/diagram/ui/MindmapCanvas'));
const ChartsCanvas = lazy(() => import('@/features/diagram/ui/ChartsCanvas'));
const DrawioCanvas = lazy(() => import('@/features/diagram/ui/DrawioCanvas'));
const InfographicCanvas = lazy(() => import('@/features/diagram/ui/InfographicCanvas'));
const ArtifactCanvas = lazy(() => import('@/features/diagram/ui/ArtifactCanvas'));

/* ── Live Timer for Canvas ── */
function CanvasLiveTimer() {
  const { streamStartTime } = useChatStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streamStartTime) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [streamStartTime]);
  if (!streamStartTime) return null;
  const elapsed = Math.max(0, now - streamStartTime);
  const secs = (elapsed / 1000).toFixed(1);
  return <span className="text-[10px] text-indigo-400 tabular-nums font-mono ml-1">{secs}s</span>;
}

function CanvasLoader() {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  return (
    <div className={`w-full h-full flex items-center justify-center transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'}`}>
      <div className="flex flex-col items-center gap-3 sd-fade-in">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
        <span className={`text-xs ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-500'}`}>{t('canvas.loadingEngine')}</span>
      </div>
    </div>
  );
}

function EmptyCanvas() {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  return (
    <div className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-300 ${
      canvasMode === 'light'
        ? 'bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200'
        : 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
    }`}>
      {/* Glow effects in background */}
      <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full filter blur-3xl pointer-events-none ${canvasMode === 'light' ? 'bg-blue-400/10' : 'bg-blue-500/5'}`} />
      <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full filter blur-3xl pointer-events-none ${canvasMode === 'light' ? 'bg-indigo-400/10' : 'bg-indigo-500/5'}`} />

      {/* Dot grid */}
      <div className={`absolute inset-0 pointer-events-none ${canvasMode === 'light' ? 'opacity-30' : 'opacity-20'}`}
        style={{
          backgroundImage: canvasMode === 'light'
            ? 'radial-gradient(circle, #6366f1 0.8px, transparent 0.8px)'
            : 'radial-gradient(circle, #3b82f6 0.8px, transparent 0.8px)',
          backgroundSize: '24px 24px',
        }} />

      <div className="relative z-10 flex flex-col items-center sd-fade-in text-center">
        <SmartDiagramIconMark className="w-20 h-20 mb-7 drop-shadow-xl" />
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mb-3 sd-mobile-empty-title">
          SmartDiagram
        </h1>
        <p className={`text-sm max-w-sm text-center leading-relaxed mb-10 font-normal px-4 sd-mobile-empty-desc ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>
          {t('canvas.emptyDescription')}
        </p>
        <div className="flex items-center gap-2.5 flex-wrap justify-center max-w-lg px-4">
          {VISIBLE_DIAGRAM_AGENTS.map((agent, i) => (
            <div key={agent.id}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-md text-xs sd-slide-up backdrop-blur-sm ${
                canvasMode === 'light'
                  ? 'bg-white border border-slate-200 text-slate-700'
                  : 'bg-slate-900/60 border border-slate-800/80 text-slate-200'
              }`}
              style={{ animationDelay: `${300 + i * 60}ms` }}>
              <span className={`w-2 h-2 rounded-full ${agent.dotClass}`} />
              <span className={`font-semibold ${canvasMode === 'light' ? 'text-slate-700' : 'text-slate-200'}`}>{agent.label}</span>
              <span className="text-slate-400">·</span>
              <span className={canvasMode === 'light' ? 'text-slate-500' : 'text-slate-400'}>{agent.engineLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CanvasPanelInner() {
  const { canvasTask, canvasEngine, canvasCode, isStreaming, canvasPhase, designConcept, streamingCode, pendingElements, canvasMode } = useChatStore();
  const { t } = useT();
  const isMobile = useIsMobile();
  const [conceptOpen, setConceptOpen] = useState(!isMobile);

  // Preload drawio iframe in background — users get instant switch later
  const [drawioMounted, setDrawioMounted] = useState(false);
  const shouldMountDrawio = drawioMounted || canvasEngine === 'drawio';
  useEffect(() => {
    if (shouldMountDrawio) return;
    // Background preload: mount hidden iframe 3s after page settles
    const timer = setTimeout(() => setDrawioMounted(true), 3000);
    return () => clearTimeout(timer);
  }, [shouldMountDrawio]);

  // Compute early — needed by both empty state and main view
  const hasStreamingContent = !!streamingCode || (canvasEngine === 'excalidraw' && pendingElements.length > 0);
  const isGenerating = canvasEngine && canvasPhase !== 'done' && !canvasCode && !hasStreamingContent;

  // Shared preloaded drawio element
  const drawioPreload = shouldMountDrawio ? (
    <div
      className="absolute inset-0"
      style={{ display: canvasEngine === 'drawio' && !isGenerating ? 'block' : 'none', zIndex: 10 }}
    >
      <Suspense fallback={<CanvasLoader />}><DrawioCanvas /></Suspense>
    </div>
  ) : null;

  // No engine selected → welcome screen (but keep drawio preloading in background)
  if (!canvasEngine && !canvasCode) {
    return (
      <div className="w-full h-full relative">
        <EmptyCanvas />
        {drawioPreload}
      </div>
    );
  }

  const agentMeta = getAgentMeta(canvasEngine);
  const agentDot = agentMeta?.dotClass || 'bg-slate-400';

  // Phase-based status text
  const phaseText = (() => {
    switch (canvasPhase) {
      case 'routing': return t('canvas.routing');
      case 'designing': return t('canvas.designing');
      case 'generating': return t('canvas.generating');
      default: return '';
    }
  })();

  const renderCanvas = () => {
    switch (canvasEngine) {
      case 'excalidraw':
        return <Suspense fallback={<CanvasLoader />}><ExcalidrawCanvas /></Suspense>;
      case 'mermaid':
        return <Suspense fallback={<CanvasLoader />}><MermaidCanvas /></Suspense>;
      case 'flow':
        return (
          <Suspense fallback={<CanvasLoader />}>
            <ReactFlowProvider>
              <FlowCanvas />
            </ReactFlowProvider>
          </Suspense>
        );
      case 'mindmap':
        return <Suspense fallback={<CanvasLoader />}><MindmapCanvas /></Suspense>;
      case 'charts':
        return <Suspense fallback={<CanvasLoader />}><ChartsCanvas /></Suspense>;
      case 'drawio':
        return null; // rendered persistently below — see drawioMounted
      case 'infographic':
        return <Suspense fallback={<CanvasLoader />}><InfographicCanvas /></Suspense>;
      case 'html_email':
      case 'web_report_html':
        return <Suspense fallback={<CanvasLoader />}><ArtifactCanvas /></Suspense>;
      default:
        return (
          <div className={`w-full h-full flex items-center justify-center p-10 transition-colors duration-300 ${canvasMode === 'light' ? 'bg-white text-slate-800 border border-slate-200' : 'bg-slate-950 text-slate-300'}`}>
            <div className={`max-w-xl text-sm whitespace-pre-wrap leading-relaxed ${canvasMode === 'light' ? 'text-slate-700' : 'text-slate-400'}`}>
              {canvasCode || t('canvas.noRenderableContent')}
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`w-full h-full flex flex-col overflow-hidden transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'}`}>
      {/* Top toolbar */}
      {canvasEngine && (
        <div className={`flex items-center justify-between px-4 py-2 border-b shrink-0 relative overflow-visible ${
          canvasMode === 'light'
            ? 'border-slate-200 bg-slate-50/80 text-slate-800'
            : 'border-slate-800 bg-slate-900/60 text-slate-200'
        } backdrop-blur-md`} style={{ zIndex: 20 }}>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={`w-2 h-2 rounded-full ${agentDot}`} />
            {getTaskDisplayName(canvasTask)}
            {canvasEngine && (
              <span className={`${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-500'} font-normal`}>· {getAgentEngineName(canvasEngine)}</span>
            )}
            {isStreaming && <Loader2 className="w-3.5 h-3.5 animate-spin ml-1 text-indigo-500" />}
          </div>
          <div className="flex items-center gap-2">
            <SaveButton />
            <ExportButton />
          </div>
        </div>
      )}
      {/* Canvas area */}
      <div className="flex-1 min-h-0 relative" data-canvas>
        {isGenerating ? (
          <GeneratingView
            agentMeta={agentMeta}
            canvasTask={canvasTask}
            canvasEngine={canvasEngine}
            canvasPhase={canvasPhase}
            phaseText={phaseText}
            designConcept={designConcept}
            streamingCode={streamingCode}
          />
        ) : (
          <>
            {renderCanvas()}
            
            {/* Floating AINodeOptimizeOverlay */}
            <AINodeOptimizeOverlay />
            
            {/* Floating Design Concept Overlay Widget */}
            {designConcept && (
              <div className="absolute bottom-4 left-4 z-30 transition-all duration-300 select-none">
                {conceptOpen ? (
              <div className={`w-80 max-w-[calc(100vw-2rem)] rounded-xl border p-3.5 shadow-xl transition-all duration-300 ${
                    canvasMode === 'light'
                      ? 'border-slate-200 bg-white/95 text-slate-800 shadow-slate-200/50'
                      : 'border-slate-800 bg-slate-900/90 text-slate-100'
                  } backdrop-blur-md`}>
                    <div className={`flex items-center justify-between gap-4 mb-2 border-b pb-1.5 ${canvasMode === 'light' ? 'border-slate-100' : 'border-slate-800'}`}>
                      <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
                        <span>💡</span> {t('canvas.designThought')}
                      </p>
                      <div className="flex items-center gap-2">
                        {isStreaming && (
                          <span className="flex items-center gap-1 text-[9px] text-indigo-500 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                            {t('canvas.generatingShort')}
                          </span>
                        )}
                        <button 
                          onClick={() => setConceptOpen(false)}
                          className={`text-[10px] cursor-pointer px-1 py-0.5 rounded transition-colors ${
                            canvasMode === 'light' ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          {t('canvas.collapse')}
                        </button>
                      </div>
                    </div>
                    <div className={`text-xs leading-relaxed max-h-28 overflow-y-auto pr-1 prose prose-xs max-w-none
                      ${canvasMode === 'light'
                        ? 'prose-slate text-slate-600 prose-strong:text-slate-800 prose-code:text-indigo-600 prose-code:bg-slate-100'
                        : 'prose-invert text-slate-300 prose-strong:text-slate-100 prose-code:text-blue-300 prose-code:bg-slate-700/50'
                      }
                      prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0
                      prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-code:font-mono
                      [&>*:first-child]:mt-0 [&>*:last-child]:mb-0`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{designConcept}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => setConceptOpen(true)}
                    className={`w-8 h-8 rounded-full border flex items-center justify-center shadow-lg hover:shadow-xl text-amber-500 cursor-pointer transition-all ${
                      canvasMode === 'light' ? 'border-slate-200 bg-white/95 hover:bg-slate-100 shadow-slate-200/50' : 'border-slate-800 bg-slate-900/90 hover:bg-slate-800'
                    }`}
                    title={t('canvas.showDesignThought')}
                  >
                    💡
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Persistent drawio iframe — preloaded in background */}
        {drawioPreload}
      </div>
    </div>
  );
}

/* ── Precise Node Optimization Overlay ── */
function AINodeOptimizeOverlay() {
  const { selectedNode, setSelectedNode, canvasMode } = useChatStore();
  const { t } = useT();
  const [inputState, setInputState] = useState({ nodeKey: '', value: '' });
  const selectedNodeKey = selectedNode ? `${selectedNode.type}:${selectedNode.id}` : '';
  const inputVal = inputState.nodeKey === selectedNodeKey ? inputState.value : '';

  if (!selectedNode) return null;

  if (selectedNode.type !== 'mindmap' && selectedNode.type !== 'flow') return null;

  const handleSend = () => {
    if (!inputVal.trim()) return;
    const prompt = t('canvas.nodeEditPrompt', {
      agent: selectedNode.type === 'mindmap' ? 'mindmap' : 'flow',
      text: selectedNode.text,
      id: selectedNode.id,
      instruction: inputVal.trim(),
    });
    window.dispatchEvent(new CustomEvent('send-ai-message', { detail: { text: prompt } }));
    setInputState({ nodeKey: selectedNodeKey, value: '' });
    setSelectedNode(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const badgeColor = selectedNode.type === 'mindmap' 
    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400' 
    : 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400';

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4 sd-slide-up">
      <div className={`flex flex-col gap-2.5 p-3 border rounded-2xl shadow-2xl backdrop-blur-xl ${
        canvasMode === 'light' ? 'bg-white/95 border-slate-200 shadow-slate-200/50' : 'bg-slate-900/90 border-slate-800'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden mr-2">
            <span className="flex h-1.5 w-1.5 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"></span>
            </span>
            <span className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>{t('canvas.localEdit')}</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badgeColor} truncate`}>
              {selectedNode.type === 'mindmap' ? t('canvas.mindmap') : t('canvas.flowchart')}: {selectedNode.text}
            </span>
          </div>
          <button
            onClick={() => setSelectedNode(null)}
            className={`cursor-pointer p-0.5 rounded transition-colors shrink-0 ${
              canvasMode === 'light' ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className={`flex items-center gap-2 border rounded-xl px-3 py-1.5 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all ${
          canvasMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800/80'
        }`}>
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputState({ nodeKey: selectedNodeKey, value: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={t('canvas.nodeEditPlaceholder')}
            className={`flex-1 bg-transparent border-none outline-none text-xs py-1 ${
              canvasMode === 'light' ? 'text-slate-800 placeholder-slate-400' : 'text-slate-200 placeholder-slate-500'
            }`}
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={!inputVal.trim()}
            className={`flex items-center justify-center p-1.5 rounded-lg transition-all ${
              inputVal.trim()
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-lg shadow-indigo-500/20'
                : 'text-slate-700 bg-slate-800/40 cursor-not-allowed'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Keep original exported component name same to avoid breaking other imports
export default function CanvasPanel() {
  return <CanvasPanelInner />;
}

/* ── Generating View ── */
function GeneratingView({
  agentMeta, canvasTask, canvasEngine, canvasPhase, phaseText, designConcept, streamingCode,
}: {
  agentMeta: ReturnType<typeof getAgentMeta>;
  canvasTask: DiagramTaskType | null;
  canvasEngine: DiagramEngineType | null;
  canvasPhase: string;
  phaseText: string;
  designConcept: string;
  streamingCode: string;
}) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const codeRef = useRef<HTMLPreElement>(null);

  // Auto-scroll code area to bottom
  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [streamingCode]);

  const showCode = canvasPhase === 'generating' && streamingCode;

  return (
    <div className={`w-full h-full flex flex-col relative overflow-hidden transition-colors duration-300 ${
      canvasMode === 'light'
        ? 'bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200'
        : 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
    }`}>
      {/* Dot grid */}
      <div className={`absolute inset-0 pointer-events-none ${canvasMode === 'light' ? 'opacity-30' : 'opacity-10'}`}
        style={{
          backgroundImage: canvasMode === 'light'
            ? 'radial-gradient(circle, #6366f1 0.8px, transparent 0.8px)'
            : 'radial-gradient(circle, #3b82f6 0.8px, transparent 0.8px)',
          backgroundSize: '24px 24px',
        }} />

      {/* Header bar */}
      <div className={`relative z-10 flex items-center gap-3 px-6 py-4 shrink-0 border-b ${
        canvasMode === 'light'
          ? 'border-slate-200 bg-white/60'
          : 'border-slate-800/40 bg-slate-900/25'
      } backdrop-blur-sm`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shadow-md ${
          canvasMode === 'light' ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}>
          {agentMeta?.Icon ? (
            <agentMeta.Icon className="w-4 h-4" style={{ color: agentMeta.color }} />
          ) : (
            <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
          )}
        </div>
        <div>
          <p className={`text-sm font-semibold ${canvasMode === 'light' ? 'text-slate-800' : 'text-slate-200'}`}>
            {getTaskDisplayName(canvasTask)} · {getAgentEngineName(canvasEngine)}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
            <span className={`text-[11px] ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>{phaseText}</span>
            <CanvasLiveTimer />
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden">
        {/* Design concept — full text */}
        {designConcept && (
          <div className={`rounded-xl border shadow-lg overflow-auto shrink-0 sd-slide-up backdrop-blur-sm ${
            canvasMode === 'light' ? 'bg-white/85 border-slate-200 text-slate-800' : 'bg-slate-900/60 border-slate-850 text-slate-300'
          }`}
            style={{ maxHeight: showCode ? '35%' : '70%' }}>
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold text-amber-500 mb-2 flex items-center gap-1">
                <span>💡</span> {t('canvas.designThought')}
              </p>
              <div className={`text-xs leading-relaxed prose prose-xs max-w-none
                ${canvasMode === 'light'
                  ? 'prose-slate text-slate-600 prose-strong:text-slate-800 prose-code:text-indigo-600 prose-code:bg-slate-100'
                  : 'prose-invert text-slate-300 prose-strong:text-slate-100 prose-code:text-blue-300 prose-code:bg-slate-700/50'
                }
                prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0
                prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-code:font-mono
                [&>*:first-child]:mt-0 [&>*:last-child]:mb-0`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{designConcept}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Streaming code viewer */}
        {showCode && (
          <div className={`flex-1 min-h-0 rounded-xl overflow-hidden border shadow-xl sd-slide-up flex flex-col ${
            canvasMode === 'light' ? 'border-slate-200 bg-white/80' : 'border-slate-800 bg-slate-900/40'
          } backdrop-blur-xs`}>
            {/* Code header */}
            <div className={`flex items-center gap-2 px-4 py-2.5 border-b shrink-0 ${
              canvasMode === 'light' ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-950/60'
            }`}>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
              </div>
              <span className="text-[10px] text-slate-400 font-mono ml-2">{t('canvas.codeStream')}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                <span className="text-[10px] text-indigo-500 font-medium">{t('canvas.writingDsl')}</span>
              </div>
            </div>
            {/* Code content */}
            <pre ref={codeRef}
              className={`flex-1 min-h-0 overflow-auto px-5 py-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all ${
                canvasMode === 'light' ? 'bg-slate-50/80 text-slate-800' : 'bg-slate-950/80 text-slate-300'
              }`}
              style={{ scrollBehavior: 'smooth' }}>
              {streamingCode}
              <span className="inline-block w-2 h-4 bg-indigo-500/80 animate-pulse ml-0.5" style={{ verticalAlign: 'text-bottom' }} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
