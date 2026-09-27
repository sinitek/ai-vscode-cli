import { CliName } from "./types";

const CODEGRAPH_NPM_PACKAGE = "@colbymchenry/codegraph";

const CLI_INSTALL_COMMANDS: Record<CliName, string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
  opencode: "npm install -g opencode-ai",
};

const CLI_DISPLAY_NAMES: Record<CliName, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
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

export function getCliInstallCommand(cli: CliName): string {
  return CLI_INSTALL_COMMANDS[cli];
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
