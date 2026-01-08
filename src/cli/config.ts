import * as vscode from "vscode";
import { CliName, ThinkingMode, ThinkingWorkspaceFile } from "./types";

export const CONFIG_NAMESPACE = "sinitek-cli-tools";

export function getDefaultCli(): CliName {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<CliName>("defaultCli", "codex");
}

export function getCliCommand(cli: CliName): string {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string>(`commands.${cli}`, cli);
}

export function getCliArgs(cli: CliName): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string[]>(`args.${cli}`, []);
}

export function getAutoOpenPanel(): boolean {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<boolean>("autoOpenPanel", false);
}

export function getRememberSelectedCli(): boolean {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<boolean>("rememberSelectedCli", true);
}

export function getThinkingArgs(cli: CliName, mode: ThinkingMode): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string[]>(`thinkingArgs.${cli}.${mode}`, []);
}

export function getThinkingMode(cli: CliName): ThinkingMode {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const globalMode = config.get<ThinkingMode>("thinkingMode");
  if (globalMode) {
    if (cli !== "codex" && globalMode === "xhigh") {
      return "high";
    }
    if (cli === "codex" && globalMode === "off") {
      return "low";
    }
    return globalMode;
  }
  const perCliKey = `thinkingMode${cli.charAt(0).toUpperCase()}${cli.slice(1)}`;
  const mode = config.get<ThinkingMode>(perCliKey)
    ?? config.get<ThinkingMode>(`thinkingMode.${cli}`, "medium");
  if (cli !== "codex" && mode === "xhigh") {
    return "high";
  }
  if (cli === "codex" && mode === "off") {
    return "low";
  }
  return mode;
}

export function getThinkingPromptPrefix(cli: CliName, mode: ThinkingMode): string {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string>(`thinkingPromptPrefix.${cli}.${mode}`, "");
}

export function getThinkingPromptSuffix(cli: CliName, mode: ThinkingMode): string {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string>(`thinkingPromptSuffix.${cli}.${mode}`, "");
}

export function getThinkingWorkspaceFiles(
  cli: CliName,
  mode: ThinkingMode
): ThinkingWorkspaceFile[] {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<ThinkingWorkspaceFile[]>(`thinkingWorkspaceFiles.${cli}.${mode}`, []);
}
