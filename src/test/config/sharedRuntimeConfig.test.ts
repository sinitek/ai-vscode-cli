import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { once } from "events";
import { SharedRuntimeConfig, ConfigSelectionChangedError, type SharedConfigSelection } from "../../config/sharedRuntimeConfig";

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-shared-config-"));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test("windows reject switched profiles but accept updated revisions of the same profile", async () => {
  await withDirectory(async (directory) => {
    const first = new SharedRuntimeConfig(directory);
    const second = new SharedRuntimeConfig(directory);
    const before = await first.change(async () => ({ configId: "before", profileDigest: "digest-before" }));
    assert.deepEqual(await second.read(), before);
    const after = await second.change(async () => ({ configId: "after", profileDigest: "digest-after" }));
    await assert.rejects(first.acquire(before), ConfigSelectionChangedError);
    assert.deepEqual(await first.read(), after);
    const sameProfileEdit = await second.change(async () => ({ configId: "after", profileDigest: "digest-edited" }));
    assert.notEqual(after.revision, sameProfileEdit.revision);
    const lease = await first.acquire(after);
    assert.deepEqual(lease.selection, sameProfileEdit);
    await lease.release();
  });
});

test("same-version executions coexist but live leases block switching and active-profile editing", async () => {
  await withDirectory(async (directory) => {
    const first = new SharedRuntimeConfig(directory);
    const second = new SharedRuntimeConfig(directory);
    const selected = await first.change(async () => ({ configId: "selected", profileDigest: "digest" }));
    const firstLease = await first.acquire(selected);
    const secondLease = await second.acquire(selected);
    try {
      assert.deepEqual(firstLease.selection, secondLease.selection);
      await assert.rejects(second.change(async () => ({ configId: "other", profileDigest: "other" })), /执行中的任务/);
      await assert.rejects(first.edit("selected", async () => assert.fail("must not edit"), async () => "other"), /执行中的任务/);
      await first.edit("inactive", async () => undefined, async () => "ignored");
      await firstLease.release();
      await assert.rejects(second.change(async () => ({ configId: "other", profileDigest: "other" })), /执行中的任务/);
    } finally {
      await Promise.all([firstLease.release(), secondLease.release()]);
    }
    await second.change(async () => ({ configId: "other", profileDigest: "other" }));
  });
});

test("partial writes invalidate execution until an explicit successful application", async () => {
  await withDirectory(async (directory) => {
    const shared = new SharedRuntimeConfig(directory);
    await shared.change(async () => ({ configId: "before", profileDigest: "before" }));
    await assert.rejects(shared.change(async () => { throw new Error("synthetic-write-failure"); }), /synthetic-write-failure/);
    const invalid = await shared.read();
    assert.equal(invalid?.ready, false);
    await assert.rejects(shared.acquire(invalid!), /上次配置应用未成功/);
    const restored = await shared.change(async () => ({ configId: "restored", profileDigest: "restored" }));
    const lease = await shared.acquire(restored);
    await lease.release();
    await fs.writeFile(path.join(directory, "selection.json"), "broken");
    await assert.rejects(shared.read(), /无法读取/);
  });
});

test("first-read migration runs once and independent native directories do not share ownership", async () => {
  await withDirectory(async (directory) => {
    const first = new SharedRuntimeConfig(path.join(directory, "one"));
    const second = new SharedRuntimeConfig(path.join(directory, "two"));
    const selected = (await first.read(async () => ({ configId: "initial", profileDigest: "initial" })))!;
    assert.equal((await first.read(async () => assert.fail("must not initialize twice")))?.configId, "initial");
    const lease = await first.acquire(selected);
    try {
      await second.change(async () => ({ configId: "independent", profileDigest: "independent" }));
      assert.equal((await first.read())?.configId, "initial");
    } finally { await lease.release(); }
  });
});

const workerSource = `
const { SharedRuntimeConfig } = require(process.argv[1]);
const fs = require("fs/promises");
const path = require("path");
const shared = new SharedRuntimeConfig(process.argv[2], 3000);
const leases = new Map();
process.on("message", async (message) => {
  try {
    let result;
    if (message.action === "change" || message.action === "hold") {
      result = await shared.change(async () => {
        if (message.action === "hold") {
          process.send({ id: message.id, holding: true });
          await new Promise(() => {});
        }
        await fs.writeFile(path.join(process.argv[2], "synthetic-runtime"), message.configId);
        return { configId: message.configId, profileDigest: message.configId };
      });
    } else if (message.action === "acquire") {
      const lease = await shared.acquire(message.expected);
      leases.set(message.id, lease);
      result = { ...lease.selection, leaseId: message.id };
    } else if (message.action === "release") {
      await leases.get(message.leaseId).release();
      result = true;
    } else result = await shared.read();
    process.send({ id: message.id, result });
  } catch (error) { process.send({ id: message.id, error: error.message }); }
});
`;

function createWorker(directory: string) {
  const child = spawn(process.execPath, ["-e", workerSource, require.resolve("../../config/sharedRuntimeConfig"), directory], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  child.on("message", (message: any) => {
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error));
    else callbacks.resolve(message.holding ? "holding" : message.result);
  });
  child.on("exit", () => {
    for (const callbacks of pending.values()) callbacks.reject(new Error("worker exited"));
    pending.clear();
  });
  return {
    request: (message: Record<string, unknown>): Promise<any> => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.send({ ...message, id });
    }),
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    },
  };
}

test("independent processes serialize writes, reject unseen selections and recover a crashed execution lease", { timeout: 15000 }, async () => {
  await withDirectory(async (directory) => {
    const first = createWorker(directory);
    const second = createWorker(directory);
    try {
      const before: SharedConfigSelection = await first.request({ action: "change", configId: "before" });
      const lease = await first.request({ action: "acquire", expected: before });
      await assert.rejects(second.request({ action: "change", configId: "blocked" }), /执行中的任务/);
      const concurrent = await second.request({ action: "acquire", expected: before });
      await second.request({ action: "release", leaseId: concurrent.leaseId });
      await first.stop();
      const after = await second.request({ action: "change", configId: "after" });
      assert.notEqual(after.revision, lease.revision);
      await assert.rejects(second.request({ action: "acquire", expected: before }), /本次任务未启动/);
      assert.equal(await fs.readFile(path.join(directory, "synthetic-runtime"), "utf8"), "after");
      const replacements = await Promise.all(["one", "two"].map((configId) => second.request({ action: "change", configId })));
      const committed = await second.request({ action: "read" });
      assert.ok(replacements.some((selection) => selection.revision === committed.revision));
      assert.equal(await fs.readFile(path.join(directory, "synthetic-runtime"), "utf8"), committed.configId);
    } finally { await Promise.all([first.stop(), second.stop()]); }
  });
});

test("a crashed configuration writer leaves execution invalid and its process lock can be recovered", { timeout: 15000 }, async () => {
  await withDirectory(async (directory) => {
    const writer = createWorker(directory);
    const survivor = new SharedRuntimeConfig(directory, 3000);
    try {
      assert.equal(await writer.request({ action: "hold" }), "holding");
      await writer.stop();
      assert.equal((await survivor.read())?.ready, false);
      await survivor.change(async () => ({ configId: "recovered", profileDigest: "recovered" }));
      assert.equal((await survivor.read())?.ready, true);
    } finally { await writer.stop(); }
  });
});

test("simultaneous configuration changes from independent processes publish one coherent final selection", { timeout: 15000 }, async () => {
  await withDirectory(async (directory) => {
    const first = createWorker(directory);
    const second = createWorker(directory);
    try {
      const replacements = await Promise.all([
        first.request({ action: "change", configId: "first-window" }),
        second.request({ action: "change", configId: "second-window" }),
      ]);
      const committed = await first.request({ action: "read" });
      assert.deepEqual(await second.request({ action: "read" }), committed);
      assert.ok(replacements.some((selection) => selection.revision === committed.revision));
      assert.equal(await fs.readFile(path.join(directory, "synthetic-runtime"), "utf8"), committed.configId);
    } finally { await Promise.all([first.stop(), second.stop()]); }
  });
});
