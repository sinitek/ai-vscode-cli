export type LoopOrchestrationOwnershipTracker = {
  acquire: (taskId: string) => () => void;
  collectTaskIds: () => Set<string>;
  getCount: (taskId: string) => number;
};

export function createLoopOrchestrationOwnershipTracker(): LoopOrchestrationOwnershipTracker {
  const countsByTaskId = new Map<string, number>();

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
      };
    },
    collectTaskIds: () => new Set(countsByTaskId.keys()),
    getCount: (taskId) => countsByTaskId.get(taskId) ?? 0,
  };
}
