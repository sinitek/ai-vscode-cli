export const LOOP_MAIN_SUB_CHAT_TRANSCRIPT_FILENAME = "group-chat.md";

export const LOOP_MAIN_SUB_CHAT_ROUND_KEY = "main-sub";

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
} from "./loopFinalSummary";

export type LoopGroupChatSegmentKind =
  | "preamble"
  | "rules"
  | "task-event"
  | "user-message"
  | "main-turn"
  | "subtask-joined"
  | "subtask-turn"
  | "closed"
  | "error"
  | "section";

export type LoopGroupChatSegment = {
  kind: LoopGroupChatSegmentKind;
  heading: string;
  body: string;
  dialogueTurn?: number;
  actorId?: string;
  actorTitle?: string;
};

export type LoopGroupChatTranscript = {
  title: string | null;
  segments: LoopGroupChatSegment[];
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
  const isInterrupted = task.status === "needs-review" || task.status === "error" || task.status === "stopped";
  const isRunning = !isInterrupted && (hasRunningProcess || (!isCompleted && task.status === "running"));
  const blockedByFailureLimit = Boolean(task.mainAiFailureLimitReached);
  return {
    isRunning,
    canSupplement: isRunning || (!isCompleted && !blockedByFailureLimit),
    canContinue: !isCompleted && !isRunning && !blockedByFailureLimit,
    canStop: isRunning,
  };
}

export function buildLoopMainSubChatTranscriptFile(communicationDir: string): string {
  return joinLoopGroupChatPath(
    normalizeLoopGroupChatBaseDir(communicationDir),
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

export function buildLoopSubtaskJoinedChatSection(options: {
  subtaskId: string;
  title: string;
  round: number;
  communicationFile?: string | null;
  retryCount?: number;
  timestamp?: string;
}): { heading: string; body: string } {
  const retryCount = options.retryCount ?? 0;
  const communicationFile = normalizeLoopCommunicationFilePath(options.communicationFile);
  const lines = [
    `- 成员 ID：${options.subtaskId}`,
    `- 时间：${options.timestamp ?? new Date().toISOString()}`,
    `- 轮次：${options.round}`,
    retryCount > 0 ? `- 重试：第 ${retryCount} 次` : null,
    `- 状态：running`,
    communicationFile ? `- 沟通文件：${communicationFile}` : null,
  ].filter((line): line is string => Boolean(line));
  return {
    heading: `子任务加入：${formatLoopGroupChatMemberName(options.title)}`,
    body: lines.join("\n"),
  };
}

export function buildLoopSubtaskFinishedChatSection(options: {
  subtaskId: string;
  title: string;
  runStatus: string;
  assistantContent?: string | null;
  communicationFile?: string | null;
  includeCommunicationFile?: boolean;
}): { heading: string; body: string } {
  const communicationFile = normalizeLoopCommunicationFilePath(options.communicationFile);
  const turn = buildLoopMainSubSubtaskTurnBody({
    runStatus: options.runStatus,
    assistantContent: options.assistantContent,
    communicationFile,
  });
  const fileLine = communicationFile ? `- 沟通文件：${communicationFile}` : "";
  const shouldAppendFile = Boolean(
    options.includeCommunicationFile
    && fileLine
    && !turn.split("\n").some((line) => line.trim() === fileLine),
  );
  return {
    heading: `子任务发言：${formatLoopGroupChatMemberName(options.title)}`,
    body: [
      `- 成员 ID：${options.subtaskId}`,
      "",
      turn,
      ...(shouldAppendFile ? ["", fileLine] : []),
    ].join("\n"),
  };
}

function normalizeLoopCommunicationFilePath(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseLoopGroupChatTranscript(content: string): LoopGroupChatTranscript {
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
    if (h2 && (isLoopGroupChatBoundaryHeading(h2[1]?.trim() ?? "") || !current)) {
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

  const segments: LoopGroupChatSegment[] = [];
  const preamble = normalizeLoopGroupChatBody(preambleLines);
  if (preamble) {
    segments.push({
      kind: "preamble",
      heading: title ?? "Transcript",
      body: preamble,
    });
  }

  sections.forEach((section) => {
    const body = normalizeLoopGroupChatBody(section.bodyLines);
    if (!section.heading && !body) {
      return;
    }
    segments.push(classifyLoopGroupChatSection(section.heading, body));
  });

  return {
    title,
    segments,
    closed: segments.some((segment) => segment.kind === "closed"),
  };
}

const LOOP_GROUP_CHAT_STARTED_AT_PATTERN = /(?:^|\n)-\s*时间：\s*([^\s]+)/u;

export function latestLoopGroupChatSubtaskStartedAt(content: string): ReadonlyMap<string, number> {
  const latest = new Map<string, number>();
  for (const segment of parseLoopGroupChatTranscript(content).segments) {
    if (segment.kind !== "subtask-joined") {
      continue;
    }
    const subtaskId = segment.actorId?.trim();
    if (!subtaskId) {
      continue;
    }
    const matched = segment.body.match(LOOP_GROUP_CHAT_STARTED_AT_PATTERN);
    const startedAt = matched?.[1] ? Date.parse(matched[1]) : Number.NaN;
    if (!Number.isFinite(startedAt)) {
      continue;
    }
    const previous = latest.get(subtaskId);
    if (previous === undefined || startedAt >= previous) {
      latest.set(subtaskId, startedAt);
    }
  }
  return latest;
}

function normalizeLoopGroupChatBaseDir(value: string): string {
  const normalized = String(value ?? "").trim();
  return normalized.replace(/[\\/]+$/, "") || ".";
}

function classifyLoopGroupChatSection(heading: string, body: string): LoopGroupChatSegment {
  const metadataActorId = extractLoopGroupChatMetadataValue(body, ["成员 ID", "参与者 ID", "子任务 ID"]);
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
      dialogueTurn: normalizeOptionalLoopGroupChatRoundNumber(mainTurn[1]),
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
      dialogueTurn: normalizeOptionalLoopGroupChatRoundNumber(mainTurnWithDisplayName[1]),
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

  if (heading === "群聊规则") {
    return { kind: "rules", heading, body };
  }
  if (heading === "任务事件") {
    return { kind: "task-event", heading, body };
  }
  if (heading === "验收结果") {
    return {
      kind: "main-turn",
      heading,
      body,
      actorId: "main",
      actorTitle: "主任务",
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
      actorId: "main",
      actorTitle: "主任务",
    };
  }
  if (heading === "群聊收束") {
    return {
      kind: "closed",
      heading,
      body,
      actorId: "main",
      actorTitle: "主任务",
    };
  }
  return { kind: "section", heading, body };
}

function isLoopGroupChatBoundaryHeading(heading: string): boolean {
  return heading === "群聊规则"
    || heading === "任务事件"
    || heading === "补充需求"
    || heading === "任务成功完成"
    || heading === "任务中断"
    || heading === "群聊收束"
    || heading === "验收结果"
    || /^主任务发言：第\s+\d+\s+轮(?:（.+?）)?$/u.test(heading)
    || /^主任务发言：第\s+\d+\s+轮【.+?】$/u.test(heading)
    || /^子任务加入：.+?（.+?）$/u.test(heading)
    || /^子任务加入：【.+?】$/u.test(heading)
    || /^子任务发言：.+?（.+?）$/u.test(heading)
    || /^子任务发言：【.+?】$/u.test(heading);
}

function normalizeLoopGroupChatBody(lines: string[]): string {
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

function normalizeOptionalLoopGroupChatRoundNumber(value: unknown): number | undefined {
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

function joinLoopGroupChatPath(baseDir: string, ...segments: string[]): string {
  const separator = getLoopGroupChatPathSeparator(baseDir);
  const normalizedBase = baseDir.replace(/[\\/]+$/, "") || ".";
  const normalizedSegments = segments
    .map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean);
  return [normalizedBase, ...normalizedSegments].join(separator);
}

function getLoopGroupChatPathSeparator(filePath: string): "/" | "\\" {
  return filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
}
