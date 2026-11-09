import test = require("node:test");
import assert = require("node:assert/strict");
import {
  CHAT_MESSAGE_LIMIT_DEFAULT,
  CHAT_MESSAGE_LIMIT_MIN,
  CHAT_MESSAGE_LIMIT_MAX,
  normalizeChatMessageLimit,
} from "../../chatMessageLimit";

test("chat message limit exports the shared contract", () => {
  assert.equal(CHAT_MESSAGE_LIMIT_DEFAULT, 500);
  assert.equal(CHAT_MESSAGE_LIMIT_MIN, 1);
  assert.equal(CHAT_MESSAGE_LIMIT_MAX, 10000);
});

test("chat message limit rejects missing, blank, nonnumeric and nonfinite input", () => {
  for (const value of [undefined, null, "", "   ", "nope", true, false, {}, [], [10], NaN, Infinity, -Infinity, "Infinity", "NaN", "1e999", Symbol("limit"), 10n]) {
    assert.equal(normalizeChatMessageLimit(value), CHAT_MESSAGE_LIMIT_DEFAULT, String(value));
  }
});

test("chat message limit floors finite numbers and nonempty numeric strings before clamping", () => {
  for (const [value, expected] of [
    [0, 1], [-5, 1], [-0.5, 1], [0.9, 1], [1, 1], [500, 500],
    [731.9, 731], [10000, 10000], [10001, 10000], [Number.MAX_VALUE, 10000],
    [" 810.9 ", 810], ["0", 1], ["-7.1", 1], ["10000.9", 10000], ["1e3", 1000],
  ] as const) {
    assert.equal(normalizeChatMessageLimit(value), expected, String(value));
  }
});
