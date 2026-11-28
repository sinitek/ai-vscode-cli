import * as fs from "fs";
import * as path from "path";
import { normalizeDepartmentMetadata } from "../department";
import { hasLoopTaskIdentitiesUnderRoot, locateLoopTaskIdentities, locateLoopTaskIdentity, listRegisteredLoopTaskIdentityRoots } from "../loopTaskIdentityCatalog";
import { normalizeLoopTaskRecord, type LoopTaskRecord } from "../loopTaskStore";
import { readHistoricalDepartmentSourceState } from "./departmentOwnedTaskSource";

const SOURCE_MARKER = ".department-source.json";
const OWNER_MARKER = ".department-owner.json";

export type DepartmentHistoricalTask = {
  task: LoopTaskRecord;
  sourceState: ReturnType<typeof readHistoricalDepartmentSourceState>;
};

type DepartmentHistoricalSnapshot = {
  leaderIdsByModule: Map<string, string[]>;
};

function isRegisteredSourceRoot(root: string): boolean {
  try {
    if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) return false;
    const markerPath = path.join(root, SOURCE_MARKER);
    if (fs.lstatSync(markerPath).isSymbolicLink() || !fs.lstatSync(markerPath).isFile()) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { version?: unknown; sourceId?: unknown };
    return marker.version === 1 && marker.sourceId === "department-production-v1";
  } catch { return false; }
}

function isMissingDirectory(root: string): boolean {
  try { fs.lstatSync(root); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}

function readSourceFile(file: string): LoopTaskRecord[] | null {
  try {
    if (path.dirname(file) === path.parse(file).root || fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile()) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return null;
    const records = parsed.tasks.map((record) => normalizeLoopTaskRecord(record, file));
    if (records.some((record) => !record || record.taskStoreFile !== file)) return null;
    return records as LoopTaskRecord[];
  } catch { return null; }
}

function readRegisteredSnapshot(): DepartmentHistoricalSnapshot | null {
  const roots = listRegisteredLoopTaskIdentityRoots();
  if (!roots) return null;
  const uniqueRoots = [...new Set(roots.map((root) => path.resolve(root)))];
  const tasks: LoopTaskRecord[] = [];
  const taskFiles = new Map<string, string>();
  const sourceRootByFile = new Map<string, string>();
  for (const root of uniqueRoots) {
    if (!isRegisteredSourceRoot(root)) {
      if (isMissingDirectory(root) && hasLoopTaskIdentitiesUnderRoot(root) === false) continue;
      return null;
    }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch { return null; }
    for (const entry of entries) {
      if (!entry.name.endsWith(".json") || entry.name === SOURCE_MARKER || entry.name === OWNER_MARKER) continue;
      if (!entry.isFile()) return null;
      const file = path.join(root, entry.name);
      const records = readSourceFile(file);
      if (!records) return null;
      for (const task of records) {
        if (taskFiles.has(task.id)) return null;
        taskFiles.set(task.id, file);
        sourceRootByFile.set(file, root);
        tasks.push(task);
      }
    }
  }
  const identities = locateLoopTaskIdentities([...taskFiles.keys()]);
  if (!identities.available) return null;
  for (const [taskId, file] of taskFiles) {
    const locations = identities.locations.get(taskId);
    if (!locations || locations.length !== 1 || path.resolve(locations[0]!) !== file
      || !sourceRootByFile.has(file)) return null;
  }
  const leaderIdsByModule = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.departmentInvalid) return null;
    const department = task.departmentInvalid ? null : task.department;
    if (department?.role !== "leader") continue;
    const key = JSON.stringify([department.rootTaskId, department.leaderSubtaskId]);
    const ids = leaderIdsByModule.get(key) ?? [];
    ids.push(task.id);
    leaderIdsByModule.set(key, ids);
  }
  return { leaderIdsByModule };
}

export function readDepartmentHistoricalTask(taskId: string): DepartmentHistoricalTask | null {
  const location = locateLoopTaskIdentity(taskId);
  if (!location.available || location.files.length !== 1) return null;
  const file = path.resolve(location.files[0]!);
  const roots = listRegisteredLoopTaskIdentityRoots();
  if (!roots) return null;
  const root = roots.map((item) => path.resolve(item)).find((item) => path.dirname(file) === item);
  if (!root || !isRegisteredSourceRoot(root)) return null;
  const records = readSourceFile(file);
  const matches = records?.filter((task) => task.id === taskId) ?? [];
  if (matches.length !== 1) return null;
  const task = matches[0]!;
  const department = task.departmentInvalid ? null : normalizeDepartmentMetadata(task.department);
  if (!department || department.role === "employee"
    || (department.role === "director" && (department.rootTaskId !== task.id || department.parentTaskId !== null || department.leaderSubtaskId !== null))
    || (department.role === "leader" && (department.rootTaskId === task.id || department.parentTaskId !== department.rootTaskId || !department.leaderSubtaskId))) return null;
  const currentLocation = locateLoopTaskIdentity(taskId);
  if (!currentLocation.available || currentLocation.files.length !== 1 || path.resolve(currentLocation.files[0]!) !== file) return null;
  return { task, sourceState: readHistoricalDepartmentSourceState(root, "department-production-v1") };
}

export function readDepartmentHistoricalLeaderIds(rootTaskId: string, moduleId: string): readonly string[] | null {
  const snapshot = readRegisteredSnapshot();
  if (!snapshot) return null;
  const ids = snapshot.leaderIdsByModule.get(JSON.stringify([rootTaskId, moduleId])) ?? [];
  return ids.length === 1 ? ids : ids.length === 0 ? [] : null;
}
