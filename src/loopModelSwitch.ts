import type { CliName, ThinkingMode } from "./cli/types";
import type { LoopTaskModelRoute, LoopTaskModelRouting, LoopTaskOriginProfile, LoopTaskRecord } from "./loopTaskStore";
import { resolveStoredLoopSubtaskMode } from "./loopPlusSubtaskMode";
import type { PromptRunInput } from "./promptRunTypes";
import { normalizeRouteThinkingMode, resolveLoopPlusRoleExecution, resolveStoredSubtaskExecution } from "./subtaskCliRoute";

export function applyLoopPromptThinkingToOriginProfile(
  profile: LoopTaskOriginProfile,
  input: Partial<PromptRunInput>,
): LoopTaskOriginProfile {
  return {
    ...profile,
    ...(input.loopMainThinkingMode ? { mainThinkingMode: input.loopMainThinkingMode } : {}),
    ...(input.loopSubtaskThinkingMode ? { subtaskThinkingMode: input.loopSubtaskThinkingMode } : {}),
    ...(input.loopSubtaskFrontendThinkingMode ? { subtaskFrontendThinkingMode: input.loopSubtaskFrontendThinkingMode } : {}),
    ...(input.loopSubtaskFullstackThinkingMode ? { subtaskFullstackThinkingMode: input.loopSubtaskFullstackThinkingMode } : {}),
  };
}

export function applyLoopModelRoutingToPrompt<Input extends Partial<PromptRunInput>>(
  input: Input,
  routing?: LoopTaskModelRouting,
  profile?: LoopTaskOriginProfile,
): Input {
  if (!routing) return input;
  return {
    ...input,
    ...(profile?.mainThinkingMode ? { loopMainThinkingMode: profile.mainThinkingMode } : {}),
    ...(profile?.subtaskThinkingMode ? { loopSubtaskThinkingMode: profile.subtaskThinkingMode } : {}),
    ...(profile?.subtaskFrontendThinkingMode ? { loopSubtaskFrontendThinkingMode: profile.subtaskFrontendThinkingMode } : {}),
    ...(profile?.subtaskFullstackThinkingMode ? { loopSubtaskFullstackThinkingMode: profile.subtaskFullstackThinkingMode } : {}),
    model: routing.main.model,
    loopMainModel: routing.main.model,
    loopMainModelFallback: routing.main.fallback,
    loopSubtaskModel: routing.subtask.model,
    loopSubtaskModelFallback: routing.subtask.fallback,
    loopSubtaskCli: routing.subtask.cli,
    loopSubtaskConfigId: routing.subtask.configId,
    loopSubtaskFrontendModel: routing.subtaskFrontend?.model,
    loopSubtaskFrontendCli: routing.subtaskFrontend?.cli,
    loopSubtaskFrontendConfigId: routing.subtaskFrontend?.configId,
    loopSubtaskFullstackModel: routing.subtaskFullstack?.model,
    loopSubtaskFullstackCli: routing.subtaskFullstack?.cli,
    loopSubtaskFullstackConfigId: routing.subtaskFullstack?.configId,
  };
}

export function applyLoopInvocationModelRouting(input: PromptRunInput, task: LoopTaskRecord | null): PromptRunInput {
  if (!task?.modelRouting || !input.taskRole || input.loopAsk) return input;
  const routed = applyLoopModelRoutingToPrompt(input, task.modelRouting, task.originProfile);
  let cli = task.cli;
  let configId = task.modelRouting.main.configId;
  let model = task.modelRouting.main.model;
  let thinkingMode = task.originProfile?.mainThinkingMode ?? routed.loopMainThinkingMode;
  if (input.taskRole === "subtask") {
    const subtask = task.subTasks.find((item) => item.id === input.loopSubtaskId);
    const execution = task.schedulingMode === "event_driven"
      ? resolveLoopPlusRoleExecution({
        mainCli: task.cli,
        taskType: subtask?.taskType,
        writeFiles: subtask?.writeFiles,
        codingDelivery: subtask?.codingDelivery,
        loopSubtaskMode: task.loopSubtaskMode,
        loopSubtaskModeInvalid: task.loopSubtaskModeInvalid,
        mainRoute: task.modelRouting.main,
        backendRoute: task.modelRouting.subtask,
        frontendRoute: task.modelRouting.subtaskFrontend,
        fullstackRoute: task.modelRouting.subtaskFullstack,
        originProfile: task.originProfile,
        prompt: routed,
      })
      : resolveStoredSubtaskExecution({ mainCli: task.cli, route: task.modelRouting.subtask, prompt: routed, originThinkingMode: task.originProfile?.subtaskThinkingMode });
    if (execution.unavailableReason) return input;
    cli = execution.cli;
    configId = execution.configId ?? undefined;
    model = execution.model;
    thinkingMode = execution.thinkingMode;
    routed.loopSubtaskCli = cli;
    routed.loopSubtaskConfigId = configId;
    routed.loopSubtaskModel = model;
    if (thinkingMode) routed.loopSubtaskThinkingMode = thinkingMode;
  }
  return {
    ...routed,
    model,
    ...(thinkingMode ? { thinkingModeOverride: thinkingMode } : {}),
    ...(input.model !== model ? { executionModel: undefined, executionProfile: undefined } : {}),
    ...(configId && input.configSelections?.[cli]?.configId !== configId ? { configSelections: undefined } : {}),
  };
}

export type LoopModelSwitchRole = "main" | "subtask" | "frontend" | "fullstack";
export type LoopModelSwitchOption = { value: string; label: string };
export type LoopModelSwitchField = {
  role: LoopModelSwitchRole;
  label: string;
  cli: CliName;
  configId: string | null;
  model: string;
  options: LoopModelSwitchOption[];
  thinkingMode?: ThinkingMode;
  thinkingOptionsByModel?: Record<string, LoopModelSwitchOption[]>;
};
export type LoopModelSwitchState = { fields: LoopModelSwitchField[]; error?: string };
export type LoopModelSwitchDeps = {
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedLoopCliModel?: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getLoopModelSwitchOptions?: (cli: CliName, role: "main" | "subtask", configId: string | null) => LoopModelSwitchOption[];
  getSelectedLoopThinkingMode?: (cli: CliName, role: "main" | "subtask", model?: string | null, configId?: string | null) => ThinkingMode | null;
  getLoopModelSwitchThinkingOptions?: (cli: CliName, model: string, configId: string | null) => LoopModelSwitchOption[];
};

const THINKING_PROFILE_KEYS = {
  main: "mainThinkingMode", subtask: "subtaskThinkingMode",
  frontend: "subtaskFrontendThinkingMode", fullstack: "subtaskFullstackThinkingMode",
} as const;

export function getLoopModelSwitchThinkingOptions(cli: CliName): LoopModelSwitchOption[] {
  const modes = cli === "dsh" ? []
    : cli === "kimi-code" ? ["low", "medium", "high", "xhigh", "max"]
      : [...(cli === "grok" ? ["off"] : []), "low", "medium", "high", "xhigh", "max", "ultra"];
  return modes.map((value) => ({ value, label: value }));
}

export function buildLoopModelSwitchState(task: LoopTaskRecord, deps: LoopModelSwitchDeps): LoopModelSwitchState {
  const fields: LoopModelSwitchField[] = [];
  const add = (role: LoopModelSwitchRole, label: string, route?: LoopTaskModelRoute): void => {
    const cli = role === "main" ? task.cli : route?.cli ?? task.cli;
    const configId = deps.getActiveConfigIdForCli(cli);
    const modelRole = role === "main" ? "main" : "subtask";
    const model = route ? route.model ?? "" : deps.getSelectedLoopCliModel?.(cli, modelRole, configId)
      ?? deps.getSelectedCliModel(cli, configId) ?? "";
    const options = configId ? deps.getLoopModelSwitchOptions?.(cli, modelRole, configId) ?? [] : [];
    const thinkingOptionsByModel = Object.fromEntries(options.map((option) => [option.value,
      deps.getLoopModelSwitchThinkingOptions?.(cli, option.value, configId) ?? getLoopModelSwitchThinkingOptions(cli),
    ]));
    const thinkingMode = task.originProfile?.[THINKING_PROFILE_KEYS[role]]
      ?? (role === "fullstack" ? task.originProfile?.subtaskThinkingMode : undefined)
      ?? deps.getSelectedLoopThinkingMode?.(cli, modelRole, model, configId) ?? undefined;
    fields.push({ role, label, cli, configId, model, options, thinkingMode, thinkingOptionsByModel });
  };
  add("main", "主模型", task.modelRouting?.main);
  if (task.schedulingMode !== "event_driven") {
    add("subtask", "子模型", task.modelRouting?.subtask);
  } else {
    const mode = resolveStoredLoopSubtaskMode({
      loopSubtaskMode: task.loopSubtaskMode,
      loopSubtaskModeInvalid: task.loopSubtaskModeInvalid,
      frontendRoute: task.modelRouting?.subtaskFrontend,
    });
    if (!mode) {
      return { fields, error: "当前任务的子任务模式无效，无法切换模型。" };
    }
    if (mode === "fullstack") {
      add("fullstack", "子-全栈模型", task.modelRouting?.subtaskFullstack ?? task.modelRouting?.subtask);
    } else {
      add("subtask", "子-后端模型", task.modelRouting?.subtask);
      add("frontend", "子-前端模型", task.modelRouting?.subtaskFrontend);
    }
  }
  const unavailable = fields.find((field) => !field.configId || !field.options.length);
  return { fields, ...(unavailable ? { error: `${unavailable.label}所在 ${unavailable.cli} 的当前配置没有可选模型，请先检查模型配置。` } : {}) };
}

export function resolveLoopModelSwitch(
  task: LoopTaskRecord,
  state: LoopModelSwitchState,
  models: unknown,
  thinkingModes?: unknown,
): { ok: true; modelRouting: LoopTaskModelRouting; configId: string; originProfile: LoopTaskOriginProfile } | { ok: false; error: string } {
  if (task.status === "completed") {
    return { ok: false, error: "任务已完成，不能切换模型。" };
  }
  if (state.error) {
    return { ok: false, error: state.error };
  }
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return { ok: false, error: "请选择主模型和子模型。" };
  }
  if (thinkingModes !== undefined && (!thinkingModes || typeof thinkingModes !== "object" || Array.isArray(thinkingModes))) {
    return { ok: false, error: "请选择有效的思考力度。" };
  }
  const originProfile: LoopTaskOriginProfile = { ...task.originProfile, configId: state.fields[0].configId! };
  const routing: LoopTaskModelRouting = { ...task.modelRouting, main: { ...task.modelRouting?.main }, subtask: { ...task.modelRouting?.subtask } };
  for (const field of state.fields) {
    const value = (models as Record<string, unknown>)[field.role];
    if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
      return { ok: false, error: `${field.label}已不在当前配置的可选列表中，请重新选择。` };
    }
    if (thinkingModes !== undefined) {
      const selected = (thinkingModes as Record<string, unknown>)[field.role];
      const options = field.thinkingOptionsByModel?.[value] ?? [];
      const thinkingMode = normalizeRouteThinkingMode(selected);
      if (options.length && (!thinkingMode || !options.some((option) => option.value === thinkingMode))
        || !options.length && selected !== undefined) {
        return { ok: false, error: `${field.label}的思考力度已不可用，请重新选择。` };
      }
      if (thinkingMode) originProfile[THINKING_PROFILE_KEYS[field.role]] = thinkingMode;
      else delete originProfile[THINKING_PROFILE_KEYS[field.role]];
    }
    const key = field.role === "frontend" ? "subtaskFrontend" : field.role === "fullstack" ? "subtaskFullstack" : field.role;
    const previous = routing[key] ?? (field.role === "fullstack" ? task.modelRouting?.subtask : undefined);
    const { model: previousModel, fallback: previousFallback, ...route } = previous ?? {};
    routing[key] = { ...route, configId: field.configId!, ...(field.role !== "main" ? { cli: field.cli } : {}), ...(value ? { model: value } : {}) };
  }
  return { ok: true, modelRouting: routing, configId: state.fields[0].configId!, originProfile };
}
