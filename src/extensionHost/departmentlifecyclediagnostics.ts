import { logEssential } from "../logger";

export type DepartmentLifecycleEvent = "department-root-stop-started" | "department-root-stop-settled"
  | "department-leader-cleanup" | "department-leader-capacity" | "department-employee-capacity" | "department-lifecycle-persistence-failed";
export type DepartmentLifecycleStage = "root-stop" | "runtime-save" | "lifecycle" | "task-idle"
  | "producer-close" | "owner-receipts" | "release-save" | "capacity-release";
export type DepartmentLifecycleReason = "none" | "already-blocked" | "evidence-missing" | "evidence-rejected"
  | "persistence-failed" | "task-still-running" | "identity-changed" | "unexpected-failure";
type Fields = { rootTaskId: string; leaderTaskId?: string; generation?: number;
  stage: DepartmentLifecycleStage; result: "started" | "confirmed" | "unconfirmed" | "released" | "retained";
  reason: DepartmentLifecycleReason; errorCode?: string; elapsedMs?: number; confirmed?: number; unconfirmed?: number; retained?: number };
const id = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "invalid-id";
const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(2147483647, Math.floor(value))) : 0;
const departmentDiagnosticErrorCodes = new Set([
  "department-producer-no-live-generation",
  "department-interactive-local-session-unavailable",
  "department-interactive-native-session-conflict",
  "department-interactive-owner-start-failed",
  "department-interactive-session-write-failed",
  "EACCES", "EBUSY", "ENOENT", "ENOSPC", "EPERM", "EROFS", "EIO",
]);

/** Telemetry only: never awaited, never used as execution/receipt authority.
 * Explicit field projection prevents errors, sessions and arbitrary payloads escaping. */
export function departmentLifecycleDiagnostic(event: DepartmentLifecycleEvent, fields: Fields): void {
  try {
    const data = { rootTaskId: id(fields.rootTaskId),
      ...(fields.leaderTaskId === undefined ? {} : { leaderTaskId: id(fields.leaderTaskId) }),
      ...(fields.generation === undefined ? {} : { generation: count(fields.generation) }),
      stage: fields.stage, result: fields.result, reason: fields.reason,
      ...(safeDepartmentErrorCode(fields.errorCode) ? { errorCode: safeDepartmentErrorCode(fields.errorCode) } : {}),
      ...Object.fromEntries((["elapsedMs", "confirmed", "unconfirmed", "retained"] as const)
        .filter((key) => fields[key] !== undefined).map((key) => [key, count(fields[key]!)])) };
    void Promise.resolve(logEssential(event, data)).catch(() => undefined);
  } catch { /* Diagnostics cannot change persistence, original receipts or capacity. */ }
}

export function departmentCleanupErrorCode(error: unknown): string | undefined {
  try {
    const record = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : undefined;
    const values = [record?.code, record?.message, typeof error === "string" ? error : undefined];
    return values.find((value): value is string => typeof value === "string" && !!safeDepartmentErrorCode(value));
  } catch { return undefined; }
}

function safeDepartmentErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && departmentDiagnosticErrorCodes.has(value) ? value : undefined;
}

/** Exact internal reasons only; unknown exceptions never contribute their text. */
export function departmentCleanupReason(error: unknown): DepartmentLifecycleReason {
  let message: unknown;
  try { message = error instanceof Error ? error.message : error; } catch { return "unexpected-failure"; }
  if (typeof message === "string" && /^cleanup-observation-(?:unknown|conflict|failed):/.test(message)) return "evidence-rejected";
  switch (message) {
    case "leader-coordination-cleanup-unverifiable":
    case "department-group-cleanup-set-incomplete":
    case "leader-cleanup-original-observation-unavailable": return "evidence-missing";
    case "cleanup-observation-identity-or-policy-conflict":
    case "leader-cleanup-selection-conflict":
    case "leader-cleanup-generation-or-set-changed":
    case "department-group-cleanup-scope-changed": return "evidence-rejected";
    case "leader-release-persistence-failed": return "persistence-failed";
    case "execution-cleanup-unverified": return "already-blocked";
    default: return "unexpected-failure";
  }
}
