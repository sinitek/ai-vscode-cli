import assert = require("node:assert/strict");
import test = require("node:test");
import { createCompletedLoopSubtaskTabCleanup, findRunningLoopSubtaskConversationTabId, resolveCompletedLoopSubtaskTabBinding, retryLoopSubtaskTabClose } from "../../extensionHost/loopSubtaskTabs";
import type { ConversationTabRecord } from "../../sessionTabs";
import type { LoopTaskRecord } from "../../loopTaskStore";

test("finds the newest active tab by parent and subtask identity across CLIs", () => {
  const tabs: ConversationTabRecord[] = [
    { id: "old", cli: "codex", sessionId: "old-session", sessionIdByCli: {}, createdAt: 1 },
    { id: "current", cli: "claude", sessionId: "current-session", sessionIdByCli: {}, createdAt: 2 },
    { id: "finished", cli: "codex", sessionId: "finished-session", sessionIdByCli: {}, createdAt: 3 },
    { id: "sibling", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 4 },
    { id: "other-parent", cli: "claude", sessionId: null, sessionIdByCli: {}, createdAt: 5 },
    { id: "ordinary", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 6 },
  ];
  const target = { taskId: "parent", subtaskId: "subtask" };
  const contexts = new Map([
    ["old", { ...target, attemptId: "first" }],
    ["current", { ...target, attemptId: "second" }],
    ["finished", { ...target, attemptId: "third" }],
    ["sibling", { ...target, subtaskId: "sibling" }],
    ["other-parent", { ...target, taskId: "other-parent" }],
  ]);
  const deps = {
    getTabs: () => tabs,
    resolveContext: (tab: ConversationTabRecord) => contexts.get(tab.id) ?? null,
    isTabRunActive: (id: string) => id !== "finished",
  };
  assert.equal(findRunningLoopSubtaskConversationTabId(target, deps), "current");
  assert.equal(findRunningLoopSubtaskConversationTabId({ ...target, attemptId: "first" }, deps), "old");
  assert.equal(findRunningLoopSubtaskConversationTabId({ ...target, attemptId: "missing" }, deps), null);
  assert.equal(findRunningLoopSubtaskConversationTabId({ ...target, taskId: "missing" }, deps), null);
  assert.equal(tabs[0].id, "old");
});

test("does not resolve a finished or missing subtask tab", () => {
  const context = { taskId: "parent", subtaskId: "subtask" };
  const tab: ConversationTabRecord = { id: "finished", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 1 };
  const deps = {
    getTabs: () => [tab], resolveContext: () => context, isTabRunActive: () => false,
  };
  assert.equal(findRunningLoopSubtaskConversationTabId(context, deps), null);
  assert.equal(findRunningLoopSubtaskConversationTabId(context, { ...deps, getTabs: () => [] }), null);
});

test("retries a failed subtask tab close once and reports whether it will retry", async () => {
  let closeAttempts = 0;
  const failures: Array<{ attempt: number; retrying: boolean; error: string }> = [];
  const successfulAttempt = await retryLoopSubtaskTabClose(async () => {
    closeAttempts += 1;
    if (closeAttempts === 1) throw new Error("temporary host failure");
  }, (error, attempt, retrying) => {
    failures.push({ attempt, retrying, error: error instanceof Error ? error.message : String(error) });
  }, 0);

  assert.equal(successfulAttempt, 2);
  assert.equal(closeAttempts, 2);
  assert.deepEqual(failures, [{ attempt: 1, retrying: true, error: "temporary host failure" }]);
});

test("preserves the last subtask tab close failure after the bounded retry", async () => {
  const failures: Array<{ attempt: number; retrying: boolean }> = [];
  await assert.rejects(retryLoopSubtaskTabClose(async () => {
    throw new Error("persistent host failure");
  }, (_error, attempt, retrying) => failures.push({ attempt, retrying }), 0), /persistent host failure/);
  assert.deepEqual(failures, [{ attempt: 1, retrying: true }, { attempt: 2, retrying: false }]);
});

function tab(id: string, sessionId: string | null = id): ConversationTabRecord {
  return { id, cli: "codex", sessionId, sessionIdByCli: sessionId ? { codex: sessionId } : {}, createdAt: 1 };
}

function cleanupHarness(options: { readTask?: () => Pick<LoopTaskRecord, "workspaceKey" | "department" | "departmentInvalid" | "schedulingMode" | "loopPlus" | "subTasks"> | null } = {}) {
  const tabs: ConversationTabRecord[] = [];
  const active = new Set<string>();
  let workspace = "workspace";
  const closed: string[] = [];
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => workspace,
    getTabs: () => tabs,
    isTabRunActive: (id) => active.has(id),
    closeTab: async (candidate) => {
      const index = tabs.indexOf(candidate);
      if (index < 0) throw new Error("missing tab");
      tabs.splice(index, 1);
      closed.push(candidate.id);
    },
    ...(options.readTask ? { restoredEvidence: { readMessages: () => [], readRuns: () => [], readTask: options.readTask } } : {}),
  });
  return { tabs, active, closed, cleanup, setWorkspace: (value: string) => { workspace = value; } };
}

const context = { taskId: "task", subtaskId: "A", round: 1, attemptId: "lp487" };

test("binds a provisional subtask identity when the task record cannot be read", () => {
  const input = { taskRole: "subtask", loopTaskId: "task", loopSubtaskId: "A", loopRound: 1, loopAttemptId: "lp487" };
  assert.deepEqual(resolveCompletedLoopSubtaskTabBinding(null, "workspace", input), {
    context, provisional: true,
  });
  assert.deepEqual(resolveCompletedLoopSubtaskTabBinding({
    id: "task", workspaceKey: "workspace",
  }, "workspace", input), { context, provisional: false });
  assert.equal(resolveCompletedLoopSubtaskTabBinding({
    id: "task", workspaceKey: "workspace", departmentInvalid: true,
  }, "workspace", input), null);
  assert.equal(resolveCompletedLoopSubtaskTabBinding({
    id: "task", workspaceKey: "other",
  }, "workspace", input), null);
  assert.equal(resolveCompletedLoopSubtaskTabBinding(null, "workspace", { ...input, taskRole: "main" }), null);
});

test("rechecks a pending binding and closes after the session settles", async () => {
  const harness = cleanupHarness();
  const item = tab("sub", "session");
  harness.tabs.push(item);
  const settle = harness.cleanup.bindPrompt(item, context);
  const close = harness.cleanup.prepareClose(item.id, context);
  await assert.rejects(close(), /reason=idle-pending phase=bind[\s\S]*idle=0 released=1/);
  assert.deepEqual(harness.closed, []);
  settle?.(item.sessionId);
  await close();
  assert.deepEqual(harness.closed, ["sub"]);
  await close();
  assert.deepEqual(harness.closed, ["sub"]);
});

test("keeps a permanently rebound tab closed only by a later matching identity", async () => {
  const harness = cleanupHarness();
  const item = tab("sub", "session");
  harness.tabs.push(item);
  harness.cleanup.bindPrompt(item, { ...context, attemptId: "other" })?.(item.sessionId);
  const close = harness.cleanup.prepareClose(item.id, context);
  await assert.rejects(close(), /reason=context-mismatch phase=bind/);
  await assert.rejects(close(), /reason=context-mismatch phase=bind/);
  assert.deepEqual(harness.closed, []);
  assert.equal(harness.tabs.includes(item), true);
});

test("ends safely when the tab was closed manually, rebound, or occupied by a new run", async () => {
  const manual = cleanupHarness();
  const manualTab = tab("manual", "session");
  manual.tabs.push(manualTab);
  const preparedManual = manual.cleanup.prepareClose(manualTab.id, context);
  manual.tabs.splice(0, 1);
  await preparedManual();
  assert.deepEqual(manual.closed, []);

  const rebound = cleanupHarness();
  const reboundTab = tab("rebound", "session");
  rebound.tabs.push(reboundTab);
  const preparedRebound = rebound.cleanup.prepareClose(reboundTab.id, context);
  rebound.cleanup.bindPrompt(reboundTab, { ...context, attemptId: "next" });
  await assert.rejects(preparedRebound(), /reason=context-mismatch phase=bind/);
  assert.deepEqual(rebound.closed, []);

  const occupied = cleanupHarness();
  const occupiedTab = tab("occupied", "session");
  occupied.tabs.push(occupiedTab);
  occupied.active.add(occupiedTab.id);
  const settle = occupied.cleanup.bindPrompt(occupiedTab, context);
  const preparedOccupied = occupied.cleanup.prepareClose(occupiedTab.id, context);
  settle?.(occupiedTab.sessionId);
  await assert.rejects(preparedOccupied(), /reason=run-active phase=release[\s\S]*released=0/);
  assert.deepEqual(occupied.closed, []);
  occupied.active.delete(occupiedTab.id);
  await preparedOccupied();
  assert.deepEqual(occupied.closed, ["occupied"]);
});

test("retries a no-acceptance close across settle, release, and a temporarily unreadable task", async () => {
  let task: Pick<LoopTaskRecord, "workspaceKey" | "departmentInvalid" | "schedulingMode" | "subTasks"> | null = null;
  let reads = 0;
  const harness = cleanupHarness({ readTask: () => { reads += 1; return task; } });
  const item = tab("no-accept", "session");
  harness.tabs.push(item);
  harness.active.add(item.id);
  const resolved = resolveCompletedLoopSubtaskTabBinding(null, "workspace", {
    taskRole: "subtask", loopTaskId: context.taskId, loopSubtaskId: context.subtaskId, loopRound: context.round, loopAttemptId: context.attemptId,
  });
  assert.equal(resolved?.provisional, true);
  const settle = harness.cleanup.bindPrompt(item, resolved!.context, { provisional: true });
  const prepared = harness.cleanup.prepareClose(item.id, context);
  const attempt = await retryLoopSubtaskTabClose(prepared, () => {
    harness.active.delete(item.id);
    settle?.(item.sessionId);
    task = { workspaceKey: "workspace", schedulingMode: "event_driven", subTasks: [] };
  }, 0);
  assert.equal(attempt, 2);
  assert.equal(reads, 1);
  assert.deepEqual(harness.closed, ["no-accept"]);
  await prepared();
  assert.deepEqual(harness.closed, ["no-accept"]);
});

test("does not close when a provisional task stays unreadable or is ineligible", async () => {
  let reads = 0;
  const unreadable = cleanupHarness({ readTask: () => { reads += 1; return null; } });
  const item = tab("locked", "session");
  unreadable.tabs.push(item);
  const settle = unreadable.cleanup.bindPrompt(item, context, { provisional: true });
  settle?.(item.sessionId);
  const close = unreadable.cleanup.prepareClose(item.id, context);
  await assert.rejects(close(), /reason=task-unreadable phase=commit[\s\S]*taskReadable=0 cleanupAllowed=0/);
  await assert.rejects(close(), /reason=task-unreadable phase=commit/);
  assert.equal(reads, 2);
  assert.deepEqual(unreadable.closed, []);

  const ineligible = cleanupHarness({ readTask: () => ({ workspaceKey: "workspace", departmentInvalid: true, subTasks: [] }) });
  const other = tab("employee", "session");
  ineligible.tabs.push(other);
  ineligible.cleanup.bindPrompt(other, context, { provisional: true })?.(other.sessionId);
  await assert.rejects(ineligible.cleanup.prepareClose(other.id, context)(), /reason=cleanup-ineligible phase=close[\s\S]*taskReadable=1 cleanupAllowed=0/);
  assert.deepEqual(ineligible.closed, []);
});

test("reports a session mismatch without closing and survives a close that does not take effect", async () => {
  const harness = cleanupHarness();
  const item = tab("session", "original");
  harness.tabs.push(item);
  harness.cleanup.bindPrompt(item, context)?.(item.sessionId);
  item.sessionId = "replacement";
  item.sessionIdByCli = { codex: "replacement" };
  await assert.rejects(harness.cleanup.prepareClose(item.id, context)(), /reason=session-mismatch phase=bind[\s\S]*session=0/);
  assert.deepEqual(harness.closed, []);

  const retry = cleanupHarness();
  const retryTab = tab("retry", "session");
  retry.tabs.push(retryTab);
  retry.cleanup.bindPrompt(retryTab, context)?.(retryTab.sessionId);
  let blockRemoval = true;
  const blocked = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace",
    getTabs: () => retry.tabs,
    isTabRunActive: () => false,
    closeTab: async (candidate) => {
      if (blockRemoval) return;
      retry.tabs.splice(retry.tabs.indexOf(candidate), 1);
      retry.closed.push(candidate.id);
    },
  });
  blocked.bindPrompt(retryTab, context)?.(retryTab.sessionId);
  const close = blocked.prepareClose(retryTab.id, context);
  await assert.rejects(close(), /关闭未生效/);
  blockRemoval = false;
  await close();
  assert.deepEqual(retry.closed, ["retry"]);
});

test("closes only after the captured binding settles and then stays idempotent", async () => {
  const original = tab("captured", "session");
  const tabs = [original];
  const closed: ConversationTabRecord[] = [];
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => tabs, isTabRunActive: () => false,
    closeTab: async (candidate) => {
      const index = tabs.indexOf(candidate);
      if (index < 0) throw new Error("missing tab");
      tabs.splice(index, 1);
      closed.push(candidate);
    },
  });
  const settle = cleanup.bindPrompt(original, context);
  const close = cleanup.prepareClose(original.id, context);
  await assert.rejects(close(), /reason=idle-pending phase=bind/);
  assert.deepEqual(closed, []);
  settle?.(original.sessionId);
  await close();
  await close();
  assert.deepEqual(closed, [original]);
  assert.equal(tabs.includes(original), false);
});

test("does not close a later object that reuses the captured tab id", async () => {
  const original = tab("same", "session");
  const replacement = tab("same", "later");
  const tabs = [original];
  let originalCloses = 0;
  let replacementCloses = 0;
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => tabs, isTabRunActive: () => false,
    closeTab: async (candidate) => {
      if (candidate === original) originalCloses += 1;
      if (candidate === replacement) replacementCloses += 1;
      const index = tabs.indexOf(candidate);
      if (index >= 0) tabs.splice(index, 1);
    },
  });
  cleanup.bindPrompt(original, context);
  const close = cleanup.prepareClose(original.id, context);
  tabs[0] = replacement;
  cleanup.bindPrompt(replacement, context)?.(replacement.sessionId);
  await close();
  await close();
  assert.equal(originalCloses, 0);
  assert.equal(replacementCloses, 0);
  assert.equal(tabs[0], replacement);
});

test("keeps the original object when it is rebound to the same task and attempt", async () => {
  const original = tab("rebound-same", "session");
  const tabs = [original];
  let closes = 0;
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => tabs, isTabRunActive: () => false,
    closeTab: async () => { closes += 1; },
  });
  cleanup.bindPrompt(original, context);
  const close = cleanup.prepareClose(original.id, context);
  cleanup.bindPrompt(original, context)?.(original.sessionId);
  await assert.rejects(close(), /reason=identity-unknown phase=bind/);
  await assert.rejects(close(), /reason=identity-unknown phase=bind/);
  assert.equal(closes, 0);
  assert.equal(tabs[0], original);
});

test("does not adopt a tab object that appears after prepare had nothing to anchor", async () => {
  const tabs: ConversationTabRecord[] = [];
  let closes = 0;
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => tabs, isTabRunActive: () => false,
    closeTab: async () => { closes += 1; },
  });
  const close = cleanup.prepareClose("later", context);
  const item = tab("later", "session");
  tabs.push(item);
  cleanup.bindPrompt(item, context)?.(item.sessionId);
  await assert.rejects(close(), /reason=identity-unknown phase=close/);
  await assert.rejects(close(), /reason=identity-unknown phase=close/);
  assert.equal(closes, 0);
  assert.equal(tabs[0], item);
});

test("treats a provisional binding without a qualification reader as unverifiable", async () => {
  const item = tab("provisional", "session");
  const tabs = [item];
  let closes = 0;
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => tabs, isTabRunActive: () => false,
    closeTab: async () => { closes += 1; },
  });
  const resolved = resolveCompletedLoopSubtaskTabBinding(null, "workspace", {
    taskRole: "subtask", loopTaskId: context.taskId, loopSubtaskId: context.subtaskId,
    loopRound: context.round, loopAttemptId: context.attemptId,
  });
  assert.equal(resolved?.provisional, true);
  cleanup.bindPrompt(item, resolved!.context, { provisional: true })?.(item.sessionId);
  const close = cleanup.prepareClose(item.id, context);
  await assert.rejects(close(), /无法核验[\s\S]*reason=identity-unknown phase=commit/);
  await assert.rejects(close(), /reason=identity-unknown phase=commit/);
  assert.equal(closes, 0);
  assert.equal(tabs[0], item);
});

test("retains an evidence-less provisional tab ahead of a qualified target", async () => {
  const older = tab("older", "old-session");
  const target = tab("target", "target-session");
  const tabs = [older, target];
  const closes = new Map<ConversationTabRecord, number>();
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace",
    getTabs: () => tabs,
    isTabRunActive: () => false,
    closeTab: async (candidate) => {
      closes.set(candidate, (closes.get(candidate) ?? 0) + 1);
      const index = tabs.indexOf(candidate);
      if (index >= 0) tabs.splice(index, 1);
    },
  });
  cleanup.bindPrompt(older, { ...context, attemptId: "previous" }, { provisional: true })?.(older.sessionId);
  cleanup.bindPrompt(target, context)?.(target.sessionId);
  await cleanup.prepareClose(target.id, context)();
  assert.equal(closes.get(older) ?? 0, 0);
  assert.equal(closes.get(target) ?? 0, 1);
  assert.equal(tabs.includes(older), true);
  assert.equal(tabs.includes(target), false);
});

test("does not close the next provisional candidate when eligibility becomes unverifiable during the previous close", async () => {
  let task: Pick<LoopTaskRecord, "workspaceKey" | "department" | "departmentInvalid" | "schedulingMode" | "loopPlus" | "subTasks"> | null = {
    workspaceKey: "workspace", schedulingMode: "event_driven", subTasks: [],
  };
  const older = tab("older-readable", "old-session");
  const next = tab("next-provisional", "next-session");
  const tabs = [older, next];
  const closes = new Map<ConversationTabRecord, number>();
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace",
    getTabs: () => tabs,
    isTabRunActive: () => false,
    closeTab: async (candidate) => {
      closes.set(candidate, (closes.get(candidate) ?? 0) + 1);
      if (candidate === older) task = null;
      const index = tabs.indexOf(candidate);
      if (index >= 0) tabs.splice(index, 1);
    },
    restoredEvidence: {
      readMessages: () => [],
      readRuns: () => [],
      readTask: () => task,
    },
  });
  cleanup.bindPrompt(older, { ...context, attemptId: "previous" }, { provisional: true })?.(older.sessionId);
  cleanup.bindPrompt(next, context, { provisional: true })?.(next.sessionId);
  await assert.rejects(
    cleanup.prepareClose(next.id, context)(),
    /reason=task-unreadable phase=commit[\s\S]*taskReadable=0 cleanupAllowed=0/,
  );
  assert.equal(closes.get(older) ?? 0, 1);
  assert.equal(closes.get(next) ?? 0, 0);
  assert.equal(tabs.includes(next), true);
  assert.equal(tabs.includes(older), false);
});
