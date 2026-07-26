/**
 * Unified platform guest session — Diagram + PPT share the same Bearer token.
 */
import { API_BASE } from './enterpriseContext.ts';

export const GUEST_SESSION_STORAGE_KEY = 'smartdiagram.guest.session.v1';

export interface GuestQuotaStatus {
  total: number;
  used: number;
  remaining: number;
  exhausted: boolean;
  window_seconds?: number;
  nextAvailableAt?: number;
}

export interface GuestSession {
  access_token: string;
  token_type: 'bearer';
  expires_at: number;
  kind: 'guest';
  guest_id: string;
  quota?: GuestQuotaStatus;
}

interface CaptchaPayload {
  turnstile_token?: string;
  captcha_payload?: string;
}

export function normalizeGuestQuota(value: unknown): GuestQuotaStatus | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const total = source.total;
  const used = source.used;
  const remaining = source.remaining;
  const exhausted = source.exhausted;
  if (
    typeof total !== 'number'
    || !Number.isFinite(total)
    || typeof used !== 'number'
    || !Number.isFinite(used)
    || typeof remaining !== 'number'
    || !Number.isFinite(remaining)
    || typeof exhausted !== 'boolean'
  ) {
    return null;
  }

  const windowSeconds = source.window_seconds;
  const nextAvailableAt = source.next_available_at_ms ?? source.nextAvailableAt;
  return {
    total,
    used,
    remaining,
    exhausted,
    ...(typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)
      ? { window_seconds: windowSeconds }
      : {}),
    ...(typeof nextAvailableAt === 'number' && Number.isFinite(nextAvailableAt)
      ? { nextAvailableAt }
      : {}),
  };
}

export function readGuestSession(): GuestSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Omit<GuestSession, 'quota'> & { quota?: unknown };
    const { quota: rawQuota, ...storedSession } = stored;
    const quota = normalizeGuestQuota(rawQuota);
    const session: GuestSession = {
      ...storedSession,
      ...(quota ? { quota } : {}),
    };
    if (!session?.access_token || session.kind !== 'guest') return null;
    if (session.expires_at && session.expires_at * 1000 <= Date.now()) {
      clearGuestSession();
      return null;
    }
    return session;
  } catch {
    clearGuestSession();
    return null;
  }
}

export function writeGuestSession(session: GuestSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearGuestSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
}

export async function issueGuestSession(captcha?: CaptchaPayload): Promise<GuestSession> {
  const res = await fetch(`${API_BASE}/api/auth/guest/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      turnstile_token: captcha?.turnstile_token ?? '',
      captcha_payload: captcha?.captcha_payload ?? '',
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`);
  }
  const payload = (await res.json()) as Omit<GuestSession, 'quota'> & { quota?: unknown };
  const { quota: rawQuota, ...sessionPayload } = payload;
  const quota = normalizeGuestQuota(rawQuota);
  const session: GuestSession = {
    ...sessionPayload,
    ...(quota ? { quota } : {}),
  };
  writeGuestSession(session);
  return session;
}

export async function ensureGuestSession(captcha?: CaptchaPayload): Promise<GuestSession> {
  const existing = readGuestSession();
  if (existing) return existing;
  return issueGuestSession(captcha);
}

export async function refreshGuestQuota(session = readGuestSession()): Promise<GuestQuotaStatus | null> {
  if (!session) return null;
  const res = await fetch(`${API_BASE}/api/auth/guest/quota`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    credentials: 'include',
  });
  if (!res.ok) {
    if (res.status === 401) clearGuestSession();
    return session.quota ?? null;
  }
  const payload = (await res.json()) as { quota?: unknown };
  const quota = normalizeGuestQuota(payload.quota);
  if (quota) {
    writeGuestSession({ ...session, quota });
  }
  return quota;
}

export function guestAuthorizationHeader(
  session: GuestSession | null = readGuestSession()
): Record<string, string> {
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}
