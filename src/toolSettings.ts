import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CLI_LIST, LOOP_PLUS_INTERACTIVE_MODE, type CliName, type InteractiveMode, MacTaskShell } from "./cli/types";
import { migrateLegacyLoopJson } from "./loopLegacyMigration";
import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "./chatMessageLimit";
import { normalizeDepartmentMaxEmployees, normalizeDepartmentMaxLeaders } from "./departmentSettings";
import { normalizePromptInputHeight } from "./promptInputHeight";
import { writeFileAtomicallySync } from "./shared/atomicWrite";
import { withFileLockSync } from "./shared/fileLock";

export const HISTORY_RETENTION_DAYS_DEFAULT = 30;
export const HISTORY_RETENTION_DAYS_MIN = 1;
export const HISTORY_RETENTION_DAYS_MAX = 3650;
export const HUMAN_INTERACTION_TIMEOUT_MINUTES_DEFAULT = 15;
export const HUMAN_INTERACTION_TIMEOUT_MINUTES_MIN = 1;
export const HUMAN_INTERACTION_TIMEOUT_MINUTES_MAX = 1440;

export type NewTaskInteractiveMode = Exclude<InteractiveMode, "plan">;

export const NOTIFICATION_SETTING_KEYS = [
  "humanInteractionNotifications", "taskCompletionNotifications",
  "humanInteractionWindowAttention", "taskCompletionWindowAttention",
] as const;

export type NotificationSettings = Record<(typeof NOTIFICATION_SETTING_KEYS)[number], boolean>;

export function resolveNotificationSettings(settings: Partial<NotificationSettings>): NotificationSettings {
  return {
    humanInteractionNotifications: settings.humanInteractionNotifications !== false,
    taskCompletionNotifications: settings.taskCompletionNotifications !== false,
    humanInteractionWindowAttention: settings.humanInteractionWindowAttention !== false,
    taskCompletionWindowAttention: settings.taskCompletionWindowAttention !== false,
  };
}

export function resolveNewTaskInteractiveMode(value: unknown): NewTaskInteractiveMode {
  return value === "loop" || value === LOOP_PLUS_INTERACTIVE_MODE ? value : "coding";
}

export type ToolSettingsState = Partial<NotificationSettings> & {
  debug?: boolean;
  autoAddEditorContextTags?: boolean;
  autoCompactContextAfterRun?: boolean;
  humanInteractionEnabled?: boolean;
  newTaskInteractiveMode?: NewTaskInteractiveMode;
  loopEnabled?: boolean;
  loopPlusEnabled?: boolean;
  departmentEnabled?: boolean;
  loopPlusDecisionSubtaskMax?: number;
  departmentMaxLeaders?: number;
  departmentMaxEmployees?: number;
  humanInteractionTimeoutMinutes?: number;
  chatMessageLimit?: number;
  loopGroupChatMessageLimit?: number;
  hideInstructionBubbles?: boolean;
  promptInputHeight?: number;
  /** Global retention period for plugin-managed history artifacts. */
  historyRetentionDays?: number;
  macTaskShell?: MacTaskShell;
  /** @deprecated Long-term memory is workspace-scoped; keep only for legacy reads. */
  longTermMemoryEnabled?: boolean;
  /** @deprecated Long-term memory is workspace-scoped; keep only for legacy reads. */
  memoryEnabled?: boolean;
  /** @deprecated Long-term memory is workspace-scoped; keep only for legacy reads. */
  globalMemoryEnabled?: boolean;
  memoryAutoExtractAfterCompact?: boolean;
  memoryAutoExtractAfterLoopTask?: boolean;
  /**
   * Global per-CLI availability. Missing, unsaved, or non-boolean entries stay enabled.
   * There is no workspace override.
   */
  cliEnabledByName?: CliEnabledByName;
};

export type CliEnabledByName = Partial<Record<CliName, boolean>>;

const TOOL_SETTINGS_FILE = path.join(os.homedir(), ".sinitek_cli", "settings.json");
const TOOL_SETTINGS_LOCK_FILE = `${TOOL_SETTINGS_FILE}.lock`;

let cachedToolSettings: ToolSettingsState | null = null;

export type LongTermMemorySettingsInput = Pick<
  ToolSettingsState,
  | "longTermMemoryEnabled"
  | "memoryEnabled"
  | "globalMemoryEnabled"
  | "memoryAutoExtractAfterCompact"
  | "memoryAutoExtractAfterLoopTask"
> & {
  workspaceMemoryEnabled?: boolean;
};

export type ResolveLongTermMemoryEnabledInput = LongTermMemorySettingsInput & {
  workspaceSettings?: LongTermMemorySettingsInput | null;
};

export function normalizeToolSettings(value: unknown): ToolSettingsState {
  const normalized: ToolSettingsState = {};
  if (!value || typeof value !== "object") {
    return normalized;
  }
  const record = migrateLegacyLoopJson(value).value as Record<string, unknown>;
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (typeof record[key] === "boolean") normalized[key] = record[key];
  }
  if ("newTaskInteractiveMode" in record) {
    normalized.newTaskInteractiveMode = resolveNewTaskInteractiveMode(record.newTaskInteractiveMode);
  }
  if ("chatMessageLimit" in record) {
    normalized.chatMessageLimit = normalizeChatMessageLimit(record.chatMessageLimit);
  }
  if ("loopGroupChatMessageLimit" in record) {
    normalized.loopGroupChatMessageLimit = normalizeChatMessageLimit(record.loopGroupChatMessageLimit, LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT);
  }
  if (typeof record.hideInstructionBubbles === "boolean") {
    normalized.hideInstructionBubbles = record.hideInstructionBubbles;
  }
  const promptInputHeight = normalizePromptInputHeight(record.promptInputHeight);
  if (promptInputHeight !== undefined) {
    normalized.promptInputHeight = promptInputHeight;
  }
  if (typeof record.debug === "boolean") {
    normalized.debug = record.debug;
  }
  if (typeof record.autoAddEditorContextTags === "boolean") {
    normalized.autoAddEditorContextTags = record.autoAddEditorContextTags;
  }
  if (typeof record.autoCompactContextAfterRun === "boolean") {
    normalized.autoCompactContextAfterRun = record.autoCompactContextAfterRun;
  }
  if (typeof record.humanInteractionEnabled === "boolean") {
    normalized.humanInteractionEnabled = record.humanInteractionEnabled;
  }
  if (typeof record.loopEnabled === "boolean") normalized.loopEnabled = record.loopEnabled;
  if (typeof record.loopPlusEnabled === "boolean") normalized.loopPlusEnabled = record.loopPlusEnabled;
  if (typeof record.departmentEnabled === "boolean") normalized.departmentEnabled = record.departmentEnabled;
  if (typeof record.historyRetentionDays === "number" || typeof record.historyRetentionDays === "string") {
    const parsed = typeof record.historyRetentionDays === "number"
      ? record.historyRetentionDays
      : (record.historyRetentionDays.trim() ? Number(record.historyRetentionDays) : Number.NaN);
    if (Number.isFinite(parsed)) {
      normalized.historyRetentionDays = normalizeHistoryRetentionDays(parsed);
    }
  }
  if (
    typeof record.loopPlusDecisionSubtaskMax === "number"
    || typeof record.loopPlusDecisionSubtaskMax === "string"
  ) {
    const parsed = typeof record.loopPlusDecisionSubtaskMax === "number"
      ? record.loopPlusDecisionSubtaskMax
      : (record.loopPlusDecisionSubtaskMax.trim() ? Number(record.loopPlusDecisionSubtaskMax) : Number.NaN);
    if (Number.isFinite(parsed)) {
      normalized.loopPlusDecisionSubtaskMax = Math.floor(parsed);
    }
  }
  if ("departmentMaxLeaders" in record) {
    normalized.departmentMaxLeaders = normalizeDepartmentMaxLeaders(record.departmentMaxLeaders);
  }
  if ("departmentMaxEmployees" in record) {
    normalized.departmentMaxEmployees = normalizeDepartmentMaxEmployees(record.departmentMaxEmployees);
  }
  if (
    typeof record.humanInteractionTimeoutMinutes === "number"
    || typeof record.humanInteractionTimeoutMinutes === "string"
  ) {
    const parsed = typeof record.humanInteractionTimeoutMinutes === "number"
      ? record.humanInteractionTimeoutMinutes
      : (record.humanInteractionTimeoutMinutes.trim() ? Number(record.humanInteractionTimeoutMinutes) : Number.NaN);
    if (Number.isFinite(parsed)) {
      normalized.humanInteractionTimeoutMinutes = resolveHumanInteractionTimeoutMinutes(parsed);
    }
  }
  if (record.macTaskShell === "zsh" || record.macTaskShell === "bash") {
    normalized.macTaskShell = record.macTaskShell;
  }
  if (typeof record.longTermMemoryEnabled === "boolean") {
    normalized.longTermMemoryEnabled = record.longTermMemoryEnabled;
  }
  if (typeof record.memoryEnabled === "boolean") {
    normalized.memoryEnabled = record.memoryEnabled;
  }
  if (typeof record.globalMemoryEnabled === "boolean") {
    normalized.globalMemoryEnabled = record.globalMemoryEnabled;
  }
  if (typeof record.memoryAutoExtractAfterCompact === "boolean") {
    normalized.memoryAutoExtractAfterCompact = record.memoryAutoExtractAfterCompact;
  }
  if (typeof record.memoryAutoExtractAfterLoopTask === "boolean") {
    normalized.memoryAutoExtractAfterLoopTask = record.memoryAutoExtractAfterLoopTask;
  }
  const cliEnabledByName = normalizeCliEnabledByName(record.cliEnabledByName);
  if (cliEnabledByName) {
    normalized.cliEnabledByName = cliEnabledByName;
  }
  return normalized;
}

export function normalizeCliEnabledByName(value: unknown): CliEnabledByName | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const normalized: CliEnabledByName = {};
  let hasExplicit = false;
  for (const cli of CLI_LIST) {
    if (typeof record[cli] === "boolean") {
      normalized[cli] = record[cli];
      hasExplicit = true;
    }
  }
  return hasExplicit ? normalized : undefined;
}

export function isCliEnabled(
  cli: string | null | undefined,
  settings?: Pick<ToolSettingsState, "cliEnabledByName"> | null,
): boolean {
  if (!cli || !(CLI_LIST as readonly string[]).includes(cli)) {
    return false;
  }
  return settings?.cliEnabledByName?.[cli as CliName] !== false;
}

export function listEnabledClis(
  settings?: Pick<ToolSettingsState, "cliEnabledByName"> | null,
): CliName[] {
  return CLI_LIST.filter((cli) => isCliEnabled(cli, settings));
}

export function resolveNextEnabledCli(
  current: string | null | undefined,
  settings?: Pick<ToolSettingsState, "cliEnabledByName"> | null,
): CliName | null {
  if (isCliEnabled(current, settings)) {
    return current as CliName;
  }
  return listEnabledClis(settings)[0] ?? null;
}

export function resolveHumanInteractionTimeoutMinutes(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return HUMAN_INTERACTION_TIMEOUT_MINUTES_DEFAULT;
  }
  return Math.min(
    Math.max(Math.floor(numeric), HUMAN_INTERACTION_TIMEOUT_MINUTES_MIN),
    HUMAN_INTERACTION_TIMEOUT_MINUTES_MAX,
  );
}

export function readHumanInteractionTimeoutMs(settings: Pick<ToolSettingsState, "humanInteractionTimeoutMinutes"> = readToolSettings()): number {
  return resolveHumanInteractionTimeoutMinutes(settings.humanInteractionTimeoutMinutes) * 60_000;
}

export function normalizeHistoryRetentionDays(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return HISTORY_RETENTION_DAYS_DEFAULT;
  }
  return Math.min(
    Math.max(Math.floor(numeric), HISTORY_RETENTION_DAYS_MIN),
    HISTORY_RETENTION_DAYS_MAX,
  );
}

export function resolveGlobalAutoCompactContextAfterRun(
  globalSettings?: Pick<ToolSettingsState, "autoCompactContextAfterRun"> | null,
  legacyWorkspaceSettings?: {
    autoCompactContextAfterRun?: boolean;
    autoCompactContextBeforeRun?: boolean;
  } | null,
): boolean {
  if (typeof globalSettings?.autoCompactContextAfterRun === "boolean") {
    return globalSettings.autoCompactContextAfterRun;
  }
  if (typeof legacyWorkspaceSettings?.autoCompactContextAfterRun === "boolean") {
    return legacyWorkspaceSettings.autoCompactContextAfterRun;
  }
  if (typeof legacyWorkspaceSettings?.autoCompactContextBeforeRun === "boolean") {
    return legacyWorkspaceSettings.autoCompactContextBeforeRun;
  }
  return true;
}

export function resolveGlobalHumanInteractionEnabled(
  globalSettings?: Pick<ToolSettingsState, "humanInteractionEnabled"> | null,
): boolean {
  if (typeof globalSettings?.humanInteractionEnabled === "boolean") {
    return globalSettings.humanInteractionEnabled;
  }
  return true;
}

export function resolveLongTermMemoryEnabled(input?: ResolveLongTermMemoryEnabledInput | null): boolean {
  const globalSettings = input ?? {};
  const workspaceSettings = input?.workspaceSettings ?? {};
  const totalSwitches = [
    globalSettings.memoryEnabled,
    globalSettings.globalMemoryEnabled,
    globalSettings.workspaceMemoryEnabled,
    workspaceSettings.longTermMemoryEnabled,
    workspaceSettings.workspaceMemoryEnabled,
  ];

  if (totalSwitches.some((value) => value === false)) {
    return false;
  }
  if (totalSwitches.some((value) => value === true)) {
    return true;
  }
  return false;
}

export function readToolSettings(): ToolSettingsState {
  return cachedToolSettings ? { ...cachedToolSettings } : reloadToolSettings();
}

export function reloadToolSettings(): ToolSettingsState {
  try {
    cachedToolSettings = readToolSettingsFromDisk();
  } catch {
    cachedToolSettings = {};
  }
  return { ...cachedToolSettings };
}

export function readToolSettingsFromDisk(): ToolSettingsState {
  try {
    return normalizeToolSettings(JSON.parse(fs.readFileSync(TOOL_SETTINGS_FILE, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function updateToolSettings(patch: Partial<ToolSettingsState>, onlyMissing = false): void {
  withToolSettingsLock(() => {
    const current = readToolSettingsFromDisk();
    const next = onlyMissing ? { ...patch, ...current } : { ...current, ...patch };
    if (patch.cliEnabledByName && !onlyMissing) {
      next.cliEnabledByName = { ...current.cliEnabledByName, ...patch.cliEnabledByName };
    }
    persistToolSettings(next);
  });
}

export function writeToolSettings(next: ToolSettingsState): void {
  withToolSettingsLock(() => persistToolSettings(next));
}

function persistToolSettings(next: ToolSettingsState): void {
  const normalized = normalizeToolSettings(next);
  writeFileAtomicallySync(TOOL_SETTINGS_FILE, JSON.stringify(normalized, null, 2));
  cachedToolSettings = normalized;
}

function withToolSettingsLock<T>(action: () => T): T {
  return withFileLockSync(TOOL_SETTINGS_LOCK_FILE, "全局工具设置锁已替换，拒绝释放未知锁。", action);
}

export function getToolSettingsFilePath(): string {
  return TOOL_SETTINGS_FILE;
}
