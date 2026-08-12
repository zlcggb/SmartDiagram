import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gauge, Loader2, Save, ShieldAlert } from "lucide-react";
import { useT } from "@/app/i18n";
import { API_BASE, enterpriseHeaders } from "@/shared/lib/config/enterpriseContext";

export interface QuotaProfileRow {
  id?: string;
  profile_type: "account_tier" | "tenant_role";
  profile_key: string;
  daily_token_limit: number;
  monthly_token_limit: number;
  monthly_cost_limit: number;
  hard_limit_enabled: boolean;
}

export interface GuestQuotaSettings {
  max_uses_per_guest: number;
  max_uses_per_ip: number;
  window_seconds: number;
  daily_token_limit: number;
  monthly_token_limit: number;
  monthly_cost_limit: number;
  hard_limit_enabled: boolean;
}

interface PlatformQuotaProfilesPanelProps {
  open: boolean;
  isLight?: boolean;
}

const DEFAULT_GUEST_QUOTA: GuestQuotaSettings = {
  max_uses_per_guest: 5,
  max_uses_per_ip: 20,
  window_seconds: 86400,
  daily_token_limit: 200000,
  monthly_token_limit: 2000000,
  monthly_cost_limit: 2,
  hard_limit_enabled: true,
};

function profileLabel(t: (key: string) => string, row: QuotaProfileRow): string {
  if (row.profile_type === "account_tier") {
    return t(`platform.tier.${row.profile_key}`);
  }
  return t(`platform.tenantRole.${row.profile_key}`);
}

function QuotaProfileTable({
  title,
  rows,
  isLight,
  mutedClass,
  cardClass,
  saving,
  onChange,
  t,
}: {
  title: string;
  rows: QuotaProfileRow[];
  isLight: boolean;
  mutedClass: string;
  cardClass: string;
  saving: boolean;
  onChange: (profileType: QuotaProfileRow["profile_type"], profileKey: string, patch: Partial<QuotaProfileRow>) => void;
  t: (key: string) => string;
}) {
  const inputClass = `w-full rounded-md border px-2 py-1 text-[11px] tabular-nums ${
    isLight ? "border-slate-200 bg-white text-slate-700" : "border-slate-700 bg-slate-900 text-slate-200"
  }`;

  return (
    <div className={`overflow-hidden rounded-lg border ${cardClass}`}>
      <div className={`border-b px-4 py-3 ${isLight ? "border-slate-100" : "border-slate-800"}`}>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[11px]">
          <thead className={isLight ? "bg-slate-50 text-slate-500" : "bg-slate-900/60 text-slate-400"}>
            <tr>
              <th className="px-4 py-2 font-medium">{t("platform.quotaProfileLabel")}</th>
              <th className="px-4 py-2 font-medium">{t("platform.quotaDailyTokens")}</th>
              <th className="px-4 py-2 font-medium">{t("platform.quotaMonthlyTokens")}</th>
              <th className="px-4 py-2 font-medium">{t("platform.quotaMonthlyCost")}</th>
              <th className="px-4 py-2 font-medium">{t("platform.quotaHardLimit")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.profile_type}:${row.profile_key}`}
                className={isLight ? "border-t border-slate-100" : "border-t border-slate-800"}
              >
                <td className="px-4 py-2 font-medium">{profileLabel(t, row)}</td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    disabled={saving}
                    className={inputClass}
                    value={row.daily_token_limit}
                    onChange={(event) =>
                      onChange(row.profile_type, row.profile_key, {
                        daily_token_limit: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    disabled={saving}
                    className={inputClass}
                    value={row.monthly_token_limit}
                    onChange={(event) =>
                      onChange(row.profile_type, row.profile_key, {
                        monthly_token_limit: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    disabled={saving}
                    className={inputClass}
                    value={row.monthly_cost_limit}
                    onChange={(event) =>
                      onChange(row.profile_type, row.profile_key, {
                        monthly_cost_limit: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <label className={`inline-flex items-center gap-1.5 ${mutedClass}`}>
                    <input
                      type="checkbox"
                      disabled={saving}
                      checked={row.hard_limit_enabled}
                      onChange={(event) =>
                        onChange(row.profile_type, row.profile_key, {
                          hard_limit_enabled: event.target.checked,
                        })
                      }
                    />
                    {t("platform.quotaHardLimit")}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuestQuotaForm({
  guestQuota,
  isLight,
  mutedClass,
  cardClass,
  saving,
  onChange,
  t,
}: {
  guestQuota: GuestQuotaSettings;
  isLight: boolean;
  mutedClass: string;
  cardClass: string;
  saving: boolean;
  onChange: (patch: Partial<GuestQuotaSettings>) => void;
  t: (key: string) => string;
}) {
  const inputClass = `w-full rounded-md border px-2 py-1.5 text-[11px] tabular-nums ${
    isLight ? "border-slate-200 bg-white text-slate-700" : "border-slate-700 bg-slate-900 text-slate-200"
  }`;
  const fields: Array<{ key: keyof GuestQuotaSettings; label: string; step?: number }> = [
    { key: "max_uses_per_guest", label: t("platform.quotaGuestMaxUses") },
    { key: "max_uses_per_ip", label: t("platform.quotaGuestMaxUsesIp") },
    { key: "window_seconds", label: t("platform.quotaGuestWindow") },
    { key: "daily_token_limit", label: t("platform.quotaDailyTokens") },
    { key: "monthly_token_limit", label: t("platform.quotaMonthlyTokens") },
    { key: "monthly_cost_limit", label: t("platform.quotaMonthlyCost"), step: 0.01 },
  ];

  return (
    <div className={`overflow-hidden rounded-lg border ${cardClass}`}>
      <div className={`border-b px-4 py-3 ${isLight ? "border-slate-100" : "border-slate-800"}`}>
        <h3 className="text-sm font-semibold">{t("platform.quotaSectionGuest")}</h3>
        <p className={`mt-1 text-[11px] ${mutedClass}`}>{t("platform.quotaGuestDescription")}</p>
      </div>
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key} className={`block text-[11px] ${mutedClass}`}>
            {field.label}
            <input
              type="number"
              min={0}
              step={field.step ?? 1}
              disabled={saving}
              className={`mt-1 ${inputClass}`}
              value={guestQuota[field.key] as number}
              onChange={(event) => {
                const raw = Number(event.target.value) || 0;
                onChange({
                  [field.key]: field.step ? Math.max(0, raw) : Math.max(field.key === "window_seconds" ? 60 : 0, raw),
                } as Partial<GuestQuotaSettings>);
              }}
            />
          </label>
        ))}
        <label className={`flex items-end gap-2 pb-1 text-[11px] ${mutedClass}`}>
          <input
            type="checkbox"
            disabled={saving}
            checked={guestQuota.hard_limit_enabled}
            onChange={(event) => onChange({ hard_limit_enabled: event.target.checked })}
          />
          {t("platform.quotaHardLimit")}
        </label>
      </div>
    </div>
  );
}
export function PlatformQuotaProfilesPanel({ open, isLight = true }: PlatformQuotaProfilesPanelProps) {
  const { t } = useT();
  const [profiles, setProfiles] = useState<QuotaProfileRow[]>([]);
  const [guestQuota, setGuestQuota] = useState<GuestQuotaSettings>(DEFAULT_GUEST_QUOTA);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mutedClass = isLight ? "text-slate-500" : "text-slate-400";
  const cardClass = isLight ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-900/80";

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [profilesRes, guestRes] = await Promise.all([
        fetch(`${API_BASE}/api/platform/quota-profiles`, { headers: enterpriseHeaders() }),
        fetch(`${API_BASE}/api/platform/guest-quota`, { headers: enterpriseHeaders() }),
      ]);
      const profilesPayload = (await profilesRes.json().catch(() => ({}))) as {
        profiles?: QuotaProfileRow[];
        detail?: string;
      };
      const guestPayload = (await guestRes.json().catch(() => ({}))) as GuestQuotaSettings & { detail?: string };
      if (!profilesRes.ok) {
        throw new Error(String(profilesPayload.detail || `HTTP ${profilesRes.status}`));
      }
      if (!guestRes.ok) {
        throw new Error(String(guestPayload.detail || `HTTP ${guestRes.status}`));
      }
      setProfiles(profilesPayload.profiles || []);
      setGuestQuota({
        max_uses_per_guest: guestPayload.max_uses_per_guest ?? DEFAULT_GUEST_QUOTA.max_uses_per_guest,
        max_uses_per_ip: guestPayload.max_uses_per_ip ?? DEFAULT_GUEST_QUOTA.max_uses_per_ip,
        window_seconds: guestPayload.window_seconds ?? DEFAULT_GUEST_QUOTA.window_seconds,
        daily_token_limit: guestPayload.daily_token_limit ?? DEFAULT_GUEST_QUOTA.daily_token_limit,
        monthly_token_limit: guestPayload.monthly_token_limit ?? DEFAULT_GUEST_QUOTA.monthly_token_limit,
        monthly_cost_limit: guestPayload.monthly_cost_limit ?? DEFAULT_GUEST_QUOTA.monthly_cost_limit,
        hard_limit_enabled: guestPayload.hard_limit_enabled ?? DEFAULT_GUEST_QUOTA.hard_limit_enabled,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadAll(), 0);
    return () => window.clearTimeout(timer);
  }, [open, loadAll]);

  const updateProfile = (
    profileType: QuotaProfileRow["profile_type"],
    profileKey: string,
    patch: Partial<QuotaProfileRow>
  ) => {
    setProfiles((current) =>
      current.map((item) =>
        item.profile_type === profileType && item.profile_key === profileKey ? { ...item, ...patch } : item
      )
    );
  };

  const saveAll = async () => {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const [profilesRes, guestRes] = await Promise.all([
        fetch(`${API_BASE}/api/platform/quota-profiles`, {
          method: "PUT",
          headers: enterpriseHeaders(),
          body: JSON.stringify({ profiles }),
        }),
        fetch(`${API_BASE}/api/platform/guest-quota`, {
          method: "PUT",
          headers: enterpriseHeaders(),
          body: JSON.stringify(guestQuota),
        }),
      ]);
      const profilesPayload = (await profilesRes.json().catch(() => ({}))) as {
        profiles?: QuotaProfileRow[];
        detail?: string;
      };
      const guestPayload = (await guestRes.json().catch(() => ({}))) as GuestQuotaSettings & { detail?: string };
      if (!profilesRes.ok) {
        throw new Error(String(profilesPayload.detail || `HTTP ${profilesRes.status}`));
      }
      if (!guestRes.ok) {
        throw new Error(String(guestPayload.detail || `HTTP ${guestRes.status}`));
      }
      setProfiles(profilesPayload.profiles || []);
      setGuestQuota({
        max_uses_per_guest: guestPayload.max_uses_per_guest,
        max_uses_per_ip: guestPayload.max_uses_per_ip,
        window_seconds: guestPayload.window_seconds,
        daily_token_limit: guestPayload.daily_token_limit,
        monthly_token_limit: guestPayload.monthly_token_limit,
        monthly_cost_limit: guestPayload.monthly_cost_limit,
        hard_limit_enabled: guestPayload.hard_limit_enabled,
      });
      setNotice(t("platform.quotaProfilesSaved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const tierRows = profiles.filter((row) => row.profile_type === "account_tier");
  const roleRows = profiles.filter((row) => row.profile_type === "tenant_role");

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{t("platform.quotaProfilesTitle")}</h3>
          <p className={`mt-1 max-w-3xl text-sm ${mutedClass}`}>{t("platform.quotaProfilesDescription")}</p>
        </div>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void saveAll()}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            isLight
              ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
          }`}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t("platform.quotaSaveProfiles")}
        </button>
      </div>

      {error ? (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            isLight ? "border-rose-200 bg-rose-50 text-rose-700" : "border-rose-500/20 bg-rose-500/10 text-rose-300"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          {t("platform.quotaLoadFailed")}: {error}
        </div>
      ) : null}

      {notice ? (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            isLight ? "border-sky-200 bg-sky-50 text-sky-700" : "border-sky-500/20 bg-sky-500/10 text-sky-300"
          }`}
        >
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className={`flex items-center gap-2 py-8 text-sm ${mutedClass}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-4">
          <GuestQuotaForm
            guestQuota={guestQuota}
            isLight={isLight}
            mutedClass={mutedClass}
            cardClass={cardClass}
            saving={saving}
            onChange={(patch) => setGuestQuota((current) => ({ ...current, ...patch }))}
            t={t}
          />
          <QuotaProfileTable
            title={t("platform.quotaSectionTier")}
            rows={tierRows}
            isLight={isLight}
            mutedClass={mutedClass}
            cardClass={cardClass}
            saving={saving}
            onChange={updateProfile}
            t={t}
          />
          <QuotaProfileTable
            title={t("platform.quotaSectionRole")}
            rows={roleRows}
            isLight={isLight}
            mutedClass={mutedClass}
            cardClass={cardClass}
            saving={saving}
            onChange={updateProfile}
            t={t}
          />
          <div
            className={`rounded-lg border px-4 py-3 text-[11px] ${
              isLight ? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-800 bg-slate-900/50 text-slate-300"
            }`}
          >
            <p className="mb-2 flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t("platform.quotaEnforcementTitle")}
            </p>
            <p className="mb-1">{t("platform.quotaEnforcementGuest")}</p>
            <p>{t("platform.quotaEnforcementRegistered")}</p>
            <p className={`mt-2 flex items-center gap-1.5 ${mutedClass}`}>
              <Gauge className="h-3.5 w-3.5" />
              {t("platform.quotaUnlimited")}: 0
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
