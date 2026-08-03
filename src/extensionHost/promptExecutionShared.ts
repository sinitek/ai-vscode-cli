import type { OpenCodeSubagentConnection } from "../cli/openCodeSubagentMonitor";
import type { OpenCodeCanonicalModelRole, OpenCodeModelRoleInput } from "../cli/opencodeconfigmodels";
import type { CliName } from "../cli/types";
import type { LoopTaskRole } from "../promptRunState";
import type { ChatMessage } from "../webview/types";

export type PromptRunExecutionOptions = {
  cwd?: string;
  isolateProjectInstructions?: boolean;
};

export type InteractiveTabRun = {
  runId: string;
  tabId: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
  stop: () => void;
  messageTarget: ChatMessage[];
  stopped: boolean;
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
};

export type OpenCodeRuntimePreparationInput = {
  configId?: string | null;
  role?: OpenCodeModelRoleInput;
  model?: string | null;
  requiresSubtaskModel?: boolean;
};

export type OpenCodeRuntimePreparation = {
  envOverrides: Record<string, string>;
  configContent: string;
  role: OpenCodeCanonicalModelRole;
  mainModel: string;
  subtaskModel: string | null;
  effectiveModel: string;
  mainVariant: string | null;
  subtaskVariant: string | null;
  effectiveVariant: string | null;
  modelFallback: string;
  primaryModel: string;
  smallModel: string | null;
  primaryVariant: string | null;
  smallVariant: string | null;
};

export type PreparedOpenCodeSubagentRuntime = {
  connection: OpenCodeSubagentConnection | null;
  endpointSource: "managed-server" | "configured-attach" | "unavailable";
  error: Error | null;
  dispose: () => void;
};
