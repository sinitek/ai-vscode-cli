import { CliName, isOpenCodeCli } from "./types";
import {
  parseOpenCodeConfigModels,
  validateOpenCodeModelOverride,
} from "./opencodeconfigmodels";

const MODEL_ARG_KEYS: Record<string, string[]> = {
  codex: ["--model", "-m"],
  claude: ["--model"],
  opencode: ["--model", "-m"],
};

const PREFERRED_MODEL_ARG: Record<string, string> = {
  codex: "--model",
  claude: "--model",
  opencode: "--model",
};

export type ApplyModelArgOptions = {
  openCodeConfigContent?: string | null;
};

export type OpenCodeModelResolution = {
  model: string | null;
  error: string | null;
};

export function supportsCliManagedModelSelection(cli: CliName): boolean {
  return cli === "codex" || isOpenCodeCli(cli);
}

export function resolveOpenCodeModelForConfig(
  model: string | null | undefined,
  openCodeConfigContent: string | null | undefined,
): OpenCodeModelResolution {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedModel) {
    return { model: null, error: null };
  }
  const parsed = parseOpenCodeConfigModels(openCodeConfigContent);
  const validation = validateOpenCodeModelOverride(parsed, "primary", normalizedModel);
  if (validation.ok && validation.modelRef) {
    return { model: validation.modelRef, error: null };
  }
  return {
    model: null,
    error: validation.issue?.message ?? "OpenCode selected model is invalid.",
  };
}

function isModelArgKey(cli: CliName, value: string): boolean {
  return (MODEL_ARG_KEYS[cli] ?? []).includes(value);
}

export function readModelArg(cli: CliName, args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (isModelArgKey(cli, current)) {
      const next = args[index + 1];
      return typeof next === "string" && next.trim() ? next.trim() : null;
    }
    for (const key of MODEL_ARG_KEYS[cli] ?? []) {
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
    for (const key of MODEL_ARG_KEYS[cli] ?? []) {
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

export function applyModelArg(
  cli: CliName,
  args: string[],
  model: string | null | undefined,
  options: ApplyModelArgOptions = {},
): string[] {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedModel || (cli !== "codex" && !isOpenCodeCli(cli))) {
    return [...args];
  }
  const resolvedModel = isOpenCodeCli(cli)
    ? resolveOpenCodeModelForConfig(normalizedModel, options.openCodeConfigContent)
    : { model: normalizedModel, error: null };
  if (resolvedModel.error) {
    throw new Error(resolvedModel.error);
  }
  if (!resolvedModel.model) {
    return [...args];
  }
  const nextArgs = stripModelArgs(cli, args);
  nextArgs.push(PREFERRED_MODEL_ARG[cli] ?? "--model", resolvedModel.model);
  return nextArgs;
}
