import test = require("node:test");
import assert = require("node:assert/strict");
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createProcessTerminationController } from "../../cli/processTermination";
import { observeChildProcessLifecycle } from "../../cli/processLifecycle";

function fixture(platform: NodeJS.Platform = "linux", pid: number | undefined = 314159) {
  const groupSignals: Array<[number, NodeJS.Signals | number]> = [];
  const childSignals: Array<NodeJS.Signals | number | undefined> = [];
  const taskkills: number[] = [];
  let now = 0, created = 0, unrefs = 0;
  let groupFails = false, childFails = false, childResult = true;
  const timers = new Map<NodeJS.Timeout, { callback: () => void; due: number }>();
  const callbacks: Array<() => void> = [];
  const child = Object.assign(new EventEmitter(), {
    pid: pid as number | undefined, killed: false,
    stdin: null, stdout: null, stderr: null,
    kill: (signal?: NodeJS.Signals | number) => {
      childSignals.push(signal);
      if (childFails) throw new Error("child-signal-failed");
      return childResult;
    },
  });
  const controller = createProcessTerminationController(child as unknown as ChildProcess, {
    platform,
    signalProcess: (target, signal) => {
      groupSignals.push([target, signal]);
      if (groupFails) throw new Error("group-signal-failed");
    },
    taskkill: (target) => { taskkills.push(target); },
    setTimer: (callback, delay) => {
      assert.equal(delay, 2000);
      created += 1;
      callbacks.push(callback);
      const timer = { unref: () => { unrefs += 1; } } as unknown as NodeJS.Timeout;
      timers.set(timer, { callback, due: now + delay });
      return timer;
    },
    clearTimer: (timer) => { timers.delete(timer); },
  });
  return {
    child, controller, groupSignals, childSignals, taskkills, timers, callbacks,
    get created() { return created; },
    get unrefs() { return unrefs; },
    failGroup: () => { groupFails = true; },
    failChild: () => { childFails = true; },
    rejectChild: () => { childResult = false; },
    advance: (milliseconds: number) => {
      now += milliseconds;
      for (const [timer, entry] of timers) {
        if (entry.due > now) continue;
        timers.delete(timer);
        entry.callback();
      }
    },
  };
}

test("TERM followed by close cancels escalation, including an already queued callback", () => {
  const f = fixture();
  f.child.emit("spawn");
  assert.equal(f.controller.kill(), true);
  f.advance(100);
  f.child.emit("close", 0, null);
  assert.equal(f.timers.size, 0);
  f.advance(5000);
  f.callbacks[0]();
  assert.deepEqual(f.groupSignals, [[-314159, "SIGTERM"]]);
  assert.equal(f.controller.kill(), false);
  assert.equal(f.controller.kill("SIGKILL"), false);
  assert.deepEqual(f.childSignals, []);
  assert.equal(f.child.listenerCount("error"), 0);
  assert.equal(f.child.listenerCount("exit"), 0);
  assert.equal(f.child.listenerCount("spawn"), 0);
});

test("a child that remains running escalates exactly once even when child.killed is true", () => {
  const f = fixture();
  f.child.emit("spawn");
  f.child.killed = true; // A signal-request flag is not exit or drain evidence.
  f.controller.kill();
  f.advance(1999);
  assert.equal(f.groupSignals.length, 1);
  f.advance(1);
  f.advance(10000);
  f.controller.kill();
  f.controller.kill("SIGKILL");
  assert.deepEqual(f.groupSignals, [[-314159, "SIGTERM"], [-314159, "SIGKILL"]]);
  assert.equal(f.created, 1);
  assert.equal(f.unrefs, 1);
  assert.equal(f.timers.size, 0);
});

test("repeated TERM neither duplicates a request nor extends the original deadline", () => {
  const f = fixture();
  f.controller.kill();
  f.advance(1000);
  assert.equal(f.controller.kill("SIGTERM"), true);
  f.advance(1000);
  assert.equal(f.created, 1);
  assert.deepEqual(f.groupSignals, [[-314159, "SIGTERM"], [-314159, "SIGKILL"]]);
});

for (const signal of ["SIGKILL", 9] as const) {
  test(`explicit force ${signal} cancels pending escalation and stays idempotent`, () => {
    const f = fixture();
    f.controller.kill();
    assert.equal(f.controller.kill(signal), true);
    f.controller.kill(signal);
    f.controller.kill();
    assert.equal(f.timers.size, 0);
    f.advance(5000);
    f.callbacks[0]();
    assert.deepEqual(f.groupSignals, [[-314159, "SIGTERM"], [-314159, signal]]);
  });
}

test("force as the first request creates no escalation timer", () => {
  const f = fixture();
  f.controller.kill("SIGKILL");
  f.controller.kill();
  assert.deepEqual(f.groupSignals, [[-314159, "SIGKILL"]]);
  assert.equal(f.created, 0);
});

test("natural close before the first kill prevents all signal dispatch", () => {
  const f = fixture();
  f.child.emit("close", 0, null);
  assert.equal(f.controller.kill(), false);
  assert.equal(f.controller.kill("SIGINT"), false);
  assert.deepEqual(f.groupSignals, []);
  assert.equal(f.created, 0);
});

test("exit cancels stale identity signalling but cannot settle close/drain evidence", async () => {
  const f = fixture();
  const lifecycle = observeChildProcessLifecycle(f.child as unknown as ChildProcess);
  let settled = false;
  void lifecycle.then(() => { settled = true; });
  f.child.emit("spawn");
  f.controller.kill();
  f.child.emit("exit", 0, null);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.timers.size, 0);
  f.callbacks[0]();
  assert.equal(f.controller.kill("SIGKILL"), false);
  assert.deepEqual(f.groupSignals, [[-314159, "SIGTERM"]]);
  f.child.emit("close", 0, null);
  assert.equal((await lifecycle).processTerminal.status, "confirmed");
});

test("spawn failure without a PID never dispatches or schedules escalation", () => {
  const f = fixture("linux", 0);
  f.child.pid = undefined;
  f.child.emit("error", new Error("spawn ENOENT"));
  assert.equal(f.controller.kill(), false);
  assert.equal(f.controller.kill("SIGKILL"), false);
  f.child.emit("close", -2, null);
  assert.equal(f.controller.kill(), false);
  assert.deepEqual(f.groupSignals, []);
  assert.equal(f.created, 0);
  assert.equal(f.child.listenerCount("error"), 0);
});

test("a post-spawn error does not suppress the one necessary escalation", () => {
  const f = fixture();
  f.child.emit("spawn");
  f.controller.kill();
  f.child.emit("error", new Error("IPC write failed"));
  f.advance(2000);
  assert.deepEqual(f.groupSignals, [[-314159, "SIGTERM"], [-314159, "SIGKILL"]]);
});

test("POSIX group failure falls back to the same child for TERM and escalation", () => {
  const f = fixture();
  f.failGroup();
  f.controller.kill();
  f.advance(2000);
  assert.deepEqual(f.childSignals, ["SIGTERM", "SIGKILL"]);
  f.child.emit("close", 0, null);
  assert.equal(f.controller.kill(), false);
  assert.equal(f.childSignals.length, 2);
});

test("failed signal requests remain bounded and report failure without claiming cleanup", () => {
  const f = fixture();
  f.failGroup();
  f.failChild();
  assert.equal(f.controller.kill(), false);
  f.advance(10000);
  f.advance(10000);
  assert.equal(f.groupSignals.length, 2);
  assert.equal(f.childSignals.length, 2);
  assert.equal(f.created, 1);
  assert.equal(f.timers.size, 0);
});

test("a rejected child fallback reports false and is still eligible for bounded escalation", () => {
  const f = fixture();
  f.failGroup();
  f.rejectChild();
  assert.equal(f.controller.kill(), false);
  f.advance(2000);
  assert.deepEqual(f.childSignals, ["SIGTERM", "SIGKILL"]);
});

test("other supported signals retain POSIX group dispatch without creating timers", () => {
  const f = fixture();
  assert.equal(f.controller.kill("SIGINT"), true);
  assert.equal(f.controller.kill(0), true);
  assert.deepEqual(f.groupSignals, [[-314159, "SIGINT"], [-314159, 0]]);
  assert.equal(f.created, 0);
});

test("Windows requests one taskkill tree stop and never reuses a closed child's PID", () => {
  const f = fixture("win32");
  f.child.emit("spawn");
  assert.equal(f.controller.kill(), true);
  f.controller.kill();
  f.controller.kill("SIGKILL");
  assert.deepEqual(f.taskkills, [314159]);
  f.child.emit("close", 0, null);
  assert.equal(f.controller.kill(), false);
  assert.equal(f.controller.kill("SIGKILL"), false);
  f.advance(5000);
  assert.deepEqual(f.taskkills, [314159]);
  assert.deepEqual(f.groupSignals, []);
  assert.deepEqual(f.childSignals, []);
  assert.equal(f.created, 0);
});

test("Windows natural close before any stop prevents even the first taskkill", () => {
  const f = fixture("win32");
  f.child.emit("close", 0, null);
  assert.equal(f.controller.kill(), false);
  assert.deepEqual(f.taskkills, []);
});
