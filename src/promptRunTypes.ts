import type { CliName, ThinkingMode } from "./cli/types";
import type { OpenCodeCanonicalModelRole } from "./cli/opencodeconfigmodels";
import type { LoopTaskRole } from "./promptRunState";
import type { ConversationExecutionProfile } from "./webview/types";
import type { LoopPlusAcceptancePlanSnapshot } from "./loopPlusAcceptancePlan";

export type PromptRunInput = {
  configSelections?: Partial<Record<CliName, import("./config/sharedRuntimeConfig").VisibleConfigSelection>>;
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  executionModel?: string | null;
  executionProfile?: ConversationExecutionProfile;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopSubtaskCli?: CliName;
  loopSubtaskConfigId?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopSubtaskFrontendCli?: CliName;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFrontendModel?: string;
  loopSubtaskFrontendThinkingMode?: ThinkingMode;
  loopSubtaskFullstackCli?: CliName;
  loopSubtaskFullstackConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopSubtaskFullstackThinkingMode?: ThinkingMode;
  loopSubtaskMode?: import("./loopPlusSubtaskMode").LoopSubtaskMode;
  loopMainModelFallback?: string;
  loopSubtaskModelFallback?: string;
  loopContinuePrompt?: string;
  loopPlusAcceptancePlan?: LoopPlusAcceptancePlanSnapshot;
  imagePaths?: string[];
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopAsk?: boolean;
  loopRound?: number;
  loopSubtaskId?: string;
  executionCwd?: string;
  isolateProjectInstructions?: boolean;
  skipLongTermMemoryPersist?: boolean;
  thinkingModeOverride?: ThinkingMode;
  throwOnError?: boolean;
  cliCommandRepairAttempted?: boolean;
};

export type PromptRunTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type ResolvedOpenCodeRoleModels = {
  main: string | null;
  subtask: string | null;
  fallback: Partial<Record<OpenCodeCanonicalModelRole, string>>;
};
