import type { RuntimeConfigExecutionLease } from "../config/sharedRuntimeConfig";

/** Runtime status can become stopped before the invocation and its lease finish. */
export class PromptRunHandoff {
  private readonly runs = new Map<string, Set<{ done: Promise<void>; cancel: () => void }>>();
  private readonly leases = new Map<string, Set<RuntimeConfigExecutionLease>>();
  private readonly stopping = new Set<string>();

  constructor(private readonly timeoutMs = 90000) {}

  async run(tabId: string, operation: (isAborted: () => boolean) => Promise<void>): Promise<void> {
    if (this.stopping.has(tabId)) throw new Error("正在等待原任务完全暂停，请稍后发送。");
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    let cancelled = false;
    const entry = { done, cancel: () => { cancelled = true; } };
    const entries = this.runs.get(tabId) ?? new Set<typeof entry>();
    this.runs.set(tabId, entries);
    entries.add(entry);
    try {
      await operation(() => cancelled);
    } finally {
      finish();
      entries.delete(entry);
      if (!entries.size) this.runs.delete(tabId);
    }
  }

  trackLease(tabId: string, lease: RuntimeConfigExecutionLease): RuntimeConfigExecutionLease {
    const entries = this.leases.get(tabId) ?? new Set<RuntimeConfigExecutionLease>();
    this.leases.set(tabId, entries);
    let releasing: Promise<void> | undefined;
    const tracked: RuntimeConfigExecutionLease = {
      selection: lease.selection,
      release: () => {
        if (!entries.has(tracked)) return Promise.resolve();
        if (!releasing) {
          releasing = lease.release().then(() => {
            entries.delete(tracked);
            if (!entries.size) this.leases.delete(tabId);
          }).finally(() => { releasing = undefined; });
        }
        return releasing;
      },
    };
    entries.add(tracked);
    return tracked;
  }

  async pause(
    tabId: string,
    stop: () => void,
    isCurrent: () => boolean,
    confirmStopped: (isCurrent: () => boolean) => Promise<void> = async () => undefined,
  ): Promise<void> {
    if (this.stopping.has(tabId)) throw new Error("正在等待原任务完全暂停，请勿重复发送。");
    this.stopping.add(tabId);
    let waiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!isCurrent()) throw new Error("目标会话已变化，补充任务未发送，输入已保留。");
      const runs = Array.from(this.runs.get(tabId) ?? []);
      for (const run of runs) run.cancel();
      stop();
      await Promise.race([
        (async () => {
          await Promise.all(runs.map((run) => run.done));
          if (!isCurrent()) throw new Error("目标会话已变化，补充任务未发送，输入已保留。");
          await confirmStopped(() => waiting && isCurrent());
          // A normal completion may have scheduled a failed lease release retry.
          // Confirm release here instead of treating that completion as idle.
          await Promise.all(Array.from(this.leases.get(tabId) ?? [], (lease) => lease.release()));
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("等待原任务完全暂停超时，补充任务未发送，输入已保留，请稍后重试。")), this.timeoutMs);
        }),
      ]);
      if (!isCurrent()) throw new Error("目标会话已变化，补充任务未发送，输入已保留。");
    } finally {
      waiting = false;
      if (timer) clearTimeout(timer);
      this.stopping.delete(tabId);
    }
  }
}
