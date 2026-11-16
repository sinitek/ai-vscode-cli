import test = require("node:test");
import assert = require("node:assert/strict");
import { assertModeAvailable } from "../../modeAvailability";
import { resolveLoopTaskAtCreationBoundary } from "../../extensionHost/loopOrchestration";

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("classic Loop rechecks stale continuation and current mode after runner preparation", async () => {
  let modeEnabled = true;
  const records = new Map<string, { id: string; status: string }>([["resume", { id: "resume", status: "running" }]]);
  let creates = 0;
  let runnerStarts = 0;
  const waiting = deferred<void>();
  const release = deferred<void>();
  const start = async (): Promise<void> => {
    const entry = await resolveLoopTaskAtCreationBoundary({
      candidateId: "resume",
      prepareRunner: async () => { waiting.resolve(); await release.promise; },
      readTask: (id) => records.get(id) ?? null,
      isReusableContinuation: (task) => task.status === "running",
      allowFallbackCreation: true,
      assertNewTaskAvailable: () => assertModeAvailable("loop", { loopEnabled: modeEnabled }),
      createTask: () => { creates += 1; const task = { id: "new", status: "running" }; records.set(task.id, task); return task; },
    });
    if (entry.task) runnerStarts += 1;
  };

  const started = start();
  await waiting.promise;
  records.set("resume", { id: "resume", status: "stopped" });
  modeEnabled = false;
  release.resolve();
  await assert.rejects(started, /Loop已在工具设置中关闭，未启动任务/u);

  assert.equal(records.has("new"), false);
  assert.equal(creates, 0);
  assert.equal(runnerStarts, 0);
});

test("classic Loop keeps valid continuations and enabled fallback creation after runner preparation", async () => {
  const candidate = { id: "resume" };
  const records = new Map([[candidate.id, candidate]]);
  let modeEnabled = false;
  let creates = 0;
  const continuation = await resolveLoopTaskAtCreationBoundary({
    candidateId: candidate.id,
    prepareRunner: async () => undefined,
    readTask: (id) => records.get(id) ?? null,
    isReusableContinuation: () => true,
    allowFallbackCreation: true,
    assertNewTaskAvailable: () => assertModeAvailable("loop", { loopEnabled: modeEnabled }),
    createTask: () => { creates += 1; return { id: "unexpected" }; },
  });
  assert.equal(continuation.task, candidate);
  assert.equal(continuation.created, false);
  assert.equal(creates, 0);

  records.delete(candidate.id);
  modeEnabled = true;
  const fallback = await resolveLoopTaskAtCreationBoundary({
    candidateId: candidate.id,
    prepareRunner: async () => undefined,
    readTask: (id) => records.get(id) ?? null,
    isReusableContinuation: () => true,
    allowFallbackCreation: true,
    assertNewTaskAvailable: () => assertModeAvailable("loop", { loopEnabled: modeEnabled }),
    createTask: () => { creates += 1; return { id: "new" }; },
  });
  assert.equal(fallback.task?.id, "new");
  assert.equal(fallback.created, true);
  assert.equal(creates, 1);
});
