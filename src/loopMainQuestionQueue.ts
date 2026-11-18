type QuestionOptions = {
  canRun: () => boolean;
  isAborted?: () => boolean;
};

type Work = {
  options?: QuestionOptions;
  execute: () => Promise<void>;
  cancel: () => void;
  reject: (error: unknown) => void;
};

type SessionQueue = {
  pending: Work[];
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function createLoopMainQuestionQueue(options: { pollIntervalMs?: number } = {}) {
  const sessions = new Map<string, SessionQueue>();

  function pump(tabId: string, queue: SessionQueue): void {
    if (queue.running) {
      return;
    }
    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = undefined;
    }
    queue.pending = queue.pending.filter((work) => {
      if (work.options?.isAborted?.()) {
        work.cancel();
        return false;
      }
      return true;
    });
    while (queue.pending.length > 0) {
      const work = queue.pending[0];
      try {
        if (work.options && !work.options.canRun()) {
          queue.timer = setTimeout(() => pump(tabId, queue), options.pollIntervalMs ?? 100);
          queue.timer.unref?.();
          return;
        }
      } catch (error) {
        queue.pending.shift();
        work.reject(error);
        continue;
      }
      queue.pending.shift();
      queue.running = true;
      void work.execute().finally(() => {
        queue.running = false;
        pump(tabId, queue);
      });
      return;
    }
    sessions.delete(tabId);
  }

  function enqueue<Result>(tabId: string, execute: () => Promise<Result>, question?: QuestionOptions): Promise<Result | undefined> {
    const queue = sessions.get(tabId) ?? { pending: [], running: false };
    sessions.set(tabId, queue);
    return new Promise<Result | undefined>((resolve, reject) => {
      const work: Work = {
        ...(question ? { options: question } : {}),
        cancel: () => resolve(undefined),
        reject,
        execute: async () => {
          try {
            resolve(await execute());
          } catch (error) {
            reject(error);
          }
        },
      };
      queue.pending.push(work);
      pump(tabId, queue);
    });
  }

  return {
    runMain: <Result>(tabId: string, execute: () => Promise<Result>): Promise<Result> => (
      enqueue(tabId, execute) as Promise<Result>
    ),
    runQuestion: <Result>(tabId: string, question: QuestionOptions, execute: () => Promise<Result>) => (
      enqueue(tabId, execute, question)
    ),
  };
}
