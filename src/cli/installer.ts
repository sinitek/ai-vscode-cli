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

export function getCliInstallCommand(cli: CliName): string {
  return CLI_INSTALL_COMMANDS[cli];
}

export function getCliDisplayName(cli: CliName): string {
  return CLI_DISPLAY_NAMES[cli];
}

export function getCodeGraphInstallCommand(options: { initializeWorkspace?: boolean } = {}): string {
  const commands = [
    `npm install -g ${CODEGRAPH_NPM_PACKAGE}@latest`,
    "codegraph install --target codex --location global",
  ];
  if (options.initializeWorkspace) {
    commands.push("codegraph init");
  }
  return commands.join(" && ");
}
