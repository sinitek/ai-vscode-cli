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
