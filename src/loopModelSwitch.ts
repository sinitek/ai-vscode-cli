import type { CliName } from "./cli/types";
import type { LoopTaskModelRoute, LoopTaskModelRouting, LoopTaskRecord } from "./loopTaskStore";
import { resolveStoredLoopSubtaskMode } from "./loopPlusSubtaskMode";
import type { PromptRunInput } from "./promptRunTypes";
import { resolveLoopPlusRoleExecution, resolveStoredSubtaskExecution } from "./subtaskCliRoute";

export function applyLoopModelRoutingToPrompt<Input extends Partial<PromptRunInput>>(
  input: Input,
  routing?: LoopTaskModelRouting,
): Input {
  if (!routing) return input;
  return {
    ...input,
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
  const routed = applyLoopModelRoutingToPrompt(input, task.modelRouting);
  let cli = task.cli;
  let configId = task.modelRouting.main.configId;
  let model = task.modelRouting.main.model;
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
      : resolveStoredSubtaskExecution({ mainCli: task.cli, route: task.modelRouting.subtask, prompt: routed });
    if (execution.unavailableReason) return input;
    cli = execution.cli;
    configId = execution.configId ?? undefined;
    model = execution.model;
    routed.loopSubtaskCli = cli;
    routed.loopSubtaskConfigId = configId;
    routed.loopSubtaskModel = model;
  }
  return {
    ...routed,
    model,
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
};
export type LoopModelSwitchState = { fields: LoopModelSwitchField[]; error?: string };
export type LoopModelSwitchDeps = {
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedLoopCliModel?: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getLoopModelSwitchOptions?: (cli: CliName, role: "main" | "subtask", configId: string | null) => LoopModelSwitchOption[];
};

export function buildLoopModelSwitchState(task: LoopTaskRecord, deps: LoopModelSwitchDeps): LoopModelSwitchState {
  const fields: LoopModelSwitchField[] = [];
  const add = (role: LoopModelSwitchRole, label: string, route?: LoopTaskModelRoute): void => {
    const cli = role === "main" ? task.cli : route?.cli ?? task.cli;
    const configId = deps.getActiveConfigIdForCli(cli);
    const modelRole = role === "main" ? "main" : "subtask";
    const model = route ? route.model ?? "" : deps.getSelectedLoopCliModel?.(cli, modelRole, configId)
      ?? deps.getSelectedCliModel(cli, configId) ?? "";
    fields.push({ role, label, cli, configId, model, options: configId ? deps.getLoopModelSwitchOptions?.(cli, modelRole, configId) ?? [] : [] });
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
): { ok: true; modelRouting: LoopTaskModelRouting; configId: string } | { ok: false; error: string } {
  if (task.status === "completed") {
    return { ok: false, error: "任务已完成，不能切换模型。" };
  }
  if (state.error) {
    return { ok: false, error: state.error };
  }
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return { ok: false, error: "请选择主模型和子模型。" };
  }
  const routing: LoopTaskModelRouting = { ...task.modelRouting, main: { ...task.modelRouting?.main }, subtask: { ...task.modelRouting?.subtask } };
  for (const field of state.fields) {
    const value = (models as Record<string, unknown>)[field.role];
    if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
      return { ok: false, error: `${field.label}已不在当前配置的可选列表中，请重新选择。` };
    }
    const key = field.role === "frontend" ? "subtaskFrontend" : field.role === "fullstack" ? "subtaskFullstack" : field.role;
    const previous = routing[key] ?? (field.role === "fullstack" ? task.modelRouting?.subtask : undefined);
    const { model: previousModel, fallback: previousFallback, ...route } = previous ?? {};
    routing[key] = { ...route, configId: field.configId!, ...(field.role !== "main" ? { cli: field.cli } : {}), ...(value ? { model: value } : {}) };
  }
  return { ok: true, modelRouting: routing, configId: state.fields[0].configId! };
}
