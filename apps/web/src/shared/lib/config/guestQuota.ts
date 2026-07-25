/**
 * Guest quota — server-backed via unified guest session.
 */
import {
  ensureGuestSession,
  readGuestSession,
  refreshGuestQuota,
  type GuestQuotaStatus,
} from './guestSession.ts';

export type { GuestQuotaStatus };

export async function getGuestQuota(): Promise<GuestQuotaStatus> {
  const session = readGuestSession() ?? (await ensureGuestSession().catch(() => null));
  if (!session) {
    return { total: 0, used: 0, remaining: 0, exhausted: true };
  }
  const quota = (await refreshGuestQuota(session)) ?? session.quota;
  if (quota) return quota;
  return { total: 5, used: 0, remaining: 5, exhausted: false };
}

export async function canGuestUse(): Promise<boolean> {
  const quota = await getGuestQuota();
  return !quota.exhausted;
}

/** Refresh quota from server after an AI call completes. */
export async function refreshGuestQuotaFromServer(): Promise<GuestQuotaStatus | null> {
  const quota = await refreshGuestQuota();
  return quota;
}
