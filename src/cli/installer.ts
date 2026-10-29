import { CliName } from "./types";

const CODEGRAPH_NPM_PACKAGE = "@colbymchenry/codegraph";

const CLI_NPM_INSTALL_COMMANDS: Record<Exclude<CliName, "grok" | "zcode">, string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
  opencode: "npm install -g opencode-ai",
  dsh: "npm install -g @deepseek-ai/dsh",
  "kimi-code": "npm install -g @moonshot-ai/kimi-code@latest",
};

const GROK_INSTALL_COMMANDS: Record<"windows" | "unix", string> = {
  windows: "irm https://x.ai/cli/install.ps1 | iex",
  unix: "curl -fsSL https://x.ai/cli/install.sh | bash",
};

const CLI_DISPLAY_NAMES: Record<CliName, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
  grok: "Grok",
  dsh: "DSH",
  "kimi-code": "KimiCode",
  zcode: "ZCode",
};

const CODEGRAPH_INSTALL_STEP_COMMANDS = {
  installCli: `npm install -g ${CODEGRAPH_NPM_PACKAGE}@latest`,
  registerMcp: "codegraph install --target codex --location global",
  initWorkspace: "codegraph init",
} as const;

export type CodeGraphInstallStep = keyof typeof CODEGRAPH_INSTALL_STEP_COMMANDS;

export type CodeGraphInstallCommandOptions = {
  cliInstalled?: boolean;
  mcpConfigured?: boolean;
  initializeWorkspace?: boolean;
};

export function getCliInstallCommand(cli: CliName, processPlatform: NodeJS.Platform = process.platform): string {
  if (cli === "grok") {
    return processPlatform === "win32" ? GROK_INSTALL_COMMANDS.windows : GROK_INSTALL_COMMANDS.unix;
  }
  // ZCode 0.17.0 on this machine is the official desktop app shim, not an npm package.
  // Do not invent an install command.
  if (cli === "zcode") {
    return "";
  }
  return CLI_NPM_INSTALL_COMMANDS[cli];
}

export function getCliDisplayName(cli: CliName): string {
  return CLI_DISPLAY_NAMES[cli];
}

export function getCodeGraphInstallSteps(options: CodeGraphInstallCommandOptions = {}): CodeGraphInstallStep[] {
  const cliInstalled = options.cliInstalled === true;
  const steps: CodeGraphInstallStep[] = [];
  if (!cliInstalled) {
    steps.push("installCli", "registerMcp");
  } else if (options.mcpConfigured !== true) {
    steps.push("registerMcp");
  }
  if (options.initializeWorkspace) {
    steps.push("initWorkspace");
  }
  return steps;
}

export function getCodeGraphInstallCommand(options: CodeGraphInstallCommandOptions = {}): string {
  return getCodeGraphInstallSteps(options)
    .map((step) => CODEGRAPH_INSTALL_STEP_COMMANDS[step])
    .join(" && ");
}
