import { CLI_LIST, type CliName, type ThinkingMode } from "./cli/types";
import {
  loopSubtaskRouteHasIdentity,
  readLoopSubtaskModeField,
  resolveStoredLoopSubtaskMode,
  type LoopSubtaskMode,
} from "./loopPlusSubtaskMode";
import type { LoopPlusTaskType, LoopTaskModelRoute, LoopTaskOriginProfile } from "./loopTaskStore";

const THINKING_MODES = ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"] as const;
export const SUBTASK_ROUTE_CONFIG_RETRY_DELAY_MS = 3000;
export const SUBTASK_ROUTE_CONFIG_MAX_RETRIES = 3;

export async function resolveSubtaskRouteConfigId(input: {
  cli: CliName;
  configId?: unknown;
  getActiveConfigId: (cli: CliName) => string | null;
  waitForConfigApply?: (cli: CliName) => Promise<boolean>;
  refreshPanelState?: () => Promise<void>;
  delay?: (milliseconds: number) => Promise<void>;
}): Promise<string | null> {
  const requestedConfigId = normalizeRouteConfigId(input.configId);
  if (requestedConfigId) {
    return requestedConfigId;
  }
  const delay = input.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  let activeConfigId = normalizeRouteConfigId(input.getActiveConfigId(input.cli));
  for (let attempt = 0; !activeConfigId && attempt < SUBTASK_ROUTE_CONFIG_MAX_RETRIES; attempt += 1) {
    await delay(SUBTASK_ROUTE_CONFIG_RETRY_DELAY_MS);
    try {
      await input.waitForConfigApply?.(input.cli);
    } catch {}
    try {
      await input.refreshPanelState?.();
    } catch {}
    activeConfigId = normalizeRouteConfigId(input.getActiveConfigId(input.cli));
  }
  return activeConfigId ?? null;
}

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

export type LoopPlusExecutionRole = "backend" | "frontend" | "general";

export type LoopPlusRoleRoutePrompt = {
  model?: unknown;
  loopMainModel?: unknown;
  loopMainThinkingMode?: unknown;
  loopSubtaskCli?: unknown;
  loopSubtaskConfigId?: unknown;
  loopSubtaskModel?: unknown;
  loopSubtaskThinkingMode?: unknown;
  loopSubtaskFrontendCli?: unknown;
  loopSubtaskFrontendConfigId?: unknown;
  loopSubtaskFrontendModel?: unknown;
  loopSubtaskFrontendThinkingMode?: unknown;
  loopSubtaskFullstackCli?: unknown;
  loopSubtaskFullstackConfigId?: unknown;
  loopSubtaskFullstackModel?: unknown;
  loopSubtaskFullstackThinkingMode?: unknown;
};

export type ResolvedLoopPlusRoleExecution = ResolvedSubtaskExecution & {
  role?: LoopPlusExecutionRole;
  mode?: LoopSubtaskMode;
  legacyAtomic?: boolean;
};

const GENERAL_CODING_CONFLICT = "分析任务不能携带编码交付。发现修改需求后交回主模型重新派发。";
const FRONTEND_ROUTE_MISSING = "子-前端配置不可用，不能派发前端编码任务。";
const FULLSTACK_ROUTE_MISSING = "子-全栈配置不可用，不能派发编码任务。";
const INVALID_SUBTASK_MODE = "子任务模式无效，不能派发。";
const BACKEND_CONFIG_MISSING = "目标 CLI 没有可用配置，不能派发子任务。";

export function resolveLoopPlusExecutionRole(input: {
  taskType?: LoopPlusTaskType;
  writeFiles?: readonly string[];
  codingDelivery?: boolean;
}): { ok: true; role: LoopPlusExecutionRole; legacy: boolean } | { ok: false; unavailableReason: string } {
  const writes = Array.isArray(input.writeFiles) && input.writeFiles.some((item) => typeof item === "string" && item.trim());
  const coding = input.codingDelivery === true || writes;
  if (input.taskType === "general") {
    if (coding) {
      return { ok: false, unavailableReason: GENERAL_CODING_CONFLICT };
    }
    return { ok: true, role: "general", legacy: false };
  }
  if (input.taskType === "frontend") {
    return { ok: true, role: "frontend", legacy: false };
  }
  if (input.taskType === "backend") {
    return { ok: true, role: "backend", legacy: false };
  }
  return { ok: true, role: "backend", legacy: true };
}

export function resolveLoopPlusRoleExecution(input: {
  mainCli: CliName;
  taskType?: LoopPlusTaskType;
  writeFiles?: readonly string[];
  codingDelivery?: boolean;
  loopSubtaskMode?: unknown;
  loopSubtaskModeInvalid?: boolean;
  mainRoute?: LoopTaskModelRoute | null;
  backendRoute?: LoopTaskModelRoute | null;
  frontendRoute?: LoopTaskModelRoute | null;
  fullstackRoute?: LoopTaskModelRoute | null;
  originProfile?: Pick<LoopTaskOriginProfile, "configId" | "mainThinkingMode" | "subtaskThinkingMode" | "subtaskFrontendThinkingMode" | "subtaskFullstackThinkingMode"> | null;
  prompt?: LoopPlusRoleRoutePrompt | null;
}): ResolvedLoopPlusRoleExecution {
  const explicitMode = readLoopSubtaskModeField(input.loopSubtaskMode);
  if (input.loopSubtaskModeInvalid || explicitMode === null) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: INVALID_SUBTASK_MODE,
    };
  }
  const mode = resolveStoredLoopSubtaskMode({
    loopSubtaskMode: explicitMode,
    frontendRoute: input.frontendRoute,
  });
  if (!mode) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: INVALID_SUBTASK_MODE,
    };
  }
  const legacyAtomic = !explicitMode && mode === "fullstack" && !loopSubtaskRouteHasIdentity(input.fullstackRoute);
  const role = resolveLoopPlusExecutionRole(input);
  if (!role.ok) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: role.unavailableReason,
      mode,
    };
  }
  if (role.role === "general") {
    return { ...resolveGeneralAnalysisExecution(input), role: "general", mode, legacyAtomic };
  }
  if (mode === "fullstack") {
    if (legacyAtomic) {
      return {
        ...resolveStoredSubtaskExecution({
          mainCli: input.mainCli,
          route: input.backendRoute,
          routeFallback: input.backendRoute?.fallback,
          prompt: input.prompt,
          originThinkingMode: input.originProfile?.subtaskThinkingMode,
        }),
        role: role.role,
        mode,
        legacyAtomic: true,
      };
    }
    if (!fullstackRouteIsPresent(input)) {
      return {
        cli: input.mainCli,
        configId: null,
        crossCli: false,
        unavailableReason: FULLSTACK_ROUTE_MISSING,
        role: role.role,
        mode,
      };
    }
    const resolved = resolveStoredSubtaskExecution({
      mainCli: input.mainCli,
      route: input.fullstackRoute,
      routeFallback: input.fullstackRoute?.fallback,
      prompt: {
        loopSubtaskCli: input.prompt?.loopSubtaskFullstackCli,
        loopSubtaskConfigId: input.prompt?.loopSubtaskFullstackConfigId,
        loopSubtaskModel: input.prompt?.loopSubtaskFullstackModel,
        loopSubtaskThinkingMode: input.prompt?.loopSubtaskFullstackThinkingMode,
      },
      originThinkingMode: input.originProfile?.subtaskFullstackThinkingMode,
    });
    if (resolved.unavailableReason) {
      return { ...resolved, role: role.role, mode };
    }
    return { ...resolved, role: role.role, mode, legacyAtomic: false };
  }
  if (role.role === "frontend") {
    if (!frontendRouteIsPresent(input)) {
      return {
        cli: input.mainCli,
        configId: null,
        crossCli: false,
        unavailableReason: FRONTEND_ROUTE_MISSING,
        role: "frontend",
        mode,
      };
    }
    const resolved = resolveFrontendRoleExecution(input);
    return { ...resolved, role: resolved.unavailableReason ? undefined : "frontend", mode };
  }
  const resolved = resolveStoredSubtaskExecution({
    mainCli: input.mainCli,
    route: input.backendRoute,
    routeFallback: input.backendRoute?.fallback,
    prompt: input.prompt,
    originThinkingMode: input.originProfile?.subtaskThinkingMode,
  });
  return { ...resolved, role: resolved.unavailableReason ? undefined : "backend", mode };
}

function resolveGeneralAnalysisExecution(input: {
  mainCli: CliName;
  mainRoute?: LoopTaskModelRoute | null;
  originProfile?: Pick<LoopTaskOriginProfile, "configId" | "mainThinkingMode"> | null;
  prompt?: LoopPlusRoleRoutePrompt | null;
}): ResolvedSubtaskExecution {
  const configId = normalizeRouteConfigId(input.originProfile?.configId) ?? null;
  const model = normalizeRouteModel(input.mainRoute?.model)
    ?? normalizeRouteModel(input.prompt?.loopMainModel)
    ?? normalizeRouteModel(input.prompt?.model);
  const thinkingMode = normalizeRouteThinkingMode(input.originProfile?.mainThinkingMode)
    ?? normalizeRouteThinkingMode(input.prompt?.loopMainThinkingMode);
  return {
    cli: input.mainCli,
    configId,
    ...(model ? { model } : {}),
    ...(thinkingMode ? { thinkingMode } : {}),
    crossCli: false,
  };
}

function fullstackRouteIsPresent(input: {
  fullstackRoute?: LoopTaskModelRoute | null;
  originProfile?: Pick<LoopTaskOriginProfile, "subtaskFullstackThinkingMode"> | null;
  prompt?: LoopPlusRoleRoutePrompt | null;
}): boolean {
  const route = input.fullstackRoute;
  return Boolean(
    loopSubtaskRouteHasIdentity(route)
    || input.prompt?.loopSubtaskFullstackCli
    || input.prompt?.loopSubtaskFullstackConfigId
    || input.prompt?.loopSubtaskFullstackModel
    || input.prompt?.loopSubtaskFullstackThinkingMode
    || input.originProfile?.subtaskFullstackThinkingMode
  );
}

function frontendRouteIsPresent(input: {
  frontendRoute?: LoopTaskModelRoute | null;
  originProfile?: Pick<LoopTaskOriginProfile, "subtaskFrontendThinkingMode"> | null;
  prompt?: LoopPlusRoleRoutePrompt | null;
}): boolean {
  const route = input.frontendRoute;
  return Boolean(
    route?.cli
    || route?.configId
    || route?.model
    || route?.fallback
    || input.prompt?.loopSubtaskFrontendCli
    || input.prompt?.loopSubtaskFrontendConfigId
    || input.prompt?.loopSubtaskFrontendModel
    || input.prompt?.loopSubtaskFrontendThinkingMode
    || input.originProfile?.subtaskFrontendThinkingMode
  );
}

function resolveFrontendRoleExecution(input: {
  mainCli: CliName;
  frontendRoute?: LoopTaskModelRoute | null;
  originProfile?: Pick<LoopTaskOriginProfile, "configId" | "subtaskFrontendThinkingMode"> | null;
  prompt?: LoopPlusRoleRoutePrompt | null;
}): ResolvedSubtaskExecution {
  const promptCliInvalid = Boolean(input.prompt?.loopSubtaskFrontendCli)
    && parseCliNameField(input.prompt?.loopSubtaskFrontendCli).ok === false;
  if (input.frontendRoute?.fallback === INVALID_SUBTASK_CLI_ROUTE || promptCliInvalid) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: FRONTEND_ROUTE_MISSING,
    };
  }
  const routeCli = parseCliNameField(input.frontendRoute?.cli);
  const promptCli = parseCliNameField(input.prompt?.loopSubtaskFrontendCli);
  if (!routeCli.ok || !promptCli.ok) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: FRONTEND_ROUTE_MISSING,
    };
  }
  const cli = routeCli.cli ?? promptCli.cli;
  if (!cli) {
    return {
      cli: input.mainCli,
      configId: null,
      crossCli: false,
      unavailableReason: FRONTEND_ROUTE_MISSING,
    };
  }
  const crossCli = cli !== input.mainCli;
  const configId = normalizeRouteConfigId(input.frontendRoute?.configId)
    ?? normalizeRouteConfigId(input.prompt?.loopSubtaskFrontendConfigId)
    ?? (crossCli ? null : normalizeRouteConfigId(input.originProfile?.configId) ?? null);
  if (crossCli && !configId) {
    return {
      cli,
      configId: null,
      crossCli: true,
      unavailableReason: BACKEND_CONFIG_MISSING,
    };
  }
  if (!configId) {
    return {
      cli,
      configId: null,
      crossCli: false,
      unavailableReason: FRONTEND_ROUTE_MISSING,
    };
  }
  const routeModel = normalizeRouteModel(input.frontendRoute?.model);
  const promptModel = normalizeRouteModel(input.prompt?.loopSubtaskFrontendModel);
  const model = input.frontendRoute?.cli ? routeModel : (promptModel ?? routeModel);
  const thinkingMode = normalizeRouteThinkingMode(input.originProfile?.subtaskFrontendThinkingMode)
    ?? normalizeRouteThinkingMode(input.prompt?.loopSubtaskFrontendThinkingMode);
  return {
    cli,
    configId,
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
