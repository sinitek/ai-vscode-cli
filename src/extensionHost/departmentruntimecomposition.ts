import { createDepartmentEmployeeAllocationHost } from "./departmentemployeeallocationhost";
import { departmentLifecycleDiagnostic, departmentCleanupErrorCode, type DepartmentLifecycleStage } from "./departmentlifecyclediagnostics";
import { assertDepartmentOrganizationContinuation, readDepartmentOrganizationStopFeedback, type DepartmentLeaderOwnershipReader } from "./departmentGroupChatProjection";
import { departmentRoleCliIssue, normalizeDepartmentMetadata, type DepartmentMetadata, type DepartmentRoleRoute } from "../department";
import { normalizeDepartmentConfigurationSnapshot, type DepartmentConfigurationState } from "../departmentConfiguration";
import { DepartmentCapacityPool, isValidDepartmentCapacitySnapshot, type DepartmentCapacitySnapshot } from "../departmentcapacity";
import { DEPARTMENT_MAX_EMPLOYEES_DEFAULT, DEPARTMENT_MAX_LEADERS_DEFAULT } from "../departmentSettings";
import { normalizeLoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import { findLoopLiveDispatchConflict } from "../loopParallel";
import { buildLoopBlockerDiagnosticFailure } from "../loopBlocker";
import { normalizeLoopProgressPercent, resolveLegacyLoopMaxRounds, type LoopMainDecision, type LoopTaskRecord } from "../loopTaskStore";
import { getLoopDecisionSubtasks } from "./loopTaskStateMachine";
import type { PromptRunInput, PromptRunTarget } from "../promptRunTypes";
import type { DepartmentPromptStartRequest } from "../sessionMessageHandlers";
import { isLocalSessionId } from "../interactive/sessionHistoryRepair";
import { createDepartmentOrchestrationHost, type DepartmentOrchestrationDeps } from "./departmentorchestration";
import type { ClassicLoopDecisionResult, DepartmentDirectorDecisionRequest } from "./loopOrchestration";
import { DepartmentRuntimeStore } from "./departmentruntimestore";
import { isDepartmentRuntimeSnapshot, type DepartmentRuntimeSnapshot } from "./departmentruntimestate";
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
  "capacity" | "persistRuntime" | "notifyDirector" | "buildLeaderInput" | "validateRoutes" | "canExecuteRoot" | "leaderSettled" | "applyEmployeeAllocation" | "readEmployeeCapacity"> & {
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
  runDirectorDecision(request: { input: PromptRunInput; target: PromptRunTarget; task: LoopTaskRecord; round: number;
    renderDirectorContext(maxLength: number): string }): Promise<ClassicLoopDecisionResult>;
  /** Keep the existing orphan detector informed while preparation, clarification,
   * coordination waits and model consumption still belong to this director. */
  acquireDirectorOwnership?(taskId: string): () => void;
  applyClassicDecision(taskId: string, decision: LoopMainDecision): { status: string; task: LoopTaskRecord; subtasks?: LoopTaskRecord["subTasks"] };
  report(taskId: string, message: string): void;
  completed?(task: LoopTaskRecord, decision: LoopMainDecision, target: PromptRunTarget): void;
  stopDirector(taskId: string): void | Promise<void>;
  logOrganizationStop?(event: { rootTaskId: string; path: "live" | "cold";
    result: "started" | "confirmed" | "unconfirmed"; stage: OrganizationStopStage }): void;
  waitForDirectorClarification?(task: LoopTaskRecord, target: PromptRunTarget): Promise<boolean>;
};
type Controller = { target: PromptRunTarget; input: PromptRunInput; revision: number; wake: (() => void) | null; run: Promise<void> | null; stopped: boolean;
  stopRevision: number };
type OrganizationStopStage = "request" | "save" | "cancel" | "director-cancel" | "director-readback" | "cleanup"
  | "snapshot-read" | "snapshot-fence" | "member-verify" | "capacity-verify" | "member-stop" | "capacity-save" | "capacity-readback";
const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Host-only central factory. Installs admission on the SAME adapter used by ordinary Loop+. */
export function createDepartmentRuntimeComposition(deps: DepartmentRuntimeCompositionDeps) {
  const capacity = new DepartmentCapacityPool({ maxLeaders: DEPARTMENT_MAX_LEADERS_DEFAULT, maxEmployees: DEPARTMENT_MAX_EMPLOYEES_DEFAULT });
  const snapshots = new Map<string, DepartmentRuntimeSnapshot>();
  const failed = new Set<string>();
  const recoveryFailures = new Set<string>();
  const otherFailures = new Set<string>();
  function markFailed(root: string, source: "recovery" | "other" = "other"): void {
    failed.add(root);
    (source === "recovery" ? recoveryFailures : otherFailures).add(root);
  }
  function clearOtherFailures(root: string): void {
    otherFailures.delete(root);
    if (!recoveryFailures.has(root)) failed.delete(root);
  }
  function clearConfirmedRecoveryFailure(root: string): void {
    recoveryFailures.delete(root);
    if (!otherFailures.has(root)) failed.delete(root);
  }
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
  const activeStops = new Map<string, Promise<void>>();
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
    const saved = deps.store.read(id, task.workspaceKey);
    return saved.ok && !saved.value?.runtime.stopping ? saved.value?.capacity ?? null : null;
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
    if (!result.ok) { markFailed(root); throw new Error(`部门运行状态保存失败：${result.error}`); }
    // Real releases must still be persisted after revocation, but revocation is
    // never permission to migrate/register policy or heal an execution fence.
    const meta = normalizeDepartmentMetadata(task.department);
    if (task.departmentInvalid || !meta || meta.role !== "director" || meta.rootTaskId !== root
      || meta.parentTaskId !== null || meta.leaderSubtaskId !== null || task.workspaceKey !== deps.workspaceKey()
      || !deps.validateRoutes(meta.routes)) { markFailed(root); return; }
    // Only this verified organization lifecycle migrates/registers allocation state.
    const allocation = deps.store.synchronizeEmployeeAllocation(root, task.workspaceKey);
    if (!allocation.ok) { markFailed(root); throw new Error(`部门员工额度保存失败：${allocation.error}`); }
    clearOtherFailures(root);
  }
  const allocation = createDepartmentEmployeeAllocationHost({ ...deps, capacity,
    runtimeSnapshot: (root) => host.runtimeSnapshot(root),
    current: (root) => !disposed && !failed.has(root) && host.runtimeSnapshot(root) !== null,
  });
  const host = createDepartmentOrchestrationHost({ ...deps, capacity,
    applyEmployeeAllocation: allocation.applyEmployeeAllocation,
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
  const capacitySubscription = capacity.subscribe((root) => { if (!snapshots.has(root)) return; try { save(root); } catch (error) { markFailed(root); deps.log?.("department-capacity-persist-failed", error); } });
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
    const startedAt = Date.now();
    let stage: DepartmentLifecycleStage = "identity";
    let rejectionCode: string | undefined;
    try {
      const metadataSnapshot = metadata(root);
      stage = "snapshot-read";
      const saved = deps.store.read(root.id, root.workspaceKey);
      if (!saved.ok) { markFailed(root.id); throw new Error(saved.error); }
      if (!saved.value) throw new Error("部门运行快照缺失，不能将既有任务视为空组织。");
      stage = "stop-gate";
      if (saved.value.runtime.stopping) throw new Error("部门停止尚未确认，不能恢复或继续执行。");
      snapshots.set(root.id, saved.value.runtime);
      stage = "recovery-verify";
      const result = host.recoverRoot(root, metadataSnapshot, normalizeLoopPlusAcceptancePlanSnapshot(root.loopPlusAcceptancePlan), saved.value.runtime, [saved.value.capacity]);
      if (!result.ok) {
        rejectionCode = result.reason;
        markFailed(root.id, "recovery");
        throw new Error(`部门恢复核验阻塞：${result.reason}。保留原占用，不能重新派发。`);
      }
      departmentLifecycleDiagnostic("department-root-recovery", { rootTaskId: root.id, stage, result: "confirmed",
        reason: "none", elapsedMs: Date.now() - startedAt });
    } catch (error) {
      departmentLifecycleDiagnostic("department-root-recovery", { rootTaskId: root.id, stage, result: "unconfirmed",
        reason: stage === "stop-gate" ? "already-blocked" : "evidence-rejected", elapsedMs: Date.now() - startedAt,
        errorCode: rejectionCode ?? departmentCleanupErrorCode(error) });
      throw error;
    }
  }
  async function stopColdLoopPlusMembers(root: LoopTaskRecord, rootMetadata: DepartmentMetadata, assertCurrent: () => void,
    setStage: (stage: OrganizationStopStage) => void): Promise<void> {
    if (rootMetadata.executionMode !== "loop-plus") return;
    setStage("snapshot-read");
    const read = deps.store.read(root.id, root.workspaceKey);
    if (!read.ok || !read.value) throw new Error("Loop+ 部门停止快照不可用，保留原占用。");
    let stored = read.value;
    const plan = normalizeLoopPlusAcceptancePlanSnapshot(root.loopPlusAcceptancePlan);
    if (!plan || !isDepartmentRuntimeSnapshot(stored.runtime, root.id)
      || !isValidDepartmentCapacitySnapshot(stored.capacity, root.id)
      || stored.runtime.startingModules?.length
      || stored.executionBindings?.length || stored.leaderExecutionSets?.length
      || stored.capacity.maxLeaders !== rootMetadata.limits.maxLeaders
      || stored.capacity.maxEmployees !== rootMetadata.limits.maxEmployees) {
      throw new Error("Loop+ 部门停止快照或容量不匹配，保留原占用。");
    }
    if (!stored.runtime.stopping) {
      setStage("snapshot-fence");
      const fenced = { ...stored, runtime: { ...clone(stored.runtime), stopping: true } };
      const write = deps.store.write(fenced);
      if (!write.ok) throw new Error(`Loop+ 部门停止标记保存失败：${write.error}`);
      assertCurrent();
      const confirmed = deps.store.read(root.id, root.workspaceKey);
      if (!confirmed.ok || !confirmed.value || !same(confirmed.value.runtime, fenced.runtime)
        || !same(confirmed.value.capacity, stored.capacity)) {
        throw new Error("Loop+ 部门停止标记读回未确认，保留原占用。");
      }
      stored = confirmed.value;
    }
    setStage("member-verify");
    const members = stored.runtime.leaders.map((member) => {
      const module = root.subTasks.find((item) => item.id === member.leaderSubtaskId);
      const task = deps.readTask(member.taskId);
      const expectedMetadata = module && normalizeDepartmentMetadata({ ...rootMetadata, role: "leader",
        parentTaskId: root.id, leaderSubtaskId: member.leaderSubtaskId, moduleTitle: module.title });
      const actualMetadata = task && normalizeDepartmentMetadata(task.department);
      let scheduler: ReturnType<typeof createLoopPlusScheduler>;
      try {
        if (!task?.loopPlus) throw new Error("missing-loop-plus-snapshot");
        scheduler = createLoopPlusScheduler({ snapshot: task.loopPlus });
      } catch {
        throw new Error("Loop+ 组长调度快照无效，保留原占用。");
      }
      if (!module || !task || task.id !== member.taskId || task.workspaceKey !== root.workspaceKey
        || task.departmentInvalid || task.schedulingMode !== "event_driven"
        || !expectedMetadata || !same(actualMetadata, expectedMetadata)
        || task.cli !== rootMetadata.routes.leader.cli
        || !same(normalizeLoopPlusAcceptancePlanSnapshot(task.loopPlusAcceptancePlan), plan)) {
        throw new Error("Loop+ 组长任务身份或计划不匹配，保留原占用。");
      }
      return { member, task, scheduler };
    });
    setStage("capacity-verify");
    const activeMemberStatuses = new Set(["starting", "running", "stopping", "blocked"]);
    const expectedLeaderLeases = stored.runtime.leaders.filter((member) => activeMemberStatuses.has(member.status))
      .map((member) => member.leaderSubtaskId).sort();
    const knownModules = new Set(stored.runtime.leaders.map((member) => member.leaderSubtaskId));
    const expectedEmployeeLeases = members.flatMap(({ task, scheduler }) => scheduler.snapshot().running
      .map((attempt) => JSON.stringify([task.id, attempt.attemptId]))).sort();
    if (!same(expectedLeaderLeases, [...stored.capacity.leaders].sort())
      || !same(expectedEmployeeLeases, [...stored.capacity.employees].sort())
      || stored.capacity.leaders.some((moduleId) => !knownModules.has(moduleId))) {
      throw new Error("Loop+ 部门占用与组长 attempt 不一致，保留原占用。");
    }
    setStage("member-stop");
    for (const entry of members) {
      assertCurrent();
      const { member, task, scheduler } = entry;
      const before = { id: task.id, workspaceKey: task.workspaceKey, cli: task.cli, sessionId: task.sessionId,
        taskStoreFile: task.taskStoreFile, department: task.department, departmentInvalid: task.departmentInvalid,
        schedulingMode: task.schedulingMode, loopPlusAcceptancePlan: task.loopPlusAcceptancePlan };
      const initial = scheduler.snapshot();
      if (member.status === "completed") {
        if (!initial.completed || initial.running.length || task.status !== "completed") {
          throw new Error("Loop+ 已完成组长仍有活动调度，保留原占用。");
        }
        continue;
      }
      if (deps.runtime.hasTaskExecution(task.id)) {
        throw new Error("部门恢复核验阻塞：live-leader-unverifiable。保留原占用，不能重新派发。");
      }
      deps.runtime.host().stopParent(task.id);
      await deps.stopLeader(task.id);
      await deps.runtime.waitForTaskIdle(task.id);
      assertCurrent();
      const current = deps.readTask(task.id), after = current && { id: current.id, workspaceKey: current.workspaceKey,
        cli: current.cli, sessionId: current.sessionId, taskStoreFile: current.taskStoreFile,
        department: current.department, departmentInvalid: current.departmentInvalid,
        schedulingMode: current.schedulingMode, loopPlusAcceptancePlan: current.loopPlusAcceptancePlan };
      let stoppedScheduler: ReturnType<typeof createLoopPlusScheduler> | null = null;
      try { if (current?.loopPlus) stoppedScheduler = createLoopPlusScheduler({ snapshot: current.loopPlus }); } catch { /* checked below */ }
      if (!current || !same(before, after) || current.status !== "stopped" || !stoppedScheduler
        || !stoppedScheduler.snapshot().parentStopped || stoppedScheduler.snapshot().running.length
        || deps.runtime.hasTaskExecution(task.id)) {
        throw new Error("Loop+ 组长停止尚未确认，保留原占用。");
      }
    }
    assertCurrent();
    const stoppedRoot = deps.readTask(root.id);
    if (!stoppedRoot || stoppedRoot.status !== "stopped"
      || members.some(({ member }) => stoppedRoot.subTasks.find((module) => module.id === member.leaderSubtaskId)?.status === "running")) {
      throw new Error("Loop+ 部门停止状态未写入，保留原占用。");
    }
    const runtime: DepartmentRuntimeSnapshot = { ...clone(stored.runtime), stopping: false,
      leaders: stored.runtime.leaders.map((member) => ({ ...member,
        status: member.status === "completed" ? "completed" : "paused" })) };
    const capacity = { ...clone(stored.capacity), leaders: [], employees: [], employeeOverflow: [] };
    setStage("capacity-save");
    const write = deps.store.write({ ...stored, runtime, capacity });
    if (!write.ok) throw new Error(`Loop+ 部门停止占用保存失败：${write.error}`);
    setStage("capacity-readback");
    assertCurrent();
    const confirmed = deps.store.read(root.id, root.workspaceKey);
    if (!confirmed.ok || !confirmed.value || !same(confirmed.value.runtime, runtime)
      || !same(confirmed.value.capacity, capacity)) {
      throw new Error("Loop+ 部门停止占用读回未确认，保留原占用。");
    }
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
        if (deps.readTask(root)?.status === "running" && !deps.updateTask(root, { status: "needs-review" })) markFailed(root);
        deps.report(root, `总监协调已暂停：${error instanceof Error ? error.message : String(error)}`);
      } catch (failure) { markFailed(root); try { deps.log?.("department-director-pause-failed", failure); } catch { /* remain fenced */ } }
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
      const result = await deps.runDirectorDecision({ input: { ...c.input }, target: c.target, task, round: Math.max(1, task.currentRound + 1),
        renderDirectorContext: (maxLength) => host.directorCoordinationContext(root, maxLength) });
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
    if (!host.acknowledgeRootRequirements(task.id, request.requirements)) return { status: "pending-requirements", task: deps.readTask(task.id)! };
    if (decision.directorCollaborationIssue) deps.report(task.id, "协作处置格式无效，请用 directorCollaborations 提交稳定消息 ID 和 deliver 或 dismiss。");
    for (const action of decision.directorCollaborations ?? []) {
      const result = host.processDirectorCollaboration(task.id, action.id, action.action);
      if (!result.ok) deps.report(task.id, `协作处置失败：${action.id}，${result.reason}`);
    }
    if (decision.status === "completed") {
      const result = host.confirmRootComplete(task.id, { ...decision, status: "completed" });
      if (!result.ok) { deps.report(task.id, `暂未写入整体完成：${result.reason}`); return { status: "pending-requirements", task: deps.readTask(task.id)! }; }
      return { status: "completed", task: deps.readTask(task.id)!, decision };
    }
    const progressPercent = normalizeLoopProgressPercent(decision.progressPercent);
    const progressPatch = progressPercent !== undefined && progressPercent < 100 && progressPercent !== task.loopProgressPercent
      ? { loopProgressPercent: progressPercent } : {};
    if (decision.status === "waiting") {
      const leaders = host.runtimeSnapshot(task.id)?.leaders ?? [];
      if (leaders.some((member) => member.status === "starting" || member.status === "running")) {
        if (progressPatch.loopProgressPercent === undefined) return { status: "pending-requirements", task };
        const saved = deps.updateTask(task.id, { ...progressPatch, updatedAt: Date.now() });
        if (!saved) throw new Error("总监进度保存失败。");
        return { status: "pending-requirements", task: saved };
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
      const paused = deps.updateTask(task.id, { ...progressPatch, status: "needs-review", finalSummary: summary, updatedAt: Date.now() });
      if (!paused) throw new Error("总监阻塞状态保存失败。");
      deps.report(task.id, summary);
      return { status: "needs-review", task: paused, decision };
    }
    if (decision.status === "continue") {
      const snapshot = host.runtimeSnapshot(task.id);
      const activeModules = new Set([
        ...(snapshot?.startingModules ?? []),
        ...(snapshot?.leaders.filter((member) => ["starting", "running", "stopping", "blocked"].includes(member.status))
          .map((member) => member.leaderSubtaskId) ?? []),
      ]);
      const active = task.subTasks.filter((module) => activeModules.has(module.id) && module.status === "running");
      const candidates = getLoopDecisionSubtasks(decision).filter((candidate): candidate is typeof candidate & { id: string } => typeof candidate.id === "string");
      const conflict = findLoopLiveDispatchConflict(active, candidates);
      const rebound = candidates.find((candidate) => task.subTasks.some((module) => module.id === candidate.id));
      if (conflict || rebound) {
        deps.report(task.id, conflict
          ? `暂未增派 ${conflict.candidateId}：与运行中的组长模块 ${conflict.activeId} 冲突，待其结束后重新判断。`
          : `拒绝覆盖已登记的组长模块 ${rebound!.id}，请使用新的模块 ID 重新派发。`);
        return { status: "pending-requirements", task };
      }
    }
    const applied = deps.applyClassicDecision(task.id, decision);
    if (applied.task.status === "needs-review") {
      if (applied.task.finalSummary) deps.report(task.id, applied.task.finalSummary);
      return { status: "needs-review", task: applied.task, decision };
    }
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
    if (activeStops.has(root.id)) throw new Error("部门正在停止，请稍候。");
    if (continuations.has(root.id)) throw new Error("部门正在继续，请等待当前续接完成。");
    const director = m.role === "director" && root.id === task.id;
    const ownerLeader = m.role === "leader" && m.executionMode !== "loop-plus";
    if (director) assertStopGate(task);
    if (ownerLeader && (request.cli !== target.cli || root.status !== "running" || root.runtimeInterrupted
      || unconfirmedStops.has(root.id))) throw new Error("组长当前不可接收补充需求，请先由总监继续组织。");
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
      if (ownerLeader) {
        const trusted = assertStopGate(currentRoot);
        if (trusted.status !== "running" || trusted.runtimeInterrupted || unconfirmedStops.has(root.id)) {
          throw new Error("组长当前不可接收补充需求，请先由总监继续组织。");
        }
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
      if (ownerLeader) {
        try { await host.submitLeaderSupplement(root.id, task.id, target, prompt, assertContinuation); }
        catch (error) { throw new Error(`组长当前不可接收补充需求：${error instanceof Error ? error.message : String(error)}`); }
      } else if (!deps.runtime.host().hasController(task.id) || !deps.runtime.host().submitUserMessage(task.id, prompt)) {
        throw new Error("组长当前不可接收补充需求，请先由总监继续组织。");
      }
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
      if (!continued.ok) throw Object.assign(new Error(`部门继续被拒绝：${continued.reason}`), { code: continued.reason });
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
  function stop(root: LoopTaskRecord): Promise<void> {
    const current = deps.readTask(root.id);
    if (!current || current.workspaceKey !== deps.workspaceKey() || rootIdentity(current) !== rootIdentity(root)) {
      return Promise.reject(new Error("部门停止归属或状态已变化。"));
    }
    const active = activeStops.get(root.id);
    if (active) return active;
    const operation = stopOnce(current).finally(() => activeStops.delete(root.id));
    activeStops.set(root.id, operation);
    return operation;
  }
  async function stopOnce(root: LoopTaskRecord): Promise<void> {
    const request: StopRequest = { identity: rootIdentity(root), state: "stopping" };
    stopRequests.set(root.id, request);
    unconfirmedStops.set(root.id, request);
    const path = host.runtimeSnapshot(root.id) ? "live" : "cold";
    const diagnostic = (result: "started" | "confirmed" | "unconfirmed", stage: OrganizationStopStage) => {
      try { deps.logOrganizationStop?.({ rootTaskId: root.id, path, result, stage }); } catch { /* Diagnostics are best effort. */ }
    };
    let stage: OrganizationStopStage = "request";
    diagnostic("started", stage);
    try {
      await stopOrganization(root, (currentStage) => { stage = currentStage; });
      if (stopRequests.get(root.id) !== request) return;
      // Member cleanup and director retirement can finish even when the root stop write did not land.
      const current = readOrganizationRoot(root.id);
      if (disposed || !current || current.status !== "stopped" || current.workspaceKey !== deps.workspaceKey()
        || rootIdentity(current) !== request.identity) throw new Error("部门停止归属或状态已变化。");
      request.state = "confirmed";
      if (unconfirmedStops.get(root.id) === request) unconfirmedStops.delete(root.id);
      if (path === "cold" && metadata(current).executionMode === "loop-plus") clearConfirmedRecoveryFailure(root.id);
      diagnostic("confirmed", "cleanup");
    } catch (error) {
      if (stopRequests.get(root.id) === request) request.state = "unconfirmed";
      diagnostic("unconfirmed", stage);
      throw error;
    }
  }
  async function stopOrganization(root: LoopTaskRecord, setStage: (stage: OrganizationStopStage) => void): Promise<void> {
    // Revoke even when recovery/ensure fails: a pending request must never adopt
    // this stop as its new baseline after preparation returns.
    continuations.delete(root.id);
    const c = controllers.get(root.id); if (c) { c.stopRevision++; c.stopped = true; wake(root.id); }
    if (disposed) throw new Error("部门运行入口已释放。");
    let directorStop: Promise<void> | undefined;
    if (!host.runtimeSnapshot(root.id)) {
      let frozen = clone(root); const m = metadata(frozen), request = {};
      if (m.role !== "director" || m.rootTaskId !== frozen.id) throw new Error("部门停止根任务身份无效。");
      // Freeze the authoritative organization, session and state across route
      // preparation. Unrelated timestamps do not grant or revoke ownership.
      const identity = (task: LoopTaskRecord | null) => task && ({ id: task.id, cli: task.cli, sessionId: task.sessionId,
        workspaceKey: task.workspaceKey, department: task.department, departmentInvalid: task.departmentInvalid,
        status: task.status, schedulingMode: task.schedulingMode, modelRouting: task.modelRouting,
        loopPlusAcceptancePlan: task.loopPlusAcceptancePlan, subTasks: task.subTasks, currentRound: task.currentRound });
      let expected = clone(identity(frozen));
      const assertStop = () => {
        if (disposed || coldStops.get(frozen.id) !== request) throw new Error("部门停止请求已失效。");
        if (deps.workspaceKey() !== frozen.workspaceKey || !same(expected, identity(deps.readTask(frozen.id)))
          || host.runtimeSnapshot(frozen.id) || controllers.has(frozen.id)) throw new Error("部门停止归属或状态已变化。");
      };
      coldStops.set(frozen.id, request);
      try {
        assertStop();
        setStage("save");
        const stoppedSubTasks = frozen.subTasks.map((module) => module.status === "running"
          ? { ...module, status: "pending" as const, updatedAt: Date.now() } : module);
        if (frozen.status !== "stopped" || !same(frozen.subTasks, stoppedSubTasks)) {
          try { deps.updateTask(frozen.id, { status: "stopped", subTasks: stoppedSubTasks, updatedAt: Date.now() }); } catch { /* Still request cancellation. */ }
          const saved = deps.readTask(frozen.id);
          if (saved?.status === "stopped" && same(saved.subTasks, stoppedSubTasks)) {
            frozen = clone(saved);
            expected = clone(identity(frozen));
          }
        }
        assertStop();
        setStage("cancel");
        directorStop = Promise.resolve().then(() => deps.stopDirector(frozen.id));
        const [preparation, cancellation] = await Promise.allSettled([
          Promise.resolve().then(() => deps.prepareColdRecovery?.(clone(frozen), assertStop)), directorStop,
        ]);
        if (preparation.status === "rejected") throw preparation.reason;
        assertStop();
        if (m.executionMode === "loop-plus" && cancellation.status === "rejected") {
          setStage("director-cancel");
          throw new Error("总监取消尚未确认，原执行记录继续保留。");
        }
        if (m.executionMode === "loop-plus" && (frozen.status !== "stopped" || !same(frozen.subTasks, stoppedSubTasks))) {
          setStage("director-readback");
          throw new Error("部门停止状态未写入，保留原占用。");
        }
        setStage("cleanup");
        await deps.prepareRoutes(clone(m.routes));
        assertStop();
        if (!deps.validateRoutes(m.routes)) throw new Error("部门角色配置在停止期间发生变化。");
        await stopColdLoopPlusMembers(frozen, m, assertStop, setStage);
        assertStop();
        if (!deps.validateRoutes(m.routes)) throw new Error("部门角色配置在停止期间发生变化。");
        if (m.executionMode === "loop-plus") return;
        ensure(deps.readTask(frozen.id)!);
      } finally {
        if (coldStops.get(frozen.id) === request) coldStops.delete(frozen.id);
      }
    }
    // Close admission before awaiting director cancellation; failure must not skip child cleanup.
    setStage("cleanup");
    const stopping = host.stopRoot(root.id);
    const results = await Promise.allSettled([stopping, directorStop ?? Promise.resolve().then(() => deps.stopDirector(root.id))]);
    if (results.some((result) => result.status === "rejected") || results[0].status !== "fulfilled" || !results[0].value) {
      throw new Error("部门停止尚未完成全部执行清理；原执行记录继续保留。");
    }
    await c?.run;
  }
  async function reconcileColdStopBeforeContinue(root: LoopTaskRecord): Promise<LoopTaskRecord> {
    const current = readOrganizationRoot(root.id);
    if (!current || rootIdentity(current) !== rootIdentity(root)) throw new Error("部门续接归属已变化。");
    if (activeStops.has(root.id)) throw new Error("部门正在停止，请稍候。");
    if (host.runtimeSnapshot(root.id) || metadata(current).executionMode !== "loop-plus") return current;
    const saved = deps.store.read(root.id, current.workspaceKey);
    if (!saved.ok) throw new Error(saved.error);
    if (!saved.value?.runtime.stopping) return current;
    await stop(current);
    const settled = readOrganizationRoot(root.id);
    if (!settled || rootIdentity(settled) !== rootIdentity(root) || settled.status !== "stopped") {
      throw new Error("部门停止状态未确认，不能继续执行。");
    }
    return settled;
  }
  const organizationControl = {
    continue: async (root: LoopTaskRecord, prompt?: string) => {
      const startedAt = Date.now();
      let stage: DepartmentLifecycleStage = "stop-gate";
      try {
        if (disposed) throw new Error("部门运行入口已释放。");
        if (continuations.has(root.id)) throw new Error("部门正在继续，请等待当前续接完成。");
        const current = assertStopGate(await reconcileColdStopBeforeContinue(root));
        stage = "target-verify";
        const target = deps.resolveTargetForRoot?.(current);
        if (!target) throw new Error("总监真实会话不可用。");
        if (deps.taskForTarget(target.tabId)?.id !== current.id) throw new Error("部门续接会话绑定无效。");
        stage = "resume";
        await continueDepartmentPrompt({ displayPrompt: prompt ?? "继续部门任务", modelPrompt: prompt ?? "继续部门任务", contextTags: [], targetTabId: target.tabId, cli: target.cli });
        departmentLifecycleDiagnostic("department-root-continuation", { rootTaskId: root.id, stage, result: "confirmed",
          reason: "none", elapsedMs: Date.now() - startedAt });
      } catch (error) {
        departmentLifecycleDiagnostic("department-root-continuation", { rootTaskId: root.id, stage, result: "unconfirmed",
          reason: stage === "stop-gate" ? "already-blocked" : "evidence-rejected",
          elapsedMs: Date.now() - startedAt, errorCode: departmentCleanupErrorCode(error) });
        throw error;
      }
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
    hasLocalDirectorActivity: (root: string) => controllers.has(root) || continuations.has(root),
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
