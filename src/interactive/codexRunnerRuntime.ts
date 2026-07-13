import * as fs from "fs";
import * as path from "path";
import { InteractiveMode, ThinkingMode } from "../cli/types";
import {
  extractCodexCollabToolFailure,
  extractCodexItemTraceCandidate,
  extractCodexSubagentLifecycleUpdates,
  isCodexFinalAnswerAgentMessage,
  type CodexCollabToolFailure,
  type CodexItemTraceEventType,
  type CodexSubagentUpdate,
} from "./codexAppServerEvents";
import {
  extractDelta,
  extractItemErrorMessage,
  extractReasoningText,
  normalizeTodoListItems,
  toExecLikeItem,
} from "./codexAppServerProtocol";
import { detectCodexRateLimitErrorMessage } from "./codexErrorClassifier";

export type CodexThreadOptions = {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: string;
  model?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  additionalDirectories?: string[];
  webSearchEnabled?: boolean;
  webSearchMode?: string;
  networkAccessEnabled?: boolean;
  multiAgentEnabled?: boolean;
};

export type CodexRuntimeTraceKind = "thinking" | "normal";

export type CodexRuntimeTraceMeta = {
  merge?: boolean;
};

export type CodexRuntimeItemEventHandlers = {
  onAssistantDelta: (chunk: string, meta?: { codexFinalAnswer?: boolean }) => void;
  onTrace: (content: string, kind?: CodexRuntimeTraceKind, meta?: CodexRuntimeTraceMeta) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onSubagentUpdate?: (update: CodexSubagentUpdate) => void;
};

export type CodexTurnAssistantObserver = {
  emit: CodexRuntimeItemEventHandlers["onAssistantDelta"];
  promoteCommentaryOnCompletedTurn: (
    turnStatus: unknown,
    allowCompletedTurnFallback: boolean
  ) => boolean;
};

export function createCodexTurnAssistantObserver(
  onAssistantDelta: CodexRuntimeItemEventHandlers["onAssistantDelta"]
): CodexTurnAssistantObserver {
  let observedNonEmptyText = false;
  let observedFinalAnswer = false;

  const emit: CodexRuntimeItemEventHandlers["onAssistantDelta"] = (chunk, meta) => {
    if (chunk.trim()) {
      observedNonEmptyText = true;
    }
    if (meta?.codexFinalAnswer === true) {
      observedFinalAnswer = true;
    }
    onAssistantDelta(chunk, meta);
  };

  return {
    emit,
    promoteCommentaryOnCompletedTurn: (turnStatus, allowCompletedTurnFallback) => {
      if (
        !allowCompletedTurnFallback
        || String(turnStatus || "").trim() !== "completed"
        || !observedNonEmptyText
        || observedFinalAnswer
      ) {
        return false;
      }
      observedFinalAnswer = true;
      onAssistantDelta("", { codexFinalAnswer: true });
      return true;
    },
  };
}

export function createCodexAbortError(): Error {
  const error = new Error("Codex run aborted");
  error.name = "AbortError";
  return error;
}

export function createCodexRunnerDisposedError(message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.name = "RunnerDisposedError";
  error.code = "RUNNER_DISPOSED";
  return error;
}

const CODEX_APP_SERVER_CLIENT_NAME = "codex";
const CODEX_APP_SERVER_CLIENT_TITLE = "Codex";
const CODEX_APP_SERVER_CLIENT_VERSION_FALLBACK = "0.0.0";
const CODEX_PACKAGE_NAME_PREFIX = "@openai/codex";
const CODEX_PACKAGE_VERSION_SEARCH_DEPTH = 8;
const CODEX_AGENT_JOB_MAX_RUNTIME_SECONDS = 24 * 60 * 60;

export function pickArgValue(args: string[], keys: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (keys.includes(arg) && index + 1 < args.length) {
      return args[index + 1] ?? null;
    }
  }
  return null;
}

export function hasFlag(args: string[], keys: string[]): boolean {
  return args.some((arg) => keys.includes(arg));
}

export function collectArgValues(args: string[], keys: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (keys.includes(args[index]) && index + 1 < args.length) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function resolveCodexPackageVersionFromCommand(commandPath: string): string | null {
  const normalizedCommandPath = String(commandPath || "").trim();
  if (!normalizedCommandPath) {
    return null;
  }

  const candidatePaths = new Set<string>([normalizedCommandPath]);
  try {
    candidatePaths.add(fs.realpathSync(normalizedCommandPath));
  } catch {
    // keep scanning from the original path when realpath is unavailable
  }

  for (const candidatePath of candidatePaths) {
    let currentDir = path.dirname(candidatePath);
    for (let depth = 0; depth < CODEX_PACKAGE_VERSION_SEARCH_DEPTH; depth += 1) {
      const packageJsonPath = path.join(currentDir, "package.json");
      const packageJson = readJsonObject(packageJsonPath);
      const packageName = typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
      const packageVersion = typeof packageJson?.version === "string" ? packageJson.version.trim() : "";
      if (packageName.startsWith(CODEX_PACKAGE_NAME_PREFIX) && packageVersion) {
        return packageVersion;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  return null;
}

export function buildCodexAppServerClientInfo(commandPath: string): {
  name: string;
  title: string;
  version: string;
} {
  return {
    name: CODEX_APP_SERVER_CLIENT_NAME,
    title: CODEX_APP_SERVER_CLIENT_TITLE,
    version: resolveCodexPackageVersionFromCommand(commandPath) ?? CODEX_APP_SERVER_CLIENT_VERSION_FALLBACK,
  };
}

export function mapCodexReasoningEffort(mode: ThinkingMode): string {
  if (mode === "max") {
    return "max";
  }
  if (mode === "xhigh") {
    return "xhigh";
  }
  if (mode === "ultra") {
    return "ultra";
  }
  if (mode === "high") {
    return "high";
  }
  if (mode === "medium") {
    return "medium";
  }
  if (mode === "low" || mode === "off" || mode === "on") {
    return "low";
  }
  return "medium";
}

export function buildCodexThreadOptions(
  args: string[],
  cwd: string | undefined,
  thinkingMode: ThinkingMode,
  interactiveMode: InteractiveMode,
  modelOverride?: string | null,
  multiAgentEnabled = true
): CodexThreadOptions {
  const options: CodexThreadOptions = {
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    modelReasoningEffort: mapCodexReasoningEffort(thinkingMode),
    multiAgentEnabled,
  };

  const model = typeof modelOverride === "string" && modelOverride.trim()
    ? modelOverride.trim()
    : pickArgValue(args, ["--model", "-m"]);
  if (model) {
    options.model = model;
  }

  if (hasFlag(args, ["--dangerously-bypass-approvals-and-sandbox"])) {
    options.approvalPolicy = "never";
    options.sandboxMode = "danger-full-access";
  } else {
    const approval = pickArgValue(args, ["--ask-for-approval", "-a"]);
    if (approval) {
      options.approvalPolicy = approval;
    }
    const sandbox = pickArgValue(args, ["--sandbox", "-s"]);
    if (sandbox) {
      options.sandboxMode = sandbox;
    }
  }

  const additionalDirectories = collectArgValues(args, ["--add-dir"])
    .map((item) => item.trim())
    .filter(Boolean);
  if (additionalDirectories.length) {
    options.additionalDirectories = additionalDirectories;
  }

  const enableWebSearch = args.some(
    (arg, index) => arg === "--search"
      || (arg === "--enable" && args[index + 1] === "web_search_request")
  );
  if (enableWebSearch) {
    options.webSearchEnabled = true;
    options.webSearchMode = "live";
    options.networkAccessEnabled = true;
  }

  if (interactiveMode === "plan") {
    options.sandboxMode = "read-only";
    options.approvalPolicy = "untrusted";
  }

  return options;
}

export function buildCodexAppServerArgs(
  multiAgentEnabled: boolean,
  configOverrides: string[] = []
): string[] {
  const args = [
    "app-server",
    ...configOverrides.flatMap((override) => ["-c", override]),
    "--listen",
    "stdio://",
  ];
  if (!multiAgentEnabled) {
    args.push("--disable", "multi_agent");
  }
  return args;
}

export function buildCodexTurnInput(prompt: string, imagePaths: string[]): unknown[] {
  const inputs: unknown[] = [{ type: "text", text: prompt, text_elements: [] }];
  imagePaths.forEach((imagePath) => {
    if (imagePath.trim()) {
      inputs.push({ type: "localImage", path: imagePath.trim() });
    }
  });
  return inputs;
}

export function buildCodexAppServerConfig(options: CodexThreadOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {
    agents: {
      job_max_runtime_seconds: CODEX_AGENT_JOB_MAX_RUNTIME_SECONDS,
    },
  };
  if (options.multiAgentEnabled === false) {
    config.features = {
      multi_agent: false,
    };
  }
  if (typeof options.webSearchMode === "string" && options.webSearchMode) {
    config.web_search = options.webSearchMode;
  } else if (options.webSearchEnabled === true) {
    config.web_search = "live";
  } else if (options.webSearchEnabled === false) {
    config.web_search = "disabled";
  }
  return config;
}

export function buildCodexAppServerSandboxMode(sandboxMode?: string): string {
  const normalized = String(sandboxMode || "").trim();
  if (["read-only", "workspace-write", "danger-full-access"].includes(normalized)) {
    return normalized;
  }
  return "workspace-write";
}

export function buildCodexAppServerSandboxPolicy(options: CodexThreadOptions): Record<string, unknown> {
  const sandboxMode = buildCodexAppServerSandboxMode(options.sandboxMode);
  const networkAccess = options.networkAccessEnabled === true;

  if (sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  if (sandboxMode === "read-only") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess,
    };
  }

  const writableRoots = Array.from(
    new Set(
      [options.workingDirectory, ...(options.additionalDirectories ?? [])]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );

  return {
    type: "workspaceWrite",
    writableRoots,
    readOnlyAccess: { type: "fullAccess" },
    networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export function buildCodexAppServerInitializeParams(commandPath: string): Record<string, unknown> {
  return {
    clientInfo: buildCodexAppServerClientInfo(commandPath),
    capabilities: {
      experimentalApi: false,
      optOutNotificationMethods: [],
    },
  };
}

export function buildCodexThreadParams(options: CodexThreadOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {
    cwd: options.workingDirectory,
    sandbox: buildCodexAppServerSandboxMode(options.sandboxMode),
    config: buildCodexAppServerConfig(options),
    experimentalRawEvents: false,
    persistExtendedHistory: false,
  };
  if (options.model) {
    params.model = options.model;
  }
  if (options.approvalPolicy) {
    params.approvalPolicy = options.approvalPolicy;
  }
  return params;
}

export function buildCodexTurnStartParams(
  threadId: string | null,
  prompt: string,
  imagePaths: string[],
  options: CodexThreadOptions
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    threadId,
    input: buildCodexTurnInput(prompt, imagePaths),
    cwd: options.workingDirectory,
    sandboxPolicy: buildCodexAppServerSandboxPolicy(options),
  };
  if (options.model) {
    params.model = options.model;
  }
  if (options.modelReasoningEffort) {
    params.effort = options.modelReasoningEffort;
  }
  if (options.approvalPolicy) {
    params.approvalPolicy = options.approvalPolicy;
  }
  return params;
}

export function emitCodexTodoListUpdate(
  items: unknown[],
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void
): void {
  const normalizedItems = normalizeTodoListItems(items);
  if (normalizedItems.length) {
    onTaskListUpdate(normalizedItems);
  }
}

export function shouldEmitItemTraceCandidate(
  emittedTraceContents: Map<string, string>,
  itemType: string,
  itemId: string,
  content: string
): boolean {
  const normalizedType = itemType.trim();
  const normalizedId = itemId.trim();
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return false;
  }
  if (!normalizedType || !normalizedId) {
    return true;
  }
  const dedupKey = `${normalizedType}:${normalizedId}`;
  const previousContent = emittedTraceContents.get(dedupKey);
  if (previousContent === normalizedContent) {
    return false;
  }
  emittedTraceContents.set(dedupKey, normalizedContent);
  return true;
}

function formatFileChangeTrace(item: Record<string, unknown>): string {
  const status = typeof item.status === "string" ? item.status : "";
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const lines = changes
    .map((change) => {
      const record = change && typeof change === "object"
        ? change as Record<string, unknown>
        : {};
      const changePath = typeof record.path === "string" ? record.path : "";
      const changeKind = typeof record.kind === "string" ? record.kind : "update";
      return changePath ? `${changeKind}: ${changePath}` : "";
    })
    .filter(Boolean);
  return ["file update", status ? `status: ${status}` : "", ...lines].filter(Boolean).join("\n");
}

function emitTraceCandidate(
  rawItem: Record<string, unknown>,
  eventType: CodexItemTraceEventType,
  expectedItemType: string,
  emittedTraceContents: Map<string, string>,
  onTrace: CodexRuntimeItemEventHandlers["onTrace"]
): void {
  const traceCandidate = extractCodexItemTraceCandidate(rawItem, eventType);
  if (!traceCandidate || traceCandidate.itemType !== expectedItemType) {
    return;
  }
  if (!shouldEmitItemTraceCandidate(
    emittedTraceContents,
    traceCandidate.itemType,
    traceCandidate.itemId,
    traceCandidate.content
  )) {
    return;
  }
  onTrace(traceCandidate.content, "normal", { merge: false });
}

export function handleCodexItemEvent(options: {
  eventType: CodexItemTraceEventType;
  rawItem: unknown;
  threadId?: string;
  primaryThreadId?: string;
  assistantBuffers: Map<string, string>;
  emittedTraceContents: Map<string, string>;
  handlers: CodexRuntimeItemEventHandlers;
  onVisibleError: (message: string) => void;
  formatCollabToolFailure: (failure: CodexCollabToolFailure) => string;
}): void {
  const {
    eventType,
    rawItem,
    threadId,
    primaryThreadId,
    assistantBuffers,
    emittedTraceContents,
    handlers,
    onVisibleError,
    formatCollabToolFailure,
  } = options;
  const item = toExecLikeItem(rawItem);
  const itemType = String(item.type || "").trim();
  const normalizedThreadId = String(threadId || "").trim();
  const normalizedPrimaryThreadId = String(primaryThreadId || "").trim();
  const isSubagentThread = Boolean(
    normalizedThreadId
    && normalizedPrimaryThreadId
    && normalizedThreadId !== normalizedPrimaryThreadId
  );

  extractCodexSubagentLifecycleUpdates(item).forEach((update) => {
    handlers.onSubagentUpdate?.(update);
  });

  if (isSubagentThread) {
    const itemId = String(item.id || "").trim();
    const bufferKey = itemId ? `${normalizedThreadId}:${itemId}` : "";
    if (itemType === "agent_message" && eventType === "item.completed") {
      const nextText = typeof item.text === "string" ? item.text : "";
      const previousText = bufferKey ? (assistantBuffers.get(bufferKey) ?? "") : "";
      const delta = extractDelta(previousText, nextText);
      handlers.onSubagentUpdate?.({
        threadId: normalizedThreadId,
        status: "running",
        ...(delta ? { delta } : {}),
      });
      if (bufferKey) {
        assistantBuffers.delete(bufferKey);
      }
      return;
    }
    if (itemType === "error") {
      const message = typeof item.message === "string"
        ? item.message.trim()
        : extractItemErrorMessage(item);
      handlers.onSubagentUpdate?.({
        threadId: normalizedThreadId,
        status: "failed",
        ...(message ? { error: message } : {}),
      });
      return;
    }
    handlers.onSubagentUpdate?.({ threadId: normalizedThreadId, status: "running" });
    return;
  }

  if (itemType === "agent_message") {
    if (eventType === "item.completed") {
      const itemId = String(item.id || "").trim();
      const nextText = typeof item.text === "string" ? item.text : "";
      const previousText = itemId ? (assistantBuffers.get(itemId) ?? "") : "";
      const delta = extractDelta(previousText, nextText);
      const codexFinalAnswer = isCodexFinalAnswerAgentMessage(item);
      if (delta || codexFinalAnswer) {
        handlers.onAssistantDelta(delta, codexFinalAnswer ? { codexFinalAnswer: true } : undefined);
      }
      if (itemId) {
        assistantBuffers.delete(itemId);
      }
    }
    return;
  }

  if (itemType === "todo_list") {
    emitCodexTodoListUpdate(Array.isArray(item.items) ? item.items : [], handlers.onTaskListUpdate);
    return;
  }

  if (itemType === "reasoning") {
    const text = extractReasoningText(item);
    if (text) {
      handlers.onTrace(text, "thinking");
    }
    return;
  }

  if (itemType === "command_execution" || itemType === "mcp_tool_call" || itemType === "web_search") {
    emitTraceCandidate(item, eventType, itemType, emittedTraceContents, handlers.onTrace);
    return;
  }

  if (itemType === "file_change") {
    if (eventType === "item.completed") {
      handlers.onTrace(formatFileChangeTrace(item));
    }
    return;
  }

  if (itemType === "dynamic_tool_call") {
    if (eventType !== "item.completed") {
      return;
    }
    const tool = typeof item.tool === "string" ? item.tool.trim() : "";
    const status = typeof item.status === "string" ? item.status.trim() : "";
    handlers.onTrace(["tool", tool, status ? `status: ${status}` : ""].filter(Boolean).join("\n"));
    return;
  }

  if (itemType === "collab_agent_tool_call") {
    if (eventType !== "item.completed") {
      return;
    }
    const tool = typeof item.tool === "string" ? item.tool.trim() : "subtask";
    const status = typeof item.status === "string" ? item.status.trim() : "";
    handlers.onTrace(["subtask", tool, status ? `status: ${status}` : ""].filter(Boolean).join("\n"));
    const failure = extractCodexCollabToolFailure(item);
    if (failure) {
      onVisibleError(formatCollabToolFailure(failure));
    }
    return;
  }

  if (itemType === "error") {
    const message = typeof item.message === "string"
      ? item.message.trim()
      : extractItemErrorMessage(item);
    const rateLimitMessage = detectCodexRateLimitErrorMessage(item) ?? detectCodexRateLimitErrorMessage(message);
    if (rateLimitMessage) {
      onVisibleError(rateLimitMessage);
      return;
    }
    if (message) {
      onVisibleError(message);
    }
  }
}
