import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { OVERLAYS_MODALS_STYLES } from "../../webview/viewContentStyles/overlaysModals";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";

function harness() {
  const element = () => ({
    hidden: false, disabled: false, checked: true, textContent: "", tabIndex: 0, focused: false,
    attributes: {} as Record<string, string>,
    listeners: {} as Record<string, (event: any) => void>,
    classList: { toggle: (_name: string, _active: boolean) => undefined },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    addEventListener(name: string, listener: (event: any) => void) { this.listeners[name] = listener; },
    focus() { this.focused = true; },
  });
  const elements = {
    toolSettingsGeneralTab: element(), toolSettingsGeneralPanel: element(),
    toolSettingsAiTaskTab: element(), toolSettingsAiTaskPanel: element(),
    toolSettingsWorkspaceTab: element(), toolSettingsWorkspacePanel: element(),
    toolSettingsNotificationsTab: element(), toolSettingsNotificationsPanel: element(),
    toolSettingsRepairTab: element(), toolSettingsRepairPanel: element(),
    taskCompletionNotifications: element(), humanInteractionNotifications: element(),
    taskCompletionWindowAttention: element(), humanInteractionWindowAttention: element(),
    helpNotificationWindows: element(), helpNotificationLinux: element(),
    helpNotificationMac: element(), notificationAuthorizationStatus: element(), authorizeNotifications: element(), refreshNotificationAuthorization: element(),
  };
  const messages: Array<{ type: string; action?: string; requestId: number; key?: string; value?: boolean }> = [];
  const state: Record<string, boolean> = {
    taskCompletionNotifications: true, humanInteractionNotifications: true,
    taskCompletionWindowAttention: true, humanInteractionWindowAttention: true,
  };
  let timeout: (() => void) | undefined;
  const context = vm.createContext({
    elements, state, i18n: getWebviewStrings(), vscode: { postMessage: (message: typeof messages[number]) => messages.push(message) },
    requestCliRepairs: () => undefined,
    setTimeout: (callback: () => void) => { timeout = callback; return 1; }, clearTimeout: () => { timeout = undefined; },
  });
  const start = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("let notificationAuthorizationRequestId");
  const end = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("function openHelp()", start);
  vm.runInContext(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.slice(start, end), context);
  vm.runInContext(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.slice(0, VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("function requestCliRepairs")), context);
  const bindings = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("const toolSettingsTabs");
  vm.runInContext(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.slice(bindings, VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("if (elements.autoCompactContextAfterRun)", bindings)), context);
  const api = vm.runInContext("({requestNotificationAuthorization, applyNotificationAuthorization, setToolSettingsTab})", context) as {
    requestNotificationAuthorization: (request: boolean) => void;
    applyNotificationAuthorization: (data: { requestId: number; payload: Record<string, unknown> }) => void;
    setToolSettingsTab: (scope: string) => void;
  };
  return { elements, state, messages, api, context, timeout: () => timeout?.() };
}

test("工具设置默认常规配置，仅通知设置页签查询权限", () => {
  const env = harness();
  assert.equal(env.elements.toolSettingsNotificationsPanel.hidden, true);
  assert.equal(env.messages.length, 0);
  env.api.setToolSettingsTab("notifications");
  assert.equal(env.elements.toolSettingsGeneralPanel.hidden, true);
  assert.equal(env.elements.toolSettingsNotificationsTab.attributes["aria-selected"], "true");
  assert.equal(env.elements.toolSettingsGeneralTab.tabIndex, -1);
  assert.equal(env.messages[0].action, "status");
  assert.equal(env.elements.authorizeNotifications.disabled, true);
  env.api.requestNotificationAuthorization(true);
  assert.equal(env.messages.length, 1);
});

test("工具设置支持鼠标、方向键及 Home/End 切换五个页签", () => {
  const env = harness();
  let prevented = 0;
  const press = (key: string) => ({ key, preventDefault: () => { prevented += 1; } });
  env.elements.toolSettingsWorkspaceTab.listeners.click({});
  assert.equal(env.elements.toolSettingsWorkspacePanel.hidden, false);
  env.elements.toolSettingsWorkspaceTab.listeners.keydown(press("ArrowRight"));
  assert.equal(env.elements.toolSettingsNotificationsTab.focused, true);
  assert.equal(env.elements.toolSettingsNotificationsPanel.hidden, false);
  env.elements.toolSettingsNotificationsTab.listeners.keydown(press("End"));
  assert.equal(env.elements.toolSettingsRepairPanel.hidden, false);
  env.elements.toolSettingsRepairTab.listeners.keydown(press("Home"));
  assert.equal(env.elements.toolSettingsGeneralPanel.hidden, false);
  env.elements.toolSettingsGeneralTab.listeners.keydown(press("ArrowLeft"));
  assert.equal(env.elements.toolSettingsRepairPanel.hidden, false);
  env.elements.toolSettingsGeneralTab.listeners.keydown(press("Tab"));
  assert.equal(prevented, 4);
  env.api.setToolSettingsTab("unknown");
  assert.equal(env.elements.toolSettingsGeneralPanel.hidden, false);
});

test("通知和图标闪烁四项开关默认开启且独立更新", () => {
  const keys = ["taskCompletionNotifications", "humanInteractionNotifications", "taskCompletionWindowAttention", "humanInteractionWindowAttention"] as const;
  for (const key of keys) {
    const env = harness();
    for (const setting of keys) assert.equal(env.state[setting], true);
    env.elements[key].listeners.change({ target: { checked: false } });
    for (const setting of keys) assert.equal(env.state[setting], setting !== key);
    env.elements[key].listeners.change({ target: { checked: true } });
    assert.equal(env.state[key], true);
    assert.deepEqual(env.messages.map(({ type, key, value }) => ({ type, key, value })), [
      { type: "updateSetting", key, value: false },
      { type: "updateSetting", key, value: true },
    ]);
  }
});

test("两个通知开关只发送各自配置更新", () => {
  const env = harness();
  assert.equal(env.state.taskCompletionNotifications, true);
  assert.equal(env.state.humanInteractionNotifications, true);
  env.elements.taskCompletionNotifications.listeners.change({ target: { checked: false } });
  assert.equal(env.state.taskCompletionNotifications, false);
  assert.equal(env.state.humanInteractionNotifications, true);
  env.elements.humanInteractionNotifications.listeners.change({ target: { checked: false } });
  env.elements.taskCompletionNotifications.listeners.change({ target: { checked: true } });
  assert.equal(env.state.taskCompletionNotifications, true);
  assert.equal(env.state.humanInteractionNotifications, false);
  assert.deepEqual(env.messages.map(({ type, key, value }) => ({ type, key, value })), [
    { type: "updateSetting", key: "taskCompletionNotifications", value: false },
    { type: "updateSetting", key: "humanInteractionNotifications", value: false },
    { type: "updateSetting", key: "taskCompletionNotifications", value: true },
  ]);
});

test("通知开关回显真实配置，缺省开启并可恢复保存失败后的状态", () => {
  const env = harness();
  const source = VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE;
  const start = source.indexOf("state.humanInteractionNotifications =");
  const end = source.indexOf("state.cliEnabledByName =", start);
  const render = source.indexOf('["humanInteractionNotifications", "taskCompletionNotifications", "humanInteractionWindowAttention", "taskCompletionWindowAttention"].forEach');
  const renderEnd = source.indexOf("});", render) + 3;
  const keys = ["taskCompletionNotifications", "humanInteractionNotifications", "taskCompletionWindowAttention", "humanInteractionWindowAttention"] as const;
  const configurations: Partial<Record<typeof keys[number], boolean>>[] = [
    {}, ...keys.map((key) => ({ [key]: false })), Object.fromEntries(keys.map((key) => [key, false])), {},
  ];
  for (const panelState of configurations) {
    env.context.panelState = panelState;
    vm.runInContext(source.slice(start, end) + source.slice(render, renderEnd), env.context);
    for (const key of keys) assert.equal(env.elements[key].checked, panelState[key] !== false);
  }
});

test("Mac permission statuses provide correct actions and Linux hides authorization controls", () => {
  const env = harness();
  for (const status of ["not-determined", "authorized", "denied", "disabled", "unavailable"]) {
    env.api.requestNotificationAuthorization(false);
    env.api.applyNotificationAuthorization({ requestId: env.messages.at(-1)!.requestId, payload: { platform: "darwin", status } });
    assert.equal(env.elements.helpNotificationMac.hidden, false);
    assert.equal(env.elements.helpNotificationWindows.hidden, true);
    assert.equal(env.elements.helpNotificationLinux.hidden, true);
    assert.equal(env.elements.authorizeNotifications.hidden, false);
    assert.equal(env.elements.authorizeNotifications.disabled, status === "unavailable");
    assert.equal(env.elements.authorizeNotifications.textContent, ["authorized", "denied", "disabled"].includes(status) ? "打开系统通知设置" : "授权通知");
    assert.equal(env.elements.refreshNotificationAuthorization.disabled, false);
  }
  env.api.requestNotificationAuthorization(false);
  env.api.applyNotificationAuthorization({ requestId: env.messages.at(-1)!.requestId, payload: { platform: "linux", status: "not-required" } });
  assert.equal(env.elements.helpNotificationMac.hidden, true);
  assert.equal(env.elements.helpNotificationWindows.hidden, true);
  assert.equal(env.elements.helpNotificationLinux.hidden, false);
  assert.equal(env.elements.authorizeNotifications.hidden, true);
  assert.match(OVERLAYS_MODALS_STYLES, /#authorizeNotifications\[hidden\]\s*\{\s*display:\s*none;/);
  assert.equal(env.elements.authorizeNotifications.disabled, true);
});

test("Windows offers system notification settings for enabled, disabled and unavailable states", () => {
  const env = harness();
  for (const status of ["authorized", "denied", "disabled", "unavailable"]) {
    env.api.requestNotificationAuthorization(false);
    env.api.applyNotificationAuthorization({ requestId: env.messages.at(-1)!.requestId, payload: { platform: "win32", status, detail: `Windows: ${status}` } });
    assert.equal(env.elements.helpNotificationMac.hidden, true);
    assert.equal(env.elements.helpNotificationWindows.hidden, false);
    assert.equal(env.elements.helpNotificationLinux.hidden, true);
    assert.equal(env.elements.authorizeNotifications.hidden, false);
    assert.equal(env.elements.authorizeNotifications.disabled, false);
    assert.equal(env.elements.authorizeNotifications.textContent, "打开系统通知设置");
    assert.equal(env.elements.notificationAuthorizationStatus.textContent, `Windows: ${status}`);
  }
  env.api.requestNotificationAuthorization(true);
  assert.equal(env.messages.at(-1)!.action, "request");
  env.timeout();
  assert.equal(env.elements.authorizeNotifications.hidden, false);
  assert.equal(env.elements.authorizeNotifications.disabled, false);
  assert.equal(env.elements.authorizeNotifications.textContent, "打开系统通知设置");
  assert.match(env.elements.notificationAuthorizationStatus.textContent, /超时/);
});

test("permission actions correlate responses, render details as text and recover after timeout", () => {
  const env = harness();
  env.api.requestNotificationAuthorization(true);
  assert.equal(env.messages[0].action, "request");
  env.api.applyNotificationAuthorization({ requestId: 0, payload: { detail: "stale" } });
  assert.notEqual(env.elements.notificationAuthorizationStatus.textContent, "stale");
  env.timeout();
  assert.match(env.elements.notificationAuthorizationStatus.textContent, /超时/);
  assert.equal(env.elements.refreshNotificationAuthorization.disabled, false);
  env.api.requestNotificationAuthorization(false);
  env.api.applyNotificationAuthorization({ requestId: 1, payload: { detail: "late" } });
  assert.notEqual(env.elements.notificationAuthorizationStatus.textContent, "late");
  env.api.applyNotificationAuthorization({ requestId: 2, payload: { platform: "darwin", status: "denied", detail: "<b>只显示文字</b>" } });
  assert.equal(env.elements.notificationAuthorizationStatus.textContent, "<b>只显示文字</b>");
});
