import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Languages,
  Loader2,
  Moon,
  Palette,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useT } from '../../i18n';
import OpsDashboard from '../ops/OpsDashboard';
import DiagramPreferencesPanel from './DiagramPreferencesPanel';

type SettingsSection = 'appearance' | 'model' | 'preferences' | 'ops' | 'session';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onClearConversation: () => void;
}

interface NavItem {
  id: SettingsSection;
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
}

export default function SettingsModal({
  open,
  onClose,
  onClearConversation,
}: SettingsModalProps) {
  const { modelConfig, setModelConfig, canvasMode, setCanvasMode } = useChatStore();
  const { t, locale, toggleLocale } = useT();
  const isLight = canvasMode === 'light';
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');
  const [apiKey, setApiKey] = useState(modelConfig?.api_key || '');
  const [baseUrl, setBaseUrl] = useState(modelConfig?.base_url || '');
  const [modelId, setModelId] = useState(modelConfig?.model_id || '');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  useEffect(() => {
    if (open) {
      setActiveSection('appearance');
      setApiKey(modelConfig?.api_key || '');
      setBaseUrl(modelConfig?.base_url || '');
      setModelId(modelConfig?.model_id || '');
      setTestStatus('idle');
      setTestError('');
    }
  }, [open, modelConfig]);

  const navItems = useMemo<NavItem[]>(() => [
    {
      id: 'appearance',
      icon: Palette,
      label: t('settings.nav.appearance'),
      description: t('settings.appearanceDescription'),
    },
    {
      id: 'model',
      icon: Settings2,
      label: t('settings.nav.model'),
      description: t('settings.modelDescription'),
    },
    {
      id: 'preferences',
      icon: SlidersHorizontal,
      label: t('settings.nav.preferences'),
      description: t('settings.preferencesDescription'),
    },
    {
      id: 'ops',
      icon: Activity,
      label: t('settings.nav.ops'),
      description: t('settings.opsDescription'),
    },
    {
      id: 'session',
      icon: Trash2,
      label: t('settings.nav.session'),
      description: t('settings.sessionDescription'),
    },
  ], [t]);

  const activeItem = navItems.find((item) => item.id === activeSection) || navItems[0];

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      const res = await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        setTestError(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (e: unknown) {
      setTestStatus('error');
      setTestError(e instanceof Error ? e.message : t('settings.connectionFailed'));
    }
  };

  const handleSave = () => {
    setModelConfig({
      api_key: apiKey.trim(),
      base_url: baseUrl.trim(),
      model_id: modelId.trim(),
    });
    onClose();
  };

  if (!open) return null;

  const sidebarClass = isLight
    ? 'border-slate-200 bg-cyan-100/80 text-slate-800'
    : 'border-slate-800 bg-slate-900 text-slate-100';
  const mainClass = isLight
    ? 'bg-slate-50 text-slate-950'
    : 'bg-slate-950 text-slate-100';
  const cardClass = isLight
    ? 'border-slate-200 bg-white'
    : 'border-slate-800 bg-slate-900/80';
  const fieldClass = `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors ${
    isLight
      ? 'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:border-blue-400'
      : 'border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-600 focus:border-blue-500/60'
  }`;
  const labelClass = `mb-1.5 block text-[12px] font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`;
  const mutedClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const subtleClass = isLight ? 'text-slate-600' : 'text-slate-400';
  const secondaryButtonClass = `inline-flex h-9 items-center justify-center rounded-lg border px-3 text-[12px] font-semibold transition-colors ${
    isLight
      ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
  }`;

  const renderSectionHeader = (title: string, description: string) => (
    <div className="mb-5">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className={`mt-1 max-w-2xl text-sm ${mutedClass}`}>{description}</p>
    </div>
  );

  const renderAppearance = () => (
    <div>
      {renderSectionHeader(t('settings.appearanceTitle'), t('settings.appearanceDescription'))}
      <div className={`overflow-hidden rounded-lg border ${cardClass}`}>
        <div className={`flex items-center justify-between gap-4 border-b px-4 py-4 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'}`}>
              <Languages className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t('settings.language')}</div>
              <div className={`mt-0.5 text-[12px] ${mutedClass}`}>{t('settings.languageDescription', { language: t('language.current') })}</div>
            </div>
          </div>
          <button type="button" onClick={toggleLocale} className={secondaryButtonClass}>
            {locale === 'zh' ? t('settings.switchToEnglish') : t('settings.switchToChinese')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300'}`}>
              {isLight ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t('settings.theme')}</div>
              <div className={`mt-0.5 text-[12px] ${mutedClass}`}>
                {t('settings.themeDescription', { theme: isLight ? t('settings.themeLight') : t('settings.themeDark') })}
              </div>
            </div>
          </div>
          <div className={`inline-flex rounded-lg border p-1 ${isLight ? 'border-slate-200 bg-slate-100' : 'border-slate-800 bg-slate-950'}`}>
            <button
              type="button"
              onClick={() => setCanvasMode('light')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-colors ${
                isLight ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              {t('settings.themeLight')}
            </button>
            <button
              type="button"
              onClick={() => setCanvasMode('dark')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-colors ${
                !isLight ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              {t('settings.themeDark')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderModel = () => (
    <div>
      {renderSectionHeader(t('settings.modelTitle'), t('settings.modelDescription'))}
      <div className={`rounded-lg border p-5 ${cardClass}`}>
        <div className="grid gap-4">
          <div>
            <label className={labelClass}>{t('settings.apiKey')}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('settings.baseUrl')}</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('settings.modelId')}</label>
            <input
              type="text"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="gpt-4o"
              className={fieldClass}
            />
          </div>
          {testStatus === 'success' && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${isLight ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/10 text-emerald-200'}`}>
              <CheckCircle className="h-4 w-4" />
              {t('settings.connectionSuccess')}
            </div>
          )}
          {testStatus === 'error' && (
            <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/10 text-rose-200'}`}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{testError}</span>
            </div>
          )}
          <div className={`flex items-center justify-between border-t pt-4 ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
            <button
              type="button"
              onClick={handleTest}
              disabled={!apiKey.trim() || testStatus === 'testing'}
              className={`${secondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {testStatus === 'testing'
                ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('settings.testing')}</span>
                : t('settings.testConnection')
              }
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-[12px] font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors hover:bg-blue-700"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSession = () => (
    <div>
      {renderSectionHeader(t('settings.sessionTitle'), t('settings.sessionDescription'))}
      <div className={`rounded-lg border p-5 ${isLight ? 'border-rose-100 bg-white' : 'border-rose-500/20 bg-rose-500/5'}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isLight ? 'bg-rose-50 text-rose-600' : 'bg-rose-500/10 text-rose-200'}`}>
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className={`text-sm font-semibold ${isLight ? 'text-rose-700' : 'text-rose-100'}`}>{t('settings.clearConversation')}</h3>
            <p className={`mt-1 text-[12px] leading-relaxed ${isLight ? 'text-rose-500/80' : 'text-rose-200/70'}`}>
              {t('settings.clearConversationDescription')}
            </p>
            <button
              type="button"
              onClick={onClearConversation}
              className={`mt-4 inline-flex h-9 items-center justify-center rounded-lg px-3 text-[12px] font-semibold transition-colors ${
                isLight ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
              }`}
            >
              {t('dialog.clearConversation.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderActiveSection = () => {
    if (activeSection === 'appearance') return renderAppearance();
    if (activeSection === 'model') return renderModel();
    if (activeSection === 'preferences') {
      return <DiagramPreferencesPanel open onClose={() => setActiveSection('appearance')} embedded />;
    }
    if (activeSection === 'ops') {
      return <OpsDashboard open onClose={() => setActiveSection('appearance')} embedded />;
    }
    return renderSession();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className={`flex h-[88vh] min-h-[620px] w-full max-w-6xl overflow-hidden rounded-[20px] border shadow-2xl ${
        isLight ? 'border-white/70 bg-white' : 'border-slate-800 bg-slate-950'
      }`}>
        <aside className={`flex w-[248px] shrink-0 flex-col border-r ${sidebarClass}`}>
          <div className="px-5 py-5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                className={`inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors ${
                  isLight ? 'text-slate-600 hover:bg-white/50 hover:text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
                {t('settings.backToApp')}
              </button>
            </div>
            <div className="mt-6">
              <h1 className="text-xl font-semibold tracking-tight">{t('settings.title')}</h1>
              <p className={`mt-1 text-[12px] leading-relaxed ${subtleClass}`}>{t('settings.subtitle')}</p>
            </div>
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                    active
                      ? isLight ? 'bg-white/55 text-slate-950 shadow-sm' : 'bg-slate-800 text-white'
                      : isLight ? 'text-slate-700 hover:bg-white/35 hover:text-slate-950' : 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className={`flex min-w-0 flex-1 flex-col ${mainClass}`}>
          <header className={`flex h-16 shrink-0 items-center justify-between border-b px-8 ${
            isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'
          }`}>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{activeItem.label}</div>
              <div className={`mt-0.5 truncate text-[12px] ${mutedClass}`}>{activeItem.description}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              title={t('common.close')}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                isLight ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-950' : 'text-slate-500 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
            {renderActiveSection()}
          </div>
        </main>
      </div>
    </div>
  );
}
