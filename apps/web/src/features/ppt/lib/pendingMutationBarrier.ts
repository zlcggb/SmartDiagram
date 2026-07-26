export interface PendingMutationBarrier {
  track: <T>(key: string, task: Promise<T>) => Promise<T>;
  wait: (key: string) => Promise<void>;
}

/**
 * Tracks in-flight saves by resource key so a dependent action can wait for
 * every save that was already running when the action started.
 */
export function createPendingMutationBarrier(): PendingMutationBarrier {
  const pending = new Map<string, Set<Promise<void>>>();

  return {
    track(key, task) {
      const settled = task.then(
        () => undefined,
        () => undefined
      );
      const tasks = pending.get(key) ?? new Set<Promise<void>>();
      tasks.add(settled);
      pending.set(key, tasks);

      void settled.then(() => {
        tasks.delete(settled);
        if (tasks.size === 0 && pending.get(key) === tasks) {
          pending.delete(key);
        }
      });

      return task;
    },
    async wait(key) {
      const tasks = pending.get(key);
      if (!tasks?.size) return;
      await Promise.all([...tasks]);
    }
  };
}
