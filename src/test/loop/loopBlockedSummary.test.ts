import test = require("node:test");
import assert = require("node:assert/strict");
import * as os from "os";
import * as path from "path";
import {
  buildLoopBlockedPauseText,
  LOOP_BLOCKED_SUMMARY_EXAMPLE,
  normalizeLoopBlockedSummary,
} from "../../loopBlockedSummary";
import { buildLoopGroupChatFinalStatusSection } from "../../loopFinalSummary";
import { LOOP_MAIN_AI_FAILURE_LIMIT } from "../../loopMainFailure";
import type { LoopTaskRecord } from "../../loopTaskStore";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildLoopTaskNeedsReviewText } = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");

const impossibleSummary = [
  "### 当前结论",
  "按当前要求无法完成。",
  "### 阻塞原因与未完成事项",
  "要求从未启用且没有备份的审计记录恢复历史事件，现有数据不包含这些事件，无法验证或还原。",
  "### 可行替代方案",
  "无法交付真实的历史事件；可调整范围，为未来事件启用审计记录，但不能补造历史数据。",
].join("\n");

function pausedTask(summary?: string, schedulingMode: LoopTaskRecord["schedulingMode"] = "classic"): LoopTaskRecord {
  return {
    id: "blocked-task", cli: "codex", workspaceKey: "workspace", rootPrompt: "完成任务",
    status: "needs-review", schedulingMode, createdAt: 1, updatedAt: 2, maxRounds: 6, currentRound: 1,
    taskStoreFile: path.join(os.tmpdir(), "blocked-task.json"), communicationDir: os.tmpdir(),
    mainCommunicationFile: path.join(os.tmpdir(), "main-task.md"), subTasks: [], rounds: [],
    finalSummary: summary, completionRoundSummaries: [], completionRequirementCoverage: [],
  };
}

test("both modes show the actual blocker and ordered recovery prerequisites", () => {
  for (const schedulingMode of [undefined, "classic", "event_driven"] as const) {
    const text = buildLoopBlockedPauseText({ schedulingMode, finalSummary: LOOP_BLOCKED_SUMMARY_EXAMPLE });
    assert.ok(text.startsWith(`${schedulingMode === "event_driven" ? "Loop+" : "Loop"} 已暂停`));
    assert.ok(text.includes(LOOP_BLOCKED_SUMMARY_EXAMPLE));
    assert.match(text, /1\. 接口负责人提供/);
    assert.match(text, /2\. 主模型核对/);
    assert.match(text, /仅点击继续不会补齐接口约定/);
  }
});

test("evidence-backed impossibility never receives a misleading retry or continue footer", () => {
  for (const schedulingMode of ["classic", "event_driven"] as const) {
    const text = buildLoopBlockedPauseText({ schedulingMode, finalSummary: impossibleSummary });
    assert.ok(text.endsWith(impossibleSummary));
    assert.doesNotMatch(text, /继续执行|补充上述所需证据|### 如何继续/);
  }
});

test("missing summaries explain the uncertainty without inventing a cause or asking users to diagnose it", () => {
  for (const summary of [undefined, null, "", " \n "]) {
    const text = normalizeLoopBlockedSummary(summary);
    assert.match(text, /无法判断是暂时受阻还是按当前要求无法完成/);
    assert.match(text, /未提供具体阻塞原因/);
    assert.match(text, /向主模型提问/);
    assert.match(text, /不建议反复点击/);
  }
  assert.equal(normalizeLoopBlockedSummary("  接口返回 403，联调权限不足。\n"), "接口返回 403，联调权限不足。");
});

test("classic review bubbles include the supplied reason rather than only a task id and record path", () => {
  const task = pausedTask(LOOP_BLOCKED_SUMMARY_EXAMPLE);
  const text = buildLoopTaskNeedsReviewText(task, () => false);
  assert.ok(text.includes(LOOP_BLOCKED_SUMMARY_EXAMPLE));
  assert.ok(text.includes(task.taskStoreFile));
  assert.match(text, /Loop 任务：blocked-task/);
  assert.doesNotMatch(text, /AI 调用已连续失败/);

  const failed = buildLoopTaskNeedsReviewText({ ...task, mainAiFailureCount: 3 }, () => true);
  assert.ok(failed.includes(`主任务 AI 调用已连续失败 3/${LOOP_MAIN_AI_FAILURE_LIMIT} 次`));
  assert.match(buildLoopTaskNeedsReviewText(pausedTask(" "), () => false), /未提供具体阻塞原因/);
  assert.doesNotMatch(buildLoopTaskNeedsReviewText(pausedTask(impossibleSummary), () => false), /继续执行/);
});

test("group interruption summaries preserve impossibility and avoid promising continuation", () => {
  const section = buildLoopGroupChatFinalStatusSection(pausedTask(impossibleSummary));
  assert.equal(section?.terminalStatus, "interrupted");
  assert.ok(section?.body.includes(impossibleSummary));
  assert.doesNotMatch(section?.body ?? "", /需要人工复核或继续|继续执行/);
  const missing = buildLoopGroupChatFinalStatusSection(pausedTask());
  assert.match(missing?.body ?? "", /未提供具体阻塞原因/);
});

test("legacy main failure pauses rebuild the actual error for group and chat instead of a generic summary", () => {
  const task = { ...pausedTask("过期业务摘要"), mainAiFailureCount: 5, mainAiFailureLimitReached: true,
    mainAiLastFailureMessage: "Codex 会话交接失败：等待会话关闭确认超时。" };
  for (const text of [buildLoopBlockedPauseText(task), buildLoopTaskNeedsReviewText(task, () => true),
    buildLoopGroupChatFinalStatusSection(task)?.body ?? ""]) {
    assert.match(text, /5\/5/);
    assert.match(text, /等待会话关闭确认超时/);
    assert.match(text, /不等于模型服务故障/);
    assert.doesNotMatch(text, /过期业务摘要|未提供具体阻塞原因/);
  }
  const group = buildLoopGroupChatFinalStatusSection({ ...task, schedulingMode: "event_driven", currentRound: 0 });
  assert.match(group?.body ?? "", /Loop\+ 事件驱动/);
  assert.doesNotMatch(group?.body ?? "", /当前主任务轮次：0/);
});
