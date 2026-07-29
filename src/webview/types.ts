import {
  CliName,
  InteractiveMode,
  LoopExecutionMode,
  MacTaskShell,
  OpenCodeThinkingState,
  ThinkingMode,
} from "../cli/types";
import { ConfigPlatform } from "../config/types";
import type { GraphRunStatus } from "../graph/types";
import type { LoopTaskStatus } from "../loopTaskStore";
import type { LoopSubtaskMaxThinkingMode } from "../loopSubtaskThinking";

export type ConfigSummary = {
  id: string;
  name: string;
  platform: ConfigPlatform;
};

export type WebviewOpenCodeThinkingState = OpenCodeThinkingState & {
  configuredDefaultVariant?: string | null;
};

export type PanelMessage =
  | { type: "requestState" }
  | { type: "selectCli"; cli: CliName }
  | { type: "selectCliModel"; cli: CliName; model: string | null; configId?: string | null }
  | { type: "selectCliLoopModel"; cli: CliName; role: "main" | "subtask"; model: string | null; configId?: string | null }
  | { type: "addCliModel"; cli: CliName; model: string; configId?: string | null }
  | { type: "renameCliModel"; cli: CliName; previousModel: string; nextModel: string; configId?: string | null }
  | { type: "deleteCliModel"; cli: CliName; model: string; configId?: string | null }
  | { type: "moveCliModel"; cli: CliName; model: string; direction: "up" | "down"; configId?: string | null }
  | { type: "inspectModelManager"; cli: CliName; configId?: string | null; visibleModelCount?: number; visibleManagedModelCount?: number; selectedModel?: string | null }
  | { type: "selectSession"; sessionId: string | null; cli: CliName }
  | { type: "selectConversationTab"; tabId: string; cli: CliName }
  | { type: "closeConversationTab"; tabId: string; cli: CliName }
  | { type: "newSession" }
  | { type: "resetConversationTabSession" }
  | { type: "deleteSession"; sessionId: string; cli: CliName }
  | { type: "loadHistorySessionMessages"; sessionId: string; cli: CliName }
  | { type: "exportHistorySessionMessages"; sessionId: string; cli: CliName }
  | { type: "applyConfig"; cli: CliName; configId: string }
  | { type: "clearAllSessions" }
  | { type: "clearPromptHistory" }
  | { type: "updateSetting"; key: string; value: unknown }
  | { type: "updateOpenCodeVariant"; value: string | null; role?: "primary" | "small"; modelRole?: OpenCodeWebviewModelRole }
  | { type: "updateOpenCodeRoleModel"; role: "primary" | "small"; modelRole?: OpenCodeWebviewModelRole; value: string | null }
  | { type: "initializeWorkspaceHarness"; enabled: boolean }
  | { type: "installCodeGraph" }
  | {
      type: "sendPrompt";
      prompt: string;
      interactiveMode?: InteractiveMode;
      contextOptions?: PromptContextOptions;
      tabId?: string;
      cli?: CliName;
      model?: string;
      loopMainModel?: string;
      loopSubtaskModel?: string;
      loopMainThinkingMode?: ThinkingMode;
      loopSubtaskThinkingMode?: ThinkingMode;
      lobsterMainModel?: string;
      lobsterSubtaskModel?: string;
      loopExecutionMode?: LoopExecutionMode;
      preserveActiveTab?: boolean;
    }
  | { type: "stopRun" }
  | { type: "runCommonCommand"; command: "compactContext" }
  | { type: "openLoopGroupChat"; taskId?: string | null; roundKey?: string | null }
  | { type: "openGraphRun"; graphRunId?: string | null; nodeId?: string | null }
  | { type: "openConfig" }
  | { type: "resolveDropPaths"; uris: string[] }
  | { type: "pickWorkspacePath" }
  | { type: "uploadFiles"; files: UploadFilePayload[] }
  | {
      type: "exportRunStream";
      records: RunStreamExportRecordPayload[];
      tabId?: string | null;
      cli?: CliName;
    }
  | { type: "loadRules"; cli: CliName; scope: "global" | "project" }
  | { type: "saveRules"; content: string; targets: CliName[]; scope: "global" | "project" }
  | {
      type: "webviewError";
      message: string;
      stack?: string;
      source?: string;
      lineno?: number;
      colno?: number;
      reason?: string;
    }
  | {
      type: "webviewDebug";
      event: string;
      payload?: unknown;
    }
  | {
      type: "sessionLoadError";
      title: string;
      detail: string;
      tabId?: string | null;
      sessionId?: string | null;
      cli?: CliName;
    };

export type UploadFilePayload = {
  name: string;
  type: string;
  dataUrl: string;
};

export type PromptContextOptions = {
  includeCurrentFile?: boolean;
  includeSelection?: boolean;
};

export type RunStreamExportRecordPayload = {
  id?: string;
  content?: string;
  source?: "stdout" | "stderr" | "event" | string;
  createdAt?: number;
};

export type EditorContextState = {
  filePath: string | null;
  fileLabel: string | null;
  hasSelection: boolean;
  selectionLabel: string | null;
};

export type SessionSummary = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  cli: CliName;
  isLoopSession: boolean;
  isGraphSession: boolean;
  graphRunId: string | null;
  isOpenInConversationTabs: boolean;
  openConversationTabId: string | null;
  firstPrompt?: string;
};

export type ConversationTabSummary = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  createdAt: number;
  loopTaskRole?: "main" | "subtask";
  loopTaskId?: string;
  loopTaskRunning?: boolean;
  loopTaskStatus?: LoopTaskStatus;
  loopMainTabCloseLocked?: boolean;
  graphRunId?: string;
  graphRunStatus?: GraphRunStatus;
  graphRunBlocked?: boolean;
};

export type PromptHistoryItem = {
  id: string;
  prompt: string;
  createdAt: number;
  cli: CliName;
};

export type ChatMessageAction =
  | {
      type: "openLoopGroupChat";
      taskId: string;
      roundKey?: string | null;
      label?: string;
    }
  | {
      type: "openGraphRun";
      graphRunId: string;
      nodeId?: string | null;
      label?: string;
    };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "trace";
  content: string;
  createdAt?: number;
  sequence?: number;
  kind?: "thinking" | "normal" | "tool-use";
  merge?: boolean;
  contextTags?: string[];
  taskRole?: "main" | "subtask";
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
  loopAnswerConclusion?: boolean;
  loopFinalSummary?: boolean;
  graphFinalSummary?: boolean;
  codexFinalAnswer?: boolean;
  subagentProvider?: "opencode" | "codex" | "loop";
  subagentId?: string;
  subagentName?: string;
  subagentStatus?: "running" | "completed" | "failed" | "interrupted";
  actions?: ChatMessageAction[];
};

export type OpenCodeModelOption = {
  ref: string;
  label: string;
  providerId: string;
  modelId: string;
};

export type OpenCodeWebviewModelRole = "main" | "subtask";
export type OpenCodeWebviewLegacyModelRole = "primary" | "small";

export type OpenCodeModelsState = {
  models: OpenCodeModelOption[];
  configMainRef?: string | null;
  configSubtaskRef?: string | null;
  selectedMainRef?: string | null;
  selectedSubtaskRef?: string | null;
  /** @deprecated Compatibility alias for OpenCode config field `model`. */
  configPrimaryRef?: string | null;
  /** @deprecated Compatibility alias for OpenCode config field `small_model`. */
  configSmallRef?: string | null;
  /** @deprecated Compatibility alias for the main role. */
  selectedPrimaryRef?: string | null;
  /** @deprecated Compatibility alias for the subtask role. */
  selectedSmallRef?: string | null;
  issues: Array<{
    role?: OpenCodeWebviewModelRole | OpenCodeWebviewLegacyModelRole;
    code: string;
    messageKey?: string;
  }>;
};

export type PanelState = {
  currentCli: CliName;
  autoOpenPanel: boolean;
  rememberSelectedCli: boolean;
  autoAddEditorContextTags: boolean;
  longTermMemoryEnabled: boolean;
  workspaceMemoryEnabled: boolean;
  autoCompactContextAfterRun: boolean;
  multiAgentEnabled: boolean;
  loopMaxRounds: number;
  loopSubtaskMaxThinkingMode: LoopSubtaskMaxThinkingMode;
  loopExecutionModeByCli?: Record<CliName, LoopExecutionMode>;
  debug: boolean;
  locale: string;
  isMac: boolean;
  macTaskShell: MacTaskShell;
  thinkingMode: ThinkingMode;
  openCodeThinking: WebviewOpenCodeThinkingState;
  openCodeSmallThinking?: WebviewOpenCodeThinkingState;
  openCodeModels?: OpenCodeModelsState;
  interactive: {
    supported: boolean;
    enabled: boolean;
  };
  interactiveMode: InteractiveMode;
  rulePaths: {
    global: Record<CliName, string>;
    project: Record<CliName, string | null>;
  };
  sessionState: {
    currentSessionId: string | null;
    sessions: SessionSummary[];
  };
  conversationTabs: {
    activeTabId: string | null;
    tabs: ConversationTabSummary[];
  };
  promptHistory: PromptHistoryItem[];
  configState: {
    configs: ConfigSummary[];
    activeConfigId: string | null;
  };
  modelState: {
    selectedByCli: Record<CliName, string | null>;
    optionsByCli: Record<CliName, string[]>;
      managedByCli: Record<CliName, string[]>;
      selectedLoopByCli?: Partial<Record<CliName, { main?: string | null; subtask?: string | null }>>;
      selectedLoopThinkingByCli?: Partial<Record<CliName, { main?: ThinkingMode | null; subtask?: ThinkingMode | null }>>;
      loopOptionsByCli?: Partial<Record<CliName, { main: string[]; subtask: string[] }>>;
    };
  editorContext: EditorContextState;
};
