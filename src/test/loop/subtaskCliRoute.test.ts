import test = require("node:test");
import assert = require("node:assert/strict");

import type { CliName } from "../../cli/types";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  INVALID_SUBTASK_CLI_ROUTE,
  planBoundSubtaskConfigApply,
  resolveSubtaskRouteConfigId,
  resolveStoredSubtaskExecution,
  subtaskRouteIsConfigured,
} = require("../../subtaskCliRoute") as typeof import("../../subtaskCliRoute");
const {
  normalizeLoopTaskModelRouting,
} = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const {
  ensureCliModelStore,
  selectLoopSubtaskCliInStore,
  buildModelState,
  getSelectedLoopSubtaskCliFromStore,
} = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const {
  hasContinueModel,
  promptModelsFromContinuePair,
  resolveCurrentLoopModelPair,
  resolveLoopContinueModelPair,
} = require("../../continueModelChoice") as typeof import("../../continueModelChoice");
test("old Loop routes stay on the same CLI and illegal CLI values never reach a runner", () => {
  const legacy = normalizeLoopTaskModelRouting({
    main: { model: "gpt-main" },
    subtask: { model: "gpt-sub" },
  });
  assert.equal(legacy?.subtask.cli, undefined);
  assert.equal(legacy?.subtask.configId, undefined);
  const sameCli = resolveStoredSubtaskExecution({
    mainCli: "codex",
    route: legacy?.subtask,
    prompt: { loopSubtaskModel: "gpt-sub" },
  });
  assert.equal(sameCli.cli, "codex");
  assert.equal(sameCli.crossCli, false);
  assert.equal(sameCli.model, "gpt-sub");
  assert.equal(sameCli.unavailableReason, undefined);

  const invalid = normalizeLoopTaskModelRouting({
    main: { model: "gpt-main" },
    subtask: { cli: "not-a-cli", model: "stolen-main-model", configId: "main-config" },
  });
  assert.equal(invalid?.subtask.fallback, INVALID_SUBTASK_CLI_ROUTE);
  assert.equal(invalid?.subtask.cli, undefined);
  assert.equal(invalid?.subtask.model, undefined);
  const blocked = resolveStoredSubtaskExecution({
    mainCli: "grok",
    route: invalid?.subtask,
    routeFallback: invalid?.subtask.fallback,
    prompt: { loopSubtaskModel: "grok-main" },
  });
  assert.equal(blocked.crossCli, false);
  assert.equal(blocked.unavailableReason, "子模型 CLI 分组无效，不能派发子任务。");
  assert.equal(blocked.model, undefined);
});

test("Claude is a valid subroute without a model string and does not inherit the main CLI", () => {
  const routing = normalizeLoopTaskModelRouting({
    main: { model: "gpt-main" },
    subtask: { cli: "claude", configId: "claude-config" },
  });
  assert.equal(subtaskRouteIsConfigured(routing?.subtask), true);
  const execution = resolveStoredSubtaskExecution({
    mainCli: "codex",
    route: routing?.subtask,
    prompt: { loopSubtaskThinkingMode: "high" },
    originThinkingMode: "low",
  });
  assert.equal(execution.cli, "claude");
  assert.equal(execution.configId, "claude-config");
  assert.equal(execution.model, undefined);
  assert.equal(execution.crossCli, true);
  assert.equal(execution.thinkingMode, "low");
  assert.equal(planBoundSubtaskConfigApply({
    taskRole: "subtask",
    targetCli: "claude",
    loopSubtaskCli: "claude",
    loopSubtaskConfigId: "missing",
    configExists: false,
  }).action, "fail");
});

test("subtask CLI selection is stored per main config and does not rewrite the target CLI main role", () => {
  const legacy = ensureCliModelStore({
    selectedByConfigId: { "grok-config": "grok-main" },
    selectedLoopByConfigId: { "grok-config": { main: "grok-main", subtask: "grok-sub" } },
  } as never);
  assert.deepEqual(legacy.selectedLoopSubtaskCliByConfigId, {});
  const store = selectLoopSubtaskCliInStore(legacy, "codex-a", "grok");
  assert.equal(getSelectedLoopSubtaskCliFromStore(store, "codex-a"), "grok");
  assert.equal(getSelectedLoopSubtaskCliFromStore(store, "codex-b"), null);
  assert.equal(store.selectedByConfigId["grok-config"], "grok-main");
  assert.deepEqual(store.selectedLoopByConfigId["grok-config"], { main: "grok-main", subtask: "grok-sub" });
  const state = buildModelState(store, () => "codex-a");
  assert.equal(state.selectedLoopSubtaskCliByConfigId?.["codex-a"], "grok");
  const roundTrip = ensureCliModelStore(JSON.parse(JSON.stringify(store)));
  assert.equal(getSelectedLoopSubtaskCliFromStore(roundTrip, "codex-a"), "grok");
  assert.equal(roundTrip.selectedLoopByConfigId["grok-config"]?.main, "grok-main");
});

test("continue keeps the original cross-CLI route and current config rewrites the selected CLI", () => {
  const original = {
    main: "gpt-main",
    subtask: null,
    subtaskCli: "claude" as CliName,
    subtaskConfigId: "claude-old",
  };
  assert.equal(hasContinueModel(original), true);
  assert.equal(hasContinueModel({ main: null, subtask: null }), false);
  const kept = resolveLoopContinueModelPair({
    modelSource: "original",
    original,
    current: { main: "new-main", subtask: "new-sub", subtaskCli: "grok", subtaskConfigId: "grok-new" },
  });
  assert.deepEqual(promptModelsFromContinuePair(kept), {
    model: "gpt-main",
    loopMainModel: "gpt-main",
    loopSubtaskCli: "claude",
    loopSubtaskConfigId: "claude-old",
  });

  const current = resolveCurrentLoopModelPair({
    cli: "opencode",
    configId: "opencode-main",
    getSelectedCliModel: (cli) => cli === "opencode" ? "oc-main" : null,
    getSelectedLoopCliModel: (cli, role) => cli === "codex" && role === "subtask" ? "codex-sub" : null,
    getSelectedLoopSubtaskCli: () => "codex",
    getActiveConfigIdForCli: (cli) => cli === "codex" ? "codex-live" : null,
  });
  assert.equal(current.subtaskCli, "codex");
  assert.equal(current.subtaskConfigId, "codex-live");
  assert.equal(current.subtask, "codex-sub");
  assert.equal(current.main, "oc-main");

  const missing = resolveCurrentLoopModelPair({
    cli: "claude",
    configId: "claude-main",
    getSelectedCliModel: () => null,
    getSelectedLoopSubtaskCli: () => "grok",
    getActiveConfigIdForCli: () => null,
  });
  assert.equal(missing.unavailableReason, "目标 CLI 没有可用配置，不能派发子任务。");
  assert.equal(hasContinueModel(missing), false);
});

test("cross-CLI config sync retries every three seconds at most three times", async () => {
  const delays: number[] = [];
  let refreshes = 0;
  let waits = 0;
  const configId = await resolveSubtaskRouteConfigId({
    cli: "claude",
    getActiveConfigId: () => refreshes === 3 ? "claude-live-config" : null,
    waitForConfigApply: async () => { waits += 1; return true; },
    refreshPanelState: async () => { refreshes += 1; },
    delay: async (milliseconds) => { delays.push(milliseconds); },
  });
  assert.equal(configId, "claude-live-config");
  assert.deepEqual(delays, [3000, 3000, 3000]);
  assert.equal(refreshes, 3);
  assert.equal(waits, 3);

  const exhaustedDelays: number[] = [];
  const exhausted = await resolveSubtaskRouteConfigId({
    cli: "claude",
    getActiveConfigId: () => null,
    delay: async (milliseconds) => { exhaustedDelays.push(milliseconds); },
  });
  assert.equal(exhausted, null);
  assert.deepEqual(exhaustedDelays, [3000, 3000, 3000]);
});
