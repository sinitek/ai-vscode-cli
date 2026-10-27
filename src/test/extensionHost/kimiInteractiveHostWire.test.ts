import test = require("node:test");
import assert = require("node:assert/strict");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import type { CliName } from "../../cli/types";
import type { KimiStreamHandlers } from "../../interactive/kimiRunner";
import type { InteractiveRunnerManager } from "../../interactive/manager";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import type { InteractiveTabRun } from "../../extensionHost/promptExecutionShared";

const { createPromptInteractiveRuntimeHost } = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");
const { KIMI_CODE_DEFAULT_MODEL } = require("../../config/kimiCodeConfig") as typeof import("../../config/kimiCodeConfig");

type RuntimeDeps = Parameters<typeof createPromptInteractiveRuntimeHost>[0];

const ACP_ID = "0f3c5d0c-6c58-4c6f-8f4e-3c5c9a1d2e77";

type FakeRunnerOptions = {
  behavior?: (prompt: string, handlers: KimiStreamHandlers) => Promise<void>;
  thinkingOptions?: string[];
  thinking?: string | null;
  modeId?: string | null;
  effectiveThinkingMode?: import("../../cli/types").ThinkingMode;
};

function createKimiRunner(options: FakeRunnerOptions) {
  const starts: Array<{ requireResume?: boolean }> = [];
  const appliedModels: string[] = [];
  const snapshot = {
    model: KIMI_CODE_DEFAULT_MODEL,
    thinking: options.thinking === undefined ? "high" : options.thinking,
    modeId: options.modeId ?? "yolo",
    modelOptions: [KIMI_CODE_DEFAULT_MODEL],
    thinkingOptions: options.thinkingOptions ?? ["off", "low", "medium", "high", "xhigh", "max"],
    modeOptions: ["default", "plan", "auto", "yolo"],
  };
  let disposed = 0;
  const runner = {
    start: async (startOptions?: { requireResume?: boolean }) => {
      starts.push(startOptions ?? {});
      return {
        acpSessionId: ACP_ID,
        resumed: startOptions?.requireResume === true,
        retainedLocalSessionId: null,
      };
    },
    prompt: async (prompt: string, handlers?: KimiStreamHandlers) => {
      await options.behavior?.(prompt, handlers ?? {});
      return { stopReason: "end_turn" };
    },
    cancelTurn: () => undefined,
    dispose: () => {
      disposed += 1;
    },
    isReusable: () => true,
    getConfigSnapshot: () => snapshot,
    setThinkingMode: async () => snapshot,
    setModel: async (model: string) => {
      appliedModels.push(model);
      snapshot.model = model;
      return snapshot;
    },
  };
  return { runner, starts, snapshot, appliedModels, disposed: () => disposed };
}

function createHostHarness(options: FakeRunnerOptions = {}) {
  const fake = createKimiRunner(options);
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const runStatus: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  let runnerCreated = false;
  const registered: Array<Record<string, unknown>> = [];
  const launched: Array<Record<string, unknown>> = [];
  let idCounter = 0;
  const manager = {
    getOrCreateKimiCodeRunner: (input: Record<string, unknown>) => {
      created.push(input);
      runnerCreated = true;
      return fake.runner;
    },
    hasKimiCodeRunner: () => runnerCreated,
    setRunner: (_cli: string, _sessionId: string, _runner: unknown, _thinking: string, _mode: string, _model: string, runnerOptions: Record<string, unknown>) => {
      registered.push(runnerOptions);
    },
    detachRunner: () => undefined,
  } as unknown as InteractiveRunnerManager;
  const deps: RuntimeDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
    activeRunsByTabId,
    adoptSessionId: () => undefined,
    applyProcessTitle: () => undefined,
    applyThinkingWorkspaceFiles: () => undefined,
    appendTaskRun: () => undefined,
    buildSubagentProgressLabels: () => ({
      provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" },
      subagent: "subagent",
      status: { running: "running", completed: "completed", failed: "failed", interrupted: "interrupted" },
      errorPrefix: "error: ",
    }),
    buildTaskRunCompletionText: (status) => `completion:${status}`,
    createMessageId: () => `msg-${++idCounter}`,
    getActiveConfigIdForCli: () => null,
    getConversationTabById: () => ({ sessionId: "local_1", cli: "kimi-code" }),
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => options.effectiveThinkingMode ?? "high",
    getGlobalHumanInteractionEnabled: () => false,
    getPendingSessionDraft: (tabId) => {
      const existing = pendingMessagesByTab.get(tabId);
      if (existing) {
        return { messages: existing };
      }
      const next: ChatMessage[] = [];
      pendingMessagesByTab.set(tabId, next);
      return { messages: next };
    },
    getSelectedCliModel: () => KIMI_CODE_DEFAULT_MODEL,
    resolveKimiModelWireForRun: async () => KIMI_CODE_DEFAULT_MODEL,
    prepareKimiInteractiveLaunch: async (input) => {
      launched.push(input);
      return {
        agentArgs: [],
        env: { KIMI_CODE_HOME: "/tmp/isolated-kimi" },
        modeId: "yolo",
        modelAlias: KIMI_CODE_DEFAULT_MODEL,
        thinkingValue: input.thinkingMode === "off" ? "high" : input.thinkingMode,
      };
    },
    getWorkspaceInteractiveMode: () => "coding",
    getInteractiveRunnerManager: () => manager,
    loadSessionMessages: (_cli: CliName, sessionId: string) => {
      const existing = messagesBySession.get(sessionId);
      if (existing) {
        return existing;
      }
      const next: ChatMessage[] = [];
      messagesBySession.set(sessionId, next);
      return next;
    },
    logCliStartup: () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: () => undefined,
    migrateLocalSessionToTargetSession: () => undefined,
    persistMessagesForTab: () => undefined,
    preparePendingLabel: () => undefined,
    resolveClaudeInteractiveEntrypoint: () => undefined,
    resolveCodexInteractiveSelection: () => null,
    resolveInteractiveMappedId: () => null,
    resolveInteractiveSessionForResume: async (_cli, sessionId) => sessionId,
    resolveWorkspaceCwd: () => "/workspace",
    requestHumanInteraction: async (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {},
    }),
    cancelHumanInteractionForTab: () => undefined,
    sendPanelMessage: (payload) => {
      panelMessages.push(payload);
    },
    sendRunStatusForTab: (_tabId, status) => {
      runStatus.push(status);
    },
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => false,
    t: (key) => key,
    updateProcessTitle: () => undefined,
    upsertInteractiveMapping: () => undefined,
  };
  return {
    host: createPromptInteractiveRuntimeHost(deps),
    panelMessages,
    runStatus,
    created,
    registered,
    launched,
    messagesBySession,
    activeRunsByTabId,
    fake,
  };
}

function inputFor(prompt: string): PromptRunInput {
  return { displayPrompt: prompt, modelPrompt: prompt, contextTags: [] };
}

function targetFor(sessionId: string | null): PromptRunTarget {
  return { tabId: "tab-kimi", cli: "kimi-code", sessionId };
}

test("Kimi host sends the ACP thinking options and mode updates to the owning tab", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onModeUpdate?.("plan");
      handlers.onAssistantDelta?.("done");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("hello"), targetFor("local_1"));

  const thinkingMessage = harness.panelMessages.find((message) => message.type === "kimiThinkingOptions");
  assert.ok(thinkingMessage, "缺少 kimiThinkingOptions");
  assert.deepEqual(thinkingMessage, {
    type: "kimiThinkingOptions",
    tabId: "tab-kimi",
    options: ["off", "low", "medium", "high", "xhigh", "max"],
    currentValue: "high",
    modeId: "yolo",
  });
  const modeMessage = harness.panelMessages.find((message) => message.type === "kimiModeUpdate");
  assert.deepEqual(modeMessage, { type: "kimiModeUpdate", tabId: "tab-kimi", modeId: "plan" });
  assert.deepEqual(harness.runStatus, ["start", "end"]);
});

test("Kimi host applies the selected model at the start of every turn", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onAssistantDelta?.("done");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("first"), targetFor("local_1"));
  await harness.host.runPromptInteractive(inputFor("second"), targetFor("local_1"));
  assert.deepEqual(harness.fake.appliedModels, [KIMI_CODE_DEFAULT_MODEL, KIMI_CODE_DEFAULT_MODEL]);
});

test("Kimi host labels the context window as the configured capacity, not an adapter fallback", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 5120, modelContextWindow: 262144 });
      handlers.onAssistantDelta?.("done");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("count"), targetFor("local_1"));
  const usage = harness.panelMessages.filter((message) => message.type === "contextTokenUsage");
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.tokensInContextWindow, 5120);
  assert.equal(usage[0]?.modelContextWindow, 262144);
  assert.equal(usage[0]?.contextWindowSource, "kimi-config-window");
  assert.notEqual(usage[0]?.contextWindowSource, "adapter-fallback");
});

test("Kimi host drops usage without real counts and never sends zero", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onTokenUsageUpdate?.({ tokensInContextWindow: Number.NaN, modelContextWindow: 262144 });
      handlers.onTokenUsageUpdate?.({ tokensInContextWindow: -1, modelContextWindow: 262144 });
      handlers.onAssistantDelta?.("done");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("count"), targetFor("local_1"));
  assert.equal(harness.panelMessages.some((message) => message.type === "contextTokenUsage"), false);
});

test("Kimi host forwards off as the configured effort and keeps the launch credential-free", async () => {
  const harness = createHostHarness({
    effectiveThinkingMode: "off",
    behavior: async (_prompt, handlers) => {
      handlers.onAssistantDelta?.("done");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("hello"), targetFor("local_1"));
  assert.equal(harness.launched[0]?.thinkingMode, "off");
  assert.equal(harness.created[0]?.thinkingValue, "high");
  assert.deepEqual(harness.created[0]?.agentArgs, []);
  const thinkingMessage = harness.panelMessages.find((message) => message.type === "kimiThinkingOptions");
  assert.equal(
    String(JSON.stringify(thinkingMessage)).includes("sk-"),
    false,
    "宿主消息不能带密钥",
  );
});
