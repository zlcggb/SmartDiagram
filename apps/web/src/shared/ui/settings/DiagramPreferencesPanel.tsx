import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { API_BASE, enterpriseBodyContext, enterpriseHeaders, hasProjectContext } from '@/shared/lib/config/enterpriseContext';
import { useT } from '@/app/i18n';

type PreferenceScope = 'user' | 'team' | 'project';

interface DiagramPreferencesPanelProps {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
}

interface PreferenceForm {
  scope: PreferenceScope;
  edgeColor: string;
  edgeWidth: string;
  nodeBorderRadius: string;
  nodePadding: string;
  nodeFontSize: string;
  nodeMinWidth: string;
  chartBackground: string;
  chartPalette: string;
  notes: string;
}

interface PreferenceMemory {
  status?: string;
  preferences?: Record<string, unknown>;
  sources?: Record<string, boolean>;
}

const DEFAULT_FORM: PreferenceForm = {
  scope: 'user',
  edgeColor: '#1e40af',
  edgeWidth: '2',
  nodeBorderRadius: '12',
  nodePadding: '16',
  nodeFontSize: '14',
  nodeMinWidth: '160',
  chartBackground: '#ffffff',
  chartPalette: '#5470c6, #91cc75, #fac858, #ee6666',
  notes: '',
};

const clampNumber = (value: string, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const hexColor = (value: unknown, fallback: string) => {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

const formFromPreferences = (memory: PreferenceMemory | null, currentScope: PreferenceScope): PreferenceForm => {
  const preferences = memory?.preferences || {};
  const style = asRecord(preferences.style);
  const flow = asRecord(preferences.flow);
  const charts = asRecord(preferences.charts);
  const mergedFlow = { ...style, ...flow };
  const palette = Array.isArray(charts.palette) && charts.palette.length > 0
    ? charts.palette.map(String).join(', ')
    : DEFAULT_FORM.chartPalette;
  return {
    ...DEFAULT_FORM,
    scope: currentScope,
    edgeColor: hexColor(mergedFlow.edge_color, DEFAULT_FORM.edgeColor),
    edgeWidth: String(mergedFlow.edge_width ?? DEFAULT_FORM.edgeWidth),
    nodeBorderRadius: String(mergedFlow.node_border_radius ?? DEFAULT_FORM.nodeBorderRadius),
    nodePadding: String(mergedFlow.node_padding ?? DEFAULT_FORM.nodePadding),
    nodeFontSize: String(mergedFlow.node_font_size ?? DEFAULT_FORM.nodeFontSize),
    nodeMinWidth: String(mergedFlow.node_min_width ?? DEFAULT_FORM.nodeMinWidth),
    chartBackground: hexColor(charts.background, DEFAULT_FORM.chartBackground),
    chartPalette: palette,
    notes: typeof preferences.notes === 'string' ? preferences.notes : '',
  };
};

const preferencesFromForm = (form: PreferenceForm) => {
  const palette = form.chartPalette
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const preferences: Record<string, unknown> = {
    flow: {
      edge_color: form.edgeColor,
      edge_width: clampNumber(form.edgeWidth, 2, 1, 8),
      node_border_radius: clampNumber(form.nodeBorderRadius, 12, 0, 32),
      node_padding: clampNumber(form.nodePadding, 16, 4, 40),
      node_font_size: clampNumber(form.nodeFontSize, 14, 10, 24),
      node_min_width: clampNumber(form.nodeMinWidth, 160, 80, 360),
    },
    charts: {
      background: form.chartBackground,
      palette,
    },
  };
  const notes = form.notes.trim();
  if (notes) preferences.notes = notes;
  return preferences;
};

export default function DiagramPreferencesPanel({ open, onClose, embedded = false }: DiagramPreferencesPanelProps) {
  const { canvasMode } = useChatStore();
  const { t } = useT();
  const [form, setForm] = useState<PreferenceForm>(DEFAULT_FORM);
  const [memory, setMemory] = useState<PreferenceMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const isLight = canvasMode === 'light';
  const scopeOptions: Array<{ value: PreferenceScope; label: string }> = [
    { value: 'user', label: t('preferences.scope.user') },
    { value: 'team', label: t('preferences.scope.team') },
    ...(hasProjectContext() ? [{ value: 'project' as PreferenceScope, label: t('preferences.scope.project') }] : []),
  ];

  const sourcesText = useMemo(() => {
    const sources = memory?.sources || {};
    return ['tenant', 'team', 'user', 'project']
      .filter((key) => sources[key])
      .map((key) => t(`memory.source.${key}`))
      .join(' / ') || t('common.empty');
  }, [memory, t]);

  const updateField = <K extends keyof PreferenceForm>(key: K, value: PreferenceForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const loadPreferences = useCallback(async (scope?: PreferenceScope) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/preferences/artifact`, {
        method: 'GET',
        headers: enterpriseHeaders(false, { includeProject: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json() as PreferenceMemory;
      setMemory(payload);
      setForm((current) => formFromPreferences(payload, scope ?? current.scope));
    } catch (err) {
      console.error('[Preferences] Load failed:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const savePreferences = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE}/api/preferences/artifact`, {
        method: 'PATCH',
        headers: enterpriseHeaders(),
        body: JSON.stringify({
          ...enterpriseBodyContext({ includeProject: true }),
          scope: form.scope,
          merge: true,
          preferences: preferencesFromForm(form),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json() as { merged?: PreferenceMemory };
      const merged = payload.merged || null;
      setMemory(merged);
      setForm(formFromPreferences(merged, form.scope));
      setSaved(true);
    } catch (err) {
      console.error('[Preferences] Save failed:', err);
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadPreferences(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPreferences, open]);

  if (!open) return null;

  const fieldClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
    isLight
      ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-400'
      : 'border-slate-800 bg-slate-900 text-slate-100 placeholder:text-slate-600 focus:border-blue-500/60'
  }`;
  const labelClass = `mb-1.5 block text-[11px] font-medium ${isLight ? 'text-slate-600' : 'text-slate-400'}`;
  const panelClass = isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-slate-700 bg-slate-950 text-slate-100';

  const content = (
      <div className={`flex h-full w-full flex-col ${embedded ? '' : `max-w-[440px] border-l shadow-2xl ${panelClass}`}`}>
        <div className={`flex items-center justify-between border-b px-4 py-3 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
          <div className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className={`h-4 w-4 shrink-0 ${isLight ? 'text-slate-600' : 'text-slate-300'}`} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{t('preferences.title')}</div>
              <div className={`truncate text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{t('preferences.sources', { sources: sourcesText })}</div>
            </div>
          </div>
          {!embedded && (
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
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>{t('preferences.scope')}</label>
              <div className={`grid ${scopeOptions.length > 2 ? 'grid-cols-3' : 'grid-cols-2'} gap-1 rounded-lg border p-1 ${
                isLight ? 'border-slate-200 bg-slate-100' : 'border-slate-800 bg-slate-900'
              }`}>
                {scopeOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => updateField('scope', item.value)}
                    className={`rounded-md px-3 py-2 text-[12px] font-medium transition-colors ${
                      form.scope === item.value
                        ? isLight ? 'bg-white text-slate-900 shadow-sm' : 'bg-slate-800 text-white'
                        : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${isLight ? 'border-slate-200 bg-slate-50/70' : 'border-slate-800 bg-slate-900/60'}`}>
              <div className={`mb-3 text-[12px] font-semibold ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>{t('preferences.flow')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>{t('preferences.edgeColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={hexColor(form.edgeColor, DEFAULT_FORM.edgeColor)}
                      onChange={(event) => updateField('edgeColor', event.target.value)}
                      className={`h-9 w-10 shrink-0 rounded-md border p-1 ${isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'}`}
                    />
                    <input
                      value={form.edgeColor}
                      onChange={(event) => updateField('edgeColor', event.target.value)}
                      className={fieldClass}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>{t('preferences.edgeWidth')}</label>
                  <input type="number" min={1} max={8} value={form.edgeWidth} onChange={(event) => updateField('edgeWidth', event.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('preferences.nodeRadius')}</label>
                  <input type="number" min={0} max={32} value={form.nodeBorderRadius} onChange={(event) => updateField('nodeBorderRadius', event.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('preferences.nodePadding')}</label>
                  <input type="number" min={4} max={40} value={form.nodePadding} onChange={(event) => updateField('nodePadding', event.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('preferences.nodeFontSize')}</label>
                  <input type="number" min={10} max={24} value={form.nodeFontSize} onChange={(event) => updateField('nodeFontSize', event.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('preferences.nodeWidth')}</label>
                  <input type="number" min={80} max={360} value={form.nodeMinWidth} onChange={(event) => updateField('nodeMinWidth', event.target.value)} className={fieldClass} />
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${isLight ? 'border-slate-200 bg-slate-50/70' : 'border-slate-800 bg-slate-900/60'}`}>
              <div className={`mb-3 text-[12px] font-semibold ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>{t('preferences.charts')}</div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>{t('preferences.background')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={hexColor(form.chartBackground, DEFAULT_FORM.chartBackground)}
                      onChange={(event) => updateField('chartBackground', event.target.value)}
                      className={`h-9 w-10 shrink-0 rounded-md border p-1 ${isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'}`}
                    />
                    <input
                      value={form.chartBackground}
                      onChange={(event) => updateField('chartBackground', event.target.value)}
                      className={fieldClass}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>{t('preferences.palette')}</label>
                  <input
                    value={form.chartPalette}
                    onChange={(event) => updateField('chartPalette', event.target.value)}
                    className={fieldClass}
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {form.chartPalette.split(',').map((color) => color.trim()).filter(Boolean).slice(0, 8).map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className={`h-4 w-4 rounded-full border ${isLight ? 'border-white shadow-sm' : 'border-slate-700'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className={labelClass}>{t('preferences.notes')}</label>
              <textarea
                value={form.notes}
                onChange={(event) => updateField('notes', event.target.value)}
                rows={3}
                className={`${fieldClass} resize-none leading-relaxed`}
                placeholder={t('preferences.notesPlaceholder')}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                {error}
              </div>
            )}
            {saved && (
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${
                isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-200'
              }`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('preferences.saved')}
              </div>
            )}
          </div>
        </div>

        <div className={`flex items-center justify-between border-t px-4 py-3 ${isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'}`}>
          <button
            type="button"
            onClick={() => loadPreferences(form.scope)}
            disabled={loading || saving}
            className={`rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50 ${
              isLight ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-slate-800 text-slate-300 hover:bg-slate-900'
            }`}
          >
            {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('common.loading')}</span> : t('common.reload')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${
                isLight ? 'text-slate-500 hover:text-slate-900' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              onClick={savePreferences}
              disabled={loading || saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('common.saving')}</span> : t('common.save')}
            </button>
          </div>
        </div>
      </div>
  );

  if (embedded) return content;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      {content}
    </div>
  );
}
