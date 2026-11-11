import test = require("node:test");
import assert = require("node:assert/strict");
import { selectLoopGroupChatBubbles, type LoopGroupChatBubbleWindow } from "../../webview/loopGroupChatBubbleRetention";

function createEntries(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

test("group chat defaults to 200 and removes the oldest 50 when the threshold is reached", () => {
  for (const [count, retainedCount, first] of [[0, 0, undefined], [199, 199, 0], [200, 150, 50], [201, 151, 50], [249, 199, 50], [250, 150, 100], [2001, 151, 1850]] as const) {
    const retained = selectLoopGroupChatBubbles(createEntries(count), undefined);
    assert.equal(retained.length, retainedCount);
    assert.equal(retained[0], first);
    if (count) {
      assert.equal(retained.at(-1), count - 1);
    }
  }
});

test("group chat keeps the removed prefix hidden when thinking bubbles disappear", () => {
  const window: LoopGroupChatBubbleWindow = { start: 0 };
  assert.deepEqual(selectLoopGroupChatBubbles(createEntries(200), 200, window), createEntries(200).slice(50));
  assert.deepEqual(selectLoopGroupChatBubbles(createEntries(199), 200, window), createEntries(199).slice(50));
  assert.equal(selectLoopGroupChatBubbles(createEntries(249), 200, window).length, 199);
  assert.deepEqual(selectLoopGroupChatBubbles(createEntries(250), 200, window), createEntries(250).slice(100));
});

test("group chat scales the batch size and reapplies the window when its setting changes", () => {
  const entries = createEntries(200);
  const window: LoopGroupChatBubbleWindow = { start: 0 };
  assert.equal(selectLoopGroupChatBubbles(entries, 200, window).length, 150);
  assert.deepEqual(selectLoopGroupChatBubbles(entries, 400, window), entries);
  assert.deepEqual(selectLoopGroupChatBubbles(entries, 100, window), entries.slice(125));
  assert.equal(selectLoopGroupChatBubbles(createEntries(7), 7, window).length, 5);
});

test("group chat rejects invalid limits, normalizes numeric input and never drops the newest bubble", () => {
  for (const value of [null, "", " ", "bad", true, {}, [], Infinity, NaN]) {
    assert.equal(selectLoopGroupChatBubbles(createEntries(200), value).length, 150);
  }
  for (const value of [1, 0, -20, "1.9"]) {
    assert.deepEqual(selectLoopGroupChatBubbles(createEntries(200), value), [199]);
    assert.deepEqual(selectLoopGroupChatBubbles([], value), []);
  }
  assert.equal(selectLoopGroupChatBubbles(createEntries(10000), 20000).length, 7500);
  assert.equal(selectLoopGroupChatBubbles(createEntries(10), " 10.9 ").length, 7);
});

test("group chat selection does not mutate its transcript entries", () => {
  const entries = Object.freeze(createEntries(200));
  const retained = selectLoopGroupChatBubbles(entries, 200);
  assert.equal(entries.length, 200);
  assert.notEqual(retained, entries);
  assert.deepEqual(retained, entries.slice(50));
});
