import type { OpenCodeSubagentConnection } from "../cli/openCodeSubagentMonitor";
import type { OpenCodeCanonicalModelRole, OpenCodeModelRoleInput } from "../cli/opencodeconfigmodels";
import type { CliName } from "../cli/types";
import type { CodexRuntimeConfigEvidence } from "../config/codexRuntimeConfigIdentity";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { LoopTaskRole } from "../promptRunState";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput } from "../promptRunTypes";
import type { PreparedLoopMainExecution } from "./promptRunHandoff";

export type PromptRunExecutionOptions = {
  registerQuestionRun?: (runId: string) => void;
  /** Original Loop+ runner capability, captured before its first native start. */
  departmentInteractiveRunner?: (runner: object, release: () => Promise<void>) => (nativeSessionId: string) => Promise<void>;
  /** Trusted per-invocation process transport; never serialized into task/model input. */
  departmentProcessStream?: typeof import("../cli/commandRunner").runCliStream;
  /** Trusted leader mapping: preserve its durable local tab/session key. */
  departmentLeaderNativeSession?: (sessionId: string) => void;
  /** Trusted interactive Owner transport; never serialized into model/task input. */
  departmentCodexRun?: (prompt: string, handlers: import("../interactive/codexOwnedExecution").CodexOwnedStreamHandlers) => Promise<void>;
  cancelDepartmentCodexPreparation?: () => void;
  requireOriginalSession?: boolean;
  prepareOriginalSession?: {
    configId: string;
    codexConfigEvidence: CodexRuntimeConfigEvidence;
    isConfigCurrent: () => boolean;
    prepare: () => PreparedLoopMainExecution;
  };
  onOriginalTurnStartRejected?: () => void;
  originalSessionPreparationSignal?: AbortSignal;
  cwd?: string;
  isolateProjectInstructions?: boolean;
  isAborted?: () => boolean;
};

export function shouldUseClassicLoopProjectInstructions(
  input: Pick<PromptRunInput, "taskRole" | "loopTaskId">,
  task: Pick<LoopTaskRecord, "schedulingMode"> | null,
): boolean {
  return input.taskRole === "subtask"
    && Boolean(input.loopTaskId)
    && task !== null
    && (task.schedulingMode === "classic" || task.schedulingMode === undefined);
}

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
};

export type OpenCodeRuntimePreparationInput = {
  configId?: string | null;
  role?: OpenCodeModelRoleInput;
  model?: string | null;
  variant?: string | null;
  requiresSubtaskModel?: boolean;
};

export type OpenCodeRuntimePreparation = {
  configId?: string | null;
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
