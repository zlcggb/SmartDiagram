/**
 * ChatPanel — AI command sidebar (RIGHT panel).
 *
 * Features:
 *   - ChatGPT-style input bar with agent selector in bottom toolbar
 *   - react-markdown rendering for assistant messages
 *   - Copy message button
 *   - Settings modal integration
 *   - IME-compatible keyboard handling
 *   - SSE streaming with tag parser
 *
 * ALL styles are pure Tailwind v4 utility classes.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Loader2, Trash2, Settings,
  ChevronDown, ChevronUp,
  Sparkles, Copy, Check,
  Plus, X, ImageIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore } from '../../store/chatStore';
import SettingsModal from '../settings/SettingsModal';
import {
  DIAGRAM_AGENTS,
  getAgentDisplayName,
  getTaskByEngine,
  getTaskDisplayName,
  type DiagramAgentMeta,
} from '../../config/diagramAgents';
import type { DiagramEngineType, DiagramTaskType } from '../../types/diagram';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

/* ── Design Concept Collapsible ── */
function DesignConceptCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const isLong = text.length > 100;
  return (
    <div className="mt-2 rounded-lg border border-amber-500/10 bg-amber-500/5 overflow-hidden">
      <button onClick={() => isLong && setOpen(!open)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left">
        <span className="text-[10px] mt-0.5">💡</span>
        <span className={`text-[11px] leading-relaxed flex-1 text-amber-300/70 ${!open && isLong ? 'line-clamp-2' : ''}`}>
          {text}
        </span>
        {isLong && (open
          ? <ChevronUp className="w-3 h-3 mt-1 shrink-0 text-amber-400/40" />
          : <ChevronDown className="w-3 h-3 mt-1 shrink-0 text-amber-400/40" />
        )}
      </button>
    </div>
  );
}

/* ── Copy Button ── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={handleCopy}
      className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors opacity-0 group-hover:opacity-100"
      title="复制">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/* ── Markdown renderer for assistant messages ── */
function AssistantContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none text-slate-200
                    prose-p:my-1 prose-p:leading-relaxed prose-p:text-[13px]
                    prose-headings:text-slate-100 prose-headings:font-semibold
                    prose-code:text-blue-300 prose-code:bg-slate-700/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
                    prose-pre:bg-slate-800 prose-pre:border prose-pre:border-slate-700/50 prose-pre:rounded-lg
                    prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                    prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-li:text-[13px]
                    prose-strong:text-slate-100
                    prose-table:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}




/* ── Main ChatPanel ── */
export default function ChatPanel() {
  const {
    messages, addMessage, updateLastAssistantMessage, clearMessages,
    isStreaming, setIsStreaming,
    setCurrentTask, setCurrentEngine, setCanvasCode, setCanvasTask, setCanvasEngine,
    canvasCode, canvasTask, canvasEngine,
    setDesignConcept, modelConfig,
    addPendingElement, clearPendingElements,
    inputImages, addInputImage, removeInputImage, clearInputImages,
    setCanvasPhase,
    setStreamingCode,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<DiagramAgentMeta | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── File / Image handlers ── */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return; // only images for now
      const reader = new FileReader();
      reader.onloadend = () => {
        addInputImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => addInputImage(reader.result as string);
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + 'px';
    }
  }, [input]);

  // Detect @agent in input and auto-select agent
  useEffect(() => {
    const match = input.match(/^@(\w+)/);
    if (match) {
      const found = DIAGRAM_AGENTS.find(a => a.id === match[1].toLowerCase());
      if (found && found !== selectedAgent) {
        setSelectedAgent(found);
      }
    }
  }, [input]);

  /* ── Send message ── */
  const sendMessage = useCallback(async () => {
    let text = input.trim();
    const imagesToSend = [...inputImages];
    if ((!text && imagesToSend.length === 0) || isStreaming) return;

    // If agent is selected but no @ prefix in text, prepend it
    if (selectedAgent && !text.startsWith('@')) {
      text = `${selectedAgent.prefix}${text}`;
    }

    addMessage({ id: `u_${Date.now()}`, role: 'user', content: text, images: imagesToSend.length > 0 ? imagesToSend : undefined, timestamp: Date.now() });
    setInput('');
    clearInputImages();
    setSelectedAgent(null);
    addMessage({ id: `a_${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() });
    setIsStreaming(true);
    setDesignConcept('');
    clearPendingElements();
    setCanvasPhase('routing');
    setStreamingCode('');

    let codeBuffer = '', designBuffer = '';
    let elementCount = 0;
    // Throttled streaming code: accumulate locally, flush to state every 200ms
    let localCodeBuffer = '';
    let codeFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushCode = () => {
      if (localCodeBuffer) {
        setStreamingCode(localCodeBuffer);
      }
    };

    try {
      const history = messages
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          images: imagesToSend,
          history,
          current_code: canvasCode || '',
          current_task: canvasTask || '',
          current_engine: canvasEngine || '',
          model_config: modelConfig,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No reader');

      let sseBuffer = '';

      const processSSELine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        try {
          const data = JSON.parse(line.slice(6));
          switch (data.type) {
            case 'route': {
              const taskType = (data.task || getTaskByEngine(data.engine as DiagramEngineType)) as DiagramTaskType | null;
              const engineType = data.engine as DiagramEngineType;
              if (taskType) setCurrentTask(taskType);
              if (engineType) setCurrentEngine(engineType);
              updateLastAssistantMessage({
                taskType: taskType || undefined,
                engineType: engineType || undefined,
              });
              break;
            }
            case 'agent': {
              const taskType = (data.task as DiagramTaskType) || getTaskByEngine(data.name as DiagramEngineType) || undefined;
              const engineType = data.name as DiagramEngineType;
              if (taskType) {
                setCurrentTask(taskType);
                setCanvasTask(taskType);
              }
              setCurrentEngine(engineType);
              setCanvasEngine(engineType);
              setCanvasPhase('designing');
              updateLastAssistantMessage({
                engineType: engineType,
                taskType: taskType,
              });
              break;
            }
            case 'design_start':
              updateLastAssistantMessage({ content: '✨ 正在分析需求...' });
              break;
            case 'design':
              designBuffer += data.content;
              setDesignConcept(designBuffer);
              updateLastAssistantMessage({ designConcept: designBuffer, content: '✨ 设计思路生成中...' });
              break;
            case 'design_end':
              break;
            case 'code_start':
              clearPendingElements();
              elementCount = 0;
              codeBuffer = '';
              setCanvasPhase('generating');
              updateLastAssistantMessage({ content: '🔨 正在生成图表...' });
              break;
            case 'element':
              elementCount++;
              addPendingElement(data.content);
              updateLastAssistantMessage({ content: `🎨 正在绘制图表 (${elementCount} 个元素)...` });
              break;
            case 'code':
              localCodeBuffer += (data.content || '');
              if (!codeFlushTimer) {
                codeFlushTimer = setTimeout(() => {
                  flushCode();
                  codeFlushTimer = null;
                }, 200);
              }
              break;
            case 'code_complete':
              codeBuffer = data.content;
              break;
            case 'code_end': {
              if (codeFlushTimer) { clearTimeout(codeFlushTimer); codeFlushTimer = null; }
              const pending = useChatStore.getState().pendingElements;
              const finalCode = codeBuffer || (pending.length > 0 ? JSON.stringify(pending) : '');
              if (finalCode) {
                setCanvasCode(finalCode);
                const state = useChatStore.getState();
                if (state.currentTask) setCanvasTask(state.currentTask);
                if (state.currentEngine) setCanvasEngine(state.currentEngine);
              }
              setCanvasPhase('done');
              setStreamingCode('');
              updateLastAssistantMessage({ code: finalCode || '[]', content: '✅ 图表已生成完毕' });
              break;
            }
            case 'error':
              updateLastAssistantMessage({ content: `❌ ${data.message}` });
              break;
          }
        } catch (parseErr) {
          console.warn('[SSE] Failed to parse line:', line.slice(0, 100), parseErr);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        sseBuffer += chunk;

        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) processSSELine(trimmed);
        }
      }

      if (sseBuffer.trim()) {
        processSSELine(sseBuffer.trim());
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      updateLastAssistantMessage({ content: `❌ 连接失败: ${errMsg}` });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, modelConfig, messages, canvasCode, canvasTask, canvasEngine, selectedAgent, addPendingElement, clearPendingElements, inputImages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const agentDotClass = (name: string) =>
    DIAGRAM_AGENTS.find(a => a.id === name)?.dotClass || 'bg-slate-400';

  const agentPillClass = (name: string) => {
    switch (name) {
      case 'excalidraw': return 'bg-purple-500/10 text-purple-400';
      case 'mermaid': return 'bg-emerald-500/10 text-emerald-400';
      case 'flow': return 'bg-blue-500/10 text-blue-400';
      case 'mindmap': return 'bg-amber-500/10 text-amber-400';
      case 'charts': return 'bg-pink-500/10 text-pink-400';
      case 'drawio': return 'bg-cyan-500/10 text-cyan-400';
      case 'infographic': return 'bg-rose-500/10 text-rose-400';
      default: return 'bg-slate-500/10 text-slate-400';
    }
  };

  return (
    <div className="h-full flex flex-col bg-dark-900">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-[13px] font-semibold tracking-tight text-slate-100">SmartDiagram</h1>
            <p className="text-[10px] text-slate-500">AI Visualization</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={clearMessages}
            className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Messages Area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center sd-fade-in">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 bg-slate-800 border border-slate-700/50">
              <Sparkles className="w-7 h-7 text-blue-400/60" />
            </div>
            <p className="text-sm font-medium text-slate-400 mb-1">描述你想要的图表</p>
            <p className="text-xs text-slate-600 mb-6">
              点击 <code className="px-1.5 py-0.5 rounded bg-slate-800 text-blue-400 text-[10px] font-mono">+</code> 上传图片，按任务选择图类型，或直接用 <code className="px-1.5 py-0.5 rounded bg-slate-800 text-blue-400 text-[10px] font-mono">@</code> 指定底层引擎
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[280px]">
              {[
                { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'charts')!, text: '做一个 2024 年营收与利润双轴图' },
                { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'flow')!, text: '画一个 AI Agent 审批工作流' },
                { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'mermaid')!, text: '生成用户登录时序图' },
              ].map((ex, i) => (
                <button key={i}
                  onClick={() => {
                    setSelectedAgent(ex.agent);
                    setInput(ex.text);
                    textareaRef.current?.focus();
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all duration-200 bg-slate-800/80 border border-slate-700/50 hover:border-blue-500/30 hover:bg-slate-800 sd-slide-up"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                    style={{ background: `${ex.agent.color}15`, color: ex.agent.color }}>
                    <ex.agent.Icon style={{ width: 10, height: 10 }} />
                    {ex.agent.label}
                  </span>
                  <span className="text-xs text-slate-400">{ex.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} sd-slide-up`}>
              <div className={`group relative max-w-[90%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${msg.role === 'user'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-slate-800 border border-slate-700/50 text-slate-200'
                }`}>
                {/* Agent pill */}
                {msg.role === 'assistant' && (msg.taskType || msg.engineType) && (
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold mb-2 ${agentPillClass(msg.engineType || '')}`}>
                    <span className={`w-[5px] h-[5px] rounded-full ${agentDotClass(msg.engineType || '')}`} />
                    {getTaskDisplayName(msg.taskType || getTaskByEngine(msg.engineType) || undefined)}
                    {msg.engineType && (
                      <span className="opacity-70 font-normal">· {getAgentDisplayName(msg.engineType)}</span>
                    )}
                  </div>
                )}

                {/* User images */}
                {msg.role === 'user' && msg.images && msg.images.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt={`attachment-${idx}`}
                        style={{
                          width: 80, height: 80,
                          objectFit: 'cover',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.2)',
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Design concept */}
                {msg.role === 'assistant' && msg.designConcept && (
                  <DesignConceptCard text={msg.designConcept} />
                )}

                {/* Content */}
                {msg.role === 'assistant' && msg.code ? (
                  <button
                    className="text-xs mt-1.5 flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                    onClick={() => {
                      clearPendingElements();
                      setCanvasCode(msg.code!);
                      if (msg.taskType) setCanvasTask(msg.taskType);
                      if (msg.engineType) setCanvasEngine(msg.engineType);
                    }}
                    title="点击在画布中查看此图表"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    图表已生成到画布
                  </button>
                ) : msg.role === 'assistant' && !msg.content && isStreaming ? (
                  <div className="flex items-center gap-2 py-0.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span className="text-xs text-slate-500">思考中</span>
                    <span className="flex gap-[3px]">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1 h-1 rounded-full bg-blue-400"
                          style={{ animation: `sd-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </span>
                  </div>
                ) : msg.role === 'assistant' && msg.content && isStreaming && msg.id === messages[messages.length - 1]?.id ? (
                  <div className="flex items-center gap-2 py-0.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span className="text-xs text-slate-400">{msg.content}</span>
                  </div>
                ) : msg.role === 'assistant' && msg.content ? (
                  <AssistantContent content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}

                {/* Copy button */}
                {msg.content && msg.role === 'assistant' && !msg.code && (
                  <div className="absolute top-2 right-2">
                    <CopyButton text={msg.content} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* ── ChatGPT-Style Input Area ── */}
      <div className="px-3 pb-3 pt-1">
        <div style={{
          background: '#1e293b',
          border: '1px solid rgba(148,163,184,0.2)',
          borderRadius: '16px',
          overflow: 'visible',
          transition: 'border-color 0.2s',
        }}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          {/* Image preview strip */}
          {inputImages.length > 0 && (
            <div style={{ padding: '8px 14px 0', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {inputImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative', width: 56, height: 56 }}>
                  <img
                    src={img}
                    alt={`upload-${idx}`}
                    style={{
                      width: 56, height: 56,
                      objectFit: 'cover',
                      borderRadius: '10px',
                      border: '1px solid rgba(148,163,184,0.3)',
                    }}
                  />
                  <button
                    onClick={() => removeInputImage(idx)}
                    style={{
                      position: 'absolute', top: -6, right: -6,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#1e293b', border: '1px solid #475569',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: '#f87171',
                      fontSize: '11px', lineHeight: 1,
                    }}
                    title="移除图片"
                  >
                    <X style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <div style={{ padding: '12px 14px 4px' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={inputImages.length > 0 ? '描述图片内容和目标图类型，AI 会自动选择合适引擎...' : '描述你想表达的内容，例如流程图、架构图、数据图表、时序图...'}
              rows={1}
              disabled={isStreaming}
              style={{
                width: '100%',
                background: 'transparent',
                fontSize: '13px',
                color: '#e2e8f0',
                outline: 'none',
                resize: 'none',
                maxHeight: '140px',
                border: 'none',
                lineHeight: '1.5',
              }}
            />
          </div>

          {/* Bottom toolbar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 8px 8px',
          }}>
            {/* Left side: + button, Agent chip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
              {/* + Button for image upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '30px', height: '30px',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: inputImages.length > 0 ? 'rgba(59,130,246,0.1)' : 'transparent',
                  border: inputImages.length > 0 ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(148,163,184,0.3)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  color: inputImages.length > 0 ? '#60a5fa' : '#94a3b8',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#334155'; e.currentTarget.style.color = '#e2e8f0'; }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = inputImages.length > 0 ? 'rgba(59,130,246,0.1)' : 'transparent';
                  e.currentTarget.style.color = inputImages.length > 0 ? '#60a5fa' : '#94a3b8';
                }}
                title="上传图片（支持粘贴）"
              >
                {inputImages.length > 0
                  ? <ImageIcon style={{ width: 14, height: 14 }} />
                  : <Plus style={{ width: 14, height: 14 }} />
                }
              </button>

              {/* Agent dropdown chip */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowAgentPicker(!showAgentPicker)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: selectedAgent ? '4px 8px 4px 8px' : '4px 10px',
                    borderRadius: '8px',
                    background: selectedAgent ? `${selectedAgent.color}12` : 'transparent',
                    border: selectedAgent ? `1px solid ${selectedAgent.color}30` : '1px solid rgba(148,163,184,0.2)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: selectedAgent ? selectedAgent.color : '#94a3b8',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => { if (!selectedAgent) e.currentTarget.style.background = '#334155'; }}
                  onMouseLeave={(e) => { if (!selectedAgent) e.currentTarget.style.background = 'transparent'; }}
                >
                  {selectedAgent ? (
                    <>
                      <selectedAgent.Icon style={{ width: 12, height: 12 }} />
                      {selectedAgent.label}
                    </>
                  ) : (
                    <>
                      <Sparkles style={{ width: 12, height: 12 }} />
                      任务自动识别
                    </>
                  )}
                  <ChevronDown style={{ width: 12, height: 12, opacity: 0.6 }} />
                </button>

                {/* Agent dropdown list */}
                {showAgentPicker && (
                  <div
                    ref={(el) => {
                      if (!el) return;
                      const handler = (e: MouseEvent) => {
                        if (!el.contains(e.target as Node)) setShowAgentPicker(false);
                      };
                      document.addEventListener('mousedown', handler);
                      el.dataset.cleanup = 'true';
                      const obs = new MutationObserver(() => {
                        if (!document.contains(el)) {
                          document.removeEventListener('mousedown', handler);
                          obs.disconnect();
                        }
                      });
                      obs.observe(document.body, { childList: true, subtree: true });
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: '6px',
                      zIndex: 50,
                      background: '#1e293b',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: '12px',
                      padding: '4px',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
                      minWidth: '180px',
                    }}
                  >
                    {/* "AI Auto" option */}
                    <button
                      onClick={() => { setSelectedAgent(null); setShowAgentPicker(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 10px', borderRadius: '8px',
                        background: !selectedAgent ? '#334155' : 'transparent',
                        border: 'none', cursor: 'pointer', fontSize: '12px',
                        color: '#e2e8f0', fontWeight: !selectedAgent ? 600 : 400,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = !selectedAgent ? '#334155' : 'transparent')}
                    >
                      <Sparkles style={{ width: 14, height: 14, color: '#60a5fa' }} />
                      <span>AI 自动选择</span>
                      {!selectedAgent && <Check style={{ width: 12, height: 12, color: '#60a5fa', marginLeft: 'auto' }} />}
                    </button>

                    <div style={{ height: '1px', background: 'rgba(148,163,184,0.15)', margin: '4px 8px' }} />

                    {DIAGRAM_AGENTS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setSelectedAgent(a);
                          setShowAgentPicker(false);
                          textareaRef.current?.focus();
                        }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '8px 10px', borderRadius: '8px',
                          background: selectedAgent?.id === a.id ? '#334155' : 'transparent',
                          border: 'none', cursor: 'pointer', fontSize: '12px',
                          color: '#e2e8f0', fontWeight: selectedAgent?.id === a.id ? 600 : 400,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = selectedAgent?.id === a.id ? '#334155' : 'transparent')}
                      >
                        <a.Icon style={{ width: 14, height: 14, color: a.color }} />
                        <span>{a.label}</span>
                        <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '2px' }}>{a.engineLabel}</span>
                        {selectedAgent?.id === a.id && <Check style={{ width: 12, height: 12, color: a.color, marginLeft: 'auto' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* X to deselect agent */}
              {selectedAgent && (
                <button
                  onClick={() => setSelectedAgent(null)}
                  style={{
                    width: '18px', height: '18px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(148,163,184,0.15)', border: 'none',
                    cursor: 'pointer', color: '#94a3b8',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(248,113,113,0.2)'; e.currentTarget.style.color = '#f87171'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.15)'; e.currentTarget.style.color = '#94a3b8'; }}
                  title="清除 Agent 选择"
                >
                  <X style={{ width: 10, height: 10 }} />
                </button>
              )}
            </div>

            {/* Right: Send button */}
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && inputImages.length === 0) || isStreaming}
              style={{
                width: '32px', height: '32px',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none',
                cursor: ((!input.trim() && inputImages.length === 0) || isStreaming) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                background: ((input.trim() || inputImages.length > 0) && !isStreaming)
                  ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                  : '#334155',
                opacity: ((!input.trim() && inputImages.length === 0) || isStreaming) ? 0.4 : 1,
                boxShadow: ((input.trim() || inputImages.length > 0) && !isStreaming)
                  ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
              }}
            >
              {isStreaming
                ? <Loader2 style={{ width: 14, height: 14, color: '#94a3b8', animation: 'spin 1s linear infinite' }} />
                : <Send style={{ width: 14, height: 14, color: '#fff' }} />
              }
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'right', padding: '4px 8px 0', fontSize: '10px', color: '#475569' }}>
          Enter 发送 · Shift+Enter 换行
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
