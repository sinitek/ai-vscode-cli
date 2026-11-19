import { randomUUID } from "crypto";
import * as path from "path";
import { isDepartmentExecutionCli } from "../department";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import { bindLoopSubtaskSession } from "../loopSubtaskSession";
import type { LoopTaskRecord } from "../loopTaskStore";
import { DepartmentExecutionOwnerServer, type ExecutionTerminalEvidence } from "../runtime/departmentexecutionowner";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { fingerprintDepartmentExecutionSelection, type CleanupRequirements, type DepartmentExecutionIdentity,
  type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import { DepartmentLeaderExecutionLedger, leaderExecutionScopeKey } from "./departmentleaderexecutionledger";
import type { DepartmentExecutionProducerHost } from "./departmentexecutionproducer";
import { departmentCleanupErrorCode } from "./departmentlifecyclediagnostics";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { PromptRunExecutionOptions } from "./promptExecutionShared";

/** These transports already have Loop/Loop+ interactive runners. Their Owner
 * observes those original runners; it never implements a second CLI protocol. */
export function usesDepartmentInteractiveRuntime(cli: unknown): boolean {
  return isDepartmentExecutionCli(cli) && cli !== "codex" && cli !== "opencode";
}

type Capture = NonNullable<PromptRunExecutionOptions["departmentInteractiveRunner"]>;
type Observation = { done: Promise<void>; resolve(): void; reject(error: unknown): void };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
const requirements: CleanupRequirements = { processTerminal: false, turnTerminal: true, streams: true,
  runner: true, executionRoot: false, links: false, temp: false, tab: false };
const confirmed = (evidence: string) => ({ status: "confirmed" as const, evidence });
const absent = { status: "not-applicable" as const, reason: "owned-by-loop-runtime" };
const diagnosticId = (value: string | undefined): string | undefined => value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
type Entry = {
  binding?: DepartmentExecutionBinding; localSessionId: string; selection: DepartmentExecutionSelection; server: DepartmentExecutionOwnerServer; client: DepartmentExecutionOwnerClient;
  terminal: ReturnType<typeof deferred<ExecutionTerminalEvidence>>;
  registered: ReturnType<typeof deferred<void>>; native: ReturnType<typeof deferred<string>>;
  ready: Promise<void>; pending: Set<Promise<void>>; runners: Map<object, { release: () => Promise<void>; work?: Promise<void> }>;
  invocations: Set<string>; cancel?: () => void; sealed: boolean; closing?: Promise<void>;
};
type Invocation = {
  taskId: string; role: "leader" | "employee"; invocationId: string; sessionId: string | null;
  initializeLocalSession?: () => string | null;
  subtaskId?: string; attemptId?: string; expected: { configId: string | null; revision: string };
  grokExecutionRootId?: string;
  cancel(): void; execute(capture: Capture): Promise<void>;
};

export function createDepartmentInteractiveRuntime(deps: {
  producer: DepartmentExecutionProducerHost; store: DepartmentRuntimeStore; ownerDirectory: string;
  readTask(id: string): LoopTaskRecord | null;
  updateTask(id: string, patch: Partial<LoopTaskRecord>): LoopTaskRecord | null;
  log?(event: string, payload: Record<string, unknown>): void;
}) {
  const ledger = new DepartmentLeaderExecutionLedger(deps.store, deps.producer.producer);
  const entries = new Map<string, Entry>();
  const observations = new Map<string, Observation>();
  const authorized = new Set<string>();
  const key = (...parts: string[]) => JSON.stringify(parts);
  function observe(taskId: string, attemptId: string): Observation {
    const id = key(taskId, attemptId);
    let value = observations.get(id);
    if (!value) {
      if (observations.size >= 256) throw new Error("department-interactive-observation-capacity");
      const done = deferred<void>();
      value = { done: done.promise, resolve: () => done.resolve(), reject: done.reject };
      observations.set(id, value);
    }
    return value;
  }
  function facts(input: Invocation) {
    const task = deps.readTask(input.taskId), scope = deps.producer.scope(input.taskId);
    const route = task?.department?.routes[input.role];
    if (!task || task.departmentInvalid || task.executionSessionInvalid || !route || !usesDepartmentInteractiveRuntime(route.cli)
      || input.role === "leader" && task.cli !== route.cli || !route.configId || input.expected.configId !== route.configId)
      throw new Error("department-interactive-route-or-session-invalid");
    const saved = deps.store.read(scope.rootTaskId, scope.workspace);
    if (!saved.ok || !saved.value) throw new Error("department-interactive-runtime-unavailable");
    if (input.role === "employee") {
      const attempt = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot().running
        .filter(value => value.subtaskId === input.subtaskId && value.attemptId === input.attemptId);
      const subtasks = task.subTasks.filter(value => value.id === input.subtaskId && value.status === "running");
      if (!input.subtaskId || !input.attemptId || attempt.length !== 1 || subtasks.length !== 1
        || !authorized.has(key(task.id, input.subtaskId, input.attemptId))
        || !saved.value.capacity.employees.includes(key(task.id, input.attemptId)))
        throw new Error("department-interactive-attempt-or-lease-invalid");
    }
    const selection: DepartmentExecutionSelection = { version: 1, cli: route.cli!, role: input.role,
      configId: route.configId, revision: input.expected.revision, model: route.model ?? null,
      thinkingMode: route.thinkingMode ?? null, openCodeVariant: route.openCodeVariant ?? null };
    return { task, scope, selection };
  }
  function releaseRunner(resource: { release: () => Promise<void>; work?: Promise<void> }): Promise<void> {
    resource.work ??= Promise.resolve().then(resource.release);
    void resource.work.catch(() => undefined);
    return resource.work;
  }
  async function close(entry: Entry): Promise<void> {
    if (entry.closing) return entry.closing;
    entry.sealed = true;
    entry.native.reject(new Error("department-interactive-preparation-sealed"));
    entry.cancel?.();
    entry.closing = (async () => {
      for (const resource of entry.runners.values()) releaseRunner(resource);
      await Promise.allSettled([...entry.pending]);
      // A runner captured during cancellation is also retained and drained.
      const released = await Promise.allSettled([...entry.runners.values()].map(releaseRunner));
      const failed = released.find((value): value is PromiseRejectedResult => value.status === "rejected");
      entry.terminal.resolve({ processTerminal: absent, turnTerminal: confirmed("original-loop-turns-drained"),
        streams: failed ? { status: "failed", reason: "original-interactive-drain-failed" } : confirmed("original-interactive-streams-drained") });
      try {
        await entry.ready;
        if (!entry.binding) throw new Error("department-interactive-owner-unbound");
        await entry.client.waitForCleanup(entry.binding.identity, entry.binding.requirements);
      } catch (error) { throw failed?.reason ?? error; }
      finally { await entry.server.close(); }
    })();
    void entry.closing.catch(entry.terminal.reject);
    return entry.closing;
  }
  function create(input: Invocation, current: ReturnType<typeof facts>, localSessionId: string): Entry {
    const { scope, selection, task } = current;
    const identity: DepartmentExecutionIdentity = { version: 1, ...scope, cli: selection.cli,
      ...(input.role === "leader" ? { role: "leader" as const } : { role: "employee" as const,
        subtaskId: input.subtaskId!, attemptId: input.attemptId! }),
      ownerId: randomUUID(), executionId: randomUUID(), session: { state: "unbound" },
      ...fingerprintDepartmentExecutionSelection(selection) };
    const terminal = deferred<ExecutionTerminalEvidence>();
    const directory = path.join(deps.ownerDirectory, identity.ownerId);
    let entry!: Entry;
    const server = new DepartmentExecutionOwnerServer({ directory, ownerId: identity.ownerId, launcher: {
      requirements: () => ({ ...requirements }),
      seal: () => { void close(entry).catch(() => undefined); },
      async launch() {
        return { kind: "turn", completion: terminal.promise, cleanup: async () => ({
          runner: confirmed("original-interactive-runners-released"), executionRoot: absent, links: absent, temp: absent, tab: absent,
        }) };
      },
    } });
    entry = { localSessionId, selection, registered: deferred<void>(), native: deferred<string>(), server, client: new DepartmentExecutionOwnerClient(directory), terminal,
      ready: Promise.resolve(), pending: new Set(), runners: new Map(), invocations: new Set(), sealed: false };
    // Retain the original sealer before the first asynchronous preparation.
    if (input.role === "leader") deps.producer.attachNativeOwner(task.id, () => close(entry));
    entry.ready = ledger.admit(scope, { registrationId: input.role === "leader" ? "interactive-leader" : `interactive-${input.attemptId}`,
      target: input.role === "leader" ? { role: "leader" } : { role: "employee", subtaskId: input.subtaskId!, attemptId: input.attemptId! },
      selection, requirements: { ...requirements } }, async (bind, authorizeStart) => {
      // Responsibility is durable before the original runner may initialize.
      entry.registered.resolve();
      const nativeId = await entry.native.promise;
      const latest = facts(input);
      if (entry.sealed || leaderExecutionScopeKey(latest.scope) !== leaderExecutionScopeKey(scope)) throw new Error("department-interactive-preparation-sealed");
      const session = {
        cli: selection.cli, sessionId: nativeId, configId: selection.configId,
        ...(input.role === "employee" && selection.cli === "grok" && input.grokExecutionRootId
          ? { grokExecutionRootId: input.grokExecutionRootId } : {}),
      };
      const old = input.role === "leader" ? latest.task.executionSession
        : latest.task.subTasks.find(value => value.id === input.subtaskId)?.executionSession;
      if (old && JSON.stringify(old) !== JSON.stringify(session)) throw new Error("department-interactive-session-conflict");
      const updated = deps.updateTask(task.id, input.role === "leader" ? { executionSession: session }
        : { subTasks: bindLoopSubtaskSession(latest.task.subTasks, input.subtaskId!, session) });
      const reread = deps.readTask(task.id);
      const persisted = input.role === "leader" ? reread?.executionSession
        : reread?.subTasks.find(value => value.id === input.subtaskId)?.executionSession;
      if (!updated || JSON.stringify(persisted) !== JSON.stringify(session)) throw new Error("department-interactive-session-write-failed");
      const binding: DepartmentExecutionBinding = { identity: { ...identity, session: { state: "bound", id: nativeId } },
        selection, requirements: { ...requirements } };
      entry.binding = binding;
      const bound = bind(binding);
      if (!bound.ok) throw new Error(bound.error);
      deps.producer.retainOriginalClient(binding, entry.client);
      await authorizeStart(binding);
      if (entry.sealed) throw new Error("department-interactive-preparation-sealed");
      await server.listen();
      const started = await entry.client.startExecution(binding.identity);
      if (started.status !== "live") throw new Error("department-interactive-owner-start-failed");
    });
    void entry.ready.catch(error => { entry.registered.reject(error); terminal.reject(error); });
    return entry;
  }
  return {
    authorizeAttempt(task: string, subtask: string, attempt: string): void {
      if (authorized.size >= 256 && !authorized.has(key(task, subtask, attempt))) throw new Error("department-interactive-admission-capacity");
      authorized.add(key(task, subtask, attempt));
    },
    observe(task: string, attempt: string) {
      return { done: observe(task, attempt).done };
    },
    rejectUnstarted(task: string, attempt: string, error?: unknown): void {
      if (!entries.has(key(task, "employee", attempt))) {
        observations.get(key(task, attempt))?.reject(error ?? new Error("department-interactive-invocation-never-started"));
      }
    },
    async run(input: Invocation): Promise<void> {
      const observed = input.role === "employee" && input.attemptId ? observe(input.taskId, input.attemptId) : null;
      const startedAt = Date.now();
      let stage = "admission";
      const diagnose = (result: "started" | "confirmed" | "unconfirmed", error?: unknown): void => {
        try {
          const task = deps.readTask(input.taskId);
          const errorCode = error === undefined ? undefined : departmentCleanupErrorCode(error);
          deps.log?.("department-interactive-invocation", {
            ...(diagnosticId(task?.department?.rootTaskId) ? { rootTaskId: diagnosticId(task?.department?.rootTaskId) } : {}),
            ...(diagnosticId(input.taskId) ? { leaderTaskId: diagnosticId(input.taskId) } : {}),
            ...(diagnosticId(input.subtaskId) ? { subtaskId: diagnosticId(input.subtaskId) } : {}),
            ...(diagnosticId(input.attemptId) ? { attemptId: diagnosticId(input.attemptId) } : {}),
            stage, result, elapsedMs: Math.max(0, Date.now() - startedAt),
            ...(errorCode ? { errorCode } : {}),
          });
        } catch { /* Diagnostics cannot change execution authority or cleanup. */ }
      };
      diagnose("started");
      try {
        stage = "admission";
        const current = facts(input), id = key(input.taskId, input.role, input.role === "leader" ? String(current.scope.generation) : input.attemptId!);
        let entry = entries.get(id);
        stage = "local-session";
        const localSessionId = input.sessionId ?? (input.role === "employee" && !entry ? input.initializeLocalSession?.() : null);
        if (!localSessionId) throw new Error("department-interactive-local-session-unavailable");
        stage = "owner-preparation";
        if (!entry) {
          if (entries.size >= 256) throw new Error("department-interactive-owner-capacity");
          entry = create(input, current, localSessionId); entries.set(id, entry);
        }
        if (entry.sealed || entry.pending.size || entry.invocations.has(input.invocationId)
          || JSON.stringify(entry.selection) !== JSON.stringify(current.selection)
          || entry.localSessionId !== localSessionId)
          throw new Error("department-interactive-invocation-conflict");
        entry.invocations.add(input.invocationId); entry.cancel = input.cancel;
        const original = entry;
        const work = (async () => {
          await original.registered.promise;
          stage = "runner";
          facts(input);
          if (original.sealed) throw new Error("department-interactive-invocation-sealed");
          await input.execute((runner, release) => {
            let resource = original.runners.get(runner);
            if (!resource) { resource = { release }; original.runners.set(runner, resource); }
            if (original.sealed) {
              releaseRunner(resource);
              throw new Error("department-interactive-runner-sealed");
            }
            return async nativeSessionId => {
              stage = "native-session";
              const bound = original.binding?.identity.session;
              if (original.sealed || bound?.state === "bound" && bound.id !== nativeSessionId)
                throw new Error("department-interactive-native-session-conflict");
              original.native.resolve(nativeSessionId);
              stage = "owner-authorization";
              await original.ready;
              if (original.sealed) throw new Error("department-interactive-invocation-sealed");
            };
          });
        })();
        original.pending.add(work);
        try { await work; }
        catch (error) { original.native.reject(error); throw error; }
        finally {
          original.pending.delete(work); original.cancel = undefined;
          original.native.reject(new Error("department-interactive-session-not-prepared"));
          if (input.role === "employee" || !original.binding) {
            stage = "owner-cleanup";
            await close(original);
          }
        }
        observed?.resolve();
        diagnose("confirmed");
      } catch (error) { diagnose("unconfirmed", error); observed?.reject(error); throw error; }
    },
    /** Called only after the original complete group was cleaned and released. */
    releaseTask(taskId: string): void {
      for (const map of [entries, observations]) for (const id of map.keys()) if (JSON.parse(id)[0] === taskId) map.delete(id);
      for (const id of authorized) if (JSON.parse(id)[0] === taskId) authorized.delete(id);
    },
  };
}
