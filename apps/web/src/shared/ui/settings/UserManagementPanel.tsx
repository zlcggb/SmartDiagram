import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Coins,
  Gauge,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
  Workflow,
} from 'lucide-react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { useT, type Locale } from '@/app/i18n';
import { API_BASE, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext';

interface UserStats {
  total_runs: number;
  total_conversations: number;
  total_diagrams: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_total_tokens: number;
  estimated_cost: number;
  last_active_at: string;
}

interface UserItem {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  tenant_id: string;
  created_at: string;
  stats: UserStats;
}

function compactNumber(value: number, locale: Locale = 'zh') {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 0,
  }).format(value);
}

function money(value: number) {
  return `$${value.toFixed(4)}`;
}

function relativeTime(isoString: string, neverLabel: string): string {
  if (!isoString) return neverLabel;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return neverLabel;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function UserManagementPanel({
  open,
  onClose: _onClose,
  embedded: _embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { canvasMode } = useChatStore();
  const { t, locale } = useT();
  const isLight = canvasMode === 'light';
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        headers: enterpriseHeaders(false),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { users: UserItem[] };
      setUsers(payload.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadUsers();
  }, [open]);

  if (!open) return null;

  const cardClass = isLight
    ? 'border-slate-200 bg-white'
    : 'border-slate-800 bg-slate-900/80';
  const mutedClass = isLight ? 'text-slate-500' : 'text-slate-400';

  // Aggregate totals
  const totalTokens = users.reduce((sum, u) => sum + u.stats.estimated_total_tokens, 0);
  const totalCost = users.reduce((sum, u) => sum + u.stats.estimated_cost, 0);

  const compact = (v: number) => compactNumber(v, locale);

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('settings.usersTitle')}</h2>
            <p className={`mt-1 max-w-2xl text-sm ${mutedClass}`}>{t('settings.usersDescription')}</p>
          </div>
          <button
            onClick={() => void loadUsers()}
            disabled={loading}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              isLight
                ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          isLight ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
        }`}>
          <AlertTriangle className="h-4 w-4" />
          {t('users.loadFailed')}: {error}
        </div>
      )}

      {/* Summary Tiles */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-[11px] ${mutedClass}`}>{t('users.totalUsers')}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>
                {users.length}
              </p>
            </div>
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              isLight ? 'bg-blue-50 text-blue-700' : 'bg-blue-500/10 text-blue-300'
            }`}>
              <Users className="h-4 w-4" />
            </div>
          </div>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-[11px] ${mutedClass}`}>{t('users.totalTokens')}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>
                {compact(totalTokens)}
              </p>
            </div>
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-500/10 text-amber-300'
            }`}>
              <Gauge className="h-4 w-4" />
            </div>
          </div>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-[11px] ${mutedClass}`}>{t('users.totalCost')}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${isLight ? 'text-slate-950' : 'text-slate-100'}`}>
                {money(totalCost)}
              </p>
            </div>
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-300'
            }`}>
              <Coins className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* User Cards */}
      <div className="space-y-3">
        {users.map((user) => {
          const isAdmin = user.role === 'admin' || user.role === 'owner';
          return (
            <div
              key={user.id}
              className={`overflow-hidden rounded-lg border ${cardClass}`}
            >
              {/* User header */}
              <div className={`flex items-center justify-between gap-4 border-b px-4 py-3 ${
                isLight ? 'border-slate-100' : 'border-slate-800'
              }`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    isAdmin
                      ? isLight ? 'bg-blue-50 text-blue-600' : 'bg-blue-500/10 text-blue-200'
                      : isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {isAdmin ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{user.display_name || user.email}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isAdmin
                          ? isLight ? 'bg-blue-50 text-blue-700' : 'bg-blue-500/10 text-blue-200'
                          : isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {user.role}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        user.status === 'active'
                          ? isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-300'
                          : isLight ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {user.status}
                      </span>
                    </div>
                    <div className={`mt-0.5 text-[12px] ${mutedClass}`}>
                      {user.email}
                      <span className="mx-1.5">·</span>
                      {user.tenant_id}
                    </div>
                  </div>
                </div>
                <div className={`shrink-0 text-right text-[11px] ${mutedClass}`}>
                  <div>{t('users.lastActive')}</div>
                  <div className={`mt-0.5 font-medium ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                    {relativeTime(user.stats.last_active_at, t('users.neverActive'))}
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-px px-4 py-3 sm:grid-cols-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Workflow className={`h-3 w-3 ${isLight ? 'text-blue-500' : 'text-blue-400'}`} />
                    <span className={`text-[10px] ${mutedClass}`}>{t('users.runs')}</span>
                  </div>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    {compact(user.stats.total_runs)}
                  </p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <MessageSquare className={`h-3 w-3 ${isLight ? 'text-cyan-500' : 'text-cyan-400'}`} />
                    <span className={`text-[10px] ${mutedClass}`}>{t('users.conversations')}</span>
                  </div>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    {compact(user.stats.total_conversations)}
                  </p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <BarChart3 className={`h-3 w-3 ${isLight ? 'text-violet-500' : 'text-violet-400'}`} />
                    <span className={`text-[10px] ${mutedClass}`}>{t('users.diagrams')}</span>
                  </div>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    {compact(user.stats.total_diagrams)}
                  </p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Gauge className={`h-3 w-3 ${isLight ? 'text-amber-500' : 'text-amber-400'}`} />
                    <span className={`text-[10px] ${mutedClass}`}>{t('users.inputTokens')}</span>
                  </div>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    {compact(user.stats.estimated_input_tokens)}
                  </p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Gauge className={`h-3 w-3 ${isLight ? 'text-orange-500' : 'text-orange-400'}`} />
                    <span className={`text-[10px] ${mutedClass}`}>{t('users.outputTokens')}</span>
                  </div>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    {compact(user.stats.estimated_output_tokens)}
                  </p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Coins className={`h-3 w-3 ${isLight ? 'text-emerald-500' : 'text-emerald-400'}`} />
                    <span className={`text-[10px] ${mutedClass}`}>{t('users.totalCost')}</span>
                  </div>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    {money(user.stats.estimated_cost)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {!loading && users.length === 0 && !error && (
          <div className={`rounded-lg border px-6 py-12 text-center text-sm ${cardClass} ${mutedClass}`}>
            {t('users.noUsers')}
          </div>
        )}

        {loading && users.length === 0 && (
          <div className={`flex items-center justify-center gap-2 rounded-lg border px-6 py-12 ${cardClass} ${mutedClass}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}
      </div>
    </div>
  );
}
