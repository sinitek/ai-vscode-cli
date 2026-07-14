import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CLI_LIST,
  type CliName,
  type LoopExecutionMode,
  normalizeLoopExecutionMode,
} from "./cli/types";
import { isTimestampWithinHistoryRetention } from "./historyRetention";
import { logError } from "./logger";
import {
  getLegacyLoopStoragePaths,
  isLegacyLoopTaskStorePath,
  migrateLegacyLoopJson,
} from "./loopLegacyMigration";
import { normalizeLoopMainAiFailureCount } from "./loopMainFailure";
import { normalizeLoopWriteFiles } from "./loopParallel";
import type { LoopDebateRoundRecord } from "./loopDebate";

const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const WORKSPACE_KEY_FALLBACK = "no-workspace";
const LOOP_TASK_STORE_DIR = path.join(DATA_DIR, "loop-tasks");
const LOOP_TASK_STORE_FILENAME = "loop-tasks.json";
const LOOP_TASK_STORE_FLAT_FILE = path.join(DATA_DIR, LOOP_TASK_STORE_FILENAME);
const LOOP_COMMUNICATION_DIR = path.join(DATA_DIR, "loop-communications");
const LEGACY_LOOP_STORAGE_PATHS = getLegacyLoopStoragePaths(DATA_DIR);
const LOOP_DEFAULT_MAX_ROUNDS = 20;
const LOOP_MIN_MAX_ROUNDS = 1;
const LOOP_MAX_MAX_ROUNDS = 100;
const LOOP_MAX_SKILL_IDS_PER_SUBTASK = 3;
const LOOP_MAX_SKILL_GUIDANCE_LENGTH = 32_000;
const LOOP_SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const loopTaskStoreFileCache = new Map<string, string>();

export type LoopTaskRole = "main" | "subtask";
export type LoopTaskStatus = "running" | "completed" | "needs-review" | "error" | "stopped";
export type LoopRunStatus = "end" | "error" | "stopped";
export type LoopTaskKind = "development" | "non_development";

export type LoopSubtaskRecord = {
  id: string;
  title: string;
  prompt?: string;
  conflictGroup?: string;
  writeFiles?: string[];
  skillIds?: string[];
  skillGuidance?: string;
  status: "pending" | "running" | "completed" | "skipped" | "blocked";
  summary?: string;
  communicationFile?: string;
  updatedAt?: number;
};

export type LoopAcceptanceCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type LoopAcceptance = {
  passed: boolean;
  summary?: string;
  checks: LoopAcceptanceCheck[];
};

export type LoopRoundSummary = {
  round: number;
  subtaskId?: string;
  title: string;
  summary: string;
};

export type LoopSubtaskDecision = {
  id?: string;
  title: string;
  prompt: string;
  conflictGroup?: string;
  writeFiles?: string[];
  skillIds?: string[];
};

export type LoopMainDecision = {
  status: "completed" | "continue" | "blocked";
  answerConclusion?: string;
  finalSummary?: string;
  roundSummaries?: LoopRoundSummary[];
  requirementCoverage?: LoopAcceptanceCheck[];
  acceptance?: LoopAcceptance;
  subtask?: LoopSubtaskDecision;
  subtasks?: LoopSubtaskDecision[];
  parallelReason?: string;
  estimatedRemainingRounds?: number;
};

export type LoopRoundRecord = {
  round: number;
  role: LoopTaskRole;
  subtaskId?: string;
  status: LoopRunStatus;
  startedAt: number;
  endedAt: number;
  summary?: string;
};

export type LoopTaskRecord = {
  id: string;
  cli: CliName;
  workspaceKey: string;
  taskStoreFile: string;
  rootPrompt: string;
  taskKind?: LoopTaskKind;
  executionMode?: LoopExecutionMode;
  status: LoopTaskStatus;
  createdAt: number;
  updatedAt: number;
  maxRounds: number;
  currentRound: number;
  communicationDir: string;
  mainCommunicationFile: string;
  sessionId?: string | null;
  activeSubtaskId?: string | null;
  activeSubtaskIds?: string[];
  subTasks: LoopSubtaskRecord[];
  rounds: LoopRoundRecord[];
  answerConclusion?: string;
  finalSummary?: string;
  estimatedRemainingRounds?: number;
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
  mainAiLastFailureAt?: number;
  mainAiLastFailureMessage?: string;
  supplementalRequirements?: string[];
  debateRounds?: LoopDebateRoundRecord<LoopMainDecision>[];
  completionRoundSummaries: LoopRoundSummary[];
  completionRequirementCoverage: LoopAcceptanceCheck[];
};

export type LoopTaskStore = {
  tasks: LoopTaskRecord[];
};

export function buildLoopSessionIdsByCli(
  tasks: readonly Pick<LoopTaskRecord, "cli" | "sessionId">[]
): Record<CliName, Set<string>> {
  const sessionIdsByCli: Record<CliName, Set<string>> = {
    codex: new Set<string>(),
    claude: new Set<string>(),
    opencode: new Set<string>(),
  };
  tasks.forEach((task) => {
    const sessionId = typeof task.sessionId === "string" ? task.sessionId.trim() : "";
    if (sessionId) {
      sessionIdsByCli[task.cli].add(sessionId);
    }
  });
  return sessionIdsByCli;
}

export type LoopCommunicationPaths = {
  dir: string;
  mainFile: string;
  subtasksDir: string;
};

function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

function sanitizeLoopPathSegment(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || fallback;
}

export function getLoopTaskStoreSessionFile(workspaceKey: string, cli: CliName, sessionId: string): string {
  const workspaceSegment = sanitizeLoopPathSegment(workspaceKey, WORKSPACE_KEY_FALLBACK);
  const sessionSegment = sanitizeLoopPathSegment(sessionId, "session");
  return path.join(LOOP_TASK_STORE_DIR, workspaceSegment, cli, sessionSegment, LOOP_TASK_STORE_FILENAME);
}

function getLoopTaskStorePendingFile(workspaceKey: string, cli: CliName, taskId: string): string {
  const workspaceSegment = sanitizeLoopPathSegment(workspaceKey, WORKSPACE_KEY_FALLBACK);
  const taskSegment = sanitizeLoopPathSegment(taskId, "task");
  return path.join(
    LOOP_TASK_STORE_DIR,
    workspaceSegment,
    cli,
    "__pending__",
    taskSegment,
    LOOP_TASK_STORE_FILENAME
  );
}

export function buildLoopTaskStoreFile(cli: CliName, workspaceKey: string, sessionId: string | null, taskId: string): string {
  if (sessionId && sessionId.trim()) {
    return getLoopTaskStoreSessionFile(workspaceKey, cli, sessionId);
  }
  return getLoopTaskStorePendingFile(workspaceKey, cli, taskId);
}

function collectLoopTaskStoreFilesFromDir(
  dirPath: string,
  filename: string = LOOP_TASK_STORE_FILENAME,
): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const collected: string[] = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      void logError("loop-task-store-readdir-error", { dirPath: current, error: String(error) });
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (entry.isFile() && entry.name === filename) {
        collected.push(fullPath);
      }
    });
  }
  return collected;
}

export function listLoopTaskStoreFiles(): string[] {
  const unmigratedLegacyFiles = migrateLegacyLoopStorage();
  const files = collectLoopTaskStoreFilesFromDir(LOOP_TASK_STORE_DIR);
  if (fs.existsSync(LOOP_TASK_STORE_FLAT_FILE)) {
    files.push(LOOP_TASK_STORE_FLAT_FILE);
  }
  files.push(...unmigratedLegacyFiles);
  return Array.from(new Set(files));
}

function migrateLegacyLoopStorage(): string[] {
  const legacyFiles = collectLoopTaskStoreFilesFromDir(
    LEGACY_LOOP_STORAGE_PATHS.taskStoreDir,
    path.basename(LEGACY_LOOP_STORAGE_PATHS.taskStoreFlatFile),
  );
  if (fs.existsSync(LEGACY_LOOP_STORAGE_PATHS.taskStoreFlatFile)) {
    legacyFiles.push(LEGACY_LOOP_STORAGE_PATHS.taskStoreFlatFile);
  }
  if (!migrateLegacyLoopCommunicationStorage()) {
    return Array.from(new Set(legacyFiles));
  }
  Array.from(new Set(legacyFiles)).forEach(migrateLegacyLoopTaskStoreFile);
  removeEmptyDirectories(LEGACY_LOOP_STORAGE_PATHS.taskStoreDir);
  return Array.from(new Set(legacyFiles)).filter((filePath) => fs.existsSync(filePath));
}

function migrateLegacyLoopTaskStoreFile(filePath: string): void {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      throw new Error("legacy Loop task store format invalid");
    }
    const migratedJson = migrateLegacyLoopJson(parsed, DATA_DIR).value as LoopTaskStore;
    const migratedStore = ensureLoopTaskStore(migratedJson, { sourceFile: filePath });
    for (const task of migratedStore.tasks) {
      const targetFile = buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId ?? null, task.id);
      const migratedTask: LoopTaskRecord = {
        ...task,
        taskStoreFile: targetFile,
      };
      const targetStore = readLoopTaskStore(targetFile);
      const existingIndex = targetStore.tasks.findIndex((item) => item.id === task.id);
      let expectedUpdatedAt = migratedTask.updatedAt;
      if (existingIndex < 0) {
        targetStore.tasks.push(migratedTask);
      } else if (targetStore.tasks[existingIndex].updatedAt <= migratedTask.updatedAt) {
        targetStore.tasks[existingIndex] = migratedTask;
      } else {
        expectedUpdatedAt = targetStore.tasks[existingIndex].updatedAt;
      }
      writeLoopTaskStore(targetFile, targetStore);
      const persistedTask = readLoopTaskStore(targetFile).tasks.find((item) => item.id === task.id);
      if (!persistedTask || persistedTask.updatedAt < expectedUpdatedAt || persistedTask.taskStoreFile !== targetFile) {
        throw new Error(`Loop task migration verification failed: ${task.id}`);
      }
      loopTaskStoreFileCache.set(task.id, targetFile);
    }
    fs.unlinkSync(filePath);
  } catch (error) {
    void logError("loop-legacy-task-store-migration-error", {
      filePath,
      error: String(error),
    });
  }
}

function migrateLegacyLoopCommunicationStorage(): boolean {
  const sourceDir = LEGACY_LOOP_STORAGE_PATHS.communicationDir;
  if (!fs.existsSync(sourceDir)) {
    return true;
  }
  try {
    const sourceStats = fs.lstatSync(sourceDir);
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
      throw new Error("legacy Loop communication root must be a real directory");
    }
    assertLoopMigrationTreeHasNoSymlinks(sourceDir);
    if (!fs.existsSync(LOOP_COMMUNICATION_DIR)) {
      fs.mkdirSync(path.dirname(LOOP_COMMUNICATION_DIR), { recursive: true });
      fs.renameSync(sourceDir, LOOP_COMMUNICATION_DIR);
      return true;
    }
    const targetStats = fs.lstatSync(LOOP_COMMUNICATION_DIR);
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      throw new Error("Loop communication root must be a real directory");
    }
    mergeLegacyLoopDirectory(sourceDir, LOOP_COMMUNICATION_DIR);
    fs.rmSync(sourceDir, { recursive: true, force: true });
    return !fs.existsSync(sourceDir);
  } catch (error) {
    void logError("loop-legacy-communication-migration-error", {
      sourceDir,
      targetDir: LOOP_COMMUNICATION_DIR,
      error: String(error),
    });
    return false;
  }
}

function mergeLegacyLoopDirectory(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const sourceStats = fs.lstatSync(sourcePath);
    if (sourceStats.isSymbolicLink()) {
      throw new Error(`Loop communication migration refuses symlink: ${sourcePath}`);
    }
    if (!fs.existsSync(targetPath)) {
      copyLoopMigrationEntry(sourcePath, targetPath, sourceStats);
      continue;
    }
    const targetStats = fs.lstatSync(targetPath);
    if (targetStats.isSymbolicLink()) {
      throw new Error(`Loop communication migration refuses target symlink: ${targetPath}`);
    }
    if (sourceStats.isDirectory() && targetStats.isDirectory()) {
      mergeLegacyLoopDirectory(sourcePath, targetPath);
      continue;
    }
    if (sourceStats.isFile() && targetStats.isFile() && filesHaveEqualContent(sourcePath, targetPath)) {
      continue;
    }
    copyLoopMigrationConflict(sourcePath, targetPath, sourceStats);
  }
}

function copyLoopMigrationEntry(sourcePath: string, targetPath: string, sourceStats: fs.Stats): void {
  if (sourceStats.isDirectory()) {
    mergeLegacyLoopDirectory(sourcePath, targetPath);
    return;
  }
  if (sourceStats.isFile()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    return;
  }
  throw new Error(`Loop communication migration refuses special file: ${sourcePath}`);
}

function assertLoopMigrationTreeHasNoSymlinks(rootDir: string): void {
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      const stats = fs.lstatSync(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Loop communication migration refuses symlink: ${entryPath}`);
      }
      if (stats.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }
}

function filesHaveEqualContent(left: string, right: string): boolean {
  const leftStats = fs.statSync(left);
  const rightStats = fs.statSync(right);
  return leftStats.size === rightStats.size && fs.readFileSync(left).equals(fs.readFileSync(right));
}

function copyLoopMigrationConflict(sourcePath: string, targetPath: string, sourceStats: fs.Stats): void {
  const extension = path.extname(targetPath);
  const base = targetPath.slice(0, targetPath.length - extension.length);
  let sequence = 0;
  while (true) {
    const suffix = sequence === 0 ? ".pre-loop-migration" : `.pre-loop-migration-${sequence}`;
    const candidate = `${base}${suffix}${extension}`;
    if (!fs.existsSync(candidate)) {
      copyLoopMigrationEntry(sourcePath, candidate, sourceStats);
      return;
    }
    const candidateStats = fs.lstatSync(candidate);
    if (candidateStats.isSymbolicLink()) {
      throw new Error(`Loop communication migration refuses conflict symlink: ${candidate}`);
    }
    if (sourceStats.isFile() && candidateStats.isFile() && filesHaveEqualContent(sourcePath, candidate)) {
      return;
    }
    if (sourceStats.isDirectory() && candidateStats.isDirectory()) {
      mergeLegacyLoopDirectory(sourcePath, candidate);
      return;
    }
    sequence += 1;
  }
}

function removeEmptyDirectories(rootDir: string): void {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  const rootStats = fs.lstatSync(rootDir);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    return;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(rootDir, entry.name));
    }
  }
  if (fs.existsSync(rootDir) && fs.readdirSync(rootDir).length === 0) {
    fs.rmdirSync(rootDir);
  }
}

function resolveLoopTaskStoreFileForTask(taskId: string): string | null {
  const cached = loopTaskStoreFileCache.get(taskId);
  if (cached && fs.existsSync(cached)) {
    const cachedStore = readLoopTaskStore(cached);
    if (cachedStore.tasks.some((task) => task.id === taskId)) {
      return cached;
    }
    loopTaskStoreFileCache.delete(taskId);
  }
  const candidateFiles = listLoopTaskStoreFiles();
  for (const filePath of candidateFiles) {
    const store = readLoopTaskStore(filePath);
    if (store.tasks.some((task) => task.id === taskId)) {
      loopTaskStoreFileCache.set(taskId, filePath);
      return filePath;
    }
  }
  return null;
}

export function getLoopCommunicationPaths(taskId: string): LoopCommunicationPaths {
  const dir = path.join(LOOP_COMMUNICATION_DIR, taskId);
  return {
    dir,
    mainFile: path.join(dir, "main-task.md"),
    subtasksDir: path.join(dir, "subtasks"),
  };
}

export function ensureLoopCommunicationFiles(taskId: string, rootPrompt: string): LoopCommunicationPaths {
  const paths = getLoopCommunicationPaths(taskId);
  try {
    fs.mkdirSync(paths.subtasksDir, { recursive: true });
    if (!fs.existsSync(paths.mainFile)) {
      fs.writeFileSync(paths.mainFile, [
        `# Loop 任务沟通文件`,
        ``,
        `- 任务 ID：${taskId}`,
        `- 创建时间：${new Date().toISOString()}`,
        ``,
        `## 原始目标`,
        rootPrompt,
        ``,
        `## 主任务复核记录`,
      ].join("\n"), "utf8");
    }
  } catch (error) {
    void logError("loop-communication-init-error", { taskId, error: String(error) });
  }
  return paths;
}

export function buildLoopSubtaskCommunicationFile(taskId: string, subtaskId: string, round: number, retryCount: number): string {
  const safeSubtaskId = subtaskId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const retrySuffix = retryCount > 0 ? `-retry-${retryCount}` : "";
  return path.join(getLoopCommunicationPaths(taskId).subtasksDir, `round-${round}-${safeSubtaskId}${retrySuffix}.md`);
}

export function prepareLoopSubtaskCommunicationFile(
  task: LoopTaskRecord,
  subtask: LoopSubtaskRecord,
  round: number,
  retryCount: number
): string {
  const filePath = buildLoopSubtaskCommunicationFile(task.id, subtask.id, round, retryCount);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, [
        `# 子任务沟通文件`,
        ``,
        `- Loop 任务 ID：${task.id}`,
        `- 子任务 ID：${subtask.id}`,
        `- 子任务标题：${subtask.title}`,
        `- 授权写入文件/范围：${formatLoopWriteFiles(subtask.writeFiles) ?? "未声明；以子任务指令为准"}`,
        `- 轮次：${round}`,
        `- 重试次数：${retryCount}`,
        `- 创建时间：${new Date().toISOString()}`,
        ``,
        `## 执行报告`,
        `请在本节写清：执行目标、实际修改/操作、涉及文件、验证命令与结果、遗留问题、给主任务的建议。`,
        ``,
        `## 待主任务确认`,
        `- 当前状态：无`,
        `- 待确认问题：无`,
        `- 已知事实：无`,
        `- 影响/阻塞步骤：无`,
        `- 可选方案：无`,
        `- 推荐方案：无`,
        ``,
        `如出现必须由主任务或用户确认后才能继续的问题，请立即停止实施，把当前状态改为“待确认”并补全本节；不要在 assistant 回复中提问或复述问题。`,
      ].join("\n"), "utf8");
    }
  } catch (error) {
    void logError("loop-subtask-communication-init-error", { taskId: task.id, subtaskId: subtask.id, filePath, error: String(error) });
  }
  updateLoopSubtaskCommunicationFile(task.id, subtask.id, filePath);
  return filePath;
}

function updateLoopSubtaskCommunicationFile(taskId: string, subtaskId: string, filePath: string): void {
  const task = readLoopTaskRecord(taskId);
  if (!task) {
    return;
  }
  const subTasks = task.subTasks.map((item) => item.id === subtaskId ? { ...item, communicationFile: filePath, updatedAt: Date.now() } : item);
  updateLoopTaskRecord(taskId, { subTasks, updatedAt: Date.now() });
}

export function readLoopTaskRecord(taskId: string): LoopTaskRecord | null {
  const storeFile = resolveLoopTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return null;
  }
  const task = readLoopTaskStore(storeFile).tasks.find((item) => item.id === taskId) ?? null;
  if (!task) {
    return null;
  }
  if (task.taskStoreFile !== storeFile) {
    return { ...task, taskStoreFile: storeFile };
  }
  return task;
}

export function updateLoopTaskRecord(
  taskId: string,
  patch: Partial<LoopTaskRecord>,
  options: { allowCompletedToRunning?: boolean } = {}
): LoopTaskRecord | null {
  const storeFile = resolveLoopTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return null;
  }
  const store = readLoopTaskStore(storeFile);
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return null;
  }
  const existing = store.tasks[index];
  const nextStatus = existing.status === "completed" && patch.status === "running" && options.allowCompletedToRunning !== true
    ? existing.status
    : patch.status ?? existing.status;
  const next: LoopTaskRecord = {
    ...existing,
    ...patch,
    taskStoreFile: typeof patch.taskStoreFile === "string" && patch.taskStoreFile.trim()
      ? patch.taskStoreFile
      : existing.taskStoreFile,
    status: nextStatus,
    subTasks: Array.isArray(patch.subTasks) ? patch.subTasks : existing.subTasks,
    rounds: Array.isArray(patch.rounds) ? patch.rounds : existing.rounds,
    debateRounds: Array.isArray(patch.debateRounds) ? patch.debateRounds : existing.debateRounds,
    supplementalRequirements: Array.isArray(patch.supplementalRequirements)
      ? patch.supplementalRequirements.map((item) => String(item).trim()).filter(Boolean)
      : existing.supplementalRequirements,
    completionRoundSummaries: Array.isArray(patch.completionRoundSummaries)
      ? patch.completionRoundSummaries
      : existing.completionRoundSummaries,
    completionRequirementCoverage: Array.isArray(patch.completionRequirementCoverage)
      ? patch.completionRequirementCoverage
      : existing.completionRequirementCoverage,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
  const targetStoreFile = next.taskStoreFile;
  if (targetStoreFile !== storeFile) {
    store.tasks.splice(index, 1);
    if (store.tasks.length > 0) {
      writeLoopTaskStore(storeFile, store);
    } else if (fs.existsSync(storeFile)) {
      try {
        fs.unlinkSync(storeFile);
      } catch (error) {
        void logError("loop-task-store-delete-error", { filePath: storeFile, error: String(error) });
      }
    }
    const targetStore = readLoopTaskStore(targetStoreFile);
    const targetIndex = targetStore.tasks.findIndex((task) => task.id === taskId);
    if (targetIndex >= 0) {
      targetStore.tasks[targetIndex] = next;
    } else {
      targetStore.tasks.push(next);
    }
    writeLoopTaskStore(targetStoreFile, targetStore);
    loopTaskStoreFileCache.set(taskId, targetStoreFile);
    return next;
  }
  store.tasks[index] = next;
  writeLoopTaskStore(storeFile, store);
  loopTaskStoreFileCache.set(taskId, storeFile);
  return next;
}

export function appendLoopRound(taskId: string, round: LoopRoundRecord): void {
  const storeFile = resolveLoopTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return;
  }
  const store = readLoopTaskStore(storeFile);
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return;
  }
  const task = store.tasks[index];
  const existingRoundIndex = task.rounds.findIndex((item) => (
    item.round === round.round
    && item.role === round.role
    && (item.subtaskId ?? null) === (round.subtaskId ?? null)
  ));
  const rounds = [...task.rounds];
  if (existingRoundIndex >= 0) {
    rounds[existingRoundIndex] = { ...rounds[existingRoundIndex], ...round };
  } else {
    rounds.push(round);
  }
  store.tasks[index] = {
    ...task,
    rounds,
    currentRound: Math.max(task.currentRound, round.round),
    updatedAt: Date.now(),
  };
  writeLoopTaskStore(storeFile, store);
}

export function bindLoopTaskToSession(taskId: string, sessionId: string): LoopTaskRecord | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  const task = readLoopTaskRecord(taskId);
  if (!task) {
    return null;
  }
  const targetStoreFile = getLoopTaskStoreSessionFile(task.workspaceKey, task.cli, normalizedSessionId);
  if (task.sessionId === normalizedSessionId && task.taskStoreFile === targetStoreFile) {
    return task;
  }
  return updateLoopTaskRecord(taskId, {
    sessionId: normalizedSessionId,
    taskStoreFile: targetStoreFile,
    updatedAt: Date.now(),
  });
}

function normalizeLoopTaskRecord(record: unknown, sourceFile?: string): LoopTaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LoopTaskRecord>;
  const cli = typeof raw.cli === "string" && isCliName(raw.cli) ? raw.cli : null;
  if (typeof raw.id !== "string" || !raw.id.trim() || !cli || typeof raw.rootPrompt !== "string") {
    return null;
  }
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const status = isLoopTaskStatus(raw.status) ? raw.status : "running";
  const workspaceKey = typeof raw.workspaceKey === "string" ? raw.workspaceKey : WORKSPACE_KEY_FALLBACK;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  const normalizedSourceFile = sourceFile && (
    !isLegacyLoopTaskStorePath(sourceFile, DATA_DIR)
    || fs.existsSync(LEGACY_LOOP_STORAGE_PATHS.communicationDir)
  ) ? sourceFile : undefined;
  const taskStoreFile = typeof raw.taskStoreFile === "string" && raw.taskStoreFile.trim()
    ? raw.taskStoreFile
    : (normalizedSourceFile ?? buildLoopTaskStoreFile(cli, workspaceKey, sessionId, raw.id));
  const subTasks = Array.isArray(raw.subTasks)
    ? raw.subTasks.map(normalizeLoopSubtaskRecord).filter((item): item is LoopSubtaskRecord => Boolean(item))
    : [];
  const rounds = Array.isArray(raw.rounds)
    ? raw.rounds.map(normalizeLoopRoundRecord).filter((item): item is LoopRoundRecord => Boolean(item))
    : [];
  const completionRoundSummaries = Array.isArray(raw.completionRoundSummaries)
    ? raw.completionRoundSummaries.map(normalizeSingleLoopRoundSummary).filter((item): item is LoopRoundSummary => Boolean(item))
    : [];
  const completionRequirementCoverage = normalizeLoopAcceptanceChecks(
    (raw as { completionRequirementCoverage?: unknown }).completionRequirementCoverage
  );
  const supplementalRequirements = Array.isArray((raw as { supplementalRequirements?: unknown }).supplementalRequirements)
    ? (raw as { supplementalRequirements: unknown[] }).supplementalRequirements
      .map((item) => String(item).trim())
      .filter(Boolean)
    : [];
  const debateRounds = normalizeLoopDebateRounds((raw as { debateRounds?: unknown }).debateRounds);
  const taskKind = normalizeLoopTaskKind((raw as { taskKind?: unknown }).taskKind);
  return {
    id: raw.id,
    cli,
    workspaceKey,
    taskStoreFile,
    rootPrompt: raw.rootPrompt,
    ...(taskKind ? { taskKind } : {}),
    executionMode: normalizeLoopExecutionMode((raw as { executionMode?: unknown }).executionMode),
    status,
    createdAt,
    updatedAt,
    maxRounds: normalizeStoredLoopMaxRounds(raw.maxRounds),
    currentRound: typeof raw.currentRound === "number" ? raw.currentRound : 0,
    communicationDir: typeof raw.communicationDir === "string" ? raw.communicationDir : getLoopCommunicationPaths(raw.id).dir,
    mainCommunicationFile: typeof raw.mainCommunicationFile === "string" ? raw.mainCommunicationFile : getLoopCommunicationPaths(raw.id).mainFile,
    sessionId,
    activeSubtaskId: typeof raw.activeSubtaskId === "string" ? raw.activeSubtaskId : null,
    activeSubtaskIds: Array.isArray((raw as { activeSubtaskIds?: unknown }).activeSubtaskIds)
      ? (raw as { activeSubtaskIds: unknown[] }).activeSubtaskIds
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : (typeof raw.activeSubtaskId === "string" && raw.activeSubtaskId.trim() ? [raw.activeSubtaskId] : []),
    subTasks,
    rounds,
    answerConclusion: typeof raw.answerConclusion === "string" ? raw.answerConclusion : undefined,
    finalSummary: typeof raw.finalSummary === "string" ? raw.finalSummary : undefined,
    estimatedRemainingRounds: normalizeLoopEstimatedRemainingRounds(
      (raw as { estimatedRemainingRounds?: unknown }).estimatedRemainingRounds
    ),
    mainAiFailureCount: normalizeLoopMainAiFailureCount(
      (raw as { mainAiFailureCount?: unknown }).mainAiFailureCount
    ),
    mainAiFailureLimitReached: Boolean((raw as { mainAiFailureLimitReached?: unknown }).mainAiFailureLimitReached),
    mainAiLastFailureAt: typeof (raw as { mainAiLastFailureAt?: unknown }).mainAiLastFailureAt === "number"
      ? (raw as { mainAiLastFailureAt: number }).mainAiLastFailureAt
      : undefined,
    mainAiLastFailureMessage: typeof (raw as { mainAiLastFailureMessage?: unknown }).mainAiLastFailureMessage === "string"
      ? (raw as { mainAiLastFailureMessage: string }).mainAiLastFailureMessage
      : undefined,
    supplementalRequirements,
    debateRounds,
    completionRoundSummaries,
    completionRequirementCoverage,
  };
}

function normalizeLoopDebateRounds(value: unknown): LoopDebateRoundRecord<LoopMainDecision>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is LoopDebateRoundRecord<LoopMainDecision> => (
    Boolean(item && typeof item === "object" && !Array.isArray(item))
  ));
}

function normalizeLoopSubtaskRecord(record: unknown): LoopSubtaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LoopSubtaskRecord>;
  if (typeof raw.id !== "string" || !raw.id.trim() || typeof raw.title !== "string") {
    return null;
  }
  const status = raw.status === "pending" || raw.status === "running" || raw.status === "completed" || raw.status === "skipped" || raw.status === "blocked"
    ? raw.status
    : "pending";
  const skillIds = normalizeLoopSkillIds((raw as { skillIds?: unknown }).skillIds);
  const skillGuidance = normalizeLoopSkillGuidance((raw as { skillGuidance?: unknown }).skillGuidance);
  return {
    id: raw.id,
    title: raw.title,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    conflictGroup: typeof raw.conflictGroup === "string" ? raw.conflictGroup : undefined,
    writeFiles: normalizeLoopWriteFiles((raw as { writeFiles?: unknown }).writeFiles),
    ...(skillIds && skillGuidance ? { skillIds, skillGuidance } : {}),
    status,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    communicationFile: typeof raw.communicationFile === "string" ? raw.communicationFile : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  };
}

function normalizeLoopTaskKind(value: unknown): LoopTaskKind | undefined {
  return value === "development" || value === "non_development" ? value : undefined;
}

function normalizeLoopSkillIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const skillIds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const skillId = item.trim();
    if (!skillId || !LOOP_SKILL_ID_PATTERN.test(skillId) || skillIds.includes(skillId)) {
      continue;
    }
    skillIds.push(skillId);
    if (skillIds.length >= LOOP_MAX_SKILL_IDS_PER_SUBTASK) {
      break;
    }
  }
  return skillIds.length > 0 ? skillIds : undefined;
}

function normalizeLoopSkillGuidance(value: unknown): string | undefined {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > LOOP_MAX_SKILL_GUIDANCE_LENGTH
  ) {
    return undefined;
  }
  return value;
}

function normalizeLoopRoundRecord(record: unknown): LoopRoundRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LoopRoundRecord>;
  if (typeof raw.round !== "number" || !isLoopTaskRole(raw.role)) {
    return null;
  }
  if (raw.status !== "end" && raw.status !== "error" && raw.status !== "stopped") {
    return null;
  }
  return {
    round: raw.round,
    role: raw.role,
    subtaskId: typeof raw.subtaskId === "string" ? raw.subtaskId : undefined,
    status: raw.status,
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    endedAt: typeof raw.endedAt === "number" ? raw.endedAt : Date.now(),
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
  };
}

function isLoopTaskStatus(value: unknown): value is LoopTaskStatus {
  return value === "running" || value === "completed" || value === "needs-review" || value === "error" || value === "stopped";
}

function isLoopTaskRole(value: unknown): value is LoopTaskRole {
  return value === "main" || value === "subtask";
}

function ensureLoopTaskStore(
  store?: LoopTaskStore,
  options: { sourceFile?: string } = {}
): LoopTaskStore {
  const now = Date.now();
  const tasks = Array.isArray(store?.tasks)
    ? store.tasks
      .map((record) => normalizeLoopTaskRecord(record, options.sourceFile))
      .filter((record): record is LoopTaskRecord => Boolean(record))
      .filter((record) => isTimestampWithinHistoryRetention(record.updatedAt, now))
    : [];
  return { tasks };
}

export function readLoopTaskStore(filePath: string): LoopTaskStore {
  try {
    if (!fs.existsSync(filePath)) {
      return { tasks: [] };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const retainLegacyStoragePaths = isLegacyLoopTaskStorePath(filePath, DATA_DIR)
      && fs.existsSync(LEGACY_LOOP_STORAGE_PATHS.communicationDir);
    const parsed = migrateLegacyLoopJson(
      JSON.parse(raw),
      retainLegacyStoragePaths ? undefined : DATA_DIR,
    ).value;
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { tasks: [] };
    }
    return ensureLoopTaskStore({ tasks: parsed.tasks as LoopTaskRecord[] }, { sourceFile: filePath });
  } catch (error) {
    void logError("loop-task-store-read-error", { filePath, error: String(error) });
    return { tasks: [] };
  }
}

export function writeLoopTaskStore(filePath: string, store: LoopTaskStore): void {
  try {
    const retainLegacyStoragePaths = isLegacyLoopTaskStorePath(filePath, DATA_DIR)
      && fs.existsSync(LEGACY_LOOP_STORAGE_PATHS.communicationDir);
    const migratedStore = migrateLegacyLoopJson(
      store,
      retainLegacyStoragePaths ? undefined : DATA_DIR,
    ).value;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(ensureLoopTaskStore(migratedStore, { sourceFile: filePath }), null, 2),
      "utf8"
    );
  } catch (error) {
    void logError("loop-task-store-write-error", { filePath, error: String(error) });
  }
}

export function cleanupLoopTaskStoreRetention(): void {
  try {
    const filePaths = listLoopTaskStoreFiles();
    filePaths.forEach((filePath) => {
      const normalized = readLoopTaskStore(filePath);
      if (normalized.tasks.length > 0) {
        writeLoopTaskStore(filePath, normalized);
        normalized.tasks.forEach((task) => {
          loopTaskStoreFileCache.set(task.id, filePath);
        });
        return;
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    void logError("loop-task-store-retention-cleanup-error", { error: String(error) });
  }
}

function collectRetainedLoopTaskIds(): Set<string> {
  const retainedTaskIds = new Set<string>();
  const filePaths = listLoopTaskStoreFiles();
  filePaths.forEach((filePath) => {
    const store = readLoopTaskStore(filePath);
    store.tasks.forEach((task) => {
      retainedTaskIds.add(task.id);
    });
  });
  return retainedTaskIds;
}

function getLatestMtimeMsInTree(rootPath: string): number {
  let latestMtimeMs = 0;
  const stack = [rootPath];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }
    let stats: fs.Stats;
    try {
      stats = fs.statSync(currentPath);
    } catch {
      continue;
    }
    if (Number.isFinite(stats.mtimeMs)) {
      latestMtimeMs = Math.max(latestMtimeMs, stats.mtimeMs);
    }
    if (!stats.isDirectory()) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.forEach((entry) => {
      stack.push(path.join(currentPath, entry.name));
    });
  }
  return latestMtimeMs;
}

export function cleanupLoopCommunicationRetention(): void {
  try {
    if (!fs.existsSync(LOOP_COMMUNICATION_DIR)) {
      return;
    }
    const now = Date.now();
    const retainedTaskIds = collectRetainedLoopTaskIds();
    const entries = fs.readdirSync(LOOP_COMMUNICATION_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isDirectory()) {
        return;
      }
      const taskId = entry.name;
      if (retainedTaskIds.has(taskId)) {
        return;
      }
      const dirPath = path.join(LOOP_COMMUNICATION_DIR, taskId);
      const latestTouchedAt = getLatestMtimeMsInTree(dirPath);
      if (isTimestampWithinHistoryRetention(latestTouchedAt, now)) {
        return;
      }
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (error) {
        void logError("loop-communication-retention-delete-error", {
          taskId,
          dirPath,
          error: String(error),
        });
      }
    });
    if (fs.existsSync(LOOP_COMMUNICATION_DIR) && fs.readdirSync(LOOP_COMMUNICATION_DIR).length === 0) {
      fs.rmSync(LOOP_COMMUNICATION_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    void logError("loop-communication-retention-cleanup-error", { error: String(error) });
  }
}

function normalizeLoopEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), LOOP_MAX_MAX_ROUNDS);
}

function normalizeStoredLoopMaxRounds(value: unknown): number {
  const rawValue = parseLoopMaxRoundsValue(value);
  if (rawValue === null) {
    return LOOP_DEFAULT_MAX_ROUNDS;
  }
  return rawValue;
}

function parseLoopMaxRoundsValue(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(Math.max(Math.floor(numeric), LOOP_MIN_MAX_ROUNDS), LOOP_MAX_MAX_ROUNDS);
}

function normalizeSingleLoopRoundSummary(value: unknown): LoopRoundSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const summary = value as {
    round?: unknown;
    subtaskId?: unknown;
    title?: unknown;
    summary?: unknown;
  };
  const round = typeof summary.round === "number" && summary.round > 0
    ? Math.floor(summary.round)
    : null;
  const title = typeof summary.title === "string" ? summary.title.trim() : "";
  const content = typeof summary.summary === "string" ? summary.summary.trim() : "";
  if (!round || !title || !content) {
    return null;
  }
  return {
    round,
    subtaskId: typeof summary.subtaskId === "string" && summary.subtaskId.trim()
      ? summary.subtaskId.trim()
      : undefined,
    title,
    summary: content,
  };
}

function normalizeLoopAcceptanceChecks(value: unknown): LoopAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): LoopAcceptanceCheck | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const check = item as { name?: unknown; passed?: unknown; detail?: unknown };
      const name = typeof check.name === "string" && check.name.trim() ? check.name.trim() : "acceptance";
      return {
        name,
        passed: check.passed === true,
        detail: typeof check.detail === "string" ? check.detail : undefined,
      };
    })
    .filter((item): item is LoopAcceptanceCheck => Boolean(item));
}

function formatLoopWriteFiles(writeFiles?: string[]): string | null {
  if (!Array.isArray(writeFiles) || writeFiles.length === 0) {
    return null;
  }
  return writeFiles.join("、");
}
