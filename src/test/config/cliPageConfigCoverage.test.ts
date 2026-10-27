import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import { setTimeout as delay } from "node:timers/promises";
import * as vm from "node:vm";

import { installVscodeMock } from "../vscodeMock";
import { parseGrokConfigModels, type GrokConfigModels } from "../../cli/grokConfigModels";
import type {
  ConfigCloseMessage,
  ConfigOpenExternalMessage,
  ConfigOpenPathMessage,
  ConfigRequestMessage,
} from "../../webview/configProtocol";

installVscodeMock();

const repoRoot = process.cwd();

type AnyRecord = Record<string, any>;
type MessageHandler = (message: unknown) => void;

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function findAsset(extension: string): string {
  const assetsDir = path.join(repoRoot, "media", "config", "assets");
  const match = fs
    .readdirSync(assetsDir)
    .find((file) => file.startsWith("index-") && file.endsWith(extension));
  assert.ok(match, `missing config asset ${extension}`);
  return match;
}

function createConfigWebview() {
  const uris: string[] = [];
  return {
    uris,
    webview: {
      cspSource: "vscode-resource://sinitek-test",
      asWebviewUri(uri: { fsPath: string }) {
        const normalized = uri.fsPath.split(path.sep).join("/");
        const value = `webview-test://${normalized}`;
        uris.push(value);
        return { toString: () => value };
      },
    },
  };
}

function renderConfigHtml(): { html: string; uris: string[] } {
  const { getConfigViewHtml } = require("../../webview/configView") as typeof import("../../webview/configView");
  const harness = createConfigWebview();
  const html = getConfigViewHtml(
    harness.webview as any,
    { fsPath: repoRoot } as any,
  );
  return { html, uris: harness.uris };
}

function extractConfigActions(): string[] {
  const { CONFIG_ACTIONS } = require("../../webview/configProtocol") as typeof import("../../webview/configProtocol");
  return [...CONFIG_ACTIONS];
}

function loadStoreUtilities(): { utils: AnyRecord; storage: Map<string, string> } {
  const source = readProjectFile("media/config/assets/config-app-store.js");
  const utilitySource = extractBetween(source, "const CONFIG_STORAGE_KEYS =", "// Config store").replace(/,\s*$/, ";");
  const storage = new Map<string, string>();
  const sandbox: AnyRecord = {
    console: { error: () => undefined },
    localStorage: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key) ?? null : null),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
    },
  };
  vm.runInNewContext(
    `${utilitySource}
globalThis.__store = {
  CONFIG_STORAGE_KEYS,
  storeJson,
  readJson,
  createCopyName,
  createEmptyOrder,
  loadStoredOrder,
  mergeOrderWithConfigs,
  appendOrderForConfigs,
};`,
    sandbox,
  );
  return { utils: sandbox.__store, storage };
}

function loadApiUtilities(windowValue: AnyRecord, fetchImpl: (url: string, init?: AnyRecord) => Promise<AnyRecord>) {
  const source = readProjectFile("media/config/assets/config-app-api.js");
  const sandbox: AnyRecord = {
    console: { error: () => undefined },
    fetch: fetchImpl,
    window: windowValue,
  };
  vm.runInNewContext(
    `${source}
globalThis.__api = {
  detectConfigApiMode,
  configApiMode,
  configApi,
  httpConfigApi,
  requestConfigApi,
  fetchConfigList,
  fetchCliSkillsList,
};`,
    sandbox,
  );
  return sandbox.__api as AnyRecord;
}

function loadVisualEditorUtils(startMarker: string, endMarker: string, globalName: string): AnyRecord {
  const source = readProjectFile("media/config/assets/config-app-ui.js");
  const visualSource = extractBetween(source, startMarker, endMarker);
  const sandbox: AnyRecord = {};
  vm.runInNewContext(
    `${visualSource}
globalThis.__utils = ${globalName};`,
    sandbox,
  );
  return sandbox.__utils as AnyRecord;
}

function loadConfigVscodeTheme(themeVariables: Record<string, string>): AnyRecord {
  const source = readProjectFile("media/config/assets/config-app-ui.js");
  const themeSource = extractBetween(source, "const readConfigVscodeColor =", "// App root");
  const sandbox: AnyRecord = {
    document: { documentElement: {} },
    window: {
      getComputedStyle: () => ({
        getPropertyValue: (name: string) => themeVariables[name] || "",
      }),
    },
    ZB: {
      algorithm: "existing-algorithm",
      token: { padding: 16, colorPrimary: "legacy-primary" },
      components: {
        Button: { fontWeight: 500, defaultBg: "legacy-button-background" },
        List: { itemPaddingLG: "12px 16px" },
      },
    },
  };
  vm.runInNewContext(
    `${themeSource}
globalThis.__theme = createConfigVscodeTheme();`,
    sandbox,
  );
  return sandbox.__theme as AnyRecord;
}

type PanelHarness = {
  createCalls: unknown[][];
  commandCalls: unknown[][];
  externalUrls: string[];
  messageHandler?: MessageHandler;
  disposeHandler?: () => void;
  maximizeCommandError?: Error;
  disposeCount: number;
  panel: {
    title: string;
    webview: {
      html: string;
      cspSource: string;
      postedMessages: unknown[];
      asWebviewUri: (uri: { fsPath: string }) => { toString: () => string };
      onDidReceiveMessage: (handler: MessageHandler) => { dispose: () => void };
      postMessage: (message: unknown) => Promise<boolean>;
    };
    reveal: (column: unknown, preserveFocus?: boolean) => void;
    onDidDispose: (handler: () => void) => { dispose: () => void };
    dispose: () => void;
  };
  revealCount: number;
};

function installConfigPanelHarness(): PanelHarness {
  const vscode = require("vscode") as AnyRecord;
  const harness: PanelHarness = {
    createCalls: [],
    commandCalls: [],
    externalUrls: [],
    disposeCount: 0,
    revealCount: 0,
    panel: {
      title: "",
      webview: {
        html: "",
        cspSource: "vscode-resource://sinitek-panel-test",
        postedMessages: [],
        asWebviewUri(uri: { fsPath: string }) {
          const normalized = uri.fsPath.split(path.sep).join("/");
          return { toString: () => `webview-panel-test://${normalized}` };
        },
        onDidReceiveMessage(handler: MessageHandler) {
          harness.messageHandler = handler;
          return { dispose: () => undefined };
        },
        async postMessage(message: unknown) {
          harness.panel.webview.postedMessages.push(message);
          return true;
        },
      },
      reveal(column: unknown, preserveFocus?: boolean) {
        harness.revealCount += 1;
        harness.commandCalls.push(["reveal", column, preserveFocus]);
      },
      onDidDispose(handler: () => void) {
        harness.disposeHandler = handler;
        return { dispose: () => undefined };
      },
      dispose() {
        harness.disposeCount += 1;
        harness.disposeHandler?.();
      },
    },
  };

  vscode.window.createWebviewPanel = (...args: unknown[]) => {
    harness.createCalls.push(args);
    return harness.panel;
  };
  vscode.commands.executeCommand = async (...args: unknown[]) => {
    harness.commandCalls.push(args);
    if (args[0] === "workbench.action.maximizeEditorHideSidebar" && harness.maximizeCommandError) {
      throw harness.maximizeCommandError;
    }
    return undefined;
  };
  vscode.env.openExternal = async (uri: { toString?: () => string }) => {
    harness.externalUrls.push(uri.toString ? uri.toString() : String(uri));
    return true;
  };
  vscode.workspace.workspaceFolders = [
    { uri: { fsPath: "/workspace/project-a" } },
    { uri: { fsPath: "   " } },
  ];

  return harness;
}

async function dispatchPanelMessage(harness: PanelHarness, message: unknown): Promise<AnyRecord> {
  assert.ok(harness.messageHandler, "webview message handler should be registered");
  harness.messageHandler(message);
  await delay(0);
  await delay(0);
  const messages = harness.panel.webview.postedMessages;
  return messages[messages.length - 1] as AnyRecord;
}

function requireFresh<T>(modulePath: string): T {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath) as T;
}

test("config view HTML wires assets, CSP, bridge globals, and startup sequencing", () => {
  const cssAsset = findAsset(".css");
  const jsAsset = findAsset(".js");
  const { html, uris } = renderConfigHtml();
  const nonceMatch = html.match(/script-src 'nonce-([A-Za-z0-9]{32})'/);
  assert.ok(nonceMatch, "CSP should include a 32 character script nonce");
  const nonce = nonceMatch[1];

  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src vscode-resource:\/\/sinitek-test https: data:/);
  assert.match(html, /worker-src vscode-resource:\/\/sinitek-test blob:/);
  assert.match(html, new RegExp(`<link rel="stylesheet" href="webview-test://.*/${escapeRegExp(cssAsset)}" />`));
  assert.match(html, /<style nonce="[A-Za-z0-9]{32}">[\s\S]*--clay-canvas: var\(--vscode-editor-background\)/);
  assert.match(html, /--clay-shadow: none/);
  assert.match(html, /--font-family: var\(--vscode-font-family/);
  assert.match(html, /\.config-app-workspace\s*\{[\s\S]*height:\s*calc\(100vh - 72px\) !important/);
  assert.match(html, /\.config-editor-shell > \.ant-card > \.ant-card-body[\s\S]*overflow:\s*auto !important/);
  assert.match(html, /\.skills-manager-modal \.ant-modal\s*\{[\s\S]*width:\s*min\(1180px,\s*calc\(100vw - 24px\)\) !important/);
  assert.match(html, /\.skills-manager-content > div:last-child[\s\S]*max-height:\s*none !important/);
  assert.match(html, new RegExp(`loadScript\\("webview-test://.*/${escapeRegExp(jsAsset)}"\\)`));
  assert.match(html, /config-app-ui\.js\?v=/);
  assert.match(html, /const configBase = "webview-test:\/\/.*\/media\/config";/);
  assert.match(html, /const downloadsDir = ".*Downloads";/);
  assert.match(html, /history\.replaceState\(null, "", configBase \+ "\/index\.html"\)/);
  assert.match(html, /window\.sinitekConfigBridge = \{/);
  assert.match(html, /window\.electronAPI = \{\s+config: \{/);
  assert.match(html, /syncActiveConfigIds\(\)\.finally\(\(\) => \{/);

  const nonceAttributes = Array.from(html.matchAll(/nonce="([^"]+)"/g), (match) => match[1]);
  assert.ok(nonceAttributes.length >= 1, "inline script should carry the CSP nonce");
  assert.ok(nonceAttributes.every((value) => value === nonce));
  for (const expected of [
    cssAsset,
    jsAsset,
    "config-app-api.js",
    "config-app-store.js",
    "config-app-ui.js",
    "media/config",
  ]) {
    assert.ok(uris.some((uri) => uri.includes(expected)), `webview URI should include ${expected}`);
  }
});

test("config view reports missing hashed and app assets without touching user data", () => {
  const { getConfigViewHtml } = require("../../webview/configView") as typeof import("../../webview/configView");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-config-view-"));
  const assetsDir = path.join(tempRoot, "media", "config", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const harness = createConfigWebview();

  fs.writeFileSync(path.join(assetsDir, "index-test.js"), "console.log('test');", "utf8");
  assert.throws(
    () => getConfigViewHtml(harness.webview as any, { fsPath: tempRoot } as any),
    /Missing config manager asset: \.css/,
  );

  fs.writeFileSync(path.join(assetsDir, "index-test.css"), "body{}", "utf8");
  fs.writeFileSync(path.join(assetsDir, "config-app-api.js"), "", "utf8");
  fs.writeFileSync(path.join(assetsDir, "config-app-store.js"), "", "utf8");
  assert.throws(
    () => getConfigViewHtml(harness.webview as any, { fsPath: tempRoot } as any),
    /Missing config manager asset: config-app-ui\.js/,
  );

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("main webview content and provider cover success, cache, message, and fallback paths", () => {
  const fsModule = require("fs") as typeof fs;
  const logger = require("../../logger") as AnyRecord;
  const originalReadFileSync = fsModule.readFileSync;
  const originalLogError = logger.logError;
  const viewContentPath = "../../webview/viewContent";
  const viewProviderPath = "../../webview/viewProvider";

  try {
    let viewContent = requireFresh<typeof import("../../webview/viewContent")>(viewContentPath);
    const firstHtml = viewContent.getWebviewHtml({ cspSource: "vscode-resource://main-panel" });
    assert.match(firstHtml, /携宁 CLI 助手/);
    assert.match(firstHtml, /const CLI_NAMES = \[/);
    const cachedHtml = viewContent.getWebviewHtml({ cspSource: "vscode-resource://main-panel" });
    assert.match(cachedHtml, /携宁 CLI 助手/);

    logger.logError = async () => undefined;
    fsModule.readFileSync = ((target: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (String(target).includes("marked.min.js") || String(target).includes("json-formatter.umd.js")) {
        throw new Error("vendor script missing by test");
      }
      return (originalReadFileSync as any)(target, ...args);
    }) as typeof fs.readFileSync;
    viewContent = requireFresh<typeof import("../../webview/viewContent")>(viewContentPath);
    const noMarkedHtml = viewContent.getWebviewHtml({ cspSource: "vscode-resource://main-panel" });
    assert.match(noMarkedHtml, /携宁 CLI 助手/);

    fsModule.readFileSync = originalReadFileSync;
    logger.logError = originalLogError;
    viewContent = requireFresh<typeof import("../../webview/viewContent")>(viewContentPath);
    const { CliBridgeViewProvider } = requireFresh<typeof import("../../webview/viewProvider")>(viewProviderPath);
    const messages: unknown[] = [];
    const posted: unknown[] = [];
    const view: AnyRecord = {
      onDidDispose: () => ({ dispose: () => undefined }),
      webview: {
        cspSource: "vscode-resource://provider",
        options: undefined,
        html: "",
        onDidReceiveMessage(handler: MessageHandler) {
          view.messageHandler = handler;
          return { dispose: () => undefined };
        },
        postMessage(message: unknown) {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
      show(preserveFocus: boolean) {
        view.showArgument = preserveFocus;
      },
    };
    const provider = new CliBridgeViewProvider({ fsPath: repoRoot } as any, {
      onMessage: (message) => messages.push(message),
    });
    provider.postState({ currentCli: "codex" } as any);
    provider.postMessage({ type: "before-resolve" });
    provider.reload();
    provider.reveal();
    provider.resolveWebviewView(view as any);
    assert.equal(view.webview.options.enableScripts, true);
    assert.equal(view.webview.options.localResourceRoots[0].fsPath, repoRoot);
    assert.match(view.webview.html, /携宁 CLI 助手/);
    view.messageHandler({ type: "sendPrompt", prompt: "hello" });
    assert.deepEqual(messages, [{ type: "sendPrompt", prompt: "hello" }]);
    provider.postState({ currentCli: "codex" } as any);
    provider.postMessage({ type: "custom" });
    provider.reveal();
    assert.deepEqual(posted, [
      { type: "state", payload: { currentCli: "codex" } },
      { type: "custom" },
    ]);
    assert.equal(view.showArgument, true);

    viewContent.getWebviewHtml = () => {
      throw new Error("<broken & \"quoted\" 'panel'>");
    };
    provider.reload();
    assert.match(view.webview.html, /&lt;broken &amp; &quot;quoted&quot; &#39;panel&#39;&gt;/);
    const errorFallbackView: AnyRecord = {
      onDidDispose: () => ({ dispose: () => undefined }),
      webview: { ...view.webview, html: "" },
      show: () => undefined,
    };
    const errorFallbackProvider = new CliBridgeViewProvider({ fsPath: repoRoot } as any, {
      onMessage: () => undefined,
    });
    errorFallbackProvider.resolveWebviewView(errorFallbackView as any);
    assert.match(errorFallbackView.webview.html, /&lt;broken &amp; &quot;quoted&quot; &#39;panel&#39;&gt;/);

    viewContent.getWebviewHtml = () => {
      throw "string render failure";
    };
    provider.reload();
    assert.match(view.webview.html, /string render failure/);
    const fallbackView: AnyRecord = {
      onDidDispose: () => ({ dispose: () => undefined }),
      webview: { ...view.webview, html: "" },
      show: () => undefined,
    };
    const fallbackProvider = new CliBridgeViewProvider({ fsPath: repoRoot } as any, {
      onMessage: () => undefined,
    });
    fallbackProvider.resolveWebviewView(fallbackView as any);
    assert.match(fallbackView.webview.html, /string render failure/);
  } finally {
    fsModule.readFileSync = originalReadFileSync;
    logger.logError = originalLogError;
    delete require.cache[require.resolve(viewContentPath)];
    delete require.cache[require.resolve(viewProviderPath)];
  }
});

test("config HTML bridge validates host protocol mapping and active-config sync boundaries", () => {
  const { html } = renderConfigHtml();
  const actions = extractConfigActions();

  for (const action of actions) {
    assert.match(html, new RegExp(`requestConfig\\("${escapeRegExp(action)}"`), `${action} should be exposed by the webview bridge`);
  }
  assert.match(html, /openPath: \(path\) => \{[\s\S]*type: "config:openPath", path/);
  assert.match(html, /openExternal: \(url\) => \{[\s\S]*type: "config:openExternal", url/);
  assert.match(html, /mapConfigListFromHost\(configs, platform\)/);
  assert.match(html, /requestedPlatform !== "opencode"/);
  assert.match(html, /openCodeSkills: config\.openCodeSkills \?\? config\.geminiSkills \?\? \[\]/);
  assert.match(html, /const \{ geminiSkills, \.\.\.rest \} = config/);
  assert.match(html, /const \{ geminiSkills, \.\.\.rest \} = payload/);
  assert.match(html, /const platforms = \["claude", "codex", "opencode", "grok", "dsh", "kimi-code"\]/);
  assert.match(html, /event: "syncActive:empty"/);
  assert.match(html, /event: "syncActive:error"/);
  assert.match(html, /localStorage\.removeItem\(ACTIVE_CONFIG_KEY_PREFIX \+ platform\)/);

  const requestMessages: ConfigRequestMessage[] = [
    { type: "config:request", requestId: "list", action: "getList", platform: "claude" },
    { type: "config:request", requestId: "order", action: "setOrder", platform: "codex", order: { codex: ["codex-a"] } },
    {
      type: "config:request",
      requestId: "copy",
      action: "copy",
      payload: {
        sourcePlatform: "claude",
        sourceId: "claude-a",
        targetPlatform: "opencode",
        name: "OpenCode Copy",
      },
    },
  ];
  const openPathMessage: ConfigOpenPathMessage = { type: "config:openPath", path: "/tmp/config.json" };
  const openExternalMessage: ConfigOpenExternalMessage = { type: "config:openExternal", url: "https://example.test" };
  const closeMessage: ConfigCloseMessage = { type: "config:close" };
  assert.deepEqual(requestMessages.map((message) => message.type), ["config:request", "config:request", "config:request"]);
  assert.equal(openPathMessage.type, "config:openPath");
  assert.equal(openExternalMessage.type, "config:openExternal");
  assert.equal(closeMessage.type, "config:close");
});

test("config manager panel creates a safe webview and handles non-config host messages", async () => {
  const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
  const harness = installConfigPanelHarness();
  const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any);

  manager.show();
  await delay(0);
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0][0], "sinitek-cli-tools.configManager");
  assert.equal((harness.createCalls[0][3] as AnyRecord).enableScripts, true);
  assert.equal((harness.createCalls[0][3] as AnyRecord).retainContextWhenHidden, true);
  assert.ok(harness.panel.webview.html.includes("window.electronAPI"));
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.maximizeEditorHideSidebar").length,
    1,
  );

  const firstHtml = harness.panel.webview.html;
  manager.show();
  await delay(0);
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.revealCount, 1);
  assert.equal(harness.commandCalls.find((call) => call[0] === "reveal")?.[2], false);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.maximizeEditorHideSidebar").length,
    2,
  );

  manager.syncActiveConfig();
  assert.deepEqual(
    harness.panel.webview.postedMessages[harness.panel.webview.postedMessages.length - 1],
    { type: "config:syncActive" },
  );

  manager.reload();
  assert.ok(harness.panel.title.length > 0);
  assert.notEqual(harness.panel.webview.html, firstHtml);

  assert.ok(harness.messageHandler, "message handler should be registered");
  harness.messageHandler({ type: "config:openPath", path: "/tmp/sinitek-config.json" });
  harness.messageHandler({ type: "config:openPath", path: "" });
  harness.messageHandler({ type: "config:openExternal", url: "https://example.test/signup" });
  harness.messageHandler({ type: "config:openExternal", url: "" });
  harness.messageHandler({ type: "config:debug", payload: { event: "unit-test" } });
  harness.messageHandler({ type: "config:debug" });
  await delay(0);
  assert.deepEqual(harness.commandCalls.some((call) => call[0] === "revealFileInOS"), true);
  assert.deepEqual(harness.externalUrls, ["https://example.test/signup"]);

  harness.disposeHandler?.();
  await delay(0);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleMaximizeEditorGroup").length,
    1,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleSidebarVisibility").length,
    1,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleAuxiliaryBar").length,
    1,
  );
  manager.syncActiveConfig();
  assert.equal(harness.panel.webview.postedMessages.filter((message) => (message as AnyRecord).type === "config:syncActive").length, 1);
});

test("config manager panel closes when the webview requests it", async () => {
  const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
  const harness = installConfigPanelHarness();
  const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any);

  manager.show();
  assert.ok(harness.messageHandler, "message handler should be registered");

  harness.messageHandler({ type: "config:close" } satisfies ConfigCloseMessage);
  await delay(0);

  assert.equal(harness.disposeCount, 1);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleMaximizeEditorGroup").length,
    1,
  );
  manager.syncActiveConfig();
  assert.equal(harness.panel.webview.postedMessages.length, 0);
});

test("config manager panel stays in the editor when maximizing width fails", async () => {
  const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
  const harness = installConfigPanelHarness();
  harness.maximizeCommandError = new Error("editor maximize is unavailable");
  const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any);

  manager.show();
  await delay(0);
  manager.show();
  await delay(0);

  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.revealCount, 1);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.maximizeEditorHideSidebar").length,
    2,
  );

  harness.disposeHandler?.();
  await delay(0);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleSidebarVisibility").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleAuxiliaryBar").length,
    0,
  );
});

test("config manager panel opens at the maximum editor width and restores splits on close", async () => {
  const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
  const harness = installConfigPanelHarness();
  const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any);

  manager.show();
  await delay(0);
  await delay(0);

  const openedCommands = harness.commandCalls.map((call) => call[0]);
  assert.deepEqual(
    openedCommands.filter((command) => command !== "reveal"),
    [
      "workbench.action.maximizeEditorHideSidebar",
    ],
  );

  manager.show();
  await delay(0);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.maximizeEditorHideSidebar").length,
    2,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleCenteredLayout").length,
    0,
  );

  harness.disposeHandler?.();
  await delay(0);
  await delay(0);
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleZenMode").length,
    0,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleMaximizeEditorGroup").length,
    1,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleSidebarVisibility").length,
    1,
  );
  assert.equal(
    harness.commandCalls.filter((call) => call[0] === "workbench.action.toggleAuxiliaryBar").length,
    1,
  );
  manager.syncActiveConfig();
});

test("config manager panel routes request actions, change notifications, and errors through response messages", async () => {
  const configService = require("../../config/configService") as AnyRecord;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["getConfigList", "setConfigOrder", "saveConfig", "applyConfig"]) {
    originals.set(name, configService[name]);
  }

  const serviceCalls: unknown[][] = [];
  try {
    configService.getConfigList = async (platform: string) => {
      serviceCalls.push(["getConfigList", platform]);
      return [
        {
          id: `${platform}-one`,
          name: `${platform} One`,
          platform,
          createdAt: 1,
          updatedAt: 2,
        },
      ];
    };
    configService.setConfigOrder = async (platform: string, order: AnyRecord) => {
      serviceCalls.push(["setConfigOrder", platform, order]);
    };
    configService.saveConfig = async (config: AnyRecord) => {
      serviceCalls.push(["saveConfig", config.platform, config.id]);
    };
    configService.applyConfig = async (platform: string, payload: AnyRecord) => {
      serviceCalls.push(["applyConfig", platform, payload]);
      if (platform === "codex") {
        throw new Error("apply denied by test");
      }
      return { applied: platform };
    };

    const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
    const harness = installConfigPanelHarness();
    let changeNotifications = 0;
    const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any, {
      onConfigChanged: () => {
        changeNotifications += 1;
      },
    });
    manager.show();

    const listResponse = await dispatchPanelMessage(harness, {
      type: "config:request",
      requestId: "list-opencode",
      action: "getList",
      platform: "opencode",
    } satisfies ConfigRequestMessage);
    assert.equal(listResponse.success, true);
    assert.deepEqual(listResponse.data[0].platform, "opencode");

    const orderResponse = await dispatchPanelMessage(harness, {
      type: "config:request",
      requestId: "order-codex",
      action: "setOrder",
      platform: "codex",
      order: { codex: ["codex-one"] },
    } satisfies ConfigRequestMessage);
    assert.deepEqual(orderResponse, {
      type: "config:response",
      requestId: "order-codex",
      success: true,
      data: true,
    });
    assert.equal(changeNotifications, 1);

    const saveResponse = await dispatchPanelMessage(harness, {
      type: "config:request",
      requestId: "save-claude",
      action: "save",
      config: {
        id: "claude-one",
        name: "Claude One",
        platform: "claude",
        content: "{}",
        mcpContent: "{}",
        claudeSkills: [],
        createdAt: 1,
        updatedAt: 2,
      },
    } satisfies ConfigRequestMessage);
    assert.equal(saveResponse.success, true);
    assert.equal(saveResponse.data.platform, "claude");
    assert.equal(changeNotifications, 2);

    const applyResponse = await dispatchPanelMessage(harness, {
      type: "config:request",
      requestId: "apply-codex",
      action: "apply",
      platform: "codex",
      payload: { configContent: "model = \"gpt-5.1-codex\"" },
    } satisfies ConfigRequestMessage);
    assert.equal(applyResponse.success, false);
    assert.match(String(applyResponse.error), /apply denied by test/);
    assert.equal(changeNotifications, 2);

    const applySuccessResponse = await dispatchPanelMessage(harness, {
      type: "config:request",
      requestId: "apply-opencode",
      action: "apply",
      platform: "opencode",
      payload: { configContent: "{\"model\":\"gpt-5.1-codex\"}" },
    } satisfies ConfigRequestMessage);
    assert.deepEqual(applySuccessResponse, {
      type: "config:response",
      requestId: "apply-opencode",
      success: true,
      data: { applied: "opencode" },
    });
    assert.equal(changeNotifications, 3);

    const unknownResponse = await dispatchPanelMessage(harness, {
      type: "config:request",
      requestId: "unknown",
      action: "notAConfigAction",
    });
    assert.equal(unknownResponse.success, false);
    assert.equal(unknownResponse.requestId, "unknown");
    assert.deepEqual(serviceCalls.map((call) => call[0]), [
      "getConfigList",
      "setConfigOrder",
      "saveConfig",
      "applyConfig",
      "applyConfig",
    ]);
  } finally {
    for (const [name, original] of originals) {
      configService[name] = original;
    }
  }
});

test("Grok save applies disk config and awaits model refresh before acknowledging success", async () => {
  const configService = require("../../config/configService") as typeof import("../../config/configService");
  const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-grok-save-refresh-"));
  const previousHome = process.env.GROK_HOME;
  const initial = '[model.original]\nmodel = "original-model"\n';
  const updated = '[models]\ndefault = "sol"\n[model.sol]\nmodel = "gpt-6.1-sol"\nname = "Not the dropdown label"\n';
  const snapshots: GrokConfigModels[] = [];
  let refreshBarrier: Promise<void> = Promise.resolve();
  let refreshStarted: () => void = () => undefined;
  let releaseRefresh: () => void = () => undefined;
  process.env.GROK_HOME = temporaryHome;
  try {
    fs.writeFileSync(path.join(temporaryHome, "config.toml"), initial);
    const harness = installConfigPanelHarness();
    const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any, {
      onConfigChanged: async () => {
        refreshStarted();
        await refreshBarrier;
        snapshots.push(parseGrokConfigModels(await configService.readGrokConfigText()));
      },
    });
    manager.show();
    const request = (message: ConfigRequestMessage) => (manager as AnyRecord).handleRequest(message) as Promise<void>;
    const responses = harness.panel.webview.postedMessages as AnyRecord[];
    await request({
      type: "config:request", requestId: "save-grok", action: "save",
      config: { id: "profile", name: "Grok", platform: "grok", content: updated, configContent: updated, createdAt: 1, updatedAt: 2 },
    });
    assert.equal(responses.at(-1)?.success, true);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.models), [["original"]]);
    assert.equal((await configService.getConfigById("grok", "profile"))?.configContent, updated);

    refreshBarrier = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshEntered = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const applying = request({
      type: "config:request", requestId: "apply-grok", action: "apply", platform: "grok", payload: { content: updated },
    });
    await refreshEntered;
    assert.equal(await configService.readGrokConfigText(), updated);
    assert.equal(responses.some((message) => message.requestId === "apply-grok"), false);
    assert.equal(snapshots.length, 1);
    releaseRefresh();
    await applying;
    assert.equal(responses.at(-1)?.success, true);
    assert.deepEqual(snapshots[1].models, ["sol"]);
    assert.deepEqual(snapshots[1].labels, { sol: "gpt-6.1-sol" });
    assert.equal(snapshots[1].defaultModel, "sol");

    await request({
      type: "config:request", requestId: "apply-invalid-grok", action: "apply", platform: "grok", payload: { content: "[[[" },
    });
    assert.equal(responses.at(-1)?.success, false);
    assert.equal(snapshots.length, 2);
    assert.equal(await configService.readGrokConfigText(), updated);
    assert.match(readProjectFile("src/extension.ts"), /onConfigChanged: \(\) => postPanelState\(\)/);
  } finally {
    releaseRefresh();
    if (previousHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousHome;
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test("config manager panel routes remaining request actions and export branches", async () => {
  const configService = require("../../config/configService") as AnyRecord;
  const originals = new Map<string, unknown>();
  const serviceNames = [
    "getConfigOrder",
    "getConfigById",
    "copyConfig",
    "deleteConfig",
    "getCurrentConfig",
    "backupConfig",
    "getBackupList",
    "initDefaultConfig",
    "getCliSkillsList",
    "openCliSkillsDirectory",
    "deleteCliSkill",
    "copyCliSkill",
  ];
  for (const name of serviceNames) {
    originals.set(name, Object.getOwnPropertyDescriptor(configService, name));
    Object.defineProperty(configService, name, {
      value: configService[name],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  const originalMkdir = fs.promises.mkdir;
  const originalWriteFile = fs.promises.writeFile;
  const calls: unknown[][] = [];
  const written: unknown[][] = [];
  let mkdirFailuresRemaining = 1;

  try {
    configService.getConfigOrder = async (platform: string) => {
      calls.push(["getConfigOrder", platform]);
      return { [platform]: [`${platform}-one`] };
    };
    configService.getConfigById = async (platform: string, id: string) => {
      calls.push(["getConfigById", platform, id]);
      return { id, name: "By Id", platform, createdAt: 1, updatedAt: 2 };
    };
    configService.copyConfig = async (payload: AnyRecord) => {
      calls.push(["copyConfig", payload.targetPlatform]);
      return { id: "copy-one", platform: payload.targetPlatform };
    };
    configService.deleteConfig = async (platform: string, id: string) => {
      calls.push(["deleteConfig", platform, id]);
    };
    configService.getCurrentConfig = async (platform: string) => {
      calls.push(["getCurrentConfig", platform]);
      return { id: `${platform}-current`, platform };
    };
    configService.backupConfig = async (platform: string) => {
      calls.push(["backupConfig", platform]);
      return { fileName: `${platform}.bak` };
    };
    configService.getBackupList = async (platform: string) => {
      calls.push(["getBackupList", platform]);
      return [`${platform}.bak`];
    };
    configService.initDefaultConfig = async (platform: string) => {
      calls.push(["initDefaultConfig", platform]);
      return { id: `${platform}-default`, platform };
    };
    configService.getCliSkillsList = async (platform: string) => {
      calls.push(["getCliSkillsList", platform]);
      return { directory: `/skills/${platform}`, displayDirectory: `~/${platform}/skills`, skills: [] };
    };
    configService.openCliSkillsDirectory = async (platform: string) => {
      calls.push(["openCliSkillsDirectory", platform]);
      return `/skills/${platform}`;
    };
    configService.deleteCliSkill = async (platform: string, name: string) => {
      calls.push(["deleteCliSkill", platform, name]);
      return { directory: `/skills/${platform}`, displayDirectory: `~/${platform}/skills`, skills: [] };
    };
    configService.copyCliSkill = async (platform: string, name: string, targetPlatform: string) => {
      calls.push(["copyCliSkill", platform, name, targetPlatform]);
      return { directory: `/skills/${platform}`, displayDirectory: `~/${platform}/skills`, skills: [{ name }] };
    };
    fs.promises.mkdir = (async (target: fs.PathLike) => {
      calls.push(["mkdir", String(target)]);
      if (mkdirFailuresRemaining > 0) {
        mkdirFailuresRemaining -= 1;
        throw new Error("mkdir denied by test");
      }
      return undefined as any;
    }) as typeof fs.promises.mkdir;
    fs.promises.writeFile = (async (...args: any[]) => {
      written.push(args);
      return undefined;
    }) as typeof fs.promises.writeFile;

    const { ConfigManagerPanel } = require("../../webview/configPanel") as typeof import("../../webview/configPanel");
    const harness = installConfigPanelHarness();
    let changeNotifications = 0;
    const manager = new ConfigManagerPanel({ fsPath: repoRoot } as any, {
      onConfigChanged: () => {
        changeNotifications += 1;
      },
    });
    manager.reload();
    manager.syncActiveConfig();
    manager.show();

    const requests: AnyRecord[] = [
      { requestId: "get-order", action: "getOrder", platform: "codex" },
      { requestId: "get-by-id", action: "getById", platform: "claude", id: "claude-one" },
      { requestId: "copy", action: "copy", payload: { sourcePlatform: "claude", sourceId: "a", targetPlatform: "codex", name: "Copy" } },
      { requestId: "delete", action: "delete", platform: "codex", id: "codex-one" },
      { requestId: "current", action: "getCurrent", platform: "opencode" },
      { requestId: "backup", action: "backup", platform: "claude" },
      { requestId: "backups", action: "getBackups", platform: "claude" },
      { requestId: "init", action: "initDefault", platform: "codex" },
      { requestId: "skills-list", action: "getCliSkillsList", platform: "codex" },
      { requestId: "skills-open", action: "openCliSkillsDirectory", platform: "claude" },
      { requestId: "skills-delete", action: "deleteCliSkill", platform: "opencode", name: "skill-a" },
      { requestId: "skills-copy", action: "copyCliSkill", platform: "grok", name: "skill-b", targetPlatform: "codex" },
      { requestId: "export-invalid", action: "exportConfigs", payload: { fileName: "ignored.json" } },
      { requestId: "export-default", action: "exportConfigs", payload: { content: "{\"ok\":true}" } },
      { requestId: "export-sanitized", action: "exportConfigs", payload: { fileName: "bad:name", content: "{}" } },
      { requestId: "export-ready", action: "exportConfigs", payload: { fileName: "ready.json", content: "{}" } },
    ];

    for (const request of requests) {
      const response = await dispatchPanelMessage(harness, {
        type: "config:request",
        ...request,
      });
      assert.equal(response.type, "config:response");
      assert.equal(response.requestId, request.requestId);
      if (request.requestId === "export-invalid") {
        assert.equal(response.success, false);
      } else {
        assert.equal(response.success, true, `${request.action} should succeed`);
      }
    }

    assert.equal(changeNotifications, 3);
    assert.equal(written.length, 3);
    assert.ok(written.some(([target]) => String(target).endsWith("bad_name.json")));
    assert.ok(written.some(([target]) => String(target).endsWith("ready.json")));
    assert.deepEqual(calls.find((call) => call[0] === "getCliSkillsList"), ["getCliSkillsList", "codex"]);
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(configService, name, descriptor);
      } else {
        delete configService[name];
      }
    }
    fs.promises.mkdir = originalMkdir;
    fs.promises.writeFile = originalWriteFile;
  }
});

test("config protocol declarations stay aligned with panel switch cases and bridge actions", () => {
  const actions = extractConfigActions();
  const panelSource = readProjectFile("src/webview/configPanel.ts");
  const viewSource = readProjectFile("src/webview/configView.ts");
  const apiSource = readProjectFile("media/config/assets/config-app-api.js");

  assert.deepEqual(actions, [
    "getList",
    "getOrder",
    "setOrder",
    "getById",
    "save",
    "copy",
    "delete",
    "getCurrent",
    "apply",
    "backup",
    "getBackups",
    "initDefault",
    "getCliSkillsList",
    "openCliSkillsDirectory",
    "deleteCliSkill",
    "copyCliSkill",
    "searchLobehubSkills",
    "installLobehubSkill",
    "exportConfigs",
    "getCliEnabled",
  ]);

  for (const action of actions) {
    assert.match(panelSource, new RegExp(`case "${escapeRegExp(action)}":`), `${action} should have a panel handler`);
    assert.match(viewSource, new RegExp(`requestConfig\\("${escapeRegExp(action)}"`), `${action} should have a webview bridge wrapper`);
  }

  assert.match(apiSource, /detectConfigApiMode = \(\) =>[\s\S]*window\.electronAPI\?\.config \? "ipc" : "http"/);
  assert.match(apiSource, /getCliSkillsList: \(platform\) =>\s*requestConfigApi\(`\/skills\/\$\{encodeURIComponent\(platform\)\}`\)/);
  assert.match(apiSource, /configApiMode === "ipc" \? getIpcConfigApi\(\) : httpConfigApi/);
  assert.match(viewSource, /close: \(\) => \{[\s\S]*?vscode\.postMessage\(\{ type: "config:close" \}\)/);
  assert.match(panelSource, /message\.type === "config:close"[\s\S]*?this\.panel\?\.dispose\(\)/);
});

test("config API asset supports IPC, HTTP success, and HTTP error contracts", async () => {
  const ipcApi = loadApiUtilities(
    {
      electronAPI: {
        config: {
          getList: async (platform: string) => [`ipc:${platform}`],
          getCliSkillsList: async (platform: string) => [{ platform, name: "opencode-skill" }],
        },
      },
    },
    async () => {
      throw new Error("HTTP should not be used in IPC mode");
    },
  );
  assert.equal(ipcApi.detectConfigApiMode(), "ipc");
  assert.equal(ipcApi.configApiMode, "ipc");
  assert.deepEqual(toPlain(await ipcApi.fetchConfigList("codex")), ["ipc:codex"]);
  assert.deepEqual(toPlain(await ipcApi.fetchCliSkillsList("opencode")), [{ platform: "opencode", name: "opencode-skill" }]);

  const fetchCalls: { url: string; init?: AnyRecord }[] = [];
  const httpApi = loadApiUtilities({}, async (url: string, init?: AnyRecord) => {
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: ["http-codex"] }),
    };
  });
  assert.equal(httpApi.detectConfigApiMode(), "http");
  assert.equal(httpApi.configApiMode, "http");
  assert.deepEqual(toPlain(await httpApi.httpConfigApi.getList("codex")), ["http-codex"]);
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:9001/api/config/list/codex");
  assert.equal(fetchCalls[0].init?.headers["Content-Type"], "application/json");

  const appErrorApi = loadApiUtilities({}, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: false, message: "application failure" }),
  }));
  await assert.rejects(appErrorApi.httpConfigApi.getList("claude"), /application failure/);

  const httpErrorApi = loadApiUtilities({}, async () => ({
    ok: false,
    status: 503,
    text: async () => "",
  }));
  await assert.rejects(httpErrorApi.httpConfigApi.getList("claude"), /请求失败\(503\)/);
});

test("config store asset keeps platform order, duplicate names, empty states, and error fallbacks isolated", () => {
  const { utils, storage } = loadStoreUtilities();

  assert.deepEqual(toPlain(utils.createEmptyOrder()), { claude: [], codex: [], opencode: [], grok: [], dsh: [], "kimi-code": [] });
  assert.equal(utils.createCopyName("Gateway", []), "Gateway_副本");
  assert.equal(
    utils.createCopyName("Gateway", ["Gateway_副本", "Gateway_副本2"]),
    "Gateway_副本3",
  );

  const configs = [
    { id: "codex-b", platform: "codex" },
    { id: "codex-a", platform: "codex" },
    { id: "codex-c", platform: "codex" },
  ];
  assert.deepEqual(toPlain(utils.mergeOrderWithConfigs(configs, ["missing", "codex-a", "codex-b"])), {
    configs: [
      { id: "codex-a", platform: "codex" },
      { id: "codex-b", platform: "codex" },
      { id: "codex-c", platform: "codex" },
    ],
    order: ["codex-a", "codex-b", "codex-c"],
  });
  assert.deepEqual(
    toPlain(utils.appendOrderForConfigs(
      [
        { id: "claude-one", platform: "claude" },
        { id: "opencode-one", platform: "opencode" },
      ],
      { claude: [], codex: ["codex-one"], opencode: [] },
    )),
    { claude: ["claude-one"], codex: ["codex-one"], opencode: ["opencode-one"], grok: [], dsh: [], "kimi-code": [] },
  );

  utils.storeJson("valid", { ok: true });
  assert.equal(storage.get("valid"), "{\"ok\":true}");
  storage.set("broken", "{not-json");
  assert.deepEqual(toPlain(utils.readJson("broken", { fallback: true })), { fallback: true });
  assert.deepEqual(toPlain(utils.loadStoredOrder()), { claude: [], codex: [], opencode: [], grok: [], dsh: [], "kimi-code": [] });

  const storeSource = readProjectFile("media/config/assets/config-app-store.js");
  assert.match(storeSource, /selectedConfigPlatform: null/);
  assert.match(storeSource, /isLoading: !1/);
  assert.match(storeSource, /console\.error\("加载配置失败:", n\), e\(\{ isLoading: !1 \}\), n/);
  assert.match(storeSource, /getConfigsByPlatform: \(n\) => t\(\)\.configs\.filter/);
});

test("configuration UI asset exposes platform switching, empty/error states, and compact selectors", () => {
  const uiSource = readProjectFile("media/config/assets/config-app-ui.js");
  const cssSource = readProjectFile(`media/config/assets/${findAsset(".css")}`);
  const listPanel = extractBetween(uiSource, "// Config list panel", "const CLI_GLOBAL_SKILL_TARGETS =");
  const editorPanel = extractBetween(uiSource, "const ConfigEditorPanel =", "const { Header: jk");
  const layout = extractBetween(uiSource, "const CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY", "const readConfigVscodeColor =");

  assert.match(listPanel, /H\("claude", \$\)/);
  assert.match(listPanel, /isConfigPlatformEnabled\("claude", cliEnabledByName\) \? H\("claude", \$\)/);
  assert.match(listPanel, /children: "没有已启用的 CLI"/);
  assert.match(listPanel, /children: "Skills 市场"/);
  assert.match(listPanel, /H\("codex", w\)/);
  assert.match(listPanel, /H\("opencode", O\)/);
  assert.match(listPanel, /H\("grok", grokConfigs\)/);
  assert.match(listPanel, /H\("dsh", dshConfigs\)/);
  assert.ok(listPanel.indexOf('H("claude"') < listPanel.indexOf('H("codex"'));
  assert.ok(listPanel.indexOf('H("codex"') < listPanel.indexOf('H("opencode"'));
  assert.ok(listPanel.indexOf('H("opencode"') < listPanel.indexOf('H("grok"'));
  assert.ok(listPanel.indexOf('H("grok"') < listPanel.indexOf('H("dsh"'));
  assert.match(listPanel, /locale: \{ emptyText: "暂无配置" \}/);
  assert.match(listPanel, /children: "暂无配置可导出"/);
  assert.match(listPanel, /onClick: \(\) => I\(k\)/);
  assert.match(listPanel, /if \(!Y && !p\) B\(ae, F\)/);

  assert.match(editorPanel, /className: "config-empty-state"/);
  assert.match(editorPanel, /children: "请从左侧选择一个配置"/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-claude"/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-opencode"/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-codex"/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-dsh"/);
  assert.match(editorPanel, /"data-testid": "dsh-model-id"/);
  assert.match(editorPanel, /DSH_UI_MODEL_ID/);
  assert.match(layout, /config-mobile-directory-button/);
  assert.match(editorPanel, /\[claudeEditorMode, setClaudeEditorMode\] = c\.useState\("json"\)/);
  assert.match(editorPanel, /\[openCodeEditorMode, setOpenCodeEditorMode\] = c\.useState\("json"\)/);
  assert.match(editorPanel, /\[codexEditorMode, setCodexEditorMode\] = c\.useState\("toml"\)/);
  assert.match(editorPanel, /O\.platform === "claude"[\s\S]*setClaudeEditorMode\("json"\)/);
  assert.match(editorPanel, /O\.platform === "opencode"[\s\S]*setOpenCodeEditorMode\("json"\)/);
  assert.match(editorPanel, /setCodexEditorMode\("toml"\)/);
  assert.match(editorPanel, /switchClaudeEditorMode\("visual"\)/);
  assert.match(editorPanel, /switchOpenCodeEditorMode\("json"\)/);
  assert.match(editorPanel, /switchCodexEditorMode\("toml"\)/);
  assert.match(editorPanel, /const renderFixedEditorModeTabs =/);
  assert.equal(
    (editorPanel.match(/className: "config-editor-fixed-actions"/g) || []).length,
    6,
    "each config editor should render a fixed action area",
  );
  assert.match(editorPanel, /const renderConfigEditorCardTitle =/);
  assert.equal(
    (editorPanel.match(/title: renderConfigEditorCardTitle\(/g) || []).length,
    5,
    "each config editor should render mode tabs under the card title",
  );
  assert.equal(
    (editorPanel.match(/renderFixedEditorModeTabs\(\[/g) || []).length,
    0,
    "mode tabs should not render from the right-side action area",
  );
  assert.match(editorPanel, /className: "config-editor-fixed-title"/);
  assert.match(editorPanel, /children: \[[\s\S]*?be\.jsx\("div", \{ children: W \}\)[\s\S]*?renderFixedEditorModeTabs\(H\)/);
  assert.match(editorPanel, /be\.jsx\(nh, \{[\s\S]*?className: "config-editor-fixed-mode-switch"/);
  assert.match(editorPanel, /activeKey: W\.find\(\(H\) => H\.active\)\?\.value \|\| W\[0\]\?\.value/);
  assert.match(editorPanel, /items: W\.map\(\(H\) => \(\{ key: H\.value, label: H\.label \}\)\)/);
  assert.match(editorPanel, /onChange: \(H\) => \{[\s\S]*?const k = W\.find\(\(L\) => L\.value === H\);[\s\S]*?k\?\.onClick\?\.\(\);/);
  assert.match(editorPanel, /tabBarStyle: \{ margin: 0 \}/);
  assert.match(editorPanel, /alignSelf: "flex-start"/);
  const modeTabs = extractBetween(editorPanel, "const renderFixedEditorModeTabs =", "const renderConfigEditorCardTitle =");
  assert.doesNotMatch(modeTabs, /"aria-pressed":/);

  assert.match(layout, /CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY = "\(max-width: 920px\)"/);
  assert.match(layout, /className: "config-mobile-directory-button"/);
  assert.match(layout, /className: mobileNavigationOpen[\s\S]*"config-app-sidebar config-app-sidebar-open"/);

  for (const selector of [
    ".config-app-workspace",
    ".config-mobile-directory-button",
    ".config-mobile-sidebar-backdrop",
    ".config-editor-shell",
    ".config-list .config-activate-radio",
  ]) {
    assert.ok(cssSource.includes(selector), `compact stylesheet should keep ${selector}`);
  }
  assert.match(uiSource, /const readConfigVscodeColor = \(\.\.\.variableNames\) => \{/);
  assert.match(uiSource, /const createConfigVscodeTheme = \(\) => \{/);
  assert.match(uiSource, /window\.getComputedStyle\(document\.documentElement\)/);
  assert.match(uiSource, /new MutationObserver\(\(\) => \{/);
  assert.match(uiSource, /observer\.observe\(document\.documentElement, themeAttributeOptions\)/);
  assert.match(uiSource, /observer\.observe\(document\.body, themeAttributeOptions\)/);
  assert.match(uiSource, /setConfigVscodeTheme\(createConfigVscodeTheme\(\)\)/);
  assert.match(uiSource, /theme: configVscodeTheme/);
  assert.doesNotMatch(uiSource, /configClayPalette|#faf9f7|#dad4c8|DM Sans/);
  assert.doesNotMatch(cssSource, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("configuration UI resolves Ant Design tokens from the current VS Code theme", () => {
  const theme = loadConfigVscodeTheme({
    "--vscode-editor-background": "editor-background",
    "--vscode-foreground": "editor-foreground",
    "--vscode-descriptionForeground": "description-foreground",
    "--vscode-disabledForeground": "disabled-foreground",
    "--vscode-editorWidget-background": "widget-background",
    "--vscode-input-background": "input-background",
    "--vscode-widget-border": "widget-border",
    "--vscode-focusBorder": "focus-border",
    "--vscode-button-background": "button-background",
    "--vscode-button-hoverBackground": "button-hover-background",
    "--vscode-button-foreground": "button-foreground",
    "--vscode-textLink-foreground": "link-foreground",
    "--vscode-textLink-activeForeground": "link-active-foreground",
    "--vscode-testing-iconPassed": "success-foreground",
    "--vscode-editorWarning-foreground": "warning-foreground",
    "--vscode-editorError-foreground": "error-foreground",
    "--vscode-list-hoverBackground": "list-hover-background",
    "--vscode-list-activeSelectionBackground": "list-selection-background",
    "--vscode-list-activeSelectionForeground": "list-selection-foreground",
  });

  assert.equal(theme.algorithm, "existing-algorithm");
  assert.equal(theme.token.padding, 16);
  assert.equal(theme.token.colorPrimary, "button-background");
  assert.equal(theme.token.colorPrimaryHover, "button-hover-background");
  assert.equal(theme.token.colorText, "editor-foreground");
  assert.equal(theme.token.colorBgBase, "editor-background");
  assert.equal(theme.token.colorBorder, "widget-border");
  assert.equal(theme.components.Button.defaultBg, "input-background");
  assert.equal(theme.components.Button.primaryColor, "button-foreground");
  assert.equal(theme.components.Button.fontWeight, 500);
  assert.equal(theme.components.Tree.nodeSelectedBg, "list-selection-background");
  assert.equal(theme.components.Tree.nodeSelectedColor, "list-selection-foreground");
  assert.equal(theme.components.List.itemPaddingLG, "12px 16px");
});

test("skills manager lists global skills with copy and delete actions", () => {
  const uiSource = readProjectFile("media/config/assets/config-app-ui.js");
  const cssSource = readProjectFile(`media/config/assets/${findAsset(".css")}`);
  const skillRows = extractBetween(uiSource, "const renderSkillRows =", "const SkillsManagerModal =");

  assert.match(skillRows, /be\.jsxs\("table", \{\s+className: "skills-manager-table"/);
  assert.doesNotMatch(skillRows, /type: "checkbox"/);
  assert.match(skillRows, /className: "skills-manager-skill-line"/);
  assert.match(skillRows, /className: "skills-manager-skill-description"/);
  assert.match(skillRows, /children: skill\.description/);
  assert.match(skillRows, /children: "复制到"/);
  assert.match(skillRows, /children: "删除"/);
  assert.doesNotMatch(skillRows, /className: "skills-manager-item"/);
  assert.match(uiSource, /renderSkillRows\(r, f, setCopySkill, p\)/);
  assert.match(uiSource, /children: "打开目录"/);
  assert.match(uiSource, /children: "该目录还没有 Skills"/);
  assert.match(uiSource, /Skills 加载中\.\.\./);
  assert.match(uiSource, /width: 760/);
  assert.match(uiSource, /rootClassName: "skills-manager-modal"/);
  assert.doesNotMatch(uiSource, /MCP\(全局\)/);
  assert.doesNotMatch(uiSource, /title: "MCP 市场"/);
  assert.doesNotMatch(uiSource, /claudeSkills: C/);

  assert.match(cssSource, /\.skills-manager-table \{[\s\S]*table-layout: fixed;/);
  assert.match(cssSource, /\.skills-manager-table-check \{[\s\S]*width: 36px;/);
  assert.match(cssSource, /\.skills-manager-skill-line \{[\s\S]*display: flex;/);
  assert.match(cssSource, /\.skills-manager-skill-description \{[\s\S]*white-space: nowrap;/);
});

test("Codex, Claude, and OpenCode visual editor utilities expose stable observable contracts", () => {
  const codex = loadVisualEditorUtils(
    "// CODEX_VISUAL_EDITOR_UTILS_START",
    "// CODEX_VISUAL_EDITOR_UTILS_END",
    "CodexConfigVisualEditorUtils",
  );
  const claude = loadVisualEditorUtils(
    "// CLAUDE_VISUAL_EDITOR_UTILS_START",
    "// CLAUDE_VISUAL_EDITOR_UTILS_END",
    "ClaudeConfigVisualEditorUtils",
  );
  const openCode = loadVisualEditorUtils(
    "// OPENCODE_VISUAL_EDITOR_UTILS_START",
    "// OPENCODE_VISUAL_EDITOR_UTILS_END",
    "OpenCodeConfigVisualEditorUtils",
  );

  for (const [label, utils] of [
    ["Codex", codex],
    ["Claude", claude],
  ] as const) {
    for (const method of ["createState", "updateState", "serializeState"]) {
      assert.equal(typeof utils[method], "function", `${label} should expose ${method}`);
    }
  }
  for (const method of ["createState", "addProvider", "updateProvider", "addModel", "updateModel", "setRole", "serializeState"]) {
    assert.equal(typeof openCode[method], "function", `OpenCode should expose ${method}`);
  }

  const codexState = codex.updateState(codex.createState("", ""), {
    model: "gpt-5.1-codex",
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    webSearch: "cached",
  });
  const codexSerialized = codex.serializeState(codexState);
  assert.equal(codexSerialized.ok, true);
  assert.match(codexSerialized.content, /model = "gpt-5\.1-codex"/);
  assert.match(codexSerialized.content, /approval_policy = "never"/);

  const claudeState = claude.updateState(claude.createState({}), {
    model: "sonnet",
    effortLevel: "high",
    autoCompactEnabled: "true",
  });
  const claudeSerialized = JSON.parse(claude.serializeState(claudeState).content);
  assert.equal(claudeSerialized.model, "sonnet");
  assert.equal(claudeSerialized.effortLevel, "high");
  assert.equal(claudeSerialized.autoCompactEnabled, true);

  let openCodeState = openCode.createState({});
  openCodeState = openCode.addProvider(openCodeState);
  const providerId = openCodeState.selectedProviderId;
  openCodeState = openCode.addModel(openCodeState, providerId);
  const modelId = openCodeState.selectedModelId;
  openCodeState = openCode.updateProvider(openCodeState, providerId, {
    id: "builtin",
    name: "Built In",
    npm: "@ai-sdk/openai-compatible",
    apiKeyEnv: "BUILTIN_API_KEY",
  });
  openCodeState = openCode.updateModel(openCodeState, "builtin", modelId, {
    id: "main",
    name: "Main",
  });
  openCodeState = openCode.setRole(openCodeState, "builtin", "main", "primary", true);
  const openCodeSerialized = openCode.serializeState(openCodeState);
  assert.equal(openCodeSerialized.ok, true);
  assert.equal(openCodeSerialized.config.model, "builtin/main");
  assert.equal(Object.keys(openCodeSerialized.config.provider).length, 1);
});

test("skills copy and market install share the DSH and Kimi Code targets appended after Codex", async () => {
  const uiSource = readProjectFile("media/config/assets/config-app-ui.js");
  assert.equal(uiSource.split("const CLI_GLOBAL_SKILL_TARGETS =").length, 2);
  const targetBlock = extractBetween(uiSource, "const CLI_GLOBAL_SKILL_TARGETS = [", "];");
  assert.equal(targetBlock, `const CLI_GLOBAL_SKILL_TARGETS = [
  { id: "claude", label: "Claude" },
  { id: "opencode", label: "OpenCode" },
  { id: "grok", label: "Grok" },
  { id: "codex", label: "Codex" },
  { id: "dsh", label: "DSH" },
  { id: "kimi-code", label: "kimi" },
`);
  const copyModal = extractBetween(uiSource, "const SkillsCopyModal =", "const SkillsMarketModal =");
  const marketModal = extractBetween(uiSource, "const SkillsMarketModal =", "const renderSkillRows =");
  assert.match(copyModal, /const targets = CLI_GLOBAL_SKILL_TARGETS\.filter\(\(item\) => item\.id !== platform\)/);
  assert.match(marketModal, /platforms: selectedTargets/);
  assert.match(marketModal, /\.\.\.CLI_GLOBAL_SKILL_TARGETS\.map\(\(target\) => be\.jsxs\("label"/);
  assert.match(marketModal, /CLI_GLOBAL_SKILL_TARGETS\.find\(\(target\) => target\.id === item\.platform\)/);
  assert.doesNotMatch(copyModal, /id: "claude"|apiKey|sk-[A-Za-z0-9]/);
  assert.doesNotMatch(marketModal, /id: "claude"|apiKey|sk-[A-Za-z0-9]/);

  const slice = uiSource.slice(uiSource.indexOf("const CLI_GLOBAL_SKILL_TARGETS ="), uiSource.indexOf("const SkillsManagerModal ="));
  const state: unknown[] = [];
  let cursor = 0;
  const effects: Array<() => void> = [];
  const copies: string[] = [];
  const installs: Array<Record<string, unknown>> = [];
  const element = (type: string, props: AnyRecord) => ({ type, props });
  const descendants = (node: AnyRecord): AnyRecord[] => {
    const children = [node.props.children].flat().filter((child) => child && typeof child === "object");
    return [node, ...children.flatMap(descendants)];
  };
  const sandbox = {
    Error,
    be: { jsx: element, jsxs: element },
    xr: "modal",
    xn: "button",
    Kt: { success: () => undefined, warning: () => undefined },
    searchLobehubSkills: async () => ({
      currentPage: 1,
      totalPages: 1,
      totalCount: 1,
      items: [{ identifier: "market-skill", name: "market-skill", description: "描述" }],
    }),
    installLobehubSkill: async (payload: Record<string, unknown>) => {
      installs.push(payload);
      return { targets: [{ platform: "dsh", name: "market-skill", status: "installed" }] };
    },
    window: { dispatchEvent: () => undefined },
    CustomEvent: class CustomEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    c: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value: unknown) => {
          state[index] = typeof value === "function" ? (value as (current: unknown) => unknown)(state[index]) : value;
        }];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = { current: initial };
        return state[index];
      },
      useEffect(effect: () => void) {
        if (effects.length === 0) effects.push(effect);
      },
    },
  };
  const components = vm.runInNewContext(`${slice}\n({ SkillsCopyModal, SkillsMarketModal })`, sandbox) as {
    SkillsCopyModal: (props: AnyRecord) => AnyRecord;
    SkillsMarketModal: (props: AnyRecord) => AnyRecord;
  };
  cursor = 0;
  const copyModalNode = components.SkillsCopyModal({
    skill: { name: "example-skill", path: "/skills/example-skill" },
    platform: "claude",
    onClose: () => undefined,
    onCopy: async (_item: unknown, platform: string) => {
      copies.push(platform);
    },
  });
  const copyLabels = descendants(copyModalNode)
    .filter((node) => node.type === "label")
    .map((node) => node.props.children[1].props.children);
  assert.deepEqual(copyLabels, ["OpenCode", "Grok", "Codex", "DSH", "kimi"]);
  const dshCopy = descendants(copyModalNode).find((node) => node.type === "label" && node.props.children[1].props.children === "DSH");
  assert.ok(dshCopy);
  dshCopy.props.children[0].props.onChange({ target: { checked: true } });
  cursor = 0;
  await components.SkillsCopyModal({
    skill: { name: "example-skill", path: "/skills/example-skill" },
    platform: "claude",
    onClose: () => undefined,
    onCopy: async (_item: unknown, platform: string) => {
      copies.push(platform);
    },
  }).props.onOk();
  assert.deepEqual(copies, ["dsh"]);

  state.length = 0;
  cursor = 0;
  const market = () => {
    cursor = 0;
    return components.SkillsMarketModal({ onClose: () => undefined });
  };
  market();
  effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  const listed = market();
  const download = descendants(listed).find((node) => node.type === "button" && node.props.children === "下载");
  assert.ok(download);
  download.props.onClick();
  const selected = market();
  const marketLabels = descendants(selected)
    .filter((node) => node.type === "label" && node.props.className === "skills-copy-target")
    .map((node) => node.props.children[1].props.children);
  assert.deepEqual(marketLabels, ["Claude", "OpenCode", "Grok", "Codex", "DSH", "kimi"]);
  const dshInstall = descendants(selected).find((node) => node.type === "label" && node.props.children[1].props.children === "DSH");
  assert.ok(dshInstall);
  dshInstall.props.children[0].props.onChange({ target: { checked: true } });
  const install = descendants(market()).find((node) => node.type === "button" && node.props.children === "安装");
  assert.ok(install);
  assert.equal(install.props.disabled, false);
  install.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(toPlain(installs), [{ identifier: "market-skill", platforms: ["dsh"] }]);
  assert.equal(JSON.stringify(installs).includes("apiKey"), false);
  assert.equal(JSON.stringify(copies).includes("sk-"), false);
});
