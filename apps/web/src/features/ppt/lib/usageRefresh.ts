export interface AiUsageRefreshOptions {
  busy: boolean;
  refresh: () => void | Promise<void>;
  schedule: (callback: () => void, intervalMs: number) => unknown;
  cancel: (handle: unknown) => void;
  intervalMs?: number;
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
