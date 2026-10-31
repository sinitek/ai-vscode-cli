import * as fs from "fs";
import * as path from "path";
import {
  CLI_LIST,
  type CliName,
  type InteractiveMode,
  type ThinkingMode,
} from "./cli/types";
import {
  isLegacyLoopInteractiveMode,
  migrateLegacyLoopJson,
} from "./loopLegacyMigration";
import {
  normalizeLoopPlusAcceptancePlanSelectionId,
  normalizeLoopPlusAcceptancePlans,
  type LoopPlusAcceptancePlan,
} from "./loopPlusAcceptancePlan";

export type ConversationTabRecordForWorkspaceSettings = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  sessionIdByCli: Partial<Record<CliName, string>>;
  createdAt: number;
  executionLocked?: boolean;
  lockedPrimaryModel?: string | null;
};

export type ConversationTabsStateForWorkspaceSettings = {
  activeTabId: string | null;
  tabs: ConversationTabRecordForWorkspaceSettings[];
};

export type WorkspaceSettings = {
  currentCli?: CliName;
  thinkingMode?: ThinkingMode;
  interactiveModeByCli?: Partial<Record<CliName, InteractiveMode>>;
  /** @deprecated After-run context compaction is global; keep only for migration reads. */
  autoCompactContextAfterRun?: boolean;
  /** @deprecated Before-run context compaction is a legacy global migration input. */
  autoCompactContextBeforeRun?: boolean;
  workspaceMemoryEnabled?: boolean;
  /** @deprecated Loop max rounds is global; keep only for legacy reads. */
  loopMaxRounds?: number;
  activeConfigIdByCli?: Partial<Record<CliName, string>>;
  conversationTabs?: ConversationTabsStateForWorkspaceSettings;
  /** Loop+ 验收方案模板；“系统默认”是内置基线，不存于此字段。 */
  loopPlusAcceptancePlans?: LoopPlusAcceptancePlan[];
  /** 最近一次选中的验收方案 ID；“系统默认”以固定 ID 表示。 */
  loopPlusAcceptancePlanSelection?: string;
};

export type WorkspaceSettingsStoreLogger = (event: string, payload?: unknown) => void;

export type WorkspaceSettingsStoreOptions = {
  workspaceSettingsDir: string;
  workspaceKey: string | null | undefined;
  isCliName: (value: string) => value is CliName;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  isInteractiveMode: (value: unknown) => value is InteractiveMode;
  normalizeVisibleInteractiveMode: (value: unknown) => InteractiveMode;
  normalizeLoopMaxRounds: (value: unknown) => number;
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
    const parsed = migrateLegacyLoopJson(JSON.parse(raw)).value;
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
        if (mode === "loop_plus") {
          normalized[cli] = "loop_plus";
          return;
        }
        if (options.isInteractiveMode(mode) || isLegacyLoopInteractiveMode(mode)) {
          normalized[cli] = isLegacyLoopInteractiveMode(mode)
            ? "loop"
            : options.normalizeVisibleInteractiveMode(mode);
        }
      });
      if (Object.keys(normalized).length > 0) {
        result.interactiveModeByCli = normalized;
      }
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
    const loopMaxRounds = (parsed as WorkspaceSettings).loopMaxRounds;
    if (typeof loopMaxRounds === "number" || typeof loopMaxRounds === "string") {
      result.loopMaxRounds = options.normalizeLoopMaxRounds(loopMaxRounds);
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
    normalizeAcceptancePlanSettings(result, parsed as Record<string, unknown>);
    return result;
  } catch (error) {
    options.logError?.("workspace-settings-read-error", { error: String(error) });
    return {};
  }
}

function normalizeAcceptancePlanSettings(result: WorkspaceSettings, parsed: Record<string, unknown>): void {
  const plans = normalizeLoopPlusAcceptancePlans(parsed.loopPlusAcceptancePlans);
  if (plans.length > 0) {
    result.loopPlusAcceptancePlans = plans;
  }
  // 只有文件里确实带有验收方案数据时才写回，避免给无关工作区凭空增加字段。
  if (plans.length > 0 || Object.prototype.hasOwnProperty.call(parsed, "loopPlusAcceptancePlanSelection")) {
    result.loopPlusAcceptancePlanSelection = normalizeLoopPlusAcceptancePlanSelectionId(
      parsed.loopPlusAcceptancePlanSelection,
      plans,
    );
  }
}

export type SaveWorkspaceSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * 保存工作区设置，并把失败原因交回调用方（例如验收方案保存需要在界面提示中文错误）。
 * 与 `saveWorkspaceSettings` 共用同一份写入逻辑，不改变既有静默失败语义。
 */
export function trySaveWorkspaceSettings(
  next: WorkspaceSettings,
  options: WorkspaceSettingsStoreOptions,
): SaveWorkspaceSettingsResult {
  const filePath = getWorkspaceSettingsFilePath(options);
  if (!filePath) {
    return { ok: false, error: "当前工作区没有可用的设置存储位置。" };
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
    return { ok: true };
  } catch (error) {
    options.logError?.("workspace-settings-write-error", { error: String(error) });
    return { ok: false, error: String(error) };
  }
}

export function saveWorkspaceSettings(next: WorkspaceSettings, options: WorkspaceSettingsStoreOptions): void {
  trySaveWorkspaceSettings(next, options);
}

export function getWorkspaceSettingsFilePath(options: WorkspaceSettingsStoreOptions): string | null {
  if (!options.workspaceKey) {
    return null;
  }
  return path.join(options.workspaceSettingsDir, `${options.workspaceKey}.json`);
}
