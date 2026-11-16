import type { LoopTaskRecord } from "../loopTaskStore";
import { DepartmentOwnershipIndex } from "./departmentOwnershipIndex";
import { DepartmentOwnedTaskSource, type DepartmentTaskOwnerCapability, type DepartmentTaskSourceDescriptor } from "./departmentOwnedTaskSource";

export type DepartmentSourceWriterBarrier = () => Promise<void>;
export type DepartmentOwnedSourcePort = {
  readonly descriptor: DepartmentTaskSourceDescriptor;
  readonly ready: boolean;
  readonly readTaskRecord: (taskId: string) => LoopTaskRecord | null;
  readonly readLeaderTaskIds: DepartmentOwnershipIndex["readDepartmentLeaderTaskIds"];
  listFiles(): readonly string[] | null;
  readFile(filePath: string): readonly LoopTaskRecord[] | null;
  commitSync(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): boolean;
  readRevision(): number | null;
  commit(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): Promise<boolean>;
  recoverAndRebuild(): boolean;
  rebuild(): boolean;
  close(): Promise<boolean>;
};

/**
 * Host-only composition boundary. Keep this instance and its capability inside Extension Host code;
 * never serialize the returned port to a Webview or model. The required barrier covers writers
 * outside this controller and must prove they are quiescent before the durable owner is released.
 */
export class DepartmentOwnedSourceController implements DepartmentOwnedSourcePort {
  readonly descriptor: DepartmentTaskSourceDescriptor;
  #source: DepartmentOwnedTaskSource;
  #index: DepartmentOwnershipIndex;
  #capability: DepartmentTaskOwnerCapability | null = null;
  #writerBarrier: DepartmentSourceWriterBarrier;
  readonly readLeaderTaskIds: DepartmentOwnershipIndex["readDepartmentLeaderTaskIds"];
  private accepting = true;
  private closed = false;
  private closePromise: Promise<boolean> | null = null;
  private active = 0;
  private publicationRevision = 0;
  private idleWaiters: Array<() => void> = [];

  private constructor(source: DepartmentOwnedTaskSource, index: DepartmentOwnershipIndex, writerBarrier: DepartmentSourceWriterBarrier) {
    this.#source = source;
    this.#index = index;
    this.#writerBarrier = writerBarrier;
    this.readLeaderTaskIds = (rootTaskId, leaderSubtaskId) => this.ready
      ? this.#index.readDepartmentLeaderTaskIds(rootTaskId, leaderSubtaskId)
      : null;
    this.descriptor = source.descriptor;
  }

  static create(sourceId: string, rootPath: string, writerBarrier: DepartmentSourceWriterBarrier): DepartmentOwnedSourceController | null {
    if (typeof writerBarrier !== "function") throw new Error("A trusted writer quiescence barrier is required");
    const source = DepartmentOwnedTaskSource.register(sourceId, rootPath);
    const index = new DepartmentOwnershipIndex(source);
    const controller = new DepartmentOwnedSourceController(source, index, writerBarrier);
    const capability = source.claim();
    if (!capability) { index.dispose(); source.dispose(); return null; }
    controller.#capability = capability;
    if (!source.prepareRebuild() || !index.rebuild()) {
      index.invalidate();
      return controller;
    }
    controller.publicationRevision++;
    return controller;
  }

  get ready(): boolean {
    return this.accepting && !this.closed && Boolean(this.#capability) && this.#index.state === "ready" && this.#source.isCurrent();
  }

  readonly readTaskRecord = (taskId: string): LoopTaskRecord | null => this.ready ? this.#index.readTaskRecord(taskId) : null;

  listFiles(): readonly string[] | null {
    if (!this.ready) return null;
    try { return this.#source.listFiles(); } catch { this.#index.invalidate(); return null; }
  }

  readFile(filePath: string): readonly LoopTaskRecord[] | null {
    if (!this.ready) return null;
    const records = this.#source.readFile(filePath);
    if (!records) this.#index.invalidate();
    return records;
  }

  /** Process-local publication generation, unavailable while reads are revoked. */
  readRevision(): number | null { return this.ready ? this.publicationRevision : null; }

  /** Synchronous router boundary: durable transaction AND index publication finish before return.
   * Never overtake an already admitted asynchronous operation or allow reentrant transactions.
   */
  commitSync(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): boolean {
    if (!this.ready || this.active !== 0) return false;
    this.active++;
    try { return this.publish(updates); }
    finally { this.finishOperation(); }
  }

  async commit(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): Promise<boolean> {
    if (!this.ready || !this.#capability) return false;
    this.active++;
    try {
      // Yield once so close can shut admission and wait for every already accepted operation.
      await Promise.resolve();
      return this.publish(updates);
    } finally { this.finishOperation(); }
  }

  private publish(updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): boolean {
    try {
      this.#index.invalidate();
      if (!this.#capability || !this.#source.transact(this.#capability, updates)) return false;
      // A commit admitted before close may finish persistence, but close must keep reads revoked.
      if (!this.accepting || this.closed) return true;
      if (!this.#index.rebuild()) return false;
      this.publicationRevision++;
      return true;
    } catch {
      this.#index.invalidate();
      return false;
    }
  }

  private finishOperation(): void {
    this.active--;
    if (this.active === 0) for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  /** Explicit recovery is the only route out of a failed transaction; rebuild alone cannot heal it. */
  recoverAndRebuild(): boolean {
    if (!this.accepting || this.closed || !this.#capability || this.active !== 0) return false;
    this.#index.invalidate();
    if (!this.#source.recover(this.#capability)) return false;
    if (!this.#source.prepareRebuild()) return false;
    if (!this.#index.rebuild()) return false;
    this.publicationRevision++;
    return true;
  }

  /** A clean complete rebuild can restore readiness after initial startup or external invalidation. */
  rebuild(): boolean {
    if (!this.accepting || this.closed || !this.#capability || this.active !== 0) return false;
    this.#index.invalidate();
    if (!this.#source.prepareRebuild()) return false;
    if (!this.#index.rebuild()) return false;
    this.publicationRevision++;
    return true;
  }

  close(): Promise<boolean> {
    if (this.closePromise) return this.closePromise;
    this.accepting = false;
    this.#index.invalidate();
    this.closePromise = this.closeAfterQuiescence();
    return this.closePromise;
  }

  private async closeAfterQuiescence(): Promise<boolean> {
    while (this.active > 0) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    try { await this.#writerBarrier(); }
    catch { return false; }
    if (!this.#capability || !this.#source.release(this.#capability)) return false;
    this.closed = true;
    this.#index.dispose();
    this.#source.dispose();
    this.#capability = null;
    return true;
  }
}
