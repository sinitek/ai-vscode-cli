import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CLI_LIST,
  type CliName,
  type LobsterExecutionMode,
  normalizeLobsterExecutionMode,
} from "./cli/types";
import { isTimestampWithinHistoryRetention } from "./historyRetention";
import { logError } from "./logger";
import { normalizeLobsterMainAiFailureCount } from "./lobsterMainFailure";
import { normalizeLobsterWriteFiles } from "./lobsterParallel";
import type { LobsterDebateRoundRecord } from "./lobsterDebate";

const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const WORKSPACE_KEY_FALLBACK = "no-workspace";
const LOBSTER_TASK_STORE_DIR = path.join(DATA_DIR, "lobster-tasks");
const LOBSTER_TASK_STORE_FILENAME = "lobster-tasks.json";
const LOBSTER_TASK_STORE_LEGACY_FILE = path.join(DATA_DIR, LOBSTER_TASK_STORE_FILENAME);
const LOBSTER_COMMUNICATION_DIR = path.join(DATA_DIR, "lobster-communications");
const LOBSTER_DEFAULT_MAX_ROUNDS = 20;
const LOBSTER_MIN_MAX_ROUNDS = 1;
const LOBSTER_MAX_MAX_ROUNDS = 100;

const lobsterTaskStoreFileCache = new Map<string, string>();

export type LobsterTaskRole = "main" | "subtask";
export type LobsterTaskStatus = "running" | "completed" | "needs-review" | "error" | "stopped";
export type LobsterRunStatus = "end" | "error" | "stopped";

export type LobsterSubtaskRecord = {
  id: string;
  title: string;
  prompt?: string;
  conflictGroup?: string;
  writeFiles?: string[];
  status: "pending" | "running" | "completed" | "skipped" | "blocked";
  summary?: string;
  communicationFile?: string;
  updatedAt?: number;
};

export type LobsterAcceptanceCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type LobsterAcceptance = {
  passed: boolean;
  summary?: string;
  checks: LobsterAcceptanceCheck[];
};

export type LobsterRoundSummary = {
  round: number;
  subtaskId?: string;
  title: string;
  summary: string;
};

export type LobsterSubtaskDecision = {
  id?: string;
  title: string;
  prompt: string;
  conflictGroup?: string;
  writeFiles?: string[];
};

export type LobsterMainDecision = {
  status: "completed" | "continue" | "blocked";
  answerConclusion?: string;
  finalSummary?: string;
  roundSummaries?: LobsterRoundSummary[];
  requirementCoverage?: LobsterAcceptanceCheck[];
  acceptance?: LobsterAcceptance;
  subtask?: LobsterSubtaskDecision;
  subtasks?: LobsterSubtaskDecision[];
  parallelReason?: string;
  estimatedRemainingRounds?: number;
};

export type LobsterRoundRecord = {
  round: number;
  role: LobsterTaskRole;
  subtaskId?: string;
  status: LobsterRunStatus;
  startedAt: number;
  endedAt: number;
  summary?: string;
};

export type LobsterTaskRecord = {
  id: string;
  cli: CliName;
  workspaceKey: string;
  taskStoreFile: string;
  rootPrompt: string;
  executionMode?: LobsterExecutionMode;
  status: LobsterTaskStatus;
  createdAt: number;
  updatedAt: number;
  maxRounds: number;
  currentRound: number;
  communicationDir: string;
  mainCommunicationFile: string;
  sessionId?: string | null;
  activeSubtaskId?: string | null;
  activeSubtaskIds?: string[];
  subTasks: LobsterSubtaskRecord[];
  rounds: LobsterRoundRecord[];
  answerConclusion?: string;
  finalSummary?: string;
  estimatedRemainingRounds?: number;
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
  mainAiLastFailureAt?: number;
  mainAiLastFailureMessage?: string;
  supplementalRequirements?: string[];
  debateRounds?: LobsterDebateRoundRecord<LobsterMainDecision>[];
  completionRoundSummaries: LobsterRoundSummary[];
  completionRequirementCoverage: LobsterAcceptanceCheck[];
};

export type LobsterTaskStore = {
  tasks: LobsterTaskRecord[];
};

export function buildLobsterSessionIdsByCli(
  tasks: readonly Pick<LobsterTaskRecord, "cli" | "sessionId">[]
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

export type LobsterCommunicationPaths = {
  dir: string;
  mainFile: string;
  subtasksDir: string;
};

function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

function sanitizeLobsterPathSegment(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || fallback;
}

export function getLobsterTaskStoreSessionFile(workspaceKey: string, cli: CliName, sessionId: string): string {
  const workspaceSegment = sanitizeLobsterPathSegment(workspaceKey, WORKSPACE_KEY_FALLBACK);
  const sessionSegment = sanitizeLobsterPathSegment(sessionId, "session");
  return path.join(LOBSTER_TASK_STORE_DIR, workspaceSegment, cli, sessionSegment, LOBSTER_TASK_STORE_FILENAME);
}

function getLobsterTaskStorePendingFile(workspaceKey: string, cli: CliName, taskId: string): string {
  const workspaceSegment = sanitizeLobsterPathSegment(workspaceKey, WORKSPACE_KEY_FALLBACK);
  const taskSegment = sanitizeLobsterPathSegment(taskId, "task");
  return path.join(
    LOBSTER_TASK_STORE_DIR,
    workspaceSegment,
    cli,
    "__pending__",
    taskSegment,
    LOBSTER_TASK_STORE_FILENAME
  );
}

export function buildLobsterTaskStoreFile(cli: CliName, workspaceKey: string, sessionId: string | null, taskId: string): string {
  if (sessionId && sessionId.trim()) {
    return getLobsterTaskStoreSessionFile(workspaceKey, cli, sessionId);
  }
  return getLobsterTaskStorePendingFile(workspaceKey, cli, taskId);
}

function collectLobsterTaskStoreFilesFromDir(dirPath: string): string[] {
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
      void logError("lobster-task-store-readdir-error", { dirPath: current, error: String(error) });
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (entry.isFile() && entry.name === LOBSTER_TASK_STORE_FILENAME) {
        collected.push(fullPath);
      }
    });
  }
  return collected;
}

export function listLobsterTaskStoreFiles(): string[] {
  const files = collectLobsterTaskStoreFilesFromDir(LOBSTER_TASK_STORE_DIR);
  if (fs.existsSync(LOBSTER_TASK_STORE_LEGACY_FILE)) {
    files.push(LOBSTER_TASK_STORE_LEGACY_FILE);
  }
  return Array.from(new Set(files));
}

function resolveLobsterTaskStoreFileForTask(taskId: string): string | null {
  const cached = lobsterTaskStoreFileCache.get(taskId);
  if (cached && fs.existsSync(cached)) {
    const cachedStore = readLobsterTaskStore(cached);
    if (cachedStore.tasks.some((task) => task.id === taskId)) {
      return cached;
    }
    lobsterTaskStoreFileCache.delete(taskId);
  }
  const candidateFiles = listLobsterTaskStoreFiles();
  for (const filePath of candidateFiles) {
    const store = readLobsterTaskStore(filePath);
    if (store.tasks.some((task) => task.id === taskId)) {
      lobsterTaskStoreFileCache.set(taskId, filePath);
      return filePath;
    }
  }
  return null;
}

export function getLobsterCommunicationPaths(taskId: string): LobsterCommunicationPaths {
  const dir = path.join(LOBSTER_COMMUNICATION_DIR, taskId);
  return {
    dir,
    mainFile: path.join(dir, "main-task.md"),
    subtasksDir: path.join(dir, "subtasks"),
  };
}

export function ensureLobsterCommunicationFiles(taskId: string, rootPrompt: string): LobsterCommunicationPaths {
  const paths = getLobsterCommunicationPaths(taskId);
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
    void logError("lobster-communication-init-error", { taskId, error: String(error) });
  }
  return paths;
}

export function buildLobsterSubtaskCommunicationFile(taskId: string, subtaskId: string, round: number, retryCount: number): string {
  const safeSubtaskId = subtaskId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const retrySuffix = retryCount > 0 ? `-retry-${retryCount}` : "";
  return path.join(getLobsterCommunicationPaths(taskId).subtasksDir, `round-${round}-${safeSubtaskId}${retrySuffix}.md`);
}

export function prepareLobsterSubtaskCommunicationFile(
  task: LobsterTaskRecord,
  subtask: LobsterSubtaskRecord,
  round: number,
  retryCount: number
): string {
  const filePath = buildLobsterSubtaskCommunicationFile(task.id, subtask.id, round, retryCount);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, [
        `# 子任务沟通文件`,
        ``,
        `- Loop 任务 ID：${task.id}`,
        `- 子任务 ID：${subtask.id}`,
        `- 子任务标题：${subtask.title}`,
        `- 授权写入文件/范围：${formatLobsterWriteFiles(subtask.writeFiles) ?? "未声明；以子任务指令为准"}`,
        `- 轮次：${round}`,
        `- 重试次数：${retryCount}`,
        `- 创建时间：${new Date().toISOString()}`,
        ``,
        `## 执行报告`,
        `请在本节写清：执行目标、实际修改/操作、涉及文件、验证命令与结果、遗留问题、给主任务的建议。`,
      ].join("\n"), "utf8");
    }
  } catch (error) {
    void logError("lobster-subtask-communication-init-error", { taskId: task.id, subtaskId: subtask.id, filePath, error: String(error) });
  }
  updateLobsterSubtaskCommunicationFile(task.id, subtask.id, filePath);
  return filePath;
}

function updateLobsterSubtaskCommunicationFile(taskId: string, subtaskId: string, filePath: string): void {
  const task = readLobsterTaskRecord(taskId);
  if (!task) {
    return;
  }
  const subTasks = task.subTasks.map((item) => item.id === subtaskId ? { ...item, communicationFile: filePath, updatedAt: Date.now() } : item);
  updateLobsterTaskRecord(taskId, { subTasks, updatedAt: Date.now() });
}

export function readLobsterTaskRecord(taskId: string): LobsterTaskRecord | null {
  const storeFile = resolveLobsterTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return null;
  }
  const task = readLobsterTaskStore(storeFile).tasks.find((item) => item.id === taskId) ?? null;
  if (!task) {
    return null;
  }
  if (task.taskStoreFile !== storeFile) {
    return { ...task, taskStoreFile: storeFile };
  }
  return task;
}

export function updateLobsterTaskRecord(
  taskId: string,
  patch: Partial<LobsterTaskRecord>,
  options: { allowCompletedToRunning?: boolean } = {}
): LobsterTaskRecord | null {
  const storeFile = resolveLobsterTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return null;
  }
  const store = readLobsterTaskStore(storeFile);
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return null;
  }
  const existing = store.tasks[index];
  const nextStatus = existing.status === "completed" && patch.status === "running" && options.allowCompletedToRunning !== true
    ? existing.status
    : patch.status ?? existing.status;
  const next: LobsterTaskRecord = {
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
      writeLobsterTaskStore(storeFile, store);
    } else if (fs.existsSync(storeFile)) {
      try {
        fs.unlinkSync(storeFile);
      } catch (error) {
        void logError("lobster-task-store-delete-error", { filePath: storeFile, error: String(error) });
      }
    }
    const targetStore = readLobsterTaskStore(targetStoreFile);
    const targetIndex = targetStore.tasks.findIndex((task) => task.id === taskId);
    if (targetIndex >= 0) {
      targetStore.tasks[targetIndex] = next;
    } else {
      targetStore.tasks.push(next);
    }
    writeLobsterTaskStore(targetStoreFile, targetStore);
    lobsterTaskStoreFileCache.set(taskId, targetStoreFile);
    return next;
  }
  store.tasks[index] = next;
  writeLobsterTaskStore(storeFile, store);
  lobsterTaskStoreFileCache.set(taskId, storeFile);
  return next;
}

export function appendLobsterRound(taskId: string, round: LobsterRoundRecord): void {
  const storeFile = resolveLobsterTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return;
  }
  const store = readLobsterTaskStore(storeFile);
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
  writeLobsterTaskStore(storeFile, store);
}

export function bindLobsterTaskToSession(taskId: string, sessionId: string): LobsterTaskRecord | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  const task = readLobsterTaskRecord(taskId);
  if (!task) {
    return null;
  }
  const targetStoreFile = getLobsterTaskStoreSessionFile(task.workspaceKey, task.cli, normalizedSessionId);
  if (task.sessionId === normalizedSessionId && task.taskStoreFile === targetStoreFile) {
    return task;
  }
  return updateLobsterTaskRecord(taskId, {
    sessionId: normalizedSessionId,
    taskStoreFile: targetStoreFile,
    updatedAt: Date.now(),
  });
}

function normalizeLobsterTaskRecord(record: unknown, sourceFile?: string): LobsterTaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LobsterTaskRecord>;
  const cli = typeof raw.cli === "string" && isCliName(raw.cli) ? raw.cli : null;
  if (typeof raw.id !== "string" || !raw.id.trim() || !cli || typeof raw.rootPrompt !== "string") {
    return null;
  }
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const status = isLobsterTaskStatus(raw.status) ? raw.status : "running";
  const workspaceKey = typeof raw.workspaceKey === "string" ? raw.workspaceKey : WORKSPACE_KEY_FALLBACK;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  const taskStoreFile = typeof raw.taskStoreFile === "string" && raw.taskStoreFile.trim()
    ? raw.taskStoreFile
    : (sourceFile ?? buildLobsterTaskStoreFile(cli, workspaceKey, sessionId, raw.id));
  const subTasks = Array.isArray(raw.subTasks)
    ? raw.subTasks.map(normalizeLobsterSubtaskRecord).filter((item): item is LobsterSubtaskRecord => Boolean(item))
    : [];
  const rounds = Array.isArray(raw.rounds)
    ? raw.rounds.map(normalizeLobsterRoundRecord).filter((item): item is LobsterRoundRecord => Boolean(item))
    : [];
  const completionRoundSummaries = Array.isArray(raw.completionRoundSummaries)
    ? raw.completionRoundSummaries.map(normalizeSingleLobsterRoundSummary).filter((item): item is LobsterRoundSummary => Boolean(item))
    : [];
  const completionRequirementCoverage = normalizeLobsterAcceptanceChecks(
    (raw as { completionRequirementCoverage?: unknown }).completionRequirementCoverage
  );
  const supplementalRequirements = Array.isArray((raw as { supplementalRequirements?: unknown }).supplementalRequirements)
    ? (raw as { supplementalRequirements: unknown[] }).supplementalRequirements
      .map((item) => String(item).trim())
      .filter(Boolean)
    : [];
  const debateRounds = normalizeLobsterDebateRounds((raw as { debateRounds?: unknown }).debateRounds);
  return {
    id: raw.id,
    cli,
    workspaceKey,
    taskStoreFile,
    rootPrompt: raw.rootPrompt,
    executionMode: normalizeLobsterExecutionMode((raw as { executionMode?: unknown }).executionMode),
    status,
    createdAt,
    updatedAt,
    maxRounds: normalizeStoredLobsterMaxRounds(raw.maxRounds),
    currentRound: typeof raw.currentRound === "number" ? raw.currentRound : 0,
    communicationDir: typeof raw.communicationDir === "string" ? raw.communicationDir : getLobsterCommunicationPaths(raw.id).dir,
    mainCommunicationFile: typeof raw.mainCommunicationFile === "string" ? raw.mainCommunicationFile : getLobsterCommunicationPaths(raw.id).mainFile,
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
    estimatedRemainingRounds: normalizeLobsterEstimatedRemainingRounds(
      (raw as { estimatedRemainingRounds?: unknown }).estimatedRemainingRounds
    ),
    mainAiFailureCount: normalizeLobsterMainAiFailureCount(
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

function normalizeLobsterDebateRounds(value: unknown): LobsterDebateRoundRecord<LobsterMainDecision>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is LobsterDebateRoundRecord<LobsterMainDecision> => (
    Boolean(item && typeof item === "object" && !Array.isArray(item))
  ));
}

function normalizeLobsterSubtaskRecord(record: unknown): LobsterSubtaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LobsterSubtaskRecord>;
  if (typeof raw.id !== "string" || !raw.id.trim() || typeof raw.title !== "string") {
    return null;
  }
  const status = raw.status === "pending" || raw.status === "running" || raw.status === "completed" || raw.status === "skipped" || raw.status === "blocked"
    ? raw.status
    : "pending";
  return {
    id: raw.id,
    title: raw.title,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    conflictGroup: typeof raw.conflictGroup === "string" ? raw.conflictGroup : undefined,
    writeFiles: normalizeLobsterWriteFiles((raw as { writeFiles?: unknown }).writeFiles),
    status,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    communicationFile: typeof raw.communicationFile === "string" ? raw.communicationFile : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  };
}

function normalizeLobsterRoundRecord(record: unknown): LobsterRoundRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LobsterRoundRecord>;
  if (typeof raw.round !== "number" || !isLobsterTaskRole(raw.role)) {
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

function isLobsterTaskStatus(value: unknown): value is LobsterTaskStatus {
  return value === "running" || value === "completed" || value === "needs-review" || value === "error" || value === "stopped";
}

function isLobsterTaskRole(value: unknown): value is LobsterTaskRole {
  return value === "main" || value === "subtask";
}

function ensureLobsterTaskStore(
  store?: LobsterTaskStore,
  options: { sourceFile?: string } = {}
): LobsterTaskStore {
  const now = Date.now();
  const tasks = Array.isArray(store?.tasks)
    ? store.tasks
      .map((record) => normalizeLobsterTaskRecord(record, options.sourceFile))
      .filter((record): record is LobsterTaskRecord => Boolean(record))
      .filter((record) => isTimestampWithinHistoryRetention(record.updatedAt, now))
    : [];
  return { tasks };
}

export function readLobsterTaskStore(filePath: string): LobsterTaskStore {
  try {
    if (!fs.existsSync(filePath)) {
      return { tasks: [] };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { tasks: [] };
    }
    return ensureLobsterTaskStore({ tasks: parsed.tasks as LobsterTaskRecord[] }, { sourceFile: filePath });
  } catch (error) {
    void logError("lobster-task-store-read-error", { filePath, error: String(error) });
    return { tasks: [] };
  }
}

export function writeLobsterTaskStore(filePath: string, store: LobsterTaskStore): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(ensureLobsterTaskStore(store, { sourceFile: filePath }), null, 2),
      "utf8"
    );
  } catch (error) {
    void logError("lobster-task-store-write-error", { filePath, error: String(error) });
  }
}

export function cleanupLobsterTaskStoreRetention(): void {
  try {
    const filePaths = listLobsterTaskStoreFiles();
    filePaths.forEach((filePath) => {
      const normalized = readLobsterTaskStore(filePath);
      if (normalized.tasks.length > 0) {
        writeLobsterTaskStore(filePath, normalized);
        normalized.tasks.forEach((task) => {
          lobsterTaskStoreFileCache.set(task.id, filePath);
        });
        return;
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    void logError("lobster-task-store-retention-cleanup-error", { error: String(error) });
  }
}

function collectRetainedLobsterTaskIds(): Set<string> {
  const retainedTaskIds = new Set<string>();
  const filePaths = listLobsterTaskStoreFiles();
  filePaths.forEach((filePath) => {
    const store = readLobsterTaskStore(filePath);
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

export function cleanupLobsterCommunicationRetention(): void {
  try {
    if (!fs.existsSync(LOBSTER_COMMUNICATION_DIR)) {
      return;
    }
    const now = Date.now();
    const retainedTaskIds = collectRetainedLobsterTaskIds();
    const entries = fs.readdirSync(LOBSTER_COMMUNICATION_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isDirectory()) {
        return;
      }
      const taskId = entry.name;
      if (retainedTaskIds.has(taskId)) {
        return;
      }
      const dirPath = path.join(LOBSTER_COMMUNICATION_DIR, taskId);
      const latestTouchedAt = getLatestMtimeMsInTree(dirPath);
      if (isTimestampWithinHistoryRetention(latestTouchedAt, now)) {
        return;
      }
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (error) {
        void logError("lobster-communication-retention-delete-error", {
          taskId,
          dirPath,
          error: String(error),
        });
      }
    });
    if (fs.existsSync(LOBSTER_COMMUNICATION_DIR) && fs.readdirSync(LOBSTER_COMMUNICATION_DIR).length === 0) {
      fs.rmSync(LOBSTER_COMMUNICATION_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    void logError("lobster-communication-retention-cleanup-error", { error: String(error) });
  }
}

function normalizeLobsterEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), LOBSTER_MAX_MAX_ROUNDS);
}

function normalizeStoredLobsterMaxRounds(value: unknown): number {
  const rawValue = parseLobsterMaxRoundsValue(value);
  if (rawValue === null) {
    return LOBSTER_DEFAULT_MAX_ROUNDS;
  }
  return rawValue;
}

function parseLobsterMaxRoundsValue(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(Math.max(Math.floor(numeric), LOBSTER_MIN_MAX_ROUNDS), LOBSTER_MAX_MAX_ROUNDS);
}

function normalizeSingleLobsterRoundSummary(value: unknown): LobsterRoundSummary | null {
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

function normalizeLobsterAcceptanceChecks(value: unknown): LobsterAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): LobsterAcceptanceCheck | null => {
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
    .filter((item): item is LobsterAcceptanceCheck => Boolean(item));
}

function formatLobsterWriteFiles(writeFiles?: string[]): string | null {
  if (!Array.isArray(writeFiles) || writeFiles.length === 0) {
    return null;
  }
  return writeFiles.join("、");
}
