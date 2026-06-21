import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Coins,
  DatabaseZap,
  Gauge,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Workflow,
  X,
} from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useT, type Locale } from '../../i18n';
import { API_BASE, canReadOps, enterpriseHeaders, enterpriseQueryParams } from '../../config/enterpriseContext';

type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

interface AuditMetrics {
  agent_runs?: {
    total?: number;
    status_counts?: Record<string, number>;
    engine_counts?: Record<string, number>;
    estimated_input_tokens?: number;
    estimated_output_tokens?: number;
    estimated_cost?: number;
  };
  audit_events?: {
    total?: number;
    event_type_counts?: Record<string, number>;
    severity_counts?: Record<string, number>;
  };
  approval_requests?: {
    total?: number;
    pending?: number;
    status_counts?: Record<string, number>;
    type_counts?: Record<string, number>;
    oldest_pending_age_seconds?: number | null;
  };
  budget?: {
    period?: string;
    scope?: string;
    usage?: {
      source?: string;
      run_count?: number;
      estimated_cost?: number;
      estimated_total_tokens?: number;
      estimated_input_tokens?: number;
      estimated_output_tokens?: number;
      rolled_up_at?: string;
    };
    budget?: {
      monthly_cost_limit?: number;
      monthly_token_limit?: number;
      hard_limit_enabled?: boolean;
      status?: string;
    };
    remaining?: {
      cost?: number | null;
      tokens?: number | null;
    };
  };
  queue_health?: {
    totals?: {
      jobs?: number;
      queued?: number;
      running?: number;
      failed?: number;
    };
    queues?: Record<string, {
      total?: number;
      status_counts?: Record<string, number>;
      queued_count?: number;
      running_count?: number;
      failed_count?: number;
      oldest_queued_age_seconds?: number | null;
    }>;
  };
}

interface AgentRunSummary {
  id: string;
  status: string;
  task_type?: string;
  engine_type?: string;
  cost_estimate?: number;
  started_at?: string;
  ended_at?: string | null;
}

interface TraceSpan {
  span_id: string;
  parent_span_id?: string | null;
  name: string;
  span_type: string;
  status: string;
  duration_ms: number;
}

interface TraceResponse {
  trace_id?: string | null;
  span_count?: number;
  spans?: TraceSpan[];
}

interface ExecutionStep {
  id: string;
  label?: string;
  agent?: string;
  phase?: string;
  status?: string;
  duration_ms?: number;
  error?: string;
}

interface ExecutionStepsResponse {
  execution_steps?: ExecutionStep[];
  tool_calls?: {
    tool_name: string;
    status: string;
  }[];
}

interface ApprovalRequest {
  approval_id: string;
  approval_type: string;
  status: string;
  reason?: string;
  requested_by?: string;
  created_at?: string;
}

function compactNumber(value: number | undefined, digits = 0, locale: Locale = 'en') {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: Math.abs(value || 0) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function money(value: number | undefined) {
  return `$${(value || 0).toFixed(4)}`;
}

function percent(used: number, limit: number | undefined) {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function timeLabel(value: string | null | undefined, pendingLabel: string, unknownLabel: string) {
  if (!value) return pendingLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unknownLabel;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sortedEntries(record: Record<string, number> | undefined, limit = 5) {
  return Object.entries(record || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function translatedKey(t: TranslateFn, prefix: string, value: string | undefined, fallback?: string) {
  const raw = value || fallback || '';
  if (!raw) return '';
  const key = `${prefix}.${raw}`;
  const translated = t(key);
  return translated === key ? raw : translated;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  const { canvasMode } = useChatStore();
  const isLight = canvasMode === 'light';
  return (
    <div className={`rounded-lg border px-4 py-3 ${
      isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{label}</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>{value}</p>
        </div>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={`mt-2 text-[11px] truncate ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{sub}</p>
    </div>
  );
}

function MiniBar({
  label,
  rawLabel,
  value,
  max,
  tone = 'bg-blue-500',
}: {
  label: string;
  rawLabel?: string;
  value: number;
  max: number;
  tone?: string;
}) {
  const { canvasMode } = useChatStore();
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
        <span
          title={rawLabel && rawLabel !== label ? rawLabel : undefined}
          className={`truncate ${canvasMode === 'light' ? 'text-slate-600' : 'text-slate-300'}`}
        >
          {label}
        </span>
        <span className={`tabular-nums ${canvasMode === 'light' ? 'text-slate-500' : 'text-slate-500'}`}>{value}</span>
      </div>
      <div className={`h-2 overflow-hidden rounded-full ${canvasMode === 'light' ? 'bg-slate-100' : 'bg-slate-800'}`}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function OpsDashboard({ open, onClose, embedded = false }: { open: boolean; onClose: () => void; embedded?: boolean }) {
  const { canvasMode } = useChatStore();
  const { t, locale } = useT();
  const isLight = canvasMode === 'light';
  const [metrics, setMetrics] = useState<AuditMetrics | null>(null);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const [steps, setSteps] = useState<ExecutionStepsResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshingRollup, setRefreshingRollup] = useState(false);
  const [error, setError] = useState('');

  const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...enterpriseHeaders(Boolean(init?.body)),
        ...((init?.headers as Record<string, string> | undefined) || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  };

  const approvalBody = (decision: 'approved' | 'rejected') => ({
    ...Object.fromEntries(enterpriseQueryParams().entries()),
    decision,
    comment: `ops_dashboard_${decision}`,
  });

  const loadDashboard = async () => {
    if (!canReadOps()) {
      setMetrics(null);
      setRuns([]);
      setApprovals([]);
      setTrace(null);
      setSteps(null);
      setError(t('auth.adminRequired'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = enterpriseQueryParams().toString();
      const [metricsPayload, runsPayload, approvalsPayload] = await Promise.all([
        fetchJson<AuditMetrics>(`/api/audit/metrics?${query}`),
        fetchJson<{ agent_runs: AgentRunSummary[] }>(`/api/audit/agent-runs?${query}&limit=8`),
        fetchJson<{ approvals: ApprovalRequest[] }>(`/api/approvals?${query}&status=pending&limit=6`),
      ]);
      const nextRuns = runsPayload.agent_runs || [];
      const nextSelectedRunId = selectedRunId || nextRuns[0]?.id || '';
      setMetrics(metricsPayload);
      setRuns(nextRuns);
      setApprovals(approvalsPayload.approvals || []);
      setSelectedRunId(nextSelectedRunId);
      if (nextSelectedRunId) {
        const [tracePayload, stepsPayload] = await Promise.all([
          fetchJson<TraceResponse>(`/api/audit/agent-runs/${nextSelectedRunId}/trace?${query}`),
          fetchJson<ExecutionStepsResponse>(`/api/audit/agent-runs/${nextSelectedRunId}/steps?${query}`),
        ]);
        setTrace(tracePayload);
        setSteps(stepsPayload);
      } else {
        setTrace(null);
        setSteps(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const decideApproval = async (approvalId: string, decision: 'approved' | 'rejected') => {
    setError('');
    try {
      await fetchJson(`/api/approvals/${approvalId}/decision`, {
        method: 'POST',
        body: JSON.stringify(approvalBody(decision)),
      });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const refreshRollup = async () => {
    setRefreshingRollup(true);
    setError('');
    try {
      await fetchJson(`/api/audit/usage-rollups/refresh?${enterpriseQueryParams().toString()}&scope=tenant`, {
        method: 'POST',
      });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingRollup(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadDashboard();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !selectedRunId) return;
    if (!canReadOps()) return;
    const query = enterpriseQueryParams().toString();
    Promise.all([
      fetchJson<TraceResponse>(`/api/audit/agent-runs/${selectedRunId}/trace?${query}`),
      fetchJson<ExecutionStepsResponse>(`/api/audit/agent-runs/${selectedRunId}/steps?${query}`),
    ])
      .then(([tracePayload, stepsPayload]) => {
        setTrace(tracePayload);
        setSteps(stepsPayload);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedRunId, open]);

  const budget = metrics?.budget;
  const usage = budget?.usage || {};
  const budgetLimit = budget?.budget || {};
  const remaining = budget?.remaining || {};
  const queueTotals = metrics?.queue_health?.totals || {};
  const approvalMetrics = metrics?.approval_requests || {};
  const costPct = percent(usage.estimated_cost || 0, budgetLimit.monthly_cost_limit);
  const tokenPct = percent(usage.estimated_total_tokens || 0, budgetLimit.monthly_token_limit);
  const maxStatusCount = Math.max(1, ...sortedEntries(metrics?.agent_runs?.status_counts).map(([, count]) => count));
  const maxEventCount = Math.max(1, ...sortedEntries(metrics?.audit_events?.event_type_counts).map(([, count]) => count));
  const traceTotalDuration = useMemo(
    () => (trace?.spans || []).reduce((sum, span) => sum + (span.duration_ms || 0), 0),
    [trace],
  );
  const stepTotalDuration = useMemo(
    () => (steps?.execution_steps || []).reduce((sum, step) => sum + (step.duration_ms || 0), 0),
    [steps],
  );
  const compact = (value: number | undefined, digits = 0) => compactNumber(value, digits, locale);
  const statusLabel = (value: string | undefined) => translatedKey(t, 'ops.status', value, t('common.unknown'));
  const phaseLabel = (value: string | undefined) => translatedKey(t, 'ops.phase', value, t('common.unknown'));
  const agentLabel = (value: string | undefined) => translatedKey(t, 'ops.agent', value, t('common.unknown'));
  const engineLabel = (value: string | undefined) => translatedKey(t, 'ops.engine', value, t('common.unknown'));
  const eventLabel = (value: string | undefined) => translatedKey(t, 'ops.event', value, t('common.unknown'));
  const sourceLabel = (value: string | undefined) => translatedKey(t, 'ops.source', value, value || t('common.unknown'));
  const scopeLabel = (value: string | undefined) => translatedKey(t, 'ops.scopeValue', value, value || t('common.unknown'));
  const approvalTypeLabel = (value: string | undefined) => translatedKey(t, 'ops.approvalType', value, value || t('common.unknown'));
  const spanTypeLabel = (value: string | undefined) => translatedKey(t, 'ops.spanType', value, value || t('common.unknown'));
  const stepLabel = (step: ExecutionStep) => translatedKey(t, 'ops.step', step.id, step.label || step.id);

  if (!open) return null;

  const shellClass = embedded
    ? `w-full ${isLight ? 'text-slate-900' : 'text-slate-100'}`
    : `flex h-full w-full flex-col overflow-hidden max-w-6xl rounded-xl border shadow-2xl ${
        isLight ? 'border-slate-200 bg-slate-50 text-slate-900' : 'border-slate-800 bg-slate-950 text-slate-100'
      }`;
  const headerClass = embedded
    ? `mb-4 flex items-center justify-between rounded-lg border px-4 py-3 ${
        isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
      }`
    : `flex items-center justify-between border-b px-5 py-4 ${
        isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
      }`;
  const bodyClass = embedded ? 'space-y-4' : 'flex-1 overflow-y-auto p-5';
  const metricGridClass = embedded ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'grid gap-3 md:grid-cols-2 lg:grid-cols-6';
  const budgetSignalGridClass = embedded ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4 lg:grid-cols-[1fr_1.1fr]';
  const signalsGridClass = embedded ? 'grid gap-4' : 'grid gap-5 md:grid-cols-2';
  const approvalsGridClass = embedded ? 'grid gap-2 p-3 md:grid-cols-2' : 'grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3';
  const runExecutionGridClass = embedded ? 'mt-4 grid gap-4 xl:grid-cols-2' : 'mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]';

  const content = (
      <section className={shellClass}>
        <header className={headerClass}>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              isLight ? 'bg-slate-900 text-white' : 'bg-white text-slate-950'
            }`}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{t('ops.title')}</h2>
              <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {budget?.period || t('ops.periodCurrent')} · {sourceLabel(usage.source || 'agent_runs')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshRollup}
              disabled={refreshingRollup || loading}
              title={t('ops.rollup')}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
                isLight
                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {refreshingRollup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5" />}
              {t('ops.rollup')}
            </button>
            <button
              onClick={loadDashboard}
              disabled={loading}
              title={t('ops.refreshMetrics')}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                isLight
                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            {!embedded && (
              <button
                onClick={onClose}
                title={t('common.close')}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  isLight ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className={`mx-5 mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            isLight ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
          }`}>
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        <div className={bodyClass}>
          <div className={metricGridClass}>
            <MetricTile
              icon={Workflow}
              label={t('ops.agentRuns')}
              value={compact(metrics?.agent_runs?.total)}
              sub={t('ops.usageScope', { count: compact(usage.run_count) })}
              accent={isLight ? 'bg-blue-50 text-blue-700' : 'bg-blue-500/10 text-blue-300'}
            />
            <MetricTile
              icon={Coins}
              label={t('ops.estimatedCost')}
              value={money(metrics?.agent_runs?.estimated_cost)}
              sub={t('ops.remaining', { value: money(remaining.cost ?? undefined) })}
              accent={isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-300'}
            />
            <MetricTile
              icon={Gauge}
              label={t('ops.estimatedTokens')}
              value={compact((metrics?.agent_runs?.estimated_input_tokens || 0) + (metrics?.agent_runs?.estimated_output_tokens || 0))}
              sub={t('ops.remaining', { value: compact(remaining.tokens ?? undefined) })}
              accent={isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-500/10 text-amber-300'}
            />
            <MetricTile
              icon={ShieldCheck}
              label={t('ops.auditEvents')}
              value={compact(metrics?.audit_events?.total)}
              sub={t('ops.scope', { scope: scopeLabel(budget?.scope || 'tenant') })}
              accent={isLight ? 'bg-cyan-50 text-cyan-700' : 'bg-cyan-500/10 text-cyan-300'}
            />
            <MetricTile
              icon={UserCheck}
              label={t('ops.approvals')}
              value={compact(approvalMetrics.pending)}
              sub={t('ops.totalCheckpoints', { count: compact(approvalMetrics.total) })}
              accent={isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/10 text-rose-300'}
            />
            <MetricTile
              icon={Loader2}
              label={t('ops.queuedJobs')}
              value={compact(queueTotals.queued)}
              sub={t('ops.queueState', { running: compact(queueTotals.running), failed: compact(queueTotals.failed) })}
              accent={isLight ? 'bg-violet-50 text-violet-700' : 'bg-violet-500/10 text-violet-300'}
            />
          </div>

          <div className={`mt-4 ${budgetSignalGridClass}`}>
            <section className={`rounded-lg border p-4 ${
              isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
            }`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  {t('ops.budget')}
                </h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  usage.source === 'rollup'
                    ? isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-300'
                    : isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'
                }`}>
                  {sourceLabel(usage.source || 'agent_runs')}
                </span>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className={isLight ? 'text-slate-600' : 'text-slate-300'}>{t('ops.cost')}</span>
                    <span className="tabular-nums">{costPct.toFixed(1)}%</span>
                  </div>
                  <div className={`h-2.5 overflow-hidden rounded-full ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${costPct}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className={isLight ? 'text-slate-600' : 'text-slate-300'}>{t('ops.tokens')}</span>
                    <span className="tabular-nums">{tokenPct.toFixed(1)}%</span>
                  </div>
                  <div className={`h-2.5 overflow-hidden rounded-full ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${tokenPct}%` }} />
                  </div>
                </div>
                <div className={`grid grid-cols-2 gap-3 border-t pt-4 text-[11px] ${
                  isLight ? 'border-slate-100 text-slate-600' : 'border-slate-800 text-slate-400'
                }`}>
                  <span>{t('ops.costLimit')}</span>
                  <span className="text-right tabular-nums">{money(budgetLimit.monthly_cost_limit)}</span>
                  <span>{t('ops.tokenLimit')}</span>
                  <span className="text-right tabular-nums">{compact(budgetLimit.monthly_token_limit)}</span>
                  <span>{t('ops.hardLimit')}</span>
                  <span className="text-right">{budgetLimit.hard_limit_enabled ? t('common.enabled') : t('common.disabled')}</span>
                  <span>{t('ops.rolledUp')}</span>
                  <span className="text-right">{timeLabel(usage.rolled_up_at, t('common.pending'), t('common.unknown'))}</span>
                </div>
              </div>
            </section>

            <section className={`rounded-lg border p-4 ${
              isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
            }`}>
              <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold">
                <Activity className="h-4 w-4 text-cyan-500" />
                {t('ops.signals')}
              </h3>
              <div className={signalsGridClass}>
                <div className="space-y-3">
                  {sortedEntries(metrics?.agent_runs?.status_counts).map(([label, value]) => (
                    <MiniBar key={label} label={statusLabel(label)} rawLabel={label} value={value} max={maxStatusCount} tone="bg-blue-500" />
                  ))}
                  {sortedEntries(metrics?.agent_runs?.status_counts).length === 0 && (
                    <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('ops.noRuns')}</p>
                  )}
                </div>
                <div className="space-y-3">
                  {sortedEntries(metrics?.audit_events?.event_type_counts).map(([label, value]) => (
                    <MiniBar key={label} label={eventLabel(label)} rawLabel={label} value={value} max={maxEventCount} tone="bg-cyan-500" />
                  ))}
                  {sortedEntries(metrics?.audit_events?.event_type_counts).length === 0 && (
                    <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('ops.noEvents')}</p>
                  )}
                </div>
              </div>
            </section>
          </div>

          <section className={`mt-4 rounded-lg border ${
            isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
          }`}>
            <div className={`flex items-center justify-between border-b px-4 py-3 ${
              isLight ? 'border-slate-100' : 'border-slate-800'
            }`}>
              <h3 className="flex items-center gap-2 text-xs font-semibold">
                <UserCheck className="h-4 w-4 text-rose-500" />
                {t('ops.pendingApprovals')}
              </h3>
              <span className={`text-[10px] tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                {t('ops.pendingCount', { count: approvalMetrics.pending || approvals.length })}
              </span>
            </div>
            <div className={approvalsGridClass}>
              {approvals.map((approval) => (
                <div key={approval.approval_id} className={`rounded-md border px-3 py-2 ${
                  isLight ? 'border-slate-100 bg-slate-50' : 'border-slate-800 bg-slate-950'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium" title={approval.approval_type}>
                        {approvalTypeLabel(approval.approval_type || 'approval')}
                      </p>
                      <p className={`mt-1 line-clamp-2 text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        {approval.reason || approval.approval_id}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-500/10 text-amber-300'
                    }`}>
                      {statusLabel(approval.status)}
                    </span>
                  </div>
                  <div className={`mt-2 flex items-center justify-between gap-2 border-t pt-2 ${
                    isLight ? 'border-slate-100' : 'border-slate-800'
                  }`}>
                    <span className={`truncate text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                      {timeLabel(approval.created_at, t('common.pending'), t('common.unknown'))} · {approval.requested_by || t('common.unknown')}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => void decideApproval(approval.approval_id, 'rejected')}
                        title={t('ops.rejectTitle')}
                        className={`h-7 rounded-md border px-2 text-[10px] font-medium ${
                          isLight
                            ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {t('ops.reject')}
                      </button>
                      <button
                        onClick={() => void decideApproval(approval.approval_id, 'approved')}
                        title={t('ops.approveTitle')}
                        className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                          isLight
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'bg-white text-slate-950 hover:bg-slate-200'
                        }`}
                      >
                        {t('ops.approve')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {approvals.length === 0 && (
                <div className={`col-span-full px-3 py-8 text-center text-xs ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                  {t('ops.noPendingApprovals')}
                </div>
              )}
            </div>
          </section>

          <div className={runExecutionGridClass}>
            <section className={`rounded-lg border ${
              isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
            }`}>
              <div className={`flex items-center justify-between border-b px-4 py-3 ${
                isLight ? 'border-slate-100' : 'border-slate-800'
              }`}>
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <Clock3 className="h-4 w-4 text-amber-500" />
                  {t('ops.recentRuns')}
                </h3>
                <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{runs.length}</span>
              </div>
              <div className="max-h-72 overflow-y-auto p-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`mb-1 flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                      selectedRunId === run.id
                        ? isLight ? 'bg-slate-900 text-white' : 'bg-white text-slate-950'
                        : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium" title={`${run.engine_type || ''} · ${run.status || ''}`}>
                        {engineLabel(run.engine_type)} · {statusLabel(run.status)}
                      </p>
                      <p className={`mt-0.5 truncate text-[10px] ${
                        selectedRunId === run.id ? 'opacity-70' : isLight ? 'text-slate-500' : 'text-slate-500'
                      }`}>
                        {run.id}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums">{money(run.cost_estimate)}</span>
                  </button>
                ))}
                {runs.length === 0 && (
                  <div className={`px-3 py-8 text-center text-xs ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    {t('ops.noRuns')}
                  </div>
                )}
              </div>
            </section>

            <section className={`rounded-lg border ${
              isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
            }`}>
              <div className={`flex items-center justify-between border-b px-4 py-3 ${
                isLight ? 'border-slate-100' : 'border-slate-800'
              }`}>
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <GitBranch className="h-4 w-4 text-emerald-500" />
                  {t('ops.execution')}
                </h3>
                <span className={`text-[10px] tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                  {t('ops.stepsDuration', { steps: (steps?.execution_steps || []).length, duration: stepTotalDuration.toFixed(1) })}
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto p-3">
                {(steps?.execution_steps || []).map((step) => (
                  <div key={step.id} className={`mb-2 rounded-md border px-3 py-2 ${
                    isLight ? 'border-slate-100 bg-slate-50' : 'border-slate-800 bg-slate-950'
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {step.status === 'succeeded'
                          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          : step.status === 'pending' || step.status === 'skipped'
                            ? <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                        }
                        <span className="truncate text-xs font-medium" title={step.label || step.id}>{stepLabel(step)}</span>
                      </div>
                      <span className={`shrink-0 text-[10px] tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        {(step.duration_ms || 0).toFixed(1)}ms
                      </span>
                    </div>
                    <p className={`mt-1 truncate text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                      {agentLabel(step.agent || 'agent')} · {phaseLabel(step.phase || 'phase')} · {statusLabel(step.status)}
                    </p>
                  </div>
                ))}
                {(!steps?.execution_steps || steps.execution_steps.length === 0) && (
                  <div className={`px-3 py-8 text-center text-xs ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    {t('ops.noExecutionSteps')}
                  </div>
                )}
                <div className={`my-3 border-t ${isLight ? 'border-slate-100' : 'border-slate-800'}`} />
                <div className={`mb-2 flex justify-between text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                  <span>{t('ops.traceSpans')}</span>
                  <span>{trace?.span_count || 0} · {traceTotalDuration.toFixed(1)}ms</span>
                </div>
                {(trace?.spans || []).map((span) => (
                  <div key={span.span_id} className={`mb-2 rounded-md border px-3 py-2 ${
                    isLight ? 'border-slate-100 bg-slate-50' : 'border-slate-800 bg-slate-950'
                  }`} style={{ marginLeft: span.parent_span_id ? 18 : 0 }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {span.status === 'succeeded'
                          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                        }
                        <span className="truncate text-xs font-medium">{span.name}</span>
                      </div>
                      <span className={`shrink-0 text-[10px] tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        {(span.duration_ms || 0).toFixed(1)}ms
                      </span>
                    </div>
                    <p className={`mt-1 text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                      {spanTypeLabel(span.span_type)} · {span.span_id}
                    </p>
                  </div>
                ))}
                {(!trace?.spans || trace.spans.length === 0) && (
                  <div className={`px-3 py-8 text-center text-xs ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    {t('ops.noTraceSpans')}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
  );

  if (embedded) return content;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      {content}
    </div>
  );
}
