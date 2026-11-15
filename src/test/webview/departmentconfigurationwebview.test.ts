import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";
import { VIEW_CONTENT_SCRIPT_DEPARTMENT_CONFIGURATION } from "../../webview/viewContentScript/departmentConfiguration";
import { CLI_LIST } from "../../cli/types";
import { getWebviewStrings } from "../../webview/viewContentStrings";

class Control {
  value = ""; textContent = ""; hidden = false; disabled = false;
  options: Array<{ value: string; textContent: string }> = [];
  listeners: Record<string, () => void> = {};
  replaceChildren(): void { this.options = []; }
  appendChild(option: { value: string; textContent: string }): void { this.options.push(option); }
  addEventListener(event: string, listener: () => void): void { this.listeners[event] = listener; }
}

export function createDepartmentUiHarness() {
  const controls: Record<string, Control> = {};
  for (const id of ["departmentRoleConfiguration", "departmentDirectorSummary", "departmentRoleMessage", "ordinaryModels"])
    controls[id] = new Control();
  for (const role of ["leader", "employee"]) for (const field of ["cli", "config", "model", "thinking", "variant", "retry", "message"])
    controls[`department-${role}-${field}`] = new Control();
  const posted: Record<string, any>[] = [];
  const state = { currentCli: "codex", interactiveMode: "department", configState: { configs: [{ id: "director", name: "总监档案" }] } };
  const strings = getWebviewStrings();
  const context = vm.createContext({ document: {
    getElementById: (id: string) => controls[id] ?? null,
    querySelector: () => controls.ordinaryModels,
    createElement: () => ({ value: "", textContent: "" }),
  }, state, getEnabledCliNames: () => CLI_LIST, formatCliDisplayName: (cli: string) => cli,
  t: (key: keyof typeof strings) => strings[key], vscode: { postMessage: (message: Record<string, any>) => posted.push(message) } });
  vm.runInContext(VIEW_CONTENT_SCRIPT_DEPARTMENT_CONFIGURATION, context);
  const director = { cli: "codex", configId: "director", model: "gpt", thinkingMode: "high", openCodeVariant: null };
  const sync = (preferences: Record<string, unknown> = {}, configId = "director", scope?: string) => context.syncDepartmentConfigurationState({ departmentConfigurationScope: scope, departmentDirector: { ...director, configId }, departmentRolePreferences: preferences });
  const change = (role: string, field: string, value: string) => {
    controls[`department-${role}-${field}`].value = value;
    controls[`department-${role}-${field}`].listeners.change();
  };
  const candidates = (role: string, request = posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === role).slice(-1)[0]!) => {
    context.applyDepartmentRoleCandidates({ role, scope: request.scope, requestId: request.requestId, candidates: { cli: request.cli, configId: request.configId,
      configs: [{ id: "profile", name: "角色档案" }], models: ["model"], supportsDefaultModel: true, defaultModel: "model",
      thinkingByModel: { model: ["high"] }, variantsByModel: { model: ["high", "max"] } } });
  };
  return { context, state, controls, posted, sync, change, candidates };
}

test("generated role controls load, isolate CLI/profile queries and submit an explicit default choice", () => {
  const h = createDepartmentUiHarness(); h.sync();
  assert.equal(h.controls["department-leader-model"].disabled, true);
  assert.equal(h.controls["department-leader-config"].disabled, true);
  h.candidates("leader");
  assert.equal(h.controls["department-leader-config"].disabled, false);
  assert.equal(h.posted.some((message) => message.type === "updateDepartmentRolePreference"), false);
  h.change("leader", "config", "profile"); h.candidates("leader");
  h.change("leader", "model", "__default__");
  const save = h.posted.slice(-1)[0]!;
  assert.equal(save.type, "updateDepartmentRolePreference"); assert.equal(save.preference.model, null);
  assert.equal(save.directorConfigId, "director");
  h.context.applyDepartmentRolePreferenceSaved({ ...save, type: "departmentRolePreferenceSaved", ok: true });
  h.change("leader", "cli", "opencode"); const old = h.posted.slice(-1)[0]!;
  h.change("leader", "cli", "claude"); const current = h.posted.slice(-1)[0]!;
  h.candidates("leader", old);
  assert.equal(h.controls["department-leader-config"].disabled, true, "late old CLI candidate must not unlock the new row");
  h.candidates("leader", current);
  assert.equal(h.controls["department-leader-cli"].value, "claude");
  assert.equal(h.controls["department-leader-model"].value, "__missing__");
});

test("save failure allows retry; mode switch and host refresh preserve the independent role selection", () => {
  const h = createDepartmentUiHarness();
  h.sync({ leader: { cli: "opencode", configId: "profile", model: "model", thinkingMode: null, openCodeVariant: "high" } });
  h.candidates("leader"); h.candidates("employee");
  h.change("leader", "variant", "max"); const save = h.posted.slice(-1)[0]!;
  h.context.applyDepartmentRolePreferenceSaved({ ...save, ok: false, error: "角色配置保存失败，请重试。" });
  assert.equal(h.controls["department-leader-retry"].hidden, false);
  assert.equal(h.controls["department-leader-variant"].disabled, false);
  assert.match(h.controls["department-leader-message"].textContent, /保存失败/);
  h.state.interactiveMode = "loop_plus"; h.context.renderDepartmentConfiguration();
  assert.equal(h.controls.departmentRoleConfiguration.hidden, true);
  h.state.interactiveMode = "department"; h.context.renderDepartmentConfiguration();
  assert.equal(h.controls["department-leader-variant"].value, "max");
  h.controls["department-leader-retry"].listeners.click(); const retry = h.posted.slice(-1)[0]!;
  assert.notEqual(retry.requestId, save.requestId);
  h.context.applyDepartmentRolePreferenceSaved({ ...retry, ok: true });
  h.sync({ leader: retry.preference });
  assert.equal(h.controls["department-leader-variant"].value, "max");
  const old = h.posted.find((message) => message.type === "requestDepartmentRoleCandidates")!;
  h.sync({}, "other-director"); h.candidates("leader", old);
  assert.equal(h.controls["department-leader-config"].disabled, true);
});

test("candidate errors, empty configs and missing models show actionable Chinese states", () => {
  const h = createDepartmentUiHarness(); h.sync();
  const request = h.posted.find((message) => message.role === "leader")!;
  h.context.applyDepartmentRoleCandidates({ ...request, error: "读取角色档案失败，请重试。" });
  assert.match(h.controls["department-leader-message"].textContent, /读取角色档案失败/);
  assert.match(h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab"), /失败|加载/);
  assert.equal(h.controls["department-leader-retry"].hidden, false);
  h.context.applyDepartmentRoleCandidates({ ...request, candidates: { cli: request.cli, configId: null, configs: [], models: [] } });
  assert.match(h.controls["department-leader-message"].textContent, /没有可用档案/);
  assert.equal(h.controls["department-leader-config"].disabled, true);
  h.sync({ employee: { cli: "claude", configId: "empty-models", model: null, thinkingMode: null, openCodeVariant: null } });
  const employeeRequest = h.posted.filter((message) => message.role === "employee").slice(-1)[0]!;
  h.context.applyDepartmentRoleCandidates({ ...employeeRequest, candidates: { cli: "claude", configId: "empty-models",
    configs: [{ id: "empty-models", name: "空模型档案" }], models: [], supportsDefaultModel: false } });
  assert.match(h.controls["department-employee-message"].textContent, /没有可用模型/);
  assert.equal(h.controls["department-employee-model"].disabled, true);
});

test("same director in a new workspace resets drafts and rejects stale candidates and saves", () => {
  const h = createDepartmentUiHarness();
  const pref = { cli: "codex", configId: "profile", model: "model", thinkingMode: null, openCodeVariant: null };
  h.sync({ leader: pref, employee: pref }, "director", "workspace-a:1");
  h.candidates("leader"); h.candidates("employee");
  h.change("leader", "model", "__default__");
  const oldSave = h.posted[h.posted.length - 1]!;
  const oldQuery = h.posted.find((message) => message.role === "employee")!;
  h.sync({}, "director", "workspace-b:2");
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true }); h.candidates("employee", oldQuery);
  assert.equal(h.controls["department-leader-model"].value, "__missing__");
  assert.equal(h.controls["department-employee-config"].disabled, true);
  assert.match(h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab"), /加载/);
});

test("new roots require loaded saved choices; failure preserves draft, retry success unlocks, old modes and supplements pass", () => {
  const h = createDepartmentUiHarness();
  const pref = { cli: "codex", configId: "profile", model: "model", thinkingMode: null, openCodeVariant: null };
  const issue = () => h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab");
  h.sync({ leader: pref, employee: pref }); assert.match(issue(), /加载/);
  h.candidates("leader"); h.candidates("employee"); assert.equal(issue(), "");
  h.change("leader", "thinking", "high"); const save = h.posted[h.posted.length - 1]!;
  assert.match(issue(), /正在保存/); assert.equal(h.context.guardDepartmentRootDispatch({ interactiveMode: "department" }, "tab"), false);
  h.context.applyDepartmentRolePreferenceSaved({ ...save, ok: false, error: "保存失败" });
  assert.match(issue(), /失败/); assert.equal(h.controls["department-leader-thinking"].value, "high");
  for (const mode of ["coding", "loop", "loop_plus"]) assert.equal(h.context.guardDepartmentRootDispatch({ interactiveMode: mode }, "tab"), true);
  h.context.isConversationTabBusy = () => true; assert.equal(issue(), "");
  assert.equal(h.context.departmentRootReadinessIssue({ interactiveMode: "department", departmentConfigurationScope: "old:0" }, "tab"), "", "supplements ignore new-root scope/draft readiness");
  h.context.isConversationTabBusy = () => false;
  h.controls["department-leader-retry"].listeners.click(); const retry = h.posted[h.posted.length - 1]!;
  h.context.applyDepartmentRolePreferenceSaved({ ...retry, ok: true }); assert.equal(issue(), "");
  h.change("leader", "cli", "claude"); h.candidates("leader"); assert.match(issue(), /尚未保存|完成/);
});
