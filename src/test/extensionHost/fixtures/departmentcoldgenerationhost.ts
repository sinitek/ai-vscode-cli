import { coldOpenCodeLaunch } from "./departmentproductionwiringfixture";
import * as fs from "fs";
import * as path from "path";
import type test = require("node:test");
import { createDepartmentProductionTaskStore } from "../../../extensionHost/departmentProductionTaskStore";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import { createDepartmentExecutionProducer } from "../../../extensionHost/departmentexecutionproducer";
import { DepartmentColdGenerationRecovery } from "../../../extensionHost/departmentcoldgenerationrecovery";
import { createDepartmentStoredLeaderIdentityReader } from "../../../extensionHost/departmentleaderstoredidentity";
import { createDepartmentRuntimeComposition } from "../../../extensionHost/departmentruntimecomposition";
import { createDepartmentLeaderProductionHost } from "../../../extensionHost/departmentleaderproductionhost";
import { createLoopPlusRuntimeFixture } from "./loopPlusRuntimeFixture";
import { SharedRuntimeConfig } from "../../../config/sharedRuntimeConfig";
import { updateLoopTaskRecord } from "../../../loopTaskStore";
import { resolveLoopConversationTabContextFromMessages } from "../../../panelStateBuilder";
import { createDepartmentExecutionResources } from "../../../extensionHost/departmentexecutionresources";
import { createDepartmentProductionCleanup } from "../../../extensionHost/departmentproductioncleanup";
import { fingerprintDepartmentExecutionSelection, sameExecution } from "../../../runtime/departmentexecutionidentity";

/** A second production repository/producer/composition. Receives only a trusted
 * application directory, never the original producer, private proof or clients.
 * UI session restoration is controlled; identity comes from original transcripts. */
export async function coldGenerationHost(t: test.TestContext, directory: string, registration?: (capability: import("../../../extensionHost/departmentcoldgenerationrecovery").DepartmentColdRestoredTab,
  resources: ReturnType<typeof createDepartmentExecutionResources>, tab: { id: string; cli: string; sessionId: string | null }) => void) {
  const file = (name: string) => path.join(directory, name);
  const diagnostics: string[] = [];
  const diagnosed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { diagnostics.push(stage + ": " + (error instanceof Error ? error.message : String(error))); throw error; }
  };
  const source = createDepartmentProductionTaskStore(file("owned"));
  const store = new DepartmentRuntimeStore(file("runtime"));
  const read = (id: string) => source.readTaskRecord(id);
  const producer = createDepartmentExecutionProducer({ store, workspaceKey: () => "workspace", readTask: read, validateRoutes: () => true,
    processOverlay: "required", authorityDirectory: file("authorities"), ownerDirectory: file("owners") });
  const native = createDepartmentLeaderProductionHost({ producer, store, ownerDirectory: file("owners"), readTask: read, updateTask: updateLoopTaskRecord });
  const config = new SharedRuntimeConfig(file("configuration"));
  const expected = await config.read(); if (!expected) throw new Error("cold-fixture-configuration-missing");
  const identity = createDepartmentStoredLeaderIdentityReader({ store, workspaceKey: () => "workspace", readSessionContext(cli, id) {
    return resolveLoopConversationTabContextFromMessages(JSON.parse(fs.readFileSync(file(`transcript-${cli}-${id}.json`), "utf8")));
  } });
  const targets = new Map<string, { tabId: string; cli: "codex" | "opencode"; sessionId: string }>();
  const tabs = new Map<string, { id: string; cli: string; sessionId: string | null }>();
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: id => tabs.get(id) ?? null, isActive: () => false,
    owns(i) { const read = store.read(i.rootTaskId, "workspace");
      const owns = !!(read.ok && read.value
        && read.value.runtime.leaders.some(m => m.taskId === i.leaderTaskId && m.generation === i.generation)
        && read.value.executionBindings?.some(b => sameExecution(b.identity, i)));
      if (!owns) diagnostics.push("resource-owner-conflict: " + JSON.stringify({ generation: i.generation,
        members: read.ok && read.value?.runtime.leaders.map(m => ({ generation: m.generation, status: m.status })) }));
      return owns;
    },
    async close(tab) { tabs.delete(tab.id); } });
  const restore = (task: NonNullable<ReturnType<typeof read>>) => {
    if (!["codex", "opencode"].includes(task.cli) || !task.sessionId) return null;
    const context = resolveLoopConversationTabContextFromMessages(JSON.parse(fs.readFileSync(file(`transcript-${task.cli}-${task.sessionId}.json`), "utf8")));
    if (task.department?.role === "leader" && (context.taskRole !== "main" || context.loopTaskId !== task.id)) return null;
    const target = { tabId: `restored-${task.id}`, cli: task.cli as "codex" | "opencode", sessionId: task.sessionId }; targets.set(task.id, target);
    if (!tabs.has(target.tabId)) { tabs.set(target.tabId, { id: target.tabId, cli: task.cli, sessionId: task.sessionId }); }
    return target;
  };
  let restored = 0;
  const recovery = new DepartmentColdGenerationRecovery({ store, authorityDirectory: file("authorities"), workspaceKey: () => "workspace", readTask: read,
    verifyStoredIdentity: identity,
    restoreTarget(task) { restored++; const target = restore(task); return target && { ...target, restoredTab: tabs.get(target.tabId)! }; },
    registerRestoredTarget(capability) { if (registration) registration(capability, resources, [...tabs.values()][0]); else resources.recordRestored(capability); }, acceptRetirement(cap) { producer.acceptColdRetirement(cap); } });
  let runs = 0;
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistence: {
    create(task) { const created = source.create(task); producer.recordNewLeader(created); return created; }, read,
    save(task) { if (!updateLoopTaskRecord(task.id, task)) throw new Error("cold-fixture-write-failed"); }, remove: source.deleteTaskRecord,
  }, runDepartmentMain(input, options) { return producer.track(input.loopTaskId!, async () => {
    runs++; let output = ""; options.onStarted?.();
    const consumer = resources.beginConsumer(options.targetTabId); let consumed = false;
    try {
    if (read(input.loopTaskId!)?.cli === "opencode") {
      let failure: Error | undefined;
      const handle = native.runOpenCode(input.loopTaskId!, options.invocationId, input.modelPrompt, {
        onStdout(chunk) { for (const line of chunk.trim().split("\n")) if (line) output += JSON.parse(line).part.text; },
        onStderr(chunk) { diagnostics.push(chunk); }, onError(error) { failure = error; }, onExit() {},
      }, expected, file("configuration"), coldOpenCodeLaunch(directory), options.signal, consumer.target);
      const facts = await handle.lifecycle;
      if (failure) throw failure;
      if (facts?.processTerminal.status !== "confirmed" || facts.streams.status !== "confirmed") throw new Error("cold-fixture-opencode-leader-unconfirmed");
    } else await native.run(input.loopTaskId!, options.invocationId, input.modelPrompt, {
      onAssistantDelta(chunk) { output += chunk; }, onThreadId() {}, onTurnCompleted() {}, onTrace() {}, onTaskListUpdate() {},
    }, expected, async selection => ({ configurationDirectory: file("configuration"), workspaceDirectory: file("workspace"), macTaskShell: "bash",
      requestUserInputEnabled: false, runner: { command: file(process.platform === "win32" ? "native.cmd" : "native"), args: [],
        env: { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, CODEX_HOME: file(".codex"), SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT },
        model: selection.model, thinkingMode: "medium", interactiveMode: "coding", threadId: null,
        configFingerprint: fingerprintDepartmentExecutionSelection(selection).configFingerprint } }), options.signal, consumer.target);
    fixture.publish(input, options.targetTabId, { status: "end", content: output }); consumed = true;
    } catch (error) { diagnostics.push("main-consumer: " + (error instanceof Error ? error.message : String(error))); throw error; }
    finally { consumer.finish(consumed); }
  }); }, closeDepartmentCoordinator: async id => { const closed = await producer.close(id); if (!closed.ok) throw new Error(closed.error); },
  runPromptOverride: async () => { throw new Error("cold-fixture-unexpected-employee"); } });
  const group = createDepartmentProductionCleanup({ store, producer, ownerDirectory: file("owners"), workspaceKey: () => "workspace", readTask: read });
  const composition = createDepartmentRuntimeComposition({ runtime: fixture.adapter, store, workspaceKey: () => "workspace", readTask: read, updateTask: updateLoopTaskRecord,
    prepareRoutes: async () => undefined, validateRoutes: () => true, prepareColdRecovery: (root, check) => recovery.prepare(root, check),
    verifyStoredLeaderIdentity: identity, inspectLeaderSession: task => recovery.inspect(task) ?? (targets.has(task.id) ? { target: targets.get(task.id)!, live: null } : null),
    observeRestoredExecution: (task, attempt) => recovery.observeAttempt(task, attempt),
    observeLeaderCleanup: (task, generation) => {
      const observed = recovery.owns(task.id) ? recovery.observation(task.id, generation) : group.observe(task, generation);
      return observed && { done: diagnosed("observe-leader-cleanup", () => observed.done) };
    },
    stopLeader: taskId => diagnosed("stop-leader", async () => { if (recovery.owns(taskId)) await recovery.stop(taskId); else { const close = await producer.close(taskId); if (!close.ok) throw new Error(close.error); await fixture.adapter.waitForTaskIdle(taskId); } }),
    leaderReleased: (taskId, generation) => diagnosed("release-leader", async () => { if (recovery.owns(taskId)) await recovery.released(taskId, generation); else { native.release(taskId); await producer.retire(taskId, generation); } }),
    prepareLeaderContinuation: task => producer.canContinueLeader(task.id) ? restore(task) : null,
    resumeLeaderExecution: (id, generation) => producer.openContinuedLeader(id, generation),
    resolveTarget: tab => [...targets.values()].find(target => target.tabId === tab) ?? null,
    taskForTarget: tab => read([...targets].find(([, target]) => target.tabId === tab)?.[0] ?? ""),
    resolveTargetForRoot: root => targets.get(root.id) ?? null,
    createRoot: () => { throw new Error("cold-fixture-no-new-root"); }, createLeaderTarget: () => { throw new Error("cold-fixture-no-new-leader"); },
    stopDirector: () => undefined, runDirectorDecision: async () => { throw new Error("cold-fixture-no-director-model"); },
    applyClassicDecision: () => { throw new Error("cold-fixture-no-director-model"); }, report(_taskId, message) { diagnostics.push(message); },
    log(message, error) { diagnostics.push(message + ": " + (error instanceof Error ? error.message : String(error))); }, createMessageId: () => "cold-message",
  });
  t.after(async () => { producer.closeAll(); composition.dispose(); fixture.dispose(); await source.close(); });
  return { source, store, read, producer, recovery, composition, fixture, diagnostics, resources, tabs, get restored() { return restored; }, get runs() { return runs; } };
}
