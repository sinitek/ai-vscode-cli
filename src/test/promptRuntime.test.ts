import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  buildHiddenRetryPrompt,
  buildThinkingPrompt,
} = require("../promptRuntime") as typeof import("../promptRuntime");
const {
  FINAL_ANSWER_PROMPT_INSTRUCTION,
  FINAL_ANSWER_TEXT_MARKER,
} = require("../finalAnswerProtocol") as typeof import("../finalAnswerProtocol");

test("adds the final-answer marker instruction to every supported CLI prompt", () => {
  for (const cli of ["codex", "claude", "opencode"] as const) {
    const prompt = buildThinkingPrompt(cli, "medium", "implement the task");
    assert.match(prompt, /implement the task/);
    assert.ok(prompt.endsWith(FINAL_ANSWER_PROMPT_INSTRUCTION));
    assert.equal(prompt.split(FINAL_ANSWER_TEXT_MARKER).length - 1, 2);
  }
});

test("adds the final-answer marker instruction to hidden retry prompts", () => {
  const prompt = buildHiddenRetryPrompt("claude", "high");

  assert.ok(prompt.includes(FINAL_ANSWER_TEXT_MARKER));
  assert.ok(prompt.endsWith(FINAL_ANSWER_PROMPT_INSTRUCTION));
});

test("allows machine-protocol runs to opt out of the human final-answer marker", () => {
  const prompt = buildThinkingPrompt("codex", "high", '{"status":"completed"}', {
    includeFinalAnswerInstruction: false,
  });
  const retryPrompt = buildHiddenRetryPrompt("opencode", "high", {
    includeFinalAnswerInstruction: false,
  });

  assert.doesNotMatch(prompt, /\[final_answer\]/);
  assert.doesNotMatch(retryPrompt, /\[final_answer\]/);
});
