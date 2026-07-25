export const GUEST_TOKEN_STORAGE_KEY = "smartdiagram.ppt.guest-token.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

export function isValidPptGuestToken(value: string | null | undefined) {
  return Boolean(value && /^ppt_guest_[a-f0-9]{64}$/u.test(value));
}

function createGuestToken(cryptoLike: CryptoLike) {
  const bytes = cryptoLike.getRandomValues(new Uint8Array(32));
  return `ppt_guest_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function getOrCreatePptGuestToken(
  storage: StorageLike = window.localStorage,
  cryptoLike: CryptoLike = globalThis.crypto
) {
  try {
    const existing = storage.getItem(GUEST_TOKEN_STORAGE_KEY);
    if (isValidPptGuestToken(existing)) return existing as string;
  } catch {
    // Restricted browser storage still gets an in-memory token for this page load.
  }
  const token = createGuestToken(cryptoLike);
  try {
    storage.setItem(GUEST_TOKEN_STORAGE_KEY, token);
  } catch {
    // The caller can continue with the returned token when storage is unavailable.
  }
  return token;
}
