import { captureDepartmentTestWorkers, stopDepartmentFixtureWorkers } from "./departmentownedtestworkers";
import { createDepartmentProductionCleanup } from "../../../extensionHost/departmentproductioncleanup";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type test = require("node:test");
import { installVscodeMock } from "../../vscodeMock";
installVscodeMock();
import type { LoopTaskRecord } from "../../../loopTaskStore";
import type { CliName } from "../../../cli/types";
import type { PromptRunInput } from "../../../promptRunTypes";
import type { LoopPlusRuntimeAdapterDeps } from "../../../extensionHost/loopPlusRuntimeAdapter";
import type { DepartmentExecutionTabTarget } from "../../../extensionHost/departmentexecutionresources";
type OpenCodeMain = (input: PromptRunInput,
  options: Parameters<NonNullable<LoopPlusRuntimeAdapterDeps["runDepartmentMain"]>>[1],
  tabTarget?: DepartmentExecutionTabTarget) => Promise<string>;
import { SharedRuntimeConfig } from "../../../config/sharedRuntimeConfig";
import { SIMULATED_LEADER_CLI } from "../../runtime/fixtures/departmentleadercodexhost";
import { createDepartmentExecutionProducer } from "../../../extensionHost/departmentexecutionproducer";
import { createDepartmentLeaderProductionHost } from "../../../extensionHost/departmentleaderproductionhost";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import { createDepartmentCodexPreparation } from "../../../extensionHost/departmentcodexpreparation";
import { createDepartmentProcessPreparation, startDepartmentProcessInvocation } from "../../../extensionHost/departmentprocesspreparation";
import { createLoopPlusRuntimeFixture } from "./loopPlusRuntimeFixture";
import { createDepartmentRuntimeComposition, roleInput } from "../../../extensionHost/departmentruntimecomposition";
import { createDepartmentProductionTaskStore } from "../../../extensionHost/departmentProductionTaskStore";
import { prepareDepartmentTaskRecord } from "../../../extensionHost/departmentOwnedTaskRepository";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../../loopPlusAcceptancePlan";
import { createDepartmentExecutionResources } from "../../../extensionHost/departmentexecutionresources";
import { sameExecution } from "../../../runtime/departmentexecutionidentity";
import { fingerprintDepartmentExecutionSelection } from "../../../runtime/departmentexecutionidentity";
import { createLoopOrchestrationOwnershipTracker } from "../../../loopOrchestrationOwnership";

export function gate() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
export async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 12000;
  while (!await check()) { if (Date.now() > deadline) throw new Error("production-wiring-fixture-timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Actual production producer, owned repository, composition, scheduler/adapter,
 * Store, configuration and fixed workers. Only native CLI and UI consumers are
 * controlled/free fixtures; no fixture producer is constructed or installed. */
export async function productionWiring(t: test.TestContext, employee: "codex" | "opencode" = "codex", withResources = false, withGroupCleanup = false, modules = 1, treeControl?: { maxEmployees: number }, leader: "codex" | "opencode" = "codex", authorityEnabled = false, coldRecoveryEnabled = false) {
  const workers = captureDepartmentTestWorkers(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-production-wiring-"));
  const file = (n: string) => path.join(directory, n);
  const source = createDepartmentProductionTaskStore(file("owned"));
  const store = new DepartmentRuntimeStore(file("runtime"));
  const read = (id: string) => source.readTaskRecord(id);
  let sessionWritten: ((taskId: string) => void) | undefined;
  let taskUpdated: ((task: LoopTaskRecord, patch: Partial<LoopTaskRecord>) => void) | undefined;
  // Use the actual source router, including immutable native-session validation.
  const taskStore = require("../../../loopTaskStore") as typeof import("../../../loopTaskStore");
  const update = (id: string, patch: Partial<LoopTaskRecord>) => {
    const saved = taskStore.updateLoopTaskRecord(id, patch);
    if (saved) taskUpdated?.(saved, patch);
    if (saved && patch.executionSession) sessionWritten?.(id);
    return saved;
  };
  const producer = createDepartmentExecutionProducer({ store, workspaceKey: () => "workspace", readTask: read,
    validateRoutes: (routes) => routes.leader.cli === leader && routes.leader.configId === "profile" && routes.employee.cli === employee,
    processOverlay: "required", ...(authorityEnabled ? { authorityDirectory: file("authorities"), ...(coldRecoveryEnabled ? { ownerDirectory: file("owners") } : {}) } : {}) });
  const config = new SharedRuntimeConfig(file("configuration"));
  const expected = await config.change(async () => ({ configId: "profile", profileDigest: null }));
  fs.mkdirSync(file("workspace")); fs.writeFileSync(file("workspace/source.txt"), "isolated fixture");
  fs.mkdirSync(file("employee"));
  const environment = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT,
    HOME: directory, USERPROFILE: directory, CODEX_HOME: file(".codex") };
  function writeCli(root: string) {
    const cmd = path.join(root, process.platform === "win32" ? "native.cmd" : "native");
    const script = path.join(root, "native.cjs");
    const body = SIMULATED_LEADER_CLI.replace("let native,turn,round,", "let matchedPrompt=false;let native,turn,round,")
      .replace("if(turn&&!replied)", `if(turn&&!replied&&exists('answer-by-prompt')){
        const {marker}=JSON.parse(fs.readFileSync(file('answer-by-prompt'),'utf8'));
        matchedPrompt=JSON.stringify(turn.params.input).includes(marker)&&!exists('answer-by-prompt-eof');
      }
      if(turn&&!replied)`)
      .replace("delta:'fixture answer'", `delta:matchedPrompt?JSON.stringify(JSON.parse(fs.readFileSync(file('answer-by-prompt'),'utf8')).answer):
        exists('answer-'+round)?fs.readFileSync(file('answer-'+round),'utf8'):
        exists('answer-fallback')?fs.readFileSync(file('answer-fallback'),'utf8'):'fixture answer'`)
      .replace("eof=true;", "eof=true;if(matchedPrompt)fs.writeFileSync(file('answer-by-prompt-eof'),'ok');")
      .replace("if(turn&&!replied)", "if(turn&&!replied&&!exists('hold-output'))")
      .replace("if(turn&&!done&&!exists('hold-terminal'))", "if(turn&&!done&&!exists('hold-output')&&!exists('hold-terminal'))");
    fs.writeFileSync(script, `const ROOT=${JSON.stringify(root)};\n${body}`);
    fs.writeFileSync(cmd, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/usr/bin/env node\nconst ROOT=${JSON.stringify(root)};\n${body}`);
    fs.chmodSync(cmd, 0o755); return cmd;
  }
  const command = writeCli(directory), employeeCommand = writeCli(file("employee"));
  const entries = (rootTaskId = "root") => {
    const saved = store.read(rootTaskId, "workspace");
    return saved.ok ? saved.value?.leaderExecutionSets?.flatMap((set) => set.entries) ?? [] : [];
  };
  let beforeBuilder: (() => Promise<void>) | undefined, beforeEmployeeBuilder: (() => Promise<void>) | undefined;
  let beforeLeaderCallback: (() => Promise<void>) | undefined;
  let beforeLeaderCleanup: (() => Promise<void>) | undefined;
  const tabs = new Map<string, { id: string; cli: string; sessionId: string | null }>(), closedTabs: string[] = [], tabCloseAttempts: string[] = [];
  const employeeProcessLifecycles: Array<{ processTerminal: string; streams: string; temp: string }> = [];
  let tabCloseError = false, employeeConsumer: (() => Promise<void>) | undefined, employeeOutput: (() => Promise<void>) | undefined;
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: (id) => tabs.get(id) ?? null, isActive: () => false,
    owns(identity) {
      const read = store.read(identity.rootTaskId, "workspace");
      return read.ok && !!read.value && read.value.runtime.leaders.some((l) => l.taskId === identity.leaderTaskId && l.generation === identity.generation)
        && (read.value.executionBindings ?? []).some((b) => sameExecution(b.identity, identity));
    },
    async close(tab) { tabCloseAttempts.push(tab.id); if (tabCloseError) throw new Error("controlled-tab-close-error"); tabs.delete(tab.id); closedTabs.push(tab.id); },
  });
  const created = (id: string, cli: string, sessionId: string | null) => {
    if (withResources) { tabs.set(id, { id, cli, sessionId }); resources.recordCreated(id); }
  };
  let mainCalls = 0, localRuns = 0, employeeBuilders = 0;
  let openCodeMain: OpenCodeMain | undefined;
  const mainInvocations: Array<{ taskId: string; invocationId: string; prompt: string }> = [];
  const controlTargets = new Map<string, { tabId: string; cli: "codex"; sessionId: string | null }>();
  const leaderHost = createDepartmentLeaderProductionHost({ producer, store, ownerDirectory: file("owners"), readTask: read, updateTask: update });
  const codex = createDepartmentCodexPreparation({ retainOriginalClient: (binding, client) => producer.retainOriginalClient(binding, client), store, employeeAdmission: producer.employeeAdmission, ownerDirectory: file("owners"), workspaceKey: () => "workspace", readTask: read, updateTask: update });
  const processHost = createDepartmentProcessPreparation({ store, employeeAdmission: producer.employeeAdmission, ownerDirectory: file("owners"), workspaceKey: () => "workspace", readTask: read, updateTask: update,
    retainOriginalClient: (binding, client, directory) => producer.retainOriginalClient(binding, client, directory),
    nativeStopped: binding => producer.nativeStopped(binding),
    prepareLaunch: async () => { throw new Error("fixture-per-invocation-builder-required"); } });
  let fixture: ReturnType<typeof createLoopPlusRuntimeFixture>;
  const description = (selection: import("../../../runtime/departmentexecutionidentity").DepartmentExecutionSelection, cmd = command) => ({
    configurationDirectory: file("configuration"), workspaceDirectory: file("workspace"), macTaskShell: "bash" as const, requestUserInputEnabled: false,
    runner: { command: cmd, args: [], env: environment, model: selection.model, thinkingMode: selection.thinkingMode as "medium", interactiveMode: "coding" as const,
      threadId: null, configFingerprint: fingerprintDepartmentExecutionSelection(selection).configFingerprint },
  });
  fixture = createLoopPlusRuntimeFixture({ configId: "profile", ...(modules > 1 ? { maxConcurrency: 20, decisionSubtaskMax: () => 20 } : {}), taskPersistence: {
    create: (task) => { const saved = source.create(task); producer.recordNewLeader(saved); return saved; }, read,
    save: (task) => { if (!update(task.id, task)) throw new Error("fixture-owned-write-failed"); },
    remove: (taskId) => { if (!source.deleteTaskRecord(taskId)) throw new Error("fixture-owned-delete-failed"); },
  },
    runDepartmentMain: (input, options) => producer.track(input.loopTaskId!, async () => {
      mainCalls++; mainInvocations.push({ taskId: input.loopTaskId!, invocationId: options.invocationId, prompt: input.modelPrompt }); let output = "";
      options.onStarted?.();
      const consumer = withResources ? resources.beginConsumer(options.targetTabId) : undefined;
      let consumed = false;
      try {
      if (leader === "opencode") {
        if (!openCodeMain) throw new Error("fixture-opencode-main-port-required");
        output = await openCodeMain(input, options, consumer?.target);
      } else await leaderHost.run(input.loopTaskId!, options.invocationId, input.modelPrompt, {
        async onAssistantDelta(chunk) { await beforeLeaderCallback?.(); output += chunk; }, onThreadId() {}, onTurnCompleted() {}, onTrace() {}, onTaskListUpdate() {},
      }, expected, async (selection) => {
        const leader = entries(read(input.loopTaskId!)?.department?.rootTaskId).find((e) => e.responsibility.target.role === "leader" && e.executionId === null);
        if (!leader || leader.executionId !== null) throw new Error("fixture-registration-not-before-builder");
        await beforeBuilder?.(); return description(selection);
      }, options.signal, consumer?.target);
      fixture.publish(input, options.targetTabId, { status: "end", content: output });
      consumed = true;
      } finally { consumer?.finish(consumed); }
    }),
    closeDepartmentCoordinator: async (id) => { const result = await producer.close(id); if (!result.ok) throw new Error(result.error); },
    ownsDepartmentAttemptResources: (req) => { (req.targetCli === "codex" ? codex : processHost).authorizeAttempt(req.taskId, req.subtaskId, req.attemptId); return true; },
    observeAttemptTermination: (req) => (req.targetCli === "codex" ? codex : processHost).observe(req.taskId, req.attemptId, req.subtaskId),
    onSubtaskTargetCreated: (target) => created(target.tabId, target.cli, target.sessionId),
    runPromptOverride: (input, options) => {
      if (input.taskRole !== "subtask") { localRuns++; throw new Error("fixture-no-local-main-runner"); }
      return producer.track(input.loopTaskId!, async () => {
        if (employee === "codex") {
          const consumer = withResources ? resources.beginConsumer(options!.targetTabId!) : undefined;
          let consumed = false;
          try {
          await codex.run(input.loopTaskId!, input.loopSubtaskId!, {
            async onAssistantDelta() { await employeeOutput?.(); },
            onThreadId(id) { const tab = tabs.get(options!.targetTabId!); if (tab) tab.sessionId = id; }, onTrace() {}, onTaskListUpdate() {} }, expected,
            async (s) => {
              employeeBuilders++; if (!entries().some((e) => e.responsibility.target.role === "employee" && e.executionId === null)) throw new Error("fixture-employee-registration-missing");
              await beforeEmployeeBuilder?.();
              return { ...description(s, employeeCommand), prompt: input.modelPrompt };
            }, { signal: options?.signal, tabTarget: consumer?.target });
          await employeeConsumer?.();
          consumed = true;
          } finally { consumer?.finish(consumed); }
        } else {
          // This conservative existing OpenCode preparation supports exact
          // sessions only. Seed the controlled native session as its trusted
          // native creation fixture, never claim first-session coverage.
          const task = read(input.loopTaskId!)!;
          update(task.id, { subTasks: task.subTasks.map((s) => s.id === input.loopSubtaskId ? { ...s, executionSession: { cli: "opencode" as const, configId: "profile", sessionId: "ses_fixture" } } : s) });
          const consumer = withResources ? resources.beginConsumer(options!.targetTabId!) : undefined;
          let rejectProcess!: (error: Error) => void;
          const processFailure = new Promise<never>((_resolve, reject) => { rejectProcess = reject; });
          void processFailure.catch(() => undefined);
          const processExit = gate(); let processOutput = "";
          let consumed = false, handle: ReturnType<typeof startDepartmentProcessInvocation>;
          try {
          handle = startDepartmentProcessInvocation(processHost, task.id, input.loopSubtaskId!, {
            onStdout: (chunk) => { processOutput += chunk; }, onExit: () => processExit.resolve(), onError: rejectProcess,
          }, expected, async () => {
            employeeBuilders++; if (!entries().some((e) => e.responsibility.target.role === "employee" && e.executionId === null)) throw new Error("fixture-employee-registration-missing");
            await beforeEmployeeBuilder?.();
            const processCli = file("employee/process.cjs");
            fs.writeFileSync(processCli, `const fs=require('fs'),http=require('http');
if(process.argv[2]==='serve') {const s=http.createServer((req,res)=>res.end(JSON.stringify({id:'ses_fixture',directory:fs.realpathSync(process.cwd())})));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));process.on('SIGTERM',()=>s.close(()=>process.exit(0)));}
else if(process.argv[2]==='export'){fs.appendFileSync(${JSON.stringify(file("employee/export-count"))},'export\\n');process.stdout.write(JSON.stringify({info:{id:'ses_fixture',directory:fs.realpathSync(process.cwd())}}));}
else{fs.writeFileSync(${JSON.stringify(file("employee/started"))},'yes');process.stdout.write(JSON.stringify({type:'text',sessionID:'ses_fixture',part:{type:'text',text:'fixture'}})+'\\n');}`);
            return { configurationDirectory: file("configuration"), workspaceDirectory: file("workspace"),
              overlay: { configContent: JSON.stringify({ provider: { fixture: { models: { model: {} } } } }), primaryModel: "fixture/model", smallModel: null },
              launch: { command: process.execPath, args: [processCli, "run", "--session", "ses_fixture"], baseEnvironment: environment } };
          }, { signal: options?.signal, tabTarget: consumer?.target });
          // The original consumer finishes on the real business exit event;
          // waiting for the full terminal receipt here would include tab release.
          await Promise.race([processExit.promise, processFailure]);
          await employeeConsumer?.();
          consumed = true;
          } finally { consumer?.finish(consumed); }
          if (!processOutput.includes("ses_fixture")) throw new Error("fixture-opencode-output-not-consumed");
          const lifecycle = await handle.lifecycle;
          employeeProcessLifecycles.push({ processTerminal: lifecycle?.processTerminal.status ?? "missing",
            streams: lifecycle?.streams.status ?? "missing", temp: lifecycle?.temp.status ?? "missing" });
        }
        fixture.publish(input, options?.targetTabId ?? "", { status: "end", content: "employee fixture completed" });
      });
    },
  });
  if (leader === "opencode") {
    writeColdOpenCodeCli(directory);
    openCodeMain = async (input, options, tabTarget) => {
      let output = "", failure: Error | undefined;
      const handle = leaderHost.runOpenCode(input.loopTaskId!, options.invocationId, input.modelPrompt, {
        onStdout(chunk) { for (const line of chunk.trim().split("\n")) if (line) output += JSON.parse(line).part.text; },
        onStderr() {}, onError(error) { failure = error; }, onExit() {},
      }, expected, file("configuration"), coldOpenCodeLaunch(directory), options.signal, tabTarget);
      const facts = await handle.lifecycle;
      if (failure) throw failure;
      if (facts?.processTerminal.status !== "confirmed" || facts.streams.status !== "confirmed") throw new Error("fixture-opencode-leader-unconfirmed");
      return output;
    };
  }
  const routes = { director: { cli: "codex" as const, configId: "profile", thinkingMode: "medium" as const },
    leader: { cli: leader, configId: "profile", ...(leader === "opencode" ? { model: "fixture/model" } : {}), thinkingMode: "medium" as const },
    employee: { cli: employee as CliName, configId: "profile", ...(employee === "opencode" ? { model: "fixture/model" } : {}), thinkingMode: "medium" as const } };
  const plan = buildSystemLoopPlusAcceptancePlanSnapshot();
  const root = source.create(prepareDepartmentTaskRecord({ id: "root", cli: "codex", workspaceKey: "workspace", taskStoreFile: "", rootPrompt: "fixture department",
    status: "running", sessionId: "local_director", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
    communicationDir: directory, mainCommunicationFile: file("root.md"), subTasks: Array.from({ length: modules }, (_, n) => ({ id: n ? "module-" + n : "module", title: n ? "module-" + n : "module", status: "running" as const, prompt: "fixture module" })), rounds: [],
    completionRoundSummaries: [], completionRequirementCoverage: [] }, { version: 1, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null,
    role: "director", moduleTitle: "fixture department", routes, limits: { maxLeaders: 4, maxEmployees: treeControl?.maxEmployees ?? 20 } }, plan));
  const groupCleanup = createDepartmentProductionCleanup({ store, producer, ownerDirectory: file("owners"), workspaceKey: () => "workspace", readTask: read });
  let targetCount = 0;
  const ownership = createLoopOrchestrationOwnershipTracker();
  const composition = createDepartmentRuntimeComposition({ runtime: fixture.adapter, store, workspaceKey: () => "workspace", readTask: read, updateTask: update,
    acquireLeaderOwnership: ownership.acquire, acquireDirectorOwnership: ownership.acquire,
    log: (event, error) => { if (process.env.R231_DIAGNOSTIC) console.error(event, error); },
    prepareRoutes: async () => undefined, validateRoutes: (r) => r.leader.cli === leader && r.employee.cli === employee,
    beginLeaderExecution: (id, generation) => producer.openNewLeader(id, generation),
    ...(treeControl ? {
      resumeLeaderExecution: (id: string, generation: number) => producer.openContinuedLeader(id, generation),
      prepareLeaderContinuation: (task: LoopTaskRecord) => {
        if (!producer.canContinueLeader(task.id) || read(task.id)?.sessionId !== task.sessionId) return null;
        // Controlled equivalent of the trusted host session-tab API. It owns
        // the new UI target while preserving the task/local/native sessions.
        const existing = [...tabs.values()].find((tab) => tab.sessionId === task.sessionId && tab.cli === task.cli);
        const tabId = existing?.id ?? "continued-main-" + (++targetCount);
        if (!existing) created(tabId, task.cli, task.sessionId!);
        return { tabId, cli: task.cli, sessionId: task.sessionId! };
      },
    } : {}),
    resolveTargetForRoot: (task) => treeControl ? controlTargets.get(task.id) ?? null : null,
    resolveTarget: (tabId) => treeControl ? [...controlTargets.values()].find((v) => v.tabId === tabId) ?? null : null,
    taskForTarget: (tabId) => treeControl ? read([...controlTargets].find(([, v]) => v.tabId === tabId)?.[0] ?? "") : null, createRoot: () => { throw new Error("fixture-root-already-created"); },
    createLeaderTarget: () => { targetCount++; const tabId = modules === 1 ? "leader-tab" : "leader-tab-" + targetCount, sessionId = modules === 1 ? "local_leader" : "local_leader_" + targetCount;
      created(tabId, leader, sessionId); return { tabId, cli: leader, sessionId }; },
    inspectLeaderSession: (task) => {
      const tabId = treeControl ? [...tabs.values()].find((v) => v.sessionId === task.sessionId)?.id : "leader-tab";
      return tabId ? { target: { tabId, cli: task.cli, sessionId: task.sessionId ?? null }, live: null } : null;
    },
    observeRestoredExecution: () => null, observeLeaderCleanup: (task, generation) => {
      if (beforeLeaderCleanup) return { done: beforeLeaderCleanup().then(async () => {
        const observed = withGroupCleanup ? groupCleanup.observe(task, generation) : null;
        if (!observed) throw new Error("fixture-original-group-observation-unavailable");
        await observed.done;
      }) };
      return withGroupCleanup ? groupCleanup.observe(task, generation) : null;
    },
    leaderReleased: async (id, generation) => { leaderHost.release(id); await producer.retire(id, generation); },
    stopLeader: async (id) => { const closing = producer.close(id); fixture.adapter.host().stopParent(id); await closing; },
    stopDirector: () => undefined, runDirectorDecision: async () => { throw new Error("fixture-director-unused"); },
    applyClassicDecision: () => { throw new Error("fixture-director-unused"); }, report: () => undefined, createMessageId: () => "message",
  });
  if (!composition.host.registerRoot(root, root.department, plan).ok) throw new Error("fixture-root-registration-failed");
  const wire = (root = directory) => { try { return fs.readFileSync(path.join(root, "wire.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((v) => JSON.parse(v)); } catch { return []; } };
  t.after(async () => {
    const taskId = composition.host.runtimeSnapshot("root")?.leaders[0]?.taskId;
    const closing = taskId ? producer.close(taskId) : Promise.resolve();
    producer.closeAll(); fixture.adapter.host().stopParent(taskId ?? "");
    // Graceful teardown first; a stuck negative-test responsibility must not
    // hang test cleanup. This timeout is never production release evidence.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([closing.catch(() => undefined), new Promise<void>((r) => { timeout = setTimeout(r, 500); })]); }
    finally { clearTimeout(timeout); }
    // Fixture-only process teardown; never resource release/capacity evidence.
    for (const worker of workers) {
      worker.child.removeAllListeners("exit");
      worker.child.removeAllListeners("error");
      worker.child.removeAllListeners("disconnect");
    }
    try {
      await stopDepartmentFixtureWorkers({
        pidFiles: [path.join(directory, "native-instances"), path.join(file("employee"), "native-instances")],
        handles: workers.map((worker) => ({ handle: worker.child, identity: worker.identity })),
      });
    } finally {
      composition.dispose(); fixture.dispose(); await source.close();
      // A killed worker can still finish an atomic write. Retry test-directory
      // deletion only; no receipt/capacity assertion uses teardown as evidence.
      await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
    }
  });
  return { workers, file, directory, source, store, producer, leaderHost, fixture, composition, ownership, groupCleanup, read, update, expected, entries, wire, description, mainInvocations, controlTargets, resources,
    setOpenCodeMain(run: OpenCodeMain) { openCodeMain = run; },
    start: (moduleId = "module") => composition.host.startLeader("root", { leaderSubtaskId: moduleId, moduleTitle: moduleId, prompt: "Implement complete fixture module with actual employees and report native evidence." }),
    answer(round: number, value: unknown) { fs.writeFileSync(file("answer-" + round), JSON.stringify(value)); },
    answerByPrompt(marker: string, answer: unknown, fallback: unknown) {
      fs.writeFileSync(file("answer-by-prompt"), JSON.stringify({ marker, answer }));
      fs.writeFileSync(file("answer-fallback"), JSON.stringify(fallback));
    },
    beforeBuilder(fn: () => Promise<void>) { beforeBuilder = fn; }, get mainCalls() { return mainCalls; }, get localRuns() { return localRuns; }, get employeeBuilders() { return employeeBuilders; },
    beforeLeaderCallback(fn: () => Promise<void>) { beforeLeaderCallback = fn; },
    beforeLeaderCleanup(fn: () => Promise<void>) { beforeLeaderCleanup = fn; },
    beforeEmployeeBuilder(fn: () => Promise<void>) { beforeEmployeeBuilder = fn; },
    tabs, closedTabs, tabCloseAttempts, employeeProcessLifecycles, failTabClose(value: boolean) { tabCloseError = value; },
    beforeEmployeeConsumerFinish(fn: () => Promise<void>) { employeeConsumer = fn; },
    onEmployeeOutput(fn: () => Promise<void>) { employeeOutput = fn; },
    onSessionWritten(fn: (taskId: string) => void) { sessionWritten = fn; },
    onTaskUpdated(fn: NonNullable<typeof taskUpdated>) { taskUpdated = fn; },
  };
}

/** Free deterministic native protocol, shared by the original and independent
 * recovery fixtures. The recorded directory belongs to the real original root. */
export function coldOpenCodeLaunch(directory: string) {
  return { command: path.join(directory, process.platform === "win32" ? "cold-opencode.cmd" : "cold-opencode"), baseArgs: ["run", "--format", "json"],
    cwd: path.join(directory, "workspace"), baseEnvironment: { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory },
    overlay: { configContent: JSON.stringify({ provider: { fixture: { models: { model: {} } } } }), primaryModel: "fixture/model", smallModel: null } };
}
export function writeColdOpenCodeCli(directory: string): void {
  const command = path.join(directory, process.platform === "win32" ? "cold-opencode.cmd" : "cold-opencode");
  const script = path.join(directory, "cold-opencode.cjs");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`);
  fs.chmodSync(command, 0o755);
  fs.writeFileSync(path.join(directory, "cold-opencode.cjs"), `const fs=require('fs'),http=require('http'),path=require('path'),args=process.argv.slice(2),root=${JSON.stringify(directory)};
const session='ses_coldLeader',file=n=>path.join(root,n),read=()=>fs.readFileSync(file('cold-native-directory'),'utf8');
if(args.includes('serve')){const s=http.createServer((req,res)=>{
if(req.method==='POST'&&req.url.startsWith('/experimental/control-plane/move-session')){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const v=JSON.parse(body);if(v.sessionID!==session||v.moveChanges!==false||v.destination.directory!==fs.realpathSync(process.cwd())||fs.existsSync(read())){res.writeHead(409).end('{}');return;}fs.writeFileSync(file('cold-native-directory'),v.destination.directory);fs.appendFileSync(file('cold-native-events'),'move\\n');res.writeHead(204).end();});return;}
if(req.method==='POST'&&req.url.startsWith('/session')){if(fs.existsSync(file('cold-native-directory'))){res.writeHead(409).end('{}');return;}fs.writeFileSync(file('cold-native-directory'),fs.realpathSync(process.cwd()));}
res.end(JSON.stringify({id:session,directory:read()}));});s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));process.on('SIGTERM',()=>s.close(()=>process.exit(0)));}
else if(args[0]==='export'){if(args[1]!==session)process.exit(31);process.stdout.write(JSON.stringify({info:{id:session,directory:read()}}));}
else {const i=args.indexOf('--session');if(i<0||args[i+1]!==session||read()!==fs.realpathSync(process.cwd()))process.exit(32);const n=fs.existsSync(file('cold-native-round'))?Number(fs.readFileSync(file('cold-native-round'),'utf8'))+1:1;fs.writeFileSync(file('cold-native-round'),String(n));fs.appendFileSync(file('cold-native-events'),'run:'+n+'\\n');const answer=fs.readFileSync(file('answer-'+n),'utf8');process.stdout.write(JSON.stringify({type:'text',sessionID:session,part:{type:'text',text:answer}})+'\\n');}
`);
}
