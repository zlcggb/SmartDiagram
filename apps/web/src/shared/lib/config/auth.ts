import { API_BASE } from './apiBase.ts';

export type AuthRole = 'member' | 'admin' | 'owner';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: AuthRole | string;
  tenant_id: string;
  team_id: string;
  project_id: string;
  roles: string[];
  scopes: string[];
  avatar_url?: string | null;
}

export interface AuthSession {
  access_token: string;
  token_type: 'bearer';
  expires_at: number;
  user: AuthUser;
}

const AUTH_STORAGE_KEY = 'smartdiagram.auth.session';

export function readAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session?.access_token || !session?.user) return null;
    if (session.expires_at && session.expires_at * 1000 <= Date.now()) {
      clearAuthSession();
      return null;
    }
    return session;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function writeAuthSession(session: AuthSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function isAdminSession(session: AuthSession | null) {
  const roles = new Set(session?.user.roles || []);
  return roles.has('admin') || roles.has('owner');
}

export function isPlatformAdminSession(session: AuthSession | null) {
  const roles = new Set(session?.user.roles || []);
  return roles.has('platform_admin');
}

export interface CaptchaResult {
  provider: 'turnstile' | 'altcha';
  token: string;  // turnstile_token or altcha base64 payload
}

export async function loginWithPassword(email: string, password: string, captcha?: CaptchaResult): Promise<AuthSession> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      turnstile_token: captcha?.provider === 'turnstile' ? captcha.token : '',
      captcha_payload: captcha?.provider === 'altcha' ? captcha.token : '',
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  const session = (await res.json()) as AuthSession;
  writeAuthSession(session);
  return session;
}

export async function validateAuthSession(session: AuthSession): Promise<AuthSession> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    clearAuthSession();
    throw new Error('Session expired');
  }
  const payload = (await res.json()) as { kind?: string; user?: AuthUser };
  if (payload.kind === 'guest') {
    clearAuthSession();
    throw new Error('Session expired');
  }
  const refreshed = payload.user
    ? { ...session, user: { ...session.user, ...payload.user } }
    : session;
  writeAuthSession(refreshed);
  return refreshed;
}

export interface ProfileUpdate {
  displayName?: string;
  avatar?: Blob;
  removeAvatar?: boolean;
}

export async function updateProfile(
  session: AuthSession,
  update: ProfileUpdate,
): Promise<AuthSession> {
  const body = new FormData();
  if (update.displayName !== undefined) body.set('display_name', update.displayName);
  if (update.avatar) body.set('avatar', update.avatar, 'avatar.jpg');
  if (update.removeAvatar) body.set('remove_avatar', 'true');

  const res = await fetch(`${API_BASE}/api/auth/me/profile`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(payload.detail || `HTTP ${res.status}`);
  }
  const refreshed = (await res.json()) as AuthSession;
  writeAuthSession(refreshed);
  return refreshed;
}

export async function registerWithPassword(
  email: string,
  password: string,
  captcha: CaptchaResult,
): Promise<AuthSession> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      turnstile_token: captcha.provider === 'turnstile' ? captcha.token : '',
      captcha_payload: captcha.provider === 'altcha' ? captcha.token : '',
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  const session = (await res.json()) as AuthSession;
  writeAuthSession(session);
  return session;
}

export interface CaptchaConfig {
  provider: string;          // "dual" | "altcha" | "turnstile"
  challenge_url: string;     // ALTCHA challenge endpoint
  turnstile_site_key: string; // Turnstile site key (empty = disabled)
  enabled: boolean;
  show_demo_presets: boolean;
  demo_presets?: Record<'user' | 'admin', { email: string; password: string }>;
}

export async function fetchCaptchaConfig(): Promise<CaptchaConfig> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/captcha-config`);
    if (!res.ok) {
      return { provider: 'altcha', challenge_url: '', turnstile_site_key: '', enabled: false, show_demo_presets: false };
    }
    return (await res.json()) as CaptchaConfig;
  } catch {
    // Keep the shell usable when the API is still starting or the preview runs frontend-only.
    return { provider: 'altcha', challenge_url: '', turnstile_site_key: '', enabled: false, show_demo_presets: false };
  }
}

export interface BudgetMetrics {
  allowed: boolean;
  estimated_cost: number;
  monthly_cost_limit: number;
  estimated_total_tokens: number;
  monthly_token_limit: number;
  hard_limit_enabled: boolean;
  run_count: number;
}

export async function fetchBillingData(session: AuthSession): Promise<BudgetMetrics> {
  const res = await fetch(`${API_BASE}/api/billing/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch billing data');
  }
  const data = await res.json();
  return data.budget;
}
