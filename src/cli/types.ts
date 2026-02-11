export const CLI_LIST = ["codex", "claude", "gemini"] as const;

export type CliName = (typeof CLI_LIST)[number];

export type ThinkingMode = "off" | "on" | "low" | "medium" | "high" | "xhigh";

export type InteractiveMode = "coding" | "plan";

export type MacTaskShell = "zsh" | "bash";

export type ThinkingWorkspaceFile = {
  path: string;
  content: string;
};
