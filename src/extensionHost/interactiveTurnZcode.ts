import { ZcodeInteractiveRunner } from "../interactive/zcodeRunner";
import { isZcodeSessionId } from "../interactive/zcodeAppServerProtocol";
import { normalizeRawStreamContent } from "../promptRunState";
import type { ZcodeInteractiveLaunch } from "./zcodeInteractiveLaunch";
import type { InteractiveTurnAttemptPort, InteractiveTurnStrategy } from "./interactiveTurnStrategy";

function isRealTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function createZcodeInteractiveTurnStrategy(): InteractiveTurnStrategy {
  return {
    async runAttempt(port: InteractiveTurnAttemptPort) {
      const launch = port.zcodeLaunch;
      if (!launch) {
        throw new Error("ZCode interactive launch is not prepared.");
      }
      const cwd = port.cwd ?? process.cwd();
      const uiSessionIdAtStart = port.uiSessionId;
      const previousSessionId = uiSessionIdAtStart;
      const mappedSessionId = uiSessionIdAtStart
        ? port.resolveInteractiveMappedId(port.cli, uiSessionIdAtStart)
        : null;
      const resumeSessionId = isZcodeSessionId(mappedSessionId) ? mappedSessionId : null;
      const model = port.zcodeModelWire ?? launch.modelRef;
      const runner = uiSessionIdAtStart
        ? port.interactiveRunnerManager.getOrCreateZcodeRunner({
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
        : new ZcodeInteractiveRunner({
          command: port.commandForRunner,
          agentArgs: launch.agentArgs,
          cwd,
          model,
          thinkingMode: launch.thinkingValue,
          modeId: launch.modeId,
          localSessionId: null,
          env: launch.env,
        });
      let flushingZcodeStop = false;
      port.setStopCurrentTurn(() => {
        flushingZcodeStop = true;
        try {
          runner.cancelTurn();
        } finally {
          flushingZcodeStop = false;
        }
      });
      port.syncInteractiveRunEntry(port.stopFn);
      const started = await runner.start();
      if (model) {
        await runner.setModel(model, launch.thinkingValue);
      } else if (launch.thinkingValue && runner.getSettings().thinkingOptions.includes(launch.thinkingValue)) {
        await runner.setThoughtLevel(launch.thinkingValue);
      }
      const settings = runner.getSettings();
      port.updateSessionForNewRun(started.sessionId);
      const uiSessionId = port.uiSessionId;
      if (previousSessionId && previousSessionId !== uiSessionId) {
        port.interactiveRunnerManager.detachRunner("zcode", previousSessionId, runner);
      }
      if (uiSessionId) {
        port.interactiveRunnerManager.setRunner(
          "zcode",
          uiSessionId,
          runner,
          port.thinkingMode,
          port.interactiveMode,
          settings.model,
          {
            command: port.commandForRunner,
            args: launch.agentArgs,
            cwd,
            localSessionId: started.sessionId,
            env: launch.env,
          },
        );
      }
      if (started.usage && isRealTokenCount(started.usage.tokensInContextWindow)) {
        port.sendPanelMessage({
          type: "contextTokenUsage",
          tabId: port.tabId,
          tokensInContextWindow: started.usage.tokensInContextWindow,
          modelContextWindow: started.usage.modelContextWindow,
          contextWindowSource: "zcode-projection",
        });
      }
      port.sendPanelMessage({
        type: "zcodeThinkingOptions",
        tabId: port.tabId,
        options: runner.getSettings().thinkingOptions,
        currentValue: runner.getSettings().thinking,
        modeId: runner.getSettings().modeId,
      });
      const zcodeToolMessageIds = new Map<string, string>();
      const result = await runner.prompt(port.attemptPrompt, {
        onAssistantDelta: (text) => {
          if (port.isCurrentRunActive()) {
            port.appendAssistantChunkForTab(text);
          }
        },
        onThinkingDelta: (text) => {
          if (port.isCurrentRunActive()) {
            port.appendTraceMessageForTab(text, "thinking");
          }
        },
        onTrace: (text, kind, meta) => {
          if (port.isCurrentRunActive()) {
            let id: string | undefined;
            if (meta?.toolCallId) {
              id = zcodeToolMessageIds.get(meta.toolCallId) ?? port.createMessageId();
              zcodeToolMessageIds.set(meta.toolCallId, id);
            }
            port.appendTraceMessageForTab(
              text,
              kind === "error" ? "normal" : "tool-use",
              { id, merge: false },
            );
          }
        },
        onEvent: (event) => {
          const entry = port.interactiveRunsByTabId.get(port.tabId);
          if (!port.isCurrentRunActive() && !(flushingZcodeStop && entry?.runId === port.runId)) {
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
        onTokenUsageUpdate: (usage) => {
          port.sendPanelMessage({
            type: "contextTokenUsage",
            tabId: port.tabId,
            tokensInContextWindow: usage.tokensInContextWindow,
            modelContextWindow: usage.modelContextWindow,
            contextWindowSource: "zcode-projection",
          });
        },
        onActivity: () => {
          if (port.isCurrentRunActive()) {
            port.sendPanelMessage({ type: "runActivity", tabId: port.tabId });
          }
        },
      });
      if (result.text.trim()) {
        port.attemptHadNormalReply = true;
      }
      port.observedZcodeFinalAnswer = true;
      return port.settleInteractiveAttempt("zcode");
    },
  };
}
