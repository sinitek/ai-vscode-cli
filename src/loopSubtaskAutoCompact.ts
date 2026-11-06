import type { CliName } from "./cli/types";
import { logError } from "./logger";
import { shouldOverlapLoopMainContextCompaction, type LoopMainAutoCompactRequest } from "./loopMainAutoCompact";
import type { PromptRunInput, PromptRunTarget } from "./promptRunTypes";

type DeferredCompaction = {
  start: (completed: boolean) => void;
};

export class LoopSubtaskAutoCompactions {
  private readonly pending = new Map<string, DeferredCompaction>();
  private readonly flights = new Map<string, Promise<void>>();

  constructor(private readonly onError: (error: unknown) => void) {}

  defer(input: PromptRunInput, target: PromptRunTarget, run: () => Promise<void>): boolean {
    if (input.taskRole !== "subtask" || !input.loopTaskId?.trim() || !input.loopSubtaskId?.trim() || !target.sessionId) {
      return false;
    }
    const taskKey = JSON.stringify([input.loopTaskId, input.loopSubtaskId]);
    const sessionKey = JSON.stringify([target.cli, target.sessionId]);
    const previous = this.flights.get(sessionKey);
    let start!: (completed: boolean) => void;
    const notified = new Promise<boolean>((resolve) => { start = resolve; });
    const flight = notified.then(async (completed) => {
      await previous;
      if (completed) {
        await run();
      }
    }).catch(this.onError).finally(() => {
      if (this.flights.get(sessionKey) === flight) {
        this.flights.delete(sessionKey);
      }
    });
    this.pending.get(taskKey)?.start(false);
    this.pending.set(taskKey, { start });
    this.flights.set(sessionKey, flight);
    return true;
  }

  notify(taskId: string, subtaskId: string, completed: boolean): void {
    const taskKey = JSON.stringify([taskId, subtaskId]);
    const pending = this.pending.get(taskKey);
    this.pending.delete(taskKey);
    pending?.start(completed);
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

export const loopSubtaskAutoCompactions = new LoopSubtaskAutoCompactions((error) => {
  void logError("loop-subtask-auto-compact-failed", {
    error: error instanceof Error ? error.message : String(error),
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
