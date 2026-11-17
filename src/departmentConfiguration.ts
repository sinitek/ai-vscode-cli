import { CLI_LIST, type CliName, type ThinkingMode } from "./cli/types";
import { departmentRoleCliIssue, type DepartmentRoleRoute } from "./department";
import { normalizeRouteThinkingMode } from "./subtaskCliRoute";
import {
  normalizeLoopPlusAcceptancePlanSnapshot,
  type LoopPlusAcceptancePlanSnapshot,
} from "./loopPlusAcceptancePlan";

export type DepartmentConfiguredRoleRoute = {
  cli: CliName;
  configId: string | null;
  /** null means the selected CLI's configured default model. */
  model: string | null;
  thinkingMode: ThinkingMode | null;
  openCodeVariant: string | null;
};

export type DepartmentRolePreferences = {
  leader: DepartmentConfiguredRoleRoute;
  employee: DepartmentConfiguredRoleRoute;
};

/** Credential-free choices for one exact CLI/profile. An absent selection is never a default choice. */
export type DepartmentRoleCandidates = {
  cli: CliName;
  configId: string | null;
  configs: Array<{ id: string; name: string }>;
  models: string[];
  defaultModel: string | null;
  supportsDefaultModel: boolean;
  thinkingByModel: Record<string, ThinkingMode[]>;
  variantsByModel: Record<string, string[]>;
  /** Opaque host read revision, never configuration content or execution authority. */
  sourceRevision?: string;
};

export type DepartmentConfigBindingSelection = {
  configId: string | null;
  revision: string;
  ready: boolean;
};

export type DepartmentConfigBindingReader = (cli: CliName) => Promise<DepartmentConfigBindingSelection | null>;
export type DepartmentConfigBindingSnapshot = Map<CliName, DepartmentConfigBindingSelection>;
export type DepartmentSelectionContextReader = () => string | number;
let departmentSelectionContextRevision = 0;
export function invalidateDepartmentSelectionContext(): void { departmentSelectionContextRevision += 1; }
export function getDepartmentSelectionContextRevision(): number { return departmentSelectionContextRevision; }

export async function captureDepartmentConfigBindings(
  expected: readonly { cli: CliName; configId: string | null }[],
  readSelection: DepartmentConfigBindingReader,
): Promise<DepartmentConfigBindingSnapshot> {
  const expectedByCli = new Map<CliName, string>();
  for (const item of expected) {
    if (!item.configId) throw new Error("角色 CLI 当前没有已确认的激活档案，请重新选择后重试。");
    const existing = expectedByCli.get(item.cli);
    if (existing && existing !== item.configId) throw new Error("同一 CLI 的角色档案绑定不一致，请重新选择后重试。");
    expectedByCli.set(item.cli, item.configId);
  }
  const snapshots = await Promise.all([...expectedByCli].map(async ([cli, configId]) => {
    const selection = await readSelection(cli);
    if (!selection || !selection.ready || selection.configId !== configId || !selection.revision) {
      throw new Error("角色 CLI 配置尚未就绪或已切换，请重新应用当前档案后重试。");
    }
    return [cli, { configId: selection.configId, revision: selection.revision, ready: selection.ready }] as const;
  }));
  return new Map(snapshots);
}

export async function assertDepartmentConfigBindingsCurrent(
  expected: DepartmentConfigBindingSnapshot,
  readSelection: DepartmentConfigBindingReader,
): Promise<void> {
  const current = await Promise.all([...expected].map(async ([cli, snapshot]) => [cli, await readSelection(cli)] as const));
  for (const [cli, selection] of current) {
    const previous = expected.get(cli)!;
    if (!selection || !selection.ready || selection.configId !== previous.configId || selection.revision !== previous.revision) {
      throw new Error("角色 CLI 配置修订或激活状态已变化，请重新选择后重试。");
    }
  }
}

export function validateDepartmentRoleCandidate(preference: DepartmentConfiguredRoleRoute, candidates: DepartmentRoleCandidates): void {
  if (candidates.cli !== preference.cli || candidates.configId !== preference.configId
    || !candidates.configs.some((config) => config.id === preference.configId)) {
    throw new Error("所选 CLI 档案已失效，请重新选择档案。");
  }
  if (preference.model === null ? !candidates.supportsDefaultModel : !candidates.models.includes(preference.model)) {
    throw new Error("所选模型不可用，或当前档案不支持 CLI 默认模型，请重新选择。");
  }
  if (preference.cli === "opencode" && preference.model === null
    && (!candidates.defaultModel || !candidates.models.includes(candidates.defaultModel))) {
    throw new Error("OpenCode 档案没有有效默认模型，请重新选择。");
  }
  const model = preference.model ?? candidates.defaultModel ?? "";
  if (preference.thinkingMode !== null && !candidates.thinkingByModel[model]?.includes(preference.thinkingMode)) {
    throw new Error("所选思考力度不适用于当前 CLI 档案和模型，请重新选择。");
  }
  if (preference.openCodeVariant !== null && (preference.cli !== "opencode"
    || !candidates.variantsByModel[model]?.includes(preference.openCodeVariant))) {
    throw new Error("所选 OpenCode 变体不适用于当前档案和模型，请重新选择。");
  }
}

export type DepartmentRouteValidation = {
  hasConfig: (cli: CliName, configId: string | null) => boolean;
  hasModel: (cli: CliName, configId: string | null, model: string | null) => boolean;
  supportsThinkingMode: (cli: CliName, model: string | null, mode: ThinkingMode | null, configId: string | null) => boolean;
  supportsOpenCodeVariant: (cli: CliName, model: string | null, variant: string | null, configId: string | null) => boolean;
  getLimits: () => { maxLeaders: number; maxEmployees: number };
  getAcceptancePlan: () => LoopPlusAcceptancePlanSnapshot;
};

export type DepartmentConfigurationState = {
  routes: { director: DepartmentRoleRoute; leader: DepartmentRoleRoute; employee: DepartmentRoleRoute };
  limits: { maxLeaders: number; maxEmployees: number };
  loopPlusAcceptancePlan: LoopPlusAcceptancePlanSnapshot;
};


export function normalizeDepartmentRolePreference(value: unknown): DepartmentConfiguredRoleRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.cli !== "string" || !(CLI_LIST as readonly string[]).includes(raw.cli)) return null;
  if (!(raw.configId === null || typeof raw.configId === "string")) return null;
  if (!(raw.model === null || typeof raw.model === "string")) return null;
  if (typeof raw.model === "string" && !raw.model.trim()) return null;
  if (!(raw.thinkingMode === null || (typeof raw.thinkingMode === "string" && normalizeRouteThinkingMode(raw.thinkingMode)))) return null;
  if (!(raw.openCodeVariant === null || typeof raw.openCodeVariant === "string")) return null;
  return {
    cli: raw.cli as CliName,
    configId: typeof raw.configId === "string" && raw.configId.trim() ? raw.configId.trim() : null,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : null,
    thinkingMode: raw.thinkingMode === null ? null : normalizeRouteThinkingMode(raw.thinkingMode) ?? null,
    openCodeVariant: typeof raw.openCodeVariant === "string" && raw.openCodeVariant.trim() ? raw.openCodeVariant.trim() : null,
  };
}

/** Resolves saved role preferences against live host capabilities before they can enter a task snapshot. */
export function resolveDepartmentConfiguration(
  director: DepartmentRoleRoute,
  preferences: DepartmentRolePreferences,
  validation: DepartmentRouteValidation,
): DepartmentConfigurationState {
  for (const role of ["leader", "employee"] as const) {
    const issue = departmentRoleCliIssue(role, preferences[role]?.cli);
    if (issue) throw new Error(issue);
  }
  const resolveRoute = (label: string, preference: DepartmentConfiguredRoleRoute): DepartmentRoleRoute => {
    if (!normalizeDepartmentRolePreference(preference)) throw new Error(`${label}角色配置缺失或无效，请重新选择。`);
    if (!validation.hasConfig(preference.cli, preference.configId)) {
      throw new Error(`${label}所选 CLI 档案已失效，请重新选择档案。`);
    }
    if (!validation.hasModel(preference.cli, preference.configId, preference.model)) {
      throw new Error(`${label}所选模型不可用，请重新选择模型。`);
    }
    if (!validation.supportsThinkingMode(preference.cli, preference.model, preference.thinkingMode, preference.configId)) {
      throw new Error(`${label}所选思考力度不适用于当前模型，请重新选择。`);
    }
    if (!validation.supportsOpenCodeVariant(preference.cli, preference.model, preference.openCodeVariant, preference.configId)) {
      throw new Error(`${label}所选 OpenCode 变体不可用，请重新选择。`);
    }
    return {
      cli: preference.cli,
      ...(preference.configId ? { configId: preference.configId } : {}),
      ...(preference.model ? { model: preference.model } : {}),
      ...(preference.thinkingMode ? { thinkingMode: preference.thinkingMode } : {}),
      ...(preference.openCodeVariant ? { openCodeVariant: preference.openCodeVariant } : {}),
    };
  };
  if (!director.cli) {
    throw new Error("总监当前 CLI 不可用，请切换到有效 CLI 后重试。");
  }
  const resolvedDirector = resolveRoute("总监", {
    cli: director.cli,
    configId: director.configId ?? null,
    model: director.model ?? null,
    thinkingMode: director.thinkingMode ?? null,
    openCodeVariant: director.openCodeVariant ?? null,
  });
  const limits = validation.getLimits();
  if (!Number.isSafeInteger(limits.maxLeaders) || limits.maxLeaders < 1
    || !Number.isSafeInteger(limits.maxEmployees) || limits.maxEmployees < 1) {
    throw new Error("产研部并发人数设置无效，请检查系统配置。");
  }
  return {
    routes: {
      director: resolvedDirector,
      leader: resolveRoute("组长", preferences.leader),
      employee: resolveRoute("员工", preferences.employee),
    },
    limits: { ...limits },
    loopPlusAcceptancePlan: normalizeLoopPlusAcceptancePlanSnapshot(validation.getAcceptancePlan()),
  };
}

export type DepartmentConfigurationResolvePort = {
  getDirector: () => DepartmentConfiguredRoleRoute | Promise<DepartmentConfiguredRoleRoute>;
  getActiveConfigIdForCli?: (cli: CliName) => string | null;
  readConfigBinding?: DepartmentConfigBindingReader;
  getSelectionContextRevision?: DepartmentSelectionContextReader;
  getScope?: () => string;
  getReadinessIssue?: () => string | null;
  getPreferences: (director: DepartmentConfiguredRoleRoute) => Partial<DepartmentRolePreferences> | undefined;
  getCandidates: (cli: CliName, configId: string | null) => Promise<DepartmentRoleCandidates>;
  getLimits: DepartmentRouteValidation["getLimits"];
  getAcceptancePlan: DepartmentRouteValidation["getAcceptancePlan"];
};

/** Storage shape validation only; restoring a snapshot does not authorize execution. */
export function normalizeDepartmentConfigurationSnapshot(value: unknown): DepartmentConfigurationState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const routes = raw.routes as Record<string, Record<string, unknown>> | undefined;
  const limits = raw.limits as { maxLeaders?: unknown; maxEmployees?: unknown } | undefined;
  if (!routes || !limits || !Number.isSafeInteger(limits.maxLeaders) || !Number.isSafeInteger(limits.maxEmployees)
    || (limits.maxLeaders as number) < 1 || (limits.maxEmployees as number) < 1) return null;
  const normalized: DepartmentConfigurationState["routes"] = { director: {}, leader: {}, employee: {} };
  for (const role of ["director", "leader", "employee"] as const) {
    const route = routes[role];
    if (!route || typeof route !== "object" || Array.isArray(route)) return null;
    const preference = normalizeDepartmentRolePreference({ cli: route.cli, configId: route.configId ?? null,
      model: route.model ?? null, thinkingMode: route.thinkingMode ?? null, openCodeVariant: route.openCodeVariant ?? null });
    if (!preference) return null;
    normalized[role] = { cli: preference.cli, ...(preference.configId ? { configId: preference.configId } : {}),
      ...(preference.model ? { model: preference.model } : {}), ...(preference.thinkingMode ? { thinkingMode: preference.thinkingMode } : {}),
      ...(preference.openCodeVariant ? { openCodeVariant: preference.openCodeVariant } : {}) };
  }
  return { routes: normalized, limits: { maxLeaders: limits.maxLeaders as number, maxEmployees: limits.maxEmployees as number },
    loopPlusAcceptancePlan: normalizeLoopPlusAcceptancePlanSnapshot(raw.loopPlusAcceptancePlan) };
}

/** Capture once at root start. Browser identity/routes/limits are intentionally absent from this port. */
export async function resolveDepartmentConfigurationWithHost(port: DepartmentConfigurationResolvePort): Promise<DepartmentConfigurationState> {
  const scope = port.getScope?.();
  const contextRevision = port.getSelectionContextRevision?.();
  const assertReady = (): void => {
    if (port.getScope?.() !== scope) throw new Error("工作区或配置作用域已变化，请在当前工作区重新发送。");
    if (port.getSelectionContextRevision?.() !== contextRevision) throw new Error("CLI、模式或模型选择已变化，请重新发送任务。");
    const issue = port.getReadinessIssue?.();
    if (issue) throw new Error(issue);
  };
  assertReady();
  const director = normalizeDepartmentRolePreference(await port.getDirector());
  assertReady();
  if (!director) throw new Error("总监当前配置无效，请重新选择档案与模型。");
  const preferences = port.getPreferences(director);
  const originalPreferences = JSON.stringify(preferences);
  const leader = normalizeDepartmentRolePreference(preferences?.leader);
  const employee = normalizeDepartmentRolePreference(preferences?.employee);
  if (!leader || !employee) throw new Error("请先完成组长和员工的 CLI、档案、模型及思考力度配置。");
  for (const [role, preference] of [["leader", leader], ["employee", employee]] as const) {
    const issue = departmentRoleCliIssue(role, preference.cli);
    if (issue) throw new Error(issue);
  }
  const routes = [director, leader, employee];
  const activeConfigIds = new Map<CliName, string | null>();
  let bindings: DepartmentConfigBindingSnapshot | undefined;
  const assertBindings = (): void => {
    if (!port.getActiveConfigIdForCli) return;
    for (const [cli, configId] of activeConfigIds) {
      if (!configId || port.getActiveConfigIdForCli(cli) !== configId) {
        throw new Error("角色 CLI 激活档案在加载期间发生变化，请重新选择后重试。");
      }
    }
  };
  if (port.getActiveConfigIdForCli) {
    for (const route of routes) {
      if (!activeConfigIds.has(route.cli)) activeConfigIds.set(route.cli, port.getActiveConfigIdForCli(route.cli));
    }
    routes.forEach((route, index) => {
      if (route.configId !== activeConfigIds.get(route.cli)) {
        throw new Error(`${["总监", "组长", "员工"][index]}角色未绑定当前 CLI 激活档案，请重新选择后重试。`);
      }
    });
    assertBindings();
  }
  if (port.readConfigBinding) {
    bindings = await captureDepartmentConfigBindings(routes, port.readConfigBinding);
    assertReady();
    assertBindings();
  }
  const candidates = await Promise.all(routes.map((route) => port.getCandidates(route.cli, route.configId)));
  assertBindings();
  if (bindings && port.readConfigBinding) await assertDepartmentConfigBindingsCurrent(bindings, port.readConfigBinding);
  assertReady();
  routes.forEach((route, index) => {
    try { validateDepartmentRoleCandidate(route, candidates[index]); }
    catch (error) { throw new Error(`${["总监", "组长", "员工"][index]}配置无效：${error instanceof Error ? error.message : "请重新选择。"}`); }
  });
  assertReady();
  const currentDirector = normalizeDepartmentRolePreference(await port.getDirector());
  assertReady();
  assertBindings();
  if (bindings && port.readConfigBinding) await assertDepartmentConfigBindingsCurrent(bindings, port.readConfigBinding);
  if (JSON.stringify(currentDirector) !== JSON.stringify(director)) throw new Error("总监配置在加载期间发生变化，请重试。");
  // Re-read exact profiles after all preparation awaits. A default/model capability
  // or host selection revision change invalidates this request; never silently
  // switch an in-flight root to a newer default.
  const verified = await Promise.all(routes.map((route) => port.getCandidates(route.cli, route.configId)));
  assertReady();
  assertBindings();
  if (bindings && port.readConfigBinding) await assertDepartmentConfigBindingsCurrent(bindings, port.readConfigBinding);
  if (JSON.stringify(verified) !== JSON.stringify(candidates)) throw new Error("角色档案或配置修订在加载期间发生变化，请重试。");
  if (JSON.stringify(port.getPreferences(director)) !== originalPreferences) throw new Error("角色配置在加载期间发生变化，请重试。");
  assertReady();
  const effective = routes.map((route, index) => ({ ...route,
    model: route.cli === "opencode" && route.model === null ? candidates[index].defaultModel : route.model }));
  const [effectiveDirector, effectiveLeader, effectiveEmployee] = effective;
  // Validation above is exact-profile; the synchronous resolver copies routes, limits and plan.
  return resolveDepartmentConfiguration({ ...effectiveDirector, configId: effectiveDirector.configId ?? undefined, model: effectiveDirector.model ?? undefined,
    thinkingMode: effectiveDirector.thinkingMode ?? undefined, openCodeVariant: effectiveDirector.openCodeVariant ?? undefined },
  { leader: effectiveLeader, employee: effectiveEmployee }, {
    hasConfig: () => true, hasModel: () => true, supportsThinkingMode: () => true, supportsOpenCodeVariant: () => true,
    getLimits: port.getLimits, getAcceptancePlan: port.getAcceptancePlan,
  });
}


/** Host-only save barrier. Scope includes workspace generation and director selection. */
export class DepartmentConfigurationSaveBarrier {
  private readonly operations = new Map<string, Map<string, { pending: boolean; failed: boolean }>>();
  begin(scope: string, role: string): (ok: boolean) => void {
    const rows = this.operations.get(scope) ?? new Map();
    this.operations.set(scope, rows);
    if (rows.get(role)?.pending) throw new Error("该角色配置正在保存，请完成后重试。");
    const operation = { pending: true, failed: false };
    rows.set(role, operation);
    return (ok) => { operation.pending = false; operation.failed = !ok; };
  }
  issue(scope: string): string | null {
    const rows = [...(this.operations.get(scope)?.values() ?? [])];
    if (rows.some((row) => row.pending)) return "产研部角色配置正在保存，请保存完成后再新建任务。";
    if (rows.some((row) => row.failed)) return "产研部角色配置保存失败，请重试成功后再新建任务。";
    return null;
  }
}
