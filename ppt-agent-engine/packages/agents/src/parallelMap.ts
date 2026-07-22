/**
 * LangGraph 风格的 map-reduce 并行（轻量版，不引入 @langchain/langgraph）。
 *
 * 对应概念：
 * - fan-out / Send：每个 item 派发一个 worker
 * - max_concurrency：限制同时活跃分支，保护网关限流
 * - fan-in：全部结束后汇总 results（含失败项）
 */

export type ParallelMapOk<T, R> = { item: T; index: number; ok: true; value: R };
export type ParallelMapFail<T> = { item: T; index: number; ok: false; error: unknown };
export type ParallelMapResult<T, R> = ParallelMapOk<T, R> | ParallelMapFail<T>;

export type ParallelMapOptions<T> = {
  /** 同时执行的 worker 数，默认 3，上限 8 */
  concurrency?: number;
  onItemStart?: (info: { index: number; total: number; item: T }) => void;
  onItemDone?: (info: { index: number; total: number; item: T; ok: boolean }) => void;
  /** 单个 item 产生流式 token 时的回调（用于并发场景下把 token 透传给外层） */
  onItemToken?: (info: { index: number; total: number; item: T; token: string }) => void;
};

export function resolveConcurrency(envKeys: string[] = ["AI_CONCURRENCY"], fallback = 3) {
  for (const key of envKeys) {
    const raw = Number.parseInt(process.env[key] || "", 10);
    if (Number.isFinite(raw) && raw >= 1) {
      return Math.min(8, raw);
    }
  }
  return Math.min(8, Math.max(1, fallback));
}

/** 全部检索默认并发：SEARCH_CONCURRENCY → AI_CONCURRENCY → 3 */
export function resolveSearchConcurrency() {
  return resolveConcurrency(["SEARCH_CONCURRENCY", "AI_CONCURRENCY"], 3);
}

/**
 * 有限并发 map：顺序派发任务槽，同槽内 await worker；多槽并行。
 * 单页失败不取消其他页（与 LangGraph 分支隔离类似）。
 */
export async function parallelMap<T, R>(
  items: readonly T[],
  worker: (item: T, index: number, emitToken: (token: string) => void) => Promise<R>,
  options: ParallelMapOptions<T> = {}
): Promise<Array<ParallelMapResult<T, R>>> {
  const total = items.length;
  if (total === 0) return [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, total));
  const results: Array<ParallelMapResult<T, R> | undefined> = new Array(total);
  let cursor = 0;

  async function runSlot() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      const item = items[index] as T;
      options.onItemStart?.({ index, total, item });
      try {
        const value = await worker(item, index, (token) => {
          options.onItemToken?.({ index, total, item, token });
        });
        results[index] = { item, index, ok: true, value };
        options.onItemDone?.({ index, total, item, ok: true });
      } catch (error) {
        results[index] = { item, index, ok: false, error };
        options.onItemDone?.({ index, total, item, ok: false });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runSlot()));
  return results as Array<ParallelMapResult<T, R>>;
}
