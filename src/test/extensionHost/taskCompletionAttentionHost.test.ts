import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import vm = require("node:vm");
import ts = require("typescript");
import { notifyTaskRunCompletion } from "../../taskCompletionAttention";
import type { TaskRunRecord } from "../../promptRunState";

const extensionSource = fs.readFileSync(path.join(process.cwd(), "src/extension.ts"), "utf8");
const syntax = ts.createSourceFile("extension.ts", extensionSource, ts.ScriptTarget.ES2020, true);
const functionNames = ["appendTaskRun", "finalizeTaskRun", "appendCompletionMessage"];
const script = ts.transpileModule(syntax.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement) && functionNames.includes(statement.name?.text ?? ""),
).map((statement) => statement.getText(syntax)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function runRecord(patch: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    id: "run", cli: "codex", sessionId: null, prompt: "测试任务", startedAt: 1,
    endedAt: 2, durationMs: 1, status: "end", ...patch,
  };
}

function harness() {
  const completions: string[] = [];
  const store = { runs: [] as TaskRunRecord[] };
  const primaryPromptRunController = {
    activeRunId: "run",
    activeTaskRun: runRecord(),
    activeCompletionSent: false,
    activeMessageTarget: [] as unknown[],
  };
  const sandbox = {
    primaryPromptRunController,
    humanInteractionAttention: { taskCompleted: async (eventId: string) => { completions.push(eventId); } },
    notifyTaskRunCompletion,
    readTaskStore: () => store,
    writeTaskStore: () => undefined,
    createMessageId: () => "message",
    buildTaskRunCompletionText: () => "完成",
    appendMessageToStore: (messages: unknown[], message: unknown) => { messages.push(message); },
    sendPanelMessage: () => undefined,
    appendTaskRun: (_record: TaskRunRecord, _options?: { notifyCompletion?: boolean }) => undefined,
    appendCompletionMessage: (_status: string, _options?: { notifyCompletion?: boolean }) => undefined,
  };
  vm.runInNewContext(script, sandbox);
  return { ...sandbox, completions, store };
}

test("shared persisted run recording notifies successful Vibe once and filters Loop intermediate calls", () => {
  const env = harness();
  env.appendTaskRun(runRecord());
  env.appendTaskRun(runRecord({ id: "child", taskRole: "subtask", loopTaskId: "parent" }));
  env.appendTaskRun(runRecord({ id: "main-round", taskRole: "main", loopTaskId: "parent" }));
  env.appendTaskRun(runRecord({ id: "error", status: "error" }));
  env.appendTaskRun(runRecord({ id: "stopped", status: "stopped" }));
  assert.equal(env.store.runs.length, 5);
  assert.deepEqual(env.completions, ["vibe:run"]);
});

test("one-shot completion finalization notifies only once and context compaction stays silent", () => {
  const ordinary = harness();
  ordinary.appendCompletionMessage("end");
  ordinary.appendCompletionMessage("end");
  assert.equal(ordinary.store.runs.length, 1);
  assert.deepEqual(ordinary.completions, ["vibe:run"]);
  const compact = harness();
  compact.appendCompletionMessage("end", { notifyCompletion: false });
  assert.equal(compact.store.runs.length, 1);
  assert.deepEqual(compact.completions, []);
});

test("persist failures do not emit a successful completion notification", () => {
  const env = harness();
  env.writeTaskStore = () => { throw new Error("存储写入失败"); };
  const sandbox = { ...env };
  vm.runInNewContext(script, sandbox);
  assert.throws(() => sandbox.appendTaskRun(runRecord()), /存储写入失败/);
  assert.deepEqual(env.completions, []);
});

test("interactive and parallel runtimes use the shared run recorder and all completion entry points are connected", () => {
  for (const file of ["promptInteractiveRuntime.ts", "promptParallelRuntime.ts"]) {
    const source = fs.readFileSync(path.join(process.cwd(), "src/extensionHost", file), "utf8");
    assert.match(source, /appendTaskRun\(taskRecord\)/);
  }
  assert.match(extensionSource, /notifyLoopTaskCompletion\(humanInteractionAttention, decisionRunResult\.task\)/);
  assert.match(extensionSource, /appendCompletionMessage: \(status\) => appendCompletionMessage\(status, \{ notifyCompletion: false \}\)/);
  assert.match(extensionSource, /onTaskCompleted: \(taskId\) =>/);
  const adapter = fs.readFileSync(path.join(process.cwd(), "src/extensionHost/loopPlusRuntimeAdapter.ts"), "utf8");
  assert.match(adapter, /onTaskCompleted: deps\.onTaskCompleted/);
});

test("completion notification settings are independently application scoped and enabled by default", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  for (const name of ["taskCompletionNotifications", "taskCompletionWindowAttention"]) {
    const property = manifest.contributes.configuration.properties[`sinitek-cli-tools.${name}`];
    assert.equal(property.default, true);
    assert.equal(property.scope, "application");
    assert.match(property.description, /子任务/);
  }
});
