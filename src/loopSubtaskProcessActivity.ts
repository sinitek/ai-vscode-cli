import type { RunProcess } from "./cli/commandRunner";
import { LOOP_WAIT_WATCHDOG_TICK_MS } from "./loopWaitWatchdog";

const terminatedProcesses = new WeakSet<RunProcess>();
const consumedResults = new WeakSet<RunProcess>();
const terminatedAt = new WeakMap<RunProcess, number>();

export function observeLoopSubtaskProcess(process: RunProcess): void {
  void process.lifecycle?.then(evidence => {
    if (evidence.processTerminal.status === "confirmed") {
      terminatedProcesses.add(process);
      terminatedAt.set(process, Date.now());
    }
  }, () => undefined);
}

export function recordLoopSubtaskProcessResult(process: RunProcess): void {
  consumedResults.add(process);
}

export function isLoopSubtaskProcessLost(process: RunProcess): boolean {
  const endedAt = terminatedAt.get(process);
  return terminatedProcesses.has(process) && !consumedResults.has(process)
    && endedAt !== undefined && Date.now() - endedAt >= LOOP_WAIT_WATCHDOG_TICK_MS;
}
