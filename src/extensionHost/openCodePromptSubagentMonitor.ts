import type { createOpenCodeSubagentMonitor, OpenCodeSubagentMonitor } from "../cli/openCodeSubagentMonitor";
import type { CliName } from "../cli/types";
import type { logDebug, logInfo } from "../logger";
import type { SubagentProgressUpdate } from "../subagentProgress";
import type { OpenCodePromptSubagentMonitorContext } from "./openCodePromptRunTemplate";

export type OpenCodePromptMonitorFactory = (options: Pick<Parameters<typeof createOpenCodeSubagentMonitor>[0],
  "connection" | "directory" | "onUpdate" | "onNoChildren" | "onError"
>) => OpenCodeSubagentMonitor;

export function createOpenCodePromptSubagentMonitor(
  context: OpenCodePromptSubagentMonitorContext,
  ports: {
    kind: "one-shot" | "parallel";
    createMonitor: OpenCodePromptMonitorFactory;
    createDisabledMonitor: () => OpenCodeSubagentMonitor;
    canUpdateProgress: () => boolean;
    canShowEmptyProgressNotice: () => boolean;
    hasShownEmptyProgressNotice: () => boolean;
    markEmptyProgressNoticeShown: () => void;
    updateProgress: (update: SubagentProgressUpdate) => void;
    showEmptyProgressNotice: () => void;
    getLogContext: () => { cli: CliName; runId: string; tabId: string; sessionId: string | null };
    pollIntervalMs: number;
    logInfo: typeof logInfo;
    logDebug: typeof logDebug;
  },
): OpenCodeSubagentMonitor {
  const { subagentRuntime, attemptNumber, directory } = context;
  if (!subagentRuntime.connection) {
    return ports.createDisabledMonitor();
  }
  return ports.createMonitor({
    connection: subagentRuntime.connection,
    directory,
    onUpdate: (update) => {
      if (ports.canUpdateProgress()) {
        ports.updateProgress(update);
      }
    },
    onNoChildren: () => {
      if (ports.hasShownEmptyProgressNotice() || !ports.canShowEmptyProgressNotice()) {
        return;
      }
      ports.markEmptyProgressNoticeShown();
      ports.showEmptyProgressNotice();
      void ports.logInfo(`runPrompt-${ports.kind}-subagent-poll-empty`, {
        ...ports.getLogContext(),
        attempt: attemptNumber,
        pollIntervalMs: ports.pollIntervalMs,
      });
    },
    onError: (error) => {
      void ports.logDebug(`runPrompt-${ports.kind}-subagent-monitor-error`, {
        ...ports.getLogContext(),
        attempt: attemptNumber,
        error: error.message,
      });
    },
  });
}
