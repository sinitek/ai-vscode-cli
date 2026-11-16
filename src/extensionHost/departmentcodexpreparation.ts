import { admitDepartmentEmployeeExecution, type DepartmentEmployeeExecutionAdmission } from "./departmentemployeeexecutionadmission";
import * as path from "path";
import * as fs from "fs";
import { createHash, randomUUID } from "crypto";
import type { LoopTaskRecord } from "../loopTaskStore";
import { normalizeDepartmentMetadata } from "../department";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import { bindLoopSubtaskSession, resolveLoopSubtaskSession } from "../loopSubtaskSession";
import { fingerprintDepartmentExecutionSelection, identifier, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import { startDepartmentCodexOwner } from "./departmentcodexbootstrap";
import type { DepartmentCodexPreparation } from "../runtime/departmentcodexpreparationcontract";
import type { CodexOwnedStreamHandlers } from "../interactive/codexOwnedExecution";
import type { DepartmentProcessInvocationLifetime } from "./departmentprocesspreparation";
import { bindDepartmentExecutionTab, type DepartmentExecutionTabTarget } from "./departmentexecutionresources";

type CodexLifetime = DepartmentProcessInvocationLifetime & { tabTarget?: DepartmentExecutionTabTarget };

export type DepartmentCodexLaunchDescription = Pick<DepartmentCodexPreparation,
  "runner" | "macTaskShell" | "prompt" | "requestUserInputEnabled" | "configurationDirectory" | "workspaceDirectory">;
export type DepartmentCodexPreparationHost = {
  employeeAdmission?: DepartmentEmployeeExecutionAdmission | null;
  retainOriginalClient?(binding: DepartmentExecutionBinding, client: DepartmentExecutionOwnerClient): void;
  store: DepartmentRuntimeStore; ownerDirectory: string; workspaceKey(): string;
  logInfo?: (message: string, data?: unknown) => void | Promise<void>;
  logError?: (message: string, data?: unknown) => void | Promise<void>;
  readTask(id: string): LoopTaskRecord | null;
  updateTask(id: string, patch: Partial<LoopTaskRecord>): LoopTaskRecord | null;
};
/** Sole EH writer coordinator. Admission is per actual adapter attempt; unknown entries
 * remain reserved. Recovered hosts observe a recorded Owner and never replay prompts. */
export function createDepartmentCodexPreparation(host: DepartmentCodexPreparationHost) {
  const entries = new Map<string, Promise<void>>(), admitted = new Set<string>();
  const slots = new Map<string, string>();
  const observations = new Map<string, { done: Promise<void>; resolve(): void; reject(error: unknown): void }>();
  const key = (...parts: string[]) => JSON.stringify(parts);
  const observe = (task: string, attempt: string) => {
    const id = key(task, attempt); let entry = observations.get(id);
    if (!entry) {
      if (observations.size >= 256) throw new Error("department-codex-observation-capacity");
      let resolve!: () => void, reject!: (e: unknown) => void;
      const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void done.catch(() => undefined);
      entry = { done, resolve, reject }; observations.set(id, entry);
    }
    return entry;
  };
  return {
    /** Called only after successful whole-group lease release; unresolved groups
     * retain every original entry and cannot reclaim these bounded slots. */
    releaseTask(taskId: string): void {
      for (const map of [entries, observations, slots]) for (const id of map.keys()) {
        if (JSON.parse(id)[0] === taskId) map.delete(id);
      }
      for (const id of admitted) if (JSON.parse(id)[0] === taskId) admitted.delete(id);
    },
    authorizeAttempt(task: string, subtask: string, attempt: string): void {
      const id = key(task, subtask, attempt);
      if (!admitted.has(id) && admitted.size >= 256) throw new Error("department-codex-admission-capacity");
      admitted.add(id);
    },
    observe(task: string, attempt: string, subtask?: string) {
      const result = observe(task, attempt);
      if (subtask) {
        const id = key(task, subtask);
        if (!slots.has(id) && slots.size >= 256) throw new Error("department-codex-slot-capacity");
        slots.set(id, attempt);
      }
      return { done: result.done };
    },
    rejectUnstarted(task: string, subtask: string): void {
      const attempt = slots.get(key(task, subtask));
      if (attempt && !entries.has(key(task, attempt))) observe(task, attempt).reject(new Error("department-codex-invocation-never-started"));
    },
    run(taskId: string, subtaskId: string, handlers: CodexOwnedStreamHandlers,
      expected: { configId: string | null; revision: string },
      prepare: (selection: DepartmentExecutionSelection, threadId: string | null) => Promise<DepartmentCodexLaunchDescription>,
      lifetime: CodexLifetime = {}): Promise<void> {
      let facts: ReturnType<typeof authority>;
      try { facts = authority(taskId, subtaskId); } catch (error) { return Promise.reject(error); }
      const id = key(taskId, facts.attempt.attemptId), previous = entries.get(id);
      if (previous) return previous;
      if (entries.size >= 256) return Promise.reject(new Error("department-codex-host-capacity"));
      const observed = observe(taskId, facts.attempt.attemptId);
      const fixedFacts = structuredClone(facts), fixedHandlers = { ...handlers }, fixedExpected = structuredClone(expected);
      const fixedLifetime = { signal: lifetime.signal, isAborted: lifetime.isAborted, tabTarget: lifetime.tabTarget };
      const started = Promise.resolve().then(() => start(fixedFacts, fixedHandlers, fixedExpected, prepare, fixedLifetime));
      void started.catch(observed.reject); entries.set(id, started); return started;
    },
  };
  function authority(taskId: string, subtaskId: string) {
    const task = host.readTask(taskId), m = normalizeDepartmentMetadata(task?.department);
    if (!task || task.id !== taskId || task.departmentInvalid || m?.role !== "leader" || !m.leaderSubtaskId || m.parentTaskId !== m.rootTaskId
      || task.workspaceKey !== host.workspaceKey() || task.status !== "running") throw new Error("department-codex-authority-invalid");
    const root = host.readTask(m.rootTaskId), rm = normalizeDepartmentMetadata(root?.department);
    const modules = root?.subTasks.filter((v) => v.id === m.leaderSubtaskId) ?? [];
    if (!root || root.id !== m.rootTaskId || root.departmentInvalid || root.status !== "running" || root.workspaceKey !== task.workspaceKey
      || rm?.role !== "director" || rm.rootTaskId !== root.id || modules.length !== 1 || modules[0].title !== m.moduleTitle || modules[0].status !== "running"
      || JSON.stringify(rm.routes) !== JSON.stringify(m.routes)) throw new Error("department-codex-root-invalid");
    const read = host.store.read(m.rootTaskId, task.workspaceKey);
    if (!read.ok || !read.value || read.value.runtime.stopping) throw new Error("department-codex-runtime-unavailable");
    const members = read.value.runtime.leaders.filter((v) => v.taskId === taskId && v.leaderSubtaskId === m.leaderSubtaskId);
    const attempts = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot().running.filter((v) => v.subtaskId === subtaskId);
    const subtasks = task.subTasks.filter((v) => v.id === subtaskId), member = members[0];
    if (members.length !== 1 || !member.generation || member.status !== "running" || attempts.length !== 1 || subtasks.length !== 1 || subtasks[0].status !== "running"
      || !read.value.capacity.leaders.includes(m.leaderSubtaskId)
      || !read.value.capacity.employees.includes(key(task.id, attempts[0].attemptId))) throw new Error("department-codex-attempt-or-lease-invalid");
    const route = m.routes.employee, recordedSession = subtasks[0].executionSession ?? null;
    const continuation = resolveLoopSubtaskSession(task, subtasks[0], "codex", route.configId);
    const source = task.subTasks.filter((v) => v.id === continuation.sourceSubtaskId);
    if (source.length > 1) throw new Error("department-codex-session-source-ambiguous");
    const sourceSignature = JSON.stringify({ sourceId: continuation.sourceSubtaskId,
      continueFrom: subtasks[0].continueFromSubtaskId ?? null, sourceSession: source[0]?.executionSession ?? null });
    const session = continuation.sessionId
      ? { cli: "codex" as const, configId: route.configId, sessionId: continuation.sessionId } : recordedSession;
    if (recordedSession && session && JSON.stringify([recordedSession.cli, recordedSession.configId, recordedSession.sessionId])
      !== JSON.stringify([session.cli, session.configId, session.sessionId])) throw new Error("department-codex-session-handoff-conflict");
    if (route.cli !== "codex" || !route.configId || !route.thinkingMode || route.openCodeVariant
      || session && (session.cli !== "codex" || session.configId !== route.configId || !identifier(session.sessionId))) throw new Error("department-codex-session-or-route-invalid");
    return { task, m, root, module: modules[0], member, attempt: attempts[0], route, session, recordedSession, sourceSignature, saved: read.value };
  }
  async function start(facts: ReturnType<typeof authority>, handlers: CodexOwnedStreamHandlers, expected: { configId: string | null; revision: string },
    prepare: (selection: DepartmentExecutionSelection, threadId: string | null) => Promise<DepartmentCodexLaunchDescription>, lifetime: CodexLifetime): Promise<void> {
    const { task, m, route, member, attempt } = facts;
    const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "employee", configId: route.configId!, revision: expected.revision,
      model: route.model ?? null, thinkingMode: route.thinkingMode!, openCodeVariant: null };
    if (expected.configId !== selection.configId) throw new Error("department-codex-role-configuration-conflict");
    const old = facts.saved.executionBindings?.filter(({ identity }) => identity.leaderTaskId === task.id && identity.role === "employee"
      && identity.subtaskId === attempt.subtaskId && identity.attemptId === attempt.attemptId) ?? [];
    if (old.length) {
      if (old.length !== 1 || old[0].identity.session.state !== "bound" || old[0].identity.session.id !== facts.session?.sessionId
        || old[0].identity.generation !== member.generation || JSON.stringify(old[0].selection) !== JSON.stringify(selection)) {
        throw new Error("department-codex-existing-binding-conflict");
      }
      const result = await new DepartmentExecutionOwnerClient(path.join(host.ownerDirectory, old[0].identity.ownerId)).observeExecution(old[0].identity);
      throw new Error(`department-codex-existing-binding-observe-only:${result.status}`);
    }
    if (!admitted.has(key(task.id, attempt.subtaskId, attempt.attemptId))) throw new Error("department-codex-no-live-admission");
    const owner = await admitDepartmentEmployeeExecution(host.employeeAdmission, host.store, {
      rootTaskId: m.rootTaskId, workspace: task.workspaceKey, leaderTaskId: task.id, moduleId: m.leaderSubtaskId!, generation: member.generation!,
    }, { subtaskId: attempt.subtaskId, attemptId: attempt.attemptId }, selection, async (admission) => {
      const signatureOf = (v: ReturnType<typeof authority>) => JSON.stringify({ workspace: v.task.workspaceKey, metadata: v.m, rootMetadata: v.root.department,
        leader: { cli: v.task.cli, sessionId: v.task.sessionId, schedulingMode: v.task.schedulingMode }, root: { cli: v.root.cli, sessionId: v.root.sessionId },
        module: { id: v.module.id, title: v.module.title, status: v.module.status },
        member: { taskId: v.member.taskId, module: v.member.leaderSubtaskId, generation: v.member.generation, status: v.member.status }, attempt: v.attempt });
      const signature = signatureOf(facts);
      const sessionKey = (session: typeof facts.session) => session ? JSON.stringify([session.cli, session.sessionId, session.configId]) : "null";
      let expectedSession = facts.recordedSession, binding: DepartmentExecutionBinding | undefined;
      let expectedSourceSignature = facts.sourceSignature;
      const assertCurrent = (): void => {
        admission.assertCurrent();
        if (lifetime.signal?.aborted || lifetime.isAborted?.()) throw new Error("department-codex-caller-cancelled");
        const current = authority(task.id, attempt.subtaskId);
        if (signatureOf(current) !== signature || sessionKey(current.recordedSession) !== sessionKey(expectedSession)
          || current.sourceSignature !== expectedSourceSignature) throw new Error("department-codex-authority-changed");
        const bindings = current.saved.executionBindings?.filter((v) => v.identity.leaderTaskId === task.id && v.identity.role === "employee"
          && v.identity.subtaskId === attempt.subtaskId && v.identity.attemptId === attempt.attemptId) ?? [];
        if (binding ? bindings.length !== 1 || JSON.stringify(bindings[0]) !== JSON.stringify(binding) : bindings.length !== 0) throw new Error("department-codex-binding-changed");
      };
      assertCurrent();
      const prepared = await prepare(structuredClone(selection), facts.session?.sessionId ?? null);
      assertCurrent();
      const identity = { version: 1 as const, workspace: task.workspaceKey, rootTaskId: m.rootTaskId, leaderTaskId: task.id, moduleId: m.leaderSubtaskId!,
        generation: member.generation!, role: "employee" as const, cli: "codex" as const, subtaskId: attempt.subtaskId, attemptId: attempt.attemptId,
        ownerId: randomUUID(), executionId: randomUUID(), session: facts.session ? { state: "bound" as const, id: facts.session.sessionId }
          : { state: "unbound" as const }, ...fingerprintDepartmentExecutionSelection(selection) };
      // A native thread can exist before either binding record. Retain a one-use,
      // identity-only reservation across EH loss so a recovered host cannot create
      // another Owner/thread for that unknown attempt. This is not a receipt.
      const reservationDirectory = path.join(host.ownerDirectory, "codex-preparations");
      fs.mkdirSync(reservationDirectory, { recursive: true, mode: 0o700 });
      const slot = JSON.stringify([identity.workspace, identity.rootTaskId, identity.leaderTaskId, identity.moduleId,
        identity.generation, identity.role, identity.subtaskId, identity.attemptId]);
      const reservation = path.join(reservationDirectory, createHash("sha256").update(slot).digest("hex") + ".json");
      let fd: number;
      try { fd = fs.openSync(reservation, "wx", 0o600); }
      catch { throw new Error("department-codex-preparation-reserved-or-unknown"); }
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, identity, selection })); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); } // Never delete a partial/failed reservation into a retry.
      assertCurrent();
      const tab = bindDepartmentExecutionTab(lifetime.tabTarget, identity);
      const owner = await startDepartmentCodexOwner({ ...prepared, identity, selection, ownerDirectory: path.join(host.ownerDirectory, identity.ownerId) }, {
        handlers, tab, logInfo: host.logInfo, logError: host.logError, signal: lifetime.signal, assertAuthorized: assertCurrent,
        authorizeStart: () => admission.authorizeStart(binding!),
        persist: async (native, requirements) => {
          assertCurrent();
          admission.assertRequirements(requirements);
          const session = { cli: "codex" as const, sessionId: native.threadId, configId: selection.configId };
          const updated = host.updateTask(task.id, { subTasks: bindLoopSubtaskSession(host.readTask(task.id)!.subTasks, attempt.subtaskId, session) });
          expectedSession = session;
          if (!task.subTasks.find((v) => v.id === attempt.subtaskId)?.continueFromSubtaskId) {
            expectedSourceSignature = JSON.stringify({ sourceId: attempt.subtaskId, continueFrom: null, sourceSession: session });
          }
          const reread = host.readTask(task.id)?.subTasks.filter((v) => v.id === attempt.subtaskId) ?? [];
          if (!updated || reread.length !== 1 || sessionKey(reread[0].executionSession ?? null) !== sessionKey(session)) throw new Error("department-codex-session-persistence-failed");
          assertCurrent();
          const next: DepartmentExecutionBinding = { identity: { ...identity, session: { state: "bound", id: native.threadId } }, selection, requirements };
          admission.bind(next);
          binding = next; assertCurrent(); // exact readback, including requirements and selection
        },
      });
      const observed = observe(task.id, attempt.attemptId);
      const client = new DepartmentExecutionOwnerClient(path.join(host.ownerDirectory, identity.ownerId));
      host.retainOriginalClient?.(structuredClone(binding!), client);
      void owner.resourcesReleased.then(() => client.waitForCleanup(owner.identity, binding!.requirements))
        .then(observed.resolve, observed.reject).finally(() => owner.disconnect()).catch(() => undefined);
      return owner;
    });
    await owner.completion;
  }
}
