import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { OVERLAYS_MODALS_STYLES } from "../../webview/viewContentStyles/overlaysModals";

function harness() {
  const element = () => ({
    hidden: false, disabled: false, textContent: "", tabIndex: 0,
    attributes: {} as Record<string, string>,
    classList: { toggle: (_name: string, _active: boolean) => undefined },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
  });
  const elements = {
    helpTabModes: element(), helpPanelModes: element(), helpTabNotifications: element(), helpPanelNotifications: element(),
    helpNotificationMac: element(), notificationAuthorizationStatus: element(), authorizeNotifications: element(), refreshNotificationAuthorization: element(),
  };
  const messages: Array<{ type: string; action: string; requestId: number }> = [];
  let timeout: (() => void) | undefined;
  const context = vm.createContext({
    elements, i18n: getWebviewStrings(), vscode: { postMessage: (message: typeof messages[number]) => messages.push(message) },
    setTimeout: (callback: () => void) => { timeout = callback; return 1; }, clearTimeout: () => { timeout = undefined; },
  });
  const start = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("let notificationAuthorizationRequestId");
  const end = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("function openHelp()", start);
  vm.runInContext(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.slice(start, end), context);
  const api = vm.runInContext("({requestNotificationAuthorization, applyNotificationAuthorization, setHelpTab})", context) as {
    requestNotificationAuthorization: (request: boolean) => void;
    applyNotificationAuthorization: (data: { requestId: number; payload: Record<string, unknown> }) => void;
    setHelpTab: (notifications: boolean) => void;
  };
  return { elements, messages, api, timeout: () => timeout?.() };
}

test("help tabs retain mode default and query permission only on notification tab", () => {
  const env = harness();
  env.api.setHelpTab(false);
  assert.equal(env.elements.helpPanelNotifications.hidden, true);
  assert.equal(env.messages.length, 0);
  env.api.setHelpTab(true);
  assert.equal(env.elements.helpPanelModes.hidden, true);
  assert.equal(env.elements.helpTabNotifications.attributes["aria-selected"], "true");
  assert.equal(env.elements.helpTabModes.tabIndex, -1);
  assert.equal(env.messages[0].action, "status");
  assert.equal(env.elements.authorizeNotifications.disabled, true);
  env.api.requestNotificationAuthorization(true);
  assert.equal(env.messages.length, 1);
});

test("Mac permission statuses provide correct action and other platforms hide Mac controls", () => {
  const env = harness();
  for (const status of ["not-determined", "authorized", "denied", "disabled", "unavailable"]) {
    env.api.requestNotificationAuthorization(false);
    env.api.applyNotificationAuthorization({ requestId: env.messages.at(-1)!.requestId, payload: { platform: "darwin", status } });
    assert.equal(env.elements.helpNotificationMac.hidden, false);
    assert.equal(env.elements.authorizeNotifications.hidden, false);
    assert.equal(env.elements.authorizeNotifications.disabled, status === "unavailable");
    assert.equal(env.elements.authorizeNotifications.textContent, ["authorized", "denied", "disabled"].includes(status) ? "打开系统通知设置" : "授权通知");
    assert.equal(env.elements.refreshNotificationAuthorization.disabled, false);
  }
  env.api.requestNotificationAuthorization(false);
  env.api.applyNotificationAuthorization({ requestId: env.messages.at(-1)!.requestId, payload: { platform: "win32", status: "not-required" } });
  assert.equal(env.elements.helpNotificationMac.hidden, true);
  assert.equal(env.elements.authorizeNotifications.hidden, true);
  assert.match(OVERLAYS_MODALS_STYLES, /#authorizeNotifications\[hidden\]\s*\{\s*display:\s*none;/);
  assert.equal(env.elements.authorizeNotifications.disabled, true);
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
