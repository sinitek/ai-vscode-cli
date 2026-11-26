import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import { logError, logEssential } from "./logger";

type Identity = { id: string };
type Snapshot = { version: 1; ready: boolean; roots: string[]; owned: Record<string, string>; files: Record<string, string[]>; ordinaryMoves?: Record<string, { file: string; sources: string[] }> };
const directory = path.join(os.homedir(), ".sinitek_cli", "loop-task-identities");
const catalogFile = path.join(directory, "catalog.json");
const lockFile = path.join(directory, "transaction.lock");
export const LOOP_TASK_IDENTITY_UPDATE_WAIT_MS = 100;
export const LOOP_TASK_IDENTITY_UPDATE_RETRIES = 3;
const readLockWaitMs = LOOP_TASK_IDENTITY_UPDATE_WAIT_MS;
const lockPollMs = 5;
const inside = (root: string, file: string) => file === root || file.startsWith(`${root}${path.sep}`);
type IdentityCatalogUnavailable = "identity-lock-present" | "identity-catalog-unavailable";

function isLoopTaskIdentityLockContention(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const ioError = error as NodeJS.ErrnoException;
  return ioError.code === "EEXIST" && ioError.syscall === "open" && ioError.path === lockFile;
}

function waitForTransactionLock(deadline = performance.now() + readLockWaitMs): boolean {
  const pause = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  while (fs.existsSync(lockFile)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    Atomics.wait(pause, 0, 0, Math.min(lockPollMs, remaining));
  }
  return true;
}

export function waitForLoopTaskIdentityUpdateRetry(deadline: number): boolean {
  return waitForTransactionLock(deadline) && performance.now() < deadline;
}

function read(allowUnready = false): Snapshot | null {
  try {
    const value = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as Snapshot;
    if (value.version !== 1 || typeof value.ready !== "boolean" || (!allowUnready && !value.ready) || !Array.isArray(value.roots)
      || value.roots.some((root) => typeof root !== "string" || !path.isAbsolute(root))
      || !value.owned || typeof value.owned !== "object" || Array.isArray(value.owned)
      || Object.entries(value.owned).some(([id, file]) => !id.trim() || typeof file !== "string" || !path.isAbsolute(file)
        || !value.roots.some((root) => inside(root, file)))
      || !value.files || typeof value.files !== "object" || Array.isArray(value.files)
      || Object.entries(value.files).some(([file, ids]) => !path.isAbsolute(file) || !Array.isArray(ids)
        || ids.some((id) => typeof id !== "string" || !id.trim()))
      || (value.ordinaryMoves !== undefined && (!value.ordinaryMoves || typeof value.ordinaryMoves !== "object" || Array.isArray(value.ordinaryMoves)
        || Object.entries(value.ordinaryMoves).some(([id, move]) => !id.trim() || !move || typeof move !== "object"
          || typeof move.file !== "string" || !path.isAbsolute(move.file) || !Array.isArray(move.sources)
          || move.sources.some((file) => typeof file !== "string" || !path.isAbsolute(file))
          || value.roots.some((root) => inside(root, move.file) || move.sources.some((file) => inside(root, file))))))) throw new Error("任务身份目录无效或尚未提交");
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
function locked<T>(action: () => T, onLockContention?: () => void): T {
  fs.mkdirSync(directory, { recursive: true });
  // All supported ordinary and owned writers use this lock, even before initialization.
  // Unknown/stale locks are never stolen based on PID, mtime or elapsed time.
  let fd: number;
  try {
    fd = fs.openSync(lockFile, "wx", 0o600);
  } catch (error) {
    if (onLockContention && isLoopTaskIdentityLockContention(error)) onLockContention();
    throw error;
  }
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
export type LoopTaskIdentityCatalogInitializationOptions = {
  registerEmptySource?: boolean;
  recoverWhenAllRegisteredRootsAreMissing?: boolean;
};

function pathExistsWithoutFollowingLinks(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function initializeLoopTaskIdentityCatalog(
  root: string,
  load: () => ReadonlyMap<string, readonly Identity[]>,
  options: LoopTaskIdentityCatalogInitializationOptions = {},
): void {
  locked(() => {
    let existing: Snapshot | null;
    try { existing = read(); }
    catch (error) {
      if (!options.recoverWhenAllRegisteredRootsAreMissing) throw error;
      const incomplete = read(true);
      if (!incomplete || incomplete.ready || incomplete.roots.length === 0
        || incomplete.roots.some(pathExistsWithoutFollowingLinks)) throw error;
      if (!path.isAbsolute(root) || incomplete.roots.some((other) => inside(other, root) || inside(root, other))) throw error;
      const files: Record<string, string[]> = Object.create(null);
      const owned: Record<string, string> = Object.assign(Object.create(null), incomplete.owned);
      if (Object.values(incomplete.ordinaryMoves ?? {}).some((move) => inside(root, move.file) || move.sources.some((file) => inside(root, file)))) throw error;
      for (const [name, tasks] of load()) {
        const file = path.resolve(name);
        if (!path.isAbsolute(name) || tasks.some((task) => typeof task.id !== "string" || !task.id.trim())) throw error;
        const ids = tasks.filter((task) => {
          const move = incomplete.ordinaryMoves?.[task.id];
          return !move || file === move.file || !move.sources.includes(file);
        }).map((task) => task.id);
        files[file] = ids;
        if (inside(root, file)) for (const id of ids) {
          if (Object.prototype.hasOwnProperty.call(owned, id)) throw error;
          owned[id] = file;
        }
      }
      if (fs.readdirSync(root).some((name) => name !== ".department-owner.json" && name !== ".department-source.json")) throw error;
      publish({ version: 1, ready: true, roots: [...incomplete.roots, root], owned, files, ordinaryMoves: incomplete.ordinaryMoves });
      return;
    }
    if (existing && existing.roots.length > 0) {
      if (!existing.roots.includes(root)) {
        // A new host may append its own empty source. This never rebuilds the catalog,
        // imports existing files, or acquires another source's ownership.
        if (!options.registerEmptySource || !path.isAbsolute(root)
          || existing.roots.some((other) => inside(other, root) || inside(root, other))
          || Object.keys(existing.files).some((file) => inside(root, file))
          || Object.values(existing.ordinaryMoves ?? {}).some((move) => inside(root, move.file) || move.sources.some((file) => inside(root, file)))
          || fs.readdirSync(root).some((name) => name !== ".department-owner.json" && name !== ".department-source.json")) {
          throw new Error("任务身份目录未登记此受控来源，且来源非全新空目录");
        }
        publish({ ...existing, roots: [...existing.roots, root] });
      }
      return;
    }
    const files: Record<string, string[]> = Object.create(null);
    if (Object.values(existing?.ordinaryMoves ?? {}).some((move) => inside(root, move.file) || move.sources.some((file) => inside(root, file)))) {
      throw new Error("普通任务历史来源不可提升为部门来源");
    }
    for (const [name, tasks] of load()) {
      const file = path.resolve(name);
      files[file] = tasks.filter((task) => {
        const move = existing?.ordinaryMoves?.[task.id];
        return !move || file === move.file || !move.sources.includes(file);
      }).map((task) => task.id);
    }
    const owned: Record<string, string> = Object.create(null);
    for (const [file, ids] of Object.entries(files)) if (inside(root, file)) for (const id of ids) owned[id] = file;
    publish({ version: 1, ready: true, roots: [root], owned, files, ordinaryMoves: existing?.ordinaryMoves });
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
    if (!waitForTransactionLock()) return { available: false };
    const snapshot = read();
    if (!snapshot) return { available: false };
    const locations = new Map<string, string[]>(taskIds.map((id) => [id, []]));
    for (const [file, ids] of Object.entries(snapshot.files)) {
      for (const id of ids) locations.get(id)?.push(file);
    }
    for (const [id, files] of locations) {
      if (!files.length && Object.prototype.hasOwnProperty.call(snapshot.owned, id)) files.push(snapshot.owned[id]);
    }
    return waitForTransactionLock() ? { available: true, locations } : { available: false };
  } catch { return { available: false }; }
}

export function locateLoopTaskIdentity(taskId: string): { available: false } | { available: true; files: string[] } {
  const result = locateLoopTaskIdentities([taskId]);
  return result.available ? { available: true, files: [...result.locations.get(taskId)!] } : result;
}

/** Current controlled roots, without granting write or recovery authority. */
export function listRegisteredLoopTaskIdentityRoots(): readonly string[] | null {
  try {
    if (fs.existsSync(lockFile)) return null;
    const snapshot = read();
    if (!snapshot) return null;
    return [...snapshot.roots];
  } catch { return null; }
}

/** A committed ordinary destination survives stale source bytes and process restarts.
 * Absence is ordinary compatibility; a locked/damaged catalog is never a fallback permit.
 */
export function locateOrdinaryLoopTaskMove(taskId: string, onUnavailable?: (reason: IdentityCatalogUnavailable) => void): { available: false } | { available: true; file?: string } {
  let reason: IdentityCatalogUnavailable = "identity-lock-present";
  try {
    if (!fs.existsSync(lockFile)) {
      const snapshot = read();
      const file = snapshot?.ordinaryMoves?.[taskId]?.file;
      if (!fs.existsSync(lockFile)) return { available: true, file };
    }
  } catch { reason = "identity-catalog-unavailable"; }
  onUnavailable?.(reason);
  return { available: false };
}

/** Ordinary communication GC has no authority to delete department artifacts. Hold the
 * supported-writer gate through classification AND deletion, including across Node hosts.
 * Missing, locked, damaged or unpublished catalogs reject GC; absence is not ordinary identity.
 */
export function withLoopTaskIdentityRetention(action: (ownedTaskIds: ReadonlySet<string>) => void): void {
  locked(() => {
    const snapshot = read();
    if (!snapshot || snapshot.roots.length === 0) throw new Error("任务身份目录不可用，跳过通信清理");
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
  const ownership = inspectLoopTaskIdentityOwnership(taskId);
  if (ownership === "ordinary") return false;
  if (ownership === "department-owned") return true;
  return null;
}

function ownsIdentity(snapshot: Snapshot, taskId: string): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot.owned, taskId) || Object.entries(snapshot.files).some(([file, ids]) => ids.includes(taskId)
    && snapshot.roots.some((root) => inside(root, file)));
}

export function inspectLoopTaskIdentityOwnership(taskId: string): "ordinary" | "department-owned" | IdentityCatalogUnavailable {
  try {
    if (fs.existsSync(lockFile)) return "identity-lock-present";
    const snapshot = read();
    if (!snapshot) return "ordinary";
    const owned = ownsIdentity(snapshot, taskId);
    if (fs.existsSync(lockFile)) return "identity-lock-present";
    return owned ? "department-owned" : "ordinary";
  } catch { return "identity-catalog-unavailable"; }
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
    const move = snapshot.ordinaryMoves?.[taskId];
    const known = move ? move.sources.includes(path.resolve(sourceFile)) : files.length === 1 && files[0] === path.resolve(sourceFile);
    return !Object.prototype.hasOwnProperty.call(snapshot.owned, taskId) && known
      && !snapshot.roots.some((root) => inside(root, path.resolve(sourceFile))) && !fs.existsSync(lockFile);
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
  ordinary?: {
    atomicWrite: true;
    move?: { taskId: string; sourceFile: string; sourceTasks: readonly Identity[]; targetFile: string };
    onLockContention?: () => void;
    updateSource?: { taskId: string; file: string; assertUnchanged(): void };
  },
): boolean {
  let lockContended = false;
  let retries = 0;
  const startedAt = performance.now();
  let deadline: number | undefined;
  const commit = () => locked(() => {
    const snapshot = read();
    const source = ordinary?.updateSource;
    if (source) {
      const moved = snapshot?.ordinaryMoves?.[source.taskId]?.file;
      const file = path.resolve(source.file);
      if (snapshot && (ownsIdentity(snapshot, source.taskId) || snapshot.roots.some((root) => inside(root, file)))) {
        throw new Error("Controlled task identities require owner transactions");
      }
      if (moved && moved !== file) throw new Error("Loop task update source moved before commit");
      source.assertUnchanged();
    }
    return commitLoopTaskIdentitiesUnderLock(snapshot, updates, write, ownedRoot, ordinary);
  }, ordinary?.onLockContention ?? (ownedRoot ? () => { lockContended = true; } : undefined));

  if (!ownedRoot) return commit();
  for (;;) {
    lockContended = false;
    try {
      const result = commit();
      if (retries > 0) {
        void logEssential("loop-task-owner-write-contention-resolved", {
          retries, waitedMs: Math.max(0, Math.floor(performance.now() - startedAt)),
        }).catch(() => undefined);
      }
      return result;
    } catch (error) {
      if (!lockContended) throw error;
      deadline ??= startedAt + LOOP_TASK_IDENTITY_UPDATE_WAIT_MS;
      if (retries < LOOP_TASK_IDENTITY_UPDATE_RETRIES && waitForLoopTaskIdentityUpdateRetry(deadline)) {
        retries++;
        continue;
      }
      void logError("loop-task-owner-write-contention-rejected", {
        retries, waitedMs: Math.max(0, Math.floor(performance.now() - startedAt)),
      }).catch(() => undefined);
      throw error;
    }
  }
}

// The caller owns the non-reentrant writer gate and has read this exact snapshot.
function commitLoopTaskIdentitiesUnderLock(
  previous: Snapshot | null,
  updates: ReadonlyMap<string, readonly Identity[]>,
  write: () => boolean,
  ownedRoot?: string,
  ordinary?: { atomicWrite: true; move?: { taskId: string; sourceFile: string; sourceTasks: readonly Identity[]; targetFile: string } },
): boolean {
  if (!previous && ownedRoot) throw new Error("部门身份目录未初始化");
  if (!previous && !ordinary?.move) return write();
  const prior: Snapshot = previous ?? { version: 1, ready: true, roots: [], owned: Object.create(null), files: Object.create(null) };
  if (ownedRoot && !prior.roots.includes(ownedRoot)) throw new Error("未登记的部门来源");
  const next = structuredClone(prior);
  const move = ordinary?.move;
  if (move) {
    const source = path.resolve(move.sourceFile), target = path.resolve(move.targetFile);
    if (ownedRoot || source === target || prior.roots.some((root) => inside(root, source) || inside(root, target))
      || Object.prototype.hasOwnProperty.call(prior.owned, move.taskId)
      || !updates.get(move.targetFile)?.some((task) => task.id === move.taskId)
      || move.sourceTasks.some((task) => task.id === move.taskId)) throw new Error("普通任务迁移身份无效");
    next.files[source] = move.sourceTasks.map((task) => task.id);
    next.ordinaryMoves = { ...(next.ordinaryMoves ?? {}), [move.taskId]: {
      file: target, sources: [...new Set([...(next.ordinaryMoves?.[move.taskId]?.sources ?? []), source])],
    } };
  }
  for (const [name, tasks] of updates) {
    const file = path.resolve(name);
    if (ownedRoot && !inside(ownedRoot, file)) throw new Error("部门文件迁出受控来源");
    if (!ownedRoot && prior.roots.some((root) => inside(root, file))) throw new Error("普通 writer 无权写入部门来源");
    for (const task of tasks) {
      if (typeof task.id !== "string" || !task.id.trim()) throw new Error("任务 ID 无效");
      const reserved = Object.prototype.hasOwnProperty.call(prior.owned, task.id) ? prior.owned[task.id] : undefined;
      if (reserved && (!ownedRoot || reserved !== file)) throw new Error("部门任务历史身份已保留，拒绝普通写入或迁移");
      if (ownedRoot) Object.defineProperty(next.owned, task.id, { value: file, enumerable: true, configurable: true, writable: true });
      const conflicts = Object.entries(prior.files).filter(([other, ids]) => other !== file && ids.includes(task.id));
      if (conflicts.some(([other]) => ownedRoot || prior.roots.some((root) => inside(root, other)))) throw new Error("普通/部门任务身份冲突");
    }
    next.files[file] = tasks.map((task) => task.id);
  }
  // Validate the complete proposed owned contribution, including multi-file transactions.
  const ids = new Map<string, string>();
  for (const [file, values] of Object.entries(next.files)) for (const id of values) {
    const other = ids.get(id);
    if (other && prior.roots.some((root) => inside(root, file) || inside(root, other))) throw new Error("受控任务 ID 重复");
    ids.set(id, file);
  }
  if (previous) publish({ ...previous, ready: false });
  try {
    if (!write()) return false;
  } catch (error) {
    // Ordinary atomic replacement failed before rename: original file bytes still hold.
    // Owner/multi-file writers retain the original uncertain ready=false behavior.
    if (ordinary && previous) { try { publish(previous); } catch { /* Keep uncertainty closed. */ } }
    throw error;
  }
  publish(next);
  return true;
}

/** A single file is the bounded retention batch. Read and classify its records, then
 * commit their contribution and bytes under the SAME gate and catalog snapshot.
 * A locked/damaged/unpublished catalog never invokes prepare, even if it later recovers.
 * No nested ordinary writer or cross-call authority snapshot is exposed to the caller.
 */
export function retainOrdinaryLoopTaskIdentities(
  filePath: string,
  prepare: (destinations: ReadonlyMap<string, string>, ownedTaskIds: ReadonlySet<string>) => { tasks: readonly Identity[]; write: () => boolean } | null,
): boolean {
  return locked(() => {
    const previous = read();
    const file = path.resolve(filePath);
    if (previous?.roots.some((root) => inside(root, file))) throw new Error("普通清理无权写入部门来源");
    const destinations = new Map(Object.entries(previous?.ordinaryMoves ?? {}).map(([id, move]) => [id, move.file]));
    const ownedTaskIds = new Set(Object.keys(previous?.owned ?? {}));
    for (const [source, ids] of Object.entries(previous?.files ?? {})) {
      if (previous!.roots.some((root) => inside(root, source))) for (const id of ids) ownedTaskIds.add(id);
    }
    const prepared = prepare(destinations, ownedTaskIds);
    if (!prepared) return false;
    return commitLoopTaskIdentitiesUnderLock(previous, new Map([[filePath, prepared.tasks]]), prepared.write, undefined, { atomicWrite: true });
  });
}

/** Exact known-source fallback follows a committed move; it never enumerates stores or
 * falls back to stale source bytes. Identity classification and disk read share the gate.
 */
export function readKnownOrdinaryLoopTaskIdentity<T>(
  taskId: string, knownFile: string | undefined, readFile: (file: string) => T | null,
): T | null {
  try {
    return locked(() => {
      const snapshot = read();
      const file = snapshot?.ordinaryMoves?.[taskId]?.file ?? knownFile;
      if (!file || (snapshot && (Object.prototype.hasOwnProperty.call(snapshot.owned, taskId)
        || snapshot.roots.some((root) => inside(root, path.resolve(file)))
        || Object.entries(snapshot.files).some(([source, ids]) => ids.includes(taskId)
          && snapshot.roots.some((root) => inside(root, source)))))) return null;
      return readFile(file);
    });
  } catch { return null; }
}
