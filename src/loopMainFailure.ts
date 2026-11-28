export const RUNTIME_CONFIG_LOCK_TIMEOUT = "RUNTIME_CONFIG_LOCK_TIMEOUT";
export const RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE = "等待其他窗口配置操作超时，任务未启动，请稍后重试。";

export const LOOP_MAIN_AI_FAILURE_LIMIT = 5;

const loopPlusMainFailureMessages = {
  LOOP_PLUS_IDENTITY_BUSY: "等待任务身份目录解除占用已超时，请在其他窗口写入结束后继续。",
  LOOP_PLUS_PARENT_UNAVAILABLE: "无法确认主任务的执行归属，请核对原任务和会话后继续。",
  LOOP_PLUS_RUN_NOT_STARTED: "主任务在启动前退出，请检查原标签和会话状态后继续。",
  LOOP_PLUS_RUN_UNCONFIRMED: "缺少本次主调用的终态记录，请核对原会话中的执行结果后继续。",
  LOOP_PLUS_FINAL_UNCONFIRMED: "主调用已结束，无法确认本轮助手的最终回复。请核对原会话后继续。",
} as const;

type LoopPlusMainFailureCode = keyof typeof loopPlusMainFailureMessages;
export const LOOP_PLUS_MAIN_FAILURE_CODES = Object.keys(loopPlusMainFailureMessages) as LoopPlusMainFailureCode[];

export function loopPlusMainFailure(code: LoopPlusMainFailureCode): Error & { code: LoopPlusMainFailureCode } {
  return Object.assign(new Error(loopPlusMainFailureMessages[code]), { code });
}

export function isLoopPlusMainFailureCode(code: string | undefined): code is LoopPlusMainFailureCode {
  return Object.prototype.hasOwnProperty.call(loopPlusMainFailureMessages, code ?? "");
}

export type LoopMainAiFailureState = {
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
  mainAiLastFailureAt?: number;
  mainAiLastFailureMessage?: string;
  mainAiLastFailureCode?: string | null;
};

export function isLoopMainStartupConfigLockTimeout(state: LoopMainAiFailureState): boolean {
  return state.mainAiLastFailureCode === undefined
    ? state.mainAiLastFailureMessage === RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE
    : state.mainAiLastFailureCode === RUNTIME_CONFIG_LOCK_TIMEOUT;
}

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
