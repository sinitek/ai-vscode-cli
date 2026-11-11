import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import {
  buildChatBubbleRetentionRuntimeSource,
  selectRetainedChatBubbleEntries,
  type ChatBubbleRetentionEntry,
} from "../../webview/chatBubbleRetention";

function entries(count: number): ChatBubbleRetentionEntry[] {
  return Array.from({ length: count }, (_, index) => ({ message: { content: "same" }, index, protected: false }));
}

test("retention starts at the limit and removes oldest 25 percent batches", () => {
  for (const [count, expectedCount, firstIndex] of [[499, 499, 0], [500, 375, 125], [501, 376, 125], [624, 499, 125], [625, 375, 250]]) {
    const retained = selectRetainedChatBubbleEntries(entries(count), 500);
    assert.equal(retained.length, expectedCount);
    assert.equal(retained[0].index, firstIndex);
  }
});

test("retention skips protected entries inside the oldest window without deleting newer entries or mutating inputs", () => {
  const source = entries(12).map((entry) => Object.freeze({ ...entry, protected: entry.index % 3 === 0 }));
  Object.freeze(source);
  const retained = selectRetainedChatBubbleEntries(source, 5);
  assert.deepEqual(retained.map((entry) => entry.index), [0, 3, 6, 8, 9, 10, 11]);
  retained.forEach((entry) => assert.equal(entry, source[entry.index]));
  assert.equal(source.length, 12);
  assert.deepEqual(source.map((entry) => entry.index), Array.from({ length: 12 }, (_, index) => index));
});

test("protected entries consume positions in the oldest batch instead of extending deletion into newer messages", () => {
  const source = entries(500).map((entry) => ({ ...entry, protected: entry.index === 0 || entry.index === 50 }));
  const retained = selectRetainedChatBubbleEntries(source, 500);
  assert.equal(retained.length, 377);
  assert.deepEqual(retained.slice(0, 4).map((entry) => entry.index), [0, 50, 125, 126]);
  assert.deepEqual(selectRetainedChatBubbleEntries(source, 500), retained);
});

test("all protected entries exceed threshold safely; tiny limits and empty arrays work", () => {
  const protectedEntries = entries(1000).map((entry) => ({ ...entry, protected: true }));
  assert.equal(selectRetainedChatBubbleEntries(protectedEntries, 1).length, 1000);
  assert.deepEqual(selectRetainedChatBubbleEntries([], 1), []);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(1), 1), []);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(2), 1), []);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(20), 1), []);
});

test("retention rounds quarter batches up and supports the maximum configured limit", () => {
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(4), 5).map((entry) => entry.index), [0, 1, 2, 3]);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(5), 5).map((entry) => entry.index), [2, 3, 4]);
  assert.deepEqual(selectRetainedChatBubbleEntries(entries(7), 5).map((entry) => entry.index), [4, 5, 6]);
  assert.equal(selectRetainedChatBubbleEntries(entries(10_000), 10_000).length, 7500);
  assert.equal(selectRetainedChatBubbleEntries(entries(500)).length, 375);
});

test("large histories retain original indices and order without content deduplication", () => {
  const retained = selectRetainedChatBubbleEntries(entries(100_000), 500);
  assert.equal(retained.length, 375);
  assert.equal(retained[0].index, 99_625);
  assert.equal(retained[374].index, 99_999);
});

test("runtime injection executes the identical oldest-window algorithm", () => {
  const runtime = vm.runInNewContext(`${buildChatBubbleRetentionRuntimeSource()}; ({ selectRetainedChatBubbleEntries })`);
  const source = entries(625);
  assert.deepEqual(Array.from(runtime.selectRetainedChatBubbleEntries(source, 500)), selectRetainedChatBubbleEntries(source, 500));
});
