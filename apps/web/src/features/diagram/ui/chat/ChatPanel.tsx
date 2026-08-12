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

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  Send, Loader2, Settings, SquarePen,
  ChevronDown, ChevronUp, ChevronRight,
  Sparkles, Copy, Check,
  Plus, X, ImageIcon, SlidersHorizontal,
  Brain, CheckCircle2,
  Database,
  Activity,
  AlertCircle,
  RotateCcw,
  History,
  Search,
  RefreshCw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useChatStore,
  type ConversationMemorySummary,
  type ConsistencyAgentSummary,
  type ConversationResumeNotice,
  type DesignAgentSummary,
  type ExportPlanSummary,
  type HumanApprovalSummary,
  type KnowledgeContextSummary,
  type LongTermPreferencesSummary,
  type Message,
  type PlannerPlanSummary,
  type RepairAgentSummary,
  type ExecutionPlanStep,
  type ThinkingStep,
} from '@/features/diagram/model/chatStore';
import SettingsModal from '@/shared/ui/settings/SettingsModal';
import { ConfirmDialog, NoticeDialog, TextInputDialog } from '@/components/common/AppDialog';
import { API_BASE, enterpriseBodyContext, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext';
import { useT } from '@/app/i18n';
import {
  DIAGRAM_AGENTS,
  VISIBLE_DIAGRAM_AGENTS,
  getAgentDisplayName,
  getTaskByEngine,
  getTaskDisplayName,
  type DiagramAgentMeta,
} from '@/shared/lib/config/diagramAgents';
import type { DiagramEngineType, DiagramTaskType } from '@/types/diagram';
import type { AuthSession } from '@/shared/store/auth';
import { getGuestQuota, refreshGuestQuotaFromServer, type GuestQuotaStatus } from '@/shared/lib/config/guestQuota';
import { ensureGuestSession } from '@/shared/lib/config/guestSession';
import LoginScreen from '@/components/auth/LoginScreen';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import {
  listConversationHistory,
  listDiagramHistory,
  type ConversationHistoryItem,
  type DiagramHistoryItem,
  type HistoryAgentProcess,
} from '@/features/diagram/model/diagramHistory';
import {
  DIAGRAM_SHELL_EVENT,
  type DiagramShellCommand,
  type DiagramShellEventDetail,
} from '@/shared/ui/shell/shellEvents';
import { SmartDiagramIconMark } from '@/components/brand/AppIconMarks';

type VersionActionPayload = {
  diagram_id: string;
  diagram_version_id: string;
  code?: string;
  engine_type?: DiagramEngineType;
  task_type?: DiagramTaskType;
  design_concept?: string;
  version_number?: number;
};

type HistoryMode = 'diagrams' | 'conversations';
type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

type BranchDialogState = { kind: 'history'; item: DiagramHistoryItem; initialValue: string };

type SendMessageOverrides = {
  forcedAgent?: DiagramAgentMeta | null;
  images?: string[];
  preserveInputImages?: boolean;
  currentCode?: string;
  currentTask?: DiagramTaskType | null;
  currentEngine?: DiagramEngineType | null;
  currentDiagramId?: string | null;
  currentDiagramVersionId?: string | null;
  designConcept?: string;
};

const formatSeconds = (value: number | undefined) => {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.0';
  return seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
};

/** Format a future epoch timestamp as a human-readable countdown string, e.g. "23h 15m" */
const formatResetTime = (resetAt: number): string => {
  const diffMs = Math.max(0, resetAt - Date.now());
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
};

const historyProcessToThinkingSteps = (process: HistoryAgentProcess | null | undefined): ThinkingStep[] => {
  const steps = Array.isArray(process?.steps) ? process.steps : [];
  const now = Date.now();
  return steps
    .map((step, index) => {
      const durationSeconds = Number(step.duration_seconds ?? ((step.duration_ms || 0) / 1000));
      const label = String(step.label || step.id || `Step ${index + 1}`).trim();
      return {
        id: String(step.id || `history_step_${index + 1}`),
        label,
        startTime: now,
        duration: Number.isFinite(durationSeconds) ? Math.max(durationSeconds, 0) : 0,
        status: step.status === 'running' ? 'running' : 'completed',
      } satisfies ThinkingStep;
    })
    .filter((step) => step.label);
};

const titleCaseKey = (value: string) =>
  value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const translatedOptional = (t: TranslateFn, key: string, fallback: string) => {
  const translated = t(key);
  return translated === key ? fallback : translated;
};

const runtimeStepToPlanStep = (stepId: string, action?: string) => {
  if (stepId === 'designer') return 'designer';
  if (stepId === 'agent' || stepId === 'llm') return action === 'start' ? 'chart' : '';
  if (stepId === 'generating') return 'chart';
  return stepId;
};

const parseExecutionPlanSteps = (items: unknown[]): ExecutionPlanStep[] =>
  items
    .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item: Record<string, unknown>) => ({
      id: String(item.id || ''),
      label: String(item.label || ''),
      agent: String(item.agent || ''),
      phase: String(item.phase || ''),
      status: String(item.status || 'unknown'),
      durationMs: Number(item.duration_ms || item.durationMs || 0),
      metadata: typeof item.metadata === 'object' && item.metadata ? item.metadata as Record<string, unknown> : undefined,
    }));

const mergeExecutionPlanSteps = (
  incoming: ExecutionPlanStep[],
  current: ExecutionPlanStep[],
) => {
  const currentById = new Map(current.map((step) => [step.id, step]));
  return incoming.map((step) => {
    const existing = currentById.get(step.id);
    if (!existing) return step;
    if (step.status === 'pending' && existing.status !== 'pending') {
      return {
        ...step,
        status: existing.status,
        durationMs: existing.durationMs,
        metadata: { ...(step.metadata || {}), ...(existing.metadata || {}) },
      };
    }
    return {
      ...step,
      durationMs: step.durationMs || existing.durationMs,
      metadata: { ...(existing.metadata || {}), ...(step.metadata || {}) },
    };
  });
};

const updateExecutionPlanStepStatus = (
  steps: ExecutionPlanStep[],
  rawStepId: string,
  action: string | undefined,
  nextStatus?: string,
) => {
  const stepId = runtimeStepToPlanStep(rawStepId, action);
  if (!stepId) return steps;
  const now = Date.now();
  return steps.map((step) => {
    if (step.id !== stepId) return step;
    const metadata = { ...(step.metadata || {}) };
    if (action === 'start') {
      metadata.startedAtMs = now;
      return { ...step, status: 'running', metadata };
    }
    const startedAtMs = Number(metadata.startedAtMs || 0);
    const durationMs = startedAtMs > 0 ? now - startedAtMs : step.durationMs;
    return {
      ...step,
      status: nextStatus || (action === 'end' ? 'succeeded' : step.status),
      durationMs,
      metadata,
    };
  });
};

const markExecutionPlanFailed = (steps: ExecutionPlanStep[], errorMessage: string) => {
  if (steps.length === 0) return steps;
  const hasRunning = steps.some((step) => step.status === 'running');
  let failedAssigned = false;
  return steps.map((step) => {
    if (step.status === 'succeeded') return step;
    if (step.status === 'running' || (!hasRunning && !failedAssigned && step.status === 'pending')) {
      failedAssigned = true;
      return {
        ...step,
        status: 'failed',
        metadata: { ...(step.metadata || {}), error: errorMessage },
      };
    }
    if (step.status === 'pending') {
      return { ...step, status: 'skipped' };
    }
    return step;
  });
};

/* ── Design Concept Collapsible ── */
function DesignConceptCard({ text }: { text: string }) {
  const { canvasMode } = useChatStore();
  const [open, setOpen] = useState(false);
  const isLong = text.length > 100;
  const isLight = canvasMode === 'light';

  return (
    <div className={`mt-2 rounded-xl border transition-all duration-300 overflow-hidden ${
      isLight 
        ? 'border-amber-200 bg-amber-50/70 shadow-sm' 
        : 'border-amber-500/10 bg-amber-500/5'
    }`}>
      <button onClick={() => isLong && setOpen(!open)}
        className={`w-full flex items-start gap-2 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
          isLight ? 'hover:bg-amber-100/30' : 'hover:bg-amber-500/5'
        }`}>
        <span className="text-[10px] mt-0.5">💡</span>
        <div className={`text-[11px] leading-relaxed flex-1 transition-colors ${
          isLight 
            ? 'text-amber-900 font-medium' 
            : 'text-amber-300/80'
        } ${!open && isLong ? 'line-clamp-2' : ''}`}>
          <div className={`prose prose-xs max-w-none
            ${isLight
              ? 'prose-slate prose-headings:text-amber-900 prose-strong:text-amber-900 prose-code:text-amber-800 prose-code:bg-amber-100'
              : 'prose-invert prose-headings:text-amber-200 prose-strong:text-amber-200 prose-code:text-amber-200 prose-code:bg-amber-900/30'
            }
            prose-p:my-0.5 prose-p:text-[11px] prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0
            prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-code:font-mono
            [&>*:first-child]:mt-0 [&>*:last-child]:mb-0`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </div>
        {isLong && (open
          ? <ChevronUp className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isLight ? 'text-amber-700' : 'text-amber-500/40'}`} />
          : <ChevronDown className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isLight ? 'text-amber-700' : 'text-amber-500/40'}`} />
        )}
      </button>
    </div>
  );
}

function ExportPlanCard({ plan }: { plan: ExportPlanSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const allowed = plan.allowedFormats
    .map((item) => String(item.format || '').toUpperCase())
    .filter(Boolean)
    .slice(0, 5);

  if (allowed.length === 0) return null;

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 ${
      isLight ? 'border-violet-200 bg-violet-50/70 text-violet-900' : 'border-violet-500/10 bg-violet-500/5 text-violet-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('agentCard.export')}</span>
        </div>
        <span className={`shrink-0 text-[10px] ${isLight ? 'text-violet-700' : 'text-violet-300/70'}`}>
          {plan.preferredFormat ? String(plan.preferredFormat).toUpperCase() : plan.status}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {allowed.map((format) => (
          <span
            key={format}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              isLight ? 'bg-white text-violet-700' : 'bg-violet-500/10 text-violet-200'
            }`}
          >
            {format}
          </span>
        ))}
      </div>
    </div>
  );
}

function ExecutionPlanCard({ steps }: { steps: ExecutionPlanStep[] }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const visibleSteps = steps
    .filter((step) => step.id || step.label)
    .slice(0, 5);
  if (visibleSteps.length === 0) return null;

  const totalMs = visibleSteps.reduce((sum, step) => sum + Number(step.durationMs || 0), 0);
  const duration = totalMs > 0 ? formatSeconds(totalMs / 1000) : '';
  const statusLabel = (status: string) => translatedOptional(t, `ops.status.${status}`, status || t('common.unknown'));
  const stepLabel = (step: ExecutionPlanStep) => translatedOptional(
    t,
    `ops.step.${step.id}`,
    step.label || titleCaseKey(step.phase || step.agent || step.id),
  );

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      isLight ? 'border-blue-200 bg-blue-50/70 text-blue-900' : 'border-blue-500/15 bg-blue-500/5 text-blue-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('agentCard.execution')}</span>
        </div>
        <span className={`shrink-0 text-[10px] tabular-nums ${isLight ? 'text-blue-700' : 'text-blue-300/70'}`}>
          {duration ? t('agentCard.executionSummary', { steps: steps.length, duration }) : t('agentCard.steps', { count: steps.length })}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {visibleSteps.map((step, index) => (
          <div key={`${step.id || step.label}-${index}`} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="min-w-0 truncate">{stepLabel(step)}</span>
            <span className={`shrink-0 ${isLight ? 'text-blue-700/70' : 'text-blue-200/60'}`}>
              {statusLabel(step.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConversationMemoryCard({ memory }: { memory: ConversationMemorySummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const loaded = memory.status === 'loaded';
  const denied = memory.status === 'denied';
  const toneClass = loaded
    ? isLight ? 'border-cyan-200 bg-cyan-50/80 text-cyan-900' : 'border-cyan-500/15 bg-cyan-500/5 text-cyan-200'
    : denied
      ? isLight ? 'border-rose-200 bg-rose-50/80 text-rose-900' : 'border-rose-500/15 bg-rose-500/5 text-rose-200'
      : isLight ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-slate-700/70 bg-slate-800/40 text-slate-300';
  const statusText = loaded
    ? t('memory.conversation.loaded')
    : denied
      ? t('memory.denied')
      : t('memory.conversation.empty');
  const details = [
    memory.summaryPresent ? t('memory.summaryPresent') : t('memory.summaryMissing'),
    t('memory.recentMessages', { count: memory.recentCount }),
    memory.turnCount ? t('memory.turns', { count: memory.turnCount }) : '',
    memory.currentDiagramVersionId ? t('memory.diagramVersion', { id: memory.currentDiagramVersionId.slice(0, 8) }) : '',
  ].filter(Boolean);

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('memory.conversation.title')}</span>
        </div>
        <span className="shrink-0 text-[10px] opacity-75">{statusText}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {details.map((detail) => (
          <span key={detail} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isLight ? 'bg-white/80' : 'bg-white/10'}`}>
            {detail}
          </span>
        ))}
      </div>
      {memory.reason && !loaded && (
        <p className="mt-1.5 truncate text-[10px] opacity-70">{memory.reason}</p>
      )}
    </div>
  );
}

function LongTermPreferencesCard({ preferences }: { preferences: LongTermPreferencesSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const loaded = preferences.status === 'loaded';
  const denied = preferences.status === 'denied';
  const sourceLabels = Object.entries(preferences.sources || {})
    .filter(([, enabled]) => enabled)
    .map(([source]) => translatedOptional(t, `memory.source.${source}`, titleCaseKey(source)))
    .slice(0, 3);
  const keyLabels = preferences.keys
    .map((key) => translatedOptional(t, `memory.preferenceKey.${key}`, titleCaseKey(key)))
    .slice(0, 5);

  const toneClass = loaded && preferences.keys.length > 0
    ? isLight ? 'border-lime-200 bg-lime-50/80 text-lime-900' : 'border-lime-500/15 bg-lime-500/5 text-lime-200'
    : denied
      ? isLight ? 'border-rose-200 bg-rose-50/80 text-rose-900' : 'border-rose-500/15 bg-rose-500/5 text-rose-200'
      : isLight ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-slate-700/70 bg-slate-800/40 text-slate-300';
  const statusText = loaded && preferences.keys.length > 0
    ? t('memory.preferences.loaded')
    : denied
      ? t('memory.denied')
      : t('memory.preferences.empty');

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('memory.preferences.title')}</span>
        </div>
        <span className="shrink-0 text-[10px] opacity-75">{statusText}</span>
      </div>
      {(sourceLabels.length > 0 || keyLabels.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {sourceLabels.map((source) => (
            <span key={`source-${source}`} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isLight ? 'bg-white/80' : 'bg-white/10'}`}>
              {source}
            </span>
          ))}
          {keyLabels.map((key) => (
            <span key={`key-${key}`} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isLight ? 'bg-white/80' : 'bg-white/10'}`}>
              {key}
            </span>
          ))}
        </div>
      )}
      {preferences.reason && !loaded && (
        <p className="mt-1.5 truncate text-[10px] opacity-70">{preferences.reason}</p>
      )}
    </div>
  );
}

function ConversationResumeNoticeCard({ notice }: { notice: ConversationResumeNotice }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const restored = notice.status === 'canvas_restored';
  const toneClass = restored
    ? isLight ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900' : 'border-emerald-500/15 bg-emerald-500/5 text-emerald-200'
    : isLight ? 'border-amber-200 bg-amber-50/90 text-amber-900' : 'border-amber-500/20 bg-amber-500/10 text-amber-200';
  const detailItems = [
    t('conversationHistory.messages', { count: notice.messageCount }),
    notice.currentDiagramVersionId ? t('memory.diagramVersion', { id: notice.currentDiagramVersionId.slice(0, 8) }) : '',
  ].filter(Boolean);

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {restored
            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            : <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          }
          <span className="truncate text-[11px] font-semibold">
            {restored ? t('conversationHistory.canvasRestoredTitle') : t('conversationHistory.canvasMissingTitle')}
          </span>
        </div>
        <span className="shrink-0 text-[10px] opacity-75">
          {restored ? t('conversationHistory.canvasAvailable') : t('conversationHistory.canvasUnavailable')}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[10px] opacity-80">
        {restored
          ? t('conversationHistory.canvasRestoredDetail', { title: notice.conversationTitle })
          : t('conversationHistory.canvasMissingDetail', { title: notice.conversationTitle })
        }
      </p>
      {detailItems.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {detailItems.map((detail) => (
            <span key={detail} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isLight ? 'bg-white/80' : 'bg-white/10'}`}>
              {detail}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlannerPlanCard({ plan }: { plan: PlannerPlanSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const steps = plan.subtasks
    .map((item) => String(item.label || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (steps.length === 0) return null;

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      isLight ? 'border-sky-200 bg-sky-50/80 text-sky-900' : 'border-sky-500/15 bg-sky-500/5 text-sky-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('agentCard.plan')}</span>
        </div>
        <span className={`shrink-0 text-[10px] ${isLight ? 'text-sky-700' : 'text-sky-300/70'}`}>
          {plan.mode || plan.status}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {steps.map((step, index) => (
          <div key={`${step}-${index}`} className={`truncate text-[10px] ${isLight ? 'text-sky-800' : 'text-sky-200/80'}`}>
            {index + 1}. {step}
          </div>
        ))}
      </div>
    </div>
  );
}

function DesignAgentCard({ summary }: { summary: DesignAgentSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const rules = summary.appliedRules.slice(0, 3);

  if (!summary.changed && rules.length === 0) return null;

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      isLight ? 'border-teal-200 bg-teal-50/80 text-teal-900' : 'border-teal-500/15 bg-teal-500/5 text-teal-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('agentCard.design')}</span>
        </div>
        <span className={`shrink-0 text-[10px] ${isLight ? 'text-teal-700' : 'text-teal-300/70'}`}>
          {summary.changed ? t('agentCard.optimized') : summary.status}
        </span>
      </div>
      {rules.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rules.map((rule) => (
            <span
              key={rule}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isLight ? 'bg-white text-teal-700' : 'bg-teal-500/10 text-teal-200'
              }`}
            >
              {rule.replace(/^[^.]+\./, '')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RepairAgentCard({ summary }: { summary: RepairAgentSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const rules = summary.appliedRules.slice(0, 3);

  if (!summary.repaired && summary.validationOk) return null;

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      summary.repaired
        ? isLight ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900' : 'border-emerald-500/15 bg-emerald-500/5 text-emerald-200'
        : isLight ? 'border-rose-200 bg-rose-50/80 text-rose-900' : 'border-rose-500/15 bg-rose-500/5 text-rose-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {summary.repaired
            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            : <X className="h-3.5 w-3.5 shrink-0" />
          }
          <span className="truncate text-[11px] font-semibold">{t('agentCard.repair')}</span>
        </div>
        <span className="shrink-0 text-[10px] opacity-75">
          {summary.repaired ? t('agentCard.repaired') : summary.status}
        </span>
      </div>
      {rules.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rules.map((rule) => (
            <span
              key={rule}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isLight ? 'bg-white/80' : 'bg-white/10'
              }`}
            >
              {rule.replace(/^[^.]+\./, '')}
            </span>
          ))}
        </div>
      ) : summary.errors.length > 0 ? (
        <p className="mt-1.5 truncate text-[10px] opacity-80">{summary.errors[0]}</p>
      ) : null}
    </div>
  );
}

function ConsistencyAgentCard({ summary }: { summary: ConsistencyAgentSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const issues = [
    ...summary.missingRequiredTerms.map((term) => t('consistency.missingTerm', { term })),
    ...summary.forbiddenTermsPresent.map((term) => t('consistency.forbiddenTerm', { term })),
  ].slice(0, 3);

  if (summary.ok && summary.checkedChunks === 0) return null;

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      summary.ok
        ? isLight ? 'border-indigo-200 bg-indigo-50/80 text-indigo-900' : 'border-indigo-500/15 bg-indigo-500/5 text-indigo-200'
        : isLight ? 'border-amber-200 bg-amber-50/90 text-amber-900' : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {summary.ok
            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            : <Brain className="h-3.5 w-3.5 shrink-0" />
          }
          <span className="truncate text-[11px] font-semibold">{t('agentCard.consistency')}</span>
        </div>
        <span className="shrink-0 text-[10px] opacity-75">
          {summary.needsUserInput ? t('agentCard.needsConfirm') : summary.status}
        </span>
      </div>
      {issues.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {issues.map((issue) => (
            <span key={issue} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isLight ? 'bg-white/80' : 'bg-white/10'}`}>
              {issue}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 truncate text-[10px] opacity-80">
          {t('consistency.checkedConstraints', { count: summary.checkedChunks })}
        </p>
      )}
    </div>
  );
}

function HumanApprovalCard({ approval }: { approval: HumanApprovalSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const [status, setStatus] = useState(approval.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isLight = canvasMode === 'light';

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/approvals/${approval.approvalId}/decision`, {
        method: 'POST',
        headers: enterpriseHeaders(),
        body: JSON.stringify({
          ...enterpriseBodyContext(),
          decision,
          comment: 'frontend_human_decision',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setStatus(String(payload.status || decision));
    } catch (err) {
      console.error('[Approval] decision failed:', err);
      setError(t('approval.failed', { message: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      isLight ? 'border-amber-200 bg-amber-50/90 text-amber-900' : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-[11px] font-semibold">{t('approval.title')}</span>
        </div>
        <span className="shrink-0 text-[10px] opacity-75">{status}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[10px] opacity-80">{approval.reason}</p>
      {error && <p className="mt-1.5 text-[10px] text-rose-500">{error}</p>}
      {status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide('approved')}
            className={`rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${
              isLight ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
            }`}
          >
            {t('approval.approve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide('rejected')}
            className={`rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${
              isLight ? 'bg-white text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100' : 'bg-white/10 text-amber-100 hover:bg-white/15'
            }`}
          >
            {t('approval.reject')}
          </button>
        </div>
      )}
    </div>
  );
}

function KnowledgeContextCard({ context }: { context: KnowledgeContextSummary }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isRetrieved = ['retrieved', 'retrieved_with_template', 'template_selected', 'history_selected'].includes(context.status);
  const isUnavailable = context.status === 'unavailable';
  const selectedTemplate = context.selectedTemplate;
  const historicalDiagrams = context.historicalDiagrams || [];
  const toneClass = isRetrieved
    ? canvasMode === 'light'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-emerald-500/15 bg-emerald-500/5 text-emerald-300'
    : isUnavailable
      ? canvasMode === 'light'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-rose-500/15 bg-rose-500/5 text-rose-300'
      : canvasMode === 'light'
        ? 'border-slate-200 bg-slate-50 text-slate-700'
        : 'border-slate-700/60 bg-slate-800/40 text-slate-300';
  const label = isRetrieved
    ? selectedTemplate
      ? t('knowledge.templateApplied', { name: selectedTemplate.name })
      : historicalDiagrams.length > 0
        ? t('knowledge.historyReferenced', { count: historicalDiagrams.length })
        : t('knowledge.citations', { count: context.count })
    : isUnavailable
      ? t('knowledge.unavailable')
      : t('knowledge.empty');
  const citationText = context.citations
    .slice(0, 3)
    .map((citation) => {
      const source = String(citation.source_id || 'unknown-source');
      const locator = String(citation.source_locator || '');
      return locator ? `${source} · ${locator}` : source;
    })
    .join(' / ');

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 text-[11px] ${toneClass}`}>
      <div className="flex items-center gap-2 font-medium">
        <Database className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      {citationText && (
        <div className={`mt-1 truncate ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
          {citationText}
        </div>
      )}
      {selectedTemplate && (
        <div className={`mt-1 truncate ${canvasMode === 'light' ? 'text-emerald-700/80' : 'text-emerald-300/70'}`}>
          {selectedTemplate.engineType || 'template'} · score {Number(selectedTemplate.matchScore || 0).toFixed(1)}
        </div>
      )}
      {historicalDiagrams.length > 0 && (
        <div className={`mt-1 truncate ${canvasMode === 'light' ? 'text-emerald-700/80' : 'text-emerald-300/70'}`}>
          {historicalDiagrams.slice(0, 2).map((item) => item.title || item.diagramId).join(' / ')}
        </div>
      )}
    </div>
  );
}

type AgentDetailCardItem = {
  key: string;
  label: string;
  node: ReactNode;
};

function AgentDetailsDisclosure({ message }: { message: Message }) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const isLight = canvasMode === 'light';
  const hasPlannerPlan = Boolean(message.plannerPlan?.subtasks.some((item) => String(item.label || '').trim()));
  const hasDesignAgent = Boolean(message.designAgent && (message.designAgent.changed || message.designAgent.appliedRules.length > 0));
  const hasRepairAgent = Boolean(message.repairAgent && (message.repairAgent.repaired || !message.repairAgent.validationOk));
  const hasConsistencyAgent = Boolean(message.consistencyAgent && (!message.consistencyAgent.ok || message.consistencyAgent.checkedChunks > 0));
  const hasExportPlan = Boolean(message.exportPlan?.allowedFormats.some((item) => String(item.format || '').trim()));
  const detailCardCandidates: Array<AgentDetailCardItem | null> = [
    message.executionPlan && message.executionPlan.length > 0
      ? { key: 'execution', label: t('agentCard.execution'), node: <ExecutionPlanCard steps={message.executionPlan} /> }
      : null,
    message.conversationMemory
      ? { key: 'conversation-memory', label: t('memory.conversation.title'), node: <ConversationMemoryCard memory={message.conversationMemory} /> }
      : null,
    message.longTermPreferences
      ? { key: 'preferences', label: t('memory.preferences.title'), node: <LongTermPreferencesCard preferences={message.longTermPreferences} /> }
      : null,
    message.resumeNotice
      ? { key: 'resume-notice', label: t('settings.nav.session'), node: <ConversationResumeNoticeCard notice={message.resumeNotice} /> }
      : null,
    message.plannerPlan && hasPlannerPlan
      ? { key: 'planner', label: t('agentCard.plan'), node: <PlannerPlanCard plan={message.plannerPlan} /> }
      : null,
    message.knowledgeContext
      ? { key: 'knowledge', label: t('knowledge.citations', { count: message.knowledgeContext.count }), node: <KnowledgeContextCard context={message.knowledgeContext} /> }
      : null,
    message.designAgent && hasDesignAgent
      ? { key: 'design', label: t('agentCard.design'), node: <DesignAgentCard summary={message.designAgent} /> }
      : null,
    message.repairAgent && hasRepairAgent
      ? { key: 'repair', label: t('agentCard.repair'), node: <RepairAgentCard summary={message.repairAgent} /> }
      : null,
    message.consistencyAgent && hasConsistencyAgent
      ? { key: 'consistency', label: t('agentCard.consistency'), node: <ConsistencyAgentCard summary={message.consistencyAgent} /> }
      : null,
    message.exportPlan && hasExportPlan
      ? { key: 'export', label: t('agentCard.export'), node: <ExportPlanCard plan={message.exportPlan} /> }
      : null,
  ];
  const detailCards = detailCardCandidates.filter((item): item is AgentDetailCardItem => Boolean(item));

  if (detailCards.length === 0) return null;

  const preview = detailCards.slice(0, 3).map((item) => item.label).join(' / ');

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[11px] transition-colors ${
          isLight
            ? 'border-slate-200 bg-white/80 text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
            : 'border-slate-700/70 bg-slate-900/50 text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/10'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Activity className={`h-3.5 w-3.5 shrink-0 ${isLight ? 'text-blue-600' : 'text-blue-300'}`} />
          <span className="shrink-0 font-semibold">{t('agentCard.details')}</span>
          {!open && (
            <span className={`hidden min-w-0 truncate sm:inline ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
              {preview}
            </span>
          )}
        </span>
        <span className={`flex shrink-0 items-center gap-1.5 ${isLight ? 'text-blue-600' : 'text-blue-300'}`}>
          <span>{open ? t('agentCard.detailsHide') : t('agentCard.detailsHidden', { count: detailCards.length })}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          {detailCards.map((item) => (
            <div key={item.key}>{item.node}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagramTypeSwitchButton({
  message,
  open,
  busy,
  disabled,
  onToggle,
  onClose,
  onSelect,
}: {
  message: Message;
  open: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (agent: DiagramAgentMeta) => void;
}) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 360 });
  const isLight = canvasMode === 'light';

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 256;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
    const belowTop = rect.bottom + 8;
    const belowSpace = viewportHeight - belowTop - 8;
    const desiredHeight = Math.min(420, viewportHeight - 16);
    const openAbove = belowSpace < 260 && rect.top > belowSpace;
    const top = openAbove ? Math.max(8, rect.top - desiredHeight - 8) : belowTop;
    const maxHeight = Math.max(180, Math.min(desiredHeight, viewportHeight - top - 8));
    setPosition({ left, top, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const handleLayoutChange = () => updatePosition();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleLayoutChange);
    window.addEventListener('scroll', handleLayoutChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleLayoutChange);
      window.removeEventListener('scroll', handleLayoutChange, true);
    };
  }, [open, onClose, updatePosition]);

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className={`fixed w-64 overflow-y-auto rounded-xl border p-1.5 shadow-2xl ${
            isLight
              ? 'border-slate-200 bg-white text-slate-900 shadow-slate-900/20'
              : 'border-slate-700 bg-slate-950 text-slate-100 shadow-black/50'
          }`}
          style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, zIndex: 10000 }}
        >
          <div className={`px-2 py-1.5 text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            {t('version.changeTypeMenu')}
          </div>
          {VISIBLE_DIAGRAM_AGENTS
            .filter((agent) => agent.id !== message.engineType)
            .map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelect(agent)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                  isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                }`}
              >
                <agent.Icon className="h-4 w-4 shrink-0" style={{ color: agent.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{agent.label}</span>
                  <span className={`block truncate text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    {agent.engineLabel}
                  </span>
                </span>
              </button>
            ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={busy || disabled}
        onClick={onToggle}
        className={`text-[11px] inline-flex items-center gap-1 rounded-md px-2 py-1 border transition-colors disabled:opacity-50 ${
          isLight
            ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'border-blue-500/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20'
        }`}
        title={t('version.changeTypeTitle')}
      >
        <RefreshCw className="w-3 h-3" />
        {t('version.changeType')}
        <ChevronDown className="w-3 h-3" />
      </button>
      {menu}
    </>
  );
}

function DiagramHistoryPanel({
  open,
  mode,
  items,
  conversationItems,
  query,
  loading,
  error,
  onClose,
  onModeChange,
  onQueryChange,
  onSearch,
  onRefresh,
  onUse,
  onBranch,
  onResumeConversation,
}: {
  open: boolean;
  mode: HistoryMode;
  items: DiagramHistoryItem[];
  conversationItems: ConversationHistoryItem[];
  query: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onModeChange: (mode: HistoryMode) => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
  onUse: (item: DiagramHistoryItem) => void;
  onBranch: (item: DiagramHistoryItem) => void;
  onResumeConversation: (item: ConversationHistoryItem) => void;
}) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  if (!open) return null;
  const isLight = canvasMode === 'light';
  const activeCount = mode === 'diagrams' ? items.length : conversationItems.length;
  const isDiagramMode = mode === 'diagrams';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div
        className={`h-full w-full max-w-[420px] border-l shadow-2xl ${
          isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-slate-700 bg-slate-950 text-slate-100'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-4 py-3 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
          <div className="flex min-w-0 items-center gap-2">
            <History className={`h-4 w-4 shrink-0 ${isLight ? 'text-slate-600' : 'text-slate-300'}`} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{isDiagramMode ? t('history.title') : t('conversationHistory.title')}</div>
              <div className={`truncate text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('history.count', { count: activeCount })}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-2 transition-colors ${
              isLight ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-100'
            }`}
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={`border-b p-3 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
          <div className={`mb-2 grid grid-cols-2 gap-1 rounded-lg border p-1 ${
            isLight ? 'border-slate-200 bg-slate-100' : 'border-slate-800 bg-slate-900'
          }`}>
            {[
              { value: 'diagrams' as const, label: t('history.diagramsTab') },
              { value: 'conversations' as const, label: t('history.conversationsTab') },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onModeChange(item.value)}
                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  mode === item.value
                    ? isLight ? 'bg-white text-slate-900 shadow-sm' : 'bg-slate-800 text-slate-100'
                    : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
            isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900'
          }`}>
            <Search className={`h-3.5 w-3.5 shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-500'}`} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearch();
              }}
              className={`min-w-0 flex-1 bg-transparent text-[12px] outline-none ${
                isLight ? 'placeholder:text-slate-400' : 'placeholder:text-slate-600'
              }`}
              placeholder={isDiagramMode ? t('history.placeholder') : t('conversationHistory.placeholder')}
            />
            <button
              type="button"
              onClick={onSearch}
              disabled={loading}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                isLight ? 'bg-slate-900 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-900 hover:bg-white'
              }`}
            >
              {t('common.search')}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className={`rounded-md p-1.5 transition-colors disabled:opacity-50 ${
                isLight ? 'text-slate-500 hover:bg-slate-200' : 'text-slate-400 hover:bg-slate-800'
              }`}
              title={t('common.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {error && <div className="mt-2 text-[11px] text-rose-500">{error}</div>}
        </div>

        <div className="h-[calc(100%-154px)] overflow-y-auto p-3">
          {loading && activeCount === 0 ? (
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-[12px] ${
              isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800 text-slate-400'
            }`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('common.loading')}
            </div>
          ) : activeCount === 0 ? (
            <div className={`rounded-lg border px-3 py-6 text-center text-[12px] ${
              isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800 text-slate-400'
            }`}>
              {isDiagramMode ? t('history.empty') : t('conversationHistory.empty')}
            </div>
          ) : isDiagramMode ? (
            <div className="space-y-2">
              {items.map((item) => {
                const version = item.current_version;
                const summary = item.conversation?.summary || version?.design_concept || version?.code_preview || '';
                const process = version?.agent_process;
                const processSteps = Array.isArray(process?.steps) ? process.steps : [];
                const processSeconds = Number(process?.duration_seconds ?? ((process?.duration_ms || 0) / 1000));
                const totalTokens = Number(process?.token_usage?.estimated_total_tokens || 0);
                const canUse = Boolean(version?.code);
                const canBranch = Boolean(version?.diagram_version_id);
                return (
                  <div
                    key={`${item.diagram_id}-${version?.diagram_version_id || item.current_version_id || 'current'}`}
                    className={`rounded-lg border px-3 py-2.5 ${
                      isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`truncate text-[12px] font-semibold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                          {item.title || t('history.untitled')}
                        </div>
                        <div className={`mt-1 flex flex-wrap items-center gap-1.5 text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                          <span>{item.engine_type || version?.engine_type || 'diagram'}</span>
                          <span>V{version?.version_number || '-'}</span>
                          {version?.code_hash && <span>{version.code_hash}</span>}
                        </div>
                        {process && (
                          <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] ${
                            isLight ? 'text-blue-700' : 'text-blue-300'
                          }`}>
                            <Brain className="h-3 w-3" />
                            <span>{t('history.agentProcess')}</span>
                            <span>{t('history.agentProcessSummary', {
                              steps: process.step_count || processSteps.length,
                              duration: formatSeconds(processSeconds),
                            })}</span>
                            {totalTokens > 0 && (
                              <span className={isLight ? 'text-slate-500' : 'text-slate-500'}>
                                {t('history.agentProcessTokens', { tokens: totalTokens })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={!canUse}
                          onClick={() => onUse(item)}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isLight
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'bg-blue-500/20 text-blue-200 hover:bg-blue-500/30'
                          }`}
                        >
                          {t('history.use')}
                        </button>
                        <button
                          type="button"
                          disabled={!canBranch}
                          onClick={() => onBranch(item)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isLight
                              ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                          title={t('history.branchTitle')}
                        >
                          {t('history.branch')}
                        </button>
                      </div>
                    </div>
                    {summary && (
                      <div className={`mt-2 line-clamp-2 text-[11px] leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                        {summary}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {conversationItems.map((item) => {
                const messages = Array.isArray(item.messages) ? item.messages : [];
                const assistantProcess = [...messages]
                  .reverse()
                  .find((message) => message.role === 'assistant' && message.agent_process)?.agent_process;
                const processSteps = Array.isArray(assistantProcess?.steps) ? assistantProcess.steps : [];
                const processSeconds = Number(assistantProcess?.duration_seconds ?? ((assistantProcess?.duration_ms || 0) / 1000));
                const totalTokens = Number(assistantProcess?.token_usage?.estimated_total_tokens || 0);
                const memory = item.context?.short_term_memory || {};
                const previewMessages = messages.slice(-3);
                const hasCanvasSnapshot = Boolean(item.current_diagram?.code && item.current_diagram?.diagram_version_id);
                return (
                  <div
                    key={item.conversation_id}
                    className={`rounded-lg border px-3 py-2.5 ${
                      isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`truncate text-[12px] font-semibold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                          {item.title || t('conversationHistory.untitled')}
                        </div>
                        <div className={`mt-1 flex flex-wrap items-center gap-1.5 text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                          <span>{item.status || t('common.unknown')}</span>
                          <span>{t('conversationHistory.messages', { count: item.message_count || messages.length })}</span>
                          {memory.turn_count ? <span>{t('conversationHistory.turns', { count: memory.turn_count })}</span> : null}
                          {item.context?.last_engine_type ? <span>{item.context.last_engine_type}</span> : null}
                        </div>
                        {assistantProcess && (
                          <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] ${
                            isLight ? 'text-blue-700' : 'text-blue-300'
                          }`}>
                            <Brain className="h-3 w-3" />
                            <span>{t('history.agentProcess')}</span>
                            <span>{t('history.agentProcessSummary', {
                              steps: assistantProcess.step_count || processSteps.length,
                              duration: formatSeconds(processSeconds),
                            })}</span>
                            {totalTokens > 0 && (
                              <span className={isLight ? 'text-slate-500' : 'text-slate-500'}>
                                {t('history.agentProcessTokens', { tokens: totalTokens })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onResumeConversation(item)}
                        className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                          isLight
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-blue-500/20 text-blue-200 hover:bg-blue-500/30'
                        }`}
                      >
                        {t('conversationHistory.resume')}
                      </button>
                    </div>
                    <div className="mt-2">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${
                        hasCanvasSnapshot
                          ? isLight ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20'
                          : isLight ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20'
                      }`}>
                        {hasCanvasSnapshot
                          ? <CheckCircle2 className="h-3 w-3" />
                          : <AlertCircle className="h-3 w-3" />
                        }
                        {hasCanvasSnapshot ? t('conversationHistory.canvasAvailable') : t('conversationHistory.canvasUnavailable')}
                      </span>
                    </div>
                    {(item.summary || memory.last_user_message) && (
                      <div className={`mt-2 line-clamp-2 text-[11px] leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                        {item.summary || memory.last_user_message}
                      </div>
                    )}
                    {previewMessages.length > 0 && (
                      <div className={`mt-2 space-y-1 rounded-md border px-2 py-2 ${
                        isLight ? 'border-slate-200 bg-white/70' : 'border-slate-800 bg-slate-950/40'
                      }`}>
                        {previewMessages.map((message) => (
                          <div key={message.id} className={`flex gap-1.5 text-[10px] leading-relaxed ${
                            isLight ? 'text-slate-600' : 'text-slate-400'
                          }`}>
                            <span className={`shrink-0 font-semibold ${
                              message.role === 'assistant'
                                ? isLight ? 'text-blue-700' : 'text-blue-300'
                                : isLight ? 'text-slate-700' : 'text-slate-300'
                            }`}>
                              {message.role === 'assistant' ? t('conversationHistory.assistant') : t('conversationHistory.user')}
                            </span>
                            <span className="line-clamp-1 min-w-0">{message.content || t('common.empty')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Copy Button ── */
function CopyButton({ text }: { text: string }) {
  const { t } = useT();
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
      title={t('common.copy')}>
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/* ── Markdown renderer for assistant messages ── */
function AssistantContent({ content, canvasMode }: { content: string; canvasMode: 'dark' | 'light' }) {
  return (
    <div className={`prose prose-sm max-w-none text-[13px] leading-relaxed
                    ${canvasMode === 'light' 
                      ? 'prose-slate text-slate-800 prose-headings:text-slate-900 prose-strong:text-slate-900 prose-code:text-indigo-600 prose-code:bg-slate-100 prose-pre:bg-slate-50 prose-pre:border-slate-200' 
                      : 'prose-invert text-slate-200 prose-headings:text-slate-100 prose-strong:text-slate-100 prose-code:text-blue-300 prose-code:bg-slate-700/50 prose-pre:bg-slate-800 prose-pre:border-slate-700/50'
                    }
                    prose-p:my-1 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
                    prose-pre:border prose-pre:rounded-lg
                    prose-a:text-blue-500 hover:prose-a:underline
                    prose-ul:my-1 prose-ol:my-1 prose-li:my-0
                    prose-table:text-xs`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ── Live Timer — ticks every 100ms while streaming ── */
function LiveTimer({ startTime }: { startTime: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startTime) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [startTime]);
  if (!startTime) return null;
  const elapsed = Math.max(0, now - startTime);
  const secs = (elapsed / 1000).toFixed(1);
  return <span className="text-[10px] text-slate-400 tabular-nums font-mono">{secs}s</span>;
}




/* ── Main ChatPanel ── */
interface ChatPanelProps {
  authSession: AuthSession | null;
  onLogout: () => void;
  onLogin: (session: AuthSession) => void;
}

export default function ChatPanel({ authSession, onLogout, onLogin }: ChatPanelProps) {
  const location = useLocation();
  const {
    messages, addMessage, updateLastAssistantMessage, clearMessages,
    conversationId, setConversationId,
    isStreaming, setIsStreaming,
    streamStartTime, setStreamStartTime,
    setCurrentTask, setCurrentEngine, setCanvasCode, setCanvasTask, setCanvasEngine,
    canvasCode, canvasTask, canvasEngine,
    canvasDiagramId, setCanvasDiagramId,
    canvasDiagramVersionId, setCanvasDiagramVersionId,
    requestCanvasRenderRetry,
    setDesignConcept, modelConfig,
    setSelectedNode,
    addPendingElement, clearPendingElements,
    inputImages, addInputImage, removeInputImage, clearInputImages,
    setCanvasPhase,
    setStreamingCode,
    detailLevel, setDetailLevel,
    canvasMode,
    setMobileActivePanel,
  } = useChatStore();
  const { t } = useT();
  const isMobile = useIsMobile();

  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<DiagramAgentMeta | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showLengthPicker, setShowLengthPicker] = useState(false);
  const [versionActionBusy, setVersionActionBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState<HistoryMode>('diagrams');
  const [historyItems, setHistoryItems] = useState<DiagramHistoryItem[]>([]);
  const [conversationHistoryItems, setConversationHistoryItems] = useState<ConversationHistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [branchDialog, setBranchDialog] = useState<BranchDialogState | null>(null);
  const [rollbackDialog, setRollbackDialog] = useState<Message | null>(null);
  const [typeSwitchMessageId, setTypeSwitchMessageId] = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<{ title: string; message: string } | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [guestQuota, setGuestQuota] = useState<GuestQuotaStatus>({
    total: 5,
    used: 0,
    remaining: 5,
    exhausted: false,
  });
  const isGuest = !authSession;
  const guestExhausted = isGuest && guestQuota.exhausted;

  useEffect(() => {
    if (!isGuest) return;
    void getGuestQuota().then(setGuestQuota).catch(() => undefined);
  }, [isGuest]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const diagramShellHandlersRef = useRef<Record<DiagramShellCommand, () => void> | null>(null);

  // Mobile countdown timer for auto-switch to canvas
  const [mobileCountdown, setMobileCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startMobileCountdown = useCallback(() => {
    if (!isMobile) return;
    // Clear any existing countdown
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    setMobileCountdown(3);
    let remaining = 3;
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setMobileCountdown(null);
        setMobileActivePanel('canvas');
      } else {
        setMobileCountdown(remaining);
      }
    }, 1000);
  }, [isMobile, setMobileActivePanel]);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  const switchToCanvas = useCallback(() => {
    if (isMobile) {
      // Cancel countdown if user manually taps
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setMobileCountdown(null);
      }
      setMobileActivePanel('canvas');
    }
  }, [isMobile, setMobileActivePanel]);

  const diagramActionHeaders = () => enterpriseHeaders();

  const showError = (message: string) => {
    setNoticeDialog({ title: t('common.error'), message });
  };

  const activateVersionPayload = (payload: VersionActionPayload) => {
    clearPendingElements();
    if (payload.code) setCanvasCode(payload.code);
    if (payload.task_type) setCanvasTask(payload.task_type);
    if (payload.engine_type) setCanvasEngine(payload.engine_type);
    setCanvasDiagramId(payload.diagram_id);
    setCanvasDiagramVersionId(payload.diagram_version_id);
    if (payload.design_concept) setDesignConcept(payload.design_concept);
  };

  const loadDiagramHistory = useCallback(async (searchText: string) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setHistoryItems(await listDiagramHistory(searchText));
    } catch (err) {
      console.error('[History] Load failed:', err);
      setHistoryError((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadConversationHistory = useCallback(async (searchText: string) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setConversationHistoryItems(await listConversationHistory(searchText));
    } catch (err) {
      console.error('[ConversationHistory] Load failed:', err);
      setHistoryError((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadCurrentHistory = (searchText = historyQuery, mode = historyMode) => {
    if (mode === 'conversations') {
      void loadConversationHistory(searchText);
    } else {
      void loadDiagramHistory(searchText);
    }
  };

  const changeHistoryMode = (mode: HistoryMode) => {
    setHistoryMode(mode);
    setHistoryError('');
    loadCurrentHistory(historyQuery, mode);
  };

  const openDiagramHistory = () => {
    setHistoryOpen(true);
    loadCurrentHistory(historyQuery);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const query = params.get('history')?.trim();
    if (!query) return;
    const mode: HistoryMode = params.get('historyMode') === 'conversations'
      ? 'conversations'
      : 'diagrams';
    const timer = window.setTimeout(() => {
      setHistoryQuery(query);
      setHistoryMode(mode);
      setHistoryOpen(true);
      if (mode === 'conversations') void loadConversationHistory(query);
      else void loadDiagramHistory(query);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.search, loadConversationHistory, loadDiagramHistory]);

  const startNewConversation = () => {
    if (isStreaming) return;
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    clearMessages();
    clearPendingElements();
    clearInputImages();
    setInput('');
    setSelectedAgent(null);
    setShowAgentPicker(false);
    setShowLengthPicker(false);
    setHistoryOpen(false);
    setHistoryQuery('');
    setHistoryError('');
    setBranchDialog(null);
    setRollbackDialog(null);
    setTypeSwitchMessageId(null);
    setSelectedNode(null);
    setCurrentTask(null);
    setCurrentEngine(null);
    setStreamStartTime(null);
    setIsStreaming(false);
    setCanvasCode('');
    setCanvasTask(null);
    setCanvasEngine(null);
    setCanvasDiagramId(null);
    setCanvasDiagramVersionId(null);
    setDesignConcept('');
    setCanvasPhase('idle');
    setStreamingCode('');
  };

  useEffect(() => {
    diagramShellHandlersRef.current = {
      'new-conversation': startNewConversation,
      'open-history': openDiagramHistory,
      'focus-chat': () => {
        setMobileActivePanel('chat');
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      },
      'focus-canvas': () => {
        setMobileActivePanel('canvas');
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[data-shell-region="canvas"]')?.focus();
        });
      },
    };
  });

  useEffect(() => {
    const handleDiagramShellCommand = (event: Event) => {
      const command = (event as CustomEvent<DiagramShellEventDetail>).detail?.command;
      if (command) diagramShellHandlersRef.current?.[command]?.();
    };
    window.addEventListener(DIAGRAM_SHELL_EVENT, handleDiagramShellCommand);
    return () => window.removeEventListener(DIAGRAM_SHELL_EVENT, handleDiagramShellCommand);
  }, []);

  const useHistoricalDiagram = (item: DiagramHistoryItem) => {
    const version = item.current_version;
    if (!version?.code || !version.diagram_version_id) return;
    const engine = (version.engine_type || item.engine_type || 'general') as DiagramEngineType;
    const task = (version.task_type || item.task_type || getTaskByEngine(engine) || 'general') as DiagramTaskType;
    const restoredSteps = historyProcessToThinkingSteps(version.agent_process);
    const processSeconds = Number(version.agent_process?.duration_seconds ?? ((version.agent_process?.duration_ms || 0) / 1000));
    const assistantContent = version.agent_process?.assistant_content?.trim();
    clearPendingElements();
    setCanvasCode(version.code);
    setCanvasTask(task);
    setCanvasEngine(engine);
    setCanvasDiagramId(item.diagram_id);
    setCanvasDiagramVersionId(version.diagram_version_id);
    setDesignConcept(version.design_concept || '');
    setCanvasPhase('done');
    setStreamingCode('');
    setHistoryOpen(false);
    addMessage({
      id: `a_history_${Date.now()}`,
      role: 'assistant',
      content: assistantContent || t('history.loaded', { title: item.title || item.diagram_id }),
      code: version.code,
      engineType: engine,
      taskType: task,
      designConcept: version.design_concept,
      diagramId: item.diagram_id,
      diagramVersionId: version.diagram_version_id,
      steps: restoredSteps.length > 0 ? restoredSteps : undefined,
      statusText: restoredSteps.length > 0
        ? t('history.agentProcessSummary', { steps: restoredSteps.length, duration: formatSeconds(processSeconds) })
        : undefined,
      timestamp: Date.now(),
    });
  };

  const createHistoryBranch = async (item: DiagramHistoryItem, branchName: string) => {
    const version = item.current_version;
    if (!version?.diagram_version_id) return;
    setVersionActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/diagrams/${item.diagram_id}/versions/${version.diagram_version_id}/branch`, {
        method: 'POST',
        headers: diagramActionHeaders(),
        body: JSON.stringify({
          ...enterpriseBodyContext(),
          branch_name: branchName,
          reason: 'frontend_history_branch',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json() as VersionActionPayload;
      activateVersionPayload(payload);
      setHistoryOpen(false);
      addMessage({
        id: `a_history_branch_${Date.now()}`,
        role: 'assistant',
        content: t('history.branchCreated', { name: branchName }),
        code: payload.code,
        engineType: payload.engine_type,
        taskType: payload.task_type,
        designConcept: payload.design_concept,
        diagramId: payload.diagram_id,
        diagramVersionId: payload.diagram_version_id,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[History] Branch failed:', err);
      showError(t('history.branchFailed', { message: (err as Error).message }));
    } finally {
      setVersionActionBusy(false);
    }
  };

  const branchHistoricalDiagram = (item: DiagramHistoryItem) => {
    const version = item.current_version;
    if (!version?.diagram_version_id) return;
    setBranchDialog({
      kind: 'history',
      item,
      initialValue: t('dialog.branch.historyDefault', { title: item.title || t('history.untitled') }),
    });
  };

  const resumeConversationHistory = (item: ConversationHistoryItem) => {
    const historyMessages = Array.isArray(item.messages) ? item.messages : [];
    const currentDiagram = item.current_diagram || null;
    const conversationTitle = item.title || item.conversation_id;
    const canvasSnapshotCode = currentDiagram?.code || '';
    const canvasSnapshotVersionId = currentDiagram?.diagram_version_id || '';
    const hasCanvasSnapshot = Boolean(canvasSnapshotCode && canvasSnapshotVersionId);
    const diagramEngine = currentDiagram?.engine_type as DiagramEngineType | undefined;
    const diagramTask = currentDiagram?.task_type as DiagramTaskType | undefined;
    clearMessages();
    setConversationId(item.conversation_id);
    setCanvasDiagramVersionId(currentDiagram?.diagram_version_id || item.current_diagram_version_id || null);
    if (hasCanvasSnapshot && currentDiagram) {
      clearPendingElements();
      setCanvasCode(canvasSnapshotCode);
      if (diagramEngine) setCanvasEngine(diagramEngine);
      if (diagramTask) setCanvasTask(diagramTask);
      setCanvasDiagramId(currentDiagram.diagram_id || null);
      setCanvasDiagramVersionId(canvasSnapshotVersionId);
      setDesignConcept(currentDiagram.design_concept || '');
      setCanvasPhase('done');
      setStreamingCode('');
    } else {
      clearPendingElements();
      setCanvasCode('');
      setCanvasDiagramId(null);
      setDesignConcept('');
      setCanvasPhase('idle');
      setStreamingCode('');
    }
    const lastEngine = item.context?.last_engine_type as DiagramEngineType | undefined;
    const lastTask = item.context?.last_task_type as DiagramTaskType | undefined;
    const activeEngine = diagramEngine || lastEngine;
    const activeTask = diagramTask || lastTask;
    if (activeEngine) {
      setCurrentEngine(activeEngine);
      if (!currentDiagram?.code) setCanvasEngine(activeEngine);
    }
    if (activeTask) {
      setCurrentTask(activeTask);
      if (!currentDiagram?.code) setCanvasTask(activeTask);
    }
    let attachedCurrentDiagram = false;
    historyMessages.forEach((message, index) => {
      const restoredSteps = message.role === 'assistant'
        ? historyProcessToThinkingSteps(message.agent_process)
        : [];
      const processSeconds = Number(message.agent_process?.duration_seconds ?? ((message.agent_process?.duration_ms || 0) / 1000));
      const isCurrentDiagramMessage = Boolean(
        currentDiagram?.code
        && canvasSnapshotVersionId
        && message.diagram_version_id === canvasSnapshotVersionId
        && message.role === 'assistant'
      );
      if (isCurrentDiagramMessage) attachedCurrentDiagram = true;
      // Use per-message diagram snapshot from backend (code, diagram_id, design_concept)
      // so every historical diagram version can be restored, not just the last one
      const msgCode = isCurrentDiagramMessage
        ? currentDiagram?.code
        : (message.code || undefined);
      const msgDesignConcept = isCurrentDiagramMessage
        ? currentDiagram?.design_concept
        : (message.design_concept || undefined);
      const msgDiagramId = isCurrentDiagramMessage
        ? currentDiagram?.diagram_id
        : (message.diagram_id || undefined);
      addMessage({
        id: message.id || `history_message_${Date.now()}_${index}`,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content || '',
        engineType: (isCurrentDiagramMessage ? diagramEngine : message.engine_type as DiagramEngineType | undefined),
        taskType: (isCurrentDiagramMessage ? diagramTask : message.task_type as DiagramTaskType | undefined),
        diagramVersionId: message.diagram_version_id,
        code: msgCode,
        designConcept: msgDesignConcept,
        diagramId: msgDiagramId,
        steps: restoredSteps.length > 0 ? restoredSteps : undefined,
        statusText: restoredSteps.length > 0
          ? t('history.agentProcessSummary', { steps: restoredSteps.length, duration: formatSeconds(processSeconds) })
          : undefined,
        timestamp: message.created_at ? new Date(message.created_at).getTime() || Date.now() : Date.now(),
      });
    });
    if (hasCanvasSnapshot && currentDiagram && !attachedCurrentDiagram) {
      addMessage({
        id: `a_conversation_canvas_resume_${Date.now()}`,
        role: 'assistant',
        content: t('conversationHistory.canvasRestored', { title: conversationTitle }),
        code: canvasSnapshotCode,
        engineType: diagramEngine,
        taskType: diagramTask,
        designConcept: currentDiagram.design_concept,
        diagramId: currentDiagram.diagram_id,
        diagramVersionId: canvasSnapshotVersionId,
        resumeNotice: {
          status: 'canvas_restored',
          conversationTitle,
          messageCount: item.message_count || historyMessages.length,
          currentDiagramVersionId: canvasSnapshotVersionId,
        },
        timestamp: Date.now(),
      });
    } else if (!hasCanvasSnapshot) {
      addMessage({
        id: `a_conversation_canvas_missing_${Date.now()}`,
        role: 'assistant',
        content: t('conversationHistory.canvasMissing', { title: conversationTitle }),
        engineType: activeEngine,
        taskType: activeTask,
        diagramVersionId: item.current_diagram_version_id,
        resumeNotice: {
          status: 'canvas_missing',
          conversationTitle,
          messageCount: item.message_count || historyMessages.length,
          currentDiagramVersionId: item.current_diagram_version_id,
          reason: currentDiagram ? 'snapshot_without_code' : 'missing_snapshot',
        },
        timestamp: Date.now(),
      });
    } else if (historyMessages.length === 0) {
      addMessage({
        id: `a_conversation_resume_${Date.now()}`,
        role: 'assistant',
        content: t('conversationHistory.resumed', { title: conversationTitle }),
        timestamp: Date.now(),
      });
    }
    setHistoryOpen(false);
  };

  const confirmBranchDialog = async (branchName: string) => {
    const dialog = branchDialog;
    if (!dialog) return;
    await createHistoryBranch(dialog.item, branchName);
    setBranchDialog(null);
  };

  const performRollback = async (msg: Message) => {
    if (!msg.diagramId || !msg.diagramVersionId) return;
    setVersionActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/diagrams/${msg.diagramId}/versions/${msg.diagramVersionId}/rollback`, {
        method: 'POST',
        headers: diagramActionHeaders(),
        body: JSON.stringify({
          ...enterpriseBodyContext(),
          reason: 'frontend_user_rollback',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json() as VersionActionPayload;
      activateVersionPayload(payload);
      addMessage({
        id: `a_rollback_${Date.now()}`,
        role: 'assistant',
        content: t('version.rollbackCreated', { version: payload.version_number ?? '' }).trim(),
        code: payload.code,
        engineType: payload.engine_type,
        taskType: payload.task_type,
        designConcept: payload.design_concept,
        diagramId: payload.diagram_id,
        diagramVersionId: payload.diagram_version_id,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[Version] Rollback failed:', err);
      showError(t('version.rollbackFailed', { message: (err as Error).message }));
    } finally {
      setVersionActionBusy(false);
    }
  };

  const handleRollback = (msg: Message) => {
    if (!msg.diagramId || !msg.diagramVersionId) return;
    setRollbackDialog(msg);
  };

  const confirmRollbackDialog = async () => {
    const msg = rollbackDialog;
    if (!msg) return;
    await performRollback(msg);
    setRollbackDialog(null);
  };

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
    const match = input.match(/^@([\w-]+)/);
    if (match) {
      const tag = match[1].toLowerCase();
      const found = VISIBLE_DIAGRAM_AGENTS.find(a => a.id === tag);
      if (found && found !== selectedAgent) {
        const timer = window.setTimeout(() => setSelectedAgent(found), 0);
        return () => window.clearTimeout(timer);
      }
    }
  }, [input, selectedAgent]);

  /* ── Send message ── */
  const sendMessage = useCallback(async (directText?: string, overrides?: SendMessageOverrides) => {
    // 确保 directText 确实为字符串类型，防范 React 事件对象被当作参数误传入
    const isDirectString = typeof directText === 'string';
    let text = (isDirectString ? directText : input).trim();
    const imagesToSend = overrides?.images ? [...overrides.images] : [...inputImages];
    if ((!text && imagesToSend.length === 0) || isStreaming) return;

    // Guest quota check — block if exhausted
    if (isGuest) {
      const quota = await getGuestQuota();
      setGuestQuota(quota);
      if (quota.exhausted) return;
      await ensureGuestSession();
    }

    // If agent is selected but no @ prefix in text, prepend it
    const agentForSend = overrides?.forcedAgent ?? selectedAgent;
    if (agentForSend && !text.startsWith('@')) {
      text = `${agentForSend.prefix}${text}`;
    }

    addMessage({ id: `u_${Date.now()}`, role: 'user', content: text, images: imagesToSend.length > 0 ? imagesToSend : undefined, timestamp: Date.now() });
    if (!isDirectString) {
      setInput('');
    }
    if (!overrides?.preserveInputImages) {
      clearInputImages();
    }
    setSelectedAgent(null);
    addMessage({ id: `a_${Date.now()}`, role: 'assistant', content: '', steps: [], timestamp: Date.now() });
    setIsStreaming(true);
    setStreamStartTime(Date.now());
    setDesignConcept('');
    clearPendingElements();
    setCanvasPhase('routing');
    setStreamingCode('');

    let currentSteps: ThinkingStep[] = [];
    let currentExecutionPlan: ExecutionPlanStep[] = [];

    const setExecutionPlan = (steps: ExecutionPlanStep[]) => {
      currentExecutionPlan = steps;
      updateLastAssistantMessage({ executionPlan: [...currentExecutionPlan] });
    };

    const applyExecutionPlanStatus = (stepId: string, action?: string, status?: string) => {
      if (currentExecutionPlan.length === 0) return;
      const nextPlan = updateExecutionPlanStepStatus(currentExecutionPlan, stepId, action, status);
      if (nextPlan !== currentExecutionPlan) {
        setExecutionPlan(nextPlan);
      }
    };

    const failExecutionPlan = (message: string) => {
      if (currentExecutionPlan.length === 0) return;
      setExecutionPlan(markExecutionPlanFailed(currentExecutionPlan, message));
    };

    // Abort previous active request if any
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    let codeBuffer = '', designBuffer = '', textBuffer = '';
    let elementCount = 0;
    const startTime = Date.now();
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
        headers: enterpriseHeaders(true),
        body: JSON.stringify({
          message: text,
          images: imagesToSend,
          history,
          current_code: overrides?.currentCode ?? canvasCode ?? '',
          current_task: overrides?.currentTask ?? canvasTask ?? '',
          current_engine: overrides?.currentEngine ?? canvasEngine ?? '',
          current_diagram_id: overrides?.currentDiagramId ?? canvasDiagramId ?? '',
          current_diagram_version_id: overrides?.currentDiagramVersionId ?? canvasDiagramVersionId ?? '',
          design_concept: overrides?.designConcept ?? '',
          conversation_id: conversationId,
          model_config: modelConfig,
          detailLevel,
        }),
        signal: controller.signal,
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
            case 'conversation': {
              if (data.conversation_id) {
                setConversationId(String(data.conversation_id));
              }
              break;
            }
            case 'status': {
              const { step_id, content, action } = data;
              applyExecutionPlanStatus(String(step_id || ''), String(action || ''));
              if (action === 'start') {
                currentSteps = currentSteps.map(s => 
                  s.status === 'running' 
                    ? { ...s, status: 'completed', duration: (Date.now() - s.startTime) / 1000 } 
                    : s
                );
                currentSteps = currentSteps.filter(s => s.id !== step_id);
                currentSteps.push({
                  id: step_id,
                  label: content || '',
                  startTime: Date.now(),
                  status: 'running'
                });
              } else if (action === 'end') {
                currentSteps = currentSteps.map(s => 
                  s.id === step_id && s.status === 'running'
                    ? { ...s, status: 'completed', duration: (Date.now() - s.startTime) / 1000 }
                    : s
                );
              }
              updateLastAssistantMessage({ 
                statusText: content || undefined, 
                steps: [...currentSteps] 
              });
              break;
            }
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
            case 'execution_plan': {
              const incomingPlan = Array.isArray(data.steps) ? parseExecutionPlanSteps(data.steps) : [];
              setExecutionPlan(mergeExecutionPlanSteps(incomingPlan, currentExecutionPlan));
              break;
            }
            case 'conversation_memory': {
              updateLastAssistantMessage({
                conversationMemory: {
                  status: String(data.status || 'empty'),
                  reason: typeof data.reason === 'string' ? data.reason : undefined,
                  summaryPresent: Boolean(data.summary_present),
                  recentCount: Number(data.recent_count || 0),
                  turnCount: data.turn_count === undefined || data.turn_count === null ? undefined : Number(data.turn_count),
                  currentDiagramVersionId: typeof data.current_diagram_version_id === 'string'
                    ? data.current_diagram_version_id
                    : undefined,
                },
              });
              break;
            }
            case 'long_term_preferences': {
              updateLastAssistantMessage({
                longTermPreferences: {
                  status: String(data.status || 'empty'),
                  reason: typeof data.reason === 'string' ? data.reason : undefined,
                  sources: typeof data.sources === 'object' && data.sources ? data.sources as Record<string, boolean> : {},
                  keys: Array.isArray(data.keys) ? data.keys.map(String) : [],
                },
              });
              break;
            }
            case 'planner_plan': {
              updateLastAssistantMessage({
                plannerPlan: {
                  status: String(data.status || 'unknown'),
                  mode: typeof data.mode === 'string' ? data.mode : undefined,
                  complexity: typeof data.complexity === 'string' ? data.complexity : undefined,
                  engineType: typeof data.engine_type === 'string' ? data.engine_type : undefined,
                  knowledgeRequired: Boolean(data.knowledge_required),
                  subtasks: Array.isArray(data.subtasks) ? data.subtasks : [],
                  qualityGates: Array.isArray(data.quality_gates) ? data.quality_gates.map(String) : [],
                  assumptions: Array.isArray(data.assumptions) ? data.assumptions.map(String) : [],
                  note: typeof data.note === 'string' ? data.note : undefined,
                },
              });
              break;
            }
            case 'design_agent': {
              updateLastAssistantMessage({
                designAgent: {
                  status: String(data.status || 'unknown'),
                  engineType: typeof data.engine_type === 'string' ? data.engine_type : undefined,
                  changed: Boolean(data.changed),
                  appliedRules: Array.isArray(data.applied_rules) ? data.applied_rules.map(String) : [],
                  note: typeof data.note === 'string' ? data.note : undefined,
                },
              });
              break;
            }
            case 'repair_agent': {
              updateLastAssistantMessage({
                repairAgent: {
                  status: String(data.status || 'unknown'),
                  engineType: typeof data.engine_type === 'string' ? data.engine_type : undefined,
                  repaired: Boolean(data.repaired),
                  appliedRules: Array.isArray(data.applied_rules) ? data.applied_rules.map(String) : [],
                  errors: Array.isArray(data.errors) ? data.errors.map(String) : [],
                  validationOk: Boolean(data.validation_ok),
                  note: typeof data.note === 'string' ? data.note : undefined,
                },
              });
              break;
            }
            case 'consistency_agent': {
              updateLastAssistantMessage({
                consistencyAgent: {
                  status: String(data.status || 'unknown'),
                  ok: Boolean(data.ok),
                  needsUserInput: Boolean(data.needs_user_input),
                  checkedChunks: Number(data.checked_chunks || 0),
                  missingRequiredTerms: Array.isArray(data.missing_required_terms) ? data.missing_required_terms.map(String) : [],
                  forbiddenTermsPresent: Array.isArray(data.forbidden_terms_present) ? data.forbidden_terms_present.map(String) : [],
                  coverageRatio: Number(data.coverage_ratio ?? 1),
                  note: typeof data.note === 'string' ? data.note : undefined,
                },
              });
              break;
            }
            case 'human_approval_required': {
              updateLastAssistantMessage({
                approvalRequest: {
                  approvalId: String(data.approval_id || ''),
                  approvalType: String(data.approval_type || ''),
                  status: String(data.status || 'pending'),
                  requiredScope: String(data.required_scope || ''),
                  reason: String(data.reason || ''),
                  resource: typeof data.resource === 'object' && data.resource ? data.resource : {},
                },
              });
              break;
            }
            case 'knowledge_context': {
              const selectedTemplate = data.selected_template && typeof data.selected_template === 'object'
                ? {
                    templateId: String(data.selected_template.template_id || ''),
                    name: String(data.selected_template.name || ''),
                    engineType: data.selected_template.engine_type ? String(data.selected_template.engine_type) : undefined,
                    taskType: data.selected_template.task_type ? String(data.selected_template.task_type) : undefined,
                    matchScore: Number(data.selected_template.match_score || 0),
                  }
                : undefined;
              const historicalDiagrams = Array.isArray(data.historical_diagrams)
                ? (data.historical_diagrams as unknown[])
                    .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
                    .map((item: Record<string, unknown>) => ({
                      diagramId: String(item.diagram_id || ''),
                      title: String(item.title || ''),
                      engineType: item.engine_type ? String(item.engine_type) : undefined,
                      taskType: item.task_type ? String(item.task_type) : undefined,
                      currentVersionId: item.current_version_id ? String(item.current_version_id) : undefined,
                    }))
                : [];
              updateLastAssistantMessage({
                knowledgeContext: {
                  status: String(data.status || 'unknown'),
                  count: Number(data.count || 0),
                  citations: Array.isArray(data.citations) ? data.citations : [],
                  selectedTemplate,
                  historicalDiagrams,
                  note: typeof data.note === 'string' ? data.note : undefined,
                },
              });
              break;
            }
            case 'export_plan': {
              updateLastAssistantMessage({
                exportPlan: {
                  status: String(data.status || 'unknown'),
                  engineType: typeof data.engine_type === 'string' ? data.engine_type : undefined,
                  preferredFormat: typeof data.preferred_format === 'string' ? data.preferred_format : undefined,
                  allowedFormats: Array.isArray(data.allowed_formats) ? data.allowed_formats : [],
                  deniedFormats: Array.isArray(data.denied_formats) ? data.denied_formats : [],
                  note: typeof data.note === 'string' ? data.note : undefined,
                },
              });
              break;
            }
            case 'diagram_saved': {
              if (data.persisted && data.diagram_id && data.diagram_version_id) {
                const diagramId = String(data.diagram_id);
                const diagramVersionId = String(data.diagram_version_id);
                setCanvasDiagramId(diagramId);
                setCanvasDiagramVersionId(diagramVersionId);
                updateLastAssistantMessage({
                  diagramId,
                  diagramVersionId,
                });
              }
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
              updateLastAssistantMessage({ content: t('chat.status.analyzing') });
              break;
            case 'design':
              designBuffer += data.content;
              setDesignConcept(designBuffer);
              updateLastAssistantMessage({ designConcept: designBuffer, content: t('chat.status.designing') });
              break;
            case 'design_end':
              break;
            case 'code_start':
              applyExecutionPlanStatus('generating', 'start');
              clearPendingElements();
              elementCount = 0;
              codeBuffer = '';
              setCanvasPhase('generating');
              updateLastAssistantMessage({ content: t('chat.status.generating') });
              break;
            case 'element':
              elementCount++;
              addPendingElement(data.content);
              updateLastAssistantMessage({ content: t('chat.status.drawing', { count: elementCount }) });
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
              applyExecutionPlanStatus('generating', 'end');
              applyExecutionPlanStatus('renderer', 'start');
              applyExecutionPlanStatus('renderer', 'end');
              currentSteps = currentSteps.map(s => 
                s.id === 'generating' && s.status === 'running'
                  ? { ...s, status: 'completed', duration: (Date.now() - s.startTime) / 1000 }
                  : s
              );
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
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              updateLastAssistantMessage({ code: finalCode || '[]', content: t('chat.status.done', { seconds: elapsed }) });
              // Consume guest quota on successful diagram generation
              if (isGuest) {
                void refreshGuestQuotaFromServer().then((quota) => {
                  if (quota) setGuestQuota(quota);
                });
              }
              // Mobile: start 3-2-1 countdown to auto-switch to canvas
              startMobileCountdown();
              break;
            }
            case 'text':
              textBuffer += (data.content || '');
              updateLastAssistantMessage({ content: textBuffer });
              break;
            case 'error':
              failExecutionPlan(String(data.message || t('common.error')));
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
      // Ignore AbortError as it is triggered intentionally
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      failExecutionPlan(errMsg);
      updateLastAssistantMessage({ content: t('chat.status.connectionFailed', { message: errMsg }) });
    } finally {
      setIsStreaming(false);
      setStreamStartTime(null);
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      if (currentSteps.length > 0) {
        currentSteps = currentSteps.map(s => 
          s.status === 'running' 
            ? { ...s, status: 'completed', duration: (Date.now() - s.startTime) / 1000 } 
            : s
        );
        updateLastAssistantMessage({ steps: [...currentSteps] });
      }
    }
  }, [
    input, isStreaming, modelConfig, messages,
    canvasCode, canvasTask, canvasEngine, canvasDiagramId, canvasDiagramVersionId,
    conversationId, selectedAgent, addPendingElement, clearPendingElements, inputImages,
    setConversationId, setCanvasDiagramId, setCanvasDiagramVersionId, t,
    addMessage, clearInputImages, detailLevel, isGuest, setCanvasCode,
    setCanvasEngine, setCanvasPhase, setCanvasTask, setCurrentEngine,
    setCurrentTask, setDesignConcept, setIsStreaming, setStreamStartTime,
    setStreamingCode, startMobileCountdown, updateLastAssistantMessage,
  ]);

  const handleChangeDiagramType = useCallback((msg: Message, agent: DiagramAgentMeta) => {
    if (isStreaming) return;
    setTypeSwitchMessageId(null);
    if (msg.code) {
      clearPendingElements();
      setCanvasCode(msg.code);
      if (msg.taskType) setCanvasTask(msg.taskType);
      if (msg.engineType) setCanvasEngine(msg.engineType);
      if (msg.diagramId) setCanvasDiagramId(msg.diagramId);
      if (msg.diagramVersionId) setCanvasDiagramVersionId(msg.diagramVersionId);
      if (msg.designConcept) setDesignConcept(msg.designConcept);
      setCanvasPhase('done');
      setStreamingCode('');
    }
    void sendMessage(`${agent.prefix}${t('version.changeTypePrompt', { type: agent.label })}`, {
      forcedAgent: agent,
      images: [],
      preserveInputImages: true,
      currentCode: msg.code || canvasCode || '',
      currentTask: msg.taskType || canvasTask || getTaskByEngine(agent.id) || null,
      currentEngine: msg.engineType || canvasEngine || null,
      designConcept: msg.designConcept || useChatStore.getState().designConcept || '',
      // 换类型 = 新图表，不传旧 diagram_id，让后端创建独立记录
      // 否则所有换类型的图表都会变成同一个 diagram 的版本，历史里只保留最后一个
      currentDiagramId: null,
      currentDiagramVersionId: null,
    });
  }, [
    isStreaming,
    sendMessage,
    t,
    clearPendingElements,
    setCanvasCode,
    setCanvasTask,
    setCanvasEngine,
    setCanvasDiagramId,
    setCanvasDiagramVersionId,
    setDesignConcept,
    setCanvasPhase,
    setStreamingCode,
    canvasCode,
    canvasTask,
    canvasEngine,
  ]);

  const handleRetryRender = useCallback((msg: Message) => {
    if (!msg.code || isStreaming) return;
    clearPendingElements();
    setCanvasCode(msg.code);
    if (msg.taskType) setCanvasTask(msg.taskType);
    if (msg.engineType) setCanvasEngine(msg.engineType);
    if (msg.diagramId) setCanvasDiagramId(msg.diagramId);
    if (msg.diagramVersionId) setCanvasDiagramVersionId(msg.diagramVersionId);
    if (msg.designConcept) setDesignConcept(msg.designConcept);
    setCanvasPhase('done');
    setStreamingCode('');
    if (msg.engineType === 'mermaid') {
      void sendMessage([
        '@mermaid 请修复当前 Mermaid 图表并重新渲染。',
        '要求：保留原业务内容、关键节点、分层结构和关系，不要降级为空图，不要删除核心节点，不要只改配色。',
        '请针对 Mermaid 语法错误和布局渲染错误进行修复。不要使用 flowchart 边标签语法（例如 A -->|"关系"| B），请把关系文字改成独立关系节点，输出完整可渲染的 Mermaid 代码。',
      ].join('\n'), {
        forcedAgent: DIAGRAM_AGENTS.find((agent) => agent.id === 'mermaid') || null,
        images: [],
        preserveInputImages: true,
        currentCode: msg.code,
        currentTask: msg.taskType || canvasTask || getTaskByEngine('mermaid') || null,
        currentEngine: 'mermaid',
        currentDiagramId: msg.diagramId || canvasDiagramId || null,
        currentDiagramVersionId: msg.diagramVersionId || canvasDiagramVersionId || null,
      });
      return;
    }
    requestCanvasRenderRetry();
  }, [
    isStreaming,
    sendMessage,
    clearPendingElements,
    setCanvasCode,
    setCanvasTask,
    setCanvasEngine,
    setCanvasDiagramId,
    setCanvasDiagramVersionId,
    setDesignConcept,
    setCanvasPhase,
    setStreamingCode,
    requestCanvasRenderRetry,
    canvasTask,
    canvasDiagramId,
    canvasDiagramVersionId,
  ]);

  // Listen for external direct message events (e.g. from canvas node AI optimize overlay)
  useEffect(() => {
    const handleSendDirect = (e: Event) => {
      const {
        text,
        currentCode,
        currentTask,
        currentEngine,
        currentDiagramId,
        currentDiagramVersionId,
      } = (e as CustomEvent).detail || {};
      if (text) {
        sendMessage(text, {
          currentCode,
          currentTask,
          currentEngine,
          currentDiagramId,
          currentDiagramVersionId,
          forcedAgent: currentEngine === 'mermaid'
            ? DIAGRAM_AGENTS.find((agent) => agent.id === 'mermaid') || null
            : undefined,
          images: [],
          preserveInputImages: true,
        });
      }
    };
    window.addEventListener('send-ai-message', handleSendDirect);
    return () => window.removeEventListener('send-ai-message', handleSendDirect);
  }, [sendMessage]);

  // Cleanup connections on unmount
  useEffect(() => {
    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, []);

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

  const promptExamples = [
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'charts')!, text: t('chat.example.charts') },
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'flow')!, text: t('chat.example.flow') },
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'drawio')!, text: t('chat.example.drawio') },
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'mermaid')!, text: t('chat.example.mermaid') },
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'mindmap')!, text: t('chat.example.mindmap') },
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'excalidraw')!, text: t('chat.example.excalidraw') },
    { agent: DIAGRAM_AGENTS.find((agent) => agent.id === 'infographic')!, text: t('chat.example.infographic') },
  ];

  const detailOptions = [
    { value: 'short', label: t('chat.detail.short'), desc: t('chat.detail.shortDesc') },
    { value: 'medium', label: t('chat.detail.medium'), desc: t('chat.detail.mediumDesc') },
    { value: 'long', label: t('chat.detail.long'), desc: t('chat.detail.longDesc') },
  ] as const;
  const activeDetailLabel = detailOptions.find((option) => option.value === detailLevel)?.label || t('chat.detail.medium');

  return (
    <div className={`h-full flex flex-col transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50 text-slate-800' : 'bg-dark-900 text-slate-200'}`}>

      {/* ── Header ── */}
      <div className={`flex items-center justify-between px-5 py-3.5 border-b transition-colors duration-300 ${
        canvasMode === 'light' ? 'border-slate-200 bg-white/60' : 'border-slate-700/50 bg-dark-900/60'
      }`}>
        <div className="flex items-center gap-3">
          <SmartDiagramIconMark className="w-8 h-8 shrink-0 drop-shadow-sm" />
          <div>
            <h1 className={`text-[13px] font-semibold tracking-tight ${canvasMode === 'light' ? 'text-slate-800' : 'text-slate-100'}`}>SmartDiagram</h1>
            <p className={`text-[10px] ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-500'}`}>{t('app.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={startNewConversation}
            disabled={isStreaming}
            title={isStreaming ? t('chat.newConversationDisabled') : t('chat.newConversation')}
            aria-label={t('chat.newConversation')}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
              isStreaming
                ? 'cursor-not-allowed opacity-45'
                : canvasMode === 'light'
                  ? 'border-slate-200 bg-white text-slate-500 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                  : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-200'
            }`}
          >
            <SquarePen className="w-4 h-4" />
          </button>
          <button onClick={openDiagramHistory}
            title={t('history.title')}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors cursor-pointer ${
              canvasMode === 'light'
                ? 'border-slate-200 bg-white text-slate-500 shadow-sm hover:border-slate-300 hover:text-slate-900'
                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-100'
            }`}>
            <History className="w-4 h-4" />
          </button>
          <button onClick={() => setSettingsOpen(true)}
            title={t('settings.open')}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
              canvasMode === 'light'
                ? 'border-slate-200 bg-white text-slate-500 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-200'
            }`}>
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <TextInputDialog
        open={Boolean(branchDialog)}
        title={t('dialog.branch.title')}
        label={t('dialog.branch.label')}
        description={t('dialog.branch.description')}
        initialValue={branchDialog?.initialValue || ''}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        busy={versionActionBusy}
        onCancel={() => setBranchDialog(null)}
        onConfirm={confirmBranchDialog}
      />
      <ConfirmDialog
        open={Boolean(rollbackDialog)}
        title={t('dialog.rollback.title')}
        message={t('dialog.rollback.message')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        busy={versionActionBusy}
        onCancel={() => setRollbackDialog(null)}
        onConfirm={confirmRollbackDialog}
      />
      <ConfirmDialog
        open={clearDialogOpen}
        title={t('dialog.clearConversation.title')}
        message={t('dialog.clearConversation.message')}
        confirmLabel={t('dialog.clearConversation.confirm')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setClearDialogOpen(false)}
        onConfirm={() => {
          clearMessages();
          setClearDialogOpen(false);
        }}
      />
      <NoticeDialog
        open={Boolean(noticeDialog)}
        title={noticeDialog?.title || t('common.error')}
        message={noticeDialog?.message || ''}
        closeLabel={t('common.close')}
        onClose={() => setNoticeDialog(null)}
      />
      <DiagramHistoryPanel
        open={historyOpen}
        mode={historyMode}
        items={historyItems}
        conversationItems={conversationHistoryItems}
        query={historyQuery}
        loading={historyLoading}
        error={historyError}
        onClose={() => setHistoryOpen(false)}
        onModeChange={changeHistoryMode}
        onQueryChange={setHistoryQuery}
        onSearch={() => loadCurrentHistory(historyQuery)}
        onRefresh={() => loadCurrentHistory(historyQuery)}
        onUse={useHistoricalDiagram}
        onBranch={branchHistoricalDiagram}
        onResumeConversation={resumeConversationHistory}
      />

      {/* ── Messages Area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center sd-fade-in">
            <SmartDiagramIconMark className="w-14 h-14 mb-5 drop-shadow-sm" />
            <p className={`text-sm font-medium mb-1 ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>{t('chat.emptyTitle')}</p>
            <p className={`text-xs mb-6 ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-600'}`}>
              {t('chat.emptyDescription')}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[320px]">
              {promptExamples.map((ex, i) => (
                <button key={i}
                  onClick={() => {
                    setSelectedAgent(ex.agent);
                    setInput(ex.text);
                    textareaRef.current?.focus();
                  }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all duration-200 border shadow-xs ${
                    canvasMode === 'light' 
                      ? 'bg-white border-slate-250 hover:bg-slate-100' 
                      : 'bg-slate-800/80 border-slate-700/50 hover:border-blue-500/30 hover:bg-slate-800'
                  } sd-slide-up`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
                    style={{ background: `${ex.agent.color}15`, color: ex.agent.color }}>
                    <ex.agent.Icon style={{ width: 10, height: 10 }} />
                    {ex.agent.label}
                  </span>
                  <span className={`text-xs ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>{ex.text}</span>
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
                : canvasMode === 'light' 
                  ? 'bg-white border border-slate-200 text-slate-800 shadow-sm'
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

                {/* Thinking steps */}
                {msg.role === 'assistant' && msg.steps && msg.steps.length > 0 && (
                  <ThinkingProcess 
                    steps={msg.steps} 
                    isStreaming={isStreaming && msg.id === messages[messages.length - 1]?.id} 
                  />
                )}

                {msg.role === 'assistant' && (
                  <AgentDetailsDisclosure message={msg} />
                )}

                {msg.role === 'assistant' && msg.approvalRequest && (
                  <HumanApprovalCard approval={msg.approvalRequest} />
                )}

                {/* Design concept */}
                {msg.role === 'assistant' && msg.designConcept && (
                  <DesignConceptCard text={msg.designConcept} />
                )}

                {/* Content */}
                {msg.role === 'assistant' && msg.code ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button
                      className={`text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                        canvasMode === 'light' ? 'text-emerald-600 hover:text-emerald-700' : 'text-emerald-400 hover:text-emerald-300'
                      }`}
                      onClick={() => {
                        clearPendingElements();
                        setCanvasCode(msg.code!);
                        if (msg.taskType) setCanvasTask(msg.taskType);
                        if (msg.engineType) setCanvasEngine(msg.engineType);
                        if (msg.diagramId) setCanvasDiagramId(msg.diagramId);
                        if (msg.diagramVersionId) setCanvasDiagramVersionId(msg.diagramVersionId);
                        if (msg.designConcept) setDesignConcept(msg.designConcept);
                        setCanvasPhase('done');
                        setStreamingCode('');
                        switchToCanvas();
                      }}
                      title={t('chat.viewOnCanvasTitle')}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${canvasMode === 'light' ? 'bg-emerald-600' : 'bg-emerald-400'}`} />
                      {t('chat.generatedToCanvas')}
                    </button>

                    {msg.diagramId && msg.diagramVersionId && (
                      <>
                        <DiagramTypeSwitchButton
                          message={msg}
                          open={typeSwitchMessageId === msg.id}
                          busy={versionActionBusy}
                          disabled={isStreaming}
                          onToggle={() => setTypeSwitchMessageId(typeSwitchMessageId === msg.id ? null : msg.id)}
                          onClose={() => setTypeSwitchMessageId(null)}
                          onSelect={(agent) => handleChangeDiagramType(msg, agent)}
                        />
                        <button
                          type="button"
                          disabled={isStreaming}
                          onClick={() => handleRetryRender(msg)}
                          className={`text-[11px] inline-flex items-center gap-1 rounded-md px-2 py-1 border transition-colors disabled:opacity-50 ${
                            canvasMode === 'light'
                              ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                              : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                          }`}
                          title={t('version.retryRenderTitle')}
                        >
                          <RefreshCw className="w-3 h-3" />
                          {msg.engineType === 'mermaid' ? t('mermaid.autoRepairRetry') : t('common.retry')}
                        </button>
                        <button
                          type="button"
                          disabled={versionActionBusy || msg.diagramVersionId === canvasDiagramVersionId}
                          onClick={() => handleRollback(msg)}
                          className={`text-[11px] inline-flex items-center gap-1 rounded-md px-2 py-1 border transition-colors disabled:opacity-50 ${
                            canvasMode === 'light'
                              ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                              : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                          }`}
                          title={t('version.rollbackTitle')}
                        >
                          <RotateCcw className="w-3 h-3" />
                          {t('version.rollback')}
                        </button>
                      </>
                    )}
                  </div>
                ) : msg.role === 'assistant' && !msg.content && isStreaming ? (
                  msg.steps && msg.steps.length > 0 ? null : (
                    <div className="flex items-center gap-2 py-0.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      <span className="text-xs text-slate-500">{msg.statusText || t('chat.thinking')}</span>
                      <span className="flex gap-[3px]">
                        {[0, 1, 2].map(i => (
                          <span key={i} className="w-1 h-1 rounded-full bg-blue-400"
                            style={{ animation: `sd-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                        ))}
                      </span>
                      <LiveTimer startTime={streamStartTime} />
                    </div>
                  )
                ) : msg.role === 'assistant' && msg.content && isStreaming && msg.id === messages[messages.length - 1]?.id ? (
                  <div className="flex items-center gap-2 py-0.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span className="text-xs text-slate-400 flex-1">{msg.content}</span>
                    <LiveTimer startTime={streamStartTime} />
                  </div>
                ) : msg.role === 'assistant' && msg.content ? (
                  <AssistantContent content={msg.content} canvasMode={canvasMode} />
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

      {/* ── Mobile Countdown Banner ── */}
      {isMobile && mobileCountdown !== null && (
        <div
          style={{
            margin: '0 12px',
            marginBottom: '4px',
            padding: '10px 14px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(59,130,246,0.10))',
            border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            animation: 'sd-pulse 1.5s ease-in-out infinite',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', fontWeight: 700,
              animation: 'sd-countdown-pop 1s ease-in-out infinite',
            }}>
              {mobileCountdown}
            </span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: canvasMode === 'light' ? '#4338ca' : '#a5b4fc' }}>
              {t('mobile.countdownHint')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={switchToCanvas}
              style={{
                fontSize: '11px', padding: '4px 10px', borderRadius: '6px',
                background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
              }}
            >
              {t('mobile.goNow')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (countdownTimerRef.current) {
                  clearInterval(countdownTimerRef.current);
                  countdownTimerRef.current = null;
                }
                setMobileCountdown(null);
              }}
              style={{
                fontSize: '11px', padding: '4px 8px', borderRadius: '6px',
                background: 'transparent',
                color: canvasMode === 'light' ? '#64748b' : '#94a3b8',
                border: `1px solid ${canvasMode === 'light' ? '#cbd5e1' : '#334155'}`,
                cursor: 'pointer', fontWeight: 500,
              }}
            >
              {t('mobile.stayHere')}
            </button>
          </div>
        </div>
      )}

      {/* ── Guest Quota Bar ── */}
      {isGuest && (
        <div style={{
          margin: '0 12px',
          marginBottom: '4px',
          padding: '8px 12px',
          borderRadius: '10px',
          background: guestExhausted
            ? (canvasMode === 'light' ? 'linear-gradient(135deg, #fef2f2, #fff1f2)' : 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(244,63,94,0.10))')
            : (canvasMode === 'light' ? 'linear-gradient(135deg, #eff6ff, #f0f9ff)' : 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(99,102,241,0.06))'),
          border: guestExhausted
            ? (canvasMode === 'light' ? '1px solid #fecaca' : '1px solid rgba(239,68,68,0.25)')
            : (canvasMode === 'light' ? '1px solid #bfdbfe' : '1px solid rgba(59,130,246,0.2)'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '12px',
          transition: 'all 0.3s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ fontSize: '14px', flexShrink: 0 }}>{guestExhausted ? '⏰' : '🎯'}</span>
            <span style={{
              color: guestExhausted
                ? (canvasMode === 'light' ? '#dc2626' : '#fca5a5')
                : (canvasMode === 'light' ? '#2563eb' : '#93c5fd'),
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {guestExhausted
                ? `${t('guest.quotaExhausted')}${guestQuota.nextAvailableAt ? ` · ${t('guest.resetIn', { time: formatResetTime(guestQuota.nextAvailableAt) })}` : ''}`
                : t('guest.quotaRemaining', { remaining: guestQuota.remaining, total: guestQuota.total })
              }
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowLoginModal(true)}
            style={{
              flexShrink: 0,
              padding: '4px 12px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: guestExhausted
                ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                : (canvasMode === 'light' ? '#e0e7ff' : 'rgba(99,102,241,0.2)'),
              color: guestExhausted
                ? '#fff'
                : (canvasMode === 'light' ? '#4338ca' : '#a5b4fc'),
              boxShadow: guestExhausted ? '0 2px 8px rgba(99,102,241,0.3)' : 'none',
            }}
          >
            {guestExhausted ? t('guest.loginNow') : t('guest.loginToUnlock')}
          </button>
        </div>
      )}

      {/* ── ChatGPT-Style Input Area ── */}
      <div className="px-3 pb-3 pt-1">
        <div style={{
          background: canvasMode === 'light' ? '#ffffff' : '#1e293b',
          border: canvasMode === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(148,163,184,0.2)',
          borderRadius: '16px',
          overflow: 'visible',
          transition: 'all 0.2s',
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
                    title={t('chat.removeImage')}
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
              placeholder={guestExhausted ? t('guest.quotaExhausted') : inputImages.length > 0 ? t('chat.inputPlaceholderWithImages') : t('chat.inputPlaceholder')}
              rows={1}
              disabled={isStreaming || guestExhausted}
              style={{
                width: '100%',
                background: 'transparent',
                fontSize: '13px',
                color: canvasMode === 'light' ? '#0f172a' : '#e2e8f0',
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
                onMouseEnter={(e) => { e.currentTarget.style.background = canvasMode === 'light' ? '#e2e8f0' : '#334155'; e.currentTarget.style.color = canvasMode === 'light' ? '#1e293b' : '#e2e8f0'; }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = inputImages.length > 0 ? 'rgba(59,130,246,0.1)' : 'transparent';
                  e.currentTarget.style.color = inputImages.length > 0 ? '#60a5fa' : '#94a3b8';
                }}
                title={t('chat.uploadImage')}
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
                  onMouseEnter={(e) => { if (!selectedAgent) e.currentTarget.style.background = canvasMode === 'light' ? '#e2e8f0' : '#334155'; }}
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
                      {t('chat.autoDetectTask')}
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
                      background: canvasMode === 'light' ? '#ffffff' : '#1e293b',
                      border: canvasMode === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(148,163,184,0.2)',
                      borderRadius: '12px',
                      padding: '4px',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
                      minWidth: '240px',
                    }}
                  >
                    {/* "AI Auto" option */}
                    <button
                      onClick={() => { setSelectedAgent(null); setShowAgentPicker(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 10px', borderRadius: '8px',
                        background: !selectedAgent ? (canvasMode === 'light' ? '#f1f5f9' : '#334155') : 'transparent',
                        border: 'none', cursor: 'pointer', fontSize: '12px',
                        color: canvasMode === 'light' ? '#334155' : '#e2e8f0', fontWeight: !selectedAgent ? 600 : 400,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = canvasMode === 'light' ? '#f1f5f9' : '#334155')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = !selectedAgent ? (canvasMode === 'light' ? '#f1f5f9' : '#334155') : 'transparent')}
                    >
                      <Sparkles style={{ width: 14, height: 14, color: '#60a5fa' }} />
                      <span>{t('chat.aiAutoSelect')}</span>
                      {!selectedAgent && <Check style={{ width: 12, height: 12, color: '#60a5fa', marginLeft: 'auto' }} />}
                    </button>

                    <div style={{ height: '1px', background: 'rgba(148,163,184,0.15)', margin: '4px 8px' }} />

                    {VISIBLE_DIAGRAM_AGENTS.map((a) => (
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
                          background: selectedAgent?.id === a.id ? (canvasMode === 'light' ? '#f1f5f9' : '#334155') : 'transparent',
                          border: 'none', cursor: 'pointer', fontSize: '12px',
                          color: canvasMode === 'light' ? '#334155' : '#e2e8f0', fontWeight: selectedAgent?.id === a.id ? 600 : 400,
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = canvasMode === 'light' ? '#f1f5f9' : '#334155')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = selectedAgent?.id === a.id ? (canvasMode === 'light' ? '#f1f5f9' : '#334155') : 'transparent')}
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

              {/* Length dropdown chip */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowLengthPicker(!showLengthPicker)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background: 'transparent',
                    border: '1px solid rgba(148,163,184,0.2)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#94a3b8',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = canvasMode === 'light' ? '#e2e8f0' : '#334155'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <SlidersHorizontal style={{ width: 12, height: 12, opacity: 0.8 }} />
                  <span>
                    {activeDetailLabel}
                  </span>
                  <ChevronDown style={{ width: 12, height: 12, opacity: 0.6 }} />
                </button>

                {/* Length dropdown list */}
                {showLengthPicker && (
                  <div
                    ref={(el) => {
                      if (!el) return;
                      const handler = (e: MouseEvent) => {
                        if (!el.contains(e.target as Node)) setShowLengthPicker(false);
                      };
                      document.addEventListener('mousedown', handler);
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
                      background: canvasMode === 'light' ? '#ffffff' : '#1e293b',
                      border: canvasMode === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(148,163,184,0.2)',
                      borderRadius: '12px',
                      padding: '4px',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
                      minWidth: '130px',
                    }}
                  >
                    {detailOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setDetailLevel(opt.value);
                          setShowLengthPicker(false);
                        }}
                        style={{
                          width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                          padding: '6px 10px', borderRadius: '8px',
                          background: detailLevel === opt.value ? (canvasMode === 'light' ? '#f1f5f9' : '#334155') : 'transparent',
                          border: 'none', cursor: 'pointer', fontSize: '12px',
                          color: canvasMode === 'light' ? '#334155' : '#e2e8f0', textAlign: 'left',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = canvasMode === 'light' ? '#f1f5f9' : '#334155')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = detailLevel === opt.value ? (canvasMode === 'light' ? '#f1f5f9' : '#334155') : 'transparent')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <span style={{ fontWeight: detailLevel === opt.value ? 600 : 400 }}>{opt.label}</span>
                          {detailLevel === opt.value && <Check style={{ width: 12, height: 12, color: '#60a5fa', marginLeft: 'auto' }} />}
                        </div>
                        <span style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>{opt.desc}</span>
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
                  title={t('chat.clearAgent')}
                >
                  <X style={{ width: 10, height: 10 }} />
                </button>
              )}
            </div>

            {/* Right: Send button */}
            <button
              onClick={() => sendMessage()}
              disabled={(!input.trim() && inputImages.length === 0) || isStreaming || guestExhausted}
              style={{
                width: '32px', height: '32px',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none',
                cursor: ((!input.trim() && inputImages.length === 0) || isStreaming || guestExhausted) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                background: ((input.trim() || inputImages.length > 0) && !isStreaming && !guestExhausted)
                  ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                  : '#334155',
                opacity: ((!input.trim() && inputImages.length === 0) || isStreaming || guestExhausted) ? 0.4 : 1,
                boxShadow: ((input.trim() || inputImages.length > 0) && !isStreaming && !guestExhausted)
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
        <div style={{ textAlign: 'right', padding: '4px 8px 0', fontSize: '10px', color: canvasMode === 'light' ? '#64748b' : '#475569' }}>
          {t('chat.keyboardHint')}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        authSession={authSession}
        onClose={() => setSettingsOpen(false)}
        onLogout={onLogout}
        onClearConversation={() => {
          setSettingsOpen(false);
          setClearDialogOpen(true);
        }}
      />

      {/* Guest Login Modal */}
      {showLoginModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(15,23,42,0.55)',
          backdropFilter: 'blur(6px)',
        }}>
          <LoginScreen
            displayMode="modal"
              onLogin={(session) => {
              setShowLoginModal(false);
              onLogin(session);
            }}
            onClose={() => setShowLoginModal(false)}
          />
        </div>
      )}
    </div>
  );
}

/* ── Collapsible Thinking Steps Timeline ── */
interface ThinkingProcessProps {
  steps: ThinkingStep[];
  isStreaming: boolean;
}

function ThinkingProcess({ steps, isStreaming }: ThinkingProcessProps) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(!isStreaming);

  // 用组件内部 tick 在 isStreaming 为真时进行 100ms 的递增渲染，保证思考秒数实时变化
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (isStreaming) {
      const timer = setInterval(() => {
        setNow(Date.now());
      }, 100);
      return () => clearInterval(timer);
    }
  }, [isStreaming]);

  // 计算当前总共思考的秒数
  const totalDuration = steps.reduce((acc, step) => {
    if (step.duration !== undefined) {
      return acc + step.duration;
    }
    if (step.status === 'running') {
      return acc + (now - step.startTime) / 1000;
    }
    return acc;
  }, 0);

  const isCompleted = steps.every(s => s.status === 'completed') && !isStreaming;

  // 当生成完毕且 steps 都为 completed 时，收起折叠
  useEffect(() => {
    const timer = window.setTimeout(() => setCollapsed(isCompleted), 0);
    return () => window.clearTimeout(timer);
  }, [isCompleted]);

  return (
    <div className={`border rounded-lg overflow-hidden mb-3 transition-all ${
      canvasMode === 'light' 
        ? 'border-slate-200/60 bg-slate-50/50' 
        : 'border-slate-800/80 bg-slate-900/30'
    }`}>
      {/* Collapsible Trigger Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full px-3 py-1.5 flex items-center justify-between text-xs font-medium cursor-pointer transition-colors ${
          canvasMode === 'light'
            ? 'bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700'
            : 'bg-slate-900/40 hover:bg-slate-900/80 text-slate-400 hover:text-slate-300'
        }`}
      >
        <div className="flex items-center gap-2">
          {isCompleted ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <Brain className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
          )}
          <span>{isCompleted ? t('thinking.completed') : t('thinking.active')}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            canvasMode === 'light' ? 'bg-slate-200/60 text-slate-600' : 'bg-slate-800 text-slate-400'
          }`}>
            {totalDuration.toFixed(1)}s
          </span>
        </div>
        {collapsed ? <ChevronRight className="w-3.5 h-3.5 opacity-60" /> : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {/* Expanded Step Timeline */}
      {!collapsed && (
        <div className={`px-4 py-3 border-t text-[12px] ${
          canvasMode === 'light' 
            ? 'bg-white border-slate-100 text-slate-600' 
            : 'bg-slate-950/60 border-slate-800/60 text-slate-300'
        }`}>
          <div className={`relative pl-4 border-l flex flex-col gap-2.5 ${
            canvasMode === 'light' ? 'border-slate-100' : 'border-slate-800/60'
          }`}>
            {steps.map((step) => {
              const isRunning = step.status === 'running';
              const stepDuration = step.duration !== undefined 
                ? step.duration 
                : isRunning ? (now - step.startTime) / 1000 : 0;
              return (
                <div key={step.id} className="relative flex items-center justify-between">
                  {/* Timeline dot */}
                  <span className={`absolute -left-[21px] top-1/2 -translate-y-1/2 flex items-center justify-center p-[2px] ${
                    canvasMode === 'light' ? 'bg-white' : 'bg-slate-900'
                  }`}>
                    {isRunning ? (
                      <Loader2 className="w-2.5 h-2.5 text-blue-500 animate-spin" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                  </span>

                  {/* Step Name */}
                  <span className={isRunning ? 'text-blue-500 font-medium' : 'opacity-80'}>
                    {step.label}
                  </span>

                  {/* Step Duration */}
                  <span className="text-[10px] opacity-60 font-mono">
                    {isRunning ? `${stepDuration.toFixed(1)}s` : `${stepDuration.toFixed(2)}s`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
