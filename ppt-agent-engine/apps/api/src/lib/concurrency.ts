export interface ConcurrentFailure<T> {
  item: T;
  index: number;
  error: unknown;
}

export function normalizeConcurrency(value: unknown, fallback = 3, maximum = 5) {
  const parsed = typeof value === "number" ? value : Number(value);
  const safeFallback = Math.min(maximum, Math.max(1, Math.floor(fallback)));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.floor(parsed))) : safeFallback;
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  requestedConcurrency: number,
  task: (item: T, index: number) => Promise<void>
) {
  const concurrency = Math.min(items.length, normalizeConcurrency(requestedConcurrency));
  const failures: Array<ConcurrentFailure<T>> = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      try {
        await task(item, index);
      } catch (error) {
        failures.push({ item, index, error });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  failures.sort((left, right) => left.index - right.index);
  return { concurrency, failures };
}
