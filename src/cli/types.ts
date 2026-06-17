export const CLI_LIST = ["codex", "claude", "gemini"] as const;

export type CliName = (typeof CLI_LIST)[number];

export type ThinkingMode = "off" | "on" | "low" | "medium" | "high" | "xhigh" | "max";

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
