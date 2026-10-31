import test = require("node:test");
import assert = require("node:assert/strict");

import {
    } from "../../cli/types";
import { buildLoopAnswerConclusionMarkdown, buildLoopMainSubChatTranscriptFile, buildLoopMainSubSubtaskTurnBody, buildLoopFinalSummaryMarkdown, buildLoopGroupChatFinalStatusSection, formatLoopGroupChatMemberName, isLoopTaskRunOrphaned, latestLoopGroupChatSubtaskStartedAt, parseLoopGroupChatTranscript, resolveLoopTaskRunControlState } from "../../loopGroupChat";
import { getStrings } from "../../webview/loopGroupChatPanelRenderer";

test("uses requirement and question labels for Loop group chat actions", () => {
  assert.equal(getStrings().supplementTask, "补充需求");
  assert.equal(getStrings().askMainModel, "我要提问");
});

test("parses supplemental requirements as user chat messages", () => {
  const transcript = [
    "# Loop 主从群聊记录",
    "",
    "## 任务事件",
    "任务已启动。",
    "",
    "## 补充需求",
    "- 时间：2026-07-10T08:00:00.000Z",
    "- 主任务轮次：2",
    "请优先补充失败场景测试。",
    "",
    "## 补充需求",
    "- 时间：2026-07-10T08:01:00.000Z",
    "- 主任务轮次：2",
    "同时更新中英文文案。",
  ].join("\n");

  const parsed = parseLoopGroupChatTranscript(transcript);
  const userMessages = parsed.segments.filter((segment) => segment.kind === "user-message");

  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "task-event", "user-message", "user-message"],
  );
  assert.deepEqual(userMessages.map((segment) => segment.body), [
    "请优先补充失败场景测试。",
    "同时更新中英文文案。",
  ]);
  assert.deepEqual(userMessages.map((segment) => segment.actorId), ["user", "user"]);
});

test("resolves loop task run controls from persisted running status", () => {
  const controlState = resolveLoopTaskRunControlState(
    { id: "task-1", status: "running" },
    new Set(),
  );

  assert.equal(controlState.isRunning, true);
  assert.equal(controlState.canSupplement, true);
  assert.equal(controlState.canStop, true);
  assert.equal(controlState.canContinue, false);
});

test("allows a review Loop task to continue without showing stop", () => {
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-review", status: "needs-review" }, new Set()),
    {
      isRunning: false,
      canSupplement: true,
      canContinue: true,
      canStop: false,
    },
  );
});

test("identifies a persisted running Loop task without runtime ownership as orphaned", () => {
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "running" }, new Set()), true);
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "running" }, new Set(["task-1"])), false);
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "stopped" }, new Set()), false);
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "running", activeSubtaskIds: ["subtask-1"] }, new Set()), false);
});

test("keeps loop continue available only for incomplete non-running tasks", () => {
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-1", status: "needs-review" }, new Set()),
    { isRunning: false, canSupplement: true, canContinue: true, canStop: false },
  );
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-1", status: "stopped" }, new Set()),
    { isRunning: false, canSupplement: true, canContinue: true, canStop: false },
  );
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-1", status: "needs-review" }, new Set(["task-1"])),
    { isRunning: false, canSupplement: true, canContinue: true, canStop: false },
  );
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-1", status: "completed" }, new Set(["task-1"])),
    { isRunning: true, canSupplement: true, canContinue: false, canStop: true },
  );
});

test("treats persisted interruption as terminal even while stale runtime ownership is being released", () => {
  assert.deepEqual(
    resolveLoopTaskRunControlState(
      { id: "task-1", status: "running", mainAiFailureLimitReached: true },
      new Set(["task-1"]),
    ),
    { isRunning: true, canSupplement: true, canContinue: false, canStop: true },
  );
  assert.deepEqual(
    resolveLoopTaskRunControlState(
      { id: "task-1", status: "needs-review", mainAiFailureLimitReached: true },
      new Set(["task-1"]),
    ),
    { isRunning: false, canSupplement: false, canContinue: false, canStop: false },
  );
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-1", status: "error" }, new Set(["task-1"])),
    { isRunning: false, canSupplement: true, canContinue: true, canStop: false },
  );
  assert.deepEqual(
    resolveLoopTaskRunControlState({ id: "task-1", status: "stopped" }, new Set(["task-1"])),
    { isRunning: false, canSupplement: true, canContinue: true, canStop: false },
  );
});

test("blocks loop continue when main AI failure limit has already been reached", () => {
  assert.deepEqual(
    resolveLoopTaskRunControlState(
      { id: "task-1", status: "needs-review", mainAiFailureLimitReached: true },
      new Set(),
    ),
    { isRunning: false, canSupplement: false, canContinue: false, canStop: false },
  );
});

test("builds terminal loop group chat status sections", () => {
  const completed = buildLoopGroupChatFinalStatusSection({
    id: "task-1",
    status: "completed",
    currentRound: 3,
    updatedAt: 0,
    answerConclusion: "答案是优先修复展示链路。",
    finalSummary: "全部验收通过。",
    estimatedRemainingRounds: 0,
  });
  assert.equal(completed?.heading, "任务成功完成");
  assert.equal(completed?.terminalStatus, "completed");
  assert.match(completed?.body ?? "", /任务已成功完成/u);
  assert.match(completed?.body ?? "", /问题回答结论/u);
  assert.match(completed?.body ?? "", /答案是优先修复展示链路/u);
  assert.match(completed?.body ?? "", /全部验收通过/u);
  assert.match(completed?.body ?? "", /预计剩余轮次：0 轮/u);

  const interrupted = buildLoopGroupChatFinalStatusSection({
    id: "task-2",
    status: "stopped",
    currentRound: 2,
    updatedAt: 0,
    finalSummary: "用户已中止任务。",
  });
  assert.equal(interrupted?.heading, "任务中断");
  assert.equal(interrupted?.terminalStatus, "interrupted");
  assert.match(interrupted?.body ?? "", /任务已中断/u);
  assert.match(interrupted?.body ?? "", /用户已中止任务/u);

  assert.equal(buildLoopGroupChatFinalStatusSection({ id: "task-3", status: "running" }), null);
});

test("builds loop final summary with question conclusion and overall summary", () => {
  const markdown = buildLoopFinalSummaryMarkdown({
    id: "task-1",
    sessionId: "session-1",
    finalSummary: "任务记录中的旧总结。",
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  }, {
    answerConclusion: "问题结论：应该同时展示直接答案和 Loop 最终总结。",
    finalSummary: "整体总结：已完成展示链路调整。",
    roundSummaries: [
      { round: 1, subtaskId: "subtask-a", title: "定位问题", summary: "确认缺少直接结论展示。" },
    ],
    requirementCoverage: [
      { name: "同时展示两段内容", passed: true, detail: "最终气泡包含两个独立小节。" },
    ],
    acceptance: {
      passed: true,
      summary: "验收通过。",
      checks: [
        { name: "直接结论", passed: true, detail: "已展示。" },
      ],
    },
  });

  assert.match(markdown, /^# Loop 任务最终总结/mu);
  assert.match(markdown, /## 问题回答结论\n问题结论：应该同时展示直接答案和 Loop 最终总结/u);
  assert.match(markdown, /## 子任务完成摘要/u);
  assert.match(markdown, /第 1 轮 定位问题（subtask-a）：确认缺少直接结论展示/u);
  assert.match(markdown, /## 整体任务总结\n整体总结：已完成展示链路调整/u);
});

test("builds standalone loop answer conclusion for AI conversation stream", () => {
  const markdown = buildLoopAnswerConclusionMarkdown({
    finalSummary: "任务已完成整体总结。",
    answerConclusion: "任务记录中的直接答案。",
  }, {
    answerConclusion: "面板里应单独展示这个直接答案。",
    finalSummary: "整体总结用于最终总结气泡。",
  });

  assert.equal(markdown, [
    "## 问题回答结论",
    "",
    "面板里应单独展示这个直接答案。",
  ].join("\n"));
});

test("falls back to final summary when loop answer conclusion is missing", () => {
  const markdown = buildLoopFinalSummaryMarkdown({
    id: "task-2",
    sessionId: null,
    finalSummary: "最终总结兜底为直接结论。",
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  });

  assert.match(markdown, /## 问题回答结论\n最终总结兜底为直接结论/u);
  assert.match(markdown, /## 整体任务总结\n最终总结兜底为直接结论/u);
});

test("falls back to final summary for standalone loop answer conclusion", () => {
  const markdown = buildLoopAnswerConclusionMarkdown({
    finalSummary: "最终总结兜底为独立直接结论。",
  });

  assert.equal(markdown, [
    "## 问题回答结论",
    "",
    "最终总结兜底为独立直接结论。",
  ].join("\n"));
});

test("builds stable main-sub group chat transcript path", () => {
  assert.equal(
    buildLoopMainSubChatTranscriptFile("/tmp/loop-communications/task-1/"),
    "/tmp/loop-communications/task-1/group-chat.md",
  );
});

test("formats loop group chat member names with bracketed display names", () => {
  assert.equal(formatLoopGroupChatMemberName("主任务"), "【主任务】");
  assert.equal(formatLoopGroupChatMemberName("【子任务 1】"), "【子任务 1】");
  assert.equal(formatLoopGroupChatMemberName("  子任务 2  "), "【子任务 2】");
});

test("parses terminal loop group chat status sections as final bubbles", () => {
  const transcript = [
    "# Loop 群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 任务成功完成",
    "任务已成功完成。",
    "",
    "## 任务中断",
    "任务已中断，需要人工复核或继续。",
  ].join("\n");

  const parsed = parseLoopGroupChatTranscript(transcript);

  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "closed", "error"],
  );
  const completed = parsed.segments.find((segment) => segment.heading === "任务成功完成");
  assert.equal(completed?.actorId, "main");
  assert.equal(completed?.actorTitle, "主任务");
  const interrupted = parsed.segments.find((segment) => segment.heading === "任务中断");
  assert.equal(interrupted?.actorId, "main");
  assert.equal(interrupted?.actorTitle, "主任务");
});

test("parses bracketed main-sub group chat member names with metadata ids", () => {
  const transcript = [
    "# Loop 主从群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 主任务发言：第 1 轮【主任务】",
    "- 成员 ID：main",
    "已派发首批子任务。",
    "",
    "## 子任务加入：【子任务 1：实现执行群聊】",
    "- 成员 ID：execution-chat",
    "子任务开始执行。",
    "",
    "## 子任务发言：【子任务 1：实现执行群聊】",
    "- 成员 ID：execution-chat",
    "已完成 UI 修改。",
  ].join("\n");

  const parsed = parseLoopGroupChatTranscript(transcript);

  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "main-turn", "subtask-joined", "subtask-turn"],
  );
  const main = parsed.segments.find((segment) => segment.kind === "main-turn");
  assert.equal(main?.actorTitle, "主任务");
  assert.equal(main?.actorId, "main");
  assert.equal(main?.dialogueTurn, 1);
  const joined = parsed.segments.find((segment) => segment.kind === "subtask-joined");
  assert.equal(joined?.actorTitle, "子任务 1：实现执行群聊");
  assert.equal(joined?.actorId, "execution-chat");
  const subtask = parsed.segments.find((segment) => segment.kind === "subtask-turn");
  assert.equal(subtask?.actorTitle, "子任务 1：实现执行群聊");
  assert.equal(subtask?.actorId, "execution-chat");
});

test("parses main-sub group chat transcript into role-oriented segments", () => {
  const transcript = [
    "# Loop 主从群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 群聊规则",
    "- 主任务拆分和验收。",
    "",
    "## 主任务发言：第 1 轮（main）",
    "已派发首批子任务。",
    "",
    "## 子任务加入：子任务 1（implement-ui）",
    "子任务开始执行。",
    "",
    "## 子任务发言：子任务 1（implement-ui）",
    "已完成 UI 修改。",
    "",
    "## 验收结果",
    "- 安全审查：未通过",
    "- 其它：通过",
    "  审查内容：确认审计日志不写入密钥",
    "",
    "## 任务事件",
    "子任务批次完成。",
    "",
    "## 群聊收束",
    "主任务验收通过。",
  ].join("\n");

  const parsed = parseLoopGroupChatTranscript(transcript);

  assert.equal(parsed.title, "Loop 主从群聊记录");
  assert.equal(parsed.closed, true);
  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "rules", "main-turn", "subtask-joined", "subtask-turn", "main-turn", "task-event", "closed"],
  );
  const main = parsed.segments.find((segment) => segment.kind === "main-turn");
  assert.equal(main?.dialogueTurn, 1);
  assert.equal(main?.actorId, "main");
  const acceptance = parsed.segments.find((segment) => segment.heading === "验收结果");
  assert.equal(acceptance?.kind, "main-turn");
  assert.equal(acceptance?.actorTitle, "主任务");
  assert.match(acceptance?.body ?? "", /安全审查：未通过/);
  const joined = parsed.segments.find((segment) => segment.kind === "subtask-joined");
  assert.equal(joined?.actorTitle, "子任务 1");
  assert.equal(joined?.actorId, "implement-ui");
});

test("formats completed main-sub subtask chat turn as the final reply", () => {
  const body = buildLoopMainSubSubtaskTurnBody({
    runStatus: "end",
    assistantContent: "\n已完成修复。\n\n- build 通过\n",
    communicationFile: "/tmp/subtask.md",
  });

  assert.equal(body, "已完成修复。\n\n- build 通过");
  assert.equal(body.includes("运行结果"), false);
  assert.equal(body.includes("沟通文件"), false);
});

test("formats incomplete main-sub subtask chat turn with troubleshooting context", () => {
  const body = buildLoopMainSubSubtaskTurnBody({
    runStatus: "error",
    assistantContent: null,
    communicationFile: "/tmp/subtask.md",
  });

  assert.match(body, /运行结果：error/u);
  assert.match(body, /沟通文件：\/tmp\/subtask\.md/u);
  assert.match(body, /未捕获到子任务最终回复/u);
});

test("uses each subtask join time and keeps the latest restart", () => {
  const startedAt = latestLoopGroupChatSubtaskStartedAt([
    "# Loop 主从群聊记录",
    "",
    "## 子任务加入：【子任务 1：Alpha】",
    "- 成员 ID：alpha",
    "- 时间：2026-09-29T05:59:34.578Z",
    "- 状态：running",
    "",
    "## 子任务发言：【子任务 1：Alpha】",
    "- 成员 ID：alpha",
    "- 时间：2026-09-29T08:00:00.000Z",
    "",
    "## 子任务加入：title（beta）",
    "- 时间：2026-09-29T06:10:00.000Z",
    "",
    "## 子任务加入：【子任务 1：Alpha】",
    "- 成员 ID：alpha",
    "- 时间：2026-09-29T07:27:25.803Z",
    "- 状态：running",
    "",
    "## 子任务加入：【无时间】",
    "- 成员 ID：gamma",
    "- 状态：running",
  ].join("\n"));
  assert.equal(startedAt.get("alpha"), Date.parse("2026-09-29T07:27:25.803Z"));
  assert.equal(startedAt.get("beta"), Date.parse("2026-09-29T06:10:00.000Z"));
  assert.equal(startedAt.has("gamma"), false);
});
