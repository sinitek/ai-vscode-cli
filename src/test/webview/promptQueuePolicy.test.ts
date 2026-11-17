import test = require("node:test");
import assert = require("node:assert/strict");
import vm = require("node:vm");
import ts = require("typescript");
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE as core } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE as queue } from "../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI as ui } from "../../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS as overlays } from "../../webview/viewContentScript/settingsAndOverlays";
import { createPromptPanelMessageHandlers } from "../../panelMessageHandlers/prompt";

function functions(source: string, names: string[]): string {
  const syntax = ts.createSourceFile("webview.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return syntax.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""))
    .map((node) => node.getText(syntax)).join("\n");
}

function harness() {
  const posted: Array<{ type: string; hasPendingPrompts?: boolean }> = [];
  const runtime = { pendingPromptQueue: [] as any[], queueEditingIndex: -1, overlays: {}, pendingRunPrompt: null as any };
  const tabs: Record<string, any> = { active: { id: "active", cli: "codex" }, background: { id: "background", cli: "codex" } };
  const context: Record<string, any> = {
    state: { currentCli: "codex", interactiveMode: "coding" },
    conversationRuntimeByTabId: { active: runtime },
    TAB_RUNTIME_DEFAULT_KEY: "__default__", runningTabStartedAtById: {}, erroredTabIds: new Set(), loopMetaByTabId: {},
    vscode: { postMessage: (message: any) => posted.push(message) },
    getActiveConversationTabId: () => "active",
    getConversationTabSummary: (id: string) => tabs[id],
    getLoopMetaForTabSummary: (tab: any) => tab?.loopTaskRole ? { taskRole: tab.loopTaskRole } : null,
    getActiveConversationRuntimeState: () => runtime,
    getConversationRuntimeState: (id: string) => context.conversationRuntimeByTabId[id],
    normalizeInteractiveMode: (mode: string) => mode || "coding",
    snapshotPromptPayloadForQueue: (payload: any) => payload,
    normalizePromptPayload: (payload: any) => payload,
    elements: { promptInput: { value: "保留草稿" }, runConflictOverlay: { classList: { toggle: () => undefined } }, queuePrompt: { disabled: false, title: "" } },
    updateRunWait: () => undefined, showToast: () => undefined, t: (key: string) => key,
    isRuntimeStateForActiveTab: (id: string) => id === "active", isConversationTabBusy: () => false,
    resetTaskListState: () => undefined, ensureRuntimeTaskList: () => ({}), ensureRuntimeStateMessages: () => [],
    syncActiveMessagesFromRuntime: () => undefined, syncConversationControlsForActiveTab: () => undefined,
    resetPromptContextForNextPrompt: () => undefined,
    dispatchPrompt: () => { posted.push({ type: "sendPrompt" }); return true; },
  };
  vm.createContext(context);
  vm.runInContext([
    functions(core, ["syncPendingPromptQueueState", "pruneConversationRuntimeStates", "resetConversationRuntimeState"]),
    functions(queue, ["canQueuePrompt", "queuePromptForLater", "updateQueueIndicator", "clearQueuedPromptIndex", "flushPendingPromptQueue"]),
    functions(ui, ["syncRunConflictOverlay", "closeRunConflictOverlay"]),
    functions(overlays, ["queueConflictPromptForLater"]),
  ].join("\n"), context);
  return { context, runtime, tabs, posted };
}

test("only Vibe payloads on ordinary tabs can enter the queue, including after a mode switch", () => {
  const env = harness();
  for (const mode of ["loop", "loop_plus"]) {
    env.context.state.interactiveMode = mode;
    assert.equal(env.context.queuePromptForLater({ prompt: "拒绝" }), false);
    env.context.state.interactiveMode = "coding";
    assert.equal(env.context.queuePromptForLater({ prompt: "拒绝快照", interactiveMode: mode }), false);
  }
  for (const role of ["main", "subtask"]) {
    env.tabs.active.loopTaskRole = role;
    assert.equal(env.context.queuePromptForLater({ prompt: "拒绝", interactiveMode: "coding" }), false);
  }
  assert.equal(env.runtime.pendingPromptQueue.length, 0);
  assert.equal(env.posted.length, 0);
  delete env.tabs.active.loopTaskRole;
  assert.equal(env.context.queuePromptForLater({ prompt: "正常排队" }), true);
  assert.equal(env.runtime.pendingPromptQueue.length, 1);
  assert.equal(env.posted.some((event) => event.type === "pendingPromptQueueChanged" && event.hasPendingPrompts), true);
});

test("the conflict queue button disables for Loop roles and rejected enqueue preserves input and payload", () => {
  const env = harness();
  env.tabs.active.loopTaskRole = "subtask";
  env.runtime.pendingRunPrompt = { prompt: "保留草稿", interactiveMode: "coding" };
  env.context.syncRunConflictOverlay();
  assert.equal(env.context.elements.queuePrompt.disabled, true);
  assert.equal(env.context.queueConflictPromptForLater(), false);
  assert.equal(env.context.elements.promptInput.value, "保留草稿");
  assert.equal(env.runtime.pendingRunPrompt.prompt, "保留草稿");
  delete env.tabs.active.loopTaskRole;
  env.context.syncRunConflictOverlay();
  assert.equal(env.context.elements.queuePrompt.disabled, false);
  assert.equal(env.context.queueConflictPromptForLater(), true);
  assert.equal(env.context.elements.promptInput.value, "");
});

test("all tabs contribute queue state and background dequeue synchronizes before dispatch", () => {
  const env = harness();
  env.context.conversationRuntimeByTabId.background = { pendingPromptQueue: [{ prompt: "后台", interactiveMode: "coding" }], queueEditingIndex: -1 };
  env.context.syncPendingPromptQueueState();
  assert.equal(env.posted.at(-1)?.hasPendingPrompts, true);
  env.context.state.interactiveMode = "loop_plus";
  env.context.flushPendingPromptQueue("background");
  env.context.state.interactiveMode = "coding";
  assert.deepEqual(JSON.parse(JSON.stringify(env.posted.slice(-2))), [{ type: "pendingPromptQueueChanged", hasPendingPrompts: false }, { type: "sendPrompt" }]);
  env.context.queuePromptForLater({ prompt: "删除" });
  env.context.clearQueuedPromptIndex(0);
  assert.equal(env.posted.at(-1)?.hasPendingPrompts, false);
  Object.assign(env.runtime, { runStreamRecords: [], runStreamOpenRecordIds: new Set() });
  env.context.queuePromptForLater({ prompt: "重置" });
  env.context.resetConversationRuntimeState("active");
  assert.equal(env.posted.at(-1)?.hasPendingPrompts, false);
  env.context.conversationRuntimeByTabId.background.pendingPromptQueue.push({ prompt: "关页" });
  env.context.pruneConversationRuntimeStates(["active"]);
  assert.equal(env.posted.at(-1)?.hasPendingPrompts, false);
});

test("queue snapshots with Loop payloads or Loop target tabs cannot dispatch", () => {
  const env = harness();
  env.runtime.pendingPromptQueue.push({ prompt: "旧队列", interactiveMode: "loop_plus" });
  assert.equal(env.context.flushPendingPromptQueue("active"), false);
  env.runtime.pendingPromptQueue[0].interactiveMode = "coding";
  env.tabs.active.loopTaskRole = "main";
  assert.equal(env.context.flushPendingPromptQueue("active"), false);
  assert.equal(env.runtime.pendingPromptQueue.length, 1);
});

test("queue message handler accepts only booleans without refreshing or executing tasks", () => {
  const values: boolean[] = [];
  const handlers = createPromptPanelMessageHandlers({ updatePendingPromptQueueState: (value: boolean) => values.push(value) } as any);
  for (const value of [true, false, "true", null, 1]) {
    handlers.pendingPromptQueueChanged!({ type: "pendingPromptQueueChanged", hasPendingPrompts: value } as any);
  }
  assert.deepEqual(values, [true, false]);
});
