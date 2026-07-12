export const OPENCODE_ONE_SHOT_STARTUP_TIMEOUT_MS = 60 * 1000;

export function resolveOpenCodeOneShotWatchdogTimeoutMs(hasActivity: boolean): number | null {
  return hasActivity ? null : OPENCODE_ONE_SHOT_STARTUP_TIMEOUT_MS;
}
