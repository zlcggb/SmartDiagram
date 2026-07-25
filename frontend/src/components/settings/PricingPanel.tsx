import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Coins,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useT } from '../../i18n';
import { API_BASE, enterpriseHeaders } from '../../config/enterpriseContext';

interface PricingRate {
  model: string;
  input: number;
  output: number;
  cache: number;
  currency: string;
  source: string;
  note?: string;
  updated_by?: string;
  updated_at?: string;
}

interface EditableRate extends PricingRate {
  dirty?: boolean;
  isNew?: boolean;
}

const SOURCE_BADGE: Record<string, string> = {
  database: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200',
  env: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-200',
  builtin: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export default function PricingPanel({
  open,
}: {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';
  const [rates, setRates] = useState<EditableRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingModel, setSavingModel] = useState('');
  const [deletingModel, setDeletingModel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cardClass = isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900/80';
  const mutedClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const fieldClass = `w-full rounded-md border px-2 py-1.5 text-[12px] outline-none transition-colors ${
    isLight
      ? 'border-slate-200 bg-slate-50 text-slate-900 focus:border-blue-400'
      : 'border-slate-700 bg-slate-950 text-slate-100 focus:border-blue-500/60'
  }`;

  const loadRates = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/pricing`, {
        headers: enterpriseHeaders(false),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { rates: PricingRate[] };
      setRates((payload.rates || []).map((rate) => ({ ...rate })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadRates();
  }, [open]);

  const updateRate = (model: string, patch: Partial<EditableRate>) => {
    setRates((prev) =>
      prev.map((rate) => (rate.model === model ? { ...rate, ...patch, dirty: true } : rate)),
    );
  };

  const parseNum = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const saveRate = async (rate: EditableRate) => {
    setSavingModel(rate.model);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/pricing/${encodeURIComponent(rate.model)}`, {
        method: 'PUT',
        headers: enterpriseHeaders(true),
        body: JSON.stringify({
          model: rate.model.trim(),
          input: rate.input,
          output: rate.output,
          cache: rate.cache,
          currency: rate.currency || 'CNY',
          note: rate.note || '',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotice(t('pricing.saved'));
      await loadRates();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingModel('');
    }
  };

  const removeRate = async (rate: EditableRate) => {
    if (rate.isNew) {
      setRates((prev) => prev.filter((item) => item !== rate));
      return;
    }
    setDeletingModel(rate.model);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/pricing/${encodeURIComponent(rate.model)}`, {
        method: 'DELETE',
        headers: enterpriseHeaders(false),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotice(t('pricing.deleted'));
      await loadRates();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingModel('');
    }
  };

  const addRate = () => {
    setRates((prev) => [
      ...prev,
      {
        model: '',
        input: 0,
        output: 0,
        cache: 0,
        currency: 'CNY',
        source: 'database',
        dirty: true,
        isNew: true,
      },
    ]);
  };

  if (!open) return null;

  return (
    <div>
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('pricing.title')}</h2>
            <p className={`mt-1 max-w-2xl text-sm ${mutedClass}`}>{t('pricing.description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addRate}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition-colors ${
                isLight
                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Plus className="h-4 w-4" />
              {t('pricing.addModel')}
            </button>
            <button
              onClick={() => void loadRates()}
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
      </div>

      {error && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            isLight
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            isLight
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          <CheckCircle className="h-4 w-4" />
          {notice}
        </div>
      )}

      <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${cardClass} ${mutedClass}`}>
        {t('pricing.precedenceHint')}
      </div>

      <div className="space-y-3">
        {rates.map((rate, index) => (
          <div key={`${rate.model}-${index}`} className={`overflow-hidden rounded-lg border ${cardClass}`}>
            <div
              className={`flex items-center justify-between gap-3 border-b px-4 py-2.5 ${
                isLight ? 'border-slate-100' : 'border-slate-800'
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Coins className={`h-4 w-4 shrink-0 ${isLight ? 'text-emerald-500' : 'text-emerald-400'}`} />
                {rate.isNew ? (
                  <input
                    value={rate.model}
                    onChange={(event) => updateRate(rate.model, { model: event.target.value })}
                    placeholder={t('pricing.modelPlaceholder')}
                    className={fieldClass}
                  />
                ) : (
                  <span className="truncate text-sm font-semibold">{rate.model}</span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    SOURCE_BADGE[rate.source] || SOURCE_BADGE.builtin
                  }`}
                >
                  {t(`pricing.source.${rate.source}`)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => void saveRate(rate)}
                  disabled={savingModel === rate.model || !rate.model.trim() || (!rate.dirty && !rate.isNew)}
                  className={`inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${
                    isLight
                      ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'border-blue-500/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {savingModel === rate.model ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t('pricing.save')}
                </button>
                <button
                  onClick={() => void removeRate(rate)}
                  disabled={deletingModel === rate.model}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                    isLight
                      ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                  title={rate.isNew ? t('pricing.discard') : t('pricing.removeOverride')}
                >
                  {deletingModel === rate.model ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
              {(
                [
                  ['input', t('pricing.inputPrice')],
                  ['output', t('pricing.outputPrice')],
                  ['cache', t('pricing.cachePrice')],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className={`mb-1 block text-[11px] font-medium ${mutedClass}`}>{label}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={Number.isFinite(rate[key]) ? rate[key] : 0}
                    onChange={(event) => updateRate(rate.model, { [key]: parseNum(event.target.value) } as Partial<EditableRate>)}
                    className={fieldClass}
                  />
                </div>
              ))}
              <div>
                <label className={`mb-1 block text-[11px] font-medium ${mutedClass}`}>{t('pricing.currency')}</label>
                <input
                  value={rate.currency}
                  onChange={(event) => updateRate(rate.model, { currency: event.target.value })}
                  className={fieldClass}
                />
              </div>
            </div>
            <div className={`px-4 pb-3 text-[10px] ${mutedClass}`}>{t('pricing.perMillion')}</div>
          </div>
        ))}

        {!loading && rates.length === 0 && !error && (
          <div className={`rounded-lg border px-6 py-12 text-center text-sm ${cardClass} ${mutedClass}`}>
            {t('pricing.empty')}
          </div>
        )}
        {loading && rates.length === 0 && (
          <div className={`flex items-center justify-center gap-2 rounded-lg border px-6 py-12 ${cardClass} ${mutedClass}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}
      </div>
    </div>
  );
}
