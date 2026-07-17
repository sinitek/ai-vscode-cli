import {
  buildOpenCodeRunFailureMessage,
  buildProcessLabel,
  parseOpenCodeSessionId,
  parseOpenCodeRunOutput,
  resolveCliCommand,
  runCliStream,
  type RunProcess,
} from "./cli/commandRunner";
import { GEMINI_NATIVE_COMPACT_PROMPT } from "./cli/geminiCompaction";
import {
  finalizeGeminiStreamJsonRemainder,
  getGeminiEventDisplay,
  parseGeminiStreamJsonChunk,
  type GeminiStreamJsonEvent,
} from "./cli/geminiStreamJson";
import { buildGeminiThinkingRuntimeProfile } from "./cli/geminiThinking";
import { isClaudeNativeCompactUnsupportedError } from "./interactive/claudeCompaction";
import { ClaudeInteractiveRunner } from "./interactive/claudeRunner";
import type { InteractiveRunnerManager } from "./interactive/manager";
import {
  normalizeCodexRunSelection,
  type CodexRunSelection,
} from "./interactive/codexThreadSelection";
import { t } from "./i18n";
import { logError, logInfo, sanitizeEnv } from "./logger";
import { CliName, InteractiveMode, ThinkingMode } from "./cli/types";
import { ChatMessage } from "./webview/types";

type GeminiStreamJsonState = {
  remainder: string;
  assistantText: string;
  resultStatus: string | null;
  errorText: string | null;
};

type GeminiStreamJsonHandlers = {
  onAssistantText?: (text: string) => void;
  onTraceText?: (text: string) => void;
  onSessionId?: (sessionId: string) => void;
  onPlainText?: (text: string) => void;
};

type OpenCodeNativeCompactResult = {
  compacted: boolean;
  sessionId: string;
  finalText: string | null;
};

type OpenCodeRuntimeOptions = {
  openCodeVariant?: string | null;
  model?: string | null;
  openCodeSmallModel?: string | null;
  openCodeConfigContent?: string | null;
  envOverrides?: Record<string, string>;
};

const OPENCODE_NATIVE_COMPACT_COMMAND = "/compact";

function buildOpenCodeCompactSuccessMessage(sessionId: string): string {
  return `OpenCode context compaction completed for current session: ${sessionId}`;
}

function buildOpenCodeCompactFailureMessage(message: string): string {
  return `OpenCode context compaction failed: ${message}`;
}

export function processGeminiStreamJsonChunk(
  state: GeminiStreamJsonState,
  chunk: string,
  handlers: GeminiStreamJsonHandlers = {}
): void {
  const parsed = parseGeminiStreamJsonChunk(state.remainder, chunk);
  state.remainder = parsed.remainder;
  parsed.events.forEach((event) => processGeminiStreamJsonEvent(state, event, handlers));
  const plainText = formatGeminiPlainTextLines(parsed.textLines);
  if (plainText) {
    state.assistantText += plainText;
    handlers.onPlainText?.(plainText);
  }
}

export function finalizeGeminiStreamJsonState(
  state: GeminiStreamJsonState,
  handlers: GeminiStreamJsonHandlers = {}
): void {
  const parsed = finalizeGeminiStreamJsonRemainder(state.remainder);
  state.remainder = "";
  if (!parsed) {
    return;
  }
  if (parsed.kind === "event") {
    processGeminiStreamJsonEvent(state, parsed.event, handlers);
    return;
  }
  const text = parsed.text.trimEnd();
  if (text) {
    state.assistantText += text;
    handlers.onPlainText?.(text);
  }
}

function formatGeminiPlainTextLines(lines: string[]): string {
  return lines.join("\n").trimEnd();
}

function processGeminiStreamJsonEvent(
  state: GeminiStreamJsonState,
  event: GeminiStreamJsonEvent,
  handlers: GeminiStreamJsonHandlers
): void {
  const display = getGeminiEventDisplay(event);
  if (display.assistantText) {
    state.assistantText += display.assistantText;
    handlers.onAssistantText?.(display.assistantText);
  }
  if (display.traceText) {
    handlers.onTraceText?.(display.traceText);
  }
  if (display.sessionId) {
    handlers.onSessionId?.(display.sessionId);
  }
  if (display.resultStatus) {
    state.resultStatus = display.resultStatus;
  }
  if (display.errorText) {
    state.errorText = display.errorText;
  }
}

export function extractRecentTurns(messages: ChatMessage[], maxTurns: number): ChatMessage[] {
  // Keep the last N user turns (+ following assistant if present).
  const result: ChatMessage[] = [];
  let collected = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    if (msg.role === "user") {
      // include assistant after this user message if it exists
      const assistant = messages[i + 1];
      if (assistant && assistant.role === "assistant") {
        result.push(assistant);
      }
      result.push(msg);
      collected += 1;
      if (collected >= maxTurns) {
        break;
      }
    }
  }
  return result.reverse();
}

export function formatTurnsForBootstrap(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const content = (message.content ?? "").trimEnd();
    if (!content) {
      continue;
    }
    if (message.role === "user") {
      lines.push("USER:");
      lines.push(content);
      lines.push("");
    } else if (message.role === "assistant") {
      lines.push("ASSISTANT:");
      lines.push(content);
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}

type CompactionPromptMessageKey =
  | "compact.systemPrompt"
  | "compact.systemPrompt.reqTitle"
  | "compact.systemPrompt.req1"
  | "compact.systemPrompt.req2"
  | "compact.systemPrompt.req3"
  | "compact.systemPrompt.summaryTitle";

export function buildCompactionPrompt(translate: (key: CompactionPromptMessageKey) => string): string {
  return [
    translate("compact.systemPrompt"),
    translate("compact.systemPrompt.reqTitle"),
    translate("compact.systemPrompt.req1"),
    translate("compact.systemPrompt.req2"),
    translate("compact.systemPrompt.req3"),
    "",
    translate("compact.systemPrompt.summaryTitle"),
    "FACTS:",
    "- ...",
    "TODOS:",
    "- [ ] ...",
    "DECISIONS:",
    "- ...",
    "CONSTRAINTS:",
    "- ...",
    "INDEX:",
    "- file: <path> - <note>",
    "- cmd: <command> - <note>",
    "- conclusion: <text> - <note>",
  ].join("\n");
}

export type GeminiNativeContextCompactionDeps = {
  runCliStream: typeof runCliStream;
  buildProcessLabel: typeof buildProcessLabel;
  prepareGeminiRunProfile: (
    selectedModel: string | null,
    thinkingMode: ThinkingMode,
    cwd?: string
  ) => { runtimeModel: string | null; envOverrides?: Record<string, string> };
  setActiveProcess: (process: ReturnType<typeof runCliStream> | undefined) => void;
};

export type GeminiNativeContextCompactionOptions = {
  sessionId: string;
  tabId?: string | null;
  selectedModel: string | null;
  cwd: string | null;
  thinkingMode: ThinkingMode;
  onTraceText?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onRawStream?: (chunk: string, stream: "stdout" | "stderr") => void;
};

export async function runGeminiNativeContextCompactionWithDeps(
  deps: GeminiNativeContextCompactionDeps,
  options: GeminiNativeContextCompactionOptions
): Promise<{ compacted: boolean; sessionId: string; resultStatus: string | null; errorText: string | null }> {
  const runCli = "gemini" as unknown as CliName;
  const geminiRunProfile = deps.prepareGeminiRunProfile(options.selectedModel, options.thinkingMode, options.cwd ?? undefined);
  const runtimeModel = geminiRunProfile.runtimeModel ?? options.selectedModel;
  const runtimeEnvOverrides = geminiRunProfile.envOverrides;
  const geminiStreamState: GeminiStreamJsonState = { remainder: "", assistantText: "", resultStatus: null, errorText: null };
  let adoptedSessionId = options.sessionId;

  const attemptResult = await new Promise<
    { type: "exit"; code: number | null }
    | { type: "error"; error: Error }
  >((resolve) => {
    let settled = false;
    const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const process = deps.runCliStream(
      runCli,
      GEMINI_NATIVE_COMPACT_PROMPT,
      {
        onStdout: (chunk: string) => {
          options.onRawStream?.(chunk, "stdout");
          processGeminiStreamJsonChunk(geminiStreamState, chunk, {
            onAssistantText: (text) => {
              options.onAssistantText?.(text);
            },
            onTraceText: (text) => options.onTraceText?.(text),
            onSessionId: (nextSessionId) => {
              adoptedSessionId = nextSessionId;
            },
            onPlainText: (text) => {
              options.onAssistantText?.(text);
            },
          });
        },
        onStderr: (chunk: string) => {
          options.onRawStream?.(chunk, "stderr");
          if (chunk.trim()) {
            options.onTraceText?.(chunk.trimEnd());
          }
        },
        onExit: (code: number | null) => settle({ type: "exit", code }),
        onError: (error: Error) => settle({ type: "error", error }),
      },
      {
        cwd: options.cwd ?? undefined,
        sessionId: options.sessionId,
        thinkingMode: options.thinkingMode,
        model: runtimeModel,
        envOverrides: runtimeEnvOverrides,
        processLabel: deps.buildProcessLabel(runCli, options.sessionId),
      }
    );

    deps.setActiveProcess(process);
  });

  finalizeGeminiStreamJsonState(geminiStreamState, {
    onAssistantText: (text) => {
      options.onAssistantText?.(text);
    },
    onTraceText: (text) => options.onTraceText?.(text),
    onSessionId: (nextSessionId) => {
      adoptedSessionId = nextSessionId;
    },
    onPlainText: (text) => {
      options.onAssistantText?.(text);
    },
  });

  deps.setActiveProcess(undefined);

  if (attemptResult.type === "error") {
    throw attemptResult.error;
  }

  if (attemptResult.code !== 0) {
    throw new Error(geminiStreamState.errorText || `Gemini compaction exited with code ${attemptResult.code ?? 1}`);
  }

  if (geminiStreamState.resultStatus && geminiStreamState.resultStatus !== "success") {
    throw new Error(geminiStreamState.errorText || `Gemini compaction result status: ${geminiStreamState.resultStatus}`);
  }

  return {
    compacted: true,
    sessionId: adoptedSessionId,
    resultStatus: geminiStreamState.resultStatus,
    errorText: geminiStreamState.errorText,
  };
}

export function createDefaultGeminiNativeContextCompactionDeps(
  setActiveProcess: (process: ReturnType<typeof runCliStream> | undefined) => void
): GeminiNativeContextCompactionDeps {
  return {
    runCliStream,
    buildProcessLabel,
    prepareGeminiRunProfile: buildGeminiThinkingRuntimeProfile,
    setActiveProcess,
  };
}

type OpenCodeNativeContextCompactionOptions = {
  sessionId: string;
  tabId?: string | null;
  selectedModel: string | null;
  cwd: string | null;
};

async function runOpenCodeNativeContextCompactionWithDeps(
  deps: ContextCompactionRunDeps,
  options: OpenCodeNativeContextCompactionOptions
): Promise<OpenCodeNativeCompactResult> {
  const runtimeOptions = await deps.prepareOpenCodeRunProfile?.(
    options.selectedModel,
    options.cwd ?? undefined,
    "opencode"
  ) ?? { model: options.selectedModel };
  const runStream = deps.runCliStream ?? runCliStream;
  const processLabelBuilder = deps.buildProcessLabel ?? buildProcessLabel;
  const parseOutput = deps.parseOpenCodeRunOutput ?? parseOpenCodeRunOutput;
  const buildFailureMessage = deps.buildOpenCodeRunFailureMessage ?? buildOpenCodeRunFailureMessage;
  let rawStdout = "";
  let rawStderr = "";

  const attemptResult = await new Promise<
    { type: "exit"; code: number | null }
    | { type: "error"; error: Error }
  >((resolve) => {
    let settled = false;
    const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const process = runStream(
      "opencode",
      OPENCODE_NATIVE_COMPACT_COMMAND,
      {
        onStdout: (chunk: string) => {
          rawStdout += chunk;
          deps.sendRawStreamDelta(chunk, { stream: "stdout" });
        },
        onStderr: (chunk: string) => {
          rawStderr += chunk;
          deps.sendRawStreamDelta(chunk, { stream: "stderr" });
          if (chunk.trim()) {
            deps.appendTraceMessage(chunk.trimEnd());
          }
        },
        onExit: (code: number | null) => settle({ type: "exit", code }),
        onError: (error: Error) => settle({ type: "error", error }),
      },
      {
        cwd: options.cwd ?? undefined,
        sessionId: options.sessionId,
        openCodeVariant: runtimeOptions.openCodeVariant,
        model: runtimeOptions.model ?? options.selectedModel,
        openCodeSmallModel: runtimeOptions.openCodeSmallModel,
        openCodeConfigContent: runtimeOptions.openCodeConfigContent,
        envOverrides: runtimeOptions.envOverrides,
        processLabel: processLabelBuilder("opencode", options.sessionId),
      }
    );

    deps.setActiveProcess(process);
  });

  deps.setActiveProcess(undefined);
  const output = parseOutput(rawStdout, rawStderr);

  if (attemptResult.type === "error") {
    throw new Error(buildOpenCodeCompactFailureMessage(attemptResult.error.message || String(attemptResult.error)));
  }

  if (attemptResult.code !== 0) {
    const failureMessage = buildFailureMessage(
      output,
      `OpenCode /compact exited with code ${attemptResult.code ?? 1}.`,
      {
        missingFinalOutputMessage: "OpenCode /compact exited without returning a final result.",
        missingFinalOutputWithStatusMessage: (statusText) => `OpenCode /compact exited without returning a final result. Last status: ${statusText}`,
      }
    );
    throw new Error(buildOpenCodeCompactFailureMessage(failureMessage));
  }

  if (!output.finalText) {
    const failureMessage = buildFailureMessage(
      output,
      "OpenCode /compact completed without returning a final result.",
      {
        missingFinalOutputMessage: "OpenCode /compact completed without returning a final result. Verify that this OpenCode CLI version supports slash commands in `opencode run --auto --format json`.",
        missingFinalOutputWithStatusMessage: (statusText) => `OpenCode /compact completed without returning a final result. Last status: ${statusText}`,
      }
    );
    throw new Error(buildOpenCodeCompactFailureMessage(failureMessage));
  }

  if (isOpenCodeNativeCompactUnsupportedText(output.finalText)) {
    throw new Error(buildOpenCodeCompactFailureMessage(
      "This OpenCode CLI did not accept the native /compact command in `opencode run --auto --format json`. Update OpenCode or compact from the OpenCode TUI."
    ));
  }

  return {
    compacted: true,
    sessionId: parseOpenCodeSessionId(rawStdout) ?? options.sessionId,
    finalText: output.finalText,
  };
}

function isOpenCodeNativeCompactUnsupportedText(text: string | null): boolean {
  if (!text) {
    return false;
  }
  return /(?:unknown|unrecognized|unsupported|invalid)\s+(?:slash\s+)?command|not\s+(?:a\s+)?command/iu.test(text)
    && /\/(?:compact|summarize)\b/iu.test(text);
}

export type ContextCompactionOptions = {
  silent?: boolean;
  cli?: CliName;
  tabId?: string | null;
  sessionId?: string | null;
};

export type ContextCompactionRunStatus = "end" | "error" | "stopped";

export type ContextCompactionRunnerManager = Pick<
  InteractiveRunnerManager,
  "beginActiveRun" | "endActiveRun" | "getOrCreateCodexRunner" | "getOrCreateClaudeRunner" | "setRunner"
>;

export type ContextCompactionRunDeps = {
  getCurrentCli: () => CliName;
  getActiveConversationTabId: () => string | null;
  isInteractiveSupported: (cli: CliName) => boolean;
  appendSystemMessageForCli: (cli: CliName, sessionId: string | null, content: string) => void;
  getCurrentSessionId: (cli: CliName) => string | null;
  hasActiveProcessOrInteractiveStop: () => boolean;
  resolveInteractiveSessionForResume: (
    cli: CliName,
    sessionId: string | null,
    tabId: string | null
  ) => Promise<string | null | undefined>;
  resolveWorkspaceCwd: () => string | undefined;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getEffectiveThinkingMode: (cli: CliName, model: string | null) => ThinkingMode;
  getWorkspaceInteractiveMode: (cli: CliName) => InteractiveMode;
  applyThinkingWorkspaceFiles: (cli: CliName, thinkingMode: ThinkingMode, cwd?: string) => void;
  getEffectiveCliArgs: (cli: CliName, model: string | null) => string[];
  getCliCommand: (cli: CliName) => string;
  resolveClaudeInteractiveEntrypoint: (command: string | undefined) => string | undefined;
  logCliStartup: (payload: {
    cli: CliName;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    mode: "interactive" | "one-shot";
  }) => void;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  createMessageId: () => string;
  beginActiveRunState: (options: {
    runId: string;
    cli: CliName;
    sessionId: string;
    tabId: string | null;
    messageTarget: ChatMessage[];
  }) => void;
  getActiveRunId: () => string | undefined;
  setActiveInteractiveStop: (stop: (() => void) | null) => void;
  isActiveInteractiveStop: (stop: () => void) => boolean;
  appendStopMessageToStore: () => void;
  killActiveProcess: () => void;
  sendRunStatus: (
    status: "start" | "end" | "error" | "stopped",
    message?: string,
    options?: { activity?: "contextCompaction" }
  ) => void;
  appendCompletionMessage: (status: ContextCompactionRunStatus) => void;
  persistActiveMessages: () => void;
  clearActiveRun: () => void;
  interactiveRunnerManager: ContextCompactionRunnerManager;
  resolveInteractiveMappedId: (cli: CliName, sessionId: string) => string | null;
  appendSystemMessage: (content: string) => void;
  getGlobalMultiAgentEnabled: () => boolean;
  upsertInteractiveMapping: (
    cli: CliName,
    localSessionId: string,
    mappedSessionId: string,
    options?: { freezePrevious?: string; codexSelection?: CodexRunSelection | null }
  ) => void;
  sendRawStreamDelta: (
    content: unknown,
    options?: { stream?: "stdout" | "stderr" | "event"; appendNewline?: boolean }
  ) => void;
  sendPanelMessage: (message: { type: "taskListUpdate"; items: { text: string; done: boolean }[] }) => void;
  updateProcessTitle: (cli: CliName, sessionId: string) => void;
  appendTraceMessage: (content: string) => void;
  prepareGeminiRunProfile?: GeminiNativeContextCompactionDeps["prepareGeminiRunProfile"];
  prepareOpenCodeRunProfile?: (
    selectedModel: string | null,
    cwd?: string,
    cli?: CliName
  ) => Promise<OpenCodeRuntimeOptions> | OpenCodeRuntimeOptions;
  setActiveProcess: (process: RunProcess | undefined) => void;
  appendAssistantChunk: (chunk: string) => void;
  adoptSessionId: (cli: CliName, sessionId: string, tabId: string | null) => void;
  runCliStream?: typeof runCliStream;
  buildProcessLabel?: typeof buildProcessLabel;
  parseOpenCodeRunOutput?: typeof parseOpenCodeRunOutput;
  buildOpenCodeRunFailureMessage?: typeof buildOpenCodeRunFailureMessage;
};

export async function runContextCompactionWithDeps(
  deps: ContextCompactionRunDeps,
  options: ContextCompactionOptions = {}
): Promise<boolean> {
  const cli = options.cli ?? deps.getCurrentCli();
  const tabId = typeof options.tabId === "string" ? options.tabId : deps.getActiveConversationTabId();
  const silent = options.silent === true;
  if (!deps.isInteractiveSupported(cli)) {
    if (!silent) {
      deps.appendSystemMessageForCli(cli, deps.getCurrentSessionId(cli), t("rules.compactUnsupported"));
    }
    return false;
  }
  if (deps.hasActiveProcessOrInteractiveStop()) {
    if (!silent) {
      deps.appendSystemMessageForCli(cli, deps.getCurrentSessionId(cli), t("rules.compactRunning"));
    }
    return false;
  }
  const currentSessionId = options.sessionId ?? deps.getCurrentSessionId(cli);
  if (!currentSessionId) {
    if (!silent) {
      deps.appendSystemMessageForCli(cli, currentSessionId, t("rules.compactNoSession"));
    }
    return false;
  }
  const resolvedSessionId = await deps.resolveInteractiveSessionForResume(cli, currentSessionId, tabId);
  if (resolvedSessionId === undefined || !resolvedSessionId) {
    return false;
  }
  const sessionId = resolvedSessionId;

  const cwd = deps.resolveWorkspaceCwd();
  const activeConfigId = deps.getActiveConfigIdForCli(cli);
  const selectedModel = deps.getSelectedCliModel(cli, activeConfigId);
  const thinkingMode = deps.getEffectiveThinkingMode(cli, selectedModel);
  const interactiveMode = deps.getWorkspaceInteractiveMode(cli);
  deps.applyThinkingWorkspaceFiles(cli, thinkingMode, cwd);

  const args = deps.getEffectiveCliArgs(cli, selectedModel);
  const command = deps.getCliCommand(cli);
  const resolvedCommand = cli === "claude" ? resolveCliCommand(command) : null;
  const commandForRunner = cli === "claude"
    ? (resolvedCommand?.command ?? "claude")
    : command;
  const claudeEntrypoint = cli === "claude"
    ? deps.resolveClaudeInteractiveEntrypoint(resolvedCommand?.command ?? commandForRunner)
    : undefined;
  deps.logCliStartup({
    cli,
    cwd,
    command: commandForRunner,
    args,
    env: sanitizeEnv(process.env),
    mode: "interactive",
  });

  const messageTarget = deps.loadSessionMessages(cli, sessionId);
  const runId = deps.createMessageId();
  deps.beginActiveRunState({ runId, cli, sessionId, tabId, messageTarget });

  // Automatic compaction stays quiet in the transcript, but still drives the
  // Webview's active compaction indicator until the run has finished.
  deps.sendRunStatus("start", undefined, { activity: "contextCompaction" });

  let stopCurrentTurn: (() => void) | null = null;
  const stopFn = (): void => {
    if (deps.getActiveRunId() !== runId) {
      return;
    }
    void logInfo("context-compact-stop-requested", { cli, sessionId, runId });
    if (deps.isActiveInteractiveStop(stopFn)) {
      deps.setActiveInteractiveStop(null);
    }
    deps.appendStopMessageToStore();
    try {
      deps.killActiveProcess();
      stopCurrentTurn?.();
    } catch {
      // ignore
    }
    deps.sendRunStatus("stopped", silent ? undefined : t("run.stoppedByUser"));
    if (!silent) {
      deps.appendCompletionMessage("stopped");
      deps.persistActiveMessages();
    }
    deps.clearActiveRun();
  };
  deps.setActiveInteractiveStop(stopFn);

  try {
    if (cli === "codex") {
      const mappedThreadId = deps.resolveInteractiveMappedId(cli, sessionId);
      if (!mappedThreadId) {
        deps.appendSystemMessage(t("rules.compactNoSession"));
        cleanupAfterRun("end");
        return false;
      }

      const codexSelection = normalizeCodexRunSelection({
        configId: activeConfigId,
        model: selectedModel,
      });
      const runner = deps.interactiveRunnerManager.getOrCreateCodexRunner({
        sessionId,
        threadId: mappedThreadId,
        command,
        args,
        cwd: cwd ?? undefined,
        thinkingMode,
        interactiveMode,
        model: codexSelection.model,
        configId: codexSelection.configId,
        multiAgentEnabled: deps.getGlobalMultiAgentEnabled(),
      });
      stopCurrentTurn = () => runner.stopAndRebuild();
      deps.interactiveRunnerManager.beginActiveRun(cli, sessionId);
      try {
        const result = await runner.compactThread();
        deps.upsertInteractiveMapping(cli, sessionId, result.threadId, {
          freezePrevious: mappedThreadId,
          codexSelection,
        });
        deps.appendSystemMessage(t("compact.codexNativeCompressed", { threadId: result.threadId }));
        void logInfo("context-compact-codex-complete", {
          cli,
          sessionId,
          threadId: result.threadId,
          compacted: result.compacted,
        });
        deps.interactiveRunnerManager.setRunner("codex", sessionId, runner, thinkingMode, interactiveMode, codexSelection.model, {
          multiAgentEnabled: deps.getGlobalMultiAgentEnabled(),
          configId: codexSelection.configId,
        });
      } finally {
        deps.interactiveRunnerManager.endActiveRun(cli, sessionId);
      }
      cleanupAfterRun("end");
      return true;
    }

    if (cli === "claude") {
      const mappedSessionId = deps.resolveInteractiveMappedId(cli, sessionId);
      let runner = deps.interactiveRunnerManager.getOrCreateClaudeRunner({
        sessionId,
        mappedSessionId,
        command: commandForRunner,
        args,
        cwd: cwd ?? undefined,
        thinkingMode,
        interactiveMode,
        model: selectedModel,
        entrypoint: claudeEntrypoint,
      });

      stopCurrentTurn = () => runner.stopAndRebuild();

      const runClaudeSummaryCompactionFallback = async (): Promise<void> => {
        const summaryResult = await (async () => {
          deps.interactiveRunnerManager.beginActiveRun(cli, sessionId);
          try {
            return await runner.runForText(buildCompactionPrompt(t));
          } finally {
            deps.interactiveRunnerManager.endActiveRun(cli, sessionId);
          }
        })();
        const compactionSummary = summaryResult.text.trim() ? summaryResult.text.trim() : null;
        const previousSessionId = summaryResult.sessionId ?? runner.getSessionId() ?? mappedSessionId;
        if (!compactionSummary || !previousSessionId) {
          deps.appendSystemMessage(t("compact.failEmpty"));
          return;
        }

        const recent = extractRecentTurns(messageTarget, 3);
        const bootstrap = [
          t("compact.resumeNotice"),
          "",
          compactionSummary,
          "",
          t("compact.systemPrompt.recentTitle"),
          formatTurnsForBootstrap(recent),
        ].join("\n");

        runner.dispose();
        runner = new ClaudeInteractiveRunner({
          command: commandForRunner,
          args,
          cwd: cwd ?? undefined,
          thinkingMode,
          interactiveMode,
          model: selectedModel,
          entrypoint: claudeEntrypoint,
          sessionId: null,
        });

        stopCurrentTurn = () => runner.stopAndRebuild();
        deps.interactiveRunnerManager.beginActiveRun(cli, sessionId);
        try {
          await runner.runStreamed(bootstrap, {
            onAssistantDelta: () => {},
            onTrace: () => {},
            onEvent: (event) => {
              deps.sendRawStreamDelta(event, { stream: "event", appendNewline: true });
            },
            onTaskListUpdate: (items) => {
              deps.sendPanelMessage({ type: "taskListUpdate", items });
            },
            onSessionId: (newSessionId) => {
              deps.updateProcessTitle(cli, newSessionId);
              deps.upsertInteractiveMapping(cli, sessionId, newSessionId, { freezePrevious: previousSessionId });
              deps.appendSystemMessage(t("compact.summaryCompressed", { from: previousSessionId, to: newSessionId }));
              deps.appendTraceMessage(compactionSummary);
              void logInfo("context-compact-claude-complete", {
                cli,
                sessionId,
                newSessionId,
                previousSessionId,
                mode: "summary-fallback",
              });
              deps.interactiveRunnerManager.setRunner("claude", sessionId, runner, thinkingMode, interactiveMode, selectedModel);
            },
          });
        } finally {
          deps.interactiveRunnerManager.endActiveRun(cli, sessionId);
        }
      };

      let nativeResult: Awaited<ReturnType<typeof runner.compactSession>> | null = null;
      try {
        deps.interactiveRunnerManager.beginActiveRun(cli, sessionId);
        try {
          nativeResult = await runner.compactSession();
        } finally {
          deps.interactiveRunnerManager.endActiveRun(cli, sessionId);
        }
      } catch (error) {
        if (!isClaudeNativeCompactUnsupportedError(error)) {
          throw error;
        }
        void logInfo("context-compact-claude-native-fallback", {
          cli,
          sessionId,
          previousSessionId: mappedSessionId,
          reason: "unsupported-native-compact",
          error: error instanceof Error ? error.message : String(error),
        });
        await runClaudeSummaryCompactionFallback();
        cleanupAfterRun("end");
        return true;
      }

      if (!nativeResult) {
        await runClaudeSummaryCompactionFallback();
        cleanupAfterRun("end");
        return true;
      }

      const previousSessionId = nativeResult.previousSessionId ?? mappedSessionId;
      const resolvedSessionId = nativeResult.sessionId ?? previousSessionId;
      if (!nativeResult.compacted || !resolvedSessionId) {
        void logInfo("context-compact-claude-native-fallback", {
          cli,
          sessionId,
          previousSessionId,
          nextSessionId: nativeResult.sessionId,
          reason: "missing-native-compact-signal",
        });
        await runClaudeSummaryCompactionFallback();
        cleanupAfterRun("end");
        return true;
      }

      deps.updateProcessTitle(cli, resolvedSessionId);
      deps.upsertInteractiveMapping(
        cli,
        sessionId,
        resolvedSessionId,
        previousSessionId && previousSessionId !== resolvedSessionId
          ? { freezePrevious: previousSessionId }
          : {}
      );
      deps.appendSystemMessage(
        previousSessionId && previousSessionId !== resolvedSessionId
          ? t("compact.claudeNativeCompressedForked", { from: previousSessionId, to: resolvedSessionId })
          : t("compact.claudeNativeCompressed", { sessionId: resolvedSessionId })
      );
      void logInfo("context-compact-claude-native-complete", {
        cli,
        sessionId,
        previousSessionId,
        resolvedSessionId,
        compacted: nativeResult.compacted,
      });
      deps.interactiveRunnerManager.setRunner("claude", sessionId, runner, thinkingMode, interactiveMode, selectedModel);
      cleanupAfterRun("end");
      return true;
    }

    if (cli === "opencode") {
      const result = await runOpenCodeNativeContextCompactionWithDeps(deps, {
        sessionId,
        tabId,
        selectedModel,
        cwd: cwd ?? null,
      });
      deps.adoptSessionId(cli, result.sessionId, tabId);
      deps.appendSystemMessage(buildOpenCodeCompactSuccessMessage(result.sessionId));
      void logInfo("context-compact-opencode-native-complete", {
        cli,
        sessionId,
        resolvedSessionId: result.sessionId,
        compacted: result.compacted,
      });
      cleanupAfterRun("end");
      return true;
    }

    cleanupAfterRun("end");
    return true;
  } catch (error) {
    if (!silent) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      deps.appendSystemMessage(cli === "opencode" && errorMessage ? errorMessage : t("compact.failException"));
    }
    void logError("context-compact-command-failed", {
      cli,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
      silent,
    });
    cleanupAfterRun(silent ? "end" : "error");
    return false;
  } finally {
    if (deps.isActiveInteractiveStop(stopFn)) {
      deps.setActiveInteractiveStop(null);
    }
  }

  function cleanupAfterRun(status: ContextCompactionRunStatus, userMessage?: string): void {
    if (deps.getActiveRunId() !== runId) {
      void logInfo("context-compact-command-stale-end-ignored", {
        cli,
        sessionId,
        runId,
        status,
      });
      return;
    }
    void logInfo("context-compact-command-end", {
      cli,
      sessionId,
      runId,
      status,
      message: userMessage ?? null,
    });
    deps.sendRunStatus(status === "end" ? "end" : status, silent ? undefined : userMessage);
    if (!silent) {
      deps.appendCompletionMessage(status);
    }
    deps.persistActiveMessages();
    deps.clearActiveRun();
  }
}
