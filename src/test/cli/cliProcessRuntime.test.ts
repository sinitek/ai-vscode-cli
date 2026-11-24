import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import type { TestContext } from "node:test";
import {
  captureCliProcessOutput,
  runCliProcess,
  type CliProcessRuntimeHandle,
} from "../../cli/cliProcessRuntime";

test("loads and runs the process core in plain Node without a VS Code mock", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exits: Array<number | null> = [];
  let cleanupCalls = 0;
  const hostKey = "SINITEK_CORE_HOST_ONLY_SENTINEL";
  const previousHostValue = process.env[hostKey];
  process.env[hostKey] = "host-value-must-not-leak";
  const baseEnvironment: NodeJS.ProcessEnv = {
    CORE_TEST_VALUE: "from-base-environment",
    CORE_BASE_ONLY: "base-value",
    PWD: "/base/pwd-must-not-win",
  };
  const envOverrides = {
    CORE_TEST_VALUE: "from-task-overrides",
    CORE_TASK_ONLY: "task-value",
    CORE_OVERLAY_MARKER: "task-overlay-marker-must-not-win",
    PWD: "/task/pwd-must-not-win",
  };
  const baseSnapshot = { ...baseEnvironment };
  const overrideSnapshot = { ...envOverrides };
  try {
    const handle = runCliProcess({
      command: process.execPath,
      args: ["-e", [
        "process.stdout.write(JSON.stringify({argv0: process.argv0, args: process.argv.slice(1), value: process.env.CORE_TEST_VALUE, base: process.env.CORE_BASE_ONLY, task: process.env.CORE_TASK_ONLY, host: process.env.SINITEK_CORE_HOST_ONLY_SENTINEL ?? null, overlay: process.env.CORE_OVERLAY_MARKER, pwd: process.env.PWD}));",
        "process.stderr.write('tail-stderr');",
        "process.exitCode = 7;",
      ].join("")],
      cwd: process.cwd(),
      baseEnvironment,
      envOverrides,
      processLabel: "sinitek-core-test",
      overlay: {
        envOverrides: { CORE_OVERLAY_MARKER: "overlay", PWD: "/overlay/pwd-must-not-win" },
        cleanup: () => {
          cleanupCalls += 1;
          return { status: "confirmed", evidence: "owned-overlay-directory-absent" };
        },
      },
    }, {
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
      onExit: (code) => exits.push(code),
      onError: (error) => { throw error; },
    });

    assert.equal(handle.pid !== undefined, true);
    assert.equal(handle.resolvedCommand, process.execPath);
    assert.deepEqual(exits, []);
    const lifecycle = await handle.lifecycle;
    assert.deepEqual(exits, [7]);
    assert.equal(stderr.join(""), "tail-stderr");
    assert.deepEqual(JSON.parse(stdout.join("")), {
      argv0: "sinitek-core-test",
      args: [],
      value: "from-task-overrides",
      base: "base-value",
      task: "task-value",
      host: null,
      overlay: "overlay",
      pwd: process.cwd(),
    });
    assert.deepEqual(baseEnvironment, baseSnapshot);
    assert.deepEqual(envOverrides, overrideSnapshot);
    assert.equal(lifecycle?.processTerminal.status, "confirmed");
    assert.equal(lifecycle?.streams.status, "confirmed");
    assert.deepEqual(lifecycle?.temp, { status: "confirmed", evidence: "owned-overlay-directory-absent" });
    assert.equal(cleanupCalls, 1);
  } finally {
    if (previousHostValue === undefined) delete process.env[hostKey];
    else process.env[hostKey] = previousHostValue;
  }
});

function controlledRuntime(t: TestContext, platform: NodeJS.Platform) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
  const child = Object.assign(new EventEmitter(), {
    pid: 271828 as number | undefined,
    stdin: null, stdout: null, stderr: null,
    kill: () => { throw new Error("unexpected-child-fallback"); },
  });
  const signals: unknown[][] = [];
  const taskkills: unknown[][] = [];
  const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => unknown };
  t.mock.method(crossSpawn, "spawn", (...args: unknown[]) => {
    if (args[0] === "taskkill") {
      taskkills.push(args);
      const killer = new EventEmitter();
      // A missing taskkill executable must not become an unhandled error.
      queueMicrotask(() => killer.emit("error", new Error("taskkill ENOENT")));
      return killer;
    }
    return child;
  });
  t.mock.method(process, "kill", (...args: unknown[]) => { signals.push(args); return true; });
  let now = 0;
  const timers = new Map<NodeJS.Timeout, { callback: () => void; due: number }>();
  t.mock.method(global, "setTimeout", (callback: () => void, delay: number) => {
    const timer = { unref: () => undefined } as unknown as NodeJS.Timeout;
    timers.set(timer, { callback, due: now + delay });
    return timer;
  });
  t.mock.method(global, "clearTimeout", (timer: NodeJS.Timeout) => { timers.delete(timer); });
  return { child, signals, taskkills, timers, advance: (milliseconds: number) => {
    now += milliseconds;
    for (const [timer, entry] of timers) {
      if (entry.due > now) continue;
      timers.delete(timer);
      entry.callback();
    }
  } };
}

for (const platform of ["linux", "win32"] as const) {
  test(`run handle registers terminal observation before its first kill (${platform} simulation)`, async (t) => {
    const f = controlledRuntime(t, platform);
    const exits: Array<number | null> = [];
    let closeKill: boolean | undefined;
    const handle = runCliProcess({ command: process.execPath, args: [] }, {
      onExit: (code) => { exits.push(code); closeKill = handle.kill(); },
    });
    f.child.emit("spawn");
    f.child.emit("close", 0, null);
    assert.equal(closeKill, false);
    assert.equal(handle.kill("SIGKILL"), false);
    await handle.lifecycle;
    assert.deepEqual(exits, [0]);
    assert.deepEqual(f.signals, []);
    assert.deepEqual(f.taskkills, []);
    assert.equal(f.timers.size, 0);
  });

  test(`capture timeout uses the shared controller and close prevents later dispatch (${platform} simulation)`, async (t) => {
    const f = controlledRuntime(t, platform);
    const output = captureCliProcessOutput({ command: process.execPath, args: [], timeoutMs: 25 });
    const rejected = assert.rejects(output, /capture-cli-output-timeout:25/);
    f.child.emit("spawn");
    f.advance(25);
    if (platform === "win32") {
      assert.deepEqual(f.taskkills, [["taskkill", ["/PID", "271828", "/T", "/F"], { windowsHide: true, stdio: "ignore" }]]);
      assert.equal(f.timers.size, 0);
    } else {
      assert.deepEqual(f.signals, [[-271828, "SIGTERM"]]);
      assert.equal(f.timers.size, 1);
    }
    f.child.emit("close", 0, null);
    assert.equal(f.timers.size, 0);
    f.advance(5000);
    assert.equal(f.signals.length, platform === "win32" ? 0 : 1);
    assert.equal(f.taskkills.length, platform === "win32" ? 1 : 0);
    await rejected;
  });
}

test("a spawn error preserves runtime callbacks and prevents later stop dispatch", async (t) => {
  const f = controlledRuntime(t, "linux");
  f.child.pid = undefined;
  const errors: Error[] = [];
  const exits: Array<number | null> = [];
  const handle = runCliProcess({ command: process.execPath, args: [] }, {
    onError: (error) => errors.push(error), onExit: (code) => exits.push(code),
  });
  const error = new Error("spawn ENOENT");
  f.child.emit("error", error);
  assert.equal(handle.kill(), false);
  f.child.emit("close", -2, null);
  assert.equal(handle.kill("SIGKILL"), false);
  assert.equal((await handle.lifecycle)?.processTerminal.status, "unobservable");
  assert.deepEqual(errors, [error]);
  assert.deepEqual(exits, [-2]);
  assert.deepEqual(f.signals, []);
  assert.equal(f.timers.size, 0);
});

test("real isolated Node TERM retains output tails and actual close/drain callbacks", {
  timeout: 5000, skip: process.platform === "win32" ? "POSIX graceful TERM fixture; Windows stop is simulated" : false,
}, async (t) => {
  let stdout = "", stderr = "";
  const exits: Array<number | null> = [], errors: Error[] = [];
  let handle: CliProcessRuntimeHandle;
  handle = runCliProcess({ command: process.execPath, args: ["-e", [
    "const keepAlive = setInterval(() => {}, 1000);",
    "process.on('SIGTERM', () => { process.stdout.write('stdout-tail'); process.stderr.write('stderr-tail'); clearInterval(keepAlive); });",
    "process.stdout.write('ready\\n');",
  ].join("")] }, {
    onStdout: (chunk) => {
      stdout += chunk;
      if (stdout === "ready\n") handle.kill();
    },
    onStderr: (chunk) => { stderr += chunk; },
    onExit: (code) => exits.push(code),
    onError: (error) => errors.push(error),
  });
  t.after(() => { handle.kill("SIGKILL"); });
  const facts = await handle.lifecycle;
  assert.deepEqual(errors, []);
  assert.deepEqual(exits, [0]);
  assert.equal(stdout, "ready\nstdout-tail");
  assert.equal(stderr, "stderr-tail");
  assert.equal(facts?.processTerminal.status, "confirmed");
  assert.equal(facts?.streams.status, "confirmed");
  assert.equal(handle.kill(), false);
  assert.equal(handle.kill("SIGKILL"), false);
});

test("inherits the host environment when no explicit base environment is supplied", async () => {
  const key = "SINITEK_CORE_DEFAULT_BASE_SENTINEL";
  const previousValue = process.env[key];
  process.env[key] = "default-base-value";
  try {
    const result = await captureCliProcessOutput({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.SINITEK_CORE_DEFAULT_BASE_SENTINEL || '')"],
    });
    assert.equal(result.stdout, "default-base-value");
  } finally {
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
});

test("capture reports a real nonzero close with complete stdout and stderr tails", async () => {
  const result = await captureCliProcessOutput({
    command: process.execPath,
    args: ["-e", "process.stdout.write('stdout-tail');process.stderr.write('stderr-tail');process.exitCode=13"],
  });
  assert.deepEqual(result, {
    stdout: "stdout-tail",
    stderr: "stderr-tail",
    exitCode: 13,
    resolvedCommand: process.execPath,
  });
});

test("unavailable executables fail without claiming a started process", async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.equal(platformDescriptor?.configurable, true);
  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
  const errors: Error[] = [];
  const exits: Array<number | null> = [];
  const calls: string[] = [];
  try {
    const handle = runCliProcess({
      command: "/sinitek-cli-process-runtime-test/missing-command",
      args: [],
      overlay: {
        envOverrides: {},
        cleanup: () => {
          calls.push("cleanup");
          return { status: "confirmed", evidence: "owned-overlay-directory-absent" };
        },
      },
    }, {
      onError: (error) => { calls.push("error"); errors.push(error); },
      onExit: (code) => { calls.push("exit"); exits.push(code); },
    });
    assert.equal(handle.pid, undefined);
    assert.equal(handle.resolvedCommand, undefined);
    assert.equal(handle.lifecycle, undefined);
    assert.equal(handle.kill(), false);
    assert.equal((errors[0] as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
    assert.deepEqual(exits, [127]);
    await assert.rejects(captureCliProcessOutput({
      command: "/sinitek-cli-process-runtime-test/missing-command",
      args: [],
    }), { code: "ENOENT" });
    assert.deepEqual(calls, ["cleanup", "error", "exit"]);
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor!);
  }
});
