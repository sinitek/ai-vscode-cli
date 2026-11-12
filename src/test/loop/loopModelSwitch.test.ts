import test = require("node:test");
import assert = require("node:assert/strict");
import { applyLoopInvocationModelRouting, applyLoopModelRoutingToPrompt, applyLoopPromptThinkingToOriginProfile, buildLoopModelSwitchState, resolveLoopModelSwitch, type LoopModelSwitchDeps } from "../../loopModelSwitch";
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

for (const mode of ["classic", "fullstack", "split"] as const) {
  test(`${mode} saves thinking per active role and applies it at the invocation boundary`, () => {
    const record = task();
    record.originProfile = { configId: "old-config", mainThinkingMode: "low", subtaskThinkingMode: "low", subtaskFrontendThinkingMode: "low", subtaskFullstackThinkingMode: "low" };
    if (mode !== "classic") {
      record.schedulingMode = "event_driven";
      record.loopSubtaskMode = mode;
    }
    const state = buildLoopModelSwitchState(record, deps);
    assert.equal(state.fields[0].thinkingMode, "low");
    const models = Object.fromEntries(state.fields.map((field) => [field.role, `${field.cli}-${field.role === "main" ? "main" : "subtask"}`]));
    const thinking = Object.fromEntries(state.fields.map((field) => [field.role, field.role === "main" ? "xhigh" : "max"]));
    const result = resolveLoopModelSwitch(record, state, models, thinking);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(record.originProfile.mainThinkingMode, "low");
    record.modelRouting = result.modelRouting;
    record.originProfile = result.originProfile;
    assert.equal(record.originProfile.mainThinkingMode, "xhigh");
    assert.equal(record.originProfile.subtaskFullstackThinkingMode, mode === "fullstack" ? "max" : "low");
    assert.equal(record.originProfile.subtaskFrontendThinkingMode, mode === "split" ? "max" : "low");
    const input = { displayPrompt: "继续", modelPrompt: "继续", contextTags: [], thinkingModeOverride: "low" as const, loopMainThinkingMode: "low" as const, loopSubtaskThinkingMode: "low" as const };
    const main = applyLoopInvocationModelRouting({ ...input, taskRole: "main" }, record);
    assert.equal(main.thinkingModeOverride, "xhigh");
    const roles = mode === "split" ? ["backend", "frontend", "general"] as const : [mode === "fullstack" ? "fullstack" : "backend"] as const;
    for (const role of roles) {
      record.subTasks = [{ id: "child", title: "子任务", status: "running", taskType: role === "fullstack" ? "backend" : role, writeFiles: role === "general" ? [] : ["src/code.ts"] }];
      const child = applyLoopInvocationModelRouting({ ...input, taskRole: "subtask", loopSubtaskId: "child" }, record);
      assert.equal(child.thinkingModeOverride, role === "general" ? "xhigh" : "max");
      assert.equal(child.loopSubtaskThinkingMode, role === "general" ? "xhigh" : "max");
    }
  });
}

test("thinking selection is validated against the selected model and rejected atomically", () => {
  const record = task();
  const before = JSON.stringify(record);
  const state = buildLoopModelSwitchState(record, { ...deps,
    getLoopModelSwitchThinkingOptions: (_cli, model) => model ? [{ value: "low", label: "低" }] : [],
  });
  const models = { main: "codex-main", subtask: "claude-subtask" };
  for (const thinking of [null, [], "high", {}, { main: "max", subtask: "low" }, { main: "low", subtask: 1 }]) {
    assert.equal(resolveLoopModelSwitch(record, state, models, thinking).ok, false);
  }
  assert.equal(resolveLoopModelSwitch(record, state, models, { main: "low", subtask: "low" }).ok, true);
  assert.equal(resolveLoopModelSwitch(record, state, { main: "", subtask: "" }, {}).ok, true);
  assert.equal(resolveLoopModelSwitch(record, state, { main: "", subtask: "" }, { main: "low" }).ok, false);
  assert.equal(JSON.stringify(record), before);
});

test("unavailable thinking is disabled and stored role preferences seed the dialog", () => {
  const record = task();
  record.modelRouting!.main.model = "codex-main";
  const state = buildLoopModelSwitchState(record, { ...deps, getSelectedLoopThinkingMode: () => "medium" });
  const html = renderLoopModelSwitchFields(state);
  assert.match(html, /data-thinking-role="main"/u);
  assert.match(html, /value="medium" selected>中/u);
  assert.match(html, /主模型思考力度/u);
  const unsupported = buildLoopModelSwitchState(record, { ...deps, getLoopModelSwitchThinkingOptions: () => [] });
  assert.match(renderLoopModelSwitchFields(unsupported), /disabled><option value="">当前模型不支持思考力度/u);
});

test("ordinary prompts and independent group questions retain their thinking overrides", () => {
  const input = { displayPrompt: "问题", modelPrompt: "问题", contextTags: [], thinkingModeOverride: "low" as const };
  const record = task();
  record.originProfile = { configId: "config", mainThinkingMode: "max" };
  assert.equal(applyLoopInvocationModelRouting(input, record), input);
  const ask = { ...input, taskRole: "main" as const, loopAsk: true };
  assert.equal(applyLoopInvocationModelRouting(ask, record), ask);
});

test("switching only thinking keeps models while legacy requests preserve existing thinking", () => {
  const record = task();
  record.originProfile = { configId: "codex-current", mainThinkingMode: "medium", subtaskThinkingMode: "low" };
  record.modelRouting!.main.model = "codex-main";
  record.modelRouting!.subtask.model = "claude-subtask";
  const state = buildLoopModelSwitchState(record, deps);
  const models = { main: "codex-main", subtask: "claude-subtask" };
  const legacy = resolveLoopModelSwitch(record, state, models);
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  assert.deepEqual(legacy.originProfile, record.originProfile);
  const updated = resolveLoopModelSwitch(record, state, models, { main: "max", subtask: "xhigh" });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.modelRouting.main.model, "codex-main");
  assert.equal(updated.modelRouting.subtask.model, "claude-subtask");
  assert.equal(updated.originProfile.mainThinkingMode, "max");
  assert.equal(updated.originProfile.subtaskThinkingMode, "xhigh");
});

test("explicit main-tab continuation refreshes saved thinking without losing inactive role settings", () => {
  const profile = { configId: "config", mainThinkingMode: "low" as const, subtaskFullstackThinkingMode: "medium" as const };
  const updated = applyLoopPromptThinkingToOriginProfile(profile, { loopMainThinkingMode: "max", loopSubtaskThinkingMode: "xhigh" });
  assert.equal(updated.mainThinkingMode, "max");
  assert.equal(updated.subtaskThinkingMode, "xhigh");
  assert.equal(updated.subtaskFullstackThinkingMode, "medium");
  assert.equal(profile.mainThinkingMode, "low");
  assert.deepEqual(applyLoopPromptThinkingToOriginProfile(profile, {}), profile);
});
