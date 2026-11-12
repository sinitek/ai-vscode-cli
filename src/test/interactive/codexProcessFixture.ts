import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import type { TestContext, SuiteContext } from "node:test";

type FakeProcess = {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

// Fake PIDs must never reach the operating system, including on POSIX hosts.
export function blockRealProcessSignals(context: TestContext | SuiteContext): void {
  assert.ok("mock" in context);
  context.mock.method(process, "kill", () => {
    throw new Error("Fake child has no operating-system process group");
  });
}

export function fakeCodexSpawn(
  createServer: (...args: unknown[]) => FakeProcess,
  options: { onTaskkill?: (pid: number) => void; exitOnTaskkill?: boolean } = {},
): (...args: unknown[]) => unknown {
  const children = new Map<number, FakeProcess>();
  return (command, args, ...rest) => {
    if (command !== "taskkill") {
      const child = createServer(command, args, ...rest);
      if (child.pid !== undefined) children.set(child.pid, child);
      return child;
    }
    assert.ok(Array.isArray(args));
    const pid = Number(args[1]);
    assert.deepEqual(args, ["/PID", String(pid), "/T", "/F"]);
    const child = children.get(pid);
    assert.ok(child, `taskkill targeted an unknown fake PID: ${pid}`);
    options.onTaskkill?.(pid);
    const killer = new EventEmitter();
    queueMicrotask(() => {
      // Successful taskkill completion and target exit are separate events.
      killer.emit("close", 0, null);
      if (options.exitOnTaskkill !== false && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    });
    return killer;
  };
}
