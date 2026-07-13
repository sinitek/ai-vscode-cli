import type { SubagentProgressStatus, SubagentProgressUpdate } from "./subagentProgress";
import type { ChatMessage } from "./webview/types";

export const LOBSTER_SUBTASK_PROGRESS_POLL_INTERVAL_MS = 1000;

type LobsterSubtaskProgressScheduler = {
  setInterval: (callback: () => void, delayMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

const DEFAULT_SCHEDULER: LobsterSubtaskProgressScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export function extractLobsterSubtaskVisibleText(
  messages: readonly ChatMessage[],
  context: {
    taskId: string;
    round: number;
    subtaskId: string;
  },
): string {
  return messages
    .filter((message) => (
      message.role === "assistant"
      && message.kind !== "thinking"
      && !message.subagentId
      && message.taskRole === "subtask"
      && message.lobsterTaskId === context.taskId
      && message.lobsterRound === context.round
      && message.lobsterSubtaskId === context.subtaskId
      && message.content.trim().length > 0
    ))
    .map((message) => message.content.trim())
    .join("\n\n");
}

export function mapLobsterRunStatusToSubagentStatus(
  status: "end" | "error" | "stopped",
): Exclude<SubagentProgressStatus, "running"> {
  if (status === "end") {
    return "completed";
  }
  return status === "stopped" ? "interrupted" : "failed";
}

export function createLobsterSubtaskProgressMonitor(options: {
  taskId: string;
  round: number;
  subtaskId: string;
  subtaskTitle: string;
  waitingText: string;
  readMessages: () => readonly ChatMessage[];
  onUpdate: (update: SubagentProgressUpdate) => void;
  intervalMs?: number;
  scheduler?: LobsterSubtaskProgressScheduler;
}): {
  start: () => void;
  sync: () => void;
  finish: (status: Exclude<SubagentProgressStatus, "running">) => void;
  dispose: () => void;
} {
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  const intervalMs = options.intervalMs ?? LOBSTER_SUBTASK_PROGRESS_POLL_INTERVAL_MS;
  const progressId = `${options.taskId}:${options.round}:${options.subtaskId}`;
  let intervalHandle: unknown = null;
  let lastText: string | null = null;
  let disposed = false;

  const readVisibleText = (): string => extractLobsterSubtaskVisibleText(
    options.readMessages(),
    {
      taskId: options.taskId,
      round: options.round,
      subtaskId: options.subtaskId,
    },
  );

  const emit = (status: SubagentProgressStatus, text: string): void => {
    options.onUpdate({
      provider: "loop",
      id: progressId,
      agentName: options.subtaskTitle,
      status,
      text,
    });
  };

  const sync = (): void => {
    if (disposed) {
      return;
    }
    const visibleText = readVisibleText();
    const nextText = visibleText || options.waitingText;
    if (nextText === lastText) {
      return;
    }
    lastText = nextText;
    emit("running", nextText);
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (intervalHandle !== null) {
      scheduler.clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };

  return {
    start: () => {
      if (disposed || intervalHandle !== null) {
        return;
      }
      sync();
      intervalHandle = scheduler.setInterval(sync, intervalMs);
    },
    sync,
    finish: (status) => {
      if (disposed) {
        return;
      }
      const visibleText = readVisibleText();
      const nextText = visibleText || lastText || options.waitingText;
      lastText = nextText;
      emit(status, nextText);
      dispose();
    },
    dispose,
  };
}
