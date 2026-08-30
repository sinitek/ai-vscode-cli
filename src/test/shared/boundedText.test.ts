import test = require("node:test");
import assert = require("node:assert/strict");

import {
  appendBoundedUtf8Text,
  getUtf8ByteLength,
  trimUtf8TextStartToMaxBytes,
} from "../../boundedText";

test("keeps bounded text tail without truncating under limit", () => {
  const result = appendBoundedUtf8Text("abc", "def", 10);

  assert.deepEqual(result, {
    text: "abcdef",
    truncated: false,
  });
});

test("trims bounded text from the start and preserves utf8 byte limit", () => {
  const result = appendBoundedUtf8Text("1234567890", "abcdef", 8);

  assert.equal(result.text, "90abcdef");
  assert.equal(result.truncated, true);
  assert.ok(getUtf8ByteLength(result.text) <= 8);
});

test("handles multibyte content while preserving the newest suffix", () => {
  const result = trimUtf8TextStartToMaxBytes("旧旧最新", 6);

  assert.equal(result.truncated, true);
  assert.ok(result.text.endsWith("最新"));
  assert.ok(getUtf8ByteLength(result.text) <= 6);
});

test("does not leave a dangling surrogate when trimming emoji content", () => {
  const result = trimUtf8TextStartToMaxBytes("😀abc", 4);

  assert.equal(result.text, "abc");
  assert.equal(result.truncated, true);
  assert.ok(getUtf8ByteLength(result.text) <= 4);
});

test("keeps only the newest oversized chunk tail without concatenating old text", () => {
  const result = appendBoundedUtf8Text("old-prefix", "1234567890", 4);

  assert.deepEqual(result, {
    text: "7890",
    truncated: true,
  });
});
