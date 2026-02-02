import { CliName, ThinkingMode } from "../cli/types";
import { ConfigPlatform } from "../config/types";

export type ConfigSummary = {
  id: string;
  name: string;
  platform: ConfigPlatform;
};

export type PanelMessage =
  | { type: "requestState" }
  | { type: "selectCli"; cli: CliName }
  | { type: "selectSession"; sessionId: string | null; cli: CliName }
  | { type: "newSession" }
  | { type: "deleteSession"; sessionId: string; cli: CliName }
  | { type: "applyConfig"; cli: CliName; configId: string }
  | { type: "clearAllSessions" }
  | { type: "clearPromptHistory" }
  | { type: "updateSetting"; key: string; value: unknown }
  | { type: "sendPrompt"; prompt: string }
  | { type: "stopRun" }
  | { type: "runCommonCommand"; command: "compactContext" }
  | { type: "openConfig" }
  | { type: "resolveDropPaths"; uris: string[] }
  | { type: "pickWorkspacePath" }
  | { type: "uploadFiles"; files: UploadFilePayload[] }
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
    };

export type UploadFilePayload = {
  name: string;
  type: string;
  dataUrl: string;
};

export type SessionSummary = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  cli: CliName;
  firstPrompt?: string;
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
  kind?: "thinking" | "normal";
  merge?: boolean;
};

export type PanelState = {
  currentCli: CliName;
  autoOpenPanel: boolean;
  rememberSelectedCli: boolean;
  debug: boolean;
  thinkingMode: ThinkingMode;
  interactive: {
    supported: boolean;
    enabled: boolean;
  };
  rulePaths: {
    global: Record<CliName, string>;
    project: Record<CliName, string | null>;
  };
  sessionState: {
    currentSessionId: string | null;
    sessions: SessionSummary[];
  };
  promptHistory: PromptHistoryItem[];
  configState: {
    configs: ConfigSummary[];
    activeConfigId: string | null;
  };
};
