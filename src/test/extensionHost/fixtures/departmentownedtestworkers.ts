import childProcess = require("child_process");
import type test = require("node:test");

/** Capture real forked children so failed isolated tests cannot leak workers.
 * Termination here is test hygiene, never an Owner receipt or worker-retire proof. */
export function captureDepartmentTestWorkers(t: test.TestContext) {
  const children: Array<{ module: string; child: childProcess.ChildProcess }> = [];
  const fork = childProcess.fork;
  t.mock.method(childProcess, "fork", (...args: Parameters<typeof childProcess.fork>) => {
    const child = Reflect.apply(fork, childProcess, args) as childProcess.ChildProcess;
    children.push({ module: String(args[0]), child });
    return child;
  });
  t.after(async () => {
    for (const { module, child } of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      console.error(`[department-test-hygiene] terminating unresolved owned worker ${module}`);
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill();
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1000); })]);
      } finally { clearTimeout(timer); }
    }
  });
  return children;
}
