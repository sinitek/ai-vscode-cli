import { CliName, isOpenCodeCli } from "./types";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function splitProviderModel(value: string): { providerId: string; modelId: string } | null {
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function getOpenCodeProviderModelKeys(config: Record<string, unknown>, providerId: string): string[] {
  const providers = isPlainObject(config.provider) ? config.provider : {};
  const providerConfig = providers[providerId];
  if (!isPlainObject(providerConfig)) {
    return [];
  }
  const models = isPlainObject(providerConfig.models) ? providerConfig.models : {};
  return Object.keys(models);
}

export function resolveOpenCodeModelForConfig(
  model: string | null | undefined,
  openCodeConfigContent: string | null | undefined,
): OpenCodeModelResolution {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedModel) {
    return { model: null, error: null };
  }
  if (splitProviderModel(normalizedModel)) {
    return { model: normalizedModel, error: null };
  }

  const configText = typeof openCodeConfigContent === "string" ? openCodeConfigContent.trim() : "";
  if (!configText) {
    return { model: normalizedModel, error: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return { model: normalizedModel, error: null };
  }
  if (!isPlainObject(parsed)) {
    return { model: normalizedModel, error: null };
  }

  const activeModel = typeof parsed.model === "string" ? parsed.model.trim() : "";
  const activeRef = splitProviderModel(activeModel);
  if (!activeRef) {
    return { model: normalizedModel, error: null };
  }

  const activeProviderModelKeys = getOpenCodeProviderModelKeys(parsed, activeRef.providerId);
  if (activeProviderModelKeys.includes(normalizedModel)) {
    return {
      model: `${activeRef.providerId}/${normalizedModel}`,
      error: null,
    };
  }

  return {
    model: null,
    error: [
      `OpenCode selected model "${normalizedModel}" is not defined in active provider "${activeRef.providerId}".`,
      `Use a provider-qualified model such as "${activeModel}", or add "${normalizedModel}" to provider.${activeRef.providerId}.models in ~/.opencode/config.json.`,
    ].join(" "),
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
  if (!normalizedModel || !supportsCliManagedModelSelection(cli)) {
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
