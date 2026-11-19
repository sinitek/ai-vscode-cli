import * as path from "path";
import { normalizeDepartmentMetadata, type DepartmentMetadata } from "../department";
import {
  listLoopTaskStoreFilesStrict, readLoopTaskStoreResult, subscribeLoopTaskStoreChanges,
  type LoopTaskRecord, type LoopTaskStoreChange,
} from "../loopTaskStore";
import type { DepartmentLeaderOwnershipReader } from "./departmentGroupChatProjection";

type Disposable = { dispose(): void };
/** Trusted source lifecycle, never supplied by a Webview.
 * Central composition must exclusively mediate writes, or revoke isCurrent BEFORE an external
 * writer can publish changes. File-watcher delivery alone cannot guarantee synchronous freshness.
 * Watcher errors/overflow, import, restore and unknown changes must invalidate; rebuild is explicit.
 */
export type DepartmentOwnershipSourceLifecycle = {
  isCurrent(): boolean;
  subscribe(invalidate: () => void): Disposable;
};
export type DepartmentOwnershipSource = {
  listFiles(): readonly string[];
  /** null is a failed read, never an empty store. */
  readFile(filePath: string): readonly LoopTaskRecord[] | null;
  subscribe(listener: (event: LoopTaskStoreChange) => void): Disposable;
  lifecycle: DepartmentOwnershipSourceLifecycle;
};

type Entry = {
  id: string; workspace: string; invalid: boolean;
  meta: DepartmentMetadata | null; modules: readonly string[];
};
const fileKey = (file: string) => process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
const moduleKey = (workspace: string, root: string, module: string) => JSON.stringify([workspace, root, module]);
function entries(tasks: readonly LoopTaskRecord[]): Entry[] {
  return tasks.map((task) => {
    const meta = normalizeDepartmentMetadata(task.department);
    return { id: task.id, workspace: task.workspaceKey,
      invalid: Boolean(task.departmentInvalid || (task.department !== undefined && !meta)),
      meta, modules: task.subTasks.map((item) => item.id) };
  });
}

/** File contributions are replaced, not appended: rereads and updates are idempotent.
 * Duplicate records/modules remain distinct contributions, so ambiguity never becomes last-writer-wins.
 * An invalidation is deliberately global: an unknown file may have changed to ANY root/workspace.
 * Only a complete successful rebuild restores availability; incremental success cannot heal it.
 */
export class DepartmentOwnershipIndex implements Disposable {
  private files = new Map<string, Entry[]>();
  private byId = new Map<string, Map<string, Entry>>();
  private byModule = new Map<string, Map<string, string>>();
  private invalidRecords = 0;
  private version = 0;
  private status: "new" | "rebuilding" | "ready" | "invalid" | "disposed" = "new";
  private subscriptions: Disposable[] = [];
  private connected = false;

  constructor(private readonly source: DepartmentOwnershipSource) {
    try {
      this.subscriptions.push(source.subscribe((event) => {
        this.version++;
        if (event.type === "invalidate" || this.status !== "ready") { this.invalidate(); return; }
        try { this.replace(fileKey(event.filePath), entries(event.tasks)); }
        catch { this.invalidate(); }
      }));
      this.subscriptions.push(source.lifecycle.subscribe(() => this.invalidate()));
      this.connected = true;
    } catch { this.invalidate(); }
  }

  get state(): "new" | "rebuilding" | "ready" | "invalid" | "disposed" { return this.status; }

  invalidate(): void {
    this.version++;
    if (this.status !== "disposed") this.status = "invalid";
  }

  rebuild(): boolean {
    if (this.status === "disposed") return false;
    this.status = "rebuilding";
    const revision = ++this.version;
    try {
      if (!this.connected || !this.source.lifecycle.isCurrent()) throw new Error("Ownership source unavailable");
      const snapshot = new Map<string, Entry[]>();
      for (const file of this.source.listFiles()) {
        const key = fileKey(file);
        if (snapshot.has(key)) continue;
        const tasks = this.source.readFile(file);
        if (!tasks) throw new Error("Ownership source read failed");
        snapshot.set(key, entries(tasks));
      }
      if (revision !== this.version || !this.source.lifecycle.isCurrent()) throw new Error("Ownership source changed during rebuild");
      this.files.clear(); this.byId.clear(); this.byModule.clear(); this.invalidRecords = 0;
      for (const [file, records] of snapshot) this.replace(file, records);
      this.status = "ready";
      return true;
    } catch { this.invalidate(); return false; }
  }

  readonly readDepartmentLeaderTaskIds: DepartmentLeaderOwnershipReader = (rootTaskId, leaderSubtaskId) => {
    try {
      if (this.status !== "ready") return null;
      if (!this.source.lifecycle.isCurrent()) { this.invalidate(); return null; }
      if (this.invalidRecords) return null;
      const roots = this.byId.get(rootTaskId);
      if (!roots || roots.size !== 1) return null;
      const root = roots.values().next().value as Entry;
      const meta = root.meta;
      if (!meta || meta.role !== "director" || meta.rootTaskId !== rootTaskId || meta.parentTaskId !== null
        || meta.leaderSubtaskId !== null || !root.workspace || !root.modules.includes(leaderSubtaskId)) return null;
      const ids = [...(this.byModule.get(moduleKey(root.workspace, rootTaskId, leaderSubtaskId))?.values() ?? [])];
      if (ids.some((id) => this.byId.get(id)?.size !== 1)) return null;
      return ids;
    } catch { this.invalidate(); return null; }
  };

  /** Fresh record read at its unique indexed physical source, without store discovery.
   * Unexpected membership changes in that file revoke the snapshot; reads never repair it.
   * Central can use this as the coordinator readTaskRecord port for the indexed source.
   */
  readonly readTaskRecord = (taskId: string): LoopTaskRecord | null => {
    try {
      if (this.status !== "ready") return null;
      if (!this.source.lifecycle.isCurrent()) { this.invalidate(); return null; }
      const records = this.byId.get(taskId);
      if (!records || records.size !== 1) return null;
      const file = (JSON.parse(records.keys().next().value as string) as [string, number])[0];
      const tasks = this.source.readFile(file);
      if (!tasks || JSON.stringify(entries(tasks)) !== JSON.stringify(this.files.get(file))) { this.invalidate(); return null; }
      const matches = tasks.filter((task) => task.id === taskId);
      return matches.length === 1 ? matches[0] : null;
    } catch { this.invalidate(); return null; }
  };

  dispose(): void {
    if (this.status === "disposed") return;
    this.status = "disposed"; this.version++;
    for (const subscription of this.subscriptions.splice(0)) { try { subscription.dispose(); } catch { /* Already unavailable. */ } }
    this.files.clear(); this.byId.clear(); this.byModule.clear(); this.invalidRecords = 0;
  }

  private replace(file: string, records: Entry[]): void {
    const contribution = (items: Entry[], remove: boolean) => items.forEach((entry, i) => {
      const token = JSON.stringify([file, i]);
      this.invalidRecords += entry.invalid ? (remove ? -1 : 1) : 0;
      if (remove) {
        const group = this.byId.get(entry.id); group?.delete(token); if (!group?.size) this.byId.delete(entry.id);
      } else {
        if (!this.byId.has(entry.id)) this.byId.set(entry.id, new Map());
        this.byId.get(entry.id)!.set(token, entry);
      }
      const meta = entry.meta;
      if (meta?.role !== "leader" || !meta.leaderSubtaskId) return;
      const key = moduleKey(entry.workspace, meta.rootTaskId, meta.leaderSubtaskId);
      if (remove) {
        const group = this.byModule.get(key); group?.delete(token); if (!group?.size) this.byModule.delete(key);
      } else {
        if (!this.byModule.has(key)) this.byModule.set(key, new Map());
        this.byModule.get(key)!.set(token, entry.id);
      }
    });
    contribution(this.files.get(file) ?? [], true);
    contribution(records, false);
    if (records.length) this.files.set(file, records); else this.files.delete(file);
  }
}

/** Production storage adapter. Does not register a singleton, start a watcher or mutate records.
 * Mount lifecycle first, rebuild once, then inject readDepartmentLeaderTaskIds into the coordinator.
 * Caller owns external change barriers and must dispose with the extension/workspace source lease.
 */
export function createLoopTaskStoreDepartmentOwnershipIndex(lifecycle: DepartmentOwnershipSourceLifecycle): DepartmentOwnershipIndex {
  return new DepartmentOwnershipIndex({
    listFiles: listLoopTaskStoreFilesStrict,
    readFile: (file) => { const read = readLoopTaskStoreResult(file, true, true); return read.ok ? read.store.tasks : null; },
    subscribe: subscribeLoopTaskStoreChanges,
    lifecycle,
  });
}
