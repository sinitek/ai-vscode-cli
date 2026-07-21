import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../webview/viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../webview/viewContentScript/windowMessageDispatch";
import { TASKLIST_STYLES } from "../webview/viewContentStyles/tasklist";

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
  className: string;
  type: string;
  checked: boolean;
  disabled: boolean;
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
    className: "",
    type: "",
    checked: false,
    disabled: false,
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

test("renders OpenCode task updates in the active task-list overlay", () => {
  const functionSources = [
    "setTaskListItems",
    "shouldDisplayTaskListItems",
    "shouldDisplayTaskListForTab",
    "formatTaskListProgress",
    "renderTaskList",
    "normalizeTaskListStatus",
    "readTaskListDoneFromStatus",
    "normalizeTaskListItems",
    "applyExternalTaskListUpdate",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, name));
  const taskListState = {
    items: [] as Array<{ text: string; done: boolean }>,
    open: false,
    source: "auto",
    startIndex: 0,
  };
  const taskListPanel = createFakeElement();
  const taskListDetails = createFakeElement();
  const taskListCount = createFakeElement();
  const taskListBody = createFakeElement();
  const elements = {
    taskListPanel,
    taskListDetails,
    taskListCount,
    taskListBody,
  };
  const runtimeState = { messages: [{ role: "user", content: "run" }] };
  let running = true;
  const applyExternalTaskListUpdate = new Function(
    "elements",
    "document",
    "getActiveConversationTabId",
    "getTaskListState",
    "getConversationRuntimeState",
    "ensureRuntimeStateMessages",
    "resetTaskListState",
    "isRuntimeStateForActiveTab",
    "isTabRunning",
    "isConversationTabBusy",
    "state",
    `${functionSources.join("\n")}; return applyExternalTaskListUpdate;`,
  )(
    elements,
    { createElement: () => createFakeElement() },
    () => "tab-1",
    () => taskListState,
    () => runtimeState,
    (state: typeof runtimeState) => state.messages,
    (state: typeof taskListState, startIndex: number) => {
      state.items = [];
      state.open = false;
      state.source = "auto";
      state.startIndex = startIndex;
    },
    (tabId: string) => tabId === "tab-1",
    () => running,
    () => running,
    { isRunning: running },
  ) as (items: unknown[], tabId?: string) => Array<{ text: string; done: boolean }>;

  const normalized = applyExternalTaskListUpdate([
    { content: "读取日志", status: "completed" },
    { content: "修复浮层", status: "in_progress" },
    { content: "补充测试", status: "completed" },
    { content: "构建扩展", status: "pending" },
  ], "tab-1");

  assert.deepEqual(normalized, [
    { text: "读取日志", done: true },
    { text: "修复浮层", done: false },
    { text: "补充测试", done: true },
    { text: "构建扩展", done: false },
  ]);
  assert.equal(taskListState.source, "external");
  assert.equal(taskListState.open, true);
  assert.equal(taskListPanel.style.display, "block");
  assert.equal(taskListDetails.open, true);
  assert.equal(taskListCount.textContent, "2/4");
  assert.equal(taskListBody.children[0]?.children.length, 4);
  assert.equal(taskListBody.children[0]?.children[0]?.children[0]?.checked, true);

  taskListState.open = false;
  taskListDetails.open = false;
  applyExternalTaskListUpdate([
    { content: "读取日志", status: "completed" },
    { content: "修复浮层", status: "in_progress" },
    { content: "补充测试", status: "completed" },
    { content: "构建扩展", status: "pending" },
  ], "tab-1");
  assert.equal(taskListState.open, false);
  assert.equal(taskListDetails.open, false);
  assert.equal(taskListCount.textContent, "2/4");

  applyExternalTaskListUpdate([], "tab-1");

  assert.deepEqual(taskListState.items, []);
  assert.equal(taskListState.source, "auto");
  assert.equal(taskListPanel.style.display, "none");
  assert.equal(taskListDetails.open, false);

  applyExternalTaskListUpdate([
    { content: "读取日志", status: "completed" },
    { content: "修复浮层", status: "completed" },
  ], "tab-1");

  assert.deepEqual(taskListState.items, [
    { text: "读取日志", done: true },
    { text: "修复浮层", done: true },
  ]);
  assert.equal(taskListState.source, "external");
  assert.equal(taskListPanel.style.display, "block");
  assert.equal(taskListDetails.open, true);
  assert.equal(taskListCount.textContent, "2/2");
  assert.equal(taskListBody.children[0]?.children[0]?.children[0]?.checked, true);
  assert.equal(taskListBody.children[0]?.children[1]?.children[0]?.checked, true);

  running = false;
  applyExternalTaskListUpdate([
    { content: "迟到的待办更新", status: "pending" },
  ], "tab-1");

  assert.deepEqual(taskListState.items, []);
  assert.equal(taskListState.source, "auto");
  assert.equal(taskListState.startIndex, 1);
  assert.equal(taskListPanel.style.display, "none");
  assert.equal(taskListDetails.open, false);
});

test("renders a visible collapse icon in the task-list summary", () => {
  const html = buildWebviewStaticHtml({
    locale: "en",
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_I18N.en,
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });

  assert.match(
    html,
    /<summary>\s*<span class="tasklist-summary-title">\s*<span class="tasklist-toggle-icon" aria-hidden="true"><\/span>\s*<span>Task List<\/span>/,
  );
  assert.match(
    TASKLIST_STYLES,
    /\.tasklist-panel details\[open\] \.tasklist-toggle-icon\s*\{[\s\S]*transform:\s*rotate\(45deg\)/,
  );
});

test("preserves an external task list while its conversation tab is running", () => {
  const setMessagesForTabSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE,
    "setMessagesForTab",
  );
  const taskListState = {
    items: [{ text: "保持显示", done: false }],
    open: true,
    source: "external",
    startIndex: 1,
  };
  const runtimeState = {
    messages: [] as unknown[],
    taskList: taskListState,
  };
  let busy = true;
  let resetCount = 0;
  const setMessagesForTab = new Function(
    "getConversationRuntimeState",
    "updateLoopMetaForTabFromMessages",
    "ensureRuntimeTaskList",
    "isConversationTabBusy",
    "resetTaskListState",
    "hydrateRunArtifactsFromMessages",
    "isRuntimeStateForActiveTab",
    "state",
    "renderMessages",
    "renderConversationTabs",
    "reportWebviewFailure",
    `${setMessagesForTabSource}; return setMessagesForTab;`,
  )(
    () => runtimeState,
    () => false,
    (state: typeof runtimeState) => state.taskList,
    () => busy,
    (state: typeof taskListState) => {
      resetCount += 1;
      state.items = [];
      state.open = false;
      state.source = "auto";
      state.startIndex = 0;
    },
    () => undefined,
    () => false,
    { messages: [] },
    () => undefined,
    () => undefined,
    () => undefined,
  ) as (tabId: string, messages: unknown[], options?: { render?: boolean }) => void;

  setMessagesForTab("tab-1", [{ role: "trace" }], { render: false });
  assert.equal(resetCount, 0);
  assert.deepEqual(taskListState.items, [{ text: "保持显示", done: false }]);

  busy = false;
  setMessagesForTab("tab-1", [], { render: false });
  assert.equal(resetCount, 1);
  assert.deepEqual(taskListState.items, []);
});

test("uses trace metadata as a task-list overlay fallback", () => {
  const applyTraceSegmentSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING,
    "applyTraceSegment",
  );

  assert.match(
    applyTraceSegmentSource,
    /Array\.isArray\(data\.taskListItems\)[\s\S]*applyExternalTaskListUpdate\(data\.taskListItems, data\.tabId\)/,
  );
  assert.match(
    VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH,
    /data\.type === "taskListUpdate"[\s\S]*applyExternalTaskListUpdate\(data\.items, data\.tabId\)/,
  );
});
