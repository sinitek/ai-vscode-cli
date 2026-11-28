import * as assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { configureLoopTaskLockHost, recordLoopTaskLockOwner, recoverExitedLoopTaskLock } from "../../loopTaskIdentityLockRecovery";

const execute = promisify(execFile);
const catalogModule = JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"));
const lockModule = JSON.stringify(require.resolve("../../loopTaskIdentityLockRecovery"));

test("持锁进程崩溃，多个宿主只回收一次，已提交任务能继续读取", async (context) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "group-chat-lock-"));
  context.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const env = { ...process.env, HOME: fixture, USERPROFILE: fixture };
  const directory = path.join(fixture, ".sinitek_cli", "loop-task-identities");
  const lock = path.join(directory, "transaction.lock");
  const crash = spawnSync(process.execPath, ["-e", `
    const catalog = require(${catalogModule});
    catalog.initializeLoopTaskLockRecovery('fixture-machine');
    catalog.commitLoopTaskIdentities(new Map(), () => process.kill(process.pid, 'SIGKILL'));
  `], { env, timeout: 10000 });
  assert.ifError(crash.error);
  const original = fs.readFileSync(lock, "utf8");
  assert.equal(JSON.parse(original).pid, crash.pid);
  const recover = `const recovery=require(${lockModule}); recovery.configureLoopTaskLockHost('fixture-machine');
    process.stdout.write(String(recovery.recoverExitedLoopTaskLock(process.argv[1])));`;
  const results = await Promise.all(Array.from({ length: 4 }, () => execute(process.execPath, ["-e", recover, lock], { env, timeout: 10000 })));
  assert.equal(results.filter((result) => result.stdout === "true").length, 1);
  assert.equal(fs.existsSync(lock), false);
  const file = path.join(fixture, "task");
  fs.writeFileSync(file, "original");
  const read = `const catalog=require(${catalogModule}); catalog.initializeLoopTaskLockRecovery('fixture-machine');
    process.stdout.write(String(catalog.readKnownOrdinaryLoopTaskIdentity('task', process.argv[1], file=>require('fs').readFileSync(file,'utf8'))));`;
  fs.writeFileSync(lock, original);
  assert.equal((await execute(process.execPath, ["-e", read, file], { env })).stdout, "original");
  fs.writeFileSync(path.join(directory, "catalog.json"), JSON.stringify({ version: 1, ready: false, roots: [], owned: {}, files: {} }));
  fs.writeFileSync(lock, original);
  assert.equal((await execute(process.execPath, ["-e", read, file], { env })).stdout, "null");
});

test("在用锁、旧锁、异机标记和无法证明归属的锁保留原文件", (context) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "group-chat-lock-owner-"));
  context.after(() => { configureLoopTaskLockHost(undefined); fs.rmSync(fixture, { recursive: true, force: true }); });
  const lock = path.join(fixture, "transaction.lock");
  configureLoopTaskLockHost("fixture-machine");
  const fd = fs.openSync(lock, "wx");
  try { recordLoopTaskLockOwner(fd); } finally { fs.closeSync(fd); }
  const live = fs.readFileSync(lock, "utf8");
  const marker = JSON.parse(live);
  for (const bytes of [live, "", "legacy", "{}", JSON.stringify({ ...marker, pid: -1 }), JSON.stringify({ ...marker, host: "foreign", pid: 2147483647 })]) {
    fs.writeFileSync(lock, bytes);
    assert.equal(recoverExitedLoopTaskLock(lock), false);
    assert.equal(fs.readFileSync(lock, "utf8"), bytes);
  }
});
