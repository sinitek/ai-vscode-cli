import type { PromptRunInput, PromptRunTarget } from "../promptRunTypes";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { CodexRuntimeConfigEvidence } from "../config/codexRuntimeConfigIdentity";

export type PreparedLoopMainExecution = Pick<PromptRunInput, "displayPrompt" | "modelPrompt"> & {
  commit: () => void;
  afterSend: () => void;
};

export class FirstLoopMainExecution {
  claimed = false;
  admitted = false;
  prepareMain?: (task: LoopTaskRecord) => PreparedLoopMainExecution;
  readResumeTask?: () => LoopTaskRecord;
  resumeRequirements?: (task: LoopTaskRecord) => LoopTaskRecord["supplementalRequirements"] | null;
  startRejected = false;
  private resolveAdmission!: (result: { kind: "admitted" | "cancelled" } | { kind: "refused"; error: unknown }) => void;
  readonly admission = new Promise<{ kind: "admitted" | "cancelled" } | { kind: "refused"; error: unknown }>((resolve) => {
    this.resolveAdmission = resolve;
  });

  constructor(
    readonly target: PromptRunTarget,
    readonly configId: string,
    readonly isTargetCurrent: () => boolean,
    readonly unavailableMessage: string,
    readonly codexConfigEvidence: CodexRuntimeConfigEvidence,
  ) {}

  prepare(): PreparedLoopMainExecution {
    const verify = () => {
      if (!this.claimed || this.admitted || !this.readResumeTask || !this.isTargetCurrent()) throw new Error(this.unavailableMessage);
      return this.readResumeTask();
    };
    const task = verify();
    if (!this.prepareMain) throw new Error(this.unavailableMessage);
    const prepared = this.prepareMain(task);
    return {
      ...prepared,
      commit: () => {
        const latest = verify();
        if (latest.taskStoreFile !== task.taskStoreFile || latest.updatedAt !== task.updatedAt) {
          throw new Error(this.unavailableMessage);
        }
        prepared.commit();
        this.admitted = true;
        this.resolveAdmission({ kind: "admitted" });
      },
    };
  }

  finishBeforeAdmission(cancelled: boolean, error?: unknown): void {
    if (!this.admitted) this.resolveAdmission(cancelled ? { kind: "cancelled" }
      : { kind: "refused", error: error ?? new Error(this.unavailableMessage) });
  }

}

/** Runtime status can become stopped before the invocation finishes. */
export class PromptRunHandoff {
  private readonly runs = new Map<string, Set<{ done: Promise<void>; cancel: () => void }>>();
  private readonly stopping = new Set<string>();

  constructor(private readonly timeoutMs = 90000) {}

  isBusy(tabId: string): boolean {
    return this.runs.has(tabId) || this.stopping.has(tabId);
  }

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
