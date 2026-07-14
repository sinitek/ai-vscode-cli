import test = require("node:test");
import assert = require("node:assert/strict");

import {
  DEFAULT_LOOP_EXECUTION_MODE,
  normalizeLoopExecutionMode,
} from "../cli/types";
import {
  buildLoopAnswerConclusionMarkdown,
  buildLoopMainSubChatTranscriptFile,
  buildLoopMainSubSubtaskTurnBody,
  buildLoopDebateNeedsReviewSummary,
  buildLoopFinalSummaryMarkdown,
  buildLoopDebateModeratorArtifactFile,
  buildLoopDebatePaths,
  buildLoopDebateParticipantTurnArtifactFile,
  buildLoopGroupChatFinalStatusSection,
  canProceedWithLoopDebateConsensus,
  formatLoopGroupChatMemberName,
  findLatestLoopDebateModeratorSessionId,
  findLatestLoopDebateParticipantSessionId,
  isLoopDebateAdversarialParticipantRole,
  isLoopTaskRunOrphaned,
  LOOP_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES,
  LOOP_DEBATE_BLUE_TEAM_ROLE,
  LOOP_DEBATE_MAX_DIALOGUE_TURNS,
  LOOP_DEBATE_MODERATOR_TITLE,
  LOOP_DEBATE_PARTICIPANT_ROLES,
  LOOP_DEBATE_RED_TEAM_ROLE,
  normalizeLoopDebateSessionId,
  normalizeLoopDebateModeratorAction,
  normalizeLoopDebateSpeakerIds,
  parseLoopDebateChatTranscript,
  resolveLoopTaskRunControlState,
  selectDefaultLoopDebateOpeningSpeakerIds,
  validateLoopDebateConsensus,
  type LoopDebateModeratorDecisionRecord,
  type LoopDebateParticipantRecord,
  type LoopDebateConsensusRecord,
} from "../loopDebate";
import type { LoopMainDecision } from "../loopTaskStore";
import { getStrings } from "../webview/loopDebatePanelRenderer";

test("normalizes loop execution mode with legacy-compatible default", () => {
  assert.equal(DEFAULT_LOOP_EXECUTION_MODE, "main_sub_multi_agent");
  assert.equal(normalizeLoopExecutionMode(undefined), "main_sub_multi_agent");
  assert.equal(normalizeLoopExecutionMode(null), "main_sub_multi_agent");
  assert.equal(normalizeLoopExecutionMode(""), "main_sub_multi_agent");
  assert.equal(normalizeLoopExecutionMode("main_sub"), "main_sub_multi_agent");
  assert.equal(normalizeLoopExecutionMode("main_sub_multi_agent"), "main_sub_multi_agent");
  assert.equal(normalizeLoopExecutionMode("debate_multi_agent"), "debate_multi_agent");
});

test("uses speaking action labels for Loop supplemental requirements", () => {
  assert.equal(getStrings("zh-CN").supplementTask, "我要说话");
  assert.equal(getStrings("en").supplementTask, "I want to speak");
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

  const parsed = parseLoopDebateChatTranscript(transcript);
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

test("identifies a persisted running Loop task without runtime ownership as orphaned", () => {
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "running" }, new Set()), true);
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "running" }, new Set(["task-1"])), false);
  assert.equal(isLoopTaskRunOrphaned({ id: "task-1", status: "stopped" }, new Set()), false);
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

test("builds stable debate communication paths for the first debate round", () => {
  const paths = buildLoopDebatePaths("/tmp/loop-communications/task-1/", 2);

  assert.equal(paths.communicationDir, "/tmp/loop-communications/task-1");
  assert.equal(paths.debatesDir, "/tmp/loop-communications/task-1/debates");
  assert.equal(paths.loopRoundDir, "/tmp/loop-communications/task-1/debates/round-2");
  assert.equal(paths.roundDir, "/tmp/loop-communications/task-1/debates/round-2");
  assert.equal(paths.participantsDir, "/tmp/loop-communications/task-1/debates/round-2/participants");
  assert.equal(paths.briefFile, "/tmp/loop-communications/task-1/debates/round-2/brief.md");
  assert.equal(paths.chatFile, "/tmp/loop-communications/task-1/debates/round-2/chat.md");
  assert.equal(paths.participantRosterFile, "/tmp/loop-communications/task-1/debates/round-2/moderator-participants.md");
  assert.equal(paths.crossReviewFile, "/tmp/loop-communications/task-1/debates/round-2/cross-review.md");
  assert.equal(paths.consensusFile, "/tmp/loop-communications/task-1/debates/round-2/consensus.md");
  assert.equal(paths.decisionFile, "/tmp/loop-communications/task-1/debates/round-2/decision.json");
});

test("builds stable main-sub group chat transcript path", () => {
  assert.equal(
    buildLoopMainSubChatTranscriptFile("/tmp/loop-communications/task-1/"),
    "/tmp/loop-communications/task-1/group-chat.md",
  );
});

test("keeps debate mode roles red-blue while preserving legacy role compatibility", () => {
  assert.deepEqual(
    Array.from(LOOP_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES),
    [LOOP_DEBATE_BLUE_TEAM_ROLE, LOOP_DEBATE_RED_TEAM_ROLE],
  );
  assert.equal(isLoopDebateAdversarialParticipantRole("blue_team"), true);
  assert.equal(isLoopDebateAdversarialParticipantRole("red_team"), true);
  assert.equal(isLoopDebateAdversarialParticipantRole("architecture"), false);
  assert.equal(LOOP_DEBATE_PARTICIPANT_ROLES.includes("architecture"), true);
  assert.equal(LOOP_DEBATE_MODERATOR_TITLE, "裁判主持人");
});

test("builds nested paths for additional debate rounds within the same loop round", () => {
  const paths = buildLoopDebatePaths("/tmp/loop-communications/task-1", 2, 3);

  assert.equal(paths.loopRoundDir, "/tmp/loop-communications/task-1/debates/round-2");
  assert.equal(paths.roundDir, "/tmp/loop-communications/task-1/debates/round-2/debate-3");
  assert.equal(paths.consensusFile, "/tmp/loop-communications/task-1/debates/round-2/debate-3/consensus.md");
});

test("builds stable participant and moderator artifact paths for bounded chat turns", () => {
  const paths = buildLoopDebatePaths("/tmp/loop-communications/task-1", 2);

  assert.ok(LOOP_DEBATE_MAX_DIALOGUE_TURNS > 2);
  assert.equal(
    buildLoopDebateParticipantTurnArtifactFile(paths, "risk/review", 1),
    "/tmp/loop-communications/task-1/debates/round-2/participants/risk_review-turn-1.md",
  );
  assert.equal(
    buildLoopDebateModeratorArtifactFile(paths, 3),
    "/tmp/loop-communications/task-1/debates/round-2/participants/moderator-turn-3.md",
  );
  assert.equal(normalizeLoopDebateModeratorAction("continue"), "continue");
  assert.equal(normalizeLoopDebateModeratorAction("finalize"), "finalize");
  assert.equal(normalizeLoopDebateModeratorAction("block"), "block");
  assert.equal(normalizeLoopDebateModeratorAction("wait"), null);
});

test("tracks latest debate actor session ids for closed temporary tabs", () => {
  const participants: LoopDebateParticipantRecord[] = [
    {
      id: "architecture",
      role: "architecture",
      title: "架构规划",
      status: "completed",
      artifactFile: "/tmp/architecture-turn-1.md",
      sessionId: " session-arch-1 ",
      updatedAt: 1,
    },
    {
      id: "risk",
      role: "risk",
      title: "风险审查",
      status: "completed",
      artifactFile: "/tmp/risk-turn-1.md",
      sessionId: "session-risk-1",
      updatedAt: 2,
    },
    {
      id: "architecture",
      role: "architecture",
      title: "架构规划",
      status: "completed",
      artifactFile: "/tmp/architecture-turn-2.md",
      sessionId: "session-arch-2",
      updatedAt: 3,
    },
  ];
  const moderatorDecisions: LoopDebateModeratorDecisionRecord[] = [
    {
      artifactFile: "/tmp/moderator-turn-1.md",
      dialogueTurn: 1,
      action: "continue",
      reason: "需要追问",
      nextSpeakerIds: ["risk"],
      nextFocus: [],
      sessionId: "moderator-session-1",
      updatedAt: 1,
    },
    {
      artifactFile: "/tmp/moderator-turn-2.md",
      dialogueTurn: 2,
      action: "finalize",
      reason: "可以收束",
      nextSpeakerIds: [],
      nextFocus: [],
      sessionId: "moderator-session-2",
      updatedAt: 2,
    },
  ];

  assert.equal(normalizeLoopDebateSessionId(" session-1 "), "session-1");
  assert.equal(normalizeLoopDebateSessionId(" "), null);
  assert.equal(findLatestLoopDebateParticipantSessionId(participants, "architecture"), "session-arch-2");
  assert.equal(findLatestLoopDebateParticipantSessionId(participants, "risk"), "session-risk-1");
  assert.equal(findLatestLoopDebateParticipantSessionId(participants, "testing"), null);
  assert.equal(findLatestLoopDebateModeratorSessionId(moderatorDecisions), "moderator-session-2");
});

test("normalizes moderator-selected speaker ids and chooses a blue opening speaker by default", () => {
  assert.deepEqual(
    normalizeLoopDebateSpeakerIds(
      ["red-attacker", "blue-planner", "red-attacker", "unknown"],
      ["blue-planner", "red-attacker"],
      2,
    ),
    ["red-attacker", "blue-planner"],
  );

  assert.deepEqual(
    selectDefaultLoopDebateOpeningSpeakerIds([
      { id: "red-attacker", role: "red_team" },
      { id: "blue-planner", role: "blue_team" },
      { id: "blue-reviewer", role: "blue_team" },
    ]),
    ["blue-planner"],
  );
});

test("formats loop group chat member names with bracketed display names", () => {
  assert.equal(formatLoopGroupChatMemberName("裁判主持人"), "【裁判主持人】");
  assert.equal(formatLoopGroupChatMemberName("【蓝队方案方】"), "【蓝队方案方】");
  assert.equal(formatLoopGroupChatMemberName("  红队攻击方  "), "【红队攻击方】");
});

test("parses debate chat transcript into role-oriented segments", () => {
  const transcript = [
    "# Loop 红蓝对抗群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 群聊规则",
    "- 每位角色读取已有发言。",
    "",
    "## 参与者加入：蓝队方案方（blue-planner）",
    "关注可执行方案。",
    "",
    "## 第 1 轮发言：蓝队方案方（blue-planner）",
    "## 群聊发言",
    "建议先拆模块。",
    "",
    "## 第 1 轮主持人控场（裁判主持人）",
    "## 主持人决策",
    "continue",
    "",
    "## 最终立场：红队攻击方（red-attacker）",
    "## 立场",
    "agree_with_reservations",
    "",
    "## 群聊收束",
    "主持人最终动作：finalize",
    "",
    "## 主持人停止说明",
    "### 停止原因",
    "存在阻塞性异议，停止自动执行。",
  ].join("\n");

  const parsed = parseLoopDebateChatTranscript(transcript);

  assert.equal(parsed.title, "Loop 红蓝对抗群聊记录");
  assert.equal(parsed.closed, true);
  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "rules", "participant-joined", "participant-turn", "moderator-turn", "final-stance", "closed", "error"],
  );
  const joined = parsed.segments.find((segment) => segment.kind === "participant-joined");
  assert.equal(joined?.actorId, "blue-planner");
  assert.equal(joined?.actorTitle, "蓝队方案方");
  const participant = parsed.segments.find((segment) => segment.kind === "participant-turn");
  const error = parsed.segments.find((segment) => segment.kind === "error");
  assert.equal(error?.actorId, "moderator");
  assert.equal(error?.actorTitle, "裁判主持人");
  assert.match(error?.body ?? "", /停止自动执行/u);
  assert.equal(participant?.dialogueTurn, 1);
  assert.equal(participant?.actorId, "blue-planner");
  assert.equal(participant?.actorTitle, "蓝队方案方");
  const moderator = parsed.segments.find((segment) => segment.kind === "moderator-turn");
  assert.equal(moderator?.actorId, "moderator");
  assert.equal(moderator?.actorTitle, "裁判主持人");
});

test("parses bracketed debate group chat member names with metadata ids", () => {
  const transcript = [
    "# Loop 红蓝对抗群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 任务事件",
    "裁判主持人已根据任务目标完成红蓝参与者设计。",
    "首批点名发言者：【蓝队方案方】",
    "首批点名发言者 ID：blue-planner",
    "",
    "## 参与者加入：【蓝队方案方】",
    "- 成员 ID：blue-planner",
    "阵营角色：blue_team",
    "",
    "## 发言：【蓝队方案方】",
    "- 成员 ID：blue-planner",
    "- 群聊发言批次：1/6",
    "",
    "## 群聊发言",
    "建议先拆模块。",
    "",
    "## 主持人控场：【裁判主持人】",
    "- 成员 ID：moderator",
    "- 群聊发言批次：1/6",
    "",
    "## 主持人决策",
    "finalize",
    "",
    "## 最终立场：【红队攻击方】",
    "- 成员 ID：red-attacker",
    "",
    "## 立场",
    "agree_with_reservations",
    "",
    "## 群聊收束",
    "【裁判主持人】最终动作：finalize",
  ].join("\n");

  const parsed = parseLoopDebateChatTranscript(transcript);

  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "task-event", "participant-joined", "participant-turn", "moderator-turn", "final-stance", "closed"],
  );
  const joined = parsed.segments.find((segment) => segment.kind === "participant-joined");
  assert.equal(joined?.actorTitle, "蓝队方案方");
  assert.equal(joined?.actorId, "blue-planner");
  const participant = parsed.segments.find((segment) => segment.kind === "participant-turn");
  assert.equal(participant?.actorTitle, "蓝队方案方");
  assert.equal(participant?.actorId, "blue-planner");
  assert.equal(participant?.dialogueTurn, 1);
  const moderator = parsed.segments.find((segment) => segment.kind === "moderator-turn");
  assert.equal(moderator?.actorTitle, "裁判主持人");
  assert.equal(moderator?.actorId, "moderator");
  assert.equal(moderator?.dialogueTurn, 1);
  const finalStance = parsed.segments.find((segment) => segment.kind === "final-stance");
  assert.equal(finalStance?.actorTitle, "红队攻击方");
  assert.equal(finalStance?.actorId, "red-attacker");
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

  const parsed = parseLoopDebateChatTranscript(transcript);

  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "closed", "error"],
  );
  const completed = parsed.segments.find((segment) => segment.heading === "任务成功完成");
  assert.equal(completed?.actorId, "main");
  assert.equal(completed?.actorTitle, "主任务");
  const interrupted = parsed.segments.find((segment) => segment.heading === "任务中断");
  assert.equal(interrupted?.actorId, "moderator");
  assert.equal(interrupted?.actorTitle, "裁判主持人");
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

  const parsed = parseLoopDebateChatTranscript(transcript);

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

test("parses debate chat transcript without UI round section headings", () => {
  const transcript = [
    "# Loop 群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 任务事件",
    "辩论发言批次开始。",
    "- 主任务复核轮次：1",
    "- 当前发言批次：1",
    "- 最大安全发言批次数：6",
    "",
    "## 发言：架构规划（architecture）",
    "- 群聊发言批次：1/6",
    "",
    "## 群聊发言",
    "建议先拆模块。",
    "",
    "## 主持人控场（主持人控场）",
    "- 群聊发言批次：1/6",
    "",
    "## 主持人决策",
    "finalize",
  ].join("\n");

  const parsed = parseLoopDebateChatTranscript(transcript);

  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "task-event", "participant-turn", "moderator-turn"],
  );
  const participant = parsed.segments.find((segment) => segment.kind === "participant-turn");
  assert.equal(participant?.actorId, "architecture");
  assert.equal(participant?.actorTitle, "架构规划");
  assert.equal(participant?.dialogueTurn, undefined);
  const moderator = parsed.segments.find((segment) => segment.kind === "moderator-turn");
  assert.equal(moderator?.actorId, "moderator");
  assert.equal(moderator?.dialogueTurn, undefined);
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
    "## 任务事件",
    "子任务批次完成。",
    "",
    "## 群聊收束",
    "主任务验收通过。",
  ].join("\n");

  const parsed = parseLoopDebateChatTranscript(transcript);

  assert.equal(parsed.title, "Loop 主从群聊记录");
  assert.equal(parsed.closed, true);
  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "rules", "main-turn", "subtask-joined", "subtask-turn", "task-event", "closed"],
  );
  const main = parsed.segments.find((segment) => segment.kind === "main-turn");
  assert.equal(main?.dialogueTurn, 1);
  assert.equal(main?.actorId, "main");
  const joined = parsed.segments.find((segment) => segment.kind === "subtask-joined");
  assert.equal(joined?.actorTitle, "子任务 1");
  assert.equal(joined?.actorId, "implement-ui");
});

test("parses debate task execution group chat transcript after consensus dispatch", () => {
  const transcript = [
    "# Loop 主从群聊记录",
    "",
    "- 任务 ID：debate-task-1",
    "",
    "## 群聊规则",
    "- 辩论共识通过后，子任务会动态加入。",
    "",
    "## 主任务发言：第 1 轮（main）",
    "辩论已形成共识，派发两个子任务。",
    "",
    "## 子任务加入：子任务 1：实现执行群聊（execution-chat）",
    "子任务开始执行。",
    "",
    "## 子任务加入：子任务 2：补充验收测试（execution-test）",
    "子任务开始执行。",
    "",
    "## 子任务发言：子任务 1：实现执行群聊（execution-chat）",
    "已把执行事件写入 group-chat.md。",
    "",
    "## 任务事件",
    "子任务批次已全部完成。",
  ].join("\n");

  const parsed = parseLoopDebateChatTranscript(transcript);

  assert.equal(parsed.title, "Loop 主从群聊记录");
  assert.equal(parsed.closed, false);
  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "rules", "main-turn", "subtask-joined", "subtask-joined", "subtask-turn", "task-event"],
  );
  const joined = parsed.segments.filter((segment) => segment.kind === "subtask-joined");
  assert.equal(joined.length, 2);
  assert.equal(joined[0]?.actorId, "execution-chat");
  assert.equal(joined[1]?.actorTitle, "子任务 2：补充验收测试");
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

test("allows proceeding when consensus is reached and all participants agree", () => {
  const consensus: LoopDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "All default participants agree to continue.",
    participantStances: [
      { participantId: "blue_planner", stance: "agree" },
      { participantId: "red_attacker", stance: "agree" },
      { participantId: "blue_verifier", stance: "agree" },
      { participantId: "red_edge_cases", stance: "agree" },
    ],
    resolvedDisagreements: [],
    openDisagreements: [],
  };

  const validation = validateLoopDebateConsensus(consensus);

  assert.equal(validation.canProceed, true);
  assert.equal(validation.consensusReached, true);
  assert.deepEqual(validation.blockingParticipantIds, []);
  assert.deepEqual(validation.blockingDisagreementIds, []);
  assert.deepEqual(validation.reasons, []);
  assert.equal(canProceedWithLoopDebateConsensus(consensus), true);
});

test("accepts legacy debate continue decisions whose subtasks omit skillIds", () => {
  const legacyDecision: LoopMainDecision = {
    status: "continue",
    estimatedRemainingRounds: 1,
    acceptance: {
      passed: false,
      summary: "One implementation step remains.",
      checks: [{ name: "implementation", passed: false, detail: "Run the legacy subtask." }],
    },
    subtasks: [{
      id: "legacy-subtask",
      title: "Legacy subtask",
      prompt: "Execute the existing red-blue decision contract.",
      writeFiles: ["src/legacy.ts"],
    }],
  };
  const consensus: LoopDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "The legacy decision remains executable.",
    participantStances: [
      { participantId: "blue_planner", stance: "agree" },
      { participantId: "red_attacker", stance: "agree_with_reservations" },
    ],
    resolvedDisagreements: [],
    openDisagreements: [],
    decision: legacyDecision,
  };

  assert.equal(Object.prototype.hasOwnProperty.call(legacyDecision.subtasks?.[0] ?? {}, "skillIds"), false);
  assert.equal(validateLoopDebateConsensus(consensus).canProceed, true);
  assert.equal(canProceedWithLoopDebateConsensus(consensus), true);
});

test("allows proceeding when a prior risk block is resolved into final reservations", () => {
  const consensus: LoopDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "Risk concerns were converted into source-scope subtasks and acceptance checks.",
    participantStances: [
      { participantId: "blue_planner", stance: "agree" },
      { participantId: "red_attacker", stance: "agree_with_reservations" },
      { participantId: "blue_verifier", stance: "agree" },
      { participantId: "red_edge_cases", stance: "agree_with_reservations", note: "Original block is resolved by a source-scope subtask." },
    ],
    resolvedDisagreements: [
      {
        id: "source-scope",
        title: "Source and probability scope",
        participants: ["red_edge_cases"],
        severity: "blocking",
        resolution: "Add a first subtask that fixes the probability method, data timestamp, and source requirements before evidence collection.",
      },
    ],
    openDisagreements: [],
  };

  const validation = validateLoopDebateConsensus(consensus);

  assert.equal(validation.canProceed, true);
  assert.equal(validation.consensusReached, true);
  assert.deepEqual(validation.blockingParticipantIds, []);
  assert.deepEqual(validation.blockingDisagreementIds, []);
  assert.deepEqual(validation.reasons, []);
});

test("blocks proceeding when an unresolved blocking disagreement remains open", () => {
  const consensus: LoopDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "One blocking disagreement remains unresolved.",
    participantStances: [
      { participantId: "architecture", stance: "agree" },
      { participantId: "risk", stance: "agree_with_reservations" },
    ],
    resolvedDisagreements: [],
    openDisagreements: [
      {
        id: "write-scope-conflict",
        title: "Write scope conflict",
        participants: ["blue_planner", "red_attacker"],
        severity: "blocking",
      },
    ],
  };

  const validation = validateLoopDebateConsensus(consensus);

  assert.equal(validation.canProceed, false);
  assert.deepEqual(validation.blockingParticipantIds, []);
  assert.deepEqual(validation.blockingDisagreementIds, ["write-scope-conflict"]);
});

test("blocks proceeding when any participant stance is block", () => {
  const consensus: LoopDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "Risk reviewer blocks the plan.",
    participantStances: [
      { participantId: "blue_planner", stance: "agree" },
      { participantId: "red_attacker", stance: "block", note: "The evidence chain is insufficient." },
    ],
    resolvedDisagreements: [],
    openDisagreements: [],
  };

  const validation = validateLoopDebateConsensus(consensus);

  assert.equal(validation.canProceed, false);
  assert.deepEqual(validation.blockingParticipantIds, ["red_attacker"]);
  assert.deepEqual(validation.blockingDisagreementIds, []);
});

test("summarizes a reached but blocked consensus as manual review with decision details", () => {
  const summary = buildLoopDebateNeedsReviewSummary({
    reasons: [
      "Blocking participant stance: security.",
      "Open blocking disagreement: credential-chain.",
    ],
    consensus: {
      artifactFile: "/tmp/consensus.md",
      reached: true,
      summary: "默认 runtime 缺少安全凭据闭环，不能继续发布。",
      participantStances: [
        { participantId: "security", stance: "block" },
      ],
      resolvedDisagreements: [],
      openDisagreements: [
        {
          id: "credential-chain",
          title: "凭据链路",
          participants: ["security"],
          severity: "blocking",
        },
      ],
      decision: {
        status: "blocked",
        finalSummary: "必须先完成授权的 secret/ref 配置。",
        estimatedRemainingRounds: 0,
      },
    },
  });

  assert.equal(summary.title, "红蓝对抗达成阻塞共识");
  assert.equal(summary.estimatedRemainingRounds, 0);
  assert.match(summary.finalSummary, /红蓝对抗达成阻塞共识/u);
  assert.match(summary.finalSummary, /默认 runtime 缺少安全凭据闭环/u);
  assert.match(summary.finalSummary, /必须先完成授权的 secret\/ref 配置/u);
  assert.match(summary.finalSummary, /credential-chain/u);
});

test("summarizes missing consensus as no consensus reached", () => {
  const summary = buildLoopDebateNeedsReviewSummary({
    reasons: ["Consensus has not been reached."],
  });

  assert.equal(summary.title, "红蓝对抗未达成一致");
  assert.equal(summary.estimatedRemainingRounds, undefined);
  assert.match(summary.finalSummary, /Consensus has not been reached/u);
});
