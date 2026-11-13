export const LOOP_MAIN_AI_FAILURE_LIMIT = 5;

export type LoopMainAiFailureState = {
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
  mainAiLastFailureAt?: number;
  mainAiLastFailureMessage?: string;
};

export function buildLoopMainAiFailureSummary(
  state: LoopMainAiFailureState,
  options: { nonRetryable?: boolean; code?: string } = {},
): string {
  const count = normalizeLoopMainAiFailureCount(state.mainAiFailureCount);
  return [
    "### 当前结论",
    "主任务执行调用失败，整体任务尚未完成；这不等于模型服务故障。",
    "",
    "### 暂停原因与未完成事项",
    options.nonRetryable
      ? `当前错误禁止自动重试，已在第 ${count} 次失败后停止自动调度。`
      : `主任务 AI 调用已连续失败 ${count}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`,
    ...(options.code ? [`错误码：${options.code}`] : []),
    state.mainAiLastFailureMessage?.trim() || "未记录具体错误，请核对插件运行日志。",
    "主任务的后续复核与收口尚未完成；已有子任务结果保留，不视为整体成功。",
    "",
    "### 如何继续",
    "先解决上述运行错误。若涉及会话交接，须确认旧操作已结束、原会话已释放；不要删锁、强制接管或终止其它会话。",
    "条件满足后在群聊点击“继续执行”，由主模型继续复核。重复点击不会消除错误，也不会绕过安全门槛。",
  ].join("\n");
}

export function normalizeLoopMainAiFailureCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function isLoopMainAiFailureLimitReached(
  state: Pick<LoopMainAiFailureState, "mainAiFailureCount" | "mainAiFailureLimitReached">,
): boolean {
  return Boolean(state.mainAiFailureLimitReached)
    || normalizeLoopMainAiFailureCount(state.mainAiFailureCount) >= LOOP_MAIN_AI_FAILURE_LIMIT;
}

export function buildNextLoopMainAiFailureState(
  state: Pick<LoopMainAiFailureState, "mainAiFailureCount">,
  options: { failureMessage?: string | null; now?: number } = {},
): Required<Pick<LoopMainAiFailureState,
  "mainAiFailureCount" | "mainAiFailureLimitReached" | "mainAiLastFailureAt" | "mainAiLastFailureMessage"
>> {
  const nextCount = normalizeLoopMainAiFailureCount(state.mainAiFailureCount) + 1;
  return {
    mainAiFailureCount: nextCount,
    mainAiFailureLimitReached: nextCount >= LOOP_MAIN_AI_FAILURE_LIMIT,
    mainAiLastFailureAt: options.now ?? Date.now(),
    mainAiLastFailureMessage: typeof options.failureMessage === "string" ? options.failureMessage.trim() : "",
  };
}

export function buildResetLoopMainAiFailureState(): Required<Pick<LoopMainAiFailureState,
  "mainAiFailureCount" | "mainAiFailureLimitReached"
>> & Pick<LoopMainAiFailureState, "mainAiLastFailureAt" | "mainAiLastFailureMessage"> {
  return {
    mainAiFailureCount: 0,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: undefined,
    mainAiLastFailureMessage: undefined,
  };
}
