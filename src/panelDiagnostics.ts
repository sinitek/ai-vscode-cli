import * as path from "path";
import * as vscode from "vscode";
import { CliName, normalizeLoopExecutionMode } from "./cli/types";
import {
  buildHiddenRetryAttemptInfo,
  buildHiddenRetryErrorTraceContent,
  buildHiddenRetryProgressInfo,
  getHiddenRetryDelayMs,
  HIDDEN_RETRY_DELAY_SEQUENCE_MS,
  isSameHiddenRetryErrorTraceContent,
} from "./hiddenRetry";
import { t } from "./i18n";
import { ChatMessage, PanelMessage, type ChatMessageAction } from "./webview/types";
import { type ConfigItem } from "./config/types";
import { type CliModelStore } from "./modelSelectionStore";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import {
  LoopDebateChatPanel,
  type LoopDebateChatPanelMessage,
  type LoopDebateChatPanelState,
} from "./webview/loopDebatePanel";
import {
  buildLoopDebateChatMessageActionWithRoundKey,
  buildLoopDebateChatPanelStateWithDeps,
} from "./panelStateBuilder";
import { resolveLoopTaskRunControlState } from "./loopDebate";
import {
  type LoopTaskRecord,
} from "./loopTaskStore";
import { isLoopMainAiFailureLimitReached } from "./loopMainFailure";
import { appendMessageToStore, type LoopTaskRole } from "./promptRunState";

type InspectModelManagerMessage = Extract<PanelMessage, { type: "inspectModelManager" }>;

export const HIDDEN_RETRY_MAX_RETRIES = HIDDEN_RETRY_DELAY_SEQUENCE_MS.length;
const LOOP_RESUME_PROMPT_MAX_LENGTH = 48;
const LOOP_RESUME_PROMPT_PATTERNS: RegExp[] = [
  /^继续(?:执行|进行|下去|一下|一下子|任务|主任务|这个任务|当前任务|上一轮|上轮|吧)?$/u,
  /^接着(?:执行|做|继续|下去|往下)?$/u,
  /^续上$/u,
  /^continue(?:\s+(?:please|task|run|loop|main|main\s+task))?$/i,
  /^resume(?:\s+(?:please|task|run|loop|main|main\s+task))?$/i,
  /^go\s*on$/i,
  /^carry\s*on$/i,
  /^keep\s*going$/i,
  /^proceed$/i,
];

export type ErrorInfo = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
};

export type CliAttemptResult =
  | { type: "exit"; code: number | null }
  | { type: "error"; error: Error };

export type RetryErrorTraceMessageOptions = {
  tabId?: string;
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
};

export type LoopVerificationState = "yes" | "no" | "unknown";

export type LoopVerificationSignals = {
  unitTest: LoopVerificationState;
  build: LoopVerificationState;
  unitTestEvidence?: string;
  buildEvidence?: string;
};

export type LoopTaskCompletionMessagesState = {
  hasAnswerConclusion: boolean;
  hasFinalSummary: boolean;
};

type HiddenRetryTraceDeps = {
  createMessageId: () => string;
  sendPanelMessage: (payload: { type: "appendMessage"; message: ChatMessage; tabId?: string }) => void;
};

export function getErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const code = typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: unknown }).code)
      : undefined;
    return {
      message: error.message,
      name: error.name,
      code,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown; code?: unknown; stack?: unknown };
    const message = typeof record.message === "string" ? record.message : String(error);
    const name = typeof record.name === "string" ? record.name : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    return { message, name, code, stack };
  }
  return { message: String(error) };
}

export function getAttemptFailureMessage(attemptResult: CliAttemptResult, resultErrorText?: string | null): string {
  if (attemptResult.type === "error") {
    const info = getErrorInfo(attemptResult.error);
    return info.message || t("common.unknownError");
  }
  const normalizedResultError = typeof resultErrorText === "string" && resultErrorText.trim()
    ? resultErrorText.trim()
    : null;
  return normalizedResultError ?? t("run.exitCode", { code: attemptResult.code ?? "unknown" });
}

export function createHiddenRetryErrorTraceMessage(
  lastFailureMessage: string,
  options: RetryErrorTraceMessageOptions,
  deps: Pick<HiddenRetryTraceDeps, "createMessageId">,
): ChatMessage {
  const content = buildHiddenRetryErrorTraceContent(lastFailureMessage, t("common.unknownError"));
  return {
    id: deps.createMessageId(),
    role: "trace",
    content,
    createdAt: Date.now(),
    kind: "normal",
    merge: false,
    taskRole: options.taskRole,
    loopTaskId: options.loopTaskId,
    loopRound: options.loopRound,
    loopSubtaskId: options.loopSubtaskId,
  };
}

export function appendHiddenRetryErrorTraceMessage(
  target: ChatMessage[] | null | undefined,
  lastFailureMessage: string,
  options: RetryErrorTraceMessageOptions,
  deps: HiddenRetryTraceDeps,
): void {
  if (!target) {
    return;
  }
  const last = target[target.length - 1];
  if (last?.role === "trace" && isSameHiddenRetryErrorTraceContent(last.content, lastFailureMessage, t("common.unknownError"))) {
    return;
  }
  const message = createHiddenRetryErrorTraceMessage(lastFailureMessage, options, deps);
  appendMessageToStore(target, message);
  deps.sendPanelMessage({
    type: "appendMessage",
    message,
    ...(options.tabId ? { tabId: options.tabId } : {}),
  });
}

export function isAbortErrorInfo(info: ErrorInfo): boolean {
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message ?? ""}`.toLowerCase();
  return combined.includes("abort");
}

const NON_RETRYABLE_BILLING_ERROR_CODES = new Set([
  "402",
  "HTTP_402",
  "PAYMENT_REQUIRED",
  "INSUFFICIENT_CREDITS",
  "INSUFFICIENT_BALANCE",
]);

const NON_RETRYABLE_BILLING_ERROR_PATTERNS = [
  /\b(?:unexpected\s+)?status\s*:?[\s=]*402\b/i,
  /\bhttp(?:\s+status)?\s*:?[\s=]*402\b/i,
  /\b402\s+payment required\b/i,
  /\bpayment required\b/i,
  /\binsufficient\s+(?:credits?|balance|points?)\b/i,
  /\b(?:credits?|balance|points?)\s+(?:exhausted|depleted)\b/i,
  /\brequires?\s+\d+(?:\.\d+)?\s+points?\b[\s\S]*\bremaining\s+0(?![\d.])/i,
] as const;

export function isNonRetryableBillingErrorInfo(info: ErrorInfo): boolean {
  const normalizedCode = String(info.code ?? "").trim().toUpperCase();
  if (NON_RETRYABLE_BILLING_ERROR_CODES.has(normalizedCode)) {
    return true;
  }
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message ?? ""}`;
  return NON_RETRYABLE_BILLING_ERROR_PATTERNS.some((pattern) => pattern.test(combined));
}

export function isHiddenRetryEligibleErrorInfo(info: ErrorInfo): boolean {
  if (info.name === "AbortError" || info.code === "RUNNER_DISPOSED" || !info.message || isAbortErrorInfo(info)) {
    return false;
  }
  if (isNonRetryableBillingErrorInfo(info)) {
    return false;
  }
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message}`.toLowerCase();
  if ((info.code ?? "").toUpperCase() === "ENOENT" || combined.includes("enoent")) {
    return false;
  }
  return true;
}

export function isHiddenRetryEligibleAttempt(
  attemptResult: CliAttemptResult,
  failureMessage: string,
): boolean {
  if (isNonRetryableBillingErrorInfo({ message: failureMessage })) {
    return false;
  }
  return attemptResult.type === "exit"
    || isHiddenRetryEligibleErrorInfo(getErrorInfo(attemptResult.error));
}

export async function waitForHiddenRetryDelay(
  retryNumber: number,
  isRunActive: () => boolean
): Promise<boolean> {
  const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
  const deadline = Date.now() + retryDelayMs;
  while (Date.now() < deadline) {
    if (!isRunActive()) {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  return isRunActive();
}

export function buildHiddenRetryLimitMessage(): string {
  return t("run.hiddenRetryLimitReached", {
    attempts: HIDDEN_RETRY_MAX_RETRIES,
    delays: HIDDEN_RETRY_DELAY_SEQUENCE_MS.map(formatHiddenRetryDelay).join(" / "),
  });
}

export function buildHiddenRetryQueuedMessage(hiddenRetryCount: number): string {
  const retryNumber = hiddenRetryCount + 1;
  const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
  const progress = buildHiddenRetryProgressInfo(
    hiddenRetryCount,
    HIDDEN_RETRY_MAX_RETRIES,
    retryDelayMs,
  );
  return t("run.hiddenRetryQueued", {
    attempt: progress.retryNumber,
    attempts: progress.maxRetries,
    seconds: progress.retryDelaySeconds,
    delay: formatHiddenRetryDelay(retryDelayMs),
  });
}

export function buildHiddenRetryStartedMessage(retryNumber: number): string {
  const attemptInfo = buildHiddenRetryAttemptInfo(retryNumber, HIDDEN_RETRY_MAX_RETRIES);
  return t("run.hiddenRetryStarted", {
    attempt: attemptInfo.retryNumber,
    attempts: attemptInfo.maxRetries,
  });
}

function formatHiddenRetryDelay(retryDelayMs: number): string {
  if (retryDelayMs >= 60 * 1000 && retryDelayMs % (60 * 1000) === 0) {
    return `${retryDelayMs / (60 * 1000)} ${t("duration.minutes")}`;
  }
  return `${Math.max(0, Math.ceil(retryDelayMs / 1000))} ${t("duration.seconds")}`;
}

export function normalizeLoopResumePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/[，,。.!！?？;；:：~～]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLoopResumePrompt(prompt: string): boolean {
  const normalized = normalizeLoopResumePrompt(prompt);
  if (!normalized || normalized.length > LOOP_RESUME_PROMPT_MAX_LENGTH) {
    return false;
  }
  return LOOP_RESUME_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function collectRecentLoopTaskIdsFromMessages(messages: readonly ChatMessage[], limit = 12): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const taskId = typeof messages[index]?.loopTaskId === "string"
      ? messages[index]?.loopTaskId?.trim()
      : "";
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    ids.push(taskId);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

export function isLoopTaskResumable(task: LoopTaskRecord): boolean {
  return !isLoopMainAiFailureLimitReached(task)
    && (task.status === "error" || task.status === "stopped" || task.status === "running");
}

export function isLoopTaskSessionCompatible(
  task: LoopTaskRecord,
  targetSessionId: string | null,
  options: { allowMissingTaskSessionId?: boolean } = {}
): boolean {
  if (!targetSessionId) {
    return !task.sessionId;
  }
  if (task.sessionId === targetSessionId) {
    return true;
  }
  return options.allowMissingTaskSessionId === true && !task.sessionId;
}

export function formatLoopVerificationState(state: LoopVerificationState): string {
  if (state === "yes") {
    return "已完成";
  }
  if (state === "no") {
    return "未完成";
  }
  return "未明确";
}

export function detectLoopVerificationSignals(content: string): LoopVerificationSignals {
  const unitTest = detectLoopVerificationState(content, "unitTest");
  const build = detectLoopVerificationState(content, "build");
  return {
    unitTest: unitTest.state,
    build: build.state,
    unitTestEvidence: unitTest.evidence,
    buildEvidence: build.evidence,
  };
}

function detectLoopVerificationState(
  content: string,
  kind: "unitTest" | "build"
): { state: LoopVerificationState; evidence?: string } {
  const normalized = String(content || "").trim();
  if (!normalized) {
    return { state: "unknown" };
  }

  const lineCandidates = normalized
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const negativePatterns = kind === "unitTest"
    ? [
        /(?:未|没有|暂未|未能)\S{0,10}(?:单测|单元测试|测试)/i,
        /(?:单测|单元测试|测试)\S{0,10}(?:未执行|未跑|未做|失败|fail)/i,
        /\b(skip|skipped)\b.{0,16}\btest/i,
      ]
    : [
        /(?:未|没有|暂未|未能)\S{0,10}(?:编译|构建|build)/i,
        /(?:编译|构建|build)\S{0,10}(?:未执行|失败|fail)/i,
      ];
  const positivePatterns = kind === "unitTest"
    ? [
        /(?:已|完成|执行|运行|跑)\S{0,10}(?:单测|单元测试)/i,
        /(?:单测|单元测试)\S{0,12}(?:通过|成功|pass|passed|ok)/i,
        /\b(?:npm|pnpm|yarn)\s+test\b/i,
        /\b(?:jest|vitest|mocha|pytest|go test)\b/i,
      ]
    : [
        /(?:已|完成|执行|运行|跑)\S{0,10}(?:编译|构建|build)/i,
        /(?:编译|构建|build)\S{0,12}(?:通过|成功|pass|passed|ok)/i,
        /\b(?:npm|pnpm|yarn)\s+run\s+build\b/i,
        /\btsc\b/i,
      ];

  const negativeEvidence = findFirstEvidenceLine(lineCandidates, negativePatterns);
  if (negativeEvidence) {
    return { state: "no", evidence: negativeEvidence };
  }
  const positiveEvidence = findFirstEvidenceLine(lineCandidates, positivePatterns);
  if (positiveEvidence) {
    return { state: "yes", evidence: positiveEvidence };
  }
  return { state: "unknown" };
}

function findFirstEvidenceLine(lines: string[], patterns: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return line.length > 180 ? `${line.slice(0, 180)}...` : line;
      }
    }
  }
  return undefined;
}

export function getLoopCompletionMessagesState(
  messages: readonly ChatMessage[],
  taskId: string,
): LoopTaskCompletionMessagesState {
  return messages.reduce<LoopTaskCompletionMessagesState>((state, message) => {
    if (isLoopAnswerConclusionMessageForTask(message, taskId)) {
      state.hasAnswerConclusion = true;
    }
    if (isLoopFinalSummaryMessageForTask(message, taskId) && isCompleteLoopFinalSummaryContent(message.content)) {
      state.hasFinalSummary = true;
    }
    return state;
  }, { hasAnswerConclusion: false, hasFinalSummary: false });
}

export function hasCompleteLoopCompletionMessages(messages: readonly ChatMessage[], taskId: string): boolean {
  const state = getLoopCompletionMessagesState(messages, taskId);
  return state.hasAnswerConclusion && state.hasFinalSummary;
}

export function isLoopAnswerConclusionMessageForTask(message: ChatMessage, taskId: string): boolean {
  return message.role === "assistant"
    && message.taskRole === "main"
    && message.loopTaskId === taskId
    && message.loopAnswerConclusion === true
    && typeof message.content === "string"
    && message.content.trim().length > 0;
}

export function isLoopFinalSummaryMessageForTask(message: ChatMessage, taskId: string): boolean {
  return message.role === "assistant"
    && message.taskRole === "main"
    && message.loopTaskId === taskId
    && message.loopFinalSummary === true
    && typeof message.content === "string"
    && message.content.trim().length > 0;
}

export function isCompleteLoopFinalSummaryContent(content: string): boolean {
  return /(?:^|\n)##\s+问题回答结论(?:\n|$)/u.test(content)
    && /(?:^|\n)##\s+整体任务总结(?:\n|$)/u.test(content);
}

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

type LoopPromptRunInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  model?: string;
  loopExecutionMode: ReturnType<typeof normalizeLoopExecutionMode>;
  loopContinuePrompt: string;
};

type LoopPromptRunOptions = {
  targetTabId: string | null;
  resumeTaskId: string;
  resumeRequested: boolean;
};

type LoopPromptTarget = {
  tabId: string | null;
};

type LoopDebateChatPanelDeps = {
  getExtensionUri: () => vscode.Uri;
  panelsByTaskId: Map<string, LoopDebateChatPanel>;
  defaultDebateRound: number;
  normalizeTaskId: (value: unknown) => string | null;
  normalizeSupplementalRequirement: (value: unknown) => string | null;
  appendSupplementalRequirement: (existing: readonly string[] | undefined, nextItem: string) => string[];
  appendSupplementalRequirementToCommunication: (task: LoopTaskRecord, requirement: string) => void;
  readTaskRecord: (taskId: string) => LoopTaskRecord | null;
  updateTaskRecord: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  listTaskStoreFiles: () => string[];
  readTaskStoreTasks: (filePath: string) => LoopTaskRecord[];
  collectRunningTaskIds: () => Set<string>;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  fileExists: (filePath: string) => boolean;
  writeTextFileEnsuringDir: (filePath: string, content: string) => boolean;
  getActiveSubtaskIds: (task: LoopTaskRecord) => string[];
  buildCompletedConclusionAndSummaryMarkdown: (task: LoopTaskRecord) => string;
  resolveMainPromptTarget: (task: LoopTaskRecord) => LoopPromptTarget | null;
  revealPanelView: () => Promise<void>;
  switchVisibleConversationTabForLoop: (tabId: string | null) => Promise<void>;
  isTabRunActive: (tabId: string | null) => boolean;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  runLoopPrompt: (input: LoopPromptRunInput, options: LoopPromptRunOptions) => Promise<void>;
  stopRunsForTask: (taskId: string) => void;
  markTaskStoppedByUser: (taskId: string) => LoopTaskRecord | null;
  postPanelState: () => Promise<void>;
  getActiveConversationTaskId: () => string | null;
  showInformationMessage: (message: string) => void;
  showWarningMessage: (message: string) => void;
  pickTask: (tasks: LoopTaskRecord[]) => Promise<LoopTaskRecord | null>;
  t: typeof import("./i18n").t;
};

function buildLoopDebateChatPanelState(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelDeps,
): LoopDebateChatPanelState {
  return buildLoopDebateChatPanelStateWithDeps(task, {
    collectRunningLoopTaskIds: deps.collectRunningTaskIds,
    readTextFileIfNonEmpty: deps.readTextFileIfNonEmpty,
    fileExists: deps.fileExists,
    writeTextFileEnsuringDir: deps.writeTextFileEnsuringDir,
    getActiveLoopSubtaskIds: deps.getActiveSubtaskIds,
    buildLoopCompletedConclusionAndSummaryMarkdown: deps.buildCompletedConclusionAndSummaryMarkdown,
    t: deps.t,
  });
}

function extractLoopDebateChatPanelTaskId(
  arg: unknown,
  deps: LoopDebateChatPanelDeps,
): string | null {
  if (typeof arg === "string") {
    return deps.normalizeTaskId(arg);
  }
  if (arg && typeof arg === "object" && !Array.isArray(arg)) {
    return deps.normalizeTaskId((arg as { taskId?: unknown }).taskId);
  }
  return null;
}

function normalizeLoopContinuePrompt(value: unknown, deps: LoopDebateChatPanelDeps): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || deps.t("run.hiddenContinuePrompt");
}

function listLoopGroupChatTasks(deps: LoopDebateChatPanelDeps): LoopTaskRecord[] {
  const tasksById = new Map<string, LoopTaskRecord>();
  deps.listTaskStoreFiles().forEach((filePath) => {
    deps.readTaskStoreTasks(filePath).forEach((task) => {
      const existing = tasksById.get(task.id);
      if (!existing || task.updatedAt > existing.updatedAt) {
        tasksById.set(task.id, task.taskStoreFile === filePath ? task : { ...task, taskStoreFile: filePath });
      }
    });
  });
  return Array.from(tasksById.values());
}

function listRecentLoopGroupChatTasks(limit: number, deps: LoopDebateChatPanelDeps): LoopTaskRecord[] {
  return listLoopGroupChatTasks(deps)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(1, limit));
}

function canStopLoopTaskWithRunningTaskIds(
  task: LoopTaskRecord,
  runningTaskIds: ReadonlySet<string>,
): boolean {
  return resolveLoopTaskRunControlState(task, runningTaskIds).canStop;
}

export function createLoopDebateChatPanelCoordinator(deps: LoopDebateChatPanelDeps) {
  const refresh = async (taskId: string): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return;
    }
    const panel = deps.panelsByTaskId.get(normalizedTaskId);
    if (!panel) {
      return;
    }
    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopDebateChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }
    panel.update(buildLoopDebateChatPanelState(task, deps));
  };

  const continueTask = async (taskId: string, prompt?: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopDebateChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopDebateChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }
    const controlState = resolveLoopTaskRunControlState(task, deps.collectRunningTaskIds());
    if (!controlState.canContinue) {
      await refresh(normalizedTaskId);
      deps.showInformationMessage(
        controlState.isRunning
          ? deps.t("loopDebateChat.continueAlreadyRunning")
          : deps.t("loopDebateChat.continueUnavailable")
      );
      return;
    }

    const target = deps.resolveMainPromptTarget(task);
    if (!target) {
      deps.showWarningMessage(deps.t("loopDebateChat.continueUnavailable"));
      return;
    }

    await deps.revealPanelView();
    await deps.switchVisibleConversationTabForLoop(target.tabId);
    if (deps.isTabRunActive(target.tabId)) {
      deps.showInformationMessage(deps.t("loopDebateChat.continueAlreadyRunning"));
      return;
    }

    const activeConfigId = deps.getActiveConfigIdForCli(task.cli);
    const resumePrompt = normalizeLoopContinuePrompt(prompt, deps);
    await deps.runLoopPrompt({
      displayPrompt: resumePrompt,
      modelPrompt: resumePrompt,
      contextTags: [],
      model: deps.getSelectedCliModel(task.cli, activeConfigId) ?? undefined,
      loopExecutionMode: normalizeLoopExecutionMode(task.executionMode),
      loopContinuePrompt: resumePrompt,
    }, {
      targetTabId: target.tabId,
      resumeTaskId: task.id,
      resumeRequested: true,
    });
    await refresh(normalizedTaskId);
  };

  const supplementTask = async (taskId: string, prompt?: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopDebateChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopDebateChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }

    const supplementalRequirement = deps.normalizeSupplementalRequirement(prompt);
    if (!supplementalRequirement) {
      deps.showInformationMessage(deps.t("loopDebateChat.continueUnavailable"));
      return;
    }

    const nextRequirements = deps.appendSupplementalRequirement(task.supplementalRequirements, supplementalRequirement);
    deps.updateTaskRecord(task.id, {
      supplementalRequirements: nextRequirements,
      updatedAt: Date.now(),
    });
    deps.appendSupplementalRequirementToCommunication(task, supplementalRequirement);
    await refresh(normalizedTaskId);
  };

  const stopTask = async (taskId: string): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopDebateChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopDebateChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }

    if (!canStopLoopTaskWithRunningTaskIds(task, deps.collectRunningTaskIds())) {
      await refresh(normalizedTaskId);
      deps.showInformationMessage(deps.t("loopDebateChat.stopUnavailable"));
      return;
    }

    deps.stopRunsForTask(task.id);
    deps.markTaskStoppedByUser(task.id);
    await deps.postPanelState();
    await refresh(normalizedTaskId);
  };

  const handleMessage = async (taskId: string, message: LoopDebateChatPanelMessage): Promise<void> => {
    if (!message || typeof message.type !== "string") {
      return;
    }
    if (message.type === "loopDebateChat:refresh") {
      await refresh(taskId);
      return;
    }
    if (message.type === "loopDebateChat:continueTask") {
      await continueTask(taskId, message.prompt);
      return;
    }
    if (message.type === "loopDebateChat:supplementTask") {
      await supplementTask(taskId, message.prompt);
      return;
    }
    if (message.type === "loopDebateChat:stopTask") {
      await stopTask(taskId);
    }
  };

  const resolveTask = async (arg?: unknown): Promise<LoopTaskRecord | null> => {
    const explicitTaskId = extractLoopDebateChatPanelTaskId(arg, deps);
    if (explicitTaskId) {
      const task = deps.readTaskRecord(explicitTaskId);
      if (task) {
        return task;
      }
      deps.showWarningMessage(deps.t("loopDebateChat.taskMissing", { taskId: explicitTaskId }));
    }

    const activeTaskId = deps.getActiveConversationTaskId();
    if (activeTaskId) {
      const activeTask = deps.readTaskRecord(activeTaskId);
      if (activeTask) {
        return activeTask;
      }
    }

    const recentTasks = listRecentLoopGroupChatTasks(24, deps);
    if (recentTasks.length === 0) {
      return null;
    }
    if (recentTasks.length === 1) {
      return recentTasks[0] ?? null;
    }
    return deps.pickTask(recentTasks);
  };

  const open = async (arg?: unknown): Promise<void> => {
    const task = await resolveTask(arg);
    if (!task) {
      deps.showInformationMessage(deps.t("loopDebateChat.noTask"));
      return;
    }
    const state = buildLoopDebateChatPanelState(task, deps);
    let panel = deps.panelsByTaskId.get(task.id);
    if (!panel) {
      const taskId = task.id;
      panel = new LoopDebateChatPanel(deps.getExtensionUri(), {
        onMessage: (message) => {
          void handleMessage(taskId, message);
        },
        onDispose: () => {
          const currentPanel = deps.panelsByTaskId.get(taskId);
          if (currentPanel === panel) {
            deps.panelsByTaskId.delete(taskId);
          }
        },
      });
      deps.panelsByTaskId.set(task.id, panel);
    }
    panel.show(state);
  };

  const refreshOpenPanelForTask = (taskId: string): void => {
    if (!deps.panelsByTaskId.has(taskId)) {
      return;
    }
    void refresh(taskId);
  };

  const buildMessageAction = (taskId: string, round?: number): ChatMessageAction => {
    return buildLoopDebateChatMessageActionWithRoundKey(
      taskId,
      deps.defaultDebateRound,
      round,
    );
  };

  return {
    open,
    refresh,
    refreshOpenPanelForTask,
    buildMessageAction,
    listGroupChatTasks: () => listLoopGroupChatTasks(deps),
  };
}
