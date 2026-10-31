import type { CliName } from "./cli/types";
import type { GraphRunModelRoutingRecord } from "./graph/types";
import type { LoopSubtaskMode } from "./loopPlusSubtaskMode";
import type { LoopTaskModelRouting } from "./loopTaskStore";
import {
  formatSubtaskRouteSummary,
  parseCliName,
  subtaskRouteIsConfigured,
} from "./subtaskCliRoute";

export type ContinueModelSource = "original" | "current";

export type ContinueModelPair = {
  main: string | null;
  subtask: string | null;
  subtaskCli?: CliName | null;
  subtaskConfigId?: string | null;
  frontend?: string | null;
  frontendCli?: CliName | null;
  frontendConfigId?: string | null;
  fullstack?: string | null;
  fullstackCli?: CliName | null;
  fullstackConfigId?: string | null;
  /** 缺省不写。显式模式才进入续跑快照，避免把旧任务猜成新模式。 */
  loopSubtaskMode?: LoopSubtaskMode | null;
  unavailableReason?: string | null;
};

export type ContinueModelChoice = {
  original: ContinueModelPair;
  current: ContinueModelPair;
};

export type ContinueModelChoiceStrings = {
  label: string;
  originalTitle: string;
  originalHint: string;
  originalUnavailable: string;
  currentTitle: string;
  currentHint: string;
  summary: string;
  unrecorded: string;
};

type ModelSelector = (cli: CliName, configId?: string | null) => string | null;
type LoopModelSelector = (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;

export function normalizeContinueModelSource(value: unknown): ContinueModelSource | null {
  return value === "original" || value === "current" ? value : null;
}

export function normalizeContinueModelName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function emptyContinueModelPair(): ContinueModelPair {
  return { main: null, subtask: null };
}

export function hasContinueModel(pair: ContinueModelPair): boolean {
  if (pair.unavailableReason) {
    return false;
  }
  return Boolean(pair.main || pair.subtask || pair.subtaskCli || pair.frontend || pair.frontendCli || pair.fullstack || pair.fullstackCli || pair.loopSubtaskMode);
}

export function continueModelPairFromLoopRouting(
  routing: LoopTaskModelRouting | null | undefined,
): ContinueModelPair {
  const subtaskCli = parseCliName(routing?.subtask.cli) ?? null;
  const frontendCli = parseCliName(routing?.subtaskFrontend?.cli) ?? null;
  const fullstackCli = parseCliName(routing?.subtaskFullstack?.cli) ?? null;
  return {
    main: normalizeContinueModelName(routing?.main.model),
    subtask: normalizeContinueModelName(routing?.subtask.model),
    ...(subtaskCli ? { subtaskCli } : {}),
    ...(routing?.subtask.configId ? { subtaskConfigId: routing.subtask.configId } : {}),
    ...(frontendCli ? { frontendCli } : {}),
    ...(normalizeContinueModelName(routing?.subtaskFrontend?.model)
      ? { frontend: normalizeContinueModelName(routing?.subtaskFrontend?.model) }
      : {}),
    ...(routing?.subtaskFrontend?.configId ? { frontendConfigId: routing.subtaskFrontend.configId } : {}),
    ...(fullstackCli ? { fullstackCli } : {}),
    ...(normalizeContinueModelName(routing?.subtaskFullstack?.model)
      ? { fullstack: normalizeContinueModelName(routing?.subtaskFullstack?.model) }
      : {}),
    ...(routing?.subtaskFullstack?.configId ? { fullstackConfigId: routing.subtaskFullstack.configId } : {}),
    ...(routing?.subtask.fallback === "invalid-subtask-cli" || routing?.subtaskFrontend?.fallback === "invalid-subtask-cli" || routing?.subtaskFullstack?.fallback === "invalid-subtask-cli"
      ? { unavailableReason: "子模型 CLI 分组无效，不能派发子任务。" }
      : {}),
  };
}

export function continueModelPairFromGraphRouting(
  routing: GraphRunModelRoutingRecord | null | undefined,
): ContinueModelPair {
  const subtaskCli = parseCliName(routing?.executor.cli) ?? null;
  return {
    main: normalizeContinueModelName(routing?.planner.model),
    subtask: normalizeContinueModelName(routing?.executor.model),
    ...(subtaskCli ? { subtaskCli } : {}),
    ...(routing?.executor.configId ? { subtaskConfigId: routing.executor.configId } : {}),
    ...(routing?.executor.fallback === "invalid-subtask-cli"
      ? { unavailableReason: "子模型 CLI 分组无效，不能派发子任务。" }
      : {}),
  };
}

export function resolveCurrentLoopModelPair(input: {
  cli: CliName;
  configId?: string | null;
  getSelectedCliModel: ModelSelector;
  getSelectedLoopCliModel?: LoopModelSelector;
  getSelectedLoopSubtaskCli?: (configId: string | null) => CliName | null;
  getSelectedLoopFrontendCli?: (configId: string | null) => CliName | null;
  getSelectedLoopFullstackCli?: (configId: string | null) => CliName | null;
  getSelectedLoopSubtaskMode?: (configId: string | null) => LoopSubtaskMode | null;
  getLoopRoleExplicitModel?: (configId: string | null, role: "frontend" | "fullstack") => { configured: boolean; model: string };
  getActiveConfigIdForCli?: (cli: CliName) => string | null;
}): ContinueModelPair {
  const configId = input.configId ?? null;
  const selectedModel = normalizeContinueModelName(input.getSelectedCliModel(input.cli, configId));
  const main = normalizeContinueModelName(
    input.getSelectedLoopCliModel?.(input.cli, "main", configId),
  ) ?? selectedModel;
  const storedSubtaskCli = input.getSelectedLoopSubtaskCli?.(configId) ?? null;
  const subtaskCli = storedSubtaskCli ?? input.cli;
  const crossCli = subtaskCli !== input.cli;
  const subtaskConfigId = crossCli
    ? input.getActiveConfigIdForCli?.(subtaskCli) ?? null
    : configId;
  if (crossCli && !subtaskConfigId) {
    return {
      main,
      subtask: null,
      subtaskCli,
      unavailableReason: "目标 CLI 没有可用配置，不能派发子任务。",
    };
  }
  const subtask = crossCli
    ? normalizeContinueModelName(input.getSelectedLoopCliModel?.(subtaskCli, "subtask", subtaskConfigId))
      ?? normalizeContinueModelName(input.getSelectedCliModel(subtaskCli, subtaskConfigId))
    : normalizeContinueModelName(input.getSelectedLoopCliModel?.(input.cli, "subtask", configId))
      ?? selectedModel
      ?? main;
  const storedFrontendCli = input.getSelectedLoopFrontendCli?.(configId) ?? null;
  const frontendCrossCli = Boolean(storedFrontendCli && storedFrontendCli !== input.cli);
  const frontendConfigId = frontendCrossCli && storedFrontendCli
    ? input.getActiveConfigIdForCli?.(storedFrontendCli) ?? null
    : null;
  if (frontendCrossCli && !frontendConfigId) {
    return {
      main,
      subtask: null,
      frontend: null,
      frontendCli: storedFrontendCli,
      unavailableReason: "目标 CLI 没有可用配置，不能派发子任务。",
    };
  }
  const frontendExplicit = input.getLoopRoleExplicitModel?.(frontendCrossCli ? frontendConfigId : configId, "frontend");
  const frontendCliForLookup = storedFrontendCli;
  const frontend = frontendExplicit?.configured
    ? normalizeContinueModelName(frontendExplicit.model)
    : frontendCrossCli && frontendCliForLookup
      ? normalizeContinueModelName(input.getSelectedLoopCliModel?.(frontendCliForLookup, "subtask", frontendConfigId))
        ?? normalizeContinueModelName(input.getSelectedCliModel(frontendCliForLookup, frontendConfigId))
      : null;
  const storedFullstackCli = input.getSelectedLoopFullstackCli?.(configId) ?? null;
  const fullstackCrossCli = Boolean(storedFullstackCli && storedFullstackCli !== input.cli);
  const fullstackConfigId = fullstackCrossCli && storedFullstackCli
    ? input.getActiveConfigIdForCli?.(storedFullstackCli) ?? null
    : configId;
  if (fullstackCrossCli && !fullstackConfigId) {
    return {
      main,
      subtask: null,
      fullstack: null,
      fullstackCli: storedFullstackCli,
      unavailableReason: "目标 CLI 没有可用配置，不能派发子任务。",
    };
  }
  const fullstackExplicit = input.getLoopRoleExplicitModel?.(fullstackConfigId, "fullstack");
  const fullstack = fullstackExplicit?.configured ? normalizeContinueModelName(fullstackExplicit.model) : null;
  const loopSubtaskMode = input.getSelectedLoopSubtaskMode?.(configId) ?? "fullstack";
  return {
    main,
    subtask,
    ...(crossCli ? { subtaskCli, ...(subtaskConfigId ? { subtaskConfigId } : {}) } : {}),
    ...(frontendCrossCli
      ? {
        frontendCli: storedFrontendCli,
        ...(frontendConfigId ? { frontendConfigId } : {}),
        ...(frontend ? { frontend } : {}),
      }
      : frontendExplicit?.configured
        ? { ...(frontend ? { frontend } : {}) }
        : {}),
    ...((storedFullstackCli || fullstackExplicit?.configured)
      ? {
        ...(fullstackCrossCli && storedFullstackCli ? { fullstackCli: storedFullstackCli } : {}),
        ...(fullstackConfigId ? { fullstackConfigId } : {}),
        ...(fullstack ? { fullstack } : {}),
      }
      : {}),
    loopSubtaskMode,
  };
}

export function resolveLoopContinueModelPair(options: {
  modelSource: ContinueModelSource | null;
  original: ContinueModelPair;
  current: ContinueModelPair;
}): ContinueModelPair {
  if (options.modelSource === "original" && hasContinueModel(options.original)) {
    return options.original;
  }
  return options.current;
}

export function promptModelsFromContinuePair(pair: ContinueModelPair): {
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopSubtaskCli?: CliName;
  loopSubtaskConfigId?: string;
  loopSubtaskFrontendModel?: string;
  loopSubtaskFrontendCli?: CliName;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopSubtaskFullstackCli?: CliName;
  loopSubtaskFullstackConfigId?: string;
  loopSubtaskMode?: LoopSubtaskMode;
} {
  const main = pair.main ?? pair.subtask ?? undefined;
  const crossCli = Boolean(pair.subtaskCli);
  const subtask = crossCli ? (pair.subtask ?? undefined) : (pair.subtask ?? pair.main ?? undefined);
  if (!main && !subtask && !pair.subtaskCli) {
    return {};
  }
  return {
    ...(main ? { model: main, loopMainModel: main } : {}),
    ...(subtask ? { loopSubtaskModel: subtask } : {}),
    ...(pair.subtaskCli ? { loopSubtaskCli: pair.subtaskCli } : {}),
    ...(pair.subtaskConfigId ? { loopSubtaskConfigId: pair.subtaskConfigId } : {}),
    ...(pair.frontend ? { loopSubtaskFrontendModel: pair.frontend } : {}),
    ...(pair.frontendCli ? { loopSubtaskFrontendCli: pair.frontendCli } : {}),
    ...(pair.frontendConfigId ? { loopSubtaskFrontendConfigId: pair.frontendConfigId } : {}),
    ...(pair.fullstack ? { loopSubtaskFullstackModel: pair.fullstack } : {}),
    ...(pair.fullstackCli ? { loopSubtaskFullstackCli: pair.fullstackCli } : {}),
    ...(pair.fullstackConfigId ? { loopSubtaskFullstackConfigId: pair.fullstackConfigId } : {}),
    ...(pair.loopSubtaskMode ? { loopSubtaskMode: pair.loopSubtaskMode } : {}),
  };
}

export function loopModelRoutingFromPair(pair: ContinueModelPair): LoopTaskModelRouting | null {
  if (!subtaskRouteIsConfigured({
    cli: pair.subtaskCli ?? undefined,
    configId: pair.subtaskConfigId ?? undefined,
    model: pair.subtask ?? undefined,
  }) && !pair.main) {
    return null;
  }
  return {
    main: pair.main ? { model: pair.main } : {},
    subtask: {
      ...(pair.subtaskCli ? { cli: pair.subtaskCli } : {}),
      ...(pair.subtaskConfigId ? { configId: pair.subtaskConfigId } : {}),
      ...(pair.subtask ? { model: pair.subtask } : {}),
    },
    ...(pair.frontend || pair.frontendCli || pair.frontendConfigId
      ? {
        subtaskFrontend: {
          ...(pair.frontendCli ? { cli: pair.frontendCli } : {}),
          ...(pair.frontendConfigId ? { configId: pair.frontendConfigId } : {}),
          ...(pair.frontend ? { model: pair.frontend } : {}),
        },
      }
      : {}),
    ...(pair.fullstack || pair.fullstackCli || pair.fullstackConfigId
      ? {
        subtaskFullstack: {
          ...(pair.fullstackCli ? { cli: pair.fullstackCli } : {}),
          ...(pair.fullstackConfigId ? { configId: pair.fullstackConfigId } : {}),
          ...(pair.fullstack ? { model: pair.fullstack } : {}),
        },
      }
      : {}),
  };
}

export function loopModelRoutingFromPromptInput(input: {
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopSubtaskCli?: CliName | string;
  loopSubtaskConfigId?: string;
  loopSubtaskFrontendModel?: string;
  loopSubtaskFrontendCli?: CliName | string;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopSubtaskFullstackCli?: CliName | string;
  loopSubtaskFullstackConfigId?: string;
  loopMainModelFallback?: string;
  loopSubtaskModelFallback?: string;
}, options?: { mainCli?: CliName }): LoopTaskModelRouting | null {
  const main = normalizeContinueModelName(input.loopMainModel) ?? normalizeContinueModelName(input.model);
  const subtaskCli = parseCliName(input.loopSubtaskCli);
  const crossCli = Boolean(subtaskCli && options?.mainCli && subtaskCli !== options.mainCli);
  const explicitSubtask = normalizeContinueModelName(input.loopSubtaskModel);
  const subtask = explicitSubtask ?? (crossCli ? null : main);
  const mainFallback = normalizeContinueModelName(input.loopMainModelFallback);
  const subtaskFallback = normalizeContinueModelName(input.loopSubtaskModelFallback);
  const subtaskConfigId = typeof input.loopSubtaskConfigId === "string" && input.loopSubtaskConfigId.trim()
    ? input.loopSubtaskConfigId.trim()
    : undefined;
  const frontendCli = parseCliName(input.loopSubtaskFrontendCli);
  const frontendCrossCli = Boolean(frontendCli && options?.mainCli && frontendCli !== options.mainCli);
  const explicitFrontend = normalizeContinueModelName(input.loopSubtaskFrontendModel);
  const frontend = explicitFrontend ?? (frontendCrossCli ? null : null);
  const frontendConfigId = typeof input.loopSubtaskFrontendConfigId === "string" && input.loopSubtaskFrontendConfigId.trim()
    ? input.loopSubtaskFrontendConfigId.trim()
    : undefined;
  const fullstackCli = parseCliName(input.loopSubtaskFullstackCli);
  const fullstack = normalizeContinueModelName(input.loopSubtaskFullstackModel);
  const fullstackConfigId = typeof input.loopSubtaskFullstackConfigId === "string" && input.loopSubtaskFullstackConfigId.trim()
    ? input.loopSubtaskFullstackConfigId.trim()
    : undefined;
  if (!main && !subtask && !mainFallback && !subtaskFallback && !subtaskCli && !subtaskConfigId && !frontend && !frontendCli && !frontendConfigId && !fullstack && !fullstackCli && !fullstackConfigId) {
    return null;
  }
  return {
    main: {
      ...(main ? { model: main } : {}),
      ...(mainFallback ? { fallback: mainFallback } : {}),
    },
    subtask: {
      ...(subtaskCli ? { cli: subtaskCli } : {}),
      ...(subtaskConfigId ? { configId: subtaskConfigId } : {}),
      ...(subtask ? { model: subtask } : {}),
      ...(subtaskFallback ? { fallback: subtaskFallback } : {}),
    },
    ...(frontend || frontendCli || frontendConfigId
      ? {
        subtaskFrontend: {
          ...(frontendCli ? { cli: frontendCli } : {}),
          ...(frontendConfigId ? { configId: frontendConfigId } : {}),
          ...(frontend ? { model: frontend } : {}),
        },
      }
      : {}),
    ...(fullstack || fullstackCli || fullstackConfigId
      ? {
        subtaskFullstack: {
          ...(fullstackCli ? { cli: fullstackCli } : {}),
          ...(fullstackConfigId ? { configId: fullstackConfigId } : {}),
          ...(fullstack ? { model: fullstack } : {}),
        },
      }
      : {}),
  };
}

export function shouldApplyCurrentContinueModels(
  modelSource: ContinueModelSource | null,
  current: ContinueModelPair,
): boolean {
  return modelSource === "current" && hasContinueModel(current);
}

export function selectGraphContinueModelRouting(
  existing: GraphRunModelRoutingRecord | undefined,
  current: GraphRunModelRoutingRecord,
  modelSource: ContinueModelSource | null,
): GraphRunModelRoutingRecord | undefined {
  if (!shouldApplyCurrentContinueModels(modelSource, continueModelPairFromGraphRouting(current))) {
    return existing;
  }
  return current;
}

export function renderContinueModelChoiceHtml(options: {
  choice?: ContinueModelChoice | null;
  strings: ContinueModelChoiceStrings;
  escapeHtml: (value: string) => string;
}): string {
  const choice = options.choice ?? {
    original: emptyContinueModelPair(),
    current: emptyContinueModelPair(),
  };
  const originalAvailable = hasContinueModel(choice.original);
  return `<div id="continueModelChoice" class="model-choice">
    <div class="dialog-label">${options.escapeHtml(options.strings.label)}</div>
    ${renderContinueModelOption({
      value: "original",
      title: options.strings.originalTitle,
      hint: originalAvailable ? options.strings.originalHint : options.strings.originalUnavailable,
      detail: formatContinueModelSummary(options.strings.summary, choice.original, options.strings.unrecorded),
      checked: originalAvailable,
      disabled: !originalAvailable,
      escapeHtml: options.escapeHtml,
    })}
    ${renderContinueModelOption({
      value: "current",
      title: options.strings.currentTitle,
      hint: options.strings.currentHint,
      detail: formatContinueModelSummary(options.strings.summary, choice.current, options.strings.unrecorded),
      checked: !originalAvailable,
      disabled: false,
      escapeHtml: options.escapeHtml,
    })}
  </div>`;
}

function formatContinueModelSummary(template: string, pair: ContinueModelPair, unrecorded: string): string {
  return template
    .split("{main}").join(pair.main || unrecorded)
    .split("{subtask}").join(formatSubtaskRouteSummary({
      cli: pair.subtaskCli,
      model: pair.subtask,
    }, unrecorded));
}

function renderContinueModelOption(options: {
  value: ContinueModelSource;
  title: string;
  hint: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  escapeHtml: (value: string) => string;
}): string {
  const checked = options.checked ? " checked" : "";
  const disabled = options.disabled ? " disabled" : "";
  return `<label class="model-choice-option">
    <input type="radio" name="continueModelSource" value="${options.value}"${checked}${disabled} />
    <span>
      <span class="model-choice-title">${options.escapeHtml(options.title)}</span>
      <span class="model-choice-detail">${options.escapeHtml(options.hint)}</span>
      <span class="model-choice-detail">${options.escapeHtml(options.detail)}</span>
    </span>
  </label>`;
}
