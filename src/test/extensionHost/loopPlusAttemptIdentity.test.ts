import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { selectLoopPlusContinuationDetail, selectLoopPlusInvocationAssistant, selectLoopPlusInvocationRun } = require("../../extensionHost/loopPlusRuntimeAdapter") as typeof import("../../extensionHost/loopPlusRuntimeAdapter");
const { normalizeTaskRunRecord } = require("../../promptRunState") as typeof import("../../promptRunState");
const { sanitizeMessages } = require("../../sessionStore") as typeof import("../../sessionStore");
const { resolveLoopSubtaskConversationContextFromMessages } = require("../../loopConversationPresentation") as typeof import("../../loopConversationPresentation");
import type { TaskRunRecord } from "../../promptRunState";
import type { ChatMessage } from "../../webview/types";

function run(id: string, loopAttemptId?: string, status: TaskRunRecord["status"] = "end"): TaskRunRecord {
  return {
    id,
    cli: "codex",
    sessionId: "session",
    prompt: "same prompt",
    startedAt: 100,
    endedAt: 300,
    durationMs: 200,
    status,
    taskRole: "subtask",
    loopTaskId: "task",
    loopRound: 2,
    loopSubtaskId: "child",
    ...(loopAttemptId ? { loopAttemptId } : {}),
  };
}

const boundary = { messageIds: new Set<string>(), runIds: new Set<string>(), startedAt: 90 };
const query = { taskId: "task", round: 2, role: "subtask" as const, subtaskId: "child", displayPrompt: "same prompt", attemptId: "attempt-b" };

test("overlapping Loop+ attempts are selected only by an explicitly supplied identity", () => {
  const first = run("run-a", "attempt-a");
  const second = run("run-b", "attempt-b");
  assert.equal(selectLoopPlusInvocationRun([first, second], boundary, query)?.id, "run-b");
  assert.equal(selectLoopPlusInvocationRun([first], boundary, query), null);
  assert.equal(selectLoopPlusInvocationRun([run("run-missing")], boundary, query), null);

  const assistant: ChatMessage = {
    id: "assistant-b",
    role: "assistant",
    content: "result B",
    createdAt: 200,
    taskRole: "subtask",
    loopTaskId: "task",
    loopRound: 2,
    loopSubtaskId: "child",
    loopAttemptId: "attempt-b",
  };
  assert.equal(selectLoopPlusInvocationAssistant([assistant], boundary, query, second), "result B");
  assert.equal(selectLoopPlusInvocationAssistant([{ ...assistant, loopAttemptId: "attempt-a" }], boundary, query, second), null);
  assert.equal(selectLoopPlusContinuationDetail([assistant], { ...second, status: "error" }, query), null);
});

test("run and message normalization preserve identity while legacy records remain readable", () => {
  const deps = {
    isCliName: (value: string): value is "codex" => value === "codex",
    isLoopTaskRole: (value: unknown): value is "main" | "subtask" => value === "main" || value === "subtask",
  };
  assert.equal(normalizeTaskRunRecord(run("run-b", "attempt-b"), deps)?.loopAttemptId, "attempt-b");
  assert.equal(normalizeTaskRunRecord(run("legacy"), deps)?.loopAttemptId, undefined);

  const messages: ChatMessage[] = [{
    id: "user-b",
    role: "user",
    content: "continue",
    createdAt: 200,
    taskRole: "subtask",
    loopTaskId: "task",
    loopRound: 2,
    loopSubtaskId: "child",
    loopAttemptId: "attempt-b",
  }];
  const sanitized = sanitizeMessages(messages);
  assert.equal(sanitized.messages[0].loopAttemptId, "attempt-b");
  assert.deepEqual(resolveLoopSubtaskConversationContextFromMessages(sanitized.messages), {
    taskId: "task", subtaskId: "child", round: 2, attemptId: "attempt-b",
  });
  assert.deepEqual(resolveLoopSubtaskConversationContextFromMessages([{
    ...messages[0], loopAttemptId: undefined,
  }]), { taskId: "task", subtaskId: "child", round: 2 });
  assert.equal(resolveLoopSubtaskConversationContextFromMessages([
    { ...messages[0], role: "user", loopAsk: true },
  ]), null);
});
