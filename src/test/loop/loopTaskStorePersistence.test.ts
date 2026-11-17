import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Set HOME before loading the store, including in cold-module restart checks.
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-store-persistence-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
assert.equal(os.homedir(), testHome);
const storeModulePath = require.resolve("../../loopTaskStore");
type StoreModule = typeof import("../../loopTaskStore");
type LoopTaskRecord = import("../../loopTaskStore").LoopTaskRecord;
const store = require(storeModulePath) as StoreModule;
assert.ok(store.getLoopCommunicationPaths("probe").dir.startsWith(testHome + path.sep));

test.after(() => {
  try {
    assert.equal(path.dirname(testHome), path.resolve(os.tmpdir()));
    assert.ok(path.basename(testHome).startsWith("sinitek-loop-store-persistence-"));
    fs.rmSync(testHome, { recursive: true, force: true });
    assert.equal(fs.existsSync(testHome), false);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  }
});

let sequence = 0;
function createTask(): LoopTaskRecord {
  const id = `persistence-${++sequence}`;
  const now = Date.now();
  const communication = store.getLoopCommunicationPaths(id);
  return {
    id, cli: "codex", workspaceKey: id, sessionId: null,
    taskStoreFile: store.buildLoopTaskStoreFile("codex", id, null, id),
    rootPrompt: "Persist a Loop task.", status: "running",
    createdAt: now, updatedAt: now, maxRounds: 5, currentRound: 0,
    communicationDir: communication.dir, mainCommunicationFile: communication.mainFile,
    activeSubtaskId: null, activeSubtaskIds: [], subTasks: [], rounds: [],
    supplementalRequirements: [], completionRoundSummaries: [], completionRequirementCoverage: [],
  };
}

function coldStore(): StoreModule {
  delete require.cache[storeModulePath];
  return require(storeModulePath) as StoreModule;
}

function assertNoTempFiles(filePath: string): void {
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith(".tmp")), []);
}

for (const withSibling of [false, true]) {
  for (const aliasKind of ["dot", "relative", "absolute"] as const) {
    test(`same file through ${aliasKind} alias preserves the committed task${withSibling ? " and sibling" : ""}`, () => {
      const task = createTask();
      const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
      const alias = aliasKind === "dot"
        ? path.dirname(task.taskStoreFile) + path.sep + "." + path.sep + path.basename(task.taskStoreFile)
        : aliasKind === "relative" ? path.relative(process.cwd(), task.taskStoreFile) : task.taskStoreFile;
      // Also cover a relative source with an absolute patch target.
      if (aliasKind === "absolute") task.taskStoreFile = path.relative(process.cwd(), task.taskStoreFile);
      store.writeLoopTaskStore(task.taskStoreFile, { tasks: withSibling ? [task, sibling] : [task] });
      const committed = store.updateLoopTaskRecord(task.id, { taskStoreFile: alias, status: "completed" });
      assert.equal(committed?.status, "completed");
      assert.equal(fs.existsSync(task.taskStoreFile), true);
      const persisted = store.readLoopTaskStore(task.taskStoreFile).tasks;
      assert.equal(persisted.find((item) => item.id === task.id)?.status, "completed");
      assert.equal(persisted.length, withSibling ? 2 : 1);
      assert.equal(store.readLoopTaskRecord(task.id)?.status, "completed");
      assert.equal(coldStore().readLoopTaskRecord(task.id)?.status, "completed");
      assertNoTempFiles(task.taskStoreFile);
    });
  }
}

test("case aliases follow the actual volume identity without lowercasing distinct paths", (t) => {
  const task = createTask();
  const target = task.taskStoreFile.replace(task.id, task.id.toUpperCase());
  const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task, sibling] });
  const aliasesSameFile = fs.existsSync(target);
  t.diagnostic(`native volume case aliases refer to ${aliasesSameFile ? "the same" : "distinct"} files`);
  if (!aliasesSameFile) {
    const targetSibling = { ...createTask(), taskStoreFile: target };
    store.writeLoopTaskStore(target, { tasks: [targetSibling] });
  }
  const committed = store.updateLoopTaskRecord(task.id, { taskStoreFile: target, status: "completed" });
  assert.equal(committed?.status, "completed");
  const sourceTasks = store.readLoopTaskStore(task.taskStoreFile).tasks;
  const targetTasks = store.readLoopTaskStore(target).tasks;
  assert.equal(targetTasks.find((item) => item.id === task.id)?.status, "completed");
  assert.equal(sourceTasks.length, aliasesSameFile ? 2 : 1);
  assert.equal(sourceTasks[aliasesSameFile ? 1 : 0].id, sibling.id);
  assert.equal(targetTasks.length, 2);
  assert.equal(coldStore().readLoopTaskRecord(task.id)?.status, "completed");
});

test("distinct case-sensitive file identities are migrated even on a case-insensitive test volume", (t) => {
  const task = createTask();
  const caseTarget = task.taskStoreFile.replace(task.id, task.id.toUpperCase());
  const backing = createTask().taskStoreFile;
  const sibling = { ...createTask(), taskStoreFile: caseTarget };
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  store.writeLoopTaskStore(backing, { tasks: [sibling] });
  assert.ok(store.readLoopTaskRecord(task.id));
  // Model a case-sensitive volume by routing the differently cased target to a
  // distinct real file. Reads, identity and atomic rename share that mapping.
  const originalStat = fs.statSync;
  const originalRealpath = fs.realpathSync;
  const originalRead = fs.readFileSync;
  const originalRename = fs.renameSync;
  t.mock.method(fs, "statSync", ((file: fs.PathLike, ...args: unknown[]) =>
    originalStat(String(file) === caseTarget ? backing : file, ...args as [])) as typeof fs.statSync);
  t.mock.method(fs, "realpathSync", ((file: fs.PathLike, ...args: unknown[]) =>
    originalRealpath(String(file) === caseTarget ? backing : file, ...args as [])) as typeof fs.realpathSync);
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) =>
    originalRead(String(args[0]) === caseTarget ? backing : args[0], args[1]));
  t.mock.method(fs, "renameSync", (source: fs.PathLike, target: fs.PathLike) =>
    originalRename(source, String(target) === caseTarget ? backing : target));
  const committed = store.updateLoopTaskRecord(task.id, { taskStoreFile: caseTarget, status: "completed" });
  assert.equal(committed?.taskStoreFile, caseTarget);
  assert.equal(fs.existsSync(task.taskStoreFile), false);
  const persisted = JSON.parse(originalRead(backing, "utf8")).tasks as LoopTaskRecord[];
  assert.equal(persisted.find((item) => item.id === task.id)?.status, "completed");
  assert.equal(persisted.find((item) => item.id === sibling.id)?.status, "running");
  assert.equal(store.readLoopTaskRecord(task.id)?.status, "completed");
});

for (const failure of ["EACCES", "syntax", "shape", "record"] as const) {
  test(`migration target ${failure} fails before replacing either file or dropping its sibling`, (t) => {
    const task = createTask();
    const target = store.getLoopTaskStoreSessionFile(task.workspaceKey, task.cli, "read-boundary");
    const sibling = { ...createTask(), taskStoreFile: target };
    store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
    store.writeLoopTaskStore(target, { tasks: [sibling] });
    if (failure !== "EACCES") fs.writeFileSync(target,
      failure === "syntax" ? "{broken JSON" : failure === "shape" ? '{"tasks":{}}' : '{"tasks":[null]}', "utf8");
    const sourceBytes = fs.readFileSync(task.taskStoreFile, "utf8");
    const targetBytes = fs.readFileSync(target, "utf8");
    const error = Object.assign(new Error("target read denied"), { code: "EACCES" });
    const originalRead = fs.readFileSync;
    // Warm the task location before injecting a failure only on the merge target.
    assert.equal(store.readLoopTaskRecord(task.id)?.taskStoreFile, task.taskStoreFile);
    if (failure === "EACCES") {
      t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
        if (String(args[0]) === target) throw error;
        return originalRead(...args);
      });
    }
    const rename = t.mock.method(fs, "renameSync", fs.renameSync);
    assert.throws(() => store.bindLoopTaskToSession(task.id, "read-boundary"), (caught: unknown) =>
      failure === "EACCES" ? caught === error : failure === "syntax" ? caught instanceof SyntaxError : caught instanceof Error);
    assert.equal(rename.mock.callCount(), 0);
    assert.deepEqual(store.readLoopTaskStore(target), { tasks: [] }); // query compatibility
    assert.equal(originalRead(task.taskStoreFile, "utf8"), sourceBytes);
    assert.equal(originalRead(target, "utf8"), targetBytes);
    assertNoTempFiles(task.taskStoreFile);
    assertNoTempFiles(target);
    t.mock.restoreAll();
    // Repairing the input permits a genuine migration; existing siblings survive.
    store.writeLoopTaskStore(target, { tasks: [sibling] });
    assert.equal(store.bindLoopTaskToSession(task.id, "read-boundary")?.taskStoreFile, target);
    assert.equal(store.readLoopTaskStore(target).tasks.length, 2);
    assert.equal(fs.existsSync(task.taskStoreFile), false);
  });
}

for (const warmCache of [false, true]) {
  test(`source EACCES propagates through every commit entry with a ${warmCache ? "warm" : "cold"} cache`, (t) => {
    const task = createTask();
    store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
    const original = fs.readFileSync(task.taskStoreFile, "utf8");
    const module = coldStore();
    if (warmCache) assert.ok(module.readLoopTaskRecord(task.id));
    const error = Object.assign(new Error("source read denied"), { code: "EACCES" });
    const originalRead = fs.readFileSync;
    t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]) === task.taskStoreFile) throw error;
      return originalRead(...args);
    });
    for (const action of [
      () => module.updateLoopTaskRecord(task.id, { status: "completed" }),
      () => module.appendLoopRound(task.id, { round: 1, role: "main", status: "end", startedAt: 1, endedAt: 2 }),
      () => module.bindLoopTaskToSession(task.id, "source-unreadable"),
      () => module.bindLoopTaskToRuntimeTarget(task.id, "opencode", "source-unreadable"),
    ]) assert.throws(action, (caught: unknown) => caught === error);
    assert.equal(module.readLoopTaskRecord(task.id), null); // tolerant queries remain compatible
    module.cleanupLoopTaskStoreRetention(); // maintenance contains the error without deleting the file
    assert.equal(originalRead(task.taskStoreFile, "utf8"), original);
    assertNoTempFiles(task.taskStoreFile);
  });
}

test("a source that becomes unreadable after lookup cannot be returned as a missing task", (t) => {
  const task = createTask();
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  assert.ok(store.readLoopTaskRecord(task.id));
  const error = Object.assign(new Error("source read race"), { code: "EACCES" });
  const originalRead = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === task.taskStoreFile && ++reads >= 2) throw error;
    return originalRead(...args);
  });
  assert.throws(() => store.updateLoopTaskRecord(task.id, { status: "completed" }), (caught: unknown) => caught === error);
  assert.equal(JSON.parse(originalRead(task.taskStoreFile, "utf8")).tasks[0].status, "running");
});

for (const raw of ["{broken JSON", '{"tasks":{}}']) {
  test(`corrupt source ${raw} stops update and retention without replacing original bytes`, () => {
    const task = createTask();
    store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
    assert.ok(store.readLoopTaskRecord(task.id));
    fs.writeFileSync(task.taskStoreFile, raw, "utf8");
    assert.throws(() => store.updateLoopTaskRecord(task.id, { status: "completed" }));
    store.cleanupLoopTaskStoreRetention();
    assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), raw);
    // Remove just this isolated corrupt fixture so later cold lookups stay meaningful.
    fs.unlinkSync(task.taskStoreFile);
  });
}

test("cold commit lookup propagates a directory read failure instead of returning a missing task", (t) => {
  const task = createTask();
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const module = coldStore();
  const original = fs.readFileSync(task.taskStoreFile, "utf8");
  const originalReaddir = fs.readdirSync;
  const root = path.join(testHome, ".sinitek_cli", "loop-tasks");
  const error = Object.assign(new Error("store directory denied"), { code: "EACCES" });
  t.mock.method(fs, "readdirSync", ((file: fs.PathLike, ...args: unknown[]) => {
    if (String(file) === root) throw error;
    return originalReaddir(file, ...args as []);
  }) as typeof fs.readdirSync);
  assert.throws(() => module.updateLoopTaskRecord(task.id, { status: "completed" }), (caught: unknown) => caught === error);
  assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), original);
});

test("legacy target read failure stays within maintenance and preserves both original files", (t) => {
  const { getLegacyLoopStoragePaths } = require("../../loopLegacyMigration") as typeof import("../../loopLegacyMigration");
  const legacyFile = getLegacyLoopStoragePaths(path.join(testHome, ".sinitek_cli")).taskStoreFlatFile;
  const task = createTask();
  const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [sibling] });
  fs.writeFileSync(legacyFile, JSON.stringify({ tasks: [{ ...task, taskStoreFile: legacyFile }] }), "utf8");
  const sourceBytes = fs.readFileSync(legacyFile, "utf8");
  const targetBytes = fs.readFileSync(task.taskStoreFile, "utf8");
  const originalRead = fs.readFileSync;
  const error = Object.assign(new Error("legacy target read denied"), { code: "EACCES" });
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === task.taskStoreFile) throw error;
    return originalRead(...args);
  });
  assert.ok(store.listLoopTaskStoreFiles().includes(legacyFile));
  assert.equal(originalRead(legacyFile, "utf8"), sourceBytes);
  assert.equal(originalRead(task.taskStoreFile, "utf8"), targetBytes);
  assertNoTempFiles(task.taskStoreFile);
  t.mock.restoreAll();
  store.listLoopTaskStoreFiles();
  assert.equal(fs.existsSync(legacyFile), false);
  assert.equal(store.readLoopTaskStore(task.taskStoreFile).tasks.length, 2);
});

test("an invalid legacy source record is retained rather than normalized away and deleted", () => {
  const { getLegacyLoopStoragePaths } = require("../../loopLegacyMigration") as typeof import("../../loopLegacyMigration");
  const legacyFile = getLegacyLoopStoragePaths(path.join(testHome, ".sinitek_cli")).taskStoreFlatFile;
  const original = '{"tasks":[null]}';
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, original, "utf8");
  assert.ok(store.listLoopTaskStoreFiles().includes(legacyFile));
  assert.equal(fs.readFileSync(legacyFile, "utf8"), original);
  fs.unlinkSync(legacyFile);
});

for (const clockOffset of [0, -1000]) {
  test(`legacy retry preserves committed update and append when the clock offset is ${clockOffset}ms`, (t) => {
    const { getLegacyLoopStoragePaths } = require("../../loopLegacyMigration") as typeof import("../../loopLegacyMigration");
    const legacyFile = getLegacyLoopStoragePaths(path.join(testHome, ".sinitek_cli")).taskStoreFlatFile;
    const task = createTask();
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify({ tasks: [{ ...task, taskStoreFile: legacyFile }] }), "utf8");
    const originalUnlink = fs.unlinkSync;
    t.mock.method(fs, "unlinkSync", (...args: Parameters<typeof fs.unlinkSync>) => {
      if (String(args[0]) === legacyFile) throw new Error("legacy cleanup denied");
      return originalUnlink(...args);
    });
    store.listLoopTaskStoreFiles();
    t.mock.method(Date, "now", () => task.updatedAt + clockOffset);
    assert.equal(store.updateLoopTaskRecord(task.id, { status: "completed", finalSummary: "committed conclusion" })?.status, "completed");
    store.listLoopTaskStoreFiles();
    for (const module of [store, coldStore()]) {
      assert.equal(module.readLoopTaskRecord(task.id)?.status, "completed");
      assert.equal(module.readLoopTaskRecord(task.id)?.finalSummary, "committed conclusion");
    }
    store.appendLoopRound(task.id, { round: 1, role: "main", status: "end", startedAt: task.updatedAt, endedAt: task.updatedAt });
    store.listLoopTaskStoreFiles();
    const after = coldStore().readLoopTaskRecord(task.id);
    assert.equal(after?.status, "completed");
    assert.equal(after?.finalSummary, "committed conclusion");
    assert.equal(after?.rounds.length, 1);
    assert.equal(after?.taskStoreFile, task.taskStoreFile);
    t.mock.restoreAll();
    store.listLoopTaskStoreFiles();
    assert.equal(fs.existsSync(legacyFile), false);
    assert.equal(coldStore().readLoopTaskRecord(task.id)?.rounds.length, 1);
  });
}

test("normal return commits readable JSON, and only a missing task returns null", () => {
  const task = createTask();
  assert.equal(store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] }), undefined);
  const updated = store.updateLoopTaskRecord(task.id, { status: "completed" });
  assert.equal(updated?.status, "completed");
  const raw = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8"));
  assert.deepEqual(Object.keys(raw), ["tasks"]);
  assert.equal(raw.tasks[0].status, "completed");
  assert.equal(store.updateLoopTaskRecord(task.id, { status: "running" })?.status, "completed");
  assert.equal(store.updateLoopTaskRecord("missing-persistence-task", { status: "completed" }), null);
  assertNoTempFiles(task.taskStoreFile);
});

test("rejects damaged dependency writes before replacing existing store bytes", () => {
  const task = createTask();
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const original = fs.readFileSync(task.taskStoreFile, "utf8");
  const malformedDependencies: unknown[] = [
    null,
    "dependency",
    [1],
    ["   "],
    ["persist-subtask"],
    ["dependency", " dependency "],
  ];

  for (const dependsOn of malformedDependencies) {
    const damaged = {
      ...task,
      subTasks: [{
        id: "persist-subtask",
        title: "Persist task metadata",
        prompt: "Do not lose this prompt when dependency data is corrupt.",
        status: "pending" as const,
        dependsOn,
      }],
    } as unknown as LoopTaskRecord;
    assert.throws(
      () => store.writeLoopTaskStore(task.taskStoreFile, { tasks: [damaged] }),
      /subTasks\[0\]\.dependsOn/,
      `must reject ${JSON.stringify(dependsOn)}`,
    );
    assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), original);
  }
  assertNoTempFiles(task.taskStoreFile);
});

test("task creation append rejects a damaged sibling record without replacing stored bytes", () => {
  const task = createTask();
  const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task, sibling] });
  const original = fs.readFileSync(task.taskStoreFile, "utf8");
  const raw = JSON.parse(original) as { tasks: Array<Record<string, unknown>> };
  raw.tasks[0] = {
    ...raw.tasks[0],
    subTasks: [{ id: "bad-subtask", title: "Bad", prompt: "Keep raw", status: "pending", dependsOn: null }],
  };
  const damagedOriginal = JSON.stringify(raw);
  fs.writeFileSync(task.taskStoreFile, damagedOriginal, "utf8");

  assert.throws(
    () => store.appendLoopTaskRecord(task.taskStoreFile, createTask()),
    /subTasks\[0\]\.dependsOn/,
  );
  assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), damagedOriginal);
  assert.equal(store.readLoopTaskStore(task.taskStoreFile).tasks.some((record) => record.id === sibling.id), true);
  assertNoTempFiles(task.taskStoreFile);
  fs.unlinkSync(task.taskStoreFile);
});

test("task creation append preserves valid siblings, legacy dependencies, and dependency order", () => {
  const task = createTask();
  const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task, sibling] });
  const legacy = { ...createTask(), taskStoreFile: task.taskStoreFile };
  const beforeAppend = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8")) as { tasks: Array<Record<string, unknown>> };
  beforeAppend.tasks[0].subTasks = [{
    id: "legacy-subtask",
    title: "Legacy subtask",
    prompt: "Retain a pre-dependencies task record.",
    status: "pending",
  }];
  beforeAppend.tasks.push(legacy as unknown as Record<string, unknown>);
  fs.writeFileSync(task.taskStoreFile, JSON.stringify(beforeAppend), "utf8");

  const created = { ...createTask(), taskStoreFile: task.taskStoreFile };
  created.subTasks = [{
    id: "new-subtask",
    title: "Keep dependency data",
    prompt: "Append without rewriting other records.",
    status: "pending",
    dependsOn: [" first ", "second"],
  }];
  store.appendLoopTaskRecord(task.taskStoreFile, created);

  const persisted = store.readLoopTaskStore(task.taskStoreFile).tasks;
  assert.deepEqual(persisted.map((record) => record.id), [task.id, sibling.id, legacy.id, created.id]);
  assert.equal(persisted[0].subTasks[0]?.dependsOn, undefined);
  assert.deepEqual(persisted[persisted.length - 1]?.subTasks[0]?.dependsOn, ["first", "second"]);
});

test("task creation append creates a new store file", () => {
  const task = createTask();
  assert.equal(fs.existsSync(task.taskStoreFile), false);
  store.appendLoopTaskRecord(task.taskStoreFile, task);
  assert.deepEqual(store.readLoopTaskStore(task.taskStoreFile).tasks.map((record) => record.id), [task.id]);
});

for (const failure of ["write", "rename"] as const) {
  test(`${failure} failure propagates the original error, preserves the running record and removes temporary files`, (t) => {
    const task = createTask();
    store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
    assert.equal(store.readLoopTaskRecord(task.id)?.status, "running");
    const original = fs.readFileSync(task.taskStoreFile, "utf8");
    const error = Object.assign(new Error(`injected ${failure} failure`), { code: failure === "write" ? "ENOSPC" : "EACCES" });
    if (failure === "write") {
      const originalWrite = fs.writeFileSync;
      t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
        if (String(args[0]).endsWith(".tmp")) {
          originalWrite(args[0], "partial JSON", "utf8");
          throw error;
        }
        return originalWrite(...args);
      });
    } else {
      const originalRename = fs.renameSync;
      t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
        if (String(args[1]) === task.taskStoreFile) throw error;
        return originalRename(...args);
      });
    }
    assert.throws(() => store.writeLoopTaskStore(task.taskStoreFile, { tasks: [{ ...task, status: "completed" }] }),
      (caught: unknown) => caught === error);
    assert.throws(() => store.updateLoopTaskRecord(task.id, { status: "completed" }),
      (caught: unknown) => caught === error);
    assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), original);
    assert.equal(store.readLoopTaskRecord(task.id)?.status, "running");
    assertNoTempFiles(task.taskStoreFile);
    t.mock.restoreAll();
    assert.equal(store.updateLoopTaskRecord(task.id, { status: "completed" })?.status, "completed");
  });
}

test("a real rename failure leaves its existing destination intact and no temporary file", () => {
  const task = createTask();
  const blockedFile = path.join(testHome, "rename-destination-directory");
  fs.mkdirSync(blockedFile);
  fs.writeFileSync(path.join(blockedFile, "original"), "keep", "utf8");
  assert.throws(() => store.writeLoopTaskStore(blockedFile, { tasks: [task] }));
  assert.equal(fs.readFileSync(path.join(blockedFile, "original"), "utf8"), "keep");
  assertNoTempFiles(blockedFile);
});

for (const withSibling of [false, true]) {
  test(`migration target failure retains the source${withSibling ? " and its sibling" : ""}, then a retry commits`, (t) => {
    const task = createTask();
    const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
    const tasks = withSibling ? [task, sibling] : [task];
    store.writeLoopTaskStore(task.taskStoreFile, { tasks });
    const original = fs.readFileSync(task.taskStoreFile, "utf8");
    const target = store.getLoopTaskStoreSessionFile(task.workspaceKey, "codex", "bound");
    const targetSibling = { ...createTask(), taskStoreFile: target };
    store.writeLoopTaskStore(target, { tasks: [targetSibling] });
    const originalTarget = fs.readFileSync(target, "utf8");
    const error = new Error("target commit failed");
    const originalRename = fs.renameSync;
    t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
      if (String(args[1]) === target) throw error;
      return originalRename(...args);
    });
    assert.throws(() => store.bindLoopTaskToSession(task.id, "bound"), (caught: unknown) => caught === error);
    assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), original);
    assert.equal(fs.readFileSync(target, "utf8"), originalTarget);
    assert.equal(store.readLoopTaskRecord(task.id)?.taskStoreFile, task.taskStoreFile);
    assertNoTempFiles(target);
    t.mock.restoreAll();
    const moved = store.bindLoopTaskToSession(task.id, "bound");
    assert.equal(moved?.taskStoreFile, target);
    assert.equal(moved?.sessionId, "bound");
    assert.ok(moved!.updatedAt > task.updatedAt);
    assert.equal(store.readLoopTaskStore(target).tasks.length, 2);
    assert.equal(store.readLoopTaskStore(task.taskStoreFile).tasks.some((item) => item.id === task.id), false);
    assert.equal(fs.existsSync(task.taskStoreFile), withSibling);
    if (withSibling) assert.equal(store.readLoopTaskStore(task.taskStoreFile).tasks[0].id, sibling.id);
    assert.equal(coldStore().readLoopTaskRecord(task.id)?.taskStoreFile, target);
  });
}

test("legacy migration retains its source on target failure and cannot recache an old copy after relocation", (t) => {
  const { getLegacyLoopStoragePaths } = require("../../loopLegacyMigration") as typeof import("../../loopLegacyMigration");
  const legacyFile = getLegacyLoopStoragePaths(path.join(testHome, ".sinitek_cli")).taskStoreFlatFile;
  const task = createTask();
  const target = task.taskStoreFile;
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, JSON.stringify({ tasks: [{ ...task, taskStoreFile: legacyFile }] }), "utf8");
  const original = fs.readFileSync(legacyFile, "utf8");
  const originalRename = fs.renameSync;
  t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
    if (String(args[1]) === target) throw new Error("legacy target commit blocked");
    return originalRename(...args);
  });
  assert.ok(store.listLoopTaskStoreFiles().includes(legacyFile));
  assert.equal(fs.readFileSync(legacyFile, "utf8"), original);
  assert.equal(fs.existsSync(target), false);
  assertNoTempFiles(target);
  t.mock.restoreAll();

  const originalUnlink = fs.unlinkSync;
  t.mock.method(fs, "unlinkSync", (...args: Parameters<typeof fs.unlinkSync>) => {
    if (String(args[0]) === legacyFile) throw new Error("legacy source cleanup blocked");
    return originalUnlink(...args);
  });
  store.listLoopTaskStoreFiles();
  assert.equal(store.readLoopTaskRecord(task.id)?.taskStoreFile, target);
  const moved = store.bindLoopTaskToSession(task.id, "after-legacy");
  assert.ok(moved);
  store.listLoopTaskStoreFiles(); // Retry the retained legacy source after moving again.
  assert.equal(store.readLoopTaskRecord(task.id)?.taskStoreFile, moved.taskStoreFile);
  assert.equal(coldStore().readLoopTaskRecord(task.id)?.taskStoreFile, moved.taskStoreFile);
  t.mock.restoreAll();
  store.listLoopTaskStoreFiles();
  assert.equal(fs.existsSync(legacyFile), false);
  assert.equal(coldStore().readLoopTaskRecord(task.id)?.taskStoreFile, moved.taskStoreFile);
});

for (const withSibling of [false, true]) {
  test(`committed migration survives source ${withSibling ? "rewrite" : "unlink"} failure, retention and cold retry`, (t) => {
    const task = createTask();
    const sibling = { ...createTask(), taskStoreFile: task.taskStoreFile };
    store.writeLoopTaskStore(task.taskStoreFile, { tasks: withSibling ? [task, sibling] : [task] });
    const original = fs.readFileSync(task.taskStoreFile, "utf8");
    const target = store.getLoopTaskStoreSessionFile(task.workspaceKey, "opencode", "moved");
    if (withSibling) {
      const originalRename = fs.renameSync;
      t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
        if (String(args[1]) === task.taskStoreFile) throw new Error("source rewrite blocked");
        return originalRename(...args);
      });
    } else {
      const originalUnlink = fs.unlinkSync;
      t.mock.method(fs, "unlinkSync", (...args: Parameters<typeof fs.unlinkSync>) => {
        if (String(args[0]) === task.taskStoreFile) throw new Error("source unlink blocked");
        return originalUnlink(...args);
      });
    }
    const committed = store.updateLoopTaskRecord(task.id, {
      cli: "opencode", sessionId: "moved", taskStoreFile: target, status: "completed", updatedAt: task.updatedAt,
    });
    assert.equal(committed?.status, "completed");
    assert.equal(fs.readFileSync(task.taskStoreFile, "utf8"), original);
    assert.equal(store.readLoopTaskRecord(task.id)?.taskStoreFile, target);
    assertNoTempFiles(task.taskStoreFile);
    t.mock.restoreAll();
    store.cleanupLoopTaskStoreRetention();
    assert.equal(store.readLoopTaskRecord(task.id)?.taskStoreFile, target);
    const restarted = coldStore();
    assert.equal(restarted.readLoopTaskRecord(task.id)?.taskStoreFile, target);
    // Same-target binding is idempotent. Old source cleanup may remain pending;
    // subsequent patches must apply to the committed copy, even with an old clock.
    assert.equal(restarted.bindLoopTaskToRuntimeTarget(task.id, "opencode", "moved")?.status, "completed");
    const retried = restarted.updateLoopTaskRecord(task.id, { status: "running", finalSummary: "keep latest", updatedAt: task.updatedAt });
    assert.equal(retried?.status, "completed");
    assert.equal(retried?.taskStoreFile, target);
    restarted.cleanupLoopTaskStoreRetention();
    assert.equal(coldStore().readLoopTaskRecord(task.id)?.finalSummary, "keep latest");
    t.mock.method(Date, "now", () => task.updatedAt);
    restarted.appendLoopRound(task.id, {
      round: 1, role: "main", status: "end", startedAt: task.updatedAt, endedAt: task.updatedAt,
    });
    const afterRound = coldStore().readLoopTaskRecord(task.id);
    assert.equal(afterRound?.taskStoreFile, target);
    assert.equal(afterRound?.rounds.length, 1);
    assert.equal(afterRound?.updatedAt, committed?.updatedAt);
    assert.equal(store.readLoopTaskStore(task.taskStoreFile).tasks.find((item) => item.id === task.id)?.status, "running");
  });
}

test("撤销验收及原因经过实际文件存储和冷加载后保留", () => {
  const { createLoopPlusScheduler } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{ subtaskId: "obsolete", attemptId: "old-1" }]);
  scheduler.finish({ subtaskId: "obsolete", attemptId: "old-1", outcome: "completed" });
  const eventId = scheduler.prepareReviewBatch(4).items[0].eventId;
  assert.equal(scheduler.submitReviewBatch([eventId], [{ eventId, acceptance: "cancelled", reason: "用户取消旧需求" }]).ok, true);
  const task = { ...createTask(), schedulingMode: "event_driven" as const, loopPlus: scheduler.snapshot() };
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const loaded = coldStore().readLoopTaskStore(task.taskStoreFile).tasks[0];
  const restored = createLoopPlusScheduler({ snapshot: loaded.loopPlus as ReturnType<typeof scheduler.snapshot> });
  assert.equal(restored.wait().view.visibleReviewCount, 0);
  assert.equal(restored.snapshot().seenAttempts[0].acceptance, "cancelled");
  assert.equal(restored.snapshot().seenAttempts[0].acceptanceReason, "用户取消旧需求");
});
