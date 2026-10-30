import {
  LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID,
  buildSystemLoopPlusAcceptancePlan,
  normalizeLoopPlusAcceptancePlanSelectionId,
  normalizeLoopPlusAcceptancePlans,
  resolveLoopPlusAcceptancePlanSelectionId,
  deleteLoopPlusAcceptancePlan as removeLoopPlusAcceptancePlan,
  upsertLoopPlusAcceptancePlan,
  type LoopPlusAcceptancePlan,
} from "../loopPlusAcceptancePlan";
import type { WorkspaceSettings } from "../workspaceSettingsStore";

export type LoopPlusAcceptancePlanSettingsHost = {
  getWorkspaceSettings: () => WorkspaceSettings;
  setWorkspaceSettings: (settings: WorkspaceSettings) => void;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => { ok: boolean; error?: string };
};

export type LoopPlusAcceptancePlanMutationResult =
  | { ok: true; plan: LoopPlusAcceptancePlan; plans: LoopPlusAcceptancePlan[]; selection: string }
  | { ok: false; error: string };

export type LoopPlusAcceptancePlanPanelState = {
  plans: LoopPlusAcceptancePlan[];
  selection: string;
};

/**
 * 验收方案的持久化入口：读写工作区设置，并把写入失败转成中文错误交给界面。
 * 所有变更都基于当前已加载的设置重新规范化，避免旧数据或损坏数据破坏其他设置字段。
 */
export function readLoopPlusAcceptancePlanPanelState(
  settings: WorkspaceSettings,
): LoopPlusAcceptancePlanPanelState {
  const plans = normalizeLoopPlusAcceptancePlans(settings.loopPlusAcceptancePlans);
  return {
    plans,
    selection: resolveLoopPlusAcceptancePlanSelectionId(settings.loopPlusAcceptancePlanSelection, plans),
  };
}

export function buildLoopPlusAcceptancePlanSummaries(settings: WorkspaceSettings): LoopPlusAcceptancePlan[] {
  return readLoopPlusAcceptancePlanPanelState(settings).plans;
}

function applyAcceptancePlanSettings(
  settings: WorkspaceSettings,
  plans: LoopPlusAcceptancePlan[],
  selection: string,
): WorkspaceSettings {
  const next: WorkspaceSettings = { ...settings };
  if (plans.length > 0) {
    next.loopPlusAcceptancePlans = plans;
  } else {
    delete next.loopPlusAcceptancePlans;
  }
  next.loopPlusAcceptancePlanSelection = normalizeLoopPlusAcceptancePlanSelectionId(selection, plans);
  return next;
}

function persistAcceptancePlanSettings(
  host: LoopPlusAcceptancePlanSettingsHost,
  next: WorkspaceSettings,
): { ok: true } | { ok: false; error: string } {
  const result = host.saveWorkspaceSettings(next);
  if (!result.ok) {
    return { ok: false, error: "验收方案保存失败，请稍后重试。" };
  }
  host.setWorkspaceSettings(next);
  return { ok: true };
}

export function saveLoopPlusAcceptancePlan(
  host: LoopPlusAcceptancePlanSettingsHost,
  input: {
    planId?: string | null;
    name: unknown;
    checks: unknown;
    otherText?: unknown;
    select?: boolean;
  },
): LoopPlusAcceptancePlanMutationResult {
  const settings = host.getWorkspaceSettings();
  const current = readLoopPlusAcceptancePlanPanelState(settings);
  const upsert = upsertLoopPlusAcceptancePlan({
    plans: current.plans,
    planId: input.planId ?? null,
    name: input.name,
    checks: input.checks,
    otherText: input.otherText,
  });
  if (!upsert.ok) {
    return upsert;
  }
  const selection = input.select === false
    ? normalizeLoopPlusAcceptancePlanSelectionId(current.selection, upsert.plans)
    : upsert.plan.id;
  const next = applyAcceptancePlanSettings(settings, upsert.plans, selection);
  const persisted = persistAcceptancePlanSettings(host, next);
  if (!persisted.ok) {
    return persisted;
  }
  return {
    ok: true,
    plan: upsert.plan,
    plans: upsert.plans,
    selection: normalizeLoopPlusAcceptancePlanSelectionId(selection, upsert.plans),
  };
}

export function deleteLoopPlusAcceptancePlan(
  host: LoopPlusAcceptancePlanSettingsHost,
  planId: unknown,
): LoopPlusAcceptancePlanMutationResult {
  const settings = host.getWorkspaceSettings();
  const current = readLoopPlusAcceptancePlanPanelState(settings);
  const removed = removeLoopPlusAcceptancePlan(current.plans, planId, current.selection);
  if (!removed.ok) {
    return removed;
  }
  const next = applyAcceptancePlanSettings(settings, removed.plans, removed.selection);
  const persisted = persistAcceptancePlanSettings(host, next);
  if (!persisted.ok) {
    return persisted;
  }
  const selection = normalizeLoopPlusAcceptancePlanSelectionId(removed.selection, removed.plans);
  const stored = removed.plans.find((item) => item.id === selection);
  const plan = stored ?? buildSystemLoopPlusAcceptancePlan();
  return {
    ok: true,
    plan,
    plans: removed.plans,
    selection,
  };
}

export function selectLoopPlusAcceptancePlan(
  host: LoopPlusAcceptancePlanSettingsHost,
  planId: unknown,
): { ok: true; selection: string } | { ok: false; error: string } {
  const settings = host.getWorkspaceSettings();
  const current = readLoopPlusAcceptancePlanPanelState(settings);
  const requested = typeof planId === "string" ? planId.trim() : "";
  if (requested && requested !== LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID && !current.plans.some((plan) => plan.id === requested)) {
    return { ok: false, error: "验收方案不存在或已被删除。" };
  }
  const selection = requested
    ? normalizeLoopPlusAcceptancePlanSelectionId(requested, current.plans)
    : LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID;
  const next = applyAcceptancePlanSettings(settings, current.plans, selection);
  const persisted = persistAcceptancePlanSettings(host, next);
  if (!persisted.ok) {
    return persisted;
  }
  return { ok: true, selection };
}

/** 供面板状态构建：内置“系统默认”不进设置文件，但在界面里永远存在。 */
export function buildLoopPlusAcceptancePlansPanelValue(settings: WorkspaceSettings): LoopPlusAcceptancePlan[] {
  return readLoopPlusAcceptancePlanPanelState(settings).plans;
}

export function buildLoopPlusAcceptancePlanSelectionPanelValue(settings: WorkspaceSettings): string {
  return readLoopPlusAcceptancePlanPanelState(settings).selection;
}

export function resolveSystemLoopPlusAcceptancePlan(): LoopPlusAcceptancePlan {
  return buildSystemLoopPlusAcceptancePlan();
}
