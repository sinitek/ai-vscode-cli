import * as path from "path";
import type { CliName } from "./cli/types";
import type { PanelMessage } from "./webview/types";
import type { ConfigItem } from "./config/types";
import type { CliModelStore } from "./modelSelectionStore";
import type { WorkspaceSettings } from "./workspaceSettingsStore";

type InspectModelManagerMessage = Extract<PanelMessage, { type: "inspectModelManager" }>;

export {
  HIDDEN_RETRY_MAX_RETRIES,
  type ErrorInfo,
  type CliAttemptResult,
  type RetryErrorTraceMessageOptions,
  getErrorInfo,
  getAttemptFailureMessage,
  createHiddenRetryErrorTraceMessage,
  appendHiddenRetryErrorTraceMessage,
  isAbortErrorInfo,
  isNonRetryableBillingErrorInfo,
  isHiddenRetryEligibleErrorInfo,
  isHiddenRetryEligibleAttempt,
  waitForHiddenRetryDelay,
  buildHiddenRetryLimitMessage,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
} from "./promptRetry";

export {
  type LoopVerificationState,
  type LoopVerificationSignals,
  type LoopTaskCompletionMessagesState,
  normalizeLoopResumePrompt,
  isLoopResumePrompt,
  collectRecentLoopTaskIdsFromMessages,
  isLoopTaskResumable,
  isLoopTaskPromptResumeCandidate,
  isLoopTaskSessionCompatible,
  formatLoopVerificationState,
  detectLoopVerificationSignals,
  getLoopCompletionMessagesState,
  hasCompleteLoopCompletionMessages,
  isLoopAnswerConclusionMessageForTask,
  isLoopFinalSummaryMessageForTask,
  isCompleteLoopFinalSummaryContent,
} from "./loopTaskMessagePolicy";

export {
  buildLoopGroupChatPanelState,
  createLoopGroupChatPanelCoordinator,
} from "./extensionHost/loopGroupChatPanelCoordinator";

type ModelDiagnosticsPayload = {
  cli: CliName;
  configId: string | null;
  webviewConfigId: string | null;
  activeConfigId: string | null;
  workspacePreferredConfigId: string | null;
  visibleModelCount: number;
  visibleManagedModelCount: number;
  selectedModel: string | null;
  memoryModels: string[];
  memoryManagedModels: string[];
  diskModels: string[];
  diskManagedModels: string[];
  diskModelCountsByConfigId: Record<string, number>;
  memoryModelCountsByConfigId: Record<string, number>;
  configIds: string[];
  modelStoreReadError: string | null;
  modelStoreWriteError: string | null;
  configStateLoadError: string | null;
  reasons: string[];
};

export type PanelDiagnosticsDeps = {
  getWorkspaceKey: () => string;
  getDataDir: () => string;
  getModelStoreFile: () => string;
  getWorkspaceSettings: () => WorkspaceSettings;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  normalizeCliModelName: (value: unknown) => string | null;
  ensureCliModelStore: (store?: CliModelStore) => CliModelStore;
  readModelStore: () => CliModelStore | undefined;
  getMemoryModelStore: () => CliModelStore;
  getModelSelectionStoreErrors: () => { lastReadError: string | null; lastWriteError: string | null };
  setLastConfigStateLoadError: (cli: CliName, message: string) => void;
  getLastConfigStateLoadError: (cli: CliName) => string | null;
  getConfigList: (cli: CliName) => Promise<ConfigItem[]>;
  getModelOptionsForConfigFromStore: (store: CliModelStore, configId: string | null) => string[];
  getManagedModelOptionsForConfigFromStore: (store: CliModelStore, configId: string | null) => string[];
  summarizeModelStoreByConfigId: (store: CliModelStore) => Record<string, number>;
  countStoreModels: (summary: Record<string, number>) => number;
  t: typeof import("./i18n").t;
  logDebug: (event: string, payload?: unknown) => void;
  logEssential: (event: string, payload?: unknown) => void;
  logError: (event: string, payload?: unknown) => void;
  showErrorWithActions: (title: string, detail: unknown, options?: { detailTitle?: string; detail?: string }) => Promise<void>;
  errorToMessage: (error: unknown) => string;
};

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function buildModelManagerDiagnosticsDetail(payload: ModelDiagnosticsPayload, deps: PanelDiagnosticsDeps): string {
  return [
    deps.t("model.diagnostics.message"),
    "",
    `reasons: ${payload.reasons.join("; ")}`,
    `cli: ${payload.cli}`,
    `storagePath: ${deps.getModelStoreFile()}`,
    `logsDir: ${path.join(deps.getDataDir(), "logs")}`,
    `workspaceKey: ${deps.getWorkspaceKey()}`,
    `configIdUsedForModels: ${payload.configId ?? "(none)"}`,
    `webviewConfigId: ${payload.webviewConfigId ?? "(none)"}`,
    `activeConfigId: ${payload.activeConfigId ?? "(none)"}`,
    `workspacePreferredConfigId: ${payload.workspacePreferredConfigId ?? "(none)"}`,
    `knownConfigIds: ${JSON.stringify(payload.configIds)}`,
    `selectedModel: ${payload.selectedModel ?? "(none)"}`,
    `visibleModelCount: ${payload.visibleModelCount}`,
    `visibleManagedModelCount: ${payload.visibleManagedModelCount}`,
    `memoryModelsForConfig: ${JSON.stringify(payload.memoryModels)}`,
    `memoryManagedModelsForConfig: ${JSON.stringify(payload.memoryManagedModels)}`,
    `diskModelsForConfig: ${JSON.stringify(payload.diskModels)}`,
    `diskManagedModelsForConfig: ${JSON.stringify(payload.diskManagedModels)}`,
    `memoryModelCountsByConfigId: ${JSON.stringify(payload.memoryModelCountsByConfigId)}`,
    `diskModelCountsByConfigId: ${JSON.stringify(payload.diskModelCountsByConfigId)}`,
    `modelSelectionStoreState.lastReadError: ${payload.modelStoreReadError ?? "(none)"}`,
    `modelSelectionStoreState.lastWriteError: ${payload.modelStoreWriteError ?? "(none)"}`,
    `lastConfigStateLoadError: ${payload.configStateLoadError ?? "(none)"}`,
  ].join("\n");
}

export function createPanelDiagnosticsInspector(deps: PanelDiagnosticsDeps) {
  return async function inspectModelManagerState(message: InspectModelManagerMessage): Promise<void> {
    try {
      const cli = message.cli;
      const webviewConfigId = typeof message.configId === "string" && message.configId.trim()
        ? message.configId.trim()
        : null;
      const activeConfigId = deps.getActiveConfigIdForCli(cli);
      const workspacePreferredConfigId = deps.getWorkspaceSettings().activeConfigIdByCli?.[cli] ?? null;
      const configId = webviewConfigId || activeConfigId || workspacePreferredConfigId;
      const visibleModelCount = normalizeCount(message.visibleModelCount);
      const visibleManagedModelCount = normalizeCount(message.visibleManagedModelCount);
      const selectedModel = deps.normalizeCliModelName(message.selectedModel);
      const previousModelStoreReadError = deps.getModelSelectionStoreErrors().lastReadError;
      const diskStore = deps.ensureCliModelStore(deps.readModelStore());
      const storeErrors = deps.getModelSelectionStoreErrors();
      const modelStoreReadError = storeErrors.lastReadError ?? previousModelStoreReadError;
      const memoryStore = deps.ensureCliModelStore(deps.getMemoryModelStore());
      let configIds: string[] = [];
      try {
        configIds = (await deps.getConfigList(cli)).map((config) => config.id);
      } catch (error) {
        deps.setLastConfigStateLoadError(cli, deps.errorToMessage(error));
      }

      const memoryModels = deps.getModelOptionsForConfigFromStore(memoryStore, configId);
      const memoryManagedModels = deps.getManagedModelOptionsForConfigFromStore(memoryStore, configId);
      const diskModels = deps.getModelOptionsForConfigFromStore(diskStore, configId);
      const diskManagedModels = deps.getManagedModelOptionsForConfigFromStore(diskStore, configId);
      const memoryModelCountsByConfigId = deps.summarizeModelStoreByConfigId(memoryStore);
      const diskModelCountsByConfigId = deps.summarizeModelStoreByConfigId(diskStore);
      const reasons: string[] = [];
      const latestStoreErrors = deps.getModelSelectionStoreErrors();
      const configStateLoadError = deps.getLastConfigStateLoadError(cli);

      if (modelStoreReadError) {
        reasons.push("model-store-read-error");
      }
      if (latestStoreErrors.lastWriteError) {
        reasons.push("model-store-write-error");
      }
      if (configStateLoadError) {
        reasons.push("config-state-load-error");
      }
      if (!configId && (deps.countStoreModels(memoryModelCountsByConfigId) > 0 || deps.countStoreModels(diskModelCountsByConfigId) > 0)) {
        reasons.push("missing-active-config-id");
      }
      if (configId && visibleModelCount === 0 && (memoryModels.length > 0 || diskModels.length > 0)) {
        reasons.push("webview-model-options-empty-but-store-has-models");
      }
      if (configId && visibleManagedModelCount === 0 && (memoryManagedModels.length > 0 || diskManagedModels.length > 0)) {
        reasons.push("webview-managed-models-empty-but-store-has-models");
      }
      if (webviewConfigId && activeConfigId && webviewConfigId !== activeConfigId && visibleManagedModelCount === 0) {
        reasons.push("webview-active-config-mismatch");
      }

      const payload: ModelDiagnosticsPayload = {
        cli,
        configId,
        webviewConfigId,
        activeConfigId,
        workspacePreferredConfigId,
        visibleModelCount,
        visibleManagedModelCount,
        selectedModel,
        memoryModels,
        memoryManagedModels,
        diskModels,
        diskManagedModels,
        diskModelCountsByConfigId,
        memoryModelCountsByConfigId,
        configIds,
        modelStoreReadError,
        modelStoreWriteError: latestStoreErrors.lastWriteError,
        configStateLoadError,
        reasons,
      };

      if (reasons.length === 0) {
        deps.logDebug("model-manager-state-ok", payload);
        return;
      }

      deps.logEssential("model-manager-state-inconsistent", payload);
      await deps.showErrorWithActions(
        deps.t("model.diagnostics.title"),
        deps.t("model.diagnostics.message"),
        {
          detailTitle: deps.t("model.diagnostics.title"),
          detail: buildModelManagerDiagnosticsDetail(payload, deps),
        }
      );
    } catch (error) {
      deps.logError("model-manager-inspection-failed", {
        error: deps.errorToMessage(error),
      });
      await deps.showErrorWithActions(deps.t("model.diagnostics.title"), error);
    }
  };
}
