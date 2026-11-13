import { buildLoopGroupChatFinalStatusSection, buildLoopMainSubChatTranscriptFile, buildLoopMainSubSubtaskTurnBody, formatLoopGroupChatMemberName, LOOP_MAIN_SUB_CHAT_ROUND_KEY, latestLoopGroupChatSubtaskStartedAt, resolveLoopTaskRunControlState } from "./loopGroupChat";
import { getLoopMainSubChatMainTitle, getLoopSubtaskDisplayTitle } from "./loopConversationPresentation";
import { normalizeLoopProgressPercent, type LoopRoundRecord, type LoopTaskRecord } from "./loopTaskStore";
import { type LoopPlusPanelProjection } from "./webview/loopGroupChatPanelTypes";
import { projectLoopPlusPanel } from "./loopPlusPanelProjection";
import type { LoopGroupChatPanelRound, LoopGroupChatPanelState } from "./webview/loopGroupChatPanelTypes";

export type LoopGroupChatPanelStateBuilderDeps = {
  collectRunningLoopTaskIds: () => ReadonlySet<string>;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  fileExists: (filePath: string) => boolean;
  writeTextFileEnsuringDir: (filePath: string, content: string) => boolean;
  getActiveLoopSubtaskIds: (task: LoopTaskRecord) => string[];
  buildLoopCompletedConclusionAndSummaryMarkdown: (task: LoopTaskRecord) => string;
  t: (key: any, params?: any) => string;
};

export function buildLoopGroupChatPanelStateWithDeps(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelStateBuilderDeps,
): LoopGroupChatPanelState {
  const runningTaskIds = deps.collectRunningLoopTaskIds();
  const controlState = resolveLoopTaskRunControlState(task, runningTaskIds);
  const loopPlus = projectLoopPlusPanel(task);
  const rounds = buildLoopMainSubChatPanelRounds(task, deps, loopPlus);
  const chatMarkdown = buildLoopCombinedGroupChatMarkdown(task, rounds, deps);
  const missingChatFiles = rounds
    .map((round) => round.chatFile)
    .filter((filePath): filePath is string => Boolean(filePath && !deps.readTextFileIfNonEmpty(filePath)));
  const error = missingChatFiles.length > 0 && !chatMarkdown.trim()
    ? deps.t("loopGroupChatChat.transcriptMissing", { path: missingChatFiles[0] ?? "" })
    : null;
  return {
    ...(loopPlus ? { loopPlus } : {}),
    task: {
      id: task.id,
      cli: task.cli,
      status: task.status,
      rootPrompt: task.rootPrompt,
      progressPercent: resolveLoopPanelProgressPercent(task, loopPlus),
      taskStoreFile: task.taskStoreFile,
      mainCommunicationFile: task.mainCommunicationFile,
      currentRound: task.currentRound,
      updatedAt: task.updatedAt,
      canSupplement: controlState.canSupplement,
      canContinue: controlState.canContinue,
      canStop: controlState.canStop,
    },
    rounds,
    chatMarkdown,
    error,
    ...(task.pendingClarification ? { clarification: task.pendingClarification } : {}),
  };
}

function buildLoopCombinedGroupChatMarkdown(
  task: LoopTaskRecord,
  rounds: LoopGroupChatPanelRound[],
  deps: LoopGroupChatPanelStateBuilderDeps,
): string {
  const content = rounds[0]?.chatFile ? deps.readTextFileIfNonEmpty(rounds[0].chatFile) : null;
  return content
    ? appendLoopGroupChatFinalStatusMarkdown(content, task)
    : renderLoopGroupChatFinalStatusMarkdown(task);
}

function renderLoopGroupChatFinalStatusMarkdown(task: LoopTaskRecord): string {
  const finalStatusSection = buildLoopGroupChatFinalStatusSection(task);
  if (!finalStatusSection) {
    return "";
  }
  return `## ${finalStatusSection.heading}\n${finalStatusSection.body}\n`;
}

function appendLoopGroupChatFinalStatusMarkdown(markdown: string, task: LoopTaskRecord): string {
  const finalStatusSection = buildLoopGroupChatFinalStatusSection(task);
  if (!finalStatusSection) {
    return markdown;
  }
  if (hasLoopGroupChatFinalStatusSection(markdown, finalStatusSection.heading)) {
    return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  }
  const prefix = markdown.trimEnd();
  const section = `## ${finalStatusSection.heading}\n${finalStatusSection.body}`;
  return prefix ? `${prefix}\n\n${section}\n` : `${section}\n`;
}

function hasLoopGroupChatFinalStatusSection(markdown: string, heading: string): boolean {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)##\\s+${escapedHeading}\\s*(?:\\n|$)`, "u").test(markdown);
}

function buildLoopMainSubChatPanelRounds(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelStateBuilderDeps,
  loopPlus: LoopPlusPanelProjection | null,
): LoopGroupChatPanelRound[] {
  return [buildLoopMainSubChatPanelRound(task, loopPlus ? "Loop+ 群聊" : "主从群聊", deps, loopPlus)];
}

function latestLoopMemberStartedAt(
  task: LoopTaskRecord,
  role: "main" | "subtask",
  subtaskId?: string,
): number | undefined {
  let latest: number | undefined;
  for (const round of task.rounds) {
    if (round.role !== role) {
      continue;
    }
    if (role === "subtask" && round.subtaskId !== subtaskId) {
      continue;
    }
    if (typeof round.startedAt !== "number" || !Number.isFinite(round.startedAt)) {
      continue;
    }
    latest = latest === undefined ? round.startedAt : Math.max(latest, round.startedAt);
  }
  return latest;
}

function resolveLoopMemberLastStartedAt(
  task: LoopTaskRecord,
  role: "main" | "subtask",
  status: string,
  updatedAt: number | undefined,
  subtaskId?: string,
  chatStartedAt?: number,
): number | null {
  if (role === "subtask") {
    const subtask = subtaskId ? task.subTasks.find((item) => item.id === subtaskId) : undefined;
    if (typeof subtask?.lastStartedAt === "number" && Number.isFinite(subtask.lastStartedAt)) {
      return subtask.lastStartedAt;
    }
    const recorded = latestLoopMemberStartedAt(task, "subtask", subtaskId);
    if (typeof recorded === "number") {
      return recorded;
    }
    return typeof chatStartedAt === "number" && Number.isFinite(chatStartedAt) ? chatStartedAt : null;
  }
  const recorded = latestLoopMemberStartedAt(task, role, subtaskId);
  if (status === "pending" || status === "skipped") {
    return recorded ?? null;
  }
  if (typeof recorded === "number") {
    if (
      status === "running"
      && typeof updatedAt === "number"
      && Number.isFinite(updatedAt)
      && updatedAt > recorded
    ) {
      return updatedAt;
    }
    return recorded;
  }
  return typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : null;
}

function resolveLoopPanelProgressPercent(task: LoopTaskRecord, loopPlus?: LoopPlusPanelProjection | null): number {
  const completed = loopPlus ? loopPlus.ok && loopPlus.phase === "completed" : task.status === "completed";
  const storedProgress = loopPlus ? task.loopPlusProgressPercent : task.loopProgressPercent;
  return completed ? 100 : Math.min(normalizeLoopProgressPercent(storedProgress) ?? 0, 99);
}

function buildLoopMainSubChatPanelRound(
  task: LoopTaskRecord,
  label: string,
  deps: LoopGroupChatPanelStateBuilderDeps,
  loopPlus: LoopPlusPanelProjection | null = null,
): LoopGroupChatPanelRound {
  const chatFile = ensureLoopMainSubChatTranscriptWithDeps(task, deps);
  const joinedAtBySubtaskId = readLoopSubtaskJoinedStartedAt(chatFile, deps);
  if (loopPlus) {
    const progressPercent = resolveLoopPanelProgressPercent(task, loopPlus);
    const mainTitle = `${getLoopMainSubChatMainTitle()} ${progressPercent}%`;
    return {
      key: LOOP_MAIN_SUB_CHAT_ROUND_KEY,
      kind: "execution",
      label,
      loopRound: Math.max(1, task.currentRound || 1),
      status: loopPlus.ok ? loopPlus.phase : "invalid",
      chatFile,
      startedAt: task.createdAt,
      completedAt: loopPlus.ok && loopPlus.phase === "completed" ? task.updatedAt : undefined,
      participants: [
        {
          id: "main",
          title: mainTitle,
          role: "main",
          status: loopPlusMemberStatus(loopPlus, "main", "main", task.status),
          sessionId: task.sessionId ?? null,
          summary: task.finalSummary,
          updatedAt: task.updatedAt,
          lastStartedAt: resolveLoopMemberLastStartedAt(
            task,
            "main",
            loopPlusMemberStatus(loopPlus, "main", "main", task.status),
            task.updatedAt,
          ),
        },
        ...task.subTasks.map((subtask, index) => ({
          id: subtask.id,
          title: getLoopSubtaskDisplayTitle(index, subtask),
          role: "subtask",
          status: loopPlusMemberStatus(loopPlus, "subtask", subtask.id, subtask.status),
          sessionId: null,
          summary: subtask.summary,
          updatedAt: subtask.updatedAt,
          lastStartedAt: resolveLoopMemberLastStartedAt(
            task,
            "subtask",
            loopPlusMemberStatus(loopPlus, "subtask", subtask.id, subtask.status),
            subtask.updatedAt,
            subtask.id,
            joinedAtBySubtaskId.get(subtask.id),
          ),
        })),
      ],
    };
  }
  const activeSubtaskIds = deps.getActiveLoopSubtaskIds(task);
  const mainRunning = task.status === "running" && activeSubtaskIds.length === 0;
  const mainTitle = `${getLoopMainSubChatMainTitle()} ${resolveLoopPanelProgressPercent(task)}%`;
  const mainStatus = mainRunning ? "running" : task.status;
  const mainParticipant: LoopGroupChatPanelRound["participants"][number] = {
    id: "main",
    title: mainTitle,
    role: "main",
    status: mainStatus,
    sessionId: task.sessionId ?? null,
    summary: task.finalSummary,
    updatedAt: task.updatedAt,
    lastStartedAt: resolveLoopMemberLastStartedAt(task, "main", mainStatus, task.updatedAt),
  };
  const subtaskParticipants = task.subTasks.map((subtask, index) => ({
    id: subtask.id,
    title: getLoopSubtaskDisplayTitle(index, subtask),
    role: "subtask",
    status: subtask.status,
    sessionId: null,
    summary: subtask.summary,
    updatedAt: subtask.updatedAt,
    lastStartedAt: resolveLoopMemberLastStartedAt(
      task,
      "subtask",
      subtask.status,
      subtask.updatedAt,
      subtask.id,
      joinedAtBySubtaskId.get(subtask.id),
    ),
  }));
  return {
    key: LOOP_MAIN_SUB_CHAT_ROUND_KEY,
    kind: "execution",
    label,
    loopRound: Math.max(1, task.currentRound || 1),
    status: task.status,
    chatFile,
    activeSpeaker: buildLoopMainSubChatActiveSpeaker(task, deps),
    startedAt: task.createdAt,
    completedAt: task.status === "completed" ? task.updatedAt : undefined,
    participants: [mainParticipant, ...subtaskParticipants],
  };
}

function readLoopSubtaskJoinedStartedAt(
  chatFile: string,
  deps: LoopGroupChatPanelStateBuilderDeps,
): ReadonlyMap<string, number> {
  if (!chatFile || !deps.fileExists(chatFile)) {
    return new Map();
  }
  const content = deps.readTextFileIfNonEmpty(chatFile);
  return content ? latestLoopGroupChatSubtaskStartedAt(content) : new Map();
}

function buildLoopMainSubChatActiveSpeaker(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelStateBuilderDeps,
): LoopGroupChatPanelRound["activeSpeaker"] {
  if (task.status !== "running") {
    return undefined;
  }
  const activeSubtaskIds = deps.getActiveLoopSubtaskIds(task);
  const activeSubtask = task.subTasks.find((subtask) => (
    activeSubtaskIds.includes(subtask.id)
    && subtask.status === "running"
  ));
  if (activeSubtask) {
    const index = task.subTasks.findIndex((subtask) => subtask.id === activeSubtask.id);
    return {
      kind: "subtask",
      id: activeSubtask.id,
      title: getLoopSubtaskDisplayTitle(index, activeSubtask),
      updatedAt: activeSubtask.updatedAt ?? task.updatedAt,
    };
  }
  if (activeSubtaskIds.length === 0) {
    return {
      kind: "main",
      id: "main",
      title: getLoopMainSubChatMainTitle(),
      updatedAt: task.updatedAt,
    };
  }
  return undefined;
}

function loopPlusMemberStatus(
  projection: LoopPlusPanelProjection,
  kind: "main" | "subtask",
  subtaskId: string,
  recordedStatus: string,
): string {
  if (!projection.ok) {
    return "invalid";
  }
  if (kind === "main") {
    switch (projection.activity) {
      case "waiting":
        return "waiting";
      case "review_pending":
        return "review_pending";
      case "reviewing":
        return "reviewing";
      case "paused":
        return "paused";
      case "stopped":
        return "stopped";
      case "completed":
        return "completed";
      case "idle":
        return "idle";
      case "decomposing":
        return "decomposing";
    }
  }
  if (projection.currentReview?.subtaskId === subtaskId) {
    return projection.activity === "reviewing" ? "reviewing" : "held_review";
  }
  if (projection.reviewQueue.some((item) => item.subtaskId === subtaskId)) {
    return projection.activity === "reviewing" ? "reviewing" : "queued_review";
  }
  const running = projection.running.find((item) => item.subtaskId === subtaskId);
  if (running) {
    return running.interrupted ? "waiting_continuation" : "running";
  }
  if (projection.pending.some((item) => item.subtaskId === subtaskId)) {
    return "pending";
  }
  const attemptsForSubtask = projection.seenAttempts.filter((item) => item.subtaskId === subtaskId);
  const latestAttempt = attemptsForSubtask[attemptsForSubtask.length - 1];
  if (latestAttempt?.disposition === "closed") {
    return "stopped";
  }
  const reviewed = attemptsForSubtask.filter((item) => item.disposition === "reviewed");
  const latestReviewed = reviewed[reviewed.length - 1];
  if (latestReviewed) {
    return latestReviewed.acceptance === "failed" ? "acceptance_failed" : "acceptance_passed";
  }
  if (recordedStatus === "completed") {
    return "execution_completed";
  }
  if (recordedStatus === "blocked" || recordedStatus === "skipped") {
    return "stopped";
  }
  return "not_in_snapshot";
}

export function ensureLoopMainSubChatTranscriptWithDeps(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelStateBuilderDeps,
): string {
  const chatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
  if (deps.fileExists(chatFile)) {
    return chatFile;
  }
  deps.writeTextFileEnsuringDir(chatFile, buildInitialLoopMainSubChatTranscript(task, deps));
  return chatFile;
}

function buildInitialLoopMainSubChatTranscript(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelStateBuilderDeps,
): string {
  const mainTitle = getLoopMainSubChatMainTitle();
  const lines: string[] = [
    "# Loop 主从群聊记录",
    "",
    `- 任务 ID：${task.id}`,
    `- CLI：${task.cli}`,
    `- 任务状态：${task.status}`,
    `- 创建时间：${new Date(task.createdAt).toISOString()}`,
    `- 任务记录：${task.taskStoreFile}`,
    `- 主任务沟通文件：${task.mainCommunicationFile}`,
    "",
    "## 群聊规则",
    "- 主任务负责拆分、派发、复核。",
    "- 子任务会在派发和执行时动态加入群聊，并以“子任务 1~N”标记。",
    "- 本页面只读，真实执行仍以任务记录、主任务沟通文件和子任务沟通文件为准。",
    "",
    "## 任务事件",
    `Loop 主从任务已创建。当前轮次：${task.currentRound || 0}。`,
  ];

  task.rounds
    .slice()
    .sort((left, right) => left.startedAt - right.startedAt)
    .forEach((round) => {
      if (round.role === "main") {
        lines.push(
          "",
          `## 主任务发言：第 ${round.round} 轮${formatLoopGroupChatMemberName(mainTitle)}`,
          ["- 成员 ID：main", "", formatLoopRoundRecordForChat(round)].join("\n"),
        );
        return;
      }
      const subtask = task.subTasks.find((item) => item.id === round.subtaskId);
      const index = subtask ? task.subTasks.findIndex((item) => item.id === subtask.id) : -1;
      const title = subtask ? getLoopSubtaskDisplayTitle(index, subtask) : `子任务 ${round.subtaskId ?? "unknown"}`;
      lines.push(
        "",
        `## 子任务发言：${formatLoopGroupChatMemberName(title)}`,
        [
          `- 成员 ID：${round.subtaskId ?? "unknown"}`,
          "",
          buildLoopMainSubSubtaskTurnBody({
            runStatus: round.status,
            assistantContent: subtask?.summary,
            communicationFile: subtask?.communicationFile,
          }),
        ].join("\n"),
      );
    });

  if (task.status === "completed") {
    lines.push("", "## 群聊收束", deps.buildLoopCompletedConclusionAndSummaryMarkdown(task));
  }
  return `${lines.join("\n")}\n`;
}

function formatLoopRoundRecordForChat(round: LoopRoundRecord): string {
  return [
    `- 状态：${round.status}`,
    `- 开始：${new Date(round.startedAt).toISOString()}`,
    `- 结束：${new Date(round.endedAt).toISOString()}`,
    round.summary ? `- 摘要：${round.summary}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

