import test = require("node:test");
import assert = require("node:assert/strict");
import type { CliName } from "../../cli/types";
import {
  buildConversationExecutionProfile,
  createConversationTabConfigurationRestorer,
  resolveConversationTabConfiguration,
  type ConversationModelRole,
  type ConversationModelRoute,
  type ConversationTabConfiguration,
} from "../../conversationTabConfiguration";
import type { ChatMessage } from "../../webview/types";

function userMessage(profile?: ChatMessage["executionProfile"]): ChatMessage {
  return { id: "prompt", role: "user", content: "继续", executionProfile: profile };
}

function createHarness(configuration: ConversationTabConfiguration | null) {
  const state = {
    activeTabId: "tab-main",
    workspaceKey: "workspace",
    activeConfigs: { codex: "other", grok: "other", opencode: "other", claude: "other" } as Record<CliName, string>,
    configurations: new Map<string, ConversationTabConfiguration | null>([["tab-main", configuration]]),
    configs: new Set(["codex:main-config", "grok:sub-config", "opencode:open-config", "claude:claude-config"]),
    models: ["main-model", "sub-model", "provider/model"],
  };
  const calls = {
    applied: [] as string[],
    selected: [] as { route: ConversationModelRoute; role: ConversationModelRole }[],
    thinking: [] as { route: ConversationModelRoute; role: ConversationModelRole }[],
    subtaskClis: [] as string[],
    errors: [] as unknown[],
  };
  const deps: Parameters<typeof createConversationTabConfigurationRestorer>[0] = {
    getActiveTabId: () => state.activeTabId,
    getWorkspaceKey: () => state.workspaceKey,
    getConfiguration: (tabId) => state.configurations.get(tabId) ?? null,
    configExists: async (cli, configId) => state.configs.has(`${cli}:${configId}`),
    waitForConfigApply: async () => true,
    getActiveConfigId: (cli) => state.activeConfigs[cli],
    applyConfig: async (cli, configId) => {
      state.activeConfigs[cli] = configId;
      calls.applied.push(`${cli}:${configId}`);
      return "applied";
    },
    getModelOptions: async () => state.models,
    selectModel: (route, role) => { calls.selected.push({ route, role }); },
    restoreThinking: (route, role) => { calls.thinking.push({ route, role }); },
    selectSubtaskCli: (configId, cli) => { calls.subtaskClis.push(`${configId}:${cli}`); },
    onError: (error) => { calls.errors.push(error); },
  };
  return { state, calls, deps, restore: createConversationTabConfigurationRestorer(deps) };
}

const loopConfiguration: ConversationTabConfiguration = {
  mainRole: "main",
  main: { cli: "codex", configId: "main-config", model: "main-model", thinkingMode: "xhigh" },
  subtask: { cli: "grok", configId: "sub-config", model: "sub-model", thinkingMode: "high" },
};

test("records raw model IDs and thinking without inventing missing configuration", () => {
  assert.equal(buildConversationExecutionProfile(null, "main-model", "high"), undefined);
  assert.equal(buildConversationExecutionProfile("  ", "main-model"), undefined);
  assert.deepEqual(buildConversationExecutionProfile(" config ", "model-id", "high", "xhigh"), {
    configId: "config", model: "model-id", thinkingMode: "high", openCodeVariant: "xhigh",
  });
  assert.deepEqual(buildConversationExecutionProfile("config", null), { configId: "config", model: null });
});

test("Loop main tabs use the current bound pair instead of an earlier execution snapshot", () => {
  const configuration = resolveConversationTabConfiguration({
    cli: "codex",
    taskRole: "main",
    task: {
      cli: "codex",
      originProfile: { configId: "main-config", mainThinkingMode: "xhigh", subtaskThinkingMode: "high" },
      modelRouting: {
        main: { model: "main-model" },
        subtask: { cli: "grok", configId: "sub-config", model: "sub-model" },
      },
    },
    messages: [userMessage({ configId: "old-config", model: "old-model", thinkingMode: "low" })],
  });
  assert.deepEqual(configuration, {
    ...loopConfiguration,
    main: { ...loopConfiguration.main, openCodeVariant: undefined },
    subtask: { ...loopConfiguration.subtask, openCodeVariant: undefined },
  });
});

test("same-CLI child routes inherit the main config but cross-CLI routes never do", () => {
  for (const cli of ["codex", "grok"] as const) {
    const configuration = resolveConversationTabConfiguration({
      cli: "codex", taskRole: "main", messages: [],
      task: {
        cli: "codex", originProfile: { configId: "main-config" },
        modelRouting: { main: { model: "main-model" }, subtask: { cli, model: "sub-model" } },
      },
    });
    assert.equal(configuration?.subtask?.configId, cli === "codex" ? "main-config" : null);
  }
});

test("child tabs restore their actual execution profile even after the Loop pair changes", () => {
  const snapshot = { configId: "open-config", model: "provider/model", thinkingMode: "off" as const, openCodeVariant: "high" };
  const configuration = resolveConversationTabConfiguration({
    cli: "opencode", taskRole: "subtask", messages: [userMessage(snapshot)],
    task: {
      cli: "codex", originProfile: { configId: "main-config" },
      modelRouting: { main: { model: "main-model" }, subtask: { cli: "grok", configId: "new-config", model: "new-model" } },
    },
  });
  assert.deepEqual(configuration, { main: { cli: "opencode", ...snapshot } });
});

test("legacy child tabs use the saved route and recorded execution model without guessing another CLI", () => {
  const task = {
    cli: "codex" as const,
    originProfile: { configId: "main-config", subtaskThinkingMode: "high" as const },
    modelRouting: { main: { model: "main-model" }, subtask: { model: "sub-model" } },
  };
  const configuration = resolveConversationTabConfiguration({
    cli: "codex", taskRole: "subtask", task,
    messages: [{ ...userMessage(), executionModel: "executed-sub-model" }],
  });
  assert.equal(configuration?.main.model, "executed-sub-model");
  assert.equal(configuration?.main.configId, "main-config");
  assert.equal(configuration?.main.thinkingMode, "high");
  assert.equal(resolveConversationTabConfiguration({ cli: "opencode", taskRole: "subtask", task, messages: [] }), null);
});

test("ordinary tabs only use the latest user execution profile and preserve legacy unknown state", () => {
  const snapshot = { configId: "main-config", model: null, thinkingMode: "low" as const };
  assert.deepEqual(resolveConversationTabConfiguration({ cli: "codex", messages: [userMessage(snapshot)] }), {
    main: { cli: "codex", ...snapshot },
  });
  assert.equal(resolveConversationTabConfiguration({ cli: "codex", messages: [userMessage(snapshot), userMessage()] }), null);
  assert.equal(resolveConversationTabConfiguration({ cli: "codex", messages: [] }), null);
});

test("restores both Loop config routes, models and thinking without changing a target CLI main role", async () => {
  const harness = createHarness(loopConfiguration);
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.applied, ["codex:main-config", "grok:sub-config"]);
  assert.deepEqual(harness.calls.selected, [
    { route: loopConfiguration.main, role: "main" },
    { route: loopConfiguration.subtask, role: "subtask" },
  ]);
  assert.deepEqual(harness.calls.thinking, harness.calls.selected);
  assert.deepEqual(harness.calls.subtaskClis, ["main-config:grok"]);
  assert.equal(harness.calls.errors.length, 0);
});

test("Vibe restores a child execution model and its thinking as the single model selection", async () => {
  const route: ConversationModelRoute = { cli: "opencode", configId: "open-config", model: "provider/model", openCodeVariant: "high" };
  const harness = createHarness({ main: route });
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.selected, [{ route, role: "vibe" }]);
  assert.deepEqual(harness.calls.thinking, [{ route, role: "vibe" }]);
  assert.deepEqual(harness.calls.subtaskClis, []);
});

test("keeps current config and model when the saved config no longer exists", async () => {
  const harness = createHarness(loopConfiguration);
  harness.state.configs.delete("codex:main-config");
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.applied, []);
  assert.deepEqual(harness.calls.selected, []);
  assert.deepEqual(harness.calls.thinking, []);
  assert.equal(harness.state.activeConfigs.codex, "other");
});

test("restores an existing config but never recreates a deleted model or overwrites its thinking", async () => {
  const harness = createHarness(loopConfiguration);
  harness.state.models = ["sub-model"];
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.selected.map(({ role }) => role), ["subtask"]);
  assert.deepEqual(harness.calls.thinking.map(({ role }) => role), ["subtask"]);
  assert.equal(harness.state.activeConfigs.codex, "main-config");
});

test("a missing child config preserves the child CLI selection while restoring the main model", async () => {
  const harness = createHarness(loopConfiguration);
  harness.state.configs.delete("grok:sub-config");
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.selected.map(({ role }) => role), ["main"]);
  assert.deepEqual(harness.calls.subtaskClis, []);
  assert.equal(harness.state.activeConfigs.grok, "other");
});

test("default model snapshots can clear a selection, while unknown models remain unchanged", async () => {
  const route: ConversationModelRoute = { cli: "codex", configId: "main-config", model: null, thinkingMode: "low" };
  const harness = createHarness({ main: route });
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.selected, [{ route, role: "vibe" }]);
  harness.state.configurations.set("tab-main", { main: { cli: "codex", configId: "main-config" } });
  await harness.restore("tab-main");
  assert.equal(harness.calls.selected.length, 1);
  assert.equal(harness.calls.thinking.length, 1);
});

test("Claude routes restore their thinking even though Claude has no model picker", async () => {
  const route: ConversationModelRoute = { cli: "claude", configId: "claude-config", model: null, thinkingMode: "high" };
  const harness = createHarness({ mainRole: "main", main: route });
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.selected, []);
  assert.deepEqual(harness.calls.thinking, [{ route, role: "main" }]);
});

test("does not reapply an already active config", async () => {
  const harness = createHarness({ main: loopConfiguration.main });
  harness.state.activeConfigs.codex = "main-config";
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.applied, []);
  assert.equal(harness.calls.selected.length, 1);
});

test("superseded config writes do not restore stale models", async () => {
  const harness = createHarness(loopConfiguration);
  harness.deps.applyConfig = async () => "superseded";
  await harness.restore("tab-main");
  assert.deepEqual(harness.calls.selected, []);
});

test("read and apply failures are logged without breaking tab navigation", async () => {
  for (const failure of ["read", "apply"]) {
    const harness = createHarness(loopConfiguration);
    const error = new Error(failure);
    if (failure === "read") harness.deps.configExists = async () => { throw error; };
    else harness.deps.applyConfig = async () => { throw error; };
    await harness.restore("tab-main");
    assert.deepEqual(harness.calls.errors, [error]);
    assert.deepEqual(harness.calls.selected, []);
  }
});

test("rapid tab changes discard an earlier async restoration", async () => {
  const harness = createHarness(loopConfiguration);
  let finishFirstRead!: (exists: boolean) => void;
  harness.deps.configExists = () => new Promise((resolve) => { finishFirstRead = resolve; });
  const firstRestore = harness.restore("tab-main");
  harness.state.activeTabId = "empty-tab";
  await harness.restore("empty-tab");
  finishFirstRead(true);
  await firstRestore;
  assert.deepEqual(harness.calls.applied, []);
  assert.deepEqual(harness.calls.selected, []);
});

test("leaving and returning to a tab cancels the older request even if the tab ID matches again", async () => {
  const harness = createHarness({ main: loopConfiguration.main });
  let finishFirstRead!: (exists: boolean) => void;
  const configExists = harness.deps.configExists;
  harness.deps.configExists = () => new Promise((resolve) => { finishFirstRead = resolve; });
  const firstRestore = harness.restore("tab-main");
  harness.state.activeTabId = "empty-tab";
  await harness.restore("empty-tab");
  harness.state.activeTabId = "tab-main";
  harness.deps.configExists = configExists;
  await harness.restore("tab-main");
  finishFirstRead(true);
  await firstRestore;
  assert.equal(harness.calls.selected.length, 1);
});

test("workspace changes and delayed model catalogs cannot overwrite the new active context", async () => {
  const harness = createHarness(loopConfiguration);
  let finishModels!: (models: string[]) => void;
  const modelReadStarted = new Promise<void>((resolve) => {
    harness.deps.getModelOptions = () => {
      resolve();
      return new Promise((finish) => { finishModels = finish; });
    };
  });
  const restoration = harness.restore("tab-main");
  await modelReadStarted;
  harness.state.workspaceKey = "other-workspace";
  finishModels(["main-model"]);
  await restoration;
  assert.deepEqual(harness.calls.selected, []);
  assert.deepEqual(harness.calls.thinking, []);
});
