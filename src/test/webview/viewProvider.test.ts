import * as assert from "node:assert/strict";
import { test } from "node:test";
import type * as vscode from "vscode";
import { installVscodeMock } from "../vscodeMock";
import type { PanelMessage } from "../../webview/types";

installVscodeMock();

import { CliBridgeViewProvider } from "../../webview/viewProvider";

function createViewHarness() {
  const posted: unknown[] = [];
  let messageHandler: (message: PanelMessage) => void = () => undefined;
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
