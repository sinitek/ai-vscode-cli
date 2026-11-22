import { logError, logInfo } from "../logger";

export class LoopPlusUpdateUnconfirmedError extends Error {
  constructor(taskId: string) {
    super(`Loop+ task update did not commit: ${taskId}`);
  }
}

export function logLoopPlusRuntimeEvent(event: string, payload?: unknown): void {
  if (event === "loop-plus-persist-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { taskId: _taskId, attemptId: _attemptId, error: _error, ...diagnostic } = detail;
    void logError(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else {
    void logInfo(event, payload);
  }
}
