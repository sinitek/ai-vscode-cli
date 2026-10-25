export const CLI_LIST = ["codex", "claude", "opencode", "grok", "dsh"] as const;

export type PublicCliName = (typeof CLI_LIST)[number];

export type CliName = PublicCliName;

export function isOpenCodeCli(value: unknown): boolean {
  return value === "opencode";
}

export type ThinkingMode = "off" | "on" | "low" | "medium" | "high" | "xhigh" | "ultra" | "max";

export type OpenCodeVariantOption = {
  value: string;
  label: string;
  source?: "resolved-cli" | "config";
};

export type OpenCodeThinkingMessageKey =
  | "follow-default"
  | "loading"
  | "select-model"
  | "metadata-error"
  | "no-variants"
  | "config-variants";

export type OpenCodeThinkingState = {
  providerId: string | null;
  modelId: string | null;
  reasoning: boolean | "unknown";
  options: OpenCodeVariantOption[];
  selectedVariant: string | null;
  status: "ready" | "unknown" | "error";
  source: "resolved-cli" | "config" | "fallback";
  disabled: boolean;
  messageKey?: OpenCodeThinkingMessageKey;
};

export const LOOP_PLUS_INTERACTIVE_MODE = "loop_plus" as const;
export const LOOP_PLUS_DISPLAY_NAME = "Loop+";

export type InteractiveMode = "coding" | "plan" | "loop" | "graph" | typeof LOOP_PLUS_INTERACTIVE_MODE;

export type LoopExecutionMode = "main_sub_multi_agent" | "debate_multi_agent";

export const DEFAULT_LOOP_EXECUTION_MODE: LoopExecutionMode = "main_sub_multi_agent";

export function normalizeLoopExecutionMode(value: unknown): LoopExecutionMode {
  if (value === "debate_multi_agent") {
    return "debate_multi_agent";
  }
  return DEFAULT_LOOP_EXECUTION_MODE;
}

export type MacTaskShell = "zsh" | "bash";

export type ThinkingWorkspaceFile = {
  path: string;
  content: string;
};

export const GROK_CLI = "grok" as const;

export type GrokCliName = typeof GROK_CLI;

export const DSH_CLI = "dsh" as const;

export type DshCliName = typeof DSH_CLI;

export const GROK_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type GrokReasoningEffort = (typeof GROK_REASONING_EFFORTS)[number];

export function mapThinkingModeToGrokEffort(mode: unknown): GrokReasoningEffort | null {
  if (typeof mode !== "string") {
    return null;
  }
  const normalized = mode.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "off") {
    return "none";
  }
  if (normalized === "on") {
    return "medium";
  }
  if (normalized === "ultra") {
    return "max";
  }
  if ((GROK_REASONING_EFFORTS as readonly string[]).includes(normalized)) {
    return normalized as GrokReasoningEffort;
  }
  return null;
}


export function createCliRecord<T>(create: (cli: CliName) => T): Record<CliName, T> {
  const record = {} as Record<CliName, T>;
  for (const cli of CLI_LIST) {
    record[cli] = create(cli);
  }
  return record;
}
