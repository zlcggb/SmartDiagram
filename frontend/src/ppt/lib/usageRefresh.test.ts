import assert from "node:assert/strict";
import test from "node:test";

import { startAiUsageAutoRefresh } from "./usageRefresh.ts";

test("refreshes once immediately while idle without starting a timer", async () => {
  let refreshCount = 0;
  let scheduled = false;
  const cleanup = startAiUsageAutoRefresh({
    busy: false,
    refresh: async () => { refreshCount += 1; },
    schedule: () => { scheduled = true; return 1; },
    cancel: () => undefined,
  });

  await Promise.resolve();
  assert.equal(refreshCount, 1);
  assert.equal(scheduled, false);
  cleanup();
});

test("refreshes immediately and repeatedly while generation is busy", async () => {
  let refreshCount = 0;
  let callback: (() => void) | undefined;
  let cancelledHandle: unknown;
  const cleanup = startAiUsageAutoRefresh({
    busy: true,
    intervalMs: 2_000,
    refresh: async () => { refreshCount += 1; },
    schedule: (next, delay) => {
      assert.equal(delay, 2_000);
      callback = next;
      return "timer-1";
    },
    cancel: (handle) => { cancelledHandle = handle; },
  });

  await Promise.resolve();
  assert.equal(refreshCount, 1);
  callback?.();
  await Promise.resolve();
  assert.equal(refreshCount, 2);
  cleanup();
  assert.equal(cancelledHandle, "timer-1");
});

test("does not leak rejected refresh promises", async () => {
  const cleanup = startAiUsageAutoRefresh({
    busy: false,
    refresh: async () => { throw new Error("temporary ledger error"); },
    schedule: () => 1,
    cancel: () => undefined,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  cleanup();
});
