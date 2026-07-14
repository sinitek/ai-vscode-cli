import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const originalHome = process.env.HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-lobster-task-store-"));
process.env.HOME = testHome;
const lobsterTaskStore = require("../lobsterTaskStore") as typeof import("../lobsterTaskStore");
if (originalHome === undefined) {
  delete process.env.HOME;
} else {
  process.env.HOME = originalHome;
}

let recordSequence = 0;

type SkillTaskRecord = import("../lobsterTaskStore").LobsterTaskRecord;
type SkillSubtaskDecision = import("../lobsterTaskStore").LobsterSubtaskDecision;

test.after(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});

function hasOwnProperty(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function createLegacyTask(): import("../lobsterTaskStore").LobsterTaskRecord {
  recordSequence += 1;
  const now = Date.now();
  const id = `legacy-task-${recordSequence}`;
  const taskStoreFile = lobsterTaskStore.buildLobsterTaskStoreFile(
    "codex",
    "lobster-task-store-test",
    `session-${recordSequence}`,
    id,
  );
  return {
    id,
    cli: "codex",
    workspaceKey: "lobster-task-store-test",
    taskStoreFile,
    rootPrompt: "Preserve legacy Loop task behavior.",
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: 20,
    currentRound: 1,
    communicationDir: path.join(testHome, "communications", id),
    mainCommunicationFile: path.join(testHome, "communications", id, "main-task.md"),
    sessionId: `session-${recordSequence}`,
    activeSubtaskId: "legacy-subtask",
    activeSubtaskIds: ["legacy-subtask"],
    subTasks: [{
      id: "legacy-subtask",
      title: "Legacy subtask",
      prompt: "Run the existing workflow without skill guidance.",
      status: "running",
      updatedAt: now,
    }],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function readSkillTask(filePath: string): SkillTaskRecord {
  const task = lobsterTaskStore.readLobsterTaskStore(filePath).tasks[0];
  assert.ok(task);
  return task;
}

test("accepts optional skill IDs on subtask decisions without changing legacy decisions", () => {
  const legacyDecision: SkillSubtaskDecision = {
    title: "Legacy decision",
    prompt: "Run the existing subtask without selecting skills.",
  };
  const skillDecision: SkillSubtaskDecision = {
    title: "Skill-guided decision",
    prompt: "Use the selected development skills as execution requirements.",
    skillIds: ["test-driven-development", "incremental-implementation"],
  };

  assert.equal(hasOwnProperty(legacyDecision, "skillIds"), false);
  assert.deepEqual(skillDecision.skillIds, [
    "test-driven-development",
    "incremental-implementation",
  ]);
});

test("initializes subtask communication with a structured main-task confirmation section", () => {
  const task = createLegacyTask();
  lobsterTaskStore.writeLobsterTaskStore(task.taskStoreFile, { tasks: [task] });

  const communicationFile = lobsterTaskStore.prepareLobsterSubtaskCommunicationFile(
    task,
    task.subTasks[0],
    1,
    0,
  );
  const content = fs.readFileSync(communicationFile, "utf8");
  const persisted = lobsterTaskStore.readLobsterTaskRecord(task.id);

  assert.match(content, /## 待主任务确认/u);
  assert.match(content, /- 当前状态：无/u);
  assert.match(content, /- 待确认问题：无/u);
  assert.match(content, /- 已知事实：无/u);
  assert.match(content, /- 影响\/阻塞步骤：无/u);
  assert.match(content, /- 可选方案：无/u);
  assert.match(content, /- 推荐方案：无/u);
  assert.match(content, /立即停止实施.*不要在 assistant 回复中提问或复述问题/su);
  assert.equal(persisted?.subTasks[0]?.communicationFile, communicationFile);
});

test("reads and rewrites legacy records without adding skill fields", () => {
  const legacyTask = createLegacyTask();
  fs.mkdirSync(path.dirname(legacyTask.taskStoreFile), { recursive: true });
  fs.writeFileSync(legacyTask.taskStoreFile, JSON.stringify({ tasks: [legacyTask] }, null, 2), "utf8");

  const loaded = lobsterTaskStore.readLobsterTaskStore(legacyTask.taskStoreFile);
  assert.equal(loaded.tasks.length, 1);
  assert.equal(hasOwnProperty(loaded.tasks[0], "taskKind"), false);
  assert.equal(hasOwnProperty(loaded.tasks[0].subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.tasks[0].subTasks[0], "skillGuidance"), false);

  lobsterTaskStore.writeLobsterTaskStore(legacyTask.taskStoreFile, loaded);
  const persisted = JSON.parse(fs.readFileSync(legacyTask.taskStoreFile, "utf8")) as {
    tasks: Array<{ taskKind?: unknown; subTasks: Array<{ skillIds?: unknown; skillGuidance?: unknown }> }>;
  };
  assert.equal(hasOwnProperty(persisted.tasks[0], "taskKind"), false);
  assert.equal(hasOwnProperty(persisted.tasks[0].subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(persisted.tasks[0].subTasks[0], "skillGuidance"), false);
});

test("keeps legacy records skill-free through resume and completion updates", () => {
  const legacyTask = createLegacyTask();
  lobsterTaskStore.writeLobsterTaskStore(legacyTask.taskStoreFile, { tasks: [legacyTask] });

  const resumed = lobsterTaskStore.readLobsterTaskRecord(legacyTask.id);
  assert.ok(resumed);
  assert.equal(hasOwnProperty(resumed, "taskKind"), false);
  assert.equal(hasOwnProperty(resumed.subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(resumed.subTasks[0], "skillGuidance"), false);

  const completedSubtasks = resumed.subTasks.map((subtask) => ({
    ...subtask,
    status: "completed" as const,
    summary: "Legacy subtask completed.",
    communicationFile: path.join(resumed.communicationDir, "legacy-subtask.md"),
    updatedAt: Date.now(),
  }));
  const completed = lobsterTaskStore.updateLobsterTaskRecord(legacyTask.id, {
    status: "completed",
    subTasks: completedSubtasks,
    finalSummary: "Legacy task completed.",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: Date.now(),
  });

  assert.ok(completed);
  assert.equal(hasOwnProperty(completed, "taskKind"), false);
  assert.equal(hasOwnProperty(completed.subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(completed.subTasks[0], "skillGuidance"), false);
  const persisted = lobsterTaskStore.readLobsterTaskStore(legacyTask.taskStoreFile).tasks[0];
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.subTasks[0].status, "completed");
  assert.equal(persisted.subTasks[0].summary, "Legacy subtask completed.");
  assert.equal(hasOwnProperty(persisted, "taskKind"), false);
  assert.equal(hasOwnProperty(persisted.subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(persisted.subTasks[0], "skillGuidance"), false);
});

test("round-trips confirmed task kind and bounded subtask skill snapshots", () => {
  const baseTask = createLegacyTask();
  const skillGuidance = "Use a failing test before the minimal implementation.\n";
  const task: SkillTaskRecord = {
    ...baseTask,
    taskKind: "development",
    subTasks: [{
      ...baseTask.subTasks[0],
      skillIds: ["test-driven-development", "incremental-implementation"],
      skillGuidance,
    }],
  };

  lobsterTaskStore.writeLobsterTaskStore(task.taskStoreFile, { tasks: [task] });
  const loaded = readSkillTask(task.taskStoreFile);
  assert.equal(loaded.taskKind, "development");
  assert.deepEqual(loaded.subTasks[0].skillIds, [
    "test-driven-development",
    "incremental-implementation",
  ]);
  assert.equal(loaded.subTasks[0].skillGuidance, skillGuidance);

  lobsterTaskStore.writeLobsterTaskStore(task.taskStoreFile, { tasks: [loaded] });
  const persisted = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8")) as {
    tasks: Array<{
      taskKind?: unknown;
      subTasks: Array<{ skillIds?: unknown; skillGuidance?: unknown }>;
    }>;
  };
  assert.equal(persisted.tasks[0].taskKind, "development");
  assert.deepEqual(persisted.tasks[0].subTasks[0].skillIds, [
    "test-driven-development",
    "incremental-implementation",
  ]);
  assert.equal(persisted.tasks[0].subTasks[0].skillGuidance, skillGuidance);
});

test("normalizes bounded snapshots and drops invalid or half-present skill fields at the store boundary", () => {
  const baseTask = createLegacyTask();
  const exactLimitGuidance = "g".repeat(32_000);
  const rawTask = {
    ...baseTask,
    taskKind: "planning",
    skillPath: "/tmp/untrusted-skill.md",
    subTasks: [
      {
        ...baseTask.subTasks[0],
        id: "bounded-subtask",
        skillIds: [
          " test-driven-development ",
          42,
          "",
          "UPPER_CASE",
          "../escape",
          "test-driven-development",
          "incremental-implementation",
          "deprecation-and-migration",
          "source-driven-development",
        ],
        skillGuidance: "g".repeat(32_001),
        guidanceFile: "/tmp/untrusted-skill.md",
        command: "cat /tmp/untrusted-skill.md",
      },
      {
        ...baseTask.subTasks[0],
        id: "exact-limit-subtask",
        skillIds: ["test-driven-development"],
        skillGuidance: exactLimitGuidance,
      },
      {
        ...baseTask.subTasks[0],
        id: "ids-only-subtask",
        skillIds: ["test-driven-development"],
      },
      {
        ...baseTask.subTasks[0],
        id: "guidance-only-subtask",
        skillGuidance: "independent guidance must not survive normalization",
      },
      {
        ...baseTask.subTasks[0],
        id: "invalid-types-subtask",
        skillIds: "test-driven-development",
        skillGuidance: 123,
      },
    ],
  };

  lobsterTaskStore.writeLobsterTaskStore(rawTask.taskStoreFile, {
    tasks: [rawTask as unknown as import("../lobsterTaskStore").LobsterTaskRecord],
  });
  const loaded = readSkillTask(rawTask.taskStoreFile);
  assert.equal(hasOwnProperty(loaded, "taskKind"), false);
  assert.equal(hasOwnProperty(loaded, "skillPath"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[0], "skillGuidance"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[0], "guidanceFile"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[0], "command"), false);
  assert.deepEqual(loaded.subTasks[1].skillIds, ["test-driven-development"]);
  assert.equal(loaded.subTasks[1].skillGuidance, exactLimitGuidance);
  assert.equal(hasOwnProperty(loaded.subTasks[2], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[2], "skillGuidance"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[3], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[3], "skillGuidance"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[4], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[4], "skillGuidance"), false);
});

test("round-trips non-development task kind without adding subtask skill fields", () => {
  const baseTask = createLegacyTask();
  const task: SkillTaskRecord = {
    ...baseTask,
    taskKind: "non_development",
    subTasks: [...baseTask.subTasks],
  };

  lobsterTaskStore.writeLobsterTaskStore(task.taskStoreFile, { tasks: [task] });
  const loaded = readSkillTask(task.taskStoreFile);
  assert.equal(loaded.taskKind, "non_development");
  assert.equal(hasOwnProperty(loaded.subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.subTasks[0], "skillGuidance"), false);
});

test("preserves confirmed skill fields through communication, retry, and completion updates", () => {
  const baseTask = createLegacyTask();
  const skillGuidance = "Keep the implementation incremental and verified.\n";
  const task: SkillTaskRecord = {
    ...baseTask,
    taskKind: "development",
    subTasks: [{
      ...baseTask.subTasks[0],
      skillIds: ["incremental-implementation"],
      skillGuidance,
    }],
  };
  lobsterTaskStore.writeLobsterTaskStore(task.taskStoreFile, { tasks: [task] });

  const resumed = lobsterTaskStore.readLobsterTaskRecord(task.id) as SkillTaskRecord | null;
  assert.ok(resumed);
  const retried = lobsterTaskStore.updateLobsterTaskRecord(task.id, {
    subTasks: resumed.subTasks.map((subtask) => ({
      ...subtask,
      status: "running" as const,
      communicationFile: path.join(resumed.communicationDir, "retry.md"),
      updatedAt: Date.now(),
    })),
    updatedAt: Date.now(),
  }) as SkillTaskRecord | null;

  assert.ok(retried);
  assert.equal(retried.taskKind, "development");
  assert.deepEqual(retried.subTasks[0].skillIds, ["incremental-implementation"]);
  assert.equal(retried.subTasks[0].skillGuidance, skillGuidance);
  assert.equal(retried.subTasks[0].communicationFile, path.join(resumed.communicationDir, "retry.md"));

  const completed = lobsterTaskStore.updateLobsterTaskRecord(task.id, {
    status: "completed",
    subTasks: retried.subTasks.map((subtask) => ({
      ...subtask,
      status: "completed" as const,
      summary: "Confirmed skill-guided subtask completed.",
      updatedAt: Date.now(),
    })),
    finalSummary: "Confirmed task completed.",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: Date.now(),
  }) as SkillTaskRecord | null;

  assert.ok(completed);
  assert.equal(completed.taskKind, "development");
  assert.deepEqual(completed.subTasks[0].skillIds, ["incremental-implementation"]);
  assert.equal(completed.subTasks[0].skillGuidance, skillGuidance);
  assert.equal(completed.subTasks[0].status, "completed");
  assert.equal(completed.subTasks[0].summary, "Confirmed skill-guided subtask completed.");
  const persisted = readSkillTask(task.taskStoreFile);
  assert.equal(persisted.taskKind, "development");
  assert.deepEqual(persisted.subTasks[0].skillIds, ["incremental-implementation"]);
  assert.equal(persisted.subTasks[0].skillGuidance, skillGuidance);
});
