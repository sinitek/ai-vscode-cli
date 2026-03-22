import { CliName } from "./types";

const MODEL_ARG_KEYS: Record<CliName, string[]> = {
  codex: ["--model", "-m"],
  claude: ["--model"],
  gemini: ["--model", "-m"],
};

const PREFERRED_MODEL_ARG: Record<CliName, string> = {
  codex: "--model",
  claude: "--model",
  gemini: "-m",
};

function isModelArgKey(cli: CliName, value: string): boolean {
  return MODEL_ARG_KEYS[cli].includes(value);
}

export function readModelArg(cli: CliName, args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (isModelArgKey(cli, current)) {
      const next = args[index + 1];
      return typeof next === "string" && next.trim() ? next.trim() : null;
    }
    for (const key of MODEL_ARG_KEYS[cli]) {
      const prefix = `${key}=`;
      if (current.startsWith(prefix)) {
        const value = current.slice(prefix.length).trim();
        return value || null;
      }
    }
  }
  return null;
}

export function stripModelArgs(cli: CliName, args: string[]): string[] {
  const nextArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (isModelArgKey(cli, current)) {
      index += 1;
      continue;
    }
    let handledInline = false;
    for (const key of MODEL_ARG_KEYS[cli]) {
      if (current.startsWith(`${key}=`)) {
        handledInline = true;
        break;
      }
    }
    if (handledInline) {
      continue;
    }
    nextArgs.push(current);
  }
  return nextArgs;
}

export function applyModelArg(cli: CliName, args: string[], model: string | null | undefined): string[] {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedModel) {
    return [...args];
  }
  const nextArgs = stripModelArgs(cli, args);
  nextArgs.push(PREFERRED_MODEL_ARG[cli], normalizedModel);
  return nextArgs;
}

