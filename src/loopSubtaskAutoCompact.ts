import type { CliName } from "./cli/types";
import { logError } from "./logger";
import { getErrorInfo } from "./promptRetry";
import { shouldOverlapLoopMainContextCompaction, type LoopMainAutoCompactRequest } from "./loopMainAutoCompact";
import type { PromptRunInput, PromptRunTarget } from "./promptRunTypes";

type DeferredCompaction = {
  start: (completed: boolean, onCompleted?: () => Promise<void>) => void;
  flight: Promise<void>;
};

type CompactionOrigin = {
  activity: "contextCompaction";
  taskId: string;
  subtaskId: string;
  cli: CliName;
  tabId: string;
  sessionId: string;
};

export class LoopSubtaskAutoCompactions {
  private readonly pending = new Map<string, DeferredCompaction>();
  private readonly flights = new Map<string, Promise<void>>();

  constructor(private readonly onError: (error: unknown, origin: CompactionOrigin) => void) {}

  defer(input: PromptRunInput, target: PromptRunTarget, run: () => Promise<void>): boolean {
    if (input.taskRole !== "subtask" || !input.loopTaskId?.trim() || !input.loopSubtaskId?.trim() || !target.sessionId) {
      return false;
    }
    const taskKey = JSON.stringify([input.loopTaskId, input.loopSubtaskId]);
    const sessionKey = JSON.stringify([target.cli, target.sessionId]);
    // Capture the completed invocation before callers reuse input/target objects.
    const origin: CompactionOrigin = {
      activity: "contextCompaction", taskId: input.loopTaskId, subtaskId: input.loopSubtaskId,
      cli: target.cli, tabId: target.tabId, sessionId: target.sessionId,
    };
    const previous = this.flights.get(sessionKey);
    let start!: DeferredCompaction["start"];
    const notified = new Promise<{ completed: boolean; onCompleted?: () => Promise<void> }>((resolve) => {
      start = (completed, onCompleted) => resolve({ completed, onCompleted });
    });
    const flight = notified.then(async ({ completed, onCompleted }) => {
      await previous;
      if (completed) {
        try {
          await run();
        } catch (error) {
          this.onError(error, origin);
        } finally {
          // Keep this session reserved until its completed tab has been retired.
          await onCompleted?.();
        }
      }
    }).catch((error) => this.onError(error, origin)).finally(() => {
      if (this.flights.get(sessionKey) === flight) {
        this.flights.delete(sessionKey);
      }
    });
    this.pending.get(taskKey)?.start(false);
    this.pending.set(taskKey, { start, flight });
    this.flights.set(sessionKey, flight);
    return true;
  }

  notify(taskId: string, subtaskId: string, completed: boolean, onCompleted?: () => Promise<void>): Promise<void> | undefined {
    const taskKey = JSON.stringify([taskId, subtaskId]);
    const pending = this.pending.get(taskKey);
    this.pending.delete(taskKey);
    pending?.start(completed, onCompleted);
    return pending?.flight;
  }

  async wait(cli: CliName, sessionId: string | null): Promise<void> {
    if (sessionId) {
      await this.flights.get(JSON.stringify([cli, sessionId]));
    }
  }

  has(cli: CliName, sessionId: string | null): boolean {
    return Boolean(sessionId && this.flights.has(JSON.stringify([cli, sessionId])));
  }

  runWhenReady<T>(cli: CliName, sessionId: string | null, run: () => Promise<T>): Promise<T> {
    const flight = sessionId ? this.flights.get(JSON.stringify([cli, sessionId])) : undefined;
    return flight ? flight.then(run) : run();
  }
}

export const loopSubtaskAutoCompactions = new LoopSubtaskAutoCompactions((error, origin) => {
  const info = getErrorInfo(error);
  void logError("loop-subtask-auto-compact-failed", {
    ...origin,
    error: info.message,
    errorCode: info.code,
  }).catch(() => undefined);
});

export async function scheduleAutoCompactAfterPrompt(
  input: PromptRunInput,
  target: PromptRunTarget,
  run: (options: LoopMainAutoCompactRequest) => Promise<void>,
): Promise<void> {
  const configSelection = input.configSelections?.[target.cli];
  const execution = configSelection ? {
    configSelection,
    model: input.model ?? null,
    thinkingMode: input.thinkingModeOverride,
  } : undefined;
  if (loopSubtaskAutoCompactions.defer(input, target, () => run({ isolatedRun: true, ...(execution ? { execution } : {}) }))) {
    return;
  }
  await run({ overlapLoopDispatch: shouldOverlapLoopMainContextCompaction(input) });
}
