import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";
import { VIEW_CONTENT_SCRIPT_DEPARTMENT_CONFIGURATION } from "../../webview/viewContentScript/departmentConfiguration";
import { CLI_LIST } from "../../cli/types";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { installVscodeMock } from "../vscodeMock";
import type { PanelMessageHandlerDeps } from "../../sessionMessageHandlers";
import type { PanelMessage } from "../../webview/types";

installVscodeMock();
const { handlePanelMessageWithDeps } = require("../../sessionMessageHandlers") as typeof import("../../sessionMessageHandlers");

class Control {
  value = ""; textContent = ""; title = ""; hidden = false; disabled = false; parentNode: Control | null = null;
  children: Control[] = [];
  classList = { toggle: (_name: string, _enabled: boolean) => {} };
  options: Array<{ value: string; textContent: string }> = [];
  listeners: Record<string, () => void> = {};
  replaceChildren(): void { this.options = []; }
  get nextSibling(): Control | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children, index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }
  appendChild(option: Control | { value: string; textContent: string }): void {
    if (option instanceof Control) {
      if (option.parentNode) option.parentNode.children.splice(option.parentNode.children.indexOf(option), 1);
      option.parentNode = this; this.children.push(option);
    } else this.options.push(option);
  }
  insertBefore(child: Control, before: Control | null): void {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    const index = before ? this.children.indexOf(before) : -1;
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  addEventListener(event: string, listener: () => void): void { this.listeners[event] = listener; }
}

export function createDepartmentUiHarness() {
  const controls: Record<string, Control> = {};
  for (const id of ["departmentRoleConfiguration", "departmentDirectorControls", "departmentRoleMessage", "ordinaryModels"])
    controls[id] = new Control();
  for (const role of ["leader", "employee"]) for (const field of ["cli", "model", "thinking", "variant", "retry"])
    controls[`department-${role}-${field}`] = new Control();
  const posted: Record<string, any>[] = [];
  const state: { currentCli: string; interactiveMode: string; activeConfigIdByCli: Partial<Record<import("../../cli/types").CliName, string | null>>; configState: { configs: Array<{ id: string; name: string }>; revision?: string }; configStateByCli: Record<string, { revision?: string }> } = { currentCli: "codex", interactiveMode: "department", activeConfigIdByCli: { codex: "director" }, configState: { configs: [{ id: "director", name: "总监档案" }], revision: "r1" }, configStateByCli: { codex: { revision: "r1" } } };
  const selectParents = {
    codex: new Control(), opencode: new Control(),
  };
  controls.ordinaryModels.appendChild(selectParents.codex);
  controls.ordinaryModels.appendChild(selectParents.opencode);
  for (const id of ["modelSelect", "thinkingMode"]) selectParents.codex.appendChild(controls[id] = new Control());
  for (const id of ["openCodePrimaryModelSelect", "openCodePrimaryThinkingMode"]) selectParents.opencode.appendChild(controls[id] = new Control());
  const strings = getWebviewStrings();
  const context = vm.createContext({ document: {
    getElementById: (id: string) => controls[id] ?? null,
    querySelector: (selector: string) => selector === ".input-model-row" ? controls.ordinaryModels : selector === ".config-select-row" ? controls.configSelectRow : null,
    createElement: () => ({ value: "", textContent: "" }),
  }, state, elements: {}, getEnabledCliNames: () => CLI_LIST, formatCliDisplayName: (cli: string) => cli,
  t: (key: keyof typeof strings) => strings[key], vscode: { postMessage: (message: Record<string, any>) => posted.push(message) } });
  vm.runInContext(VIEW_CONTENT_SCRIPT_DEPARTMENT_CONFIGURATION, context);
  const director = { cli: "codex", configId: "director", model: "gpt", thinkingMode: "high", openCodeVariant: null };
  const sync = (preferences: Record<string, any> = {}, configId = "director", scope?: string) => {
    context.syncDepartmentConfigurationState({ departmentConfigurationScope: scope, departmentDirector: { ...director, configId }, departmentRolePreferences: preferences });
  };
  const change = (role: string, field: string, value: string) => {
    controls[`department-${role}-${field}`].value = value;
    controls[`department-${role}-${field}`].listeners.change();
  };
  const changeModeLocally = (mode: string) => context.applyLocalInteractiveModeChange(mode);
  const candidates = (role: string, request = posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === role).slice(-1)[0]!) => {
    context.applyDepartmentRoleCandidates({ role, scope: request.scope, requestId: request.requestId, candidates: { cli: request.cli, configId: request.configId,
      models: ["model"], supportsDefaultModel: true, defaultModel: "model",
      thinkingByModel: { model: ["high"] }, variantsByModel: { model: ["high", "max"] } } });
  };
  const error = (role: string) => vm.runInContext(`departmentRoleUi.rows.${role}.error`, context) as string;
  return { context, state, controls, posted, sync, change, changeModeLocally, candidates, error };
}

test("first mode entry loads both role models through the host without a CLI toggle or retry", async () => {
  const h = createDepartmentUiHarness();
  h.state.interactiveMode = "coding";
  h.sync();
  let changeMode!: (event: { target: { value: string } }) => void;
  h.context.elements.interactiveModeSelect = { addEventListener: (_event: string, listener: typeof changeMode) => { changeMode = listener; } };
  h.context.normalizeInteractiveMode = (value: string) => value;
  h.context.syncModelSelectorByInteractiveMode = () => h.context.renderDepartmentConfiguration();
  const start = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.lastIndexOf("      if (elements.interactiveModeSelect) {");
  const end = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("      if (elements.debugMode) {", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(VIEW_CONTENT_SCRIPT_MODEL_MANAGER.slice(start, end), h.context);
  changeMode({ target: { value: "department" } });

  let revision = 0;
  let hostMode = "coding";
  const replies: Record<string, any>[] = [];
  const deps = {
    ensureWorkspaceSessionStore: () => {},
    getCurrentCli: () => "codex", getActiveConfigIdForCli: () => "director",
    getDepartmentConfigurationScope: () => undefined,
    getDepartmentSelectionContextRevision: () => revision,
    invalidateDepartmentSelectionContext: () => { revision++; },
    isCliName: (value: string) => CLI_LIST.includes(value as any),
    isInteractiveMode: (value: string) => ["coding", "department"].includes(value),
    setWorkspaceInteractiveModeForCli: (_cli: string, mode: string) => { hostMode = mode; },
    getWorkspaceSettings: () => ({}), postPanelState: async () => {},
    readStoredToolSettings: () => ({ departmentEnabled: true }),
    readDepartmentConfigBinding: async () => ({ configId: "director", revision: "r1", ready: true }),
    getDepartmentRoleCandidates: async (cli: string, configId: string) => ({ cli, configId, configs: [{ id: configId }],
      models: ["model"], supportsDefaultModel: false, thinkingByModel: { model: ["high"] }, variantsByModel: {} }),
    postWebviewMessage: (reply: Record<string, any>) => { replies.push(reply); h.context.applyDepartmentRoleCandidates(reply); },
  } as unknown as PanelMessageHandlerDeps;
  // Start each message in send order without awaiting the preceding handler:
  // candidate binding reads must overlap subsequent messages, as in the extension.
  await Promise.all(h.posted.map((message) => handlePanelMessageWithDeps(message as PanelMessage, deps)));
  assert.equal(hostMode, "department");
  assert.equal(replies.length, 2);
  for (const role of ["leader", "employee"]) {
    assert.equal(h.error(role), "");
    assert.equal(h.controls[`department-${role}-model`].disabled, false);
    h.change(role, "model", "model");
    assert.equal(h.posted.at(-1)!.type, "updateDepartmentRolePreference");
    assert.equal(h.posted.at(-1)!.preference.thinkingMode, "high");
  }
});

test("generated role controls load, isolate CLI/profile queries and submit an explicit default choice", () => {
  const h = createDepartmentUiHarness(); h.sync();
  assert.equal(h.controls["department-leader-model"].disabled, true);
  h.candidates("leader");
  assert.equal(h.controls["department-leader-config"], undefined);
  assert.equal(h.posted.some((message) => message.type === "updateDepartmentRolePreference"), false);
  h.change("leader", "model", "__default__");
  const save = h.posted.slice(-1)[0]!;
  assert.equal(save.type, "updateDepartmentRolePreference"); assert.equal(save.preference.model, null);
  assert.equal(save.directorConfigId, "director");
  assert.equal(h.controls["department-leader-model"].title, "CLI 默认模型");
  h.context.applyDepartmentRolePreferenceSaved({ ...save, type: "departmentRolePreferenceSaved", ok: true });
  h.state.activeConfigIdByCli.opencode = "open-profile";

  h.change("leader", "cli", "opencode"); const old = h.posted.slice(-1)[0]!;
  h.change("leader", "cli", "codex"); const current = h.posted.slice(-1)[0]!;
  h.candidates("leader", old);
  assert.equal(h.controls["department-leader-model"].disabled, true, "late old CLI candidate must not unlock the new row");
  h.candidates("leader", current);
  assert.equal(h.controls["department-leader-cli"].value, "codex");
  assert.equal(h.controls["department-leader-model"].value, "__missing__");
});

test("all Loop CLIs are offered and saved Grok employees fetch candidates without replacing the route", () => {
  for (const cli of CLI_LIST) {
    const h = createDepartmentUiHarness();
    h.state.activeConfigIdByCli[cli] = cli === "codex" ? "director" : "profile";
    const saved = { cli, configId: h.state.activeConfigIdByCli[cli], model: "model", thinkingMode: null, openCodeVariant: null };
    h.sync({ employee: saved });
    assert.equal(h.controls["department-employee-cli"].value, cli);
    assert.deepEqual(h.controls["department-employee-cli"].options.map(option => option.value), ["__missing__", ...CLI_LIST]);
    const query = h.posted.find(message => message.role === "employee")!;
    assert.equal(query.cli, cli);
    h.candidates("employee", query);
    h.change("employee", "model", "model");
    const save = h.posted.at(-1)!;
    assert.equal(save.type, "updateDepartmentRolePreference");
    assert.equal(save.preference.cli, cli);
    assert.equal(saved.cli, cli);
  }
});

test("role efforts list concrete values and persist the displayed selection without an inherit option", () => {
  const h = createDepartmentUiHarness(); h.sync();
  assert.equal(h.controls["department-leader-thinking"].hidden, true, "loading has no redundant effort control");
  h.candidates("leader");
  h.change("leader", "model", "model");
  const thinking = h.controls["department-leader-thinking"];
  assert.equal(thinking.hidden, false);
  assert.deepEqual(thinking.options.map((option) => option.value), ["high"]);
  const save = h.posted.at(-1)!;
  assert.equal(thinking.value, "high");
  assert.equal(save.preference.thinkingMode, thinking.value);
  assert.equal(save.preference.openCodeVariant, null);
  h.context.applyDepartmentRolePreferenceSaved({ ...save, ok: true });

  h.state.activeConfigIdByCli.opencode = "open-profile";
  h.change("leader", "cli", "opencode"); h.candidates("leader");
  h.change("leader", "model", "model");
  const variant = h.controls["department-leader-variant"];
  assert.equal(thinking.hidden, true);
  assert.equal(variant.hidden, false);
  assert.deepEqual(variant.options.map((option) => option.value), ["high", "max"]);
  assert.equal(h.posted.at(-1)!.preference.openCodeVariant, variant.value);
  assert.equal(h.posted.at(-1)!.preference.thinkingMode, null);
});

test("role efforts prefer medium when available and disappear for a model without effort support", () => {
  const h = createDepartmentUiHarness();
  h.sync();
  const request = h.posted.find((message) => message.role === "employee")!;
  h.context.applyDepartmentRoleCandidates({ ...request, candidates: { cli: request.cli, configId: request.configId,
    models: ["reasoning", "plain"], supportsDefaultModel: false,
    thinkingByModel: { reasoning: ["low", "medium", "high"], plain: [] }, variantsByModel: {} } });
  h.change("employee", "model", "reasoning");
  const reasoningSave = h.posted.at(-1)!;
  assert.equal(reasoningSave.preference.thinkingMode, "medium");
  assert.equal(h.controls["department-employee-thinking"].value, "medium");
  h.context.applyDepartmentRolePreferenceSaved({ ...reasoningSave, ok: true });
  h.change("employee", "model", "plain");
  assert.equal(h.controls["department-employee-thinking"].hidden, true);
  assert.equal(h.controls["department-employee-variant"].hidden, true);
  assert.equal(h.posted.at(-1)!.preference.thinkingMode, null);
});

test("save failure allows retry; mode switch and host refresh preserve the independent role selection", () => {
  const h = createDepartmentUiHarness();
  h.state.activeConfigIdByCli.opencode = "profile";
  h.sync({ leader: { cli: "opencode", configId: "profile", model: "model", thinkingMode: null, openCodeVariant: "high" } });
  h.candidates("leader"); h.candidates("employee");
  h.change("leader", "variant", "max"); const save = h.posted.slice(-1)[0]!;
  h.context.applyDepartmentRolePreferenceSaved({ ...save, ok: false, error: "角色配置保存失败，请重试。" });
  assert.equal(h.controls["department-leader-retry"].hidden, false);
  assert.equal(h.controls["department-leader-variant"].disabled, false);
  assert.match(h.error("leader"), /保存失败/);
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
  assert.equal(h.controls["department-leader-model"].disabled, true);
});

test("candidate errors, unavailable active profiles and missing models show actionable Chinese states", () => {
  const h = createDepartmentUiHarness(); h.sync();
  const request = h.posted.find((message) => message.role === "leader")!;
  h.context.applyDepartmentRoleCandidates({ ...request, error: "读取角色档案失败，请重试。" });
  assert.match(h.error("leader"), /读取角色档案失败/);
  assert.match(h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab"), /失败|加载/);
  assert.equal(h.controls["department-leader-retry"].hidden, false);
  const requestsBeforeMissingProfile = h.posted.length;
  h.state.activeConfigIdByCli.opencode = null;
  h.change("leader", "cli", "opencode");
  assert.equal(h.posted.length, requestsBeforeMissingProfile);
  h.candidates("employee");
  assert.match(h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab"), /顶部配置入口/);
  h.state.activeConfigIdByCli.opencode = "empty-models";
  h.sync({ employee: { cli: "opencode", configId: "empty-models", model: null, thinkingMode: null, openCodeVariant: null } });
  const employeeRequest = h.posted.filter((message) => message.role === "employee").slice(-1)[0]!;
  h.context.applyDepartmentRoleCandidates({ ...employeeRequest, candidates: { cli: "opencode", configId: "empty-models",
    models: [], supportsDefaultModel: false } });
  h.change("leader", "cli", "codex");
  h.candidates("leader");
  assert.match(h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab"), /没有可用模型/);
  assert.equal(h.controls["department-employee-model"].disabled, true);
});

test("same director in a new workspace resets drafts and rejects stale candidates and saves", () => {
  const h = createDepartmentUiHarness();
  const pref = { cli: "codex", configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
  h.sync({ leader: pref, employee: pref }, "director", "workspace-a:1");
  h.candidates("leader"); h.candidates("employee");
  h.change("leader", "model", "__default__");
  const oldSave = h.posted[h.posted.length - 1]!;
  const oldQuery = h.posted.find((message) => message.role === "employee")!;
  h.sync({}, "director", "workspace-b:2");
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true }); h.candidates("employee", oldQuery);
  assert.equal(h.controls["department-leader-model"].value, "__missing__");
  assert.equal(h.controls["department-employee-model"].disabled, true);
  assert.match(h.context.departmentRootReadinessIssue({ interactiveMode: "department" }, "tab"), /加载/);
});

test("director selectors return to their original parents across CLI and mode round trips", () => {
  const h = createDepartmentUiHarness();
  const codexParent = h.controls.ordinaryModels.children[0];
  const openCodeParent = h.controls.ordinaryModels.children[1];
  const codexModel = h.controls.modelSelect;
  const codexThinking = h.controls.thinkingMode;
  const openCodeModel = h.controls.openCodePrimaryModelSelect;
  const openCodeThinking = h.controls.openCodePrimaryThinkingMode;
  h.sync();
  assert.equal(codexModel.parentNode, h.controls.departmentDirectorControls);
  assert.equal(codexThinking.parentNode, h.controls.departmentDirectorControls);
  assert.equal(openCodeModel.parentNode, openCodeParent);
  assert.equal(openCodeThinking.parentNode, openCodeParent);
  h.state.currentCli = "opencode";
  h.context.renderDepartmentConfiguration();
  assert.equal(codexModel.parentNode, codexParent);
  assert.equal(codexThinking.parentNode, codexParent);
  assert.equal(openCodeModel.parentNode, h.controls.departmentDirectorControls);
  assert.equal(openCodeThinking.parentNode, h.controls.departmentDirectorControls);
  const before = h.controls.departmentDirectorControls.children.slice();
  h.context.renderDepartmentConfiguration();
  assert.deepEqual(h.controls.departmentDirectorControls.children, before, "same-parent render keeps node identity and order");
  h.state.currentCli = "codex";
  h.context.renderDepartmentConfiguration();
  assert.equal(openCodeModel.parentNode, openCodeParent);
  assert.equal(openCodeThinking.parentNode, openCodeParent);
  for (const mode of ["coding", "loop", "loop_plus"]) {
    h.state.interactiveMode = mode;
    h.context.renderDepartmentConfiguration();
    assert.equal(codexModel.parentNode, codexParent);
    assert.equal(codexThinking.parentNode, codexParent);
    assert.equal(openCodeModel.parentNode, openCodeParent);
    assert.equal(openCodeThinking.parentNode, openCodeParent);
  }
});

test("stale save acknowledgements after a mode change cannot complete a new save", () => {
  const h = createDepartmentUiHarness(); h.sync(); h.candidates("leader");
  h.change("leader", "model", "__default__");
  const oldSave = h.posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1)!;
  h.state.interactiveMode = "loop_plus";
  h.sync();
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true });
  assert.match(h.error("leader"), /模式已切换/);
  h.state.interactiveMode = "department";
  h.sync();
  const newerQuery = h.posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "leader").at(-1)!;
  assert.notEqual(newerQuery.requestId, oldSave.requestId);
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true });
  assert.match(h.controls.departmentRoleMessage.textContent, /正在加载/);
});

test("local mode changes invalidate candidate and save tokens across department ABA without panel sync", () => {
  const h = createDepartmentUiHarness(); h.sync();
  const oldQuery = h.posted.find((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "leader")!;
  h.candidates("leader", oldQuery);
  h.change("leader", "model", "__default__");
  const oldSave = h.posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1)!;

  h.changeModeLocally("loop");
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true });
  assert.match(h.error("leader"), /模式已切换/);
  h.context.applyDepartmentRoleCandidates({ ...oldQuery, candidates: { cli: oldQuery.cli, configId: oldQuery.configId,
    configs: [{ id: oldQuery.configId, name: "target" }], models: ["model"], supportsDefaultModel: true, defaultModel: "model" } });
  h.changeModeLocally("department");
  const newQuery = h.posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "leader").at(-1)!;
  assert.notEqual(newQuery.requestId, oldQuery.requestId);
  h.context.applyDepartmentRoleCandidates({ ...oldQuery, candidates: { cli: oldQuery.cli, configId: oldQuery.configId,
    configs: [{ id: oldQuery.configId, name: "target" }], models: ["late-model"], supportsDefaultModel: false } });
  assert.equal(h.controls["department-leader-model"].disabled, true, "late candidate cannot unlock ABA-returned row");
  h.candidates("leader", newQuery);
  h.change("leader", "model", "model");
  const newSave = h.posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1)!;
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true });
  assert.match(h.controls.departmentRoleMessage.textContent, /正在保存/);
  assert.equal(h.controls["department-leader-model"].disabled, true, "old acknowledgement cannot release newer save");
  h.context.applyDepartmentRolePreferenceSaved({ ...newSave, ok: false, error: "新保存失败" });
  assert.match(h.error("leader"), /新保存失败/);
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true });
  assert.match(h.error("leader"), /新保存失败/);
});

test("target config revision changes invalidate a pending save and its old acknowledgement", () => {
  const h = createDepartmentUiHarness(); h.sync(); h.candidates("leader");
  h.change("leader", "model", "__default__");
  const oldSave = h.posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1)!;
  h.state.configStateByCli.codex.revision = "r2";
  h.sync();
  h.context.applyDepartmentRolePreferenceSaved({ ...oldSave, ok: true });
  assert.equal(h.controls["department-leader-model"].value, "__missing__");
  assert.match(h.controls.departmentRoleMessage.textContent, /正在加载/);
  assert.equal(h.controls["department-leader-model"].disabled, true, "old save cannot complete while new binding candidates reload");
});

test("new roots require loaded saved choices; failure preserves draft, retry success unlocks, old modes and supplements pass", () => {
  const h = createDepartmentUiHarness();
  const pref = { cli: "codex", configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
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
  h.state.activeConfigIdByCli.opencode = "open-active";
  h.change("leader", "cli", "opencode"); h.candidates("leader"); assert.match(issue(), /尚未保存|完成/);
});
