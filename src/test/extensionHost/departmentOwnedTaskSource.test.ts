import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "department-source-home-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
const { DepartmentOwnedTaskSource } = require("../../extensionHost/departmentOwnedTaskSource") as typeof import("../../extensionHost/departmentOwnedTaskSource");
const { DepartmentOwnershipIndex } = require("../../extensionHost/departmentOwnershipIndex") as typeof import("../../extensionHost/departmentOwnershipIndex");
const { deleteLoopTaskStoreFile, tryWriteLoopTaskStore } = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { departmentRecords } = require("../loop/departmentGroupChatHost.fixture") as typeof import("../loop/departmentGroupChatHost.fixture");

test.after(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
});

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "department-source-"));
  const root = path.join(parent, "owned");
  const source = DepartmentOwnedTaskSource.register("department-test", root);
  return { parent, root: source.descriptor.root, source, cleanup: () => { source.dispose(); fs.rmSync(parent, { recursive: true, force: true }); } };
}

test("atomic owner claim is exclusive across source instances and stale markers are never stolen", () => {
  const h = fixture();
  try {
    const first = h.source.claim();
    assert.ok(first);
    const second = DepartmentOwnedTaskSource.register("department-test", h.root);
    try {
      assert.equal(second.claim(), null);
      assert.equal(h.source.prepareRebuild(), true);
      assert.equal(h.source.lifecycle.isCurrent(), true);
      assert.equal(h.source.release(first), true);
      assert.ok(second.claim());
    } finally { second.dispose(); }
  } finally { h.cleanup(); }
});

test("persistent source marker cannot be rebound to a different source id", () => {
  const h = fixture();
  h.source.dispose();
  try {
    assert.throws(() => DepartmentOwnedTaskSource.register("another-department", h.root), /identity mismatch/);
    assert.equal(fs.readFileSync(path.join(h.root, ".department-source.json"), "utf8"), JSON.stringify({ version: 1, sourceId: "department-test" }));
  } finally { fs.rmSync(h.parent, { recursive: true, force: true }); }
});

test("registration rejects marker symlinks and special files before reading identity", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "department-marker-type-"));
  try {
    const linkedRoot = path.join(parent, "linked");
    fs.mkdirSync(linkedRoot);
    const ordinary = path.join(parent, "ordinary.json");
    fs.writeFileSync(ordinary, JSON.stringify({ version: 1, sourceId: "department-test" }));
    fs.symlinkSync(ordinary, path.join(linkedRoot, ".department-source.json"));
    assert.throws(() => DepartmentOwnedTaskSource.register("department-test", linkedRoot), /Invalid department source marker/);
    if (process.platform !== "win32") {
      const specialRoot = path.join(parent, "special");
      fs.mkdirSync(specialRoot);
      const mkfifo = spawnSync("mkfifo", [path.join(specialRoot, ".department-source.json")]);
      if (mkfifo.status === 0) assert.throws(() => DepartmentOwnedTaskSource.register("department-test", specialRoot), /Invalid department source marker/);
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("two real Node processes racing cannot claim one registered root", async () => {
  const h = fixture();
  try {
    const modulePath = require.resolve("../../extensionHost/departmentOwnedTaskSource");
    const script = `const {DepartmentOwnedTaskSource}=require(${JSON.stringify(modulePath)}); const s=DepartmentOwnedTaskSource.register('department-test',process.argv[1]); process.stdout.write(s.claim()?'claimed':'busy');`;
    const run = () => new Promise<string>((resolve, reject) => {
      const child = require("node:child_process").spawn(process.execPath, ["-e", script, h.root], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => output += chunk.toString());
      child.once("error", reject);
      child.once("close", (code: number) => code === 0 ? resolve(output) : reject(new Error(`child exited ${code}`)));
    });
    assert.deepEqual((await Promise.all([run(), run()])).sort(), ["busy", "claimed"]);
  } finally { h.cleanup(); }
});

test("owner transactions reject foreign paths and publish only after revocation", () => {
  const h = fixture();
  try {
    const owner = h.source.claim();
    assert.ok(owner);
    assert.equal(h.source.prepareRebuild(), true);
    let invalidated = 0;
    h.source.lifecycle.subscribe(() => { invalidated++; });
    const fixtureTask = [...departmentRecords().records.values()][0];
    const task = { ...fixtureTask, createdAt: Date.now(), updatedAt: Date.now(), taskStoreFile: path.join(h.root, "tasks.json") };
    assert.equal(h.source.transact(owner, new Map([[path.join(h.parent, "outside.json"), [task]]])), false);
    assert.equal(fs.existsSync(path.join(h.root, "tasks.json")), false);
    assert.ok(invalidated > 0);
    assert.equal(h.source.recover(owner), true);
    assert.equal(h.source.prepareRebuild(), true);
    const legacyStatus = { ...task, status: "sleeping" as never };
    assert.equal(h.source.transact(owner, new Map([[task.taskStoreFile, [legacyStatus]]])), true);
    assert.equal(h.source.readFile(task.taskStoreFile)?.[0].status, "needs-review");
    assert.equal(fs.readdirSync(h.root).some((name) => name.endsWith(".recovery")), false);
    const changed = { ...task, currentRound: task.currentRound + 1 };
    assert.equal(h.source.transact(owner, new Map([[task.taskStoreFile, [changed]]])), true);
    assert.equal(h.source.lifecycle.isCurrent(), true);
    assert.equal(h.source.readFile(task.taskStoreFile)?.[0].currentRound, changed.currentRound);
  } finally { h.cleanup(); }
});

test("invalid task records fail the complete read and keep the ownership index unavailable", () => {
  const h = fixture();
  try {
    const owner = h.source.claim();
    assert.ok(owner);
    assert.equal(h.source.prepareRebuild(), true);
    const file = path.join(h.root, "mixed.json");
    const valid = [...departmentRecords().records.values()][0];
    fs.writeFileSync(file, JSON.stringify({ tasks: [valid, { id: "broken" }] }));
    assert.equal(h.source.readFile(file), null);
    const index = new DepartmentOwnershipIndex(h.source);
    assert.equal(index.rebuild(), false);
    assert.equal(index.state, "invalid");
    index.dispose();
  } finally { h.cleanup(); }
});

test("complete enumeration rejects symlinks and matching special files", () => {
  const h = fixture();
  try {
    const owner = h.source.claim();
    assert.ok(owner);
    assert.equal(h.source.prepareRebuild(), true);
    fs.writeFileSync(path.join(h.root, "valid.json"), JSON.stringify({ tasks: [] }));
    assert.deepEqual(h.source.listFiles(), [path.join(h.source.descriptor.root, "valid.json")]);
    fs.symlinkSync(path.join(h.root, "valid.json"), path.join(h.root, "linked.json"));
    assert.throws(() => h.source.listFiles());
    if (process.platform !== "win32") {
      fs.unlinkSync(path.join(h.root, "linked.json"));
      const mkfifo = spawnSync("mkfifo", [path.join(h.root, "pipe.json")]);
      if (mkfifo.status === 0) assert.throws(() => h.source.listFiles());
    }
  } finally { h.cleanup(); }
});

test("complete enumeration fails closed on unreadable roots and entries disappearing during lstat", () => {
  const h = fixture();
  const mutableFs = fs as unknown as { readdirSync: typeof fs.readdirSync; lstatSync: typeof fs.lstatSync };
  const originalReaddir = mutableFs.readdirSync;
  const originalLstat = mutableFs.lstatSync;
  try {
    const owner = h.source.claim();
    assert.ok(owner);
    assert.equal(h.source.prepareRebuild(), true);
    const file = path.join(h.root, "moving.json");
    fs.writeFileSync(file, JSON.stringify({ tasks: [] }));
    mutableFs.readdirSync = ((target: fs.PathLike, options?: unknown) => {
      if (String(target) === h.root) throw new Error("directory unreadable");
      return (originalReaddir as (path: fs.PathLike, options?: unknown) => unknown)(target, options) as ReturnType<typeof fs.readdirSync>;
    }) as typeof fs.readdirSync;
    assert.throws(() => h.source.listFiles());
    mutableFs.readdirSync = originalReaddir;
    mutableFs.lstatSync = ((target: fs.PathLike, options?: unknown) => {
      if (String(target) === file) { const error = new Error("entry vanished") as NodeJS.ErrnoException; error.code = "ENOENT"; throw error; }
      return (originalLstat as (path: fs.PathLike, options?: unknown) => unknown)(target, options) as ReturnType<typeof fs.lstatSync>;
    }) as typeof fs.lstatSync;
    assert.throws(() => h.source.listFiles());
  } finally {
    mutableFs.readdirSync = originalReaddir;
    mutableFs.lstatSync = originalLstat;
    h.cleanup();
  }
});

test("ordinary writes reject registered roots and ordinary storage remains compatible", () => {
  const h = fixture();
  try {
    const file = path.join(h.root, "owned.json");
    assert.equal(tryWriteLoopTaskStore(file, { tasks: [] }), false);
    assert.equal(deleteLoopTaskStoreFile(file), false);
    assert.equal(fs.existsSync(file), false);
    const storeModule = require.resolve("../../loopTaskStore");
    const child = spawnSync(process.execPath, ["-e", `const s=require(${JSON.stringify(storeModule)}); process.stdout.write(String(s.tryWriteLoopTaskStore(process.argv[1],{tasks:[]})))`, file], { encoding: "utf8" });
    assert.equal(child.status, 0);
    assert.equal(child.stdout, "false");
    const ordinary = path.join(h.parent, "ordinary", "loop-tasks.json");
    assert.equal(tryWriteLoopTaskStore(ordinary, { tasks: [] }), true);
    assert.equal(deleteLoopTaskStoreFile(ordinary), true);
    fs.unlinkSync(path.join(h.root, ".department-source.json"));
    fs.symlinkSync(ordinary, path.join(h.root, ".department-source.json"));
    assert.equal(tryWriteLoopTaskStore(file, { tasks: [] }), false);
    assert.equal(fs.existsSync(file), false);
  } finally { h.cleanup(); }
});

test("ordinary writes reject a final symlink into a controlled root but allow directory aliases", () => {
  const h = fixture();
  try {
    const controlledTarget = path.join(h.root, "target.json");
    fs.writeFileSync(controlledTarget, JSON.stringify({ tasks: [{ id: "unchanged" }] }));
    const linkDir = path.join(h.parent, "links");
    fs.mkdirSync(linkDir);
    const fileLink = path.join(linkDir, "linked.json");
    fs.symlinkSync(controlledTarget, fileLink);
    assert.equal(tryWriteLoopTaskStore(fileLink, { tasks: [] }), false);
    assert.equal(fs.readFileSync(controlledTarget, "utf8"), JSON.stringify({ tasks: [{ id: "unchanged" }] }));

    const ordinaryDir = path.join(h.parent, "ordinary");
    const ordinaryAlias = path.join(h.parent, "ordinary-alias");
    fs.mkdirSync(ordinaryDir);
    fs.symlinkSync(ordinaryDir, ordinaryAlias, "dir");
    const compatibleFile = path.join(ordinaryAlias, "loop-tasks.json");
    assert.equal(tryWriteLoopTaskStore(compatibleFile, { tasks: [] }), true);
    assert.equal(fs.readFileSync(path.join(ordinaryDir, "loop-tasks.json"), "utf8"), JSON.stringify({ tasks: [] }, null, 2));
  } finally { h.cleanup(); }
});

test("partial publication keeps recovery evidence until explicit recovery and rebuild", () => {
  const h = fixture();
  const mutableFs = fs as unknown as { renameSync: typeof fs.renameSync };
  const originalRename = mutableFs.renameSync;
  try {
    const owner = h.source.claim();
    assert.ok(owner);
    assert.equal(h.source.prepareRebuild(), true);
    const firstFile = path.join(h.root, "a.json");
    const secondFile = path.join(h.root, "b.json");
    fs.writeFileSync(firstFile, JSON.stringify({ tasks: [] }));
    const task = [...departmentRecords().records.values()][0];
    const next = { ...task, createdAt: Date.now(), updatedAt: Date.now(), taskStoreFile: firstFile };
    let calls = 0;
    mutableFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
      calls++;
      if (calls === 2) throw new Error("simulated publication failure");
      return originalRename(from, to);
    }) as typeof fs.renameSync;
    assert.equal(h.source.transact(owner, new Map([[firstFile, [next]], [secondFile, []]])), false);
    assert.equal(h.source.lifecycle.isCurrent(), false);
    assert.equal(fs.readdirSync(h.root).some((name) => name.endsWith(".recovery")), true);
    assert.equal(h.source.prepareRebuild(), false);
    mutableFs.renameSync = originalRename;
    assert.equal(h.source.recover(owner), true);
    assert.equal(fs.readdirSync(h.root).some((name) => name.includes(owner.token) && (name.endsWith(".stage") || name.endsWith(".restore"))), false);
    assert.equal(h.source.prepareRebuild(), true);
    const retry = { ...next, currentRound: next.currentRound + 1 };
    assert.equal(h.source.transact(owner, new Map([[firstFile, [retry]]])), true);
    assert.equal(h.source.readFile(firstFile)?.[0].currentRound, retry.currentRound);
  } finally { mutableFs.renameSync = originalRename; h.cleanup(); }
});
