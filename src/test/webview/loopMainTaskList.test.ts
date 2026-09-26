import * as assert from "node:assert/strict";
import { test } from "node:test";

import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = start + signature.length; index < source.length; index += 1) {
    if (source[index] === "(") {
      parameterDepth += 1;
    } else if (source[index] === ")") {
      parameterDepth -= 1;
    } else if (source[index] === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

type FakeElement = {
  style: Record<string, string>;
  open: boolean;
  textContent: string;
  innerHTML: string;
  children: FakeElement[];
  appendChild: (child: FakeElement) => void;
};

function createFakeElement(): FakeElement {
  const children: FakeElement[] = [];
  let innerHtml = "";
  return {
    style: {},
    open: false,
    textContent: "",
    children,
    get innerHTML() {
      return innerHtml;
    },
    set innerHTML(value: string) {
      innerHtml = value;
      children.splice(0, children.length);
    },
    appendChild(child: FakeElement) {
      children.push(child);
    },
  };
}

test("Loop and Loop+ main tabs do not keep or show a stale task list", () => {
  const tabs = new Map<string, { id: string; loopTaskRole?: string }>([
    ["main-tab", { id: "main-tab", loopTaskRole: "main" }],
    ["subtask-tab", { id: "subtask-tab", loopTaskRole: "subtask" }],
  ]);
  const taskListState = {
    items: [{ text: "旧清单：改无关模块", done: false }] as Array<{ text: string; done: boolean }>,
    open: true,
    source: "external",
    startIndex: 0,
  };
  const runtimeState = {
    messages: [
      { role: "assistant", content: "Tasklist:\n- [pending] 旧清单：改无关模块" },
    ] as unknown[],
    taskList: taskListState,
  };
  const taskListPanel = createFakeElement();
  taskListPanel.style.display = "block";
  const elements = {
    taskListPanel,
    taskListDetails: createFakeElement(),
    taskListCount: createFakeElement(),
    taskListBody: createFakeElement(),
  };
  const taskListSource = [
    "readConversationTabLoopTaskRole",
    "isLoopMainTaskListTab",
    "shouldDisplayTaskListForTab",
    "clearScheduledTaskListUpdate",
    "areTaskListItemsEqual",
    "setTaskListItems",
    "shouldDisplayTaskListItems",
    "formatTaskListProgress",
    "renderTaskList",
    "normalizeTaskListStatus",
    "readTaskListDoneFromStatus",
    "normalizeTaskListItems",
    "resetTaskListForRunStart",
    "closeTaskListForRunCompletion",
    "applyExternalTaskListUpdate",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, name)).join("\n");
  const api = new Function(
    "elements",
    "document",
    "getActiveConversationTabId",
    "getConversationTabSummary",
    "getTaskListState",
    "getConversationRuntimeState",
    "ensureRuntimeStateMessages",
    "resetTaskListState",
    "isRuntimeStateForActiveTab",
    "isTabRunning",
    "isConversationTabBusy",
    "state",
    `let taskListTextUpdateTimer = null;\n${taskListSource}\nreturn { shouldDisplayTaskListForTab, applyExternalTaskListUpdate, isLoopMainTaskListTab };`,
  )(
    elements,
    { createElement: () => createFakeElement() },
    () => "main-tab",
    (tabId: string) => tabs.get(tabId) ?? null,
    () => taskListState,
    () => runtimeState,
    (state: typeof runtimeState) => state.messages,
    (state: typeof taskListState, startIndex = 0) => {
      state.items = [];
      state.open = false;
      state.source = "auto";
      state.startIndex = startIndex;
    },
    () => true,
    () => true,
    () => true,
    { isRunning: true, messages: runtimeState.messages },
  ) as {
    shouldDisplayTaskListForTab: (tabId: string) => boolean;
    applyExternalTaskListUpdate: (items: unknown[], tabId?: string) => unknown[];
    isLoopMainTaskListTab: (tabId: string) => boolean;
  };

  assert.equal(api.isLoopMainTaskListTab("main-tab"), true);
  assert.equal(api.shouldDisplayTaskListForTab("main-tab"), false);
  assert.equal(api.shouldDisplayTaskListForTab("subtask-tab"), true);

  api.applyExternalTaskListUpdate([
    { text: "旧清单：改无关模块", done: false },
    { text: "另一件旧事项", done: false },
  ], "main-tab");
  assert.deepEqual(taskListState.items, []);
  assert.equal(taskListState.source, "auto");
  assert.equal(taskListPanel.style.display, "none");

  taskListState.items = [{ text: "保持到子任务", done: false }];
  taskListState.source = "external";
  taskListState.open = true;
  api.applyExternalTaskListUpdate([
    { text: "子任务当前事项", done: false },
  ], "subtask-tab");
  assert.equal(taskListState.source, "external");
  assert.deepEqual(taskListState.items, [{ text: "子任务当前事项", done: false }]);

  const setMessagesForTab = new Function(
    "getConversationRuntimeState",
    "updateLoopMetaForTabFromMessages",
    "updateGraphMetaForTabFromMessages",
    "ensureRuntimeTaskList",
    "isConversationTabBusy",
    "isLoopMainTaskListTab",
    "resetTaskListState",
    "hydrateRunArtifactsFromMessages",
    "isRuntimeStateForActiveTab",
    "state",
    "renderMessages",
    "renderConversationTabs",
    "reportWebviewFailure",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "setMessagesForTab")}; return setMessagesForTab;`,
  )(
    () => runtimeState,
    () => false,
    () => false,
    (state: typeof runtimeState) => state.taskList,
    () => true,
    (tabId: string) => tabId === "main-tab",
    (state: typeof taskListState, startIndex = 0) => {
      state.items = [];
      state.open = false;
      state.source = "auto";
      state.startIndex = startIndex;
    },
    () => undefined,
    () => false,
    { messages: [] },
    () => undefined,
    () => undefined,
    () => undefined,
  ) as (tabId: string, messages: unknown[], options?: { render?: boolean }) => void;

  taskListState.items = [{ text: "父任务仍忙时的旧列表", done: false }];
  taskListState.open = true;
  taskListState.source = "external";
  setMessagesForTab("main-tab", [{ role: "assistant", content: "继续编排" }], { render: false });
  assert.deepEqual(taskListState.items, []);
  assert.equal(taskListState.source, "auto");

  taskListState.items = [{ text: "普通运行中的列表", done: false }];
  taskListState.open = true;
  taskListState.source = "external";
  setMessagesForTab("subtask-tab", [{ role: "assistant", content: "继续子任务" }], { render: false });
  assert.deepEqual(taskListState.items, [{ text: "普通运行中的列表", done: false }]);
  assert.equal(taskListState.source, "external");
});
