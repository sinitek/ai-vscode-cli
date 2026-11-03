"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.argv.includes("--live")) {
  throw new Error("此验证会调用真实模型并产生费用；请构建后使用 --live 显式启动。");
}

require("../dist/test/vscodeMock").installVscodeMock();
const { CodexInteractiveRunner } = require("../dist/interactive/codexRunner");
const { createPromptRunModelsHost } = require("../dist/extensionHost/promptRunModels");
const { createLoopPlusRuntimeFixture } = require("../dist/test/extensionHost/fixtures/loopPlusRuntimeFixture");

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-model-live-"));
  const models = createPromptRunModelsHost({
    getActiveConfigIdForCli: () => null,
    getSelectedCliModel: () => "gpt-6.1-sol",
    getSelectedLoopCliModel: (_cli, role) => role === "main" ? "gpt-6.1-sol" : "gpt-6.1-terra",
    getSelectedLoopThinkingMode: (_cli, role) => role === "main" ? "high" : "low",
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    getEffectiveThinkingMode: () => "medium",
    getGlobalLoopSubtaskMaxThinkingMode: () => "xhigh",
    isThinkingMode: (value) => ["low", "medium", "high", "xhigh"].includes(value),
    resolveOpenCodeRoleModelsForConfig: () => { throw new Error("非 OpenCode 验证"); },
  });
  const fixture = createLoopPlusRuntimeFixture({
    maxConcurrency: 1,
    executionRootFactory: () => ({ cwd: workspace, dispose: () => {} }),
    resolveThinkingMode: (input, cli, role, model) => models.resolvePromptRunThinkingModeForRole(input, cli, role, model, { applySubtaskCap: role === "subtask" }),
  });
  fixture.target.sessionId = null;
  const runners = new Map();
  const calls = [];
  const failures = [];
  let taskId;
  const deadline = setTimeout(() => {
    for (const runner of runners.values()) runner.dispose();
    console.error("真实 Loop+ 验证超过 8 分钟");
    process.exit(1);
  }, 480000);

  const invoke = async (input, tabId) => {
    taskId = input.loopTaskId;
    if (failures.length > 0) throw new Error("真实 CLI 调用失败，停止后续请求");
    console.log(JSON.stringify({ phase: "binding", role: input.taskRole, model: input.model, effort: input.thinkingModeOverride }));
    const expectedModel = input.taskRole === "main" ? "gpt-6.1-sol" : "gpt-6.1-terra";
    const expectedEffort = input.taskRole === "main" ? "high" : "low";
    assert.equal(input.model, expectedModel);
    assert.equal(input.thinkingModeOverride, expectedEffort);
    const target = tabId === fixture.target.tabId ? fixture.target : fixture.createdSubtaskTargets.find((item) => item.tabId === tabId);
    assert.ok(target, "真实调用必须绑定明确的目标 Tab");
    let runner = runners.get(tabId);
    if (!runner) {
      runner = new CodexInteractiveRunner({
        command: process.env.CODEX_COMMAND || "codex",
        args: ["--model", input.model],
        cwd: input.executionCwd || workspace,
        thinkingMode: input.thinkingModeOverride,
        interactiveMode: "coding",
        model: input.model,
        threadId: null,
      });
      runners.set(tabId, runner);
    }
    let content = "";
    let threadId = target.sessionId;
    console.log(JSON.stringify({ phase: "start", role: input.taskRole, model: input.model, effort: input.thinkingModeOverride }));
    try {
      await runner.runStreamed(input.modelPrompt, {
        onAssistantDelta: (chunk) => { content += chunk; },
        onTrace: () => {},
        onTaskListUpdate: () => {},
        onThreadId: (value) => { threadId = value; },
        onRequest: () => null,
      });
    } catch (error) {
      const failure = { role: input.taskRole, model: input.model, effort: input.thinkingModeOverride, threadId, error: String(error) };
      failures.push(failure);
      console.error(JSON.stringify(failure));
      throw error;
    }
    assert.ok(threadId, "真实 runner 必须返回 session ID");
    target.sessionId = threadId;
    const call = { role: input.taskRole, model: input.model, effort: input.thinkingModeOverride, threadId };
    calls.push(call);
    fs.writeFileSync(path.join(workspace, `response-${calls.length}.txt`), content);
    console.log(JSON.stringify({ phase: "end", ...call, responseLength: content.length }));
    fixture.publish(input, tabId, { status: "end", content });
  };
  fixture.setAttemptAction(invoke);
  for (let count = 0; count < 8; count += 1) fixture.queueMain(invoke);
  try {
    const prompt = "这是隔离工作区的 Loop+ 模型路由真实验收。必须先派发且只派发一个 backend 编码子任务（不是 general）：创建 result.txt，内容严格为 MODEL_ROUTING_OK。子任务自行读回验证并汇报。主任务不得代写文件；收到子任务报告后亲自读文件验收，按提示协议返回完整 JSON 完成。没有其它交付，不要提交或联网。";
    await fixture.adapter.runEventDriven({
      displayPrompt: prompt, modelPrompt: prompt, contextTags: [],
      model: "gpt-6.1-sol", loopMainModel: "gpt-6.1-sol", loopMainThinkingMode: "high",
      loopSubtaskCli: "codex", loopSubtaskModel: "gpt-6.1-terra", loopSubtaskThinkingMode: "low",
      loopSubtaskFullstackCli: "codex", loopSubtaskFullstackModel: "gpt-6.1-terra", loopSubtaskFullstackThinkingMode: "low",
      loopSubtaskMode: "fullstack",
    }, { schedulingMode: "event_driven" }, fixture.target);
    assert.equal(fixture.readTask(taskId)?.status, "completed");
    assert.equal(fixture.attemptCalls.length, 1);
    assert.ok(fixture.mainCalls.length >= 2);
    assert.equal(fs.readFileSync(path.join(workspace, "result.txt"), "utf8").trim(), "MODEL_ROUTING_OK");
    const sessionsDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
    const sessionFiles = fs.readdirSync(sessionsDir, { recursive: true }).map((entry) => String(entry));
    for (const call of calls) {
      const sessionFile = sessionFiles.find((entry) => entry.endsWith(`${call.threadId}.jsonl`));
      assert.ok(sessionFile, "真实 Codex session 记录必须存在");
      const contexts = fs.readFileSync(path.join(sessionsDir, sessionFile), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.type === "turn_context");
      assert.ok(contexts.some((event) => event.payload.model === call.model && event.payload.effort === call.effort), "session turn_context 必须确认实际模型与思考力度");
      call.confirmedBySession = true;
    }
    const result = { passed: true, taskStatus: "completed", calls, output: "MODEL_ROUTING_OK" };
    fs.writeFileSync(path.join(workspace, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, evidencePath: path.join(workspace, "result.json") }, null, 2));
  } catch (error) {
    failures.push(String(error));
    fs.writeFileSync(path.join(workspace, "failure.json"), JSON.stringify({ calls, failures, task: fixture.readTask(taskId), hostMessages: fixture.hostMessages }, null, 2));
    console.error(`真实验证失败，证据目录：${workspace}`);
    throw error;
  } finally {
    clearTimeout(deadline);
    for (const runner of runners.values()) runner.dispose();
    fixture.dispose();
  }
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
