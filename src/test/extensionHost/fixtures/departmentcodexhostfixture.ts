import { fixtureEmployeeAdmission } from "../../runtime/fixtures/departmentemployeeadmission";
/** Installed EH fixture: real production task writer/config lease and actual adapter, simulated native protocol. */
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
import { createDepartmentCodexPreparation } from "../../../extensionHost/departmentcodexpreparation";
import { createLoopPlusRuntimeFixture } from "./loopPlusRuntimeFixture";
import { SharedRuntimeConfig } from "../../../config/sharedRuntimeConfig";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection, type DepartmentExecutionIdentity } from "../../../runtime/departmentexecutionidentity";
import { fixturePreparation } from "../../runtime/fixtures/departmentcodexownerworker";

export async function seedDepartmentCodexHostFixture(directory: string, home: string, workspaceKey: string): Promise<void> {
  const route = { cli: "codex" as const, configId: "profile", thinkingMode: "medium" as const };
  const metadata = { version: 1 as const, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director" as const,
    moduleTitle: "module", routes: { director: route, leader: route, employee: route }, limits: { maxLeaders: 4, maxEmployees: 20 } };
  const root: LoopTaskRecord = { id: "root", cli: "codex", workspaceKey, taskStoreFile: "", rootPrompt: "Isolated interactive Codex bootstrap",
    schedulingMode: "classic", status: "completed", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
    communicationDir: directory, mainCommunicationFile: path.join(directory, "communication.md"), sessionId: "director-native",
    subTasks: [{ id: "module", title: "module", status: "completed" }], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] };
  const leader: LoopTaskRecord = { ...root, id: "leader", sessionId: "leader-native", loopPlus: createLoopPlusScheduler({ maxConcurrency: 4 }).snapshot(), subTasks: [{ id: "subtask", title: "subtask", status: "completed" }] };
  const source = createDepartmentProductionTaskStore(path.join(home, ".sinitek_cli", "department-tasks-v1"));
  try {
    source.create(prepareDepartmentTaskRecord(root, metadata, buildSystemLoopPlusAcceptancePlanSnapshot()));
    source.create(prepareDepartmentTaskRecord(leader, { ...metadata, role: "leader", parentTaskId: "root", leaderSubtaskId: "module" }, buildSystemLoopPlusAcceptancePlanSnapshot()));
  } finally { assert.equal(await source.close(), true); }
}

export async function runDepartmentCodexHostFixture(directory: string, workspace: string, workspaceKey: string, _nodeExecutable: string, cancelPreparation = false): Promise<void> {
  const file = (name: string) => path.join(directory, name);
  const until = async (check: () => boolean) => { const end = Date.now() + 15000; while (!check()) { if (Date.now() > end) throw new Error("EH-fixture-gate-not-reached"); await new Promise((resolve) => setTimeout(resolve, 10)); } };
  assert.ok(readLoopTaskRecord("root"));
  assert.ok(updateLoopTaskRecord("root", { status: "running", subTasks: readLoopTaskRecord("root")!.subTasks.map((s) => ({ ...s, status: "running" })) }, { allowCompletedToRunning: true }));
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "attempt" }]);
  const leader = readLoopTaskRecord("leader")!;
  assert.ok(updateLoopTaskRecord("leader", { status: "running", loopPlus: scheduler.snapshot(), subTasks: leader.subTasks.map((s) => ({ ...s, status: "running" })) }, { allowCompletedToRunning: true }));
  const config = new SharedRuntimeConfig(file("configuration"));
  const selected = await config.change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "employee", configId: "profile", revision: selected.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: workspaceKey, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
    cli: "codex", role: "employee", subtaskId: "subtask", attemptId: "attempt", ownerId: "fixture", executionId: "fixture", session: { state: "unbound" }, ...fingerprintDepartmentExecutionSelection(selection) };
  const { prepared } = fixturePreparation(directory, identity, selection);
  prepared.runner.model = null; prepared.runner.configFingerprint = identity.configFingerprint; delete prepared.runner.cwd;
  // A real task child reads both production persistent records before accepting its task.
  const command = prepared.runner.command;
  const injected = `const task=JSON.parse(fs.readFileSync(${JSON.stringify(leader.taskStoreFile)},'utf8'));const runtime=JSON.parse(fs.readFileSync(${JSON.stringify(file("runtime/726f6f74.json"))},'utf8'));const selection=JSON.parse(fs.readFileSync(${JSON.stringify(file("configuration/selection.json"))},'utf8'));fs.writeFileSync(file('observed'),JSON.stringify({task,runtime,ownerLeases:selection.leases,cwd:process.cwd()}));`;
  fs.writeFileSync(command, fs.readFileSync(command, "utf8").replace("request=m.id;mark('task-started');", injected + "request=m.id;mark('task-started');"));
  const store = new DepartmentRuntimeStore(file("runtime")), runtime = createDepartmentRuntimeSnapshot("root");
  runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
  assert.equal(store.write({ version: 1, rootTaskId: "root", workspaceKey, runtime,
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"])] } }).ok, true);
  const admission = fixtureEmployeeAdmission(store, workspaceKey);
  const service = createDepartmentCodexPreparation({ store, employeeAdmission: admission.port, ownerDirectory: file("owners"), workspaceKey: () => workspaceKey,
    readTask: readLoopTaskRecord, updateTask: updateLoopTaskRecord });
  let entered = false, release!: () => void;
  const preparationGate = new Promise<void>((resolve) => { release = resolve; });
  const fixture = createLoopPlusRuntimeFixture({ cli: "codex", configId: "profile",
    taskPersistence: { create() { throw new Error("not-used"); }, read: readLoopTaskRecord, save(task) { assert.ok(updateLoopTaskRecord(task.id, task)); }, remove() { throw new Error("not-used"); } },
    ownsDepartmentAttemptResources: () => { service.authorizeAttempt("leader", "subtask", "attempt"); return true; },
    observeAttemptTermination: () => service.observe("leader", "attempt", "subtask"),
    runPromptOverride: async (_input, options) => {
      assert.ok(options?.signal);
      await service.run("leader", "subtask", { onAssistantDelta() {}, onThreadId() {}, onTrace() {}, onTaskListUpdate() {} }, selected,
        async () => { entered = true; if (cancelPreparation) await preparationGate; return { runner: prepared.runner, prompt: "controlled EH prompt", macTaskShell: "bash",
          configurationDirectory: file("configuration"), workspaceDirectory: workspace, requestUserInputEnabled: false }; },
        { signal: options.signal, isAborted: options.isAborted });
    },
  });
  let unknown = 0, releases = 0;
  fixture.adapter.setDepartmentExecutionAdmission!(async () => ({ release() { releases++; }, cleanupFailed() { unknown++; } }));
  const attempt = fixture.adapter.startAttempt({ taskId: "leader", subtaskId: "subtask", attemptId: "attempt", title: "subtask", prompt: "controlled", modelPrompt: "controlled", writeFiles: [], round: 1, targetCli: "codex" });
  if (cancelPreparation) {
    await until(() => entered); attempt.abort(); release(); await attempt.promise;
    assert.equal(fs.existsSync(file("task-started")), false);
    assert.equal(store.read("root", workspaceKey).ok, true);
    assert.equal(releases, 0); assert.equal(unknown, 1);
    fs.writeFileSync(file("eh-result.json"), JSON.stringify({ cancelledBeforeLaunch: true, adapterSignal: true, taskSpawn: 0, capacityRetained: true }));
    fixture.dispose(); return;
  }
  await until(() => fs.existsSync(file("task-started")));
  const read = store.read("root", workspaceKey); assert.ok(read.ok && read.value);
  const binding = read.value.executionBindings![0];
  const persisted = readLoopTaskRecord("leader")!.subTasks[0].executionSession;
  assert.equal(persisted?.sessionId, "native"); assert.equal(binding.identity.session.state, "bound");
  fs.writeFileSync(file("eh-result.json"), JSON.stringify({ identity: binding.identity, sessionId: persisted.sessionId, ehPid: process.pid,
    adapterSignal: true, boundBeforeTask: true, leaseOwnedByWorker: true, scope: "real adapter + production repository/config + production coordinator; trusted fixture runPrompt callback" }));
  // The extension test host exits now while the original Owner and native turn remain live.
}
