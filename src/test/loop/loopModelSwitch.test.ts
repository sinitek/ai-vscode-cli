import test = require("node:test");
import assert = require("node:assert/strict");
import { applyLoopInvocationModelRouting, applyLoopModelRoutingToPrompt, buildLoopModelSwitchState, resolveLoopModelSwitch, type LoopModelSwitchDeps } from "../../loopModelSwitch";
import type { LoopTaskRecord } from "../../loopTaskStore";
import { renderLoopModelSwitchFields } from "../../webview/loopModelSwitchDialog";

function task(): LoopTaskRecord {
  return {
    id: "switch-task", cli: "codex", status: "running", workspaceKey: "workspace", taskStoreFile: "/tmp/tasks.json",
    rootPrompt: "实现功能", createdAt: 1, updatedAt: 1, maxRounds: 10, currentRound: 1,
    communicationDir: "/tmp/comm", mainCommunicationFile: "/tmp/comm/main.md", subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
    modelRouting: {
      main: { model: "old-main" }, subtask: { cli: "claude", configId: "old-config", model: "old-child" },
      subtaskFrontend: { cli: "grok", model: "old-frontend" }, subtaskFullstack: { cli: "opencode", model: "old-fullstack" },
    },
  };
}

const deps: LoopModelSwitchDeps = {
  getActiveConfigIdForCli: (cli) => `${cli}-current`,
  getSelectedCliModel: () => "unrelated-model",
  getLoopModelSwitchOptions: (cli, role, configId) => {
    assert.equal(configId, `${cli}-current`);
    return [{ value: `${cli}-${role}`, label: `${cli} 显示名称` }, { value: "", label: "CLI 默认模型" }];
  },
};

test("Loop uses each bound CLI's current config without changing the CLI or global selection", () => {
  const record = task();
  const state = buildLoopModelSwitchState(record, deps);
  assert.deepEqual(state.fields.map((field) => [field.role, field.cli, field.configId]), [
    ["main", "codex", "codex-current"], ["subtask", "claude", "claude-current"],
  ]);
  const result = resolveLoopModelSwitch(record, state, { main: "codex-main", subtask: "claude-subtask" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.configId, "codex-current");
  assert.deepEqual(result.modelRouting.subtask, { cli: "claude", configId: "claude-current", model: "claude-subtask" });
  assert.equal(result.modelRouting.main.model, "codex-main");
  assert.equal(record.modelRouting?.main.model, "old-main");
});

test("invocation boundary refreshes split frontend models and discards an obsolete config selection", () => {
  const record = task();
  record.schedulingMode = "event_driven";
  record.loopSubtaskMode = "split";
  record.subTasks = [{ id: "front", title: "前端", status: "running", taskType: "frontend", writeFiles: ["src/ui.ts"] }];
  record.modelRouting!.subtaskFrontend = { cli: "grok", configId: "grok-current", model: "new-frontend" };
  const result = applyLoopInvocationModelRouting({
    displayPrompt: "继续", modelPrompt: "继续", contextTags: [], taskRole: "subtask", loopTaskId: record.id,
    loopSubtaskId: "front", model: "cached-model", loopSubtaskModel: "cached-child",
    configSelections: { grok: { configId: "grok-old", revision: "old" } },
  }, record);
  assert.equal(result.model, "new-frontend");
  assert.equal(result.loopSubtaskModel, "new-frontend");
  assert.equal(result.loopSubtaskCli, "grok");
  assert.equal(result.loopSubtaskConfigId, "grok-current");
  assert.equal(result.configSelections, undefined);
});

test("invocation boundary preserves explicit default child instead of inheriting the main model", () => {
  const record = task();
  record.modelRouting!.subtask = { cli: "codex", configId: "codex-current" };
  const result = applyLoopInvocationModelRouting({
    displayPrompt: "继续", modelPrompt: "继续", contextTags: [], taskRole: "subtask", loopTaskId: record.id,
    model: "cached-model", loopSubtaskModel: "cached-child", loopMainModelFallback: "cached-fallback",
  }, record);
  assert.equal(result.model, undefined);
  assert.equal(result.loopSubtaskModel, undefined);
  assert.equal(result.loopSubtaskCli, "codex");
  assert.equal(result.loopMainModelFallback, undefined);
});

test("ordinary prompts and group chat questions retain their independently selected model", () => {
  const input = { displayPrompt: "问题", modelPrompt: "问题", contextTags: [], model: "ask-model" };
  assert.equal(applyLoopInvocationModelRouting(input, task()), input);
  const ask = { ...input, taskRole: "main" as const, loopAsk: true };
  assert.equal(applyLoopInvocationModelRouting(ask, task()), ask);
});

for (const mode of ["fullstack", "split"] as const) {
  test(`Loop+ ${mode} switches only active role slots and preserves inactive routes`, () => {
    const record = { ...task(), schedulingMode: "event_driven" as const, loopSubtaskMode: mode };
    const state = buildLoopModelSwitchState(record, deps);
    assert.deepEqual(state.fields.map((field) => field.role), mode === "fullstack" ? ["main", "fullstack"] : ["main", "subtask", "frontend"]);
    const result = resolveLoopModelSwitch(record, state, {
      main: "codex-main", fullstack: "opencode-subtask", subtask: "claude-subtask", frontend: "grok-subtask",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.modelRouting.subtaskFullstack?.model, mode === "fullstack" ? "opencode-subtask" : "old-fullstack");
    assert.equal(result.modelRouting.subtaskFrontend?.model, mode === "split" ? "grok-subtask" : "old-frontend");
  });
}

test("legacy atomic fullstack switches its child CLI without guessing a new CLI", () => {
  const record = { ...task(), schedulingMode: "event_driven" as const };
  delete record.modelRouting!.subtaskFrontend;
  delete record.modelRouting!.subtaskFullstack;
  const state = buildLoopModelSwitchState(record, deps);
  assert.equal(state.fields[1].role, "fullstack");
  assert.equal(state.fields[1].cli, "claude");
});

test("default model clears the old model and fallback without losing route identity", () => {
  const record = task();
  record.modelRouting!.subtask.fallback = "old-child";
  const state = buildLoopModelSwitchState(record, deps);
  const result = resolveLoopModelSwitch(record, state, { main: "", subtask: "" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.modelRouting.main, { configId: "codex-current" });
  assert.deepEqual(result.modelRouting.subtask, { cli: "claude", configId: "claude-current" });
});

test("rejects missing, stale, foreign, completed and unavailable choices atomically", () => {
  const record = task();
  const before = JSON.stringify(record);
  const state = buildLoopModelSwitchState(record, deps);
  for (const models of [null, [], {}, { main: "codex-main", subtask: "foreign" }, { main: 1, subtask: "" }]) {
    assert.equal(resolveLoopModelSwitch(record, state, models).ok, false);
  }
  assert.equal(resolveLoopModelSwitch({ ...record, status: "completed" }, state, { main: "", subtask: "" }).ok, false);
  const unavailable = buildLoopModelSwitchState(record, { ...deps, getActiveConfigIdForCli: () => null });
  assert.match(unavailable.error ?? "", /当前配置没有可选模型/u);
  assert.equal(resolveLoopModelSwitch(record, unavailable, { main: "", subtask: "" }).ok, false);
  assert.equal(JSON.stringify(record), before);
});

test("renders display names, default selection, unavailable old choices and HTML escaping", () => {
  const record = task();
  record.modelRouting!.main.model = undefined;
  const state = buildLoopModelSwitchState(record, deps);
  state.fields[0].options.push({ value: '<model">', label: '<模型">' });
  const html = renderLoopModelSwitchFields(state);
  assert.match(html, /value="" selected>CLI 默认模型/u);
  assert.match(html, /disabled selected>请选择模型/u);
  assert.match(html, /codex 显示名称/u);
  assert.match(html, /&lt;模型&quot;&gt;/u);
  assert.doesNotMatch(html, /<model/u);
});

test("latest persisted routes replace stale prompt models, including explicit CLI defaults", () => {
  const prompt = { model: "old-main", loopMainModel: "old-main", loopSubtaskModel: "old-child", loopSubtaskFrontendModel: "old-frontend", loopMainThinkingMode: "high" as const };
  assert.equal(applyLoopModelRoutingToPrompt(prompt), prompt);
  const updated = applyLoopModelRoutingToPrompt(prompt, { main: { configId: "codex-current" }, subtask: { cli: "claude", configId: "claude-current" } });
  assert.equal(updated.model, undefined);
  assert.equal(updated.loopMainModel, undefined);
  assert.equal(updated.loopSubtaskModel, undefined);
  assert.equal(updated.loopSubtaskFrontendModel, undefined);
  assert.equal(updated.loopMainThinkingMode, "high");
  assert.equal(prompt.model, "old-main");
});
