export interface AiUsageRefreshOptions {
  busy: boolean;
  refresh: () => void | Promise<void>;
  schedule: (callback: () => void, intervalMs: number) => unknown;
  cancel: (handle: unknown) => void;
  intervalMs?: number;
}

/** Only the newest overlapping request may update the visible usage summary. */
export function createLatestAsyncCommit<T>(
  commit: (value: T) => void,
  onLatestError?: (error: unknown) => void,
) {
  let latestRequest = 0;

  return async (load: () => Promise<T>): Promise<void> => {
    const request = ++latestRequest;
    try {
      const value = await load();
      if (request === latestRequest) commit(value);
    } catch (error) {
      if (request === latestRequest) onLatestError?.(error);
    }
  };
}

/** Refresh once now, then poll only while an AI operation is running. */
export function startAiUsageAutoRefresh(options: AiUsageRefreshOptions): () => void {
  const refreshSafely = () => {
    void Promise.resolve(options.refresh()).catch(() => undefined);
  };
  refreshSafely();
  if (!options.busy) return () => undefined;

  const handle = options.schedule(refreshSafely, options.intervalMs ?? 2_000);
  return () => options.cancel(handle);
}
