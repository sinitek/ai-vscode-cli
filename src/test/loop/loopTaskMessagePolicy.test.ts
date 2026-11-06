import test = require("node:test");
import assert = require("node:assert/strict");
import {
  collectRecentLoopTaskIdsFromMessages,
  detectLoopVerificationSignals,
  formatLoopVerificationState,
  getLoopCompletionMessagesState,
  hasCompleteLoopCompletionMessages,
  isCompleteLoopFinalSummaryContent,
  isLoopAnswerConclusionMessageForTask,
  isLoopFinalSummaryMessageForTask,
  isLoopResumePrompt,
  isLoopTaskPromptResumeCandidate,
  isLoopTaskResumable,
  isLoopTaskSessionCompatible,
  normalizeLoopResumePrompt,
} from "../../loopTaskMessagePolicy";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { ChatMessage } from "../../webview/types";

test("resume prompts preserve normalization, Chinese and English patterns, and short-input boundary", () => {
  assert.equal(normalizeLoopResumePrompt("  CONTINUE   main task？！  "), "CONTINUE main task");
  assert.equal(normalizeLoopResumePrompt("   "), "");
  for (const prompt of ["继续执行。", "接着往下", "续上", "resume please", "go on", "carryon", "keep going", "proceed"]) {
    assert.equal(isLoopResumePrompt(prompt), true, prompt);
  }
  for (const prompt of ["", "   ", "继续实现新的需求", "continue task later", "continue " + "task ".repeat(12)]) {
    assert.equal(isLoopResumePrompt(prompt), false, prompt);
  }
});

test("recent task ids ignore blanks, deduplicate and remain newest-first", () => {
  const message = (loopTaskId?: string): ChatMessage => ({ id: "id", role: "assistant", content: "", createdAt: 1, loopTaskId });
  assert.deepEqual(collectRecentLoopTaskIdsFromMessages([]), []);
  assert.deepEqual(collectRecentLoopTaskIdsFromMessages([message("old"), message(" new "), message("old"), message(), message(" ")]), ["old", "new"]);
  assert.deepEqual(collectRecentLoopTaskIdsFromMessages([message("old"), message("new")], 1), ["new"]);
});

test("session matching is exact and only explicitly allows missing task sessions", () => {
  const task = (sessionId?: string): LoopTaskRecord => ({ sessionId } as LoopTaskRecord);
  assert.equal(isLoopTaskSessionCompatible(task(), null), true);
  assert.equal(isLoopTaskSessionCompatible(task("session"), null, { allowMissingTaskSessionId: true }), false);
  assert.equal(isLoopTaskSessionCompatible(task("session"), "session"), true);
  assert.equal(isLoopTaskSessionCompatible(task("session"), "other", { allowMissingTaskSessionId: true }), false);
  assert.equal(isLoopTaskSessionCompatible(task("session "), "session"), false);
  assert.equal(isLoopTaskSessionCompatible(task(), "session"), false);
  assert.equal(isLoopTaskSessionCompatible(task(), "session", { allowMissingTaskSessionId: true }), true);
});

test("classic incomplete conclusions and Loop+ terminal recovery remain distinct", () => {
  for (const status of ["running", "needs-review", "error", "stopped"] as const) {
    assert.equal(isLoopTaskResumable({ status }), true);
    assert.equal(isLoopTaskResumable({ status, mainAiFailureLimitReached: true }), false);
    assert.equal(isLoopTaskPromptResumeCandidate({ status, schedulingMode: "event_driven" }, { hasCompleteCompletionMessages: false }), true);
    assert.equal(isLoopTaskPromptResumeCandidate({ status, mainAiFailureLimitReached: true }, { hasCompleteCompletionMessages: false }), false);
  }
  assert.equal(isLoopTaskResumable({ status: "completed" }), false);
  for (const hasCompleteCompletionMessages of [false, true]) {
    assert.equal(isLoopTaskPromptResumeCandidate({ status: "completed", schedulingMode: "event_driven" }, { hasCompleteCompletionMessages }), false);
    assert.equal(isLoopTaskPromptResumeCandidate({ status: "completed", schedulingMode: "classic" }, { hasCompleteCompletionMessages }), !hasCompleteCompletionMessages);
    assert.equal(isLoopTaskPromptResumeCandidate({ status: "completed" }, { hasCompleteCompletionMessages }), !hasCompleteCompletionMessages);
  }
});

test("verification is tri-state, negative-first and truncates evidence at the existing boundary", () => {
  assert.deepEqual(detectLoopVerificationSignals(""), { unitTest: "unknown", build: "unknown", unitTestEvidence: undefined, buildEvidence: undefined });
  const mixed = detectLoopVerificationSignals("单元测试通过\nnpm run build\n未执行单元测试\n构建失败");
  assert.deepEqual(mixed, { unitTest: "no", build: "no", unitTestEvidence: "未执行单元测试", buildEvidence: "构建失败" });
  assert.deepEqual(detectLoopVerificationSignals("单测通过\n构建成功"), {
    unitTest: "yes", build: "yes", unitTestEvidence: "单测通过", buildEvidence: "构建成功",
  });
  const evidence = "单测通过" + "证".repeat(180);
  assert.equal(detectLoopVerificationSignals(evidence).unitTestEvidence, evidence.slice(0, 180) + "...");
  assert.equal(detectLoopVerificationSignals("无执行证据").build, "unknown");
  assert.deepEqual(["yes", "no", "unknown"].map((state) => formatLoopVerificationState(state as "yes" | "no" | "unknown")), ["已完成", "未完成", "未明确"]);
});

test("completion messages require role, task identity, marker and nonempty body plus both summary headings", () => {
  const conclusion: ChatMessage = { id: "answer", role: "assistant", taskRole: "main", loopTaskId: "task", loopAnswerConclusion: true, content: "结论", createdAt: 1 };
  const summary: ChatMessage = { ...conclusion, id: "summary", loopAnswerConclusion: false, loopFinalSummary: true, content: "## 问题回答结论\n结论\n## 整体任务总结\n总结" };
  assert.equal(isLoopAnswerConclusionMessageForTask(conclusion, "task"), true);
  assert.equal(isLoopFinalSummaryMessageForTask(summary, "task"), true);
  for (const patch of [{ role: "trace" as const }, { taskRole: "subtask" as const }, { loopTaskId: "other" }, { content: " " }]) {
    assert.equal(isLoopAnswerConclusionMessageForTask({ ...conclusion, ...patch }, "task"), false);
    assert.equal(isLoopFinalSummaryMessageForTask({ ...summary, ...patch }, "task"), false);
  }
  assert.equal(isLoopAnswerConclusionMessageForTask({ ...conclusion, loopAnswerConclusion: false }, "task"), false);
  assert.equal(isLoopFinalSummaryMessageForTask({ ...summary, loopFinalSummary: false }, "task"), false);
  assert.deepEqual(getLoopCompletionMessagesState([], "task"), { hasAnswerConclusion: false, hasFinalSummary: false });
  assert.equal(hasCompleteLoopCompletionMessages([conclusion, { ...summary, content: "## 整体任务总结" }], "task"), false);
  assert.equal(hasCompleteLoopCompletionMessages([conclusion, summary], "task"), true);
  assert.equal(hasCompleteLoopCompletionMessages([conclusion, summary], "other"), false);
  assert.equal(isCompleteLoopFinalSummaryContent("## 问题回答结论"), false);
});
