import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLoopAutoSleepProtocolLines,
  LOOP_AUTO_SLEEP_REASON_MAX_LENGTH,
  LOOP_AUTO_WAKE_MAX_SECONDS,
  LOOP_AUTO_WAKE_MIN_SECONDS,
  LoopAutoWakeScheduler,
  normalizeLoopSleepDecision,
  normalizeLoopWakeAfterSeconds,
  resolveLoopAutoWakeAt,
  type LoopAutoWakeTask,
} from "../loopAutoWake";

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

test("describes automatic sleep as a shared parsed-task decision capability", () => {
  const protocol = buildLoopAutoSleepProtocolLines().join("\n");

  assert.match(protocol, /通用等待能力/u);
  assert.match(protocol, /不是 Loop 主任务专属/u);
  assert.match(protocol, /任何负责返回本 JSON 决策协议的任务/u);
  assert.match(protocol, /普通自由文本回复不会触发自动睡眠/u);
});

test("normalizes the Loop automatic-sleep JSON boundary", () => {
  assert.equal(normalizeLoopWakeAfterSeconds(LOOP_AUTO_WAKE_MIN_SECONDS), LOOP_AUTO_WAKE_MIN_SECONDS);
  assert.equal(normalizeLoopWakeAfterSeconds(LOOP_AUTO_WAKE_MAX_SECONDS), LOOP_AUTO_WAKE_MAX_SECONDS);
  assert.equal(normalizeLoopWakeAfterSeconds(LOOP_AUTO_WAKE_MIN_SECONDS - 1), null);
  assert.equal(normalizeLoopWakeAfterSeconds(LOOP_AUTO_WAKE_MAX_SECONDS + 1), null);
  assert.equal(normalizeLoopWakeAfterSeconds(10.5), null);
  assert.equal(normalizeLoopWakeAfterSeconds("10"), null);
  assert.equal(normalizeLoopWakeAfterSeconds(Number.POSITIVE_INFINITY), null);

  assert.deepEqual(normalizeLoopSleepDecision({
    status: "sleep",
    wakeAfterSeconds: 3600,
    sleepReason: "  wait for the external build  ",
  }), {
    status: "sleep",
    wakeAfterSeconds: 3600,
    sleepReason: "wait for the external build",
  });
  assert.equal(normalizeLoopSleepDecision({ status: "sleep", wakeAfterSeconds: 3600, sleepReason: "" }), null);
  assert.equal(normalizeLoopSleepDecision({
    status: "sleep",
    wakeAfterSeconds: 3600,
    sleepReason: "x".repeat(LOOP_AUTO_SLEEP_REASON_MAX_LENGTH + 1),
  }), null);
  assert.equal(normalizeLoopSleepDecision({ status: "continue", wakeAfterSeconds: 3600, sleepReason: "wait" }), null);
  assert.equal(resolveLoopAutoWakeAt(1_000, 60), 61_000);
});

test("chunks long wake delays and starts the task only when the persisted wake time is due", async () => {
  let now = 1_000;
  const task: LoopAutoWakeTask = { id: "task-long", status: "sleeping", autoWakeAt: 4_500 };
  const fake = createFakeTimers();
  const wakeCalls: string[] = [];
  const scheduler = new LoopAutoWakeScheduler({
    readTask: () => task,
    onWake: (taskId) => {
      wakeCalls.push(taskId);
      return "started";
    },
    now: () => now,
    setTimeout: fake.setTimeout,
    clearTimeout: fake.clearTimeout,
    maxTimerDelayMs: 1_000,
  });

  scheduler.schedule(task);
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
  assert.deepEqual(wakeCalls, ["task-long"]);
  assert.equal(fake.nextActive(), undefined);
  scheduler.dispose();
});

test("retries a due wake attempt and discards canceled or stale sleeping tasks", async () => {
  let now = 5_000;
  let task: LoopAutoWakeTask = { id: "task-retry", status: "sleeping", autoWakeAt: now };
  const fake = createFakeTimers();
  let attempts = 0;
  const scheduler = new LoopAutoWakeScheduler({
    readTask: () => task,
    onWake: () => {
      attempts += 1;
      return "retry";
    },
    now: () => now,
    setTimeout: fake.setTimeout,
    clearTimeout: fake.clearTimeout,
    retryDelayMs: 750,
  });

  scheduler.restore([task, { id: "not-sleeping", status: "running", autoWakeAt: now }]);
  const dueTimer = fake.nextActive();
  assert.ok(dueTimer);
  assert.equal(dueTimer.delayMs, 0);
  await fake.fire(dueTimer);
  assert.equal(attempts, 1);
  assert.equal(fake.nextActive()?.delayMs, 750);

  scheduler.cancel(task.id);
  assert.equal(fake.nextActive(), undefined);
  task = { ...task, status: "stopped" };
  scheduler.schedule(task);
  assert.equal(fake.nextActive(), undefined);
  scheduler.dispose();
});
