import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildAppServerRequestResolution,
  buildForwardedRawEvent,
  buildTurnFailureMessage,
  extractDelta,
  extractItemErrorMessage,
  extractReasoningText,
  normalizeTodoListItems,
  shouldSuppressRawEvent,
  toExecLikeItem,
} from "../interactive/codexAppServerProtocol";

test("extractDelta returns appended content and falls back to common-prefix delta", () => {
  assert.equal(extractDelta("", "hello"), "hello");
  assert.equal(extractDelta("hello", "hello world"), " world");
  assert.equal(extractDelta("hello world", "hello there"), "there");
  assert.equal(extractDelta("unchanged", ""), "");
});

test("normalizeTodoListItems supports text, step, completed, and status fields", () => {
  assert.deepEqual(
    normalizeTodoListItems([
      { text: " First ", completed: true },
      { step: "Second", status: "completed" },
      { text: "Third", status: "pending" },
      { text: "   " },
      "ignored",
    ]),
    [
      { text: "First", done: true },
      { text: "Second", done: true },
      { text: "Third", done: false },
    ]
  );
});

test("extractReasoningText flattens reasoning fragments and removes duplicates", () => {
  assert.equal(
    extractReasoningText({
      text: [{ text: "Consider A" }, { summary: "Consider B" }],
      summary: "Consider A",
      content: [{ title: "Decision" }, { content: "Ship it" }],
    }),
    "Consider A\nConsider B\nDecision\nShip it"
  );
});

test("extractReasoningText removes only standalone empty HTML comments", () => {
  assert.equal(
    extractReasoningText({
      text: "**Planning first step**\n\n<!-- -->",
      summary: [
        "**Planning second step**\n\n<!--\t-->",
        "Keep inline <!-- --> example",
        "<!-- keep this explanation -->",
      ],
    }),
    [
      "**Planning first step**",
      "**Planning second step**",
      "Keep inline <!-- --> example",
      "<!-- keep this explanation -->",
    ].join("\n")
  );
});

test("toExecLikeItem normalizes item type, web search action, aliases, and errors", () => {
  assert.deepEqual(
    toExecLikeItem({
      type: "commandExecution",
      action: { type: "openPage", url: "https://example.test" },
      aggregatedOutput: "stdout",
      exitCode: 2,
      durationMs: 123,
      error: { detail: "failed" },
    }),
    {
      type: "command_execution",
      action: { type: "open_page", url: "https://example.test" },
      aggregatedOutput: "stdout",
      aggregated_output: "stdout",
      exitCode: 2,
      exit_code: 2,
      durationMs: 123,
      duration_ms: 123,
      error: "failed",
    }
  );
});

test("extractItemErrorMessage prefers structured message fields", () => {
  assert.equal(extractItemErrorMessage({ error: " plain " }), "plain");
  assert.equal(extractItemErrorMessage({ error: { message: "message wins", detail: "detail" } }), "message wins");
  assert.equal(extractItemErrorMessage({ error: { detail: "detail wins" } }), "detail wins");
});

test("buildForwardedRawEvent preserves raw event payload shapes", () => {
  assert.deepEqual(
    buildForwardedRawEvent({ method: "thread/started", params: { thread: { id: "thread-1" } } }),
    { type: "thread.started", thread_id: "thread-1" }
  );
  assert.deepEqual(
    buildForwardedRawEvent({
      method: "turn/plan/updated",
      params: {
        turnId: "turn-1",
        threadId: "thread-1",
        explanation: "next",
        plan: [{ step: "Do work", status: "completed" }],
      },
    }),
    {
      type: "turn.plan.updated",
      turnId: "turn-1",
      threadId: "thread-1",
      explanation: "next",
      plan: [{ step: "Do work", status: "completed" }],
    }
  );
  assert.deepEqual(
    buildForwardedRawEvent({
      method: "item/completed",
      params: {
        item: {
          type: "reasoning",
          text: [{ text: "Think" }],
        },
      },
    }),
    {
      type: "item.completed",
      item: {
        type: "reasoning",
        text: "Think",
      },
    }
  );
});

test("buildForwardedRawEvent filters deltas, codex nested events, and unsupported item events", () => {
  assert.equal(shouldSuppressRawEvent("item/agentMessage/delta"), true);
  assert.equal(buildForwardedRawEvent({ method: "item/agentMessage/delta", params: { delta: "x" } }), null);
  assert.equal(buildForwardedRawEvent({ method: "codex/event/item/completed", params: {} }), null);
  assert.equal(buildForwardedRawEvent({ method: "item/started", params: { item: { type: "reasoning" } } }), null);
  assert.equal(buildForwardedRawEvent({ method: "error", params: { message: "   " } }), null);
});

test("buildTurnFailureMessage prefers server error details", () => {
  assert.equal(
    buildTurnFailureMessage({ turn: { error: { additionalDetails: "server failed" } } }, "fallback failed"),
    "server failed"
  );
  assert.equal(
    buildTurnFailureMessage(
      { turn: { error: { message: "message failed", additionalDetails: "server failed" } } },
      "fallback failed"
    ),
    "message failed"
  );
  assert.equal(buildTurnFailureMessage({ turn: {} }, "fallback failed"), "fallback failed");
});

test("buildAppServerRequestResolution answers known app-server requests and rejects unknown ones", () => {
  assert.deepEqual(
    buildAppServerRequestResolution("item/commandExecution/requestApproval", "unsupported"),
    { result: { decision: "decline" } }
  );
  assert.deepEqual(
    buildAppServerRequestResolution("item/tool/requestUserInput", "unsupported"),
    { result: { answers: {} } }
  );
  const unsupported = buildAppServerRequestResolution("unknown/request", "unsupported unknown/request");
  assert.equal(unsupported.result, undefined);
  assert.equal(unsupported.error?.code, -32601);
  assert.match(unsupported.error?.message ?? "", /unknown\/request/);
});
