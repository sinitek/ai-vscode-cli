type AdmissionOptions = {
  canRun: () => boolean;
  isAborted?: () => boolean;
  signal?: AbortSignal;
};

type Work = {
  compaction: boolean;
  options?: AdmissionOptions;
  execute: () => Promise<void>;
  cancel: () => void;
  reject: (error: unknown) => void;
  detach: () => void;
};

type SessionQueue = {
  pending: Work[];
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function createLoopMainQuestionQueue(options: { pollIntervalMs?: number } = {}) {
  const sessions = new Map<string, SessionQueue>();
  const compactions = new Map<string, { controller: AbortController; done: Promise<void>; ready: Promise<boolean> }>();

  function pump(tabId: string, queue: SessionQueue): void {
    if (queue.running) {
      return;
    }
    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = undefined;
    }
    queue.pending = queue.pending.filter((work) => {
      if (work.options?.signal?.aborted || work.options?.isAborted?.()) {
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
        work.detach();
        work.reject(error);
        continue;
      }
      queue.pending.shift();
      work.detach();
      queue.running = true;
      void work.execute().finally(() => {
        queue.running = false;
        pump(tabId, queue);
      });
      return;
    }
    sessions.delete(tabId);
  }

  function enqueue<Result>(tabId: string, execute: () => Promise<Result>, admission?: AdmissionOptions, compaction = false): Promise<Result | undefined> {
    if (admission?.signal?.aborted || admission?.isAborted?.()) return Promise.resolve(undefined);
    const queue = sessions.get(tabId) ?? { pending: [], running: false };
    sessions.set(tabId, queue);
    return new Promise<Result | undefined>((resolve, reject) => {
      const abort = () => {
        const index = queue.pending.indexOf(work);
        if (index < 0) return;
        queue.pending.splice(index, 1);
        work.cancel();
        pump(tabId, queue);
      };
      const work: Work = {
        compaction,
        options: admission,
        detach: () => admission?.signal?.removeEventListener("abort", abort),
        cancel: () => { work.detach(); resolve(undefined); },
        reject,
        execute: async () => {
          try {
            resolve(await execute());
          } catch (error) {
            reject(error);
          }
        },
      };
      const before = compaction ? queue.pending.findIndex((pending) => !pending.compaction) : -1;
      if (before === -1) queue.pending.push(work);
      else queue.pending.splice(before, 0, work);
      admission?.signal?.addEventListener("abort", abort, { once: true });
      pump(tabId, queue);
    });
  }

  function runMain<Result>(tabId: string, execute: () => Promise<Result>): Promise<Result>;
  function runMain<Result>(tabId: string, execute: () => Promise<Result>, admission: AdmissionOptions): Promise<Result | undefined>;
  function runMain<Result>(tabId: string, execute: () => Promise<Result>, admission?: AdmissionOptions): Promise<Result | undefined> {
    return enqueue(tabId, execute, admission);
  }

  function runCompaction(tabId: string, execute: () => Promise<void>): Promise<void> {
    const previous = compactions.get(tabId);
    const controller = previous && !previous.controller.signal.aborted ? previous.controller : new AbortController();
    const { signal } = controller;
    const run = enqueue(tabId, async () => {
      await Promise.resolve();
      if (!signal.aborted) await execute();
    }, { canRun: () => true, signal }, true);
    const done = run.then(() => undefined, () => undefined).finally(() => {
      if (compactions.get(tabId)?.done === done) compactions.delete(tabId);
    });
    const ready = new Promise<boolean>((resolve) => {
      const cancel = () => resolve(false);
      signal.addEventListener("abort", cancel, { once: true });
      void done.then(() => {
        signal.removeEventListener("abort", cancel);
        resolve(!signal.aborted);
      });
    });
    compactions.set(tabId, { controller, done, ready });
    return run;
  }

  return {
    isBusy: (tabId: string): boolean => sessions.has(tabId),
    getCompaction: (tabId: string | null | undefined) => tabId ? compactions.get(tabId) : undefined,
    cancelCompaction: (tabId: string) => compactions.get(tabId)?.controller.abort(),
    runCompaction,
    runMain,
    runQuestion: <Result>(tabId: string, question: AdmissionOptions, execute: () => Promise<Result>) => (
      enqueue(tabId, execute, question)
    ),
  };
}
