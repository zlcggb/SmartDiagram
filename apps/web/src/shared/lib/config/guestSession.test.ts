import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGuestQuota } from "./guestSession.ts";

test("guest quota normalizes the server reset timestamp at the API boundary", () => {
  assert.deepEqual(
    normalizeGuestQuota({
      total: 5,
      used: 5,
      remaining: 0,
      exhausted: true,
      window_seconds: 86_400,
      next_available_at_ms: 1_800_000_000_123,
    }),
    {
      total: 5,
      used: 5,
      remaining: 0,
      exhausted: true,
      window_seconds: 86_400,
      nextAvailableAt: 1_800_000_000_123,
    },
  );
});

test("guest quota keeps the next available time absent when the limit is not exhausted", () => {
  assert.deepEqual(
    normalizeGuestQuota({
      total: 5,
      used: 2,
      remaining: 3,
      exhausted: false,
      window_seconds: 86_400,
    }),
    {
      total: 5,
      used: 2,
      remaining: 3,
      exhausted: false,
      window_seconds: 86_400,
    },
  );
});
