import { fixtureEmployeeAdmission } from "./departmentemployeeadmission";
import * as fs from "fs";
import * as path from "path";
import { createDepartmentProcessPreparation } from "../../../extensionHost/departmentprocesspreparation";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import type { LoopTaskRecord } from "../../../loopTaskStore";
import childProcess = require("child_process");
import { recordDepartmentWorkerInstance } from "../../extensionHost/fixtures/departmentownedtestworkers";
const directory = process.argv[2];
const realFork = childProcess.fork;
childProcess.fork = ((...args: Parameters<typeof childProcess.fork>) => {
  const child = realFork.apply(childProcess, args);
  if (String(args[0]).endsWith("departmentprocessownerworker.js") && child.pid)
    recordDepartmentWorkerInstance(path.join(directory, "owned-worker-pids"), child.pid);
  return child;
}) as typeof childProcess.fork;
const read = (id: string): LoopTaskRecord | null => {
  try { return JSON.parse(fs.readFileSync(path.join(directory, id + "-task"), "utf8")); } catch { return null; }
};
const store = new DepartmentRuntimeStore(path.join(directory, "runtime"));
const admission = fixtureEmployeeAdmission(store);
const service = createDepartmentProcessPreparation({
  store, employeeAdmission: admission.port, ownerDirectory: path.join(directory, "owners"),
  workspaceKey: () => "workspace", readTask: read,
  updateTask(id, patch) {
    const value = { ...read(id), ...patch } as LoopTaskRecord;
    fs.writeFileSync(path.join(directory, id + "-task"), JSON.stringify(value)); return value;
  },
  async prepareLaunch(_selection, sessionId) {
    return { configurationDirectory: path.join(directory, "configuration"), workspaceDirectory: path.join(directory, "workspace"), overlay: null,
      launch: { command: process.execPath, args: [path.join(__dirname, "departmentprocessproductioncli.js"), "run", ...(sessionId ? ["--session", sessionId] : []), "controlled-prompt"],
        baseEnvironment: { ...process.env, DEPARTMENT_FIXTURE_DIRECTORY: directory } } };
  },
});
const expected = JSON.parse(fs.readFileSync(path.join(directory, "expected"), "utf8"));
service.authorizeAttempt("leader", "subtask", "attempt");
const observed = service.observe("leader", "attempt");
void observed.done.catch(() => undefined);
void service.run("leader", "subtask", {
  onStdout: (chunk) => fs.appendFileSync(path.join(directory, "session-output"), chunk),
  onStderr: (chunk) => fs.appendFileSync(path.join(directory, "session-error"), chunk),
  onExit: (code) => fs.writeFileSync(path.join(directory, "business-exit"), String(code)),
}, expected).then(() => {
  fs.writeFileSync(path.join(directory, "host-started"), "started");
  // Simulate abrupt EH loss AFTER the real production coordinator has bound and opened launch.
  process.exit(0);
}, () => process.exit(1));
