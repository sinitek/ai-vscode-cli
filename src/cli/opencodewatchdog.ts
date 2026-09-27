export const OPENCODE_ONE_SHOT_STARTUP_TIMEOUT_MS = 60 * 1000;

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OPENCODE_INTERNAL_LOG_LINE_PATTERN =
  /^timestamp=\d{4}-\d{2}-\d{2}T\S+\s+level=(?:DEBUG|INFO|WARN|ERROR)\b/u;

export function resolveOpenCodeOneShotWatchdogTimeoutMs(hasActivity: boolean): number | null {
  return hasActivity ? null : OPENCODE_ONE_SHOT_STARTUP_TIMEOUT_MS;
}

/**
 * OpenCode 1.18 writes `--print-logs` lines to stderr before any `--format json`
 * event. They prove the process is alive, but they are not a provider error.
 */
export function isOpenCodeInternalLogLine(line: string): boolean {
  const cleaned = line.replace(ANSI_ESCAPE_PATTERN, "").trim();
  return OPENCODE_INTERNAL_LOG_LINE_PATTERN.test(cleaned);
}
