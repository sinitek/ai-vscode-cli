export const CODEX_THREAD_BUSY = "CODEX_THREAD_BUSY";
export const CODEX_THREAD_HANDOFF_FAILED = "CODEX_THREAD_HANDOFF_FAILED";
export const CODEX_THREAD_WRITER_CONFLICT = "CODEX_THREAD_WRITER_CONFLICT";

export function isCodexActiveWriterMessage(message: string): boolean {
  return /\balready has an active writer\b/i.test(message);
}

export function createCodexThreadError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function isNonRetryableCodexThreadError(code: string | undefined, message: string): boolean {
  return code === CODEX_THREAD_BUSY
    || code === CODEX_THREAD_HANDOFF_FAILED
    || code === CODEX_THREAD_WRITER_CONFLICT
    || isCodexActiveWriterMessage(message);
}

export type CodexHandoffStage = "waiting_load" | "requesting_unload" | "waiting_close" | "waiting_exit";
export type CodexHandoffReason = "protocol_unsupported" | "unload_failed" | "invalid_response" | "timeout";
export type CodexHandoffDiagnostic = {
  connectionId: number;
  threadId: string;
  stage: CodexHandoffStage;
  reason: CodexHandoffReason;
  rpcMethod: "thread/unsubscribe";
  rpcCode?: number | string;
  causeSummary?: string;
};

export function createCodexHandoffError(diagnostic: CodexHandoffDiagnostic): Error & {
  code: string; diagnostic: CodexHandoffDiagnostic;
} {
  const stageText: Record<CodexHandoffStage, string> = {
    waiting_load: "仍在等待旧连接完成会话加载",
    requesting_unload: "会话卸载请求尚未返回",
    waiting_close: "已请求卸载，仍在等待会话关闭确认",
    waiting_exit: "旧连接已关闭，仍在等待进程实际退出",
  };
  const detail = diagnostic.reason === "protocol_unsupported" ? "旧 Codex 明确不支持会话卸载协议"
    : diagnostic.reason === "unload_failed" ? "会话卸载请求失败"
    : diagnostic.reason === "invalid_response" ? "会话卸载响应格式无效"
    : stageText[diagnostic.stage];
  return Object.assign(createCodexThreadError(CODEX_THREAD_HANDOFF_FAILED,
    `Codex 会话交接失败：${detail}。已停止恢复以避免写入冲突；不会自动重试或终止其它会话。`), { diagnostic });
}
