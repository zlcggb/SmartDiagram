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
  let refreshInFlight = false;
  let stopped = false;

  const refreshSafely = () => {
    if (stopped || refreshInFlight) return;
    refreshInFlight = true;
    try {
      void Promise.resolve(options.refresh())
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight = false;
        });
    } catch {
      refreshInFlight = false;
    }
  };
  refreshSafely();
  if (!options.busy) {
    return () => {
      stopped = true;
    };
  }

  const handle = options.schedule(refreshSafely, options.intervalMs ?? 2_000);
  return () => {
    stopped = true;
    options.cancel(handle);
  };
}
