import * as path from "path";
import * as fs from "fs";
import { createLoopSubtaskExecutionRoot, type LoopSubtaskExecutionRoot } from "../loopSubtaskExecutionRoot";
import { createHash, randomUUID } from "crypto";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { CodexOwnedStreamHandlers } from "../interactive/codexOwnedExecution";
import { CLEANUP_PARTS, sameExecution, fingerprintDepartmentExecutionSelection, type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import type { CliProcessRuntimeHandlers } from "../cli/cliProcessRuntime";
import type { RunProcess } from "../cli/commandRunner";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import type { DepartmentLeaderProcessBootstrapPort } from "./departmentleaderprocessbootstrap";
import { createDepartmentLeaderProcessBootstrap } from "./departmentleaderprocessbootstrap";
import { DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT, hasDepartmentLeaderSessionOverride, hasDepartmentLeaderDirectoryOverride, departmentLeaderProcessRequirements, type DepartmentLeaderProcessLaunch } from "../runtime/departmentleaderprocesscontract";
import { createDepartmentOpenCodeSession } from "../runtime/departmentopencodesessionpreparation";
import { DepartmentLeaderExecutionLedger, leaderExecutionScopeKey } from "./departmentleaderexecutionledger";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";
import { LEADER_CALLBACKS, type LeaderCodexDescription } from "../runtime/departmentleadercodexcontract";
import { createDepartmentLeaderCodexBootstrap, type DepartmentLeaderCodexPort } from "./departmentleadercodexbootstrap";
import type { DepartmentExecutionProducerHost } from "./departmentexecutionproducer";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import { bindDepartmentExecutionTab, releaseDepartmentExecutionTab, type DepartmentExecutionTabTarget } from "./departmentexecutionresources";

type Leader = { port: DepartmentLeaderCodexPort; selection: DepartmentExecutionSelection; consumers: CodexOwnedStreamHandlers | null; busy: boolean };
type OpenCodeLeader = { port: DepartmentLeaderProcessBootstrapPort; selection: DepartmentExecutionSelection; sessionId: string;
  busy: boolean; handlers: CliProcessRuntimeHandlers | null; invocationIds: Set<string>; activeId: string | null; launchKey: string; cleanupConfirmed: boolean;
  binding: DepartmentExecutionBinding; responsibility: Parameters<DepartmentLeaderExecutionLedger["admit"]>[1];
  authorizeStart?: () => Promise<void> };
export function createDepartmentLeaderCallbackDelegate(producer: Pick<DepartmentExecutionProducerHost, "observationScope">,
  taskId: string, scope: ReturnType<DepartmentExecutionProducerHost["scope"]>, isCurrentLeader: () => boolean,
  currentConsumers: () => CodexOwnedStreamHandlers | null): Record<string, unknown> {
  const delegate: Record<string, unknown> = {};
  for (const name of LEADER_CALLBACKS.filter((n) => n !== "logInfo" && n !== "logError")) {
    delegate[name] = (...args: unknown[]) => {
      if (leaderExecutionScopeKey(producer.observationScope(taskId, scope.generation)) !== leaderExecutionScopeKey(scope)
        || !isCurrentLeader()) throw new Error("department-leader-generation-changed");
      const consumers = currentConsumers();
      if (!consumers) throw new Error("department-leader-consumer-missing");
      const consumer = consumers[name];
      return typeof consumer === "function" ? Reflect.apply(consumer, undefined, args) : null;
    };
  }
  return delegate;
}
export function createDepartmentLeaderProductionHost(deps: {
  producer: DepartmentExecutionProducerHost; store: DepartmentRuntimeStore; ownerDirectory: string;
  readTask(id: string): LoopTaskRecord | null;
  updateTask(id: string, patch: Partial<LoopTaskRecord>): LoopTaskRecord | null;
  logInfo?: (message: string, data?: unknown) => void | Promise<void>;
  logError?: (message: string, data?: unknown) => void | Promise<void>;
}) {
  const leaders = new Map<string, Leader>();
  const openCodeLeaders = new Map<string, OpenCodeLeader>();
  // Retain unsuccessful/unknown preparations. A repeated registration is not
  // permission to create another native session or another Owner.
  const openCodePreparations = new Map<string, string>();
  const openCodeRoots = new Map<string, LoopSubtaskExecutionRoot>();
  // The inherited EH environment is a creation input, not a per-turn selection.
  // VS Code may lazily add host-only variables while the original Owner lives.
  // Keep this snapshot scoped and bounded; explicit launch/overlay changes still
  // go through the unchanged immutable launch comparison below.
  const openCodeEnvironments = new Map<string, { scopeKey: string; value: NodeJS.ProcessEnv }>();
  return {
    captureOpenCodeEnvironment(taskId: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
      const scopeKey = leaderExecutionScopeKey(deps.producer.scope(taskId));
      const existing = openCodeEnvironments.get(taskId);
      if (existing) {
        if (existing.scopeKey !== scopeKey) throw new Error("department-leader-opencode-environment-generation-conflict");
        if (JSON.stringify(existing.value) !== JSON.stringify(inherited)) {
          try { void Promise.resolve(deps.logInfo?.("department-leader-opencode-original-environment-retained",
            { taskId, generation: deps.producer.scope(taskId).generation, inheritedEnvironmentChanged: true })).catch(() => undefined); }
          catch { /* Diagnostics cannot change the immutable launch or its result. */ }
        }
        return { ...existing.value };
      }
      if (openCodeEnvironments.size >= 128) throw new Error("department-leader-owner-capacity");
      const value = { ...inherited }; openCodeEnvironments.set(taskId, { scopeKey, value });
      return { ...value };
    },
    release(taskId: string): void {
      const leader = leaders.get(taskId); if (leader && !leader.busy) { leader.port.disconnect(); leaders.delete(taskId); }
      const openCodeLeader = openCodeLeaders.get(taskId);
      if (openCodeLeader && !openCodeLeader.busy && openCodeLeader.cleanupConfirmed) {
        openCodeLeader.port.disconnect(); openCodeLeaders.delete(taskId);
        openCodePreparations.delete(taskId);
        openCodeRoots.delete(taskId);
        openCodeEnvironments.delete(taskId);
      }
    },
    async run(taskId: string, invocationId: string, prompt: string, handlers: CodexOwnedStreamHandlers,
      expected: { configId: string | null; revision: string },
      build: (selection: DepartmentExecutionSelection) => Promise<LeaderCodexDescription>, signal?: AbortSignal,
      tabTarget?: DepartmentExecutionTabTarget): Promise<void> {
      const scope = deps.producer.scope(taskId), task = deps.readTask(taskId), route = task?.department?.routes.leader;
      if (!route || task?.cli !== "codex" || route.cli !== "codex" || !route.configId || expected.configId !== route.configId
        || !route.thinkingMode || route.openCodeVariant || task.executionSessionInvalid) throw new Error("department-leader-production-route-invalid");
      const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "leader", configId: route.configId,
        revision: expected.revision, model: route.model ?? null, thinkingMode: route.thinkingMode, openCodeVariant: null };
      let leader = leaders.get(taskId);
      if (!leader) {
        const resumedSession = deps.producer.continuationSession(taskId);
        if (leaders.size >= 128 || (task.executionSession && (!resumedSession
          || JSON.stringify(task.executionSession) !== JSON.stringify(resumedSession)))) throw new Error("department-leader-existing-session-observation-only");
        const assertGeneration = () => {
          if (leaderExecutionScopeKey(deps.producer.scope(taskId)) !== leaderExecutionScopeKey(scope)) throw new Error("department-leader-generation-changed");
        };
        const identity = { version: 1 as const, ...scope, role: "leader" as const, cli: "codex" as const,
          ownerId: randomUUID(), executionId: randomUUID(), session: resumedSession ? { state: "bound" as const, id: resumedSession.sessionId } : { state: "unbound" as const }, ...fingerprintDepartmentExecutionSelection(selection) };
        const delegate = { requestUserInputEnabled: handlers.requestUserInputEnabled === true,
          ...createDepartmentLeaderCallbackDelegate(deps.producer, taskId, scope,
            () => leaders.get(taskId) === leader && !!leader, () => leader?.consumers ?? null) };
        const port = createDepartmentLeaderCodexBootstrap(identity, selection, path.join(deps.ownerDirectory, identity.ownerId), {
          tab: bindDepartmentExecutionTab(tabTarget, identity),
          store: deps.store, producer: deps.producer.producer,
          retainOriginalClient: (binding, client) => deps.producer.retainOriginalClient(binding, client),
          assertCurrent: assertGeneration,
          build: async () => {
            assertGeneration();
            const description = await build(structuredClone(selection));
            assertGeneration();
            return resumedSession ? { ...description, runner: { ...description.runner, threadId: resumedSession.sessionId } } : description;
          },
          async persistSession(native) {
            assertGeneration();
            const session = { cli: "codex" as const, sessionId: native.threadId, configId: selection.configId };
            if (resumedSession) {
              if (JSON.stringify(session) !== JSON.stringify(resumedSession)
                || JSON.stringify(deps.readTask(taskId)?.executionSession) !== JSON.stringify(resumedSession)) throw new Error("department-leader-resume-session-conflict");
              return; // Reuse the immutable native thread; never replace its identity.
            }
            if (deps.readTask(taskId)?.executionSession) throw new Error("department-leader-session-already-bound");
            if (!deps.updateTask(taskId, { executionSession: session })) throw new Error("department-leader-session-write-failed");
            const saved = deps.readTask(taskId)?.executionSession;
            if (JSON.stringify(saved) !== JSON.stringify(session)) throw new Error("department-leader-session-readback-failed");
          },
          readSession: () => {
            // Binding/cleanup reads remain valid while this original generation
            // is closing. They cannot read through a replacement Leader object.
            if (leaders.get(taskId) !== leader) throw new Error("department-leader-generation-changed");
            return deps.readTask(taskId)?.executionSession ?? null;
          },
          handlers: delegate as CodexOwnedStreamHandlers, logInfo: deps.logInfo, logError: deps.logError,
        });
        leader = { port, selection, consumers: null, busy: false }; leaders.set(taskId, leader);
        deps.producer.attachNativeOwner(taskId, () => port.closeAdmissionsAndDrain());
      }
      if (leader.busy || JSON.stringify(leader.selection) !== JSON.stringify(selection)) throw new Error("department-leader-busy-or-selection-changed");
      leader.busy = true; leader.consumers = { ...handlers };
      try {
        const launch = await leader.port.invoke({ invocationId, prompt }, signal);
        const terminal = await launch.completion;
        if ([terminal.processTerminal, terminal.turnTerminal, terminal.streams].some((v) => v.status !== "confirmed")) throw new Error("department-leader-native-result-unknown");
      } finally { leader.busy = false; leader.consumers = null; }
    },
    runOpenCode(taskId: string, invocationId: string, prompt: string, handlers: CliProcessRuntimeHandlers,
      expected: { configId: string | null; revision: string }, configurationDirectory: string,
      launch: Omit<DepartmentLeaderProcessLaunch, "sessionId"> & { sessionId?: string | null }, signal?: AbortSignal,
      tabTarget?: DepartmentExecutionTabTarget): RunProcess {
      launch = structuredClone(launch); expected = { ...expected }; handlers = { ...handlers };
      const abort = new AbortController();
      const cancel = () => abort.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      let settled = false;
      let resolveLifecycle!: (value: NonNullable<RunProcess["lifecycle"]> extends Promise<infer T> ? T : never) => void;
      const lifecycle: NonNullable<RunProcess["lifecycle"]> = new Promise((resolve) => { resolveLifecycle = resolve; });
      const report = (terminal: import("../runtime/departmentexecutionowner").ExecutionTerminalEvidence,
        error?: Error): void => {
        if (settled) return;
        settled = true; signal?.removeEventListener("abort", cancel);
        const code = !error && terminal.processTerminal.status === "confirmed" && terminal.turnTerminal.status === "confirmed"
          && terminal.streams.status === "confirmed" ? 0 : 1;
        try {
          if (error) handlers.onError?.(error);
        } catch { /* A consumer exception cannot leave physical evidence pending. */ }
        try { handlers.onExit?.(code); } catch { /* Same settlement rule. */ }
        resolveLifecycle({ processTerminal: terminal.processTerminal, streams: terminal.streams,
          temp: { status: "unobservable", reason: "department-owner-terminal-does-not-expose-resource-receipt" } });
      };
      const execute = async (): Promise<void> => {
        try {
          const scope = deps.producer.scope(taskId), task = deps.readTask(taskId), route = task?.department?.routes.leader;
          if (!task || task.status !== "running" || !route || route.cli !== "opencode" || task.cli !== "opencode"
            || !route.configId || expected.configId !== route.configId || abort.signal.aborted) throw new Error("department-leader-opencode-route-invalid");
          const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: route.configId,
            revision: expected.revision, model: route.model ?? null, thinkingMode: route.thinkingMode ?? null,
            openCodeVariant: route.openCodeVariant ?? null };
          if (!selection.model || (launch.openCodeVariant ?? null) !== selection.openCodeVariant
            || !launch.overlay || launch.overlay.primaryModel !== selection.model) {
            throw new Error("department-leader-opencode-launch-selection-conflict");
          }
          if (hasDepartmentLeaderSessionOverride(launch.baseArgs) || hasDepartmentLeaderDirectoryOverride(launch.baseArgs)) throw new Error("department-leader-opencode-session-argument-conflict");
          const launchKey = createHash("sha256").update(JSON.stringify({ ...launch, processLabel: undefined })).digest("hex");
          let leader = openCodeLeaders.get(taskId);
          if (leader) {
            const conflicts = [leader.busy && "busy", leader.invocationIds.has(invocationId) && "duplicate-invocation",
              JSON.stringify(leader.selection) !== JSON.stringify(selection) && "selection",
              leader.invocationIds.size >= DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT && "invocation-limit",
              leader.launchKey !== launchKey && "launch", !!launch.sessionId && launch.sessionId !== leader.sessionId && "native-session"].filter(Boolean);
            // Only categories, never launch/environment values, hashes or tokens.
            if (conflicts.length) throw new Error("department-leader-opencode-busy-or-conflict:" + conflicts.join(","));
            leader.busy = true; leader.handlers = handlers; leader.activeId = invocationId; leader.invocationIds.add(invocationId);
            try {
              const current = leader;
              const ledger = new DepartmentLeaderExecutionLedger(deps.store, deps.producer.producer);
              const terminal = await ledger.admit(scope, current.responsibility, async (bind, authorizeStart) => {
                const rebound = bind(current.binding);
                if (!rebound.ok) throw new Error(rebound.error);
                current.authorizeStart = () => authorizeStart(current.binding);
                try { return await current.port.invoke({ invocationId, prompt }, abort.signal); }
                finally { current.authorizeStart = undefined; }
              });
              if ([terminal.processTerminal, terminal.turnTerminal, terminal.streams].some((v) => v.status !== "confirmed"))
                throw new Error("department-leader-opencode-terminal-unknown");
              report(terminal);
            } finally { leader.busy = false; leader.handlers = null; leader.activeId = null; }
            return;
          }

          if (leaders.size + openCodePreparations.size >= 128) throw new Error("department-leader-owner-capacity");
          const priorPreparation = openCodePreparations.get(taskId);
          if (priorPreparation) throw new Error("department-leader-opencode-preparation-observation-only");
          const savedPreparation = deps.store.readLeaderExecutionSet(scope);
          if (!savedPreparation.ok || !savedPreparation.value || savedPreparation.value.set.entries.some((entry) => entry.responsibility.target.role === "leader"))
            throw new Error("department-leader-opencode-preparation-observation-only");
          openCodePreparations.set(taskId, leaderExecutionScopeKey(scope));
          const resumedSession = deps.producer.continuationSession(taskId);
          if (deps.readTask(taskId)?.executionSession && (!resumedSession
            || JSON.stringify(deps.readTask(taskId)?.executionSession) !== JSON.stringify(resumedSession))) {
            throw new Error("department-leader-opencode-existing-session-observation-only");
          }
          if (resumedSession && (resumedSession.cli !== "opencode" || resumedSession.configId !== selection.configId
            || !/^ses_[A-Za-z0-9]+$/.test(resumedSession.sessionId))) throw new Error("department-leader-opencode-continuation-conflict");
          if (launch.sessionId && launch.sessionId !== resumedSession?.sessionId) throw new Error("department-leader-opencode-launch-session-conflict");
          const preparation = { ...launch, sessionId: resumedSession?.sessionId ?? "" };
          const requirements = { ...departmentLeaderProcessRequirements({ launch: preparation as DepartmentLeaderProcessLaunch }) };
          const scopeKey = leaderExecutionScopeKey(scope);
          const registrationId = "leader-" + createHash("sha256").update(scopeKey).digest("hex");
          const responsibility = { registrationId, target: { role: "leader" as const }, selection, requirements };
          const ledger = new DepartmentLeaderExecutionLedger(deps.store, deps.producer.producer);
          const ownerId = randomUUID(), executionId = randomUUID();
          const baseIdentity = { version: 1 as const, ...scope, role: "leader" as const, cli: "opencode" as const,
            ownerId, executionId, session: resumedSession ? { state: "bound" as const, id: resumedSession.sessionId }
              : { state: "unbound" as const }, ...fingerprintDepartmentExecutionSelection(selection) };
          let nativeSessionId = resumedSession?.sessionId;
          let binding: DepartmentExecutionBinding | undefined;
          let ownedRoot: LoopSubtaskExecutionRoot | undefined;
          const routeSignature = JSON.stringify(route);
          const assertCurrent = (identity: typeof baseIdentity, requireBinding = true): void => {
            ownedRoot?.assertCurrent();
            const currentScope = deps.producer.scope(taskId), current = deps.readTask(taskId), currentRoute = current?.department?.routes.leader;
            if (leaderExecutionScopeKey(currentScope) !== scopeKey || !current || current.status !== "running"
              || current.cli !== "opencode" || JSON.stringify(currentRoute) !== routeSignature
              || !currentRoute || currentRoute.cli !== "opencode" || currentRoute.configId !== selection.configId
              || identity.rootTaskId !== scope.rootTaskId || identity.workspace !== scope.workspace
              || identity.leaderTaskId !== taskId || identity.moduleId !== scope.moduleId || identity.generation !== scope.generation
              || identity.executionId !== executionId || identity.ownerId !== ownerId
              || identity.configFingerprint !== baseIdentity.configFingerprint || identity.profileFingerprint !== baseIdentity.profileFingerprint
              ) throw new Error("department-leader-opencode-authority-changed");
            if (identity.session.state === "bound") {
              if (!nativeSessionId || identity.session.id !== nativeSessionId || JSON.stringify(current.executionSession)
                !== JSON.stringify({ cli: "opencode", sessionId: nativeSessionId, configId: selection.configId }))
                throw new Error("department-leader-opencode-session-changed");
              if (requireBinding) {
                const read = deps.store.readLeaderExecutionSet(scope);
                const saved = read.ok && read.value?.bindings.find((b) => b.identity.executionId === executionId);
                if (!binding || !saved || JSON.stringify(saved) !== JSON.stringify(binding)) throw new Error("department-leader-opencode-binding-changed");
              }
            }
          };

          let continuation: Awaited<ReturnType<DepartmentExecutionProducerHost["prepareNativeContinuation"]>> | undefined;
          const assertPreparation = () => {
            continuation?.assertCurrent();
            assertCurrent(baseIdentity, false);
            if (abort.signal.aborted) throw new Error("department-leader-opencode-preparation-cancelled");
          };
          const terminal = await ledger.admit(scope, responsibility, async (bind, authorizeStart) => {
            assertPreparation();
            // Ledger admission is durable before even the isolated root/native preparation.
            // The root stays owned by this host closure throughout the generation.
            const createdRoot = createLoopSubtaskExecutionRoot(preparation.cwd);
            ownedRoot = createdRoot; // Fix original assert/dispose before the first canonical lookup.
            openCodeRoots.set(taskId, ownedRoot);
            ownedRoot.cwd = fs.realpathSync(createdRoot.cwd);
            ownedRoot.assertCurrent();
            preparation.cwd = ownedRoot.cwd;
            assertPreparation();
            const preparationArgs = preparation.baseArgs[0] === "run" ? preparation.baseArgs : ["run", ...preparation.baseArgs];
            continuation = resumedSession ? await deps.producer.prepareNativeContinuation(baseIdentity, selection, undefined, assertPreparation) : undefined;
            assertPreparation();
            nativeSessionId = await createDepartmentOpenCodeSession({ workspaceDirectory: preparation.cwd, retired: continuation?.source, assertCurrent: assertPreparation,
              sessionState: nativeSessionId ? "bound" : "unbound", sessionId: nativeSessionId, requireDirectory: true, launch: { command: preparation.command,
                args: preparationArgs, cwd: preparation.cwd,
                baseEnvironment: preparation.baseEnvironment, envOverrides: preparation.envOverrides,
                processLabel: preparation.processLabel, macTaskShell: preparation.macTaskShell }, overlay: preparation.overlay ?? null }, abort.signal);
            assertPreparation();
            if (!resumedSession) {
              const persisted = { cli: "opencode" as const, sessionId: nativeSessionId!, configId: selection.configId };
              if (deps.readTask(taskId)?.executionSession || !deps.updateTask(taskId, { executionSession: persisted })
                || JSON.stringify(deps.readTask(taskId)?.executionSession) !== JSON.stringify(persisted)) throw new Error("department-leader-opencode-session-persistence-failed");
            } else if (JSON.stringify(deps.readTask(taskId)?.executionSession) !== JSON.stringify({ cli: "opencode", sessionId: nativeSessionId, configId: selection.configId })) {
              throw new Error("department-leader-opencode-continuation-readback-conflict");
            }
            assertPreparation();
            if (JSON.stringify(deps.readTask(taskId)?.executionSession)
              !== JSON.stringify({ cli: "opencode", sessionId: nativeSessionId, configId: selection.configId })) {
              throw new Error("department-leader-opencode-session-readback-conflict");
            }
            const finalLaunch: DepartmentLeaderProcessLaunch = { ...preparation, sessionId: nativeSessionId! };
            const boundIdentity = { ...baseIdentity, session: { state: "bound" as const, id: nativeSessionId } };
            binding = { identity: structuredClone(boundIdentity), selection: structuredClone(selection), requirements };
            const result = bind(binding);
            if (!result.ok) throw new Error(result.error);
            const read = deps.store.readLeaderExecutionSet(scope);
            const saved = read.ok && read.value?.bindings.find((b) => b.identity.executionId === executionId);
            const entry = read.ok && read.value?.set.entries.find((e) => e.responsibility.registrationId === registrationId);
            if (!saved || JSON.stringify(saved) !== JSON.stringify(binding) || !entry || entry.executionId !== executionId)
              throw new Error("department-leader-opencode-binding-readback-failed");
            assertCurrent(boundIdentity);
            if (abort.signal.aborted) throw new Error("department-leader-opencode-preparation-cancelled");
            const tab = bindDepartmentExecutionTab(tabTarget, boundIdentity);
            const host = {
              assertCurrent: () => assertCurrent(boundIdentity),
              authorizeStart: () => {
                const current = openCodeLeaders.get(taskId);
                if (current !== created || !current.authorizeStart) return Promise.reject(new Error("department-leader-opencode-admission-ended"));
                return current.authorizeStart();
              },
              onOutput: (_identity: typeof boundIdentity, outputInvocationId: string, stream: "stdout" | "stderr", chunk: string) => {
                const current = openCodeLeaders.get(taskId);
                if (current !== created || !current.busy || !current.handlers || current.activeId !== outputInvocationId
                  || !sameExecution(_identity, boundIdentity)
                  || leaderExecutionScopeKey(deps.producer.observationScope(taskId, scope.generation)) !== scopeKey)
                  throw new Error("department-leader-opencode-output-consumer-unavailable");
                return (stream === "stdout" ? current.handlers.onStdout : current.handlers.onStderr)?.(chunk);
              },
              drainConsumers: (_identity: typeof boundIdentity, outputInvocationId: string) => {
                const current = openCodeLeaders.get(taskId);
                return current === created && current.busy && current.handlers !== null && current.activeId === outputInvocationId
                  && sameExecution(_identity, boundIdentity)
                  && leaderExecutionScopeKey(deps.producer.observationScope(taskId, scope.generation)) === scopeKey;
              },
              async releaseExecutionRoot(_identity: typeof boundIdentity): Promise<CleanupResult> {
                if (!sameExecution(_identity, boundIdentity) || openCodeRoots.get(taskId) !== ownedRoot || !ownedRoot)
                  return { status: "unobservable", reason: "leader-owned-root-identity-conflict" };
                const result = ownedRoot.dispose();
                return result.ok && !result.retainedDirectory
                  ? { status: "confirmed", evidence: "original-host-root-and-links-removed" }
                  : { status: "failed", reason: "leader-owned-root-or-links-retained" };
              },
              async releaseTab(_identity: typeof boundIdentity): Promise<CleanupResult> {
                return releaseDepartmentExecutionTab(tab, _identity);
              },
            };
            const port = createDepartmentLeaderProcessBootstrap({ version: 1, identity: boundIdentity, selection,
              ownerDirectory: path.join(deps.ownerDirectory, ownerId), configurationDirectory,
              launch: finalLaunch, hostExecutionRoot: true }, host);
            const client = new OriginalOpenCodeLeaderClient(path.join(deps.ownerDirectory, ownerId), boundIdentity, requirements, port);
            deps.producer.retainOriginalClient(binding, client, ownedRoot.cwd);
            const created: OpenCodeLeader = { port, selection, sessionId: nativeSessionId, busy: true, handlers,
              invocationIds: new Set([invocationId]), activeId: invocationId, launchKey, cleanupConfirmed: false,
              binding, responsibility, authorizeStart: () => authorizeStart(binding!) };
            openCodeLeaders.set(taskId, created);
            deps.producer.attachNativeOwner(taskId, () => port.closeAdmissionsAndDrain().then(async (cleanup) => {
              await deps.producer.nativeStopped(binding!);
              created.cleanupConfirmed = true;
              return cleanup;
            }));
            // Keep preparation and the actual grant in the same live admission.
            // Each later invocation creates a fresh admission over this binding.
            try { return await port.invoke({ invocationId, prompt }, abort.signal); }
            finally { created.authorizeStart = undefined; created.busy = false; created.handlers = null; created.activeId = null; }
          });
          if ([terminal.processTerminal, terminal.turnTerminal, terminal.streams].some((v) => v.status !== "confirmed"))
            throw new Error("department-leader-opencode-terminal-unknown");
          report(terminal);
        } catch (error) {
          report({ processTerminal: { status: "unobservable", reason: "department-owner-launch-unconfirmed" },
            turnTerminal: { status: "unobservable", reason: "department-owner-launch-unconfirmed" },
            streams: { status: "unobservable", reason: "department-owner-launch-unconfirmed" } },
          error instanceof Error ? error : new Error("department-leader-opencode-run-failed"));
        }
      };
      void execute();
      return { kill() { if (settled || abort.signal.aborted) return false; abort.abort(); return true; }, lifecycle };
    },
  };
}

/** Observe through this exact bootstrap's validated receipt AND stopped gate.
 * A replacement socket client or disk receipt cannot acquire this capability. */
class OriginalOpenCodeLeaderClient extends DepartmentExecutionOwnerClient {
  constructor(directory: string, private readonly identity: DepartmentExecutionIdentity,
    private readonly requirements: CleanupRequirements, private readonly port: DepartmentLeaderProcessBootstrapPort) { super(directory); }
  override retainCleanupWitness(witness: Parameters<DepartmentExecutionOwnerClient["retainCleanupWitness"]>[0]): void {
    this.port.retainCleanupWitness(witness);
  }
  override observeExecution(identity: DepartmentExecutionIdentity) {
    return sameExecution(identity, this.identity) ? this.port.observe()
      : Promise.resolve({ status: "conflict" as const, identity, reason: "original-leader-identity-conflict" });
  }
  override async waitForCleanup(identity: DepartmentExecutionIdentity, requirements: CleanupRequirements, signal?: AbortSignal) {
    if (signal?.aborted || !sameExecution(identity, this.identity)
      || !CLEANUP_PARTS.every((part) => requirements[part] === this.requirements[part])) throw new Error("original-leader-observation-conflict");
    const observed = await this.port.observe();
    if (signal?.aborted || observed.status !== "cleaned" || !sameExecution(observed.identity, this.identity))
      throw new Error("original-leader-cleanup-unconfirmed");
    return structuredClone(observed.receipt);
  }
}
