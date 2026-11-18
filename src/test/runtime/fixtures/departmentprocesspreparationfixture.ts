import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as childProcess from "child_process";
import { SharedRuntimeConfig } from "../../../config/sharedRuntimeConfig";
import { createLoopPlusScheduler } from "../../../loopPlusScheduler";
import { createDepartmentRuntimeSnapshot } from "../../../extensionHost/departmentruntimestate";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import type { DepartmentProcessPreparationHost } from "../../../extensionHost/departmentprocesspreparation";
import type { LoopTaskRecord } from "../../../loopTaskStore";
import { fixtureEmployeeAdmission } from "./departmentemployeeadmission";
const cli = path.join(__dirname, "departmentprocessproductioncli.js");

export async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error("fixture-gate-not-reached"); await new Promise((resolve) => setTimeout(resolve, 5)); }
}
export async function setup(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-process-production-"));
  const workers: childProcess.ChildProcess[] = [];
  const children = require("child_process") as typeof childProcess;
  const fork = children.fork;
  t.mock.method(children, "fork", (...args: Parameters<typeof fork>) => {
    const child = fork(...args);
    if (String(args[0]).endsWith("departmentprocessownerworker.js")) workers.push(child);
    return child;
  });
  fs.mkdirSync(path.join(directory, "workspace"));
  fs.writeFileSync(path.join(directory, "workspace", "source.txt"), "controlled source");
  const config = new SharedRuntimeConfig(path.join(directory, "configuration"));
  const current = await config.change(async () => ({ configId: "profile", profileDigest: null }));
  const expected = { configId: current.configId, revision: current.revision };
  fs.writeFileSync(path.join(directory, "expected"), JSON.stringify(expected));
  const route = { cli: "opencode" as const, configId: "profile", model: "fixture/model" };
  const metadata = { version: 1 as const, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader" as const,
    moduleTitle: "module", routes: { director: route, leader: route, employee: route }, limits: { maxLeaders: 4, maxEmployees: 20 } };
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "attempt" }]);
  const leader = { id: "leader", workspaceKey: "workspace", status: "running", cli: "opencode", department: metadata,
    subTasks: [{ id: "subtask", title: "subtask", status: "running", executionSession: { cli: "opencode", sessionId: "ses_fixture", configId: "profile" } }],
    loopPlus: scheduler.snapshot() } as LoopTaskRecord;
  const root = { ...leader, id: "root", subTasks: [{ id: "module", title: "module", status: "running" }],
    department: { ...metadata, role: "director", parentTaskId: null, leaderSubtaskId: null } } as LoopTaskRecord;
  const store = new DepartmentRuntimeStore(path.join(directory, "runtime"));
  const runtime = createDepartmentRuntimeSnapshot("root");
  runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
  assert.equal(store.write({ version: 1, rootTaskId: "root", workspaceKey: "workspace", runtime,
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"])] } }).ok, true);
  const tasks = new Map([[root.id, root], [leader.id, leader]]);
  const admission = fixtureEmployeeAdmission(store);
  const host: DepartmentProcessPreparationHost = {
    store, employeeAdmission: admission.port, ownerDirectory: path.join(directory, "owners"), workspaceKey: () => "workspace", readTask: (id) => tasks.get(id) ?? null,
    updateTask(id, patch) { const task = tasks.get(id); if (!task) return null; const next = { ...task, ...patch }; tasks.set(id, next); return next; },
    async prepareLaunch(_selection, sessionId) {
      return { configurationDirectory: path.join(directory, "configuration"), workspaceDirectory: path.join(directory, "workspace"), overlay: null,
        launch: { command: process.execPath, args: [cli, "run", ...(sessionId ? ["--session", sessionId] : []), "controlled-prompt"],
          baseEnvironment: { ...process.env, DEPARTMENT_FIXTURE_DIRECTORY: directory } } };
    },
  };
  t.after(async () => {
    fs.writeFileSync(path.join(directory, "exit"), "open"); fs.writeFileSync(path.join(directory, "drain"), "open");
    fs.writeFileSync(path.join(directory, "export-open"), "open");
    fs.writeFileSync(path.join(directory, "create-open"), "open");
    fs.writeFileSync(path.join(directory, "server-close-open"), "open");
    for (const worker of workers) if (worker.exitCode === null && worker.signalCode === null) worker.kill();
    await until(() => workers.every(worker => worker.exitCode !== null || worker.signalCode !== null));
    if (process.env.DEPARTMENT_KEEP_FIXTURE) t.diagnostic(directory);
    else fs.rmSync(directory, { recursive: true, force: true });
  });
  return { admission, directory, config, current, expected, host, tasks, leader, root, store, workers };
}

/** Hold a real worker event at the trusted host boundary; no worker test switches or timers. */
export function holdOwnerEvent(t: test.TestContext, type: string) {
  const cp = require("child_process") as typeof import("child_process");
  const originalFork = cp.fork;
  let reached!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => { reached = resolve; });
  let worker: ReturnType<typeof cp.fork> | undefined;
  t.mock.method(cp, "fork", (...args: Parameters<typeof cp.fork>) => {
    const child = originalFork(...args); worker = child;
    const emit = child.emit as (event: string | symbol, ...values: unknown[]) => boolean;
    t.mock.method(child, "emit", (event: string | symbol, ...values: any[]) => {
      if (event === "message" && values[0]?.type === type) {
        release = () => { emit.call(child, event, ...values); }; reached(); return true;
      }
      return emit.call(child, event, ...values);
    });
    return child;
  });
  return { ready, release: () => release(), disconnect: () => worker?.disconnect(), exited: () => worker?.exitCode !== null && worker?.exitCode !== undefined };
}
