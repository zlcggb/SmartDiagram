import { readAuthSession } from '@/shared/lib/config/auth.ts';
import {
  ensureGuestSession,
  guestAuthorizationHeader,
  readGuestSession,
} from '@/shared/lib/config/guestSession.ts';

interface SessionLike {
  access_token: string;
}

export async function pptIdentityHeaders(
  session: SessionLike | null = readAuthSession()
): Promise<Record<string, string>> {
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  const guest = readGuestSession() ?? (await ensureGuestSession().catch(() => null));
  return guestAuthorizationHeader(guest);
}

export function currentPptIdentityHeaders() {
  const session = readAuthSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return guestAuthorizationHeader();
}

export function isPptGuest() {
  return readAuthSession() === null;
}
