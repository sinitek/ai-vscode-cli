export const CLI_LIST = ["codex", "claude", "opencode"] as const;

export type PublicCliName = (typeof CLI_LIST)[number];

export type CliName = PublicCliName;

export function isOpenCodeCli(value: unknown): boolean {
  return value === "opencode";
}

export type ThinkingMode = "off" | "on" | "low" | "medium" | "high" | "xhigh" | "max";

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

export type InteractiveMode = "coding" | "plan" | "lobster";

export type LobsterExecutionMode = "main_sub_multi_agent" | "debate_multi_agent";

export const DEFAULT_LOBSTER_EXECUTION_MODE: LobsterExecutionMode = "main_sub_multi_agent";

export function normalizeLobsterExecutionMode(value: unknown): LobsterExecutionMode {
  if (value === "debate_multi_agent") {
    return "debate_multi_agent";
  }
  return DEFAULT_LOBSTER_EXECUTION_MODE;
}

export type MacTaskShell = "zsh" | "bash";

export type ThinkingWorkspaceFile = {
  path: string;
  content: string;
};
