import {
  CliName,
  InteractiveMode,
  LobsterExecutionMode,
  MacTaskShell,
  OpenCodeThinkingState,
  ThinkingMode,
} from "../cli/types";
import { ConfigPlatform } from "../config/types";
import type { LobsterTaskStatus } from "../lobsterTaskStore";
import type { FinalAnswerPolicy } from "../toolSettings";

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
  | { type: "updateOpenCodeVariant"; value: string | null; role?: "primary" | "small" }
  | { type: "updateOpenCodeRoleModel"; role: "primary" | "small"; value: string | null }
  | { type: "initializeWorkspaceHarness"; enabled: boolean }
  | {
      type: "sendPrompt";
      prompt: string;
      interactiveMode?: InteractiveMode;
      contextOptions?: PromptContextOptions;
      tabId?: string;
      cli?: CliName;
      model?: string;
      lobsterExecutionMode?: LobsterExecutionMode;
      preserveActiveTab?: boolean;
    }
  | { type: "stopRun" }
  | { type: "runCommonCommand"; command: "compactContext" }
  | { type: "openLobsterDebateChat"; taskId?: string | null; roundKey?: string | null }
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
  isLobsterSession: boolean;
  isOpenInConversationTabs: boolean;
  openConversationTabId: string | null;
  firstPrompt?: string;
};

export type ConversationTabSummary = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  createdAt: number;
  lobsterTaskRole?: "main" | "subtask";
  lobsterTaskId?: string;
  lobsterTaskRunning?: boolean;
  lobsterTaskStatus?: LobsterTaskStatus;
  lobsterMainTabCloseLocked?: boolean;
};

export type PromptHistoryItem = {
  id: string;
  prompt: string;
  createdAt: number;
  cli: CliName;
};

export type ChatMessageAction =
  | {
      type: "openLobsterDebateChat";
      taskId: string;
      roundKey?: string | null;
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
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
  lobsterAnswerConclusion?: boolean;
  lobsterFinalSummary?: boolean;
  codexFinalAnswer?: boolean;
  subagentProvider?: "opencode" | "codex";
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

export type OpenCodeModelsState = {
  models: OpenCodeModelOption[];
  configPrimaryRef: string | null;
  configSmallRef: string | null;
  selectedPrimaryRef: string | null;
  selectedSmallRef: string | null;
  issues: Array<{
    role?: "primary" | "small";
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
  codexMultiAgentEnabled: boolean;
  finalAnswerPolicy: FinalAnswerPolicy;
  lobsterMaxRounds: number;
  lobsterAutoCloseSubtaskTabs: boolean;
  lobsterExecutionModeByCli?: Record<CliName, LobsterExecutionMode>;
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
  };
  editorContext: EditorContextState;
};
