import assert from "node:assert/strict";
import test from "node:test";
import { createPendingMutationBarrier } from "./pendingMutationBarrier.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("生成动作会等待同一页尚未完成的全部保存请求", async () => {
  const barrier = createPendingMutationBarrier();
  const first = deferred();
  const second = deferred();
  let generationStarted = false;

  barrier.track("slide-1", first.promise);
  barrier.track("slide-1", second.promise);

  const generation = barrier.wait("slide-1").then(() => {
    generationStarted = true;
  });

  second.resolve();
  await Promise.resolve();
  assert.equal(generationStarted, false);

  first.resolve();
  await generation;
  assert.equal(generationStarted, true);
});

test("保存失败不会永久阻塞后续生成", async () => {
  const barrier = createPendingMutationBarrier();

  barrier.track("slide-1", Promise.reject(new Error("save failed")));

  await assert.doesNotReject(barrier.wait("slide-1"));
});
