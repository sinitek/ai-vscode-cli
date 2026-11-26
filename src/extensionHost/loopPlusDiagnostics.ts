import { logError, logEssential, logInfo } from "../logger";

const ESSENTIAL_LOOP_PLUS_RUNTIME_EVENTS = new Set([
  "loop-plus-finish-ignored",
  "loop-plus-finish-failed",
  "loop-plus-report-failed",
  "loop-plus-subtask-interrupted",
  "loop-plus-subtask-tab-auto-close-error",
  "loop-plus-subtask-tab-auto-closed",
]);

export class LoopPlusUpdateUnconfirmedError extends Error {
  constructor(taskId: string) {
    super(`Loop+ task update did not commit: ${taskId}`);
  }
}

export function logLoopPlusRuntimeEvent(event: string, payload?: unknown): void {
  if (event === "loop-plus-invocation-diagnostic") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const stages = new Set(["run", "execution", "handoff", "projection"]);
    const codes = new Set(["terminal-produced-run-missing", "cancelled", "early-exit", "transport-interrupted",
      "run-error-unknown", "unknown", "identity-rejected", "terminal-content-unknown", "authoritative-handoff-used"]);
    const stage = stages.has(String(detail.stage)) ? detail.stage : "unknown";
    const code = codes.has(String(detail.code)) ? detail.code : "unknown";
    void logEssential(event, { stage, code, pid: process.pid }).catch(() => undefined);
  } else if (event === "loop-plus-report-failed" || event === "loop-plus-finish-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { error: _error, ...diagnostic } = detail;
    void logEssential(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else if (ESSENTIAL_LOOP_PLUS_RUNTIME_EVENTS.has(event)) {
    void logEssential(event, payload).catch(() => undefined);
  } else if (event === "loop-plus-persist-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { taskId: _taskId, attemptId: _attemptId, error: _error, ...diagnostic } = detail;
    void logError(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else {
    void logInfo(event, payload).catch(() => undefined);
  }
}
