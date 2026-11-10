import test = require("node:test");
import assert = require("node:assert/strict");
import { setTimeout as delay } from "node:timers/promises";
import { createLoopMainQuestionQueue, hasPendingClassicLoopMainWork } from "../../loopMainQuestionQueue";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("busy questions wait for idle and retain FIFO order", async () => {
  const queue = createLoopMainQuestionQueue({ pollIntervalMs: 1 });
  const calls: string[] = [];
  let idle = false;
  const first = queue.runQuestion("main", { canRun: () => idle }, async () => { calls.push("first"); return 1; });
  const second = queue.runQuestion("main", { canRun: () => idle }, async () => { calls.push("second"); return 2; });
  await delay(5);
  assert.deepEqual(calls, []);
  idle = true;
  await delay(5);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(calls, ["first", "second"]);
});

test("acceptance and supplemental main work precede queued questions without preempting the active answer", async () => {
  const queue = createLoopMainQuestionQueue();
  const active = deferred();
  const calls: string[] = [];
  const first = queue.runQuestion("main", { canRun: () => true }, async () => {
    calls.push("answer-1");
    await active.promise;
    calls.push("answer-1-done");
  });
  const second = queue.runQuestion("main", { canRun: () => true }, async () => { calls.push("answer-2"); });
  const review = queue.runMain("main", async () => { calls.push("review"); });
  const supplement = queue.runMain("main", async () => { calls.push("supplement"); });
  assert.deepEqual(calls, ["answer-1"]);
  active.resolve();
  await Promise.all([first, second, review, supplement]);
  assert.deepEqual(calls, ["answer-1", "answer-1-done", "review", "supplement", "answer-2"]);
});

test("main preparation and question preparation hold the same session lock", async () => {
  const queue = createLoopMainQuestionQueue();
  const mainDone = deferred();
  let asking = false;
  const main = queue.runMain("main", () => mainDone.promise);
  const question = queue.runQuestion("main", { canRun: () => true }, async () => { asking = true; });
  assert.equal(asking, false);
  mainDone.resolve();
  await Promise.all([main, question]);
  assert.equal(asking, true);
});

test("cancelling a waiting question does not start it or stop unrelated main work", async () => {
  const queue = createLoopMainQuestionQueue({ pollIntervalMs: 1 });
  let aborted = false;
  let calls = 0;
  const question = queue.runQuestion("main", {
    canRun: () => false,
    isAborted: () => aborted,
  }, async () => { calls += 1; });
  aborted = true;
  await delay(5);
  assert.equal(await question, undefined);
  assert.equal(calls, 0);
  await queue.runMain("main", async () => { calls += 1; });
  assert.equal(calls, 1);
});

test("errors release the session and do not lose subsequent questions", async () => {
  const queue = createLoopMainQuestionQueue();
  const failed = queue.runQuestion("main", { canRun: () => true }, async () => { throw new Error("failed answer"); });
  const recovered = queue.runQuestion("main", { canRun: () => true }, async () => "next answer");
  await assert.rejects(failed, /failed answer/);
  assert.equal(await recovered, "next answer");
  const unavailable = queue.runQuestion("main", { canRun: () => { throw new Error("missing task"); } }, async () => "never");
  await assert.rejects(unavailable, /missing task/);
  assert.equal(await queue.runMain("main", async () => "reused"), "reused");
});

test("different main tabs progress independently", async () => {
  const queue = createLoopMainQuestionQueue({ pollIntervalMs: 1 });
  let aborted = false;
  const blocked = queue.runQuestion("first", { canRun: () => false, isAborted: () => aborted }, async () => "never");
  assert.equal(await queue.runQuestion("second", { canRun: () => true }, async () => "ready"), "ready");
  aborted = true;
  await delay(5);
  await blocked;
});

test("classic Loop reserves review gaps and unobserved supplemental requirements", () => {
  const base = { controllerActive: true, activeSubtaskCount: 1, requirementCount: 2, observedRequirementCount: 2 };
  assert.equal(hasPendingClassicLoopMainWork(base), false);
  assert.equal(hasPendingClassicLoopMainWork({ ...base, activeSubtaskCount: 0 }), true);
  assert.equal(hasPendingClassicLoopMainWork({ ...base, requirementCount: 3 }), true);
  assert.equal(hasPendingClassicLoopMainWork({ ...base, controllerActive: false, activeSubtaskCount: 0 }), false);
});
