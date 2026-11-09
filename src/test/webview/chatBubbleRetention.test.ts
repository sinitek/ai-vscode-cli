import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import {
  buildChatBubbleRetentionRuntimeSource,
  isProtectedChatBubbleMessage,
  selectRetainedChatBubbleEntries,
  type ChatBubbleRetentionEntry,
} from "../../webview/chatBubbleRetention";

function entries(count: number): ChatBubbleRetentionEntry[] {
  return Array.from({ length: count }, (_, index) => ({ message: { content: "same" }, index, protected: false }));
}

test("retention uses cumulative trigger and batch boundaries", () => {
  for (const [count, expectedCount, firstIndex] of [[550, 550, 0], [551, 451, 100], [650, 550, 100], [651, 451, 200]]) {
    const retained = selectRetainedChatBubbleEntries(entries(count), 500);
    assert.equal(retained.length, expectedCount);
    assert.equal(retained[0].index, firstIndex);
  }
});

test("retention removes oldest process entries, skipping interleaved protected entries without mutating inputs", () => {
  const source = entries(12).map((entry) => Object.freeze({ ...entry, protected: entry.index % 3 === 0 }));
  Object.freeze(source);
  const retained = selectRetainedChatBubbleEntries(source, 5);
  assert.deepEqual(retained.map((entry) => entry.index), [0, 3, 6, 9, 11]);
  retained.forEach((entry) => assert.equal(entry, source[entry.index]));
  assert.equal(source.length, 12);
  assert.deepEqual(source.map((entry) => entry.index), Array.from({ length: 12 }, (_, index) => index));
});

test("all protected entries exceed threshold safely; tiny limits and empty arrays work", () => {
  const protectedEntries = entries(1000).map((entry) => ({ ...entry, protected: true }));
  assert.equal(selectRetainedChatBubbleEntries(protectedEntries, 1).length, 1000);
  assert.deepEqual(selectRetainedChatBubbleEntries([], 1), []);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(2), 1).map((entry) => entry.index), [1]);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(20), 1).map((entry) => entry.index), [19]);
});

test("large histories retain original indices and order without content deduplication", () => {
  const retained = selectRetainedChatBubbleEntries(entries(100_000), 500);
  assert.equal(retained.length, 500);
  assert.equal(retained[0].index, 99_500);
  assert.equal(retained[499].index, 99_999);
});

test("ordinary unmarked assistant replies are protected conservatively; explicit finals override process styles", () => {
  const protect = (message: Parameters<typeof isProtectedChatBubbleMessage>[0], process = false) =>
    isProtectedChatBubbleMessage(message, "[final_answer]", process);
  assert.equal(protect({ role: "user", kind: "thinking" }, true), true);
  assert.equal(protect({ role: "assistant", content: "**Thinking** ordinary legacy answer" }), true);
  for (const kind of ["thinking", "tool-use", "tool-result", "tool"]) {
    assert.equal(protect({ role: "assistant", kind }), false);
  }
  assert.equal(protect({ role: "assistant", subagentId: "worker" }), false);
  assert.equal(protect({ role: "assistant" }, true), false);
  assert.equal(protect({ role: "trace" }), false);
  assert.equal(protect({ role: "system" }), false);
  for (const marker of [{ loopAnswerConclusion: true }, { loopFinalSummary: true }, { codexFinalAnswer: true }, { content: "[final_answer] done" }]) {
    assert.equal(protect({ role: "assistant", kind: "thinking", subagentId: "worker", ...marker }, true), true);
  }
});

test("runtime injection executes the identical algorithm and protection implementation", () => {
  const runtime = vm.runInNewContext(`${buildChatBubbleRetentionRuntimeSource()}; ({ selectRetainedChatBubbleEntries, isProtectedChatBubbleMessage })`);
  const source = entries(651);
  assert.deepEqual(Array.from(runtime.selectRetainedChatBubbleEntries(source, 500)), selectRetainedChatBubbleEntries(source, 500));
  assert.equal(runtime.isProtectedChatBubbleMessage({ role: "assistant", kind: "thinking", content: "[final_answer] done" }, "[final_answer]"), true);
});
