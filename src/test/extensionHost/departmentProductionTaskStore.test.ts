import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { spawnSync } from "node:child_process";
import { installVscodeMock } from "../vscodeMock";
installVscodeMock();
import type { LoopTaskRecord, LoopMainDecision } from "../../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import type { DepartmentConfigurationState } from "../../departmentConfiguration";

const previousHome = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-production-source-home-"));
process.env.HOME = home;
const store = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { createDepartmentProductionTaskStore } = require("../../extensionHost/departmentProductionTaskStore") as typeof import("../../extensionHost/departmentProductionTaskStore");
const { prepareDepartmentTaskRecord } = require("../../extensionHost/departmentOwnedTaskRepository") as typeof import("../../extensionHost/departmentOwnedTaskRepository");
const { locateLoopTaskIdentity } = require("../../loopTaskIdentityCatalog") as typeof import("../../loopTaskIdentityCatalog");
const { createDepartmentRuntimeComposition } = require("../../extensionHost/departmentruntimecomposition") as typeof import("../../extensionHost/departmentruntimecomposition");
const { DepartmentRuntimeStore } = require("../../extensionHost/departmentruntimestore") as typeof import("../../extensionHost/departmentruntimestore");
const { createLoopOrchestrationHost } = require("../../extensionHost/loopOrchestration") as typeof import("../../extensionHost/loopOrchestration");
const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
const { transitionLoopMainDecision } = require("../../extensionHost/loopTaskStateMachine") as typeof import("../../extensionHost/loopTaskStateMachine");
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const { departmentRecords } = require("../loop/departmentGroupChatHost.fixture") as typeof import("../loop/departmentGroupChatHost.fixture");
if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test("production source + central composition + real Loop+ adapter persist complete owned tasks and share admission", async () => {
  const base = departmentRecords().root;
  const ordinary = { ...base, id: "ordinary-before-source", department: undefined, schedulingMode: "classic" as const,
    createdAt: Date.now(), updatedAt: Date.now(), subTasks: [], sessionId: null };
  ordinary.taskStoreFile = store.buildLoopTaskStoreFile("codex", ordinary.workspaceKey, null, ordinary.id);
  assert.equal(store.tryWriteLoopTaskStore(ordinary.taskStoreFile, { tasks: [ordinary] }), true);
  let source = createDepartmentProductionTaskStore(path.join(home, ".sinitek_cli", "department-tasks-v1"));
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistence: {
    create: (task) => source.create(task), read: store.readLoopTaskRecord,
    save: (task) => { assert.ok(store.updateLoopTaskRecord(task.id, task), "real owned update must persist"); },
    remove: (taskId) => { assert.equal(source.deleteTaskRecord(taskId), true, "real owned delete must persist"); },
  } });
  const configuration: DepartmentConfigurationState = { routes: {
    director: { cli: "codex", configId: "profile", model: "director", thinkingMode: "high" },
    leader: { cli: "codex", configId: "profile", model: "leader", thinkingMode: "high" },
    employee: { cli: "codex", configId: "profile", model: "employee", thinkingMode: "off" },
  }, limits: { maxLeaders: 4, maxEmployees: 1 }, loopPlusAcceptancePlan: base.loopPlusAcceptancePlan! };
  const targets = new Map<string, PromptRunTarget>([["director", { tabId: "director", cli: "codex", sessionId: "director-session" }]]);
  let composition!: ReturnType<typeof createDepartmentRuntimeComposition>;
  let targetSequence = 0, lastOutput = "", directorCalls = 0;
  const classicErrors: unknown[] = [];
  let next: LoopMainDecision = { status: "continue", subtasks: ["accounts", "reports"].map((id) => ({ id, title: id,
    prompt: `负责完整 ${id} 模块及其接口、界面和必要测试，向总监报告进度和跨组依赖，复用真实员工完成实施和组长统一验收，并提供修改路径与验证证据。任务未结束时也应及时汇报跨组依赖，总监按汇报协调并确认整体完成，不检查代码、不执行验收。` })) };
  const parser = createPromptRunRuntimeHost({ getActiveWorkspaceKey: () => "workspace" } as Parameters<typeof createPromptRunRuntimeHost>[0]);
  const classic = createLoopOrchestrationHost({
    handleDepartmentDecision: (request) => composition.handleDirectorDecision(request),
    normalizeLoopContinuePromptForPrompt: () => null, buildLoopSupplementalRequirementsLines: (task) => task.supplementalRequirements ?? [],
    isLoopTaskExecutionInterrupted: (id) => store.readLoopTaskRecord(id)?.status !== "running",
    readLoopTaskRecord: store.readLoopTaskRecord, updateLoopTaskRecord: store.updateLoopTaskRecord,
    refreshOpenLoopGroupChatPanelForTask: () => undefined, resolvePromptRunModelForRole: (input) => input.loopMainModel,
    resolvePromptRunThinkingModeForRole: () => undefined,
    runPrompt: async () => { directorCalls++; lastOutput = JSON.stringify(next); next = { status: "blocked", finalSummary: "等待汇报" }; },
    resolveLoopTaskSessionId: (target) => target.sessionId, bindLoopTaskToSession: store.bindLoopTaskToSession,
    getLoopRoundRunStatus: () => "end", appendLoopRound: store.appendLoopRound, buildLoopRoundSummary: () => "协调汇报",
    getLastLoopAssistantContent: () => lastOutput, parseLoopMainDecision: parser.parseLoopMainDecision, logError: (...args) => { classicErrors.push(args); },
  });
  const created = new Map<string, LoopTaskRecord>();
  const notices: string[] = [];
  const rename = fs.renameSync;
  fs.renameSync = ((from, to) => {
    rename(from, to);
    if (path.dirname(String(to)) === source.descriptor.root && !path.basename(String(to)).startsWith(".")) {
      const record = JSON.parse(fs.readFileSync(to, "utf8")).tasks[0] as LoopTaskRecord | undefined;
      if (record && !created.has(record.id)) created.set(record.id, record);
    }
  }) as typeof fs.renameSync;
  composition = createDepartmentRuntimeComposition({
    runtime: fixture.adapter, store: new DepartmentRuntimeStore(path.join(fixture.rootDir, "runtime")), workspaceKey: () => "workspace",
    readTask: store.readLoopTaskRecord, updateTask: store.updateLoopTaskRecord,
    prepareRoutes: async () => undefined, validateRoutes: () => true,
    resolveTarget: (id) => targets.get(id ?? "director") ?? null,
    taskForTarget: (id) => id === "director" ? store.readLoopTaskRecord("owned-director") : null,
    resolveTargetForRoot: () => targets.get("director")!,
    createRoot: (input, target, config) => source.create(prepareDepartmentTaskRecord({ ...base, id: "owned-director", status: "running",
      rootPrompt: input.displayPrompt, sessionId: target.sessionId, workspaceKey: "workspace", createdAt: Date.now(), updatedAt: Date.now(),
      currentRound: 0, loopPlus: undefined, communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "director.md"), subTasks: [], rounds: [] }, { version: 1, role: "director", rootTaskId: "owned-director", parentTaskId: null,
      leaderSubtaskId: null, moduleTitle: "部门目标", routes: config.routes, limits: config.limits }, config.loopPlusAcceptancePlan)),
    createLeaderTarget: () => { const id = `leader-${++targetSequence}`, target = { tabId: id, cli: "codex" as const, sessionId: `${id}-session` };
      targets.set(id, target); return target; },
    inspectLeaderSession: (task) => { const target = [...targets.values()].find((t) => t.sessionId === task.sessionId);
      return target ? { target, live: fixture.adapter.observeTask?.(task.id) ?? null } : null; },
    observeRestoredExecution: (task, attempt) => fixture.adapter.observeAttempt?.(task.id, attempt.subtaskId, attempt.attemptId) ?? null,
    stopLeader: async (id) => { fixture.adapter.host().stopParent(id); await fixture.adapter.waitForTaskIdle(id); }, stopDirector: () => undefined,
    runDirectorDecision: classic.runClassicLoopMainDecision,
    applyClassicDecision: (id, decision) => { const result = transitionLoopMainDecision({ task: store.readLoopTaskRecord(id)!, decision, now: Date.now() });
      const task = store.updateLoopTaskRecord(id, result.patch); assert.ok(task); return { status: result.status, task, subtasks: result.subtasks }; },
    report: (_id, message) => { notices.push(message); }, createMessageId: () => `message-${++targetSequence}`,
  });
  try {
    for (const [prefix, count] of [["accounts", 2], ["reports", 1]] as const) fixture.queueMain((input, tab) => fixture.publish(input, tab, {
      status: "end", content: JSON.stringify({ status: "dispatch", subtasks: Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`,
        title: `${prefix}-${i}`, taskType: "general", writeFiles: [], prompt: `Implement the complete ${prefix}-${i} requirement and report changed files and verification evidence.` })) }),
    }));
    await composition.startDepartmentPrompt({ cli: "codex", targetTabId: "director", displayPrompt: "实现账号和报表模块", modelPrompt: "部门目标",
      contextTags: [], departmentConfiguration: configuration });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 3, "owned leaders share regular and per-leader overflow capacity").catch((error) => {
      throw new Error(`${error}; directorCalls=${directorCalls}; classicErrors=${JSON.stringify(classicErrors)}; root=${JSON.stringify(store.readLoopTaskRecord("owned-director"))}; notices=${JSON.stringify(notices)}; logs=${JSON.stringify(fixture.logs)}; created=${JSON.stringify([...created.values()].map((task) => [task.id, task.department]))}`);
    });
    const root = store.readLoopTaskRecord("owned-director")!;
    const members = composition.host.runtimeSnapshot(root.id)!.leaders;
    assert.equal(members.length, 2); assert.equal(created.size, 3);
    for (const record of created.values()) {
      assert.ok(record.department); assert.deepEqual(record.loopPlusAcceptancePlan, configuration.loopPlusAcceptancePlan);
      assert.equal(path.dirname(record.taskStoreFile), source.descriptor.root);
      if (record.department.role === "leader") assert.ok(record.loopPlus);
      assert.deepEqual(locateLoopTaskIdentity(record.id), { available: true, files: [record.taskStoreFile] });
    }
    assert.equal(source.readDepartmentLeaderTaskIds(root.id, "accounts")?.length, 1);
    assert.equal(source.listTaskStoreFiles().length, 3);
    assert.equal(composition.readCapacity(root.id)!.employees.length, 3);
    assert.equal(composition.readCapacity(root.id)!.employeeOverflow?.length, 2);
    assert.equal(fixture.rootsCreated.length, 3, "waiting attempts have no execution resources");
    assert.ok(fixture.attemptCalls.every((input) => input.model === "employee"));
    const [a, b] = members;
    assert.equal(composition.host.coordinateCollaboration(a.taskId, { id: "collaboration-stable", targetLeaderTaskId: b.taskId, body: "报表配合账号接口" }).ok, true);
    assert.equal(store.readLoopTaskRecord(b.taskId)!.departmentDeliveries?.[`department:${root.id}:collaboration-stable`], undefined);
    const delivery = composition.host.processDirectorCollaboration(root.id, "collaboration-stable", "deliver");
    assert.equal(delivery.ok, true, `production collaboration delivery failed: ${JSON.stringify(delivery)}; target=${JSON.stringify(store.readLoopTaskRecord(b.taskId))}; runtime=${JSON.stringify(composition.host.runtimeSnapshot(root.id))}`);
    assert.equal(composition.host.processDirectorCollaboration(root.id, "collaboration-stable", "deliver").ok, true);
    assert.equal(store.readLoopTaskRecord(b.taskId)!.departmentDeliveries![`department:${root.id}:collaboration-stable`], "报表配合账号接口");
    assert.equal(composition.host.confirmRootComplete(root.id, "不能提前完成").ok, false);
    await composition.organizationControl.stop(root);
    assert.equal(composition.readCapacity(root.id)!.employees.length, 0);
    assert.equal(composition.readCapacity(root.id)!.leaders.length, 0);
    assert.ok(fixture.rootsDisposed.length >= 3);
    const leader = store.readLoopTaskRecord(a.taskId)!;
    assert.equal(store.bindLoopTaskToRuntimeTarget(leader.id, leader.cli, "rebound-session")?.taskStoreFile, leader.taskStoreFile);
    assert.equal(store.tryWriteLoopTaskStore(leader.taskStoreFile, { tasks: [leader] }), false);
    assert.deepEqual(locateLoopTaskIdentity(ordinary.id), { available: true, files: [ordinary.taskStoreFile] });
    assert.throws(() => source.create(prepareDepartmentTaskRecord({ ...root, id: ordinary.id }, { ...root.department!, rootTaskId: ordinary.id }, root.loopPlusAcceptancePlan!)), /冲突/);
    assert.equal(store.tryWriteLoopTaskStore(path.join(home, "ordinary-spoof.json"), { tasks: [{ ...ordinary, id: leader.id }] }), false);
    assert.equal(fs.existsSync(path.join(home, "ordinary-spoof.json")), false);
    const crossProcess = spawnSync(process.execPath, ["-e", `
      const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
      const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
      const record=${JSON.stringify(ordinary)};
      const readdir=fs.readdirSync;fs.readdirSync=()=>{throw Error("owned ID must not scan ordinary stores")};
      assert.equal(store.readLoopTaskRecord(${JSON.stringify(leader.id)}),null);fs.readdirSync=readdir;
      record.id=${JSON.stringify(leader.id)}; record.taskStoreFile=path.join(process.env.HOME,'cross-process-denied','tasks.json');
      assert.equal(store.tryWriteLoopTaskStore(record.taskStoreFile,{tasks:[record]}),false);
      assert.equal(fs.existsSync(path.dirname(record.taskStoreFile)),false);
      const updatedAt=record.updatedAt;record.updatedAt=0;
      assert.equal(store.tryWriteLoopTaskStore(record.taskStoreFile,{tasks:[record]}),false);
      assert.equal(fs.existsSync(path.dirname(record.taskStoreFile)),false);record.updatedAt=updatedAt;
      record.id='ordinary-cross-process';record.taskStoreFile=store.buildLoopTaskStoreFile(record.cli,record.workspaceKey,null,record.id);
      assert.equal(store.tryWriteLoopTaskStore(record.taskStoreFile,{tasks:[record]}),true);
    `], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(crossProcess.status, 0, crossProcess.stdout + crossProcess.stderr);
    assert.throws(() => source.create(prepareDepartmentTaskRecord({ ...root, id: "ordinary-cross-process" },
      { ...root.department!, rootTaskId: "ordinary-cross-process" }, root.loopPlusAcceptancePlan!)), /冲突/);
    const legacyRoot = path.join(home, ".sinitek_cli", "lobster-tasks");
    const legacyCommunication = path.join(home, ".sinitek_cli", "lobster-communications");
    fs.mkdirSync(legacyRoot, { recursive: true }); fs.mkdirSync(legacyCommunication, { recursive: true });
    const legacyFile = path.join(legacyRoot, "lobster-tasks.json");
    const legacyContent = JSON.stringify({ tasks: [{ ...ordinary, id: leader.id }] });
    fs.writeFileSync(legacyFile, legacyContent); fs.writeFileSync(path.join(legacyCommunication, "keep.md"), "keep");
    assert.ok(store.listLoopTaskStoreFiles().includes(legacyFile));
    assert.equal(fs.readFileSync(legacyFile, "utf8"), legacyContent);
    assert.equal(fs.existsSync(path.join(legacyCommunication, "keep.md")), true);
    fs.rmSync(legacyRoot, { recursive: true, force: true }); fs.rmSync(legacyCommunication, { recursive: true, force: true });
    for (const schedulingMode of ["classic", "event_driven"] as const) {
      const task = { ...ordinary, id: `ordinary-${schedulingMode}`, schedulingMode, taskStoreFile: path.join(home, `ordinary-${schedulingMode}.json`) };
      assert.equal(store.tryWriteLoopTaskStore(task.taskStoreFile, { tasks: [task] }), true);
      assert.equal(store.updateLoopTaskRecord(task.id, { finalSummary: "普通任务兼容" })?.finalSummary, "普通任务兼容");
      assert.equal(store.bindLoopTaskToSession(task.id, `ordinary-session-${schedulingMode}`)?.sessionId, `ordinary-session-${schedulingMode}`);
    }
    const rootFile = root.taskStoreFile;
    assert.equal(await source.close(), true);
    assert.equal(store.readLoopTaskRecord(root.id), null);
    assert.equal(store.updateLoopTaskRecord(root.id, { finalSummary: "关闭后拒绝" }), null);
    source = createDepartmentProductionTaskStore(source.descriptor.root);
    assert.equal(source.readTaskRecord(root.id)?.id, root.id, "source reopen uses catalog and complete verified records, not ordinary fallback");
    const now = Date.now, future = now() + 1000 * 60 * 60 * 24 * 365 * 100;
    assert.ok(store.updateLoopTaskRecord(a.taskId, { updatedAt: future }));
    const before = fs.readFileSync(rootFile, "utf8");
    try {
      Date.now = () => future;
      assert.equal(await source.close(), true);
      source = createDepartmentProductionTaskStore(source.descriptor.root);
      assert.equal(store.readLoopTaskRecord(root.id), null, "expired records are hidden on public routed reads after full source reinitialization");
      store.cleanupLoopTaskStoreRetention();
      assert.equal(fs.readFileSync(rootFile, "utf8"), before, "retention cannot orphan an in-date leader");
    } finally { Date.now = now; }
    assert.ok(store.updateLoopTaskRecord(a.taskId, { updatedAt: now() }));
    try {
      Date.now = () => future;
      store.cleanupLoopTaskStoreRetention();
      for (const file of source.listTaskStoreFiles()) assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { tasks: [] });
      const tombstone = spawnSync(process.execPath, ["-e", `
        const assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
        const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
        const task=${JSON.stringify(ordinary)};task.id=${JSON.stringify(root.id)};task.taskStoreFile=path.join(process.env.HOME,'retired-spoof','tasks.json');
        assert.equal(store.readLoopTaskRecord(task.id),null);
        assert.equal(store.tryWriteLoopTaskStore(task.taskStoreFile,{tasks:[task]}),false);
        assert.equal(fs.existsSync(path.dirname(task.taskStoreFile)),false);
      `], { env: { ...process.env, HOME: home }, encoding: "utf8" });
      assert.equal(tombstone.status, 0, tombstone.stdout + tombstone.stderr);
    } finally { Date.now = now; }
  } finally { fs.renameSync = rename; composition.dispose(); await source.close(); fixture.dispose(); }
});

for (const scenario of ["owner-change", "transaction-failure", "unknown-lock", "external-change", "replacement-lock"] as const) test(`production source refuses ${scenario} without ordinary fallback or marker theft`, () => {
  const childHome = fs.mkdtempSync(path.join(os.tmpdir(), "department-source-failure-home-"));
  const script = `
    const assert=require('node:assert/strict'), fs=require('fs'), path=require('path');
    const {createDepartmentProductionTaskStore}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentProductionTaskStore"))});
    const {prepareDepartmentTaskRecord}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentOwnedTaskRepository"))});
    const {departmentRecords}=require(${JSON.stringify(require.resolve("../loop/departmentGroupChatHost.fixture"))});
    const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
    (async()=>{
      const source=createDepartmentProductionTaskStore(path.join(process.env.HOME,'owned')); const root=source.descriptor.root;
      const task=departmentRecords().root; task.createdAt=task.updatedAt=Date.now(); task.subTasks=[];
      task.department.routes={director:{cli:'codex'},leader:{cli:'codex'},employee:{cli:'claude',thinkingMode:'off'}};
      const record=source.create(prepareDepartmentTaskRecord(task,task.department,task.loopPlusAcceptancePlan));
      const before=fs.readFileSync(record.taskStoreFile,'utf8');
      const marker=path.join(root,'.department-owner.json');
      const rename=fs.renameSync;
      if (${JSON.stringify(scenario)}==='owner-change') fs.writeFileSync(marker,JSON.stringify({version:1,sourceId:'department-production-v1',token:'unknown',revision:1}));
      else if (${JSON.stringify(scenario)}==='external-change') source.revokeBeforeExternalChange();
      else if (${JSON.stringify(scenario)}==='unknown-lock') fs.writeFileSync(path.join(process.env.HOME,'.sinitek_cli','loop-task-identities','transaction.lock'),'unknown');
      else fs.renameSync=(from,to)=>{if(path.dirname(String(to))===root){if (${JSON.stringify(scenario)}==='replacement-lock'){const lock=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities','transaction.lock');fs.unlinkSync(lock);fs.writeFileSync(lock,'replacement');}throw Error('owner transaction publication failed');}return rename(from,to)};
      assert.equal(store.updateLoopTaskRecord(record.id,{finalSummary:'must not persist'}),null);
      fs.renameSync=rename;
      assert.equal(fs.readFileSync(record.taskStoreFile,'utf8'),before);
      assert.equal(source.readTaskRecord(record.id),null);
      assert.equal(store.tryAppendLoopRound(record.id,{round:1,role:'main',status:'end',startedAt:1,endedAt:2,summary:'refused'}),false);
      if (['unknown-lock','replacement-lock'].includes(${JSON.stringify(scenario)})) assert.equal(fs.existsSync(path.join(process.env.HOME,'.sinitek_cli','loop-task-identities','transaction.lock')),true);
      const closed=await source.close();
      {
        assert.equal(closed,false); assert.equal(fs.existsSync(marker),true);
        assert.throws(()=>createDepartmentProductionTaskStore(root));
      }
    })().catch(e=>{console.error(e);process.exitCode=1});
  `;
  try {
    const result = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, HOME: childHome }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(childHome, { recursive: true, force: true }); }
});

test("production owner delete preserves its task on transaction failure and rejects after close", () => {
  const script = `
    const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
    const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
    const identities=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
    const {createDepartmentProductionTaskStore}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentProductionTaskStore"))});
    const {prepareDepartmentTaskRecord}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentOwnedTaskRepository"))});
    const {departmentRecords}=require(${JSON.stringify(require.resolve("../loop/departmentGroupChatHost.fixture"))});
    (async()=>{
      const mode=process.argv[1],id='owned-delete-'+mode;
      const task=departmentRecords().root;task.id=id;task.department.rootTaskId=id;task.createdAt=task.updatedAt=Date.now();task.subTasks=[];
        task.department.routes={director:{cli:'codex'},leader:{cli:'codex'},employee:{cli:'claude',thinkingMode:'off'}};
      const source=createDepartmentProductionTaskStore(path.join(process.env.HOME,id));
      const record=source.create(prepareDepartmentTaskRecord(task,task.department,task.loopPlusAcceptancePlan));
      if(mode==='success'){
        assert.equal(source.deleteTaskRecord(record.id),true);
        assert.equal(source.readTaskRecord(record.id),null);
        assert.deepEqual(identities.locateLoopTaskIdentity(record.id),{available:true,files:[record.taskStoreFile]},'owned identity keeps its routed file after deletion');
        assert.deepEqual(store.readLoopTaskStore(record.taskStoreFile).tasks,[],'owner transaction publishes an empty task store');
        assert.equal(await source.close(),true);
        assert.equal(source.deleteTaskRecord(record.id),false,'closed owner rejects further deletes');
      } else {
        const before=fs.readFileSync(record.taskStoreFile,'utf8'),rename=fs.renameSync;
        fs.renameSync=(from,to)=>{if(path.dirname(String(to))===source.descriptor.root)throw Error('owner delete publication failed');return rename(from,to)};
        assert.equal(source.deleteTaskRecord(record.id),false);
        fs.renameSync=rename;
        assert.equal(fs.readFileSync(record.taskStoreFile,'utf8'),before,'failed atomic publication leaves the task file unchanged');
        assert.equal(source.readTaskRecord(record.id),null,'uncertain owner state fails closed');
        assert.equal(await source.close(),false,'uncertain delete retains its owner marker');
      }
    })().catch(e=>{console.error(e);process.exitCode=1});
  `;
  for (const mode of ["success", "failure"]) {
    const childHome = fs.mkdtempSync(path.join(os.tmpdir(), "department-delete-owner-home-"));
    try {
      const result=spawnSync(process.execPath,["-e",script,mode],{env:{...process.env,HOME:childHome},encoding:"utf8"});
      assert.equal(result.status,0,result.stdout+result.stderr);
    } finally { fs.rmSync(childHome,{recursive:true,force:true}); }
  }
});

test("unregistered hosts retain department communications and tombstones; unavailable catalogs close GC", () => {
  const childHome = fs.mkdtempSync(path.join(os.tmpdir(), "department-retention-home-"));
  const result = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),cp=require('child_process');
    const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
    const {createDepartmentProductionTaskStore}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentProductionTaskStore"))});
    const {prepareDepartmentTaskRecord}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentOwnedTaskRepository"))});
    const {departmentRecords}=require(${JSON.stringify(require.resolve("../loop/departmentGroupChatHost.fixture"))});
    (async()=>{
      const source=createDepartmentProductionTaskStore(path.join(process.env.HOME,'.sinitek_cli','department-tasks-v1'));
      const task=departmentRecords().root;task.createdAt=task.updatedAt=Date.now();task.subTasks=[];
      task.department.routes={director:{cli:'codex'},leader:{cli:'codex'},employee:{cli:'claude',thinkingMode:'off'}};
      const record=source.create(prepareDepartmentTaskRecord(task,task.department,task.loopPlusAcceptancePlan));
      const read=fs.readFileSync;let reads=0;
      fs.readFileSync=(file,...args)=>{if(path.basename(String(file))==='catalog.json')reads++;return read(file,...args)};
      try{assert.equal(source.readTaskRecord(record.id).id,record.id);assert.equal(reads,1,'repository snapshot reads catalog once for all contributions');}
      finally{fs.readFileSync=read;}
      const communication=path.join(process.env.HOME,'.sinitek_cli','loop-communications');
      const old=new Date(1000);
      const make=id=>{const dir=path.join(communication,id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'report.md'),'keep');fs.utimesSync(path.join(dir,'report.md'),old,old);fs.utimesSync(dir,old,old);return dir};
      const owned=make(record.id),ordinary=make('ordinary-expired');
      const clean=()=>{const child=cp.spawnSync(process.execPath,['-e',${JSON.stringify(`require(${JSON.stringify(require.resolve("../../loopTaskStore"))}).cleanupLoopCommunicationRetention()`)}],{env:process.env,encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr)};
      clean();assert.equal(fs.existsSync(owned),true);assert.equal(fs.existsSync(ordinary),false);assert.ok(source.readTaskRecord(record.id));
      assert.equal(store.deleteLoopTaskStoreFile(record.taskStoreFile),true);clean();assert.equal(fs.existsSync(owned),true,'durable deleted ID retains communication');
      const unknown=make('ordinary-unclassified');
      const directory=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities'),catalog=path.join(directory,'catalog.json'),lock=path.join(directory,'transaction.lock');
      const original=fs.readFileSync(catalog,'utf8');
      for(const scenario of ['lock','corrupt','unpublished','missing']){
        if(scenario==='lock')fs.writeFileSync(lock,'unknown-owner');
        else if(scenario==='missing')fs.unlinkSync(catalog);
        else if(scenario==='unpublished')fs.writeFileSync(catalog,JSON.stringify({...JSON.parse(original),ready:false}));
        else fs.writeFileSync(catalog,'broken');
        clean();assert.equal(fs.existsSync(owned),true,scenario);assert.equal(fs.existsSync(unknown),true,scenario);
        if(scenario==='lock'){assert.equal(fs.readFileSync(lock,'utf8'),'unknown-owner');fs.unlinkSync(lock);}
        fs.writeFileSync(catalog,original);
      }
      clean();assert.equal(fs.existsSync(unknown),false,'known ordinary garbage is still removed');
      assert.equal(await source.close(),true);
    })().catch(e=>{console.error(e);process.exitCode=1});
  `], { env: { ...process.env, HOME: childHome }, encoding: "utf8" });
  try { assert.equal(result.status, 0, result.stdout + result.stderr); }
  finally { fs.rmSync(childHome, { recursive: true, force: true }); }
});
