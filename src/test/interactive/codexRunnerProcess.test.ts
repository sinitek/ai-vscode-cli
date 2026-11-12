import * as assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => unknown };
const { killProcessTree } = require("../../interactive/codexRunnerProcess") as typeof import("../../interactive/codexRunnerProcess");

for (const outcome of ["success", "error", "nonzero", "throw", "already-exited"]) {
  test(`Windows taskkill handles ${outcome} without assuming the target exited`, () => {
    const originalSpawn = crossSpawn.spawn;
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    const killer = new EventEmitter();
    const signals: unknown[] = [];
    const child = { pid: 123456, exitCode: null, signalCode: null, kill: (signal: unknown) => { signals.push(signal); return true; } } as unknown as ChildProcess;
    Object.defineProperty(process, "platform", { value: "win32" });
    crossSpawn.spawn = (command, args) => {
      assert.equal(command, "taskkill");
      assert.deepEqual(args, ["/PID", "123456", "/T", "/F"]);
      if (outcome === "throw") {
        throw new Error("cannot spawn taskkill");
      }
      return killer;
    };
    try {
      assert.equal(killProcessTree(child), outcome !== "throw");
      if (outcome === "error" || outcome === "already-exited") {
        if (outcome === "already-exited") {
          Object.assign(child, { exitCode: 0 });
        }
        killer.emit("error", new Error("taskkill unavailable"));
        killer.emit("close", 1);
      } else if (outcome !== "throw") {
        killer.emit("close", outcome === "nonzero" ? 1 : 0);
      }
      assert.equal(signals.length, outcome === "error" || outcome === "nonzero" ? 1 : 0);
      assert.equal(child.exitCode, outcome === "already-exited" ? 0 : null);
    } finally {
      Object.defineProperty(process, "platform", platformDescriptor);
      crossSpawn.spawn = originalSpawn;
    }
  });
}
