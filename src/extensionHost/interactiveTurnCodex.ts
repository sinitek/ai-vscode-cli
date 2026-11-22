import { normalizeRawStreamContent } from "../promptRunState";
import { extractTaskListItemsFromForwardedCodexEvent } from "../interactive/codexAppServerProtocol";
import { CodexInteractiveRunner, type CodexStreamHandlers } from "../interactive/codexRunner";
import { isCodexRetryProgressTraceKind } from "../interactive/codexRunnerRuntime";
import { decideCodexThreadForSelection, normalizeCodexRunSelection } from "../interactive/codexThreadSelection";
import type { InteractiveTurnAttemptPort, InteractiveTurnStrategy } from "./interactiveTurnStrategy";

export function createCodexInteractiveTurnStrategy(): InteractiveTurnStrategy {
  return {
    async runAttempt(port: InteractiveTurnAttemptPort) {
      const uiSessionIdAtStart = port.uiSessionId;
      const originalThreadTurn = port.originalCodexThreadTurn;
      const mappedThreadId = uiSessionIdAtStart
        ? port.resolveInteractiveMappedId(port.cli, uiSessionIdAtStart)
        : null;
      const nextSelection = normalizeCodexRunSelection({
        configId: port.activeConfigId,
        model: port.selectedModel,
      });
      const threadDecision = originalThreadTurn ? {
        threadId: originalThreadTurn.threadId, freezePrevious: null, startedFreshForSelectionChange: false,
      } : decideCodexThreadForSelection({
        mappedThreadId,
        previousSelection: uiSessionIdAtStart
          ? port.interactiveRunnerManager.getCodexRunnerSelection(uiSessionIdAtStart)
            ?? port.resolveCodexInteractiveSelection(uiSessionIdAtStart)
          : null,
        nextSelection,
      });
      const recovery = port.loopPlusMain?.recovery;
      if (recovery && threadDecision.threadId !== recovery.threadId) return "return";
      if (threadDecision.startedFreshForSelectionChange) {
        void port.logInfo("runPrompt-interactive-codex-selection-new-thread", {
          cli: port.cli,
          sessionId: uiSessionIdAtStart,
          configFingerprint: port.configFingerprint,
          previousThreadId: mappedThreadId,
          configId: nextSelection.configId,
          model: nextSelection.model,
          tabId: port.tabId,
        });
      }
      const runnerWasManaged = Boolean(uiSessionIdAtStart && !originalThreadTurn);
      let ownedThreadId: string | null = null;
      const runner = port.departmentCodexRun ? {
        runStreamed: port.departmentCodexRun,
        stopAndRebuild: () => port.cancelDepartmentCodexPreparation?.(),
        getThreadId: () => ownedThreadId,
        dispose: () => undefined,
      } : runnerWasManaged && uiSessionIdAtStart
        ? port.interactiveRunnerManager.getOrCreateCodexRunner({
            sessionId: uiSessionIdAtStart,
            configFingerprint: port.configFingerprint,
            threadId: threadDecision.threadId,
            command: port.command,
            args: port.args,
            cwd: port.cwd ?? undefined,
            thinkingMode: port.thinkingMode,
            interactiveMode: port.interactiveMode,
            model: nextSelection.model,
            configId: nextSelection.configId,
          })
        : new CodexInteractiveRunner({
            configFingerprint: port.configFingerprint,
            command: port.command,
            args: port.args,
            cwd: port.cwd ?? undefined,
            thinkingMode: port.thinkingMode,
            interactiveMode: port.interactiveMode,
            model: nextSelection.model,
            threadId: originalThreadTurn?.threadId ?? null,
          });

      try {
        port.setStopCurrentTurn(() => runner.stopAndRebuild());
        port.syncInteractiveRunEntry(port.stopFn);
        const handlers: CodexStreamHandlers = {
          loopPlusMain: port.loopPlusMain,
          onAssistantDelta: (chunk, meta) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            if (meta?.kind === "thinking") {
              port.appendAssistantChunkForTab(chunk, "thinking", {
                reasoningItemId: meta.reasoningItemId,
              });
              port.appendDebugStdout(chunk);
              return;
            }
            if (meta?.codexFinalAnswer === true) {
              port.observedCodexFinalAnswer = true;
            }
            if (chunk.trim().length > 0) {
              port.attemptHadNormalReply = true;
            }
            port.appendAssistantChunkForTab(chunk, undefined, {
              codexFinalAnswer: meta?.codexFinalAnswer === true,
              assistantItemId: meta?.assistantItemId,
            });
            port.appendDebugStdout(chunk);
          },
          onSubagentUpdate: (update) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            port.updateSubagentProgress({
              provider: "codex",
              id: update.threadId,
              agentName: update.agentName,
              status: update.status,
              delta: update.delta,
              error: update.error,
            });
          },
          onTrace: (content, kind, meta) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            if (content.trim().length > 0 && isCodexRetryProgressTraceKind(kind)) {
              port.attemptHadNormalReply = true;
            }
            port.appendTraceMessageForTab(content, kind === "thinking" ? "thinking" : "normal", meta);
            port.appendTraceLog(content);
          },
          onEvent: (event) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            port.sendPanelMessage({ type: "rawStreamDelta", content: normalizeRawStreamContent(event) + (String(normalizeRawStreamContent(event)).endsWith("\n") ? "" : "\n"), stream: "event", tabId: port.tabId });
            const eventTaskListItems = extractTaskListItemsFromForwardedCodexEvent(event, runner.getThreadId());
            if (eventTaskListItems.length) {
              port.sendPanelMessage({ type: "taskListUpdate", items: eventTaskListItems, tabId: port.tabId });
            }
            port.appendDebugEvent(event);
          },
          onTurnCompleted: () => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            port.observedCodexPrimaryTurnCompleted = true;
          },
          onTaskListUpdate: (items) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            port.sendPanelMessage({ type: "taskListUpdate", items, tabId: port.tabId });
          },
          onTokenUsageUpdate: (update) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            port.sendPanelMessage({
              type: "contextTokenUsage",
              tabId: port.tabId,
              tokensInContextWindow: update.tokensInContextWindow,
              modelContextWindow: update.modelContextWindow,
            });
          },
          onRequest: port.handleStructuredHumanInteractionRequest,
          requestUserInputEnabled: port.canHandleStructuredHumanInteractionRequest(),
          onThreadId: (threadId) => {
            ownedThreadId = threadId;
            if (!port.isCurrentRunActive()) {
              return;
            }
            port.updateProcessTitle(port.cli, threadId);
            port.updateSessionForNewRun(threadId, {
              freezePrevious: threadDecision.freezePrevious,
              codexSelection: nextSelection,
            });
            const uiSessionId = port.uiSessionId;
            void port.logInfo("runPrompt-interactive-codex-thread", {
              cli: port.cli,
              sessionId: uiSessionId,
              threadId,
              replacedThreadId: threadDecision.freezePrevious,
              configId: nextSelection.configId,
              model: nextSelection.model,
              originalSessionId: port.originalSessionId,
              tabId: port.tabId,
            });
            if (uiSessionId && !port.departmentCodexRun) {
              port.interactiveRunnerManager.setRunner("codex", uiSessionId, runner as CodexInteractiveRunner, port.thinkingMode, port.interactiveMode, nextSelection.model, {
                configId: nextSelection.configId,
                command: port.command,
                configFingerprint: port.configFingerprint,
                args: port.args,
                cwd: port.cwd ?? undefined,
              });
            }
            port.syncInteractiveRunEntry();
          },
        };
        if (port.departmentCodexRun) await port.departmentCodexRun(port.attemptPrompt, handlers);
        else await (runner as CodexInteractiveRunner).runStreamed(port.attemptPrompt, handlers, undefined, originalThreadTurn);
        return await port.settleInteractiveAttempt("codex");
      } finally {
        if (!port.departmentCodexRun && !runnerWasManaged) {
          const localRunner = runner as CodexInteractiveRunner;
          const threadId = localRunner.getThreadId();
          if (originalThreadTurn || !threadId || !port.interactiveRunnerManager.hasCodexRunner(threadId, localRunner)) {
            localRunner.dispose();
          }
        }
      }
    },
  };
}
