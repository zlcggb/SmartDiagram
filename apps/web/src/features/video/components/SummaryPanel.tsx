import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { askQuestionStream, fileDownloadUrl } from '../lib/api';
import {
  exportMindmapElixirPng,
  exportMindmapElixirSvg,
  exportMindmapMarkdown,
  exportSubtitle,
  SUBTITLE_FORMATS,
} from '../lib/exportFormats';
import { renderChatMarkdown, renderMarkdown } from '../lib/markdown';
import { normalizeMindmapMarkdown } from '../lib/mindElixirHelpers';
import type {
  ChatAction,
  ChatMessageItem,
  SummaryState,
  TranscriptSegment,
  TranslationState,
} from '../lib/types';
import { QuizPanel } from './QuizPanel';
import { VideoMindmapCanvas, type VideoMindmapCanvasHandle } from './VideoMindmapCanvas';

interface SummaryPanelProps {
  summary: SummaryState;
  translation: TranslationState;
  summaryTaskId: string;
  videoTitle?: string;
  webpageUrl?: string;
  videoDuration?: number;
  embedded?: boolean;
  readOnly?: boolean;
  shareToken?: string;
  onGenerate: (opts: { targetLang: string; prompt: string }) => void;
  onTranslate: (targetLang: string) => void;
  onCancel: () => void;
  onSeek: (seconds: number) => void;
}

const LANGS = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
];

const STAGE_TEXT: Record<string, string> = {
  queued: '排队中…',
  transcribing: '正在获取字幕 / 转写音频…',
  local_asr: '正在识别语音…',
  analyzing_frames: '正在分析视频画面…',
  summarizing: 'AI 正在总结…',
  done: '完成',
};

const STAGE_FLOOR: Record<string, number> = {
  queued: 3,
  transcribing: 8,
  local_asr: 60,
  analyzing_frames: 22,
  summarizing: 55,
};

const MINDMAP_FORMATS = [
  { id: 'md', label: 'Markdown' },
  { id: 'svg', label: 'SVG' },
  { id: 'png', label: 'PNG' },
];

const SUGGESTED = [
  '这个视频的核心观点是什么？',
  '有哪些值得记住的要点？',
  '请用三句话概括内容',
];

const INTENT_LABELS: Record<string, string> = {
  video_qa: '内容问答',
  make_quiz: '生成测验',
  translate: '语言翻译',
  download: '视频下载',
  seek_player: '播放跳转',
  chitchat: '日常对话',
};

function fmtTime(seconds?: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

function formatNowTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function timeLink(webpageUrl: string, seconds?: number): string | null {
  const url = webpageUrl || '';
  const t = Math.floor(seconds || 0);
  if (!url) return null;
  if (/youtube\.com|youtu\.be/.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}t=${t}s`;
  }
  if (/bilibili\.com/.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}t=${t}`;
  }
  return null;
}

export const SummaryPanel: React.FC<SummaryPanelProps> = ({
  summary,
  translation,
  summaryTaskId,
  videoTitle = 'video',
  webpageUrl = '',
  videoDuration = 0,
  embedded = false,
  readOnly = false,
  shareToken = '',
  onGenerate,
  onTranslate,
  onCancel,
  onSeek,
}) => {
  const navigate = useNavigate();
  const [targetLang, setTargetLang] = useState('zh');
  const [transLang, setTransLang] = useState('zh');
  const [activeTab, setActiveTab] = useState<'summary' | 'chapters' | 'mindmap' | 'transcript' | 'quiz' | 'chat'>('summary');
  const [customPrompt, setCustomPrompt] = useState('');
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  const handleCopyShareLink = () => {
    if (!summaryTaskId || !shareToken || typeof window === 'undefined') return;
    const isShortCode = shareToken.length === 10 && !shareToken.includes('.');
    const url = isShortCode
      ? `${window.location.origin}/video?s=${encodeURIComponent(shareToken)}`
      : `${window.location.origin}/video?analysis=${encodeURIComponent(summaryTaskId)}&share=${encodeURIComponent(shareToken)}`;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url);
    }
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2600);
  };

  const [subtitleExportFormat, setSubtitleExportFormat] = useState('srt');
  const [mindmapExportFormat, setMindmapExportFormat] = useState('md');
  const [exportBilingual, setExportBilingual] = useState(true);

  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [questionInput, setQuestionInput] = useState('');
  const [asking, setAsking] = useState(false);

  const [liveElapsedMs, setLiveElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  const mindmapBoxRef = useRef<HTMLDivElement | null>(null);
  const mindmapCanvasRef = useRef<VideoMindmapCanvasHandle | null>(null);
  const partialScrollBoxRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const result = summary.result;
  const isRunning = ['queued', 'transcribing', 'local_asr', 'analyzing_frames', 'summarizing'].includes(
    summary.status,
  );
  const isDone = summary.status === 'done' && !!result;
  const isStreamingResult = isRunning && summary.stage === 'summarizing' && !!result;
  const showResultTabs = (isDone || isStreamingResult) && !!result;
  const isCancelled = summary.status === 'cancelled';

  const stageText = STAGE_TEXT[summary.stage] || '处理中…';
  const progressHint = useMemo(() => {
    if (summary.stageMessage) return summary.stageMessage;
    if (summary.stage === 'local_asr') return '正在识别语音，本步骤较慢，请保持页面打开。';
    if (summary.stage === 'transcribing') return '优先使用平台字幕或云端转写，通常比本机识别快得多。';
    return '长视频可能需要几分钟，请耐心等待。';
  }, [summary.stage, summary.stageMessage]);

  const summaryProgressWidth = useMemo(() => {
    if (summary.status === 'done') return 100;
    if (!isRunning) return 0;
    const stage = summary.stage || summary.status;
    const floor = STAGE_FLOOR[stage] ?? 2;
    const v = Math.max(Number(summary.percent) || 0, floor);
    return Math.min(Math.max(v, 2), 99);
  }, [isRunning, summary.percent, summary.stage, summary.status]);

  const transRunning = translation?.status === 'translating';
  const transDone = translation?.status === 'done' && !!translation?.result;
  const transProgressWidth = useMemo(() => {
    if (translation?.status === 'done') return 100;
    if (translation?.status !== 'translating') return 0;
    return Math.min(Math.max(Number(translation.percent) || 0, 2), 99);
  }, [translation?.percent, translation?.status]);

  const sourceText = useMemo(() => {
    const s = result?.transcript_source;
    if (s === 'subtitle') return '来源：平台字幕';
    if (s === 'cloud_asr') return '来源：云端语音转写';
    if (s === 'asr') return '来源：本地语音转写';
    if (s === 'vision') return '来源：画面分析（无旁白）';
    if (s === 'multimodal') return '来源：音画融合';
    return '';
  }, [result?.transcript_source]);

  const timingBadge = useMemo(() => {
    const t = summary.timing;
    if (!t || !t.total_ms) return '';
    const total = (t.total_ms / 1000).toFixed(1);
    let text = `总耗时 ${total}s`;
    if (t.asr_ms && t.llm_ms) {
      const asr = (t.asr_ms / 1000).toFixed(1);
      const llm = (t.llm_ms / 1000).toFixed(1);
      text += ` (识别 ${asr}s · 研报 ${llm}s)`;
    }
    const dur = videoDuration || 0;
    if (dur > 0 && t.total_ms > 0) {
      const speedup = Math.round(dur / (t.total_ms / 1000));
      if (speedup >= 2) {
        text += ` · ${speedup}x 极速`;
      }
    }
    return text;
  }, [summary.timing, videoDuration]);

  useEffect(() => {
    if (isRunning) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      const timer = setInterval(() => {
        if (startTimeRef.current) {
          setLiveElapsedMs(Date.now() - startTimeRef.current);
        }
      }, 200);
      return () => clearInterval(timer);
    } else {
      startTimeRef.current = null;
      setLiveElapsedMs(0);
    }
  }, [isRunning]);

  const partialTranscript = summary.partial_transcript || [];
  useEffect(() => {
    if (partialScrollBoxRef.current) {
      partialScrollBoxRef.current.scrollTop = partialScrollBoxRef.current.scrollHeight;
    }
  }, [partialTranscript.length]);

  useEffect(() => {
    setQuestionInput('');
    setAsking(false);
    setChatMessages(Array.isArray(result?.chat_history) ? [...result.chat_history] : []);
  }, [summaryTaskId]);

  useEffect(() => {
    if (Array.isArray(result?.chat_history) && chatMessages.length === 0 && result.chat_history.length > 0) {
      setChatMessages([...result.chat_history]);
    }
  }, [result?.chat_history, chatMessages.length]);

  const scrollChatBottom = () => {
    setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }, 20);
  };

  const parsedKeyPoints = useMemo(() => {
    const points = result?.key_points || [];
    return points.map((p) => {
      if (typeof p !== 'string') return { tag: '', content: String(p) };
      const m = p.match(/^[【\[]([^】\]]+)[】\]]\s*(.*)$/);
      if (m) return { tag: m[1], content: m[2] };
      return { tag: '', content: p };
    });
  }, [result?.key_points]);

  const summaryMarkdown = useMemo(() => {
    if (!result) return '';
    let out = `# ${result.title || 'AI 深度总结研报'}\n\n`;
    if (result.tldr) out += `> **核心破局点 (TL;DR)**：${result.tldr}\n\n`;
    out += `${result.summary || ''}\n\n`;
    if (result.actionable_takeaways?.length) {
      out += `## 实战落地指南\n`;
      for (const a of result.actionable_takeaways) out += `- ${a}\n`;
      out += `\n`;
    }
    if (result.key_points?.length) {
      out += `## 知识要点\n`;
      for (const p of result.key_points) out += `- ${p}\n`;
      out += `\n`;
    }
    if (result.chapters?.length) {
      out += `## 章节导航\n`;
      for (const c of result.chapters) out += `- [${c.time}] ${c.title}：${c.summary || ''}\n`;
    }
    return out;
  }, [result]);

  const transcriptLines: TranscriptSegment[] = useMemo(() => {
    if (transDone && translation.result) return translation.result;
    if (result?.transcript?.length) return result.transcript;
    if (partialTranscript.length) return partialTranscript;
    return [];
  }, [partialTranscript, result?.transcript, transDone, translation.result]);

  const transcriptText = useMemo(() => {
    return (transcriptLines || [])
      .map((l) =>
        l.translation
          ? `[${l.time || fmtTime(l.start)}] ${l.text}\n    ${l.translation}`
          : `[${l.time || fmtTime(l.start)}] ${l.text}`,
      )
      .join('\n');
  }, [transcriptLines]);

  const renderedSummaryHtml = useMemo(() => {
    if (!result?.summary) return '';
    return renderMarkdown(result.summary);
  }, [result?.summary]);

  const handleRichTextClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    const pill = target?.closest?.('.timestamp-pill') as HTMLElement | null;
    if (!pill) return;
    const sec = Number(pill.getAttribute('data-seek-seconds'));
    if (!Number.isNaN(sec)) {
      e.preventDefault();
      onSeek(Math.max(0, sec));
    }
  };

  const copyText = (text?: string) => {
    if (text && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  };

  const handleExportMindmap = (type: string) => {
    const title = videoTitle || 'mindmap';
    const md = result?.mindmap;
    const me = mindmapCanvasRef.current?.getInstance();
    if (type === 'md') exportMindmapMarkdown(md, title);
    else if (type === 'svg') exportMindmapElixirSvg(me, title);
    else if (type === 'png') void exportMindmapElixirPng(me, title);
  };

  const handleOpenInDiagramStudio = () => {
    const md = normalizeMindmapMarkdown(result?.mindmap || '');
    if (!md) return;

    const cleanVideoTitle = (videoTitle && videoTitle !== 'video' ? videoTitle : '').trim();
    const reportTitle = (result?.title || '').trim();
    const displayTitle = reportTitle || cleanVideoTitle || '视频深度总结思维导图';
    const tldr = (result?.tldr || '').trim();
    const keyPoints = Array.isArray(result?.key_points)
      ? result.key_points.slice(0, 4).map((p) => String(p).trim()).filter(Boolean)
      : [];

    const conceptParts: string[] = [];
    if (tldr) {
      conceptParts.push(tldr);
    } else if (result?.summary) {
      conceptParts.push(String(result.summary).replace(/\s+/g, ' ').slice(0, 220));
    }
    if (keyPoints.length > 0) {
      conceptParts.push(`核心要点：${keyPoints.join('；')}`);
    }
    const conceptText = conceptParts.join('\n') || `来自视频《${displayTitle}》的结构化思维导图`;

    const store = useChatStore.getState();
    store.clearMessages();
    store.clearPendingElements();
    store.clearInputImages();
    store.setSelectedNode(null);
    store.setCanvasDiagramId(null);
    store.setCanvasDiagramVersionId(null);
    store.setIsStreaming(false);
    store.setStreamStartTime(null);
    store.setStreamingCode('');
    store.setCanvasEngine('mindmap');
    store.setCanvasTask('mindmap');
    store.setCurrentEngine('mindmap');
    store.setCurrentTask('mindmap');
    store.setDesignConcept(conceptText);
    store.setCanvasCode(md);
    store.setCanvasPhase('done');
    store.requestCanvasRenderRetry();
    store.addMessage({
      id: `a_video_import_${Date.now()}`,
      role: 'assistant',
      content: `已从视频学习助手导入《${displayTitle}》的思维导图。您可以直接在右侧输入指令继续深挖、扩写节点，或点击「换类型」将其转换为流程图、架构图、信息图。`,
      taskType: 'mindmap',
      engineType: 'mindmap',
      designConcept: conceptText,
      code: md,
      sourceVideo: {
        taskId: summaryTaskId || '',
        title: cleanVideoTitle || displayTitle,
        tldr: tldr || undefined,
        webpageUrl: webpageUrl || undefined,
      },
      timestamp: Date.now(),
    });
    navigate('/diagram');
  };

  const handleAsk = async (preset?: string) => {
    const q = (preset ?? questionInput).trim();
    if (!q || asking || !summaryTaskId) return;
    if (!preset) setQuestionInput('');

    const history = chatMessages
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    const userMsg: ChatMessageItem = { role: 'user', content: q, created_at: formatNowTime() };
    const assistantMsg: ChatMessageItem = {
      role: 'assistant',
      content: '',
      action: null,
      router: null,
      streaming: true,
      created_at: formatNowTime(),
    };

    setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
    setAsking(true);
    scrollChatBottom();

    try {
      await askQuestionStream(summaryTaskId, q, history, {
        onRouter: (routerMeta, createdAt) => {
          setChatMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = {
                ...last,
                router: routerMeta,
                created_at: createdAt || last.created_at,
              };
            }
            return copy;
          });
          scrollChatBottom();
        },
        onDelta: (delta) => {
          setChatMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, content: last.content + delta };
            }
            return copy;
          });
          scrollChatBottom();
        },
        onDone: (doneItem) => {
          setChatMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = {
                ...last,
                content: last.content || doneItem?.answer || '',
                action: doneItem?.action || null,
                router: doneItem?.router || last.router,
                created_at: doneItem?.created_at || last.created_at,
                streaming: false,
              };
            }
            return copy;
          });
          scrollChatBottom();
        },
      });
    } catch (e: any) {
      setChatMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            streaming: false,
            error: true,
            content: `回答失败：${e?.message || '未知错误'}`,
          };
        }
        return copy;
      });
    } finally {
      setAsking(false);
      scrollChatBottom();
    }
  };

  const handleTriggerAction = (action?: ChatAction | null) => {
    if (!action) return;
    if (action.type === 'download' && action.summary_task_id) {
      const url = fileDownloadUrl(action.summary_task_id);
      window.open(url, '_blank');
    } else if (action.type === 'switch_tab' && action.tab) {
      setActiveTab(action.tab as any);
    } else if (action.type === 'seek' && action.seconds !== undefined) {
      onSeek(action.seconds);
    }
  };

  return (
    <div
      className={
        embedded
          ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm'
          : 'mx-auto mt-5 max-w-3xl rounded-3xl border border-slate-200/80 bg-white text-left shadow-lg'
      }
    >
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg
            className="h-4.5 w-4.5 text-[#0071e3]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z" />
          </svg>
          <h3 className="text-[15px] font-semibold text-slate-900">AI 视频总结</h3>
          {sourceText && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">
              {sourceText}
            </span>
          )}
          {isDone && timingBadge && (
            <span
              className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-amber-700"
              title="端到端处理耗时"
            >
              ⚡ {timingBadge}
            </span>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {isDone && summaryTaskId && shareToken && (
              <button
                type="button"
                onClick={handleCopyShareLink}
                className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition ${
                  copiedShareLink
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#0071e3]/40 hover:text-[#0071e3]'
                }`}
                title="复制免登录只读分享链接"
              >
                <span>{copiedShareLink ? '✓' : '🔗'}</span>
                <span>{copiedShareLink ? '已复制链接' : '分享'}</span>
              </button>
            )}
            <div className="relative">
              <select
                value={targetLang}
                disabled={isRunning}
                onChange={(e) => setTargetLang(e.target.value)}
                className="field-pill appearance-none !h-7 !px-3 pr-7 !text-[12px]"
              >
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {isRunning ? (
              <button type="button" className="btn-pill-danger !h-7 !px-3 !text-[12px]" onClick={onCancel}>
                取消总结
              </button>
            ) : (
              <button
                type="button"
                className="btn-pill-outline-sm !h-7 !px-3 !text-[12px]"
                onClick={() => onGenerate({ targetLang, prompt: customPrompt.trim() })}
              >
                {isDone || summary.status === 'error' || isCancelled ? '重新生成' : '开始总结'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Optional Prompt Bar */}
      {!readOnly && !isRunning && !isDone && (
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="shrink-0 text-slate-500">💡 领域主题 / 提示词：</span>
            <input
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              type="text"
              placeholder="可选（留空时全自动根据视频标题提取先验主题）"
              className="field-pill min-w-0 flex-1 !h-8 !px-3 !text-[12px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onGenerate({ targetLang, prompt: customPrompt.trim() });
              }}
            />
          </div>
        </div>
      )}

      {/* Running State (Transcribing / Frame Analysis) */}
      {isRunning && !isStreamingResult && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-5">
          <div className="flex items-center justify-between gap-3 text-[13px] text-slate-500">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-medium text-slate-900">{stageText}</span>
              <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#0071e3]">
                ⏱️ {(liveElapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
              {Math.round(summaryProgressWidth)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full bg-[#0071e3] transition-all duration-300 ${
                summary.stage === 'queued' ? 'animate-pulse' : ''
              }`}
              style={{ width: `${summaryProgressWidth}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-slate-500">{progressHint}</p>

          {partialTranscript.length > 0 && (
            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#0071e3]/20 bg-[#0071e3]/[0.04] p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0071e3] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0071e3]" />
                  </span>
                  <span className="text-[12px] font-bold text-[#0071e3]">
                    实时转写就绪（已产出 {partialTranscript.length} 句 · 边听边读）
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">分片并发加速中</span>
              </div>
              <div
                ref={partialScrollBoxRef}
                className="panel-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-[12.5px]"
              >
                {partialTranscript.map((seg, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 rounded-lg px-2 py-1 transition hover:bg-white/80"
                  >
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 rounded bg-[#0071e3]/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#0071e3] hover:bg-[#0071e3]/20"
                      onClick={() => onSeek(seg.start)}
                    >
                      {seg.time || fmtTime(seg.start)}
                    </button>
                    <span className="leading-relaxed text-slate-800">{seg.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Compact Streaming Banner when Summarizing with Partial Result */}
      {isStreamingResult && (
        <div className="shrink-0 border-b border-[#0071e3]/15 bg-[#0071e3]/[0.04] px-5 py-2.5">
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0071e3] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0071e3]" />
              </span>
              <span className="truncate font-medium text-slate-900">{progressHint || stageText}</span>
              <span className="shrink-0 rounded-full bg-[#0071e3]/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#0071e3]">
                ⏱️ {(liveElapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
            <span className="shrink-0 font-semibold tabular-nums text-[#0071e3]">
              {Math.round(summaryProgressWidth)}%
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#0071e3]/15">
            <div
              className="h-full rounded-full bg-[#0071e3] transition-all duration-300"
              style={{ width: `${summaryProgressWidth}%` }}
            />
          </div>
        </div>
      )}

      {/* Cancelled */}
      {!isRunning && isCancelled && (
        <div className="flex flex-1 flex-col px-5 py-6">
          <p className="text-[14px] text-slate-600">{summary.error || '已取消 AI 总结'}</p>
          <p className="mt-2 text-[13px] text-slate-500">需要总结时请点击右上角「重新生成」。</p>
        </div>
      )}

      {/* Error */}
      {!isRunning && summary.status === 'error' && (
        <div className="flex flex-1 flex-col px-5 py-6">
          <p className="text-[13px] text-red-500">{summary.error || '总结失败，请重试'}</p>
          <button
            type="button"
            className="btn-pill mt-4 w-fit !px-4 !py-2 !text-[13px]"
            onClick={() => onGenerate({ targetLang, prompt: customPrompt.trim() })}
          >
            重新生成
          </button>
        </div>
      )}

      {/* Idle */}
      {!isRunning && !isDone && !isCancelled && summary.status !== 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center">
          <p className="text-[14px] text-slate-600">
            点击右上角「开始总结」，AI 将自动提取字幕、生成深度研报、章节导航、思维导图与测验。
          </p>
        </div>
      )}

      {/* Done or Progressive Streaming Results */}
      {showResultTabs && result && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          <div className="mb-2.5 flex shrink-0 gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 text-[12.5px]">
            {(
              [
                ['summary', '研报总结'],
                ['chapters', '章节导航'],
                ['mindmap', '思维导图'],
                ['transcript', '字幕/文稿'],
                ['quiz', '测验'],
                ['chat', '问答'],
              ] as const
            ).map(([id, label]) => {
              const isTabReady =
                !isStreamingResult ||
                (id === 'summary' && Boolean(result.summary || result.tldr)) ||
                (id === 'chapters' && Boolean(result.chapters && result.chapters.length > 0)) ||
                (id === 'mindmap' && Boolean(result.mindmap && result.mindmap.trim())) ||
                (id === 'transcript' && Boolean(result.transcript && result.transcript.length > 0));
              return (
                <button
                  key={id}
                  type="button"
                  className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 transition ${
                    activeTab === id ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                  onClick={() => {
                    setActiveTab(id);
                    if (id === 'mindmap') {
                      setTimeout(() => mindmapCanvasRef.current?.refreshLayout(), 40);
                    }
                  }}
                >
                  <span>{label}</span>
                  {isStreamingResult && isTabReady && (id === 'chapters' || id === 'mindmap' || id === 'transcript') && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="已提前就绪" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Tab: Summary */}
            {activeTab === 'summary' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="panel-scroll min-h-0 flex-1 space-y-4 pr-1">
                  {result.title && (
                    <h3 className="text-[17px] font-bold tracking-tight text-slate-900">{result.title}</h3>
                  )}

                  {result.tldr && (
                    <div className="rounded-2xl border border-[#0071e3]/25 bg-gradient-to-br from-[#0071e3]/10 via-[#0071e3]/[0.04] to-transparent p-4 shadow-sm">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-[#0071e3]">
                        <span>🎯 核心破局点 (TL;DR)</span>
                      </div>
                      <p className="text-[13.5px] font-medium leading-relaxed text-slate-900">{result.tldr}</p>
                    </div>
                  )}

                  {isStreamingResult && !result.summary && !result.tldr && (
                    <div className="rounded-2xl border border-[#0071e3]/20 bg-[#0071e3]/[0.03] p-4 text-[13px] text-slate-600">
                      <div className="flex items-center gap-2 font-semibold text-[#0071e3]">
                        <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[#0071e3]" />
                        <span>✨ 全文转写已完成！正在双轨并发生成深度研报与思维导图…</span>
                      </div>
                      <p className="mt-1.5 text-[12.5px] text-slate-500">
                        报告正文即将流式输出；您可以随时点击上方「字幕/文稿」立即阅读完整台词，或待「思维导图 / 章节导航」亮起绿点后先行浏览。
                      </p>
                    </div>
                  )}

                  {renderedSummaryHtml ? (
                    <div
                      className="prose-report text-[14px] leading-relaxed text-slate-800"
                      onClick={handleRichTextClick}
                      dangerouslySetInnerHTML={{ __html: renderedSummaryHtml }}
                    />
                  ) : (
                    result.summary && (
                      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-800">
                        {result.summary}
                      </p>
                    )
                  )}

                  {result.actionable_takeaways && result.actionable_takeaways.length > 0 && (
                    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
                      <h4 className="mb-2.5 flex items-center gap-2 text-[14px] font-bold text-emerald-800">
                        <span>🚀 实战落地指南与行动建议</span>
                      </h4>
                      <ul className="space-y-2">
                        {result.actionable_takeaways.map((item, idx) => (
                          <li
                            key={idx}
                            className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-slate-800"
                          >
                            <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-600">
                              ✓
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {parsedKeyPoints.length > 0 && (
                    <div>
                      <h4 className="mb-2.5 mt-4 text-[14px] font-bold text-slate-900">核心要素与维度解析</h4>
                      <ul className="space-y-2">
                        {parsedKeyPoints.map((p, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2.5 rounded-xl border border-slate-200/60 bg-slate-50/70 p-2.5 text-[13.5px] leading-relaxed"
                          >
                            {p.tag ? (
                              <span className="shrink-0 rounded-md bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-semibold text-[#0071e3]">
                                {p.tag}
                              </span>
                            ) : (
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0071e3]" />
                            )}
                            <span className="leading-relaxed text-slate-800">{p.content}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex shrink-0 items-center justify-between border-t border-slate-200/80 pt-3">
                  <button
                    type="button"
                    className="text-[13px] font-medium text-[#0071e3] hover:underline"
                    onClick={() => copyText(summaryMarkdown)}
                  >
                    复制完整研报 (Markdown)
                  </button>
                  {timingBadge && <span className="font-mono text-[11px] text-slate-500">{timingBadge}</span>}
                </div>
              </div>
            )}

            {/* Tab: Chapters */}
            {activeTab === 'chapters' && (
              <div className="panel-scroll min-h-0 flex-1 space-y-3 pr-1">
                {(result.chapters || []).map((c, i) => {
                  const extLink = timeLink(webpageUrl, c.seconds);
                  return (
                    <div key={i} className="rounded-2xl border border-slate-200/80 p-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md bg-[#0071e3]/10 px-2 py-0.5 text-[12px] font-medium text-[#0071e3] hover:bg-[#0071e3]/20"
                          onClick={() => onSeek(c.seconds)}
                        >
                          {c.time}
                        </button>
                        {extLink && (
                          <a
                            href={extLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-slate-400 hover:text-[#0071e3]"
                            title="在原站打开"
                          >
                            ↗
                          </a>
                        )}
                        <span className="text-[14px] font-semibold text-slate-900">{c.title}</span>
                      </div>
                      {c.summary && (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{c.summary}</p>
                      )}
                    </div>
                  );
                })}
                {(!result.chapters || result.chapters.length === 0) && (
                  <p className="py-8 text-center text-[13px] text-slate-400">暂无章节信息</p>
                )}
              </div>
            )}

            {/* Tab: Mindmap */}
            {activeTab === 'mindmap' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] text-slate-500">双击节点可编辑 · 滚轮缩放 · 拖拽平移 · 右下角小地图</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[#0071e3]/30 bg-[#0071e3]/10 px-2.5 py-1 text-[12px] font-medium text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white"
                      onClick={handleOpenInDiagramStudio}
                      title="发送至 SmartDiagram 图表工作台进行 AI 深度改图"
                    >
                      在图表工作台打开 ↗
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
                      onClick={async () => {
                        const el = mindmapBoxRef.current;
                        if (!el) return;
                        if (document.fullscreenElement) {
                          await document.exitFullscreen();
                        } else {
                          await el.requestFullscreen();
                        }
                        setTimeout(() => mindmapCanvasRef.current?.refreshLayout(), 50);
                      }}
                    >
                      全屏
                    </button>
                  </div>
                </div>
                <div
                  ref={mindmapBoxRef}
                  className="flex min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-slate-200/80"
                >
                  <VideoMindmapCanvas
                    ref={mindmapCanvasRef}
                    markdown={result.mindmap || ''}
                    className="h-full min-h-0 w-full"
                  />
                </div>
                <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3">
                  <select
                    value={mindmapExportFormat}
                    onChange={(e) => setMindmapExportFormat(e.target.value)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] outline-none focus:border-[#0071e3]"
                  >
                    {MINDMAP_FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-full border border-[#0071e3]/40 px-4 py-1.5 text-[12px] font-medium text-[#0071e3] hover:bg-[#0071e3]/10"
                    onClick={() => handleExportMindmap(mindmapExportFormat)}
                  >
                    导出思维导图
                  </button>
                  <button
                    type="button"
                    className="text-[12px] text-[#0071e3] hover:underline"
                    onClick={() => copyText(result.mindmap)}
                  >
                    复制 Markdown
                  </button>
                </div>
              </div>
            )}

            {/* Tab: Transcript */}
            {activeTab === 'transcript' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] text-slate-500">
                    共 {transcriptLines.length} 句{transDone ? ' · 已对照翻译' : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={transLang}
                      disabled={transRunning}
                      onChange={(e) => setTransLang(e.target.value)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#0071e3] disabled:opacity-50"
                    >
                      {LANGS.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={transRunning}
                      onClick={() => onTranslate(transLang)}
                      className="rounded-full border border-[#0071e3]/40 px-4 py-1.5 text-[13px] font-medium text-[#0071e3] transition hover:bg-[#0071e3]/10 disabled:opacity-50"
                    >
                      {transRunning ? '翻译中…' : transDone ? '重新翻译' : '对照翻译'}
                    </button>
                  </div>
                </div>

                {transRunning && (
                  <div className="mb-3 shrink-0">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span>翻译中</span>
                      <span className="tabular-nums text-slate-800">{Math.round(transProgressWidth)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[#0071e3] transition-all duration-300"
                        style={{ width: `${transProgressWidth}%` }}
                      />
                    </div>
                  </div>
                )}

                {translation.status === 'error' && (
                  <p className="mb-3 shrink-0 text-[13px] text-red-500">
                    {translation.error || '翻译失败，请重试'}
                  </p>
                )}

                <div className="panel-scroll min-h-0 flex-1 space-y-2 pr-1">
                  {transcriptLines.map((l, i) => {
                    const extLink = timeLink(webpageUrl, l.start);
                    return (
                      <div key={i} className="flex gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                        <button
                          type="button"
                          className="mt-0.5 shrink-0 text-[11px] font-medium text-[#0071e3] hover:underline"
                          onClick={() => onSeek(l.start)}
                        >
                          {l.time || fmtTime(l.start)}
                        </button>
                        {extLink && (
                          <a
                            href={extLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 shrink-0 text-[11px] text-slate-400 hover:text-[#0071e3]"
                          >
                            ↗
                          </a>
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] leading-relaxed text-slate-800">{l.text}</p>
                          {l.translation && (
                            <p className="text-[13px] leading-relaxed text-[#0071e3]">{l.translation}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3">
                  <select
                    value={subtitleExportFormat}
                    onChange={(e) => setSubtitleExportFormat(e.target.value)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] outline-none focus:border-[#0071e3]"
                  >
                    {SUBTITLE_FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  {transDone && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={exportBilingual}
                        onChange={(e) => setExportBilingual(e.target.checked)}
                        className="rounded"
                      />
                      双语
                    </label>
                  )}
                  <button
                    type="button"
                    className="rounded-full border border-[#0071e3]/40 px-4 py-1.5 text-[12px] font-medium text-[#0071e3] hover:bg-[#0071e3]/10"
                    onClick={() => {
                      if (!transcriptLines.length) return;
                      exportSubtitle(transcriptLines, subtitleExportFormat, {
                        bilingual: exportBilingual && transDone,
                        title: videoTitle || 'subtitle',
                      });
                    }}
                  >
                    导出字幕
                  </button>
                </div>
                <div className="mt-2 flex shrink-0 items-center justify-between text-[12px] text-slate-500">
                  <span>全文 {transcriptLines.length} 段</span>
                  <button
                    type="button"
                    className="text-[#0071e3] hover:underline"
                    onClick={() => copyText(transcriptText)}
                  >
                    复制文本
                  </button>
                </div>
              </div>
            )}

            {/* Tab: Quiz (常驻保活，切 Tab 不丢作答进度) */}
            <div className={activeTab === 'quiz' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
              <QuizPanel
                summaryTaskId={summaryTaskId}
                webpageUrl={webpageUrl}
                initialQuiz={result?.quiz || null}
                initialQuizState={result?.quiz_state || null}
                readOnly={readOnly}
                onSeek={onSeek}
              />
            </div>

            {/* Tab: Chat */}
            {activeTab === 'chat' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  ref={chatScrollRef}
                  className="panel-scroll min-h-0 flex-1 space-y-3 pr-1"
                  onClick={handleRichTextClick}
                >
                  {chatMessages.length === 0 && (
                    <div className="py-6">
                      {readOnly ? (
                        <p className="text-[13px] text-slate-500">
                          分享者暂未在本视频中留下 AI 问答记录。
                        </p>
                      ) : (
                        <>
                          <p className="text-[13px] text-slate-500">围绕视频内容向 AI 提问，例如：</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {SUGGESTED.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => void handleAsk(s)}
                                className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-[12.5px] text-slate-700 hover:border-[#0071e3]/40 hover:text-[#0071e3]"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-[#0071e3] text-white'
                            : msg.error
                              ? 'border border-red-200 bg-red-50 text-red-600'
                              : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {msg.role === 'user' ? (
                          <div className="whitespace-pre-wrap">
                            <span>{msg.content}</span>
                            {msg.created_at && (
                              <div className="mt-1 select-none text-right font-mono text-[10px] text-white/75">
                                {msg.created_at}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            {msg.streaming && !msg.content ? (
                              <span className="inline-flex items-center gap-1.5 text-slate-500">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0071e3]" />
                                思考中…
                              </span>
                            ) : (
                              <div
                                className="prose-chat leading-relaxed"
                                dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }}
                              />
                            )}
                            {msg.streaming && msg.content && (
                              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#0071e3] align-middle" />
                            )}

                            {/* 双系统智能路由与真实性能监控栏 */}
                            {msg.router && !msg.streaming && (
                              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-2 text-[11px] text-slate-500">
                                <span className="inline-flex items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 font-medium text-slate-700 shadow-sm">
                                  <span>{INTENT_LABELS[msg.router.intent || ''] || msg.router.intent}</span>
                                </span>

                                <span
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-emerald-700"
                                  title="Jev 系统 1 意图分类与短路分流耗时"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  ⚡ Jev系统1: {Number(msg.router.latency_ms || 0).toFixed(1)}ms
                                </span>

                                {msg.router.llm_total_ms !== undefined && (
                                  msg.router.llm_total_ms > 0 ? (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-md bg-[#0071e3]/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[#0071e3]"
                                      title={`系统 2 大模型流式生成总耗时（首字响应 TTFT: ${msg.router.llm_ttft_ms || 0}ms）`}
                                    >
                                      🧠 大模型:{' '}
                                      {msg.router.llm_total_ms >= 1000
                                        ? `${(msg.router.llm_total_ms / 1000).toFixed(2)}s`
                                        : `${msg.router.llm_total_ms}ms`}
                                      {msg.router.llm_ttft_ms ? (
                                        <span className="opacity-75">(首字 {msg.router.llm_ttft_ms}ms)</span>
                                      ) : null}
                                    </span>
                                  ) : (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-amber-700"
                                      title="由系统 1 直接完成指令编排，零大模型 Token 消耗"
                                    >
                                      ✨ 极速直达 · 0 大模型 Token 消耗
                                    </span>
                                  )
                                )}
                              </div>
                            )}

                            {/* 意图快捷动作按钮 */}
                            {(msg.action || msg.created_at) && !msg.streaming && (
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                {msg.action ? (
                                  <button
                                    type="button"
                                    onClick={() => handleTriggerAction(msg.action)}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#0071e3]/30 bg-[#0071e3]/10 px-3 py-1.5 text-[12px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white active:scale-[0.98]"
                                  >
                                    {msg.action.type === 'download' && <span>⬇</span>}
                                    {msg.action.type === 'switch_tab' && <span>✨</span>}
                                    {msg.action.type === 'seek' && <span>▶</span>}
                                    <span>{msg.action.label || '执行操作'}</span>
                                  </button>
                                ) : (
                                  <span />
                                )}
                                {msg.created_at && (
                                  <span className="ml-auto select-none font-mono text-[10px] text-slate-400">
                                    🕒 {msg.created_at}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {readOnly ? (
                  <div className="mt-3 flex shrink-0 items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-[12px] text-slate-500">
                    <span>👀 当前为只读分享模式，可点击上方回答中的 ▶ 时间戳跳转原视频进度</span>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600 shadow-2xs">
                      只读保护
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-slate-200/80 pt-3">
                    <input
                      value={questionInput}
                      onChange={(e) => setQuestionInput(e.target.value)}
                      disabled={asking}
                      placeholder="输入关于本视频的问题，按回车发送…"
                      className="field-pill min-w-0 flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleAsk();
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={asking || !questionInput.trim()}
                      onClick={() => void handleAsk()}
                      className="btn-pill-sm"
                    >
                      {asking ? '回答中…' : '发送'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
