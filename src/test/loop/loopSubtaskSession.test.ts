import test = require("node:test");
import assert = require("node:assert/strict");
import { bindLoopSubtaskSession, inheritLoopPlusRepairSessions, normalizeLoopSubtaskSession, readLoopContinuationSource, resolveLoopSubtaskSession, withLoopSubtaskSession } from "../../loopSubtaskSession";
import type { LoopSubtaskRecord } from "../../loopTaskStore";
import type { LoopPlusDecision } from "../../loopPlusDecision";

const source: LoopSubtaskRecord = {
  id: "implementation", title: "实现", status: "completed",
  executionSession: { cli: "codex", configId: "profile", sessionId: "thread-original" },
};

test("continuation sources are explicit, trimmed, and reject invalid values", () => {
  assert.equal(readLoopContinuationSource(undefined), undefined);
  assert.equal(readLoopContinuationSource(" implementation "), "implementation");
  for (const value of [false, 1, {}, [], " "]) {
    assert.equal(readLoopContinuationSource(value), null);
  }
});

test("explicit follow-up and same-id rework restore a persisted session", () => {
  for (const decision of [{ id: "repair", continueFromSubtaskId: "implementation" }, { id: "implementation" }]) {
    assert.equal(resolveLoopSubtaskSession({ subTasks: [source] }, decision, "codex", "profile").sessionId, "thread-original");
  }
  assert.equal(resolveLoopSubtaskSession({ subTasks: [source] }, { id: "independent" }, "codex", "profile").sessionId, null);
});

test("missing, cross-parent, cross-CLI and cross-profile sessions are never resumed", () => {
  const decision = { id: "repair", continueFromSubtaskId: source.id };
  assert.equal(resolveLoopSubtaskSession({ subTasks: [] }, decision, "codex", "profile").sessionId, null);
  assert.equal(resolveLoopSubtaskSession({ subTasks: [source] }, decision, "claude", "profile").sessionId, null);
  assert.equal(resolveLoopSubtaskSession({ subTasks: [source] }, decision, "codex", "other").sessionId, null);
  for (const session of [{ ...source.executionSession, sessionId: "local_fake" }, { cli: "unknown", configId: null, sessionId: "thread" }, { cli: "codex", sessionId: "thread" }]) {
    assert.equal(normalizeLoopSubtaskSession(session), undefined);
  }
});

test("session bindings survive follow-up chains without changing unrelated records", () => {
  const tasks: LoopSubtaskRecord[] = [source, { id: "repair", title: "修补", status: "completed" }];
  const next = bindLoopSubtaskSession(tasks, "repair", source.executionSession!);
  assert.equal(next[0], source);
  assert.equal(tasks[1].executionSession, undefined);
  assert.equal(resolveLoopSubtaskSession({ subTasks: next }, { id: "next", continueFromSubtaskId: "repair" }, "codex", "profile").sessionId, "thread-original");
});

test("failed review links automatically bind repairs, while passed and ambiguous links do not", () => {
  const subtasks = [{ id: "repair", title: "修补", prompt: "修复验收指出的问题" }];
  const decision: LoopPlusDecision = { status: "accept", subtasks, reviews: [{ reviewEventId: "failure", acceptance: "failed", subtaskIds: ["repair"] }] };
  const events = [{ eventId: "failure", subtaskId: "implementation" }];
  assert.equal(inheritLoopPlusRepairSessions(decision, events).subtasks?.[0].continueFromSubtaskId, "implementation");
  assert.equal(decision.subtasks?.[0].continueFromSubtaskId, undefined);
  assert.equal(inheritLoopPlusRepairSessions({ ...decision, reviews: [{ reviewEventId: "failure", acceptance: "passed", subtaskIds: ["repair"] }] }, events).subtasks?.[0].continueFromSubtaskId, undefined);
  const ambiguous: LoopPlusDecision = { ...decision, reviews: [{ reviewEventId: "failure", acceptance: "failed", subtaskIds: ["repair"] }, { reviewEventId: "other", acceptance: "failed", subtaskIds: ["repair"] }] };
  assert.equal(inheritLoopPlusRepairSessions(ambiguous, [...events, { eventId: "other", subtaskId: "another" }]).subtasks?.[0].continueFromSubtaskId, undefined);
  assert.equal(inheritLoopPlusRepairSessions({ ...decision, subtasks: [{ ...subtasks[0], continueFromSubtaskId: "chosen" }] }, events).subtasks?.[0].continueFromSubtaskId, "chosen");
});

test("one session is serialized and its lease is released after failures", async () => {
  const events: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const first = withLoopSubtaskSession("codex", "shared-thread", async () => { events.push("first"); await hold; throw new Error("expected failure"); });
  const second = withLoopSubtaskSession("codex", "shared-thread", async () => { events.push("second"); });
  await Promise.resolve();
  assert.deepEqual(events, ["first"]);
  release();
  await assert.rejects(first, /expected failure/);
  await second;
  await withLoopSubtaskSession("codex", "shared-thread", async () => { events.push("third"); });
  assert.deepEqual(events, ["first", "second", "third"]);
});

test("a follow-up waits for its source even when the first execution acquired its session after startup", async () => {
  const events: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const first = withLoopSubtaskSession("codex", null, async () => { events.push("source"); await hold; }, { taskId: "parent", subtaskId: "A" });
  const next = withLoopSubtaskSession("codex", "newly-created-session", async () => { events.push("follow-up"); }, { taskId: "parent", subtaskId: "B", sourceSubtaskId: "A" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["source"]);
  release();
  await Promise.all([first, next]);
  assert.deepEqual(events, ["source", "follow-up"]);
});
