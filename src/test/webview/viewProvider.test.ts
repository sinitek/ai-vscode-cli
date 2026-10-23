import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type * as vscode from "vscode";
import { installVscodeMock } from "../vscodeMock";
import type { PanelMessage } from "../../webview/types";

installVscodeMock();

import { CliBridgeViewProvider } from "../../webview/viewProvider";

function createViewHarness() {
  const posted: unknown[] = [];
  let messageHandler: (message: PanelMessage) => void | Promise<void> = () => undefined;
  let disposeHandler: () => void = () => undefined;
  const view = {
    webview: {
      cspSource: "vscode-resource://reference-test",
      html: "",
      options: {},
      onDidReceiveMessage(handler: typeof messageHandler) {
        messageHandler = handler;
        return { dispose: () => undefined };
      },
      postMessage(payload: unknown) {
        posted.push(payload);
        return Promise.resolve(true);
      },
    },
    onDidDispose(handler: () => void) {
      disposeHandler = handler;
      return { dispose: () => undefined };
    },
    show: () => undefined,
  } as unknown as vscode.WebviewView;
  return {
    view,
    posted,
    receive: (message: PanelMessage) => messageHandler(message),
    dispose: () => disposeHandler(),
  };
}

function createProvider(messages: PanelMessage[] = []) {
  return new CliBridgeViewProvider({ fsPath: process.cwd() } as vscode.Uri, {
    onMessage: (message) => { messages.push(message); },
  });
}

test("buffers references before the view and script are ready and flushes only once", () => {
  const messages: PanelMessage[] = [];
  const provider = createProvider(messages);
  const harness = createViewHarness();
  provider.insertPromptPaths(["src/app.ts"]);
  provider.resolveWebviewView(harness.view);
  provider.insertPromptPaths(["src"]);
  assert.deepEqual(harness.posted, []);
  harness.receive({ type: "requestState" });
  harness.receive({ type: "requestState" });
  assert.deepEqual(harness.posted, [{ type: "insertPromptPaths", paths: ["src/app.ts", "src"] }]);
  assert.equal(messages.length, 2);
});

test("inserts references immediately into a ready webview and ignores empty paths", () => {
  const provider = createProvider();
  const harness = createViewHarness();
  provider.resolveWebviewView(harness.view);
  harness.receive({ type: "requestState" });
  provider.insertPromptPaths([]);
  provider.insertPromptPaths(["my folder/项目.ts"]);
  assert.deepEqual(harness.posted, [{ type: "insertPromptPaths", paths: ["my folder/项目.ts"] }]);
});

test("buffers references after reload until the new script requests state", () => {
  const provider = createProvider();
  const harness = createViewHarness();
  provider.resolveWebviewView(harness.view);
  harness.receive({ type: "requestState" });
  provider.reload();
  provider.insertPromptPaths(["src/reloaded.ts"]);
  harness.receive({ type: "sendPrompt", prompt: "hello" });
  assert.deepEqual(harness.posted, []);
  harness.receive({ type: "requestState" });
  assert.deepEqual(harness.posted, [{ type: "insertPromptPaths", paths: ["src/reloaded.ts"] }]);
});

test("preserves pending references across disposal and ignores stale view messages", () => {
  const provider = createProvider();
  const previous = createViewHarness();
  provider.resolveWebviewView(previous.view);
  previous.receive({ type: "requestState" });
  previous.dispose();
  provider.insertPromptPaths(["src/new-view.ts"]);
  const current = createViewHarness();
  provider.resolveWebviewView(current.view);
  previous.receive({ type: "requestState" });
  assert.deepEqual(previous.posted, []);
  assert.deepEqual(current.posted, []);
  current.receive({ type: "requestState" });
  assert.deepEqual(current.posted, [{ type: "insertPromptPaths", paths: ["src/new-view.ts"] }]);
});

test("opens and reuses a script-disabled editor preview for local files, URLs and SVG data", async () => {
  const vscodeApi = require("vscode") as typeof import("vscode");
  const previousCreate = vscodeApi.window.createWebviewPanel;
  const opened: Array<{ options: unknown; column: unknown; panel: vscode.WebviewPanel; dispose: () => void }> = [];
  vscodeApi.window.createWebviewPanel = ((_type: string, _title: string, column: unknown, options: unknown) => {
    let dispose: () => void = () => undefined;
    const panel = {
      webview: { html: "" },
      reveal: () => undefined,
      onDidDispose: (handler: () => void) => { dispose = handler; },
    } as unknown as vscode.WebviewPanel;
    opened.push({ options, column, panel, dispose: () => dispose() });
    return panel;
  }) as typeof vscodeApi.window.createWebviewPanel;
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "chat-preview-test-"));
  try {
    const messages: PanelMessage[] = [];
    const provider = createProvider(messages);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);
    await harness.receive({ type: "previewChatImage", source: pathToFileURL(path.join(directory, "missing.png")).href });
    await harness.receive({ type: "previewChatImage", source: "javascript:alert(1)" });
    assert.equal(opened.length, 0);
    await harness.receive({ type: "previewChatImage", source: "https://example.com/first.png", alt: "第一张" });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].column, vscodeApi.ViewColumn.Active);
    assert.deepEqual(opened[0].options, { enableScripts: false, localResourceRoots: [] });
    assert.match(opened[0].panel.webview.html, /第一张/);
    await harness.receive({ type: "previewChatImage", source: "https://example.com/second.png", alt: "第二张" });
    assert.equal(opened.length, 1);
    assert.match(opened[0].panel.webview.html, /second.png/);
    await harness.receive({ type: "previewChatImage", source: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text y="25">中文图示</text></svg>'), alt: "SVG 图示" });
    assert.equal(opened.length, 1);
    assert.match(opened[0].panel.webview.html, /data:image\/svg\+xml,/);
    assert.doesNotMatch(opened[0].panel.webview.html, /<svg/);
    const localPath = path.join(directory, "本地.svg");
    await fs.promises.writeFile(localPath, '<svg viewBox="0 0 120 60"><text y="20">本地图片</text></svg>');
    await harness.receive({ type: "previewChatImage", source: pathToFileURL(localPath).href, alt: "本地图片" });
    assert.equal(opened.length, 1);
    assert.match(opened[0].panel.webview.html, /data:image\/svg\+xml,/);
    assert.doesNotMatch(opened[0].panel.webview.html, /src="file:/);
    const olderRequest = harness.receive({ type: "previewChatImage", source: localPath, alt: "过期预览" });
    await harness.receive({ type: "previewChatImage", source: "https://example.com/latest.png", alt: "最新预览" });
    await olderRequest;
    assert.match(opened[0].panel.webview.html, /latest.png/);
    assert.doesNotMatch(opened[0].panel.webview.html, /过期预览/);
    assert.deepEqual(messages, []);
    opened[0].dispose();
    await harness.receive({ type: "previewChatImage", source: "https://example.com/third.png" });
    assert.equal(opened.length, 2);
  } finally {
    vscodeApi.window.createWebviewPanel = previousCreate;
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("resolves local resources and saves original SVG bytes through the native save dialog", async () => {
  const vscodeApi = require("vscode") as typeof import("vscode");
  const previousSave = vscodeApi.window.showSaveDialog;
  const previousFs = vscodeApi.workspace.fs;
  const previousFolders = vscodeApi.workspace.workspaceFolders;
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "chat-download-test-"));
  const saved: Array<{ uri: unknown; bytes: Uint8Array }> = [];
  const dialogs: vscode.SaveDialogOptions[] = [];
  let canceled = false;
  const destination = { fsPath: path.join(directory, "保存.svg") } as vscode.Uri;
  vscodeApi.window.showSaveDialog = async (options) => { dialogs.push(options!); return canceled ? undefined : destination; };
  Object.defineProperty(vscodeApi.workspace, "fs", { configurable: true, value: {
    writeFile: async (uri: unknown, bytes: Uint8Array) => { saved.push({ uri, bytes }); },
  } });
  Object.defineProperty(vscodeApi.workspace, "workspaceFolders", { configurable: true, value: [{ uri: { fsPath: directory } }] });
  try {
    const svg = '<svg viewBox="0 0 160 80"><text y="25">下载图示</text></svg>';
    await fs.promises.writeFile(path.join(directory, "图示.svg"), svg);
    const messages: PanelMessage[] = [];
    const provider = createProvider(messages);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);
    await harness.receive({ type: "resolveChatImage", source: "图示.svg" });
    assert.equal((harness.posted[0] as { type: string }).type, "chatImageResolved");
    assert.match((harness.posted[0] as { resolvedSource: string }).resolvedSource, /^data:image\/svg\+xml,/);
    await harness.receive({ type: "resolveChatImage", source: "missing.png" });
    assert.match((harness.posted[1] as { error: string }).error, /无法加载本地图片/);
    await harness.receive({ type: "downloadChatImage", source: "图示.svg" });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].uri, destination);
    assert.equal(Buffer.from(saved[0].bytes).toString(), svg);
    assert.deepEqual(dialogs[0].filters, { "SVG 图片": ["svg"] });
    assert.match(dialogs[0].defaultUri!.fsPath, /图示.svg$/);
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");
    await harness.receive({ type: "downloadChatImage", source: "data:image/png;base64," + pixel.toString("base64") });
    assert.equal(saved.length, 2);
    assert.deepEqual(Buffer.from(saved[1].bytes), pixel);
    assert.deepEqual(dialogs[1].filters, { "图片": ["png"] });
    canceled = true;
    await harness.receive({ type: "downloadChatImage", source: "data:image/svg+xml," + encodeURIComponent(svg) });
    assert.equal(dialogs.length, 3);
    assert.equal(saved.length, 2);
    await harness.receive({ type: "downloadChatImage", source: "javascript:alert(1)" });
    assert.equal(dialogs.length, 3);
    assert.deepEqual(messages, []);
    const staleResolve = harness.receive({ type: "resolveChatImage", source: "图示.svg" });
    harness.dispose();
    await staleResolve;
    assert.equal(harness.posted.length, 2);
  } finally {
    vscodeApi.window.showSaveDialog = previousSave;
    Object.defineProperty(vscodeApi.workspace, "fs", { configurable: true, value: previousFs });
    Object.defineProperty(vscodeApi.workspace, "workspaceFolders", { configurable: true, value: previousFolders });
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
