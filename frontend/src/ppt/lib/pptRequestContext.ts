import { readAuthSession } from "../../config/auth.ts";
import { getOrCreatePptGuestToken } from "./pptGuestIdentity.ts";

interface SessionLike {
  access_token: string;
}

export function pptIdentityHeaders(
  session: SessionLike | null,
  guestToken: () => string = getOrCreatePptGuestToken
): Record<string, string> {
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return { "X-PPT-Guest-Token": guestToken() };
}

export function currentPptIdentityHeaders() {
  return pptIdentityHeaders(readAuthSession());
}

export function isPptGuest() {
  return readAuthSession() === null;
}

