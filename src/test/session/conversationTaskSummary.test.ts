import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import * as ts from "typescript";
import {
  buildConversationTaskSummaryPrompt,
  createConversationTaskSummaryCoordinator,
  createConversationTaskSummaryQueue,
  createConversationTaskSummarySubmissions,
  normalizeConversationTaskSummary,
} from "../../conversationTaskSummary";
import { createSessionTabsController, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft } from "../../sessionTabs";
import { createCliRecord } from "../../cli/types";
import type { SessionStore } from "../../sessionStore";
import type { WorkspaceSettings } from "../../workspaceSettingsStore";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { captureConversationTaskSummaryExecution } = require("../../extensionHost/conversationTaskSummary") as typeof import("../../extensionHost/conversationTaskSummary");

const pause = (milliseconds = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
}

function createCoordinator(timeoutMs = 100, queueOptions: Parameters<typeof createConversationTaskSummaryQueue>[0] = {}) {
  type Metadata = { taskSummary?: string; taskSummaryAttempted?: boolean; sessionId?: string };
  let workspace = "workspace-a";
  const tabs = new Map<string, Metadata>([["tab-a", {}], ["tab-b", {}]]);
  const drafts = new Map<string, Metadata>([["tab-a", {}], ["tab-b", {}]]);
  const sessions = new Map<string, Metadata>();
  let publishes = 0;
  const coordinator = createConversationTaskSummaryCoordinator({
    workspace: () => workspace,
    getTab: (tabId) => tabs.get(tabId) ?? null,
    getDraft: (tabId) => drafts.get(tabId)!,
    getSession: (tab) => tab.sessionId ? sessions.get(tab.sessionId) : undefined,
    persist: () => undefined,
    publish: () => { publishes += 1; },
    queueOptions: { timeoutMs, pollMs: 2, ...queueOptions },
  });
  return { coordinator, tabs, drafts, sessions, setWorkspace: (key: string) => { workspace = key; }, publishes: () => publishes };
}

test("normalizes only AI text, caps Unicode code points, and bounds the request", () => {
  assert.equal(normalizeConversationTaskSummary("  修复  登录\n流程  "), "修复 登录 流程");
  assert.equal(normalizeConversationTaskSummary("“重构会话存储”"), "重构会话存储");
  const unicode = normalizeConversationTaskSummary("任务" + "😀𠮷".repeat(40))!;
  assert.equal(Array.from(unicode).length, 30);
  assert.equal(unicode.charCodeAt(unicode.length - 1) >= 0xdc00, true);
  for (const value of [undefined, null, "", " \n ", "English only", "<think>思考</think>摘要", "# 标题", "字".repeat(4097)]) {
    assert.equal(normalizeConversationTaskSummary(value), undefined);
  }
  const prompt = buildConversationTaskSummaryPrompt("用户需求".repeat(10000));
  const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as { requirement: string };
  assert.equal(Array.from(payload.requirement).length, 6000);
  assert.match(prompt, /不调用工具/);
});

test("the first visible submission survives Loop protocol dispatch and local-session adoption unchanged", () => {
  const registry = createConversationTaskSummarySubmissions<object, { workspace: string; draft: object; requirement: string; model: string }>();
  const tab = {};
  const draft = { messages: [] as string[], sessionId: null as string | null };
  const first = registry.remember(tab, "workspace", draft, () => ({ workspace: "workspace", draft, requirement: "改进用户登录体验", model: "submitted-model" }));
  draft.messages.push("用户需求", "内部恢复协议");
  draft.sessionId = "local_new";
  const dispatched = registry.remember(tab, "workspace", draft, () => assert.fail("later model selection and Loop protocol must not replace the first visible requirement"));
  assert.equal(dispatched, first);
  assert.equal(dispatched?.requirement, "改进用户登录体验");
  assert.equal(dispatched?.model, "submitted-model");
  assert.equal(registry.isCurrent(tab, first!), true);
  const next = registry.remember(tab, "workspace", draft, () => ({ workspace: "workspace", draft, requirement: "修复图片预览", model: "next-model" }), true);
  assert.notEqual(next, first);
  assert.equal(registry.isCurrent(tab, first!), false);
  assert.equal(registry.isCurrent(tab, next!), true);
  assert.equal(registry.remember(tab, "workspace", draft, () => assert.fail("internal dispatch must reuse the new submission")), next);
  assert.equal(registry.remember(tab, "other-workspace", {}, () => undefined), undefined);
  assert.equal(registry.remember({}, "workspace", {}, () => undefined), undefined);
});

test("extension captures Vibe and Loop main summaries without summarizing internal protocols or subtasks", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const sourceFile = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true);
  const names = ["preloadUserMessageForPrompt", "rememberConversationTaskSummarySubmission"];
  const declarations = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? "")
  ));
  assert.equal(declarations.length, names.length);
  const script = ts.transpileModule(declarations.map((declaration) => declaration.getText(sourceFile)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const tab = { taskSummary: "之前的任务摘要", taskSummaryAttempted: true };
  const draft = { firstPrompt: "之前的需求", messages: [{ id: "old", role: "user", content: "之前的需求" }] };
  const submissions = createConversationTaskSummarySubmissions<object, { workspace: string; draft: object; requirement: string }>();
  let messageSequence = 0;
  const runtime = vm.runInNewContext(`${script}\n({ preloadUserMessageForPrompt, rememberConversationTaskSummarySubmission });`, {
    activeWorkspaceKey: "workspace",
    pendingConversationTaskSummarySubmissions: submissions,
    getConversationTabById: () => tab,
    getConversationTabSessionIdForCli: () => "native-session",
    getPendingSessionDraft: () => draft,
    readLoopTaskRecord: () => ({ rootPrompt: "旧 Loop 根需求", subTasks: [{ id: "subtask", prompt: "旧子任务需求" }] }),
    getActiveConfigIdForCli: () => "config",
    getSelectedCliModel: () => "model",
    getEffectiveThinkingMode: () => "off",
    getCliCommand: () => "codex",
    getCliArgs: () => [],
    resolveRecordedExecutionModel: () => "model",
    resolvePreloadedExecutionModel: () => "model",
    markConversationTabExecutionLocked: () => false,
    createMessageId: () => `message-${++messageSequence}`,
    buildConversationExecutionProfile: () => ({}),
    buildUserChatMessage: (input: PromptRunInput, _createdAt: number, messageId: string) => ({ id: messageId, role: "user", content: input.displayPrompt }),
    loadSessionMessages: () => draft.messages,
    appendMessageToStore: (messages: typeof draft.messages, message: typeof draft.messages[number]) => messages.push(message),
    sendPanelMessage: () => undefined,
  }) as {
    preloadUserMessageForPrompt: (input: PromptRunInput, target: PromptRunTarget, options?: { captureTaskSummary?: boolean }) => PromptRunInput;
    rememberConversationTaskSummarySubmission: (input: PromptRunInput, target: PromptRunTarget) => { requirement: string } | undefined;
  };
  const target: PromptRunTarget = { tabId: "tab-a", cli: "codex", sessionId: "native-session" };
  const input: PromptRunInput = { displayPrompt: "修复新的登录问题", modelPrompt: "模型上下文", contextTags: [] };
  const first = runtime.preloadUserMessageForPrompt(input, target);
  const firstSnapshot = runtime.rememberConversationTaskSummarySubmission(first, target);
  assert.equal(firstSnapshot?.requirement, input.displayPrompt);
  assert.equal(runtime.preloadUserMessageForPrompt(first, target), first);
  const second = runtime.preloadUserMessageForPrompt({ ...input }, target);
  const secondSnapshot = runtime.rememberConversationTaskSummarySubmission(second, target);
  assert.notEqual(secondSnapshot, firstSnapshot, "even identical submitted text is a new task");
  assert.equal(secondSnapshot?.requirement, input.displayPrompt);
  const internal = { ...input, taskRole: "main" as const, loopTaskId: "loop", displayPrompt: "内部调度协议" };
  assert.equal(runtime.rememberConversationTaskSummarySubmission(internal, target), secondSnapshot);
  runtime.preloadUserMessageForPrompt(internal, target, { captureTaskSummary: false });
  assert.equal(runtime.rememberConversationTaskSummarySubmission(internal, target), secondSnapshot);
  const subtask = runtime.preloadUserMessageForPrompt({ ...input, taskRole: "subtask", loopTaskId: "loop", loopSubtaskId: "subtask" }, target);
  assert.equal(runtime.rememberConversationTaskSummarySubmission(subtask, target), undefined);
  assert.equal(runtime.rememberConversationTaskSummarySubmission(second, target), secondSnapshot);
  const mainInput = { ...input, taskRole: "main" as const, loopTaskId: "loop", displayPrompt: "恢复主任务摘要并保留子任务标题" };
  const main = runtime.preloadUserMessageForPrompt(mainInput, target);
  const mainSnapshot = runtime.rememberConversationTaskSummarySubmission(main, target);
  assert.notEqual(mainSnapshot, secondSnapshot);
  assert.equal(mainSnapshot?.requirement, mainInput.displayPrompt);
  assert.equal(runtime.rememberConversationTaskSummarySubmission(internal, target), mainSnapshot);
  submissions.remember(tab, "workspace", draft, () => undefined, true);
  const recoveredSnapshot = runtime.rememberConversationTaskSummarySubmission(internal, target);
  assert.equal(recoveredSnapshot?.requirement, "旧 Loop 根需求");
  assert.equal(runtime.rememberConversationTaskSummarySubmission(internal, target), recoveredSnapshot);
  assert.equal(runtime.rememberConversationTaskSummarySubmission(subtask, target), undefined);
});

test("first submit calls AI once, does not use a prompt prefix, and accepts before task completion", async () => {
  const harness = createCoordinator();
  const ai = deferred<string>();
  let captures = 0;
  let calls = 0;
  let releases = 0;
  const capture = () => {
    captures += 1;
    return { run: async () => { calls += 1; return ai.promise; }, dispose: () => { releases += 1; } };
  };
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: false, submission: capture, capture }), false);
  assert.equal(captures, 0);
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: capture, capture }), true);
  assert.equal(captures, 0, "runner and provider configuration capture should happen after dispatch returns");
  assert.equal(harness.tabs.get("tab-a")!.taskSummary, undefined);
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: capture, capture }), false);
  await pause();
  assert.equal(calls, 1);
  ai.resolve("改进登录异常恢复能力");
  await pause();
  assert.equal(harness.tabs.get("tab-a")!.taskSummary, "改进登录异常恢复能力");
  assert.equal(harness.drafts.get("tab-a")!.taskSummary, "改进登录异常恢复能力");
  assert.equal(harness.publishes(), 1);
  assert.equal(releases, 1);
  harness.coordinator.dispose();
});

test("a superseded submission is canceled before its deferred capture starts", async () => {
  const harness = createCoordinator();
  let firstCaptures = 0;
  let secondCaptures = 0;
  harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => {
    firstCaptures += 1;
    return { run: async () => "过期摘要", dispose: () => undefined };
  } });
  harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => {
    secondCaptures += 1;
    return { run: async () => "当前任务摘要", dispose: () => undefined };
  } });
  await pause();
  assert.equal(firstCaptures, 0);
  assert.equal(secondCaptures, 1);
  assert.equal(harness.tabs.get("tab-a")!.taskSummary, "当前任务摘要");
  harness.coordinator.dispose();
});

test("concurrent tabs remain isolated and late binding writes to the current migrated session", async () => {
  const harness = createCoordinator();
  const first = deferred<string>();
  const second = deferred<string>();
  harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => ({ run: () => first.promise, dispose: () => undefined }) });
  harness.coordinator.request({ tabId: "tab-b", eligible: true, submission: {}, capture: () => ({ run: () => second.promise, dispose: () => undefined }) });
  harness.sessions.set("native-session", {});
  harness.tabs.get("tab-a")!.sessionId = "native-session";
  second.resolve("优化图片预览");
  first.resolve("修复会话迁移");
  await pause();
  assert.equal(harness.sessions.get("native-session")!.taskSummary, "修复会话迁移");
  assert.equal(harness.tabs.get("tab-b")!.taskSummary, "优化图片预览");
  harness.coordinator.dispose();
});

test("new submissions refresh existing summaries and persist to the tab, draft and bound session", async () => {
  const harness = createCoordinator();
  const tab = harness.tabs.get("tab-a")!;
  Object.assign(tab, { taskSummary: "之前的任务摘要", taskSummaryAttempted: true, sessionId: "historical-session" });
  harness.sessions.set("historical-session", { taskSummary: tab.taskSummary, taskSummaryAttempted: true });
  const submission = {};
  const result = deferred<string>();
  let captures = 0;
  const capture = () => {
    captures += 1;
    return { run: () => result.promise, dispose: () => undefined };
  };
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission, capture }), true);
  assert.equal(tab.taskSummary, "之前的任务摘要");
  result.resolve("修复后续任务摘要刷新");
  await pause();
  for (const metadata of [tab, harness.drafts.get("tab-a"), harness.sessions.get("historical-session")]) {
    assert.equal(metadata?.taskSummary, "修复后续任务摘要刷新");
    assert.equal(metadata?.taskSummaryAttempted, true);
  }
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission, capture }), false);
  assert.equal(captures, 1);
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => ({
    run: async () => "优化第三个任务", dispose: () => undefined,
  }) }), true);
  await pause();
  assert.equal(tab.taskSummary, "优化第三个任务");
  assert.equal(harness.sessions.get("historical-session")!.taskSummary, "优化第三个任务");
  assert.equal(harness.publishes(), 2);
  harness.coordinator.dispose();
});

test("a new submission aborts the previous summary and late output cannot overwrite the latest task", async () => {
  const harness = createCoordinator();
  const previous = deferred<string>();
  let previousSignal: AbortSignal | undefined;
  let releases = 0;
  harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => ({
    run: (signal) => { previousSignal = signal; return previous.promise; },
    dispose: () => { releases += 1; },
  }) });
  await pause();
  harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => ({
    run: async () => "当前新任务的摘要", dispose: () => { releases += 1; },
  }) });
  assert.equal(previousSignal?.aborted, true);
  await pause();
  previous.resolve("不应覆盖的旧任务摘要");
  await pause();
  assert.equal(harness.tabs.get("tab-a")!.taskSummary, "当前新任务的摘要");
  assert.equal(harness.publishes(), 1);
  assert.equal(releases, 2);
  harness.coordinator.dispose();
});

test("failed refreshes retain the previous summary but do not prevent the next task from generating", async () => {
  for (const outcome of ["empty", "error", "timeout", "capture"]) {
    const harness = createCoordinator(8);
    const tab = harness.tabs.get("tab-a")!;
    Object.assign(tab, { taskSummary: "已保存的任务摘要", taskSummaryAttempted: true, sessionId: "native" });
    harness.drafts.get("tab-a")!.taskSummary = tab.taskSummary;
    harness.sessions.set("native", { taskSummary: tab.taskSummary });
    const submission = {};
    const capture = () => {
      if (outcome === "capture") throw new Error("capture failed");
      return {
        run: async (): Promise<string> => {
          if (outcome === "error") throw new Error("unavailable");
          if (outcome === "timeout") return new Promise(() => undefined);
          return " ";
        },
        dispose: () => undefined,
      };
    };
    harness.coordinator.request({ tabId: "tab-a", eligible: true, submission, capture });
    await pause(20);
    assert.equal(tab.taskSummary, "已保存的任务摘要", outcome);
    assert.equal(harness.drafts.get("tab-a")!.taskSummary, tab.taskSummary, outcome);
    assert.equal(harness.sessions.get("native")!.taskSummary, tab.taskSummary, outcome);
    assert.equal(harness.publishes(), 0, outcome);
    assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission, capture }), false, outcome);
    assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => ({
      run: async () => "下一任务已成功更新", dispose: () => undefined,
    }) }), true, outcome);
    await pause();
    assert.equal(tab.taskSummary, "下一任务已成功更新", outcome);
    harness.coordinator.dispose();
  }
});

test("capacity overflow preserves the previous summary and only consumes the rejected submission", async () => {
  const harness = createCoordinator(100, { concurrency: 1, capacity: 1 });
  const blocker = deferred<string>();
  harness.coordinator.request({ tabId: "tab-b", eligible: true, submission: {}, capture: () => ({
    run: () => blocker.promise, dispose: () => undefined,
  }) });
  const tab = harness.tabs.get("tab-a")!;
  tab.taskSummary = "上次成功生成的摘要";
  const submission = {};
  const capture = () => ({ run: async () => "下一任务的有效摘要", dispose: () => undefined });
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission,
    capture: () => assert.fail("a full queue must not capture a runner"),
  }), false);
  assert.equal(tab.taskSummary, "上次成功生成的摘要");
  blocker.resolve("其他标签页的任务摘要");
  await pause();
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission, capture }), false);
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture }), true);
  await pause();
  assert.equal(tab.taskSummary, "下一任务的有效摘要");
  harness.coordinator.dispose();
});

test("close, reset, workspace switch, and teardown discard late results and release runners", async () => {
  for (const action of ["close", "reset", "workspace", "dispose"]) {
    const harness = createCoordinator();
    const result = deferred<string>();
    let releases = 0;
    let signal: AbortSignal | undefined;
    harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {}, capture: () => ({
      run: (value) => { signal = value; return result.promise; }, dispose: () => { releases += 1; },
    }) });
    await pause();
    const original = harness.tabs.get("tab-a")!;
    if (action === "close") harness.tabs.delete("tab-a");
    if (action === "reset") { delete original.taskSummaryAttempted; harness.drafts.set("tab-a", {}); }
    if (action === "workspace") harness.setWorkspace("workspace-b");
    if (action === "dispose") harness.coordinator.dispose();
    await pause();
    result.resolve("不应展示的过期摘要");
    await pause();
    assert.equal(original.taskSummary, undefined, action);
    assert.equal(harness.publishes(), 0, action);
    assert.equal(signal?.aborted, true, action);
    assert.equal(releases, 1, action);
    harness.coordinator.dispose();
  }
});

test("a reset tab can immediately summarize its new task while the old job is retiring", async () => {
  const harness = createCoordinator();
  const previous = deferred<string>();
  let releases = 0;
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {},
    capture: () => ({ run: async () => previous.promise, dispose: () => { releases += 1; } }),
  }), true);
  const tab = harness.tabs.get("tab-a")!;
  delete tab.taskSummaryAttempted;
  harness.drafts.set("tab-a", {});
  assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: {},
    capture: () => ({ run: async () => "新任务的独立摘要", dispose: () => { releases += 1; } }),
  }), true);
  await pause();
  previous.resolve("旧任务的迟到摘要");
  await pause();
  assert.equal(tab.taskSummary, "新任务的独立摘要");
  assert.equal(harness.drafts.get("tab-a")!.taskSummary, "新任务的独立摘要");
  assert.equal(harness.publishes(), 1);
  assert.equal(releases, 1, "the canceled deferred job never creates a runner to release");
  harness.coordinator.dispose();
});

test("empty, failed, and timed out AI calls stay missing without retries", async () => {
  for (const outcome of ["empty", "error", "timeout", "oversize"]) {
    const harness = createCoordinator(8);
    let releases = 0;
    const capture = () => ({
      run: async (): Promise<string> => {
        if (outcome === "error") throw new Error("AI unavailable");
        if (outcome === "timeout") return new Promise(() => undefined);
        return outcome === "oversize" ? "长".repeat(4097) : " ";
      },
      dispose: () => { releases += 1; },
    });
    harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: capture, capture });
    await pause(20);
    assert.equal(harness.tabs.get("tab-a")!.taskSummary, undefined);
    assert.equal(releases, 1);
    assert.equal(harness.coordinator.request({ tabId: "tab-a", eligible: true, submission: capture, capture }), false);
    harness.coordinator.dispose();
  }
});

test("queue caps concurrency and capacity and drains all cancelled resources", async () => {
  const queue = createConversationTaskSummaryQueue({ concurrency: 1, capacity: 2, timeoutMs: 100 });
  let starts = 0;
  let releases = 0;
  const job = (key: string) => ({ key, isCurrent: () => true,
    run: async (): Promise<string> => { starts += 1; return new Promise(() => undefined); },
    accept: () => assert.fail("cancelled job accepted"), dispose: () => { releases += 1; },
  });
  assert.equal(queue.enqueue(job("one")), true);
  assert.equal(queue.enqueue(job("two")), true);
  assert.equal(queue.enqueue(job("three")), false);
  await pause();
  assert.equal(starts, 1);
  assert.equal(queue.size, 2);
  queue.dispose();
  await pause();
  assert.equal(queue.size, 0);
  assert.equal(releases, 3);
});

test("workspace tab normalization, reload and historical reopening preserve summaries without label fallback", () => {
  const store: SessionStore = createCliRecord(() => ({ currentId: null as string | null, sessions: [] }));
  store.codex.sessions.push({ id: "native", label: "原有标签", createdAt: 1, lastUsedAt: 1, taskSummary: "修复认证流程" });
  const state: ConversationTabsState = { activeTabId: "draft", tabs: [] };
  const settings: WorkspaceSettings = { conversationTabs: { activeTabId: "draft", tabs: [
    { id: "draft", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 1, taskSummary: "  整理\n代码  ", taskSummaryAttempted: true },
    { id: "old", cli: "codex", sessionId: "native", sessionIdByCli: { codex: "native" }, createdAt: 1 },
  ] } };
  const controller = createSessionTabsController({ state, pendingDrafts: {} as Record<string, PendingSessionDraft>,
    conversationTabPrefix: "tab", getCurrentCli: () => "codex", setCurrentCli: () => undefined,
    getDefaultCli: () => "codex", isCliName: (value: string): value is "codex" => value === "codex",
    getLatestSessionId: () => null, getSessionStore: () => store, getWorkspaceSettings: () => settings,
    saveWorkspaceSettings: () => undefined, setCurrentSession: () => undefined,
    setWorkspaceInteractiveModeForCli: () => false, resolveAutoInteractiveModeForConversationTab: () => "coding",
    collectRunningLoopTaskIds: () => new Set(), isLoopTaskRunning: () => false,
    getLoopTaskStatus: () => null, resolveConversationTabLoopContext: () => ({}), buildSessionLabelFromPrompt: () => "标签",
  });
  controller.initializeConversationTabsFromWorkspaceSettings();
  assert.equal(state.tabs[0].taskSummary, "整理 代码");
  assert.equal(settings.conversationTabs!.tabs[0].taskSummary, "整理 代码");
  assert.equal(controller.buildConversationTabsState().tabs[1].taskSummary, "修复认证流程");
  controller.addConversationTab("codex", null);
  assert.equal(controller.buildConversationTabsState().tabs[2].taskSummary, undefined);
  controller.setActiveConversationTab("draft");
  controller.startNewSession("codex");
  assert.equal((state.tabs[0] as ConversationTabRecord).taskSummary, undefined);
});

test("Codex side runner receives a frozen provider snapshot, a new session, and read-only options", async () => {
  const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-snapshot-test-"));
  const codexHome = path.join(root, ".codex");
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, "config.toml"), 'model = "model-before"\nmodel_provider = "before"\n[mcp_servers.untrusted]\ncommand = "bad"\n');
  const originalRun = CodexInteractiveRunner.prototype.runStreamed;
  let calls = 0;
  CodexInteractiveRunner.prototype.runStreamed = async function (prompt, handlers) {
    calls += 1;
    const options = (this as unknown as { options: { env: NodeJS.ProcessEnv; cwd: string; model: string; threadId: null; readOnly: boolean } }).options;
    assert.equal(options.readOnly, true);
    assert.equal(options.threadId, null);
    assert.equal(options.model, "model-before");
    assert.notEqual(options.cwd, root);
    assert.equal(options.env.TEST_SNAPSHOT, "before");
    const config = fs.readFileSync(path.join(options.env.CODEX_HOME!, "config.toml"), "utf8");
    assert.match(config, /model_provider = "before"/);
    assert.doesNotMatch(config, /mcp_servers|untrusted/);
    assert.match(prompt, /归纳/);
    handlers.onAssistantDelta("这是思考", { kind: "thinking" });
    handlers.onAssistantDelta("处理中", { assistantItemId: "commentary" });
    handlers.onAssistantDelta("归纳任务需求", { assistantItemId: "answer" });
    handlers.onAssistantDelta("", { assistantItemId: "answer", codexFinalAnswer: true });
  };
  let execution: ReturnType<typeof captureConversationTaskSummaryExecution> | undefined;
  try {
    const env = { ...process.env, CODEX_HOME: codexHome, CODEX_HOME_DIR: codexHome, TEST_SNAPSHOT: "before" };
    execution = captureConversationTaskSummaryExecution({ cli: "codex", model: "model-before", requirement: "用户要我修改一个完整功能，而非简单截断", thinkingMode: "off", command: "codex", homeDir: root, parentEnv: env });
    env.TEST_SNAPSHOT = "after";
    fs.writeFileSync(path.join(codexHome, "config.toml"), 'model_provider = "after"\n');
    assert.equal(await execution.run(new AbortController().signal), "归纳任务需求");
    assert.equal(calls, 1);
    const executionRoot = execution.root;
    execution.dispose();
    assert.equal(fs.existsSync(executionRoot), false);
  } finally {
    execution?.dispose();
    CodexInteractiveRunner.prototype.runStreamed = originalRun;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DSH, Kimi, ZCode and Grok use new native sessions, frozen configs and denied permissions", async () => {
  const { createConfigPaths } = require("../../config/configPaths") as typeof import("../../config/configPaths");
  const { createDshExampleProfileText } = require("../../cli/dshConfigModels") as typeof import("../../cli/dshConfigModels");
  const { ZCODE_PLAN_MODE } = require("../../interactive/zcodeAppServerProtocol") as typeof import("../../interactive/zcodeAppServerProtocol");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-native-adapters-"));
  const parentEnv = { PATH: process.env.PATH, TEST_SNAPSHOT: "frozen" };
  const config = createConfigPaths(root, parentEnv);
  const write = (target: string, text: string): void => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  write(config.grok.config, '[models]\ndefault = "test"\n[model.test]\nmodel = "wire-test"\n');
  write(path.join(config.dsh.configDir, "active-profile.json"), createDshExampleProfileText());
  write(config["kimi-code"].config, 'default_model = "test"\n[models.test]\nmodel = "test"\nprovider = "test"\n');
  write(config.zcode.config, "{}");
  const adapters = [
    { cli: "grok", module: "grokRunner", name: "GrokInteractiveRunner", model: "test" },
    { cli: "dsh", module: "dshRunner", name: "DshInteractiveRunner", model: null },
    { cli: "kimi-code", module: "kimiRunner", name: "KimiInteractiveRunner", model: "test" },
    { cli: "zcode", module: "zcodeRunner", name: "ZcodeInteractiveRunner", model: "provider$wire" },
  ] as const;
  try {
    for (const adapter of adapters) {
      const prototype = require(`../../interactive/${adapter.module}`)[adapter.name].prototype as {
        start: () => Promise<unknown>;
        prompt: (text: string, handlers: { onAssistantDelta?: (text: string) => void; onRequest?: () => unknown }) => Promise<unknown>;
        dispose: () => void;
      };
      const original = { start: prototype.start, prompt: prototype.prompt, dispose: prototype.dispose };
      let started = false;
      let disposed = 0;
      let execution: ReturnType<typeof captureConversationTaskSummaryExecution> | undefined;
      prototype.start = async function () {
        const options = (this as unknown as { options: Record<string, unknown> }).options;
        const env = options.env as NodeJS.ProcessEnv;
        assert.equal(options.localSessionId, null, adapter.cli);
        assert.equal(env.TEST_SNAPSHOT, "frozen", adapter.cli);
        assert.equal(String(options.cwd).startsWith(execution!.root), true, adapter.cli);
        if (adapter.cli === "grok") assert.equal(options.textOnly, true);
        if (adapter.cli === "dsh") {
          assert.equal(env.DSH_PERMISSION_MODE, "read-only");
          assert.match((options.agentArgs as string[]).join(" "), /--patch/);
        }
        if (adapter.cli === "kimi-code") {
          assert.equal(options.modeId, "plan");
          assert.equal(options.denyToolPermissions, true);
        }
        if (adapter.cli === "zcode") {
          assert.equal(options.modeId, ZCODE_PLAN_MODE);
          assert.equal(options.denyToolPermissions, true);
        }
        started = true;
        return {};
      };
      prototype.prompt = async function (prompt, handlers) {
        assert.equal(started, true, adapter.cli);
        assert.match(prompt, /最初用户需求/);
        handlers.onAssistantDelta?.("整理项目任务");
        return { stopReason: "end_turn", text: "整理项目任务", usage: null };
      };
      prototype.dispose = () => { disposed += 1; };
      try {
        execution = captureConversationTaskSummaryExecution({ cli: adapter.cli, model: adapter.model,
          command: adapter.cli, requirement: "最初用户需求", thinkingMode: "off", homeDir: root, parentEnv });
        parentEnv.TEST_SNAPSHOT = "changed";
        assert.equal(await execution.run(new AbortController().signal), "整理项目任务", adapter.cli);
        execution.dispose();
        assert.equal(fs.existsSync(execution.root), false, adapter.cli);
        assert.ok(disposed >= 1, adapter.cli);
      } finally {
        execution?.dispose();
        Object.assign(prototype, original);
        parentEnv.TEST_SNAPSHOT = "frozen";
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("OpenCode captures the verified run interface and denies all tools, plugins and MCP", async () => {
  const commandRunner = require("../../cli/commandRunner") as typeof import("../../cli/commandRunner");
  const original = commandRunner.runCliStream;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-opencode-adapter-"));
  fs.mkdirSync(path.join(root, ".opencode"));
  fs.writeFileSync(path.join(root, ".opencode", "config.json"), JSON.stringify({
    model: "test/model", permission: { "*": "allow" }, mcp: { untrusted: {} }, plugin: ["untrusted"],
    provider: { test: { npm: "@ai-sdk/openai-compatible", models: { model: { name: "model" } }, options: { apiKey: "test-key", baseURL: "https://example.invalid" } } },
  }));
  let called = false;
  commandRunner.runCliStream = (cli, prompt, handlers, options) => {
    called = true;
    assert.equal(cli, "opencode");
    assert.match(prompt, /归纳/);
    const record = options as unknown as { commandOverride: string; argsOverride: string[]; cwd: string; openCodeConfigContent: string };
    assert.equal(record.commandOverride, "opencode-snapshot");
    assert.equal(record.argsOverride[0], "run");
    assert.ok(record.argsOverride.includes("json"));
    assert.equal(record.cwd.startsWith(execution.root), true);
    const config = JSON.parse(record.openCodeConfigContent);
    assert.deepEqual(config.permission, { "*": "deny" });
    assert.deepEqual(config.mcp, {});
    assert.deepEqual(config.plugin, []);
    queueMicrotask(() => {
      handlers.onStderr("不应进入摘要的日志");
      handlers.onStdout(JSON.stringify({ type: "text", part: { type: "text", text: "归纳界面需求", time: { end: 1 } } }) + "\n");
      handlers.onExit(0);
    });
    return { kill: () => false };
  };
  const execution = captureConversationTaskSummaryExecution({ cli: "opencode", model: "test/model", command: "opencode-snapshot",
    requirement: "最初用户需求", thinkingMode: "off", homeDir: root, parentEnv: { PATH: process.env.PATH } });
  try {
    assert.equal(await execution.run(new AbortController().signal), "归纳界面需求");
    assert.equal(called, true);
  } finally {
    execution.dispose();
    commandRunner.runCliStream = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude summary SDK query has no tools, permission bypass, hooks, settings or resumed session", async () => {
  const imports = require("../../interactive/dynamicImport") as typeof import("../../interactive/dynamicImport");
  const originalImport = imports.dynamicImport;
  let queryOptions: Record<string, unknown> | undefined;
  imports.dynamicImport = (async () => ({ query: ({ prompt, options }: {
    prompt: AsyncIterable<unknown>; options: Record<string, unknown>;
  }) => {
    queryOptions = options;
    return (async function* () {
      for await (const ignored of prompt) {
        assert.ok(ignored);
        yield { type: "result", subtype: "success", result: "归纳任务目标" };
      }
    })();
  } })) as typeof imports.dynamicImport;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-claude-adapter-"));
  fs.mkdirSync(path.join(root, ".claude"));
  fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: "snapshot-token", HOME: "/untrusted-home" },
    hooks: { PreToolUse: [{ command: "bad" }] },
  }));
  const execution = captureConversationTaskSummaryExecution({ cli: "claude", model: "model-snapshot", requirement: "最初用户需求",
    command: "claude", thinkingMode: "off", homeDir: root, parentEnv: { PATH: process.env.PATH } });
  try {
    assert.equal(await execution.run(new AbortController().signal), "归纳任务目标");
    assert.ok(queryOptions);
    assert.deepEqual(queryOptions.tools, []);
    assert.deepEqual(queryOptions.mcpServers, {});
    assert.deepEqual(queryOptions.hooks, {});
    assert.deepEqual(queryOptions.settingSources, []);
    assert.equal(queryOptions.permissionMode, "dontAsk");
    assert.equal(queryOptions.allowDangerouslySkipPermissions, undefined);
    assert.equal(queryOptions.resume, undefined);
    assert.equal(queryOptions.maxTurns, 1);
    assert.equal(queryOptions.persistSession, false);
    assert.equal((queryOptions.env as NodeJS.ProcessEnv).ANTHROPIC_API_KEY, "snapshot-token");
    assert.equal((queryOptions.env as NodeJS.ProcessEnv).HOME?.startsWith(execution.root), true);
  } finally {
    execution.dispose();
    imports.dynamicImport = originalImport;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
