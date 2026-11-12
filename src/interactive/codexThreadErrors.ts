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
