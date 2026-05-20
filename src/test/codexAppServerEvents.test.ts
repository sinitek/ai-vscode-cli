import test = require("node:test");
import assert = require("node:assert/strict");

import { isCodexContextCompactionCompletedNotification } from "../interactive/codexAppServerEvents";

test("detects thread/compacted notification for the expected thread", () => {
  assert.equal(
    isCodexContextCompactionCompletedNotification({
      method: "thread/compacted",
      params: { threadId: "thread-1" },
    }, "thread-1"),
    true
  );
});

test("detects context compaction completion item with normalized type", () => {
  assert.equal(
    isCodexContextCompactionCompletedNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: { type: "context_compaction" },
      },
    }, "thread-1"),
    true
  );
});

test("ignores compaction notifications for a different thread", () => {
  assert.equal(
    isCodexContextCompactionCompletedNotification({
      method: "thread/compacted",
      params: { threadId: "thread-2" },
    }, "thread-1"),
    false
  );
});
