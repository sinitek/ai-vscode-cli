import * as path from "path";
import * as fs from "fs";
import { createHash } from "crypto";
import {
  listLoopTaskStoreFilesStrict, readLoopTaskStoreResult, type LoopTaskRecord,
} from "../loopTaskStore";
import { commitLoopTaskIdentities, initializeLoopTaskIdentityCatalog, listRegisteredLoopTaskIdentityRoots, locateLoopTaskIdentities, locateLoopTaskIdentity } from "../loopTaskIdentityCatalog";
import { DepartmentOwnedSourceController } from "./departmentOwnedSourceController";
import { DepartmentOwnedTaskRepository } from "./departmentOwnedTaskRepository";

class DepartmentTaskSourceBusyError extends Error {}

/** Reuse the historical source when available. A different host's claim only blocks
 * that source, so new work can use a fresh sibling without stealing its marker.
 */
export function createDepartmentProductionTaskStoreForHost(dataDirectory: string) {
  const primaryRoot = path.join(dataDirectory, "department-tasks-v1");
  try {
    return createDepartmentProductionTaskStore(primaryRoot, true);
  } catch (error) {
    if (!(error instanceof DepartmentTaskSourceBusyError)) throw error;
  }
  for (const root of [...(listRegisteredLoopTaskIdentityRoots() ?? [])].reverse()) {
    if (path.resolve(root) === path.resolve(primaryRoot)) continue;
    try { return createDepartmentProductionTaskStore(root, true); }
    catch (error) { if (!(error instanceof DepartmentTaskSourceBusyError)) throw error; }
  }
  const sources = path.join(dataDirectory, "department-task-sources-v1");
  fs.mkdirSync(sources, { recursive: true });
  return createDepartmentProductionTaskStore(fs.mkdtempSync(path.join(sources, "source-")), true);
}

/** Host-only owner assembly. No capability or raw commit escapes this closure.
 * Only synchronous repository transactions can write the owned root. Closing first
 * revokes that sole admission path, then drains the controller before releasing ownership.
 */
export function createDepartmentProductionTaskStore(rootPath: string, registerEmptySource = false) {
  let accepting = true;
  let unverifiedWriter = false;
  let activeWrites = 0;
  let repository: DepartmentOwnedTaskRepository | null = null;
  const controller = DepartmentOwnedSourceController.create("department-production-v1", rootPath, async () => {
    if (accepting || unverifiedWriter || activeWrites !== 0 || !locateLoopTaskIdentity("").available) throw new Error("部门写者尚未静止，保留 owner marker");
  });
  if (!controller) throw new DepartmentTaskSourceBusyError("部门任务目录已由其他宿主持有，无法取得独占所有权。");
  if (!controller.ready) {
    // Unknown owner / unresolved recovery material: do not steal or remove its marker.
    throw new Error("部门受控任务来源无法取得独占所有权或尚需恢复，拒绝启动。");
  }
  try {
    initializeLoopTaskIdentityCatalog(controller.descriptor.root, () => {
      const files = new Map<string, readonly LoopTaskRecord[]>();
      for (const file of listLoopTaskStoreFilesStrict()) {
        const read = readLoopTaskStoreResult(file, true, true, true);
        if (!read.ok) throw new Error("普通任务身份目录初始化失败");
        files.set(file, read.store.tasks);
      }
      const owned = controller.listFiles();
      if (!owned) throw new Error("部门来源完整清单不可用");
      for (const file of owned) {
        const tasks = controller.readFile(file);
        if (!tasks) throw new Error("部门来源完整读取失败");
        files.set(file, tasks);
      }
      return files;
    }, {
      registerEmptySource,
      recoverWhenAllRegisteredRootsAreMissing: registerEmptySource,
    });
    repository = new DepartmentOwnedTaskRepository({
      descriptor: controller.descriptor,
      isCurrent: () => accepting && controller.ready,
      readRevision: () => controller.readRevision(),
      listFiles: () => { const files = controller.listFiles(); if (!files) throw new Error("部门来源不可用"); return files; },
      readFile: (file) => controller.readFile(file),
      locateTask: locateLoopTaskIdentity,
      locateTasks: locateLoopTaskIdentities,
      commit: (updates) => {
        if (!accepting) return false;
        activeWrites++;
        try {
          return commitLoopTaskIdentities(updates, () => controller.commitSync(updates), controller.descriptor.root);
        } finally { activeWrites--; }
      },
    });
  } catch (error) {
    // Source may have a pending transaction or an unverified file: retain its durable
    // marker for explicit recovery; never advertise this failed initialization as empty.
    accepting = false;
    repository?.dispose();
    void controller.close();
    throw error;
  }
  const currentRepository = repository;
  let closing: Promise<boolean> | null = null;
  return {
    descriptor: controller.descriptor,
    get ready(): boolean { return accepting && controller.ready && currentRepository.ready && locateLoopTaskIdentity("").available; },
    listTaskStoreFiles(): readonly string[] {
      try { return currentRepository.listTaskStoreFiles(); } catch { return []; }
    },
    create(record: Omit<LoopTaskRecord, "taskStoreFile">): LoopTaskRecord {
      if (!accepting) throw new Error("部门任务来源已关闭");
      const name = createHash("sha256").update(record.id).digest("hex");
      const result = currentRepository.create({ ...record, taskStoreFile: path.join(controller.descriptor.root, `${name}.json`) });
      if (!result.ok) throw new Error(`部门任务创建失败：${result.error}`);
      return result.value;
    },
    readTaskRecord(taskId: string): LoopTaskRecord | null {
      if (!accepting || !controller.ready) return null;
      const result = currentRepository.read(taskId);
      return result.ok ? result.value : null;
    },
    deleteTaskRecord(taskId: string): boolean {
      if (!accepting || !controller.ready) return false;
      return currentRepository.delete(taskId).ok;
    },
    readDepartmentLeaderTaskIds(rootTaskId: string, moduleId: string): readonly string[] | null {
      if (!accepting || !controller.ready || !currentRepository.read(rootTaskId).ok) return null;
      const ids = controller.readLeaderTaskIds(rootTaskId, moduleId);
      if (!ids || ids.some((id) => !currentRepository.read(id).ok)) return null;
      return ids;
    },
    /** Required BEFORE an unsupported import/restore/move writer could publish anything.
     * No automatic healing or marker handoff can certify that writer's termination.
     */
    revokeBeforeExternalChange(): void {
      unverifiedWriter = true;
      accepting = false;
      currentRepository.dispose();
    },
    close(): Promise<boolean> {
      if (closing) return closing;
      accepting = false;
      currentRepository.dispose(); // Retains identity/root refusal tombstones.
      closing = controller.close();
      return closing;
    },
  };
}
