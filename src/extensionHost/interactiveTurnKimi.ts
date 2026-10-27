import {
  isKimiCompletedStopReason,
  resolveKimiHostResumeId,
} from "../interactive/kimiAppServerProtocol";
import { KimiInteractiveRunner } from "../interactive/kimiRunner";
import { normalizeRawStreamContent } from "../promptRunState";
import type { KimiInteractiveLaunch } from "./kimiInteractiveLaunch";
import type { InteractiveTurnAttemptPort, InteractiveTurnStrategy } from "./interactiveTurnStrategy";

function isRealTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function createKimiCodeInteractiveTurnStrategy(): InteractiveTurnStrategy {
  return {
    async runAttempt(port: InteractiveTurnAttemptPort) {
      const launch = port.kimiLaunch;
      if (!launch) {
        throw new Error("Kimi Code interactive launch is not prepared.");
      }
      const cwd = port.cwd ?? process.cwd();
      const uiSessionIdAtStart = port.uiSessionId;
      const runnerWasManaged = Boolean(uiSessionIdAtStart);
      const previousSessionId = uiSessionIdAtStart;
      const mappedSessionId = uiSessionIdAtStart
        ? port.resolveInteractiveMappedId(port.cli, uiSessionIdAtStart)
        : null;
      const resumeSessionId = resolveKimiHostResumeId(uiSessionIdAtStart, mappedSessionId);
      const requireResume = resumeSessionId !== null;
      port.observedKimiFinalAnswer = false;
      const model = port.kimiModelWire ?? launch.modelAlias;
      const runner = uiSessionIdAtStart
        ? port.interactiveRunnerManager.getOrCreateKimiCodeRunner({
          sessionId: uiSessionIdAtStart,
          command: port.commandForRunner,
          agentArgs: launch.agentArgs,
          cwd,
          thinkingMode: port.thinkingMode,
          thinkingValue: launch.thinkingValue,
          interactiveMode: port.interactiveMode,
          model,
          modeId: launch.modeId,
          localSessionId: resumeSessionId,
          env: launch.env,
        })
        : new KimiInteractiveRunner({
          command: port.commandForRunner,
          agentArgs: launch.agentArgs,
          cwd,
          model,
          thinkingMode: launch.thinkingValue,
          modeId: launch.modeId,
          localSessionId: null,
          env: launch.env,
        });

      let flushingKimiStop = false;
      const canEmitKimiPresentation = (): boolean => {
        const entry = port.interactiveRunsByTabId.get(port.tabId);
        return Boolean(entry && entry.runId === port.runId && (!entry.stopped || flushingKimiStop));
      };
      try {
        port.setStopCurrentTurn(() => {
          flushingKimiStop = true;
          try {
            runner.cancelTurn();
          } finally {
            flushingKimiStop = false;
          }
        });
        port.syncInteractiveRunEntry(port.stopFn);
        const started = await runner.start({ requireResume });
        if (model) {
          await runner.setModel(model);
        }
        if (launch.thinkingValue) {
          await runner.setThinkingMode(launch.thinkingValue);
        }
        port.updateSessionForNewRun(started.acpSessionId);
        const uiSessionId = port.uiSessionId;
        if (previousSessionId && previousSessionId !== uiSessionId) {
          port.interactiveRunnerManager.detachRunner("kimi-code", previousSessionId, runner);
        }
        const snapshot = runner.getConfigSnapshot();
        if (uiSessionId) {
          port.interactiveRunnerManager.setRunner(
            "kimi-code",
            uiSessionId,
            runner,
            confirmedThinkingMode(snapshot.thinking, port.thinkingMode),
            port.interactiveMode,
            snapshot.model,
            {
              command: port.commandForRunner,
              args: launch.agentArgs,
              cwd,
              // Remember the ACP id so the next turn reuses this process.
              localSessionId: started.acpSessionId,
              env: launch.env,
            },
          );
        }
        port.syncInteractiveRunEntry(port.stopFn);
        if (port.isCurrentRunActive()) {
          port.sendPanelMessage({
            type: "kimiThinkingOptions",
            tabId: port.tabId,
            options: snapshot.thinkingOptions,
            currentValue: snapshot.thinking,
            modeId: snapshot.modeId,
          });
        }
        let kimiStopReason: string | null = null;
        let kimiPromptCompleted = false;
        let lastKimiActivityAt = 0;
        const kimiToolMessageIds = new Map<string, string>();
        await runner.prompt(port.attemptPrompt, {
          onRequest: async () => null,
          onTaskListUpdate: (items) => {
            if (canEmitKimiPresentation()) {
              port.sendPanelMessage({ type: "taskListUpdate", items, tabId: port.tabId });
            }
          },
          onActivity: () => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            const now = Date.now();
            if (now - lastKimiActivityAt >= 1000) {
              lastKimiActivityAt = now;
              port.sendPanelMessage({ type: "runActivity", tabId: port.tabId });
            }
          },
          onTokenUsageUpdate: (update) => {
            if (!isRealTokenCount(update.tokensInContextWindow) || !isRealTokenCount(update.modelContextWindow)) {
              return;
            }
            if (!port.isCurrentRunActive()) {
              const currentTab = port.getConversationTabById(port.tabId);
              const currentSessionId = port.uiSessionId;
              if (!kimiPromptCompleted
                || port.interactiveRunsByTabId.has(port.tabId)
                || currentTab?.cli !== "kimi-code"
                || !currentSessionId
                || currentTab.sessionId !== currentSessionId
                || !port.interactiveRunnerManager.hasKimiCodeRunner(currentSessionId, runner)) {
                return;
              }
            }
            port.sendPanelMessage({
              type: "contextTokenUsage",
              tabId: port.tabId,
              tokensInContextWindow: update.tokensInContextWindow,
              modelContextWindow: update.modelContextWindow,
              // ACP 的 usage_update.size 来自模型目录里配置声明的 max_context_size，
              // 是配置真值而不是适配器 fallback（DSH 的 adapter-fallback 语义不变）。
              contextWindowSource: "kimi-config-window",
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
            if (!canEmitKimiPresentation()) {
              return;
            }
            if (kind === "thinking") {
              port.appendAssistantChunkForTab(content, "thinking");
              port.appendTraceLog(content);
              return;
            }
            let id: string | undefined;
            if (meta?.toolCallId) {
              id = kimiToolMessageIds.get(meta.toolCallId) ?? port.createMessageId();
              kimiToolMessageIds.set(meta.toolCallId, id);
            }
            port.appendTraceMessageForTab(content, kind === "tool-use" ? "tool-use" : "normal", { id, merge: false });
            port.appendTraceLog(content);
          },
          onEvent: (event) => {
            if (!canEmitKimiPresentation()) {
              return;
            }
            const content = normalizeRawStreamContent(event);
            port.sendPanelMessage({
              type: "rawStreamDelta",
              content: content + (content.endsWith("\n") ? "" : "\n"),
              stream: "event",
              tabId: port.tabId,
            });
            port.appendDebugEvent(event);
          },
          onModeUpdate: (modeId) => {
            if (!canEmitKimiPresentation()) {
              return;
            }
            port.sendPanelMessage({ type: "kimiModeUpdate", tabId: port.tabId, modeId });
          },
          onComplete: ({ stopReason }) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            kimiStopReason = stopReason;
          },
        });
        kimiPromptCompleted = port.isCurrentRunActive();
        if (port.attemptHadNormalReply && isKimiCompletedStopReason(kimiStopReason)) {
          port.observedKimiFinalAnswer = true;
        }
        return await port.settleInteractiveAttempt("kimi-code");
      } finally {
        if (!runnerWasManaged) {
          const uiSessionId = port.uiSessionId;
          const retained = Boolean(
            uiSessionId
            && port.interactiveRunnerManager.hasKimiCodeRunner(uiSessionId, runner)
          );
          if (!retained) {
            runner.dispose();
          }
        }
      }
    },
  };
}

function confirmedThinkingMode(
  confirmed: string | null,
  requested: InteractiveTurnAttemptPort["thinkingMode"],
): InteractiveTurnAttemptPort["thinkingMode"] {
  if (confirmed && confirmed !== "off") {
    return confirmed as InteractiveTurnAttemptPort["thinkingMode"];
  }
  return requested;
}
