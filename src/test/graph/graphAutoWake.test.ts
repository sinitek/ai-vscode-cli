import test = require("node:test");
import assert = require("node:assert/strict");

import {
  GraphAutoWakeScheduler,
  isGraphAutoWakeRunScheduled,
  resolveGraphRunAutoWakeAt,
  type GraphAutoWakeAttemptResult,
} from "../../graph/graphAutoWake";
import type { GraphNodeRecord, GraphRunRecord } from "../../graph/types";

type FakeTimer = {
  handle: ReturnType<typeof setTimeout>;
  callback: () => void;
  delayMs: number;
  cleared: boolean;
};

function createFakeTimers() {
  let sequence = 0;
  const timers: FakeTimer[] = [];
  return {
    timers,
    setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
      sequence += 1;
      const handle = { id: sequence } as unknown as ReturnType<typeof setTimeout>;
      timers.push({ handle, callback, delayMs, cleared: false });
      return handle;
    },
    clearTimeout(handle: ReturnType<typeof setTimeout>): void {
      const timer = timers.find((item) => item.handle === handle);
      if (timer) {
        timer.cleared = true;
      }
    },
    nextActive(): FakeTimer | undefined {
      return timers.find((item) => !item.cleared);
    },
    async fire(timer: FakeTimer): Promise<void> {
      timer.cleared = true;
      timer.callback();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

function createSleepNode(wakeAt: number, overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "sleep",
    title: "Wait",
    kind: "sleep",
    status: "sleeping",
    ownerRole: "system",
    attempts: 0,
    maxAttempts: 1,
    dependsOn: [],
    unlocks: [],
    wakeAt,
    ...overrides,
  };
}

function createRun(overrides: Partial<GraphRunRecord> = {}): GraphRunRecord {
  return {
    id: "graph-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Wait and resume",
    status: "sleeping",
    createdAt: 1_000,
    updatedAt: 1_000,
    graphVersion: 1,
    runStoreFile: "/tmp/graph-runs.json",
    nodes: [createSleepNode(4_500)],
    edges: [],
    activeNodeIds: [],
    maxConcurrent: 1,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
    ...overrides,
  };
}

test("resolves the earliest sleeping Graph wakeAt and ignores non-sleeping runs", () => {
  const run = createRun({
    nodes: [
      createSleepNode(8_000, { id: "later" }),
      createSleepNode(4_000, { id: "earlier" }),
    ],
  });

  assert.equal(resolveGraphRunAutoWakeAt(run), 4_000);
  assert.equal(isGraphAutoWakeRunScheduled(run), true);
  assert.equal(resolveGraphRunAutoWakeAt({ ...run, status: "running" }), null);
  assert.equal(isGraphAutoWakeRunScheduled({ ...run, status: "completed" }), false);
});

test("chunks future Graph wake timers and starts only when wakeAt is due", async () => {
  let now = 1_000;
  const run = createRun({ id: "graph-long", nodes: [createSleepNode(4_500)] });
  const fake = createFakeTimers();
  const wakeCalls: string[] = [];
  const scheduler = new GraphAutoWakeScheduler({
    readRun: () => run,
    onWake: (graphRunId) => {
      wakeCalls.push(graphRunId);
      return "started";
    },
    now: () => now,
    setTimeout: fake.setTimeout,
    clearTimeout: fake.clearTimeout,
    maxTimerDelayMs: 1_000,
  });

  scheduler.schedule(run);
  assert.equal(fake.nextActive()?.delayMs, 1_000);

  now = 2_000;
  const firstTimer = fake.nextActive();
  assert.ok(firstTimer);
  await fake.fire(firstTimer);
  assert.equal(wakeCalls.length, 0);
  assert.equal(fake.nextActive()?.delayMs, 1_000);

  now = 4_500;
  const secondTimer = fake.nextActive();
  assert.ok(secondTimer);
  await fake.fire(secondTimer);
  assert.deepEqual(wakeCalls, ["graph-long"]);
  assert.equal(fake.nextActive(), undefined);
  scheduler.dispose();
});

test("retries due Graph wake attempts and discards stale runs", async () => {
  let now = 5_000;
  let run = createRun({ id: "graph-retry", nodes: [createSleepNode(now)] });
  const fake = createFakeTimers();
  const results: GraphAutoWakeAttemptResult[] = ["retry", "started"];
  const scheduler = new GraphAutoWakeScheduler({
    readRun: () => run,
    onWake: () => results.shift() ?? "started",
    now: () => now,
    setTimeout: fake.setTimeout,
    clearTimeout: fake.clearTimeout,
    retryDelayMs: 750,
  });

  scheduler.restore([run, createRun({ id: "not-sleeping", status: "running" })]);
  const dueTimer = fake.nextActive();
  assert.ok(dueTimer);
  assert.equal(dueTimer.delayMs, 0);
  await fake.fire(dueTimer);
  assert.equal(fake.nextActive()?.delayMs, 750);

  run = { ...run, status: "stopped" };
  const retryTimer = fake.nextActive();
  assert.ok(retryTimer);
  await fake.fire(retryTimer);
  assert.equal(fake.nextActive(), undefined);
  scheduler.dispose();
});
