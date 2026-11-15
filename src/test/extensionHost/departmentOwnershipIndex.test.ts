import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DepartmentOwnershipIndex, type DepartmentOwnershipSource } from "../../extensionHost/departmentOwnershipIndex";
import { authorizeDepartmentLeader, buildDepartmentGroupChatProjection } from "../../extensionHost/departmentGroupChatProjection";
import { departmentRecords } from "../loop/departmentGroupChatHost.fixture";
import {
  tryWriteLoopTaskStore, writeLoopTaskStore, readLoopTaskStore, readLoopTaskStoreResult,
  updateLoopTaskRecord, deleteLoopTaskStoreFile, subscribeLoopTaskStoreChanges,
  type LoopTaskRecord, type LoopTaskStoreChange,
} from "../../loopTaskStore";

function memorySource() {
  const data = departmentRecords();
  const files = new Map<string, LoopTaskRecord[]>([["/index/tasks.json", [...data.records.values()]]]);
  let current = true, scans = 0, reads = 0, fileFailure = false, listFailure = false;
  let duringList: (() => void) | undefined;
  let listener: ((change: LoopTaskStoreChange) => void) | undefined, external: (() => void) | undefined;
  let disposed = 0;
  const source: DepartmentOwnershipSource = {
    listFiles: () => { scans++; duringList?.(); if (listFailure) throw Error("unreadable directory"); return [...files.keys()]; },
    readFile: (file) => { reads++; return fileFailure ? null : files.get(file) ?? null; },
    subscribe: (handler) => { listener = handler; return { dispose() { listener = undefined; disposed++; } }; },
    lifecycle: { isCurrent: () => current, subscribe: (handler) => { external = handler; return { dispose() { external = undefined; disposed++; } }; } },
  };
  const index = new DepartmentOwnershipIndex(source);
  const replace = (file: string, tasks: LoopTaskRecord[]) => { files.set(file, tasks); listener?.({ type: "replace", filePath: file, tasks }); };
  return { ...data, index, source, files, replace, external: () => external?.(),
    invalidate: () => listener?.({ type: "invalidate", filePath: "/unknown" }),
    current: (value: boolean) => { current = value; }, fileFailure: (value: boolean) => { fileFailure = value; },
    listFailure: (value: boolean) => { listFailure = value; }, duringList: (hook: () => void) => { duringList = hook; },
    stats: () => ({ scans, reads, disposed }),
  };
}

test("ownership index rebuilds once, replaces file contributions idempotently and keeps module duplicates ambiguous", () => {
  const h = memorySource();
  try {
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    assert.equal(h.index.rebuild(), true);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), [h.leader.id]);
    h.replace("/index/tasks.json", [...h.records.values()]); h.replace("/index/tasks.json", [...h.records.values()]);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), [h.leader.id]);
    const duplicate = structuredClone(h.leader); duplicate.id = "duplicate";
    h.replace("/index/duplicate.json", [duplicate]);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), [h.leader.id, "duplicate"]);
    const port = { readTaskRecord: (id: string) => h.records.get(id) ?? null };
    assert.equal(authorizeDepartmentLeader(h.root, h.leader, port, h.index.readDepartmentLeaderTaskIds), false);
    h.replace("/index/duplicate.json", []);
    assert.equal(authorizeDepartmentLeader(h.root, h.leader, port, h.index.readDepartmentLeaderTaskIds), true);
    assert.deepEqual(h.stats(), { scans: 1, reads: 1, disposed: 0 });
  } finally { h.index.dispose(); }
});

test("ownership changes remove old module/root/workspace memberships and reject duplicate record identities", () => {
  const h = memorySource();
  try {
    assert.equal(h.index.rebuild(), true);
    const nextRoot = structuredClone(h.root); nextRoot.id = "root-2"; nextRoot.workspaceKey = "workspace-B"; nextRoot.department!.rootTaskId = nextRoot.id;
    h.replace("/index/root2.json", [nextRoot]);
    h.leader.department!.leaderSubtaskId = "module-B"; h.replace("/index/tasks.json", [...h.records.values()]);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), []);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-B")!.length, 2);
    h.leader.department!.rootTaskId = nextRoot.id; h.leader.department!.parentTaskId = nextRoot.id;
    h.leader.workspaceKey = nextRoot.workspaceKey; h.replace("/index/tasks.json", [...h.records.values()]);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(nextRoot.id, "module-B"), [h.leader.id]);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-B"), [h.other.id]);
    h.leader.workspaceKey = "wrong-workspace"; h.replace("/index/tasks.json", [...h.records.values()]);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(nextRoot.id, "module-B"), []);
    assert.equal(authorizeDepartmentLeader(nextRoot, h.leader, { readTaskRecord: () => h.leader }, h.index.readDepartmentLeaderTaskIds), false);
    h.leader.workspaceKey = nextRoot.workspaceKey; h.replace("/index/tasks.json", [...h.records.values()]);
    const copy = structuredClone(h.leader); copy.department!.leaderSubtaskId = "module-A";
    h.replace("/index/copy.json", [copy]);
    assert.equal(h.index.readDepartmentLeaderTaskIds(nextRoot.id, "module-B"), null);
    h.replace("/index/copy.json", []);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(nextRoot.id, "module-B"), [h.leader.id]);
  } finally { h.index.dispose(); }
});

test("invalidations, failed/overlapping rebuilds and source lease loss fail closed until complete rebuild", () => {
  const h = memorySource();
  try {
    assert.equal(h.index.rebuild(), true); h.invalidate();
    h.replace("/index/tasks.json", [...h.records.values()]);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    h.fileFailure(true); assert.equal(h.index.rebuild(), false);
    h.fileFailure(false); h.listFailure(true); assert.equal(h.index.rebuild(), false);
    h.listFailure(false);
    h.duringList(() => { assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null); });
    assert.equal(h.index.rebuild(), true); // Queries reject during rebuild without disturbing its snapshot.
    h.duringList(() => h.external()); assert.equal(h.index.rebuild(), false);
    h.duringList(() => {}); assert.equal(h.index.rebuild(), true);
    h.external(); assert.equal(h.index.state, "invalid"); assert.equal(h.index.rebuild(), true);
    h.current(false); assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    assert.equal(h.index.rebuild(), false); h.current(true); assert.equal(h.index.rebuild(), true);
    h.leader.departmentInvalid = true; h.replace("/index/tasks.json", [...h.records.values()]);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-B"), null);
    h.index.dispose(); h.index.dispose(); assert.equal(h.index.rebuild(), false);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    assert.equal(h.stats().disposed, 2);
  } finally { h.index.dispose(); }
});

test("projection and fresh authorization use indexed modules repeatedly without enumerating persisted stores", () => {
  const h = memorySource();
  try {
    assert.equal(h.index.rebuild(), true);
    let currentReads = 0;
    const port = { readTaskRecord: (id: string) => { currentReads++; return h.records.get(id) ?? null; }, readLeaderTaskIds: h.index.readDepartmentLeaderTaskIds };
    for (let i = 0; i < 30; i++) {
      assert.equal(authorizeDepartmentLeader(h.root, h.leader, port, h.index.readDepartmentLeaderTaskIds), true);
      assert.equal(buildDepartmentGroupChatProjection(h.root, port)!.leaders.length, 2);
    }
    assert.deepEqual(h.stats(), { scans: 1, reads: 1, disposed: 0 }); assert.equal(currentReads, 90);
    h.leader.department!.parentTaskId = "changed-outside-record-reader";
    assert.equal(authorizeDepartmentLeader(h.root, h.leader, port, h.index.readDepartmentLeaderTaskIds), false);
    assert.equal(buildDepartmentGroupChatProjection(h.root, { readTaskRecord: port.readTaskRecord }), undefined);
    h.invalidate(); assert.equal(buildDepartmentGroupChatProjection(h.root, port), undefined);
  } finally { h.index.dispose(); }
});

/** Real storage calls on isolated temporary files; only the directory discovery and external lease are fixtures. */
function diskSource() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-index-"));
  const data = departmentRecords();
  for (const task of data.records.values()) { task.createdAt = task.updatedAt = Date.now(); task.taskStoreFile = path.join(directory, "tasks.json"); }
  let scans = 0;
  const source: DepartmentOwnershipSource = {
    listFiles: () => { scans++; return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => path.join(directory, name)); },
    readFile: (file) => { const read = readLoopTaskStoreResult(file, true, true); return read.ok ? read.store.tasks : null; },
    subscribe: subscribeLoopTaskStoreChanges,
    lifecycle: { isCurrent: () => true, subscribe: () => ({ dispose() {} }) },
  };
  assert.equal(tryWriteLoopTaskStore(data.root.taskStoreFile, { tasks: [...data.records.values()] }), true);
  const index = new DepartmentOwnershipIndex(source); assert.equal(index.rebuild(), true);
  return { ...data, directory, index, scans: () => scans, cleanup: () => { index.dispose(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("confirmed real writes, updates, root/module/workspace changes, path migration and deletion update before return", () => {
  const h = diskSource();
  try {
    const query = h.index.readDepartmentLeaderTaskIds;
    assert.deepEqual(query(h.root.id, "module-A"), [h.leader.id]);
    assert.ok(updateLoopTaskRecord(h.leader.id, { department: { ...h.leader.department!, leaderSubtaskId: "module-B" } }));
    assert.deepEqual(query(h.root.id, "module-A"), []); assert.equal(query(h.root.id, "module-B")!.length, 2);
    const target = path.join(h.directory, "moved.json");
    const moved = updateLoopTaskRecord(h.leader.id, { department: h.leader.department, taskStoreFile: target }); assert.ok(moved);
    assert.deepEqual(query(h.root.id, "module-A"), [h.leader.id]);
    assert.equal(readLoopTaskStore(h.root.taskStoreFile).tasks.some((task) => task.id === h.leader.id), false);
    assert.equal(readLoopTaskStore(target).tasks[0].id, h.leader.id);
    assert.ok(updateLoopTaskRecord(h.leader.id, { workspaceKey: "other" })); assert.deepEqual(query(h.root.id, "module-A"), []);
    assert.ok(updateLoopTaskRecord(h.leader.id, { workspaceKey: h.root.workspaceKey }));
    assert.deepEqual(query(h.root.id, "module-A"), [h.leader.id]);
    assert.equal(deleteLoopTaskStoreFile(target), true); assert.deepEqual(query(h.root.id, "module-A"), []);
    assert.equal(h.scans(), 1);
  } finally { h.cleanup(); }
});

test("real write/delete failures revoke completeness, void wrapper remains compatible and rebuild failure keeps it revoked", () => {
  const h = diskSource();
  try {
    const blocker = path.join(h.directory, "blocker"); fs.writeFileSync(blocker, "not a directory");
    const target = path.join(blocker, "tasks.json");
    assert.equal(updateLoopTaskRecord(h.leader.id, { taskStoreFile: target }), null);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    assert.ok(readLoopTaskStore(h.root.taskStoreFile).tasks.some((task) => task.id === h.leader.id));
    assert.equal(h.index.rebuild(), true);
    assert.equal(tryWriteLoopTaskStore(target, { tasks: [h.leader] }), false);
    assert.equal(writeLoopTaskStore(target, { tasks: [h.leader] }), undefined);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    fs.writeFileSync(path.join(h.directory, "broken.json"), "{broken");
    assert.equal(h.index.rebuild(), false); fs.unlinkSync(path.join(h.directory, "broken.json"));
    assert.equal(h.index.rebuild(), true);
    assert.equal(deleteLoopTaskStoreFile(h.directory), false);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
  } finally { h.cleanup(); }
});

test("external file creation and restart require invalidation and explicit complete rebuild, never an incremental heal", () => {
  const h = diskSource();
  try {
    h.index.invalidate(); // Central writer barrier BEFORE a non-store import/restore or external publish.
    const duplicate = { ...h.leader, id: "external-duplicate" };
    fs.writeFileSync(path.join(h.directory, "external.json"), JSON.stringify({ tasks: [duplicate] }));
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    assert.equal(h.index.rebuild(), true); assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A")!.length, 2);
    assert.equal(deleteLoopTaskStoreFile(path.join(h.directory, "external.json")), true);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), [h.leader.id]);
    h.index.dispose();
    const restarted = new DepartmentOwnershipIndex({ listFiles: () => [h.root.taskStoreFile],
      readFile: (file) => { const result = readLoopTaskStoreResult(file, true, true); return result.ok ? result.store.tasks : null; },
      subscribe: subscribeLoopTaskStoreChanges, lifecycle: { isCurrent: () => true, subscribe: () => ({ dispose() {} }) } });
    try { assert.equal(restarted.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
      assert.equal(restarted.rebuild(), true); assert.deepEqual(restarted.readDepartmentLeaderTaskIds(h.root.id, "module-A"), [h.leader.id]);
    } finally { restarted.dispose(); }
  } finally { h.cleanup(); }
});

test("incomplete subscriptions and malformed persisted records cannot claim a complete index", () => {
  const h = memorySource();
  const unavailable = new DepartmentOwnershipIndex({ ...h.source, subscribe: () => { throw Error("watcher unavailable"); } });
  try { assert.equal(unavailable.rebuild(), false); } finally { unavailable.dispose(); h.index.dispose(); }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-index-malformed-"));
  try {
    const file = path.join(directory, "tasks.json"); const data = departmentRecords(); data.root.updatedAt = Date.now();
    fs.writeFileSync(file, JSON.stringify({ tasks: [data.root, { id: "malformed-department" }] }));
    assert.equal(readLoopTaskStoreResult(file, true, true).ok, false);
    assert.equal(readLoopTaskStore(file).tasks.length, 1); // Legacy tolerant read remains compatible.
    assert.equal(readLoopTaskStoreResult(path.join(directory, "missing.json"), true, true).ok, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("indexed fresh record reads never enumerate, detect unexpected same-file changes and reject removed sources", () => {
  const h = diskSource();
  try {
    const port = { readTaskRecord: h.index.readTaskRecord, readLeaderTaskIds: h.index.readDepartmentLeaderTaskIds };
    for (let i = 0; i < 15; i++) {
      const root = h.index.readTaskRecord(h.root.id)!; const leader = h.index.readTaskRecord(h.leader.id)!;
      assert.equal(authorizeDepartmentLeader(root, leader, port, port.readLeaderTaskIds), true);
      assert.equal(buildDepartmentGroupChatProjection(root, port)!.leaders.length, 2);
    }
    assert.equal(h.scans(), 1);
    const raw = JSON.parse(fs.readFileSync(h.root.taskStoreFile, "utf8"));
    raw.tasks.push({ ...raw.tasks[1], id: "external-copy" });
    fs.writeFileSync(h.root.taskStoreFile, JSON.stringify(raw));
    assert.equal(h.index.readTaskRecord(h.leader.id), null); assert.equal(h.index.state, "invalid");
    assert.equal(h.index.rebuild(), true);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A")!.length, 2);
    fs.unlinkSync(h.root.taskStoreFile);
    assert.equal(h.index.readTaskRecord(h.root.id), null); assert.equal(h.index.state, "invalid");
  } finally { h.cleanup(); }
});

test("partially failed real migration cannot publish a successful identity or keep authorization available", () => {
  const h = diskSource();
  const fsModule = require("node:fs") as typeof import("node:fs");
  const originalUnlink = fsModule.unlinkSync;
  try {
    // Move root/other out first so source contains just this leader and deletion is required.
    const leaderFile = path.join(h.directory, "leader.json");
    assert.ok(updateLoopTaskRecord(h.leader.id, { taskStoreFile: leaderFile }));
    const target = path.join(h.directory, "target.json");
    fsModule.unlinkSync = ((file: fs.PathLike) => {
      if (String(file) === leaderFile) throw Error("simulated delete failure");
      return originalUnlink(file);
    }) as typeof fs.unlinkSync;
    assert.equal(updateLoopTaskRecord(h.leader.id, { taskStoreFile: target }), null);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null);
    assert.equal(fs.existsSync(leaderFile), true); assert.equal(fs.existsSync(target), true);
    assert.equal(h.index.rebuild(), true);
    assert.equal(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), null); // Same identity in two physical files.
    fsModule.unlinkSync = originalUnlink;
    assert.equal(deleteLoopTaskStoreFile(target), true);
    assert.deepEqual(h.index.readDepartmentLeaderTaskIds(h.root.id, "module-A"), [h.leader.id]);
  } finally { fsModule.unlinkSync = originalUnlink; h.cleanup(); }
});
