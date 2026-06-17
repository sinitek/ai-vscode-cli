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
export const LOBSTER_DEBATE_MODERATOR_ID = "moderator";
export const LOBSTER_DEBATE_MODERATOR_TITLE = "主持人控场";

export const LOBSTER_DEBATE_PARTICIPANT_ROLES = [
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
  if (heading === "群聊收束") {
    return {
      kind: "closed",
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
    || heading === "群聊收束"
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
