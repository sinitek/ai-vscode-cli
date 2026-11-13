import * as path from "path";

const LOGIN_SHELL_BASENAMES = new Set(["zsh", "bash", "sh"]);
const NVM_INCOMPATIBLE_ENV_KEYS = ["npm_config_prefix", "NPM_CONFIG_PREFIX"] as const;

export function isLoginShellCommand(command: string): boolean {
  return LOGIN_SHELL_BASENAMES.has(path.basename(command).toLowerCase());
}

// zsh and bash only read the user startup files when argv[0] is the shell.
// A renamed argv0 still accepts -l, but skips .zprofile/.bash_profile, so nvm
// never puts the user's CLI on PATH.
export function resolveChildArgv0(command: string, processLabel?: string): string | undefined {
  if (!processLabel) {
    return undefined;
  }
  if (isLoginShellCommand(command)) {
    return undefined;
  }
  return processLabel;
}

export function stripNvmIncompatibleEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const hasIncompatibleKey = NVM_INCOMPATIBLE_ENV_KEYS.some((key) => Object.prototype.hasOwnProperty.call(env, key));
  if (!hasIncompatibleKey) {
    return env;
  }
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of NVM_INCOMPATIBLE_ENV_KEYS) {
    delete next[key];
  }
  return next;
}
