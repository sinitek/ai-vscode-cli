import { readToolSettings, HISTORY_RETENTION_DAYS_DEFAULT } from "./toolSettings";

/** Backwards-compatible default used by callers that only need the default value. */
export const HISTORY_RETENTION_DAYS = HISTORY_RETENTION_DAYS_DEFAULT;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function getHistoryRetentionDays(): number {
  const configured = readToolSettings().historyRetentionDays;
  return typeof configured === "number" && Number.isFinite(configured)
    ? configured
    : HISTORY_RETENTION_DAYS_DEFAULT;
}

export function getHistoryRetentionMs(): number {
  return getHistoryRetentionDays() * ONE_DAY_MS;
}

/** @deprecated Prefer getHistoryRetentionMs() for the dynamic global setting. */
export const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * ONE_DAY_MS;

export function getHistoryRetentionCutoff(now: number = Date.now()): number {
  return now - getHistoryRetentionMs();
}

export function isTimestampWithinHistoryRetention(
  timestamp: number,
  now: number = Date.now()
): boolean {
  return Number.isFinite(timestamp) && timestamp >= getHistoryRetentionCutoff(now);
}
