import { CliName, InteractiveMode, MacTaskShell, ThinkingMode } from "../cli/types";
import { ConfigPlatform } from "../config/types";

export type ConfigSummary = {
  id: string;
  name: string;
  platform: ConfigPlatform;
};

export type PanelMessage =
  | { type: "requestState" }
  | { type: "selectCli"; cli: CliName }
  | { type: "selectCliModel"; cli: CliName; model: string | null }
  | { type: "addCliModel"; cli: CliName; model: string }
  | { type: "selectSession"; sessionId: string | null; cli: CliName }
  | { type: "selectConversationTab"; tabId: string; cli: CliName }
  | { type: "closeConversationTab"; tabId: string; cli: CliName }
  | { type: "newSession" }
  | { type: "resetConversationTabSession" }
  | { type: "deleteSession"; sessionId: string; cli: CliName }
  | { type: "applyConfig"; cli: CliName; configId: string }
  | { type: "clearAllSessions" }
  | { type: "clearPromptHistory" }
  | { type: "updateSetting"; key: string; value: unknown }
  | {
      type: "sendPrompt";
      prompt: string;
      interactiveMode?: InteractiveMode;
      contextOptions?: PromptContextOptions;
      tabId?: string;
      cli?: CliName;
      model?: string;
    }
  | { type: "stopRun" }
  | { type: "runCommonCommand"; command: "compactContext" }
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
  firstPrompt?: string;
};

export type ConversationTabSummary = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  createdAt: number;
};

export type PromptHistoryItem = {
  id: string;
  prompt: string;
  createdAt: number;
  cli: CliName;
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
};

export type PanelState = {
  currentCli: CliName;
  autoOpenPanel: boolean;
  rememberSelectedCli: boolean;
  debug: boolean;
  locale: string;
  isMac: boolean;
  macTaskShell: MacTaskShell;
  thinkingMode: ThinkingMode;
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
  };
  editorContext: EditorContextState;
};
