import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";
import { TASKLIST_STYLES } from "../../webview/viewContentStyles/tasklist";
import { INPUT_CONTROLS_STYLES } from "../../webview/viewContentStyles/inputControls";

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
  scrollTop: number;
  children: FakeElement[];
  appendChild: (child: FakeElement) => void;
  removeChild: (child: FakeElement) => void;
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
    scrollTop: 0,
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
    removeChild(child: FakeElement) {
      children.splice(children.indexOf(child), 1);
    },
  };
}

test("preserves task-list scroll container and rows across redraws and progress updates", () => {
  const elements = {
    taskListPanel: createFakeElement(),
    taskListDetails: createFakeElement(),
    taskListCount: createFakeElement(),
    taskListBody: createFakeElement(),
  };
  const taskListState = {
    items: Array.from({ length: 12 }, (_, index) => ({ text: `任务 ${index + 1}`, done: false })),
    open: true,
  };
  const renderTaskList = new Function(
    "elements",
    "document",
    "getActiveTaskListState",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "formatTaskListProgress")}
     ${extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "renderTaskList")}
     return renderTaskList;`,
  )(elements, { createElement: createFakeElement }, () => taskListState) as (value?: typeof taskListState) => void;

  renderTaskList();
  const list = elements.taskListBody.children[0];
  const rows = list.children.slice();
  list.scrollTop = 96;
  renderTaskList();
  assert.equal(elements.taskListBody.children[0], list);
  assert.equal(list.scrollTop, 96);
  assert.deepEqual(list.children, rows);

  taskListState.items = taskListState.items.map((item, index) => ({ ...item, done: index < 3 }));
  taskListState.items[6].text = "更新任务内容";
  renderTaskList();
  assert.equal(elements.taskListBody.children[0], list);
  assert.equal(list.scrollTop, 96);
  assert.equal(elements.taskListCount.textContent, "3/12");
  assert.equal(rows[0].children[0].checked, true);
  assert.equal(rows[6].children[1].textContent, "更新任务内容");
  rows.forEach((row, index) => assert.equal(list.children[index], row));

  taskListState.items.push({ text: "追加任务", done: false });
  renderTaskList();
  assert.equal(list.children.length, 13);
  assert.equal(list.scrollTop, 96);
  taskListState.items.splice(10);
  renderTaskList();
  assert.equal(list.children.length, 10);
  assert.equal(list.scrollTop, 96);

  renderTaskList({ items: taskListState.items, open: true });
  assert.notEqual(elements.taskListBody.children[0], list);
  assert.equal(elements.taskListBody.children[0].scrollTop, 0);
  renderTaskList({ items: [], open: false });
  assert.equal(elements.taskListBody.children.length, 0);
  assert.equal(elements.taskListPanel.style.display, "none");
  assert.equal(elements.taskListDetails.open, false);
  renderTaskList(taskListState);
  assert.equal(elements.taskListBody.children[0].scrollTop, 0);
  elements.taskListBody = null as unknown as FakeElement;
  assert.doesNotThrow(() => renderTaskList());
});

test("renders OpenCode task updates in the active task-list overlay", () => {
  const functionSources = [
    "clearScheduledTaskListUpdate",
    "areTaskListItemsEqual",
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
    `let taskListTextUpdateTimer = null; ${functionSources.join("\n")}; return applyExternalTaskListUpdate;`,
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

test("caps the expanded task list at four rows with half the task item spacing", () => {
  assert.match(TASKLIST_STYLES, /--tasklist-visible-count:\s*4;/);
  assert.match(TASKLIST_STYLES, /--tasklist-row-height:\s*20px;/);
  assert.match(TASKLIST_STYLES, /--tasklist-row-gap:\s*3px;/);
  assert.match(
    TASKLIST_STYLES,
    /\.tasklist-items\s*\{[\s\S]*max-height:\s*calc\([\s\S]*var\(--tasklist-visible-count\)[\s\S]*overflow-y:\s*auto;/,
  );
});

test("reduces task-list title and item font sizes without changing item padding", () => {
  assert.match(TASKLIST_STYLES, /\.tasklist-panel summary\s*\{[^}]*font-size:\s*13px;/);
  assert.match(TASKLIST_STYLES, /\.tasklist-item\s*\{[^}]*font-size:\s*12px;/);
  assert.match(TASKLIST_STYLES, /--tasklist-list-padding-top:\s*8px;/);
  assert.match(TASKLIST_STYLES, /\.tasklist-panel details\s*\{[^}]*padding:\s*8px 12px;/);
  assert.match(TASKLIST_STYLES, /\.tasklist-items\s*\{[^}]*padding:\s*var\(--tasklist-list-padding-top\) 0 0;/);
});

test("keeps wrapped task rows from shrinking inside the scroll container", () => {
  assert.match(TASKLIST_STYLES, /\.tasklist-item\s*\{[^}]*flex:\s*0 0 auto;/);
  assert.match(
    TASKLIST_STYLES,
    /\.tasklist-item > span\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/,
  );
});

test("halves the gap between the task-list card and the input form", () => {
  assert.match(TASKLIST_STYLES, /\.tasklist-panel\s*\{[^}]*padding:\s*8px 16px 2px;/);
  assert.match(INPUT_CONTROLS_STYLES, /\.input-area\s*\{[^}]*padding:\s*8px var\(--panel-content-padding\);/);
});

test("renders a visible collapse icon in the task-list summary", () => {
  const html = buildWebviewStaticHtml({
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_STRINGS,
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
  });

  assert.match(
    html,
    /<summary>\s*<span class="tasklist-summary-title">\s*<span class="tasklist-toggle-icon" aria-hidden="true"><\/span>\s*<span>任务列表<\/span>/,
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
