import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DepartmentOwnedTaskSource } from "../../extensionHost/departmentOwnedTaskSource";
import { DepartmentOwnedSourceController } from "../../extensionHost/departmentOwnedSourceController";
import { departmentRecords } from "../loop/departmentGroupChatHost.fixture";

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "department-controller-"));
  const controller = DepartmentOwnedSourceController.create("department-controller-test", path.join(parent, "owned"), async () => undefined);
  assert.ok(controller);
  assert.equal(controller.ready, true);
  assert.equal(JSON.stringify(controller).includes("token"), false);
  return { parent, controller };
}

function taskAt(root: string) {
  const task = structuredClone([...departmentRecords().records.values()][0]);
  task.createdAt = Date.now();
  task.updatedAt = task.createdAt;
  task.taskStoreFile = path.join(root, "tasks.json");
  return task;
}

test("accepted commit drains before the required writer barrier, while late commits are rejected", async () => {
  let releaseBarrier!: () => void;
  let barrierStarted!: () => void;
  const started = new Promise<void>((resolve) => barrierStarted = resolve);
  const barrier = new Promise<void>((resolve) => releaseBarrier = resolve);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "department-controller-drain-"));
  const controller = DepartmentOwnedSourceController.create("department-controller-test", path.join(parent, "owned"), async () => { barrierStarted(); await barrier; });
  assert.ok(controller);
  try {
    const task = taskAt(controller.descriptor.root);
    const commit = controller.commit(new Map([[task.taskStoreFile, [task]]]));
    const close = controller.close();
    assert.equal(await controller.commit(new Map()), false);
    assert.equal(controller.ready, false);
    await started;
    assert.equal(await commit, true);
    assert.equal(controller.ready, false);
    assert.equal(controller.rebuild(), false);
    assert.equal(controller.ready, false);
    assert.equal(controller.readLeaderTaskIds(task.id, "module-A"), null);
    assert.equal(fs.existsSync(path.join(controller.descriptor.root, ".department-owner.json")), true);
    releaseBarrier();
    assert.equal(await close, true);
    assert.equal(fs.existsSync(path.join(controller.descriptor.root, ".department-owner.json")), false);
    const next = DepartmentOwnedSourceController.create("department-controller-test", controller.descriptor.root, async () => undefined);
    assert.ok(next);
    try {
      assert.equal(next.readTaskRecord(task.id)?.id, task.id);
      assert.deepEqual(next.readLeaderTaskIds(task.id, "module-A"), []);
    } finally { assert.equal(await next.close(), true); }
  } finally { releaseBarrier(); await controller.close(); fs.rmSync(parent, { recursive: true, force: true }); }
});

test("barrier failure keeps the source unavailable and durable owner marker blocks a new instance", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "department-controller-barrier-fail-"));
  const root = path.join(parent, "owned");
  const controller = DepartmentOwnedSourceController.create("department-controller-test", root, async () => { throw new Error("writer still active"); });
  assert.ok(controller);
  try {
    assert.equal(await controller.close(), false);
    assert.equal(controller.ready, false);
    assert.equal(fs.existsSync(path.join(root, ".department-owner.json")), true);
    assert.equal(DepartmentOwnedSourceController.create("department-controller-test", root, async () => undefined), null);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("successful close releases only after the barrier and permits a fresh controller claim", async () => {
  const h = fixture();
  try {
    assert.equal(await h.controller.close(), true);
    assert.equal(await h.controller.close(), true);
    const next = DepartmentOwnedSourceController.create("department-controller-test", h.controller.descriptor.root, async () => undefined);
    assert.ok(next);
    try { assert.equal(next.ready, true); }
    finally { assert.equal(await next.close(), true); }
  } finally { fs.rmSync(h.parent, { recursive: true, force: true }); }
});

test("failed commit stays invalid until explicit recovery and one complete index rebuild", async () => {
  const h = fixture();
  const mutableFs = fs as unknown as { renameSync: typeof fs.renameSync };
  const originalRename = mutableFs.renameSync;
  try {
    const first = taskAt(h.controller.descriptor.root);
    const secondFile = path.join(h.controller.descriptor.root, "second.json");
    let calls = 0;
    mutableFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
      calls++;
      if (calls === 2) throw new Error("publication failure");
      return originalRename(from, to);
    }) as typeof fs.renameSync;
    assert.equal(await h.controller.commit(new Map([[first.taskStoreFile, [first]], [secondFile, []]])), false);
    assert.equal(h.controller.ready, false);
    assert.equal(h.controller.rebuild(), false);
    assert.equal(fs.readdirSync(h.controller.descriptor.root).some((name) => name.endsWith(".recovery")), true);
    mutableFs.renameSync = originalRename;
    assert.equal(h.controller.recoverAndRebuild(), true);
    assert.equal(h.controller.ready, true);
    const retry = { ...first, currentRound: first.currentRound + 1 };
    assert.equal(await h.controller.commit(new Map([[first.taskStoreFile, [retry]]])), true);
    assert.equal(h.controller.readTaskRecord(first.id)?.currentRound, retry.currentRound);
  } finally { mutableFs.renameSync = originalRename; await h.controller.close(); fs.rmSync(h.parent, { recursive: true, force: true }); }
});

test("untrusted existing owner marker cannot be adopted by a controller", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "department-controller-unknown-"));
  const source = DepartmentOwnedTaskSource.register("department-controller-test", path.join(parent, "owned"));
  fs.writeFileSync(path.join(source.descriptor.root, ".department-owner.json"), JSON.stringify({ version: 1, sourceId: "department-controller-test", token: "unknown", revision: 1 }));
  try { assert.equal(DepartmentOwnedSourceController.create("department-controller-test", source.descriptor.root, async () => undefined), null); }
  finally { source.dispose(); fs.rmSync(parent, { recursive: true, force: true }); }
});

test("sync commit cannot overtake an admitted async operation and publishes readiness before returning", async () => {
  const h = fixture();
  try {
    const task = taskAt(h.controller.descriptor.root);
    const revision = h.controller.readRevision()!;
    const pending = h.controller.commit(new Map([[task.taskStoreFile, [task]]]));
    const blockedFile = path.join(h.controller.descriptor.root, "blocked.json");
    assert.equal(h.controller.commitSync(new Map([[blockedFile, []]])), false);
    assert.equal(fs.existsSync(blockedFile), false);
    assert.equal(await pending, true);
    assert.equal(h.controller.readRevision(), revision + 1);
    assert.equal(h.controller.commitSync(new Map([[task.taskStoreFile, [{ ...task, finalSummary: "同步提交" }]]])), true);
    assert.equal(h.controller.readRevision(), revision + 2);
    assert.equal(h.controller.readTaskRecord(task.id)?.finalSummary, "同步提交");
    assert.deepEqual(h.controller.readLeaderTaskIds(task.id, "module-A"), []);
    const closing = h.controller.close();
    assert.equal(h.controller.readRevision(), null);
    assert.equal(h.controller.commitSync(new Map()), false);
    assert.equal(await closing, true);
  } finally { await h.controller.close(); fs.rmSync(h.parent, { recursive: true, force: true }); }
});
