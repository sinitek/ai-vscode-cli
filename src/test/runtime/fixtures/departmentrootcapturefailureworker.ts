import fs = require("fs");
import path = require("path");
import roots = require("../../../loopSubtaskExecutionRoot");

// A separate test worker installs faults before loading the real production
// worker. No production protocol, environment switch or cleanup fact is added.
const [stage, cleanup, directory] = process.argv.slice(2);
if (!["realpath", "assert"].includes(stage) || !["confirmed", "retained"].includes(cleanup) || !path.isAbsolute(directory)) {
  throw new Error("invalid-root-capture-fixture");
}
const audit = (value: object) => fs.appendFileSync(path.join(directory, "root-capture-audit"), JSON.stringify(value) + "\n");
const create = roots.createLoopSubtaskExecutionRoot;
roots.createLoopSubtaskExecutionRoot = (...args: Parameters<typeof create>) => {
  const root = create(...args);
  audit({ event: "created", cwd: root.cwd, pid: process.pid });
  const originalDispose = root.dispose;
  root.dispose = () => {
    audit({ event: "dispose-called", cwd: root.cwd });
    // Unknown content makes the actual original disposer retain its directory.
    // Removal by test teardown is hygiene only, never a confirmed cleanup fact.
    if (cleanup === "retained") fs.writeFileSync(path.join(root.cwd, "unknown-content"), "retain");
    const result = originalDispose();
    audit({ event: "dispose-result", result });
    return result;
  };
  const fail = () => {
    audit({ event: "first-check-failed", stage });
    throw new Error("test-first-root-check-failed");
  };
  if (stage === "assert") root.assertCurrent = fail;
  else {
    const realpath = fs.realpathSync;
    fs.realpathSync = ((...values: Parameters<typeof realpath>) => {
      if (values[0] === root.cwd) { fs.realpathSync = realpath; fail(); }
      return realpath(...values);
    }) as typeof realpath;
  }
  return root;
};

const { runDepartmentProcessOwnerWorker } = require("../../../runtime/departmentprocessownerworker") as typeof import("../../../runtime/departmentprocessownerworker");
void runDepartmentProcessOwnerWorker();
