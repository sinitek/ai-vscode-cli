import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const originalHome = process.env.HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-task-store-core-"));
process.env.HOME = testHome;
const loopTaskStore = require("../loopTaskStore") as typeof import("../loopTaskStore");
if (originalHome === undefined) {
  delete process.env.HOME;
} else {
  process.env.HOME = originalHome;
}

type LoopTaskRecord = import("../loopTaskStore").LoopTaskRecord;

let taskSequence = 0;

test.after(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});

function createTask(overrides: Partial<LoopTaskRecord> = {}): LoopTaskRecord {
  taskSequence += 1;
  const now = Date.now();
  const id = "core-store-task-" + taskSequence;
  const workspaceKey = "core-store-workspace";
  const sessionId = "session-" + taskSequence;
  const communication = loopTaskStore.getLoopCommunicationPaths(id);
  const task: LoopTaskRecord = {
    id,
    cli: "codex",
    workspaceKey,
    taskStoreFile: loopTaskStore.buildLoopTaskStoreFile("codex", workspaceKey, sessionId, id),
    rootPrompt: "Persist Loop task state safely.",
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: 5,
    currentRound: 1,
    communicationDir: communication.dir,
    mainCommunicationFile: communication.mainFile,
    sessionId,
    activeSubtaskId: "persist-subtask",
    activeSubtaskIds: ["persist-subtask"],
    subTasks: [{
      id: "persist-subtask",
      title: "Persist state",
      prompt: "Write the state record.",
      writeFiles: ["src/loopTaskStore.ts"],
      status: "pending",
      updatedAt: now,
    }],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
  return { ...task, ...overrides };
}

function readPersistedTask(filePath: string, taskId: string): LoopTaskRecord {
  const task = loopTaskStore.readLoopTaskStore(filePath).tasks.find((item) => item.id === taskId);
  assert.ok(task);
  return task;
}

function resetLoopStorage(): void {
  const dataDir = path.join(testHome, ".sinitek_cli");
  [
    "loop-tasks",
    "loop-tasks.json",
    "loop-communications",
    "lobster-tasks",
    "lobster-tasks.json",
    "lobster-communications",
  ].forEach((entry) => {
    fs.rmSync(path.join(dataDir, entry), { recursive: true, force: true });
  });
  fs.mkdirSync(dataDir, { recursive: true });
}

function getLegacyPaths(): { taskDir: string; flatTaskFile: string; communicationDir: string; loopCommunicationDir: string } {
  const dataDir = path.join(testHome, ".sinitek_cli");
  return {
    taskDir: path.join(dataDir, "lobster-tasks"),
    flatTaskFile: path.join(dataDir, "lobster-tasks.json"),
    communicationDir: path.join(dataDir, "lobster-communications"),
    loopCommunicationDir: path.join(dataDir, "loop-communications"),
  };
}

test("builds isolated store and communication paths from normalized public inputs", () => {
  const sessionIds = loopTaskStore.buildLoopSessionIdsByCli([
    { cli: "codex", sessionId: " codex-session " },
    { cli: "codex", sessionId: "" },
    { cli: "claude", sessionId: null },
    { cli: "opencode", sessionId: "open-session" },
    { cli: "opencode", sessionId: "open-session" },
  ]);

  assert.deepEqual([...sessionIds.codex], ["codex-session"]);
  assert.deepEqual([...sessionIds.claude], []);
  assert.deepEqual([...sessionIds.opencode], ["open-session"]);

  assert.equal(
    loopTaskStore.getLoopTaskStoreSessionFile(" ws/../team ", "codex", " /session "),
    path.join(testHome, ".sinitek_cli", "loop-tasks", "ws_.._team", "codex", "_session", "loop-tasks.json"),
  );
  assert.equal(
    loopTaskStore.buildLoopTaskStoreFile("claude", "   ", " ", " task/one "),
    path.join(testHome, ".sinitek_cli", "loop-tasks", "no-workspace", "claude", "__pending__", "task_one", "loop-tasks.json"),
  );

  const paths = loopTaskStore.ensureLoopCommunicationFiles("task with spaces", "First root prompt");
  assert.equal(fs.existsSync(paths.subtasksDir), true);
  assert.match(fs.readFileSync(paths.mainFile, "utf8"), /First root prompt/u);
  loopTaskStore.ensureLoopCommunicationFiles("task with spaces", "Replacement prompt");
  assert.doesNotMatch(fs.readFileSync(paths.mainFile, "utf8"), /Replacement prompt/u);
  assert.equal(
    loopTaskStore.buildLoopSubtaskCommunicationFile("task with spaces", "sub/task 1", 2, 1),
    path.join(paths.subtasksDir, "round-2-sub_task_1-retry-1.md"),
  );
});

test("returns an empty store for missing, malformed, and unreadable storage files", () => {
  const missingFile = path.join(testHome, "reads", "missing.json");
  const malformedFile = path.join(testHome, "reads", "malformed.json");
  const invalidShapeFile = path.join(testHome, "reads", "invalid-shape.json");
  const unreadableDirectory = path.join(testHome, "reads", "directory-as-store");

  assert.deepEqual(loopTaskStore.readLoopTaskStore(missingFile), { tasks: [] });
  fs.mkdirSync(path.dirname(malformedFile), { recursive: true });
  fs.writeFileSync(malformedFile, "{ this is not JSON", "utf8");
  fs.writeFileSync(invalidShapeFile, JSON.stringify({ tasks: {} }), "utf8");
  fs.mkdirSync(unreadableDirectory, { recursive: true });

  assert.deepEqual(loopTaskStore.readLoopTaskStore(malformedFile), { tasks: [] });
  assert.deepEqual(loopTaskStore.readLoopTaskStore(invalidShapeFile), { tasks: [] });
  assert.deepEqual(loopTaskStore.readLoopTaskStore(unreadableDirectory), { tasks: [] });
});

test("normalizes persisted task, subtask, round, and acceptance records at the store boundary", () => {
  const storeFile = path.join(testHome, "normalization", "loop-tasks.json");
  const now = Date.now();
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile, JSON.stringify({
    tasks: [
      null,
      { id: "", cli: "codex", rootPrompt: "invalid" },
      {
        id: "raw-task",
        cli: "codex",
        rootPrompt: "Normalize public persisted data.",
        createdAt: now,
        updatedAt: now,
        status: "unknown",
        workspaceKey: 42,
        taskStoreFile: "",
        sessionId: 3,
        maxRounds: "101.8",
        currentRound: "not-a-number",
        activeSubtaskId: "only-subtask",
        subTasks: [
          {
            id: "valid-subtask",
            title: "Normalize fields",
            status: "unexpected",
            writeFiles: [" src/one.ts ", "src/one.ts", ""],
          },
          { id: "", title: "discard" },
        ],
        rounds: [
          { round: 2, role: "main", status: "end", startedAt: 1, endedAt: 2, summary: "complete" },
          { round: 2, role: "invalid", status: "end" },
        ],
        supplementalRequirements: [" first ", 5, ""],
        estimatedRemainingRounds: "101.5",
        completionRoundSummaries: [
          null,
          { round: 1.8, subtaskId: " subtask ", title: " Title ", summary: " Summary " },
          { round: 0, title: "discard", summary: "discard" },
        ],
        completionRequirementCoverage: [
          { name: " Check ", passed: true, detail: "kept exactly" },
          { passed: false },
          null,
        ],
      },
    ],
  }), "utf8");

  const store = loopTaskStore.readLoopTaskStore(storeFile);
  assert.equal(store.tasks.length, 1);
  const task = store.tasks[0];
  assert.equal(task.status, "stopped");
  assert.equal(task.workspaceKey, "no-workspace");
  assert.equal(task.taskStoreFile, storeFile);
  assert.equal(task.sessionId, null);
  assert.equal(task.maxRounds, 100);
  assert.equal(task.currentRound, 0);
  assert.deepEqual(task.activeSubtaskIds, ["only-subtask"]);
  assert.deepEqual(task.subTasks, [{
    id: "valid-subtask",
    title: "Normalize fields",
    prompt: undefined,
    conflictGroup: undefined,
    writeFiles: ["src/one.ts"],
    status: "pending",
    summary: undefined,
    communicationFile: undefined,
    updatedAt: undefined,
  }]);
  assert.deepEqual(task.rounds, [{
    round: 2,
    role: "main",
    subtaskId: undefined,
    status: "end",
    startedAt: 1,
    endedAt: 2,
    summary: "complete",
  }]);
  assert.deepEqual(task.supplementalRequirements, ["first", "5"]);
  assert.equal(task.estimatedRemainingRounds, 100);
  assert.deepEqual(task.completionRoundSummaries, [{
    round: 1,
    subtaskId: "subtask",
    title: "Title",
    summary: "Summary",
  }]);
  assert.deepEqual(task.completionRequirementCoverage, [
    { name: "Check", passed: true, detail: "kept exactly" },
    { name: "acceptance", passed: false, detail: undefined },
  ]);
});

test("does not resurrect persisted Loop tasks with missing status as running", () => {
  resetLoopStorage();
  const task = createTask({
    id: "missing-status-task",
    activeSubtaskId: null,
    activeSubtaskIds: [],
  });
  const rawTask = { ...task } as Record<string, unknown>;
  delete rawTask.status;
  fs.mkdirSync(path.dirname(task.taskStoreFile), { recursive: true });
  fs.writeFileSync(task.taskStoreFile, JSON.stringify({ tasks: [rawTask] }), "utf8");

  const persisted = readPersistedTask(task.taskStoreFile, task.id);

  assert.equal(persisted.status, "stopped");
});

test("raises existing Loop task maxRounds to the current global setting without lowering it", () => {
  resetLoopStorage();
  const task = createTask({ maxRounds: 20 });
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  const raised = loopTaskStore.ensureLoopTaskMaxRoundsAtLeast(task, 50);
  assert.equal(raised.maxRounds, 50);
  assert.equal(readPersistedTask(task.taskStoreFile, task.id).maxRounds, 50);

  const unchanged = loopTaskStore.ensureLoopTaskMaxRoundsAtLeast(raised, 10);
  assert.equal(unchanged.maxRounds, 50);
  assert.equal(readPersistedTask(task.taskStoreFile, task.id).maxRounds, 50);
});

test("writes normalized data and contains write failures at the persistence boundary", () => {
  const task = createTask();
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.equal(readPersistedTask(task.taskStoreFile, task.id).id, task.id);

  const blockedParent = path.join(testHome, "blocked-parent");
  fs.writeFileSync(blockedParent, "not a directory", "utf8");
  assert.doesNotThrow(() => {
    loopTaskStore.writeLoopTaskStore(path.join(blockedParent, "loop-tasks.json"), { tasks: [task] });
  });
});

test("normalizes legacy sleeping Loop tasks to manual review", () => {
  resetLoopStorage();
  const autoSleepStartedAt = Date.UTC(2026, 6, 17, 8, 0, 0);
  const task = {
    ...createTask({
      activeSubtaskId: null,
      activeSubtaskIds: [],
    }),
    status: "sleeping",
    autoSleepStartedAt,
    autoWakeAt: autoSleepStartedAt + 60_000,
    autoSleepReason: "Wait for the deployment result.",
  } as unknown as LoopTaskRecord;

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const persisted = readPersistedTask(task.taskStoreFile, task.id);

  assert.equal(persisted.status, "needs-review");
  assert.equal("autoSleepStartedAt" in persisted, false);
  assert.equal("autoWakeAt" in persisted, false);
  assert.equal("autoSleepReason" in persisted, false);
  assert.equal(persisted.activeSubtaskId, null);
  assert.deepEqual(persisted.activeSubtaskIds, []);
});

test("does not retain legacy sleeping tasks beyond ordinary history retention", () => {
  resetLoopStorage();
  const task = {
    ...createTask({
      createdAt: 1,
      updatedAt: 1,
    }),
    status: "sleeping",
    autoSleepStartedAt: 1,
    autoWakeAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    autoSleepReason: "Wait for a long-running external process.",
  } as unknown as LoopTaskRecord;

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  assert.equal(loopTaskStore.readLoopTaskStore(task.taskStoreFile).tasks.length, 0);
});

test("updates task state, protects completed tasks, and appends rounds idempotently", () => {
  const task = createTask({ status: "completed" });
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  assert.equal(loopTaskStore.readLoopTaskRecord("missing-task"), null);
  assert.equal(loopTaskStore.updateLoopTaskRecord("missing-task", { status: "running" }), null);
  assert.equal(loopTaskStore.bindLoopTaskToSession("missing-task", "session-missing"), null);

  const protectedUpdate = loopTaskStore.updateLoopTaskRecord(task.id, {
    status: "running",
    taskStoreFile: " ",
    supplementalRequirements: [" first ", "", 7] as unknown as string[],
  });
  assert.ok(protectedUpdate);
  assert.equal(protectedUpdate.status, "completed");
  assert.equal(protectedUpdate.taskStoreFile, task.taskStoreFile);
  assert.deepEqual(protectedUpdate.supplementalRequirements, ["first", "7"]);

  const resumed = loopTaskStore.updateLoopTaskRecord(task.id, { status: "running" }, { allowCompletedToRunning: true });
  assert.ok(resumed);
  assert.equal(resumed.status, "running");

  loopTaskStore.appendLoopRound("missing-task", {
    round: 1,
    role: "main",
    status: "end",
    startedAt: 1,
    endedAt: 2,
  });
  loopTaskStore.appendLoopRound(task.id, {
    round: 3,
    role: "main",
    status: "end",
    startedAt: 3,
    endedAt: 4,
  });
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [] });
  loopTaskStore.appendLoopRound(task.id, {
    round: 99,
    role: "main",
    status: "end",
    startedAt: 99,
    endedAt: 100,
  });
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  loopTaskStore.appendLoopRound(task.id, {
    round: 3,
    role: "main",
    status: "end",
    startedAt: 3,
    endedAt: 4,
  });
  loopTaskStore.appendLoopRound(task.id, {
    round: 3,
    role: "main",
    status: "error",
    startedAt: 3,
    endedAt: 5,
    summary: "replaced summary",
  });
  loopTaskStore.appendLoopRound(task.id, {
    round: 2,
    role: "subtask",
    subtaskId: "persist-subtask",
    status: "stopped",
    startedAt: 2,
    endedAt: 6,
  });

  const persisted = readPersistedTask(task.taskStoreFile, task.id);
  assert.equal(persisted.currentRound, 3);
  assert.deepEqual(persisted.rounds, [
    {
      round: 3,
      role: "main",
      subtaskId: undefined,
      status: "error",
      startedAt: 3,
      endedAt: 5,
      summary: "replaced summary",
    },
    {
      round: 2,
      role: "subtask",
      subtaskId: "persist-subtask",
      status: "stopped",
      startedAt: 2,
      endedAt: 6,
      summary: undefined,
    },
  ]);
});

test("creates subtask communication files and persists their generated path", () => {
  const task = createTask({
    subTasks: [{
      id: "subtask / safe",
      title: "Write the report",
      writeFiles: ["src/one.ts", "src/two.ts"],
      status: "running",
    }, {
      id: "other-subtask",
      title: "Keep untouched",
      status: "pending",
    }],
  });
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  const filePath = loopTaskStore.prepareLoopSubtaskCommunicationFile(task, task.subTasks[0], 4, 2);
  const content = fs.readFileSync(filePath, "utf8");
  assert.match(content, /授权写入文件\/范围：src\/one\.ts、src\/two\.ts/u);
  assert.match(content, /轮次：4/u);
  assert.match(content, /重试次数：2/u);

  fs.appendFileSync(filePath, "\nPreserve this report.", "utf8");
  assert.equal(loopTaskStore.prepareLoopSubtaskCommunicationFile(task, task.subTasks[0], 4, 2), filePath);
  assert.match(fs.readFileSync(filePath, "utf8"), /Preserve this report\./u);
  assert.equal(readPersistedTask(task.taskStoreFile, task.id).subTasks[0].communicationFile, filePath);
  assert.equal(readPersistedTask(task.taskStoreFile, task.id).subTasks[1].communicationFile, undefined);
});

test("contains Loop communication init failures and store read races", () => {
  const blockedPaths = loopTaskStore.getLoopCommunicationPaths("blocked-communication");
  fs.mkdirSync(path.dirname(blockedPaths.dir), { recursive: true });
  fs.writeFileSync(blockedPaths.dir, "not a directory", "utf8");
  assert.doesNotThrow(() => loopTaskStore.ensureLoopCommunicationFiles("blocked-communication", "Blocked"));

  const missingTask = createTask({ id: "missing-communication-update" });
  const missingPaths = loopTaskStore.getLoopCommunicationPaths(missingTask.id);
  fs.mkdirSync(path.dirname(missingPaths.dir), { recursive: true });
  fs.writeFileSync(missingPaths.dir, "not a directory", "utf8");
  assert.doesNotThrow(() => {
    loopTaskStore.prepareLoopSubtaskCommunicationFile(missingTask, missingTask.subTasks[0], 1, 0);
  });

  const mismatchTask = createTask({ id: "read-mismatch-task", taskStoreFile: "legacy-stale-path" });
  const mismatchStoreFile = loopTaskStore.buildLoopTaskStoreFile(mismatchTask.cli, mismatchTask.workspaceKey, mismatchTask.sessionId ?? null, mismatchTask.id);
  loopTaskStore.writeLoopTaskStore(mismatchStoreFile, { tasks: [mismatchTask] });
  assert.equal(loopTaskStore.readLoopTaskRecord(mismatchTask.id)?.taskStoreFile, mismatchStoreFile);

  const raceTask = createTask({ id: "read-race-task" });
  loopTaskStore.writeLoopTaskStore(raceTask.taskStoreFile, { tasks: [raceTask] });
  const fsModule = require("fs") as typeof import("fs");
  const originalReadFileSync = fsModule.readFileSync;
  let readCount = 0;
  fsModule.readFileSync = ((target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
    if (String(target) === raceTask.taskStoreFile) {
      readCount += 1;
      if (readCount >= 2) {
        return JSON.stringify({ tasks: [] });
      }
    }
    return originalReadFileSync(target, options as never);
  }) as typeof fs.readFileSync;
  try {
    assert.equal(loopTaskStore.readLoopTaskRecord(raceTask.id), null);
  } finally {
    fsModule.readFileSync = originalReadFileSync;
  }

  loopTaskStore.writeLoopTaskStore(raceTask.taskStoreFile, { tasks: [raceTask] });
  readCount = 0;
  fsModule.readFileSync = ((target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
    if (String(target) === raceTask.taskStoreFile) {
      readCount += 1;
      if (readCount >= 2) {
        return JSON.stringify({ tasks: [] });
      }
    }
    return originalReadFileSync(target, options as never);
  }) as typeof fs.readFileSync;
  try {
    assert.equal(loopTaskStore.updateLoopTaskRecord(raceTask.id, { status: "completed" }), null);
    readCount = 0;
    loopTaskStore.appendLoopRound(raceTask.id, {
      round: 1,
      role: "main",
      status: "end",
      startedAt: 1,
      endedAt: 2,
    });
  } finally {
    fsModule.readFileSync = originalReadFileSync;
  }
});

test("lists task stores and removes only expired orphaned communication data", () => {
  const task = createTask();
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const flatStore = path.join(testHome, ".sinitek_cli", "loop-tasks.json");
  fs.mkdirSync(path.dirname(flatStore), { recursive: true });
  fs.writeFileSync(flatStore, JSON.stringify({ tasks: [] }), "utf8");

  const retainedCommunication = loopTaskStore.ensureLoopCommunicationFiles(task.id, task.rootPrompt);
  const orphanCommunication = loopTaskStore.ensureLoopCommunicationFiles("expired-orphan", "old prompt");
  const old = new Date(0);
  fs.utimesSync(orphanCommunication.mainFile, old, old);
  fs.utimesSync(orphanCommunication.subtasksDir, old, old);
  fs.utimesSync(orphanCommunication.dir, old, old);

  const files = loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(files.includes(task.taskStoreFile), true);
  assert.equal(files.includes(flatStore), true);

  loopTaskStore.cleanupLoopTaskStoreRetention();
  assert.equal(fs.existsSync(flatStore), false);
  loopTaskStore.cleanupLoopCommunicationRetention();
  assert.equal(fs.existsSync(retainedCommunication.dir), true);
  assert.equal(fs.existsSync(orphanCommunication.dir), false);
});

test("covers Loop communication retention empty roots and contained cleanup failures", () => {
  const communicationRoot = path.join(testHome, ".sinitek_cli", "loop-communications");
  fs.rmSync(communicationRoot, { recursive: true, force: true });

  assert.doesNotThrow(() => loopTaskStore.cleanupLoopCommunicationRetention());

  fs.mkdirSync(communicationRoot, { recursive: true });
  loopTaskStore.cleanupLoopCommunicationRetention();
  assert.equal(fs.existsSync(communicationRoot), false);

  fs.mkdirSync(communicationRoot, { recursive: true });
  fs.writeFileSync(path.join(communicationRoot, "not-a-task.txt"), "ignore", "utf8");
  loopTaskStore.cleanupLoopCommunicationRetention();
  assert.equal(fs.existsSync(communicationRoot), true);
  fs.rmSync(communicationRoot, { recursive: true, force: true });

  fs.mkdirSync(communicationRoot, { recursive: true });
  const fsModule = require("fs") as typeof import("fs");
  const originalReaddirSync = fsModule.readdirSync;
  const originalRmSync = fsModule.rmSync;
  const originalStatSync = fsModule.statSync;
  const originalStatSyncDescriptor = Object.getOwnPropertyDescriptor(fsModule, "statSync");
  const taskStoreRoot = path.join(testHome, ".sinitek_cli", "loop-tasks");
  fs.mkdirSync(taskStoreRoot, { recursive: true });
  fsModule.readdirSync = ((target: fs.PathLike, options?: unknown) => {
    if (String(target) === communicationRoot) {
      throw new Error("mock communication cleanup failure");
    }
    return originalReaddirSync(target, options as never);
  }) as typeof fs.readdirSync;
  try {
    assert.doesNotThrow(() => loopTaskStore.cleanupLoopCommunicationRetention());
  } finally {
    fsModule.readdirSync = originalReaddirSync;
  }

  fsModule.readdirSync = ((target: fs.PathLike, options?: unknown) => {
    if (String(target) === taskStoreRoot) {
      throw new Error("mock task store cleanup failure");
    }
    return originalReaddirSync(target, options as never);
  }) as typeof fs.readdirSync;
  try {
    assert.doesNotThrow(() => loopTaskStore.cleanupLoopTaskStoreRetention());
  } finally {
    fsModule.readdirSync = originalReaddirSync;
  }

  const old = new Date(0);
  const missingStatsDir = path.join(communicationRoot, "missing-stats");
  fs.mkdirSync(missingStatsDir, { recursive: true });
  fs.utimesSync(missingStatsDir, old, old);
  Object.defineProperty(fsModule, "statSync", {
    ...originalStatSyncDescriptor,
    configurable: true,
    value: ((target: fs.PathLike, options?: unknown) => {
      if (String(target) === missingStatsDir) {
        throw new Error("mock stat failure");
      }
      return originalStatSync(target, options as never);
    }) as typeof fs.statSync,
  });
  try {
    loopTaskStore.cleanupLoopCommunicationRetention();
  } finally {
    if (originalStatSyncDescriptor) {
      Object.defineProperty(fsModule, "statSync", originalStatSyncDescriptor);
    }
  }

  const unreadableTreeDir = path.join(communicationRoot, "unreadable-tree");
  fs.mkdirSync(unreadableTreeDir, { recursive: true });
  fs.utimesSync(unreadableTreeDir, old, old);
  fsModule.readdirSync = ((target: fs.PathLike, options?: unknown) => {
    if (String(target) === unreadableTreeDir) {
      throw new Error("mock tree read failure");
    }
    return originalReaddirSync(target, options as never);
  }) as typeof fs.readdirSync;
  try {
    loopTaskStore.cleanupLoopCommunicationRetention();
  } finally {
    fsModule.readdirSync = originalReaddirSync;
  }

  const deleteFailureDir = path.join(communicationRoot, "delete-failure");
  fs.mkdirSync(deleteFailureDir, { recursive: true });
  fs.utimesSync(deleteFailureDir, old, old);
  fsModule.rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
    if (String(target) === deleteFailureDir) {
      throw new Error("mock orphan delete failure");
    }
    return originalRmSync(target, options);
  }) as typeof fs.rmSync;
  try {
    assert.doesNotThrow(() => loopTaskStore.cleanupLoopCommunicationRetention());
  } finally {
    fsModule.rmSync = originalRmSync;
  }

  const flatStore = path.join(testHome, ".sinitek_cli", "loop-tasks.json");
  fs.writeFileSync(flatStore, JSON.stringify({ tasks: [] }), "utf8");
  const originalUnlinkSync = fsModule.unlinkSync;
  fsModule.unlinkSync = ((target: fs.PathLike) => {
    if (String(target) === flatStore) {
      throw new Error("mock flat store unlink failure");
    }
    return originalUnlinkSync(target);
  }) as typeof fs.unlinkSync;
  try {
    assert.doesNotThrow(() => loopTaskStore.cleanupLoopTaskStoreRetention());
  } finally {
    fsModule.unlinkSync = originalUnlinkSync;
    fs.rmSync(flatStore, { force: true });
  }
});

test("migrates legacy communication trees, equal files, and task stores through public discovery", () => {
  const dataDir = path.join(testHome, ".sinitek_cli");
  const legacyCommunicationDir = path.join(dataDir, "lobster-communications");
  const communicationDir = path.join(dataDir, "loop-communications");
  const legacyTaskFile = path.join(dataDir, "lobster-tasks.json");
  const task = createTask({
    id: "legacy-migration-task",
    taskStoreFile: legacyTaskFile,
    rootPrompt: "Migrate legacy task storage.",
  });
  const conflictTarget = path.join(communicationDir, "legacy-task", "shared.md");
  const identicalTarget = path.join(communicationDir, "legacy-task", "identical.md");
  fs.mkdirSync(path.dirname(conflictTarget), { recursive: true });
  fs.writeFileSync(conflictTarget, "current", "utf8");
  fs.writeFileSync(identicalTarget, "same", "utf8");
  fs.mkdirSync(path.join(legacyCommunicationDir, "legacy-task"), { recursive: true });
  fs.writeFileSync(path.join(legacyCommunicationDir, "legacy-task", "shared.md"), "legacy", "utf8");
  fs.writeFileSync(path.join(legacyCommunicationDir, "legacy-task", "identical.md"), "same", "utf8");
  fs.writeFileSync(path.join(legacyCommunicationDir, "legacy-task", "only-legacy.md"), "copied", "utf8");
  fs.writeFileSync(legacyTaskFile, JSON.stringify({ tasks: [task] }), "utf8");

  const discovered = loopTaskStore.listLoopTaskStoreFiles();
  const migratedTask = loopTaskStore.readLoopTaskRecord(task.id);

  assert.equal(fs.existsSync(legacyCommunicationDir), false);
  assert.equal(fs.existsSync(legacyTaskFile), false);
  assert.equal(fs.readFileSync(path.join(communicationDir, "legacy-task", "only-legacy.md"), "utf8"), "copied");
  assert.equal(fs.readFileSync(identicalTarget, "utf8"), "same");
  assert.equal(fs.readFileSync(conflictTarget, "utf8"), "current");
  assert.equal(
    fs.readFileSync(path.join(communicationDir, "legacy-task", "shared.pre-loop-migration.md"), "utf8"),
    "legacy",
  );
  assert.ok(migratedTask);
  assert.equal(migratedTask.taskStoreFile, loopTaskStore.buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId ?? null, task.id));
  assert.equal(discovered.includes(migratedTask.taskStoreFile), true);
});

test("covers legacy Loop migration failure and conflict boundaries", () => {
  resetLoopStorage();
  const legacy = getLegacyPaths();

  const renameTask = createTask({
    id: "legacy-rename-task",
    taskStoreFile: legacy.flatTaskFile,
    communicationDir: path.join(legacy.communicationDir, "legacy-rename-task"),
    mainCommunicationFile: path.join(legacy.communicationDir, "legacy-rename-task", "main-task.md"),
  });
  fs.mkdirSync(path.join(legacy.communicationDir, "legacy-rename-task"), { recursive: true });
  fs.writeFileSync(path.join(legacy.communicationDir, "legacy-rename-task", "main-task.md"), "legacy", "utf8");
  fs.writeFileSync(legacy.flatTaskFile, JSON.stringify({ tasks: [renameTask] }), "utf8");
  assert.ok(loopTaskStore.listLoopTaskStoreFiles().some((filePath) => filePath.endsWith("loop-tasks.json")));
  assert.equal(fs.existsSync(path.join(legacy.loopCommunicationDir, "legacy-rename-task", "main-task.md")), true);

  resetLoopStorage();
  fs.writeFileSync(legacy.flatTaskFile, JSON.stringify({ tasks: {} }), "utf8");
  assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());
  assert.equal(fs.existsSync(legacy.flatTaskFile), true);

  resetLoopStorage();
  const migrationNow = Date.now();
  const olderTargetTask = createTask({ id: "legacy-replaces-older", updatedAt: migrationNow });
  const olderLegacyFile = path.join(legacy.taskDir, "older", "lobster-tasks.json");
  const olderTargetFile = loopTaskStore.buildLoopTaskStoreFile(
    olderTargetTask.cli,
    olderTargetTask.workspaceKey,
    olderTargetTask.sessionId ?? null,
    olderTargetTask.id,
  );
  fs.mkdirSync(path.dirname(olderLegacyFile), { recursive: true });
  fs.writeFileSync(olderLegacyFile, JSON.stringify({ tasks: [{ ...olderTargetTask, taskStoreFile: olderLegacyFile }] }), "utf8");
  loopTaskStore.writeLoopTaskStore(olderTargetFile, { tasks: [{ ...olderTargetTask, updatedAt: migrationNow - 1, taskStoreFile: olderTargetFile }] });
  loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(readPersistedTask(olderTargetFile, olderTargetTask.id).updatedAt, migrationNow);

  resetLoopStorage();
  const newerTargetTask = createTask({ id: "legacy-keeps-newer", updatedAt: migrationNow });
  const newerLegacyFile = path.join(legacy.taskDir, "newer", "lobster-tasks.json");
  const newerTargetFile = loopTaskStore.buildLoopTaskStoreFile(
    newerTargetTask.cli,
    newerTargetTask.workspaceKey,
    newerTargetTask.sessionId ?? null,
    newerTargetTask.id,
  );
  fs.mkdirSync(path.dirname(newerLegacyFile), { recursive: true });
  fs.writeFileSync(newerLegacyFile, JSON.stringify({ tasks: [{ ...newerTargetTask, taskStoreFile: newerLegacyFile }] }), "utf8");
  loopTaskStore.writeLoopTaskStore(newerTargetFile, { tasks: [{ ...newerTargetTask, updatedAt: migrationNow + 1, taskStoreFile: newerTargetFile }] });
  loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(readPersistedTask(newerTargetFile, newerTargetTask.id).updatedAt, migrationNow + 1);

  resetLoopStorage();
  const rootFileTask = createTask({
    id: "legacy-root-file-task",
    taskStoreFile: legacy.flatTaskFile,
  });
  fs.writeFileSync(legacy.taskDir, "not a directory", "utf8");
  fs.writeFileSync(legacy.flatTaskFile, JSON.stringify({ tasks: [rootFileTask] }), "utf8");
  assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());

  resetLoopStorage();
  fs.mkdirSync(legacy.communicationDir, { recursive: true });
  fs.writeFileSync(legacy.loopCommunicationDir, "not a directory", "utf8");
  assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());

  resetLoopStorage();
  fs.mkdirSync(legacy.loopCommunicationDir, { recursive: true });
  fs.mkdirSync(path.join(legacy.communicationDir, "symlink-source"), { recursive: true });
  const sourceSymlinkDir = path.join(legacy.communicationDir, "symlink-source");
  const sourceSymlink = path.join(legacy.communicationDir, "symlink-source", "link.md");
  const sourceLinkTarget = path.join(legacy.communicationDir, "symlink-source", "target.md");
  fs.writeFileSync(sourceLinkTarget, "target", "utf8");
  fs.symlinkSync(sourceLinkTarget, sourceSymlink);
  const fsModuleForSourceLink = require("fs") as typeof import("fs");
  const originalSourceLinkReaddir = fsModuleForSourceLink.readdirSync;
  let sourceDirReads = 0;
  fsModuleForSourceLink.readdirSync = ((target: fs.PathLike, options?: unknown) => {
    if (String(target) === sourceSymlinkDir) {
      sourceDirReads += 1;
      if (sourceDirReads === 1) {
        return [];
      }
    }
    return originalSourceLinkReaddir(target, options as never);
  }) as typeof fs.readdirSync;
  try {
    assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());
  } finally {
    fsModuleForSourceLink.readdirSync = originalSourceLinkReaddir;
  }

  resetLoopStorage();
  fs.mkdirSync(path.join(legacy.communicationDir, "assert-symlink"), { recursive: true });
  const assertSymlinkTarget = path.join(legacy.communicationDir, "assert-symlink", "target.md");
  fs.writeFileSync(assertSymlinkTarget, "target", "utf8");
  fs.symlinkSync(assertSymlinkTarget, path.join(legacy.communicationDir, "assert-symlink", "link.md"));
  assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());

  resetLoopStorage();
  fs.mkdirSync(path.join(legacy.communicationDir, "target-link"), { recursive: true });
  fs.writeFileSync(path.join(legacy.communicationDir, "target-link", "shared.md"), "legacy", "utf8");
  fs.mkdirSync(path.join(legacy.loopCommunicationDir, "target-link"), { recursive: true });
  const targetLinkTarget = path.join(legacy.loopCommunicationDir, "target-link", "target.md");
  fs.writeFileSync(targetLinkTarget, "target", "utf8");
  fs.symlinkSync(targetLinkTarget, path.join(legacy.loopCommunicationDir, "target-link", "shared.md"));
  assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());

  resetLoopStorage();
  fs.mkdirSync(path.join(legacy.communicationDir, "conflict"), { recursive: true });
  fs.writeFileSync(path.join(legacy.communicationDir, "conflict", "shared.md"), "legacy", "utf8");
  fs.mkdirSync(path.join(legacy.loopCommunicationDir, "conflict"), { recursive: true });
  fs.writeFileSync(path.join(legacy.loopCommunicationDir, "conflict", "shared.md"), "current", "utf8");
  const conflictLinkTarget = path.join(legacy.loopCommunicationDir, "conflict", "target.md");
  fs.writeFileSync(conflictLinkTarget, "target", "utf8");
  fs.symlinkSync(conflictLinkTarget, path.join(legacy.loopCommunicationDir, "conflict", "shared.pre-loop-migration.md"));
  assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());

  resetLoopStorage();
  fs.mkdirSync(path.join(legacy.communicationDir, "sequence-candidate"), { recursive: true });
  fs.writeFileSync(path.join(legacy.communicationDir, "sequence-candidate", "shared.md"), "legacy", "utf8");
  fs.mkdirSync(path.join(legacy.loopCommunicationDir, "sequence-candidate"), { recursive: true });
  fs.writeFileSync(path.join(legacy.loopCommunicationDir, "sequence-candidate", "shared.md"), "current", "utf8");
  fs.writeFileSync(path.join(legacy.loopCommunicationDir, "sequence-candidate", "shared.pre-loop-migration.md"), "different", "utf8");
  loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(fs.readFileSync(path.join(legacy.loopCommunicationDir, "sequence-candidate", "shared.pre-loop-migration-1.md"), "utf8"), "legacy");

  resetLoopStorage();
  fs.mkdirSync(path.join(legacy.communicationDir, "equal-candidate"), { recursive: true });
  fs.writeFileSync(path.join(legacy.communicationDir, "equal-candidate", "shared.md"), "legacy", "utf8");
  fs.mkdirSync(path.join(legacy.loopCommunicationDir, "equal-candidate"), { recursive: true });
  fs.writeFileSync(path.join(legacy.loopCommunicationDir, "equal-candidate", "shared.md"), "current", "utf8");
  fs.writeFileSync(path.join(legacy.loopCommunicationDir, "equal-candidate", "shared.pre-loop-migration.md"), "legacy", "utf8");
  loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(fs.readFileSync(path.join(legacy.loopCommunicationDir, "equal-candidate", "shared.pre-loop-migration.md"), "utf8"), "legacy");

  resetLoopStorage();
  fs.mkdirSync(path.join(legacy.communicationDir, "directory-candidate", "shared"), { recursive: true });
  fs.writeFileSync(path.join(legacy.communicationDir, "directory-candidate", "shared", "only-legacy.md"), "legacy", "utf8");
  fs.mkdirSync(path.join(legacy.loopCommunicationDir, "directory-candidate", "shared.pre-loop-migration"), { recursive: true });
  fs.writeFileSync(path.join(legacy.loopCommunicationDir, "directory-candidate", "shared"), "current", "utf8");
  loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(fs.existsSync(path.join(legacy.loopCommunicationDir, "directory-candidate", "shared.pre-loop-migration", "only-legacy.md")), true);

  resetLoopStorage();
  fs.mkdirSync(legacy.loopCommunicationDir, { recursive: true });
  fs.mkdirSync(path.join(legacy.communicationDir, "special-source"), { recursive: true });
  const specialSource = path.join(legacy.communicationDir, "special-source", "special.md");
  fs.writeFileSync(specialSource, "special", "utf8");
  const fsModule = require("fs") as typeof import("fs");
  const originalLstatSync = fsModule.lstatSync;
  const originalLstatSyncDescriptor = Object.getOwnPropertyDescriptor(fsModule, "lstatSync");
  Object.defineProperty(fsModule, "lstatSync", {
    ...originalLstatSyncDescriptor,
    configurable: true,
    value: ((target: fs.PathLike, options?: fs.StatOptions) => {
      const stats = originalLstatSync(target, options as never);
      if (String(target) === specialSource) {
        return {
          ...stats,
          isDirectory: () => false,
          isFile: () => false,
          isSymbolicLink: () => false,
        } as fs.Stats;
      }
      return stats;
    }) as typeof fs.lstatSync,
  });
  try {
    assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());
  } finally {
    if (originalLstatSyncDescriptor) {
      Object.defineProperty(fsModule, "lstatSync", originalLstatSyncDescriptor);
    }
    resetLoopStorage();
  }

  resetLoopStorage();
  const verificationTask = createTask({ id: "legacy-verification-fail" });
  const verificationLegacyFile = path.join(legacy.taskDir, "verification", "lobster-tasks.json");
  const verificationTargetFile = loopTaskStore.buildLoopTaskStoreFile(
    verificationTask.cli,
    verificationTask.workspaceKey,
    verificationTask.sessionId ?? null,
    verificationTask.id,
  );
  fs.mkdirSync(path.dirname(verificationLegacyFile), { recursive: true });
  fs.writeFileSync(verificationLegacyFile, JSON.stringify({ tasks: [{ ...verificationTask, taskStoreFile: verificationLegacyFile }] }), "utf8");
  const fsModuleForVerification = require("fs") as typeof import("fs");
  const originalVerificationReadFileSync = fsModuleForVerification.readFileSync;
  let verificationReads = 0;
  fsModuleForVerification.readFileSync = ((target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
    if (String(target) === verificationTargetFile) {
      verificationReads += 1;
      if (verificationReads >= 1) {
        return JSON.stringify({ tasks: [] });
      }
    }
    return originalVerificationReadFileSync(target, options as never);
  }) as typeof fs.readFileSync;
  try {
    assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles());
  } finally {
    fsModuleForVerification.readFileSync = originalVerificationReadFileSync;
    resetLoopStorage();
  }
});

test("moves task records between pending and session stores through public binding APIs", () => {
  const task = createTask({ sessionId: null });
  task.taskStoreFile = loopTaskStore.buildLoopTaskStoreFile(task.cli, task.workspaceKey, null, task.id);
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  assert.equal(loopTaskStore.bindLoopTaskToSession(task.id, " "), null);
  const bound = loopTaskStore.bindLoopTaskToSession(task.id, "bound-session");
  assert.ok(bound);
  assert.equal(bound.sessionId, "bound-session");
  assert.equal(fs.existsSync(task.taskStoreFile), false);
  assert.equal(loopTaskStore.bindLoopTaskToSession(task.id, "bound-session")?.taskStoreFile, bound.taskStoreFile);
  assert.equal(loopTaskStore.bindLoopTaskToRuntimeTarget("missing-runtime-task", "codex", null), null);

  const runtimeBound = loopTaskStore.bindLoopTaskToRuntimeTarget(task.id, "claude", null);
  assert.ok(runtimeBound);
  assert.equal(runtimeBound.cli, "claude");
  assert.equal(runtimeBound.sessionId, null);
  assert.match(runtimeBound.taskStoreFile, /__pending__/u);
  assert.equal(loopTaskStore.bindLoopTaskToRuntimeTarget(task.id, "claude", null)?.taskStoreFile, runtimeBound.taskStoreFile);

  const moveTask = createTask({ id: "move-existing-target", sessionId: null });
  moveTask.taskStoreFile = loopTaskStore.buildLoopTaskStoreFile(moveTask.cli, moveTask.workspaceKey, null, moveTask.id);
  const targetFile = loopTaskStore.getLoopTaskStoreSessionFile(moveTask.workspaceKey, moveTask.cli, "target-session");
  loopTaskStore.writeLoopTaskStore(moveTask.taskStoreFile, { tasks: [moveTask] });
  loopTaskStore.writeLoopTaskStore(targetFile, { tasks: [{ ...moveTask, sessionId: "target-session", taskStoreFile: targetFile }] });
  const moved = loopTaskStore.updateLoopTaskRecord(moveTask.id, {
    sessionId: "target-session",
    taskStoreFile: targetFile,
  });
  assert.equal(moved?.taskStoreFile, targetFile);
  assert.equal(loopTaskStore.readLoopTaskStore(targetFile).tasks.length, 1);

  const sourceSibling = createTask({ id: "move-source-sibling", sessionId: null });
  const replaceTarget = createTask({ id: "move-replace-target", sessionId: null });
  const sharedSourceFile = loopTaskStore.buildLoopTaskStoreFile(replaceTarget.cli, replaceTarget.workspaceKey, null, replaceTarget.id);
  sourceSibling.taskStoreFile = sharedSourceFile;
  replaceTarget.taskStoreFile = sharedSourceFile;
  const replaceTargetFile = loopTaskStore.getLoopTaskStoreSessionFile(replaceTarget.workspaceKey, replaceTarget.cli, "replace-target-session");
  const replaceNow = Date.now();
  loopTaskStore.writeLoopTaskStore(sharedSourceFile, { tasks: [sourceSibling, replaceTarget] });
  assert.equal(loopTaskStore.readLoopTaskRecord(replaceTarget.id)?.taskStoreFile, sharedSourceFile);
  loopTaskStore.writeLoopTaskStore(replaceTargetFile, {
    tasks: [{ ...replaceTarget, sessionId: "replace-target-session", taskStoreFile: replaceTargetFile, updatedAt: replaceNow }],
  });
  const replaced = loopTaskStore.updateLoopTaskRecord(replaceTarget.id, {
    sessionId: "replace-target-session",
    taskStoreFile: replaceTargetFile,
    updatedAt: replaceNow + 1,
  });
  assert.equal(replaced?.taskStoreFile, replaceTargetFile);
  assert.equal(readPersistedTask(replaceTargetFile, replaceTarget.id).updatedAt, replaceNow + 1);

  const unlinkTask = createTask({ id: "move-unlink-error", sessionId: null });
  unlinkTask.taskStoreFile = loopTaskStore.buildLoopTaskStoreFile(unlinkTask.cli, unlinkTask.workspaceKey, null, unlinkTask.id);
  loopTaskStore.writeLoopTaskStore(unlinkTask.taskStoreFile, { tasks: [unlinkTask] });
  const fsModule = require("fs") as typeof import("fs");
  const originalUnlinkSync = fsModule.unlinkSync;
  fsModule.unlinkSync = ((target: fs.PathLike) => {
    if (String(target) === unlinkTask.taskStoreFile) {
      throw new Error("mock move source unlink failure");
    }
    return originalUnlinkSync(target);
  }) as typeof fs.unlinkSync;
  try {
    assert.ok(loopTaskStore.bindLoopTaskToSession(unlinkTask.id, "unlink-target"));
  } finally {
    fsModule.unlinkSync = originalUnlinkSync;
  }

  const patchTask = createTask({ id: "move-patch-arrays", sessionId: null });
  patchTask.taskStoreFile = loopTaskStore.buildLoopTaskStoreFile(patchTask.cli, patchTask.workspaceKey, null, patchTask.id);
  loopTaskStore.writeLoopTaskStore(patchTask.taskStoreFile, { tasks: [patchTask] });
  const patched = loopTaskStore.updateLoopTaskRecord(patchTask.id, {
    rounds: [{ round: 3, role: "main", status: "end", startedAt: 1, endedAt: 2 }],
    debateRounds: [{ loopRound: 3, debateRound: 1, status: "consensus", startedAt: Date.now(), briefFile: "brief.md", participants: [] }],
    supplementalRequirements: [" keep this ", " "],
    completionRoundSummaries: [{ round: 3, title: "Round", summary: "Complete" }],
    completionRequirementCoverage: [{ name: "coverage", passed: true }],
  });
  assert.equal(patched?.rounds[0]?.round, 3);
  assert.equal(patched?.debateRounds?.[0]?.loopRound, 3);
  assert.deepEqual(patched?.supplementalRequirements, ["keep this"]);
  assert.equal(patched?.completionRoundSummaries[0]?.title, "Round");
  assert.equal(patched?.completionRequirementCoverage[0]?.passed, true);
});

test("normalizes malformed optional Loop records without preserving invalid details", () => {
  const filePath = path.join(testHome, "optional-normalization", "loop-tasks.json");
  const now = Date.now();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    tasks: [
      {
        id: "optional-normalization",
        cli: "codex",
        rootPrompt: "Normalize optional records.",
        createdAt: now,
        updatedAt: now,
        maxRounds: "not-a-number",
        activeSubtaskId: "active-subtask",
        answerConclusion: "Done",
        finalSummary: "Summary",
        estimatedRemainingRounds: "4",
        mainAiLastFailureAt: now,
        mainAiLastFailureMessage: "Last failure",
        subTasks: [
          null,
          {
            id: "subtask",
            title: "Optional",
            conflictGroup: "group-a",
            skillIds: ["valid-skill", "valid-skill", "bad skill"],
            skillGuidance: "guidance",
          },
          { id: "invalid-skills", title: "Invalid skills", skillIds: ["bad skill"], skillGuidance: "guidance" },
        ],
        rounds: [null, { round: 1, role: "main", status: "bad" }, { round: 2, role: "subtask", status: "end" }],
        completionRoundSummaries: [
          null,
          { round: 0, title: "Bad round", summary: "Ignored" },
          { round: 1.9, title: " Summary title ", summary: " Summary text ", subtaskId: " subtask " },
          { round: 2, title: "", summary: "Ignored" },
          { round: 3, title: "Ignored", summary: "" },
          { round: 4, title: 123, summary: 456 },
        ],
        completionRequirementCoverage: [{ passed: false, detail: "missing name" }],
      },
      {
        id: "fallback-normalization",
        cli: "codex",
        rootPrompt: "Use defaults.",
        maxRounds: "",
        estimatedRemainingRounds: 2,
      },
      {
        id: "invalid-cli",
        cli: "unknown",
        rootPrompt: "Filtered out.",
      },
    ],
  }), "utf8");

  const tasks = loopTaskStore.readLoopTaskStore(filePath).tasks;
  const task = tasks[0];
  assert.equal(task.maxRounds, 20);
  assert.deepEqual(task.subTasks[0]?.skillIds, ["valid-skill"]);
  assert.equal(task.subTasks[0]?.skillGuidance, "guidance");
  assert.equal(task.subTasks[0]?.conflictGroup, "group-a");
  assert.equal(task.subTasks[1]?.skillIds, undefined);
  assert.deepEqual(task.rounds.map((round) => round.round), [2]);
  assert.equal(task.answerConclusion, "Done");
  assert.equal(task.finalSummary, "Summary");
  assert.equal(task.estimatedRemainingRounds, 4);
  assert.equal(task.mainAiLastFailureAt, now);
  assert.equal(task.mainAiLastFailureMessage, "Last failure");
  assert.deepEqual(task.activeSubtaskIds, ["active-subtask"]);
  assert.deepEqual(task.completionRoundSummaries, [{
    round: 1,
    subtaskId: "subtask",
    title: "Summary title",
    summary: "Summary text",
  }]);
  assert.deepEqual(task.completionRequirementCoverage, [{ name: "acceptance", passed: false, detail: "missing name" }]);
  assert.equal(tasks[1]?.createdAt, tasks[1]?.updatedAt);
  assert.equal(tasks.length, 2);

  assert.equal(
    loopTaskStore.buildLoopTaskStoreFile("claude", null as unknown as string, null as unknown as string, null as unknown as string),
    path.join(testHome, ".sinitek_cli", "loop-tasks", "no-workspace", "claude", "__pending__", "task", "loop-tasks.json"),
  );

  resetLoopStorage();
  const legacy = getLegacyPaths();
  const legacyMissingSessionTask = createTask({ id: "legacy-missing-session", sessionId: undefined });
  const legacyMissingSessionFile = path.join(legacy.taskDir, "missing-session", "lobster-tasks.json");
  fs.mkdirSync(path.dirname(legacyMissingSessionFile), { recursive: true });
  fs.writeFileSync(legacyMissingSessionFile, JSON.stringify({
    tasks: [{ ...legacyMissingSessionTask, taskStoreFile: legacyMissingSessionFile }],
  }), "utf8");
  loopTaskStore.listLoopTaskStoreFiles();
  assert.equal(loopTaskStore.readLoopTaskRecord("legacy-missing-session")?.sessionId, null);

  resetLoopStorage();
  fs.writeFileSync(legacy.flatTaskFile, JSON.stringify({
    tasks: [{
      id: "legacy-fallback-store",
      cli: "codex",
      rootPrompt: "Build a modern task store path.",
      createdAt: now,
      updatedAt: now,
      status: "running",
      maxRounds: 3,
      currentRound: 1,
    }],
  }), "utf8");
  const legacyTask = loopTaskStore.readLoopTaskStore(legacy.flatTaskFile).tasks[0];
  assert.match(legacyTask.taskStoreFile, /loop-tasks/);

  const undefinedStoreFile = path.join(testHome, "optional-normalization", "undefined-store.json");
  loopTaskStore.writeLoopTaskStore(undefinedStoreFile, undefined as unknown as import("../loopTaskStore").LoopTaskStore);
  assert.deepEqual(loopTaskStore.readLoopTaskStore(undefinedStoreFile), { tasks: [] });

  fs.mkdirSync(legacy.communicationDir, { recursive: true });
  const retainedTask = createTask({
    id: "legacy-retained-write",
    taskStoreFile: legacy.flatTaskFile,
    communicationDir: path.join(legacy.communicationDir, "legacy-retained-write"),
    mainCommunicationFile: path.join(legacy.communicationDir, "legacy-retained-write", "main-task.md"),
  });
  loopTaskStore.writeLoopTaskStore(legacy.flatTaskFile, { tasks: [retainedTask] });
  assert.equal(loopTaskStore.readLoopTaskStore(legacy.flatTaskFile).tasks[0]?.communicationDir, retainedTask.communicationDir);
});
