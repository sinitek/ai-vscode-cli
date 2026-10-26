import { isDshCompletedStopReason, resolveDshHostResumeId } from "../interactive/dshAppServerProtocol";
import { DshInteractiveRunner } from "../interactive/dshRunner";
import { normalizeRawStreamContent } from "../promptRunState";
import { DSH_REASONING_OPTIONS } from "../cli/dshConfigModels";
import type { DshInteractiveLaunch } from "./dshInteractiveLaunch";
import type { InteractiveTurnAttemptPort, InteractiveTurnStrategy } from "./interactiveTurnStrategy";

const HIDDEN_DSH_REASONING_VALUES = new Set(["off"]);

function visibleDshReasoningOptions(options: readonly string[]): string[] {
  return options.filter((option) =>
    !HIDDEN_DSH_REASONING_VALUES.has(option)
    && (DSH_REASONING_OPTIONS as readonly string[]).includes(option),
  );
}

function confirmedThinkingMode(
  reasoningEffort: string | null,
  requested: InteractiveTurnAttemptPort["thinkingMode"],
): InteractiveTurnAttemptPort["thinkingMode"] {
  if (reasoningEffort && (DSH_REASONING_OPTIONS as readonly string[]).includes(reasoningEffort)) {
    return reasoningEffort as InteractiveTurnAttemptPort["thinkingMode"];
  }
  return requested;
}

function isRealTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function createDshInteractiveTurnStrategy(): InteractiveTurnStrategy {
  return {
    async runAttempt(port: InteractiveTurnAttemptPort) {
      const launch = port.dshLaunch;
      const modelWire = port.dshModelWire;
      if (!launch || !modelWire) {
        throw new Error("DSH interactive launch is not prepared.");
      }
      const dshCwd = port.cwd ?? process.cwd();
      const uiSessionIdAtStart = port.uiSessionId;
      const runnerWasManaged = Boolean(uiSessionIdAtStart);
      const previousSessionId = uiSessionIdAtStart;
      const mappedSessionId = uiSessionIdAtStart
        ? port.resolveInteractiveMappedId(port.cli, uiSessionIdAtStart)
        : null;
      const resumeSessionId = resolveDshHostResumeId(uiSessionIdAtStart, mappedSessionId);
      const requireResume = resumeSessionId !== null;
      port.observedDshFinalAnswer = false;
      const runnerOptions = {
        command: port.commandForRunner,
        agentArgs: launch.agentArgs,
        cwd: dshCwd,
        thinkingMode: port.thinkingMode,
        interactiveMode: port.interactiveMode,
        model: modelWire,
        localSessionId: resumeSessionId,
        env: launch.env,
      };
      const runner = uiSessionIdAtStart
        ? port.interactiveRunnerManager.getOrCreateDshRunner({
          sessionId: uiSessionIdAtStart,
          ...runnerOptions,
        })
        : new DshInteractiveRunner({
          command: runnerOptions.command,
          agentArgs: runnerOptions.agentArgs,
          cwd: runnerOptions.cwd,
          thinkingMode: runnerOptions.thinkingMode,
          model: runnerOptions.model,
          localSessionId: null,
          env: runnerOptions.env,
        });

      let flushingDshStop = false;
      const canEmitDshPresentation = (): boolean => {
        const entry = port.interactiveRunsByTabId.get(port.tabId);
        return Boolean(entry && entry.runId === port.runId && (!entry.stopped || flushingDshStop));
      };
      try {
        port.setStopCurrentTurn(() => {
          flushingDshStop = true;
          try {
            runner.cancelTurn();
          } finally {
            flushingDshStop = false;
          }
        });
        port.syncInteractiveRunEntry(port.stopFn);
        const started = await runner.start({ requireResume });
        port.updateSessionForNewRun(started.acpSessionId);
        const uiSessionId = port.uiSessionId;
        if (previousSessionId && previousSessionId !== uiSessionId) {
          port.interactiveRunnerManager.detachRunner("dsh", previousSessionId, runner);
        }
        await applyAdvertisedDshConfig(port, runner, modelWire);
        if (uiSessionId) {
          const confirmed = runner.getConfigSnapshot();
          port.interactiveRunnerManager.setRunner(
            "dsh",
            uiSessionId,
            runner,
            confirmedThinkingMode(confirmed.reasoningEffort, port.thinkingMode),
            port.interactiveMode,
            confirmed.model,
            {
              command: port.commandForRunner,
              args: launch.agentArgs,
              cwd: dshCwd,
              // Remember the ACP id, not the pre-start local_ id, so the next
              // turn reuses this process instead of opening an empty home.
              localSessionId: started.acpSessionId,
              env: launch.env,
            },
          );
        }
        port.syncInteractiveRunEntry(port.stopFn);
        let dshStopReason: string | null = null;
        let dshPromptCompleted = false;
        let lastDshActivityAt = 0;
        const dshToolMessageIds = new Map<string, string>();
        await runner.prompt(port.attemptPrompt, {
          onRequest: async () => null,
          onTaskListUpdate: (items) => {
            if (canEmitDshPresentation()) {
              port.sendPanelMessage({ type: "taskListUpdate", items, tabId: port.tabId });
            }
          },
          onActivity: () => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            const now = Date.now();
            if (now - lastDshActivityAt >= 1000) {
              lastDshActivityAt = now;
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
              if (!dshPromptCompleted
                || port.interactiveRunsByTabId.has(port.tabId)
                || currentTab?.cli !== "dsh"
                || !currentSessionId
                || currentTab.sessionId !== currentSessionId
                || !port.interactiveRunnerManager.hasDshRunner(currentSessionId, runner)) {
                return;
              }
            }
            port.sendPanelMessage({
              type: "contextTokenUsage",
              tabId: port.tabId,
              tokensInContextWindow: update.tokensInContextWindow,
              modelContextWindow: update.modelContextWindow,
              contextWindowSource: "adapter-fallback",
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
            if (!canEmitDshPresentation()) {
              return;
            }
            if (kind === "thinking") {
              port.appendAssistantChunkForTab(content, "thinking");
              port.appendTraceLog(content);
              return;
            }
            let id: string | undefined;
            if (meta?.toolCallId) {
              id = dshToolMessageIds.get(meta.toolCallId) ?? port.createMessageId();
              dshToolMessageIds.set(meta.toolCallId, id);
            }
            port.appendTraceMessageForTab(content, kind === "tool-use" ? "tool-use" : "normal", { id, merge: false });
            port.appendTraceLog(content);
          },
          onEvent: (event) => {
            if (!canEmitDshPresentation()) {
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
          onComplete: ({ stopReason }) => {
            if (!port.isCurrentRunActive()) {
              return;
            }
            dshStopReason = stopReason;
          },
        });
        dshPromptCompleted = port.isCurrentRunActive();
        if (port.attemptHadNormalReply && isDshCompletedStopReason(dshStopReason)) {
          port.observedDshFinalAnswer = true;
        }
        return await port.settleInteractiveAttempt("dsh");
      } finally {
        if (!runnerWasManaged) {
          const uiSessionId = port.uiSessionId;
          const retained = Boolean(
            uiSessionId
            && port.interactiveRunnerManager.hasDshRunner(uiSessionId, runner)
          );
          if (!retained) {
            runner.dispose();
          }
        }
      }
    },
  };
}

async function applyAdvertisedDshConfig(
  port: InteractiveTurnAttemptPort,
  runner: DshInteractiveRunner,
  modelWire: string,
): Promise<void> {
  const before = runner.getConfigSnapshot();
  if (before.model !== modelWire) {
    await runner.setModel(modelWire);
  }
  let snapshot = runner.getConfigSnapshot();
  const requested = port.thinkingMode;
  let applicationStatus: "already-current" | "applied" | "not-advertised" = "already-current";
  const requestedWireValue = snapshot.reasoningOptions.includes(requested) ? requested : null;
  if (snapshot.reasoningOptions.length === 0 || !snapshot.reasoningOptions.includes(requested)) {
    if (snapshot.reasoningOptions.length > 0 && requested !== snapshot.reasoningEffort) {
      port.appendSystemMessageForTab(port.t("dsh.reasoningUnavailable"));
    }
    if (requested !== snapshot.reasoningEffort) {
      applicationStatus = "not-advertised";
    }
  } else if (snapshot.reasoningEffort !== requested) {
    applicationStatus = "applied";
    try {
      await runner.setThinkingMode(requested);
      snapshot = runner.getConfigSnapshot();
    } catch (error) {
      port.logInfo("dsh-reasoning-effort-apply-failed", {
        configId: "reasoning_effort",
        requestedValue: requestedWireValue,
        advertisedValues: visibleDshReasoningOptions(snapshot.reasoningOptions),
        currentValue: snapshot.reasoningEffort,
        errorCode: error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "unknown")
          : error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  }
  port.logInfo("dsh-reasoning-effort", {
    configId: "reasoning_effort",
    requestedValue: requested,
    wireValue: applicationStatus === "applied" ? requestedWireValue : null,
    advertisedValues: visibleDshReasoningOptions(snapshot.reasoningOptions),
    previousValue: before.reasoningEffort,
    confirmedValue: snapshot.reasoningEffort,
    status: applicationStatus,
  });
  if (port.isCurrentRunActive()) {
    port.sendPanelMessage({
      type: "dshReasoningOptions",
      tabId: port.tabId,
      options: visibleDshReasoningOptions(snapshot.reasoningOptions),
      currentValue: snapshot.reasoningEffort,
    });
  }
}
