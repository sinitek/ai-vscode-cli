import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PromptRunHandoff } from "../../extensionHost/promptRunHandoff";
import { SharedRuntimeConfig } from "../../config/sharedRuntimeConfig";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("pause waits for the stopped invocation, native confirmation and configuration lease release", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-pause-send-"));
  try {
    const handoff = new PromptRunHandoff();
    const config = new SharedRuntimeConfig(directory);
    const selected = await config.change(async () => ({ configId: "selected", profileDigest: "digest" }));
    const lease = handoff.trackLease("tab", await config.acquire(selected));
    const finish = signal();
    const nativeStopped = signal();
    let cancelled = () => false;
    const running = handoff.run("tab", async (isAborted) => {
      cancelled = isAborted;
      await finish.promise;
      // Model the asynchronous finally path after stopped was already published.
      await lease.release();
    });
    let active = true;
    let paused = false;
    const pausing = handoff.pause("tab", () => { active = false; }, () => true,
      () => nativeStopped.promise).then(() => { paused = true; });
    assert.equal(active, false);
    assert.equal(cancelled(), true);
    await tick();
    assert.equal(paused, false);
    await assert.rejects(handoff.run("tab", async () => assert.fail("must not start")), /正在等待/);
    await assert.rejects(config.change(async () => ({ configId: "other", profileDigest: null })), /执行中的任务/);
    let peerRan = false;
    await handoff.run("peer", async () => { peerRan = true; });
    assert.equal(peerRan, true);
    finish.resolve();
    await running;
    await tick();
    assert.equal(paused, false);
    nativeStopped.resolve();
    await pausing;
    const next = handoff.trackLease("tab", await config.acquire(selected));
    await handoff.run("tab", async () => { await next.release(); });
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, "selection.json"), "utf8")).leases.length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a failed completion release is retried and concurrent release attempts share one operation", async () => {
  const handoff = new PromptRunHandoff();
  let attempts = 0;
  const releaseGate = signal();
  const lease = handoff.trackLease("tab", {
    selection: { configId: "selected", revision: "r", profileDigest: null, ready: true },
    release: async () => {
      if (++attempts === 1) throw new Error("locked");
      await releaseGate.promise;
    },
  });
  await assert.rejects(lease.release(), /locked/);
  const retry = lease.release();
  const paused = handoff.pause("tab", () => undefined, () => true);
  await tick();
  assert.equal(attempts, 2);
  releaseGate.resolve();
  await Promise.all([retry, paused]);
  await lease.release();
  assert.equal(attempts, 2);
});

test("timeout cannot send late, duplicate pause is rejected and a later pause can recover", async () => {
  const handoff = new PromptRunHandoff(15);
  const finish = signal();
  const running = handoff.run("tab", async () => finish.promise);
  let starts = 0;
  const pause = handoff.pause("tab", () => undefined, () => true).then(() => { starts += 1; });
  await assert.rejects(handoff.pause("tab", () => undefined, () => true), /重复发送/);
  await assert.rejects(pause, /暂停超时/);
  finish.resolve();
  await running;
  await tick();
  assert.equal(starts, 0);
  await handoff.pause("tab", () => undefined, () => true);
});

test("target changes and native stop failures reject the replacement without starting it", async () => {
  const handoff = new PromptRunHandoff();
  let current = false;
  await assert.rejects(handoff.pause("tab", () => assert.fail("invalid target"), () => current), /会话已变化/);
  current = true;
  const finish = signal();
  const running = handoff.run("tab", async () => finish.promise);
  const pause = handoff.pause("tab", () => { current = false; finish.resolve(); }, () => current);
  await assert.rejects(pause, /会话已变化/);
  await running;
  current = true;
  await assert.rejects(handoff.pause("tab", () => undefined, () => current,
    async () => { throw new Error("native release unconfirmed"); }), /unconfirmed/);
});
