import { isGrokCompletedStopReason, resolveGrokResumeSessionId } from "../interactive/grokAppServerProtocol";
import { GrokInteractiveRunner } from "../interactive/grokRunner";
import { normalizeRawStreamContent } from "../promptRunState";
import type { InteractiveTurnAttemptPort, InteractiveTurnStrategy } from "./interactiveTurnStrategy";

export function createGrokInteractiveTurnStrategy(): InteractiveTurnStrategy {
  return {
    async runAttempt(port: InteractiveTurnAttemptPort) {
      const grokCwd = port.cwd ?? process.cwd();
      const uiSessionIdAtStart = port.uiSessionId;
      const runnerWasManaged = Boolean(uiSessionIdAtStart);
      const previousSessionId = uiSessionIdAtStart;
      const mappedSessionId = uiSessionIdAtStart
        ? port.resolveInteractiveMappedId(port.cli, uiSessionIdAtStart)
        : null;
      const resumeSessionId = resolveGrokResumeSessionId(uiSessionIdAtStart, mappedSessionId);
      port.observedGrokFinalAnswer = false;
      const runner = uiSessionIdAtStart
        ? port.interactiveRunnerManager.getOrCreateGrokRunner({
            sessionId: uiSessionIdAtStart,
            command: port.commandForRunner,
            agentArgs: port.grokAgentArgs,
            cwd: grokCwd,
            thinkingMode: port.thinkingMode,
            interactiveMode: port.interactiveMode,
            model: port.selectedModel,
            localSessionId: resumeSessionId,
          })
        : new GrokInteractiveRunner({
            command: port.commandForRunner,
            agentArgs: port.grokAgentArgs,
            cwd: grokCwd,
            thinkingMode: port.thinkingMode,
            model: port.selectedModel,
            localSessionId: null,
          });

      let flushingGrokStop = false;
      const canEmitGrokPresentation = (): boolean => {
        const entry = port.interactiveRunsByTabId.get(port.tabId);
        return Boolean(entry && entry.runId === port.runId && (!entry.stopped || flushingGrokStop));
      };
      try {
        port.setStopCurrentTurn(() => {
          flushingGrokStop = true;
          try {
            runner.cancelTurn();
          } finally {
            flushingGrokStop = false;
          }
        });
        port.syncInteractiveRunEntry(port.stopFn);
        const started = await runner.start();
        port.updateSessionForNewRun(started.acpSessionId);
        const uiSessionId = port.uiSessionId;
        if (previousSessionId && previousSessionId !== uiSessionId) {
          port.interactiveRunnerManager.detachRunner("grok", previousSessionId, runner);
        }
        if (uiSessionId) {
          port.interactiveRunnerManager.setRunner("grok", uiSessionId, runner, port.thinkingMode, port.interactiveMode, port.selectedModel, {
            command: port.commandForRunner,
            args: port.grokAgentArgs,
            cwd: grokCwd,
          });
        }
        port.syncInteractiveRunEntry(port.stopFn);
        let grokStopReason: string | null = null;
        let grokPromptCompleted = false;
        let lastGrokActivityAt = 0;
        const grokToolMessageIds = new Map<string, string>();
        await runner.prompt(port.attemptPrompt, {
          onActivity: () => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            const now = Date.now();
            if (now - lastGrokActivityAt >= 1000) {
              lastGrokActivityAt = now;
              port.sendPanelMessage({ type: "runActivity", tabId: port.tabId });
            }
          },
          onTaskListUpdate: (items) => {
            if (port.isCurrentRunActive()) {
              port.sendPanelMessage({ type: "taskListUpdate", items, tabId: port.tabId });
            }
          },
          onTokenUsageUpdate: (update) => {
            if (!port.isCurrentRunActive()) {
              const currentTab = port.getConversationTabById(port.tabId);
              const currentSessionId = port.uiSessionId;
              if (!grokPromptCompleted
                || port.interactiveRunsByTabId.has(port.tabId)
                || currentTab?.cli !== "grok"
                || !currentSessionId
                || currentTab.sessionId !== currentSessionId
                || !port.interactiveRunnerManager.hasGrokRunner(currentSessionId, runner)) {
                return;
              }
            }
            port.sendPanelMessage({
              type: "contextTokenUsage",
              tabId: port.tabId,
              tokensInContextWindow: update.tokensInContextWindow,
              modelContextWindow: update.modelContextWindow,
            });
          },
          onAssistantDelta: (chunk) => {
            if (!port.isCurrentRunActive() || !chunk) {
              return;
            }
            if (chunk.trim()) {
              port.attemptHadNormalReply = true;
            }
            port.appendAssistantChunkForTab(chunk);
            port.appendDebugStdout(chunk);
          },
          onTrace: (content, kind, meta) => {
            if (!canEmitGrokPresentation()) {
              return;
            }
            if (kind === "thinking") {
              port.appendAssistantChunkForTab(content, "thinking");
              port.appendTraceLog(content);
              return;
            }
            let id: string | undefined;
            if (meta?.toolCallId) {
              id = grokToolMessageIds.get(meta.toolCallId) ?? port.createMessageId();
              grokToolMessageIds.set(meta.toolCallId, id);
            }
            port.appendTraceMessageForTab(content, kind === "tool-use" ? "tool-use" : "normal", { id, merge: false });
            port.appendTraceLog(content);
          },
          onEvent: (event) => {
            if (!canEmitGrokPresentation()) {
              return;
            }
            const content = normalizeRawStreamContent(event);
            port.sendPanelMessage({ type: "rawStreamDelta", content: content + (content.endsWith("\n") ? "" : "\n"), stream: "event", tabId: port.tabId });
            port.appendDebugEvent(event);
          },
          onComplete: ({ stopReason }) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            grokStopReason = stopReason;
          },
        });
        grokPromptCompleted = port.isCurrentRunActive();
        if (port.attemptHadNormalReply && isGrokCompletedStopReason(grokStopReason)) {
          port.observedGrokFinalAnswer = true;
        }
        return await port.settleInteractiveAttempt("grok");
      } finally {
        if (!runnerWasManaged) {
          const uiSessionId = port.uiSessionId;
          const retained = Boolean(
            uiSessionId
            && port.interactiveRunnerManager.hasGrokRunner(uiSessionId, runner)
          );
          if (!retained) {
            runner.dispose();
          }
        }
      }
    },
  };
}
