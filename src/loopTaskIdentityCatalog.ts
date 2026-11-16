import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";

type Identity = { id: string };
type Snapshot = { version: 1; ready: boolean; roots: string[]; owned: Record<string, string>; files: Record<string, string[]> };
const directory = path.join(os.homedir(), ".sinitek_cli", "loop-task-identities");
const catalogFile = path.join(directory, "catalog.json");
const lockFile = path.join(directory, "transaction.lock");
const inside = (root: string, file: string) => file === root || file.startsWith(`${root}${path.sep}`);

function read(): Snapshot | null {
  try {
    const value = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as Snapshot;
    if (value.version !== 1 || !value.ready || !Array.isArray(value.roots)
      || value.roots.some((root) => typeof root !== "string" || !path.isAbsolute(root))
      || !value.owned || typeof value.owned !== "object" || Array.isArray(value.owned)
      || Object.entries(value.owned).some(([id, file]) => !id.trim() || typeof file !== "string" || !path.isAbsolute(file)
        || !value.roots.some((root) => inside(root, file)))
      || !value.files || typeof value.files !== "object" || Array.isArray(value.files)
      || Object.entries(value.files).some(([file, ids]) => !path.isAbsolute(file) || !Array.isArray(ids)
        || ids.some((id) => typeof id !== "string" || !id.trim()))) throw new Error("任务身份目录无效或尚未提交");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function publish(value: Snapshot): void {
  const temp = `${catalogFile}.${randomBytes(12).toString("hex")}.stage`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, catalogFile);
  } finally { try { fs.unlinkSync(temp); } catch { /* Published or retained diagnostic. */ } }
}
function locked<T>(action: () => T): T {
  fs.mkdirSync(directory, { recursive: true });
  // All supported ordinary and owned writers use this lock, even before initialization.
  // Unknown/stale locks are never stolen based on PID, mtime or elapsed time.
  const fd = fs.openSync(lockFile, "wx", 0o600);
  const identity = fs.fstatSync(fd);
  try { return action(); }
  finally {
    fs.closeSync(fd);
    const current = fs.lstatSync(lockFile);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error("任务身份目录事务锁已替换，保留未知锁并拒绝交接");
    }
    fs.unlinkSync(lockFile);
  }
}

/** One explicit complete bootstrap under the same gate as every supported writer.
 * Reopening a published catalog does not scan directories. Damaged/uncommitted catalogs
 * need a separately authorized recovery protocol, never an automatic empty rebuild.
 */
export function initializeLoopTaskIdentityCatalog(root: string, load: () => ReadonlyMap<string, readonly Identity[]>): void {
  locked(() => {
    const existing = read();
    if (existing) {
      if (!existing.roots.includes(root)) throw new Error("任务身份目录未登记此受控来源");
      return;
    }
    const files: Record<string, string[]> = Object.create(null);
    for (const [file, tasks] of load()) files[path.resolve(file)] = tasks.map((task) => task.id);
    const owned: Record<string, string> = Object.create(null);
    for (const [file, ids] of Object.entries(files)) if (inside(root, file)) for (const id of ids) owned[id] = file;
    publish({ version: 1, ready: true, roots: [root], owned, files });
  });
}

export type LoopTaskIdentityLocations = { available: false } | {
  available: true;
  locations: ReadonlyMap<string, readonly string[]>;
};

/** One current catalog read and one contribution traversal for a bounded set of IDs.
 * Repeated input IDs share a result; duplicate physical contributions are never deduplicated.
 * No cache survives this call, and tombstones still reserve their original physical file.
 */
export function locateLoopTaskIdentities(taskIds: readonly string[]): LoopTaskIdentityLocations {
  try {
    if (fs.existsSync(lockFile)) return { available: false };
    const snapshot = read();
    if (!snapshot) return { available: false };
    const locations = new Map<string, string[]>(taskIds.map((id) => [id, []]));
    for (const [file, ids] of Object.entries(snapshot.files)) {
      for (const id of ids) locations.get(id)?.push(file);
    }
    for (const [id, files] of locations) {
      if (!files.length && Object.prototype.hasOwnProperty.call(snapshot.owned, id)) files.push(snapshot.owned[id]);
    }
    return fs.existsSync(lockFile) ? { available: false } : { available: true, locations };
  } catch { return { available: false }; }
}

export function locateLoopTaskIdentity(taskId: string): { available: false } | { available: true; files: string[] } {
  const result = locateLoopTaskIdentities([taskId]);
  return result.available ? { available: true, files: [...result.locations.get(taskId)!] } : result;
}

/** Ordinary communication GC has no authority to delete department artifacts. Hold the
 * supported-writer gate through classification AND deletion, including across Node hosts.
 * Missing, locked, damaged or unpublished catalogs reject GC; absence is not ordinary identity.
 */
export function withLoopTaskIdentityRetention(action: (ownedTaskIds: ReadonlySet<string>) => void): void {
  locked(() => {
    const snapshot = read();
    if (!snapshot) throw new Error("任务身份目录不可用，跳过通信清理");
    const owned = new Set(Object.keys(snapshot.owned));
    for (const [file, ids] of Object.entries(snapshot.files)) {
      if (snapshot.roots.some((root) => inside(root, file))) for (const id of ids) owned.add(id);
    }
    action(owned);
  });
}

/** Refusal boundary for a host which has not acquired the owned source/router.
 * false also covers a pre-bootstrap ordinary installation; null never authorizes fallback.
 */
export function isDepartmentOwnedLoopTaskIdentity(taskId: string): boolean | null {
  try {
    if (fs.existsSync(lockFile)) return null;
    const snapshot = read();
    if (!snapshot) return false;
    const owned = Object.prototype.hasOwnProperty.call(snapshot.owned, taskId) || Object.entries(snapshot.files).some(([file, ids]) => ids.includes(taskId)
      && snapshot.roots.some((root) => inside(root, file)));
    return fs.existsSync(lockFile) ? null : owned;
  } catch { return null; }
}

/** Legacy communication moves precede task writes. Refuse unregistered imports and
 * owned/ambiguous IDs BEFORE those moves, including in a host without an owned router.
 */
export function canMigrateOrdinaryLoopTaskIdentity(taskId: string, sourceFile: string): boolean {
  try {
    if (fs.existsSync(lockFile)) return false;
    const snapshot = read();
    if (!snapshot) return true; // Existing ordinary migration before catalog bootstrap.
    const files = Object.entries(snapshot.files).flatMap(([file, ids]) => ids.filter((id) => id === taskId).map(() => file));
    return !Object.prototype.hasOwnProperty.call(snapshot.owned, taskId) && files.length === 1 && files[0] === path.resolve(sourceFile)
      && !snapshot.roots.some((root) => inside(root, files[0])) && !fs.existsSync(lockFile);
  } catch { return false; }
}

/** Caller must perform synchronous disk mutation. The catalog is revoked before it, and
 * published before success returns. A partial failure retains ready=false, blocking readers
 * and future writers. This is not an authority for arbitrary direct filesystem writers.
 */
export function commitLoopTaskIdentities(
  updates: ReadonlyMap<string, readonly Identity[]>,
  write: () => boolean,
  ownedRoot?: string,
): boolean {
  return locked(() => {
    const previous = read();
    if (!previous) {
      if (ownedRoot) throw new Error("部门身份目录未初始化");
      return write();
    }
    if (ownedRoot && !previous.roots.includes(ownedRoot)) throw new Error("未登记的部门来源");
    const next = structuredClone(previous);
    for (const [name, tasks] of updates) {
      const file = path.resolve(name);
      if (ownedRoot && !inside(ownedRoot, file)) throw new Error("部门文件迁出受控来源");
      if (!ownedRoot && previous.roots.some((root) => inside(root, file))) throw new Error("普通 writer 无权写入部门来源");
      for (const task of tasks) {
        if (typeof task.id !== "string" || !task.id.trim()) throw new Error("任务 ID 无效");
        const reserved = Object.prototype.hasOwnProperty.call(previous.owned, task.id) ? previous.owned[task.id] : undefined;
        if (reserved && (!ownedRoot || reserved !== file)) throw new Error("部门任务历史身份已保留，拒绝普通写入或迁移");
        if (ownedRoot) Object.defineProperty(next.owned, task.id, { value: file, enumerable: true, configurable: true, writable: true });
        const conflicts = Object.entries(previous.files).filter(([other, ids]) => other !== file && ids.includes(task.id));
        if (conflicts.some(([other]) => ownedRoot || previous.roots.some((root) => inside(root, other)))) throw new Error("普通/部门任务身份冲突");
      }
      next.files[file] = tasks.map((task) => task.id);
    }
    // Validate the complete proposed owned contribution, including multi-file transactions.
    const ids = new Map<string, string>();
    for (const [file, values] of Object.entries(next.files)) for (const id of values) {
      const prior = ids.get(id);
      if (prior && (previous.roots.some((root) => inside(root, file) || inside(root, prior)))) throw new Error("受控任务 ID 重复");
      ids.set(id, file);
    }
    publish({ ...previous, ready: false });
    if (!write()) return false;
    publish(next);
    return true;
  });
}
