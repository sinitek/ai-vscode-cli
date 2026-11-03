import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import os = require("os");
import path = require("path");

import { CLI_LIST, type CliName } from "../../cli/types";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import { installVscodeMock } from "../vscodeMock";
import { withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
import { buildStructuredSvgSummaryPromptInstruction } from "../../finalAnswerProtocol";

installVscodeMock();

const { createLoopOrchestrationHost } = require("../../extensionHost/loopOrchestration") as typeof import("../../extensionHost/loopOrchestration");
const {
  createLoopPlusRuntimeFixture,
  waitForLoopPlus,
} = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");

function loopTask(overrides: Partial<LoopTaskRecord> = {}): LoopTaskRecord {
  return {
    id: "task-1",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/loop-tasks.json",
    rootPrompt: "ship it",
    schedulingMode: "classic",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    maxRounds: 3,
    currentRound: 1,
    communicationDir: "/tmp/loop-comm",
    mainCommunicationFile: "/tmp/loop-comm/main.md",
    sessionId: "main-session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    ...overrides,
  };
}

test("classic Loop trusts reports, delegates only required verification and keeps optional SVG guidance", async () => {
  const task = loopTask();
  const prompts: string[] = [];
  const host = createLoopOrchestrationHost({
    getLoopCommunicationPaths: () => ({ dir: task.communicationDir, mainFile: task.mainCommunicationFile, subtasksDir: "/tmp/loop-comm/subtasks" }),
    normalizeLoopContinuePromptForPrompt: () => null,
    buildLoopSupplementalRequirementsLines: () => [],
    buildLoopMainSubChatTranscriptFile: () => "/tmp/loop-comm/chat.md",
    isLoopTaskExecutionInterrupted: () => false,
    readLoopTaskRecord: () => task,
    updateLoopTaskRecord: () => task,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: () => undefined,
    resolvePromptRunThinkingModeForRole: () => undefined,
    runPrompt: async (input: PromptRunInput) => { prompts.push(input.modelPrompt); },
    resolveLoopTaskSessionId: () => null,
    getLoopRoundRunStatus: () => "stopped",
    appendLoopRound: () => undefined,
    buildLoopRoundSummary: () => "已中断",
  } as never);

  const result = await host.runClassicLoopMainDecision({
    input: { displayPrompt: task.rootPrompt, modelPrompt: task.rootPrompt, contextTags: [] },
    target: { tabId: "main-tab", cli: "codex", sessionId: null },
    task,
    round: 1,
  });
  assert.equal(result.status, "interrupted");
  assert.equal(result.runStatus, "stopped");
  assert.equal(prompts.length, 1);
  for (const prompt of prompts) {
    assert.ok(prompt.includes(buildStructuredSvgSummaryPromptInstruction("finalSummary")));
    assert.doesNotMatch(prompt, /\[final_answer\]/u);
    assert.match(prompt, /相信子任务汇报的结果/u);
    assert.match(prompt, /主任务不验收子任务产物，不检查代码、文档或实现细节/u);
    assert.match(prompt, /不运行或重复运行测试、构建、启动和其它验证/u);
    assert.match(prompt, /只有用户明确要求或项目既有规则要求[\s\S]*独立的验收或测试子任务/u);
    assert.match(prompt, /两者都未要求时默认不做/u);
    assert.match(prompt, /用户未提但项目规则要求的任务完成后测试同样必须独立派发，不能遗漏/u);
    assert.match(prompt, /原始目标以及用户或项目规则要求的独立验收、测试任务都已完成时，返回 completed/u);
    assert.match(prompt, /子任务遵循项目既有规则自主完成工作/u);
    assert.match(prompt, /不要求 acceptance、requirementCoverage 或 roundSummaries/u);
    assert.doesNotMatch(prompt, /主模型必须先把可执行界面设计写进 prompt|派发时禁止只给粗粒度目标/u);
  }
});

for (const subtaskCli of CLI_LIST) {
for (const mainCli of [subtaskCli, subtaskCli === "codex" ? "grok" : "codex"] as const) {
  const sameCli = subtaskCli === mainCli;
for (const reuseSession of [false, true]) {
test(`classic Loop ${reuseSession ? "restores a continuous task session" : "creates a fresh task session"} from ${mainCli} on ${subtaskCli}`, async () => {
  const created: PromptRunTarget[] = [];
  const systemMessages: Array<{ tabId: string; content: string }> = [];
  const prompts: Array<{ input: PromptRunInput; targetTabId?: string }> = [];
  const parent: PromptRunTarget = { tabId: "main-tab", cli: mainCli, sessionId: "main-session" };
  const task = loopTask({
    cli: mainCli,
    modelRouting: {
      main: { model: "gpt-main" },
      subtask: { cli: subtaskCli, model: "gpt-6.1-terra", ...(sameCli ? {} : { configId: "claude-config" }) },
    },
    originProfile: { configId: "codex-config", subtaskThinkingMode: "high" },
    subTasks: reuseSession ? [{ id: "previous", title: "此前任务", status: "completed", executionSession: { cli: subtaskCli, configId: "claude-config", sessionId: "claude-previous" } }] : [],
  });
  const host = createLoopOrchestrationHost({
    getActiveConfigIdForCli: () => "claude-config",
    t: (key: string) => key,
    appendSystemMessageForLoop: (target: PromptRunTarget, content: string) => {
      systemMessages.push({ tabId: target.tabId, content });
    },
    createMessageId: () => "message-1",
    getLoopMessagesForTarget: () => [],
    appendMessageToStore: (messages: unknown[], message: unknown) => { (messages as unknown[]).push(message); },
    persistLoopMessagesForTarget: () => undefined,
    sendPanelMessage: () => undefined,
    buildSubagentProgressLabels: () => ({ title: "subtask", waiting: "waiting", completed: "done", failed: "failed", interrupted: "stopped" }),
    createSubagentProgressController: () => ({ getMessage: () => null, update: () => undefined }),
    createLoopSubtaskProgressMonitor: () => ({ start: () => undefined, sync: () => undefined, finish: () => undefined }),
    createLoopSubtaskRunTarget: (cli: CliName, options?: { sessionId?: string | null }) => {
      const target = { tabId: `sub-${cli}`, cli, sessionId: options?.sessionId ?? null };
      created.push(target);
      return target;
    },
    prepareLoopSubtaskCommunicationFile: () => "/tmp/loop-comm/sub.md",
    buildLoopSubtaskStartedText: () => "started",
    appendLoopMainSubChatSubtaskStarted: () => undefined,
    getLoopSubtaskDisplayTitle: (_index: number, subtask: { title?: string }) => subtask.title ?? "subtask",
    formatLoopGroupChatMemberName: (title: string) => title,
    ensureLoopMainSubChatTranscript: () => "/tmp/loop-comm/main.md",
    appendTextFileEnsuringDir: () => undefined,
    getLastLoopAssistantContent: () => "done",
    mapLoopRunStatusToSubagentStatus: () => "completed",
    switchVisibleConversationTabForLoop: async () => undefined,
    isLoopTaskExecutionInterrupted: () => false,
    readLoopTaskRecord: () => task,
    getActiveLoopSubtaskIds: () => [],
    updateLoopTaskRecord: () => task,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: (input: PromptRunInput) => input.loopSubtaskModel ?? input.model,
    resolvePromptRunThinkingModeForRole: (input: PromptRunInput) => input.loopSubtaskThinkingMode,
    runPrompt: async (input: PromptRunInput, options: { targetTabId?: string }) => {
      prompts.push({ input, targetTabId: options.targetTabId });
    },
    getLoopRoundRunStatus: () => "end",
    appendLoopRound: () => undefined,
    buildLoopRoundSummary: () => "summary",
    finalizeLoopSubtaskRun: async () => undefined,
    resolvePromptRunTargetSessionId: () => null,
  } as never);

  const status = await host.runLoopSubtasksBatchWithRetry({
    input: { displayPrompt: "ship it", modelPrompt: "ship it", contextTags: [], model: "gpt-6.1-sol", loopSubtaskModel: "stale-subtask-model", loopSubtaskThinkingMode: "low" },
    target: parent,
    task,
    round: 1,
    subtasks: [{ ...(reuseSession ? { continueFromSubtaskId: "previous" } : {}), id: "sub-1", title: "Implement", prompt: "do the work", status: "pending" }],
  });

  assert.equal(status[0]?.status, "end");
  assert.equal(parent.cli, mainCli);
  assert.equal(parent.sessionId, "main-session");
  assert.equal(created.length, 1);
  assert.equal(created[0]?.cli, subtaskCli);
  assert.equal(created[0]?.sessionId, reuseSession ? "claude-previous" : null);
  assert.equal(created[0]?.tabId, `sub-${subtaskCli}`);
  assert.notEqual(prompts[0]?.targetTabId, parent.tabId);
  assert.equal(prompts[0]?.input.loopSubtaskCli, sameCli ? undefined : subtaskCli);
  assert.equal(prompts[0]?.input.loopSubtaskConfigId, "claude-config");
  assert.equal(prompts[0]?.input.loopSubtaskModel, "gpt-6.1-terra");
  assert.equal(prompts[0]?.input.model, "gpt-6.1-terra");
  assert.equal(prompts[0]?.input.loopSubtaskThinkingMode, "high");
  assert.equal(prompts[0]?.input.thinkingModeOverride, "high");
  assert.equal(prompts[0]?.input.taskRole, "subtask");
  assert.equal(prompts[0]?.input.loopSubtaskId, "sub-1");
  assert.match(prompts[0]?.input.modelPrompt ?? "", /遵循用户要求和项目既有规则，自主选择完成任务的方法/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /主任务将信任你的汇报判断整体进度/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /验收、测试由主任务另行安排独立子任务/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /否则报告相关要求，供主任务安排/u);
  assert.doesNotMatch(prompts[0]?.input.modelPrompt ?? "", /如果当前子任务写了界面设计，按该设计实现/u);
  assert.ok(systemMessages.some((message) => message.tabId === parent.tabId && message.content === "started"));
  assert.equal(systemMessages.some((message) => message.tabId === created[0]?.tabId), false);
});

}
}
}

test("classic Loop refuses a missing cross-CLI config instead of running the main CLI", async () => {
  const created: CliName[] = [];
  const task = loopTask({
    modelRouting: {
      main: { model: "gpt-main" },
      subtask: { cli: "grok" },
    },
  });
  const messages: string[] = [];
  const host = createLoopOrchestrationHost({
    appendSystemMessageForLoop: (_target: PromptRunTarget, message: string) => { messages.push(message); },
    markLoopSubtaskRunFinished: () => undefined,
    createLoopSubtaskRunTarget: (cli: CliName) => {
      created.push(cli);
      return { tabId: "should-not-run", cli, sessionId: null };
    },
  } as never);
  const status = await host.runLoopSubtasksBatchWithRetry({
    input: { displayPrompt: "ship it", modelPrompt: "ship it", contextTags: [] },
    target: { tabId: "main-tab", cli: "codex", sessionId: "main-session" },
    task,
    round: 1,
    subtasks: [{ id: "sub-1", title: "Implement", prompt: "do the work", status: "pending" }],
  });
  assert.equal(status[0]?.status, "error");
  assert.deepEqual(created, []);
  assert.equal(messages.includes("目标 CLI 没有可用配置，不能派发子任务。"), true);
});

test("Loop+ attempt target uses the bound sub CLI while the main target stays unchanged", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: JSON.stringify(withLoopPlusAcceptReviews({
          status: "dispatch",
          acceptance: { passed: false, checks: [] },
          subtasks: [{
            id: "A",
            title: "A",
            prompt: "Implement A without editing the parent task record or scheduler snapshot. Write scope: src/a.ts. Report only the attempt result.",
            writeFiles: ["src/a.ts"],
          }],
        })),
      });
    });
    const running = fixture.adapter.runEventDriven({
      displayPrompt: "ship it",
      modelPrompt: "ship it",
      contextTags: [],
      model: "main-model",
      loopMainModel: "main-model",
      loopSubtaskCli: "claude",
      loopSubtaskConfigId: "claude-config",
      loopSubtaskThinkingMode: "high",
    }, { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.createdSubtaskTargets.length === 1, "cross-cli attempt");
    assert.equal(fixture.target.cli, "codex");
    assert.equal(fixture.target.sessionId, "session");
    assert.equal(fixture.createdSubtaskTargets[0]?.cli, "claude");
    assert.notEqual(fixture.createdSubtaskTargets[0]?.tabId, fixture.target.tabId);
    const attempt = fixture.attemptCalls[0];
    assert.equal(attempt?.loopSubtaskCli, "claude");
    assert.equal(attempt?.loopSubtaskConfigId, "claude-config");
    assert.equal(attempt?.loopSubtaskModel, undefined);
    assert.equal(attempt?.taskRole, "subtask");
    assert.equal(fixture.mainCalls[0]?.taskRole, "main");
    assert.equal(fixture.mainCalls[0]?.loopSubtaskCli, "claude");
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});
