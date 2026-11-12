/** Real Extension Host entry. The launcher supplies an isolated development extension and HOME. */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

const root = process.env.SINITEK_NATIVE_ROOT!;
const product = process.env.SINITEK_NATIVE_PRODUCT!;
const load = (name: string): any => require(path.join(product, "dist", name));
const evidence: any = { vscode: vscode.version, platform: process.platform, events: [], assertions: [] };
const turns: any[] = [];
const compactions: any[] = [];
let api: any;
let host: any;
let taskId: string;
let child: any;
let review: any;
let compactFlight: Promise<boolean> | undefined;
let executionFlight: Promise<void> | undefined;
let releaseOwnership: (() => void) | undefined;

async function until(predicate: () => unknown, label: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

function complete(turn: any, text: string): void {
  turn.handlers.onAssistantDelta(text, { codexFinalAnswer: true, assistantItemId: randomUUID() });
  turn.handlers.onTurnCompleted?.({ threadId: turn.threadId, turnId: randomUUID(), status: "completed" });
  turn.resolve();
}

function checkCompletion(): void {
  const task = api.readLoopTaskRecord(taskId);
  assert.equal(task.subTasks[0].status, "completed");
  const snapshot = task.loopPlus;
  assert.equal(snapshot.currentReview.outcome, "completed");
  assert.equal(snapshot.currentReview.subtaskId, "native-child");
  assert.ok(api.readTaskStore().runs.some((run: any) => run.taskRole === "subtask" && run.status === "end"));
  evidence.assertions.push("persisted child completion and currentReview.outcome remain completed");
}

async function action(name: string): Promise<any> {
  if (name === "begin") {
    const { createLoopPlusOrchestrationHost } = load("extensionHost/loopPlusOrchestration.js");
    const selection = (await api.loadConfigState("codex"));
    const configSelections = { codex: { configId: selection.activeConfigId, revision: selection.revision } };
    const parent = api.resolvePromptRunTarget(api.getActiveConversationTabId());
    const input = { displayPrompt: "原生宿主压缩路由隔离验收", model: "native-fixture", loopSubtaskMode: "fullstack",
      loopSubtaskFullstackCli: "codex", loopSubtaskFullstackConfigId: selection.activeConfigId,
      loopSubtaskFullstackModel: "native-fixture", configSelections };
    // Compose the production scheduler at its invocation ports. Keep the completed child open
    // to exercise presentation; production adapter auto-close is outside this scenario.
    host = createLoopPlusOrchestrationHost({
      maxConcurrency: 1, launchDelayMs: () => 0,
      readTask: api.readLoopTaskRecord,
      createTask: ({ cli, rootPrompt, sessionId, snapshot }: any) => {
        const task = api.createLoopTaskRecord(cli, rootPrompt, { sessionId });
        taskId = task.id;
        releaseOwnership = api.loopOrchestrationOwnership.acquire(taskId);
        return api.updateLoopTaskRecord(taskId, { schedulingMode: "event_driven", loopPlus: snapshot,
          loopSubtaskMode: "fullstack" });
      },
      updateTask: (id: string, patch: any) => {
        const result = api.updateLoopTaskRecord(id, patch);
        void api.postPanelState();
        return result;
      },
      appendMessage: (target: any, content: string, id: string) => api.appendSystemMessageForLoop(target, content,
        { taskRole: "main", loopTaskId: id, merge: false }),
      runMain: (request: any) => {
        if (request.kind === "review") review = request;
        const promise = api.runPrompt({ ...input, displayPrompt: request.prompt, modelPrompt: request.modelPrompt,
          taskRole: "main", loopTaskId: request.taskId, loopRound: request.kind === "initial" ? 1 : 2,
          skipLongTermMemoryPersist: true }, { targetTabId: parent.tabId }).then(() => {
            const messages = api.getLoopMessagesForTarget(parent);
            return [...messages].reverse().find((message: any) => message.role === "assistant")?.content ?? null;
          });
        return { promise, abort: () => api.cancelLoopPlusInvocation(parent.tabId) };
      },
      startAttempt: (request: any) => {
        child = api.createLoopSubtaskRunTarget("codex");
        const promise = api.runPrompt({ ...input, displayPrompt: request.prompt, modelPrompt: request.modelPrompt,
          taskRole: "subtask", loopTaskId: request.taskId, loopSubtaskId: request.subtaskId,
          loopSubtaskCli: "codex", loopSubtaskConfigId: selection.activeConfigId,
          loopRound: request.round, skipLongTermMemoryPersist: true }, { targetTabId: child.tabId }).then(() => {
            child.sessionId = api.getConversationTabById(child.tabId).sessionId;
            const run = [...api.readTaskStore().runs].reverse().find((item: any) => item.taskRole === "subtask");
            assert.ok(run, "actual interactive runtime persisted its run result");
            const messages = api.getLoopMessagesForTarget(child);
            return { outcome: run.status === "end" ? "completed" : "failed",
              detail: [...messages].reverse().find((message: any) => message.role === "assistant")?.content ?? null };
          });
        return { promise, abort: () => api.cancelLoopPlusInvocation(child.tabId) };
      },
    });
    host.tryRun(input, parent, { schedulingMode: "event_driven" });
    await until(() => turns.length === 1, "initial runner invocation");
    complete(turns[0], JSON.stringify({ status: "dispatch", subtasks: [{ id: "native-child", title: "隔离子任务",
      prompt: "Complete the isolated native-host fixture and report its result. Do not use any external service or modify real task records.",
      writeFiles: ["native-fixture.txt"], taskType: "backend", codingDelivery: true }] }));
    await until(() => turns.length === 2, "child runner invocation");
    await api.postPanelState();
    return { parent: parent.tabId, child: child.tabId, taskId };
  }
  if (name === "completeChild") {
    complete(turns[1], "隔离子任务已完成，等待主任务验收。");
    await until(() => review && turns.length === 3, "actual main review runner");
    checkCompletion();
    await api.postPanelState();
    return { reviewKind: review.kind, task: api.readLoopTaskRecord(taskId) };
  }
  if (name === "compact") {
    // Existing tests cover the five-minute automatic eligibility gate. Invoke its real
    // extension compaction entry here, after actual completion and while review is live.
    compactFlight = api.runContextCompaction({ silent: true, cli: "codex", tabId: child.tabId,
      sessionId: child.sessionId, timeoutMs: 30000 }, true);
    await until(() => compactions.length > 0, "native compactThread boundary");
    return { pending: true };
  }
  if (name === "rejectCompact") {
    compactions.shift().reject(Object.assign(new Error("CODEX_THREAD_HANDOFF_FAILED: native fixture rejection"),
      { code: "CODEX_THREAD_HANDOFF_FAILED" }));
    assert.equal(await compactFlight, false);
    checkCompletion();
    await api.postPanelState();
    return { compacted: false };
  }
  if (name === "refresh") {
    await api.postPanelState();
    checkCompletion();
    return { refreshed: true };
  }
  if (name === "newFailure") {
    const before = turns.length;
    executionFlight = api.runPrompt({ displayPrompt: "开始真正的新执行并验证错误仍可见", model: "native-fixture",
      skipLongTermMemoryPersist: true }, { targetTabId: child.tabId });
    await until(() => turns.length > before, "new execution runner");
    turns[turns.length - 1].reject(Object.assign(new Error("native fixture model not found"), { code: "MODEL_NOT_FOUND" }));
    await executionFlight;
    assert.equal(api.readTaskStore().runs.at(-1).status, "error");
    await api.postPanelState();
    return { status: "error" };
  }
  if (name === "finish") return { done: true };
  throw new Error(`Unknown action ${name}`);
}

export async function run(): Promise<void> {
  assert.ok(root && product, "Must run through the isolated launcher");
  assert.equal(path.resolve(require("node:os").homedir()), path.join(root, "home"));
  const { CodexInteractiveRunner } = load("interactive/codexRunner.js");
  const originals = { run: CodexInteractiveRunner.prototype.runStreamed, compact: CodexInteractiveRunner.prototype.compactThread,
    stop: CodexInteractiveRunner.prototype.stopAndRebuild };
  CodexInteractiveRunner.prototype.runStreamed = function (_prompt: string, handlers: any) {
    const threadId = this.getThreadId() || randomUUID();
    this.options.threadId = threadId;
    handlers.onThreadId(threadId);
    if (this.options.readOnly) {
      handlers.onAssistantDelta("原生宿主隔离验收", { codexFinalAnswer: true, assistantItemId: randomUUID() });
      return Promise.resolve();
    }
    evidence.events.push({ type: "runner-start", threadId });
    return new Promise((resolve, reject) => {
      const turn = { owner: this, handlers, threadId, settled: false,
        resolve: () => { turn.settled = true; resolve(undefined); },
        reject: (error: Error) => { turn.settled = true; reject(error); } };
      turns.push(turn);
    });
  };
  CodexInteractiveRunner.prototype.stopAndRebuild = function () {
    originals.stop.call(this);
    for (const turn of turns) {
      if (turn.owner === this && !turn.settled) turn.reject(Object.assign(new Error("Native fixture stopped"), { name: "AbortError" }));
    }
  };
  CodexInteractiveRunner.prototype.compactThread = function () {
    evidence.events.push({ type: "compactThread", threadId: this.getThreadId() });
    return new Promise((resolve, reject) => compactions.push({ resolve, reject }));
  };
  const extension = vscode.extensions.getExtension("sinitek.native-compaction-validation")!;
  const activated = await extension.activate();
  api = activated.native;
  const config = load("config/configService.js");
  const now = Date.now();
  await config.saveConfig({ id: "native-fixture", name: "原生验收隔离配置", platform: "codex",
    configContent: 'model = "native-fixture"\n', authContent: "{}", createdAt: now, updatedAt: now });
  await config.applyConfig("codex", { profileId: "native-fixture" });
  await api.loadConfigState("codex");
  await vscode.commands.executeCommand("sinitek-cli-tools.panelView.focus");
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const server = http.createServer(async (request, response) => {
    try {
      const name = new URL(request.url!, "http://localhost").pathname.slice(1);
      const result = await action(name);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
      if (name === "finish") finish();
    } catch (error) {
      evidence.error = error instanceof Error ? error.stack : String(error);
      response.writeHead(500); response.end(JSON.stringify({ error: evidence.error }));
      finish();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(root, "bridge.json"), JSON.stringify({ port: (server.address() as any).port, vscode: vscode.version }));
  const deadline = setTimeout(finish, 180000);
  try {
    await done;
  } finally {
    clearTimeout(deadline);
    if (host && taskId) await host.stopParent(taskId);
    releaseOwnership?.();
    api.stopAllRuns();
    api.deactivate();
    CodexInteractiveRunner.prototype.runStreamed = originals.run;
    CodexInteractiveRunner.prototype.compactThread = originals.compact;
    CodexInteractiveRunner.prototype.stopAndRebuild = originals.stop;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    evidence.closed = { server: !server.listening, runnerPatchesRestored: true, productDeactivated: true };
    fs.writeFileSync(path.join(root, "host-evidence.json"), JSON.stringify(evidence, null, 2));
  }
  if (evidence.error) throw new Error(evidence.error);
}
