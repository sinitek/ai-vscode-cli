import { CLI_LIST, CliName } from "./types";

const CODEGRAPH_NPM_PACKAGE = "@colbymchenry/codegraph";

const CLI_NPM_INSTALL_COMMANDS: Record<Exclude<CliName, "grok">, string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
  opencode: "npm install -g opencode-ai",
  dsh: "npm install -g @deepseek-ai/dsh",
  "kimi-code": "npm install -g @moonshot-ai/kimi-code@latest",
  zcode: "npm install -g zcode-app-cli@latest",
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
  return CLI_NPM_INSTALL_COMMANDS[cli];
}

export function getCliInstallCommands(
  processPlatform: NodeJS.Platform = process.platform,
): Record<CliName, string> {
  const commands = {} as Record<CliName, string>;
  for (const cli of CLI_LIST) {
    commands[cli] = getCliInstallCommand(cli, processPlatform);
  }
  return commands;
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
