import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Coins,
  Gauge,
  Loader2,
  MessageSquare,
  Presentation,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  UserRound,
  Users,
  Workflow,
  UserX,
} from "lucide-react";
import { useT, type Locale } from "@/app/i18n";
import { API_BASE, enterpriseHeaders } from "@/shared/lib/config/enterpriseContext";
import { readAuthSession } from "@/shared/lib/config/auth";
import { PlatformQuotaProfilesPanel, formatQuotaUsage } from "@/shared/ui/settings/PlatformQuotaProfilesPanel";

interface PlatformGuestStats {
  ai_calls: number;
  diagram_calls: number;
  ppt_calls: number;
  estimated_total_tokens: number;
  estimated_cost: number;
}

interface PlatformGuestItem {
  id: string;
  kind: "guest";
  source?: "session" | "legacy_user";
  status: string;
  email?: string;
  display_name?: string;
  tenant_id?: string;
  tenant_name?: string;
  created_at: string;
  expires_at: string;
  last_active_at: string;
  stats: PlatformGuestStats;
}

interface PlatformSummary {
  total: number;
  tenant_count?: number;
  active?: number;
  ai_calls?: number;
  estimated_total_tokens: number;
  estimated_cost: number;
  ppt_model_calls?: number;
}

type PlatformTab = "registered" | "guests" | "quotas";

interface PlatformUserQuotaSnapshot {
  limits?: {
    daily_token_limit?: number;
    monthly_token_limit?: number;
    monthly_cost_limit?: number;
    hard_limit_enabled?: boolean;
  };
  usage?: {
    daily?: { total_tokens?: number; estimated_cost?: number };
    monthly?: { total_tokens?: number; estimated_cost?: number };
  };
  remaining?: {
    daily_tokens?: number | null;
    monthly_tokens?: number | null;
    monthly_cost?: number | null;
  };
}

interface PlatformUserStats {
  total_runs: number;
  total_conversations: number;
  total_diagrams: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_total_tokens: number;
  estimated_cost: number;
  ppt_model_calls: number;
  ppt_total_tokens: number;
  ppt_estimated_cost: number;
  diagram_model_calls: number;
  diagram_total_tokens: number;
  last_active_at: string;
}

interface PlatformUserItem {
  id: string;
  email: string;
  display_name: string;
  role: string;
  platform_roles?: string[];
  account_tier?: string;
  account_kind?: string;
  principal_kind?: string;
  effective_scope_count?: number;
  quota?: PlatformUserQuotaSnapshot;
  status: string;
  tenant_id: string;
  tenant_name: string;
  created_at: string;
  stats: PlatformUserStats;
}

const ACCOUNT_TIERS = ["free", "standard", "pro", "enterprise"] as const;
const ACCOUNT_KINDS = ["customer", "internal", "test", "demo"] as const;
const TENANT_ROLES = ["member", "admin", "owner"] as const;

const tenantRoleKey = (role: string) => `platform.tenantRole.${role}`;

const statusKey = (status: string) => `platform.status.${status}`;

const translateEnum = (
  t: (key: string) => string,
  keyFor: (value: string) => string,
  value: string
) => {
  const key = keyFor(value);
  const translated = t(key);
  return translated === key ? value : translated;
};

function compactNumber(value: number, locale: Locale = "zh") {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 0
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

export default function PlatformUserCenterPanel({
  open,
  isLight = true
}: {
  open: boolean;
  isLight?: boolean;
}) {
  const { t, locale } = useT();
  const currentUserId = readAuthSession()?.user.id ?? "";
  const [users, setUsers] = useState<PlatformUserItem[]>([]);
  const [guests, setGuests] = useState<PlatformGuestItem[]>([]);
  const [registeredSummary, setRegisteredSummary] = useState<PlatformSummary | null>(null);
  const [guestSummary, setGuestSummary] = useState<PlatformSummary | null>(null);
  const [activeTab, setActiveTab] = useState<PlatformTab>("registered");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [roleUpdatingId, setRoleUpdatingId] = useState<string | null>(null);
  const [roleNotice, setRoleNotice] = useState("");
  const [accountUpdatingId, setAccountUpdatingId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/platform/users`, {
        headers: enterpriseHeaders(false)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as {
        users: PlatformUserItem[];
        guests?: PlatformGuestItem[];
        registered_summary?: PlatformSummary;
        guest_summary?: PlatformSummary;
        tenant_count?: number;
      };
      setUsers(payload.users || []);
      setGuests(payload.guests || []);
      setRegisteredSummary(
        payload.registered_summary ?? {
          total: payload.users?.length ?? 0,
          tenant_count: payload.tenant_count ?? 0,
          estimated_total_tokens: 0,
          estimated_cost: 0,
        }
      );
      setGuestSummary(
        payload.guest_summary ?? {
          total: payload.guests?.length ?? 0,
          active: 0,
          ai_calls: 0,
          estimated_total_tokens: 0,
          estimated_cost: 0,
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadUsers();
  }, [open]);

  const platformRoleErrorMessage = (detail: string) => {
    if (detail === "last_platform_admin") return t("platform.lastPlatformAdmin");
    if (detail === "legacy_guest_not_eligible") return t("platform.legacyGuestNotEligible");
    if (detail === "cannot_modify_self") return t("platform.cannotModifySelf");
    if (detail === "user_not_found") return t("platform.userNotFound");
    return detail;
  };

  const accountProfileErrorMessage = (detail: string) => {
    if (detail === "cannot_modify_self") return t("platform.cannotModifySelf");
    if (detail === "legacy_guest_not_eligible") return t("platform.legacyGuestNotEligible");
    if (detail === "user_not_found") return t("platform.userNotFound");
    return detail;
  };

  const togglePlatformAdmin = async (user: PlatformUserItem, enabled: boolean) => {
    if (user.id === currentUserId) {
      setRoleNotice(t("platform.cannotModifySelf"));
      return;
    }
    setRoleUpdatingId(user.id);
    setRoleNotice("");
    try {
      const res = await fetch(`${API_BASE}/api/platform/users/${encodeURIComponent(user.id)}/platform-roles`, {
        method: "PATCH",
        headers: enterpriseHeaders(),
        body: JSON.stringify({ platform_admin: enabled }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        detail?: string;
        platform_roles?: string[];
      };
      if (!res.ok) {
        throw new Error(platformRoleErrorMessage(String(payload.detail || `HTTP ${res.status}`)));
      }
      const nextRoles = payload.platform_roles || [];
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? { ...item, platform_roles: nextRoles } : item))
      );
      setRoleNotice(
        enabled ? t("platform.platformAdminGranted", { name: user.display_name || user.email }) : t("platform.platformAdminRevoked", { name: user.display_name || user.email })
      );
    } catch (err) {
      setRoleNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setRoleUpdatingId(null);
    }
  };

  const updateUserAccount = async (
    user: PlatformUserItem,
    patch: { account_tier?: string; account_kind?: string; tenant_role?: string }
  ) => {
    if (user.id === currentUserId) {
      setRoleNotice(t("platform.cannotModifySelf"));
      return;
    }
    setAccountUpdatingId(user.id);
    setRoleNotice("");
    try {
      const res = await fetch(`${API_BASE}/api/platform/users/${encodeURIComponent(user.id)}/account`, {
        method: "PATCH",
        headers: enterpriseHeaders(),
        body: JSON.stringify(patch),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        detail?: string;
        role?: string;
        account_tier?: string;
        account_kind?: string;
        effective_scopes?: string[];
      };
      if (!res.ok) {
        throw new Error(accountProfileErrorMessage(String(payload.detail || `HTTP ${res.status}`)));
      }
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id
            ? {
                ...item,
                role: payload.role ?? item.role,
                account_tier: payload.account_tier ?? item.account_tier,
                account_kind: payload.account_kind ?? item.account_kind,
                effective_scope_count: payload.effective_scopes?.length ?? item.effective_scope_count,
              }
            : item
        )
      );
      setRoleNotice(t("platform.accountProfileSaved", { name: user.display_name || user.email }));
    } catch (err) {
      setRoleNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setAccountUpdatingId(null);
    }
  };

  if (!open) return null;

  const cardClass = isLight ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-900/80";
  const mutedClass = isLight ? "text-slate-500" : "text-slate-400";
  const compact = (v: number) => compactNumber(v, locale);
  const reg = registeredSummary ?? { total: users.length, estimated_total_tokens: 0, estimated_cost: 0 };
  const guest = guestSummary ?? { total: guests.length, active: 0, ai_calls: 0, estimated_total_tokens: 0, estimated_cost: 0 };

  return (
    <div>
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t("settings.platformUsersTitle")}</h2>
            <p className={`mt-1 max-w-2xl text-sm ${mutedClass}`}>{t("settings.platformUsersDescription")}</p>
          </div>
          <button
            onClick={() => void loadUsers()}
            disabled={loading}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              isLight
                ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error ? (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            isLight ? "border-rose-200 bg-rose-50 text-rose-700" : "border-rose-500/20 bg-rose-500/10 text-rose-300"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          {t("users.loadFailed")}: {error}
        </div>
      ) : null}

      {roleNotice ? (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            isLight ? "border-sky-200 bg-sky-50 text-sky-700" : "border-sky-500/20 bg-sky-500/10 text-sky-300"
          }`}
        >
          {roleNotice}
        </div>
      ) : null}

      <div className="mb-4">
        <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>{t("platform.sectionRegistered")}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("platform.registeredUsers")} value={String(reg.total)} icon={<Users className="h-4 w-4" />} tone="violet" />
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("platform.totalTenants")} value={String(reg.tenant_count ?? 0)} icon={<Building2 className="h-4 w-4" />} tone="blue" />
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("users.totalTokens")} value={compact(reg.estimated_total_tokens)} icon={<Gauge className="h-4 w-4" />} tone="amber" />
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("platform.totalPptCalls")} value={compact(reg.ppt_model_calls ?? 0)} sub={money(reg.estimated_cost)} icon={<Presentation className="h-4 w-4" />} tone="emerald" />
        </div>
      </div>

      <div className="mb-5">
        <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>{t("platform.sectionGuests")}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("platform.guestSessions")} value={String(guest.total)} icon={<UserX className="h-4 w-4" />} tone="violet" />
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("platform.activeGuests")} value={String(guest.active ?? 0)} icon={<UserRound className="h-4 w-4" />} tone="blue" />
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("platform.guestAiCalls")} value={compact(guest.ai_calls ?? 0)} icon={<Workflow className="h-4 w-4" />} tone="amber" />
          <SummaryTile cardClass={cardClass} mutedClass={mutedClass} isLight={isLight} label={t("users.totalTokens")} value={compact(guest.estimated_total_tokens)} sub={money(guest.estimated_cost)} icon={<Gauge className="h-4 w-4" />} tone="emerald" />
        </div>
      </div>

      <div className={`mb-4 flex gap-2 border-b ${isLight ? "border-slate-200" : "border-slate-800"}`}>
        <TabButton active={activeTab === "registered"} onClick={() => setActiveTab("registered")} isLight={isLight}>
          {t("platform.tabRegistered")} ({reg.total})
        </TabButton>
        <TabButton active={activeTab === "guests"} onClick={() => setActiveTab("guests")} isLight={isLight}>
          {t("platform.tabGuests")} ({guest.total})
        </TabButton>
        <TabButton active={activeTab === "quotas"} onClick={() => setActiveTab("quotas")} isLight={isLight}>
          {t("platform.tabQuotaProfiles")}
        </TabButton>
      </div>

      {activeTab === "quotas" ? (
        <PlatformQuotaProfilesPanel open isLight={isLight} />
      ) : (
      <div className="space-y-3">
        {activeTab === "registered"
          ? users.map((user) => {
          const isAdmin = user.role === "admin" || user.role === "owner";
          const isPlatformAdmin = (user.platform_roles || []).includes("platform_admin");
          const isSelf = user.id === currentUserId;
          const permissionLocked = isSelf || accountUpdatingId === user.id;
          return (
            <div key={user.id} className={`overflow-hidden rounded-lg border ${cardClass}`}>
              <div
                className={`flex items-center justify-between gap-4 border-b px-4 py-3 ${
                  isLight ? "border-slate-100" : "border-slate-800"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isAdmin
                        ? isLight
                          ? "bg-blue-50 text-blue-600"
                          : "bg-blue-500/10 text-blue-200"
                        : isLight
                          ? "bg-slate-100 text-slate-600"
                          : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {isAdmin ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{user.display_name || user.email}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isAdmin
                            ? isLight
                              ? "bg-blue-50 text-blue-700"
                              : "bg-blue-500/10 text-blue-200"
                            : isLight
                              ? "bg-slate-100 text-slate-600"
                              : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {translateEnum(t, tenantRoleKey, user.role)}
                      </span>
                      {isPlatformAdmin ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isLight ? "bg-indigo-50 text-indigo-700" : "bg-indigo-500/10 text-indigo-300"
                          }`}
                        >
                          {t("platform.badge.platformAdmin")}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          user.status === "active"
                            ? isLight
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-emerald-500/10 text-emerald-300"
                            : isLight
                              ? "bg-slate-100 text-slate-500"
                              : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {translateEnum(t, statusKey, user.status)}
                      </span>
                    </div>
                    <div className={`mt-0.5 text-[12px] ${mutedClass}`}>
                      {user.email}
                      <span className="mx-1.5">·</span>
                      {user.tenant_name}
                      <span className="mx-1.5">·</span>
                      {user.tenant_id}
                    </div>
                  </div>
                </div>
                <div className={`shrink-0 text-right text-[11px] ${mutedClass}`}>
                  <div>{t("users.lastActive")}</div>
                  <div className={`mt-0.5 font-medium ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                    {relativeTime(user.stats.last_active_at, t("users.neverActive"))}
                  </div>
                </div>
              </div>

              <div
                className={`border-b px-4 py-3 text-[11px] ${
                  isLight ? "border-slate-100 bg-slate-50/80" : "border-slate-800 bg-slate-900/40"
                }`}
              >
                <p className={`mb-2 text-[10px] font-semibold uppercase tracking-wide ${mutedClass}`}>
                  {t("platform.sectionTenantAccess")}
                </p>
                {isSelf ? (
                  <p className={`mb-2 text-[11px] ${isLight ? "text-amber-700" : "text-amber-300"}`}>
                    {t("platform.selfPermissionLocked")}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                <label className={`inline-flex items-center gap-1.5 ${mutedClass}`}>
                  {t("platform.accountTier")}
                  <select
                    disabled={permissionLocked}
                    value={user.account_tier || "standard"}
                    onChange={(event) =>
                      void updateUserAccount(user, { account_tier: event.target.value })
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      isLight ? "border-slate-200 bg-white text-slate-700" : "border-slate-700 bg-slate-900 text-slate-200"
                    }`}
                  >
                    {ACCOUNT_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {t(`platform.tier.${tier}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`inline-flex items-center gap-1.5 ${mutedClass}`}>
                  {t("platform.accountKind")}
                  <select
                    disabled={permissionLocked}
                    value={user.account_kind || "customer"}
                    onChange={(event) =>
                      void updateUserAccount(user, { account_kind: event.target.value })
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      isLight ? "border-slate-200 bg-white text-slate-700" : "border-slate-700 bg-slate-900 text-slate-200"
                    }`}
                  >
                    {ACCOUNT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`platform.kind.${kind}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`inline-flex items-center gap-1.5 ${mutedClass}`}>
                  {t("platform.tenantRole")}
                  <select
                    disabled={permissionLocked}
                    value={user.role}
                    onChange={(event) =>
                      void updateUserAccount(user, { tenant_role: event.target.value })
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      isLight ? "border-slate-200 bg-white text-slate-700" : "border-slate-700 bg-slate-900 text-slate-200"
                    }`}
                  >
                    {TENANT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t(tenantRoleKey(role))}
                      </option>
                    ))}
                  </select>
                </label>
                <span className={`ml-auto tabular-nums ${mutedClass}`}>
                  {t("platform.effectiveScopes")}: {user.effective_scope_count ?? 0}
                </span>
                </div>
              </div>

              <div
                className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-[11px] ${
                  isLight ? "border-slate-100 bg-slate-50/50" : "border-slate-800 bg-slate-900/30"
                }`}
              >
                <div>
                  <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${mutedClass}`}>
                    {t("platform.sectionPlatformAccess")}
                  </p>
                  <p className={mutedClass}>
                    {isSelf ? t("platform.selfPermissionLocked") : t("platform.platformAdminDescription")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSelf || roleUpdatingId === user.id}
                  onClick={() => void togglePlatformAdmin(user, !isPlatformAdmin)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    isPlatformAdmin
                      ? isLight
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                        : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                      : isLight
                        ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {roleUpdatingId === user.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isPlatformAdmin ? (
                    <ShieldOff className="h-3 w-3" />
                  ) : (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                  {isPlatformAdmin ? t("platform.revokePlatformAdmin") : t("platform.grantPlatformAdmin")}
                </button>
              </div>

              {user.quota ? (
                <div
                  className={`grid grid-cols-1 gap-2 border-b px-4 py-3 text-[11px] sm:grid-cols-3 ${
                    isLight ? "border-slate-100 bg-slate-50/40" : "border-slate-800 bg-slate-900/20"
                  }`}
                >
                  <div className={mutedClass}>
                    <div>{t("platform.quotaDailyUsage")}</div>
                    <div className={`mt-0.5 font-medium tabular-nums ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                      {formatQuotaUsage(
                        user.quota.usage?.daily?.total_tokens ?? 0,
                        user.quota.limits?.daily_token_limit,
                        t("platform.quotaUnlimited")
                      )}
                    </div>
                  </div>
                  <div className={mutedClass}>
                    <div>{t("platform.quotaMonthlyUsage")}</div>
                    <div className={`mt-0.5 font-medium tabular-nums ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                      {formatQuotaUsage(
                        user.quota.usage?.monthly?.total_tokens ?? 0,
                        user.quota.limits?.monthly_token_limit,
                        t("platform.quotaUnlimited")
                      )}
                    </div>
                  </div>
                  <div className={mutedClass}>
                    <div>{t("platform.quotaMonthlyCostUsage")}</div>
                    <div className={`mt-0.5 font-medium tabular-nums ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                      {formatQuotaUsage(
                        Math.round((user.quota.usage?.monthly?.estimated_cost ?? 0) * 10000) / 10000,
                        user.quota.limits?.monthly_cost_limit,
                        t("platform.quotaUnlimited")
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-px px-4 py-3 sm:grid-cols-4 xl:grid-cols-8">
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.runs")} value={compact(user.stats.total_runs)} icon={<Workflow className="h-3 w-3" />} tone="blue" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.conversations")} value={compact(user.stats.total_conversations)} icon={<MessageSquare className="h-3 w-3" />} tone="cyan" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.diagrams")} value={compact(user.stats.total_diagrams)} icon={<BarChart3 className="h-3 w-3" />} tone="violet" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("platform.pptCalls")} value={compact(user.stats.ppt_model_calls)} icon={<Presentation className="h-3 w-3" />} tone="pink" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("platform.pptTokens")} value={compact(user.stats.ppt_total_tokens)} icon={<Gauge className="h-3 w-3" />} tone="amber" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.inputTokens")} value={compact(user.stats.estimated_input_tokens)} icon={<Gauge className="h-3 w-3" />} tone="orange" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.outputTokens")} value={compact(user.stats.estimated_output_tokens)} icon={<Gauge className="h-3 w-3" />} tone="orange" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.totalCost")} value={money(user.stats.estimated_cost)} icon={<Coins className="h-3 w-3" />} tone="emerald" />
              </div>
            </div>
          );
        })
          : guests.map((guestItem) => {
          const isLegacy = guestItem.source === "legacy_user";
          const title = isLegacy
            ? guestItem.display_name || guestItem.email || guestItem.id
            : t("platform.guestId");
          const subtitle = isLegacy
            ? [guestItem.email, guestItem.tenant_name, guestItem.tenant_id].filter(Boolean).join(" · ")
            : guestItem.id;
          return (
            <div key={`${guestItem.source ?? "session"}:${guestItem.id}`} className={`overflow-hidden rounded-lg border ${cardClass}`}>
              <div className={`flex items-center justify-between gap-4 border-b px-4 py-3 ${isLight ? "border-slate-100" : "border-slate-800"}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-amber-50 text-amber-700" : "bg-amber-500/10 text-amber-300"}`}>
                    <UserX className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isLight ? "bg-amber-50 text-amber-700" : "bg-amber-500/10 text-amber-300"}`}>
                        {t("platform.badge.guest")}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        guestItem.status === "active"
                          ? (isLight ? "bg-emerald-50 text-emerald-700" : "bg-emerald-500/10 text-emerald-300")
                          : guestItem.status === "legacy"
                            ? (isLight ? "bg-slate-100 text-slate-600" : "bg-slate-800 text-slate-300")
                            : (isLight ? "bg-slate-100 text-slate-500" : "bg-slate-800 text-slate-400")
                      }`}>
                        {guestItem.status === "legacy"
                          ? t("platform.legacyGuest")
                          : translateEnum(t, statusKey, guestItem.status)}
                      </span>
                    </div>
                    <div className={`mt-0.5 truncate text-[12px] ${mutedClass}`}>{subtitle}</div>
                  </div>
                </div>
                <div className={`shrink-0 text-right text-[11px] ${mutedClass}`}>
                  <div>{t("users.lastActive")}</div>
                  <div className={`mt-0.5 font-medium ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                    {relativeTime(guestItem.last_active_at, t("users.neverActive"))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px px-4 py-3 sm:grid-cols-4 xl:grid-cols-6">
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("platform.guestAiCalls")} value={compact(guestItem.stats.ai_calls)} icon={<Workflow className="h-3 w-3" />} tone="blue" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.runs")} value={compact(guestItem.stats.diagram_calls)} icon={<BarChart3 className="h-3 w-3" />} tone="violet" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("platform.pptCalls")} value={compact(guestItem.stats.ppt_calls)} icon={<Presentation className="h-3 w-3" />} tone="pink" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.totalTokens")} value={compact(guestItem.stats.estimated_total_tokens)} icon={<Gauge className="h-3 w-3" />} tone="amber" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("users.totalCost")} value={money(guestItem.stats.estimated_cost)} icon={<Coins className="h-3 w-3" />} tone="emerald" />
                <StatCell mutedClass={mutedClass} isLight={isLight} label={t("platform.guestExpires")} value={isLegacy ? "—" : relativeTime(guestItem.expires_at, "—")} icon={<UserRound className="h-3 w-3" />} tone="cyan" />
              </div>
            </div>
          );
        })}

        {!loading && activeTab === "registered" && users.length === 0 ? (
          <p className={`rounded-lg border px-4 py-8 text-center text-sm ${cardClass} ${mutedClass}`}>
            {t("users.noUsers")}
          </p>
        ) : null}
        {!loading && activeTab === "guests" && guests.length === 0 ? (
          <p className={`rounded-lg border px-4 py-8 text-center text-sm ${cardClass} ${mutedClass}`}>
            {t("platform.noGuests")}
          </p>
        ) : null}
      </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  isLight,
  children
}: {
  active: boolean;
  onClick: () => void;
  isLight: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? isLight
            ? "border-blue-600 text-blue-700"
            : "border-blue-400 text-blue-300"
          : isLight
            ? "border-transparent text-slate-500 hover:text-slate-700"
            : "border-transparent text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryTile({
  cardClass,
  mutedClass,
  isLight,
  label,
  value,
  sub,
  icon,
  tone
}: {
  cardClass: string;
  mutedClass: string;
  isLight: boolean;
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone: "blue" | "violet" | "amber" | "emerald";
}) {
  const toneClass = {
    blue: isLight ? "bg-blue-50 text-blue-700" : "bg-blue-500/10 text-blue-300",
    violet: isLight ? "bg-violet-50 text-violet-700" : "bg-violet-500/10 text-violet-300",
    amber: isLight ? "bg-amber-50 text-amber-700" : "bg-amber-500/10 text-amber-300",
    emerald: isLight ? "bg-emerald-50 text-emerald-700" : "bg-emerald-500/10 text-emerald-300"
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-[11px] ${mutedClass}`}>{label}</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${isLight ? "text-slate-950" : "text-slate-100"}`}>{value}</p>
          {sub ? <p className={`mt-0.5 text-[11px] ${mutedClass}`}>{sub}</p> : null}
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
      </div>
    </div>
  );
}

function StatCell({
  mutedClass,
  isLight,
  label,
  value,
  icon,
  tone
}: {
  mutedClass: string;
  isLight: boolean;
  label: string;
  value: string;
  icon: ReactNode;
  tone: string;
}) {
  const toneClass: Record<string, string> = {
    blue: isLight ? "text-blue-500" : "text-blue-400",
    cyan: isLight ? "text-cyan-500" : "text-cyan-400",
    violet: isLight ? "text-violet-500" : "text-violet-400",
    pink: isLight ? "text-pink-500" : "text-pink-400",
    amber: isLight ? "text-amber-500" : "text-amber-400",
    orange: isLight ? "text-orange-500" : "text-orange-400",
    emerald: isLight ? "text-emerald-500" : "text-emerald-400"
  };

  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1">
        <span className={toneClass[tone] || toneClass.blue}>{icon}</span>
        <span className={`text-[10px] ${mutedClass}`}>{label}</span>
      </div>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${isLight ? "text-slate-900" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}
