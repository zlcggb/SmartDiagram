import { readAuthSession } from '../../../shared/lib/config/auth.ts';
import {
  ensureGuestSession,
  guestAuthorizationHeader,
  readGuestSession,
} from '../../../shared/lib/config/guestSession.ts';

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

export function currentPptIdentityHeaders(): Record<string, string> {
  const session = readAuthSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return guestAuthorizationHeader();
}

export function createPptRequestHeaders({
  identityHeaders = currentPptIdentityHeaders(),
  headers,
  includeJsonContentType = false,
}: {
  identityHeaders?: Record<string, string>;
  headers?: HeadersInit;
  includeJsonContentType?: boolean;
} = {}): Headers {
  const merged = new Headers(identityHeaders);
  if (includeJsonContentType) {
    merged.set('Content-Type', 'application/json');
  }
  new Headers(headers).forEach((value, name) => merged.set(name, value));
  return merged;
}

export function isPptGuest() {
  return readAuthSession() === null;
}
