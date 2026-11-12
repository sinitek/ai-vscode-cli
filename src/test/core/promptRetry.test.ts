import test = require("node:test");
import assert = require("node:assert/strict");
import {
  appendHiddenRetryErrorTraceMessage,
  buildHiddenRetryLimitMessage,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
  createHiddenRetryErrorTraceMessage,
  getAttemptFailureMessage,
  getErrorInfo,
  HIDDEN_RETRY_MAX_RETRIES,
  isHiddenRetryEligibleAttempt,
  isHiddenRetryEligibleErrorInfo,
  waitForHiddenRetryDelay,
} from "../../promptRetry";
import { HIDDEN_RETRY_DELAY_SEQUENCE_MS } from "../../hiddenRetry";
import type { ChatMessage } from "../../webview/types";

test("normalizes error shapes without discarding error metadata", () => {
  const error = Object.assign(new Error("network failed"), { code: "ECONNRESET" });
  assert.deepEqual(getErrorInfo(error), { message: error.message, name: "Error", code: "ECONNRESET", stack: error.stack });
  assert.deepEqual(getErrorInfo("text"), { message: "text" });
  assert.deepEqual(getErrorInfo(null), { message: "null" });
  assert.deepEqual(getErrorInfo({ message: "object", name: "ProviderError", code: 402, stack: "stack" }), {
    message: "object", name: "ProviderError", code: undefined, stack: "stack",
  });
  assert.deepEqual(getErrorInfo({}), { message: "[object Object]", name: undefined, code: undefined, stack: undefined });
  assert.equal(getAttemptFailureMessage({ type: "error", error }), "network failed");
  assert.equal(getAttemptFailureMessage({ type: "error", error: new Error("") }), "未知错误");
  assert.equal(getAttemptFailureMessage({ type: "exit", code: 1 }, "  provider failed  "), "provider failed");
  assert.match(getAttemptFailureMessage({ type: "exit", code: null }, " "), /unknown/u);
});

test("retry eligibility preserves transient success and deterministic rejection branches", () => {
  for (const info of [
    { name: "AbortError", message: "cancelled" }, { message: "request aborted" },
    { code: "RUNNER_DISPOSED", message: "disposed" }, { message: "" },
    { code: "GROK_RESPONSES_STREAM_INCOMPATIBLE", message: "incompatible" },
    { code: "ENOENT", message: "spawn failed" }, { message: "spawn ENOENT" },
    { code: "HTTP_402", message: "payment" }, { message: "HTTP 402 Payment Required" },
    { message: "insufficient credits" }, { message: "model pool requires 1 points, remaining 0" },
    { code: "model_not_found", message: "model unavailable" },
    { message: "Model is not supported by any configured account" },
  ]) {
    assert.equal(isHiddenRetryEligibleErrorInfo(info), false, JSON.stringify(info));
  }
  assert.equal(isHiddenRetryEligibleErrorInfo({ code: "ECONNRESET", message: "socket hang up" }), true);
  assert.equal(isHiddenRetryEligibleErrorInfo({ message: "HTTP 429 Too Many Requests" }), true);
  assert.equal(isHiddenRetryEligibleAttempt({ type: "exit", code: 1 }, "insufficient balance"), false);
  assert.equal(isHiddenRetryEligibleAttempt({ type: "exit", code: 1 }, "other exit"), true);
  assert.equal(isHiddenRetryEligibleAttempt({ type: "error", error: new Error("temporary") }, "temporary"), true);
  assert.equal(isHiddenRetryEligibleAttempt({ type: "error", error: new Error("abort") }, "abort"), false);
});

test("Codex writer conflicts and unsafe handoffs never enter hidden retry", () => {
  for (const code of ["CODEX_THREAD_BUSY", "CODEX_THREAD_HANDOFF_FAILED", "CODEX_THREAD_WRITER_CONFLICT"]) {
    assert.equal(isHiddenRetryEligibleErrorInfo({ code, message: "会话交接未完成" }), false);
  }
  const message = "thread abc already has an active writer";
  assert.equal(isHiddenRetryEligibleErrorInfo({ message }), false);
  assert.equal(isHiddenRetryEligibleAttempt({ type: "exit", code: 1 }, message), false);
});

test("trace preserves metadata, stores before sending, and deduplicates only adjacent errors", () => {
  const messages: ChatMessage[] = [];
  const sent: unknown[] = [];
  let serial = 0;
  const options = { tabId: "tab", taskRole: "subtask" as const, loopTaskId: "task", loopRound: 3, loopSubtaskId: "sub" };
  const deps = {
    createMessageId: () => `message-${serial += 1}`,
    sendPanelMessage: (payload: { type: "appendMessage"; message: ChatMessage; tabId?: string }) => {
      assert.strictEqual(messages.at(-1), payload.message);
      sent.push(payload);
    },
  };
  appendHiddenRetryErrorTraceMessage(null, "failed", options, deps);
  appendHiddenRetryErrorTraceMessage(undefined, "failed", options, deps);
  assert.equal(serial, 0);
  appendHiddenRetryErrorTraceMessage(messages, " failed ", options, deps);
  const first = messages[0];
  assert.deepEqual(first, {
    id: "message-1", role: "trace", content: "error\nfailed", createdAt: first.createdAt, sequence: 0,
    kind: "normal", merge: false, taskRole: "subtask", loopTaskId: "task", loopRound: 3, loopSubtaskId: "sub",
  });
  assert.deepEqual(sent, [{ type: "appendMessage", message: first, tabId: "tab" }]);
  first.content = "error: failed";
  appendHiddenRetryErrorTraceMessage(messages, "failed", { ...options, loopRound: 4 }, deps);
  assert.equal(serial, 1);
  messages.push({ id: "reply", role: "assistant", content: "between errors", createdAt: 1 });
  appendHiddenRetryErrorTraceMessage(messages, "failed", {}, deps);
  assert.equal(serial, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(sent[1], "tabId"), false);
  assert.equal(createHiddenRetryErrorTraceMessage("", {}, deps).content, "error\n未知错误");
});

test("retry messages reuse the five-step delay schedule", () => {
  assert.deepEqual(HIDDEN_RETRY_DELAY_SEQUENCE_MS, [5000, 15000, 30000, 120000, 300000]);
  assert.equal(HIDDEN_RETRY_MAX_RETRIES, 5);
  assert.match(buildHiddenRetryLimitMessage(), /5 秒 \/ 15 秒 \/ 30 秒 \/ 2 分钟 \/ 5 分钟/u);
  assert.match(buildHiddenRetryQueuedMessage(0), /5 秒/u);
  assert.match(buildHiddenRetryQueuedMessage(3), /2 分钟/u);
  assert.match(buildHiddenRetryStartedMessage(2), /2/u);
});

test("retry waiting polls at most 500ms and stops when the run becomes inactive without real waits", async (context) => {
  let now = 0;
  const waits: number[] = [];
  context.mock.method(Date, "now", () => now);
  context.mock.method(global, "setTimeout", (callback: () => void, delay: number) => {
    waits.push(delay);
    now += delay;
    callback();
    return {} as NodeJS.Timeout;
  });
  assert.equal(await waitForHiddenRetryDelay(1, () => false), false);
  assert.deepEqual(waits, []);
  assert.equal(await waitForHiddenRetryDelay(1, () => true), true);
  assert.equal(waits.length, 10);
  assert.equal(waits.every((delay) => delay > 0 && delay <= 500), true);
  waits.length = 0;
  let checks = 0;
  assert.equal(await waitForHiddenRetryDelay(5, () => (checks += 1) < 3), false);
  assert.deepEqual(waits, [500, 500]);
  waits.length = 0;
  now = 0;
  assert.equal(await waitForHiddenRetryDelay(1, () => now < 5000), false);
  assert.equal(waits.length, 10);
});
