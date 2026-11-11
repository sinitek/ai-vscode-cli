import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import type { LoopTaskRecord, LoopSubtaskRecord } from "../../loopTaskStore";
import type { ChatMessage, ConversationTabSummary } from "../../webview/types";

installVscodeMock();

const { attachConversationTabLoopMemberTitle, createExtensionSessionTabsHost } = require("../../extensionHost/sessionTabs") as typeof import("../../extensionHost/sessionTabs");
const taskStore = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { getLoopSubtaskDisplayTitle } = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");

function createTask(): Pick<LoopTaskRecord, "id" | "subTasks"> {
  const subTasks: LoopSubtaskRecord[] = Array.from({ length: 517 }, (_, index) => ({
    id: `subtask-${index + 1}`, title: `任务 ${index + 1}`, status: "completed",
  }));
  subTasks[516].title = "恢复SpreadJS本体源码构建与前端接入路线";
  return { id: "loop-task", subTasks };
}

function createSummary(): ConversationTabSummary {
  return {
    id: "subtask-tab", cli: "codex", sessionId: "subtask-session", createdAt: 1,
    loopTaskRole: "subtask", loopTaskId: "loop-task", taskSummary: "旧的 AI 摘要",
  };
}

function createMessages(subtaskId = "subtask-517", taskId = "loop-task"): ChatMessage[] {
  return [{
    id: "subtask-message", role: "user", content: "执行子任务", createdAt: 1,
    taskRole: "subtask", loopTaskId: taskId, loopSubtaskId: subtaskId, loopRound: 1,
  }];
}

test("Loop and Loop+ tooltips reuse the exact group member number and full title", () => {
  const task = createTask();
  for (const loopSchedulingMode of ["classic", "event_driven"] as const) {
    const summary = { ...createSummary(), loopSchedulingMode };
    const result = attachConversationTabLoopMemberTitle(summary, task, createMessages());
    assert.equal(result.taskSummary, "子任务 517：恢复SpreadJS本体源码构建与前端接入路线");
    assert.equal(result.taskSummary, getLoopSubtaskDisplayTitle(516, task.subTasks[516]));
    assert.equal(result.loopSchedulingMode, loopSchedulingMode);
    assert.equal(summary.taskSummary, "旧的 AI 摘要");
    task.subTasks[516].title += "，并核对长标题与非 BMP 字符 🧩 不被截断";
    assert.equal(attachConversationTabLoopMemberTitle(summary, task, createMessages()).taskSummary,
      getLoopSubtaskDisplayTitle(516, task.subTasks[516]));
    task.subTasks[516].title = "恢复SpreadJS本体源码构建与前端接入路线";
  }
});

test("Loop and Loop+ main tabs preserve AI summaries instead of replacing them with a role name", () => {
  for (const loopSchedulingMode of ["classic", "event_driven"] as const) {
    const main = { ...createSummary(), loopTaskRole: "main" as const, loopSchedulingMode, taskSummary: "恢复源码构建与前端接入" };
    assert.equal(attachConversationTabLoopMemberTitle(main, createTask(), createMessages()), main);
    assert.equal(attachConversationTabLoopMemberTitle(main, null, []).taskSummary, "恢复源码构建与前端接入");
    const missingSummary = { ...main, taskSummary: undefined };
    assert.equal(attachConversationTabLoopMemberTitle(missingSummary, null, []), missingSummary);
    assert.equal(attachConversationTabLoopMemberTitle(missingSummary, null, []).taskSummary, undefined);
  }
  const vibe = { id: "vibe", cli: "claude" as const, sessionId: null, createdAt: 1, taskSummary: "修复登录异常" };
  assert.equal(attachConversationTabLoopMemberTitle(vibe, createTask(), createMessages()), vibe);
});

test("missing or mismatched tasks and members never expose a stale AI summary", () => {
  const summary = createSummary();
  const task = createTask();
  for (const [record, messages] of [
    [null, createMessages()],
    [{ ...task, id: "another-task" }, createMessages()],
    [task, []],
    [task, createMessages("unknown")],
    [task, createMessages("subtask-517", "another-task")],
  ] as const) {
    assert.equal(attachConversationTabLoopMemberTitle(summary, record, messages).taskSummary, undefined);
  }
  assert.equal(attachConversationTabLoopMemberTitle({ ...summary, loopTaskId: undefined }, null, []).taskSummary, undefined);
});

test("persisted execution bindings restore titles without mixing CLI or overriding message identity", () => {
  const task = createTask();
  task.subTasks[516].executionSession = { cli: "codex", sessionId: "subtask-session", configId: null };
  const summary = createSummary();
  assert.equal(attachConversationTabLoopMemberTitle(summary, task, []).taskSummary,
    getLoopSubtaskDisplayTitle(516, task.subTasks[516]));
  assert.equal(attachConversationTabLoopMemberTitle({ ...summary, cli: "claude" }, task, []).taskSummary, undefined);
  assert.equal(attachConversationTabLoopMemberTitle(summary, task, createMessages("unknown")).taskSummary, undefined);
  task.subTasks[0].executionSession = { ...task.subTasks[516].executionSession };
  assert.equal(attachConversationTabLoopMemberTitle(summary, task, []).taskSummary, undefined);
  assert.equal(attachConversationTabLoopMemberTitle(summary, task, createMessages()).taskSummary,
    getLoopSubtaskDisplayTitle(516, task.subTasks[516]));
  task.subTasks[516].title = "";
  assert.equal(attachConversationTabLoopMemberTitle(summary, task, createMessages()).taskSummary, "子任务 517");
});

test("host projection reads each subtask from live, persisted or draft messages and leaves Vibe untouched", (context) => {
  const task = { ...createTask(), schedulingMode: "event_driven" } as LoopTaskRecord;
  context.mock.method(taskStore, "readLoopTaskRecord", () => task);
  const summaries: ConversationTabSummary[] = [
    { id: "vibe", cli: "codex", sessionId: null, createdAt: 1, taskSummary: "Vibe 原摘要" },
    { ...createSummary(), id: "live" },
    { ...createSummary(), id: "stored" },
    { ...createSummary(), id: "draft", sessionId: null },
    { ...createSummary(), id: "main", loopTaskRole: "main" },
  ];
  const reads: string[] = [];
  type HostDeps = Parameters<typeof createExtensionSessionTabsHost>[0];
  const host = createExtensionSessionTabsHost({
    getSessionTabsController: () => ({ buildConversationTabsState: () => ({ activeTabId: "vibe", tabs: summaries }) }),
    getSessionLifecycleController: () => ({}), getSessionStore: () => ({}),
    getCurrentCli: () => "codex", getActiveWorkspaceKey: () => "workspace",
    getWorkspaceSettings: () => ({}), getActiveTaskRun: () => null,
    getLiveMessagesForTab: (tabId: string) => { reads.push(tabId); return tabId === "live" ? createMessages() : null; },
    loadSessionMessages: () => { reads.push("stored-messages"); return createMessages(); },
    getPendingSessionDraft: () => { reads.push("draft-messages"); return { messages: createMessages() }; },
    setSessionStore: () => undefined, setCurrentCli: () => undefined, activeData: {},
  } as unknown as HostDeps);
  const result = host.buildConversationTabsState();
  assert.equal(result.activeTabId, "vibe");
  assert.equal(result.tabs[0], summaries[0]);
  assert.equal(result.tabs[4].taskSummary, summaries[4].taskSummary);
  for (const summary of result.tabs.slice(1, 4)) {
    assert.equal(summary.taskSummary, getLoopSubtaskDisplayTitle(516, task.subTasks[516]));
    assert.equal(summary.loopSchedulingMode, "event_driven");
  }
  assert.deepEqual(reads, ["live", "stored", "stored-messages", "draft", "draft-messages"]);
});
