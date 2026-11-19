import { createDepartmentEmployeeAllocationHost } from "./departmentemployeeallocationhost";
import { assertDepartmentOrganizationContinuation, readDepartmentOrganizationStopFeedback, type DepartmentLeaderOwnershipReader } from "./departmentGroupChatProjection";
import { departmentRoleCliIssue, normalizeDepartmentMetadata, type DepartmentMetadata, type DepartmentRoleRoute } from "../department";
import { normalizeDepartmentConfigurationSnapshot, type DepartmentConfigurationState } from "../departmentConfiguration";
import { DepartmentCapacityPool, type DepartmentCapacitySnapshot } from "../departmentcapacity";
import { DEPARTMENT_MAX_EMPLOYEES_DEFAULT, DEPARTMENT_MAX_LEADERS_DEFAULT } from "../departmentSettings";
import { normalizeLoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";
import { buildLoopBlockerDiagnosticFailure } from "../loopBlocker";
import { resolveLegacyLoopMaxRounds, type LoopMainDecision, type LoopTaskRecord } from "../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "../promptRunTypes";
import type { DepartmentPromptStartRequest } from "../sessionMessageHandlers";
import { isLocalSessionId } from "../interactive/sessionHistoryRepair";
import { extractJsonObjectTexts } from "../shared/jsonObjectText";
import { createDepartmentOrchestrationHost, type DepartmentOrchestrationDeps } from "./departmentorchestration";
import type { ClassicLoopDecisionResult, DepartmentDirectorDecisionRequest } from "./loopOrchestration";
import { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentRuntimeSnapshot } from "./departmentruntimestate";
import type { CliName, ThinkingMode } from "../cli/types";

/** Resolve an unspecified host thinking preference ONCE, before persisting role routes.
 * OpenCode keeps its exact variant separately and never inherits a visible thinking selection. */
export function freezeDepartmentThinkingDefaults(configuration: DepartmentConfigurationState,
  resolve: (cli: CliName, model: string | null) => ThinkingMode): DepartmentConfigurationState {
  const frozen = clone(configuration);
  for (const route of Object.values(frozen.routes)) {
    if (!route.cli) throw new Error("部门角色 CLI 缺失。");
    if (route.cli !== "opencode") route.thinkingMode ??= resolve(route.cli, route.model ?? null);
  }
  return frozen;
}

export type DepartmentRuntimeCompositionDeps = Omit<DepartmentOrchestrationDeps,
  "capacity" | "persistRuntime" | "notifyDirector" | "buildLeaderInput" | "validateRoutes" | "canExecuteRoot" | "leaderSettled" | "beginEmployeeAdmission" | "readEmployeeCapacity"> & {
  store: DepartmentRuntimeStore;
  readLeaderTaskIds?: DepartmentLeaderOwnershipReader;
  /** The department repository is authoritative for director control in production. */
  readOrganizationRoot?(taskId: string): LoopTaskRecord | null;
  workspaceKey(): string;
  /** Resolves live capabilities and shared profile availability without switching any profile. */
  prepareColdRecovery?(root: LoopTaskRecord, assertCurrent: () => void): Promise<void>;
  prepareRoutes(routes: DepartmentMetadata["routes"]): Promise<void>;
  validateRoutes(routes: DepartmentMetadata["routes"]): boolean;
  resolveTargetForRoot?(root: LoopTaskRecord): PromptRunTarget | null;
  resolveTarget(tabId: string | null): PromptRunTarget | null;
  taskForTarget(tabId: string | null): LoopTaskRecord | null;
  createRoot(input: PromptRunInput, target: PromptRunTarget, configuration: DepartmentConfigurationState): LoopTaskRecord;
  captureDirectorTaskSummary?(input: PromptRunInput, target: PromptRunTarget): void;
  /** Show only a successfully registered and bound director; panel loading must not block execution. */
  openGroupChat?(taskId: string): Promise<void>;
  runDirectorDecision(request: { input: PromptRunInput; target: PromptRunTarget; task: LoopTaskRecord; round: number }): Promise<ClassicLoopDecisionResult>;
  /** Keep the existing orphan detector informed while preparation, clarification,
   * coordination waits and model consumption still belong to this director. */
  acquireDirectorOwnership?(taskId: string): () => void;
  applyClassicDecision(taskId: string, decision: LoopMainDecision): { status: string; task: LoopTaskRecord; subtasks?: LoopTaskRecord["subTasks"] };
  report(taskId: string, message: string): void;
  completed?(task: LoopTaskRecord, decision: LoopMainDecision, target: PromptRunTarget): void;
  stopDirector(taskId: string): void | Promise<void>;
  waitForDirectorClarification?(task: LoopTaskRecord, target: PromptRunTarget): Promise<boolean>;
};
type Controller = { target: PromptRunTarget; input: PromptRunInput; revision: number; wake: (() => void) | null; run: Promise<void> | null; stopped: boolean;
  stopRevision: number };
const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Host-only central factory. Installs admission on the SAME adapter used by ordinary Loop+. */
export function createDepartmentRuntimeComposition(deps: DepartmentRuntimeCompositionDeps) {
  const capacity = new DepartmentCapacityPool({ maxLeaders: DEPARTMENT_MAX_LEADERS_DEFAULT, maxEmployees: DEPARTMENT_MAX_EMPLOYEES_DEFAULT });
  const snapshots = new Map<string, DepartmentRuntimeSnapshot>();
  const failed = new Set<string>();
  const controllers = new Map<string, Controller>();
  // Request identity exists before route preparation, independently of recovered
  // execution controllers. Removing it revokes this request, never grants execution.
  const continuations = new Map<string, object>();
  // A cold stop owns preparation only, never execution. Keep it separate from
  // continuation tokens so a late continuation/finalizer cannot clear its fence.
  const coldStops = new Map<string, object>();
  // Capacity removal precedes original-service retirement. Keep public continue
  // fenced until the WHOLE explicit stop returns; failures retain this fence.
  const unconfirmedStops = new Map<string, object>();
  type StopRequest = { identity: string; state: "stopping" | "unconfirmed" | "confirmed" };
  const stopRequests = new Map<string, StopRequest>();
  const rootIdentity = (task: LoopTaskRecord) => JSON.stringify([task.id, task.workspaceKey, task.taskStoreFile,
    task.cli, task.sessionId, task.department, task.departmentInvalid]);
  const readOrganizationRoot = (id: string) => deps.readOrganizationRoot ? deps.readOrganizationRoot(id) : deps.readTask(id);
  function readOrganizationStopState(id: string): StopRequest["state"] | undefined {
    const request = stopRequests.get(id);
    if (request?.state !== "confirmed") return request?.state;
    const current = readOrganizationRoot(id);
    return current && rootIdentity(current) === request.identity ? "confirmed" : undefined;
  }
  function readCapacity(id: string): DepartmentCapacitySnapshot | null {
    const live = capacity.snapshot(id)[0]; if (live) return live;
    const task = deps.readTask(id); if (!task) return null;
    const saved = deps.store.read(id, task.workspaceKey); return saved.ok ? saved.value?.capacity ?? null : null;
  }
  function assertStopGate(root: LoopTaskRecord): LoopTaskRecord {
    const current = readOrganizationRoot(root.id);
    if (!current || rootIdentity(current) !== rootIdentity(root)) throw new Error("部门续接归属已变化。");
    assertDepartmentOrganizationContinuation(current, readDepartmentOrganizationStopFeedback(current, deps.workspaceKey(), {
      readTaskRecord: () => current, readCapacity,
    }, readOrganizationStopState(root.id)));
    return current;
  }
  let disposed = false;
  function save(root: string, releaseLeaderModuleId?: string): void {
    const runtime = snapshots.get(root), task = deps.readTask(root);
    if (!runtime || !task) throw new Error("部门运行记录不存在，已封闭派发。");
    const occupancy = capacity.snapshot(root)[0] ?? { rootTaskId: root, ...task.department!.limits, leaders: [], employees: [] };
    if (releaseLeaderModuleId) occupancy.leaders = occupancy.leaders.filter((id) => id !== releaseLeaderModuleId);
    const result = deps.store.write({ version: 1, rootTaskId: root, workspaceKey: task.workspaceKey, runtime: clone(runtime), capacity: occupancy });
    if (!result.ok) { failed.add(root); throw new Error(`部门运行状态保存失败：${result.error}`); }
    // Real releases must still be persisted after revocation, but revocation is
    // never permission to migrate/register policy or heal an execution fence.
    const meta = normalizeDepartmentMetadata(task.department);
    if (task.departmentInvalid || !meta || meta.role !== "director" || meta.rootTaskId !== root
      || meta.parentTaskId !== null || meta.leaderSubtaskId !== null || task.workspaceKey !== deps.workspaceKey()
      || !deps.validateRoutes(meta.routes)) { failed.add(root); return; }
    // Only this verified organization lifecycle migrates/registers allocation state.
    const allocation = deps.store.synchronizeEmployeeAllocation(root, task.workspaceKey);
    if (!allocation.ok) { failed.add(root); throw new Error(`部门员工额度保存失败：${allocation.error}`); }
    failed.delete(root);
  }
  const allocation = createDepartmentEmployeeAllocationHost({ ...deps, capacity,
    runtimeSnapshot: (root) => host.runtimeSnapshot(root),
    current: (root) => !disposed && !failed.has(root) && host.runtimeSnapshot(root) !== null,
    persistenceFailed: (root) => { failed.add(root); },
  });
  const host = createDepartmentOrchestrationHost({ ...deps, capacity,
    beginEmployeeAdmission: allocation.beginEmployeeAdmission,
    readEmployeeCapacity: allocation.readEmployeeCapacity,
    canExecuteRoot: (root) => !disposed && !failed.has(root) && deps.readTask(root)?.workspaceKey === deps.workspaceKey(),
    persistRuntime: (snapshot, releaseLeaderModuleId) => { snapshots.set(snapshot.rootTaskId, clone(snapshot)); save(snapshot.rootTaskId, releaseLeaderModuleId); },
    leaderSettled: (root, taskId, generation) => {
      const c = controllers.get(root), task = deps.readTask(root), member = host.runtimeSnapshot(root)?.leaders.find((item) => item.taskId === taskId);
      if (!c || c.stopped || disposed || task?.status !== "running" || task.workspaceKey !== deps.workspaceKey()
        || failed.has(root) || !member || member.generation !== generation || !deps.validateRoutes(metadata(task).routes)) return;
      deps.report(root, `组长汇报：${deps.readTask(taskId)?.department?.moduleTitle ?? taskId}（${member.status}）\n${deps.readTask(taskId)?.finalSummary ?? "请查看组长任务状态"}`);
      wake(root);
    },
    notifyDirector: (root, message) => { deps.report(root, `组长协作待总监处理：${message.id}\n${message.body}`); wake(root); },
    buildLeaderInput: (route, request, plan, metadata) => {
      return roleInput(request.prompt, request.prompt, route, metadata.routes.employee, plan);
    },
  });
  // Every actual acquire/release is synchronously captured, independently of organization mutations.
  const capacitySubscription = capacity.subscribe((root) => { if (!snapshots.has(root)) return; try { save(root); } catch (error) { failed.add(root); deps.log?.("department-capacity-persist-failed", error); } });
  deps.runtime.setDepartmentCollaborationHandler?.(host.coordinateCollaboration);
  function wake(root: string): void {
    const c = controllers.get(root); if (!c) return;
    c.revision++; const resolve = c.wake; c.wake = null; resolve?.();
  }
  function metadata(task: LoopTaskRecord): DepartmentMetadata {
    const value = normalizeDepartmentMetadata(task.department);
    if (task.departmentInvalid || !value || task.workspaceKey !== deps.workspaceKey()) throw new Error("部门任务身份或工作区无效，拒绝继续。");
    return value;
  }
  function ensure(root: LoopTaskRecord): void {
    if (host.runtimeSnapshot(root.id)) return;
    const m = metadata(root), saved = deps.store.read(root.id, root.workspaceKey);
    if (!saved.ok) { failed.add(root.id); throw new Error(saved.error); }
    if (!saved.value) throw new Error("部门运行快照缺失，不能将既有任务视为空组织。");
    snapshots.set(root.id, saved.value.runtime);
    const result = host.recoverRoot(root, m, normalizeLoopPlusAcceptancePlanSnapshot(root.loopPlusAcceptancePlan), saved.value.runtime, [saved.value.capacity]);
    if (!result.ok) { failed.add(root.id); throw new Error(`部门恢复核验阻塞：${result.reason}。保留原占用，不能重新派发。`); }
  }
  async function startDepartmentPrompt(request: DepartmentPromptStartRequest & { departmentConfiguration: DepartmentConfigurationState }): Promise<void> {
    if (disposed) throw new Error("部门运行入口已释放。");
    request.assertCurrent?.();
    const configuration = normalizeDepartmentConfigurationSnapshot(request.departmentConfiguration);
    if (!configuration || configuration.routes.director.cli !== request.cli) throw new Error("产研部固化配置无效。");
    for (const role of ["leader", "employee"] as const) {
      const issue = departmentRoleCliIssue(role, configuration.routes[role].cli);
      if (issue) throw new Error(issue);
    }
    const workspace = deps.workspaceKey(), target = deps.resolveTarget(request.targetTabId);
    if (!target || target.cli !== request.cli || deps.taskForTarget(target.tabId)) throw new Error("目标会话不可新建部门，请使用独立会话。");
    const identity = JSON.stringify(target);
    await deps.prepareRoutes(clone(configuration.routes));
    // Last await is above. Revalidate before the FIRST task/session/execution mutation.
    request.assertCurrent?.();
    if (disposed || workspace !== deps.workspaceKey() || identity !== JSON.stringify(deps.resolveTarget(target.tabId))
      || deps.taskForTarget(target.tabId) || !deps.validateRoutes(configuration.routes)) throw new Error("工作区、目标会话或角色配置已变化，部门未启动。");
    const input = roleInput(request.displayPrompt, request.modelPrompt, configuration.routes.director, configuration.routes.employee, configuration.loopPlusAcceptancePlan);
    const task = deps.createRoot(input, target, clone(configuration));
    const m = metadata(task);
    if (m.role !== "director" || m.rootTaskId !== task.id || m.parentTaskId !== null || m.leaderSubtaskId !== null
      || task.schedulingMode === "event_driven" || !same(m.routes, configuration.routes) || !same(m.limits, configuration.limits)
      || !same(normalizeLoopPlusAcceptancePlanSnapshot(task.loopPlusAcceptancePlan), configuration.loopPlusAcceptancePlan)) throw new Error("总监身份持久化失败，部门未执行。");
    const registered = host.registerRoot(task, m, configuration.loopPlusAcceptancePlan);
    if (!registered.ok) throw new Error(`部门注册失败：${registered.reason}`);
    const bound = deps.resolveTarget(target.tabId);
    if (!bound || bound.cli !== task.cli || bound.sessionId !== task.sessionId) throw new Error("总监会话绑定失败。");
    captureDirectorTaskSummary(input, bound);
    attach(task, bound, input); launchDirector(task.id);
    if (deps.openGroupChat) {
      try {
        void deps.openGroupChat(task.id).catch((error) => {
          try { deps.log?.("department-group-chat-open-failed", error); } catch { /* display cannot stop execution */ }
        });
      } catch (error) {
        try { deps.log?.("department-group-chat-open-failed", error); } catch { /* display cannot stop execution */ }
      }
    }
  }
  function captureDirectorTaskSummary(input: PromptRunInput, target: PromptRunTarget): void {
    try {
      deps.captureDirectorTaskSummary?.(input, target);
    } catch (error) {
      try { deps.log?.("department-task-summary-capture-failed", error); } catch { /* The director can still run. */ }
    }
  }

  function attach(task: LoopTaskRecord, target: PromptRunTarget, input?: PromptRunInput): Controller {
    const existing = controllers.get(task.id); if (existing) return existing;
    const m = metadata(task);
    const c: Controller = { target: clone(target), input: input ?? roleInput(task.rootPrompt, task.rootPrompt, m.routes.director, m.routes.employee,
      normalizeLoopPlusAcceptancePlanSnapshot(task.loopPlusAcceptancePlan)), revision: 0, wake: null, run: null, stopped: false, stopRevision: 0 };
    controllers.set(task.id, c); return c;
  }
  function launchDirector(root: string, preparedOwnership?: () => void): boolean {
    const c = controllers.get(root); if (!c || c.run || c.stopped || disposed) { wake(root); return false; }
    const release = preparedOwnership ?? deps.acquireDirectorOwnership?.(root);
    const stopRevision = c.stopRevision;
    // Store the managed promise: awaiting a stopped run includes its finalizer
    // and release, so an explicit successor cannot collide with stale c.run.
    const run = directorLoop(root, c, stopRevision).catch((error) => {
      if (c.stopRevision !== stopRevision || c.stopped || disposed) return;
      c.stopped = true;
      // A failed model turn is resumable; a failed state write keeps the persistence fence.
      try {
        if (deps.readTask(root)?.status === "running" && !deps.updateTask(root, { status: "needs-review" })) failed.add(root);
        deps.report(root, `总监协调已暂停：${error instanceof Error ? error.message : String(error)}`);
      } catch (failure) { failed.add(root); try { deps.log?.("department-director-pause-failed", failure); } catch { /* remain fenced */ } }
    }).finally(() => { if (c.run === run) c.run = null; release?.(); });
    c.run = run;
    return true;
  }
  async function directorLoop(root: string, c: Controller, stopRevision: number): Promise<void> {
    while (!disposed && !c.stopped && c.stopRevision === stopRevision) {
      const task = deps.readTask(root);
      if (!task || task.status !== "running" || task.workspaceKey !== deps.workspaceKey() || failed.has(root)) return;
      const target = deps.resolveTarget(c.target.tabId);
      if (!target || target.cli !== task.cli || target.sessionId !== task.sessionId) throw new Error("总监真实会话绑定已变化，协调已暂停。");
      if (!deps.validateRoutes(metadata(task).routes)) throw new Error("部门角色配置已变化，协调已暂停。");
      c.target = clone(target);
      if (task.pendingClarification) {
        if (!deps.waitForDirectorClarification || !await deps.waitForDirectorClarification(task, c.target)) return;
        continue;
      }
      if (task.currentRound >= resolveLegacyLoopMaxRounds(task.maxRounds)) {
        if (!deps.updateTask(root, { status: "needs-review", finalSummary: "总监已达到经典 Loop 轮次上限，等待继续。" })) throw new Error("总监暂停状态保存失败。");
        return;
      }
      const revision = c.revision;
      const result = await deps.runDirectorDecision({ input: { ...c.input,
        modelPrompt: `${c.input.modelPrompt}\n${host.directorCoordinationContext(root)}` },
        target: c.target, task, round: Math.max(1, task.currentRound + 1) });
      // Late model results cannot complete or wake a successor after stop.
      if (disposed || c.stopped || c.stopRevision !== stopRevision) return;
      const current = deps.readTask(root), bound = deps.resolveTarget(c.target.tabId);
      // The first trusted model turn persists the native thread in place of
      // the local transcript placeholder. Both its returned task and a fresh
      // host read must confirm that one handoff; established sessions stay fixed.
      const firstBinding = task.sessionId !== null && isLocalSessionId(task.sessionId) && result.task.id === root && current?.sessionId === result.task.sessionId;
      if (!current || !bound || bound.cli !== current.cli || bound.tabId !== c.target.tabId || bound.sessionId !== current.sessionId
        || (current.sessionId !== task.sessionId && !firstBinding)
        || current.workspaceKey !== deps.workspaceKey() || !same(current.department, task.department)
        || !deps.validateRoutes(metadata(current).routes)) throw new Error("总监等待后归属已变化。");
      c.target = clone(bound);
      if (result.status === "completed") { deps.completed?.(result.task, result.decision, c.target); return; }
      if (result.status === "interrupted" || result.status === "needs-review") return;
      if (result.status === "awaiting-input") continue;
      if (revision === c.revision && !c.stopped && !disposed) await new Promise<void>((resolve) => { c.wake = resolve; });
    }
  }
  async function handleDirectorDecision(request: DepartmentDirectorDecisionRequest): Promise<ClassicLoopDecisionResult> {
    const task = deps.readTask(request.task.id), decision = request.decision;
    if (!task || task.status !== "running" || controllers.get(task.id)?.stopped || disposed
      || metadata(task).role !== "director" || !host.runtimeSnapshot(task.id) || failed.has(task.id)) throw new Error("部门组织状态不可执行。");
    // Explicit director actions are parsed from the same actual model response, identities stay host-bound.
    for (const text of extractJsonObjectTexts(request.content ?? "")) {
      const raw = JSON.parse(text) as Record<string, unknown>;
      if (raw.status !== decision.status || raw.directorCollaborations === undefined) continue;
      if (!Array.isArray(raw.directorCollaborations)) throw new Error("总监协作决策格式无效。");
      for (const action of raw.directorCollaborations) {
        if (!action || typeof action.id !== "string" || !["deliver", "dismiss"].includes(action.action)) throw new Error("总监协作决策无效。");
        const result = host.processDirectorCollaboration(task.id, action.id, action.action);
        if (!result.ok) deps.report(task.id, `协作处置失败：${action.id}，${result.reason}`);
      }
      break;
    }
    if (!host.acknowledgeRootRequirements(task.id, request.requirements)) return { status: "pending-requirements", task: deps.readTask(task.id)! };
    if (decision.status === "completed") {
      const result = host.confirmRootComplete(task.id, { ...decision, status: "completed" });
      if (!result.ok) { deps.report(task.id, `整体完成被组织门禁拒绝：${result.reason}`); return { status: "pending-requirements", task: deps.readTask(task.id)! }; }
      return { status: "completed", task: deps.readTask(task.id)!, decision };
    }
    if (decision.status === "waiting") {
      const leaders = host.runtimeSnapshot(task.id)?.leaders ?? [];
      if (leaders.some((member) => member.status === "starting" || member.status === "running")) {
        return { status: "pending-requirements", task };
      }
      const summary = "总监请求等待组长汇报，但当前没有正在运行的组长任务；已暂停自动协调，请复核组织状态后继续。";
      const paused = deps.updateTask(task.id, { status: "needs-review", finalSummary: summary, updatedAt: Date.now() });
      if (!paused) throw new Error("总监等待状态保存失败。");
      deps.report(task.id, summary);
      return { status: "needs-review", task: paused, decision };
    }
    if (decision.status === "blocked") {
      const leaders = host.runtimeSnapshot(task.id)?.leaders ?? [];
      const hasFailedLeader = leaders.some((member) => member.status === "blocked" || member.status === "failed");
      if (!decision.blocker && !hasFailedLeader) return { status: "pending-requirements", task };
      const summary = decision.blocker
        ? decision.finalSummary ?? "总监报告存在无法推进的阻塞，整体任务尚未完成。"
        : buildLoopBlockerDiagnosticFailure(decision.finalSummary, decision.blockerIssue);
      const paused = deps.updateTask(task.id, { status: "needs-review", finalSummary: summary, updatedAt: Date.now() });
      if (!paused) throw new Error("总监阻塞状态保存失败。");
      deps.report(task.id, summary);
      return { status: "needs-review", task: paused, decision };
    }
    const applied = deps.applyClassicDecision(task.id, decision);
    if (decision.status === "clarify") return { status: "awaiting-input", task: applied.task, decision };
    for (const module of applied.subtasks ?? []) {
      const saved = host.runtimeSnapshot(task.id)!;
      if (saved.leaders.some((member) => member.leaderSubtaskId === module.id) || saved.startingModules?.includes(module.id)) continue;
      void host.startLeader(task.id, { leaderSubtaskId: module.id, moduleTitle: module.title, prompt: module.prompt ?? module.title }).then((result) => {
        if (!result.ok) deps.report(task.id, `组长未启动：${module.title}，${result.reason}`);
        wake(task.id);
      }).catch((error) => { deps.report(task.id, `组长启动异常：${String(error)}`); wake(task.id); });
    }
    // The caller never receives classic subtasks to execute through the ordinary batch runner.
    return { status: "pending-requirements", task: deps.readTask(task.id)! };
  }
  function isDepartmentContinuation(tabId: string | null): boolean {
    const task = deps.taskForTarget(tabId); return Boolean(task && (task.department !== undefined || task.departmentInvalid));
  }
  async function continueDepartmentPrompt(request: DepartmentPromptStartRequest): Promise<void> {
    request.assertCurrent?.();
    if (disposed) throw new Error("部门运行入口已释放。");
    const found = deps.taskForTarget(request.targetTabId), resolved = deps.resolveTarget(request.targetTabId);
    if (!found || !resolved || found.cli !== resolved.cli || found.sessionId !== resolved.sessionId) throw new Error("部门续接会话绑定无效。");
    const task = clone(found), target = clone(resolved), m = metadata(task), foundRoot = deps.readTask(m.rootTaskId);
    if (!foundRoot) throw new Error("部门根任务不存在。");
    const root = clone(foundRoot), prompt = request.displayPrompt;
    if (coldStops.has(root.id)) throw new Error("部门正在停止，请等待当前停止核验完成。");
    if (continuations.has(root.id)) throw new Error("部门正在继续，请等待当前续接完成。");
    const director = m.role === "director" && root.id === task.id;
    if (director) assertStopGate(task);
    const continuation = {};
    let admitted = false;
    continuations.set(root.id, continuation);
    const assertContinuation = () => {
      // assertCurrent covers caller configuration, not organization cancellation.
      if (disposed || continuations.get(root.id) !== continuation) throw new Error("部门续接已停止或请求已失效。");
      request.assertCurrent?.();
      const current = deps.taskForTarget(request.targetTabId), currentRoot = deps.readTask(root.id);
      if (!current || !currentRoot || current.id !== task.id || current.cli !== task.cli || current.sessionId !== task.sessionId
        || current.workspaceKey !== task.workspaceKey || current.taskStoreFile !== task.taskStoreFile || currentRoot.id !== root.id
        || currentRoot.taskStoreFile !== root.taskStoreFile || currentRoot.cli !== root.cli || currentRoot.sessionId !== root.sessionId
        || currentRoot.workspaceKey !== root.workspaceKey || currentRoot.workspaceKey !== deps.workspaceKey()
        || current.departmentInvalid || currentRoot.departmentInvalid || !same(task.department, current.department)
        || !same(root.department, currentRoot.department) || !same(target, deps.resolveTarget(request.targetTabId))
        || !deps.validateRoutes(m.routes)) throw new Error("部门续接归属已变化。");
      if (director) {
        const trusted = assertStopGate(currentRoot);
        if (trusted.status !== (admitted ? "running" : root.status)) throw new Error("部门续接状态已变化。");
      }
    };
    let c: Controller | undefined, stopRevision: number | undefined;
    let release: (() => void) | undefined;
    let resuming = false;
    try {
    await deps.prepareRoutes(clone(m.routes));
    assertContinuation();
    if (deps.readTask(root.id)?.status !== root.status || deps.readTask(task.id)?.status !== task.status) throw new Error("部门续接状态已变化。");
    ensure(root);
    assertContinuation();
    if (failed.has(root.id)) throw new Error("部门持久化或恢复核验失败，不能继续派发。");
    if (m.role === "leader") {
      if (!deps.runtime.host().hasController(task.id) || !deps.runtime.host().submitUserMessage(task.id, prompt)) throw new Error("组长当前不可接收补充需求，请先由总监继续组织。");
      return;
    }
    if (m.role !== "director" || root.id !== task.id) throw new Error("员工会话不能控制组织。");
    c = attach(root, target);
    stopRevision = c.stopRevision;
    if (root.status !== "running" || c.stopped) {
      // continueRoot can publish running and await leader capacity/preparation.
      // Transfer this exact ownership to the eventual director loop.
      release = deps.acquireDirectorOwnership?.(root.id);
      resuming = true;
      // stop can finish child cleanup before the old model consumer settles.
      // Keep this request's ownership while awaiting the old managed finalizer.
      await c.run;
      assertContinuation();
      if (c.stopRevision !== stopRevision) throw new Error("部门续接已停止或请求已失效。");
      const receipt = stopRequests.get(root.id);
      const continued = await host.continueRoot(root.id, { assertCurrent: assertContinuation, admitted: () => {
        admitted = true;
        if (receipt?.state === "confirmed" && stopRequests.get(root.id) === receipt) stopRequests.delete(root.id);
      } });
      if (!continued.ok) throw new Error(`部门继续被拒绝：${continued.reason}`);
      assertContinuation();
      const resumed = deps.readTask(root.id);
      if (disposed || c.stopRevision !== stopRevision || resumed?.status !== "running"
        || resumed.workspaceKey !== deps.workspaceKey() || !same(resumed.department, root.department)
        || !same(target, deps.resolveTarget(request.targetTabId)) || !deps.validateRoutes(m.routes)) throw new Error("部门续接已停止或归属发生变化。");
      c.stopped = false;
    }
    assertContinuation();
    const latest = deps.readTask(root.id)!;
    if (!deps.updateTask(root.id, { supplementalRequirements: [...(latest.supplementalRequirements ?? []), prompt] })) throw new Error("补充需求保存失败。");
    captureDirectorTaskSummary({ ...c.input, displayPrompt: prompt }, target);
    wake(root.id); if (launchDirector(root.id, release)) release = undefined;
    } catch (error) {
      // A refused/cancelled handoff must not leave a projected running root
      // without its coordinator. The existing stop gate retains unknown leases.
      if (resuming && c && c.stopRevision === stopRevision && !c.run && deps.readTask(root.id)?.status === "running") {
        c.stopped = true; c.stopRevision++;
        await host.stopRoot(root.id);
      }
      throw error;
    } finally {
      release?.();
      if (continuations.get(root.id) === continuation) continuations.delete(root.id);
    }
  }
  async function stop(root: LoopTaskRecord): Promise<void> {
    if (coldStops.has(root.id)) throw new Error("部门正在停止，请等待当前停止核验完成。");
    const request: StopRequest = { identity: rootIdentity(root), state: "stopping" };
    stopRequests.set(root.id, request);
    unconfirmedStops.set(root.id, request);
    try {
      await stopOrganization(root);
      if (stopRequests.get(root.id) !== request) return;
      // Member cleanup and director retirement can finish even when the root stop write did not land.
      const current = readOrganizationRoot(root.id);
      if (disposed || !current || current.status !== "stopped" || current.workspaceKey !== deps.workspaceKey()
        || rootIdentity(current) !== request.identity) throw new Error("部门停止归属或状态已变化。");
      request.state = "confirmed";
      if (unconfirmedStops.get(root.id) === request) unconfirmedStops.delete(root.id);
    } catch (error) {
      if (stopRequests.get(root.id) === request) request.state = "unconfirmed";
      throw error;
    }
  }
  async function stopOrganization(root: LoopTaskRecord): Promise<void> {
    // Revoke even when recovery/ensure fails: a pending request must never adopt
    // this stop as its new baseline after preparation returns.
    continuations.delete(root.id);
    const c = controllers.get(root.id); if (c) { c.stopRevision++; c.stopped = true; wake(root.id); }
    if (disposed) throw new Error("部门运行入口已释放。");
    if (!host.runtimeSnapshot(root.id)) {
      const frozen = clone(root), m = metadata(frozen), request = {};
      if (m.role !== "director" || m.rootTaskId !== frozen.id) throw new Error("部门停止根任务身份无效。");
      // Freeze the authoritative organization, session and state across route
      // preparation. Unrelated timestamps do not grant or revoke ownership.
      const identity = (task: LoopTaskRecord | null) => task && ({ id: task.id, cli: task.cli, sessionId: task.sessionId,
        workspaceKey: task.workspaceKey, department: task.department, departmentInvalid: task.departmentInvalid,
        status: task.status, schedulingMode: task.schedulingMode, modelRouting: task.modelRouting,
        loopPlusAcceptancePlan: task.loopPlusAcceptancePlan, subTasks: task.subTasks, currentRound: task.currentRound });
      const expected = clone(identity(frozen));
      const assertStop = () => {
        if (disposed || coldStops.get(frozen.id) !== request) throw new Error("部门停止请求已失效。");
        if (deps.workspaceKey() !== frozen.workspaceKey || !same(expected, identity(deps.readTask(frozen.id)))
          || host.runtimeSnapshot(frozen.id) || controllers.has(frozen.id)) throw new Error("部门停止归属或状态已变化。");
      };
      coldStops.set(frozen.id, request);
      try {
        assertStop();
        await deps.prepareRoutes(clone(m.routes));
        assertStop();
        if (!deps.validateRoutes(m.routes)) throw new Error("部门角色配置在停止核验期间发生变化。");
        await deps.prepareColdRecovery?.(clone(frozen), assertStop);
        assertStop();
        ensure(deps.readTask(frozen.id)!);
      } finally {
        if (coldStops.get(frozen.id) === request) coldStops.delete(frozen.id);
      }
    }
    // Close admission before awaiting director cancellation; failure must not skip child cleanup.
    const stopping = host.stopRoot(root.id);
    const results = await Promise.allSettled([stopping, Promise.resolve().then(() => deps.stopDirector(root.id))]);
    if (results.some((result) => result.status === "rejected") || results[0].status !== "fulfilled" || !results[0].value) {
      throw new Error("部门停止尚未核验全部执行清理；未核验占用继续保留。");
    }
    await c?.run;
  }
  const organizationControl = {
    continue: async (root: LoopTaskRecord, prompt?: string) => {
      if (disposed) throw new Error("部门运行入口已释放。");
      if (continuations.has(root.id)) throw new Error("部门正在继续，请等待当前续接完成。");
      const current = assertStopGate(root);
      const target = deps.resolveTargetForRoot?.(current);
      if (!target) throw new Error("总监真实会话不可用。");
      if (deps.taskForTarget(target.tabId)?.id !== current.id) throw new Error("部门续接会话绑定无效。");
      await continueDepartmentPrompt({ displayPrompt: prompt ?? "继续部门任务", modelPrompt: prompt ?? "继续部门任务", contextTags: [], targetTabId: target.tabId, cli: target.cli });
    },
    stop,
    complete: async (root: LoopTaskRecord) => { ensure(root); const result = host.confirmRootComplete(root.id, root.finalSummary || "按组长汇报确认整体完成"); if (!result.ok) throw new Error(`整体完成被拒绝：${result.reason}`); },
  };
  return { host, capacity, readDepartmentEmployeeAllocation: allocation.readDepartmentEmployeeAllocation,
    updateDepartmentEmployeeLimit: allocation.updateDepartmentEmployeeLimit,
    readEmployeeCapacity: allocation.readEmployeeCapacity, startDepartmentPrompt, isDepartmentContinuation, continueDepartmentPrompt, handleDirectorDecision, organizationControl,
    wakeDirector: wake,
    recoverRoot: (root: LoopTaskRecord) => { ensure(root); },
    isOrganizationStopUnconfirmed: (root: string) => unconfirmedStops.has(root),
    readOrganizationStopState,
    readCapacity,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      continuations.clear();
      coldStops.clear();
      for (const [root, c] of controllers) { c.stopRevision++; c.stopped = true; wake(root); }
      // Keep recording real releases during shutdown; disposal is not evidence of cleanup.
      const cleanup = [...snapshots].map(([root, snapshot]) => Promise.allSettled([
        Promise.resolve().then(() => deps.stopDirector(root)),
        ...snapshot.leaders.map((member) => deps.runtime.waitForTaskIdle(member.taskId)),
        controllers.get(root)?.run,
      ]));
      void Promise.allSettled(cleanup).then(() => capacitySubscription.dispose());
    },
  };
}
/** All execution categories use frozen employee routing, including general/frontend/fullstack. */
export function roleInput(displayPrompt: string, modelPrompt: string, main: DepartmentRoleRoute, employee: DepartmentRoleRoute,
  plan: DepartmentConfigurationState["loopPlusAcceptancePlan"]): PromptRunInput {
  return { displayPrompt, modelPrompt, contextTags: [], model: main.model, loopMainModel: main.model, loopMainThinkingMode: main.thinkingMode,
    loopSubtaskCli: employee.cli, loopSubtaskConfigId: employee.configId, loopSubtaskModel: employee.model, loopSubtaskThinkingMode: employee.thinkingMode,
    loopSubtaskFrontendCli: employee.cli, loopSubtaskFrontendConfigId: employee.configId, loopSubtaskFrontendModel: employee.model,
    loopSubtaskFrontendThinkingMode: employee.thinkingMode, loopSubtaskFullstackCli: employee.cli, loopSubtaskFullstackConfigId: employee.configId,
    loopSubtaskFullstackModel: employee.model, loopSubtaskFullstackThinkingMode: employee.thinkingMode, loopSubtaskMode: "fullstack", loopPlusAcceptancePlan: clone(plan) };
}
