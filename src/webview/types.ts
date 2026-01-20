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
  | { type: "updateSetting"; key: string; value: unknown }
  | { type: "sendPrompt"; prompt: string }
  | { type: "stopRun" }
  | { type: "openConfig" }
  | { type: "resolveDropPaths"; uris: string[] }
  | { type: "pickWorkspacePath" }
  | { type: "uploadFiles"; files: UploadFilePayload[] }
  | { type: "loadRules"; cli: CliName; scope: "global" | "project" }
  | { type: "saveRules"; content: string; targets: CliName[]; scope: "global" | "project" };

export type UploadFilePayload = {
  name: string;
  type: string;
  dataUrl: string;
};

export type SessionSummary = {
  id: string;
  label: string;
  lastUsedAt: number;
  cli: CliName;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "trace";
  content: string;
  createdAt?: number;
  kind?: "thinking" | "normal";
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
  configState: {
    configs: ConfigSummary[];
    activeConfigId: string | null;
  };
};
