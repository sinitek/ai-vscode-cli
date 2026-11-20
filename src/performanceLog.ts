import { randomUUID } from "crypto";
import { performance } from "perf_hooks";
import type { CliName } from "./cli/types";
import { writePerformanceLog } from "./logger";

export type PerformanceMode = "vibe" | "loop" | "loop_plus" | "department";
type PerformanceRole = "main" | "subtask" | "director" | "leader" | "employee";
type PerformancePhase = "invocation" | "config-queue" | "runner-dispatch" | "runner" | "main-decision" | "subtask-batch"
  | "main-turn" | "attempt" | "attempt-admission" | "attempt-execution" | "attempt-cleanup"
  | "route-validation" | "organization-start" | "organization-continue" | "organization-stop" | "leader-admission";
type PerformanceOutcome = "returned" | "threw" | "denied" | "completed" | "failed" | "stopped";

export type PerformanceEntry = {
  traceId: string;
  mode: PerformanceMode;
  cli?: CliName;
  role?: PerformanceRole;
  phase: PerformancePhase;
  outcome: PerformanceOutcome;
  durationMs: number;
};

export type PerformanceTrace = ReturnType<typeof createPerformanceTrace>;

export function createPerformanceTrace(mode: PerformanceMode, cli?: CliName, role?: PerformanceRole) {
  const traceId = randomUUID();

  function start(phase: PerformancePhase): (outcome?: PerformanceOutcome) => void {
    const startedAt = performance.now();
    let recorded = false;
    return (outcome = "returned") => {
      if (recorded) return;
      recorded = true;
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      try {
        void writePerformanceLog({ traceId, mode, cli, role, phase, outcome, durationMs }).catch(() => undefined);
      } catch {}
    };
  }

  function measure<Result>(phase: PerformancePhase, operation: () => Promise<Result>,
    outcome?: (value: Result) => PerformanceOutcome): Promise<Result> {
    const finish = start(phase);
    try {
      const result = operation();
      void Promise.resolve(result).then((value) => {
        let settledOutcome: PerformanceOutcome = "returned";
        try { settledOutcome = outcome?.(value) ?? "returned"; }
        catch { settledOutcome = "returned"; }
        finish(settledOutcome);
      }, () => finish("threw")).catch(() => undefined);
      return result;
    } catch (error) {
      finish("threw");
      throw error;
    }
  }

  return { start, measure };
}
