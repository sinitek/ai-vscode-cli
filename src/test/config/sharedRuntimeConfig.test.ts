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

function createSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("panel snapshots do not wait for a configuration writer or initialize again", async () => {
  await withDirectory(async (directory) => {
    const writer = new SharedRuntimeConfig(directory);
    const reader = new SharedRuntimeConfig(directory, 30);
    await writer.change(async () => ({ configId: "selected", profileDigest: "before" }));
    const entered = createSignal();
    const resume = createSignal();
    const changing = writer.change(async () => {
      entered.resolve();
      await resume.promise;
      return { configId: "selected", profileDigest: "after" };
    });
    await entered.promise;
    try {
      const snapshots = await Promise.all(Array.from({ length: 12 }, () => reader.read(async () => assert.fail("must not initialize again"))));
      assert.ok(snapshots.every((snapshot) => snapshot?.configId === "selected" && snapshot.ready === false));
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "selection.json"), "utf8")).leases, []);
    } finally {
      resume.resolve();
      await changing;
    }
    const selected = (await reader.read())!;
    assert.equal(selected.profileDigest, "after");
    const lease = await reader.acquire(selected);
    await lease.release();
  });
});

test("local configuration transactions queue instead of timing out behind each other", async () => {
  await withDirectory(async (directory) => {
    const first = new SharedRuntimeConfig(directory, 30);
    const second = new SharedRuntimeConfig(directory, 30);
    const entered = createSignal();
    const writing = first.change(async () => {
      entered.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return { configId: "first", profileDigest: "first" };
    });
    await entered.promise;
    const queued = second.change(async () => ({ configId: "second", profileDigest: "second" }));
    await Promise.all([writing, queued]);
    assert.equal((await second.read())?.configId, "second");
    await assert.rejects(first.change(async () => { throw new Error("write failed"); }), /write failed/);
    await second.change(async () => ({ configId: "recovered", profileDigest: "recovered" }));
    assert.equal((await first.read())?.ready, true);
  });
});

test("concurrent first reads initialize once and an absent read does not create coordination files", async () => {
  await withDirectory(async (directory) => {
    const location = path.join(directory, "missing");
    const first = new SharedRuntimeConfig(location, 30);
    const second = new SharedRuntimeConfig(location, 30);
    assert.equal(await first.read(), null);
    await assert.rejects(fs.access(location), { code: "ENOENT" });
    let initialized = 0;
    const initialize = async () => {
      initialized += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      return { configId: "initial", profileDigest: "initial" };
    };
    const snapshots = await Promise.all([first.read(initialize), second.read(initialize)]);
    assert.equal(initialized, 1);
    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.equal(snapshots[0]?.ready, true);
  });
});

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

test("continuation reuses a ready profile without rewriting its selection or clearing live leases", async () => {
  await withDirectory(async (directory) => {
    const first = new SharedRuntimeConfig(directory);
    const second = new SharedRuntimeConfig(directory);
    const selected = await first.change(async () => ({ configId: "selected", profileDigest: "digest" }));
    const lease = await first.acquire(selected);
    const before = await fs.readFile(path.join(directory, "selection.json"), "utf8");
    try {
      const reused = await second.change(async () => assert.fail("must not reapply"), { reuseConfigId: "selected" });
      assert.deepEqual(reused, selected);
      assert.equal(await fs.readFile(path.join(directory, "selection.json"), "utf8"), before);
      await assert.rejects(second.change(async () => assert.fail("must not switch"), { reuseConfigId: "other" }), /执行中的任务/);
      await assert.rejects(second.change(async () => assert.fail("must not force reapply")), /执行中的任务/);
    } finally {
      await lease.release();
    }
    const switched = await second.change(async () => ({ configId: "other", profileDigest: "other" }), { reuseConfigId: "other" });
    assert.equal(switched.configId, "other");
    assert.notEqual(switched.revision, selected.revision);
  });
});

test("continuation initializes missing selections and reapplies a profile whose last apply failed", async () => {
  await withDirectory(async (directory) => {
    const shared = new SharedRuntimeConfig(directory);
    const selected = await shared.change(async () => ({ configId: "selected", profileDigest: "digest" }), { reuseConfigId: "selected" });
    await assert.rejects(shared.change(async () => { throw new Error("apply failed"); }), /apply failed/);
    assert.equal((await shared.read())?.ready, false);
    let applies = 0;
    const restored = await shared.change(async () => {
      applies += 1;
      return { configId: "selected", profileDigest: "restored" };
    }, { reuseConfigId: "selected" });
    assert.equal(applies, 1);
    assert.equal(restored.ready, true);
    assert.equal(restored.profileDigest, "restored");
    assert.notEqual(restored.revision, selected.revision);
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
    if (message.action === "change" || message.action === "hold" || message.action === "ensure") {
      result = await shared.change(async () => {
        if (message.action === "hold") {
          process.send({ id: message.id, holding: true });
          await new Promise(() => {});
        }
        await fs.writeFile(path.join(process.argv[2], "synthetic-runtime"), message.configId);
        return { configId: message.configId, profileDigest: message.configId };
      }, { reuseConfigId: message.action === "ensure" ? message.configId : undefined });
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

test("a continuation in another process reuses the selected profile without dropping the running process lease", { timeout: 15000 }, async () => {
  await withDirectory(async (directory) => {
    const running = createWorker(directory);
    const continuing = createWorker(directory);
    try {
      const selected = await running.request({ action: "change", configId: "selected" });
      const lease = await running.request({ action: "acquire", expected: selected });
      assert.deepEqual(await continuing.request({ action: "ensure", configId: "selected" }), selected);
      assert.equal(await fs.readFile(path.join(directory, "synthetic-runtime"), "utf8"), "selected");
      await assert.rejects(continuing.request({ action: "ensure", configId: "other" }), /执行中的任务/);
      await assert.rejects(continuing.request({ action: "change", configId: "selected" }), /执行中的任务/);
      await running.request({ action: "release", leaseId: lease.leaseId });
      assert.equal((await continuing.request({ action: "ensure", configId: "other" })).configId, "other");
    } finally {
      await Promise.all([running.stop(), continuing.stop()]);
    }
  });
});

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
    const survivor = new SharedRuntimeConfig(directory, 300);
    try {
      assert.equal(await writer.request({ action: "hold" }), "holding");
      const snapshot = (await survivor.read())!;
      assert.equal(snapshot.ready, false);
      await assert.rejects(survivor.acquire(snapshot), /等待其他窗口配置操作超时/);
      await writer.stop();
      assert.equal((await survivor.read())?.ready, false);
      await assert.rejects(survivor.acquire(snapshot), /上次配置应用未成功/);
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
