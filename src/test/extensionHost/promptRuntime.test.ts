import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildHiddenRetryPrompt,
  buildThinkingPrompt,
  HUMAN_INTERACTION_PROMPT_INSTRUCTION,
  CODEX_TASK_LIST_PROMPT_INSTRUCTION,
  GROK_TASK_LIST_PROMPT_INSTRUCTION,
  resolveRecordedExecutionModel,
} = require("../../promptRuntime") as typeof import("../../promptRuntime");
const {
  FINAL_ANSWER_PROMPT_INSTRUCTION,
  FINAL_ANSWER_TEXT_MARKER,
  SVG_SUMMARY_PROMPT_INSTRUCTION,
  buildStructuredSvgSummaryPromptInstruction,
} = require("../../finalAnswerProtocol") as typeof import("../../finalAnswerProtocol");

test("resolves the selected model for the active Loop role", () => {
  assert.equal(resolveRecordedExecutionModel({
    taskRole: "main",
    model: "default-model",
    loopMainModel: "selected-main-model",
    loopSubtaskModel: "selected-subtask-model",
  }), "selected-main-model");
  assert.equal(resolveRecordedExecutionModel({
    taskRole: "subtask",
    model: "default-model",
    loopMainModel: "selected-main-model",
    loopSubtaskModel: "selected-subtask-model",
  }), "selected-subtask-model");
});

test("preserves explicit CLI-default snapshots and falls back when role models are absent", () => {
  assert.equal(resolveRecordedExecutionModel({
    taskRole: "main",
    model: "selected-model",
    loopMainModel: "  ",
  }, "runtime-model"), "selected-model");
  assert.equal(resolveRecordedExecutionModel({ model: "selected-model" }, "runtime-model"), "selected-model");
  assert.equal(resolveRecordedExecutionModel({ model: "selected-model", executionModel: null }, "runtime-model"), null);
});

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

test("guides final replies to use real Markdown images in ordinary and hidden retry prompts", () => {
  for (const cli of ["codex", "claude", "opencode", "grok"] as const) {
    for (const prompt of [buildThinkingPrompt(cli, "medium", "展示图片"), buildHiddenRetryPrompt(cli, "medium")]) {
      assert.ok(prompt.includes("![图片说明](图片地址)"));
      assert.match(prompt, /Never invent an image URL/);
      assert.match(prompt, /preview in the editor area/);
      assert.match(prompt, /actual image file path/);
      assert.match(prompt, /relative paths resolve from the workspace root/);
      assert.match(prompt, /download link below each image or SVG/);
      assert.match(prompt, /fenced code block with the language svg/);
      assert.match(prompt, /self-contained without scripts, event handlers, or external assets/);
      assert.ok(prompt.includes(SVG_SUMMARY_PROMPT_INSTRUCTION));
      assert.match(prompt, /建议按需使用 SVG 做结构化表达补充/u);
      assert.match(prompt, /先给出清晰的文字结论/u);
      assert.match(prompt, /简单任务、没有图示价值或用户要求纯文字时可以省略/u);
    }
  }
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
  assert.ok(!prompt.includes(SVG_SUMMARY_PROMPT_INSTRUCTION));
  assert.ok(!retryPrompt.includes(SVG_SUMMARY_PROMPT_INSTRUCTION));
});

test("structured summaries keep optional SVG inside the existing JSON summary field", () => {
  for (const field of ["finalSummary", "finalAnswer.summary"] as const) {
    const instruction = buildStructuredSvgSummaryPromptInstruction(field);

    assert.ok(instruction.includes(SVG_SUMMARY_PROMPT_INSTRUCTION));
    assert.ok(instruction.includes(`一起放入 ${field} 字符串`));
    assert.match(instruction, /按 JSON 规则转义换行、双引号和反斜杠/u);
    assert.match(instruction, /不在 JSON 对象外追加图示，不新增图示字段/u);
    assert.doesNotMatch(instruction, /\[final_answer\]/u);
  }
});

test("guides Grok multi-step tasks through native todo_write and honors opt-outs", () => {
  const prompt = buildThinkingPrompt("grok", "medium", "调查并修复");
  assert.ok(prompt.includes(GROK_TASK_LIST_PROMPT_INSTRUCTION));
  assert.ok(prompt.indexOf(GROK_TASK_LIST_PROMPT_INSTRUCTION) < prompt.indexOf(FINAL_ANSWER_PROMPT_INSTRUCTION));
  assert.ok(buildHiddenRetryPrompt("grok", "high").includes(GROK_TASK_LIST_PROMPT_INSTRUCTION));
  for (const options of [{ includeTaskListInstruction: false }, { includeFinalAnswerInstruction: false }]) {
    assert.equal(buildThinkingPrompt("grok", "medium", "协议任务", options).includes(GROK_TASK_LIST_PROMPT_INSTRUCTION), false);
  }
  assert.equal(buildHiddenRetryPrompt("grok", "high", { includeFinalAnswerInstruction: false }).includes(GROK_TASK_LIST_PROMPT_INSTRUCTION), false);
  assert.doesNotMatch(prompt, /Tasklist:/);
});
