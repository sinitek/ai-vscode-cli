export const LOOP_AUTO_WAKE_MIN_SECONDS = 10;
export const LOOP_AUTO_WAKE_MAX_SECONDS = 365 * 24 * 60 * 60;
export const LOOP_AUTO_WAKE_RETRY_DELAY_MS = 30 * 1000;
export const LOOP_AUTO_WAKE_MAX_TIMER_DELAY_MS = 2_147_000_000;
export const LOOP_AUTO_SLEEP_REASON_MAX_LENGTH = 1000;

export type LoopSleepDecision = {
  status: "sleep";
  wakeAfterSeconds: number;
  sleepReason: string;
};

export type LoopAutoWakeTask = {
  id: string;
  status: string;
  autoWakeAt?: number;
};

export type LoopAutoWakeAttemptResult = "started" | "retry" | "discard";

type LoopAutoWakeTimerHandle = ReturnType<typeof setTimeout>;

type LoopAutoWakeSchedulerDeps = {
  readTask: (taskId: string) => LoopAutoWakeTask | null;
  onWake: (taskId: string) => LoopAutoWakeAttemptResult | Promise<LoopAutoWakeAttemptResult>;
  onError?: (taskId: string, error: unknown) => void;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => LoopAutoWakeTimerHandle;
  clearTimeout?: (handle: LoopAutoWakeTimerHandle) => void;
  retryDelayMs?: number;
  maxTimerDelayMs?: number;
};

export function buildLoopAutoSleepProtocolLines(): string[] {
  return [
    "自动睡眠与定时唤醒是宿主可解析任务决策的通用等待能力，不是 Loop 主任务专属；任何负责返回本 JSON 决策协议的任务，在明确需要等待外部可观察结果且当前没有可执行工作时，都可以返回 status=sleep。",
    "返回 status=sleep 后，程序会把当前任务持久化为 sleeping，记录 autoWakeAt，并在到点后复用同一任务 ID、会话、CLI 和执行模式自动继续；sleep 只表示等待，不表示完成或人工阻塞。",
    "普通自由文本回复不会触发自动睡眠；必须在本 JSON 决策协议内返回 status=sleep、wakeAfterSeconds 和 sleepReason。",
  ];
}

export function normalizeLoopWakeAfterSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (value < LOOP_AUTO_WAKE_MIN_SECONDS || value > LOOP_AUTO_WAKE_MAX_SECONDS) {
    return null;
  }
  return value;
}

export function normalizeLoopSleepDecision(value: unknown): LoopSleepDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as { status?: unknown; wakeAfterSeconds?: unknown; sleepReason?: unknown };
  if (raw.status !== "sleep") {
    return null;
  }
  const wakeAfterSeconds = normalizeLoopWakeAfterSeconds(raw.wakeAfterSeconds);
  const sleepReason = typeof raw.sleepReason === "string" ? raw.sleepReason.trim() : "";
  if (
    wakeAfterSeconds === null
    || !sleepReason
    || sleepReason.length > LOOP_AUTO_SLEEP_REASON_MAX_LENGTH
  ) {
    return null;
  }
  return {
    status: "sleep",
    wakeAfterSeconds,
    sleepReason,
  };
}

export function resolveLoopAutoWakeAt(startedAt: number, wakeAfterSeconds: number): number {
  return startedAt + wakeAfterSeconds * 1000;
}

export function isLoopAutoWakeTaskScheduled(task: LoopAutoWakeTask | null | undefined): task is LoopAutoWakeTask & { autoWakeAt: number } {
  return Boolean(
    task
    && task.status === "sleeping"
    && typeof task.autoWakeAt === "number"
    && Number.isFinite(task.autoWakeAt)
    && task.autoWakeAt > 0,
  );
}

export class LoopAutoWakeScheduler {
  private readonly timers = new Map<string, LoopAutoWakeTimerHandle>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => LoopAutoWakeTimerHandle;
  private readonly clearTimer: (handle: LoopAutoWakeTimerHandle) => void;
  private readonly retryDelayMs: number;
  private readonly maxTimerDelayMs: number;
  private disposed = false;

  constructor(private readonly deps: LoopAutoWakeSchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle));
    this.retryDelayMs = normalizePositiveDelay(deps.retryDelayMs, LOOP_AUTO_WAKE_RETRY_DELAY_MS);
    this.maxTimerDelayMs = normalizePositiveDelay(deps.maxTimerDelayMs, LOOP_AUTO_WAKE_MAX_TIMER_DELAY_MS);
  }

  public restore(tasks: readonly LoopAutoWakeTask[]): void {
    this.cancelAll();
    tasks.forEach((task) => this.schedule(task));
  }

  public schedule(task: LoopAutoWakeTask): void {
    this.cancel(task.id);
    if (this.disposed || !isLoopAutoWakeTaskScheduled(task)) {
      return;
    }
    this.arm(task.id, task.autoWakeAt);
  }

  public cancel(taskId: string): void {
    const handle = this.timers.get(taskId);
    if (handle !== undefined) {
      this.clearTimer(handle);
      this.timers.delete(taskId);
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

  private arm(taskId: string, wakeAt: number): void {
    if (this.disposed) {
      return;
    }
    const remainingMs = Math.max(0, wakeAt - this.now());
    const delayMs = Math.min(remainingMs, this.maxTimerDelayMs);
    const handle = this.setTimer(() => {
      void this.handleTimer(taskId);
    }, delayMs);
    this.timers.set(taskId, handle);
  }

  private async handleTimer(taskId: string): Promise<void> {
    this.timers.delete(taskId);
    if (this.disposed) {
      return;
    }
    const task = this.deps.readTask(taskId);
    if (!isLoopAutoWakeTaskScheduled(task)) {
      return;
    }
    if (task.autoWakeAt > this.now()) {
      this.arm(taskId, task.autoWakeAt);
      return;
    }

    let result: LoopAutoWakeAttemptResult = "retry";
    try {
      result = await this.deps.onWake(taskId);
    } catch (error) {
      this.deps.onError?.(taskId, error);
    }
    if (result !== "retry" || this.disposed) {
      return;
    }
    const latest = this.deps.readTask(taskId);
    if (isLoopAutoWakeTaskScheduled(latest)) {
      this.arm(taskId, this.now() + this.retryDelayMs);
    }
  }
}

function normalizePositiveDelay(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
