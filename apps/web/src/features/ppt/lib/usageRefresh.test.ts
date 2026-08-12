import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAsyncCommit, startAiUsageAutoRefresh } from "./usageRefresh.ts";

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

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshCount, 1);
  callback?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

test("does not start another refresh while the previous one is pending", async () => {
  let refreshCount = 0;
  let callback: (() => void) | undefined;
  let resolveRefresh: (() => void) | undefined;
  const cleanup = startAiUsageAutoRefresh({
    busy: true,
    refresh: () => {
      refreshCount += 1;
      return new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });
    },
    schedule: (next) => {
      callback = next;
      return "timer-1";
    },
    cancel: () => undefined,
  });

  assert.equal(refreshCount, 1);
  callback?.();
  assert.equal(refreshCount, 1);

  resolveRefresh?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  callback?.();
  assert.equal(refreshCount, 2);
  cleanup();
});

test("only commits the newest overlapping refresh result", async () => {
  const commits: number[] = [];
  const resolvers: Array<(value: number) => void> = [];
  const refresh = createLatestAsyncCommit<number>((value) => commits.push(value));

  const first = refresh(() => new Promise<number>((resolve) => resolvers.push(resolve)));
  const second = refresh(() => new Promise<number>((resolve) => resolvers.push(resolve)));

  resolvers[1]?.(2);
  await second;
  resolvers[0]?.(1);
  await first;

  assert.deepEqual(commits, [2]);
});
