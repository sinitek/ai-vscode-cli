import { sanitizePathSegment } from "./shared/pathSegments";

export const LOOP_DEBATE_DIR_NAME = "debates";
export const LOOP_DEBATE_PARTICIPANTS_DIR_NAME = "participants";
export const LOOP_DEBATE_BRIEF_FILENAME = "brief.md";
export const LOOP_DEBATE_CHAT_TRANSCRIPT_FILENAME = "chat.md";
export const LOOP_DEBATE_PARTICIPANT_ROSTER_FILENAME = "moderator-participants.md";
export const LOOP_DEBATE_CROSS_REVIEW_FILENAME = "cross-review.md";
export const LOOP_DEBATE_CONSENSUS_FILENAME = "consensus.md";
export const LOOP_DEBATE_DECISION_FILENAME = "decision.json";
export const LOOP_MAIN_SUB_CHAT_TRANSCRIPT_FILENAME = "group-chat.md";
export const LOOP_MAIN_SUB_CHAT_ROUND_KEY = "main-sub";
export const DEFAULT_LOOP_DEBATE_ROUND = 1;
export const LOOP_DEBATE_MAX_DIALOGUE_TURNS = 6;
export const LOOP_DEBATE_MAX_BATCH_SPEAKERS = 3;
export const LOOP_DEBATE_MODERATOR_ID = "moderator";
export const LOOP_DEBATE_MODERATOR_TITLE = "裁判主持人";
export const LOOP_DEBATE_BLUE_TEAM_ROLE = "blue_team";
export const LOOP_DEBATE_RED_TEAM_ROLE = "red_team";
export const LOOP_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES = [
  LOOP_DEBATE_BLUE_TEAM_ROLE,
  LOOP_DEBATE_RED_TEAM_ROLE,
] as const;

export {
  buildLoopAnswerConclusionMarkdown,
  buildLoopFinalSummaryMarkdown,
  buildLoopGroupChatFinalStatusSection,
  resolveLoopAnswerConclusion,
  type LoopFinalSummaryAcceptanceCheck,
  type LoopFinalSummaryDecision,
  type LoopFinalSummaryRoundSummary,
  type LoopFinalSummaryTask,
  type LoopGroupChatFinalStatusSection,
} from "./loopDebateFinalSummary";

export const LOOP_DEBATE_PARTICIPANT_ROLES = [
  LOOP_DEBATE_BLUE_TEAM_ROLE,
  LOOP_DEBATE_RED_TEAM_ROLE,
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

export type LoopDebateParticipantRole = (typeof LOOP_DEBATE_PARTICIPANT_ROLES)[number];

export const LOOP_DEBATE_PARTICIPANT_STANCES = [
  "agree",
  "agree_with_reservations",
  "block",
] as const;

export type LoopDebateParticipantStance = (typeof LOOP_DEBATE_PARTICIPANT_STANCES)[number];

export type LoopDebateParticipantStatus = "pending" | "running" | "completed" | "error" | "stopped";

export const LOOP_DEBATE_MODERATOR_ACTIONS = [
  "continue",
  "finalize",
  "block",
] as const;

export type LoopDebateModeratorAction = (typeof LOOP_DEBATE_MODERATOR_ACTIONS)[number];

export type LoopDebateModeratorDecisionRecord = {
  artifactFile: string;
  dialogueTurn: number;
  action: LoopDebateModeratorAction;
  reason: string;
  nextSpeakerIds: string[];
  nextFocus: string[];
  sessionId?: string | null;
  updatedAt: number;
};

export type LoopDebateActiveSpeakerRecord = {
  kind: "participant" | "moderator" | "consensus";
  id: string;
  title: string;
  dialogueTurn?: number;
  finalPass?: boolean;
  updatedAt: number;
};

export type LoopDebateParticipantRecord = {
  id: string;
  role: LoopDebateParticipantRole;
  title: string;
  model?: string | null;
  status: LoopDebateParticipantStatus;
  artifactFile: string;
  sessionId?: string | null;
  summary?: string;
  stance?: LoopDebateParticipantStance;
  blockingIssues?: string[];
  updatedAt: number;
};

export type LoopDebateDisagreementSeverity = "blocking" | "non_blocking";

export type LoopDebateDisagreementRecord = {
  id: string;
  title: string;
  participants: string[];
  severity: LoopDebateDisagreementSeverity;
  resolution?: string;
};

export type LoopDebateParticipantStanceRecord = {
  participantId: string;
  stance: LoopDebateParticipantStance;
  note?: string;
};

export type LoopDebateConsensusRecord<TDecision = unknown> = {
  artifactFile: string;
  reached: boolean;
  summary: string;
  participantStances: LoopDebateParticipantStanceRecord[];
  resolvedDisagreements: LoopDebateDisagreementRecord[];
  openDisagreements: LoopDebateDisagreementRecord[];
  decision?: TDecision;
};

export type LoopDebateRoundStatus = "running" | "consensus" | "blocked" | "error" | "stopped";

export type LoopDebateRoundRecord<TDecision = unknown> = {
  loopRound: number;
  debateRound: number;
  status: LoopDebateRoundStatus;
  startedAt: number;
  completedAt?: number;
  briefFile: string;
  chatFile?: string;
  participantRosterFile?: string;
  participantRosterSessionId?: string | null;
  dialogueTurns?: number;
  activeSpeaker?: LoopDebateActiveSpeakerRecord;
  participants: LoopDebateParticipantRecord[];
  moderatorDecisions?: LoopDebateModeratorDecisionRecord[];
  consensus?: LoopDebateConsensusRecord<TDecision>;
};

export type LoopDebateChatSegmentKind =
  | "preamble"
  | "rules"
  | "task-event"
  | "user-message"
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

export type LoopDebateChatSegment = {
  kind: LoopDebateChatSegmentKind;
  heading: string;
  body: string;
  dialogueTurn?: number;
  actorId?: string;
  actorTitle?: string;
};

export type LoopDebateChatTranscript = {
  title: string | null;
  segments: LoopDebateChatSegment[];
  closed: boolean;
};

export type LoopTaskRunControlState = {
  isRunning: boolean;
  canSupplement: boolean;
  canContinue: boolean;
  canStop: boolean;
};

export function isLoopTaskRunOrphaned(
  task: {
    id: string;
    status: string;
    activeSubtaskIds?: readonly string[] | null;
  },
  runningTaskIds: ReadonlySet<string>,
): boolean {
  return task.status === "running"
    && !runningTaskIds.has(task.id)
    && (task.activeSubtaskIds?.length ?? 0) === 0;
}

export function resolveLoopTaskRunControlState(
  task: { id: string; status: string; mainAiFailureLimitReached?: boolean | null },
  runningTaskIds: ReadonlySet<string>,
): LoopTaskRunControlState {
  const hasRunningProcess = runningTaskIds.has(task.id);
  const isCompleted = task.status === "completed";
  const isSleeping = task.status === "sleeping";
  const isInterrupted = task.status === "needs-review" || task.status === "error" || task.status === "stopped";
  const isRunning = !isInterrupted && (hasRunningProcess || (!isCompleted && task.status === "running"));
  const blockedByFailureLimit = Boolean(task.mainAiFailureLimitReached);
  return {
    isRunning,
    canSupplement: isRunning || (!isCompleted && !blockedByFailureLimit),
    canContinue: !isCompleted && !isRunning && !blockedByFailureLimit,
    canStop: isRunning || isSleeping,
  };
}

export type LoopDebatePaths = {
  communicationDir: string;
  debatesDir: string;
  loopRoundDir: string;
  roundDir: string;
  participantsDir: string;
  briefFile: string;
  chatFile: string;
  participantRosterFile: string;
  crossReviewFile: string;
  consensusFile: string;
  decisionFile: string;
};

export function buildLoopMainSubChatTranscriptFile(communicationDir: string): string {
  return joinLoopDebatePath(
    normalizeLoopDebateBaseDir(communicationDir),
    LOOP_MAIN_SUB_CHAT_TRANSCRIPT_FILENAME,
  );
}

export function formatLoopGroupChatMemberName(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  const title = normalized || "未知成员";
  if (/^【.+】$/u.test(title)) {
    return title;
  }
  return `【${title}】`;
}

export function buildLoopMainSubSubtaskTurnBody(options: {
  runStatus: string;
  assistantContent?: string | null;
  communicationFile?: string | null;
}): string {
  const content = normalizeLoopMainSubAssistantContent(options.assistantContent);
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

export type LoopDebateConsensusValidationResult = {
  canProceed: boolean;
  consensusReached: boolean;
  blockingParticipantIds: string[];
  blockingDisagreementIds: string[];
  reasons: string[];
};

export type LoopDebateNeedsReviewSummary = {
  title: string;
  finalSummary: string;
  details: string[];
  estimatedRemainingRounds?: number;
};

export function buildLoopDebatePaths(
  communicationDir: string,
  loopRound: number,
  debateRound: number = DEFAULT_LOOP_DEBATE_ROUND,
): LoopDebatePaths {
  const normalizedCommunicationDir = normalizeLoopDebateBaseDir(communicationDir);
  const normalizedLoopRound = normalizeLoopDebateRoundNumber(loopRound);
  const normalizedDebateRound = normalizeLoopDebateRoundNumber(debateRound);
  const debatesDir = joinLoopDebatePath(normalizedCommunicationDir, LOOP_DEBATE_DIR_NAME);
  const loopRoundDir = joinLoopDebatePath(debatesDir, `round-${normalizedLoopRound}`);
  const roundDir = normalizedDebateRound === DEFAULT_LOOP_DEBATE_ROUND
    ? loopRoundDir
    : joinLoopDebatePath(loopRoundDir, `debate-${normalizedDebateRound}`);
  const participantsDir = joinLoopDebatePath(roundDir, LOOP_DEBATE_PARTICIPANTS_DIR_NAME);

  return {
    communicationDir: normalizedCommunicationDir,
    debatesDir,
    loopRoundDir,
    roundDir,
    participantsDir,
    briefFile: joinLoopDebatePath(roundDir, LOOP_DEBATE_BRIEF_FILENAME),
    chatFile: joinLoopDebatePath(roundDir, LOOP_DEBATE_CHAT_TRANSCRIPT_FILENAME),
    participantRosterFile: joinLoopDebatePath(roundDir, LOOP_DEBATE_PARTICIPANT_ROSTER_FILENAME),
    crossReviewFile: joinLoopDebatePath(roundDir, LOOP_DEBATE_CROSS_REVIEW_FILENAME),
    consensusFile: joinLoopDebatePath(roundDir, LOOP_DEBATE_CONSENSUS_FILENAME),
    decisionFile: joinLoopDebatePath(roundDir, LOOP_DEBATE_DECISION_FILENAME),
  };
}

export function buildLoopDebateParticipantArtifactFile(
  paths: Pick<LoopDebatePaths, "participantsDir">,
  participantId: string,
): string {
  return joinLoopDebatePath(
    paths.participantsDir,
    `${sanitizeLoopDebatePathSegment(participantId, "participant")}.md`,
  );
}

export function buildLoopDebateParticipantTurnArtifactFile(
  paths: Pick<LoopDebatePaths, "participantsDir">,
  participantId: string,
  dialogueTurn: number,
): string {
  const normalizedTurn = normalizeLoopDebateRoundNumber(dialogueTurn);
  return joinLoopDebatePath(
    paths.participantsDir,
    `${sanitizeLoopDebatePathSegment(participantId, "participant")}-turn-${normalizedTurn}.md`,
  );
}

export function buildLoopDebateModeratorArtifactFile(
  paths: Pick<LoopDebatePaths, "participantsDir">,
  dialogueTurn: number,
): string {
  const normalizedTurn = normalizeLoopDebateRoundNumber(dialogueTurn);
  return joinLoopDebatePath(
    paths.participantsDir,
    `${LOOP_DEBATE_MODERATOR_ID}-turn-${normalizedTurn}.md`,
  );
}

export function isLoopDebateParticipantStance(value: unknown): value is LoopDebateParticipantStance {
  return normalizeLoopDebateParticipantStance(value) !== null;
}

export function normalizeLoopDebateParticipantStance(
  value: unknown,
): LoopDebateParticipantStance | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return LOOP_DEBATE_PARTICIPANT_STANCES.some((stance) => stance === normalized)
    ? normalized as LoopDebateParticipantStance
    : null;
}

export function isLoopDebateAdversarialParticipantRole(
  value: unknown,
): value is (typeof LOOP_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES)[number] {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim();
  return LOOP_DEBATE_ADVERSARIAL_PARTICIPANT_ROLES.some((role) => role === normalized);
}

export function isLoopDebateBlockingStance(value: unknown): boolean {
  return normalizeLoopDebateParticipantStance(value) === "block";
}

export function isLoopDebateModeratorAction(value: unknown): value is LoopDebateModeratorAction {
  return normalizeLoopDebateModeratorAction(value) !== null;
}

export function normalizeLoopDebateModeratorAction(
  value: unknown,
): LoopDebateModeratorAction | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return LOOP_DEBATE_MODERATOR_ACTIONS.some((action) => action === normalized)
    ? normalized as LoopDebateModeratorAction
    : null;
}

export function normalizeLoopDebateSpeakerIds(
  value: unknown,
  allowedIds: readonly string[],
  maxItems: number = LOOP_DEBATE_MAX_BATCH_SPEAKERS,
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
    : LOOP_DEBATE_MAX_BATCH_SPEAKERS;
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

export function selectDefaultLoopDebateOpeningSpeakerIds(
  participants: ReadonlyArray<{ id: string; role?: string | null }>,
): string[] {
  if (!Array.isArray(participants) || participants.length === 0) {
    return [];
  }
  const firstBlue = participants.find((participant) => participant?.role === LOOP_DEBATE_BLUE_TEAM_ROLE);
  const fallback = participants.find((participant) => typeof participant?.id === "string" && Boolean(participant.id.trim()));
  const id = typeof firstBlue?.id === "string" && firstBlue.id.trim()
    ? firstBlue.id.trim()
    : (typeof fallback?.id === "string" ? fallback.id.trim() : "");
  return id ? [id] : [];
}

export function validateLoopDebateConsensus(consensus: unknown): LoopDebateConsensusValidationResult {
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
  const blockingParticipantIds = collectBlockingLoopDebateParticipantIds(consensus.participantStances);
  const blockingDisagreementIds = collectOpenBlockingLoopDebateDisagreementIds(consensus.openDisagreements);
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

export function canProceedWithLoopDebateConsensus(consensus: unknown): boolean {
  return validateLoopDebateConsensus(consensus).canProceed;
}

export function buildLoopDebateNeedsReviewSummary(options: {
  reasons?: readonly string[] | null;
  consensus?: LoopDebateConsensusRecord | null;
}): LoopDebateNeedsReviewSummary {
  const reasons = normalizeLoopDebateNeedsReviewReasons(options.reasons);
  const consensus = options.consensus ?? null;
  const consensusSummary = typeof consensus?.summary === "string" ? consensus.summary.trim() : "";
  const decision = isObjectRecord(consensus?.decision) ? consensus.decision : null;
  const decisionSummary = typeof decision?.finalSummary === "string" ? decision.finalSummary.trim() : "";
  const estimatedRemainingRounds = normalizeLoopDebateEstimatedRemainingRounds(decision?.estimatedRemainingRounds);
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

export function normalizeLoopDebateSessionId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function findLatestLoopDebateParticipantSessionId(
  participants: readonly LoopDebateParticipantRecord[] | null | undefined,
  participantId: string,
): string | null {
  if (!Array.isArray(participants) || !participantId.trim()) {
    return null;
  }
  for (let index = participants.length - 1; index >= 0; index -= 1) {
    const participant = participants[index];
    if (participant?.id === participantId) {
      const sessionId = normalizeLoopDebateSessionId(participant.sessionId);
      if (sessionId) {
        return sessionId;
      }
    }
  }
  return null;
}

export function findLatestLoopDebateModeratorSessionId(
  decisions: readonly LoopDebateModeratorDecisionRecord[] | null | undefined,
): string | null {
  if (!Array.isArray(decisions)) {
    return null;
  }
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const sessionId = normalizeLoopDebateSessionId(decisions[index]?.sessionId);
    if (sessionId) {
      return sessionId;
    }
  }
  return null;
}

export function parseLoopDebateChatTranscript(content: string): LoopDebateChatTranscript {
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
    if (h2 && (isLoopDebateChatBoundaryHeading(h2[1]?.trim() ?? "") || !current)) {
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

  const segments: LoopDebateChatSegment[] = [];
  const preamble = normalizeLoopDebateChatBody(preambleLines);
  if (preamble) {
    segments.push({
      kind: "preamble",
      heading: title ?? "Transcript",
      body: preamble,
    });
  }

  sections.forEach((section) => {
    const body = normalizeLoopDebateChatBody(section.bodyLines);
    if (!section.heading && !body) {
      return;
    }
    segments.push(classifyLoopDebateChatSection(section.heading, body));
  });

  return {
    title,
    segments,
    closed: segments.some((segment) => segment.kind === "closed"),
  };
}

function collectBlockingLoopDebateParticipantIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => isObjectRecord(item))
    .filter((item) => isLoopDebateBlockingStance(item.stance))
    .map((item) => normalizeLoopDebateIdentifier(item.participantId, "unknown-participant"));
}

function collectOpenBlockingLoopDebateDisagreementIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => isObjectRecord(item))
    .filter((item) => item.severity === "blocking")
    .map((item) => normalizeLoopDebateIdentifier(item.id, "unknown-disagreement"));
}

function normalizeLoopDebateNeedsReviewReasons(value: readonly string[] | null | undefined): string[] {
  return Array.isArray(value)
    ? value.map((reason) => String(reason).trim()).filter(Boolean)
    : [];
}

function normalizeLoopDebateEstimatedRemainingRounds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLoopDebateRoundNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : DEFAULT_LOOP_DEBATE_ROUND;
}

function normalizeLoopDebateBaseDir(value: string): string {
  const normalized = String(value ?? "").trim();
  return normalized.replace(/[\\/]+$/, "") || ".";
}

function normalizeLoopDebateIdentifier(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeLoopDebatePathSegment(value: string, fallback: string): string {
  return sanitizePathSegment(normalizeLoopDebateIdentifier(value, fallback), fallback);
}

function classifyLoopDebateChatSection(heading: string, body: string): LoopDebateChatSegment {
  const metadataActorId = extractLoopGroupChatMetadataValue(body, ["成员 ID", "参与者 ID", "子任务 ID"]);
  const metadataDialogueTurn = extractLoopGroupChatDialogueTurn(body);
  if (heading === "补充需求") {
    return {
      kind: "user-message",
      heading,
      body: normalizeLoopSupplementalRequirementBody(body),
      actorId: "user",
    };
  }

  const mainTurn = heading.match(/^主任务发言：第\s+(\d+)\s+轮(?:（(.+?)）)?$/u);
  if (mainTurn) {
    return {
      kind: "main-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLoopDebateRoundNumber(mainTurn[1]),
      actorTitle: "主任务",
      actorId: mainTurn[2]?.trim() || "main",
    };
  }

  const mainTurnWithDisplayName = heading.match(/^主任务发言：第\s+(\d+)\s+轮【(.+?)】$/u);
  if (mainTurnWithDisplayName) {
    return {
      kind: "main-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLoopDebateRoundNumber(mainTurnWithDisplayName[1]),
      actorTitle: mainTurnWithDisplayName[2]?.trim() || "主任务",
      actorId: metadataActorId || "main",
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

  const subtaskJoinedWithDisplayName = heading.match(/^子任务加入：【(.+?)】$/u);
  if (subtaskJoinedWithDisplayName) {
    const actorTitle = subtaskJoinedWithDisplayName[1]?.trim();
    return {
      kind: "subtask-joined",
      heading,
      body,
      actorTitle,
      actorId: metadataActorId || actorTitle,
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

  const subtaskTurnWithDisplayName = heading.match(/^子任务发言：【(.+?)】$/u);
  if (subtaskTurnWithDisplayName) {
    const actorTitle = subtaskTurnWithDisplayName[1]?.trim();
    return {
      kind: "subtask-turn",
      heading,
      body,
      actorTitle,
      actorId: metadataActorId || actorTitle,
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

  const participantJoinedWithDisplayName = heading.match(/^参与者加入：【(.+?)】$/u);
  if (participantJoinedWithDisplayName) {
    const actorTitle = participantJoinedWithDisplayName[1]?.trim();
    return {
      kind: "participant-joined",
      heading,
      body,
      actorTitle,
      actorId: metadataActorId || actorTitle,
    };
  }

  const participantTurn = heading.match(/^第\s+(\d+)\s+轮发言：(.+?)（(.+?)）$/u);
  if (participantTurn) {
    return {
      kind: "participant-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLoopDebateRoundNumber(participantTurn[1]),
      actorTitle: participantTurn[2]?.trim(),
      actorId: participantTurn[3]?.trim(),
    };
  }

  const participantTurnWithRoundAndDisplayName = heading.match(/^第\s+(\d+)\s+轮发言：【(.+?)】$/u);
  if (participantTurnWithRoundAndDisplayName) {
    const actorTitle = participantTurnWithRoundAndDisplayName[2]?.trim();
    return {
      kind: "participant-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLoopDebateRoundNumber(participantTurnWithRoundAndDisplayName[1]),
      actorTitle,
      actorId: metadataActorId || actorTitle,
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

  const participantTurnWithoutRoundWithDisplayName = heading.match(/^发言：【(.+?)】$/u);
  if (participantTurnWithoutRoundWithDisplayName) {
    const actorTitle = participantTurnWithoutRoundWithDisplayName[1]?.trim();
    return {
      kind: "participant-turn",
      heading,
      body,
      dialogueTurn: metadataDialogueTurn,
      actorTitle,
      actorId: metadataActorId || actorTitle,
    };
  }

  const moderatorTurn = heading.match(/^第\s+(\d+)\s+轮主持人控场(?:（(.+?)）)?$/u);
  if (moderatorTurn) {
    return {
      kind: "moderator-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLoopDebateRoundNumber(moderatorTurn[1]),
      actorTitle: moderatorTurn[2]?.trim() || LOOP_DEBATE_MODERATOR_TITLE,
      actorId: LOOP_DEBATE_MODERATOR_ID,
    };
  }

  const moderatorTurnWithRoundAndDisplayName = heading.match(/^第\s+(\d+)\s+轮主持人控场：?【(.+?)】$/u);
  if (moderatorTurnWithRoundAndDisplayName) {
    return {
      kind: "moderator-turn",
      heading,
      body,
      dialogueTurn: normalizeOptionalLoopDebateRoundNumber(moderatorTurnWithRoundAndDisplayName[1]),
      actorTitle: moderatorTurnWithRoundAndDisplayName[2]?.trim() || LOOP_DEBATE_MODERATOR_TITLE,
      actorId: metadataActorId || LOOP_DEBATE_MODERATOR_ID,
    };
  }

  const moderatorTurnWithoutRound = heading.match(/^主持人控场(?:（(.+?)）)?$/u);
  if (moderatorTurnWithoutRound) {
    return {
      kind: "moderator-turn",
      heading,
      body,
      actorTitle: moderatorTurnWithoutRound[1]?.trim() || LOOP_DEBATE_MODERATOR_TITLE,
      actorId: LOOP_DEBATE_MODERATOR_ID,
    };
  }

  const moderatorTurnWithoutRoundWithDisplayName = heading.match(/^主持人控场：?【(.+?)】$/u);
  if (moderatorTurnWithoutRoundWithDisplayName) {
    return {
      kind: "moderator-turn",
      heading,
      body,
      dialogueTurn: metadataDialogueTurn,
      actorTitle: moderatorTurnWithoutRoundWithDisplayName[1]?.trim() || LOOP_DEBATE_MODERATOR_TITLE,
      actorId: metadataActorId || LOOP_DEBATE_MODERATOR_ID,
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

  const finalStanceWithDisplayName = heading.match(/^最终立场：【(.+?)】$/u);
  if (finalStanceWithDisplayName) {
    const actorTitle = finalStanceWithDisplayName[1]?.trim();
    return {
      kind: "final-stance",
      heading,
      body,
      actorTitle,
      actorId: metadataActorId || actorTitle,
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
      actorId: LOOP_DEBATE_MODERATOR_ID,
      actorTitle: LOOP_DEBATE_MODERATOR_TITLE,
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
      actorId: LOOP_DEBATE_MODERATOR_ID,
      actorTitle: LOOP_DEBATE_MODERATOR_TITLE,
    };
  }
  if (heading === "群聊收束") {
    return {
      kind: "closed",
      heading,
      body,
      actorId: LOOP_DEBATE_MODERATOR_ID,
      actorTitle: LOOP_DEBATE_MODERATOR_TITLE,
    };
  }
  if (heading === "主持人停止说明") {
    return {
      kind: "error",
      heading,
      body,
      actorId: LOOP_DEBATE_MODERATOR_ID,
      actorTitle: LOOP_DEBATE_MODERATOR_TITLE,
    };
  }
  return { kind: "section", heading, body };
}

function isLoopDebateChatBoundaryHeading(heading: string): boolean {
  return heading === "群聊规则"
    || heading === "任务事件"
    || heading === "补充需求"
    || heading === "运行时强制收束"
    || heading === "任务成功完成"
    || heading === "任务中断"
    || heading === "群聊收束"
    || heading === "主持人停止说明"
    || /^主任务发言：第\s+\d+\s+轮(?:（.+?）)?$/u.test(heading)
    || /^主任务发言：第\s+\d+\s+轮【.+?】$/u.test(heading)
    || /^子任务加入：.+?（.+?）$/u.test(heading)
    || /^子任务加入：【.+?】$/u.test(heading)
    || /^子任务发言：.+?（.+?）$/u.test(heading)
    || /^子任务发言：【.+?】$/u.test(heading)
    || /^参与者加入：.+?（.+?）$/u.test(heading)
    || /^参与者加入：【.+?】$/u.test(heading)
    || /^第\s+\d+\s+轮发言：.+?（.+?）$/u.test(heading)
    || /^第\s+\d+\s+轮发言：【.+?】$/u.test(heading)
    || /^发言：.+?（.+?）$/u.test(heading)
    || /^发言：【.+?】$/u.test(heading)
    || /^第\s+\d+\s+轮主持人控场(?:（.+?）)?$/u.test(heading)
    || /^第\s+\d+\s+轮主持人控场：?【.+?】$/u.test(heading)
    || /^主持人控场(?:（.+?）)?$/u.test(heading)
    || /^主持人控场：?【.+?】$/u.test(heading)
    || /^最终立场：.+?（.+?）$/u.test(heading)
    || /^最终立场：【.+?】$/u.test(heading);
}

function normalizeLoopDebateChatBody(lines: string[]): string {
  return lines.join("\n").replace(/^\s+|\s+$/g, "");
}

function normalizeLoopSupplementalRequirementBody(body: string): string {
  const lines = body.split("\n");
  while (/^-\s*(?:时间|主任务轮次)：/u.test(lines[0] ?? "")) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

function normalizeLoopMainSubAssistantContent(content: unknown): string {
  return String(content ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeOptionalLoopDebateRoundNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.trunc(numeric);
}

function extractLoopGroupChatMetadataValue(body: string, labels: readonly string[]): string | undefined {
  const normalizedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const labelPattern = normalizedLabels.join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*-?\\s*(?:${labelPattern})\\s*[：:]\\s*(.+?)\\s*(?:\\n|$)`, "u");
  const match = body.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function extractLoopGroupChatDialogueTurn(body: string): number | undefined {
  const match = body.match(/(?:^|\n)\s*-?\s*群聊发言批次\s*[：:]\s*(\d+)(?:\s*\/\s*\d+)?\s*(?:\n|$)/u);
  return normalizeOptionalLoopDebateRoundNumber(match?.[1]);
}

function joinLoopDebatePath(baseDir: string, ...segments: string[]): string {
  const separator = getLoopDebatePathSeparator(baseDir);
  const normalizedBase = baseDir.replace(/[\\/]+$/, "") || ".";
  const normalizedSegments = segments
    .map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean);
  return [normalizedBase, ...normalizedSegments].join(separator);
}

function getLoopDebatePathSeparator(filePath: string): "/" | "\\" {
  return filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
