import type { LoopTaskRecord } from "../loopTaskStore";
import type { DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
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
  readSelection(cli: DepartmentExecutionSelection["cli"]): Promise<{ ready: boolean; configId: string | null; revision: string } | null>;
}) {
  const observations = new Map<string, Observation>();
  let subscribers = 0;
  function snapshot(taskId: string, generation: number) {
    const phase = deps.producer.observationSnapshot(taskId, generation), task = phase.task, m = task.department;
    if (task.departmentInvalid || m?.role !== "leader" || !["codex", "opencode"].includes(task.cli)
      || m.routes.leader.cli !== task.cli || !["codex", "opencode"].includes(m.routes.employee.cli ?? "")
      || task.workspaceKey !== deps.workspaceKey() || task.executionSessionInvalid)
      throw new Error("department-group-cleanup-unsupported-or-stale");
    return phase;
  }
  async function aggregate(taskId: string, generation: number, key: string): Promise<void> {
    // One phase snapshot/CLI read for the complete binding batch. The second
    // snapshot is acquired AFTER config awaits and again after the Owner batch.
    let phase = snapshot(taskId, generation);
    const cleanup = new DepartmentLeaderExecutionCleanup(deps.store, deps.ownerDirectory, async () => false,
      (binding) => phase.originalClient(binding), async (bindings) => {
        try {
          phase = snapshot(taskId, generation);
          const selections = new Map<DepartmentExecutionSelection["cli"], Awaited<ReturnType<typeof deps.readSelection>>>();
          for (const cli of new Set(bindings.map((b) => b.selection.cli))) selections.set(cli, await deps.readSelection(cli));
          phase = snapshot(taskId, generation);
          if (leaderExecutionScopeKey(phase.scope) !== key) return false;
          const task = phase.task, sessions = new Map(task.subTasks.map((s) => [s.id, s.executionSession]));
          return bindings.every((binding: DepartmentExecutionBinding) => {
            const i = binding.identity, s = binding.selection, selected = selections.get(s.cli);
            const route = task.department!.routes[i.role];
            const session = i.role === "leader" ? task.executionSession : sessions.get(i.subtaskId!);
            const supportedRole = ["codex", "opencode"].includes(i.cli);
            return leaderExecutionScopeKey(i) === key && supportedRole
              && selected?.ready === true && selected.configId === s.configId && selected.revision === s.revision
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
      let key: string;
      try { key = leaderExecutionScopeKey(snapshot(task.id, generation).scope); } catch { return null; }
      let observation = observations.get(key);
      if (!observation) {
        if (observations.size >= 128) return null;
        observation = { subscribers: new Set() };
        observations.set(key, observation);
        const shared = observation;
        const finish = (error?: unknown) => {
          observations.delete(key);
          for (const listener of [...shared.subscribers]) listener(error);
        };
        // close synchronously fences every grant. Exactly one continuation owns
        // this generation's original close/drain, regardless of observer aborts.
        try {
          const closing = deps.producer.close(task.id);
          void closing.then(async (result) => {
            if (!result.ok) throw new Error(result.error);
            await aggregate(task.id, generation, key);
          }).then(() => finish(), (error) => finish(error ?? new Error("department-group-cleanup-observation-failed")));
        } catch (error) { observations.delete(key); throw error; }
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
