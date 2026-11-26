import test = require("node:test");
import assert = require("node:assert/strict");
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Isolate before importing modules that capture os.homedir() at load time.
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-task-store-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
assert.equal(os.homedir(), testHome);
test.after(() => {
  try {
    assert.equal(path.dirname(testHome), path.resolve(os.tmpdir()));
    assert.ok(path.basename(testHome).startsWith("sinitek-loop-task-store-"));
    fs.rmSync(testHome, { recursive: true, force: true });
    assert.equal(fs.existsSync(testHome), false);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  }
});

import { getLegacyLoopStoragePaths } from "../../loopLegacyMigration";

const loopTaskStore = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
assert.equal(loopTaskStore.getLoopCommunicationPaths("isolation-probe").dir,
  path.join(testHome, ".sinitek_cli", "loop-communications", "isolation-probe"));

let recordSequence = 0;

type SkillTaskRecord = import("../../loopTaskStore").LoopTaskRecord;
type SkillSubtaskDecision = import("../../loopTaskStore").LoopSubtaskDecision;

test("moves legacy task stores before identity catalog bootstrap in isolated home", () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-legacy-migration-"));
  const task = createLegacyTask();
  const modulePath = require.resolve("../../loopTaskStore");
  const legacyMigrationPath = require.resolve("../../loopLegacyMigration");
  const script = `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    assert.equal(os.homedir(), process.env.HOME);
    const store = require(process.argv[1]);
    const { getLegacyLoopStoragePaths } = require(process.argv[2]);
    const task = JSON.parse(process.env.LOOP_LEGACY_TASK);
    const dataDir = path.join(os.homedir(), ".sinitek_cli");
    const legacyPaths = getLegacyLoopStoragePaths(dataDir);
    const legacyStoreFile = path.join(legacyPaths.taskStoreDir, task.workspaceKey, task.cli, task.sessionId, path.basename(legacyPaths.taskStoreFlatFile));
    const legacyCommunicationDir = path.join(legacyPaths.communicationDir, task.id);
    const legacyMainFile = path.join(legacyCommunicationDir, "main-task.md");
    task.taskStoreFile = legacyStoreFile;
    task.communicationDir = legacyCommunicationDir;
    task.mainCommunicationFile = legacyMainFile;
    task.subTasks[0].communicationFile = path.join(legacyCommunicationDir, "subtasks", "round-1-legacy-subtask.md");
    task.executionMode = "debate_multi_agent";
    task.debateRounds = [{ round: 1, status: "running", participants: [] }];
    const catalogFile = path.join(dataDir, "loop-task-identities", "catalog.json");
    assert.equal(fs.existsSync(catalogFile), false);
    fs.mkdirSync(path.dirname(legacyStoreFile), { recursive: true });
    fs.mkdirSync(path.dirname(task.subTasks[0].communicationFile), { recursive: true });
    fs.writeFileSync(legacyStoreFile, JSON.stringify({ tasks: [task] }, null, 2), "utf8");
    fs.writeFileSync(legacyMainFile, "# Existing Loop communication\\n", "utf8");
    fs.writeFileSync(task.subTasks[0].communicationFile, "# Existing subtask artifact\\n", "utf8");
    const expectedStoreFile = store.buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId, task.id);
    const expectedCommunicationDir = path.join(dataDir, "loop-communications", task.id);
    const migrated = store.readLoopTaskRecord(task.id);
    assert.ok(fs.existsSync(catalogFile));
    assert.equal(store.listLoopTaskStoreFiles().includes(expectedStoreFile), true);
    assert.equal(fs.existsSync(legacyStoreFile), false);
    assert.equal(fs.existsSync(legacyCommunicationDir), false);
    assert.equal(fs.readFileSync(path.join(expectedCommunicationDir, "main-task.md"), "utf8"), "# Existing Loop communication\\n");
    assert.equal(fs.readFileSync(path.join(expectedCommunicationDir, "subtasks", "round-1-legacy-subtask.md"), "utf8"), "# Existing subtask artifact\\n");
    assert.equal(migrated.taskStoreFile, expectedStoreFile);
    assert.equal(migrated.communicationDir, expectedCommunicationDir);
    assert.equal(migrated.subTasks[0].communicationFile, path.join(expectedCommunicationDir, "subtasks", "round-1-legacy-subtask.md"));
    assert.equal(Object.prototype.hasOwnProperty.call(migrated, "executionMode"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated, "debateRounds"), false);
    store.updateLoopTaskRecord(task.id, { finalSummary: "已按主从模式恢复" });
    const persisted = JSON.parse(fs.readFileSync(expectedStoreFile, "utf8")).tasks[0];
    assert.equal(persisted.finalSummary, "已按主从模式恢复");
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "executionMode"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "debateRounds"), false);
  `;

  try {
    const result = spawnSync(process.execPath, ["-e", script, modulePath, legacyMigrationPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome, LOOP_LEGACY_TASK: JSON.stringify(task) },
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
    assert.equal(fs.existsSync(isolatedHome), false);
  }
});

test.after(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});

test("production ownership adapter rebuilds from real task stores and synchronizes retention with zero query discovery", () => {
  const { createLoopTaskStoreDepartmentOwnershipIndex } = require("../../extensionHost/departmentOwnershipIndex") as typeof import("../../extensionHost/departmentOwnershipIndex");
  const { departmentRecords } = require("./departmentGroupChatHost.fixture") as typeof import("./departmentGroupChatHost.fixture");
  const { authorizeDepartmentLeader, buildDepartmentGroupChatProjection } = require("../../extensionHost/departmentGroupChatProjection") as typeof import("../../extensionHost/departmentGroupChatProjection");
  const data = departmentRecords();
  const file = loopTaskStore.buildLoopTaskStoreFile("codex", "production-index", null, data.root.id);
  for (const task of data.records.values()) { task.createdAt = task.updatedAt = Date.now(); task.taskStoreFile = file; }
  assert.equal(loopTaskStore.tryWriteLoopTaskStore(file, { tasks: [...data.records.values()] }), true);
  let external!: () => void;
  const index = createLoopTaskStoreDepartmentOwnershipIndex({ isCurrent: () => true, subscribe: (callback) => { external = callback; return { dispose() {} }; } });
  const fsModule = require("fs") as typeof import("fs"); const originalReadDir = fsModule.readdirSync;
  try {
    assert.equal(index.rebuild(), true);
    let discoveries = 0;
    fsModule.readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => { discoveries++; return (originalReadDir as any)(...args); }) as typeof fs.readdirSync;
    const port = { readTaskRecord: index.readTaskRecord, readLeaderTaskIds: index.readDepartmentLeaderTaskIds };
    for (let i = 0; i < 10; i++) {
      const root = index.readTaskRecord(data.root.id)!; const leader = index.readTaskRecord(data.leader.id)!;
      assert.equal(authorizeDepartmentLeader(root, leader, port, port.readLeaderTaskIds), true);
      assert.equal(buildDepartmentGroupChatProjection(root, port)!.leaders.length, 2);
    }
    assert.equal(discoveries, 0);
    fsModule.readdirSync = originalReadDir;
    external(); assert.equal(index.readDepartmentLeaderTaskIds(data.root.id, "module-A"), null);
    assert.equal(index.rebuild(), true);
    // Retention removal is a confirmed store mutation, not a false empty result after a read error.
    for (const task of data.records.values()) task.updatedAt = 0;
    loopTaskStore.writeLoopTaskStore(file, { tasks: [...data.records.values()] });
    assert.equal(index.readDepartmentLeaderTaskIds(data.root.id, "module-A"), null);
    loopTaskStore.cleanupLoopTaskStoreRetention(); assert.equal(fs.existsSync(file), false);
    assert.equal(index.readTaskRecord(data.root.id), null);
  } finally { fsModule.readdirSync = originalReadDir; index.dispose(); loopTaskStore.deleteLoopTaskStoreFile(file); }
});

test("production ownership source rejects directory discovery failures and invalidates after legacy swallowed discovery errors", () => {
  const { createLoopTaskStoreDepartmentOwnershipIndex } = require("../../extensionHost/departmentOwnershipIndex") as typeof import("../../extensionHost/departmentOwnershipIndex");
  const directory = path.join(testHome, ".sinitek_cli", "loop-tasks"); fs.mkdirSync(directory, { recursive: true });
  const index = createLoopTaskStoreDepartmentOwnershipIndex({ isCurrent: () => true, subscribe: () => ({ dispose() {} }) });
  const fsModule = require("fs") as typeof import("fs"); const original = fsModule.readdirSync;
  try {
    assert.equal(index.rebuild(), true);
    fsModule.readdirSync = ((target: fs.PathLike, options?: any) => {
      if (String(target) === directory) throw Error("simulated unreadable directory");
      return (original as any)(target, options);
    }) as typeof fs.readdirSync;
    assert.doesNotThrow(() => loopTaskStore.listLoopTaskStoreFiles()); // Ordinary API remains tolerant.
    assert.equal(index.state, "invalid");
    assert.equal(index.rebuild(), false); assert.equal(index.state, "invalid");
    fsModule.readdirSync = original; assert.equal(index.rebuild(), true);
  } finally { fsModule.readdirSync = original; index.dispose(); }
});

test("department classic root keeps explicit baseline plan and atomic collaboration delivery receipts", () => {
  const task = createLegacyTask();
  const plan = require("../../loopPlusAcceptancePlan").buildSystemLoopPlusAcceptancePlanSnapshot();
  task.schedulingMode = "classic";
  task.loopPlusAcceptancePlan = plan;
  task.department = { version: 1, rootTaskId: task.id, parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "部门",
    routes: { director: { cli: "codex" }, leader: { cli: "codex" }, employee: { cli: "codex" } }, limits: { maxLeaders: 4, maxEmployees: 20 } };
  task.departmentDeliveries = { "message-1": "补充要求" };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.deepEqual(readSkillTask(task.taskStoreFile).loopPlusAcceptancePlan, plan);
  assert.equal(readSkillTask(task.taskStoreFile).schedulingMode, "classic");
  assert.deepEqual(readSkillTask(task.taskStoreFile).departmentDeliveries, { "message-1": "补充要求" });
  loopTaskStore.updateLoopTaskRecord(task.id, { finalSummary: "unrelated update" });
  assert.deepEqual(readSkillTask(task.taskStoreFile).loopPlusAcceptancePlan, plan);
  assert.deepEqual(readSkillTask(task.taskStoreFile).departmentDeliveries, { "message-1": "补充要求" });
});

test("bounded Loop+ block review persists and rejects malformed state", () => {
  const task = createLegacyTask();
  task.loopPlusBlockReview = { state: "pending", summary: "need independent work check" };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.deepEqual(readSkillTask(task.taskStoreFile).loopPlusBlockReview, task.loopPlusBlockReview);
  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].loopPlusBlockReview = { state: "reviewed", summary: 1 };
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.deepEqual(readSkillTask(task.taskStoreFile).loopPlusBlockReview, { state: "reviewed" });
  raw.tasks[0].loopPlusBlockReview = { state: "unknown", summary: "invalid" };
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.equal(readSkillTask(task.taskStoreFile).loopPlusBlockReview, undefined);
  delete raw.tasks[0].loopPlusBlockReview;
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.equal(readSkillTask(task.taskStoreFile).loopPlusBlockReview, undefined);
});

test("department metadata persists when valid and marks explicit malformed metadata for execution refusal", () => {
  const task = createLegacyTask();
  task.department = {
    version: 1,
    rootTaskId: "department-root",
    parentTaskId: null,
    leaderSubtaskId: null,
    role: "director",
    moduleTitle: "账号",
    routes: { director: { cli: "codex" }, leader: { cli: "opencode", openCodeVariant: "reasoning" }, employee: { cli: "claude" } },
    limits: { maxLeaders: 4, maxEmployees: 20 },
  };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.equal(readSkillTask(task.taskStoreFile).department?.rootTaskId, "department-root");
  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].department = { ...task.department, version: 9 };
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  const malformed = readSkillTask(task.taskStoreFile);
  assert.equal(malformed.department, undefined);
  assert.equal(malformed.departmentInvalid, true);
});

test("department refusal marker survives null, writes, and unrelated updates until valid metadata restores it", () => {
  const task = createLegacyTask();
  task.department = {
    version: 1, rootTaskId: "department-root", parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "账号",
    routes: { director: { cli: "codex" }, leader: { cli: "opencode" }, employee: { cli: "claude" } }, limits: { maxLeaders: 4, maxEmployees: 20 },
  };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].department = null;
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.equal(readSkillTask(task.taskStoreFile).departmentInvalid, true);
  const updated = loopTaskStore.updateLoopTaskRecord(task.id, { updatedAt: Date.now() + 1 });
  assert.equal(updated?.departmentInvalid, true);
  assert.equal(readSkillTask(task.taskStoreFile).departmentInvalid, true);
  const restored = loopTaskStore.updateLoopTaskRecord(task.id, { department: task.department });
  assert.equal(restored?.departmentInvalid, undefined);
  assert.equal(restored?.department?.rootTaskId, "department-root");
  const persisted = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  delete persisted.tasks[0].department;
  persisted.tasks[0].departmentInvalid = true;
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(persisted));
  assert.equal(readSkillTask(task.taskStoreFile).departmentInvalid, true);
});

test("persists a bounded Loop+ next-step plan and ignores corrupt stored plans", () => {
  const task = createLegacyTask();
  task.loopPlusNextStepPlan = {
    objective: "验收后继续推进剩余目标",
    acceptanceCriteria: ["基于已验收结果", "不绕过完成门禁", "核对剩余目标", "记录验证范围"],
  };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.deepEqual(readSkillTask(task.taskStoreFile).loopPlusNextStepPlan, task.loopPlusNextStepPlan);

  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].loopPlusNextStepPlan = { objective: "", acceptanceCriteria: ["bad"] };
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.equal(readSkillTask(task.taskStoreFile).loopPlusNextStepPlan, undefined);
});

test("persists per-subtask acceptance flags and keeps legacy or invalid flags on the default path", () => {
  const task = createLegacyTask();
  for (const requiresAcceptance of [false, true, undefined]) {
    task.subTasks[0].requiresAcceptance = requiresAcceptance;
    loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
    assert.equal(readSkillTask(task.taskStoreFile).subTasks[0].requiresAcceptance, requiresAcceptance);
  }
  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].subTasks[0].requiresAcceptance = "false";
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.equal(readSkillTask(task.taskStoreFile).subTasks[0].requiresAcceptance, undefined);
});

test("persists explicit dependencies, keeps legacy omissions, and rejects malformed records", () => {
  const task = createLegacyTask();
  task.subTasks = [
    { id: "base", title: "Base", status: "pending" },
    { id: "follow-up", title: "Follow up", status: "pending", dependsOn: [" base "] },
  ];
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.deepEqual(readSkillTask(task.taskStoreFile).subTasks[1]?.dependsOn, ["base"]);
  assert.equal(hasOwnProperty(readSkillTask(task.taskStoreFile).subTasks[0]!, "dependsOn"), false);

  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].subTasks[1].dependsOn = null;
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
  assert.equal(loopTaskStore.readLoopTaskStore(task.taskStoreFile).tasks.some((record) => record.id === task.id), false);
  assert.throws(() => loopTaskStore.readLoopTaskStore(task.taskStoreFile, { throwOnError: true }), /subTasks\[1\]\.dependsOn/);
  fs.unlinkSync(task.taskStoreFile);
});

function hasOwnProperty(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function createLegacyTask(): import("../../loopTaskStore").LoopTaskRecord {
  recordSequence += 1;
  const now = Date.now();
  const id = `legacy-task-${recordSequence}`;
  const taskStoreFile = loopTaskStore.buildLoopTaskStoreFile(
    "codex",
    "loop-task-store-test",
    `session-${recordSequence}`,
    id,
  );
  return {
    id,
    cli: "codex",
    workspaceKey: "loop-task-store-test",
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
  const task = loopTaskStore.readLoopTaskStore(filePath).tasks[0];
  assert.ok(task);
  return task;
}

test("subtask continuation and execution session survive storage while malformed bindings are dropped", () => {
  const task = createLegacyTask();
  const session = { cli: "codex" as const, sessionId: "thread-retained", configId: "profile-a" };
  task.subTasks[0].continueFromSubtaskId = "previous";
  task.subTasks[0].executionSession = session;
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const restored = loopTaskStore.readLoopTaskStore(task.taskStoreFile).tasks[0];
  assert.equal(restored.subTasks[0].continueFromSubtaskId, "previous");
  assert.deepEqual(restored.subTasks[0].executionSession, session);
  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  raw.tasks[0].subTasks[0].executionSession.cli = "invalid-cli";
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw), "utf8");
  assert.equal(loopTaskStore.readLoopTaskStore(task.taskStoreFile).tasks[0].subTasks[0].executionSession, undefined);
});

test("classic and Loop+ reports retain mode-specific review duties and reusable verification results", () => {
  for (const schedulingMode of [undefined, "classic", "event_driven"] as const) {
    const task = { ...createLegacyTask(), schedulingMode };
    loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
    const communicationFile = loopTaskStore.prepareLoopSubtaskCommunicationFile(task, task.subTasks[0], 1, 0);
    const content = fs.readFileSync(communicationFile, "utf8");
    if (schedulingMode === "event_driven") {
      assert.match(content, /执行目标、实际修改\/操作、涉及文件、验证覆盖范围、命令或操作与结果、未执行或未覆盖项/u);
      assert.match(content, /验证后可能使结果失效的改动/u);
      assert.match(content, /主任务直接复用仍覆盖当前改动的执行结果，不为重新证明结果而重跑/u);
      assert.match(content, /已选附加审查仍由主任务判断，不能以自测通过替代验收审查/u);
      assert.doesNotMatch(content, /没有相关要求时不额外增加验收或测试/u);
      assert.doesNotMatch(content, /便于主任务复用|补充验证只完成/u);
    } else {
      assert.match(content, /完成情况、实际修改\/操作、涉及文件、结果、遗留问题/u);
      assert.match(content, /可一并完成用户或项目规则要求的验证/u);
      assert.match(content, /已执行的验证请汇报覆盖范围、命令或操作、结果及未完成项，便于主任务复用/u);
      assert.match(content, /补充验证只完成缺失、失败或后续改动影响的部分，不重复已覆盖且仍有效的验证/u);
      assert.match(content, /汇报不清时补充说明，不因缺少报告细节直接重测/u);
      assert.match(content, /明确要求独立验收或交叉复核时仍按独立要求执行，不能用实现自测替代/u);
      assert.match(content, /没有相关要求时不额外增加验收或测试/u);
      assert.doesNotMatch(content, /涉及文件、验证命令与结果|验收、测试由主任务独立派发/u);
    }
    fs.appendFileSync(communicationFile, "\n已汇报的结果\n");
    loopTaskStore.prepareLoopSubtaskCommunicationFile(task, task.subTasks[0], 1, 0);
    assert.ok(fs.readFileSync(communicationFile, "utf8").endsWith("\n已汇报的结果\n"));
  }
});

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
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  const communicationFile = loopTaskStore.prepareLoopSubtaskCommunicationFile(
    task,
    task.subTasks[0],
    1,
    0,
  );
  const content = fs.readFileSync(communicationFile, "utf8");
  const persisted = loopTaskStore.readLoopTaskRecord(task.id);

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

test("moves a Loop task to the recovered OpenCode session store", () => {
  const task = {
    ...createLegacyTask(),
    cli: "opencode" as const,
  };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  const recoveredSessionId = `ses-recovered-${recordSequence}`;
  const rebound = loopTaskStore.bindLoopTaskToSession(task.id, recoveredSessionId);
  const targetStoreFile = loopTaskStore.getLoopTaskStoreSessionFile(
    task.workspaceKey,
    task.cli,
    recoveredSessionId,
  );

  assert.ok(rebound);
  assert.equal(rebound.sessionId, recoveredSessionId);
  assert.equal(rebound.taskStoreFile, targetStoreFile);
  assert.equal(fs.existsSync(task.taskStoreFile), false);
  const persisted = readSkillTask(targetStoreFile);
  assert.equal(persisted.id, task.id);
  assert.equal(persisted.sessionId, recoveredSessionId);
  assert.equal(persisted.taskStoreFile, targetStoreFile);
});

test("moves a resumed Loop task to the latest CLI group and session without changing its ID", () => {
  const task = createLegacyTask();
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  const resumedSessionId = `ses-opencode-resume-${recordSequence}`;
  const rebound = loopTaskStore.bindLoopTaskToRuntimeTarget(task.id, "opencode", resumedSessionId);
  const targetStoreFile = loopTaskStore.getLoopTaskStoreSessionFile(
    task.workspaceKey,
    "opencode",
    resumedSessionId,
  );

  assert.ok(rebound);
  assert.equal(rebound.id, task.id);
  assert.equal(rebound.cli, "opencode");
  assert.equal(rebound.sessionId, resumedSessionId);
  assert.equal(rebound.taskStoreFile, targetStoreFile);
  assert.equal(fs.existsSync(task.taskStoreFile), false);
  const persisted = readSkillTask(targetStoreFile);
  assert.equal(persisted.id, task.id);
  assert.equal(persisted.cli, "opencode");
  assert.equal(persisted.sessionId, resumedSessionId);
});

test("reads and rewrites legacy records without adding skill fields", () => {
  const legacyTask = createLegacyTask();
  fs.mkdirSync(path.dirname(legacyTask.taskStoreFile), { recursive: true });
  fs.writeFileSync(legacyTask.taskStoreFile, JSON.stringify({ tasks: [legacyTask] }, null, 2), "utf8");

  const loaded = loopTaskStore.readLoopTaskStore(legacyTask.taskStoreFile);
  assert.equal(loaded.tasks.length, 1);
  assert.equal(hasOwnProperty(loaded.tasks[0], "taskKind"), false);
  assert.equal(hasOwnProperty(loaded.tasks[0].subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(loaded.tasks[0].subTasks[0], "skillGuidance"), false);

  loopTaskStore.writeLoopTaskStore(legacyTask.taskStoreFile, loaded);
  const persisted = JSON.parse(fs.readFileSync(legacyTask.taskStoreFile, "utf8")) as {
    tasks: Array<{ taskKind?: unknown; subTasks: Array<{ skillIds?: unknown; skillGuidance?: unknown }> }>;
  };
  assert.equal(hasOwnProperty(persisted.tasks[0], "taskKind"), false);
  assert.equal(hasOwnProperty(persisted.tasks[0].subTasks[0], "skillIds"), false);
  assert.equal(hasOwnProperty(persisted.tasks[0].subTasks[0], "skillGuidance"), false);
});

test("keeps legacy records skill-free through resume and completion updates", () => {
  const legacyTask = createLegacyTask();
  loopTaskStore.writeLoopTaskStore(legacyTask.taskStoreFile, { tasks: [legacyTask] });

  const resumed = loopTaskStore.readLoopTaskRecord(legacyTask.id);
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
  const completed = loopTaskStore.updateLoopTaskRecord(legacyTask.id, {
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
  const persisted = loopTaskStore.readLoopTaskStore(legacyTask.taskStoreFile).tasks[0];
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

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const loaded = readSkillTask(task.taskStoreFile);
  assert.equal(loaded.taskKind, "development");
  assert.deepEqual(loaded.subTasks[0].skillIds, [
    "test-driven-development",
    "incremental-implementation",
  ]);
  assert.equal(loaded.subTasks[0].skillGuidance, skillGuidance);

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [loaded] });
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

  loopTaskStore.writeLoopTaskStore(rawTask.taskStoreFile, {
    tasks: [rawTask as unknown as import("../../loopTaskStore").LoopTaskRecord],
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

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
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
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });

  const resumed = loopTaskStore.readLoopTaskRecord(task.id) as SkillTaskRecord | null;
  assert.ok(resumed);
  const retried = loopTaskStore.updateLoopTaskRecord(task.id, {
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

  const completed = loopTaskStore.updateLoopTaskRecord(task.id, {
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

test("moves legacy task stores and communication artifacts into Loop storage", () => {
  const dataDir = path.join(testHome, ".sinitek_cli");
  const legacyPaths = getLegacyLoopStoragePaths(dataDir);
  const task = createLegacyTask();
  const legacyStoreFile = path.join(
    legacyPaths.taskStoreDir,
    task.workspaceKey,
    task.cli,
    task.sessionId ?? "session",
    path.basename(legacyPaths.taskStoreFlatFile),
  );
  const legacyCommunicationDir = path.join(legacyPaths.communicationDir, task.id);
  const legacyMainFile = path.join(legacyCommunicationDir, "main-task.md");
  const legacySubtaskFile = path.join(legacyCommunicationDir, "subtasks", "round-1-legacy-subtask.md");
  const rawTask = {
    ...task,
    taskStoreFile: legacyStoreFile,
    communicationDir: legacyCommunicationDir,
    mainCommunicationFile: legacyMainFile,
    executionMode: "debate_multi_agent",
    debateRounds: [{ round: 1, status: "running", participants: [] }],
    subTasks: [{
      ...task.subTasks[0],
      communicationFile: legacySubtaskFile,
    }],
  };

  const expectedStoreFile = loopTaskStore.buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId ?? null, task.id);
  const expectedCommunicationDir = path.join(dataDir, "loop-communications", task.id);
  const sibling = { ...createLegacyTask(), sessionId: task.sessionId, taskStoreFile: legacyStoreFile };
  try {
    fs.mkdirSync(path.dirname(legacyStoreFile), { recursive: true });
    fs.mkdirSync(path.dirname(legacySubtaskFile), { recursive: true });
    fs.writeFileSync(legacyMainFile, "# Existing Loop communication\n", "utf8");
    fs.writeFileSync(legacySubtaskFile, "# Existing subtask artifact\n", "utf8");
    // Register this ordinary legacy source through the supported writer before migration.
    loopTaskStore.writeLoopTaskStore(legacyStoreFile, { tasks: [rawTask, sibling] });
    const { canMigrateOrdinaryLoopTaskIdentity } = require("../../loopTaskIdentityCatalog") as typeof import("../../loopTaskIdentityCatalog");
    assert.equal(canMigrateOrdinaryLoopTaskIdentity(task.id, legacyStoreFile), true);
    assert.equal(canMigrateOrdinaryLoopTaskIdentity(sibling.id, legacyStoreFile), true);
    // Seed obsolete payload fields without changing the supported writer's registered identities.
    fs.writeFileSync(legacyStoreFile, JSON.stringify({ tasks: [rawTask, sibling] }, null, 2), "utf8");

    const listedFiles = loopTaskStore.listLoopTaskStoreFiles();
    const migrated = loopTaskStore.readLoopTaskRecord(task.id);

    assert.equal(listedFiles.includes(expectedStoreFile), true);
    assert.equal(fs.existsSync(legacyStoreFile), false);
    assert.equal(fs.existsSync(legacyCommunicationDir), false);
    assert.equal(fs.readFileSync(path.join(expectedCommunicationDir, "main-task.md"), "utf8"), "# Existing Loop communication\n");
    assert.equal(fs.readFileSync(path.join(expectedCommunicationDir, "subtasks", "round-1-legacy-subtask.md"), "utf8"), "# Existing subtask artifact\n");
    assert.equal(migrated?.taskStoreFile, expectedStoreFile);
    assert.equal(migrated?.communicationDir, expectedCommunicationDir);
    assert.equal(migrated?.subTasks[0]?.communicationFile, path.join(expectedCommunicationDir, "subtasks", "round-1-legacy-subtask.md"));
    assert.equal(loopTaskStore.readLoopTaskRecord(sibling.id)?.taskStoreFile, expectedStoreFile);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated ?? {}, "executionMode"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated ?? {}, "debateRounds"), false);
    loopTaskStore.updateLoopTaskRecord(task.id, { finalSummary: "已按主从模式恢复" });
    const persisted = JSON.parse(fs.readFileSync(expectedStoreFile, "utf8")) as { tasks: Array<Record<string, unknown>> };
    const persistedTask = persisted.tasks.find((record) => record.id === task.id)!;
    assert.equal(persistedTask.finalSummary, "已按主从模式恢复");
    assert.equal(Object.prototype.hasOwnProperty.call(persistedTask, "executionMode"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persistedTask, "debateRounds"), false);
    assert.equal(persisted.tasks.find((record) => record.id === sibling.id)?.rootPrompt, sibling.rootPrompt);
  } finally {
    fs.rmSync(legacyPaths.taskStoreDir, { recursive: true, force: true });
    fs.rmSync(legacyPaths.communicationDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(expectedStoreFile), { recursive: true, force: true });
    fs.rmSync(expectedCommunicationDir, { recursive: true, force: true });
  }
});

test("keeps legacy task paths intact when the communication root is unsafe to migrate", (t) => {
  const dataDir = path.join(testHome, ".sinitek_cli");
  const legacyPaths = getLegacyLoopStoragePaths(dataDir);
  const task = createLegacyTask();
  const legacyStoreFile = path.join(
    legacyPaths.taskStoreDir,
    task.workspaceKey,
    task.cli,
    task.sessionId ?? "session",
    path.basename(legacyPaths.taskStoreFlatFile),
  );
  const externalCommunicationDir = path.join(testHome, "pre-loop-communication-target");
  const legacyTaskCommunicationDir = path.join(legacyPaths.communicationDir, task.id);
  const legacyMainFile = path.join(legacyTaskCommunicationDir, "main-task.md");
  const rawTask = {
    ...task,
    taskStoreFile: legacyStoreFile,
    communicationDir: legacyTaskCommunicationDir,
    mainCommunicationFile: legacyMainFile,
  };

  let linked = false;
  try {
    fs.mkdirSync(path.dirname(legacyStoreFile), { recursive: true });
    fs.mkdirSync(path.join(externalCommunicationDir, task.id), { recursive: true });
    fs.writeFileSync(path.join(externalCommunicationDir, task.id, "main-task.md"), "# Unsafe migration source\n", "utf8");
    assert.equal(fs.existsSync(legacyPaths.communicationDir), false);
    fs.symlinkSync(externalCommunicationDir, legacyPaths.communicationDir, process.platform === "win32" ? "junction" : "dir");
    linked = true;
    assert.equal(fs.lstatSync(legacyPaths.communicationDir).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(legacyPaths.communicationDir), fs.realpathSync(externalCommunicationDir));
    assert.equal(fs.readFileSync(legacyMainFile, "utf8"), "# Unsafe migration source\n");
    // Register the source before exercising the unsafe communication-root refusal.
    loopTaskStore.writeLoopTaskStore(legacyStoreFile, { tasks: [rawTask] });
    const { canMigrateOrdinaryLoopTaskIdentity } = require("../../loopTaskIdentityCatalog") as typeof import("../../loopTaskIdentityCatalog");
    assert.equal(canMigrateOrdinaryLoopTaskIdentity(task.id, legacyStoreFile), true);
    const fsModule = require("fs") as typeof import("fs");
    const originalLstat = fsModule.lstatSync;
    let inspectedUnsafeRoot = false;
    t.mock.method(fsModule, "lstatSync", ((file: fs.PathLike, ...args: any[]) => {
      if (String(file) === legacyPaths.communicationDir) inspectedUnsafeRoot = true;
      return (originalLstat as any)(file, ...args);
    }) as typeof fs.lstatSync);

    const listedFiles = loopTaskStore.listLoopTaskStoreFiles();
    assert.equal(inspectedUnsafeRoot, true, "migration must reach the real unsafe communication-root check");
    const loaded = loopTaskStore.readLoopTaskStore(legacyStoreFile).tasks[0];

    assert.equal(listedFiles.includes(legacyStoreFile), true);
    assert.equal(fs.existsSync(legacyStoreFile), true);
    assert.equal(loaded.taskStoreFile, legacyStoreFile);
    assert.equal(loaded.communicationDir, legacyTaskCommunicationDir);
    assert.equal(loaded.mainCommunicationFile, legacyMainFile);
    assert.equal(
      fs.existsSync(loopTaskStore.buildLoopTaskStoreFile(task.cli, task.workspaceKey, task.sessionId ?? null, task.id)),
      false,
    );

    assert.equal(fs.readFileSync(path.join(externalCommunicationDir, task.id, "main-task.md"), "utf8"), "# Unsafe migration source\n");
  } finally {
    try {
      if (linked) {
        fs.unlinkSync(legacyPaths.communicationDir);
        assert.equal(fs.readFileSync(path.join(externalCommunicationDir, task.id, "main-task.md"), "utf8"), "# Unsafe migration source\n");
      }
    } finally {
      t.mock.restoreAll();
      fs.rmSync(legacyPaths.taskStoreDir, { recursive: true, force: true });
      fs.rmSync(externalCommunicationDir, { recursive: true, force: true });
    }
  }
});

test("snapshots the confirmed acceptance plan on the task and normalizes it on read", () => {
  const baseTask = createLegacyTask();
  const task: SkillTaskRecord = {
    ...baseTask,
    loopPlusAcceptancePlan: {
      id: "plan-hardening",
      name: "上线前加严",
      checks: ["other", "security"],
      otherText: "确认审计日志不写入密钥",
      systemDefault: false,
    },
  };
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const reloaded = readSkillTask(task.taskStoreFile);
  assert.deepEqual(reloaded.loopPlusAcceptancePlan, {
    id: "plan-hardening",
    name: "上线前加严",
    checks: ["other", "security"],
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  });

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [reloaded] });
  const persisted = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8")) as {
    tasks: Array<{ loopPlusAcceptancePlan?: unknown }>;
  };
  assert.deepEqual(persisted.tasks[0].loopPlusAcceptancePlan, {
    id: "plan-hardening",
    name: "上线前加严",
    checks: ["other", "security"],
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  });
});

test("legacy or corrupt acceptance plan snapshots fall back to the fixed baseline", () => {
  const baseTask = createLegacyTask();
  const bareTask = { ...baseTask };
  loopTaskStore.writeLoopTaskStore(bareTask.taskStoreFile, { tasks: [bareTask] });
  assert.equal(readSkillTask(bareTask.taskStoreFile).loopPlusAcceptancePlan, undefined);

  const corruptPath = `${bareTask.taskStoreFile}-corrupt.json`;
  fs.writeFileSync(corruptPath, JSON.stringify({
    tasks: [{
      ...baseTask,
      loopPlusAcceptancePlan: { id: "", name: "坏数据", checks: ["security"], otherText: "" },
    }],
  }), "utf8");
  assert.equal(readSkillTask(corruptPath).loopPlusAcceptancePlan, undefined);
});

test("host router ownership is final even when handler declines, throws, or is disposed", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "loop-owned-router-")));
  const task = createLegacyTask();
  assert.equal(loopTaskStore.tryWriteLoopTaskStore(task.taskStoreFile, { tasks: [task] }), true);
  const before = fs.readFileSync(task.taskStoreFile, "utf8");
  let mode: "decline" | "throw" = "decline";
  const registration = loopTaskStore.registerLoopTaskStoreHostRouter({ root, knownTaskIds: [task.id], route: () => {
    if (mode === "throw") throw Error("source unavailable");
    return { handled: false };
  } });
  try {
    for (const phase of ["decline", "throw", "disposed"]) {
      if (phase === "throw") mode = "throw";
      if (phase === "disposed") registration.dispose();
      assert.equal(loopTaskStore.readLoopTaskRecord(task.id), null);
      assert.equal(loopTaskStore.readKnownOrdinaryLoopTaskRecord(task.id), null);
      assert.equal(loopTaskStore.updateLoopTaskRecord(task.id, { status: "completed" }), null);
      assert.equal(loopTaskStore.tryAppendLoopRound(task.id, { round: 1, role: "main", status: "end", startedAt: 1, endedAt: 2 }), false);
      assert.equal(loopTaskStore.bindLoopTaskToSession(task.id, "must-not-move"), null);
      assert.equal(loopTaskStore.tryWriteLoopTaskStore(path.join(root, "nested", "new.json"), { tasks: [] }), false);
      assert.equal(fs.existsSync(path.join(root, "nested")), false);
      assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), before);
    }
  } finally { registration.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("repair provenance normalization preserves exact host identity and rejects corrupt recovery", () => {
  const task = createLegacyTask();
  const source = { subtaskId: "source", attemptId: "a1", finishEventId: "finish:source:a1" };
  task.subTasks = [{ id: "repair", title: "repair", status: "completed", repairSource: source }];
  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.deepEqual(readSkillTask(task.taskStoreFile).subTasks[0].repairSource, source);
  for (const invalid of [null, [], {}, { ...source, attemptId: " " }, { ...source, injected: true }, { ...source, finishEventId: 3 }]) {
    const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8")); raw.tasks[0].subTasks[0].repairSource = invalid;
    fs.writeFileSync(task.taskStoreFile, JSON.stringify(raw));
    assert.deepEqual(readSkillTask(task.taskStoreFile).subTasks[0].repairSource, { subtaskId: "", attemptId: "", finishEventId: "" });
  }
});
