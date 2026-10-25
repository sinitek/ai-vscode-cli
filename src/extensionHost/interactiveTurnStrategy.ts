import type { OpenCodeTaskListItem } from "../cli/openCodeTaskList";
import type { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import type { I18nKey } from "../i18n";
import type { CodexStreamHandlers } from "../interactive/codexRunner";
import type { CodexRunSelection } from "../interactive/codexThreadSelection";
import type { InteractiveRunnerManager } from "../interactive/manager";
import type { SubagentProgressUpdate } from "../subagentProgress";
import type { TraceMessageKind } from "../traceDisplay";
import type { ChatMessage } from "../webview/types";
import type { InteractiveTabRun } from "./promptExecutionShared";
import type { DshInteractiveLaunch } from "./dshInteractiveLaunch";
import { createClaudeInteractiveTurnStrategy } from "./interactiveTurnClaude";
import { createCodexInteractiveTurnStrategy } from "./interactiveTurnCodex";
import { createDshInteractiveTurnStrategy } from "./interactiveTurnDsh";
import { createGrokInteractiveTurnStrategy } from "./interactiveTurnGrok";

export type InteractiveTurnCli = "codex" | "claude" | "grok" | "dsh";

export type InteractiveAttemptDisposition = "continue" | "return";

export type InteractiveTraceMessageOptions = {
  id?: string;
  merge?: boolean;
  persist?: boolean;
  forceTraceBubble?: boolean;
  taskListItems?: OpenCodeTaskListItem[];
};

export type InteractiveAssistantChunkOptions = {
  codexFinalAnswer?: boolean;
  reasoningItemId?: string;
};

export type InteractiveTurnAttemptPort = {
  readonly cli: InteractiveTurnCli;
  readonly tabId: string;
  readonly runId: string;
  readonly attemptPrompt: string;
  readonly command: string;
  readonly commandForRunner: string;
  readonly args: string[];
  readonly grokAgentArgs: string[];
  readonly dshModelWire: string | null;
  readonly dshLaunch: Pick<DshInteractiveLaunch, "agentArgs" | "env"> | null;
  readonly cwd: string | undefined;
  readonly thinkingMode: ThinkingMode;
  readonly interactiveMode: InteractiveMode;
  readonly selectedModel: string | null;
  readonly activeConfigId: string | null;
  readonly claudeEntrypoint: string | undefined;
  readonly isolateProjectInstructions: boolean | undefined;
  readonly originalSessionId: string | null;
  readonly uiSessionId: string | null;
  readonly stopFn: () => void;
  readonly interactiveRunnerManager: InteractiveRunnerManager;
  readonly interactiveRunsByTabId: Map<string, InteractiveTabRun>;
  attemptHadNormalReply: boolean;
  claudeSawAssistantText: boolean;
  claudeToolAfterAssistantText: boolean;
  claudeResultFailed: boolean;
  claudeSawSuccessfulResult: boolean;
  claudeSawEndTurn: boolean;
  observedCodexFinalAnswer: boolean;
  observedCodexPrimaryTurnCompleted: boolean;
  observedClaudeFinalAnswer: boolean;
  observedGrokFinalAnswer: boolean;
  observedDshFinalAnswer: boolean;
  settleInteractiveAttempt(cli: InteractiveTurnCli): Promise<InteractiveAttemptDisposition>;
  appendAssistantChunkForTab(
    chunk: string,
    kind?: ChatMessage["kind"],
    options?: InteractiveAssistantChunkOptions,
  ): void;
  appendTraceMessageForTab(
    content: string,
    kind?: TraceMessageKind,
    options?: InteractiveTraceMessageOptions,
  ): void;
  appendDebugStdout(chunk: string): void;
  appendTraceLog(content: string): void;
  appendDebugEvent(event: unknown): void;
  appendSystemMessageForTab(content: string): void;
  sendPanelMessage(payload: Record<string, unknown>): void;
  updateSessionForNewRun(
    newId: string,
    options?: { freezePrevious?: string | null; codexSelection?: CodexRunSelection | null },
  ): void;
  syncInteractiveRunEntry(stop?: () => void): void;
  isCurrentRunActive(): boolean;
  setStopCurrentTurn(stop: () => void): void;
  updateProcessTitle(cli: CliName, sessionId: string): void;
  updateSubagentProgress(update: SubagentProgressUpdate): void;
  handleStructuredHumanInteractionRequest: NonNullable<CodexStreamHandlers["onRequest"]>;
  canHandleStructuredHumanInteractionRequest(): boolean;
  resolveInteractiveMappedId(cli: CliName, sessionId: string): string | null;
  resolveCodexInteractiveSelection(sessionId: string): CodexRunSelection | null;
  getConversationTabById(tabId: string): { sessionId?: string | null; cli?: CliName } | null | undefined;
  createMessageId(): string;
  logInfo(message: string, data?: unknown): void;
  t(key: I18nKey, params?: Record<string, string | number | boolean>): string;
};

export type InteractiveTurnStrategy = {
  runAttempt(port: InteractiveTurnAttemptPort): Promise<InteractiveAttemptDisposition>;
};

export function createInteractiveTurnStrategies(): Record<InteractiveTurnCli, InteractiveTurnStrategy> {
  return {
    codex: createCodexInteractiveTurnStrategy(),
    claude: createClaudeInteractiveTurnStrategy(),
    grok: createGrokInteractiveTurnStrategy(),
    dsh: createDshInteractiveTurnStrategy(),
  };
}
