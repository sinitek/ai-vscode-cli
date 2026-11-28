import * as fs from "fs";
import * as path from "path";
import { hostname } from "os";
import { randomBytes } from "crypto";
import { normalizeLoopTaskRecord, normalizeLoopTaskStoreForStorage, registerDepartmentOwnedLoopTaskStoreRoot, type LoopTaskRecord, type LoopTaskStoreChange } from "../loopTaskStore";
import type { DepartmentOwnershipSource, DepartmentOwnershipSourceLifecycle } from "./departmentOwnershipIndex";

export type DepartmentTaskSourceDescriptor = {
  version: 1;
  sourceId: string;
  root: string;
};

export type DepartmentTaskOwnerCapability = {
  sourceId: string;
  root: string;
  token: string;
  revision: number;
  released: boolean;
};

type OwnerMarker = { version: 1; sourceId: string; token: string; revision: number; hostname?: string; pid?: number };
type Disposable = { dispose(): void };
type Store = { tasks: LoopTaskRecord[] };
type RecoveryItem = { file: string; existed: boolean; content?: string };

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function markerPath(root: string): string { return path.join(root, ".department-owner.json"); }

function serializeOwnerMarker(capability: DepartmentTaskOwnerCapability, revision: number): string {
  return JSON.stringify({ version: 1, sourceId: capability.sourceId, token: capability.token,
    revision, hostname: hostname(), pid: process.pid } satisfies OwnerMarker);
}

export function readHistoricalDepartmentSourceState(root: string, sourceId: string): "inactive" | "unverified" {
  const file = markerPath(root);
  try {
    if (!fs.lstatSync(file).isFile()) return "unverified";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "inactive" : "unverified";
  }
  try {
    const contents = fs.readFileSync(file, "utf8");
    const marker = JSON.parse(contents) as Partial<OwnerMarker>;
    if (marker.version !== 1 || marker.sourceId !== sourceId || marker.hostname !== hostname()
      || typeof marker.token !== "string" || !/^[a-f0-9]{64}$/u.test(marker.token)
      || typeof marker.revision !== "number" || !Number.isSafeInteger(marker.revision) || marker.revision < 1
      || typeof marker.pid !== "number" || !Number.isSafeInteger(marker.pid) || marker.pid <= 0) return "unverified";
    try { process.kill(marker.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH" && fs.readFileSync(file, "utf8") === contents) return "inactive";
    }
  } catch { return "unverified"; }
  return "unverified";
}

/** Explicitly registered, isolated store. Existing global Loop writers do not own this root. */
export class DepartmentOwnedTaskSource implements DepartmentOwnershipSource {
  readonly descriptor: DepartmentTaskSourceDescriptor;
  readonly lifecycle: DepartmentOwnershipSourceLifecycle;
  private readonly listeners = new Set<() => void>();
  private readonly changes = new Set<(event: LoopTaskStoreChange) => void>();
  private capability: DepartmentTaskOwnerCapability | null = null;
  private invalid = true;
  private disposed = false;
  private recoveryRequired = false;
  private readonly rootRegistration: Disposable;

  private constructor(sourceId: string, root: string) {
    this.descriptor = { version: 1, sourceId, root };
    this.rootRegistration = registerDepartmentOwnedLoopTaskStoreRoot(root, sourceId);
    this.lifecycle = {
      isCurrent: () => this.isCurrent(),
      subscribe: (listener) => this.subscribeLifecycle(listener),
    };
  }

  static register(sourceId: string, rootPath: string): DepartmentOwnedTaskSource {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(sourceId)) throw new Error("Invalid department source id");
    const root = path.resolve(rootPath);
    fs.mkdirSync(root, { recursive: true });
    const realRoot = fs.realpathSync(root);
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Department source root must not be a symlink");
    return new DepartmentOwnedTaskSource(sourceId, realRoot);
  }

  /** The wx marker is the cross-process claim. Unknown existing owners are never stolen. */
  claim(): DepartmentTaskOwnerCapability | null {
    if (this.disposed || this.capability && this.isCurrent()) return this.capability;
    const cap: DepartmentTaskOwnerCapability = {
      sourceId: this.descriptor.sourceId, root: this.descriptor.root,
      token: randomBytes(32).toString("hex"), revision: 1, released: false,
    };
    let fd: number;
    try { fd = fs.openSync(markerPath(cap.root), "wx", 0o600); }
    catch { return null; }
    try {
      fs.writeFileSync(fd, serializeOwnerMarker(cap, cap.revision));
      fs.fsyncSync(fd);
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
    fs.closeSync(fd);
    this.capability = cap;
    this.invalid = true;
    return cap;
  }

  isCurrent(): boolean {
    if (this.disposed || this.invalid || !this.capability || this.capability.released) return false;
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath(this.descriptor.root), "utf8")) as OwnerMarker;
      return marker.version === 1 && marker.sourceId === this.capability.sourceId
        && marker.token === this.capability.token && marker.revision === this.capability.revision;
    } catch { return false; }
  }

  prepareRebuild(): boolean {
    if (this.disposed || this.recoveryRequired || this.hasRecoveryMaterial() || !this.capability || !this.markerMatches()) return false;
    this.invalid = false;
    return true;
  }

  beforeSourceChange(): void { this.invalidate(); }

  private subscribeLifecycle(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  invalidate(): void {
    this.invalid = true;
    for (const notify of this.listeners) { try { notify(); } catch { /* Observers cannot change commit state. */ } }
  }

  subscribeChanges(listener: (event: LoopTaskStoreChange) => void): Disposable {
    this.changes.add(listener);
    return { dispose: () => this.changes.delete(listener) };
  }

  listFiles(): readonly string[] {
    this.assertCurrent();
    const result: string[] = [];
    for (const name of fs.readdirSync(this.descriptor.root)) {
      if (!name.endsWith(".json") || name === path.basename(markerPath(this.descriptor.root)) || name === ".department-source.json") continue;
      const file = path.join(this.descriptor.root, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Unsupported entry in department source");
      result.push(file);
    }
    return result.sort();
  }

  readFile(filePath: string): readonly LoopTaskRecord[] | null {
    this.assertCurrent();
    const file = this.resolveFile(filePath);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return null;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Store;
      if (!Array.isArray(parsed.tasks)) return null;
      if (parsed.tasks.some((record) => !normalizeLoopTaskRecord(record, file))) return null;
      return normalizeLoopTaskStoreForStorage({ tasks: parsed.tasks }, { sourceFile: file, preserveExpired: true }).tasks;
    } catch { return null; }
  }

  subscribe(listener: (event: LoopTaskStoreChange) => void): Disposable {
    return this.subscribeChanges(listener);
  }

  /** All changed files are staged before publication; any failure revokes and leaves temp recovery files. */
  transact(capability: DepartmentTaskOwnerCapability, updates: ReadonlyMap<string, readonly LoopTaskRecord[]>): boolean {
    if (!this.matches(capability)) return false;
    const staged: Array<{ file: string; temp: string; recovery: string }> = [];
    const recoveryItems: RecoveryItem[] = [];
    const recoveryPath = path.join(this.descriptor.root, `.department-recovery-${capability.token}.recovery`);
    this.invalidate();
    try {
      for (const [filePath, tasks] of updates) {
        const file = this.resolveFile(filePath);
        const normalized = normalizeLoopTaskStoreForStorage({ tasks: [...tasks] }, { sourceFile: file, preserveExpired: true }).tasks;
        for (const task of normalized) if (task.taskStoreFile !== file) throw new Error("Record path does not match controlled source path");
        const temp = `${file}.${capability.token}.stage`;
        const exists = fs.existsSync(file);
        recoveryItems.push({ file, existed: exists, content: exists ? fs.readFileSync(file, "utf8") : undefined });
        staged.push({ file, temp, recovery: recoveryPath });
      }
      fs.writeFileSync(recoveryPath, JSON.stringify(recoveryItems), { flag: "wx", mode: 0o600 });
      for (const [filePath, tasks] of updates) {
        const file = this.resolveFile(filePath);
        const normalized = normalizeLoopTaskStoreForStorage({ tasks: [...tasks] }, { sourceFile: file, preserveExpired: true }).tasks;
        const temp = `${file}.${capability.token}.stage`;
        fs.writeFileSync(temp, JSON.stringify({ tasks: normalized }, null, 2), { flag: "wx", mode: 0o600 });
      }
      if (!this.markerMatches()) throw new Error("Owner lease changed during transaction");
      for (const item of staged) fs.renameSync(item.temp, item.file);
      const nextRevision = capability.revision + 1;
      this.writeMarkerRevision(capability, nextRevision);
      capability.revision = nextRevision;
      for (const item of staged) {
        try { fs.unlinkSync(item.temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      fs.unlinkSync(recoveryPath);
      this.invalid = false;
      this.recoveryRequired = false;
      for (const item of staged) {
        const tasks = normalizeLoopTaskStoreForStorage({ tasks: [...updates.get(item.file)!] }, { sourceFile: item.file, preserveExpired: true }).tasks;
        for (const listener of this.changes) { try { listener({ type: "replace", filePath: item.file, tasks }); } catch { /* Commit is already durable. */ } }
      }
      return true;
    } catch {
      this.invalidate();
      this.recoveryRequired = true;
      return false;
    }
  }

  /** Explicit rollback from the durable transaction snapshot; rebuild remains a separate step. */
  recover(capability: DepartmentTaskOwnerCapability): boolean {
    if (this.disposed || capability.released || this.capability !== capability || !this.markerMatches()) return false;
    this.invalidate();
    try {
      const recoveryFiles = fs.readdirSync(this.descriptor.root).filter((name) => /^\.department-recovery-[a-f0-9]+\.recovery$/.test(name));
      for (const name of recoveryFiles) {
        const recoveryPath = path.join(this.descriptor.root, name);
        const entries = JSON.parse(fs.readFileSync(recoveryPath, "utf8")) as RecoveryItem[];
        if (!Array.isArray(entries)) throw new Error("Invalid recovery material");
        for (const entry of entries) {
          const file = this.resolveFile(entry.file);
          if (entry.existed) {
            if (typeof entry.content !== "string") throw new Error("Invalid recovery content");
            const temp = `${file}.${capability.token}.restore`;
            fs.writeFileSync(temp, entry.content, { flag: "w", mode: 0o600 });
            fs.renameSync(temp, file);
          } else {
            try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          }
        }
        for (const name of fs.readdirSync(this.descriptor.root)) {
          if (name.includes(capability.token) && (name.endsWith(".stage") || name.endsWith(".restore"))) {
            fs.unlinkSync(path.join(this.descriptor.root, name));
          }
        }
        fs.unlinkSync(recoveryPath);
      }
      this.recoveryRequired = false;
      return !this.hasRecoveryMaterial();
    } catch {
      this.recoveryRequired = true;
      return false;
    }
  }

  release(capability: DepartmentTaskOwnerCapability): boolean {
    if (!this.matches(capability)) return false;
    this.invalidate();
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath(capability.root), "utf8")) as OwnerMarker;
      if (marker.token !== capability.token) return false;
      fs.unlinkSync(markerPath(capability.root));
      capability.released = true;
      this.capability = null;
      return true;
    } catch { return false; }
  }

  dispose(): void { this.invalidate(); this.disposed = true; this.rootRegistration.dispose(); this.listeners.clear(); this.changes.clear(); }

  private hasRecoveryMaterial(): boolean {
    try { return fs.readdirSync(this.descriptor.root).some((name) => name.startsWith(".department-recovery-") && name.endsWith(".recovery")); }
    catch { return true; }
  }

  private resolveFile(filePath: string): string {
    const file = path.resolve(filePath);
    if (!isInside(this.descriptor.root, file) || path.dirname(file) !== this.descriptor.root || !file.endsWith(".json")) {
      throw new Error("Department task path is outside the controlled source");
    }
    return file;
  }

  private matches(capability: DepartmentTaskOwnerCapability): boolean {
    return !capability.released && this.capability === capability && this.isCurrent();
  }

  private assertCurrent(): void { if (!this.isCurrent()) throw new Error("Department source is unavailable"); }

  private markerMatches(): boolean {
    if (!this.capability || this.capability.released) return false;
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath(this.descriptor.root), "utf8")) as OwnerMarker;
      return marker.token === this.capability.token && marker.sourceId === this.capability.sourceId
        && marker.revision === this.capability.revision;
    } catch { return false; }
  }

  private writeMarkerRevision(capability: DepartmentTaskOwnerCapability, revision: number): void {
    const temp = `${markerPath(capability.root)}.${capability.token}.stage`;
    fs.writeFileSync(temp, serializeOwnerMarker(capability, revision), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, markerPath(capability.root));
  }
}
