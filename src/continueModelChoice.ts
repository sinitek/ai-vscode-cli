import type { CliName } from "./cli/types";
import type { GraphRunModelRoutingRecord } from "./graph/types";
import type { LoopTaskModelRouting } from "./loopTaskStore";

export type ContinueModelSource = "original" | "current";

export type ContinueModelPair = {
  main: string | null;
  subtask: string | null;
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
  return Boolean(pair.main || pair.subtask);
}

export function continueModelPairFromLoopRouting(
  routing: LoopTaskModelRouting | null | undefined,
): ContinueModelPair {
  return {
    main: normalizeContinueModelName(routing?.main.model),
    subtask: normalizeContinueModelName(routing?.subtask.model),
  };
}

export function continueModelPairFromGraphRouting(
  routing: GraphRunModelRoutingRecord | null | undefined,
): ContinueModelPair {
  return {
    main: normalizeContinueModelName(routing?.planner.model),
    subtask: normalizeContinueModelName(routing?.executor.model),
  };
}

export function resolveCurrentLoopModelPair(input: {
  cli: CliName;
  configId?: string | null;
  getSelectedCliModel: ModelSelector;
  getSelectedLoopCliModel?: LoopModelSelector;
}): ContinueModelPair {
  const configId = input.configId ?? null;
  const selectedModel = normalizeContinueModelName(input.getSelectedCliModel(input.cli, configId));
  const main = normalizeContinueModelName(
    input.getSelectedLoopCliModel?.(input.cli, "main", configId),
  ) ?? selectedModel;
  const subtask = normalizeContinueModelName(
    input.getSelectedLoopCliModel?.(input.cli, "subtask", configId),
  ) ?? selectedModel ?? main;
  return { main, subtask };
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
} {
  const main = pair.main ?? pair.subtask ?? undefined;
  const subtask = pair.subtask ?? pair.main ?? undefined;
  if (!main && !subtask) {
    return {};
  }
  return {
    ...(main ? { model: main, loopMainModel: main } : {}),
    ...(subtask ? { loopSubtaskModel: subtask } : {}),
  };
}

export function loopModelRoutingFromPair(pair: ContinueModelPair): LoopTaskModelRouting | null {
  if (!hasContinueModel(pair)) {
    return null;
  }
  return {
    main: pair.main ? { model: pair.main } : {},
    subtask: pair.subtask ? { model: pair.subtask } : {},
  };
}

export function loopModelRoutingFromPromptInput(input: {
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainModelFallback?: string;
  loopSubtaskModelFallback?: string;
}): LoopTaskModelRouting | null {
  const main = normalizeContinueModelName(input.loopMainModel) ?? normalizeContinueModelName(input.model);
  const subtask = normalizeContinueModelName(input.loopSubtaskModel) ?? main;
  const mainFallback = normalizeContinueModelName(input.loopMainModelFallback);
  const subtaskFallback = normalizeContinueModelName(input.loopSubtaskModelFallback);
  if (!main && !subtask && !mainFallback && !subtaskFallback) {
    return null;
  }
  return {
    main: {
      ...(main ? { model: main } : {}),
      ...(mainFallback ? { fallback: mainFallback } : {}),
    },
    subtask: {
      ...(subtask ? { model: subtask } : {}),
      ...(subtaskFallback ? { fallback: subtaskFallback } : {}),
    },
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
    .split("{subtask}").join(pair.subtask || unrecorded);
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
