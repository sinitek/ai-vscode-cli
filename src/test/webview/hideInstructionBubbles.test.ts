import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "../../webview/viewContentScript/coreBootstrap";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";

type Message = { id: string; role: string; kind?: string; actions?: unknown[]; final?: boolean };
type Entry = { message: Message; index: number };

function functionSource(name: string): string {
  const match = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.match(new RegExp(`function ${name}\\([^]*?\\n      \\}`));
  assert.ok(match, `Missing runtime helper ${name}`);
  return match[0];
}

function createHarness() {
  const messages: Message[] = [
    { id: "user", role: "user" },
    { id: "command", role: "trace", kind: "tool-use" },
    { id: "result", role: "trace", kind: "tool-result" },
    { id: "progress", role: "assistant" },
    { id: "thinking", role: "assistant", kind: "thinking" },
    { id: "final", role: "assistant", final: true },
    { id: "system", role: "system" },
    { id: "interaction", role: "assistant", actions: [{ type: "confirm" }] },
    { id: "subagent-command", role: "trace", kind: "tool-use" },
  ];
  const state = { messages, hideInstructionBubbles: false, onlyShowFinalResults: false };
  const retainedInputs: Entry[][] = [];
  const context = vm.createContext({
    state,
    normalizeMessageActions: (message: Message) => message.actions || [],
    isFinalAssistantSummaryMessage: (index: number) => state.messages[index]?.final === true,
    isThinkingBubbleMessage: (message: Message) => message.kind === "thinking",
    getBaseChatBubbleEntries: () => state.messages.map((message, index) => ({ message, index })),
    retainChatBubbleEntries: (entries: Entry[]) => { retainedInputs.push(entries); return entries; },
    shouldShowMessageInResultOnlyMode: (message: Message) => message.role === "user" || message.final === true,
  });
  vm.runInContext([functionSource("isInstructionBubble"), functionSource("getVisibleMessages")].join("\n"), context);
  const visible = () => Array.from(vm.runInContext("getVisibleMessages()", context) as Entry[], ({ message }) => message.id);
  return { state, visible, retainedInputs };
}

test("instruction bubble toggle is unchecked and placed inside AI task settings", () => {
  const html = buildWebviewStaticHtml({
    cspSource: "vscode-resource://test", nonce: "test", i18n: getWebviewStrings(),
    cliOptions: "", markedScript: "", webviewStyles: "",
  });
  const input = html.match(/<input[^>]*id="hideInstructionBubbles"[^>]*>/g);
  assert.equal(input?.length, 1);
  assert.match(input![0], /type="checkbox"/);
  assert.match(input![0], /aria-label="隐藏指令气泡"/);
  assert.match(input![0], /aria-describedby="hideInstructionBubblesNote"/);
  assert.doesNotMatch(input![0], /\bchecked\b/);
  const position = html.indexOf('id="hideInstructionBubbles"');
  assert.ok(position > html.indexOf('id="toolSettingsAiTaskPanel"'));
  assert.ok(position < html.indexOf('id="toolSettingsWorkspacePanel"'));
  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /hideInstructionBubbles: false/);
  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /hideInstructionBubbles: document.getElementById\("hideInstructionBubbles"\)/);
});

test("toggle hides all instruction types without changing retention or message history", () => {
  const harness = createHarness();
  const original = JSON.stringify(harness.state.messages);
  const allIds = harness.state.messages.map((message) => message.id);
  assert.deepEqual(harness.visible(), allIds);
  harness.state.hideInstructionBubbles = true;
  assert.deepEqual(harness.visible(), ["user", "thinking", "final", "system", "interaction"]);
  assert.deepEqual(harness.retainedInputs.at(-1)?.map(({ message }) => message.id), allIds);
  assert.equal(JSON.stringify(harness.state.messages), original);
  harness.state.hideInstructionBubbles = false;
  assert.deepEqual(harness.visible(), allIds);
});

test("hidden instructions stay hidden for incoming history and tab changes and respect result-only mode", () => {
  const harness = createHarness();
  harness.state.hideInstructionBubbles = true;
  harness.state.messages.push({ id: "new-command", role: "trace", kind: "tool-use" });
  assert.ok(!harness.visible().includes("new-command"));
  harness.state.onlyShowFinalResults = true;
  assert.deepEqual(harness.visible(), ["user", "final"]);
  harness.state.onlyShowFinalResults = false;
  harness.state.messages = [{ id: "other-tab-command", role: "trace" }];
  assert.deepEqual(harness.visible(), []);
  harness.state.hideInstructionBubbles = false;
  assert.deepEqual(harness.visible(), ["other-tab-command"]);
  harness.state.messages = [];
  assert.deepEqual(harness.visible(), []);
});

test("checkbox changes immediately rerender and post the global setting", () => {
  let change: ((event: { target: { checked: boolean } }) => void) | undefined;
  const state = { hideInstructionBubbles: false };
  const messages: unknown[] = [];
  const renders: unknown[] = [];
  const elements = { hideInstructionBubbles: { addEventListener: (_name: string, listener: typeof change) => { change = listener; } } };
  const start = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("if (elements.hideInstructionBubbles)");
  const end = VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.indexOf("bindCliEnabledToggles();", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    state, elements, renderMessages: (options: unknown) => renders.push(options),
    vscode: { postMessage: (message: unknown) => messages.push(message) },
  });
  vm.runInContext(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.slice(start, end), context);
  assert.ok(change);
  for (const enabled of [true, false]) {
    change({ target: { checked: enabled } });
    assert.equal(state.hideInstructionBubbles, enabled);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [true, false].map((value) => ({ type: "updateSetting", key: "hideInstructionBubbles", value })));
  assert.deepEqual(JSON.parse(JSON.stringify(renders)), [{ incremental: true }, { incremental: true }]);
  vm.runInContext(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS.slice(start, end), vm.createContext({ elements: {} }));
});

test("panel snapshots restore checkbox state and safely default old or invalid values to off", () => {
  const assignment = VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE.match(/state\.hideInstructionBubbles = [^;]+;/);
  const checkbox = VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE.match(/if \(elements\.hideInstructionBubbles\) \{[^]*?\n        \}/);
  assert.ok(assignment && checkbox);
  assert.ok(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE.indexOf(assignment[0]) < VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE.indexOf("syncActiveMessagesFromRuntime();"));
  const state = { hideInstructionBubbles: true };
  const elements = { hideInstructionBubbles: { checked: true } };
  for (const value of [true, false, undefined, null, "true", "false", 1]) {
    vm.runInNewContext(`${assignment[0]}\n${checkbox[0]}`, { state, elements, panelState: { hideInstructionBubbles: value } });
    assert.equal(state.hideInstructionBubbles, value === true);
    assert.equal(elements.hideInstructionBubbles.checked, value === true);
  }
  vm.runInNewContext(checkbox[0], { state, elements: {} });
});
