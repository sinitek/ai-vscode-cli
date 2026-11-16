import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LoopTaskRecord } from "../../loopTaskStore";

const previousHome = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-repository-home-"));
process.env.HOME = home;
const store = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { DepartmentOwnedTaskSource } = require("../../extensionHost/departmentOwnedTaskSource") as typeof import("../../extensionHost/departmentOwnedTaskSource");
const { DepartmentOwnedSourceController } = require("../../extensionHost/departmentOwnedSourceController") as typeof import("../../extensionHost/departmentOwnedSourceController");
const { DepartmentOwnedTaskRepository } = require("../../extensionHost/departmentOwnedTaskRepository") as typeof import("../../extensionHost/departmentOwnedTaskRepository");
const { departmentRecords } = require("../loop/departmentGroupChatHost.fixture") as typeof import("../loop/departmentGroupChatHost.fixture");
if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
let sequence = 0;

function fixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "department-repository-")));
  const source = DepartmentOwnedTaskSource.register(`repository-${++sequence}`, path.join(parent, "owned"));
  const cap = source.claim(); assert.ok(cap); assert.equal(source.prepareRebuild(), true);
  const locations = new Map<string, string[]>();
  const files = new Set<string>();
  let current = true, rejectCommit = false, fakeSuccess = false, commits = 0;
  const writes: LoopTaskRecord[][] = [];
  const ports: import("../../extensionHost/departmentOwnedTaskRepository").DepartmentOwnedTaskRepositoryPorts = {
    descriptor: source.descriptor,
    isCurrent: () => current && source.isCurrent(),
    readRevision: () => current && source.isCurrent() ? cap.revision : null,
    listFiles: () => source.listFiles(),
    // Controller reader fixture: current, bounded, non-symlink and lossless for retention.
    // Source.transact remains the real owner transaction; no mocked commit publication.
    readFile: (file) => {
      if (!source.isCurrent() || path.dirname(file) !== source.descriptor.root) return null;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return null;
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!Array.isArray(parsed.tasks)) return null;
        const tasks = parsed.tasks.map((task: unknown) => store.normalizeLoopTaskRecord(task, file));
        return tasks.every((task: LoopTaskRecord | null) => task !== null) ? tasks : null;
      } catch { return null; }
    },
    locateTask: (id) => current ? { available: true, files: locations.get(id) ?? [] } : { available: false },
    commit: (updates) => {
      commits++;
      for (const tasks of updates.values()) writes.push(structuredClone([...tasks]));
      if (rejectCommit) return false;
      if (fakeSuccess) return true;
      const result = source.transact(cap, updates);
      if (result) {
        for (const [file, tasks] of updates) {
          files.add(file);
          for (const [id, paths] of locations) if (paths.includes(file)) locations.delete(id);
          for (const task of tasks) locations.set(task.id, [...(locations.get(task.id) ?? []), file]);
        }
      }
      return result;
    },
  };
  const repository = new DepartmentOwnedTaskRepository(ports);
  const { root, leader, other } = recordsAt(source.descriptor.root);
  const disk = () => [...files].map((file) => [file, fs.readFileSync(file, "utf8")]);
  return { repository, source, parent, root, leader, other, locations, writes, disk,
    reopen() { return new DepartmentOwnedTaskRepository(ports); },
    get commits() { return commits; },
    invalidate() { current = false; source.invalidate(); },
    failCommit() { rejectCommit = true; }, fakeCommit() { fakeSuccess = true; },
    cleanup() { repository.dispose(); source.dispose(); fs.rmSync(parent, { recursive: true, force: true }); },
  };
}
function recordsAt(rootPath: string) {
  const data = departmentRecords();
  const root = data.root, leader = data.leader, other = data.other;
  for (const task of [root, leader, other]) task.id += `-${sequence}`;
  for (const task of [root, leader, other]) {
    task.department!.rootTaskId = root.id;
    if (task !== root) task.department!.parentTaskId = root.id;
  }
  for (const task of [root, leader, other]) {
    task.createdAt = task.updatedAt = Date.now(); task.taskStoreFile = path.join(rootPath, `${task.id}.json`);
    task.loopPlusAcceptancePlan = structuredClone(root.loopPlusAcceptancePlan);
    task.department!.routes = { director: { cli: "codex" }, leader: { cli: "codex" }, employee: { cli: "claude", thinkingMode: "off" } };
    task.modelRouting = { main: { cli: "codex" }, subtask: { cli: "claude" } };
    task.originProfile = { configId: "fixture", subtaskThinkingMode: "off" };
    task.sessionId = `session-${task.id}`;
  }
  root.schedulingMode = "classic"; delete root.loopPlus;
  return { root, leader, other };
}

/** Real controller/source/index; only the host-wide identity catalog is an injected fixture. */
function controllerFixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "department-repository-controller-")));
  const controller = DepartmentOwnedSourceController.create(`repository-controller-${++sequence}`, path.join(parent, "owned"), async () => undefined);
  assert.ok(controller); assert.equal(controller.ready, true);
  const locations = new Map<string, string[]>();
  const reads: string[] = [];
  let listings = 0;
  const batchQueries: string[][] = [];
  const ports: import("../../extensionHost/departmentOwnedTaskRepository").DepartmentOwnedTaskRepositoryPorts = {
    descriptor: controller.descriptor,
    isCurrent: () => controller.ready,
    readRevision: () => controller.readRevision(),
    listFiles: () => { listings++; const files = controller.listFiles(); assert.ok(files); return files; },
    readFile: (file) => { reads.push(file); return controller.readFile(file); },
    locateTask: (id) => controller.ready ? { available: true, files: locations.get(id) ?? [] } : { available: false },
    locateTasks: (ids) => {
      batchQueries.push([...ids]);
      return controller.ready ? { available: true, locations: new Map(ids.map((id) => [id, locations.get(id) ?? []])) } : { available: false };
    },
    commit: (updates) => {
      const result = controller.commitSync(updates);
      if (result) {
        for (const [file, tasks] of updates) {
          for (const [id, paths] of locations) if (paths.includes(file)) locations.delete(id);
          for (const task of tasks) locations.set(task.id, [...(locations.get(task.id) ?? []), file]);
        }
      }
      return result;
    },
  };
  const repository = new DepartmentOwnedTaskRepository(ports);
  return { parent, controller, repository, ports, reads, locations, batchQueries, ...recordsAt(controller.descriptor.root),
    get listings() { return listings; },
    async cleanup() { repository.dispose(); await controller.close(); fs.rmSync(parent, { recursive: true, force: true }); },
  };
}
function value<T>(result: import("../../extensionHost/departmentOwnedTaskRepository").DepartmentRepositoryResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.value;
}
const round = { round: 1, role: "main" as const, status: "end" as const, startedAt: 1, endedAt: 2, summary: "首次" };

test("complete root and leader creation uses one real owner transaction each, with no ordinary intermediate record", () => {
  const h = fixture();
  try {
    assert.equal(fs.existsSync(h.root.taskStoreFile), false);
    const root = value(h.repository.create(h.root));
    assert.equal(h.commits, 1); assert.equal(h.writes[0][0].department?.role, "director");
    assert.equal(root.taskStoreFile, h.root.taskStoreFile);
    assert.equal(store.readLoopTaskRecord(root.id)?.department?.role, "director");
    value(h.repository.create(h.leader)); value(h.repository.create(h.other));
    assert.equal(store.readLoopTaskRecord(h.leader.id)?.loopPlusAcceptancePlan?.id, root.loopPlusAcceptancePlan?.id);
    assert.equal(fs.existsSync(store.buildLoopTaskStoreFile(root.cli, root.workspaceKey, root.sessionId!, root.id)), false);
    assert.equal(fs.readdirSync(h.source.descriptor.root).filter((name) => name.endsWith(".stage")).length, 0);
  } finally { h.cleanup(); }
});

test("public update/append and session/runtime rebind route through owner and retain the physical file", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader));
    assert.equal(store.updateLoopTaskRecord(h.leader.id, { status: "running" })?.status, "running");
    store.appendLoopRound(h.leader.id, round);
    assert.equal(store.tryAppendLoopRound(h.leader.id, { ...round, summary: "替换", endedAt: 3 }), true);
    const reread = store.readLoopTaskRecord(h.leader.id)!;
    assert.equal(reread.rounds.length, 1); assert.equal(reread.rounds[0].summary, "替换");
    assert.equal(store.bindLoopTaskToSession(h.leader.id, "rebound")?.taskStoreFile, h.leader.taskStoreFile);
    assert.equal(store.bindLoopTaskToRuntimeTarget(h.leader.id, "codex", "runtime")?.sessionId, "runtime");
    assert.equal(store.bindLoopTaskToRuntimeTarget(h.leader.id, "claude", "wrong"), null);
    assert.equal(store.readLoopTaskStoreResult(h.leader.taskStoreFile, true, true).ok, true);
    assert.equal(fs.existsSync(store.getLoopTaskStoreSessionFile(h.leader.workspaceKey, "codex", "runtime")), false);
    assert.equal(h.commits, 7);
  } finally { h.cleanup(); }
});

test("invalid metadata, route, plan, snapshot, identity and physical collisions reject before disk changes", () => {
  const h = fixture();
  try {
    const bad: LoopTaskRecord[] = [
      { ...h.root, department: undefined },
      { ...h.root, department: { ...h.root.department!, routes: { ...h.root.department!.routes, director: { cli: [] as never } } } },
      { ...h.root, loopPlusAcceptancePlan: {} as never },
      { ...h.leader, loopPlus: { version: 1 } },
      { ...h.root, taskStoreFile: path.join(h.parent, "escape.json") },
    ];
    for (const record of bad) assert.equal(h.repository.create(record).ok, false);
    assert.equal(h.commits, 0);
    value(h.repository.create(h.root)); value(h.repository.create(h.leader));
    const before = h.disk();
    assert.equal(h.repository.create(h.root).ok, false);
    const duplicate = { ...h.leader, id: "duplicate-module", taskStoreFile: path.join(h.source.descriptor.root, "duplicate.json") };
    assert.equal(h.repository.create(duplicate).ok, false);
    fs.writeFileSync(path.join(h.source.descriptor.root, "collision.json"), "original");
    assert.equal(h.repository.create({ ...h.root, id: "physical-collision", taskStoreFile: path.join(h.source.descriptor.root, "collision.json"), department: { ...h.root.department!, rootTaskId: "physical-collision" } }).ok, false);
    assert.equal(fs.readFileSync(path.join(h.source.descriptor.root, "collision.json"), "utf8"), "original");
    h.locations.set("ordinary-published", [path.join(h.parent, "ordinary.json")]);
    assert.equal(h.repository.create({ ...h.root, id: "ordinary-published", taskStoreFile: path.join(h.source.descriptor.root, "upgrade.json"), department: { ...h.root.department!, rootTaskId: "ordinary-published" } }).ok, false);
    assert.deepEqual(h.disk(), before); assert.equal(h.commits, 2);
  } finally { h.cleanup(); }
});

test("owned mutation cannot move outside source or change frozen identity/routes/plan", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader));
    const before = h.disk(), destination = path.join(h.parent, "outside", "tasks.json");
    for (const patch of [{ taskStoreFile: destination }, { id: "spoofed" }, { workspaceKey: "elsewhere" }, { department: undefined },
      { loopPlusAcceptancePlan: { ...h.root.loopPlusAcceptancePlan!, name: "changed" } }, { modelRouting: { main: { cli: "claude" as const }, subtask: {} } }]) {
      assert.equal(store.updateLoopTaskRecord(h.leader.id, patch), null);
    }
    assert.equal(fs.existsSync(path.dirname(destination)), false);
    assert.equal(store.tryWriteLoopTaskStore(destination, { tasks: [h.leader] }), false);
    assert.equal(fs.existsSync(path.dirname(destination)), false);
    assert.deepEqual(h.disk(), before);
  } finally { h.cleanup(); }
});

test("source invalidation and router disposal keep owned identities closed without discovery or fallback", () => {
  for (const dispose of [false, true]) {
    const h = fixture();
    try {
      value(h.repository.create(h.root)); const before = h.disk();
      if (dispose) h.repository.dispose(); else h.invalidate();
      assert.equal(store.readLoopTaskRecord(h.root.id), null);
      assert.equal(store.updateLoopTaskRecord(h.root.id, { finalSummary: "must not publish" }), null);
      assert.equal(store.tryAppendLoopRound(h.root.id, round), false);
      assert.equal(store.bindLoopTaskToSession(h.root.id, "closed"), null);
      assert.equal(store.readLoopTaskStoreResult(h.root.taskStoreFile).ok, false);
      const alias = path.join(h.parent, "alias"); fs.symlinkSync(h.source.descriptor.root, alias, "dir");
      assert.equal(store.readLoopTaskStoreResult(path.join(alias, path.basename(h.root.taskStoreFile))).ok, false);
      const fileAlias = path.join(h.parent, "file-alias.json"); fs.symlinkSync(h.root.taskStoreFile, fileAlias);
      assert.equal(store.readLoopTaskStoreResult(fileAlias).ok, false);
      assert.equal(store.deleteLoopTaskStoreFile(h.root.taskStoreFile), false);
      assert.equal(store.tryWriteLoopTaskStore(h.root.taskStoreFile, { tasks: [h.root] }), false);
      store.cleanupLoopTaskStoreRetention(); assert.deepEqual(h.disk(), before);
    } finally { h.cleanup(); }
  }
});

test("false commit and false success never return an unpersisted successful record", () => {
  for (const fake of [false, true]) {
    const h = fixture();
    try {
      if (fake) h.fakeCommit(); else h.failCommit();
      const result = h.repository.create(h.root);
      assert.equal(result.ok, false); assert.equal(fs.existsSync(h.root.taskStoreFile), false);
      assert.equal(store.readLoopTaskRecord(h.root.id), null);
      assert.equal(store.tryAppendLoopRound(h.root.id, round), false);
      assert.equal(store.tryWriteLoopTaskStore(path.join(h.parent, "fallback.json"), { tasks: [h.root] }), false);
    } finally { h.cleanup(); }
  }
});

test("logical delete and retention use owner commits, reject orphaning, retain deleted identity tombstones", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader));
    assert.equal(h.repository.delete(h.root.id).ok, false);
    assert.equal(store.deleteLoopTaskStoreFile(h.leader.taskStoreFile), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(h.leader.taskStoreFile, "utf8")), { tasks: [] });
    assert.equal(h.repository.create(h.leader).ok, false);
    value(h.repository.retention(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100));
    assert.deepEqual(JSON.parse(fs.readFileSync(h.root.taskStoreFile, "utf8")), { tasks: [] });
    assert.equal(store.readLoopTaskRecord(h.root.id), null);
    assert.equal(h.commits, 4);
  } finally { h.cleanup(); }
});

test("import, restore and explicit legacy migration refuse before any owner transaction", () => {
  const h = fixture();
  try {
    const legacy = path.join(h.parent, "legacy.json"); fs.writeFileSync(legacy, JSON.stringify({ tasks: [h.root] }));
    const content = fs.readFileSync(legacy, "utf8");
    assert.equal(h.repository.importRecords([h.root]).ok, false);
    assert.equal(h.repository.restoreRecords([h.root]).ok, false);
    assert.equal(h.repository.migrateLegacy(legacy).ok, false);
    assert.equal(h.commits, 0); assert.equal(fs.readFileSync(legacy, "utf8"), content);
  } finally { h.cleanup(); }
});

test("ordinary Loop and Loop+ remain discoverable, writable and bindable beside an owned source", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root));
    for (const schedulingMode of ["classic", "event_driven"] as const) {
      const ordinary = { ...h.root, id: `ordinary-${sequence}-${schedulingMode}`, department: undefined, schedulingMode, taskStoreFile: "", sessionId: null };
      ordinary.taskStoreFile = store.buildLoopTaskStoreFile("codex", ordinary.workspaceKey, null, ordinary.id);
      assert.equal(store.tryWriteLoopTaskStore(ordinary.taskStoreFile, { tasks: [ordinary] }), true);
      assert.equal(store.updateLoopTaskRecord(ordinary.id, { finalSummary: "普通任务" })?.finalSummary, "普通任务");
      assert.equal(store.tryAppendLoopRound(ordinary.id, round), true);
      assert.equal(store.bindLoopTaskToSession(ordinary.id, `ordinary-session-${schedulingMode}`)?.sessionId, `ordinary-session-${schedulingMode}`);
      assert.equal(store.updateLoopTaskRecord(ordinary.id, { department: h.root.department }), null);
    }
  } finally { h.cleanup(); }
});

test("complete initialization reopens unique controlled records and rejects ambiguous identity lookup", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader)); h.repository.dispose();
    h.locations.set(h.root.id, [h.root.taskStoreFile, h.leader.taskStoreFile]);
    assert.throws(() => h.reopen(), /唯一身份索引/);
    assert.equal(store.readLoopTaskRecord(h.root.id), null);
    h.locations.set(h.root.id, [h.root.taskStoreFile]);
    const next = h.reopen();
    try {
      assert.equal(store.updateLoopTaskRecord(h.leader.id, { finalSummary: "恢复后的事务" })?.finalSummary, "恢复后的事务");
      assert.equal(value(next.read(h.root.id)).id, h.root.id);
    } finally { next.dispose(); }
  } finally { h.cleanup(); }
});

test("public retention delegates to the owned transaction exactly once and propagates owner failure by refusal", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root)); const before = h.disk();
    store.cleanupLoopTaskStoreRetention();
    assert.equal(h.commits, 1); // In-date records need no writes.
    h.failCommit();
    assert.equal(store.updateLoopTaskRecord(h.root.id, { finalSummary: "failed write" }), null);
    assert.equal(store.tryAppendLoopRound(h.root.id, round), false);
    assert.deepEqual(h.disk(), before); assert.equal(h.commits, 2);
  } finally { h.cleanup(); }
});

test("automatic legacy migration refuses department claims before moving communication or task files", () => {
  const h = fixture();
  const legacyRoot = path.join(home, ".sinitek_cli", "lobster-tasks");
  const communication = path.join(home, ".sinitek_cli", "lobster-communications");
  try {
    value(h.repository.create(h.root));
    fs.mkdirSync(legacyRoot, { recursive: true }); fs.mkdirSync(communication, { recursive: true });
    const file = path.join(legacyRoot, "lobster-tasks.json");
    const original = JSON.stringify({ tasks: [{ ...h.root, department: undefined }] });
    fs.writeFileSync(file, original); fs.writeFileSync(path.join(communication, "evidence.txt"), "keep");
    const before = h.disk();
    assert.ok(store.listLoopTaskStoreFiles().includes(file));
    assert.equal(fs.readFileSync(file, "utf8"), original);
    assert.equal(fs.readFileSync(path.join(communication, "evidence.txt"), "utf8"), "keep");
    assert.deepEqual(h.disk(), before);
  } finally {
    h.cleanup(); fs.rmSync(legacyRoot, { recursive: true, force: true }); fs.rmSync(communication, { recursive: true, force: true });
  }
});

test("public retention removes expired controlled records only through one complete owner transaction", () => {
  const h = fixture();
  const originalNow = Date.now;
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader));
    const future = originalNow() + 1000 * 60 * 60 * 24 * 365 * 100;
    Date.now = () => future;
    store.cleanupLoopTaskStoreRetention();
    assert.equal(h.commits, 3);
    assert.deepEqual(h.writes[2], []); assert.deepEqual(h.writes[3], []);
    for (const task of [h.root, h.leader]) {
      assert.deepEqual(JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8")), { tasks: [] });
      assert.equal(store.updateLoopTaskRecord(task.id, { finalSummary: "cannot recreate" }), null);
    }
  } finally { Date.now = originalNow; h.cleanup(); }
});

test("fresh reads and initialization reject a record claiming another controlled physical file", () => {
  const h = fixture();
  try {
    value(h.repository.create(h.root));
    const raw = JSON.parse(fs.readFileSync(h.root.taskStoreFile, "utf8"));
    raw.tasks[0].taskStoreFile = path.join(h.source.descriptor.root, "false-location.json");
    fs.writeFileSync(h.root.taskStoreFile, JSON.stringify(raw));
    const before = fs.readFileSync(h.root.taskStoreFile, "utf8");
    assert.equal(store.readLoopTaskRecord(h.root.id), null);
    assert.equal(store.updateLoopTaskRecord(h.root.id, { finalSummary: "do not lose record" }), null);
    assert.equal(h.commits, 1);
    assert.equal(fs.readFileSync(h.root.taskStoreFile, "utf8"), before);
    assert.equal(fs.existsSync(raw.tasks[0].taskStoreFile), false);
    h.repository.dispose();
    assert.throws(() => h.reopen(), /声明路径/);
  } finally { h.cleanup(); }
});

test("real controller sync commit publishes durable records and index before public router returns without repository-wide rereads", async () => {
  const h = controllerFixture();
  try {
    const initialRevision = h.controller.readRevision()!;
    value(h.repository.create(h.root)); value(h.repository.create(h.leader)); value(h.repository.create(h.other));
    assert.equal(h.controller.readRevision(), initialRevision + 3);
    assert.deepEqual(h.controller.readLeaderTaskIds(h.root.id, h.leader.department!.leaderSubtaskId!), [h.leader.id]);
    for (const action of [
      () => assert.equal(store.updateLoopTaskRecord(h.leader.id, { finalSummary: "真实同步事务" })?.finalSummary, "真实同步事务"),
      () => assert.equal(store.tryAppendLoopRound(h.leader.id, round), true),
      () => assert.equal(store.bindLoopTaskToSession(h.leader.id, "real-controller-session")?.sessionId, "real-controller-session"),
    ]) {
      h.reads.length = 0;
      action();
      // One target read before mutation, one persisted readback. The controller's required
      // index rebuild is separate; repository no longer repeats complete source reads.
      assert.deepEqual(h.reads, [h.leader.taskStoreFile, h.leader.taskStoreFile]);
      assert.equal(h.controller.ready, true);
    }
    h.reads.length = 0; h.batchQueries.length = 0;
    const read = store.readLoopTaskRecord(h.leader.id)!;
    assert.deepEqual(h.batchQueries.map((ids) => ids.sort()), [[h.root.id, h.leader.id, h.other.id].sort()], "one batch covers every cached contribution");
    assert.deepEqual(h.reads, [h.leader.taskStoreFile]);
    read.rounds.length = 0;
    assert.equal(store.readLoopTaskRecord(h.leader.id)?.rounds.length, 1);
    assert.equal(h.listings, 1);
    const disk = JSON.parse(fs.readFileSync(h.leader.taskStoreFile, "utf8")).tasks[0];
    assert.equal(disk.finalSummary, "真实同步事务"); assert.equal(disk.rounds.length, 1);
    assert.equal(disk.sessionId, "real-controller-session");
    h.repository.dispose(); h.reads.length = 0;
    const reopened = new DepartmentOwnedTaskRepository(h.ports);
    try {
      assert.deepEqual([...h.reads].sort(), [h.root, h.leader, h.other].map((task) => task.taskStoreFile).sort());
    } finally { reopened.dispose(); }
  } finally { await h.cleanup(); }
});

test("cached repository retains relationship and unique identity checks without reading unrelated files", async () => {
  const h = controllerFixture();
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader)); value(h.repository.create(h.other));
    const before = fs.readFileSync(h.root.taskStoreFile, "utf8");
    h.reads.length = 0;
    assert.equal(h.repository.update(h.root.id, { subTasks: [] }).ok, false);
    assert.deepEqual(h.reads, [h.root.taskStoreFile]);
    assert.equal(fs.readFileSync(h.root.taskStoreFile, "utf8"), before);
    h.locations.set(h.other.id, [h.other.taskStoreFile, h.leader.taskStoreFile]);
    h.reads.length = 0;
    assert.equal(h.repository.read(h.leader.id).ok, false);
    assert.equal(h.repository.append(h.leader.id, round).ok, false);
    assert.deepEqual(h.reads, [h.leader.taskStoreFile, h.leader.taskStoreFile]);
  } finally { await h.cleanup(); }
});

test("external controller publication or explicit rebuild revokes cached repository until complete reinitialization", async () => {
  for (const rebuildOnly of [false, true]) {
    const h = controllerFixture();
    try {
      value(h.repository.create(h.root)); value(h.repository.create(h.leader));
      if (rebuildOnly) assert.equal(h.controller.rebuild(), true);
      else {
        const current = h.controller.readTaskRecord(h.root.id)!;
        assert.equal(await h.controller.commit(new Map([[current.taskStoreFile, [{ ...current, finalSummary: "外部已提交" }]]])), true);
      }
      assert.equal(h.controller.ready, true);
      const before = fs.readFileSync(h.leader.taskStoreFile, "utf8");
      h.reads.length = 0;
      assert.equal(store.readLoopTaskRecord(h.leader.id), null);
      assert.equal(store.updateLoopTaskRecord(h.leader.id, { finalSummary: "旧缓存不得写入" }), null);
      assert.equal(store.tryAppendLoopRound(h.leader.id, round), false);
      assert.deepEqual(h.reads, []);
      assert.equal(fs.readFileSync(h.leader.taskStoreFile, "utf8"), before);
      h.repository.dispose();
      const next = new DepartmentOwnedTaskRepository(h.ports);
      try { assert.equal(value(next.read(h.leader.id)).id, h.leader.id); }
      finally { next.dispose(); }
    } finally { await h.cleanup(); }
  }
});

test("real synchronous owner failure revokes reads, leaves recovery material and never returns an unpersisted record", async () => {
  const h = controllerFixture();
  const mutableFs = fs as unknown as { renameSync: typeof fs.renameSync };
  const rename = mutableFs.renameSync;
  try {
    value(h.repository.create(h.root)); value(h.repository.create(h.leader));
    const before = fs.readFileSync(h.leader.taskStoreFile, "utf8");
    mutableFs.renameSync = (() => { throw new Error("真实 owner 发布失败"); }) as typeof fs.renameSync;
    assert.equal(store.updateLoopTaskRecord(h.leader.id, { finalSummary: "不得误报" }), null);
    assert.equal(h.controller.ready, false);
    assert.equal(h.controller.readRevision(), null);
    assert.equal(store.readLoopTaskRecord(h.leader.id), null);
    assert.equal(store.tryAppendLoopRound(h.leader.id, round), false);
    assert.equal(fs.readFileSync(h.leader.taskStoreFile, "utf8"), before);
    assert.equal(fs.readdirSync(h.controller.descriptor.root).some((name) => name.endsWith(".recovery")), true);
    mutableFs.renameSync = rename;
    assert.equal(h.controller.recoverAndRebuild(), true);
    assert.equal(h.repository.read(h.leader.id).ok, false); // A failed repository never self-heals.
    h.repository.dispose();
    const next = new DepartmentOwnedTaskRepository(h.ports);
    try { assert.equal(value(next.read(h.leader.id)).finalSummary, h.leader.finalSummary); }
    finally { next.dispose(); }
  } finally { mutableFs.renameSync = rename; await h.cleanup(); }
});

test("real controller close revokes repository synchronously while its writer barrier is pending", async () => {
  const h = controllerFixture();
  try {
    value(h.repository.create(h.root));
    const before = fs.readFileSync(h.root.taskStoreFile, "utf8");
    const closing = h.controller.close();
    assert.equal(h.controller.commitSync(new Map()), false);
    assert.equal(h.controller.readRevision(), null);
    assert.equal(store.readLoopTaskRecord(h.root.id), null);
    assert.equal(store.updateLoopTaskRecord(h.root.id, { finalSummary: "关闭后拒绝" }), null);
    assert.equal(fs.readFileSync(h.root.taskStoreFile, "utf8"), before);
    assert.equal(await closing, true);
  } finally { await h.cleanup(); }
});
