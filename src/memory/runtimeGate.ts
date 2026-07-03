import {
  resolveLongTermMemoryEnabled,
  type ResolveLongTermMemoryEnabledInput,
} from "../toolSettings";

export type MemoryRuntimeOperation =
  | "recall"
  | "inject"
  | "generateCandidate"
  | "autoExtractAfterCompact"
  | "autoExtractAfterLobsterTask"
  | "create"
  | "update"
  | "manualSave"
  | "acceptCandidate"
  | "quickRemember"
  | "view"
  | "export"
  | "delete";

export type MemoryRuntimeGateSettings = ResolveLongTermMemoryEnabledInput & {
  memoryAutoExtractAfterCompact?: boolean;
  memoryAutoExtractAfterLobsterTask?: boolean;
};

export type LongTermMemoryRuntimeDisableReason =
  | "disabled-by-setting";

const READ_WRITE_RUNTIME_OPERATIONS: ReadonlySet<MemoryRuntimeOperation> = new Set([
  "recall",
  "inject",
  "generateCandidate",
  "autoExtractAfterCompact",
  "autoExtractAfterLobsterTask",
  "create",
  "update",
  "manualSave",
  "acceptCandidate",
  "quickRemember",
]);

const MANAGEMENT_OPERATIONS_ALLOWED_WHEN_DISABLED: ReadonlySet<MemoryRuntimeOperation> = new Set([
  "view",
  "export",
  "delete",
]);

export function getLongTermMemoryRuntimeDisableReason(
  settings?: MemoryRuntimeGateSettings | null,
): LongTermMemoryRuntimeDisableReason | null {
  return resolveLongTermMemoryEnabled(settings) ? null : "disabled-by-setting";
}

export function isLongTermMemoryRuntimeEnabled(settings?: MemoryRuntimeGateSettings | null): boolean {
  return getLongTermMemoryRuntimeDisableReason(settings) === null;
}

export function isMemoryRuntimeOperationAllowed(
  operation: MemoryRuntimeOperation,
  settings?: MemoryRuntimeGateSettings | null,
): boolean {
  if (!isLongTermMemoryRuntimeEnabled(settings)) {
    return MANAGEMENT_OPERATIONS_ALLOWED_WHEN_DISABLED.has(operation);
  }

  if (operation === "autoExtractAfterCompact") {
    return settings?.memoryAutoExtractAfterCompact === true;
  }
  if (operation === "autoExtractAfterLobsterTask") {
    return settings?.memoryAutoExtractAfterLobsterTask === true;
  }

  return READ_WRITE_RUNTIME_OPERATIONS.has(operation) || MANAGEMENT_OPERATIONS_ALLOWED_WHEN_DISABLED.has(operation);
}

export function assertMemoryRuntimeOperationAllowed(
  operation: MemoryRuntimeOperation,
  settings?: MemoryRuntimeGateSettings | null,
): void {
  if (!isMemoryRuntimeOperationAllowed(operation, settings)) {
    throw new Error(`long-term-memory-disabled:${operation}`);
  }
}
