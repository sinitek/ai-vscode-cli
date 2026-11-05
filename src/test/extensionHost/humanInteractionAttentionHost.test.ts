import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import vm = require("node:vm");
import ts = require("typescript");
import { createHumanInteractionAttentionController, withHumanInteractionAttention } from "../../humanInteractionAttention";
import { buildTimedOutHumanInteractionSubmission, type HumanInteractionRequest } from "../../humanInteraction";
import type { DesktopNotificationAuthorization } from "../../desktopNotificationAuthorization";

const hostSource = fs.readFileSync(path.join(process.cwd(), "src/extensionHost/humanInteractionAttentionHost.ts"), "utf8");
const hostScript = ts.transpileModule(hostSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function hostHarness(options: { remote?: boolean; ui?: boolean; platform?: NodeJS.Platform; notifications?: boolean; status?: DesktopNotificationAuthorization["status"]; failAuthorization?: boolean; requestDenied?: boolean; openSettings?: boolean } = {}) {
  const events: string[] = [];
  const state = { focused: false };
  const settings: Record<string, boolean> = { humanInteractionNotifications: options.notifications ?? true, taskCompletionNotifications: options.notifications ?? true, humanInteractionWindowAttention: true };
  const authorizationCalls: boolean[] = [];
  const opened: string[] = [];
  const errors: unknown[] = [];
  const authorizationState = { status: options.status ?? "authorized" };
  const subscriptions: Array<{ dispose: () => void }> = [];
  let windowChanged = (): void => undefined;
  let configurationChanged = (_key: string): void => undefined;
  let transportOptions: { mainProcessId?: number; appUserModelId?: string } = {};
  const sandbox = {
    exports: {} as typeof import("../../extensionHost/humanInteractionAttentionHost"),
    process: { platform: options.platform ?? "darwin", env: { VSCODE_PID: "321" } },
    require(name: string): unknown {
      if (name === "vscode") {
        return {
          env: { appName: "Visual Studio Code", appRoot: "/editor/resources/app", remoteName: options.remote ? "ssh-remote" : undefined,
            openExternal: async (uri: string) => { opened.push(uri); return options.openSettings ?? true; } },
          Uri: { parse: (value: string) => value },
          ExtensionKind: { UI: 1 },
          window: {
            state,
            onDidChangeWindowState: (listener: () => void) => {
              windowChanged = listener;
              return { dispose: () => undefined };
            },
          },
          workspace: {
            getConfiguration: () => ({ get: (key: string, fallback: boolean) => settings[key] ?? fallback }),
            onDidChangeConfiguration: (listener: (event: { affectsConfiguration: (key: string) => boolean }) => void) => {
              configurationChanged = (key) => listener({ affectsConfiguration: (candidate) => candidate === key });
              return { dispose: () => undefined };
            },
          },
          Disposable: class {
            constructor(public dispose: () => void) {}
          },
        };
      }
      if (name === "../desktopAttention") {
        return { createDesktopAttentionTransport: (input: typeof transportOptions) => {
          transportOptions = input;
          return {
            notificationAuthorization: async (request: boolean) => {
              authorizationCalls.push(request);
              if (options.failAuthorization) throw new Error("授权读取失败");
              if (request && authorizationState.status === "not-determined") authorizationState.status = options.requestDenied ? "denied" : "authorized";
              return { platform: options.platform ?? "darwin", status: options.platform && options.platform !== "darwin" ? "not-required" : authorizationState.status };
            },
            notify: async () => { events.push("notify"); },
            startAttention: async () => { events.push("start"); },
            stopAttention: async () => { events.push("stop"); },
          };
        } };
      }
      if (name === "../humanInteractionAttention") {
        return { createHumanInteractionAttentionController };
      }
      if (name === "../cli/config") {
        return { CONFIG_NAMESPACE: "sinitek-cli-tools" };
      }
      if (name === "fs") {
        return { readFileSync: () => JSON.stringify({ win32AppUserModelId: "Microsoft.VisualStudioCodeInsiders" }) };
      }
      if (name === "path") {
        return path;
      }
      throw new Error(`未预期的模块：${name}`);
    },
  };
  vm.runInNewContext(hostScript, sandbox);
  const controller = sandbox.exports.createHumanInteractionAttentionHost({
    subscriptions,
    globalStorageUri: { fsPath: "/test-extension-storage" },
    extension: { extensionKind: options.ui ? 1 : 2 },
  } as never, (_channel, error) => { errors.push(error); });
  return { controller, state, settings, events, subscriptions, windowChanged, configurationChanged, transportOptions, authorizationCalls, authorizationState, opened, errors };
}

test("local Mac startup requests authorization only when a notification setting is enabled", async () => {
  const local = hostHarness({ status: "not-determined" });
  assert.deepEqual(local.authorizationCalls, [true]);
  assert.equal(local.authorizationState.status, "authorized");
  const disabled = hostHarness({ notifications: false });
  assert.deepEqual(disabled.authorizationCalls, []);
  disabled.settings.taskCompletionNotifications = true;
  disabled.configurationChanged("sinitek-cli-tools.taskCompletionNotifications");
  assert.deepEqual(disabled.authorizationCalls, [true]);
  for (const platform of ["win32", "linux"] as const) {
    assert.deepEqual(hostHarness({ platform }).authorizationCalls, []);
  }
  const remote = hostHarness({ remote: true });
  assert.equal((await remote.controller.notificationAuthorization(true)).status, "unavailable");
  assert.deepEqual(remote.authorizationCalls, []);
  assert.deepEqual(remote.opened, []);
  assert.deepEqual(hostHarness({ remote: true, ui: true }).authorizationCalls, [true]);
});

test("manual Mac authorization queries without prompting and denied permissions open settings only on request", async () => {
  const env = hostHarness({ notifications: false, status: "denied" });
  assert.equal((await env.controller.notificationAuthorization()).status, "denied");
  assert.deepEqual(env.authorizationCalls, [false]);
  assert.deepEqual(env.opened, []);
  const response = await env.controller.notificationAuthorization(true);
  assert.match(response.detail!, /已打开/);
  assert.deepEqual(env.authorizationCalls, [false, false]);
  assert.equal(env.opened[0], "x-apple.systempreferences:com.apple.Notifications-Settings.extension");
  env.authorizationState.status = "authorized";
  assert.equal((await env.controller.notificationAuthorization()).status, "authorized");
  await env.controller.notificationAuthorization(true);
  assert.equal(env.opened.length, 2);
});

test("rejecting the first manual request does not immediately reopen settings or request again", async () => {
  const env = hostHarness({ notifications: false, status: "not-determined", requestDenied: true });
  assert.equal((await env.controller.notificationAuthorization(true)).status, "denied");
  assert.deepEqual(env.authorizationCalls, [false, true]);
  assert.deepEqual(env.opened, []);
  assert.equal((await env.controller.notificationAuthorization()).status, "denied");
  assert.deepEqual(env.authorizationCalls, [false, true, false]);
});

test("authorization failures remain nonblocking and failed settings navigation explains manual recovery", async () => {
  const failed = hostHarness({ failAuthorization: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(failed.errors.length, 1);
  assert.equal((await failed.controller.notificationAuthorization()).status, "unavailable");
  await failed.controller.request("ask");
  assert.ok(failed.events.includes("notify"));
  const denied = hostHarness({ notifications: false, status: "denied", openSettings: false });
  assert.match((await denied.controller.notificationAuthorization(true)).detail!, /手动前往/);
});

test("host routes focus and preference changes through the controller and disposes cleanly", async () => {
  const env = hostHarness();
  assert.equal(env.subscriptions.length, 3);
  await env.controller.request("ask");
  env.state.focused = true;
  env.windowChanged();
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
  env.state.focused = false;
  env.settings.humanInteractionWindowAttention = false;
  env.configurationChanged("sinitek-cli-tools.humanInteractionWindowAttention");
  await env.controller.refresh();
  assert.equal(env.events.length, 3);
  env.settings.humanInteractionWindowAttention = true;
  env.configurationChanged("sinitek-cli-tools.humanInteractionWindowAttention");
  await env.controller.refresh();
  for (const subscription of env.subscriptions) {
    subscription.dispose();
  }
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop", "start", "stop"]);
});

test("remote workspace hosts stay silent while a local UI host can notify a remote workspace", async () => {
  const remote = hostHarness({ remote: true });
  await remote.controller.request("ask");
  assert.deepEqual(remote.events, []);
  const local = hostHarness({ remote: true, ui: true });
  await local.controller.request("ask");
  assert.deepEqual(local.events, ["notify", "start"]);
  await local.controller.dispose();
});

test("Windows host reads the installed editor identity instead of hard-coding stable VS Code", async () => {
  const env = hostHarness({ platform: "win32" });
  assert.equal(env.transportOptions.appUserModelId, "Microsoft.VisualStudioCodeInsiders");
  assert.equal(env.transportOptions.mainProcessId, 321);
  await env.controller.dispose();
});

test("Windows host notifies in the foreground and only flashes pending interactions in the background", async () => {
  const env = hostHarness({ platform: "win32" });
  env.state.focused = true;
  await env.controller.taskCompleted("run");
  await env.controller.request("ask");
  assert.deepEqual(env.events, ["notify", "notify"]);
  env.state.focused = false;
  env.windowChanged();
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "notify", "start"]);
  await env.controller.complete("ask");
  await env.controller.taskCompleted("run");
  assert.deepEqual(env.events, ["notify", "notify", "start", "stop"]);
  await env.controller.dispose();
});

test("host routes independent task completion preferences and clears the attention latch on focus", async () => {
  const env = hostHarness();
  env.settings.taskCompletionNotifications = false;
  await env.controller.taskCompleted("run");
  assert.deepEqual(env.events, ["start"]);
  env.settings.taskCompletionNotifications = true;
  env.settings.taskCompletionWindowAttention = false;
  env.configurationChanged("sinitek-cli-tools.taskCompletionNotifications");
  await env.controller.refresh();
  assert.deepEqual(env.events, ["start", "notify", "stop"]);
  env.settings.taskCompletionWindowAttention = true;
  env.configurationChanged("sinitek-cli-tools.taskCompletionWindowAttention");
  await env.controller.refresh();
  assert.deepEqual(env.events, ["start", "notify", "stop", "start"]);
  env.state.focused = true;
  env.windowChanged();
  await env.controller.refresh();
  env.state.focused = false;
  env.windowChanged();
  await env.controller.refresh();
  assert.deepEqual(env.events, ["start", "notify", "stop", "start", "stop"]);
  await env.controller.dispose();
});

const extensionSource = fs.readFileSync(path.join(process.cwd(), "src/extension.ts"), "utf8");
const extensionSyntax = ts.createSourceFile("extension.ts", extensionSource, ts.ScriptTarget.ES2020, true);
const interactionFunctionNames = [
  "rememberPendingHumanInteraction", "forgetPendingHumanInteraction", "requestHumanInteraction",
  "resolveHumanInteractionResponse", "cancelHumanInteractionForTab", "waitForOrchestratorClarificationWithAttention",
];
const interactionScript = ts.transpileModule(extensionSyntax.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement) && interactionFunctionNames.includes(statement.name?.text ?? ""),
).map((statement) => statement.getText(extensionSyntax)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function interactionHarness() {
  const events: string[] = [];
  const controller = createHumanInteractionAttentionController({
    isFocused: () => false,
    isLocal: () => true,
    readSettings: () => ({ notifications: true, windowAttention: true }),
    transport: {
      notify: async () => { events.push("notify"); },
      startAttention: async () => { events.push("start"); },
      stopAttention: async () => { events.push("stop"); },
    },
    onError: () => undefined,
  });
  let timeout = (): void => undefined;
  const sandbox = {
    humanInteractionAttention: controller,
    withHumanInteractionAttention,
    pendingHumanInteractionsById: new Map(),
    pendingHumanInteractionIdsByTabId: new Map(),
    viewProvider: { postMessage: () => undefined },
    logInfo: async () => undefined,
    recordHumanInteractionResponse: () => undefined,
    readHumanInteractionTimeoutMs: () => 60000,
    createHumanInteractionRejectedError: () => new Error("交互已取消"),
    buildTimedOutHumanInteractionSubmission,
    createInteractionTimeout: (_milliseconds: number, callback: () => void) => {
      timeout = callback;
      return { clear: () => undefined };
    },
    waitForOrchestratorClarification: async () => ({ status: "completed" }),
  };
  const host = vm.runInNewContext(`${interactionScript}\n({ requestHumanInteraction, resolveHumanInteractionResponse, cancelHumanInteractionForTab, waitForOrchestratorClarificationWithAttention });`, sandbox) as {
    requestHumanInteraction: (request: HumanInteractionRequest) => Promise<{ status: string; timedOut?: boolean }>;
    resolveHumanInteractionResponse: (submission: { interactionId: string; tabId: string; status: string; values: object }) => void;
    cancelHumanInteractionForTab: (tabId: string) => void;
    waitForOrchestratorClarificationWithAttention: (scopeId: string, request: { interactionId: string }) => Promise<{ status: string }>;
  };
  return { controller, events, host, expire: () => timeout() };
}

const request: HumanInteractionRequest = {
  interactionId: "ask", tabId: "tab", title: "需要确认", instruction: "",
  formFields: [], submitLabel: "提交", cancelLabel: "拒绝",
};

test("real normal-interaction entry and response functions start and clear reminders", async () => {
  const env = interactionHarness();
  const response = env.host.requestHumanInteraction(request);
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start"]);
  env.host.resolveHumanInteractionResponse({ interactionId: "ask", tabId: "tab", status: "completed", values: {} });
  assert.equal((await response).status, "completed");
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
});

test("real cancellation and timeout paths both remove pending attention", async () => {
  for (const action of ["cancel", "timeout"]) {
    const env = interactionHarness();
    const response = env.host.requestHumanInteraction(request);
    const result = response.catch(() => ({ status: "aborted", timedOut: false }));
    await env.controller.refresh();
    if (action === "cancel") {
      env.host.cancelHumanInteractionForTab("tab");
    } else {
      env.expire();
    }
    const submission = await result;
    assert.equal(submission.status, action === "cancel" ? "aborted" : "completed");
    assert.equal(submission.timedOut, action === "timeout");
    await env.controller.refresh();
    assert.deepEqual(env.events, ["notify", "start", "stop"]);
  }
});

test("main-task clarification adapter uses the same reminder lifecycle", async () => {
  const env = interactionHarness();
  assert.equal((await env.host.waitForOrchestratorClarificationWithAttention("loop:task", { interactionId: "ask" })).status, "completed");
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
  assert.match(extensionSource, /waitForClarification: waitForOrchestratorClarificationWithAttention/);
});

test("reminder settings remain application scoped with Chinese descriptions and enabled defaults", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  for (const name of ["humanInteractionNotifications", "humanInteractionWindowAttention"]) {
    const setting = manifest.contributes.configuration.properties[`sinitek-cli-tools.${name}`];
    assert.equal(setting.default, true);
    assert.equal(setting.scope, "application");
    assert.match(setting.description, /[\u4e00-\u9fff]/);
  }
});
