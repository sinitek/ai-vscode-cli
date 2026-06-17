import test = require("node:test");
import assert = require("node:assert/strict");

import {
  DEFAULT_LOBSTER_EXECUTION_MODE,
  normalizeLobsterExecutionMode,
} from "../cli/types";
import {
  buildLobsterMainSubChatTranscriptFile,
  buildLobsterMainSubSubtaskTurnBody,
  buildLobsterDebateModeratorArtifactFile,
  buildLobsterDebatePaths,
  buildLobsterDebateParticipantTurnArtifactFile,
  canProceedWithLobsterDebateConsensus,
  findLatestLobsterDebateModeratorSessionId,
  findLatestLobsterDebateParticipantSessionId,
  LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
  normalizeLobsterDebateSessionId,
  normalizeLobsterDebateModeratorAction,
  parseLobsterDebateChatTranscript,
  validateLobsterDebateConsensus,
  type LobsterDebateModeratorDecisionRecord,
  type LobsterDebateParticipantRecord,
  type LobsterDebateConsensusRecord,
} from "../lobsterDebate";

test("normalizes lobster execution mode with legacy-compatible default", () => {
  assert.equal(DEFAULT_LOBSTER_EXECUTION_MODE, "main_sub_multi_agent");
  assert.equal(normalizeLobsterExecutionMode(undefined), "main_sub_multi_agent");
  assert.equal(normalizeLobsterExecutionMode(null), "main_sub_multi_agent");
  assert.equal(normalizeLobsterExecutionMode(""), "main_sub_multi_agent");
  assert.equal(normalizeLobsterExecutionMode("main_sub"), "main_sub_multi_agent");
  assert.equal(normalizeLobsterExecutionMode("main_sub_multi_agent"), "main_sub_multi_agent");
  assert.equal(normalizeLobsterExecutionMode("debate_multi_agent"), "debate_multi_agent");
});

test("builds stable debate communication paths for the first debate round", () => {
  const paths = buildLobsterDebatePaths("/tmp/lobster-communications/task-1/", 2);

  assert.equal(paths.communicationDir, "/tmp/lobster-communications/task-1");
  assert.equal(paths.debatesDir, "/tmp/lobster-communications/task-1/debates");
  assert.equal(paths.lobsterRoundDir, "/tmp/lobster-communications/task-1/debates/round-2");
  assert.equal(paths.roundDir, "/tmp/lobster-communications/task-1/debates/round-2");
  assert.equal(paths.participantsDir, "/tmp/lobster-communications/task-1/debates/round-2/participants");
  assert.equal(paths.briefFile, "/tmp/lobster-communications/task-1/debates/round-2/brief.md");
  assert.equal(paths.chatFile, "/tmp/lobster-communications/task-1/debates/round-2/chat.md");
  assert.equal(paths.participantRosterFile, "/tmp/lobster-communications/task-1/debates/round-2/moderator-participants.md");
  assert.equal(paths.crossReviewFile, "/tmp/lobster-communications/task-1/debates/round-2/cross-review.md");
  assert.equal(paths.consensusFile, "/tmp/lobster-communications/task-1/debates/round-2/consensus.md");
  assert.equal(paths.decisionFile, "/tmp/lobster-communications/task-1/debates/round-2/decision.json");
});

test("builds stable main-sub group chat transcript path", () => {
  assert.equal(
    buildLobsterMainSubChatTranscriptFile("/tmp/lobster-communications/task-1/"),
    "/tmp/lobster-communications/task-1/group-chat.md",
  );
});

test("builds nested paths for additional debate rounds within the same lobster round", () => {
  const paths = buildLobsterDebatePaths("/tmp/lobster-communications/task-1", 2, 3);

  assert.equal(paths.lobsterRoundDir, "/tmp/lobster-communications/task-1/debates/round-2");
  assert.equal(paths.roundDir, "/tmp/lobster-communications/task-1/debates/round-2/debate-3");
  assert.equal(paths.consensusFile, "/tmp/lobster-communications/task-1/debates/round-2/debate-3/consensus.md");
});

test("builds stable participant and moderator artifact paths for bounded chat turns", () => {
  const paths = buildLobsterDebatePaths("/tmp/lobster-communications/task-1", 2);

  assert.ok(LOBSTER_DEBATE_MAX_DIALOGUE_TURNS > 2);
  assert.equal(
    buildLobsterDebateParticipantTurnArtifactFile(paths, "risk/review", 1),
    "/tmp/lobster-communications/task-1/debates/round-2/participants/risk_review-turn-1.md",
  );
  assert.equal(
    buildLobsterDebateModeratorArtifactFile(paths, 3),
    "/tmp/lobster-communications/task-1/debates/round-2/participants/moderator-turn-3.md",
  );
  assert.equal(normalizeLobsterDebateModeratorAction("continue"), "continue");
  assert.equal(normalizeLobsterDebateModeratorAction("finalize"), "finalize");
  assert.equal(normalizeLobsterDebateModeratorAction("block"), "block");
  assert.equal(normalizeLobsterDebateModeratorAction("wait"), null);
});

test("tracks latest debate actor session ids for closed temporary tabs", () => {
  const participants: LobsterDebateParticipantRecord[] = [
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
  const moderatorDecisions: LobsterDebateModeratorDecisionRecord[] = [
    {
      artifactFile: "/tmp/moderator-turn-1.md",
      dialogueTurn: 1,
      action: "continue",
      reason: "需要追问",
      nextFocus: [],
      sessionId: "moderator-session-1",
      updatedAt: 1,
    },
    {
      artifactFile: "/tmp/moderator-turn-2.md",
      dialogueTurn: 2,
      action: "finalize",
      reason: "可以收束",
      nextFocus: [],
      sessionId: "moderator-session-2",
      updatedAt: 2,
    },
  ];

  assert.equal(normalizeLobsterDebateSessionId(" session-1 "), "session-1");
  assert.equal(normalizeLobsterDebateSessionId(" "), null);
  assert.equal(findLatestLobsterDebateParticipantSessionId(participants, "architecture"), "session-arch-2");
  assert.equal(findLatestLobsterDebateParticipantSessionId(participants, "risk"), "session-risk-1");
  assert.equal(findLatestLobsterDebateParticipantSessionId(participants, "testing"), null);
  assert.equal(findLatestLobsterDebateModeratorSessionId(moderatorDecisions), "moderator-session-2");
});

test("parses debate chat transcript into role-oriented segments", () => {
  const transcript = [
    "# 龙虾辩论群聊记录",
    "",
    "- 任务 ID：task-1",
    "",
    "## 群聊规则",
    "- 每位角色读取已有发言。",
    "",
    "## 参与者加入：产品体验（product-review）",
    "关注用户流程。",
    "",
    "## 第 1 轮发言：架构规划（architecture）",
    "## 群聊发言",
    "建议先拆模块。",
    "",
    "## 第 1 轮主持人控场（主持人控场）",
    "## 主持人决策",
    "continue",
    "",
    "## 最终立场：风险审查（risk）",
    "## 立场",
    "agree_with_reservations",
    "",
    "## 群聊收束",
    "主持人最终动作：finalize",
  ].join("\n");

  const parsed = parseLobsterDebateChatTranscript(transcript);

  assert.equal(parsed.title, "龙虾辩论群聊记录");
  assert.equal(parsed.closed, true);
  assert.deepEqual(
    parsed.segments.map((segment) => segment.kind),
    ["preamble", "rules", "participant-joined", "participant-turn", "moderator-turn", "final-stance", "closed"],
  );
  const joined = parsed.segments.find((segment) => segment.kind === "participant-joined");
  assert.equal(joined?.actorId, "product-review");
  assert.equal(joined?.actorTitle, "产品体验");
  const participant = parsed.segments.find((segment) => segment.kind === "participant-turn");
  assert.equal(participant?.dialogueTurn, 1);
  assert.equal(participant?.actorId, "architecture");
  assert.equal(participant?.actorTitle, "架构规划");
  const moderator = parsed.segments.find((segment) => segment.kind === "moderator-turn");
  assert.equal(moderator?.actorId, "moderator");
});

test("parses debate chat transcript without UI round section headings", () => {
  const transcript = [
    "# 龙虾群聊记录",
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

  const parsed = parseLobsterDebateChatTranscript(transcript);

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
    "# 龙虾主从群聊记录",
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

  const parsed = parseLobsterDebateChatTranscript(transcript);

  assert.equal(parsed.title, "龙虾主从群聊记录");
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
    "# 龙虾主从群聊记录",
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

  const parsed = parseLobsterDebateChatTranscript(transcript);

  assert.equal(parsed.title, "龙虾主从群聊记录");
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
  const body = buildLobsterMainSubSubtaskTurnBody({
    runStatus: "end",
    assistantContent: "\n已完成修复。\n\n- build 通过\n",
    communicationFile: "/tmp/subtask.md",
  });

  assert.equal(body, "已完成修复。\n\n- build 通过");
  assert.equal(body.includes("运行结果"), false);
  assert.equal(body.includes("沟通文件"), false);
});

test("formats incomplete main-sub subtask chat turn with troubleshooting context", () => {
  const body = buildLobsterMainSubSubtaskTurnBody({
    runStatus: "error",
    assistantContent: null,
    communicationFile: "/tmp/subtask.md",
  });

  assert.match(body, /运行结果：error/u);
  assert.match(body, /沟通文件：\/tmp\/subtask\.md/u);
  assert.match(body, /未捕获到子任务最终回复/u);
});

test("allows proceeding when consensus is reached and all participants agree", () => {
  const consensus: LobsterDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "All default participants agree to continue.",
    participantStances: [
      { participantId: "architecture", stance: "agree" },
      { participantId: "implementation", stance: "agree" },
      { participantId: "testing", stance: "agree" },
      { participantId: "risk", stance: "agree" },
    ],
    resolvedDisagreements: [],
    openDisagreements: [],
  };

  const validation = validateLobsterDebateConsensus(consensus);

  assert.equal(validation.canProceed, true);
  assert.equal(validation.consensusReached, true);
  assert.deepEqual(validation.blockingParticipantIds, []);
  assert.deepEqual(validation.blockingDisagreementIds, []);
  assert.deepEqual(validation.reasons, []);
  assert.equal(canProceedWithLobsterDebateConsensus(consensus), true);
});

test("allows proceeding when a prior risk block is resolved into final reservations", () => {
  const consensus: LobsterDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "Risk concerns were converted into source-scope subtasks and acceptance checks.",
    participantStances: [
      { participantId: "architecture", stance: "agree" },
      { participantId: "implementation", stance: "agree" },
      { participantId: "testing", stance: "agree_with_reservations" },
      { participantId: "risk", stance: "agree_with_reservations", note: "Original block is resolved by a source-scope subtask." },
    ],
    resolvedDisagreements: [
      {
        id: "source-scope",
        title: "Source and probability scope",
        participants: ["risk"],
        severity: "blocking",
        resolution: "Add a first subtask that fixes the probability method, data timestamp, and source requirements before evidence collection.",
      },
    ],
    openDisagreements: [],
  };

  const validation = validateLobsterDebateConsensus(consensus);

  assert.equal(validation.canProceed, true);
  assert.equal(validation.consensusReached, true);
  assert.deepEqual(validation.blockingParticipantIds, []);
  assert.deepEqual(validation.blockingDisagreementIds, []);
  assert.deepEqual(validation.reasons, []);
});

test("blocks proceeding when an unresolved blocking disagreement remains open", () => {
  const consensus: LobsterDebateConsensusRecord = {
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
        participants: ["architecture", "risk"],
        severity: "blocking",
      },
    ],
  };

  const validation = validateLobsterDebateConsensus(consensus);

  assert.equal(validation.canProceed, false);
  assert.deepEqual(validation.blockingParticipantIds, []);
  assert.deepEqual(validation.blockingDisagreementIds, ["write-scope-conflict"]);
});

test("blocks proceeding when any participant stance is block", () => {
  const consensus: LobsterDebateConsensusRecord = {
    artifactFile: "/tmp/consensus.md",
    reached: true,
    summary: "Risk reviewer blocks the plan.",
    participantStances: [
      { participantId: "architecture", stance: "agree" },
      { participantId: "risk", stance: "block", note: "Authorized write scope is inconsistent." },
    ],
    resolvedDisagreements: [],
    openDisagreements: [],
  };

  const validation = validateLobsterDebateConsensus(consensus);

  assert.equal(validation.canProceed, false);
  assert.deepEqual(validation.blockingParticipantIds, ["risk"]);
  assert.deepEqual(validation.blockingDisagreementIds, []);
});
