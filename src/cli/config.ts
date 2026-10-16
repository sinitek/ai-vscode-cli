import * as path from "path";
import * as vscode from "vscode";
import { applyModelArg, stripModelArgs } from "./modelArgs";
import { CLI_LIST, CliName, isOpenCodeCli, MacTaskShell, ThinkingMode, ThinkingWorkspaceFile } from "./types";
import { readToolSettings } from "../toolSettings";

export const CONFIG_NAMESPACE = "sinitek-cli-tools";
const MAC_TASK_SHELL_KEY = "macTaskShell";
const DEFAULT_MAC_TASK_SHELL: MacTaskShell = "zsh";

function isConfiguredCliName(value: unknown): value is CliName {
  return typeof value === "string" && (CLI_LIST as readonly string[]).includes(value);
}

function normalizeMacTaskShell(value: unknown): MacTaskShell | null {
  if (value === "zsh" || value === "bash") {
    return value;
  }
  return null;
}

function detectCurrentMacTaskShell(): MacTaskShell {
  const currentShell = process.env.SHELL;
  const shellName = currentShell ? path.basename(currentShell).toLowerCase() : "";
  if (shellName === "bash") {
    return "bash";
  }
  return "zsh";
}

export function getDefaultCli(): CliName {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const configured = config.get<string>("defaultCli", "codex");
  return isConfiguredCliName(configured) ? configured : "codex";
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

export function getAutoAddEditorContextTags(): boolean {
  const stored = readToolSettings().autoAddEditorContextTags;
  if (typeof stored === "boolean") {
    return stored;
  }
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<boolean>("autoAddEditorContextTags", false);
}

export function getDebugLogging(): boolean {
  const stored = readToolSettings().debug;
  if (typeof stored === "boolean") {
    return stored;
  }
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<boolean>("debug", false);
}

export function getMacTaskShell(): MacTaskShell {
  if (process.platform !== "darwin") {
    return DEFAULT_MAC_TASK_SHELL;
  }
  const stored = normalizeMacTaskShell(readToolSettings().macTaskShell);
  if (stored) {
    return stored;
  }
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const inspected = config.inspect<unknown>(MAC_TASK_SHELL_KEY);
  const explicitValue = normalizeMacTaskShell(
    inspected?.workspaceFolderValue
    ?? inspected?.workspaceValue
    ?? inspected?.globalValue
  );
  if (explicitValue) {
    return explicitValue;
  }
  return detectCurrentMacTaskShell();
}

export function isInteractiveSupported(cli: CliName): boolean {
  return cli === "codex" || cli === "claude" || cli === "grok";
}

export function getThinkingArgs(cli: CliName, mode: ThinkingMode): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string[]>(`thinkingArgs.${cli}.${mode}`, []);
}

export function getThinkingMode(cli: CliName): ThinkingMode {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const usesCodexLikeThinking = cli === "codex" || isOpenCodeCli(cli);
  const globalMode = config.get<ThinkingMode>("thinkingMode");
  if (globalMode) {
    if (cli !== "codex" && cli !== "claude" && cli !== "grok" && globalMode === "max") {
      return "high";
    }
    if (!usesCodexLikeThinking && cli !== "claude" && cli !== "grok" && globalMode === "xhigh") {
      return "high";
    }
    if (usesCodexLikeThinking && globalMode === "off") {
      return "low";
    }
    return globalMode;
  }
  const perCliKey = `thinkingMode${cli.charAt(0).toUpperCase()}${cli.slice(1)}`;
  const mode = config.get<ThinkingMode>(perCliKey)
    ?? config.get<ThinkingMode>(`thinkingMode.${cli}`, "medium");
  if (cli !== "codex" && cli !== "claude" && cli !== "grok" && mode === "max") {
    return "high";
  }
  if (!usesCodexLikeThinking && cli !== "claude" && cli !== "grok" && mode === "xhigh") {
    return "high";
  }
  if (usesCodexLikeThinking && mode === "off") {
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

export const GROK_FORBIDDEN_AGENT_ARGS = [
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-skip-permissions",
] as const;

const GROK_APPROVAL_SWITCHES = new Set(["--always-approve", "--yolo"]);

export function sanitizeGrokAgentArgs(args: readonly unknown[]): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string" || arg.trim().length === 0) {
      continue;
    }
    const normalized = arg.trim();
    if (
      isForbiddenGrokAgentArg(normalized)
      || GROK_APPROVAL_SWITCHES.has(normalized)
      || normalized.startsWith("--always-approve=")
      || normalized.startsWith("--yolo=")
      || normalized.startsWith("--permission-mode=")
    ) {
      continue;
    }
    if (normalized === "--permission-mode") {
      const next = args[index + 1];
      if (typeof next === "string" && next.trim().length > 0 && !next.trim().startsWith("-")) {
        index += 1;
      }
      continue;
    }
    sanitized.push(arg);
  }
  return sanitized;
}

export function buildGrokAgentStdioArgs(agentArgs: readonly unknown[], model?: string | null): string[] {
  const sanitized = stripModelArgs("grok", sanitizeGrokAgentArgs(agentArgs));
  const withModel = applyModelArg("grok", sanitized, model);
  return [
    "--no-auto-update",
    "--permission-mode",
    "bypassPermissions",
    "agent",
    ...withModel,
    "stdio",
  ];
}

export function getGrokCommand(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const configured = config.get<string>("commands.grok");
  const command = typeof configured === "string" ? configured.trim() : "";
  return command || "grok";
}

export function getGrokAgentArgs(): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const configured = config.get<unknown>("args.grok");
  if (!Array.isArray(configured)) {
    return [];
  }
  return sanitizeGrokAgentArgs(configured);
}

function isForbiddenGrokAgentArg(arg: string): boolean {
  const normalized = arg.trim();
  return GROK_FORBIDDEN_AGENT_ARGS.some((forbidden) => (
    normalized === forbidden || normalized.startsWith(`${forbidden}=`)
  ));
}
