import { useState, useEffect, useRef, type FormEvent } from 'react';
import {
  AlertCircle,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
} from 'lucide-react';
import {
  DEMO_LOGIN_HINTS,
  fetchCaptchaConfig,
  loginWithPassword,
  registerWithPassword,
  type AuthSession,
  type CaptchaConfig,
} from '../../config/auth';
import { useT } from '../../i18n';

interface LoginScreenProps {
  onLogin: (session: AuthSession) => void;
  /** 'page' = full-screen (default), 'modal' = compact form for popup */
  displayMode?: 'page' | 'modal';
  /** Called when the modal close button is clicked (modal mode only) */
  onClose?: () => void;
}

type LoginPreset = 'user' | 'admin';
type AuthMode = 'login' | 'register';

// ─── ALTCHA Widget (self-hosted PoW CAPTCHA) ───

function AltchaWidget({
  challengeUrl,
  onPayload,
}: {
  challengeUrl: string;
  onPayload: (payload: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    if (!challengeUrl || !containerRef.current) return;

    const loadAndRender = () => {
      if (!containerRef.current) return;
      // Clear any previous widget
      containerRef.current.innerHTML = '';

      const widget = document.createElement('altcha-widget');
      widget.setAttribute('challengeurl', challengeUrl);
      widget.setAttribute('hidefooter', '');
      widget.setAttribute('hidelogo', '');
      widget.setAttribute('strings', JSON.stringify({
        label: '安全验证',
        verifying: '验证中...',
        verified: '验证通过',
        error: '验证失败，请重试',
        expired: '已过期，请重试',
      }));
      widget.addEventListener('statechange', ((e: CustomEvent) => {
        if (e.detail?.state === 'verified' && e.detail?.payload) {
          onPayload(e.detail.payload);
        }
      }) as EventListener);
      containerRef.current.appendChild(widget);
    };

    // Load ALTCHA widget script once
    if (!scriptLoaded.current) {
      const existing = document.querySelector('script[src*="altcha"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/altcha/dist/altcha.min.js';
        script.type = 'module';
        script.async = true;
        script.onload = () => {
          scriptLoaded.current = true;
          loadAndRender();
        };
        document.head.appendChild(script);
      } else {
        scriptLoaded.current = true;
        loadAndRender();
      }
    } else {
      loadAndRender();
    }

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [challengeUrl, onPayload]);

  return <div ref={containerRef} className="w-full" />;
}

// ─── Main Component ───

export default function LoginScreen({ onLogin, displayMode = 'page', onClose }: LoginScreenProps) {
  const { t } = useT();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [preset, setPreset] = useState<LoginPreset>('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [captchaPayload, setCaptchaPayload] = useState('');
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null);

  // Fetch captcha config on mount
  useEffect(() => {
    fetchCaptchaConfig().then((config) => {
      setCaptchaConfig(config);
      // Auto-fill demo credentials only when demo presets are enabled
      if (config.show_demo_presets) {
        setEmail(DEMO_LOGIN_HINTS.user.email);
        setPassword(DEMO_LOGIN_HINTS.user.password);
      }
    });
  }, []);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setCaptchaPayload('');
    if (next === 'register') {
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } else if (captchaConfig?.show_demo_presets) {
      applyPreset('user');
    } else {
      setEmail('');
      setPassword('');
    }
  };

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
      if (mode === 'register') {
        // Validate
        if (!email || !email.includes('@')) {
          throw new Error(t('auth.invalidEmail'));
        }
        if (password.length < 8) {
          throw new Error(t('auth.passwordTooShort'));
        }
        if (password !== confirmPassword) {
          throw new Error(t('auth.passwordMismatch'));
        }
        if (!captchaPayload) {
          throw new Error(t('auth.captchaRequired'));
        }
        const session = await registerWithPassword(email, password, captchaPayload);
        onLogin(session);
      } else {
        if (!captchaPayload) {
          throw new Error(t('auth.captchaRequired'));
        }
        const session = await loginWithPassword(email, password, captchaPayload);
        onLogin(session);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('EMAIL_EXISTS') || msg.includes('already registered')) {
        setError(t('auth.emailExists'));
      } else if (msg.includes('CAPTCHA')) {
        setError(t('auth.captchaFailed'));
      } else if (mode === 'register') {
        setError(msg || t('auth.registerFailed'));
      } else {
        setError(t('auth.loginFailed'));
      }
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
  const tabClass = (active: boolean) =>
    `flex-1 py-2.5 text-center text-sm font-semibold rounded-lg transition ${
      active
        ? 'bg-white text-slate-900 shadow-sm'
        : 'text-slate-500 hover:text-slate-700'
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

  const isModal = displayMode === 'modal';

  return (
    <div className={isModal ? 'bg-white rounded-2xl shadow-2xl max-w-[460px] w-full mx-auto relative' : 'min-h-screen bg-slate-100 text-slate-900'}>
      {/* Modal close button */}
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l12 12M13 1L1 13"/></svg>
        </button>
      )}
      <div className={isModal ? '' : 'grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]'}>
        {!isModal && (
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
        )}

        <main className={isModal ? 'px-6 py-8' : 'flex items-center justify-center px-5 py-10'}>
          <form onSubmit={submit} className={isModal ? 'w-full' : 'w-full max-w-[420px]'}>
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase text-blue-600">
                {t('auth.console')}
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                {mode === 'login' ? t('auth.title') : t('auth.registerTitle')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {mode === 'login' ? t('auth.description') : t('auth.registerDescription')}
              </p>
            </div>

            {/* Login / Register tabs */}
            <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
              <button type="button" className={tabClass(mode === 'login')} onClick={() => switchMode('login')}>
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />{t('auth.signIn')}</span>
              </button>
              <button type="button" className={tabClass(mode === 'register')} onClick={() => switchMode('register')}>
                <span className="inline-flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" />{t('auth.register')}</span>
              </button>
            </div>

            {/* Demo user presets (login mode only, controlled by env) */}
            {mode === 'login' && captchaConfig?.show_demo_presets && (
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
            )}

            {/* Email */}
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">{t('auth.email')}</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9`}
                  type="email"
                  autoComplete="username"
                  placeholder={mode === 'register' ? t('auth.emailPlaceholder') : ''}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </label>

            {/* Password */}
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">{t('auth.password')}</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9`}
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'register' ? t('auth.passwordPlaceholder') : ''}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {mode === 'register' && (
                <p className="mt-1 text-xs text-slate-400">{t('auth.passwordHint')}</p>
              )}
            </label>

            {/* Confirm password (register only) */}
            {mode === 'register' && (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">{t('auth.confirmPassword')}</span>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className={`${inputClass} pl-9`}
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              </label>
            )}

            {/* ALTCHA PoW CAPTCHA */}
            {captchaConfig?.challenge_url && (
              <div className="mb-4">
                <AltchaWidget
                  key={mode}
                  challengeUrl={captchaConfig.challenge_url}
                  onPayload={setCaptchaPayload}
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'register' ? <UserPlus className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {busy
                ? (mode === 'register' ? t('auth.registering') : t('auth.signingIn'))
                : (mode === 'register' ? t('auth.register') : t('auth.signIn'))
              }
            </button>

            <p className="mt-4 text-center text-xs text-slate-500">
              {mode === 'login' ? t('auth.localOnly') : t('auth.registerNote')}
            </p>
          </form>
        </main>
      </div>
    </div>
  );
}
