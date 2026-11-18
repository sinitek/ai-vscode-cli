import test = require("node:test");
import assert = require("node:assert/strict");
import { setTimeout as delay } from "node:timers/promises";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";

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
  const review = queue.runMain("main", async () => { calls.push("review"); });
  const second = queue.runQuestion("main", { canRun: () => idle }, async () => { calls.push("second"); return 2; });
  await delay(5);
  assert.deepEqual(calls, []);
  idle = true;
  await delay(5);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  await review;
  assert.deepEqual(calls, ["first", "review", "second"]);
});

test("main work and questions share arrival order without preempting the active answer", async () => {
  const queue = createLoopMainQuestionQueue();
  const active = deferred();
  const calls: string[] = [];
  const first = queue.runQuestion("main", { canRun: () => true }, async () => {
    calls.push("answer-1");
    await active.promise;
    calls.push("answer-1-done");
  });
  const review = queue.runMain("main", async () => { calls.push("review"); });
  const second = queue.runQuestion("main", { canRun: () => true }, async () => { calls.push("answer-2"); });
  const supplement = queue.runMain("main", async () => { calls.push("supplement"); });
  assert.deepEqual(calls, ["answer-1"]);
  active.resolve();
  await Promise.all([first, second, review, supplement]);
  assert.deepEqual(calls, ["answer-1", "answer-1-done", "review", "answer-2", "supplement"]);
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
  const main = queue.runMain("main", async () => { calls += 1; });
  assert.equal(calls, 0);
  aborted = true;
  await delay(5);
  assert.equal(await question, undefined);
  await main;
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
