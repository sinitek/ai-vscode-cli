export const HISTORY_RETENTION_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * ONE_DAY_MS;

export function getHistoryRetentionCutoff(now: number = Date.now()): number {
  return now - HISTORY_RETENTION_MS;
}

export function isTimestampWithinHistoryRetention(
  timestamp: number,
  now: number = Date.now()
): boolean {
  return Number.isFinite(timestamp) && timestamp >= getHistoryRetentionCutoff(now);
}
