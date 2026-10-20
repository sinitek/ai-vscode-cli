import { CLI_LIST, type CliName, type ThinkingMode } from "./cli/types";

const THINKING_MODES = ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"] as const;

export const INVALID_SUBTASK_CLI_ROUTE = "invalid-subtask-cli";

export type SubtaskRouteIdentity = {
  cli?: CliName;
  configId?: string;
  model?: string;
  fallback?: string;
};

export type ResolvedSubtaskExecution = {
  cli: CliName;
  configId: string | null;
  model?: string;
  thinkingMode?: ThinkingMode;
  crossCli: boolean;
  unavailableReason?: string;
};

export function parseCliName(value: unknown): CliName | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return (CLI_LIST as readonly string[]).includes(normalized) ? normalized as CliName : undefined;
}

export function parseCliNameField(value: unknown): { ok: true; cli?: CliName } | { ok: false } {
  if (value == null) {
    return { ok: true };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true };
  }
  const cli = parseCliName(trimmed);
  return cli ? { ok: true, cli } : { ok: false };
}

export function cliSupportsExplicitModelSelection(cli: CliName): boolean {
  return cli !== "claude";
}

export function normalizeRouteConfigId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

export function normalizeRouteModel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

export function normalizeRouteThinkingMode(value: unknown): ThinkingMode | undefined {
  return typeof value === "string" && (THINKING_MODES as readonly string[]).includes(value)
    ? value as ThinkingMode
    : undefined;
}

export function readSubtaskRouteIdentity(value: unknown): SubtaskRouteIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as { cli?: unknown; configId?: string; model?: unknown; fallback?: unknown };
  const parsedCli = parseCliNameField(raw.cli);
  if (!parsedCli.ok) {
    return null;
  }
  const model = normalizeRouteModel(raw.model);
  const fallback = normalizeRouteModel(raw.fallback);
  const configId = normalizeRouteConfigId(raw.configId);
  if (!parsedCli.cli && !configId && !model && !fallback) {
    return null;
  }
  return {
    ...(parsedCli.cli ? { cli: parsedCli.cli } : {}),
    ...(configId ? { configId } : {}),
    ...(model ? { model } : {}),
    ...(fallback ? { fallback } : {}),
  };
}

export function subtaskRouteIsConfigured(
  route: { cli?: CliName; model?: string; configId?: string } | null | undefined,
): boolean {
  return Boolean(route?.cli || route?.model || route?.configId);
}

export function formatSubtaskRouteSummary(
  route: { cli?: CliName | null; model?: string | null } | null | undefined,
  unrecorded: string,
): string {
  const model = normalizeRouteModel(route?.model);
  const cli = route?.cli;
  if (cli && !model) {
    return cli === "claude" ? `${cli} / 默认模型` : `${cli} / 默认模型`;
  }
  if (cli && model) {
    return `${cli} / ${model}`;
  }
  return model || unrecorded;
}

export function resolveStoredSubtaskExecution(input: {
  mainCli: CliName;
  route?: { cli?: unknown; configId?: unknown; model?: unknown } | null;
  routeFallback?: unknown;
  prompt?: {
    loopSubtaskCli?: unknown;
    loopSubtaskConfigId?: unknown;
    loopSubtaskModel?: unknown;
    loopSubtaskThinkingMode?: unknown;
  } | null;
  originThinkingMode?: unknown;
}): ResolvedSubtaskExecution {
  const promptCliInvalid = Boolean(input.prompt?.loopSubtaskCli) && parseCliNameField(input.prompt?.loopSubtaskCli).ok === false;
  if (input.routeFallback === INVALID_SUBTASK_CLI_ROUTE || promptCliInvalid) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: "子模型 CLI 分组无效，不能派发子任务。",
    };
  }
  const routeCli = parseCliNameField(input.route?.cli);
  const promptCli = parseCliNameField(input.prompt?.loopSubtaskCli);
  if (!routeCli.ok || !promptCli.ok) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: "子模型 CLI 分组无效，不能派发子任务。",
    };
  }
  const cli = routeCli.cli ?? promptCli.cli ?? input.mainCli;
  const crossCli = cli !== input.mainCli;
  const configId = normalizeRouteConfigId(input.route?.configId)
    ?? normalizeRouteConfigId(input.prompt?.loopSubtaskConfigId)
    ?? null;
  if (crossCli && !configId) {
    return {
      cli,
      configId: null,
      crossCli: true,
      unavailableReason: "目标 CLI 没有可用配置，不能派发子任务。",
    };
  }
  const routeModel = normalizeRouteModel(input.route?.model);
  const promptModel = normalizeRouteModel(input.prompt?.loopSubtaskModel);
  const model = input.route?.cli
    ? routeModel
    : (promptModel ?? routeModel);
  const thinkingMode = normalizeRouteThinkingMode(input.originThinkingMode)
    ?? normalizeRouteThinkingMode(input.prompt?.loopSubtaskThinkingMode);
  return {
    cli,
    configId: crossCli ? configId : (configId ?? null),
    ...(model ? { model } : {}),
    ...(thinkingMode ? { thinkingMode } : {}),
    crossCli,
  };
}

export function isolateCrossCliSubtaskModel(input: {
  mainCli?: CliName;
  loopSubtaskCli?: unknown;
  loopSubtaskModel?: unknown;
  fallbackModel?: string;
}): string | undefined {
  const subtaskCli = parseCliName(input.loopSubtaskCli);
  const explicit = normalizeRouteModel(input.loopSubtaskModel);
  if (subtaskCli && input.mainCli && subtaskCli !== input.mainCli) {
    return explicit;
  }
  return explicit ?? input.fallbackModel;
}

export type BoundSubtaskConfigPlan =
  | { action: "skip" }
  | { action: "apply"; cli: CliName; configId: string }
  | { action: "fail"; message: string };

export function planBoundSubtaskConfigApply(input: {
  taskRole?: string | null;
  targetCli: CliName;
  loopSubtaskCli?: unknown;
  loopSubtaskConfigId?: unknown;
  activeConfigId?: string | null;
  configExists: boolean;
}): BoundSubtaskConfigPlan {
  if (input.taskRole !== "subtask") {
    return { action: "skip" };
  }
  const parsedCli = parseCliNameField(input.loopSubtaskCli);
  if (!parsedCli.ok) {
    return { action: "fail", message: "子模型 CLI 分组无效，不能派发子任务。" };
  }
  if (parsedCli.cli && parsedCli.cli !== input.targetCli) {
    return { action: "fail", message: "子任务 CLI 与执行目标不一致，不能派发。" };
  }
  const configId = normalizeRouteConfigId(input.loopSubtaskConfigId);
  if (!configId) {
    return parsedCli.cli
      ? { action: "fail", message: "目标 CLI 没有可用配置，不能派发子任务。" }
      : { action: "skip" };
  }
  if (!input.configExists) {
    return { action: "fail", message: "目标 CLI 配置不可用，不能派发子任务。" };
  }
  if ((input.activeConfigId ?? null) === configId) {
    return { action: "skip" };
  }
  return { action: "apply", cli: input.targetCli, configId };
}
