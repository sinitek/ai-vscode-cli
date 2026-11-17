import { takeDepartmentColdRetirement, type DepartmentColdRetirement } from "./departmentcoldgenerationrecovery";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import * as fs from "fs";
import { departmentGenerationAuthorityDirectory, readDepartmentGenerationAuthority, startDepartmentGenerationAuthority,
  type DepartmentGenerationAuthoritySnapshot } from "../runtime/departmentgenerationauthority";
import { DepartmentGenerationAuthorityClient } from "../runtime/departmentgenerationauthorityclient";
import type { DepartmentGenerationTicket } from "../runtime/departmentgenerationauthority";
import { assertRetiredOpenCodeSession, type DepartmentOpenCodeRetiredSession } from "../runtime/departmentopencodesessionpreparation";
import { sameExecution, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import type { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import { randomUUID } from "crypto";
import { isDepartmentExecutionCli, normalizeDepartmentMetadata } from "../department";
import type { LoopTaskRecord } from "../loopTaskStore";
import { createDepartmentEmployeeExecutionAdmission } from "./departmentemployeeexecutionadmission";
import { DepartmentLeaderExecutionLedger, leaderExecutionScopeKey, leaderExecutionSetFingerprint, type DepartmentLeaderExecutionProducer,
  responsibilityMatchesBinding, type DepartmentExecutionResponsibility, type DepartmentLeaderExecutionScope, type DepartmentLeaderProducerClosure } from "./departmentleaderexecutionledger";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";

type Original = { binding: DepartmentExecutionBinding; client: DepartmentExecutionOwnerClient; directory?: string; stopped?: boolean; stoppedReady?: Promise<void>; confirmStopped?: () => void; rejectStopped?: (error: unknown) => void };
type NativeMove = { source: DepartmentExecutionIdentity; target: DepartmentExecutionIdentity };
type Retired = { scope: DepartmentLeaderExecutionScope; routeSignature: string; localSession: string;
  fingerprint: string; session: NonNullable<LoopTaskRecord["executionSession"]>; originals: Map<string, Omit<Original, "client"> & { client?: DepartmentExecutionOwnerClient }>; moves: Map<string, NativeMove> };
type Generation = {
  scope: DepartmentLeaderExecutionScope; routeSignature: string; localSession: string;
  state: "opening" | "open" | "closing" | "closed";
  pending: Set<Promise<unknown>>; sealNative?: () => Promise<unknown>;
  closing?: Promise<DepartmentLeaderProducerClosure>; closure?: DepartmentLeaderProducerClosure;
  originals: Map<string, Original>;
  tickets: Map<string, { ticket: DepartmentGenerationTicket; responsibility: DepartmentExecutionResponsibility }>;
  previous?: Retired;
  moves?: Map<string, NativeMove>;
  continuationSession?: NonNullable<LoopTaskRecord["executionSession"]>;
  authority?: DepartmentGenerationAuthoritySnapshot;
  authorityProducerProof?: string;
  authorityClose?: () => Promise<void>;
  authorityConfirmDrain?: () => void;
};
export type DepartmentExecutionProducerDeps = {
  store: DepartmentRuntimeStore; workspaceKey(): string;
  readTask(id: string): LoopTaskRecord | null;
  validateRoutes(routes: NonNullable<LoopTaskRecord["department"]>["routes"]): boolean;
  processOverlay: Parameters<typeof createDepartmentEmployeeExecutionAdmission>[2]["processOverlay"];
  authorityDirectory?: string;
  ownerDirectory?: string;
};

/** One host capability for actual, newly created Loop+ coordinator generations.
 * Identity checks survive sealing; canLaunch is the irreversible synchronous
 * admission/grant fence. No durable/open set can be adopted by a new instance. */
export function createDepartmentExecutionProducer(deps: DepartmentExecutionProducerDeps) {
  const generations = new Map<string, Generation>();
  const byTask = new Map<string, Generation>();
  const createdHere = new Set<string>();
  // In-memory provenance issued ONLY after original whole-group cleanup and
  // durable lease removal. A cold reader cannot manufacture this capability.
  const retired = new Map<string, Retired>();
  const producerId = randomUUID();
  // Proofs hold no unresolved execution responsibility: they are issued only
  // after full cleanup and durable capacity return. Look up and discard them by
  // task id at their lifecycle boundary; never scan historical proofs when an
  // unrelated task is created or retired.
  function facts(taskId: string, generation: number, launching: boolean) {
    const task = deps.readTask(taskId), m = normalizeDepartmentMetadata(task?.department);
    if (!task || task.departmentInvalid || m?.role !== "leader" || !m.leaderSubtaskId || m.parentTaskId !== m.rootTaskId
      || task.workspaceKey !== deps.workspaceKey() || task.schedulingMode !== "event_driven" || !task.sessionId
      || !isDepartmentExecutionCli(task.cli) || m.routes.leader.cli !== task.cli
      || !isDepartmentExecutionCli(m.routes.employee.cli)) throw new Error("department-producer-role-or-task-invalid");
    const root = deps.readTask(m.rootTaskId), rm = normalizeDepartmentMetadata(root?.department);
    const modules = root?.subTasks.filter((s) => s.id === m.leaderSubtaskId) ?? [];
    const read = deps.store.read(m.rootTaskId, task.workspaceKey);
    const members = read.ok && read.value?.runtime.leaders.filter((l) => l.taskId === taskId && l.leaderSubtaskId === m.leaderSubtaskId);
    if (!root || root.departmentInvalid || rm?.role !== "director" || root.workspaceKey !== task.workspaceKey
      || rm.rootTaskId !== root.id || modules.length !== 1 || modules[0].title !== m.moduleTitle
      || JSON.stringify(rm.routes) !== JSON.stringify(m.routes) || JSON.stringify(rm.limits) !== JSON.stringify(m.limits)
      || !read.ok || !read.value || !members || members.length !== 1 || members[0].generation !== generation
      || !read.value.capacity.leaders.includes(m.leaderSubtaskId)) throw new Error("department-producer-scope-or-lease-invalid");
    if (launching && (task.status !== "running" || root.status !== "running" || modules[0].status !== "running"
      || members[0].status !== "running" || read.value.runtime.stopping || !deps.validateRoutes(m.routes))) throw new Error("department-producer-authority-revoked");
    const scope = { rootTaskId: root.id, workspace: task.workspaceKey, leaderTaskId: task.id, moduleId: m.leaderSubtaskId, generation };
    const routeSignature = JSON.stringify([m, rm, task.cli, task.originProfile, task.modelRouting]);
    return { task, scope, routeSignature, saved: read.value };
  }
  function matches(g: Generation, launch: boolean): boolean {
    try {
      const f = facts(g.scope.leaderTaskId, g.scope.generation, launch);
      const authority = g.authority && deps.authorityDirectory
        ? readDepartmentGenerationAuthority(departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope)) : null;
      return leaderExecutionScopeKey(f.scope) === leaderExecutionScopeKey(g.scope) && f.routeSignature === g.routeSignature
        && f.task.sessionId === g.localSession && (!g.authority || Boolean(authority
          && authority.snapshot.producerId === producerId && authority.snapshot.claim === g.authority.claim
          && (!launch || authority.snapshot.state === "open")));
    } catch { return false; }
  }
  function current(scope: DepartmentLeaderExecutionScope): Generation | undefined {
    const g = generations.get(leaderExecutionScopeKey(scope));
    if (!g || !matches(g, false)) return undefined;
    if (g.state !== "opening") {
      const saved = deps.store.readLeaderExecutionSet(g.scope);
      if (!saved.ok || !saved.value || saved.value.set.producerId !== producerId) return undefined;
    }
    return g;
  }
  function continuation(taskId: string) {
    if (deps.readTask(taskId)?.status === "completed") retired.delete(taskId);
    const proof = retired.get(taskId), task = deps.readTask(taskId);
    if (!proof || !task || task.executionSessionInvalid || JSON.stringify(task.executionSession) !== JSON.stringify(proof.session)
      || task.sessionId !== proof.localSession) throw new Error("department-producer-continuation-unverified");
    const read = deps.store.read(proof.scope.rootTaskId, proof.scope.workspace);
    const set = read.ok && read.value?.leaderExecutionSets?.find((s) => leaderExecutionScopeKey(s.scope) === leaderExecutionScopeKey(proof.scope));
    const bindings = read.ok && read.value?.executionBindings?.filter((b) => leaderExecutionScopeKey(b.identity) === leaderExecutionScopeKey(proof.scope));
    if (!read.ok || !read.value || !set || !bindings || set.state !== "closed" || !set.closure
      || leaderExecutionSetFingerprint(set, bindings) !== proof.fingerprint
      || read.value.capacity.employees.some((id) => JSON.parse(id)[0] === taskId)) throw new Error("department-producer-continuation-history-changed");
    return { proof, task, saved: read.value };
  }
  const producer: DepartmentLeaderExecutionProducer = {
    producerId,
    requiresGenerationAuthority: Boolean(deps.authorityDirectory),
    beginTracking(scope) { const g = current(scope); return g?.state === "opening"; },
    isCurrent(scope) { return !!current(scope); },
    canLaunch(scope) { const g = current(scope); return !!g && g.state === "open" && matches(g, true); },
    withAdmission<T>(scope: DepartmentLeaderExecutionScope, work: () => Promise<T>): Promise<T> {
      const g = current(scope);
      if (!g || !producer.canLaunch!(scope)) return Promise.reject(new Error("department-producer-admission-sealed"));
      if (g.pending.size >= 256) return Promise.reject(new Error("department-producer-admission-capacity"));
      // Retain the ORIGINAL promise, including cancelled callers' late work.
      const pending = Promise.resolve().then(() => {
        if (!producer.canLaunch!(scope)) throw new Error("department-producer-admission-sealed");
        return work();
      });
      g.pending.add(pending);
      void pending.then(() => g.pending.delete(pending), () => g.pending.delete(pending));
      return pending;
    },
    ...(deps.authorityDirectory ? {
      async registerResponsibility(scope: DepartmentLeaderExecutionScope, responsibility: DepartmentExecutionResponsibility): Promise<void> {
        const g = current(scope);
        if (!g || g.state !== "open" || !g.authority || !g.authorityProducerProof) throw new Error("department-generation-authority-unavailable");
        const old = g.tickets.get(responsibility.registrationId);
        if (old) {
          if (JSON.stringify(old.responsibility) !== JSON.stringify(responsibility) || old.ticket.localSessionId !== g.localSession)
            throw new Error("department-generation-authority-responsibility-conflict");
          return;
        }
        if (g.tickets.size >= 256) throw new Error("department-generation-authority-ticket-capacity");
        const ticket: DepartmentGenerationTicket = { id: randomUUID(), registrationId: responsibility.registrationId,
          target: structuredClone(responsibility.target), selection: structuredClone(responsibility.selection),
          requirements: structuredClone(responsibility.requirements), localSessionId: g.localSession,
          nativeSessionId: null, identity: null, state: "preparing" };
        // Retain locally before the IPC round-trip. If persistence succeeds but
        // its acknowledgement is lost, the exact ticket can still be observed
        // by the original producer's close path and cannot be forgotten.
        g.tickets.set(responsibility.registrationId, { ticket, responsibility: structuredClone(responsibility) });
        await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory!, g.scope),
          g.scope, producerId, g.authorityProducerProof).registerTicket(ticket);
      },
      async bindResponsibility(scope: DepartmentLeaderExecutionScope, registrationId: string, binding: DepartmentExecutionBinding): Promise<void> {
        const g = current(scope), tracked = g?.tickets.get(registrationId);
        if (!g || !tracked || !responsibilityMatchesBinding(g.scope, tracked.responsibility, binding)
          || binding.identity.session.state !== "bound") throw new Error("department-generation-authority-binding-conflict");
        if (tracked.ticket.state === "bound" || tracked.ticket.state === "granted" || tracked.ticket.state === "started") {
          if (JSON.stringify(tracked.ticket.identity) !== JSON.stringify(binding.identity)) throw new Error("department-generation-authority-binding-conflict");
          return;
        }
        const candidate = { ...structuredClone(tracked.ticket), nativeSessionId: binding.identity.session.id };
        await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory!, g.scope),
          g.scope, producerId, g.authorityProducerProof).bindTicket(candidate, binding.identity);
        const original = g.originals.get(binding.identity.executionId);
        if (deps.ownerDirectory && binding.identity.cli === "opencode") {
          if (!original?.directory) throw new Error("department-generation-authority-native-source-unavailable");
          await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory!, g.scope),
            g.scope, producerId, g.authorityProducerProof).registerNativeSource(candidate, original.directory);
        }
        Object.assign(tracked.ticket, candidate);
      },
      async consumeResponsibility(scope: DepartmentLeaderExecutionScope, registrationId: string, binding: DepartmentExecutionBinding): Promise<void> {
        const g = current(scope), tracked = g?.tickets.get(registrationId);
        if (!g || !tracked || !responsibilityMatchesBinding(g.scope, tracked.responsibility, binding)
          || !tracked.ticket.identity || JSON.stringify(tracked.ticket.identity) !== JSON.stringify(binding.identity)
          || !g.authority || !g.authorityProducerProof) throw new Error("department-generation-authority-start-conflict");
        await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory!, g.scope),
          g.scope, producerId, g.authorityProducerProof).consume(tracked.ticket);
      },
    } : {}),
    closeAdmissionsAndDrain(scope) {
      // Cleanup authority is the exact original local lifecycle, not permission
      // for another launch. An unreachable/changed authority must fence launch
      // without discarding this producer's native clients and pending work.
      const g = generations.get(leaderExecutionScopeKey(scope));
      if (!g || leaderExecutionScopeKey(g.scope) !== leaderExecutionScopeKey(scope)) return Promise.reject(new Error("department-producer-not-current"));
      if (g.closing) return g.closing;
      g.state = "closing"; // Irreversible local fence before any asynchronous work.
      const sealAuthority = async () => {
        if (g.authority && deps.authorityDirectory) {
          const directory = departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope);
          const authority = readDepartmentGenerationAuthority(directory);
          if (!authority || authority.snapshot.producerId !== producerId || authority.snapshot.claim !== g.authority.claim)
            throw new Error("department-generation-authority-unavailable");
          const sealed = await new DepartmentGenerationAuthorityClient(directory, g.scope, producerId, g.authorityProducerProof).seal();
          if (sealed.state !== "sealed" || sealed.claim !== g.authority.claim) throw new Error("department-generation-authority-seal-unconfirmed");
        }
      };
      const sealing = sealAuthority();
      let drained: Promise<unknown>;
      try { drained = g.sealNative ? Promise.resolve(g.sealNative()) : Promise.reject(new Error("department-producer-native-owner-unobservable")); }
      catch (error) { drained = Promise.reject(error); }
      g.closing = (async () => {
        // Start original native sealing even if authority IPC/read/persistence
        // fails. Observe all retained preparations before reporting failure.
        // Neither settlement nor timeout can generate closure or release.
        const settled = await Promise.allSettled([sealing, drained, ...g.pending]);
        const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (failed) throw failed.reason;
        if (g.authority && deps.authorityDirectory) {
          const saved = deps.store.readLeaderExecutionSet(g.scope);
          if (!saved.ok || !saved.value || saved.value.set.producerId !== producerId) throw new Error("department-generation-authority-ledger-unreadable");
          const entries = saved.value.set.entries;
          if (entries.length !== g.tickets.size || entries.some(entry => !g.tickets.has(entry.responsibility.registrationId)))
            throw new Error("department-generation-authority-ledger-ticket-set-conflict");
          for (const tracked of g.tickets.values()) {
            const ticket = tracked.ticket;
            const entry = saved.value.set.entries.find(value => value.responsibility.registrationId === ticket.registrationId);
            const binding = entry?.executionId ? saved.value.bindings.find(value => value.identity.executionId === entry.executionId) : undefined;
            const original = binding && g.originals.get(binding.identity.executionId);
            if (ticket.state !== "started" || !entry || !binding || !original || JSON.stringify(original.binding) !== JSON.stringify(binding)
              || !responsibilityMatchesBinding(g.scope, tracked.responsibility, binding)) {
              if (!(["released", "unknown"].includes(ticket.state))) {
                try { await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope),
                  g.scope, producerId, g.authorityProducerProof).markUnknown(ticket); } catch { /* unresolved ticket remains durable */ }
              }
              throw new Error("department-generation-authority-owner-proof-unavailable");
            }
            // Only the exact original Owner client can verify required cleanup.
            await original.client.waitForCleanup(binding.identity, binding.requirements);
            if (deps.ownerDirectory && binding.identity.cli === "opencode") {
              if (!original.stoppedReady) throw new Error("department-generation-authority-native-retirement-unavailable");
              await original.stoppedReady;
            }
            await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope),
              g.scope, producerId, g.authorityProducerProof).release(ticket);
          }
          const latest = await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope),
            g.scope, producerId, g.authorityProducerProof).observe();
          if (!latest.tickets.length || latest.tickets.some(ticket => ticket.state !== "released"))
            throw new Error("department-generation-authority-owner-set-incomplete");
        }
        if (!matches(g, false)) throw new Error("department-producer-closure-identity-changed");
        g.authorityConfirmDrain?.();
        g.state = "closed";
        g.closure = { version: 1, scope: structuredClone(g.scope), producerId, admissionFence: randomUUID() };
        return structuredClone(g.closure);
      })();
      void g.closing.catch(() => undefined); return g.closing;
    },
  };
  const ledger = new DepartmentLeaderExecutionLedger(deps.store, producer);
  const employeeAdmission = createDepartmentEmployeeExecutionAdmission(deps.store, producer, { processOverlay: deps.processOverlay });
  return {
    producer, employeeAdmission,
    acceptColdRetirement(capability: DepartmentColdRetirement): void {
      if (!deps.authorityDirectory) throw new Error("department-cold-retirement-unverified");
      const proof = takeDepartmentColdRetirement(capability, deps.authorityDirectory);
      if (byTask.has(proof.scope.leaderTaskId)) throw new Error("department-cold-retirement-original-host-conflict");
      const read = deps.store.read(proof.scope.rootTaskId, proof.scope.workspace), task = deps.readTask(proof.scope.leaderTaskId);
      const set = read.ok && read.value?.leaderExecutionSets?.find(s => leaderExecutionScopeKey(s.scope) === leaderExecutionScopeKey(proof.scope));
      const bindings = read.ok && read.value?.executionBindings?.filter(b => leaderExecutionScopeKey(b.identity) === leaderExecutionScopeKey(proof.scope));
      if (!read.ok || !read.value || !set || !bindings || set.state !== "closed" || !set.closure
        || leaderExecutionSetFingerprint(set, bindings) !== proof.fingerprint
        || read.value.capacity.leaders.includes(proof.scope.moduleId) || read.value.capacity.employees.some(id => JSON.parse(id)[0] === proof.scope.leaderTaskId)
        || task?.sessionId !== proof.localSession || !task?.executionSession || JSON.stringify(task.executionSession) !== JSON.stringify(proof.session))
        throw new Error("department-cold-retirement-durable-proof-conflict");
      const originals: Retired["originals"] = new Map();
      for (const source of proof.nativeSources) {
        const binding = bindings.find(b => sameExecution(b.identity, source.identity));
        if (!binding || JSON.stringify(binding.selection) !== JSON.stringify(source.selection) || fs.lstatSync(source.directory, { throwIfNoEntry: false }))
          throw new Error("department-cold-retirement-native-source-conflict");
        originals.set(binding.identity.executionId, { binding: structuredClone(binding), directory: source.directory, stopped: true });
      }
      if (bindings.filter(b => b.identity.cli === "opencode").length !== originals.size)
        throw new Error("department-cold-retirement-native-source-incomplete");
      retired.set(proof.scope.leaderTaskId, { ...proof, originals, moves: new Map() });
    },
    /** Invoke only on the return of the sole task repository's CREATE, never
     * on reads/restores/resume. This in-memory provenance is not a task flag. */
    recordNewLeader(task: LoopTaskRecord): void {
      if (task.department?.role !== "leader" || createdHere.size >= 128 || byTask.has(task.id)
        || createdHere.has(task.id) || JSON.stringify(deps.readTask(task.id)) !== JSON.stringify(task)) throw new Error("department-producer-new-task-provenance-invalid");
      createdHere.add(task.id);
    },
    /** Called only by orchestration's NEW-task ownership callback, after the
     * real capacity lease/member is persisted and before scheduler.pump. */
    async openNewLeader(taskId: string, generation: number): Promise<void> {
      if (!createdHere.delete(taskId) || byTask.has(taskId) || generations.size >= 128) throw new Error("department-producer-existing-or-capacity");
      const f = facts(taskId, generation, true);
      if (f.task.executionSession || f.task.executionSessionInvalid || f.task.subTasks.length || f.task.rounds.length
        || f.saved.leaderExecutionSets?.some((s) => s.scope.leaderTaskId === taskId)
        || f.saved.executionBindings?.some((b) => b.identity.leaderTaskId === taskId)) throw new Error("department-producer-existing-generation-observation-only");
      const g: Generation = { scope: f.scope, routeSignature: f.routeSignature, localSession: f.task.sessionId!, state: "opening", pending: new Set(), originals: new Map(), tickets: new Map(),
        };
      generations.set(leaderExecutionScopeKey(f.scope), g); byTask.set(taskId, g);
      try {
        let authority: Awaited<ReturnType<typeof startDepartmentGenerationAuthority>> | undefined;
        if (deps.authorityDirectory) authority = await startDepartmentGenerationAuthority(
          departmentGenerationAuthorityDirectory(deps.authorityDirectory, f.scope), f.scope, producerId, 5_000, deps.ownerDirectory ? { ownerDirectory: deps.ownerDirectory,
            async drain() { const result = await ledger.close(g.scope); if (!result.ok) throw new Error(result.error); } } : undefined);
        if (authority) { g.authority = authority.snapshot; g.authorityProducerProof = authority.producerProof; g.authorityClose = authority.close; g.authorityConfirmDrain = authority.confirmDrain; }
        const opened = ledger.open(f.scope);
        if (!opened.ok) throw new Error(opened.error);
        if (!matches(g, false)) throw new Error("department-producer-open-identity-changed");
        g.state = "open";
      } catch (error) {
        g.state = "closing";
        if (g.authority && deps.authorityDirectory && g.authorityClose) {
          try {
            const directory = departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope);
            await new DepartmentGenerationAuthorityClient(directory, g.scope, producerId, g.authorityProducerProof).seal();
            await g.authorityClose();
            generations.delete(leaderExecutionScopeKey(g.scope)); byTask.delete(taskId);
          } catch { /* An unconfirmed authority remains durable and unavailable. */ }
        }
        throw error;
      }
    },
    /** Same-host successor only; never reopens/adopts an old execution set. */
    canContinueLeader(taskId: string): boolean {
      try {
        const { proof, task, saved } = continuation(taskId);
        return !byTask.has(taskId) && !saved.capacity.leaders.includes(proof.scope.moduleId)
          && task.status !== "running" && deps.validateRoutes(task.department!.routes);
      } catch { return false; }
    },
    async openContinuedLeader(taskId: string, generation: number): Promise<void> {
      const { proof, task, saved } = continuation(taskId);
      if (byTask.has(taskId) || generations.size >= 128 || generation <= proof.scope.generation
        || saved.leaderExecutionSets?.some((s) => s.scope.leaderTaskId === taskId && s.scope.generation !== proof.scope.generation && s.state !== "closed"))
        throw new Error("department-producer-continuation-conflict");
      const f = facts(taskId, generation, true);
      if (f.routeSignature !== proof.routeSignature || f.task.sessionId !== proof.localSession
        || f.scope.moduleId !== proof.scope.moduleId || f.scope.rootTaskId !== proof.scope.rootTaskId
        || f.scope.workspace !== proof.scope.workspace) throw new Error("department-producer-continuation-identity-changed");
      const g: Generation = { scope: f.scope, routeSignature: f.routeSignature, localSession: f.task.sessionId!, state: "opening",
        pending: new Set(), originals: new Map(), tickets: new Map(), previous: proof, moves: new Map(proof.moves), continuationSession: structuredClone(task.executionSession!),
        };
      generations.set(leaderExecutionScopeKey(f.scope), g); byTask.set(taskId, g);
      try {
        let authority: Awaited<ReturnType<typeof startDepartmentGenerationAuthority>> | undefined;
        if (deps.authorityDirectory) authority = await startDepartmentGenerationAuthority(
          departmentGenerationAuthorityDirectory(deps.authorityDirectory, f.scope), f.scope, producerId, 5_000, deps.ownerDirectory ? { ownerDirectory: deps.ownerDirectory,
            async drain() { const result = await ledger.close(g.scope); if (!result.ok) throw new Error(result.error); } } : undefined);
        if (authority) { g.authority = authority.snapshot; g.authorityProducerProof = authority.producerProof; g.authorityClose = authority.close; g.authorityConfirmDrain = authority.confirmDrain; }
        const opened = ledger.open(f.scope);
        if (!opened.ok) throw new Error(opened.error);
        if (!matches(g, false)) throw new Error("department-producer-open-identity-changed");
        retired.delete(taskId); g.state = "open";
      } catch (error) {
        g.state = "closing";
        if (g.authority && deps.authorityDirectory && g.authorityClose) {
          try {
            const directory = departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope);
            await new DepartmentGenerationAuthorityClient(directory, g.scope, producerId, g.authorityProducerProof).seal();
            await g.authorityClose();
            generations.delete(leaderExecutionScopeKey(g.scope)); byTask.delete(taskId);
          } catch { /* An unconfirmed authority remains durable and unavailable. */ }
        }
        throw error;
      }
    },
    continuationSession(taskId: string): NonNullable<LoopTaskRecord["executionSession"]> | null {
      const g = byTask.get(taskId);
      if (!g || !producer.canLaunch!(g.scope)) throw new Error("department-producer-no-live-generation");
      return g.continuationSession ? structuredClone(g.continuationSession) : null;
    },
    scope(taskId: string): DepartmentLeaderExecutionScope {
      const g = byTask.get(taskId);
      if (!g || !producer.canLaunch!(g.scope)) throw new Error("department-producer-no-live-generation");
      return structuredClone(g.scope);
    },
    attachNativeOwner(taskId: string, sealAndDrain: () => Promise<unknown>): void {
      const g = byTask.get(taskId);
      if (!g || g.state !== "open" || g.sealNative) throw new Error("department-producer-native-owner-conflict");
      g.sealNative = sealAndDrain;
    },
    async track<T>(taskId: string, work: () => Promise<T>): Promise<T> {
      return producer.withAdmission(this.scope(taskId), work);
    },
    observationScope(taskId: string, generation: number): DepartmentLeaderExecutionScope {
      const g = byTask.get(taskId);
      if (!g || g.scope.generation !== generation || !current(g.scope)) throw new Error("department-producer-observation-scope-unavailable");
      return structuredClone(g.scope);
    },
    /** Read-only, observation-phase snapshot. Its clients are capabilities from
     * this host, checked against one authoritative set read, never launch grants.
     * Acquire a fresh phase after asynchronous policy/Owner waits. */
    observationSnapshot(taskId: string, generation: number) {
      const g = byTask.get(taskId);
      if (!g || g.scope.generation !== generation) throw new Error("department-producer-observation-scope-unavailable");
      const f = facts(taskId, generation, false);
      if (leaderExecutionScopeKey(f.scope) !== leaderExecutionScopeKey(g.scope) || f.routeSignature !== g.routeSignature
        || f.task.sessionId !== g.localSession) throw new Error("department-producer-observation-scope-unavailable");
      const saved = deps.store.readLeaderExecutionSet(g.scope);
      if (!saved.ok || !saved.value || saved.value.set.producerId !== producerId)
        throw new Error("department-producer-observation-scope-unavailable");
      const clients = new Map<string, { binding: string; client: DepartmentExecutionOwnerClient }>();
      for (const binding of saved.value.bindings) {
        const original = g.originals.get(binding.identity.executionId), key = JSON.stringify(binding);
        if (original && JSON.stringify(original.binding) === key)
          clients.set(binding.identity.executionId, { binding: key, client: original.client });
      }
      return {
        scope: structuredClone(g.scope), task: structuredClone(f.task),
            originalClient(binding: DepartmentExecutionBinding): DepartmentExecutionOwnerClient | null {
          const original = clients.get(binding.identity.executionId);
          return original && original.binding === JSON.stringify(binding) ? original.client : null;
        },
      };
    },
    retainOriginalClient(binding: DepartmentExecutionBinding, client: DepartmentExecutionOwnerClient, directory?: string): void {
      const g = current(binding.identity);
      const saved = g ? deps.store.readLeaderExecutionSet(g.scope) : { ok: false as const, error: "scope-unavailable" };
      if (!g || !saved.ok || !saved.value || !saved.value.bindings.some((b) => JSON.stringify(b) === JSON.stringify(binding)))
        throw new Error("department-producer-original-binding-conflict");
      const old = g.originals.get(binding.identity.executionId);
      if (old && (old.client !== client || JSON.stringify(old.binding) !== JSON.stringify(binding) || directory && old.directory && directory !== old.directory)) throw new Error("department-producer-original-client-conflict");
      if (!old && g.originals.size >= 256) throw new Error("department-producer-original-client-capacity");
      if (directory && (binding.identity.cli !== "opencode" || fs.realpathSync(directory) !== directory))
        throw new Error("department-producer-native-directory-conflict");
      if (!old && deps.authorityDirectory && deps.ownerDirectory) {
        let witnessed: Promise<void> | undefined;
        client.retainCleanupWitness(async (identity, requirements) => {
          const tracked = [...g.tickets.values()].find(t => t.ticket.identity && sameExecution(t.ticket.identity, identity));
          if (!tracked || JSON.stringify(requirements) !== JSON.stringify(tracked.ticket.requirements) || !g.authorityProducerProof)
            throw new Error("department-generation-authority-witness-binding-conflict");
          if (!witnessed) {
            const work = new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory!, g.scope),
              g.scope, producerId, g.authorityProducerProof).witness(tracked.ticket);
            witnessed = work;
            void work.catch(() => { if (witnessed === work) witnessed = undefined; });
          }
          await witnessed;
        });
      }
      let confirmStopped = old?.confirmStopped, rejectStopped = old?.rejectStopped;
      const stoppedReady = old?.stoppedReady ?? (directory ? new Promise<void>((resolve, reject) => { confirmStopped = resolve; rejectStopped = reject; }) : undefined);
      void stoppedReady?.catch(() => undefined);
      g.originals.set(binding.identity.executionId, { binding: structuredClone(binding), client, directory: directory ?? old?.directory,
        stopped: old?.stopped, stoppedReady, confirmStopped, rejectStopped });
    },
    /** Called only after the original private stopped handshake, never on exit. */
    async nativeStopped(binding: DepartmentExecutionBinding): Promise<void> {
      const g = byTask.get(binding.identity.leaderTaskId);
      const original = g?.originals.get(binding.identity.executionId);
      if (!original || JSON.stringify(original.binding) !== JSON.stringify(binding)) throw new Error("department-producer-original-client-conflict");
      try {
        if (g && deps.authorityDirectory && deps.ownerDirectory && binding.identity.cli === "opencode") {
          const ticket = [...g.tickets.values()].find(t => t.ticket.identity && sameExecution(t.ticket.identity, binding.identity))?.ticket;
          if (!ticket || !g.authorityProducerProof) throw new Error("department-generation-authority-native-retirement-unavailable");
          await new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(deps.authorityDirectory, g.scope),
            g.scope, producerId, g.authorityProducerProof).nativeStopped(ticket);
        }
        original.stopped = true; original.confirmStopped?.();
      } catch (error) { original.rejectStopped?.(error); throw error; }
    },
    /** One-use private authority, not a session-string based recovery API. */
    async prepareNativeContinuation(target: DepartmentExecutionIdentity, selection: DepartmentExecutionSelection,
      sourceSubtaskId: string | undefined, assertCurrent: () => void): Promise<{ source: DepartmentOpenCodeRetiredSession; assertCurrent(): void }> {
      const g = current(target);
      if (!g || !producer.canLaunch!(g.scope) || target.session.state !== "bound") throw new Error("department-native-continuation-unavailable");
      const key = target.session.id;
      const predecessor = g.moves?.get(key);
      let reservation: NativeMove | undefined;
      // Only the exact current open target is excluded for implicit self-resume.
      // Any other newer attempt (even one with no native binding) revokes the source.
      const sourceAttempt = () => {
        if (target.role !== "employee") return undefined;
        const snapshot = createLoopPlusScheduler({ snapshot: deps.readTask(target.leaderTaskId)?.loopPlus }).snapshot();
        const active = snapshot.running.filter(v => v.subtaskId === target.subtaskId && v.attemptId === target.attemptId);
        const targetSeen = snapshot.seenAttempts.filter(v => v.subtaskId === target.subtaskId && v.attemptId === target.attemptId);
        if (active.length !== 1 || targetSeen.length !== 1 || targetSeen[0].disposition !== "open")
          throw new Error("department-native-continuation-target-attempt-changed");
        return snapshot.seenAttempts.filter(v => v.subtaskId === sourceSubtaskId
          && !(sourceSubtaskId === target.subtaskId && v.attemptId === target.attemptId)).at(-1);
      };
      const latest = sourceAttempt();
      const sessionOriginals = [...g.originals.values(), ...(g.previous?.originals.values() ?? [])].filter(o => {
        const i = o.binding.identity;
        return i.cli === "opencode" && i.role === target.role && i.session.state === "bound" && i.session.id === key;
      });
      const candidates = sessionOriginals.filter(o => target.role === "leader" || o.binding.identity.role === "employee"
        && o.binding.identity.subtaskId === sourceSubtaskId && o.binding.identity.attemptId === latest?.attemptId);
      if (candidates.length !== 1 || !predecessor && sessionOriginals.length !== 1)
        throw new Error("department-native-continuation-source-ambiguous");
      const original = candidates[0], source = { identity: structuredClone(original.binding.identity),
        selection: structuredClone(original.binding.selection), directory: original.directory! };
      const validate = (checkCaller = true) => {
        if (checkCaller) assertCurrent();
        if (g.moves?.get(key) !== (reservation ?? predecessor)
          || predecessor && !sameExecution(predecessor.target, original.binding.identity))
          throw new Error("department-native-continuation-already-reserved");
        if (!original.stopped || !original.directory || !producer.canLaunch!(g.scope)) throw new Error("department-native-continuation-not-stopped");
        assertRetiredOpenCodeSession(source, target, selection);
        if (source.identity.role === "employee") {
          const task = deps.readTask(target.leaderTaskId);
          const records = task?.subTasks.filter(v => v.id === sourceSubtaskId) ?? [];
          const attempt = sourceAttempt();
          if (source.identity.session.state !== "bound" || records.length !== 1 || records[0].executionSession?.cli !== "opencode"
            || records[0].executionSession.sessionId !== source.identity.session.id
            || records[0].executionSession.configId !== selection.configId
            || attempt?.attemptId !== source.identity.attemptId || attempt?.disposition === "open")
            throw new Error("department-native-continuation-source-attempt-changed");
        }
        const read = deps.store.read(g.scope.rootTaskId, g.scope.workspace);
        if (!read.ok || !read.value || !read.value.executionBindings?.some(b => JSON.stringify(b) === JSON.stringify(original.binding))
          || source.identity.role === "employee" && read.value.capacity.employees.includes(JSON.stringify([target.leaderTaskId, source.identity.attemptId])))
          throw new Error("department-native-continuation-capacity-or-binding-conflict");
        if (source.identity.generation !== target.generation) {
          const proof = g.previous, set = read.value.leaderExecutionSets?.find(s => leaderExecutionScopeKey(s.scope) === leaderExecutionScopeKey(source.identity));
          const bindings = read.value.executionBindings.filter(b => leaderExecutionScopeKey(b.identity) === leaderExecutionScopeKey(source.identity));
          if (!proof || !set || set.state !== "closed" || !set.closure || leaderExecutionSetFingerprint(set, bindings) !== proof.fingerprint)
            throw new Error("department-native-continuation-closed-set-changed");
        }
      };
      validate();
      if (original.client) await original.client.waitForCleanup(original.binding.identity, original.binding.requirements);
      // A cold source has no substitute client: its complete receipt and stopped
      // provenance came only from the original service's single-use retirement.
      else if (!g.previous?.originals.has(original.binding.identity.executionId)) throw new Error("department-native-continuation-original-proof-missing");
      validate();
      g.moves ??= new Map();
      if (!g.moves.has(key) && g.moves.size >= 256) throw new Error("department-native-continuation-capacity");
      // Keep unknown outcomes reserved. Advance only from the prior target's
      // original binding/client after its real cleanup, stopped and lease return.
      reservation = { source: structuredClone(source.identity), target: structuredClone(target) };
      g.moves.set(key, reservation);
      return { source: structuredClone(source), assertCurrent: () => validate(false) };
    },
    originalClient(binding: DepartmentExecutionBinding): DepartmentExecutionOwnerClient | null {
      const g = current(binding.identity), original = g?.originals.get(binding.identity.executionId);
      return original && JSON.stringify(original.binding) === JSON.stringify(binding) ? original.client : null;
    },
    /** Only after durable lease removal and the original capacity release. Unknown
     * groups retain their bounded references. Completed tasks discard provenance;
     * resumable tasks retain it until a successor consumes it (or completion). */
    async retire(taskId: string, generation: number): Promise<void> {
      const g = byTask.get(taskId);
      if (!g || g.scope.generation !== generation || g.state !== "closed") return;
      const read = deps.store.read(g.scope.rootTaskId, g.scope.workspace), task = deps.readTask(taskId);
      const set = read.ok && read.value?.leaderExecutionSets?.find((s) => leaderExecutionScopeKey(s.scope) === leaderExecutionScopeKey(g.scope));
      const bindings = read.ok && read.value?.executionBindings?.filter((b) => leaderExecutionScopeKey(b.identity) === leaderExecutionScopeKey(g.scope));
      const leader = bindings ? bindings.find((b) => b.identity.role === "leader") : undefined;
      if (!read.ok || !read.value || read.value.capacity.leaders.includes(g.scope.moduleId)
        || read.value.capacity.employees.some((id) => JSON.parse(id)[0] === taskId)
        || !set || set.state !== "closed" || !set.closure || !bindings || !set.entries.length
        || set.entries.some((e) => !e.executionId || !g.originals.has(e.executionId))
        || !task?.executionSession || task.executionSessionInvalid || leader?.identity.session.state !== "bound"
        || task.executionSession.sessionId !== leader.identity.session.id || task.executionSession.configId !== leader.selection.configId) return;
      if (g.authorityClose) await g.authorityClose();
      if (task.status === "completed") retired.delete(taskId);
      else retired.set(taskId, { scope: structuredClone(g.scope), routeSignature: g.routeSignature, localSession: g.localSession,
        fingerprint: leaderExecutionSetFingerprint(set, bindings), session: structuredClone(task.executionSession), originals: new Map(g.originals), moves: new Map(g.moves) });
      g.originals.clear(); g.sealNative = undefined;
      generations.delete(leaderExecutionScopeKey(g.scope)); byTask.delete(taskId);
    },
    close(taskId: string): Promise<import("./departmentruntimestore").DepartmentRuntimeWriteResult> {
      const g = byTask.get(taskId);
      if (!g) return Promise.resolve({ ok: false, error: "department-producer-no-live-generation" });
      return ledger.close(g.scope);
    },
    /** EH disposal is a fence, never an abort/release of granted native work. */
    closeAll(): void {
      for (const taskId of byTask.keys()) void this.close(taskId).catch(() => undefined);
    },
  };
}
export type DepartmentExecutionProducerHost = ReturnType<typeof createDepartmentExecutionProducer>;
