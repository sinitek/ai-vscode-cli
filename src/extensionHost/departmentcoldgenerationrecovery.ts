import type { DepartmentOpenCodeRetiredSession } from "../runtime/departmentopencodesessionpreparation";
import { randomUUID } from "crypto";
import { normalizeDepartmentMetadata, type DepartmentMetadata } from "../department";
import { normalizeLoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import type { LoopTaskRecord } from "../loopTaskStore";
import { DepartmentGenerationAuthorityClient } from "../runtime/departmentgenerationauthorityclient";
import { departmentGenerationAuthorityDirectory, type DepartmentGenerationAuthoritySnapshot } from "../runtime/departmentgenerationauthority";
import { leaderExecutionScopeKey, responsibilityKey, responsibilityMatchesBinding, leaderExecutionSetFingerprint,
  type DepartmentLeaderExecutionScope } from "./departmentleaderexecutionledger";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentLeaderTarget } from "./departmentorchestration";

// A structural object, a disk CLOSED record or a new client cannot mint this capability.
export type DepartmentColdRetirement = Readonly<{ kind: "original-generation-retirement" }>;
type Retirement = { authorityDirectory: string; scope: DepartmentLeaderExecutionScope; fingerprint: string;
  session: NonNullable<LoopTaskRecord["executionSession"]>; localSession: string; routeSignature: string; nativeSources: DepartmentOpenCodeRetiredSession[] };
const retirements = new WeakMap<DepartmentColdRetirement, Retirement>();
export function takeDepartmentColdRetirement(value: DepartmentColdRetirement, authorityDirectory: string): Retirement {
  const proof = retirements.get(value);
  if (!proof || proof.authorityDirectory !== authorityDirectory) throw new Error("department-cold-retirement-unverified");
  retirements.delete(value); return structuredClone(proof);
}

/** Single-use registration only; never native launch or retirement authority. */
export type DepartmentColdRestoredTab = Readonly<{ kind: "verified-cold-restored-tab" }>;
export type DepartmentRestoredTabObject = { id: string; cli: string; sessionId: string | null };
type RestoredTabProof = { tab: DepartmentRestoredTabObject; scope: DepartmentLeaderExecutionScope; localSession: string;
  current(): void; retired(): boolean };
const restoredTabs = new WeakMap<DepartmentColdRestoredTab, RestoredTabProof>();
export function takeDepartmentColdRestoredTab(capability: DepartmentColdRestoredTab): RestoredTabProof {
  const proof = restoredTabs.get(capability);
  if (!proof) throw new Error("department-cold-restored-tab-unverified-or-consumed");
  restoredTabs.delete(capability);
  proof.current();
  return proof;
}

type PreparedTask = Pick<LoopTaskRecord, "id" | "workspaceKey" | "cli" | "sessionId" | "executionSession" | "department">;
type Prepared = { task: PreparedTask; routeSignature: string; nativeSources: DepartmentOpenCodeRetiredSession[]; scope: DepartmentLeaderExecutionScope;
  target: DepartmentLeaderTarget; tabGate: { retired: boolean }; fingerprint: string; client: DepartmentGenerationAuthorityClient; controlId: string; released: boolean; releasing?: Promise<void>; lifecycle: Promise<void>; stopped(): void };
const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
async function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("department-cold-generation-deadline")), Math.max(0, deadline - Date.now()));
  })]); } finally { clearTimeout(timer); }
}
function taskIdentity(task: LoopTaskRecord | null) {
  if (!task) return null;
  const { updatedAt: _, ...value } = task; return value;
}

/** Explicit public-control preparation only. No activation, new task, prompt,
 * native handoff, receipt file or producer-memory adoption occurs here. */
export class DepartmentColdGenerationRecovery {
  private readonly prepared = new Map<string, Prepared>();
  private readonly controls = new Map<string, string>();
  private readonly preparing = new Map<string, Promise<void>>();
  // Uncertain controls are never evicted to admit unrelated generations.
  private readonly maxPendingControls = 64;
  lifecycleState(): { prepared: number; controls: number; preparing: number } {
    return { prepared: this.prepared.size, controls: this.controls.size, preparing: this.preparing.size };
  }
  constructor(private readonly deps: {
    store: DepartmentRuntimeStore; authorityDirectory: string; workspaceKey(): string;
    readTask(id: string): LoopTaskRecord | null;
    verifyStoredIdentity(task: LoopTaskRecord, expected: DepartmentMetadata, generation: number): boolean;
    verifySelection(binding: DepartmentExecutionBinding): Promise<boolean>;
    restoreTarget(task: LoopTaskRecord): (DepartmentLeaderTarget & { restoredTab: DepartmentRestoredTabObject }) | null;
    registerRestoredTarget(capability: DepartmentColdRestoredTab): void;
    acceptRetirement(capability: DepartmentColdRetirement): void;
  }) {}

  private snapshot(task: LoopTaskRecord, scope: DepartmentLeaderExecutionScope) {
    const current = this.deps.readTask(task.id), root = this.deps.readTask(scope.rootTaskId);
    const m = normalizeDepartmentMetadata(current?.department), rm = normalizeDepartmentMetadata(root?.department);
    const saved = this.deps.store.readLeaderExecutionSet(scope);
    if (!current || !root || current.departmentInvalid || root.departmentInvalid || m?.role !== "leader" || rm?.role !== "director"
      || this.deps.workspaceKey() !== scope.workspace || current.workspaceKey !== scope.workspace || root.workspaceKey !== scope.workspace
      || rm.rootTaskId !== root.id || rm.parentTaskId !== null || rm.leaderSubtaskId !== null
      || root.schedulingMode === "event_driven" || current.schedulingMode !== "event_driven" || !current.loopPlus
      || current.cli !== m.routes.leader.cli || current.sessionId === root.sessionId
      || m.rootTaskId !== root.id || m.parentTaskId !== root.id || m.leaderSubtaskId !== scope.moduleId
      || root.subTasks.find(module => module.id === scope.moduleId)?.title !== m.moduleTitle
      || !same(normalizeLoopPlusAcceptancePlanSnapshot(current.loopPlusAcceptancePlan), normalizeLoopPlusAcceptancePlanSnapshot(root.loopPlusAcceptancePlan))
      || current.originProfile?.configId !== m.routes.leader.configId
      || current.originProfile?.mainThinkingMode !== m.routes.leader.thinkingMode
      || current.originProfile?.mainOpenCodeVariant !== m.routes.leader.openCodeVariant
      || current.originProfile?.subtaskThinkingMode !== m.routes.employee.thinkingMode
      || current.originProfile?.subtaskOpenCodeVariant !== m.routes.employee.openCodeVariant
      || ["main", "subtask"].some(role => {
        const actual = current.modelRouting?.[role as "main" | "subtask"], expected = m.routes[role === "main" ? "leader" : "employee"];
        return !actual || ["cli", "configId", "model", "fallback"].some(field => actual[field as keyof typeof actual] !== expected[field as keyof typeof expected]);
      })
      || !same(m.routes, rm.routes) || !same(m.limits, rm.limits)
      || !this.deps.verifyStoredIdentity(clone(current), clone(m), scope.generation)
      || !saved.ok || !saved.value) throw new Error("department-cold-generation-identity-conflict");
    // Use the scheduler's own schema validation before any target restoration.
    createLoopPlusScheduler({ snapshot: current.loopPlus });
    const read = this.deps.store.read(root.id, scope.workspace);
    if (!read.ok || !read.value || !read.value.capacity.leaders.includes(scope.moduleId))
      throw new Error("department-cold-generation-capacity-conflict");
    const { set, bindings } = saved.value;
    if (set.entries.filter(e => !!e.executionId).length !== bindings.length || set.entries.filter(e => e.responsibility.target.role === "leader").length !== 1
      || set.entries.some(entry => !!entry.executionId && !bindings.some(b => b.identity.executionId === entry.executionId
        && responsibilityMatchesBinding(scope, entry.responsibility, b))))
      throw new Error("department-cold-generation-responsibility-incomplete");
    for (const b of bindings) {
      const i = b.identity, s = b.selection, route = m.routes[i.role];
      const session = i.role === "leader" ? current.executionSession : current.subTasks.find(t => t.id === i.subtaskId)?.executionSession;
      if (i.session.state !== "bound" || session?.cli !== i.cli || session.sessionId !== i.session.id || session.configId !== s.configId
        || route.cli !== s.cli || (route.configId ?? null) !== s.configId || (route.model ?? null) !== s.model
        || (route.thinkingMode ?? null) !== s.thinkingMode || (route.openCodeVariant ?? null) !== s.openCodeVariant)
        throw new Error("department-cold-generation-session-or-selection-conflict");
    }
    return { task: current, root, set, bindings, capacity: read.value.capacity };
  }

  private exactTickets(snapshot: DepartmentGenerationAuthoritySnapshot, phase: ReturnType<DepartmentColdGenerationRecovery["snapshot"]>) {
    const { set, bindings } = phase;
    if (snapshot.producerId !== set.producerId || snapshot.tickets.length !== set.entries.length
      || snapshot.tickets.some(t => {
        const entry = set.entries.find(e => e.responsibility.registrationId === t.registrationId);
        const binding = bindings.find(b => b.identity.executionId === entry?.executionId);
        return !entry || responsibilityKey(entry.responsibility) !== responsibilityKey({ registrationId: t.registrationId,
          target: t.target, selection: t.selection, requirements: t.requirements }) || !same(binding?.identity ?? null, t.identity)
          || t.localSessionId !== phase.task.sessionId;
      })) throw new Error("department-cold-generation-authority-set-conflict");
  }

  async prepare(root: LoopTaskRecord, assertCurrent: () => void, timeoutMs = 10_000): Promise<void> {
    assertCurrent();
    const key = JSON.stringify([root.id, root.workspaceKey]);
    let work = this.preparing.get(key);
    if (!work) {
      if (this.preparing.size >= this.maxPendingControls) throw new Error("department-cold-generation-control-capacity");
      work = this.prepareOriginal(root, assertCurrent, timeoutMs);
      this.preparing.set(key, work);
    }
    try { await work; assertCurrent(); }
    finally { if (this.preparing.get(key) === work) this.preparing.delete(key); }
  }
  private async prepareOriginal(root: LoopTaskRecord, assertCurrent: () => void, timeoutMs: number): Promise<void> {
    const saved = this.deps.store.read(root.id, root.workspaceKey);
    if (!saved.ok || !saved.value) throw new Error("department-cold-generation-runtime-unavailable");
    const deadline = Date.now() + timeoutMs;
    const candidates = saved.value.runtime.leaders.filter(m => saved.value!.capacity.leaders.includes(m.leaderSubtaskId));
    const phases = candidates.map(member => {
      const task = this.deps.readTask(member.taskId);
      if (!task) throw new Error("department-cold-generation-member-missing");
      const scope = { rootTaskId: root.id, workspace: root.workspaceKey, leaderTaskId: task.id, moduleId: member.leaderSubtaskId, generation: member.generation ?? 0 };
      const phase = this.snapshot(task, scope);
      return { scope, phase };
    });
    const recheck = () => {
      assertCurrent();
      if (Date.now() >= deadline) throw new Error("department-cold-generation-deadline");
      for (const { phase, scope } of phases) {
        const now = this.snapshot(phase.task, scope);
        if (!same(taskIdentity(now.task), taskIdentity(phase.task)) || !same(taskIdentity(now.root), taskIdentity(phase.root))
          || !same(now.capacity, phase.capacity) || !same(now.set.entries, phase.set.entries) || !same(now.bindings, phase.bindings)
          || now.set.producerId !== phase.set.producerId) throw new Error("department-cold-generation-changed-during-control");
      }
    };
    // All candidate identities/policies are checked before any root can restore capacity.
    for (const { phase } of phases) for (const binding of phase.bindings) {
      if (!await beforeDeadline(this.deps.verifySelection(clone(binding)), deadline)) throw new Error("department-cold-generation-config-conflict");
      recheck();
    }
    const completed: Prepared[] = [];
    for (const { scope, phase } of phases) {
      recheck();
      const directory = departmentGenerationAuthorityDirectory(this.deps.authorityDirectory, scope);
      const client = new DepartmentGenerationAuthorityClient(directory, scope, phase.set.producerId, undefined, deadline);
      this.exactTickets(await client.observe(), phase); recheck();
      const key = leaderExecutionScopeKey(scope);
      const existing = this.prepared.get(phase.task.id);
      if (existing) {
        if (leaderExecutionScopeKey(existing.scope) !== key || !this.inspect(phase.task))
          throw new Error("department-cold-generation-prepared-conflict");
        continue;
      }
      if (!this.controls.has(key) && this.controls.size >= this.maxPendingControls)
        throw new Error("department-cold-generation-control-capacity");
      const id = this.controls.get(key) ?? randomUUID(); this.controls.set(key, id);
      let control = await client.control(id); recheck();
      while (control.state !== "closed") {
        if (control.state === "unknown") throw new Error("department-cold-generation-original-drain-unverifiable");
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
        recheck(); control = await client.recovery(id); recheck();
      }
      const snapshot = await client.observe(); this.exactTickets(snapshot, phase); recheck();
      if (snapshot.state !== "sealed" || snapshot.tickets.some(t => t.state !== "released") || !control.closure)
        throw new Error("department-cold-generation-closure-unverifiable");
      for (const binding of phase.bindings) {
        if (!await beforeDeadline(this.deps.verifySelection(clone(binding)), deadline)) throw new Error("department-cold-generation-config-conflict");
        recheck();
      }
      const latest = this.deps.store.readLeaderExecutionSet(scope);
      if (!latest.ok || !latest.value) throw new Error("department-cold-generation-ledger-unavailable");
      if (latest.value.set.state !== "closed") {
        const closed = this.deps.store.closeLeaderExecutionSet(scope, control.closure);
        if (!closed.ok) throw new Error(closed.error);
      }
      recheck();
      const final = this.deps.store.readLeaderExecutionSet(scope);
      if (!final.ok || !final.value || final.value.set.state !== "closed") throw new Error("department-cold-generation-closure-write-unconfirmed");
      // Only now may the existing trusted session manager associate a real tab.
      const restored = this.deps.restoreTarget(clone(phase.task)); recheck();
      const target = restored && { tabId: restored.tabId, cli: restored.cli, sessionId: restored.sessionId };
      if (!target || !target.tabId || target.cli !== phase.task.cli || target.sessionId !== phase.task.sessionId)
        throw new Error("department-cold-generation-target-unverifiable");
      if (!restored?.restoredTab || restored.restoredTab.id !== target.tabId || restored.restoredTab.cli !== target.cli
        || restored.restoredTab.sessionId !== target.sessionId) throw new Error("department-cold-generation-tab-object-conflict");
      const tabGate = { retired: false };
      const registration: DepartmentColdRestoredTab = Object.freeze({ kind: "verified-cold-restored-tab" });
      restoredTabs.set(registration, { tab: restored.restoredTab, scope: clone(scope), localSession: phase.task.sessionId!,
        current: recheck, retired: () => tabGate.retired });
      try { this.deps.registerRestoredTarget(registration); } finally { restoredTabs.delete(registration); }
      let stopped!: () => void; const lifecycle = new Promise<void>(resolve => { stopped = resolve; });
      const { id: taskId, workspaceKey, cli, sessionId, executionSession, department } = phase.task;
      const m = normalizeDepartmentMetadata(department)!, rm = normalizeDepartmentMetadata(phase.root.department)!;
      completed.push({ lifecycle, stopped, tabGate, task: clone({ id: taskId, workspaceKey, cli, sessionId, executionSession, department }),
        routeSignature: JSON.stringify([m, rm, phase.task.cli, phase.task.originProfile, phase.task.modelRouting]),
        nativeSources: clone(control.nativeSources), scope, target, client: new DepartmentGenerationAuthorityClient(directory, scope, phase.set.producerId), controlId: id, released: false,
        fingerprint: leaderExecutionSetFingerprint(final.value.set, final.value.bindings) });
    }
    recheck();
    for (const prepared of completed) this.prepared.set(prepared.task.id, prepared);
  }

  inspect(task: LoopTaskRecord): { target: DepartmentLeaderTarget; live: { done: Promise<void> } | null } | null {
    const p = this.prepared.get(task.id);
    if (!p || p.released || task.workspaceKey !== p.task.workspaceKey || task.cli !== p.task.cli || task.sessionId !== p.task.sessionId
      || task.departmentInvalid || task.executionSessionInvalid || !same(task.department, p.task.department)
      || !same(task.executionSession, p.task.executionSession)) return null;
    const saved = this.deps.store.readLeaderExecutionSet(p.scope);
    if (!saved.ok || !saved.value || leaderExecutionSetFingerprint(saved.value.set, saved.value.bindings) !== p.fingerprint) return null;
    return { target: clone(p.target), live: { done: p.lifecycle } };
  }
  observation(taskId: string, generation: number): { done: Promise<void> } | null {
    const p = this.prepared.get(taskId);
    return p?.scope.generation === generation && this.deps.readTask(taskId) && this.inspect(this.deps.readTask(taskId)!) ? { done: Promise.resolve() } : null;
  }
  observeAttempt(task: LoopTaskRecord, attempt: { subtaskId: string; attemptId: string }): { done: Promise<void> } | null {
    const p = this.prepared.get(task.id); if (!p || p.released) return null;
    const read = this.deps.store.readLeaderExecutionSet(p.scope);
    if (!read.ok || !read.value || !read.value.bindings.some(b => b.identity.role === "employee"
      && b.identity.subtaskId === attempt.subtaskId && b.identity.attemptId === attempt.attemptId)) return null;
    return this.observation(task.id, p.scope.generation);
  }
  owns(taskId: string): boolean { const p = this.prepared.get(taskId); return !!p && !p.released; }
  async stop(taskId: string): Promise<void> {
    const p = this.prepared.get(taskId);
    if (!p || !this.observation(taskId, p.scope.generation)) throw new Error("department-cold-generation-stop-unverified");
    const state = await p.client.recovery(p.controlId);
    if (state.state !== "closed") throw new Error("department-cold-generation-original-drain-unverifiable");
    p.stopped();
  }
  released(taskId: string, generation: number): Promise<void> {
    const p = this.prepared.get(taskId); if (!p || p.scope.generation !== generation || p.released) return Promise.resolve();
    if (!p.releasing) {
      const work = this.releaseOriginal(p); p.releasing = work;
      void work.catch(() => { if (this.prepared.get(taskId) === p && p.releasing === work) p.releasing = undefined; });
    }
    return p.releasing;
  }
  private async releaseOriginal(p: Prepared): Promise<void> {
    const taskId = p.task.id;
    const saved = this.deps.store.read(p.scope.rootTaskId, p.scope.workspace), task = this.deps.readTask(taskId);
    const set = saved.ok && saved.value?.leaderExecutionSets?.find(s => leaderExecutionScopeKey(s.scope) === leaderExecutionScopeKey(p.scope));
    const bindings = saved.ok && saved.value?.executionBindings?.filter(b => leaderExecutionScopeKey(b.identity) === leaderExecutionScopeKey(p.scope));
    if (!saved.ok || !saved.value || !set || !bindings || leaderExecutionSetFingerprint(set, bindings) !== p.fingerprint
      || saved.value.capacity.leaders.includes(p.scope.moduleId) || saved.value.capacity.employees.some(id => JSON.parse(id)[0] === taskId)
      || !task?.executionSession || task.executionSessionInvalid || task.sessionId !== p.task.sessionId
      || !same(task.executionSession, p.task.executionSession) || !same(task.department, p.task.department))
      throw new Error("department-cold-generation-capacity-removal-unconfirmed");
    if ((await p.client.recovery(p.controlId)).state !== "closed") throw new Error("department-cold-generation-original-authority-lost");
    const cap: DepartmentColdRetirement = Object.freeze({ kind: "original-generation-retirement" });
    retirements.set(cap, { authorityDirectory: this.deps.authorityDirectory, scope: clone(p.scope), fingerprint: p.fingerprint,
      session: clone(task.executionSession), localSession: task.sessionId!, routeSignature: p.routeSignature, nativeSources: clone(p.nativeSources) });
    await p.client.retire(p.controlId);
    this.deps.acceptRetirement(cap); p.tabGate.retired = true; p.released = true;
    // Identity guards protect a later generation from an old asynchronous finalizer.
    if (this.prepared.get(taskId) === p) this.prepared.delete(taskId);
    const key = leaderExecutionScopeKey(p.scope);
    if (this.controls.get(key) === p.controlId) this.controls.delete(key);
  }
}
