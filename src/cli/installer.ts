import { CliName } from "./types";

const CLI_INSTALL_COMMANDS: Record<CliName, string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
  gemini: "npm install -g @google/gemini-cli",
};

const CLI_DISPLAY_NAMES: Record<CliName, string> = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
};

export function getCliInstallCommand(cli: CliName): string {
  return CLI_INSTALL_COMMANDS[cli];
}

export function getCliDisplayName(cli: CliName): string {
  return CLI_DISPLAY_NAMES[cli];
}
