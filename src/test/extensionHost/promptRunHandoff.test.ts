import test = require("node:test");
import assert = require("node:assert/strict");
import { PromptRunHandoff } from "../../extensionHost/promptRunHandoff";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("pause waits for the stopped invocation and native confirmation", async () => {
  const handoff = new PromptRunHandoff();
  const finish = signal();
  const nativeStopped = signal();
  let cancelled = () => false;
  const running = handoff.run("tab", async (isAborted) => {
    cancelled = isAborted;
    await finish.promise;
  });
  let active = true;
  const pausing = handoff.pause("tab", () => { active = false; }, () => true, () => nativeStopped.promise);
  assert.equal(active, false);
  assert.equal(cancelled(), true);
  await tick();
  await assert.rejects(handoff.run("tab", async () => assert.fail("must not start")), /正在等待/);
  let peerRan = false;
  await handoff.run("peer", async () => { peerRan = true; });
  assert.equal(peerRan, true);
  finish.resolve();
  await running;
  nativeStopped.resolve();
  await pausing;
});

test("timeout cannot send late and a later pause can recover", async () => {
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

test("target changes and native stop failures reject replacement", async () => {
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
