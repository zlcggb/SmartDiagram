import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { DEMO_LOGIN_HINTS, loginWithPassword, type AuthSession } from '../../config/auth';
import { useT } from '../../i18n';

interface LoginScreenProps {
  onLogin: (session: AuthSession) => void;
}

type LoginPreset = 'user' | 'admin';

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const { t } = useT();
  const [email, setEmail] = useState(DEMO_LOGIN_HINTS.user.email);
  const [password, setPassword] = useState(DEMO_LOGIN_HINTS.user.password);
  const [preset, setPreset] = useState<LoginPreset>('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const applyPreset = (nextPreset: LoginPreset) => {
    const hint = DEMO_LOGIN_HINTS[nextPreset];
    setPreset(nextPreset);
    setEmail(hint.email);
    setPassword(hint.password);
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await loginWithPassword(email, password);
      onLogin(session);
    } catch (err) {
      setError(t('auth.loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
  const presetClass = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
      active
        ? 'border-blue-500 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    }`;
  const showcaseItems = [
    {
      icon: GitBranch,
      title: t('auth.showcaseDiagramTitle'),
      description: t('auth.showcaseDiagramDescription'),
    },
    {
      icon: FileText,
      title: t('auth.showcaseArtifactTitle'),
      description: t('auth.showcaseArtifactDescription'),
    },
    {
      icon: Layers3,
      title: t('auth.showcaseGovernanceTitle'),
      description: t('auth.showcaseGovernanceDescription'),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative flex min-h-[42vh] items-center justify-center overflow-hidden border-b border-slate-200 bg-slate-950 px-8 py-12 text-white lg:min-h-screen lg:border-b-0 lg:border-r">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(125,211,252,0.7) 0.8px, transparent 0.8px)',
              backgroundSize: '26px 26px',
            }}
          />
          <div className="relative max-w-2xl">
            <p className="mb-5 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-200">
              {t('auth.heroEyebrow')}
            </p>
            <div className="mb-7 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 shadow-2xl shadow-blue-500/20">
              <Sparkles className="h-7 w-7 text-cyan-300" />
            </div>
            <h1 className="max-w-xl text-4xl font-semibold sm:text-5xl">SmartDiagram Pro</h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-300">
              {t('auth.heroDescription')}
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {showcaseItems.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
                  <Icon className="h-5 w-5 text-cyan-300" />
                  <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 border-t border-white/10 pt-5">
              <p className="max-w-xl text-sm leading-7 text-slate-400">{t('auth.heroClosing')}</p>
            </div>
          </div>
        </section>

        <main className="flex items-center justify-center px-5 py-10">
          <form onSubmit={submit} className="w-full max-w-[420px]">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase text-blue-600">
                {t('auth.console')}
              </p>
              <h2 className="mt-3 text-2xl font-semibold">{t('auth.title')}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{t('auth.description')}</p>
            </div>

            <div className="mb-5 flex gap-2">
              <button type="button" className={presetClass(preset === 'user')} onClick={() => applyPreset('user')}>
                <UserRound className="h-4 w-4" />
                {t('auth.normalUser')}
              </button>
              <button type="button" className={presetClass(preset === 'admin')} onClick={() => applyPreset('admin')}>
                <ShieldCheck className="h-4 w-4" />
                {t('auth.adminUser')}
              </button>
            </div>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">{t('auth.email')}</span>
              <input
                className={inputClass}
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">{t('auth.password')}</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </label>

            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {busy ? t('auth.signingIn') : t('auth.signIn')}
            </button>

            <p className="mt-4 text-center text-xs text-slate-500">{t('auth.localOnly')}</p>
          </form>
        </main>
      </div>
    </div>
  );
}
