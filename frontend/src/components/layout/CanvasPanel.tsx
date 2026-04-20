/**
 * CanvasPanel — Hero workspace (LEFT panel).
 * Routes to the correct canvas component based on canvasEngine.
 * ALL styles are pure Tailwind v4 utility classes.
 */

import { Suspense, lazy, useRef, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';
import { PenTool, Loader2 } from 'lucide-react';
import { ReactFlowProvider } from 'reactflow';
import ExportButton from '../canvas/ExportButton';
import {
  DIAGRAM_AGENTS,
  getTaskDisplayName,
  getAgentEngineName,
  getAgentMeta,
} from '../../config/diagramAgents';

const ExcalidrawCanvas = lazy(() => import('../canvas/ExcalidrawCanvas'));
const MermaidCanvas = lazy(() => import('../canvas/MermaidCanvas'));
const FlowCanvas = lazy(() => import('../canvas/FlowCanvas'));
const MindmapCanvas = lazy(() => import('../canvas/MindmapCanvas'));
const ChartsCanvas = lazy(() => import('../canvas/ChartsCanvas'));
const DrawioCanvas = lazy(() => import('../canvas/DrawioCanvas'));
const InfographicCanvas = lazy(() => import('../canvas/InfographicCanvas'));

function CanvasLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3 sd-fade-in">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        <span className="text-xs text-slate-400">加载渲染引擎...</span>
      </div>
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fafbfc 0%, #f0f4ff 40%, #f5f3ff 70%, #fafbfc 100%)' }}>
      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, #cbd5e1 0.5px, transparent 0.5px)',
          backgroundSize: '24px 24px',
        }} />

      <div className="relative z-10 flex flex-col items-center sd-fade-in">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-7 bg-gradient-to-br from-blue-100 to-indigo-100 border border-blue-200/50 shadow-xl shadow-blue-100/20">
          <PenTool className="w-9 h-9 text-blue-500/70" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 mb-2">SmartDiagram</h1>
        <p className="text-sm text-slate-400 max-w-xs text-center leading-relaxed mb-10">
          在右侧描述任务目标，AI 会先理解你要表达什么，再选择合适的图形引擎
        </p>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {DIAGRAM_AGENTS.map((agent, i) => (
            <div key={agent.id}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/80 border border-slate-200/80 shadow-sm text-xs sd-slide-up"
              style={{ animationDelay: `${300 + i * 60}ms` }}>
              <span className={`w-2 h-2 rounded-full ${agent.dotClass}`} />
              <span className="font-medium text-slate-700">{agent.label}</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-400">{agent.engineLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CanvasPanel() {
  const { canvasTask, canvasEngine, canvasCode, isStreaming, canvasPhase, designConcept, streamingCode } = useChatStore();

  // No engine selected → welcome screen
  if (!canvasEngine && !canvasCode) {
    return <EmptyCanvas />;
  }

  const agentMeta = getAgentMeta(canvasEngine);
  const agentDot = agentMeta?.dotClass || 'bg-slate-400';

  // Phase-based status text
  const phaseText = (() => {
    switch (canvasPhase) {
      case 'routing': return '正在识别最佳引擎...';
      case 'designing': return '正在构思设计方案...';
      case 'generating': return '正在生成图表代码...';
      default: return '';
    }
  })();

  // Engine is selected but code not ready → show generating state
  const isGenerating = canvasEngine && canvasPhase !== 'done' && !canvasCode;

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
        return <Suspense fallback={<CanvasLoader />}><DrawioCanvas /></Suspense>;
      case 'infographic':
        return <Suspense fallback={<CanvasLoader />}><InfographicCanvas /></Suspense>;
      default:
        return (
          <div className="w-full h-full flex items-center justify-center p-10 bg-white">
            <div className="max-w-xl text-slate-600 text-sm whitespace-pre-wrap leading-relaxed">
              {canvasCode || '暂无可渲染内容'}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-white">
      {/* Top toolbar */}
      {canvasEngine && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200/60 bg-slate-50/80 backdrop-blur-sm shrink-0 relative overflow-visible" style={{ zIndex: 20 }}>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <span className={`w-2 h-2 rounded-full ${agentDot}`} />
            {getTaskDisplayName(canvasTask)}
            {canvasEngine && (
              <span className="text-slate-400 font-normal">· {getAgentEngineName(canvasEngine)}</span>
            )}
            {isStreaming && <Loader2 className="w-3 h-3 animate-spin ml-1 text-blue-500" />}
          </div>
          <ExportButton />
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
          renderCanvas()
        )}
      </div>
    </div>
  );
}

/* ── Generating View ── */
function GeneratingView({
  agentMeta, canvasTask, canvasEngine, canvasPhase, phaseText, designConcept, streamingCode,
}: {
  agentMeta: ReturnType<typeof getAgentMeta>;
  canvasTask: any;
  canvasEngine: any;
  canvasPhase: string;
  phaseText: string;
  designConcept: string;
  streamingCode: string;
}) {
  const codeRef = useRef<HTMLPreElement>(null);

  // Auto-scroll code area to bottom
  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [streamingCode]);

  const showCode = canvasPhase === 'generating' && streamingCode;

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fafbfc 0%, #f0f4ff 40%, #f5f3ff 70%, #fafbfc 100%)' }}>
      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'radial-gradient(circle, #cbd5e1 0.5px, transparent 0.5px)',
          backgroundSize: '24px 24px',
        }} />

      {/* Header bar */}
      <div className="relative z-10 flex items-center gap-3 px-6 py-4 shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 border border-blue-200/50 shadow-sm">
          {agentMeta?.Icon ? (
            <agentMeta.Icon className="w-4 h-4" style={{ color: agentMeta.color }} />
          ) : (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">
            {getTaskDisplayName(canvasTask)} · {getAgentEngineName(canvasEngine)}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
            <span className="text-[11px] text-slate-400">{phaseText}</span>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col px-6 pb-6 gap-4 overflow-hidden">
        {/* Design concept — full text */}
        {designConcept && (
          <div className="rounded-xl bg-white/80 border border-slate-200/80 shadow-sm overflow-auto shrink-0 sd-slide-up"
            style={{ maxHeight: showCode ? '30%' : '60%' }}>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-blue-500 mb-1.5 flex items-center gap-1">
                <span>💡</span> 设计思路
              </p>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{designConcept}</p>
            </div>
          </div>
        )}

        {/* Streaming code viewer */}
        {showCode ? (
          <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-200/80 shadow-sm sd-slide-up flex flex-col"
            style={{ background: '#1e293b' }}>
            {/* Code header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50 shrink-0">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
              </div>
              <span className="text-[10px] text-slate-500 font-mono ml-2">code output</span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-400/70">writing</span>
              </div>
            </div>
            {/* Code content */}
            <pre ref={codeRef}
              className="flex-1 min-h-0 overflow-auto px-4 py-3 text-[11px] leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-all"
              style={{ scrollBehavior: 'smooth' }}>
              {streamingCode}
              <span className="inline-block w-2 h-4 bg-blue-400/80 animate-pulse ml-0.5" style={{ verticalAlign: 'text-bottom' }} />
            </pre>
          </div>
        ) : !designConcept && (
          /* Skeleton fallback when no content yet */
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="flex items-center gap-4 opacity-40 mb-3">
              {[80, 120, 100].map((w, i) => (
                <div key={i}
                  className="rounded-lg bg-gradient-to-r from-slate-200 to-slate-100"
                  style={{
                    width: w,
                    height: 48,
                    animation: `pulse 1.5s ease-in-out ${i * 0.3}s infinite`,
                  }} />
              ))}
            </div>
            <div className="flex items-center gap-3 opacity-30">
              {[60, 80].map((w, i) => (
                <div key={i}
                  className="rounded-lg bg-gradient-to-r from-slate-200 to-slate-100"
                  style={{
                    width: w,
                    height: 36,
                    animation: `pulse 1.5s ease-in-out ${(i + 3) * 0.3}s infinite`,
                  }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
