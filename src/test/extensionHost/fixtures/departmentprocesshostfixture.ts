/** Isolated installed-EH check. Uses real owned repository/config/runtime files and a controlled Node CLI.
 * Native export is fixture protocol; runner/tab release remains explicitly unobservable. */
import * as fs from "fs";
import * as path from "path";
import assert = require("node:assert/strict");
import { createDepartmentProductionTaskStore } from "../../../extensionHost/departmentProductionTaskStore";
import { prepareDepartmentTaskRecord } from "../../../extensionHost/departmentOwnedTaskRepository";
import { readLoopTaskRecord, updateLoopTaskRecord, type LoopTaskRecord } from "../../../loopTaskStore";
import { createLoopPlusScheduler } from "../../../loopPlusScheduler";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../../loopPlusAcceptancePlan";
import { createDepartmentRuntimeSnapshot } from "../../../extensionHost/departmentruntimestate";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import { createDepartmentProcessPreparation, startDepartmentProcessInvocation } from "../../../extensionHost/departmentprocesspreparation";
import { createLoopPlusRuntimeFixture } from "./loopPlusRuntimeFixture";
import { SharedRuntimeConfig } from "../../../config/sharedRuntimeConfig";
import { parseOpenCodeRunOutput } from "../../../cli/openCodeRunOutput";
import { writeMessageFile } from "../../../sessionStore";

export async function seedDepartmentProcessHostFixture(directory: string, home: string, workspaceKey: string): Promise<void> {
  const route = { cli: "opencode" as const, configId: "profile", model: "fixture/model" };
  const metadata = { version: 1 as const, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director" as const,
    moduleTitle: "module", routes: { director: route, leader: route, employee: route }, limits: { maxLeaders: 4, maxEmployees: 20 } };
  const root: LoopTaskRecord = { id: "root", cli: "opencode", workspaceKey, taskStoreFile: "", rootPrompt: "Isolated process bootstrap",
    schedulingMode: "classic", status: "completed", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
    communicationDir: directory, mainCommunicationFile: path.join(directory, "communication.md"), sessionId: "ses_director",
    subTasks: [{ id: "module", title: "module", status: "completed" }], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] };
  const leader: LoopTaskRecord = { ...root, id: "leader", sessionId: "ses_leader", loopPlus: createLoopPlusScheduler({ maxConcurrency: 4 }).snapshot(), subTasks: [{ id: "subtask", title: "subtask", status: "completed",
    executionSession: { cli: "opencode", sessionId: "ses_fixture", configId: "profile" } }] };
  const source = createDepartmentProductionTaskStore(path.join(home, ".sinitek_cli", "department-tasks-v1"));
  try {
    source.create(prepareDepartmentTaskRecord(root, metadata, buildSystemLoopPlusAcceptancePlanSnapshot()));
    source.create(prepareDepartmentTaskRecord(leader, { ...metadata, role: "leader", parentTaskId: "root", leaderSubtaskId: "module" }, buildSystemLoopPlusAcceptancePlanSnapshot()));
  } finally { assert.equal(await source.close(), true); }
}

export async function runDepartmentProcessHostFixture(directory: string, workspace: string, workspaceKey: string, nodeExecutable: string, cancelPreparation = false): Promise<void> {
  // Activation owns the production source/router. Never open a second writer here.
  assert.ok(readLoopTaskRecord("root"));
  assert.ok(updateLoopTaskRecord("root", { status: "running" }, { allowCompletedToRunning: true }));
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "attempt" }]);
  const leader = readLoopTaskRecord("leader")!;
  assert.ok(updateLoopTaskRecord("leader", { status: "running", loopPlus: scheduler.snapshot(), subTasks: leader.subTasks.map((s) => ({ ...s, status: "running" })) }, { allowCompletedToRunning: true }));
  const config = new SharedRuntimeConfig(path.join(directory, "configuration"));
  const selection = await config.change(async () => ({ configId: "profile", profileDigest: null }));
  const store = new DepartmentRuntimeStore(path.join(directory, "runtime"));
  const runtime = createDepartmentRuntimeSnapshot("root");
  runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
  assert.equal(store.write({ version: 1, rootTaskId: "root", workspaceKey, runtime,
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"])] } }).ok, true);
  let output = "";
  const preparationHost = { store, ownerDirectory: path.join(directory, "owners"), workspaceKey: () => workspaceKey,
    readTask: readLoopTaskRecord, updateTask: updateLoopTaskRecord,
    async prepareLaunch(_selection: import("../../../runtime/departmentexecutionidentity").DepartmentExecutionSelection, sessionId: string) {
      return { configurationDirectory: path.join(directory, "configuration"), workspaceDirectory: workspace, overlay: null,
        launch: { command: nodeExecutable, args: [path.join(__dirname, "..", "..", "runtime", "fixtures", "departmentprocessproductioncli.js"), "run", "--session", sessionId, "controlled-prompt"],
          baseEnvironment: { PATH: process.env.PATH, DEPARTMENT_FIXTURE_DIRECTORY: directory, ...(cancelPreparation ? { DEPARTMENT_FIXTURE_EXPORT_GATE: "yes" } : {}), DEPARTMENT_FIXTURE_TASK_FILE: readLoopTaskRecord("leader")!.taskStoreFile } } };
    },
  };
  const service = createDepartmentProcessPreparation(preparationHost);
  if (cancelPreparation) {
    let releases = 0, unknown = 0;
    const before = JSON.stringify(readLoopTaskRecord("leader"));
    const fixture = createLoopPlusRuntimeFixture({ cli: "opencode", configId: "profile",
      taskPersistence: { create() { throw new Error("not-used"); }, read: readLoopTaskRecord,
        save(task) { assert.ok(updateLoopTaskRecord(task.id, task)); }, remove() { throw new Error("not-used"); } },
      ownsDepartmentAttemptResources: () => { service.authorizeAttempt("leader", "subtask", "attempt"); return true; },
      observeAttemptTermination: () => service.observe("leader", "attempt", "subtask"),
      runPromptOverride: async (_input, options) => {
        assert.ok(options?.signal);
        await new Promise<void>((_resolve, reject) => {
          startDepartmentProcessInvocation(service, "leader", "subtask", { onError: reject }, selection,
            preparationHost.prepareLaunch, { signal: options.signal, isAborted: options.isAborted });
        });
      },
    });
    fixture.adapter.setDepartmentExecutionAdmission!(async () => ({ release() { releases++; }, cleanupFailed() { unknown++; } }));
    const attempt = fixture.adapter.startAttempt({ taskId: "leader", subtaskId: "subtask", attemptId: "attempt", title: "subtask",
      prompt: "controlled", modelPrompt: "controlled", writeFiles: [], round: 1, targetCli: "opencode" });
    try {
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(path.join(directory, "export-ready"))) {
        if (Date.now() > deadline) throw new Error("EH-read-only-export-not-reached");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(fs.existsSync(path.join(directory, "spawn-count")), false);
      attempt.abort(); await attempt.promise;
      assert.equal(JSON.stringify(readLoopTaskRecord("leader")), before, "caller cancellation does not require task-state mutation");
      fs.writeFileSync(path.join(directory, "export-open"), "open");
      while (JSON.parse(fs.readFileSync(path.join(directory, "configuration", "selection.json"), "utf8")).leases.length) {
        if (Date.now() > deadline) throw new Error("EH-probe-lease-not-drained");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(fs.existsSync(path.join(directory, "spawn-count")), false);
      const read = store.read("root", workspaceKey); assert.ok(read.ok && read.value);
      assert.equal(read.value.executionBindings?.length ?? 0, 0); assert.equal(read.value.capacity.employees.length, 1);
      assert.equal(releases, 0); assert.equal(unknown, 1);
      fs.writeFileSync(path.join(directory, "eh-result.json"), JSON.stringify({ cancelledBeforeLaunch: true, taskUnchanged: true,
        adapterSignal: true, exportDrained: true, taskSpawn: 0, capacityRetained: true, receipt: "unobservable" }));
    } finally { fs.writeFileSync(path.join(directory, "export-open"), "cleanup"); fixture.dispose(); }
    return;
  }
  service.authorizeAttempt("leader", "subtask", "attempt");
  const first = service.run("leader", "subtask", { onStdout(chunk) { output += chunk; } }, selection);
  assert.equal(service.run("leader", "subtask", {}, selection), first);
  await first;
  const deadline = Date.now() + 10000;
  while (!output.includes("正确会话回答") || !fs.existsSync(path.join(directory, "tail-ready"))) {
    if (Date.now() > deadline) throw new Error("EH-output-timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const parsed = parseOpenCodeRunOutput(output, "");
  assert.ok(parsed.finalText!.includes("正确会话回答"));
  const task = readLoopTaskRecord("leader")!;
  const session = task.subTasks[0].executionSession!;
  assert.equal(session.sessionId, "ses_fixture");
  assert.equal(writeMessageFile("opencode", session.sessionId, [{ id: "owner-answer", role: "assistant", content: parsed.finalText!,
    taskRole: "subtask", loopTaskId: "leader", loopSubtaskId: "subtask" }], { activeWorkspaceKey: workspaceKey,
    workspaceKeyFallback: "workspace", legacyMessageDir: path.join(directory, "messages"), messageDirRoot: path.join(directory, "messages") }), true);
  const read = store.read("root", workspaceKey); assert.ok(read.ok && read.value);
  fs.writeFileSync(path.join(directory, "eh-result.json"), JSON.stringify({ identity: read.value.executionBindings![0].identity,
    taskFile: task.taskStoreFile, sessionId: session.sessionId, answer: parsed.finalText!, cwd: workspace, ehPid: process.pid }));
  // Return through the existing Extension Host test exit method. Child remains behind file gates.
}
