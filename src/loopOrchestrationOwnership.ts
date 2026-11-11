export type LoopOrchestrationOwnershipTracker = {
  acquire: (taskId: string) => () => void;
  collectTaskIds: () => Set<string>;
  getCount: (taskId: string) => number;
  waitForIdle: (taskId: string) => Promise<void>;
};

export function createLoopOrchestrationOwnershipTracker(): LoopOrchestrationOwnershipTracker {
  const countsByTaskId = new Map<string, number>();
  const idleWaiters = new Map<string, Array<() => void>>();

  return {
    acquire: (taskId) => {
      countsByTaskId.set(taskId, (countsByTaskId.get(taskId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const nextCount = (countsByTaskId.get(taskId) ?? 0) - 1;
        if (nextCount > 0) {
          countsByTaskId.set(taskId, nextCount);
          return;
        }
        countsByTaskId.delete(taskId);
        const waiters = idleWaiters.get(taskId) ?? [];
        idleWaiters.delete(taskId);
        waiters.forEach((resolve) => resolve());
      };
    },
    collectTaskIds: () => new Set(countsByTaskId.keys()),
    getCount: (taskId) => countsByTaskId.get(taskId) ?? 0,
    waitForIdle: (taskId) => {
      if (!countsByTaskId.has(taskId)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleWaiters.set(taskId, [...(idleWaiters.get(taskId) ?? []), resolve]);
      });
    },
  };
}
