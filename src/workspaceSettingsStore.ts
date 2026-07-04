import * as fs from "fs";
import * as path from "path";
import {
  CLI_LIST,
  normalizeLobsterExecutionMode,
  type CliName,
  type InteractiveMode,
  type LobsterExecutionMode,
  type ThinkingMode,
} from "./cli/types";

export type ConversationTabRecordForWorkspaceSettings = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  sessionIdByCli: Partial<Record<CliName, string>>;
  createdAt: number;
};

export type ConversationTabsStateForWorkspaceSettings = {
  activeTabId: string | null;
  tabs: ConversationTabRecordForWorkspaceSettings[];
};

export type WorkspaceSettings = {
  currentCli?: CliName;
  thinkingMode?: ThinkingMode;
  interactiveModeByCli?: Partial<Record<CliName, InteractiveMode>>;
  lobsterExecutionModeByCli?: Partial<Record<CliName, LobsterExecutionMode>>;
  autoCompactContextAfterRun?: boolean;
  autoCompactContextBeforeRun?: boolean;
  workspaceMemoryEnabled?: boolean;
  codexMultiAgentEnabled?: boolean;
  lobsterMaxRounds?: number;
  lobsterAutoCloseSubtaskTabs?: boolean;
  activeConfigIdByCli?: Partial<Record<CliName, string>>;
  conversationTabs?: ConversationTabsStateForWorkspaceSettings;
};

export type WorkspaceSettingsStoreLogger = (event: string, payload?: unknown) => void;

export type WorkspaceSettingsStoreOptions = {
  workspaceSettingsDir: string;
  workspaceKey: string | null | undefined;
  isCliName: (value: string) => value is CliName;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  isInteractiveMode: (value: unknown) => value is InteractiveMode;
  normalizeVisibleInteractiveMode: (value: unknown) => InteractiveMode;
  normalizeLobsterMaxRounds: (value: unknown) => number;
  sanitizeConversationTabRecord: (value: unknown) => ConversationTabRecordForWorkspaceSettings | null;
  logError?: WorkspaceSettingsStoreLogger;
};

export function loadWorkspaceSettings(options: WorkspaceSettingsStoreOptions): WorkspaceSettings {
  const filePath = getWorkspaceSettingsFilePath(options);
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: WorkspaceSettings = {};
    const thinkingMode = (parsed as WorkspaceSettings).thinkingMode;
    if (options.isThinkingMode(thinkingMode)) {
      result.thinkingMode = thinkingMode;
    }
    const currentCli = (parsed as WorkspaceSettings).currentCli;
    if (currentCli && options.isCliName(currentCli)) {
      result.currentCli = currentCli;
    }
    const interactiveModeByCli = (parsed as WorkspaceSettings).interactiveModeByCli;
    if (interactiveModeByCli && typeof interactiveModeByCli === "object") {
      const normalized: Partial<Record<CliName, InteractiveMode>> = {};
      CLI_LIST.forEach((cli) => {
        const mode = (interactiveModeByCli as Record<string, unknown>)[cli];
        if (options.isInteractiveMode(mode)) {
          normalized[cli] = options.normalizeVisibleInteractiveMode(mode);
        }
      });
      if (Object.keys(normalized).length > 0) {
        result.interactiveModeByCli = normalized;
      }
    }
    const lobsterExecutionModeByCli = (parsed as WorkspaceSettings).lobsterExecutionModeByCli;
    if (lobsterExecutionModeByCli && typeof lobsterExecutionModeByCli === "object") {
      const normalized: Partial<Record<CliName, LobsterExecutionMode>> = {};
      CLI_LIST.forEach((cli) => {
        const mode = (lobsterExecutionModeByCli as Record<string, unknown>)[cli];
        normalized[cli] = normalizeLobsterExecutionMode(mode);
      });
      result.lobsterExecutionModeByCli = normalized;
    }
    const codexMultiAgentEnabled = (parsed as WorkspaceSettings).codexMultiAgentEnabled;
    if (typeof codexMultiAgentEnabled === "boolean") {
      result.codexMultiAgentEnabled = codexMultiAgentEnabled;
    }
    const autoCompactContextAfterRun = (parsed as WorkspaceSettings).autoCompactContextAfterRun;
    if (typeof autoCompactContextAfterRun === "boolean") {
      result.autoCompactContextAfterRun = autoCompactContextAfterRun;
    } else {
      const autoCompactContextBeforeRun = (parsed as WorkspaceSettings).autoCompactContextBeforeRun;
      if (typeof autoCompactContextBeforeRun === "boolean") {
        result.autoCompactContextAfterRun = autoCompactContextBeforeRun;
      }
    }
    const workspaceMemoryEnabled = (parsed as WorkspaceSettings).workspaceMemoryEnabled;
    if (typeof workspaceMemoryEnabled === "boolean") {
      result.workspaceMemoryEnabled = workspaceMemoryEnabled;
    }
    const lobsterMaxRounds = (parsed as WorkspaceSettings).lobsterMaxRounds;
    if (typeof lobsterMaxRounds === "number" || typeof lobsterMaxRounds === "string") {
      result.lobsterMaxRounds = options.normalizeLobsterMaxRounds(lobsterMaxRounds);
    }
    const lobsterAutoCloseSubtaskTabs = (parsed as WorkspaceSettings).lobsterAutoCloseSubtaskTabs;
    if (typeof lobsterAutoCloseSubtaskTabs === "boolean") {
      result.lobsterAutoCloseSubtaskTabs = lobsterAutoCloseSubtaskTabs;
    }
    const activeConfigIdByCli = (parsed as WorkspaceSettings).activeConfigIdByCli;
    if (activeConfigIdByCli && typeof activeConfigIdByCli === "object") {
      const normalized: Partial<Record<CliName, string>> = {};
      CLI_LIST.forEach((cli) => {
        const activeConfigId = (activeConfigIdByCli as Record<string, unknown>)[cli];
        if (typeof activeConfigId === "string" && activeConfigId.trim()) {
          normalized[cli] = activeConfigId;
        }
      });
      if (Object.keys(normalized).length > 0) {
        result.activeConfigIdByCli = normalized;
      }
    }
    const conversationTabs = (parsed as WorkspaceSettings).conversationTabs;
    if (conversationTabs && typeof conversationTabs === "object") {
      const record = conversationTabs as ConversationTabsStateForWorkspaceSettings;
      const tabs = Array.isArray(record.tabs)
        ? record.tabs
          .map((tab) => options.sanitizeConversationTabRecord(tab))
          .filter((tab): tab is ConversationTabRecordForWorkspaceSettings => Boolean(tab))
        : [];
      if (tabs.length > 0) {
        const activeTabId = typeof record.activeTabId === "string" && tabs.some((tab) => tab.id === record.activeTabId)
          ? record.activeTabId
          : tabs[tabs.length - 1].id;
        result.conversationTabs = {
          activeTabId,
          tabs,
        };
      }
    }
    return result;
  } catch (error) {
    options.logError?.("workspace-settings-read-error", { error: String(error) });
    return {};
  }
}

export function saveWorkspaceSettings(next: WorkspaceSettings, options: WorkspaceSettingsStoreOptions): void {
  const filePath = getWorkspaceSettingsFilePath(options);
  if (!filePath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  } catch (error) {
    options.logError?.("workspace-settings-write-error", { error: String(error) });
  }
}

export function getWorkspaceSettingsFilePath(options: WorkspaceSettingsStoreOptions): string | null {
  if (!options.workspaceKey) {
    return null;
  }
  return path.join(options.workspaceSettingsDir, `${options.workspaceKey}.json`);
}
