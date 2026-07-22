import assert from "node:assert/strict";
import { runWithConcurrency } from "../apps/api/src/lib/concurrency.js";

let active = 0;
let peak = 0;
const visited: number[] = [];

const outcome = await runWithConcurrency(Array.from({ length: 9 }, (_, index) => index), 3, async (item) => {
  active += 1;
  peak = Math.max(peak, active);
  visited.push(item);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (item === 5) throw new Error("expected smoke failure");
  } finally {
    active -= 1;
  }
});

assert.equal(peak, 3);
assert.equal(visited.length, 9);
assert.equal(outcome.concurrency, 3);
assert.deepEqual(outcome.failures.map((failure) => failure.item), [5]);
console.log(`[concurrency-smoke] OK peak=${peak} processed=${visited.length} failures=${outcome.failures.length}`);
