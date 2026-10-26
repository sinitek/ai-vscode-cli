import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import type { CliName } from "../../cli/types";
import type { DshStreamHandlers } from "../../interactive/dshRunner";
import type { InteractiveRunnerManager } from "../../interactive/manager";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import type { InteractiveTabRun } from "../../extensionHost/promptExecutionShared";

const { createPromptInteractiveRuntimeHost } = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");
const { prepareDshIsolatedLaunch } = require("../../extensionHost/dshInteractiveLaunch") as typeof import("../../extensionHost/dshInteractiveLaunch");
const { buildDshLaunchArgs, redactDshDiagnostic } = require("../../interactive/dshAppServerProtocol") as typeof import("../../interactive/dshAppServerProtocol");
const {
  activateDshProfile,
  readDshActiveProfileText,
  resolveDshConfigPaths,
} = require("../../config/dshConfig") as typeof import("../../config/dshConfig");
const {
  createDshExampleProfileText,
  parseDshConfigModels,
  readDshModelWireForRun,
  toDshModelWireValue,
  DSH_VERIFIED_MODEL_ID,
} = require("../../cli/dshConfigModels") as typeof import("../../cli/dshConfigModels");
const { InteractiveRunnerManager: RunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");

const WIRE = toDshModelWireValue(DSH_VERIFIED_MODEL_ID);
const ACP_ID = "9a871318-21c4-4603-8e65-693ba8589abe";

type RuntimeDeps = Parameters<typeof createPromptInteractiveRuntimeHost>[0];

type FakeRunner = {
  start: (options?: { requireResume?: boolean }) => Promise<{ acpSessionId: string; resumed: boolean; retainedLocalSessionId: string | null }>;
  prompt: (text: string, handlers?: DshStreamHandlers) => Promise<{ stopReason: string }>;
  cancelTurn: () => void;
  dispose: () => void;
  isReusable: () => boolean;
  setModel: (model: string) => Promise<unknown>;
  setThinkingMode: (mode: string) => Promise<unknown>;
  getConfigSnapshot: () => {
    model: string | null;
    reasoningEffort: string | null;
    modelOptions: string[];
    reasoningOptions: string[];
  };
};

function createHostHarness(options: {
  behavior?: (prompt: string, handlers: DshStreamHandlers) => Promise<void>;
  start?: FakeRunner["start"];
  mappedId?: string | null;
  thinkingMode?: "ultra" | "high" | "xhigh" | "medium" | "off";
  reasoningOptions?: string[];
  currentModel?: string | null;
  selectedModel?: string | null;
  configuredModelIds?: string[];
  requireExplicitFinalAnswer?: boolean;
}) {
  const configuredModelIds = options.configuredModelIds ?? [DSH_VERIFIED_MODEL_ID];
  const configuredProfile = JSON.parse(createDshExampleProfileText()) as {
    models: Array<{ id: string; name: string; input: ["text"]; maxTokens: 256 }>;
    acpModel: string;
  };
  configuredProfile.models = configuredModelIds.map((id) => ({
    id,
    name: id,
    input: ["text"],
    maxTokens: 256,
  }));
  configuredProfile.acpModel = configuredModelIds[0] ?? "";
  const configuredModels = parseDshConfigModels(JSON.stringify(configuredProfile));
  const configuredWires = configuredModelIds.map(toDshModelWireValue);
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const runStatus: string[] = [];
  const resolvedSelections: Array<string | null> = [];
  const adopted: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const starts: Array<{ requireResume?: boolean }> = [];
  const models: string[] = [];
  const thinking: string[] = [];
  const cancels: number[] = [];
  let disposed = 0;
  let idCounter = 0;
  const snapshot = {
    model: options.currentModel === undefined ? WIRE : options.currentModel,
    reasoningEffort: null as string | null,
    modelOptions: configuredWires,
    reasoningOptions: options.reasoningOptions ?? [],
  };
  const runner: FakeRunner = {
    start: options.start ?? (async (startOptions) => {
      starts.push(startOptions ?? {});
      return { acpSessionId: ACP_ID, resumed: startOptions?.requireResume === true, retainedLocalSessionId: null };
    }),
    prompt: async (prompt, handlers) => {
      await options.behavior?.(prompt, handlers ?? {});
      return { stopReason: "end_turn" };
    },
    cancelTurn: () => {
      cancels.push(1);
    },
    dispose: () => {
      disposed += 1;
    },
    isReusable: () => true,
    setModel: async (model) => {
      models.push(model);
      if (!snapshot.modelOptions.includes(model)) {
        throw new Error(`model ${JSON.stringify(model)} was not confirmed`);
      }
      snapshot.model = model;
      return snapshot;
    },
    setThinkingMode: async (mode) => {
      thinking.push(mode);
      if (!snapshot.reasoningOptions.includes(mode)) {
        throw new Error(`reasoning ${mode} was not confirmed`);
      }
      snapshot.reasoningEffort = mode;
      return snapshot;
    },
    getConfigSnapshot: () => snapshot,
  };
  const manager = {
    getOrCreateDshRunner: (input: Record<string, unknown>) => {
      created.push(input);
      return runner;
    },
    hasDshRunner: () => created.length > 0,
    setRunner: () => undefined,
    detachRunner: () => undefined,
  } as unknown as InteractiveRunnerManager;
  const deps: RuntimeDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
    activeRunsByTabId,
    adoptSessionId: (_cli, sessionId) => {
      adopted.push(sessionId);
    },
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
    getConversationTabById: () => ({ sessionId: "local_1", cli: "dsh" }),
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => options.thinkingMode ?? "off",
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
    getSelectedCliModel: () => options.selectedModel ?? DSH_VERIFIED_MODEL_ID,
    resolveDshModelWireForRun: async (selected) => {
      resolvedSelections.push(selected);
      return readDshModelWireForRun(configuredModels, selected);
    },
    prepareDshInteractiveLaunch: async () => ({
      agentArgs: ["--patch", "/tmp/isolated/acp-patch.yaml"],
      env: { DSH_HOME: "/tmp/isolated", SINITEK_DSH_API_KEY: "secret-key" },
    }),
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
    resolveInteractiveMappedId: () => options.mappedId ?? null,
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
    shouldRequireExplicitFinalAnswerForRun: () => options.requireExplicitFinalAnswer === true,
    t: (key) => key,
    updateProcessTitle: () => undefined,
    upsertInteractiveMapping: () => undefined,
  };
  return {
    host: createPromptInteractiveRuntimeHost(deps),
    panelMessages,
    runStatus,
    adopted,
    created,
    starts,
    models,
    thinking,
    cancels,
    disposed,
    messagesBySession,
    activeRunsByTabId,
    runner,
    resolvedSelections,
  };
}

function inputFor(prompt: string): PromptRunInput {
  return { displayPrompt: prompt, modelPrompt: prompt, contextTags: [] };
}

function targetFor(sessionId: string | null): PromptRunTarget {
  return { tabId: "tab-dsh", cli: "dsh", sessionId };
}

test("DSH host maps assistant, thinking, tool, raw events, activity, and stop reason", async () => {
  const harness = createHostHarness({
    requireExplicitFinalAnswer: true,
    behavior: async (_prompt, handlers) => {
      handlers.onActivity?.();
      handlers.onAssistantDelta?.("Hello ");
      handlers.onAssistantDelta?.("world");
      handlers.onTrace?.("consider", "thinking");
      handlers.onTrace?.("bash in_progress", "tool-use", { toolCallId: "tool-1" });
      handlers.onEvent?.({ jsonrpc: "2.0", method: "session/update" });
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("Say hello"), targetFor("local_1792000000000_abc"));
  assert.equal(harness.starts[0]?.requireResume, false);
  assert.equal(harness.created[0]?.localSessionId, null);
  assert.equal(harness.created[0]?.model, WIRE);
  assert.deepEqual(harness.created[0]?.agentArgs, ["--patch", "/tmp/isolated/acp-patch.yaml"]);
  assert.equal(String(JSON.stringify(harness.created[0]?.agentArgs)).includes("secret-key"), false);
  assert.deepEqual(harness.adopted, [ACP_ID]);
  assert.deepEqual(harness.runStatus, ["start", "end"]);
  const stored = harness.messagesBySession.get(ACP_ID) ?? [];
  const assistant = stored.filter((message) => message.role === "assistant" && message.kind !== "thinking");
  const thinking = stored.filter((message) => message.kind === "thinking");
  const tools = stored.filter((message) => message.role === "trace");
  assert.equal(assistant.map((message) => message.content).join(""), "Hello world");
  assert.equal(thinking.map((message) => message.content).join(""), "consider");
  assert.equal(tools.length, 1);
  assert.match(String(tools[0]?.content), /bash in_progress/);
  assert.equal(harness.panelMessages.some((message) => message.type === "rawStreamDelta"), true);
  assert.equal(harness.panelMessages.some((message) => message.type === "runActivity"), true);
  assert.equal(stored.some((message) => String(message.content).includes("end_turn")), false);
});

test("DSH resume uses the ACP id and does not pass a local_ id to session resume", async () => {
  const harness = createHostHarness({
    mappedId: ACP_ID,
    behavior: async (_prompt, handlers) => {
      handlers.onAssistantDelta?.("resumed");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("continue"), targetFor("local_1792000000000_abc"));
  assert.equal(harness.starts[0]?.requireResume, true);
  assert.equal(harness.created[0]?.localSessionId, ACP_ID);
  assert.equal(String(harness.created[0]?.localSessionId).startsWith("local_"), false);
});

test("DSH drops late events and usage without real counts, and labels fallback windows", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      const entry = harness.activeRunsByTabId.get("tab-dsh");
      assert.ok(entry);
      const runId = entry.runId;
      handlers.onAssistantDelta?.("kept");
      entry.runId = "other-run";
      handlers.onAssistantDelta?.("late");
      handlers.onTrace?.("late-thought", "thinking");
      handlers.onTokenUsageUpdate?.({ tokensInContextWindow: Number.NaN, modelContextWindow: 0 });
      entry.runId = runId;
      handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 5967, modelContextWindow: 262144 });
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("count"), targetFor("local_1"));
  const stored = harness.messagesBySession.get(ACP_ID) ?? [];
  const assistant = stored.filter((message) => message.role === "assistant" && message.kind !== "thinking");
  assert.equal(assistant.map((message) => message.content).join(""), "kept");
  assert.equal(stored.some((message) => String(message.content).includes("late")), false);
  const usage = harness.panelMessages.filter((message) => message.type === "contextTokenUsage");
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.tokensInContextWindow, 5967);
  assert.equal(usage[0]?.modelContextWindow, 262144);
  assert.equal(usage[0]?.contextWindowSource, "adapter-fallback");
  assert.equal(JSON.stringify(usage).includes("服务确认"), false);
  assert.equal(usage.some((message) => message.tokensInContextWindow === 0), false);
});

test("DSH cancel stops the turn and ignores events after the run is stopped", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      const entry = harness.activeRunsByTabId.get("tab-dsh");
      assert.ok(entry);
      entry.stop();
      handlers.onAssistantDelta?.("after-cancel");
      handlers.onComplete?.({ stopReason: "cancelled" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("stop"), targetFor("local_1"));
  assert.equal(harness.cancels.length, 1);
  assert.equal(harness.runStatus.includes("stopped"), true);
  const stored = [...harness.messagesBySession.values()].flat();
  assert.equal(stored.some((message) => String(message.content).includes("after-cancel")), false);
});

test("DSH model switch uses the configured wire and does not map ultra to max", async () => {
  const harness = createHostHarness({
    thinkingMode: "ultra",
    reasoningOptions: ["max"],
    currentModel: null,
    behavior: async (_prompt, handlers) => {
      handlers.onAssistantDelta?.("ok");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("switch"), targetFor("local_1"));
  assert.deepEqual(harness.models, [WIRE]);
  assert.deepEqual(harness.thinking, []);
  assert.equal(harness.panelMessages.some((message) => message.type === "dshReasoningOptions" && Array.isArray(message.options) && message.options.length === 1), true);
  const stored = harness.messagesBySession.get(ACP_ID) ?? [];
  assert.equal(stored.some((message) => String(message.content).includes("dsh.reasoningUnavailable")), true);
  assert.equal(stored.some((message) => String(message.content).includes("max")), false);
});

test("DSH applies the selected reasoning effort before sending the prompt", async () => {
  const harness = createHostHarness({
    thinkingMode: "xhigh",
    reasoningOptions: ["low", "high", "xhigh", "max"],
    behavior: async (_prompt, handlers) => {
      assert.deepEqual(harness.thinking, ["xhigh"]);
      handlers.onAssistantDelta?.("ok");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });

  await harness.host.runPromptInteractive(inputFor("think harder"), targetFor("local_1"));

  assert.deepEqual(harness.thinking, ["xhigh"]);
  assert.equal(harness.panelMessages.some((message) =>
    message.type === "dshReasoningOptions"
    && message.currentValue === "xhigh"
  ), true);
});

test("DSH applies medium when ACP advertises it", async () => {
  const harness = createHostHarness({
    thinkingMode: "medium",
    reasoningOptions: ["low", "medium", "high", "xhigh", "max"],
    behavior: async (_prompt, handlers) => {
      assert.deepEqual(harness.thinking, ["medium"]);
      handlers.onAssistantDelta?.("ok");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });

  await harness.host.runPromptInteractive(inputFor("use medium"), targetFor("local_1"));

  assert.deepEqual(harness.thinking, ["medium"]);
  assert.equal(harness.panelMessages.some((message) =>
    message.type === "dshReasoningOptions"
    && message.currentValue === "medium"
  ), true);
});

test("DSH selected chat model reaches the ACP model wire", async () => {
  const secondModel = "vendor/second-model";
  const secondWire = toDshModelWireValue(secondModel);
  const harness = createHostHarness({
    selectedModel: secondModel,
    configuredModelIds: [DSH_VERIFIED_MODEL_ID, secondModel],
    currentModel: WIRE,
    behavior: async (_prompt, handlers) => {
      handlers.onAssistantDelta?.("ok");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });

  await harness.host.runPromptInteractive(inputFor("use second model"), targetFor("local_1"));

  assert.deepEqual(harness.resolvedSelections, [secondModel]);
  assert.deepEqual(harness.models, [secondWire]);
});

test("DSH keeps reasoning disabled when the model advertises no options", async () => {
  const harness = createHostHarness({
    thinkingMode: "ultra",
    reasoningOptions: [],
    behavior: async (_prompt, handlers) => {
      handlers.onAssistantDelta?.("ok");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("think"), targetFor("local_1"));
  assert.deepEqual(harness.thinking, []);
  const stored = harness.messagesBySession.get(ACP_ID) ?? [];
  assert.equal(stored.some((message) => String(message.content).includes("dsh.reasoningUnavailable")), false);
  const options = harness.panelMessages.find((message) => message.type === "dshReasoningOptions");
  assert.deepEqual(options?.options, []);
});

test("DSH startup failure does not create assistant text", async () => {
  const harness = createHostHarness({
    start: async () => {
      const error = new Error("spawn dsh ENOENT");
      (error as { code?: string }).code = "ENOENT";
      throw error;
    },
  });
  await assert.rejects(
    () => harness.host.runPromptInteractive(inputFor("fail"), targetFor(ACP_ID)),
    /ENOENT/,
  );
  const stored = [...harness.messagesBySession.values()].flat();
  assert.equal(stored.some((message) => message.role === "assistant"), false);
  assert.equal(harness.runStatus.includes("error"), true);
});

test("missing DSH wire resolution does not create a runner", async () => {
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  let created = 0;
  const deps = {
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
    buildTaskRunCompletionText: () => "",
    createMessageId: () => "id",
    getActiveConfigIdForCli: () => null,
    getConversationTabById: () => null,
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => "off" as const,
    getGlobalHumanInteractionEnabled: () => false,
    getPendingSessionDraft: () => ({ messages: [] }),
    getSelectedCliModel: () => null,
    getWorkspaceInteractiveMode: () => "coding" as const,
    getInteractiveRunnerManager: () => ({
      getOrCreateDshRunner: () => {
        created += 1;
        throw new Error("must not create");
      },
    }) as unknown as InteractiveRunnerManager,
    loadSessionMessages: () => [],
    logCliStartup: () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: () => undefined,
    migrateLocalSessionToTargetSession: () => undefined,
    persistMessagesForTab: () => undefined,
    preparePendingLabel: () => undefined,
    resolveClaudeInteractiveEntrypoint: () => undefined,
    resolveCodexInteractiveSelection: () => null,
    resolveInteractiveMappedId: () => null,
    resolveInteractiveSessionForResume: async (_cli: CliName, sessionId: string | null) => sessionId,
    resolveWorkspaceCwd: () => "/workspace",
    requestHumanInteraction: async () => ({
      interactionId: "interaction",
      tabId: "tab-dsh",
      status: "completed" as const,
      values: {},
    }),
    cancelHumanInteractionForTab: () => undefined,
    sendPanelMessage: () => undefined,
    sendRunStatusForTab: () => undefined,
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => false,
    t: (key: string) => key,
    updateProcessTitle: () => undefined,
    upsertInteractiveMapping: () => undefined,
  };
  const bare = createPromptInteractiveRuntimeHost(deps as RuntimeDeps);
  await assert.rejects(() => bare.runPromptInteractive(inputFor("no wire"), targetFor("local_1")), /wire resolver/);
  assert.equal(created, 0);
});

test("DSH isolated launch copies the patch and keeps the key out of args", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-source-"));
  const previousHome = process.env.DSH_HOME;
  const previousKey = process.env.SINITEK_DSH_API_KEY;
  const previousPermissionMode = process.env.DSH_PERMISSION_MODE;
  process.env.DSH_HOME = home;
  process.env.SINITEK_DSH_API_KEY = "secret-key-value";
  process.env.DSH_PERMISSION_MODE = "workspace-write";
  try {
    const activated = await activateDshProfile({
      profileId: "acme",
      content: createDshExampleProfileText(),
    });
    assert.equal(activated.ok, true);
    const launch = await prepareDshIsolatedLaunch({ sessionKey: "local_1" });
    assert.deepEqual(buildDshLaunchArgs(launch.agentArgs), ["--profile", "acp", "--patch", launch.patchPath]);
    assert.equal(launch.env.DSH_HOME, launch.isolatedHome);
    assert.equal(launch.env.DSH_PERMISSION_MODE, "danger-full-access");
    assert.equal(process.env.DSH_PERMISSION_MODE, "workspace-write");
    assert.notEqual(launch.isolatedHome, home);
    assert.equal(launch.env.SINITEK_DSH_API_KEY, "secret-key-value");
    assert.equal(launch.agentArgs.join(" ").includes("secret-key-value"), false);
    assert.equal(launch.agentArgs.some((arg) => arg === "headless" || arg === "sdk" || arg === "tui"), false);
    const patch = await fs.readFile(launch.patchPath, "utf8");
    assert.match(patch, /deepseek-v4\.1-flash/);
    assert.equal(patch.includes("subcoco/"), false);
    assert.equal(patch.includes("secret-key-value"), false);
    const names = await fs.readdir(home);
    assert.equal(names.includes("settings.yaml"), false);
    assert.equal(names.includes(".credentials.yaml"), false);
    assert.equal(names.includes("config.toml"), false);
    await fs.rm(launch.isolatedHome, { recursive: true, force: true });
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    if (previousKey === undefined) {
      delete process.env.SINITEK_DSH_API_KEY;
    } else {
      process.env.SINITEK_DSH_API_KEY = previousKey;
    }
    if (previousPermissionMode === undefined) {
      delete process.env.DSH_PERMISSION_MODE;
    } else {
      process.env.DSH_PERMISSION_MODE = previousPermissionMode;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("DSH isolated launch upgrades a legacy active profile before starting ACP", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-legacy-profile-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const legacyProfile = JSON.parse(createDshExampleProfileText()) as {
      models: Array<Record<string, unknown>>;
    };
    for (const model of legacyProfile.models) {
      delete model.reasoningEfforts;
      delete model.compat;
    }
    const activated = await activateDshProfile({
      profileId: "legacy",
      content: JSON.stringify(legacyProfile),
    });
    assert.equal(activated.ok, true);

    const launch = await prepareDshIsolatedLaunch({ sessionKey: "legacy-profile" });
    const patch = await fs.readFile(launch.patchPath, "utf8");
    assert.match(patch, /reasoningEfforts:\n\s+low: low\n\s+medium: medium\n\s+high: high\n\s+xhigh: xhigh\n\s+max: max/);
    assert.match(patch, /compat:\n\s+thinkingFormat: deepseek\n\s+supportsReasoningEffort: true/);
    assert.equal(/^\s+off:/m.test(patch), false);
    await fs.rm(launch.isolatedHome, { recursive: true, force: true });
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("DSH isolated launch rebuilds the patch from the current active config profile", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-stale-profile-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const activated = await activateDshProfile({
      profileId: "current",
      content: createDshExampleProfileText(),
    });
    assert.equal(activated.ok, true);

    const current = JSON.parse(createDshExampleProfileText()) as {
      models: Array<{ id: string; name: string }>;
      acpModel: string;
    };
    current.models[0].id = "gateway/current-model";
    current.models[0].name = "gateway/current-model";
    current.acpModel = "gateway/current-model";
    const paths = resolveDshConfigPaths();
    const content = JSON.stringify(current);
    await fs.writeFile(path.join(paths.configDir, "current.json"), JSON.stringify({
      id: "current",
      name: "Current",
      platform: "dsh",
      content,
      configContent: content,
      createdAt: 1,
      updatedAt: 2,
    }, null, 2), "utf8");

    const launch = await prepareDshIsolatedLaunch({ sessionKey: "stale-profile" });
    const patch = await fs.readFile(launch.patchPath, "utf8");
    assert.match(patch, /gateway\/current-model/);
    assert.equal(patch.includes("subcoco/deepseek-v4.1-flash"), false);

    const stored = JSON.parse(await fs.readFile(path.join(paths.configDir, "current.json"), "utf8")) as {
      content: string;
      configContent: string;
    };
    assert.match(stored.content, /gateway\/current-model/);
    assert.match(stored.configContent, /gateway\/current-model/);
    const applied = await readDshActiveProfileText(paths);
    assert.match(applied, /gateway\/current-model/);
    await fs.rm(launch.isolatedHome, { recursive: true, force: true });
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("copied DSH example prepares a launch after changing only apiKey and baseURL", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-direct-key-"));
  const previousHome = process.env.DSH_HOME;
  const previousKey = process.env.SINITEK_DSH_API_KEY;
  const apiKey = "sk-direct-profile-key-12345";
  const baseURL = "http://127.0.0.1:8787/v1";
  process.env.DSH_HOME = home;
  process.env.SINITEK_DSH_API_KEY = "env-fallback-key";
  try {
    const example = JSON.parse(createDshExampleProfileText()) as Record<string, unknown>;
    const profile = JSON.parse(JSON.stringify(example)) as Record<string, unknown>;
    profile.apiKey = apiKey;
    profile.baseURL = baseURL;
    assert.deepEqual({ ...profile, apiKey: example.apiKey, baseURL: example.baseURL }, example);
    const activated = await activateDshProfile({
      profileId: "direct-key",
      content: JSON.stringify(profile),
    });
    assert.equal(activated.ok, true);
    const launch = await prepareDshIsolatedLaunch({ sessionKey: "local_direct_key" });
    assert.equal(launch.env.SINITEK_DSH_API_KEY, apiKey);
    assert.equal(launch.agentArgs.join("\n").includes(apiKey), false);
    assert.equal(redactDshDiagnostic(`token ${apiKey}`, launch.env), "token [redacted]");
    const patch = await fs.readFile(launch.patchPath, "utf8");
    assert.equal(patch.includes(apiKey), false);
    const appliedProfileText = await readDshActiveProfileText(resolveDshConfigPaths());
    const appliedProfile = JSON.parse(appliedProfileText) as { baseURL: string };
    assert.equal(appliedProfile.baseURL, baseURL);
    assert.equal(readDshModelWireForRun(parseDshConfigModels(appliedProfileText), DSH_VERIFIED_MODEL_ID), WIRE);
    await fs.rm(launch.isolatedHome, { recursive: true, force: true });
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousKey === undefined) delete process.env.SINITEK_DSH_API_KEY;
    else process.env.SINITEK_DSH_API_KEY = previousKey;
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("DSH isolated launch mirrors global skills and AGENTS.md without prompt injection or secrets", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-mirror-"));
  const outside = path.join(home, "outside-secret");
  const previousHome = process.env.DSH_HOME;
  const previousKey = process.env.SINITEK_DSH_API_KEY;
  const secret = "sk-fixturekey123456";
  process.env.DSH_HOME = home;
  process.env.SINITEK_DSH_API_KEY = secret;
  try {
    await fs.writeFile(path.join(home, "AGENTS.md"), "global dsh rules\n", "utf8");
    await fs.mkdir(path.join(home, "workspace"), { recursive: true });
    await fs.writeFile(path.join(home, "workspace", "AGENTS.md"), "workspace rules stay put\n", "utf8");
    await fs.writeFile(outside, secret, "utf8");
    await fs.mkdir(path.join(home, "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(home, "skills", "demo", "SKILL.md"), "---\ndescription: demo\n---\n# demo\n", "utf8");
    await fs.writeFile(path.join(home, "skills", "demo", "marker.txt"), "first\n", "utf8");
    await fs.writeFile(path.join(home, "skills", ".credentials.yaml"), "apiKey: should-not-copy\n", "utf8");
    await fs.symlink(outside, path.join(home, "skills", "escape"));
    const activated = await activateDshProfile({
      profileId: "acme",
      content: createDshExampleProfileText(),
    });
    assert.equal(activated.ok, true);
    const launch = await prepareDshIsolatedLaunch({ sessionKey: "mirror-skills" });
    assert.equal(launch.env.DSH_HOME, launch.isolatedHome);
    assert.equal(await fs.readFile(path.join(launch.isolatedHome, "AGENTS.md"), "utf8"), "global dsh rules\n");
    assert.equal(await fs.readFile(path.join(launch.isolatedHome, "skills", "demo", "marker.txt"), "utf8"), "first\n");
    assert.equal(await fs.access(path.join(launch.isolatedHome, "skills", "escape")).then(() => true, () => false), false);
    assert.equal(await fs.access(path.join(launch.isolatedHome, "skills", ".credentials.yaml")).then(() => true, () => false), false);
    assert.equal(await fs.access(path.join(launch.isolatedHome, "workspace")).then(() => true, () => false), false);
    assert.equal(await fs.readFile(outside, "utf8"), secret);
    assert.equal(launch.agentArgs.join("\n").includes(secret), false);
    assert.equal(launch.agentArgs.join("\n").includes("global dsh rules"), false);
    await fs.writeFile(path.join(home, "skills", "demo", "marker.txt"), "second\n", "utf8");
    await fs.writeFile(path.join(home, "AGENTS.md"), "updated global rules\n", "utf8");
    const again = await prepareDshIsolatedLaunch({ sessionKey: "mirror-skills" });
    assert.equal(await fs.readFile(path.join(again.isolatedHome, "skills", "demo", "marker.txt"), "utf8"), "second\n");
    assert.equal(await fs.readFile(path.join(again.isolatedHome, "AGENTS.md"), "utf8"), "updated global rules\n");
    assert.equal(await fs.access(path.join(again.isolatedHome, "skills.sinitek-replacing")).then(() => true, () => false), false);
    assert.equal(await fs.access(path.join(again.isolatedHome, "AGENTS.md.sinitek-replacing")).then(() => true, () => false), false);
    await fs.rm(launch.isolatedHome, { recursive: true, force: true });
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    if (previousKey === undefined) {
      delete process.env.SINITEK_DSH_API_KEY;
    } else {
      process.env.SINITEK_DSH_API_KEY = previousKey;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("DSH host wiring does not import Grok runner types or forbidden ACP methods", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/extensionHost/interactiveTurnDsh.ts"), "utf8");
  assert.equal(source.includes("grokRunner"), false);
  assert.equal(source.includes("yoloMode"), false);
  assert.equal(source.includes("session/load"), false);
  assert.equal(source.includes("initialized"), false);
  assert.equal(source.includes("/compact"), false);
  assert.equal(source.includes("headless"), false);
  const manager = new RunnerManager();
  manager.disposeAll();
});
