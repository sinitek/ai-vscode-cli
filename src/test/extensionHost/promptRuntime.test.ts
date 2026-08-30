import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildHiddenRetryPrompt,
  buildThinkingPrompt,
  HUMAN_INTERACTION_PROMPT_INSTRUCTION,
  CODEX_TASK_LIST_PROMPT_INSTRUCTION,
} = require("../../promptRuntime") as typeof import("../../promptRuntime");
const {
  FINAL_ANSWER_PROMPT_INSTRUCTION,
  FINAL_ANSWER_TEXT_MARKER,
} = require("../../finalAnswerProtocol") as typeof import("../../finalAnswerProtocol");

test("adds the final-answer marker instruction to every supported CLI prompt", () => {
  for (const cli of ["codex", "claude", "opencode"] as const) {
    const prompt = buildThinkingPrompt(cli, "medium", "implement the task");
    assert.match(prompt, /implement the task/);
    assert.ok(prompt.endsWith(FINAL_ANSWER_PROMPT_INSTRUCTION));
    assert.equal(prompt.split(FINAL_ANSWER_TEXT_MARKER).length - 1, 2);
  }
});

test("adds the Codex Tasklist logging format before the final-answer instruction", () => {
  const prompt = buildThinkingPrompt("codex", "medium", "implement the task");

  assert.match(prompt, /Tasklist:\n- \[completed\] <已完成事项>\n- \[in_progress\] <当前事项>\n- \[pending\] <下一步事项>/);
  assert.match(prompt, /Simplified Chinese \(中文\)/);
  assert.ok(prompt.includes(CODEX_TASK_LIST_PROMPT_INSTRUCTION));
  assert.ok(prompt.indexOf(CODEX_TASK_LIST_PROMPT_INSTRUCTION) < prompt.indexOf(FINAL_ANSWER_PROMPT_INSTRUCTION));
  assert.ok(prompt.endsWith(FINAL_ANSWER_PROMPT_INSTRUCTION));
});

test("keeps Codex Tasklist logging format out of non-Codex and opted-out prompts", () => {
  assert.doesNotMatch(buildThinkingPrompt("claude", "medium", "implement the task"), /Tasklist:/);
  assert.doesNotMatch(buildThinkingPrompt("opencode", "medium", "implement the task"), /Tasklist:/);
  assert.doesNotMatch(
    buildThinkingPrompt("codex", "medium", "implement the task", { includeTaskListInstruction: false }),
    /Tasklist:/,
  );
});

test("adds human interaction instruction to requested Vibe prompts for all CLI groups", () => {
  for (const cli of ["codex", "claude", "opencode"] as const) {
    const prompt = buildThinkingPrompt(cli, "medium", "implement the task", {
      includeHumanInteractionInstruction: true,
    });

    assert.ok(prompt.includes(HUMAN_INTERACTION_PROMPT_INSTRUCTION));
    assert.ok(prompt.indexOf(HUMAN_INTERACTION_PROMPT_INSTRUCTION) < prompt.indexOf(FINAL_ANSWER_PROMPT_INSTRUCTION));
  }
  assert.doesNotMatch(buildThinkingPrompt("codex", "medium", "implement the task"), /Human interaction requirement/);
  assert.doesNotMatch(
    buildThinkingPrompt("opencode", "medium", "implement the task", {
      includeHumanInteractionInstruction: true,
      includeFinalAnswerInstruction: false,
    }),
    /Human interaction requirement/,
  );
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
  assert.doesNotMatch(prompt, /Tasklist:/);
  assert.doesNotMatch(retryPrompt, /\[final_answer\]/);
});
