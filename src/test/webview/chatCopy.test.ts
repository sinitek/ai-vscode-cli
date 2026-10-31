import assert = require("node:assert/strict");
import test = require("node:test");

import { CHAT_COPY_SCRIPT } from "../../webview/chatCopy";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildWebviewRuntimeScript } = require("../../webview/viewContentScript") as typeof import("../../webview/viewContentScript");
const { buildLoopGroupChatPanelHtml } = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");
const { WEBVIEW_STRINGS } = require("../../webview/viewContentStrings") as typeof import("../../webview/viewContentStrings");

test("copies selected chat text through the Webview copy event", () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const clipboard: Array<[string, string]> = [];
  const chatRoot = {
    closest(selector: string): unknown {
      return selector.includes("#messages") ? this : null;
    },
  };
  const selection = {
    anchorNode: { nodeType: 3, parentElement: chatRoot },
    isCollapsed: false,
    toString: () => "selected assistant reply",
  };
  const window = {
    getSelection: () => selection,
    addEventListener(type: string, listener: (event: any) => void): void {
      (listeners[type] ||= []).push(listener);
    },
  };
  const runtime = new Function("window", "navigator", "document", CHAT_COPY_SCRIPT);
  runtime(window, {}, {});

  const event = {
    clipboardData: {
      setData(type: string, value: string): void {
        clipboard.push([type, value]);
      },
    },
    defaultPrevented: false,
    preventDefault(): void {
      this.defaultPrevented = true;
    },
  };
  listeners.copy?.forEach((listener) => listener(event));

  assert.deepEqual(clipboard, [["text/plain", "selected assistant reply"]]);
  assert.equal(event.defaultPrevented, true);
});

test("uses the native selection copy without creating a focus-stealing input", () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const copyCommands: string[] = [];
  const chatRoot = {
    closest(selector: string): unknown {
      return selector.includes("#messages") ? this : null;
    },
  };
  const selection = {
    anchorNode: { nodeType: 3, parentElement: chatRoot },
    isCollapsed: false,
    toString: () => "selected assistant reply",
  };
  const window = {
    getSelection: () => selection,
    addEventListener(type: string, listener: (event: any) => void): void {
      (listeners[type] ||= []).push(listener);
    },
  };
  const document = {
    createElement(): never {
      throw new Error("copy should not create a focusable element");
    },
    execCommand(command: string): boolean {
      copyCommands.push(command);
      return true;
    },
  };
  const runtime = new Function("window", "navigator", "document", CHAT_COPY_SCRIPT);
  runtime(window, {}, document);

  const event = {
    defaultPrevented: false,
    preventDefault(): void {
      this.defaultPrevented = true;
    },
  };
  listeners.copy?.forEach((listener) => listener(event));

  assert.deepEqual(copyCommands, ["copy"]);
  assert.equal(event.defaultPrevented, true);
});

test("preserves native copy when the selection fallback is unavailable", () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const chatRoot = {
    closest(selector: string): unknown {
      return selector.includes("#messages") ? this : null;
    },
  };
  const window = {
    getSelection: () => ({
      anchorNode: { nodeType: 3, parentElement: chatRoot },
      isCollapsed: false,
      toString: () => "selected assistant reply",
    }),
    addEventListener(type: string, listener: (event: any) => void): void {
      (listeners[type] ||= []).push(listener);
    },
  };
  const runtime = new Function("window", "navigator", "document", CHAT_COPY_SCRIPT);
  runtime(window, {}, {
    execCommand(): boolean {
      throw new Error("copy unavailable");
    },
  });

  const event = {
    defaultPrevented: false,
    preventDefault(): void {
      this.defaultPrevented = true;
    },
  };
  assert.doesNotThrow(() => listeners.copy?.forEach((listener) => listener(event)));
  assert.equal(event.defaultPrevented, false);
});

test("copies the last chat selection after the prompt takes focus", () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const clipboard: Array<[string, string]> = [];
  const chatRoot = {
    closest(selector: string): unknown {
      return selector.includes("#messages") ? this : null;
    },
  };
  const chatSelection = {
    anchorNode: { nodeType: 3, parentElement: chatRoot },
    isCollapsed: false,
    toString: () => "气泡里需要复制的文字",
  };
  const collapsedInputSelection = { anchorNode: null, isCollapsed: true, toString: () => "" };
  let currentSelection: typeof chatSelection | typeof collapsedInputSelection = chatSelection;
  const window = {
    getSelection: () => currentSelection,
    addEventListener(type: string, listener: (event: any) => void): void {
      (listeners[type] ||= []).push(listener);
    },
  };
  const runtime = new Function("window", "navigator", "document", CHAT_COPY_SCRIPT);
  runtime(window, {}, {});

  listeners.mouseup?.forEach((listener) => listener({}));
  currentSelection = collapsedInputSelection;
  const event = {
    target: { tagName: "TEXTAREA" },
    clipboardData: {
      setData(type: string, value: string): void {
        clipboard.push([type, value]);
      },
    },
    preventDefault(): void {},
  };
  listeners.copy?.forEach((listener) => listener(event));

  assert.deepEqual(clipboard, [["text/plain", "气泡里需要复制的文字"]]);

  const nativeInputEvent = {
    target: { tagName: "TEXTAREA", selectionStart: 0, selectionEnd: 3 },
    clipboardData: {
      setData(): void {
        throw new Error("native input copy should not be replaced");
      },
    },
    preventDefault(): void {},
  };
  listeners.copy?.forEach((listener) => listener(nativeInputEvent));
});

test("injects the copy handler into both chat Webviews", () => {
  const mainScript = buildWebviewRuntimeScript({
    i18n: WEBVIEW_STRINGS,
    cliList: ["codex", "claude", "opencode"],
    loopMaxRoundsDefault: 5,
    loopMaxRoundsMin: 1,
    loopMaxRoundsMax: 12,
    loopSubtaskMaxThinkingModeDefault: "high",
    finalAnswerTextMarker: "<FINAL>",
  });
  const groupPanel = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, {
    task: {
      id: "copy-task",
      cli: "codex",
      status: "completed",
      rootPrompt: "copy",
      taskStoreFile: "/tmp/copy-task.json",
      mainCommunicationFile: "/tmp/copy-task.md",
      currentRound: 1,
      updatedAt: 1,
      canSupplement: false,
      canContinue: false,
      canStop: false,
    },
    rounds: [],
    chatMarkdown: "assistant reply",
  });

  assert.match(mainScript, /function handleChatCopy\(event\)/u);
  assert.match(groupPanel, /function handleChatCopy\(event\)/u);
  assert.match(groupPanel, /window\.addEventListener\("copy", handleChatCopy\)/u);
});
