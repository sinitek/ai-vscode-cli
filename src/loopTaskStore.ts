import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import { canMigrateOrdinaryLoopTaskIdentity, commitLoopTaskIdentities, inspectLoopTaskIdentityOwnership, isLoopTaskIdentityLockContention, locateOrdinaryLoopTaskMove, readKnownOrdinaryLoopTaskIdentity, retainOrdinaryLoopTaskIdentities, withLoopTaskIdentityRetention } from "./loopTaskIdentityCatalog";
import type { LoopBlocker } from "./loopBlocker";
import {
  CLI_LIST,
  createCliRecord,
  type CliName,
  type ThinkingMode,
} from "./cli/types";
import { isTimestampWithinHistoryRetention } from "./historyRetention";
import { logError } from "./logger";
import {
  normalizeLoopAcceptanceChecks,
  normalizeLoopEstimatedRemainingRounds,
  normalizeLoopRoundSummaries,
  type LoopAcceptanceCheck,
  type LoopRoundSummary,
} from "./loopCompletionFields";
import {
  getLegacyLoopStoragePaths,
  isLegacyLoopTaskStorePath,
  migrateLegacyLoopJson,
} from "./loopLegacyMigration";
import { normalizeLoopMainAiFailureCount } from "./loopMainFailure";
import {
  normalizeLoopPlusAcceptancePlanSnapshot,
  normalizeLoopPlusAcceptancePlanSnapshotForStorage,
  type LoopPlusAcceptancePlanSnapshot,
} from "./loopPlusAcceptancePlan";
import { normalizeLoopPlusNextStepPlan, type LoopPlusNextStepPlan } from "./loopPlusNextStepPlan";
import { readLoopPlusDependsOn } from "./loopPlusDependencies";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { parseOrchestratorClarification, type OrchestratorClarification } from "./orchestratorClarification";
import { sanitizePathSegment } from "./shared/pathSegments";
import { readLoopSubtaskModeField, type LoopSubtaskMode } from "./loopPlusSubtaskMode";
import { parseCliNameField } from "./subtaskCliRoute";
import { INVALID_SUBTASK_CLI_ROUTE } from "./subtaskCliRoute";
import { normalizeLoopSubtaskSession, readLoopContinuationSource, type LoopSubtaskSession } from "./loopSubtaskSession";
import { readDepartmentMetadataField, type DepartmentMetadata } from "./department";
import { identifier } from "./runtime/departmentexecutionidentity";

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
const CONTROLLED_ROOT_MARKER = ".department-source.json";

function canonicalExistingRoot(rootPath: string): string {
  return fs.realpathSync(path.resolve(rootPath));
}

function isControlledLoopTaskStorePath(filePath: string): boolean {
  let cursor = path.dirname(path.resolve(filePath));
  // Resolve the existing parent once, then probe only its real ancestor chain.
  // This keeps normal writes independent of the number of registered roots.
  while (true) {
    try {
      cursor = fs.realpathSync(cursor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return false;
      cursor = parent;
    }
  }
  while (true) {
    try { fs.lstatSync(path.join(cursor, CONTROLLED_ROOT_MARKER)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return false;
}

/** Internal source boundary registration. Roots stay protected until explicit unregister. */
export function registerDepartmentOwnedLoopTaskStoreRoot(rootPath: string, sourceId: string): { dispose(): void } {
  const root = canonicalExistingRoot(rootPath);
  const markerPath = path.join(root, CONTROLLED_ROOT_MARKER);
  const marker = JSON.stringify({ version: 1, sourceId });
  try { fs.writeFileSync(markerPath, marker, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let existing: unknown;
    try {
      if (!fs.lstatSync(markerPath).isFile()) throw new Error("Invalid department source marker type");
      existing = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    } catch { throw new Error("Invalid department source marker"); }
    if (!existing || typeof existing !== "object" || (existing as { version?: unknown }).version !== 1
      || (existing as { sourceId?: unknown }).sourceId !== sourceId) throw new Error("Department source marker identity mismatch");
  }
  return { dispose: () => undefined };
}

export type LoopTaskRole = "main" | "subtask";
export type LoopTaskStatus = "running" | "completed" | "needs-review" | "error" | "stopped";
export type LoopRunStatus = "end" | "error" | "stopped";
export type LoopTaskKind = "development" | "non_development";
/** Loop+ 子任务实施分类。与 LoopTaskRole、LoopTaskKind 无关。 */
export type LoopPlusTaskType = "backend" | "frontend" | "general";
export type LoopSchedulingMode = "classic" | "event_driven";
export type LoopPlusMainPhase = "decomposing";
export type { LoopSubtaskMode } from "./loopPlusSubtaskMode";

export const LOOP_PLUS_TASK_TYPES = ["backend", "frontend", "general"] as const;

export function parseLoopPlusTaskType(value: unknown): LoopPlusTaskType | undefined {
  return value === "backend" || value === "frontend" || value === "general" ? value : undefined;
}

/**
 * 显式分类与旧记录缺字段必须区分。
 * 空值或缺字段返回 undefined，调用方按原子模型/后端路由兼容。
 * 非空未知值或错误数据类型返回 null，调用方必须拒绝。
 */
export function readLoopPlusTaskTypeField(value: unknown): LoopPlusTaskType | undefined | null {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return parseLoopPlusTaskType(trimmed) ?? null;
}

export function resolveLoopSchedulingMode(value: unknown): LoopSchedulingMode {
  return typeof value === "string" && value.trim() === "event_driven" ? "event_driven" : "classic";
}

/** Host-only provenance from a successfully submitted failed review and its dispatch. */
export type LoopSubtaskRepairSource = {
  subtaskId: string;
  attemptId: string;
  finishEventId: string;
};

export type LoopSubtaskRecord = {
  dependsOn?: string[];
  repairSource?: LoopSubtaskRepairSource;
  continueFromSubtaskId?: string;
  executionSession?: LoopSubtaskSession;
  id: string;
  title: string;
  prompt?: string;
  progressWeightPercent?: number;
  conflictGroup?: string;
  writeFiles?: string[];
  /** Loop+ 实施分类。缺失表示旧记录，启动时走后端/原子模型路由。 */
  taskType?: LoopPlusTaskType;
  /** reprompt 显式声明本次交付包含编码。不从标题或正文猜测。 */
  codingDelivery?: boolean;
  /** Loop+ 主任务派发时的快照；缺省表示需要完整验收。 */
  requiresAcceptance?: boolean;
  skillIds?: string[];
  skillGuidance?: string;
  status: "pending" | "running" | "completed" | "skipped" | "blocked";
  summary?: string;
  executionFailure?: string;
  communicationFile?: string;
  updatedAt?: number;
  lastStartedAt?: number;
};

export type { LoopAcceptanceCheck, LoopRoundSummary } from "./loopCompletionFields";

export type LoopAcceptance = {
  passed: boolean;
  summary?: string;
  checks: LoopAcceptanceCheck[];
};

export type LoopSubtaskDecision = {
  dependsOn?: string[];
  continueFromSubtaskId?: string;
  id?: string;
  title: string;
  prompt: string;
  progressWeightPercent?: number;
  conflictGroup?: string;
  writeFiles?: string[];
  taskType?: LoopPlusTaskType;
  codingDelivery?: boolean;
  /** false 仅跳过完整验收，子任务结果仍须由主任务读取并处理。 */
  requiresAcceptance?: boolean;
  skillIds?: string[];
};

export type LoopMainDecision = {
  status: "completed" | "continue" | "waiting" | "blocked" | "clarify";
  directorCollaborations?: Array<{ id: string; action: "deliver" | "dismiss" }>;
  directorCollaborationIssue?: "invalid-format";
  directorProgressWeights?: Array<{ moduleId: string; progressWeightPercent: number }>;
  progressPercent?: number;
  answerConclusion?: string;
  finalSummary?: string;
  blocker?: LoopBlocker;
  /** 宿主解析得到的诊断缺项，不采信模型提供的同名字段。 */
  blockerIssue?: string;
  roundSummaries?: LoopRoundSummary[];
  requirementCoverage?: LoopAcceptanceCheck[];
  acceptance?: LoopAcceptance;
  subtask?: LoopSubtaskDecision;
  subtasks?: LoopSubtaskDecision[];
  clarification?: OrchestratorClarification;
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
  schedulingMode?: LoopSchedulingMode;
  loopPlus?: unknown;
  /** Department data is optional for legacy tasks; invalid data is explicit so execution can refuse it. */
  department?: DepartmentMetadata;
  departmentInvalid?: boolean;
  /** Host delivery receipts committed together with the Loop+ user-message queue. */
  departmentDeliveries?: Record<string, string>;
  loopPlusMainPhase?: LoopPlusMainPhase;
  loopPlusProgressPercent?: number;
  loopPlusNextStepPlan?: LoopPlusNextStepPlan;
  loopProgressPercent?: number;
  loopPlusBlockReview?: { state: "pending" | "reviewed"; summary?: string };
  /** 启动时确认的验收方案快照；缺失时主模型提示词回落到固定基线检查项。 */
  loopPlusAcceptancePlan?: LoopPlusAcceptancePlanSnapshot;
  /** 新建或续跑时绑定的子任务模式。缺失时由迁移规则解释，不随输入区事后改写。 */
  loopSubtaskMode?: LoopSubtaskMode;
  /** 记录里的模式是非法非空值。执行必须拒绝，不能猜成 fullstack 或 split。 */
  loopSubtaskModeInvalid?: boolean;
  status: LoopTaskStatus;
  /** 宿主已失去运行所有权，保留子任务关联以供手动续跑回报。用户主动停止时清除。 */
  runtimeInterrupted?: boolean;
  createdAt: number;
  updatedAt: number;
  maxRounds?: number;
  currentRound: number;
  communicationDir: string;
  mainCommunicationFile: string;
  sessionId?: string | null;
  /** Native main execution binding; sessionId above remains the local tab/store key. */
  executionSession?: LoopSubtaskSession;
  executionSessionInvalid?: boolean;
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
  mainAiLastFailureCode?: string | null;
  supplementalRequirements?: string[];
  pendingClarification?: OrchestratorClarification;
  clarificationCount?: number;
  modelRouting?: LoopTaskModelRouting;
  originProfile?: LoopTaskOriginProfile;
  completionRoundSummaries: LoopRoundSummary[];
  completionRequirementCoverage: LoopAcceptanceCheck[];
};

export type LoopTaskModelRoute = {
  cli?: CliName;
  configId?: string;
  model?: string;
  fallback?: string;
};

export type LoopTaskModelRouting = {
  main: LoopTaskModelRoute;
  /** 子-后端。旧任务的唯一子模型也写在这里。 */
  subtask: LoopTaskModelRoute;
  /** 子-前端。缺失时 Loop+ 前端任务不能启动，旧缺分类任务不读取此字段。 */
  subtaskFrontend?: LoopTaskModelRoute;
  /** 子-全栈。fullstack 模式的编码使用这一路；与后端、前端槽分开保存。 */
  subtaskFullstack?: LoopTaskModelRoute;
};

export type LoopTaskOriginProfile = {
  configId: string;
  mainThinkingMode?: ThinkingMode;
  subtaskThinkingMode?: ThinkingMode;
  subtaskFrontendThinkingMode?: ThinkingMode;
  subtaskFullstackThinkingMode?: ThinkingMode;
  mainOpenCodeVariant?: string;
  subtaskOpenCodeVariant?: string;
  subtaskFrontendOpenCodeVariant?: string;
  subtaskFullstackOpenCodeVariant?: string;
};

export type LoopTaskStore = {
  tasks: LoopTaskRecord[];
};

/** Confirmed file mutations only; failed/unknown I/O revokes completeness until rebuild.
 * Subscribers must not re-enter persistence. No read result is an incremental publication.
 */
export type LoopTaskStoreChange =
  | { type: "replace"; filePath: string; tasks: readonly LoopTaskRecord[] }
  | { type: "invalidate"; filePath?: string };
const loopTaskStoreObservers = new Set<(change: LoopTaskStoreChange) => void>();
export function subscribeLoopTaskStoreChanges(listener: (change: LoopTaskStoreChange) => void): { dispose(): void } {
  loopTaskStoreObservers.add(listener);
  return { dispose: () => { loopTaskStoreObservers.delete(listener); } };
}
function publishLoopTaskStoreChange(change: LoopTaskStoreChange): void {
  for (const listener of loopTaskStoreObservers) {
    try { listener(change); }
    catch (error) {
      // A consumer that cannot apply a mutation must discard its completeness claim.
      try { listener({ type: "invalidate" }); } catch { /* Consumer is unusable. */ }
      void logError("loop-task-store-observer-error", { error: String(error) });
    }
  }
}

/** Strict discovery for complete ownership rebuilds. Does not migrate or swallow directory errors. */
export function listLoopTaskStoreFilesStrict(): string[] {
  const files = new Set<string>();
  const visit = (directory: string, filename: string, allowMissing = true): void => {
    let entries: fs.Dirent[];
    try {
      if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Ownership discovery refuses symlink: ${directory}`);
      entries = fs.readdirSync(directory, { withFileTypes: true });
    }
    catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Ownership discovery refuses symlink: ${child}`);
      if (entry.isDirectory()) visit(child, filename, false);
      else if (entry.isFile() && entry.name === filename) files.add(child);
    }
  };
  visit(LOOP_TASK_STORE_DIR, LOOP_TASK_STORE_FILENAME);
  visit(LEGACY_LOOP_STORAGE_PATHS.taskStoreDir, path.basename(LEGACY_LOOP_STORAGE_PATHS.taskStoreFlatFile));
  for (const file of [LOOP_TASK_STORE_FLAT_FILE, LEGACY_LOOP_STORAGE_PATHS.taskStoreFlatFile]) {
    try { if (!fs.lstatSync(file).isFile()) throw new Error(`Invalid ownership source: ${file}`); files.add(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return [...files];
}

export function buildLoopSessionIdsByCli(
  tasks: readonly Pick<LoopTaskRecord, "cli" | "sessionId">[]
): Record<CliName, Set<string>> {
  const sessionIdsByCli = createCliRecord(() => new Set<string>());
  tasks.forEach((task) => {
    const sessionId = typeof task.sessionId === "string" ? task.sessionId.trim() : "";
    if (sessionId) {
      sessionIdsByCli[task.cli].add(sessionId);
    }
  });
  return sessionIdsByCli;
}

/** Trusted host-only routing. A handled failure NEVER delegates to ordinary discovery. */
export type LoopTaskHostRequest =
  | { type: "read"; taskId: string }
  | { type: "update"; taskId: string; patch: Partial<LoopTaskRecord>; options: { allowCompletedToRunning?: boolean } }
  | { type: "append"; taskId: string; round: LoopRoundRecord }
  | { type: "rebind"; taskId: string; cli?: CliName; sessionId: string | null }
  | { type: "readFile" | "deleteFile"; filePath: string }
  | { type: "retention" };
export type LoopTaskHostResult =
  | { handled: false }
  | { handled: true; ok: false }
  | { handled: true; ok: true; record?: LoopTaskRecord; store?: LoopTaskStore };
type HostRoute = {
  root: string; ids: Set<string>; active: boolean;
  route(request: LoopTaskHostRequest): LoopTaskHostResult;
};
const hostRoutes: HostRoute[] = [];
function insideRoute(root: string, file: string): boolean {
  const relative = path.relative(root, path.resolve(file));
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
/** Initialized identities must come from a complete controlled source, never model/UI fields.
 * Disposal retains identity/root tombstones. Re-registering an inactive root preserves them. */
export function registerLoopTaskStoreHostRouter(input: {
  root: string; knownTaskIds: readonly string[];
  route(request: LoopTaskHostRequest): LoopTaskHostResult;
}): { rememberTask(taskId: string): void; dispose(): void } {
  const root = canonicalExistingRoot(input.root);
  const previous = hostRoutes.find((entry) => entry.root === root);
  if (hostRoutes.some((entry) => entry.active && (insideRoute(entry.root, root) || insideRoute(root, entry.root)))) {
    throw new Error("Loop task host router overlaps an active source");
  }
  const ids = new Set([...(previous?.ids ?? []), ...input.knownTaskIds]);
  if (hostRoutes.some((entry) => entry.root !== root && [...ids].some((id) => entry.ids.has(id)))) {
    throw new Error("Loop task host router identity conflict");
  }
  const entry: HostRoute = { root, ids, active: true, route: input.route };
  if (previous) hostRoutes.splice(hostRoutes.indexOf(previous), 1);
  hostRoutes.push(entry);
  return {
    rememberTask: (id) => {
      if (!entry.active || entry.ids.has(id) || hostRoutes.some((other) => other !== entry && other.ids.has(id))) throw new Error("Loop task host identity conflict");
      entry.ids.add(id);
    },
    dispose: () => { entry.active = false; },
  };
}
function canonicalRouteFile(file: string): string {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}
function logLoopTaskUpdateRejected(stage: string, reason: string): void {
  void logError("loop-task-store-update-rejected", { stage, reason, pid: process.pid }).catch(() => undefined);
}

function routeHostRequest(request: LoopTaskHostRequest): LoopTaskHostResult {
  if ("filePath" in request) request = { ...request, filePath: canonicalRouteFile(request.filePath) };
  if (request.type === "retention") throw new Error("Retention must visit each source");
  const entry = hostRoutes.find((route) => "taskId" in request ? route.ids.has(request.taskId) : insideRoute(route.root, request.filePath));
  const reject = (reason: string): LoopTaskHostResult => {
    if (request.type === "update") logLoopTaskUpdateRejected("host-route", reason);
    return { handled: true, ok: false };
  };
  if (!entry) {
    if ("taskId" in request) {
      const ownership = inspectLoopTaskIdentityOwnership(request.taskId);
      if (ownership !== "ordinary") return reject(ownership);
    }
    return { handled: false };
  }
  if (!entry.active) return reject("owner-route-inactive");
  try {
    const result = entry.route(request);
    if (request.type === "update" && (!result.handled || !result.ok || !result.record)) return reject("owner-update-unconfirmed");
    return result.handled ? result : { handled: true, ok: false };
  } catch { return reject("owner-route-threw"); }
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
  return sanitizePathSegment(value, fallback);
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
  options: LoopTaskStoreReadOptions = {},
): string[] {
  const collected: string[] = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      publishLoopTaskStoreChange({ type: "invalidate" });
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      void logError("loop-task-store-readdir-error", { dirPath: current, error: String(error) });
      if (options.throwOnError) {
        throw error;
      }
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

export function listLoopTaskStoreFiles(options: LoopTaskStoreReadOptions = {}): string[] {
  const unmigratedLegacyFiles = migrateLegacyLoopStorage();
  const files = collectLoopTaskStoreFilesFromDir(LOOP_TASK_STORE_DIR, LOOP_TASK_STORE_FILENAME, options);
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
  try {
    for (const file of legacyFiles) {
      if (isControlledLoopTaskStorePath(file) || hostRoutes.some((entry) => insideRoute(entry.root, file))) return Array.from(new Set(legacyFiles));
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(parsed?.tasks) || parsed.tasks.some((task: LoopTaskRecord) => !task || task.department !== undefined || task.departmentInvalid
        || hostRoutes.some((entry) => entry.ids.has(task.id))
        || !canMigrateOrdinaryLoopTaskIdentity(task.id, file)
        || (typeof task.taskStoreFile === "string" && (isControlledLoopTaskStorePath(task.taskStoreFile) || hostRoutes.some((entry) => insideRoute(entry.root, task.taskStoreFile))))
        || isControlledLoopTaskStorePath(buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId ?? null, task.id)))) {
        return Array.from(new Set(legacyFiles));
      }
    }
  } catch { return Array.from(new Set(legacyFiles)); }
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
    const migratedStore = ensureLoopTaskStore(migratedJson, { sourceFile: filePath, throwOnError: true });
    for (const task of migratedStore.tasks) {
      const authority = locateOrdinaryLoopTaskMove(task.id);
      if (!authority.available) throw new Error("Loop task migration identity unavailable");
      if (authority.file) {
        const committed = readLoopTaskStore(authority.file, { throwOnError: true }).tasks.find((item) => item.id === task.id);
        if (!committed) throw new Error("Loop task migration destination unavailable");
        continue; // Known stale legacy source: cleanup only, never replay its old fields.
      }
      const targetFile = buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId ?? null, task.id);
      const migratedTask: LoopTaskRecord = {
        ...task,
        taskStoreFile: targetFile,
      };
      const targetStore = readLoopTaskStore(targetFile, { throwOnError: true });
      const existingIndex = targetStore.tasks.findIndex((item) => item.id === task.id);
      let expectedUpdatedAt = migratedTask.updatedAt;
      // On equal timestamps the already committed destination wins. A retained
      // legacy source is a retry, not evidence that its old state is newer.
      if (existingIndex < 0) {
        targetStore.tasks.push(migratedTask);
      } else if (targetStore.tasks[existingIndex].updatedAt < migratedTask.updatedAt) {
        targetStore.tasks[existingIndex] = migratedTask;
      } else {
        expectedUpdatedAt = targetStore.tasks[existingIndex].updatedAt;
      }
      commitLoopTaskStore(targetFile, targetStore, {
        taskId: task.id, sourceFile: filePath,
        sourceTasks: migratedStore.tasks.filter((item) => {
          const location = locateOrdinaryLoopTaskMove(item.id);
          if (!location.available) throw new Error("Loop task migration identity unavailable");
          return item.id !== task.id && !location.file;
        }), targetFile,
      });
      const persistedTask = readLoopTaskStore(targetFile, { throwOnError: true }).tasks.find((item) => item.id === task.id);
      if (!persistedTask || persistedTask.updatedAt < expectedUpdatedAt || persistedTask.taskStoreFile !== targetFile) {
        throw new Error(`Loop task migration verification failed: ${task.id}`);
      }
      // A retained legacy source may be retried after this task moved again.
      // Resolve all copies before choosing a location instead of caching this one.
      loopTaskStoreFileCache.delete(task.id);
    }
    if (!deleteLoopTaskStoreFile(filePath)) throw new Error("Loop task migration delete failed");
  } catch (error) {
    publishLoopTaskStoreChange({ type: "invalidate", filePath });
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
    const currentDir = stack.pop() as string;
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

type LoopTaskStoreReadOptions = { throwOnError?: boolean };

function resolveLoopTaskStoreFileForTask(taskId: string, options: LoopTaskStoreReadOptions = {}, onUnavailable?: (reason: string) => void): string | null {
  const moved = locateOrdinaryLoopTaskMove(taskId, onUnavailable);
  if (!moved.available) return null;
  if (moved.file) {
    const read = readLoopTaskStoreResult(moved.file, true, true, false, options.throwOnError);
    if (read.ok && read.store.tasks.some((task) => task.id === taskId)) {
      loopTaskStoreFileCache.set(taskId, moved.file);
      return moved.file;
    }
    onUnavailable?.("committed-move-target-unavailable");
    return null;
  }
  const cached = loopTaskStoreFileCache.get(taskId);
  if (cached) {
    const cachedStore = readLoopTaskStore(cached, options);
    if (cachedStore.tasks.some((task) => task.id === taskId)) {
      return cached;
    }
    loopTaskStoreFileCache.delete(taskId);
  }
  const candidateFiles = listLoopTaskStoreFiles(options);
  let latest: { filePath: string; updatedAt: number } | undefined;
  for (const filePath of candidateFiles) {
    const store = readLoopTaskStore(filePath, options);
    const task = store.tasks.find((item) => item.id === taskId);
    if (task && (!latest || task.updatedAt > latest.updatedAt)) {
      latest = { filePath, updatedAt: task.updatedAt };
    }
  }
  if (latest) {
    loopTaskStoreFileCache.set(taskId, latest.filePath);
    return latest.filePath;
  }
  onUnavailable?.("task-not-found");
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
        `- 建议写入文件/范围：${formatLoopWriteFiles(subtask.writeFiles) ?? "未声明；按子任务指令修改完成任务所需的文件"}`,
        `- 写入约束：建议范围不是硬限制。完成任务确实需要时可以修改其它工作区文件，并在执行报告说明原因。不要修改任务记录、调度状态或其他子任务沟通文件。`,
        `- 轮次：${round}`,
        `- 重试次数：${retryCount}`,
        `- 创建时间：${new Date().toISOString()}`,
        ``,
        `## 执行报告`,
        task.schedulingMode === "event_driven"
          ? `请在本节写清：执行目标、实际修改/操作、涉及文件、验证覆盖范围、命令或操作与结果、未执行或未覆盖项、验证后可能使结果失效的改动、遗留问题、给主任务的建议。主任务直接复用仍覆盖当前改动的执行结果，不为重新证明结果而重跑；实现、契约、改动合理性、遗漏与边界及已选附加审查仍由主任务判断，不能以自测通过替代验收审查。`
          : `请在本节写清：完成情况、实际修改/操作、涉及文件、结果、遗留问题和给主任务的建议。遵循项目既有规则自主完成工作，可一并完成用户或项目规则要求的验证；已执行的验证请汇报覆盖范围、命令或操作、结果及未完成项，便于主任务复用。补充验证只完成缺失、失败或后续改动影响的部分，不重复已覆盖且仍有效的验证；汇报不清时补充说明，不因缺少报告细节直接重测。明确要求独立验收或交叉复核时仍按独立要求执行，不能用实现自测替代；需要后续安排的独立验证或集成验证请说明要求与范围。没有相关要求时不额外增加验收或测试。`,
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

export function readLoopTaskRecord(taskId: string, options: LoopTaskStoreReadOptions = {}): LoopTaskRecord | null {
  const routed = routeHostRequest({ type: "read", taskId });
  if (routed.handled) return routed.ok ? routed.record ?? null : null;
  const storeFile = resolveLoopTaskStoreFileForTask(taskId, options);
  if (!storeFile) {
    return null;
  }
  const task = readLoopTaskStore(storeFile, options).tasks.find((item) => item.id === taskId) ?? null;
  if (!task) {
    return null;
  }
  if (task.taskStoreFile !== storeFile) {
    return { ...task, taskStoreFile: storeFile };
  }
  return task;
}

/** Ordinary group-chat fallback at an already known physical source. Never discovers stores
 * and never grants department authority when the ownership source is unavailable. */
export function readKnownOrdinaryLoopTaskRecord(taskId: string): LoopTaskRecord | null {
  if (hostRoutes.some((entry) => entry.ids.has(taskId))) return null;
  return readKnownOrdinaryLoopTaskIdentity(taskId, loopTaskStoreFileCache.get(taskId), (file) => {
    if (hostRoutes.some((entry) => insideRoute(entry.root, file))) return null;
    const result = readLoopTaskStoreResult(file, true, true);
    if (!result.ok) return null;
    const matches = result.store.tasks.filter((task) => task.id === taskId);
    const task = matches.length === 1 ? matches[0] : null;
    return task && task.department === undefined && !task.departmentInvalid ? { ...task, taskStoreFile: file } : null;
  });
}

export function updateLoopTaskRecord(
  taskId: string,
  patch: Partial<LoopTaskRecord>,
  options: { allowCompletedToRunning?: boolean } = {}
): LoopTaskRecord | null {
  const routed = routeHostRequest({ type: "update", taskId, patch, options });
  if (routed.handled) return routed.ok ? routed.record ?? null : null;
  const storeFile = resolveLoopTaskStoreFileForTask(taskId, { throwOnError: true },
    (reason) => logLoopTaskUpdateRejected("store-resolution", reason));
  if (!storeFile) {
    return null;
  }
  const read = readLoopTaskStoreResult(storeFile, true, true, false, true);
  if (!read.ok) {
    logLoopTaskUpdateRejected("source-read", "store-read-rejected");
    return null;
  }
  const store = read.store;
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    logLoopTaskUpdateRejected("source-read", "task-not-found");
    return null;
  }
  const existing = store.tasks[index];
  // An ordinary published record cannot be promoted into a trusted department record.
  if (!existing.department && !existing.departmentInvalid && (patch.department !== undefined || patch.departmentInvalid)) {
    logLoopTaskUpdateRejected("patch-validation", "department-promotion-rejected");
    return null;
  }
  const next = mergeLoopTaskRecordPatch(existing, patch, options);
  next.updatedAt = Math.max(next.updatedAt, existing.updatedAt + 1);
  const targetStoreFile = next.taskStoreFile;
  if (!isSameLoopTaskStoreFile(targetStoreFile, storeFile)) {
    const targetRead = readLoopTaskStoreResult(targetStoreFile, false, true, false, true);
    if (!targetRead.ok) {
      logLoopTaskUpdateRejected("target-read", "store-read-rejected");
      return null;
    }
    const targetStore = targetRead.store;
    const targetIndex = targetStore.tasks.findIndex((task) => task.id === taskId);
    next.updatedAt = Math.max(next.updatedAt, existing.updatedAt + 1,
      targetIndex >= 0 ? targetStore.tasks[targetIndex].updatedAt + 1 : 0);
    if (targetIndex >= 0) targetStore.tasks[targetIndex] = next;
    else targetStore.tasks.push(next);
    commitLoopTaskStore(targetStoreFile, targetStore, {
      taskId, sourceFile: storeFile, sourceTasks: store.tasks.filter((task) => task.id !== taskId), targetFile: targetStoreFile,
    });
    loopTaskStoreFileCache.set(taskId, targetStoreFile);
    // Target persistence is the commit. Cleanup failure must not make reads select the old copy.
    store.tasks.splice(index, 1);
    try {
      if (store.tasks.length > 0) {
        writeLoopTaskStore(storeFile, store);
      } else if (!deleteLoopTaskStoreFile(storeFile)) {
        throw new Error("Loop task move source cleanup delete failed");
      }
    } catch (error) {
      void logError("loop-task-store-move-cleanup-error", { taskId, filePath: storeFile, targetFile: targetStoreFile, error: String(error) });
    }
    return next;
  }
  // A lexical/case/directory alias still refers to the known physical store.
  next.taskStoreFile = storeFile;
  store.tasks[index] = next;
  commitLoopTaskStore(storeFile, store);
  loopTaskStoreFileCache.set(taskId, storeFile);
  return next;
}

/** Shared ordinary/owned update semantics; persistence and identity checks belong to the caller. */
export function mergeLoopTaskRecordPatch(existing: LoopTaskRecord, patch: Partial<LoopTaskRecord>, options: { allowCompletedToRunning?: boolean } = {}): LoopTaskRecord {
  if (Object.prototype.hasOwnProperty.call(patch, "executionSession")) {
    const native = normalizeDepartmentMainExecutionSession(patch.executionSession, existing.cli, existing.department, existing.sessionId);
    if (!native || (existing.executionSession && ["cli", "sessionId", "configId"].some((key) =>
      native[key as keyof LoopSubtaskSession] !== existing.executionSession![key as keyof LoopSubtaskSession]))) {
      throw new Error("部门组长原生会话绑定无效或不可替换");
    }
  }
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
    supplementalRequirements: Array.isArray(patch.supplementalRequirements)
      ? patch.supplementalRequirements.map((item) => String(item).trim()).filter(Boolean)
      : existing.supplementalRequirements,
    completionRoundSummaries: Array.isArray(patch.completionRoundSummaries)
      ? patch.completionRoundSummaries
      : existing.completionRoundSummaries,
    completionRequirementCoverage: Array.isArray(patch.completionRequirementCoverage)
      ? patch.completionRequirementCoverage
      : existing.completionRequirementCoverage,
    updatedAt: Math.max(existing.updatedAt, patch.updatedAt ?? Date.now()),
  };
  if (patch.department !== undefined) {
    const departmentField = readDepartmentMetadataField(patch.department);
    if (departmentField.invalid) next.departmentInvalid = true;
    else delete next.departmentInvalid;
  }
  return next;
}

/** Native identity is separate from the local tab key, and belongs to the
 * frozen leader route. This contract is shared by cold reads and writes. */
function normalizeDepartmentMainExecutionSession(value: unknown, cli: CliName, department: DepartmentMetadata | undefined,
  localSession: string | null | undefined): LoopSubtaskSession | undefined {
  const native = normalizeLoopSubtaskSession(value);
  if (!native || !value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3 || !["cli", "sessionId", "configId"].every((k) => Object.prototype.hasOwnProperty.call(value, k))
    || !CLI_LIST.includes(cli) || native.cli !== cli || department?.role !== "leader" || department.routes.leader.cli !== cli
    || cli === "opencode" && !/^ses_[A-Za-z0-9]+$/.test(native.sessionId)
    || !native.configId || native.configId !== department.routes.leader.configId
    || !identifier(native.sessionId) || native.sessionId === localSession
    || native.sessionId !== (value as LoopSubtaskSession).sessionId || native.configId !== (value as LoopSubtaskSession).configId) return undefined;
  return native;
}

/** Shared round replacement key: round + role + subtaskId. */
export function mergeLoopTaskRound(task: LoopTaskRecord, round: LoopRoundRecord): LoopTaskRecord {
  const rounds = [...task.rounds];
  const index = rounds.findIndex((item) => item.round === round.round && item.role === round.role && (item.subtaskId ?? null) === (round.subtaskId ?? null));
  if (index >= 0) rounds[index] = { ...rounds[index], ...round }; else rounds.push(round);
  return { ...task, rounds, currentRound: Math.max(task.currentRound, round.round), updatedAt: Date.now() };
}

export function ensureLoopTaskMaxRoundsAtLeast(
  task: LoopTaskRecord,
  minimumMaxRounds: number,
): LoopTaskRecord {
  const normalizedMinimum = resolveLegacyLoopMaxRounds(minimumMaxRounds);
  if (normalizedMinimum <= (task.maxRounds ?? 0)) {
    return task;
  }
  return updateLoopTaskRecord(task.id, {
    maxRounds: normalizedMinimum,
    updatedAt: Date.now(),
  }) ?? {
    ...task,
    maxRounds: normalizedMinimum,
    updatedAt: Date.now(),
  };
}

/** Confirmed append port for hosts that must observe persistence failure. */
export function tryAppendLoopRound(taskId: string, round: LoopRoundRecord): boolean {
  const routed = routeHostRequest({ type: "append", taskId, round });
  if (routed.handled) return routed.ok;
  const storeFile = resolveLoopTaskStoreFileForTask(taskId);
  if (!storeFile) return false;
  const read = readLoopTaskStoreResult(storeFile, true, true);
  if (!read.ok) return false;
  const index = read.store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return false;
  const existing = read.store.tasks[index];
  const next = mergeLoopTaskRound(existing, round);
  next.updatedAt = Math.max(next.updatedAt, existing.updatedAt + 1);
  read.store.tasks[index] = next;
  return tryWriteLoopTaskStore(storeFile, read.store);
}

/** Strict commit entry point; only a genuinely missing task is a no-op. */
export function appendLoopRound(taskId: string, round: LoopRoundRecord): void {
  const routed = routeHostRequest({ type: "append", taskId, round });
  if (routed.handled) {
    if (!routed.ok) throw new Error("Loop round append was not confirmed");
    return;
  }
  const storeFile = resolveLoopTaskStoreFileForTask(taskId, { throwOnError: true });
  if (!storeFile) return;
  const read = readLoopTaskStoreResult(storeFile, true, true, false, true);
  if (!read.ok) return;
  const index = read.store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return;
  const existing = read.store.tasks[index];
  const next = mergeLoopTaskRound(existing, round);
  next.updatedAt = Math.max(next.updatedAt, existing.updatedAt + 1);
  read.store.tasks[index] = next;
  writeLoopTaskStore(storeFile, read.store);
}

export function bindLoopTaskToSession(taskId: string, sessionId: string): LoopTaskRecord | null {
  const routed = routeHostRequest({ type: "rebind", taskId, sessionId });
  if (routed.handled) return routed.ok ? routed.record ?? null : null;
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  const task = readLoopTaskRecord(taskId, { throwOnError: true });
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

export function bindLoopTaskToRuntimeTarget(
  taskId: string,
  cli: CliName,
  sessionId: string | null,
): LoopTaskRecord | null {
  const routed = routeHostRequest({ type: "rebind", taskId, cli, sessionId });
  if (routed.handled) return routed.ok ? routed.record ?? null : null;
  const task = readLoopTaskRecord(taskId, { throwOnError: true });
  if (!task) {
    return null;
  }
  const normalizedSessionId = typeof sessionId === "string" && sessionId.trim()
    ? sessionId.trim()
    : null;
  const targetStoreFile = buildLoopTaskStoreFile(cli, task.workspaceKey, normalizedSessionId, task.id);
  if (
    task.cli === cli
    && task.sessionId === normalizedSessionId
    && task.taskStoreFile === targetStoreFile
  ) {
    return task;
  }
  return updateLoopTaskRecord(taskId, {
    cli,
    sessionId: normalizedSessionId,
    taskStoreFile: targetStoreFile,
    updatedAt: Date.now(),
  });
}


function normalizeStoredLoopSchedulingMode(value: unknown): LoopSchedulingMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized === "classic" || normalized === "event_driven") {
    return normalized;
  }
  return undefined;
}

function preserveLoopPlusSnapshot(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      return undefined;
    }
    return JSON.parse(serialized) as unknown;
  } catch {
    return value;
  }
}

export function normalizeLoopTaskRecord(record: unknown, sourceFile?: string): LoopTaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LoopTaskRecord>;
  if (Array.isArray(raw.subTasks) && raw.subTasks.some(hasInvalidLoopSubtaskDependencies)) return null;
  const cli = typeof raw.cli === "string" && isCliName(raw.cli) ? raw.cli : null;
  if (typeof raw.id !== "string" || !raw.id.trim() || !cli || typeof raw.rootPrompt !== "string") {
    return null;
  }
  if (findInvalidLoopSubtaskDependsOnIndex(record) !== null) return null;
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const status = normalizeLoopTaskStatus(raw.status);
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
    ? normalizeLoopRoundSummaries(raw.completionRoundSummaries)
    : [];
  const completionRequirementCoverage = normalizeLoopAcceptanceChecks(
    (raw as { completionRequirementCoverage?: unknown }).completionRequirementCoverage
  );
  const pendingClarification = parseOrchestratorClarification(
    (raw as { pendingClarification?: unknown }).pendingClarification,
    `clarify-${raw.id}`,
  ) ?? undefined;
  const clarificationCountRaw = (raw as { clarificationCount?: unknown }).clarificationCount;
  const clarificationCount = typeof clarificationCountRaw === "number" && Number.isFinite(clarificationCountRaw)
    ? Math.max(0, Math.floor(clarificationCountRaw))
    : 0;
  const supplementalRequirements = Array.isArray((raw as { supplementalRequirements?: unknown }).supplementalRequirements)
    ? (raw as { supplementalRequirements: unknown[] }).supplementalRequirements
      .map((item) => String(item).trim())
      .filter(Boolean)
    : [];
  const modelRouting = normalizeLoopTaskModelRouting((raw as { modelRouting?: unknown }).modelRouting);
  const originProfile = normalizeLoopTaskOriginProfile((raw as { originProfile?: unknown }).originProfile);
  const taskKind = normalizeLoopTaskKind((raw as { taskKind?: unknown }).taskKind);
  const schedulingMode = normalizeStoredLoopSchedulingMode((raw as { schedulingMode?: unknown }).schedulingMode);
  const loopPlus = preserveLoopPlusSnapshot((raw as { loopPlus?: unknown }).loopPlus);
  const legacyMaxRounds = parseLoopMaxRoundsValue(raw.maxRounds);
  const loopPlusMainPhase = normalizeLoopPlusMainPhase(
    (raw as { loopPlusMainPhase?: unknown }).loopPlusMainPhase,
  );
  const loopPlusProgressPercent = normalizeLoopPlusProgressPercent(raw.loopPlusProgressPercent);
  const loopPlusNextStepPlan = normalizeLoopPlusNextStepPlan((raw as { loopPlusNextStepPlan?: unknown }).loopPlusNextStepPlan);
  const loopProgressPercent = normalizeLoopProgressPercent(raw.loopProgressPercent);
  const rawAcceptancePlan = (raw as { loopPlusAcceptancePlan?: unknown }).loopPlusAcceptancePlan;
  const blockReview = (raw as { loopPlusBlockReview?: unknown }).loopPlusBlockReview;
  const loopPlusBlockReview = blockReview && typeof blockReview === "object" && !Array.isArray(blockReview)
    && ("state" in blockReview) && (blockReview.state === "pending" || blockReview.state === "reviewed")
    ? {
      state: blockReview.state as "pending" | "reviewed",
      ...("summary" in blockReview && typeof blockReview.summary === "string" && blockReview.summary.trim()
        ? { summary: blockReview.summary.trim() }
        : {}),
    }
    : undefined;
  const loopSubtaskMode = readLoopSubtaskModeField((raw as { loopSubtaskMode?: unknown }).loopSubtaskMode);
  const departmentField = readDepartmentMetadataField(
    (raw as { department?: unknown }).department,
    raw.departmentInvalid === true,
  );
  const loopPlusAcceptancePlan = departmentField.metadata && rawAcceptancePlan !== undefined
    ? normalizeLoopPlusAcceptancePlanSnapshot(rawAcceptancePlan)
    : normalizeLoopPlusAcceptancePlanSnapshotForStorage(rawAcceptancePlan);
  return {
    id: raw.id,
    cli,
    workspaceKey,
    taskStoreFile,
    rootPrompt: raw.rootPrompt,
    ...(taskKind ? { taskKind } : {}),
    ...(schedulingMode ? { schedulingMode } : {}),
    ...(loopPlus !== undefined ? { loopPlus } : {}),
    ...(departmentField.metadata ? { department: departmentField.metadata } : {}),
    ...(departmentField.invalid ? { departmentInvalid: true } : {}),
    ...(raw.departmentDeliveries && typeof raw.departmentDeliveries === "object" && !Array.isArray(raw.departmentDeliveries)
      ? { departmentDeliveries: Object.fromEntries(Object.entries(raw.departmentDeliveries).filter(([id, body]) => id.trim() && typeof body === "string" && body.trim())) } : {}),
    ...(loopPlusMainPhase ? { loopPlusMainPhase } : {}),
    ...(loopPlusProgressPercent !== undefined ? { loopPlusProgressPercent } : {}),
    ...(loopPlusNextStepPlan ? { loopPlusNextStepPlan } : {}),
    ...(loopProgressPercent !== undefined ? { loopProgressPercent } : {}),
    ...(loopPlusBlockReview ? { loopPlusBlockReview } : {}),
    ...(loopPlusAcceptancePlan ? { loopPlusAcceptancePlan } : {}),
    ...(loopSubtaskMode ? { loopSubtaskMode } : {}),
    ...(loopSubtaskMode === null ? { loopSubtaskModeInvalid: true } : {}),
    status,
    ...(raw.runtimeInterrupted === true ? { runtimeInterrupted: true } : {}),
    createdAt,
    updatedAt,
    ...(legacyMaxRounds !== null ? { maxRounds: legacyMaxRounds } : {}),
    currentRound: typeof raw.currentRound === "number" ? raw.currentRound : 0,
    communicationDir: typeof raw.communicationDir === "string" ? raw.communicationDir : getLoopCommunicationPaths(raw.id).dir,
    mainCommunicationFile: typeof raw.mainCommunicationFile === "string" ? raw.mainCommunicationFile : getLoopCommunicationPaths(raw.id).mainFile,
    sessionId,
    ...(raw.executionSession === undefined ? {} : (() => {
      const native = normalizeDepartmentMainExecutionSession(raw.executionSession, cli, departmentField.metadata, sessionId);
      return native
        ? { executionSession: native } : { executionSessionInvalid: true };
    })()),
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
    mainAiLastFailureCode: raw.mainAiLastFailureCode === undefined ? undefined
      : typeof raw.mainAiLastFailureCode === "string" ? raw.mainAiLastFailureCode : null,
    supplementalRequirements,
    ...(pendingClarification ? { pendingClarification } : {}),
    ...(clarificationCount ? { clarificationCount } : {}),
    ...(modelRouting ? { modelRouting } : {}),
    ...(originProfile ? { originProfile } : {}),
    completionRoundSummaries,
    completionRequirementCoverage,
  };
}

export function normalizeLoopTaskModelRouting(value: unknown): LoopTaskModelRouting | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as { main?: unknown; subtask?: unknown; subtaskFrontend?: unknown; subtaskFullstack?: unknown };
  const main = normalizeLoopTaskModelRoute(raw.main);
  const subtask = normalizeLoopTaskModelRoute(raw.subtask);
  const subtaskFrontend = normalizeLoopTaskModelRoute(raw.subtaskFrontend);
  const subtaskFullstack = normalizeLoopTaskModelRoute(raw.subtaskFullstack);
  if (!main && !subtask && !subtaskFrontend && !subtaskFullstack) {
    return undefined;
  }
  return {
    main: main ?? {},
    subtask: subtask ?? {},
    ...(subtaskFrontend ? { subtaskFrontend } : {}),
    ...(subtaskFullstack ? { subtaskFullstack } : {}),
  };
}

export function normalizeLoopTaskOriginProfile(value: unknown): LoopTaskOriginProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as {
    configId?: unknown;
    mainThinkingMode?: unknown;
    subtaskThinkingMode?: unknown;
    subtaskFrontendThinkingMode?: unknown;
    subtaskFullstackThinkingMode?: unknown;
    mainOpenCodeVariant?: unknown;
    subtaskOpenCodeVariant?: unknown;
    subtaskFrontendOpenCodeVariant?: unknown;
    subtaskFullstackOpenCodeVariant?: unknown;
  };
  const configId = typeof raw.configId === "string" ? raw.configId.trim() : "";
  if (!configId) {
    return undefined;
  }
  const mainThinkingMode = normalizeLoopOriginThinkingMode(raw.mainThinkingMode);
  const subtaskThinkingMode = normalizeLoopOriginThinkingMode(raw.subtaskThinkingMode);
  const subtaskFrontendThinkingMode = normalizeLoopOriginThinkingMode(raw.subtaskFrontendThinkingMode);
  const subtaskFullstackThinkingMode = normalizeLoopOriginThinkingMode(raw.subtaskFullstackThinkingMode);
  const mainOpenCodeVariant = normalizeLoopOriginVariant(raw.mainOpenCodeVariant);
  const subtaskOpenCodeVariant = normalizeLoopOriginVariant(raw.subtaskOpenCodeVariant);
  const subtaskFrontendOpenCodeVariant = normalizeLoopOriginVariant(raw.subtaskFrontendOpenCodeVariant);
  const subtaskFullstackOpenCodeVariant = normalizeLoopOriginVariant(raw.subtaskFullstackOpenCodeVariant);
  return {
    configId,
    ...(mainThinkingMode ? { mainThinkingMode } : {}),
    ...(subtaskThinkingMode ? { subtaskThinkingMode } : {}),
    ...(subtaskFrontendThinkingMode ? { subtaskFrontendThinkingMode } : {}),
    ...(subtaskFullstackThinkingMode ? { subtaskFullstackThinkingMode } : {}),
    ...(mainOpenCodeVariant ? { mainOpenCodeVariant } : {}),
    ...(subtaskOpenCodeVariant ? { subtaskOpenCodeVariant } : {}),
    ...(subtaskFrontendOpenCodeVariant ? { subtaskFrontendOpenCodeVariant } : {}),
    ...(subtaskFullstackOpenCodeVariant ? { subtaskFullstackOpenCodeVariant } : {}),
  };
}

const LOOP_ORIGIN_THINKING_MODES = ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"] as const;

function normalizeLoopOriginThinkingMode(value: unknown): ThinkingMode | undefined {
  return typeof value === "string" && (LOOP_ORIGIN_THINKING_MODES as readonly string[]).includes(value)
    ? value as ThinkingMode
    : undefined;
}

function normalizeLoopOriginVariant(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeLoopTaskModelRoute(value: unknown): LoopTaskModelRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as { cli?: unknown; configId?: unknown; model?: unknown; fallback?: unknown };
  const parsedCli = parseCliNameField(raw.cli);
  if (!parsedCli.ok) {
    return { fallback: INVALID_SUBTASK_CLI_ROUTE };
  }
  const configId = typeof raw.configId === "string" && raw.configId.trim() ? raw.configId.trim() : undefined;
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
  const fallback = typeof raw.fallback === "string" && raw.fallback.trim() ? raw.fallback.trim() : undefined;
  if (!parsedCli.cli && !configId && !model && !fallback) {
    return null;
  }
  return {
    ...(parsedCli.cli ? { cli: parsedCli.cli } : {}),
    ...(configId ? { configId } : {}),
    ...(model ? { model } : {}),
    ...(fallback ? { fallback } : {}),
  };
}

/** Retain an invalid sentinel rather than silently granting completion after corrupt recovery. */
function normalizeLoopSubtaskRepairSource(value: unknown): LoopSubtaskRepairSource {
  const invalid = { subtaskId: "", attemptId: "", finishEventId: "" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 3 || ![raw.subtaskId, raw.attemptId, raw.finishEventId]
    .every((item) => typeof item === "string" && item.length > 0 && item.length <= 2048 && item.trim() === item)) return invalid;
  return { subtaskId: raw.subtaskId as string, attemptId: raw.attemptId as string, finishEventId: raw.finishEventId as string };
}

function normalizeLoopSubtaskRecord(record: unknown): LoopSubtaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LoopSubtaskRecord>;
  if (typeof raw.id !== "string" || !raw.id.trim() || typeof raw.title !== "string") {
    return null;
  }
  const dependsOn = readLoopPlusDependsOn((raw as { dependsOn?: unknown }).dependsOn, raw.id);
  if (!dependsOn) return null;
  const status = raw.status === "pending" || raw.status === "running" || raw.status === "completed" || raw.status === "skipped" || raw.status === "blocked"
    ? raw.status
    : "pending";
  const skillIds = normalizeLoopSkillIds((raw as { skillIds?: unknown }).skillIds);
  const skillGuidance = normalizeLoopSkillGuidance((raw as { skillGuidance?: unknown }).skillGuidance);
  const taskType = readLoopPlusTaskTypeField((raw as { taskType?: unknown }).taskType);
  const codingDelivery = (raw as { codingDelivery?: unknown }).codingDelivery === true;
  const requiresAcceptance = typeof (raw as { requiresAcceptance?: unknown }).requiresAcceptance === "boolean"
    ? (raw as { requiresAcceptance: boolean }).requiresAcceptance
    : undefined;
  const continueFromSubtaskId = readLoopContinuationSource(raw.continueFromSubtaskId);
  const executionSession = normalizeLoopSubtaskSession(raw.executionSession);
  const progressWeightPercent = normalizeLoopSubtaskProgressWeightPercent(raw.progressWeightPercent);
  return {
    id: raw.id,
    title: raw.title,
    ...(Object.prototype.hasOwnProperty.call(raw, "dependsOn") ? { dependsOn } : {}),
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    ...(progressWeightPercent !== undefined ? { progressWeightPercent } : {}),
    ...(continueFromSubtaskId ? { continueFromSubtaskId } : {}),
    ...(executionSession ? { executionSession } : {}),
    ...(Object.prototype.hasOwnProperty.call(raw, "repairSource")
      ? { repairSource: normalizeLoopSubtaskRepairSource(raw.repairSource) } : {}),
    conflictGroup: typeof raw.conflictGroup === "string" ? raw.conflictGroup : undefined,
    writeFiles: normalizeLoopWriteFiles((raw as { writeFiles?: unknown }).writeFiles),
    ...(taskType ? { taskType } : {}),
    ...(codingDelivery ? { codingDelivery } : {}),
    ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
    ...(skillIds && skillGuidance ? { skillIds, skillGuidance } : {}),
    status,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    ...(status === "blocked" && typeof raw.executionFailure === "string" ? { executionFailure: raw.executionFailure } : {}),
    communicationFile: typeof raw.communicationFile === "string" ? raw.communicationFile : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
    ...(typeof raw.lastStartedAt === "number" && Number.isFinite(raw.lastStartedAt)
      ? { lastStartedAt: raw.lastStartedAt }
      : {}),
  };
}

export function normalizeLoopPlusProgressPercent(value: unknown): number | undefined {
  return normalizeLoopProgressPercent(value);
}

export function normalizeLoopProgressPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

export function normalizeLoopSubtaskProgressWeightPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : undefined;
}

function normalizeLoopPlusMainPhase(value: unknown): LoopPlusMainPhase | undefined {
  return value === "decomposing" ? "decomposing" : undefined;
}

function findInvalidLoopSubtaskDependsOnIndex(record: unknown): number | null {
  if (!record || typeof record !== "object" || !Array.isArray((record as { subTasks?: unknown }).subTasks)) {
    return null;
  }
  const subTasks = (record as { subTasks: unknown[] }).subTasks;
  for (let index = 0; index < subTasks.length; index += 1) {
    const subtask = subTasks[index];
    if (!subtask || typeof subtask !== "object" || Array.isArray(subtask)) continue;
    const raw = subtask as { id?: unknown; dependsOn?: unknown };
    if (!Object.prototype.hasOwnProperty.call(raw, "dependsOn")) continue;
    const subtaskId = typeof raw.id === "string" ? raw.id.trim() : "";
    if (readLoopPlusDependsOn(raw.dependsOn, subtaskId) === null) return index;
  }
  return null;
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

function normalizeLoopTaskStatus(value: unknown): LoopTaskStatus {
  if (value === "sleeping") {
    return "needs-review";
  }
  if (
    value === "running"
    || value === "completed"
    || value === "needs-review"
    || value === "error"
    || value === "stopped"
  ) {
    return value;
  }
  return "stopped";
}

function isLoopTaskRole(value: unknown): value is LoopTaskRole {
  return value === "main" || value === "subtask";
}

function ensureLoopTaskStore(
  store?: LoopTaskStore,
  options: { sourceFile?: string; throwOnError?: boolean } = {}
): LoopTaskStore {
  return normalizeLoopTaskStoreForStorage(store, options);
}

export function normalizeLoopTaskStoreForStorage(
  store?: LoopTaskStore,
  options: { sourceFile?: string; preserveExpired?: boolean; throwOnError?: boolean } = {}
): LoopTaskStore {
  const now = Date.now();
  const tasks = Array.isArray(store?.tasks)
    ? store.tasks
      .map((record) => {
        if (options.throwOnError) {
          const invalidDependsOnIndex = findInvalidLoopSubtaskDependsOnIndex(record);
          if (invalidDependsOnIndex !== null) {
            throw new Error(`Loop task record has invalid subTasks[${invalidDependsOnIndex}].dependsOn`);
          }
        }
        const normalized = normalizeLoopTaskRecord(record, options.sourceFile);
        if (!normalized && options.throwOnError) {
          throw new Error("Invalid Loop task record");
        }
        return normalized;
      })
      .filter((record): record is LoopTaskRecord => Boolean(record))
      .filter((record) => options.preserveExpired || isTimestampWithinHistoryRetention(record.updatedAt, now))
    : [];
  return { tasks };
}

function hasInvalidLoopSubtaskDependencies(subtask: unknown): boolean {
  if (!subtask || typeof subtask !== "object") return false;
  const { id, dependsOn } = subtask as { id?: unknown; dependsOn?: unknown };
  return readLoopPlusDependsOn(dependsOn, typeof id === "string" ? id.trim() : "") === null;
}

// Preserve file identity semantics on case-sensitive volumes while recognizing aliases.
function isSameLoopTaskStoreFile(left: string, right: string): boolean {
  if (path.resolve(left) === path.resolve(right)) return true;
  try {
    const leftStats = fs.statSync(left);
    const rightStats = fs.statSync(right);
    return (leftStats.ino !== 0 && leftStats.dev === rightStats.dev && leftStats.ino === rightStats.ino)
      || fs.realpathSync(left) === fs.realpathSync(right);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export type LoopTaskStoreReadResult = { ok: true; store: LoopTaskStore } | { ok: false };
/** A missing file is empty only for ordinary create/read; rebuild requires every discovered file. */
export function readLoopTaskStoreResult(filePath: string, requireExisting = false, requireComplete = false, preserveExpired = false, throwOnError = false): LoopTaskStoreReadResult {
  const routed = routeHostRequest({ type: "readFile", filePath });
  if (routed.handled) return routed.ok && routed.store ? { ok: true, store: routed.store } : { ok: false };
  try {
    // Unregistered/aliased controlled files have no ordinary read authority.
    if (isControlledLoopTaskStorePath(canonicalRouteFile(filePath))) return { ok: false };
    let raw: string;
    try { raw = fs.readFileSync(filePath, "utf8"); }
    catch (error) {
      if (!requireExisting && (error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, store: { tasks: [] } };
      throw error;
    }
    const retainLegacyStoragePaths = isLegacyLoopTaskStorePath(filePath, DATA_DIR)
      && fs.existsSync(LEGACY_LOOP_STORAGE_PATHS.communicationDir);
    const parsed = migrateLegacyLoopJson(JSON.parse(raw), retainLegacyStoragePaths ? undefined : DATA_DIR).value;
    if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("Invalid Loop task store");
    return { ok: true, store: normalizeLoopTaskStoreForStorage({ tasks: parsed.tasks as LoopTaskRecord[] }, {
      sourceFile: filePath, preserveExpired, throwOnError: requireComplete || throwOnError,
    }) };
  } catch (error) {
    publishLoopTaskStoreChange({ type: "invalidate", filePath });
    void logError("loop-task-store-read-error", { filePath, error: String(error) });
    if (throwOnError) throw error;
    return { ok: false };
  }
}

export function readLoopTaskStore(filePath: string, options: LoopTaskStoreReadOptions = {}): LoopTaskStore {
  const result = readLoopTaskStoreResult(filePath, false, false, false, options.throwOnError);
  return result.ok ? result.store : { tasks: [] };
}

/** Strict commit: success confirms file and identity publication; original I/O errors propagate. */
export function writeLoopTaskStore(filePath: string, store: LoopTaskStore): void {
  commitLoopTaskStore(filePath, store);
}

export function appendLoopTaskRecord(filePath: string, record: LoopTaskRecord): void {
  const read = readLoopTaskStoreResult(filePath, false, true, false, true);
  if (!read.ok) throw new Error("Loop task store append target unavailable");
  read.store.tasks.push(record);
  writeLoopTaskStore(filePath, read.store);
}

function commitLoopTaskStore(filePath: string, store: LoopTaskStore,
  move?: { taskId: string; sourceFile: string; sourceTasks: readonly LoopTaskRecord[]; targetFile: string }): void {
  let stage = "store-validation";
  let reason: string | undefined;
  try {
    if (!store || !Array.isArray(store.tasks)) throw new Error("Invalid Loop task store");
    stage = "root-check";
    if (hostRoutes.some((entry) => insideRoute(entry.root, filePath)) || isControlledLoopTaskStorePath(filePath)) {
      reason = "controlled-root";
      throw new Error("Controlled Loop task roots require owner transactions");
    }
    // Check the caller's IDs before retention/normalization can erase an expired record.
    stage = "identity-check";
    for (const task of store.tasks) {
      const ownership = hostRoutes.some((entry) => entry.ids.has(task.id)) ? "department-owned" : inspectLoopTaskIdentityOwnership(task.id);
      if (ownership === "ordinary") continue;
      reason = ownership;
      throw new Error("Controlled task identities require owner transactions");
    }
    stage = "normalize";
    const retainLegacyStoragePaths = isLegacyLoopTaskStorePath(filePath, DATA_DIR)
      && fs.existsSync(LEGACY_LOOP_STORAGE_PATHS.communicationDir);
    const migratedStore = migrateLegacyLoopJson(store, retainLegacyStoragePaths ? undefined : DATA_DIR).value;
    const persisted = normalizeLoopTaskStoreForStorage(migratedStore, { sourceFile: filePath, throwOnError: true });
    stage = "identity-commit";
    if (!commitLoopTaskIdentities(new Map([[filePath, persisted.tasks]]), () => {
      writeLoopTaskStoreBytes(filePath, persisted);
      return true;
    }, undefined, { atomicWrite: true, move })) throw new Error("Loop task identity commit was not confirmed");
    for (const task of persisted.tasks) loopTaskStoreFileCache.set(task.id, filePath);
    publishLoopTaskStoreChange({ type: "replace", filePath, tasks: persisted.tasks });
    return;
  } catch (error) {
    publishLoopTaskStoreChange({ type: "invalidate", filePath });
    void logError("loop-task-store-write-error", {
      filePath: path.basename(filePath), stage, pid: process.pid,
      reason: reason ?? (isLoopTaskIdentityLockContention(error) ? "identity-lock-contended" : "store-write-failed"),
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
    }).catch(() => undefined);
    throw error;
  }
}

// Byte mutation only: callers must hold the identity writer gate until publication.
function writeLoopTaskStoreBytes(filePath: string, persisted: LoopTaskStore): void {
  let tempFile: string | undefined;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (hostRoutes.some((entry) => insideRoute(entry.root, filePath)) || isControlledLoopTaskStorePath(filePath)) throw new Error("Controlled Loop task roots require owner transactions");
    try {
      const target = fs.lstatSync(filePath);
      if (!target.isFile()) throw new Error("Loop task store target must be a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    tempFile = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomBytes(12).toString("hex")}.stage`);
    fs.writeFileSync(tempFile, JSON.stringify(persisted, null, 2), { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempFile, filePath);
    tempFile = undefined;

  } finally {
    if (tempFile) { try { fs.unlinkSync(tempFile); } catch { /* best-effort cleanup */ } }
  }
}

/** Boolean compatibility port for callers that explicitly handle uncommitted writes. */
export function tryWriteLoopTaskStore(filePath: string, store: LoopTaskStore): boolean {
  try {
    writeLoopTaskStore(filePath, store);
    return true;
  } catch {
    return false;
  }
}

/** Confirmed deletion, shared by migration and retention. Failure never publishes an empty file. */
export function deleteLoopTaskStoreFile(filePath: string): boolean {
  const routed = routeHostRequest({ type: "deleteFile", filePath });
  if (routed.handled) return routed.ok;
  try {
    if (hostRoutes.some((entry) => insideRoute(entry.root, filePath)) || isControlledLoopTaskStorePath(filePath)) throw new Error("Controlled Loop task roots require owner transactions");
    if (!commitLoopTaskIdentities(new Map([[filePath, []]]), () => {
      try { fs.unlinkSync(filePath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return true;
    }, undefined, { atomicWrite: true })) return false;
    for (const [id, cached] of loopTaskStoreFileCache) if (cached === filePath) loopTaskStoreFileCache.delete(id);
    publishLoopTaskStoreChange({ type: "replace", filePath, tasks: [] });
    return true;
  } catch (error) {
    publishLoopTaskStoreChange({ type: "invalidate", filePath });
    void logError("loop-task-store-delete-error", { filePath, error: String(error) });
    return false;
  }
}

export function cleanupLoopTaskStoreRetention(): void {
  for (const entry of hostRoutes) {
    if (entry.active) { try { entry.route({ type: "retention" }); } catch { /* A failed source stays protected. */ } }
  }
  try {
    const filePaths = listLoopTaskStoreFiles();
    filePaths.forEach((filePath) => {
      if (hostRoutes.some((entry) => insideRoute(entry.root, filePath))) return;
      try {
        let retained: LoopTaskStore | undefined;
        const committed = retainOrdinaryLoopTaskIdentities(filePath, (destinations, ownedTaskIds) => {
          // Complete validation precedes expiry or stale-copy filtering; unknown identity
          // aborts the whole file before this callback, never becoming an empty task list.
          const read = readLoopTaskStoreResult(filePath, true, true, true);
          if (!read.ok || read.store.tasks.some((task) => ownedTaskIds.has(task.id)
            || hostRoutes.some((entry) => entry.ids.has(task.id)))) return null;
          retained = normalizeLoopTaskStoreForStorage({ tasks: read.store.tasks.filter((task) => {
            const destination = destinations.get(task.id);
            return !destination || isSameLoopTaskStoreFile(destination, filePath);
          }) }, { sourceFile: filePath });
          return { tasks: retained.tasks, write: () => {
            if (isControlledLoopTaskStorePath(filePath)) throw new Error("Controlled Loop task roots require owner transactions");
            if (retained!.tasks.length) writeLoopTaskStoreBytes(filePath, retained!);
            else fs.unlinkSync(filePath);
            return true;
          } };
        });
        if (!committed || !retained) return;
        for (const [id, cached] of loopTaskStoreFileCache) if (cached === filePath) loopTaskStoreFileCache.delete(id);
        retained.tasks.forEach((task) => loopTaskStoreFileCache.set(task.id, filePath));
        publishLoopTaskStoreChange({ type: "replace", filePath, tasks: retained.tasks });
      } catch (error) {
        publishLoopTaskStoreChange({ type: "invalidate", filePath });
        void logError("loop-task-store-retention-cleanup-error", { filePath, error: String(error) });
      }
    });
  } catch (error) {
    publishLoopTaskStoreChange({ type: "invalidate" });
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
    const currentPath = stack.pop() as string;
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
    withLoopTaskIdentityRetention((ownedTaskIds) => {
      const entries = fs.readdirSync(LOOP_COMMUNICATION_DIR, { withFileTypes: true });
      entries.forEach((entry) => {
        if (!entry.isDirectory()) {
          return;
        }
        const taskId = entry.name;
        // The ordinary retention scanner cannot prove deletion in an unavailable owned source.
        if (retainedTaskIds.has(taskId) || ownedTaskIds.has(taskId) || hostRoutes.some((entry) => entry.ids.has(taskId))) {
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
    });
  } catch (error) {
    void logError("loop-communication-retention-cleanup-error", { error: String(error) });
  }
}

export function resolveLegacyLoopMaxRounds(value: unknown): number {
  return parseLoopMaxRoundsValue(value) ?? LOOP_DEFAULT_MAX_ROUNDS;
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

function formatLoopWriteFiles(writeFiles?: string[]): string | null {
  if (!Array.isArray(writeFiles) || writeFiles.length === 0) {
    return null;
  }
  return writeFiles.join("、");
}
