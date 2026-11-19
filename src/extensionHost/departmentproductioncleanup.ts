import { departmentLifecycleDiagnostic as diagnostic, departmentCleanupReason, type DepartmentLifecycleReason } from "./departmentlifecyclediagnostics";
import { isDepartmentExecutionCli } from "../department";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { DepartmentExecutionProducerHost } from "./departmentexecutionproducer";
import { DepartmentLeaderExecutionCleanup } from "./departmentleaderexecutioncleanup";
import { leaderExecutionScopeKey } from "./departmentleaderexecutionledger";

type Subscriber = (error?: unknown) => void;
type Observation = { subscribers: Set<Subscriber> };

/** Production-only composition of the original producer and its original socket
 * clients. No disk receipt recovery, synthetic producer, or capacity authority. */
export function createDepartmentProductionCleanup(deps: {
  store: DepartmentRuntimeStore; producer: DepartmentExecutionProducerHost; ownerDirectory: string;
  workspaceKey(): string; readTask(id: string): LoopTaskRecord | null;
}) {
  const observations = new Map<string, Observation>();
  // Telemetry suppression only. Never consulted by receipt/capacity gates.
  const diagnosed = new Set<string>();
  let subscribers = 0;
  function snapshot(taskId: string, generation: number) {
    const phase = deps.producer.observationSnapshot(taskId, generation), task = phase.task, m = task.department;
    if (task.departmentInvalid || m?.role !== "leader" || !isDepartmentExecutionCli(task.cli)
      || m.routes.leader.cli !== task.cli || !isDepartmentExecutionCli(m.routes.employee.cli)
      || task.workspaceKey !== deps.workspaceKey() || task.executionSessionInvalid)
      throw new Error("department-group-cleanup-unsupported-or-stale");
    return phase;
  }
  async function aggregate(taskId: string, generation: number, key: string): Promise<void> {
    let phase = snapshot(taskId, generation);
    const cleanup = new DepartmentLeaderExecutionCleanup(deps.store, deps.ownerDirectory, async () => false,
      (binding) => phase.originalClient(binding), async (bindings) => {
        try {
          phase = snapshot(taskId, generation);
          if (leaderExecutionScopeKey(phase.scope) !== key) return false;
          const task = phase.task, sessions = new Map(task.subTasks.map((s) => [s.id, s.executionSession]));
          return bindings.every((binding: DepartmentExecutionBinding) => {
            const i = binding.identity, s = binding.selection;
            const route = task.department!.routes[i.role];
            const session = i.role === "leader" ? task.executionSession : sessions.get(i.subtaskId!);
            const supportedRole = isDepartmentExecutionCli(i.cli);
            return leaderExecutionScopeKey(i) === key && supportedRole
              && route.cli === s.cli && route.configId === s.configId && (route.model ?? null) === s.model
              && (route.thinkingMode ?? null) === s.thinkingMode && (route.openCodeVariant ?? null) === s.openCodeVariant
              && i.session.state === "bound" && session?.cli === i.cli && session.sessionId === i.session.id && session.configId === s.configId
              && phase.originalClient(binding) !== null;
          });
        } catch { return false; }
      });
    const observed = cleanup.observe(phase.scope);
    if (!observed) throw new Error("department-group-cleanup-set-incomplete");
    await observed.done;
    // Authority check after the aggregator's final cold complete-set comparison.
    if (leaderExecutionScopeKey(snapshot(taskId, generation).scope) !== key)
      throw new Error("department-group-cleanup-scope-changed");
  }
  return {
    /** Counts only; exposes no clients, snapshots or completion injection port. */
    observationState(): { generations: number; subscribers: number } {
      return { generations: observations.size, subscribers };
    },
    observe(task: LoopTaskRecord, generation: number, signal?: AbortSignal): { done: Promise<void> } | null {
      if (signal?.aborted || subscribers >= 128) return null;
      let key: string, rootTaskId: string;
      try { const phase = snapshot(task.id, generation); key = leaderExecutionScopeKey(phase.scope); rootTaskId = phase.scope.rootTaskId; } catch { return null; }
      let observation = observations.get(key);
      if (!observation) {
        if (observations.size >= 128) return null;
        observation = { subscribers: new Set() };
        observations.set(key, observation);
        const diagnose = !diagnosed.has(key);
        if (diagnose) {
          if (diagnosed.size >= 128) diagnosed.delete(diagnosed.values().next().value!);
          diagnosed.add(key);
        }
        const startedAt = Date.now();
        const record = (stage: "producer-close" | "owner-receipts", result: "started" | "confirmed" | "unconfirmed", reason: DepartmentLifecycleReason = "none") => {
          if (diagnose) diagnostic("department-leader-cleanup", { rootTaskId, leaderTaskId: task.id, generation, stage, result, reason, elapsedMs: Date.now() - startedAt });
        };
        const shared = observation;
        const finish = (error?: unknown) => {
          observations.delete(key);
          for (const listener of [...shared.subscribers]) listener(error);
        };
        // close synchronously fences every grant. Exactly one continuation owns
        // this generation's original close/drain, regardless of observer aborts.
        try {
          record("producer-close", "started");
          const closing = deps.producer.close(task.id);
          void closing.then(async (result) => {
            if (!result.ok) {
              record("producer-close", "unconfirmed", departmentCleanupReason(result.error));
              throw new Error(result.error);
            }
            record("producer-close", "confirmed");
            record("owner-receipts", "started");
            try {
              await aggregate(task.id, generation, key);
              record("owner-receipts", "confirmed");
            } catch (error) {
              record("owner-receipts", "unconfirmed", departmentCleanupReason(error));
              throw error;
            }
          }, (error) => { record("producer-close", "unconfirmed", departmentCleanupReason(error)); throw error; })
            .then(() => finish(), (error) => finish(error ?? new Error("department-group-cleanup-observation-failed")));
        } catch (error) { record("producer-close", "unconfirmed", departmentCleanupReason(error)); observations.delete(key); throw error; }
      }
      const shared = observation;
      const done = new Promise<void>((resolve, reject) => {
        const finish: Subscriber = (error) => {
          if (!shared.subscribers.delete(finish)) return;
          subscribers--;
          signal?.removeEventListener("abort", cancel);
          if (error !== undefined) reject(error); else resolve();
        };
        const cancel = () => finish(new Error("department-group-cleanup-cancelled"));
        shared.subscribers.add(finish); subscribers++;
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
      void done.catch(() => undefined);
      return { done };
    },
  };
}
