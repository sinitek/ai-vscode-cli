import * as fs from "fs";
import * as path from "path";
import { isDeepStrictEqual } from "util";
import { normalizeDepartmentMetadata, type DepartmentMetadata } from "../department";
import { normalizeLoopPlusAcceptancePlanSnapshot, type LoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import { isTimestampWithinHistoryRetention } from "../historyRetention";
import {
  mergeLoopTaskRecordPatch, mergeLoopTaskRound, normalizeLoopTaskRecord,
  registerLoopTaskStoreHostRouter,
  type LoopTaskHostRequest, type LoopTaskHostResult, type LoopTaskRecord, type LoopRoundRecord,
} from "../loopTaskStore";

/** Absence is authoritative only after complete source/index initialization. */
export type DepartmentTaskLocation = { available: false } | { available: true; files: readonly string[] };
export type DepartmentOwnedTaskRepositoryPorts = {
  descriptor: { version: 1; sourceId: string; root: string };
  isCurrent(): boolean;
  /** Monotonic publication generation. External commits/rebuilds require reinitialization. */
  readRevision(): number | null;
  listFiles(): readonly string[];
  readFile(file: string): readonly LoopTaskRecord[] | null;
  /** Must include ordinary identities when checking a new ID, not just department records. */
  locateTask(taskId: string): DepartmentTaskLocation;
  /** Batch authority for complete cached contribution checks. Legacy hosts may use locateTask. */
  locateTasks?(taskIds: readonly string[]): { available: false } | {
    available: true; locations: ReadonlyMap<string, readonly string[]>;
  };
  /** The controller owns the capability in this closure. No token enters this module. */
  commit(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): boolean;
};
export type DepartmentRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: string };
const clone = <T>(value: T): T => structuredClone(value);
const equal = isDeepStrictEqual;
const fail = (error: unknown): { ok: false; error: string } => ({ ok: false, error: error instanceof Error ? error.message : String(error) });
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

/** Assemble the COMPLETE host-owned record before its first persistence. Does not write or
 * authorize an identity. The repository still validates every field and root relationship.
 */
export function prepareDepartmentTaskRecord(record: LoopTaskRecord, metadata: DepartmentMetadata, plan: LoopPlusAcceptancePlanSnapshot): LoopTaskRecord {
  const department = clone(metadata), role = department.role === "director" ? department.routes.director : department.routes.leader;
  const employee = department.routes.employee;
  return { ...record, department, schedulingMode: department.role === "director" ? "classic" : "event_driven",
    loopPlusAcceptancePlan: clone(plan),
    modelRouting: { main: { ...role }, subtask: { ...employee }, subtaskFrontend: { ...employee }, subtaskFullstack: { ...employee } },
    originProfile: role.configId ? { configId: role.configId, mainThinkingMode: role.thinkingMode, mainOpenCodeVariant: role.openCodeVariant,
      subtaskThinkingMode: employee.thinkingMode, subtaskFrontendThinkingMode: employee.thinkingMode, subtaskFullstackThinkingMode: employee.thinkingMode,
      subtaskOpenCodeVariant: employee.openCodeVariant, subtaskFrontendOpenCodeVariant: employee.openCodeVariant, subtaskFullstackOpenCodeVariant: employee.openCodeVariant } : undefined,
  };
}

/** Synchronous, host-only repository. Construction reads a complete source before routing is exposed.
 * Mutations keep physical files stable; logical removal writes [] through the same owner transaction.
 * Failed commits/readback close this instance. Recovery requires a new verified instance/index.
 */
export class DepartmentOwnedTaskRepository {
  private readonly descriptor: DepartmentOwnedTaskRepositoryPorts["descriptor"];
  private readonly files = new Map<string, Set<string>>();
  private readonly identities = new Map<string, string>();
  private records = new Map<string, LoopTaskRecord>();
  private revision: number;
  private readonly retiredIds = new Set<string>();
  private readonly registration: ReturnType<typeof registerLoopTaskStoreHostRouter>;
  private disposed = false;
  private faulted = false;
  private busy = false;

  constructor(private readonly ports: DepartmentOwnedTaskRepositoryPorts) {
    this.descriptor = clone(ports.descriptor);
    if (this.descriptor.version !== 1 || !text(this.descriptor.sourceId)
      || !path.isAbsolute(this.descriptor.root) || fs.realpathSync(this.descriptor.root) !== this.descriptor.root) {
      throw new Error("部门来源描述无效");
    }
    const revision = ports.readRevision();
    if (!Number.isSafeInteger(revision) || revision === null || revision < 0) throw new Error("部门来源发布代次不可用");
    this.revision = revision;
    this.assertCurrent();
    const records = new Map<string, LoopTaskRecord>();
    for (const name of ports.listFiles()) {
      const file = this.file(name);
      if (this.files.has(file)) throw new Error("部门来源文件重复");
      const tasks = ports.readFile(file);
      if (!tasks) throw new Error("部门来源读取失败");
      const ids = new Set<string>();
      for (const task of tasks) {
        if (task.taskStoreFile !== file) throw new Error("部门任务声明路径与受控物理文件不匹配");
        if (records.has(task.id)) throw new Error("部门任务身份重复");
        records.set(task.id, clone(task)); ids.add(task.id); this.identities.set(task.id, file);
      }
      this.files.set(file, ids);
    }
    this.assertLocations(records);
    this.validateAll(records);
    this.records = records;
    this.assertCurrent();
    this.registration = registerLoopTaskStoreHostRouter({ root: this.descriptor.root, knownTaskIds: [...this.identities.keys()], route: (request) => this.route(request) });
  }

  get ready(): boolean {
    try { this.assertCurrent(); return true; } catch { return false; }
  }

  listTaskStoreFiles(): readonly string[] {
    this.assertCurrent();
    return [...this.files.keys()];
  }

  read(taskId: string): DepartmentRepositoryResult<LoopTaskRecord> {
    try {
      this.assertCurrent();
      const file = this.identities.get(taskId);
      if (!file) throw new Error("部门任务不存在");
      const records = this.snapshot([file]);
      const task = records.get(taskId)!;
      if (!isTimestampWithinHistoryRetention(task.updatedAt)) throw new Error("部门任务已超出保留期限");
      return { ok: true, value: clone(task) };
    } catch (error) { return fail(error); }
  }

  /** Complete creation: no ordinary intermediate record and no upgrade of a published identity. */
  create(record: LoopTaskRecord): DepartmentRepositoryResult<LoopTaskRecord> {
    return this.mutate(() => {
      const file = this.file(record.taskStoreFile);
      if (this.identities.has(record.id) || this.retiredIds.has(record.id)) throw new Error("部门任务 ID 已存在或已删除");
      const location = this.ports.locateTask(record.id);
      if (!location.available || location.files.length) throw new Error("任务 ID 冲突或索引不可用，禁止提升普通任务");
      // Any physical entry, including empty files and symlinks, is a collision.
      try { fs.lstatSync(file); throw new Error("部门任务物理路径已存在"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (this.files.has(file)) throw new Error("部门任务路径已登记");
      const records = this.snapshot([]);
      if (!isTimestampWithinHistoryRetention(record.updatedAt)) throw new Error("新任务已超出保留期限，拒绝创建");
      records.set(record.id, clone(record)); this.validateAll(records);
      this.registration.rememberTask(record.id); // Keep the refusal boundary even after partial commit failure.
      this.retiredIds.add(record.id);
      this.commit(new Map([[file, [records.get(record.id)!]]]));
      this.identities.set(record.id, file); this.files.set(file, new Set([record.id])); this.retiredIds.delete(record.id);
      return this.persisted(record.id, file);
    });
  }

  update(taskId: string, patch: Partial<LoopTaskRecord>, options: { allowCompletedToRunning?: boolean } = {}): DepartmentRepositoryResult<LoopTaskRecord> {
    return this.change(taskId, (previous) => mergeLoopTaskRecordPatch(previous, clone(patch), options));
  }

  private change(taskId: string, transform: (previous: LoopTaskRecord) => LoopTaskRecord): DepartmentRepositoryResult<LoopTaskRecord> {
    return this.mutate(() => {
      const file = this.identities.get(taskId);
      if (!file) throw new Error("部门任务不存在");
      const records = this.snapshot([file]), previous = records.get(taskId);
      if (!previous || !isTimestampWithinHistoryRetention(previous.updatedAt)) throw new Error("部门任务不存在或已过期");
      const next = transform(previous);
      if (next.id !== previous.id || next.workspaceKey !== previous.workspaceKey || next.taskStoreFile !== previous.taskStoreFile
        || next.cli !== previous.cli || next.schedulingMode !== previous.schedulingMode
        || !equal(next.department, previous.department) || next.departmentInvalid
        || !equal(next.loopPlusAcceptancePlan, previous.loopPlusAcceptancePlan)
        || !equal(next.modelRouting, previous.modelRouting) || !equal(next.originProfile, previous.originProfile)) {
        throw new Error("禁止修改部门身份、固化路由/方案或迁出受控文件");
      }
      if (!isTimestampWithinHistoryRetention(next.updatedAt)) throw new Error("请使用部门 retention 事务删除过期任务");
      records.set(taskId, next); this.validateAll(records);
      this.commit(new Map([[file, [...records.values()].filter((task) => task.taskStoreFile === file)]]));
      return this.persisted(taskId, file);
    });
  }

  append(taskId: string, round: LoopRoundRecord): DepartmentRepositoryResult<LoopTaskRecord> {
    return this.change(taskId, (previous) => mergeLoopTaskRound(previous, clone(round)));
  }

  rebind(taskId: string, sessionId: string | null, cli?: LoopTaskRecord["cli"]): DepartmentRepositoryResult<LoopTaskRecord> {
    return this.change(taskId, (previous) => {
      if (sessionId !== null && !text(sessionId)) throw new Error("会话身份为空");
      if (cli !== undefined && cli !== previous.cli) throw new Error("部门 CLI 已固化，禁止替换角色路由");
      return mergeLoopTaskRecordPatch(previous, { sessionId: sessionId?.trim() ?? null });
    });
  }

  delete(taskId: string): DepartmentRepositoryResult<void> { return this.remove((task) => task.id === taskId); }
  retention(now = Date.now()): DepartmentRepositoryResult<void> {
    return this.remove((task) => !isTimestampWithinHistoryRetention(task.updatedAt, now));
  }
  /** Imports/restores require a separate verified migration protocol; never silently promote. */
  importRecords(_records: readonly LoopTaskRecord[]): DepartmentRepositoryResult<never> { return fail("部门导入尚不支持，未写入任何数据"); }
  restoreRecords(_records: readonly LoopTaskRecord[]): DepartmentRepositoryResult<never> { return fail("部门恢复写入尚不支持，未写入任何数据"); }
  migrateLegacy(_file: string): DepartmentRepositoryResult<never> { return fail("部门旧数据迁移未获来源身份及重复 ID 证明，拒绝写入"); }
  dispose(): void { this.disposed = true; this.registration.dispose(); }

  private remove(predicate: (task: LoopTaskRecord) => boolean): DepartmentRepositoryResult<void> {
    return this.mutate(() => {
      const records = this.snapshot([...this.files.keys()]), updates = new Map<string, readonly LoopTaskRecord[]>();
      const removed = [...records.values()].filter(predicate);
      for (const task of removed) records.delete(task.id);
      this.validateAll(records); // Do not leave leaders without their root/module.
      for (const task of removed) updates.set(task.taskStoreFile, [...records.values()].filter((item) => item.taskStoreFile === task.taskStoreFile));
      if (updates.size) this.commit(updates);
      for (const task of removed) { this.identities.delete(task.id); this.files.get(task.taskStoreFile)!.delete(task.id); this.retiredIds.add(task.id); }
    });
  }

  private route(request: LoopTaskHostRequest): LoopTaskHostResult {
    let result: DepartmentRepositoryResult<unknown>;
    switch (request.type) {
      case "read": result = this.read(request.taskId); break;
      case "update": result = this.update(request.taskId, request.patch, request.options); break;
      case "append": result = this.append(request.taskId, request.round); break;
      case "rebind": result = this.rebind(request.taskId, request.sessionId, request.cli); break;
      case "retention": result = this.retention(); break;
      case "deleteFile": {
        const file = this.file(request.filePath);
        result = this.files.has(file) ? this.remove((task) => task.taskStoreFile === file) : fail("部门文件未登记"); break;
      }
      case "readFile": {
        try {
          this.assertCurrent(); const file = this.file(request.filePath);
          if (!this.files.has(file)) throw new Error("部门文件未登记");
          const records = this.snapshot([file]);
          return { handled: true, ok: true, store: { tasks: clone([...records.values()].filter((task) => task.taskStoreFile === file && isTimestampWithinHistoryRetention(task.updatedAt))) } };
        } catch { return { handled: true, ok: false }; }
      }
    }
    return result.ok ? { handled: true, ok: true, ...("taskId" in request ? { record: result.value as LoopTaskRecord } : {}) } : { handled: true, ok: false };
  }

  private assertCurrent(): void {
    if (this.disposed || this.faulted || !this.ports.isCurrent() || this.ports.readRevision() !== this.revision) throw new Error("部门任务来源不可用，拒绝回退普通存储");
  }
  private file(value: string): string {
    const file = path.resolve(value);
    if (file !== value || path.dirname(file) !== this.descriptor.root || !path.basename(file).endsWith(".json") || path.basename(file).startsWith(".")) {
      throw new Error("部门任务文件不在受控边界内");
    }
    return file;
  }
  private assertLocation(id: string, file: string): void {
    const location = this.ports.locateTask(id);
    if (!location.available || location.files.length !== 1 || location.files[0] !== file) throw new Error("部门任务唯一身份索引不可用或冲突");
  }
  private assertLocations(records: ReadonlyMap<string, LoopTaskRecord>): void {
    if (!this.ports.locateTasks) {
      for (const [id, task] of records) this.assertLocation(id, task.taskStoreFile);
      return;
    }
    const result = this.ports.locateTasks([...records.keys()]);
    if (!result.available) throw new Error("部门任务唯一身份索引不可用或冲突");
    for (const [id, task] of records) {
      const files = result.locations.get(id);
      if (!files || files.length !== 1 || files[0] !== task.taskStoreFile) throw new Error("部门任务唯一身份索引不可用或冲突");
    }
  }
  private snapshot(refreshFiles: readonly string[]): Map<string, LoopTaskRecord> {
    this.assertCurrent();
    const records = new Map(this.records);
    // Cached contributions were fully validated at initialization/commit. Only re-read the
    // requested physical files; a publication generation change revokes the entire cache.
    for (const file of refreshFiles) {
      const ids = this.files.get(file);
      const tasks = this.ports.readFile(file);
      if (!ids || !tasks || tasks.length !== ids.size) throw new Error("受控文件身份集合已变化");
      const seen = new Set<string>();
      for (const task of tasks) {
        if (task.taskStoreFile !== file || !ids.has(task.id) || seen.has(task.id)) throw new Error("受控任务身份或物理路径冲突");
        seen.add(task.id); records.set(task.id, clone(task));
      }
    }
    // Unique identity queries are trusted index lookups, never directory discovery or file reads.
    this.assertLocations(records);
    this.validateAll(records);
    this.assertCurrent();
    return records;
  }
  private validateAll(records: Map<string, LoopTaskRecord>): void {
    const modules = new Set<string>(), sessions = new Set<string>();
    for (const task of records.values()) {
      const meta = normalizeDepartmentMetadata(task.department), normalized = normalizeLoopTaskRecord(task, task.taskStoreFile);
      if (!meta || task.departmentInvalid || task.executionSessionInvalid || normalized?.executionSessionInvalid
        || !equal(normalized?.executionSession, task.executionSession)
        || !equal(meta, task.department) || !normalized || !text(task.workspaceKey)
        || !text(task.id) || !text(task.rootPrompt) || task.loopSubtaskModeInvalid || !task.loopPlusAcceptancePlan
        || (task.sessionId != null && !text(task.sessionId))
        || !equal(normalizeLoopPlusAcceptancePlanSnapshot(task.loopPlusAcceptancePlan), task.loopPlusAcceptancePlan)
        || !Number.isFinite(task.createdAt) || !Number.isFinite(task.updatedAt)
        || !Array.isArray(task.subTasks) || !Array.isArray(task.rounds)
        || normalized.subTasks.length !== task.subTasks.length || normalized.rounds.length !== task.rounds.length
        || !["running", "completed", "needs-review", "error", "stopped"].includes(task.status)) throw new Error("部门完整记录、角色路由或验收方案无效");
      this.file(task.taskStoreFile);
      if (Object.values(meta.routes).some((route) => !route.cli)) throw new Error("部门角色 CLI 必须显式固化");
      const roleRoute = meta.role === "director" ? meta.routes.director : meta.routes.leader;
      if (task.cli !== roleRoute.cli || (roleRoute.configId && task.originProfile?.configId !== roleRoute.configId)) throw new Error("部门主角色路由不匹配");
      for (const [route, stored] of [[roleRoute, task.modelRouting?.main], [meta.routes.employee, task.modelRouting?.subtask]] as const) {
        if (!stored || ["cli", "configId", "model", "fallback"].some((key) => (stored as Record<string, unknown>)[key] !== (route as Record<string, unknown>)[key])) throw new Error("部门固化模型路由不匹配");
      }
      for (const [route, thinkingMode, variant] of [
        [task.modelRouting?.subtaskFrontend, task.originProfile?.subtaskFrontendThinkingMode, task.originProfile?.subtaskFrontendOpenCodeVariant],
        [task.modelRouting?.subtaskFullstack, task.originProfile?.subtaskFullstackThinkingMode, task.originProfile?.subtaskFullstackOpenCodeVariant],
      ] as const) {
        if (route && (["cli", "configId", "model", "fallback"].some((field) => (route as Record<string, unknown>)[field] !== (meta.routes.employee as Record<string, unknown>)[field])
          || (task.originProfile && (thinkingMode !== meta.routes.employee.thinkingMode || variant !== meta.routes.employee.openCodeVariant)))) throw new Error("部门员工分类路由不匹配");
      }
      if (task.originProfile && (task.originProfile.mainThinkingMode !== roleRoute.thinkingMode || task.originProfile.mainOpenCodeVariant !== roleRoute.openCodeVariant
        || task.originProfile.subtaskThinkingMode !== meta.routes.employee.thinkingMode || task.originProfile.subtaskOpenCodeVariant !== meta.routes.employee.openCodeVariant)) throw new Error("部门思考力度或 variant 不匹配");
      if (task.subTasks.some((subtask) => !text(subtask.id) || !text(subtask.title) || !["pending", "running", "completed", "skipped", "blocked"].includes(subtask.status))
        || new Set(task.subTasks.map((subtask) => subtask.id)).size !== task.subTasks.length) throw new Error("模块身份、状态无效或重复");
      if (text(task.sessionId)) {
        const key = JSON.stringify([task.workspaceKey, task.cli, task.sessionId]);
        if (sessions.has(key)) throw new Error("部门任务必须使用独立会话"); sessions.add(key);
      }
      if (meta.role === "director") {
        if (meta.rootTaskId !== task.id || meta.parentTaskId !== null || meta.leaderSubtaskId !== null || task.schedulingMode !== "classic") throw new Error("总监根身份无效");
      } else if (meta.role === "leader") {
        const root = records.get(meta.rootTaskId), module = root?.subTasks.find((item) => item.id === meta.leaderSubtaskId);
        if (!root || root.department?.role !== "director" || task.id === root.id || meta.parentTaskId !== root.id || !module
          || module.title !== meta.moduleTitle || root.workspaceKey !== task.workspaceKey || task.schedulingMode !== "event_driven"
          || !equal(root.department.routes, meta.routes) || !equal(root.department.limits, meta.limits)
          || !equal(root.loopPlusAcceptancePlan, task.loopPlusAcceptancePlan)) throw new Error("组长与根模块或统一方案不匹配");
        const key = JSON.stringify([root.id, meta.leaderSubtaskId]);
        if (modules.has(key)) throw new Error("模块已拥有组长任务"); modules.add(key);
        if (!task.loopPlus) throw new Error("组长缺少真实 Loop+ 快照");
        const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
        if ([...snapshot.running, ...snapshot.pending, ...snapshot.reviewQueue, ...(snapshot.currentReview ? [snapshot.currentReview] : [])].some((execution) => !task.subTasks.some((subtask) => subtask.id === execution.subtaskId))) throw new Error("Loop+ 执行与真实子任务不匹配");
      } else throw new Error("员工复用 attempt，禁止独立部门员工任务记录");
    }
  }
  private persisted(id: string, file: string): LoopTaskRecord {
    this.assertCurrent();
    this.assertLocation(id, file);
    const record = this.records.get(id);
    if (!record) { this.faulted = true; throw new Error("部门提交后读取失败"); }
    return clone(record);
  }
  private commit(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): void {
    this.assertCurrent();
    try {
      if (this.ports.commit(clone(updates)) !== true) throw new Error("部门 owner 事务持久化失败");
      const revision = this.ports.readRevision();
      if (!this.ports.isCurrent() || revision === null || !Number.isSafeInteger(revision) || revision <= this.revision) throw new Error("部门事务未发布新的可信代次");
      const records = new Map(this.records);
      for (const [file, expected] of updates) {
        const actual = this.ports.readFile(file);
        const normalized = expected.map((task) => normalizeLoopTaskRecord(task, file));
        if (!actual || !equal(actual, normalized)) throw new Error("部门事务落盘核验失败");
        for (const [id, task] of records) if (task.taskStoreFile === file) records.delete(id);
        for (const task of actual) records.set(task.id, clone(task));
      }
      this.assertLocations(records);
      this.validateAll(records);
      if (!this.ports.isCurrent() || this.ports.readRevision() !== revision) throw new Error("部门事务核验期间来源变化");
      this.records = records;
      this.revision = revision;
    } catch (error) { this.faulted = true; throw error; }
  }
  private mutate<T>(operation: () => T): DepartmentRepositoryResult<T> {
    try {
      this.assertCurrent(); if (this.busy) throw new Error("部门事务重入被拒绝"); this.busy = true;
      try { return { ok: true, value: operation() }; } finally { this.busy = false; }
    } catch (error) { return fail(error); }
  }
}
