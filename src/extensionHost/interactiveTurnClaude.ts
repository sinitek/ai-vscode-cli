import {
  ClaudeInteractiveRunner,
  isClaudeEndTurnStop,
  isClaudeFailedFinalResult,
  isClaudeSuccessfulFinalResult,
  isClaudeToolUseStop,
} from "../interactive/claudeRunner";
import { getErrorInfo, type ErrorInfo } from "../panelDiagnostics";
import { normalizeRawStreamContent } from "../promptRunState";
import type { InteractiveTurnAttemptPort, InteractiveTurnStrategy } from "./interactiveTurnStrategy";

function isClaudeSessionNotFoundErrorInfo(info: ErrorInfo): boolean {
  const combined = `${String(info.code ?? "")} ${String(info.message ?? "")}`.toLowerCase();
  return combined.includes("claude_session_not_found")
    || combined.includes("no conversation found with session id:");
}

export function createClaudeInteractiveTurnStrategy(): InteractiveTurnStrategy {
  return {
    async runAttempt(port: InteractiveTurnAttemptPort) {
      const uiSessionIdAtStart = port.uiSessionId;
      const mappedSessionId = uiSessionIdAtStart
        ? port.resolveInteractiveMappedId(port.cli, uiSessionIdAtStart)
        : null;
      const runnerWasManaged = Boolean(uiSessionIdAtStart);
      let runner = uiSessionIdAtStart
        ? port.interactiveRunnerManager.getOrCreateClaudeRunner({
            sessionId: uiSessionIdAtStart,
            mappedSessionId,
            command: port.commandForRunner,
            args: port.args,
            cwd: port.cwd ?? undefined,
            thinkingMode: port.thinkingMode,
            interactiveMode: port.interactiveMode,
            model: port.selectedModel,
            entrypoint: port.claudeEntrypoint,
            isolateProjectInstructions: port.isolateProjectInstructions,
          })
        : new ClaudeInteractiveRunner({
            command: port.commandForRunner,
            args: port.args,
            cwd: port.cwd ?? undefined,
            thinkingMode: port.thinkingMode,
            interactiveMode: port.interactiveMode,
            model: port.selectedModel,
            entrypoint: port.claudeEntrypoint,
            sessionId: null,
            isolateProjectInstructions: port.isolateProjectInstructions,
          });

      const runStreamHandlers = {
        onAssistantDelta: (chunk: string) => {
          if (!port.isCurrentRunActive()) {
            return;
          }
          if (chunk.trim().length > 0) {
            port.attemptHadNormalReply = true;
            port.claudeSawAssistantText = true;
            port.claudeToolAfterAssistantText = false;
          }
          port.appendAssistantChunkForTab(chunk);
          port.appendDebugStdout(chunk);
        },
        onTrace: (content: string, kind?: "thinking" | "normal" | "tool-use", meta?: { merge?: boolean }) => {
          if (!port.isCurrentRunActive()) {
            return;
          }
          if (kind === "tool-use") {
            port.claudeToolAfterAssistantText = true;
            port.claudeSawEndTurn = false;
          }
          if (content.trim().length > 0 && kind !== "thinking") {
            port.attemptHadNormalReply = true;
          }
          port.appendTraceMessageForTab(content, kind ?? "normal", {
            ...meta,
            forceTraceBubble: kind === "thinking",
          });
          port.appendTraceLog(content);
        },
        onEvent: (event: unknown) => {
          if (!port.isCurrentRunActive()) {
            return;
          }
          if (isClaudeFailedFinalResult(event)) {
            port.claudeResultFailed = true;
          }
          if (isClaudeSuccessfulFinalResult(event)) {
            port.claudeSawSuccessfulResult = true;
          }
          if (isClaudeEndTurnStop(event)) {
            port.claudeSawEndTurn = true;
          }
          if (isClaudeToolUseStop(event)) {
            port.claudeToolAfterAssistantText = true;
            port.claudeSawEndTurn = false;
          }
          port.sendPanelMessage({ type: "rawStreamDelta", content: normalizeRawStreamContent(event) + (String(normalizeRawStreamContent(event)).endsWith("\n") ? "" : "\n"), stream: "event", tabId: port.tabId });
          port.appendDebugEvent(event);
        },
        onTaskListUpdate: (items: { text: string; done: boolean }[]) => {
          port.sendPanelMessage({ type: "taskListUpdate", items, tabId: port.tabId });
        },
        onSessionId: (newSessionId: string) => {
          port.updateProcessTitle(port.cli, newSessionId);
          port.updateSessionForNewRun(newSessionId);
          const uiSessionId = port.uiSessionId;
          void port.logInfo("runPrompt-interactive-claude-session", {
            cli: port.cli,
            sessionId: uiSessionId,
            newSessionId,
            originalSessionId: port.originalSessionId,
            tabId: port.tabId,
          });
          retainClaudeRunner();
          port.syncInteractiveRunEntry();
        },
      };

      const retainClaudeRunner = (): void => {
        const uiSessionId = port.uiSessionId;
        if (!uiSessionId) {
          return;
        }
        port.interactiveRunnerManager.setRunner("claude", uiSessionId, runner, port.thinkingMode, port.interactiveMode, port.selectedModel, {
          command: port.commandForRunner,
          args: port.args,
          cwd: port.cwd ?? undefined,
          entrypoint: port.claudeEntrypoint,
          isolateProjectInstructions: port.isolateProjectInstructions === true,
        });
      };

      try {
        port.setStopCurrentTurn(() => runner.stopAndRebuild());
        port.syncInteractiveRunEntry(port.stopFn);
        try {
          await runner.runStreamed(port.attemptPrompt, runStreamHandlers);
        } catch (error) {
          const info = getErrorInfo(error);
          const uiSessionId = port.uiSessionId;
          if (uiSessionId && isClaudeSessionNotFoundErrorInfo(info)) {
            port.appendSystemMessageForTab(port.t("claude.sessionResetRetry"));
            void port.logInfo("runPrompt-interactive-claude-session-reset-retry", {
              cli: port.cli,
              sessionId: uiSessionId,
              mappedSessionId,
              error: info.message,
              errorCode: info.code,
              tabId: port.tabId,
            });
            runner.dispose();
            runner = new ClaudeInteractiveRunner({
              command: port.commandForRunner,
              args: port.args,
              cwd: port.cwd ?? undefined,
              thinkingMode: port.thinkingMode,
              interactiveMode: port.interactiveMode,
              model: port.selectedModel,
              entrypoint: port.claudeEntrypoint,
              sessionId: null,
              isolateProjectInstructions: port.isolateProjectInstructions,
            });
            retainClaudeRunner();
            port.setStopCurrentTurn(() => runner.stopAndRebuild());
            port.syncInteractiveRunEntry(port.stopFn);
            port.claudeSawAssistantText = false;
            port.claudeToolAfterAssistantText = false;
            port.claudeResultFailed = false;
            port.claudeSawSuccessfulResult = false;
            port.claudeSawEndTurn = false;
            await runner.runStreamed(port.attemptPrompt, runStreamHandlers);
          } else {
            throw error;
          }
        }
        if (
          !port.claudeResultFailed
          && port.claudeSawAssistantText
          && !port.claudeToolAfterAssistantText
          && (port.claudeSawSuccessfulResult || port.claudeSawEndTurn)
        ) {
          port.observedClaudeFinalAnswer = true;
        }
        return await port.settleInteractiveAttempt("claude");
      } finally {
        if (!runnerWasManaged) {
          const sessionId = runner.getSessionId();
          const retained = Boolean(
            sessionId
            && port.interactiveRunnerManager.hasClaudeRunner?.(sessionId, runner)
          );
          if (!retained) {
            runner.dispose();
          }
        }
      }
    },
  };
}
