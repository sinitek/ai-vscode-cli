export const LOBSTER_DEBATE_DIR_NAME = "debates";
export const LOBSTER_DEBATE_PARTICIPANTS_DIR_NAME = "participants";
export const LOBSTER_DEBATE_BRIEF_FILENAME = "brief.md";
export const LOBSTER_DEBATE_CHAT_TRANSCRIPT_FILENAME = "chat.md";
export const LOBSTER_DEBATE_PARTICIPANT_ROSTER_FILENAME = "moderator-participants.md";
export const LOBSTER_DEBATE_CROSS_REVIEW_FILENAME = "cross-review.md";
export const LOBSTER_DEBATE_CONSENSUS_FILENAME = "consensus.md";
export const LOBSTER_DEBATE_DECISION_FILENAME = "decision.json";
export const LOBSTER_MAIN_SUB_CHAT_TRANSCRIPT_FILENAME = "group-chat.md";
export const LOBSTER_MAIN_SUB_CHAT_ROUND_KEY = "main-sub";
export const DEFAULT_LOBSTER_DEBATE_ROUND = 1;
export const LOBSTER_DEBATE_MAX_DIALOGUE_TURNS = 6;
export const LOBSTER_DEBATE_MAX_BATCH_SPEAKERS = 3;
export const LOBSTER_DEBATE_MODERATOR_ID = "moderator";
export const LOBSTER_DEBATE_MODERATOR_TITLE = "裁判主持人";
export const LOBSTER_DEBATE_BLUE_TEAM_ROLE = "blue_team";
export const LOBSTER_DEBATE_RED_TEAM_ROLE = "red_team";
export const LOBSTER_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES = [
  LOBSTER_DEBATE_BLUE_TEAM_ROLE,
  LOBSTER_DEBATE_RED_TEAM_ROLE,
] as const;

export const LOBSTER_DEBATE_PARTICIPANT_ROLES = [
  LOBSTER_DEBATE_BLUE_TEAM_ROLE,
  LOBSTER_DEBATE_RED_TEAM_ROLE,
  "architecture",
  "implementation",
  "testing",
  "risk",
  "product",
  "security",
  "data",
  "ux",
  "documentation",
  "custom",
] as const;

export type LobsterDebateParticipantRole = (typeof LOBSTER_DEBATE_PARTICIPANT_ROLES)[number];

export const LOBSTER_DEBATE_PARTICIPANT_STANCES = [
  "agree",
  "agree_with_reservations",
  "block",
] as const;

export type LobsterDebateParticipantStance = (typeof LOBSTER_DEBATE_PARTICIPANT_STANCES)[number];

export type LobsterDebateParticipantStatus = "pending" | "running" | "completed" | "error" | "stopped";

export const LOBSTER_DEBATE_MODERATOR_ACTIONS = [
  "continue",
  "finalize",
  "block",
] as const;

export type LobsterDebateModeratorAction = (typeof LOBSTER_DEBATE_MODERATOR_ACTIONS)[number];

export type LobsterDebateModeratorDecisionRecord = {
  artifactFile: string;
  dialogueTurn: number;
  action: LobsterDebateModeratorAction;
  reason: string;
  nextSpeakerIds: string[];
  nextFocus: string[];
  sessionId?: string | null;
  updatedAt: number;
};

export type LobsterDebateActiveSpeakerRecord = {
  kind: "participant" | "moderator" | "consensus";
  id: string;
  title: string;
  dialogueTurn?: number;
  finalPass?: boolean;
  updatedAt: number;
};

export type LobsterDebateParticipantRecord = {
  id: string;
  role: LobsterDebateParticipantRole;
  title: string;
  model?: string | null;
  status: LobsterDebateParticipantStatus;
  artifactFile: string;
  sessionId?: string | null;
  summary?: string;
  stance?: LobsterDebateParticipantStance;
  blockingIssues?: string[];
  updatedAt: number;
};

export type LobsterDebateDisagreementSeverity = "blocking" | "non_blocking";

export type LobsterDebateDisagreementRecord = {
  id: string;
  title: string;
  participants: string[];
  severity: LobsterDebateDisagreementSeverity;
  resolution?: string;
};

export type LobsterDebateParticipantStanceRecord = {
  participantId: string;
  stance: LobsterDebateParticipantStance;
  note?: string;
};

export type LobsterDebateConsensusRecord<TDecision = unknown> = {
  artifactFile: string;
  reached: boolean;
  summary: string;
  participantStances: LobsterDebateParticipantStanceRecord[];
  resolvedDisagreements: LobsterDebateDisagreementRecord[];
  openDisagreements: LobsterDebateDisagreementRecord[];
  decision?: TDecision;
};

export type LobsterDebateRoundStatus = "running" | "consensus" | "blocked" | "error" | "stopped";

export type LobsterDebateRoundRecord<TDecision = unknown> = {
  lobsterRound: number;
  debateRound: number;
  status: LobsterDebateRoundStatus;
  startedAt: number;
  completedAt?: number;
  briefFile: string;
  chatFile?: string;
  participantRosterFile?: string;
  participantRosterSessionId?: string | null;
  dialogueTurns?: number;
  activeSpeaker?: LobsterDebateActiveSpeakerRecord;
  participants: LobsterDebateParticipantRecord[];
  moderatorDecisions?: LobsterDebateModeratorDecisionRecord[];
  consensus?: LobsterDebateConsensusRecord<TDecision>;
};

export type LobsterDebateChatSegmentKind =
  | "preamble"
  | "rules"
  | "task-event"
  | "main-turn"
  | "subtask-joined"
  | "subtask-turn"
  | "participant-joined"
  | "participant-turn"
  | "moderator-turn"
  | "final-stance"
  | "forced-finalize"
  | "closed"
  | "error"
  | "section";

export type LobsterDebateChatSegment = {
  kind: LobsterDebateChatSegmentKind;
  heading: string;
  body: string;
  dialogueTurn?: number;
  actorId?: string;
  actorTitle?: string;
};

export type LobsterDebateChatTranscript = {
  title: string | null;
  segments: LobsterDebateChatSegment[];
  closed: boolean;
};

export type LobsterTaskRunControlState = {
  isRunning: boolean;
  canSupplement: boolean;
  canContinue: boolean;
  canStop: boolean;
};

export function resolveLobsterTaskRunControlState(
  task: { id: string; status: string; mainAiFailureLimitReached?: boolean | null },
  runningTaskIds: ReadonlySet<string>,
): LobsterTaskRunControlState {
  const isCompleted = task.status === "completed";
  const isRunning = !isCompleted && (task.status === "running" || runningTaskIds.has(task.id));
  const blockedByFailureLimit = Boolean(task.mainAiFailureLimitReached);
  return {
    isRunning,
    canSupplement: !isCompleted && !blockedByFailureLimit,
    canContinue: !isCompleted && !isRunning && !blockedByFailureLimit,
    canStop: isRunning,
  };
}

export type LobsterGroupChatFinalStatusSection = {
  heading: "任务成功完成" | "任务中断";
  body: string;
  terminalStatus: "completed" | "interrupted";
};

export type LobsterFinalSummaryAcceptanceCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type LobsterFinalSummaryRoundSummary = {
  round: number;
  subtaskId?: string;
  title: string;
  summary: string;
};

export type LobsterFinalSummaryTask = {
  id: string;
  sessionId?: string | null;
  finalSummary?: string | null;
  answerConclusion?: string | null;
  completionRoundSummaries?: LobsterFinalSummaryRoundSummary[] | null;
  completionRequirementCoverage?: LobsterFinalSummaryAcceptanceCheck[] | null;
};

export type LobsterFinalSummaryDecision = {
  finalSummary?: string | null;
  answerConclusion?: string | null;
  roundSummaries?: LobsterFinalSummaryRoundSummary[] | null;
  requirementCoverage?: LobsterFinalSummaryAcceptanceCheck[] | null;
  acceptance?: {
    passed?: boolean | null;
    summary?: string | null;
    checks?: LobsterFinalSummaryAcceptanceCheck[] | null;
  } | null;
};

export function buildLobsterGroupChatFinalStatusSection(task: {
  id: string;
  status: string;
  currentRound?: number | null;
  updatedAt?: number | null;
  finalSummary?: string | null;
  answerConclusion?: string | null;
  estimatedRemainingRounds?: number | null;
}): LobsterGroupChatFinalStatusSection | null {
  const status = String(task.status || "").trim();
  if (status === "completed") {
    const finalSummary = normalizeLobsterGroupChatFinalSummary(task.finalSummary, "主任务已完成。");
    const answerConclusion = normalizeLobsterGroupChatFinalSummary(task.answerConclusion, finalSummary);
    return {
      heading: "任务成功完成",
      terminalStatus: "completed",
      body: buildLobsterGroupChatFinalStatusBody(
        task,
        "任务已成功完成。",
        "### 问题回答结论",
        answerConclusion,
        [{ heading: "### 完成摘要", body: finalSummary }],
      ),
    };
  }
  if (status === "needs-review" || status === "error" || status === "stopped") {
    return {
      heading: "任务中断",
      terminalStatus: "interrupted",
      body: buildLobsterGroupChatFinalStatusBody(
        task,
        "任务已中断，需要人工复核或继续。",
        "### 中断说明",
        normalizeLobsterGroupChatFinalSummary(task.finalSummary, getDefaultLobsterInterruptedSummary(status)),
      ),
    };
  }
  return null;
}

function buildLobsterGroupChatFinalStatusBody(
  task: {
    id: string;
    status: string;
    currentRound?: number | null;
    updatedAt?: number | null;
    estimatedRemainingRounds?: number | null;
  },
  headline: string,
  summaryHeading: string,
  summary: string,
  extraSections: Array<{ heading: string; body: string }> = [],
): string {
  const lines = [
    headline,
    `- 状态：${task.status || "unknown"}`,
    `- 龙虾任务：${task.id}`,
  ];
  if (typeof task.currentRound === "number" && Number.isFinite(task.currentRound)) {
    lines.push(`- 当前主任务轮次：${Math.max(0, Math.floor(task.currentRound))}`);
  }
  if (typeof task.estimatedRemainingRounds === "number" && Number.isFinite(task.estimatedRemainingRounds)) {
    lines.push(`- 预计剩余轮次：${Math.max(0, Math.floor(task.estimatedRemainingRounds))} 轮`);
  }
  if (typeof task.updatedAt === "number" && Number.isFinite(task.updatedAt)) {
    lines.push(`- 更新时间：${new Date(task.updatedAt).toISOString()}`);
  }
  lines.push("", summaryHeading, summary);
  extraSections.forEach((section) => {
    const heading = normalizeLobsterPlainText(section.heading);
    const body = normalizeLobsterPlainText(section.body);
    if (heading && body) {
      lines.push("", heading, body);
    }
  });
  return lines.join("\n");
}

function normalizeLobsterGroupChatFinalSummary(value: string | null | undefined, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function normalizeLobsterPlainText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveLobsterAnswerConclusion(
  task: Pick<LobsterFinalSummaryTask, "answerConclusion" | "finalSummary">,
  decision?: Pick<LobsterFinalSummaryDecision, "answerConclusion" | "finalSummary"> | null,
): string {
  return normalizeLobsterPlainText(decision?.answerConclusion)
    || normalizeLobsterPlainText(task.answerConclusion)
    || normalizeLobsterPlainText(decision?.finalSummary)
    || normalizeLobsterPlainText(task.finalSummary)
    || "无";
}

export function buildLobsterAnswerConclusionMarkdown(
  task: Pick<LobsterFinalSummaryTask, "answerConclusion" | "finalSummary">,
  decision?: Pick<LobsterFinalSummaryDecision, "answerConclusion" | "finalSummary"> | null,
): string {
  return [
    "## 问题回答结论",
    "",
    resolveLobsterAnswerConclusion(task, decision),
  ].join("\n");
}

function resolveLobsterOverallFinalSummary(
  task: Pick<LobsterFinalSummaryTask, "finalSummary">,
  decision?: Pick<LobsterFinalSummaryDecision, "finalSummary"> | null,
): string {
  return normalizeLobsterPlainText(decision?.finalSummary)
    || normalizeLobsterPlainText(task.finalSummary)
    || "无";
}

export function buildLobsterFinalSummaryMarkdown(
  task: LobsterFinalSummaryTask,
  decision?: LobsterFinalSummaryDecision | null,
): string {
  const roundSummaries = Array.isArray(decision?.roundSummaries)
    ? decision.roundSummaries.slice().sort((left, right) => left.round - right.round)
    : (Array.isArray(task.completionRoundSummaries)
      ? task.completionRoundSummaries.slice().sort((left, right) => left.round - right.round)
      : []);
  const requirementCoverage = Array.isArray(decision?.requirementCoverage)
    ? decision.requirementCoverage
    : (Array.isArray(task.completionRequirementCoverage) ? task.completionRequirementCoverage : []);
  const acceptanceChecks = Array.isArray(decision?.acceptance?.checks) ? decision.acceptance?.checks ?? [] : [];
  const answerConclusion = resolveLobsterAnswerConclusion(task, decision);
  const finalSummary = resolveLobsterOverallFinalSummary(task, decision);
  const lines: string[] = [
    "# 龙虾任务最终总结",
    "",
    `- 任务 ID：${task.id}`,
    `- 会话 ID：${task.sessionId ?? "unknown"}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 验收状态：${decision?.acceptance?.passed === false ? "未通过" : "通过"}`,
    "",
    "## 问题回答结论",
    answerConclusion,
  ];

  lines.push("");
  lines.push("## 子任务完成摘要");
  if (roundSummaries.length === 0) {
    lines.push("- 无可用的子任务摘要。");
  } else {
    roundSummaries.forEach((item) => {
      const subtaskSuffix = item.subtaskId ? `（${item.subtaskId}）` : "";
      lines.push(`- 第 ${item.round} 轮 ${item.title}${subtaskSuffix}：${item.summary}`);
    });
  }

  lines.push("");
  lines.push("## 验收结果");
  if (decision?.acceptance?.summary) {
    lines.push(decision.acceptance.summary);
  }
  if (acceptanceChecks.length > 0) {
    lines.push("");
    acceptanceChecks.forEach((check) => {
      const detail = check.detail ? `（${check.detail}）` : "";
      lines.push(`- ${check.name}：${check.passed ? "通过" : "未通过"}${detail}`);
    });
  }

  lines.push("");
  lines.push("## 用户需求覆盖");
  if (requirementCoverage.length === 0) {
    lines.push("- 无可用的需求覆盖项。");
  } else {
    requirementCoverage.forEach((item) => {
      const detail = item.detail ? `（${item.detail}）` : "";
      lines.push(`- ${item.name}：${item.passed ? "已覆盖" : "未覆盖"}${detail}`);
    });
  }

  lines.push("");
  lines.push("## 整体任务总结");
  lines.push(finalSummary);
  return `${lines.join("\n")}\n`;
}

function getDefaultLobsterInterruptedSummary(status: string): string {
  if (status === "needs-review") {
    return "任务已进入人工复核，自动执行中断。";
  }
  if (status === "error") {
    return "任务执行出错，自动执行中断。";
  }
  if (status === "stopped") {
    return "任务已停止。";
  }
  return "任务已中断。";
}

export type LobsterDebatePaths = {
  communicationDir: string;
  debatesDir: string;
  lobsterRoundDir: string;
  roundDir: string;
  participantsDir: string;
  briefFile: string;
  chatFile: string;
  participantRosterFile: string;
  crossReviewFile: string;
  consensusFile: string;
  decisionFile: string;
};

export function buildLobsterMainSubChatTranscriptFile(communicationDir: string): string {
  return joinLobsterDebatePath(
    normalizeLobsterDebateBaseDir(communicationDir),
    LOBSTER_MAIN_SUB_CHAT_TRANSCRIPT_FILENAME,
  );
}

export function buildLobsterMainSubSubtaskTurnBody(options: {
  runStatus: string;
  assistantContent?: string | null;
  communicationFile?: string | null;
}): string {
  const content = normalizeLobsterMainSubAssistantContent(options.assistantContent);
  const runStatus = String(options.runStatus || "").trim() || "unknown";
  const result = runStatus === "end" ? "completed" : runStatus;
  if (runStatus === "end" && content) {
    return content;
  }

  const lines = [
    `- 运行结果：${result}`,
    options.communicationFile ? `- 沟通文件：${options.communicationFile}` : null,
  ].filter((line): line is string => Boolean(line));
  if (!content) {
    lines.push("- 说明：未捕获到子任务最终回复，请查看子任务标签页或沟通文件。");
    return lines.join("\n");
  }
  lines.push("", "### 最终回复", content);
  return lines.join("\n");
}

export type LobsterDebateConsensusValidationResult = {
  canProceed: boolean;
  consensusReached: boolean;
  blockingParticipantIds: string[];
  blockingDisagreementIds: string[];
  reasons: string[];
};

export type LobsterDebateNeedsReviewSummary = {
  title: string;
  finalSummary: string;
  details: string[];
  estimatedRemainingRounds?: number;
};

export function buildLobsterDebatePaths(
  communicationDir: string,
  lobsterRound: number,
  debateRound: number = DEFAULT_LOBSTER_DEBATE_ROUND,
): LobsterDebatePaths {
  const normalizedCommunicationDir = normalizeLobsterDebateBaseDir(communicationDir);
  const normalizedLobsterRound = normalizeLobsterDebateRoundNumber(lobsterRound);
  const normalizedDebateRound = normalizeLobsterDebateRoundNumber(debateRound);
  const debatesDir = joinLobsterDebatePath(normalizedCommunicationDir, LOBSTER_DEBATE_DIR_NAME);
  const lobsterRoundDir = joinLobsterDebatePath(debatesDir, `round-${normalizedLobsterRound}`);
  const roundDir = normalizedDebateRound === DEFAULT_LOBSTER_DEBATE_ROUND
    ? lobsterRoundDir
    : joinLobsterDebatePath(lobsterRoundDir, `debate-${normalizedDebateRound}`);
  const participantsDir = joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_PARTICIPANTS_DIR_NAME);

  return {
    communicationDir: normalizedCommunicationDir,
    debatesDir,
    lobsterRoundDir,
    roundDir,
    participantsDir,
    briefFile: joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_BRIEF_FILENAME),
    chatFile: joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_CHAT_TRANSCRIPT_FILENAME),
    participantRosterFile: joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_PARTICIPANT_ROSTER_FILENAME),
    crossReviewFile: joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_CROSS_REVIEW_FILENAME),
    consensusFile: joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_CONSENSUS_FILENAME),
    decisionFile: joinLobsterDebatePath(roundDir, LOBSTER_DEBATE_DECISION_FILENAME),
  };
}

export function buildLobsterDebateParticipantArtifactFile(
  paths: Pick<LobsterDebatePaths, "participantsDir">,
  participantId: string,
): string {
  return joinLobsterDebatePath(
    paths.participantsDir,
    `${sanitizeLobsterDebatePathSegment(participantId, "participant")}.md`,
  );
}

export function buildLobsterDebateParticipantTurnArtifactFile(
  paths: Pick<LobsterDebatePaths, "participantsDir">,
  participantId: string,
  dialogueTurn: number,
): string {
  const normalizedTurn = normalizeLobsterDebateRoundNumber(dialogueTurn);
  return joinLobsterDebatePath(
    paths.participantsDir,
    `${sanitizeLobsterDebatePathSegment(participantId, "participant")}-turn-${normalizedTurn}.md`,
  );
}

export function buildLobsterDebateModeratorArtifactFile(
  paths: Pick<LobsterDebatePaths, "participantsDir">,
  dialogueTurn: number,
): string {
  const normalizedTurn = normalizeLobsterDebateRoundNumber(dialogueTurn);
  return joinLobsterDebatePath(
    paths.participantsDir,
    `${LOBSTER_DEBATE_MODERATOR_ID}-turn-${normalizedTurn}.md`,
  );
}

export function isLobsterDebateParticipantStance(value: unknown): value is LobsterDebateParticipantStance {
  return normalizeLobsterDebateParticipantStance(value) !== null;
}

export function normalizeLobsterDebateParticipantStance(
  value: unknown,
): LobsterDebateParticipantStance | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return LOBSTER_DEBATE_PARTICIPANT_STANCES.some((stance) => stance === normalized)
    ? normalized as LobsterDebateParticipantStance
    : null;
}

export function isLobsterDebateAdversarialParticipantRole(
  value: unknown,
): value is (typeof LOBSTER_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES)[number] {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim();
  return LOBSTER_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES.some((role) => role === normalized);
}

export function isLobsterDebateBlockingStance(value: unknown): boolean {
  return normalizeLobsterDebateParticipantStance(value) === "block";
}

export function isLobsterDebateModeratorAction(value: unknown): value is LobsterDebateModeratorAction {
  return normalizeLobsterDebateModeratorAction(value) !== null;
}

export function normalizeLobsterDebateModeratorAction(
  value: unknown,
): LobsterDebateModeratorAction | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return LOBSTER_DEBATE_MODERATOR_ACTIONS.some((action) => action === normalized)
    ? normalized as LobsterDebateModeratorAction
    : null;
}

export function normalizeLobsterDebateSpeakerIds(
  value: unknown,
  allowedIds: readonly string[],
  maxItems: number = LOBSTER_DEBATE_MAX_BATCH_SPEAKERS,
): string[] {
  if (!Array.isArray(value) || !Array.isArray(allowedIds) || allowedIds.length === 0) {
    return [];
  }
  const allowed = new Set(
    allowedIds
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim()),
  );
  if (allowed.size === 0) {
    return [];
  }
  const normalizedMaxItems = Number.isFinite(maxItems) && maxItems > 0
    ? Math.max(1, Math.trunc(maxItems))
    : LOBSTER_DEBATE_MAX_BATCH_SPEAKERS;
  const result: string[] = [];
  value.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }
    const id = item.trim();
    if (!id || !allowed.has(id) || result.includes(id)) {
      return;
    }
    if (result.length < normalizedMaxItems) {
      result.push(id);
    }
  });
  return result;
}

export function selectDefaultLobsterDebateOpeningSpeakerIds(
  participants: ReadonlyArray<{ id: string; role?: string | null }>,
): string[] {
  if (!Array.isArray(participants) || participants.length === 0) {
    return [];
  }
  const firstBlue = participants.find((participant) => participant?.role === LOBSTER_DEBATE_BLUE_TEAM_ROLE);
  const fallback = participants.find((participant) => typeof participant?.id === "string" && Boolean(participant.id.trim()));
  const id = typeof firstBlue?.id === "string" && firstBlue.id.trim()
    ? firstBlue.id.trim()
    : (typeof fallback?.id === "string" ? fallback.id.trim() : "");
  return id ? [id] : [];
}

export function validateLobsterDebateConsensus(consensus: unknown): LobsterDebateConsensusValidationResult {
  if (!isObjectRecord(consensus)) {
    return {
      canProceed: false,
      consensusReached: false,
      blockingParticipantIds: [],
      blockingDisagreementIds: [],
      reasons: ["Consensus record is missing or invalid."],
    };
  }

  const consensusReached = consensus.reached === true;
  const blockingParticipantIds = collectBlockingLobsterDebateParticipantIds(consensus.participantStances);
  const blockingDisagreementIds = collectOpenBlockingLobsterDebateDisagreementIds(consensus.openDisagreements);
  const reasons: string[] = [];

  if (!consensusReached) {
    reasons.push("Consensus has not been reached.");
  }
  if (blockingParticipantIds.length > 0) {
    reasons.push(`Blocking participant stance: ${blockingParticipantIds.join(", ")}.`);
  }
  if (blockingDisagreementIds.length > 0) {
    reasons.push(`Open blocking disagreement: ${blockingDisagreementIds.join(", ")}.`);
  }

  return {
    canProceed: consensusReached && blockingParticipantIds.length === 0 && blockingDisagreementIds.length === 0,
    consensusReached,
    blockingParticipantIds,
    blockingDisagreementIds,
    reasons,
  };
}

export function canProceedWithLobsterDebateConsensus(consensus: unknown): boolean {
  return validateLobsterDebateConsensus(consensus).canProceed;
}

export function buildLobsterDebateNeedsReviewSummary(options: {
  reasons?: readonly string[] | null;
  consensus?: LobsterDebateConsensusRecord | null;
}): LobsterDebateNeedsReviewSummary {
  const reasons = normalizeLobsterDebateNeedsReviewReasons(options.reasons);
  const consensus = options.consensus ?? null;
  const consensusSummary = typeof consensus?.summary === "string" ? consensus.summary.trim() : "";
  const decision = isObjectRecord(consensus?.decision) ? consensus.decision : null;
  const decisionSummary = typeof decision?.finalSummary === "string" ? decision.finalSummary.trim() : "";
  const estimatedRemainingRounds = normalizeLobsterDebateEstimatedRemainingRounds(decision?.estimatedRemainingRounds);
  const title = consensus?.reached === true ? "红蓝对抗达成阻塞共识" : "红蓝对抗未达成一致";
  const details: string[] = [];
  if (consensusSummary) {
    details.push(`共识摘要：${consensusSummary}`);
  }
  if (decisionSummary) {
    details.push(`决策摘要：${decisionSummary}`);
  }
  if (reasons.length > 0) {
    details.push(`原因：${reasons.join("；")}`);
  }
  if (details.length === 0) {
    details.push("原因：未提供具体原因。");
  }
  return {
    title,
    finalSummary: `${title}，已进入人工复核。${details.join(" ")}`,
    details,
    ...(typeof estimatedRemainingRounds === "number" ? { estimatedRemainingRounds } : {}),
  };
}

export function normalizeLobsterDebateSessionId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function findLatestLobsterDebateParticipantSessionId(
  participants: readonly LobsterDebateParticipantRecord[] | null | undefined,
  participantId: string,
): string | null {
  if (!Array.isArray(participants) || !participantId.trim()) {
    return null;
  }
  for (let index = participants.length - 1; index >= 0; index -= 1) {
    const participant = participants[index];
    if (participant?.id === participantId) {
      const sessionId = normalizeLobsterDebateSessionId(participant.sessionId);
      if (sessionId) {
        return sessionId;
      }
    }
  }
  return null;
}

export function findLatestLobsterDebateModeratorSessionId(
  decisions: readonly LobsterDebateModeratorDecisionRecord[] | null | undefined,
): string | null {
  if (!Array.isArray(decisions)) {
    return null;
  }
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const sessionId = normalizeLobsterDebateSessionId(decisions[index]?.sessionId);
    if (sessionId) {
      return sessionId;
    }
  }
  return null;
}

export function parseLobsterDebateChatTranscript(content: string): LobsterDebateChatTranscript {
  const normalized = typeof content === "string" ? content.replace(/\r\n/g, "\n") : "";
  const lines = normalized.split("\n");
  let title: string | null = null;
  const sections: { heading: string; bodyLines: string[] }[] = [];
  let current: { heading: string; bodyLines: string[] } | null = null;
  const preambleLines: string[] = [];

  lines.forEach((line) => {
    const h1 = line.match(/^#\s+(.+?)\s*$/u);
    if (h1 && !title && !current && preambleLines.every((item) => !item.trim())) {
      title = h1[1]?.trim() ?? null;
      preambleLines.push(line);
      return;
    }

    const h2 = line.match(/^##\s+(.+?)\s*$/u);
    if (h2 && (isLobsterDebateChatBoundaryHeading(h2[1]?.trim() ?? "") || !current)) {
      if (current) {
        sections.push(current);
      }
      current = {
        heading: h2[1]?.trim() ?? "",
        bodyLines: [],
      };
      return;
    }

    if (current) {
      current.bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  });

  if (current) {
    sections.push(current);
  }

  const segments: LobsterDebateChatSegment[] = [];
  const preamble = normalizeLobsterDebateChatBody(preambleLines);
  if (preamble) {
    segments.push({
      kind: "preamble",
      heading: title ?? "Transcript",
      body: preamble,
    });
  }

  sections.forEach((section) => {
    const body = normalizeLobsterDebateChatBody(section.bodyLines);
    if (!section.heading && !body) {
      return;
    }
    segments.push(classifyLobsterDebateChatSection(section.heading, body));
  });

  return {
    title,
    segments,
    closed: segments.some((segment) => segment.kind === "closed"),
  };
}

function collectBlockingLobsterDebateParticipantIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => isObjectRecord(item))
    .filter((item) => isLobsterDebateBlockingStance(item.stance))
    .map((item) => normalizeLobsterDebateIdentifier(item.participantId, "unknown-participant"));
}

function collectOpenBlockingLobsterDebateDisagreementIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => isObjectRecord(item))
    .filter((item) => item.severity === "blocking")
    .map((item) => normalizeLobsterDebateIdentifier(item.id, "unknown-disagreement"));
}

function normalizeLobsterDebateNeedsReviewReasons(value: readonly string[] | null | undefined): string[] {
  return Array.isArray(value)
    ? value.map((reason) => String(reason).trim()).filter(Boolean)
    : [];
}

function normalizeLobsterDebateEstimatedRemainingRounds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLobsterDebateRoundNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : DEFAULT_LOBSTER_DEBATE_ROUND;
}

function normalizeLobsterDebateBaseDir(value: string): string {
  const normalized = String(value ?? "").trim();
  return normalized.replace(/[\\/]+$/, "") || ".";
}

function normalizeLobsterDebateIdentifier(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeLobsterDebatePathSegment(value: string, fallback: string): string {
  const normalized = normalizeLobsterDebateIdentifier(value, fallback).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || fallback;
}

function classifyLobsterDebateChatSection(heading: string, body: string): LobsterDebateChatSegment {
  const mainTurn = heading.match(/^主任务发言：第\s+(\d+)\s+轮(?:（(.+?)）)?$/u);
  if (mainTurn) {
    return {
      kind: "main-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLobsterDebateRoundNumber(mainTurn[1]),
      actorTitle: "主任务",
      actorId: mainTurn[2]?.trim() || "main",
    };
  }

  const subtaskJoined = heading.match(/^子任务加入：(.+?)（(.+?)）$/u);
  if (subtaskJoined) {
    return {
      kind: "subtask-joined",
      heading,
      body,
      actorTitle: subtaskJoined[1]?.trim(),
      actorId: subtaskJoined[2]?.trim(),
    };
  }

  const subtaskTurn = heading.match(/^子任务发言：(.+?)（(.+?)）$/u);
  if (subtaskTurn) {
    return {
      kind: "subtask-turn",
      heading,
      body,
      actorTitle: subtaskTurn[1]?.trim(),
      actorId: subtaskTurn[2]?.trim(),
    };
  }

  const participantJoined = heading.match(/^参与者加入：(.+?)（(.+?)）$/u);
  if (participantJoined) {
    return {
      kind: "participant-joined",
      heading,
      body,
      actorTitle: participantJoined[1]?.trim(),
      actorId: participantJoined[2]?.trim(),
    };
  }

  const participantTurn = heading.match(/^第\s+(\d+)\s+轮发言：(.+?)（(.+?)）$/u);
  if (participantTurn) {
    return {
      kind: "participant-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLobsterDebateRoundNumber(participantTurn[1]),
      actorTitle: participantTurn[2]?.trim(),
      actorId: participantTurn[3]?.trim(),
    };
  }

  const participantTurnWithoutRound = heading.match(/^发言：(.+?)（(.+?)）$/u);
  if (participantTurnWithoutRound) {
    return {
      kind: "participant-turn",
      heading,
      body,
      actorTitle: participantTurnWithoutRound[1]?.trim(),
      actorId: participantTurnWithoutRound[2]?.trim(),
    };
  }

  const moderatorTurn = heading.match(/^第\s+(\d+)\s+轮主持人控场(?:（(.+?)）)?$/u);
  if (moderatorTurn) {
    return {
      kind: "moderator-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLobsterDebateRoundNumber(moderatorTurn[1]),
      actorTitle: moderatorTurn[2]?.trim() || LOBSTER_DEBATE_MODERATOR_TITLE,
      actorId: LOBSTER_DEBATE_MODERATOR_ID,
    };
  }

  const moderatorTurnWithoutRound = heading.match(/^主持人控场(?:（(.+?)）)?$/u);
  if (moderatorTurnWithoutRound) {
    return {
      kind: "moderator-turn",
      heading,
      body,
      actorTitle: moderatorTurnWithoutRound[1]?.trim() || LOBSTER_DEBATE_MODERATOR_TITLE,
      actorId: LOBSTER_DEBATE_MODERATOR_ID,
    };
  }

  const finalStance = heading.match(/^最终立场：(.+?)（(.+?)）$/u);
  if (finalStance) {
    return {
      kind: "final-stance",
      heading,
      body,
      actorTitle: finalStance[1]?.trim(),
      actorId: finalStance[2]?.trim(),
    };
  }

  if (heading === "群聊规则") {
    return { kind: "rules", heading, body };
  }
  if (heading === "任务事件") {
    return { kind: "task-event", heading, body };
  }
  if (heading === "运行时强制收束") {
    return {
      kind: "forced-finalize",
      heading,
      body,
      actorId: LOBSTER_DEBATE_MODERATOR_ID,
      actorTitle: LOBSTER_DEBATE_MODERATOR_TITLE,
    };
  }
  if (heading === "任务成功完成") {
    return {
      kind: "closed",
      heading,
      body,
      actorId: "main",
      actorTitle: "主任务",
    };
  }
  if (heading === "任务中断") {
    return {
      kind: "error",
      heading,
      body,
      actorId: LOBSTER_DEBATE_MODERATOR_ID,
      actorTitle: LOBSTER_DEBATE_MODERATOR_TITLE,
    };
  }
  if (heading === "群聊收束") {
    return {
      kind: "closed",
      heading,
      body,
      actorId: LOBSTER_DEBATE_MODERATOR_ID,
      actorTitle: LOBSTER_DEBATE_MODERATOR_TITLE,
    };
  }
  if (heading === "主持人停止说明") {
    return {
      kind: "error",
      heading,
      body,
      actorId: LOBSTER_DEBATE_MODERATOR_ID,
      actorTitle: LOBSTER_DEBATE_MODERATOR_TITLE,
    };
  }
  return { kind: "section", heading, body };
}

function isLobsterDebateChatBoundaryHeading(heading: string): boolean {
  return heading === "群聊规则"
    || heading === "任务事件"
    || heading === "运行时强制收束"
    || heading === "任务成功完成"
    || heading === "任务中断"
    || heading === "群聊收束"
    || heading === "主持人停止说明"
    || /^主任务发言：第\s+\d+\s+轮(?:（.+?）)?$/u.test(heading)
    || /^子任务加入：.+?（.+?）$/u.test(heading)
    || /^子任务发言：.+?（.+?）$/u.test(heading)
    || /^参与者加入：.+?（.+?）$/u.test(heading)
    || /^第\s+\d+\s+轮发言：.+?（.+?）$/u.test(heading)
    || /^发言：.+?（.+?）$/u.test(heading)
    || /^第\s+\d+\s+轮主持人控场(?:（.+?）)?$/u.test(heading)
    || /^主持人控场(?:（.+?）)?$/u.test(heading)
    || /^最终立场：.+?（.+?）$/u.test(heading);
}

function normalizeLobsterDebateChatBody(lines: string[]): string {
  return lines.join("\n").replace(/^\s+|\s+$/g, "");
}

function normalizeLobsterMainSubAssistantContent(content: unknown): string {
  return String(content ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeOptionalLobsterDebateRoundNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.trunc(numeric);
}

function joinLobsterDebatePath(baseDir: string, ...segments: string[]): string {
  const separator = getLobsterDebatePathSeparator(baseDir);
  const normalizedBase = baseDir.replace(/[\\/]+$/, "") || ".";
  const normalizedSegments = segments
    .map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean);
  return [normalizedBase, ...normalizedSegments].join(separator);
}

function getLobsterDebatePathSeparator(filePath: string): "/" | "\\" {
  return filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
