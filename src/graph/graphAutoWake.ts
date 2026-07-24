import type { GraphNodeRecord, GraphRunRecord } from "./types";

export const GRAPH_AUTO_WAKE_RETRY_DELAY_MS = 30 * 1000;
export const GRAPH_AUTO_WAKE_MAX_TIMER_DELAY_MS = 2_147_000_000;

export type GraphAutoWakeAttemptResult = "started" | "retry" | "discard";

type GraphAutoWakeTimerHandle = ReturnType<typeof setTimeout>;

type GraphAutoWakeSchedulerDeps = {
  readRun: (graphRunId: string) => GraphRunRecord | null;
  onWake: (graphRunId: string) => GraphAutoWakeAttemptResult | Promise<GraphAutoWakeAttemptResult>;
  onError?: (graphRunId: string, error: unknown) => void;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => GraphAutoWakeTimerHandle;
  clearTimeout?: (handle: GraphAutoWakeTimerHandle) => void;
  retryDelayMs?: number;
  maxTimerDelayMs?: number;
};

export function resolveGraphRunAutoWakeAt(run: GraphRunRecord | null | undefined): number | null {
  if (!run || run.status !== "sleeping") {
    return null;
  }
  const wakeTimes = run.nodes
    .map(resolveGraphNodeWakeAt)
    .filter((wakeAt): wakeAt is number => wakeAt !== null)
    .sort((left, right) => left - right);
  return wakeTimes[0] ?? null;
}

export function isGraphAutoWakeRunScheduled(run: GraphRunRecord | null | undefined): run is GraphRunRecord {
  const wakeAt = resolveGraphRunAutoWakeAt(run);
  return typeof wakeAt === "number" && Number.isFinite(wakeAt) && wakeAt > 0;
}

export class GraphAutoWakeScheduler {
  private readonly timers = new Map<string, GraphAutoWakeTimerHandle>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => GraphAutoWakeTimerHandle;
  private readonly clearTimer: (handle: GraphAutoWakeTimerHandle) => void;
  private readonly retryDelayMs: number;
  private readonly maxTimerDelayMs: number;
  private disposed = false;

  public constructor(private readonly deps: GraphAutoWakeSchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle));
    this.retryDelayMs = normalizePositiveDelay(deps.retryDelayMs, GRAPH_AUTO_WAKE_RETRY_DELAY_MS);
    this.maxTimerDelayMs = normalizePositiveDelay(deps.maxTimerDelayMs, GRAPH_AUTO_WAKE_MAX_TIMER_DELAY_MS);
  }

  public restore(runs: readonly GraphRunRecord[]): void {
    this.cancelAll();
    runs.forEach((run) => this.schedule(run));
  }

  public schedule(run: GraphRunRecord): void {
    this.cancel(run.id);
    if (this.disposed || !isGraphAutoWakeRunScheduled(run)) {
      return;
    }
    this.arm(run.id, resolveGraphRunAutoWakeAt(run) as number);
  }

  public cancel(graphRunId: string): void {
    const handle = this.timers.get(graphRunId);
    if (handle !== undefined) {
      this.clearTimer(handle);
      this.timers.delete(graphRunId);
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelAll();
  }

  private cancelAll(): void {
    this.timers.forEach((handle) => this.clearTimer(handle));
    this.timers.clear();
  }

  private arm(graphRunId: string, wakeAt: number): void {
    if (this.disposed) {
      return;
    }
    const remainingMs = Math.max(0, wakeAt - this.now());
    const delayMs = Math.min(remainingMs, this.maxTimerDelayMs);
    const handle = this.setTimer(() => {
      void this.handleTimer(graphRunId);
    }, delayMs);
    this.timers.set(graphRunId, handle);
  }

  private async handleTimer(graphRunId: string): Promise<void> {
    this.timers.delete(graphRunId);
    if (this.disposed) {
      return;
    }

    const run = this.deps.readRun(graphRunId);
    const wakeAt = resolveGraphRunAutoWakeAt(run);
    if (!run || wakeAt === null) {
      return;
    }
    if (wakeAt > this.now()) {
      this.arm(graphRunId, wakeAt);
      return;
    }

    let result: GraphAutoWakeAttemptResult = "retry";
    try {
      result = await this.deps.onWake(graphRunId);
    } catch (error) {
      this.deps.onError?.(graphRunId, error);
    }
    if (result !== "retry" || this.disposed) {
      return;
    }
    const latest = this.deps.readRun(graphRunId);
    if (isGraphAutoWakeRunScheduled(latest)) {
      this.arm(graphRunId, this.now() + this.retryDelayMs);
    }
  }
}

function resolveGraphNodeWakeAt(node: GraphNodeRecord): number | null {
  if (node.kind !== "sleep") {
    return null;
  }
  if (node.status !== "sleeping" && node.status !== "pending" && node.status !== "ready") {
    return null;
  }
  if (typeof node.wakeAt !== "number" || !Number.isFinite(node.wakeAt) || node.wakeAt <= 0) {
    return null;
  }
  return node.wakeAt;
}

function normalizePositiveDelay(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
