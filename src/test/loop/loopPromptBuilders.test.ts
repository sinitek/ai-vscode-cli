import test = require("node:test");
import assert = require("node:assert/strict");
import { normalizeLoopContinuePromptForPrompt, formatLoopEstimatedRemainingRounds } from "../../loopPromptBuilders";

test("normalizes Loop continuation prompts without any execution mode", () => {
  assert.equal(normalizeLoopContinuePromptForPrompt("  补充验证  "), "补充验证");
  assert.equal(normalizeLoopContinuePromptForPrompt("   "), null);
  assert.equal(normalizeLoopContinuePromptForPrompt(undefined), null);
});

test("formats finite remaining Loop rounds", () => {
  assert.equal(formatLoopEstimatedRemainingRounds(2.4), "2");
  assert.equal(formatLoopEstimatedRemainingRounds(-1), "0");
  assert.equal(formatLoopEstimatedRemainingRounds(Number.NaN), null);
});
