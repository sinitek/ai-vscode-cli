import test = require("node:test");
import assert = require("node:assert/strict");

import {
  computeTokensInContextWindow,
  extractCodexThreadTokenUsage,
  formatTokensInContextWindowK,
} from "../../interactive/codexTokenUsage";

test("extractCodexThreadTokenUsage uses last.tokens_in_context_window helper", () => {
  assert.deepEqual(
    extractCodexThreadTokenUsage({
      threadId: "thread-1",
      turnId: "turn-1",
      tokenUsage: {
        total: { totalTokens: 90000, inputTokens: 80000, cachedInputTokens: 0, outputTokens: 10000, reasoningOutputTokens: 800 },
        last: { totalTokens: 12345, inputTokens: 10000, cachedInputTokens: 2000, outputTokens: 2345, reasoningOutputTokens: 345 },
        modelContextWindow: 272000,
      },
    }),
    {
      tokensInContextWindow: 12000,
      modelContextWindow: 272000,
      threadId: "thread-1",
      turnId: "turn-1",
    },
  );
});

test("extractCodexThreadTokenUsage accepts snake_case TokenUsageInfo fallbacks", () => {
  assert.deepEqual(
    extractCodexThreadTokenUsage({
      thread_id: "thread-2",
      turn_id: "turn-2",
      token_usage: {
        last_token_usage: { total_tokens: 512, reasoning_output_tokens: 12 },
        total_token_usage: { total_tokens: 2048 },
        model_context_window: 128000,
      },
    }),
    {
      tokensInContextWindow: 500,
      modelContextWindow: 128000,
      threadId: "thread-2",
      turnId: "turn-2",
    },
  );
});

test("extractCodexThreadTokenUsage reads turn.tokenUsage last snapshot and rejects lifetime totals", () => {
  assert.equal(
    extractCodexThreadTokenUsage({
      threadId: "thread-3",
      turn: {
        id: "turn-3",
        tokenUsage: {
          last: { totalTokens: 4096, reasoningOutputTokens: 96 },
          total: { totalTokens: 88000 },
          modelContextWindow: 272000,
        },
      },
    })?.tokensInContextWindow,
    4000,
  );
  assert.equal(
    extractCodexThreadTokenUsage({
      tokenUsage: {
        totalTokens: 2048,
        reasoningOutputTokens: 48,
      },
    })?.tokensInContextWindow,
    2000,
  );
  assert.equal(extractCodexThreadTokenUsage(null), null);
  assert.equal(extractCodexThreadTokenUsage({ tokenUsage: { last: { totalTokens: -1 } } }), null);
  assert.equal(extractCodexThreadTokenUsage({ tokenUsage: { last: { inputTokens: 12 } } }), null);
  assert.equal(extractCodexThreadTokenUsage({ tokenUsage: { total: { totalTokens: 4096 } } }), null);
});

test("computeTokensInContextWindow prefers explicit field and saturates reasoning subtraction", () => {
  assert.equal(computeTokensInContextWindow({ tokensInContextWindow: 1500, totalTokens: 2000, reasoningOutputTokens: 900 }), 1500);
  assert.equal(computeTokensInContextWindow({ totalTokens: 200, reasoningOutputTokens: 500 }), 0);
  assert.equal(computeTokensInContextWindow({ total_tokens: "1024" }), 1024);
  assert.equal(computeTokensInContextWindow({ inputTokens: 12 }), null);
});

test("formatTokensInContextWindowK uses k units", () => {
  assert.equal(formatTokensInContextWindowK(0), "0k");
  assert.equal(formatTokensInContextWindowK(499), "0.5k");
  assert.equal(formatTokensInContextWindowK(1000), "1k");
  assert.equal(formatTokensInContextWindowK(1234), "1.2k");
  assert.equal(formatTokensInContextWindowK(12345), "12k");
  assert.equal(formatTokensInContextWindowK(272000), "272k");
  assert.equal(formatTokensInContextWindowK(-1), "");
  assert.equal(formatTokensInContextWindowK(Number.NaN), "");
});
