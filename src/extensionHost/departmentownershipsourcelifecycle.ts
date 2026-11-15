import type { DepartmentOwnershipSourceLifecycle } from "./departmentOwnershipIndex";

type Disposable = { dispose(): void };
/** An authoritative source owner must cover ALL writers (including import/move/restore).
 * A watcher, PID, successful write, or mere absence of observed writes is not such a lease.
 */
export type DepartmentOwnershipSourceAuthority = {
  isCurrent(): boolean;
  subscribeRevocation(listener: () => void): Disposable;
};
/** Fail closed when the task directory still admits uncoordinated external writers. */
export class DepartmentOwnershipSourceLifecycleHost implements DepartmentOwnershipSourceLifecycle {
  private listeners = new Set<() => void>();
  private revoked = true;
  private disposed = false;
  private subscription: Disposable | null;
  constructor(private readonly authority: DepartmentOwnershipSourceAuthority | null) {
    this.subscription = authority?.subscribeRevocation(() => this.invalidate()) ?? null;
  }
  isCurrent(): boolean { return !this.disposed && !this.revoked && this.authority?.isCurrent() === true; }
  subscribe(invalidate: () => void): Disposable {
    this.listeners.add(invalidate); return { dispose: () => { this.listeners.delete(invalidate); } };
  }
  invalidate(): void { this.revoked = true; for (const notify of this.listeners) notify(); }
  /** Invoke BEFORE any controlled import, restore or source path change publishes files. */
  beforeSourceChange(): void { this.invalidate(); }
  /** Only a current source-owner lease can prepare an explicit complete index rebuild. */
  prepareRebuild(): boolean {
    if (this.disposed || !this.authority?.isCurrent()) { this.invalidate(); return false; }
    this.revoked = false; return true;
  }
  get issue(): string | null {
    return this.isCurrent() ? null : "部门归属来源尚无覆盖所有写者的独占协调租约；导入、路径移动或外部写入不能保证同步撤销，部门群聊授权已拒绝。";
  }
  dispose(): void { this.invalidate(); this.disposed = true; this.subscription?.dispose(); this.subscription = null; this.listeners.clear(); }
}
