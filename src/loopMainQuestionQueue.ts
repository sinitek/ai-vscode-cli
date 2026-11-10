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
  main: Work[];
  questions: Work[];
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function hasPendingClassicLoopMainWork(input: {
  controllerActive: boolean;
  activeSubtaskCount: number;
  requirementCount: number;
  observedRequirementCount: number;
}): boolean {
  return input.controllerActive && (input.activeSubtaskCount === 0
    || input.requirementCount > input.observedRequirementCount);
}

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
    queue.questions = queue.questions.filter((work) => {
      if (work.options?.isAborted?.()) {
        work.cancel();
        return false;
      }
      return true;
    });
    let work = queue.main.shift();
    if (!work && queue.questions.length > 0) {
      const question = queue.questions[0];
      try {
        if (question.options?.canRun()) {
          work = queue.questions.shift();
        }
      } catch (error) {
        queue.questions.shift();
        question.reject(error);
        pump(tabId, queue);
        return;
      }
    }
    if (!work) {
      if (queue.questions.length > 0) {
        queue.timer = setTimeout(() => pump(tabId, queue), options.pollIntervalMs ?? 100);
        queue.timer.unref?.();
      } else {
        sessions.delete(tabId);
      }
      return;
    }
    queue.running = true;
    void work.execute().finally(() => {
      queue.running = false;
      pump(tabId, queue);
    });
  }

  function enqueue<Result>(tabId: string, execute: () => Promise<Result>, question?: QuestionOptions): Promise<Result | undefined> {
    const queue = sessions.get(tabId) ?? { main: [], questions: [], running: false };
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
      (question ? queue.questions : queue.main).push(work);
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
