/**
 * Guest quota management — localStorage-based usage tracking.
 *
 * Allows anonymous users to generate up to MAX_USES diagrams per COOLDOWN window.
 * After exhaustion, a 24-hour cooldown resets the counter automatically.
 */

const STORAGE_KEY = 'smartdiagram.guest.quota';
const MAX_USES = 5;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

interface GuestQuotaData {
  usedCount: number;
  firstUsedAt: number; // epoch ms of first usage in current window
}

function readQuota(): GuestQuotaData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { usedCount: 0, firstUsedAt: 0 };
    const data = JSON.parse(raw) as GuestQuotaData;
    if (typeof data.usedCount !== 'number' || typeof data.firstUsedAt !== 'number') {
      return { usedCount: 0, firstUsedAt: 0 };
    }
    return data;
  } catch {
    return { usedCount: 0, firstUsedAt: 0 };
  }
}

function writeQuota(data: GuestQuotaData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Auto-reset if the cooldown window has elapsed since the first usage.
 */
function autoReset(data: GuestQuotaData): GuestQuotaData {
  if (data.firstUsedAt > 0 && Date.now() - data.firstUsedAt >= COOLDOWN_MS) {
    const reset: GuestQuotaData = { usedCount: 0, firstUsedAt: 0 };
    writeQuota(reset);
    return reset;
  }
  return data;
}

export interface GuestQuotaStatus {
  /** Remaining uses in the current window */
  remaining: number;
  /** Total allowed uses */
  total: number;
  /** How many have been used */
  used: number;
  /** Whether the quota is fully exhausted */
  exhausted: boolean;
  /** Epoch ms when the quota resets (null if not yet started) */
  resetAt: number | null;
}

/**
 * Get the current guest quota status.
 */
export function getGuestQuota(): GuestQuotaStatus {
  const data = autoReset(readQuota());
  const remaining = Math.max(0, MAX_USES - data.usedCount);
  const resetAt = data.firstUsedAt > 0 ? data.firstUsedAt + COOLDOWN_MS : null;
  return {
    remaining,
    total: MAX_USES,
    used: data.usedCount,
    exhausted: remaining <= 0,
    resetAt,
  };
}

/**
 * Consume one guest use. Call this after a successful diagram generation.
 */
export function consumeGuestUse(): void {
  let data = autoReset(readQuota());
  if (data.firstUsedAt === 0) {
    data.firstUsedAt = Date.now();
  }
  data.usedCount = Math.min(data.usedCount + 1, MAX_USES);
  writeQuota(data);
}

/**
 * Check if the guest quota allows a new request.
 */
export function canGuestUse(): boolean {
  return !getGuestQuota().exhausted;
}
