import { admitDepartmentEmployeeExecution, type DepartmentEmployeeExecutionAdmission } from "./departmentemployeeexecutionadmission";
import * as path from "path";
import * as fs from "fs";
import { createHash, randomUUID } from "crypto";
import type { LoopTaskRecord } from "../loopTaskStore";
import { normalizeDepartmentMetadata } from "../department";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import { bindLoopSubtaskSession, resolveLoopSubtaskSession } from "../loopSubtaskSession";
import { fingerprintDepartmentExecutionSelection, sameExecution, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import type { DepartmentExecutionTabTarget } from "./departmentexecutionresources";
import { bindDepartmentExecutionTab, releaseDepartmentExecutionTab } from "./departmentexecutionresources";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import { DepartmentRuntimeStore } from "./departmentruntimestore";
import { prepareDepartmentProcessOwner } from "./departmentprocessbootstrap";
import type { DepartmentProcessPreparation } from "../runtime/departmentprocesspreparationcontract";
import type { CliProcessRuntimeHandlers, CliProcessRuntimeHandle } from "../cli/cliProcessRuntime";

export type DepartmentProcessInvocationLifetime = {
  signal?: AbortSignal;
  /** Synchronous trusted authority guard, also checked when the private launch grant is issued. */
  isAborted?: () => boolean;
  tabTarget?: DepartmentExecutionTabTarget;
};

export type DepartmentProcessPreparationHost = {
  store: DepartmentRuntimeStore;
  employeeAdmission?: DepartmentEmployeeExecutionAdmission | null;
  ownerDirectory: string;
  workspaceKey(): string;
  readTask(id: string): LoopTaskRecord | null;
  updateTask(id: string, patch: Partial<LoopTaskRecord>): LoopTaskRecord | null;
  prepareNativeContinuation?: import("./departmentexecutionproducer").DepartmentExecutionProducerHost["prepareNativeContinuation"];
  nativeStopped?(binding: DepartmentExecutionBinding): void | Promise<void>;
  retainOriginalClient?(binding: Awaited<ReturnType<typeof prepareDepartmentProcessOwner>>["binding"], client: DepartmentExecutionOwnerClient, directory?: string): void;
  /** Trusted EH builder uses the existing CLI policy; never a model-supplied description. */
  prepareLaunch(selection: DepartmentExecutionSelection, sessionId: string | null): Promise<{
    launch: DepartmentProcessPreparation["launch"]; overlay: DepartmentProcessPreparation["overlay"];
    configurationDirectory: string; workspaceDirectory: string;
  }>;
};

/** First binding coordinator. Only the EH writes task/organization state. Re-entry never creates an alternative Owner. */
export function createDepartmentProcessPreparation(host: DepartmentProcessPreparationHost) {
  const entries = new Map<string, Promise<CliProcessRuntimeHandle>>();
  const admitted = new Map<string, string>();
  const observationSlots = new Map<string, string>();
  const observations = new Map<string, { done: Promise<void>; resolve(): void; reject(error: unknown): void }>();
  const observation = (taskId: string, attemptId: string) => {
    const key = JSON.stringify([taskId, attemptId]);
    let value = observations.get(key);
    if (!value) {
      if (observations.size >= 256) throw new Error("department-process-observation-capacity");
      let resolve!: () => void, reject!: (error: unknown) => void;
      const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      void done.catch(() => undefined);
      value = { done, resolve, reject }; observations.set(key, value);
    }
    return value;
  };
  return {
    authorizeAttempt(taskId: string, subtaskId: string, attemptId: string): void {
      const key = JSON.stringify([taskId, subtaskId]);
      const previous = admitted.get(JSON.stringify([key, attemptId]));
      if (!previous && admitted.size >= 256) throw new Error("department-process-admission-capacity");
      admitted.set(JSON.stringify([key, attemptId]), attemptId);
    },
    observe(taskId: string, attemptId: string, subtaskId?: string): { done: Promise<void> } {
      const observed = observation(taskId, attemptId);
      if (subtaskId) {
        const key = JSON.stringify([taskId, subtaskId]);
        if (!observationSlots.has(key) && observationSlots.size >= 256) throw new Error("department-process-observation-slot-capacity");
        observationSlots.set(key, attemptId);
      }
      return observed;
    },
    rejectUnstarted(taskId: string, subtaskId: string): void {
      const attemptId = observationSlots.get(JSON.stringify([taskId, subtaskId]));
      if (attemptId && !entries.has(JSON.stringify([taskId, attemptId]))) observation(taskId, attemptId).reject(new Error("department-process-invocation-never-started"));
    },
    run(taskId: string, subtaskId: string, handlers: CliProcessRuntimeHandlers, expected: { configId: string | null; revision: string }, prepareLaunch = host.prepareLaunch, lifetime: DepartmentProcessInvocationLifetime = {}): Promise<CliProcessRuntimeHandle> {
      let facts: ReturnType<typeof authority>;
      try { facts = authority(taskId, subtaskId); }
      catch (error) {
        const attemptId = observationSlots.get(JSON.stringify([taskId, subtaskId]));
        if (attemptId) observation(taskId, attemptId).reject(error);
        return Promise.reject(error);
      }
      const key = JSON.stringify([taskId, facts.attempt.attemptId]);
      const existing = entries.get(key); if (existing) return existing;
      if (entries.size >= 256) return Promise.reject(new Error("department-process-host-capacity"));
      const observed = observation(taskId, facts.attempt.attemptId);
      const fixedFacts = structuredClone(facts), fixedExpected = structuredClone(expected), fixedHandlers = { ...handlers };
      const fixedLifetime = { signal: lifetime.signal, isAborted: lifetime.isAborted, tabTarget: lifetime.tabTarget };
      const run = Promise.resolve().then(() => start(fixedFacts, fixedHandlers, fixedExpected, prepareLaunch, fixedLifetime));
      void run.catch(observed.reject);
      entries.set(key, run); return run;
    },
  };

  function authority(taskId: string, subtaskId: string) {
    const task = host.readTask(taskId), m = normalizeDepartmentMetadata(task?.department);
    if (!task || task.id !== taskId || task.departmentInvalid || m?.role !== "leader" || !m.leaderSubtaskId || m.parentTaskId !== m.rootTaskId
      || task.workspaceKey !== host.workspaceKey() || task.status !== "running") throw new Error("department-process-authority-invalid");
    const root = host.readTask(m.rootTaskId), rootMeta = normalizeDepartmentMetadata(root?.department);
    const modules = root?.subTasks.filter((v) => v.id === m.leaderSubtaskId) ?? [];
    if (!root || root.id !== m.rootTaskId || root.departmentInvalid || root.status !== "running" || root.workspaceKey !== task.workspaceKey || rootMeta?.role !== "director"
      || rootMeta.rootTaskId !== root.id || modules.length !== 1 || modules[0].title !== m.moduleTitle || modules[0].status !== "running"
      || JSON.stringify(rootMeta.routes) !== JSON.stringify(m.routes)) throw new Error("department-process-root-invalid");
    const read = host.store.read(m.rootTaskId, task.workspaceKey);
    if (!read.ok || !read.value || read.value.runtime.stopping) throw new Error("department-process-runtime-unavailable");
    const member = read.value.runtime.leaders.find((v) => v.taskId === taskId && v.leaderSubtaskId === m.leaderSubtaskId);
    const attempts = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot().running.filter((v) => v.subtaskId === subtaskId);
    const subtasks = task.subTasks.filter((v) => v.id === subtaskId);
    const subtask = subtasks.length === 1 ? subtasks[0] : undefined;
    if (!member?.generation || member.status !== "running" || attempts.length !== 1 || subtask?.status !== "running"
      || !read.value.capacity.leaders.includes(m.leaderSubtaskId)
      || !read.value.capacity.employees.includes(JSON.stringify([task.id, attempts[0].attemptId]))) throw new Error("department-process-attempt-or-lease-invalid");
    const route = m.routes.employee;
    const resolved = resolveLoopSubtaskSession(task, subtask, route.cli!, route.configId);
    const session = subtask.executionSession ?? (resolved.sessionId ? { cli: "opencode" as const,
      sessionId: resolved.sessionId, configId: route.configId ?? null } : undefined);
    // An absent session is the single first-create case; malformed or conflicting existing sessions never become new.
    if (route.cli !== "opencode" || !route.configId || session && (session.cli !== "opencode" || session.configId !== route.configId
      || !/^ses_[A-Za-z0-9]+$/.test(session.sessionId))) throw new Error("department-process-native-session-unbound");
    return { task, m, root, module: modules[0], member, attempt: attempts[0], session, sourceSubtaskId: resolved.sourceSubtaskId, resolved, route, saved: read.value };
  }
  async function start(facts: ReturnType<typeof authority>, handlers: CliProcessRuntimeHandlers, expected: { configId: string | null; revision: string }, prepareLaunch: DepartmentProcessPreparationHost["prepareLaunch"], lifetime: DepartmentProcessInvocationLifetime): Promise<CliProcessRuntimeHandle> {
    const { task, m, member, attempt, session, route, saved } = facts;
    if (expected.configId !== route.configId) throw new Error("department-process-role-profile-conflict");
    const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "employee", configId: route.configId ?? null,
      revision: expected.revision, model: route.model ?? null, thinkingMode: route.thinkingMode ?? null, openCodeVariant: route.openCodeVariant ?? null };
    const old = saved.executionBindings?.filter(({ identity }) => identity.leaderTaskId === task.id && identity.role === "employee"
      && identity.subtaskId === attempt.subtaskId && identity.attemptId === attempt.attemptId) ?? [];
    if (old.length) {
      if (old.length !== 1 || old[0].identity.session.state !== "bound" || old[0].identity.session.id !== session?.sessionId
        || old[0].identity.generation !== member.generation || JSON.stringify(old[0].selection) !== JSON.stringify(selection)) {
        throw new Error("department-process-existing-binding-conflict");
      }
      // Recovered hosts are observers only. No prompt replay and no private preparation discovery.
      const result = await new DepartmentExecutionOwnerClient(path.join(host.ownerDirectory, old[0].identity.ownerId)).observeExecution(old[0].identity);
      throw new Error(`department-process-existing-binding-observe-only:${result.status}`);
    }
    if (admitted.get(JSON.stringify([JSON.stringify([task.id, attempt.subtaskId]), attempt.attemptId])) !== attempt.attemptId) {
      throw new Error("department-process-no-live-admission");
    }
    return admitDepartmentEmployeeExecution(host.employeeAdmission, host.store, {
      rootTaskId: m.rootTaskId, workspace: task.workspaceKey, leaderTaskId: task.id, moduleId: m.leaderSubtaskId!, generation: member.generation!,
    }, { subtaskId: attempt.subtaskId, attemptId: attempt.attemptId }, selection, async (admission) => {
      // Compare authorization facts, not task timestamps/chat/history changed by our own durable write.
      const signatureOf = (value: ReturnType<typeof authority>) => JSON.stringify({
        workspace: value.task.workspaceKey, metadata: value.m, rootMetadata: value.root.department,
        leader: { cli: value.task.cli, sessionId: value.task.sessionId, schedulingMode: value.task.schedulingMode },
        root: { cli: value.root.cli, sessionId: value.root.sessionId },
        module: { id: value.module.id, title: value.module.title, status: value.module.status },
        member: { taskId: value.member.taskId, module: value.member.leaderSubtaskId, generation: value.member.generation, status: value.member.status },
        attempt: value.attempt, source: {
          // Include self-resume history, but not the target's own session write.
          id: value.sourceSubtaskId,
          records: value.sourceSubtaskId !== value.attempt.subtaskId ? value.task.subTasks.filter(v => v.id === value.sourceSubtaskId) : null,
          attempts: createLoopPlusScheduler({ snapshot: value.task.loopPlus }).snapshot().seenAttempts.filter(v => v.subtaskId === value.sourceSubtaskId
            && !(v.subtaskId === value.attempt.subtaskId && v.attemptId === value.attempt.attemptId)),
        },
      });
      const signature = signatureOf(facts);
      const sessionKey = (value: typeof session) => value ? JSON.stringify([value.cli, value.sessionId, value.configId]) : "null";
      let expectedSession = session;
      let continuation: Awaited<ReturnType<NonNullable<DepartmentProcessPreparationHost["prepareNativeContinuation"]>>> | undefined;
      let binding: Awaited<ReturnType<typeof prepareDepartmentProcessOwner>>["binding"] | undefined;
      let tab: ReturnType<typeof bindDepartmentExecutionTab>;
      const assertCurrent = (): void => {
        admission.assertCurrent();
        continuation?.assertCurrent();
        if (lifetime.signal?.aborted || lifetime.isAborted?.()) throw new Error("department-process-caller-cancelled");
        const current = authority(task.id, attempt.subtaskId);
        if (signatureOf(current) !== signature || sessionKey(current.session) !== sessionKey(expectedSession)) throw new Error("department-process-authority-changed");
        const matches = current.saved.executionBindings?.filter(({ identity }) => identity.leaderTaskId === task.id
          && identity.role === "employee" && identity.subtaskId === attempt.subtaskId && identity.attemptId === attempt.attemptId) ?? [];
        if (binding ? matches.length !== 1 || !sameExecution(matches[0].identity, binding.identity)
          || JSON.stringify(matches[0]) !== JSON.stringify(binding) : matches.length !== 0) throw new Error("department-process-binding-changed");
      };
      assertCurrent();
      const prepared = await prepareLaunch(structuredClone(selection), session?.sessionId ?? null);
      assertCurrent();
      admission.assertProcessOverlay(prepared.overlay !== null);
      const identity = { version: 1 as const, workspace: task.workspaceKey, rootTaskId: m.rootTaskId, leaderTaskId: task.id,
        moduleId: m.leaderSubtaskId!, generation: member.generation!, role: "employee" as const, cli: "opencode" as const,
        subtaskId: attempt.subtaskId, attemptId: attempt.attemptId, ownerId: randomUUID(), executionId: randomUUID(),
        session: session ? { state: "bound" as const, id: session.sessionId } : { state: "unbound" as const }, ...fingerprintDepartmentExecutionSelection(selection) };
      // Identity-only reservation survives loss before binding. Never replace an unknown native preparation.
      const reservations = path.join(host.ownerDirectory, "opencode-preparations");
      fs.mkdirSync(reservations, { recursive: true, mode: 0o700 });
      const slot = JSON.stringify([identity.workspace, identity.rootTaskId, identity.leaderTaskId, identity.moduleId,
        identity.generation, identity.role, identity.subtaskId, identity.attemptId]);
      const reservation = path.join(reservations, createHash("sha256").update(slot).digest("hex") + ".json");
      let fd: number;
      try { fd = fs.openSync(reservation, "wx", 0o600); }
      catch { throw new Error("department-process-preparation-reserved-or-unknown"); }
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, identity, selection })); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); } // Keep partial/failed reservations and Ledger responsibility.
      assertCurrent();
      continuation = session ? await host.prepareNativeContinuation?.(identity, selection, facts.sourceSubtaskId ?? undefined, assertCurrent) : undefined;
      assertCurrent();
      const owner = await prepareDepartmentProcessOwner({ ...prepared, identity, selection, ...(continuation ? { retired: continuation.source } : {}),
        ownerDirectory: path.join(host.ownerDirectory, identity.ownerId) }, lifetime.signal, async (nativeId) => {
        assertCurrent();
        const nativeRecord = fs.openSync(reservation + ".native.json", "wx", 0o600);
        try { fs.writeFileSync(nativeRecord, JSON.stringify({ version: 1, identity: { ...identity, session: { state: "bound", id: nativeId } }, selection })); fs.fsyncSync(nativeRecord); }
        finally { fs.closeSync(nativeRecord); }
        assertCurrent();
        const finalized = await prepareLaunch(structuredClone(selection), nativeId);
        assertCurrent();
        // Only argv is rebuilt by the existing strategy; all other trusted snapshots remain fixed.
        const withoutArgs = (value: typeof prepared) => ({ ...value, launch: { ...value.launch, args: [] } });
        if (JSON.stringify(withoutArgs(finalized)) !== JSON.stringify(withoutArgs(prepared))) throw new Error("department-process-preparation-snapshot-changed");
        admission.assertProcessOverlay(finalized.overlay !== null);
        return finalized.launch;
      }, async (boundIdentity) => releaseDepartmentExecutionTab(tab, boundIdentity), assertCurrent);
      try {
        assertCurrent();
        admission.assertRequirements(owner.binding.requirements);
        const nativeSession = owner.binding.identity.session;
        if (nativeSession.state !== "bound") throw new Error("department-process-native-session-unbound");
        const boundSession = { cli: "opencode" as const, sessionId: nativeSession.id, configId: selection.configId };
        const updated = host.updateTask(task.id, { subTasks: bindLoopSubtaskSession(host.readTask(task.id)!.subTasks, attempt.subtaskId, boundSession) });
        expectedSession = boundSession;
        const stored = host.readTask(task.id)?.subTasks.find((v) => v.id === attempt.subtaskId)?.executionSession;
        if (!updated || sessionKey(stored) !== sessionKey(boundSession)) throw new Error("department-process-session-persistence-failed");
        assertCurrent();
        admission.bind(owner.binding);
        binding = owner.binding;
        assertCurrent();
        // Fix the original tab capability before output adoption changes its
        // visible session. Cleanup reuses this capability; it cannot bind late.
        tab = bindDepartmentExecutionTab(lifetime.tabTarget, owner.binding.identity);
        assertCurrent();
        const client = new DepartmentExecutionOwnerClient(path.join(host.ownerDirectory, identity.ownerId));
        host.retainOriginalClient?.(owner.binding, client, owner.nativeDirectory);
        await owner.commit();
        assertCurrent();
        const handle = await owner.start(handlers, assertCurrent, () => admission.authorizeStart(owner.binding));
        const observed = observation(task.id, attempt.attemptId);
        // Owner owns its root and tab requirements; no EH cleanup is awaited by this receipt.
        void client.waitForCleanup(owner.binding.identity, owner.binding.requirements)
          .then(() => owner.close()).then(async () => { await host.nativeStopped?.(owner.binding); observed.resolve(); }).catch(observed.reject);
        return handle;
      } catch (error) { owner.abandon(); throw error; }
    });
  }
}

/** Synchronous stream facade used by the EH while trusted preparation is still asynchronous.
 * kill requests prelaunch cancellation only; it never claims termination of an admitted Owner. */
export function startDepartmentProcessInvocation(
  service: Pick<ReturnType<typeof createDepartmentProcessPreparation>, "run">,
  taskId: string, subtaskId: string, handlers: CliProcessRuntimeHandlers,
  expected: { configId: string | null; revision: string },
  prepareLaunch: DepartmentProcessPreparationHost["prepareLaunch"], lifetime: DepartmentProcessInvocationLifetime = {},
): CliProcessRuntimeHandle {
  const preparing = new AbortController();
  const cancel = () => preparing.abort();
  lifetime.signal?.addEventListener("abort", cancel, { once: true });
  if (lifetime.signal?.aborted) cancel();
  let pending = true, businessSettled = false;
  const callbacks: CliProcessRuntimeHandlers = {
    onStdout: (chunk) => { if (!businessSettled) handlers.onStdout?.(chunk); },
    onStderr: (chunk) => { if (!businessSettled) handlers.onStderr?.(chunk); },
    onExit: (code) => { if (!businessSettled) { businessSettled = true; handlers.onExit?.(code); } },
    onError: (error) => { if (!businessSettled) { businessSettled = true; handlers.onError?.(error); } },
  };
  let resolve!: (facts: Awaited<NonNullable<CliProcessRuntimeHandle["lifecycle"]>>) => void;
  const lifecycle: NonNullable<CliProcessRuntimeHandle["lifecycle"]> = new Promise((yes) => { resolve = yes; });
  const finish = () => { pending = false; lifetime.signal?.removeEventListener("abort", cancel); };
  void service.run(taskId, subtaskId, callbacks, expected, prepareLaunch,
    { signal: preparing.signal, isAborted: lifetime.isAborted, tabTarget: lifetime.tabTarget }).then((handle) => {
    finish();
    if (handle.lifecycle) void handle.lifecycle.then(resolve);
  }, (error: unknown) => {
    finish();
    resolve({ processTerminal: { status: "unobservable", reason: "owner-launch-unconfirmed" },
      streams: { status: "unobservable", reason: "owner-launch-unconfirmed" }, temp: { status: "unobservable", reason: "owner-launch-unconfirmed" } });
    callbacks.onError?.(error instanceof Error ? error : new Error("department-process-launch-unconfirmed"));
  });
  return { kill: () => { if (!pending || preparing.signal.aborted) return false; preparing.abort(); return true; }, lifecycle };
}
