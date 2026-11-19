import * as fs from "fs";
import { normalizeWorkspaceDepartmentCapacity } from "./departmentSettings";
import * as path from "path";
import { randomUUID } from "crypto";
import { resolveLoopPlusDecisionSubtaskMax } from "./loopPlusDecision";
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
import { normalizeDepartmentRolePreference, type DepartmentConfiguredRoleRoute } from "./departmentConfiguration";

export type ConversationTabRecordForWorkspaceSettings = {
  taskSummary?: string;
  taskSummaryAttempted?: boolean;
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
  /** 当前工作区的 Loop/Loop+ 派发上限；缺省时继承全局。 */
  loopPlusDecisionSubtaskMax?: number;
  /** 工作区产研部人数覆盖；缺省逐项继承全局。 */
  departmentMaxLeaders?: number;
  departmentMaxEmployees?: number;
  activeConfigIdByCli?: Partial<Record<CliName, string>>;
  conversationTabs?: ConversationTabsStateForWorkspaceSettings;
  /** Loop+ 验收方案模板；“系统默认”是内置基线，不存于此字段。 */
  loopPlusAcceptancePlans?: LoopPlusAcceptancePlan[];
  /** 最近一次选中的验收方案 ID；“系统默认”以固定 ID 表示。 */
  loopPlusAcceptancePlanSelection?: string;
  /** 产研部角色路由偏好，按总监 CLI 档案作用域隔离。 */
  departmentRoleRoutesByDirectorConfig?: Record<string, Partial<{ leader: DepartmentConfiguredRoleRoute; employee: DepartmentConfiguredRoleRoute }>>;
};

export type WorkspaceSettingsStoreLogger = (event: string, payload?: unknown) => void;

export function normalizeWorkspaceLoopPlusDecisionSubtaskMax(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  return Number.isFinite(numeric) ? resolveLoopPlusDecisionSubtaskMax(numeric) : undefined;
}

export function resolveEffectiveLoopPlusDecisionSubtaskMax(workspaceValue: unknown, globalValue: unknown): number {
  return normalizeWorkspaceLoopPlusDecisionSubtaskMax(workspaceValue)
    ?? resolveLoopPlusDecisionSubtaskMax(globalValue);
}

export type WorkspaceSettingsStoreOptions = {
  workspaceSettingsDir: string;
  workspaceKey: string | null | undefined;
  isCliName: (value: string) => value is CliName;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  isInteractiveMode: (value: unknown) => value is InteractiveMode;
  normalizeVisibleInteractiveMode: (value: unknown) => InteractiveMode;
  normalizeLoopMaxRounds?: (value: unknown) => number;
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
        if (mode === "department") {
          normalized[cli] = "department";
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
    for (const key of ["departmentMaxLeaders", "departmentMaxEmployees"] as const) {
      const value = normalizeWorkspaceDepartmentCapacity((parsed as WorkspaceSettings)[key]);
      if (value !== undefined) result[key] = value;
    }
    const activeConfigIdByCli = (parsed as WorkspaceSettings).activeConfigIdByCli;
    const loopPlusDecisionSubtaskMax = normalizeWorkspaceLoopPlusDecisionSubtaskMax(
      (parsed as WorkspaceSettings).loopPlusDecisionSubtaskMax,
    );
    if (loopPlusDecisionSubtaskMax !== undefined) {
      result.loopPlusDecisionSubtaskMax = loopPlusDecisionSubtaskMax;
    }
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
    const rawDepartmentRoutes = (parsed as Record<string, unknown>).departmentRoleRoutesByDirectorConfig;
    if (rawDepartmentRoutes && typeof rawDepartmentRoutes === "object" && !Array.isArray(rawDepartmentRoutes)) {
      const normalized: NonNullable<WorkspaceSettings["departmentRoleRoutesByDirectorConfig"]> = {};
      for (const [scope, routes] of Object.entries(rawDepartmentRoutes as Record<string, unknown>)) {
        if (!scope.trim() || !routes || typeof routes !== "object" || Array.isArray(routes)) continue;
        const value = routes as Record<string, unknown>;
        const leader = normalizeDepartmentRolePreference(value.leader);
        const employee = normalizeDepartmentRolePreference(value.employee);
        if (leader || employee) normalized[scope] = { ...(leader ? { leader } : {}), ...(employee ? { employee } : {}) };
      }
      if (Object.keys(normalized).length) result.departmentRoleRoutesByDirectorConfig = normalized;
    }
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
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Replace only a complete document: a failed/partial write must preserve the saved configuration.
    fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return { ok: true };
  } catch (error) {
    options.logError?.("workspace-settings-write-error", { error: String(error) });
    return { ok: false, error: String(error) };
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch { /* Already renamed, or the write never created it. */ }
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
