import { LOOP_BLOCKER_EXAMPLE } from "../../loopBlocker";
import { buildLoopBlockerSummary } from "../../loopBlocker";
import type { LoopMainDecision } from "../../loopTaskStore";
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
import { LOOP_BLOCKED_SUMMARY_EXAMPLE, LOOP_BLOCKED_SUMMARY_INSTRUCTION } from "../../loopBlockedSummary";
import { LOOP_DIRECT_EXECUTION_RULE_ZH } from "../../loopDirectExecutionPolicy";
import { buildLoopSubtaskExecutionPlan } from "../../loopParallel";
import { buildResetLoopMainAiFailureState } from "../../loopMainFailure";

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

test("classic Loop automatically requests one complete diagnosis and can continue useful work", async () => {
  const completeBlock: LoopMainDecision = {
    status: "blocked", blocker: LOOP_BLOCKER_EXAMPLE,
    finalSummary: buildLoopBlockerSummary(LOOP_BLOCKER_EXAMPLE),
  };
  for (const correction of [completeBlock,
    { ...completeBlock, blocker: { ...LOOP_BLOCKER_EXAMPLE, recoveryOptions: [
      { label: "使用仓库工具", action: "调用已有本地工具。", verification: "在任务环境验证构建。" },
    ] } },
    { status: "continue", subtasks: [{ id: "repair", title: "修复依赖", prompt: "在已授权范围内修复项目依赖。" }] },
    { status: "blocked", finalSummary: "还是受阻" }, null,
  ] as Array<LoopMainDecision | null>) {
    let stored = loopTask();
    const prompts: string[] = [];
    let calls = 0;
    let removed = 0;
    let applied: LoopMainDecision | undefined;
    const host = createLoopOrchestrationHost({
      errorToMessage: (error: unknown) => String(error),
      logError: async () => undefined,
      getLoopCommunicationPaths: () => ({ dir: "comm", mainFile: "main.md", subtasksDir: "subtasks" }),
      normalizeLoopContinuePromptForPrompt: () => null,
      buildLoopSupplementalRequirementsLines: () => [],
      buildLoopMainSubChatTranscriptFile: () => "chat.md",
      isLoopTaskExecutionInterrupted: () => false,
      readLoopTaskRecord: () => stored,
      getActiveLoopSubtaskIds: (record: LoopTaskRecord) => record.activeSubtaskIds ?? [],
      updateLoopTaskRecord: (_id: string, patch: Partial<LoopTaskRecord>) => (stored = { ...stored, ...patch }),
      refreshOpenLoopGroupChatPanelForTask: () => undefined,
      resolvePromptRunModelForRole: () => undefined,
      resolvePromptRunThinkingModeForRole: () => undefined,
      runPrompt: async (input: PromptRunInput) => { prompts.push(input.modelPrompt); },
      resolveLoopTaskSessionId: () => null,
      getLoopRoundRunStatus: () => "end",
      appendLoopRound: () => undefined,
      buildLoopRoundSummary: () => "调用已结束",
      getLastLoopAssistantContent: () => "reply",
      parseLoopMainDecision: () => calls++ === 0 ? { status: "blocked", finalSummary: "缺少工具" } : correction,
      removeLoopMainDecisionMessage: () => { removed += 1; },
      buildResetLoopMainAiFailureState: () => ({}),
      applyLoopMainDecision: (_id: string, decision: LoopMainDecision) => {
        applied = decision;
        stored = { ...stored, status: decision.status === "blocked" ? "needs-review" : "running", finalSummary: decision.finalSummary };
        return { status: decision.status, task: stored, subtasks: decision.subtasks };
      },
    } as never);
    const result = await host.runClassicLoopMainDecision({
      input: { displayPrompt: stored.rootPrompt, modelPrompt: stored.rootPrompt, contextTags: [] },
      target: { tabId: "main-tab", cli: "codex", sessionId: null }, task: stored, round: 1,
    });
    assert.equal(prompts.length, 2);
    assert.equal(removed, 1, "补充前移除旧阻塞协议气泡，避免两份结果并列");
    assert.match(prompts[1], /熔断诊断补充（本轮仅一次）/);
    assert.match(prompts[1], /缺少工具/);
    assert.match(prompts[1], /可推进就返回 continue/);
    assert.notEqual(stored.status, "completed");
    if (correction?.status === "continue") {
      assert.equal(result.status, "continue");
      assert.equal(applied?.subtasks?.[0].id, "repair");
    } else if (correction?.blocker?.recoveryOptions) {
      assert.equal(result.status, "awaiting-input");
      assert.equal(applied?.clarification?.formFields[0]?.options?.[0]?.label, "使用仓库工具");
      assert.equal(stored.status, "running");
    } else if (correction?.blocker) {
      assert.equal(result.status, "needs-review");
      assert.equal(applied?.finalSummary, completeBlock.finalSummary);
    } else {
      assert.equal(result.status, "needs-review");
      assert.match(stored.finalSummary ?? "", /熔断诊断未补齐/);
      assert.match(stored.finalSummary ?? "", correction ? /还是受阻/ : /缺少工具/);
    }
  }
});

for (const mutateInPlace of [false, true]) {
  test(`classic Loop rechecks supplements arriving during completion (${mutateInPlace ? "mutable" : "immutable"} record)`, async () => {
    const task = loopTask();
    let stored = task;
    const prompts: string[] = [];
    let applied = 0;
    const host = createLoopOrchestrationHost({
      getLoopCommunicationPaths: () => ({ dir: task.communicationDir, mainFile: task.mainCommunicationFile, subtasksDir: "/tmp/loop-comm/subtasks" }),
      normalizeLoopContinuePromptForPrompt: () => null,
      buildLoopSupplementalRequirementsLines: (record: LoopTaskRecord) => record.supplementalRequirements ?? [],
      buildLoopMainSubChatTranscriptFile: () => "/tmp/loop-comm/chat.md",
      isLoopTaskExecutionInterrupted: () => false,
      readLoopTaskRecord: () => stored,
      getActiveLoopSubtaskIds: (record: LoopTaskRecord) => record.activeSubtaskIds ?? [],
      updateLoopTaskRecord: (_taskId: string, patch: Partial<LoopTaskRecord>) => {
        stored = mutateInPlace ? Object.assign(stored, patch) : { ...stored, ...patch };
        return stored;
      },
      refreshOpenLoopGroupChatPanelForTask: () => undefined,
      resolvePromptRunModelForRole: () => undefined,
      resolvePromptRunThinkingModeForRole: () => undefined,
      runPrompt: async (input: PromptRunInput) => {
        prompts.push(input.modelPrompt);
        if (prompts.length === 1) {
          const requirements = ["主模型忙碌期间追加的需求"];
          if (mutateInPlace) {
            stored.supplementalRequirements?.push(...requirements);
          } else {
            stored = { ...stored, supplementalRequirements: requirements };
          }
        }
      },
      resolveLoopTaskSessionId: () => null,
      getLoopRoundRunStatus: () => "end",
      appendLoopRound: () => undefined,
      buildLoopRoundSummary: () => "主模型已回答",
      getLastLoopAssistantContent: () => "completed decision",
      parseLoopMainDecision: () => ({ status: "completed", finalSummary: "完成" }),
      buildResetLoopMainAiFailureState: () => ({}),
      applyLoopMainDecision: () => {
        applied += 1;
        stored = { ...stored, status: "completed" };
        return { status: "completed", task: stored };
      },
    } as never);
    const options = {
      input: { displayPrompt: task.rootPrompt, modelPrompt: task.rootPrompt, contextTags: [] },
      target: { tabId: "main-tab", cli: "codex" as const, sessionId: null },
      task,
      round: 1,
    };

    const pending = await host.runClassicLoopMainDecision(options);
    assert.equal(pending.status, "pending-requirements");
    assert.equal(stored.status, "running");
    assert.equal(applied, 0);

    const completed = await host.runClassicLoopMainDecision({ ...options, task: pending.task });
    assert.equal(completed.status, "completed");
    assert.equal(applied, 1);
    assert.match(prompts[1], /主模型忙碌期间追加的需求/u);
  });
}

test("classic Loop reuses reported verification, delegates only gaps or explicit independent checks and keeps optional SVG guidance", async () => {
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

  for (const round of [1, 2, 5]) {
    const result = await host.runClassicLoopMainDecision({
      input: { displayPrompt: task.rootPrompt, modelPrompt: task.rootPrompt, contextTags: [] },
      target: { tabId: "main-tab", cli: "codex", sessionId: null },
      task,
      round,
    });
    assert.equal(result.status, "interrupted");
    assert.equal(result.runStatus, "stopped");
  }
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.ok(prompt.includes(LOOP_DIRECT_EXECUTION_RULE_ZH));
    assert.match(prompt, /包括首次需求、补充需求、继续指令和收尾事项/);
    assert.match(prompt, /不使用文件数、行数、标题关键词或扩展名作为机械白名单/);
    assert.match(prompt, /独立的简单补充事项可在本轮直接完成/);
    assert.doesNotMatch(prompt, /主任务不要直接执行具体代码\/文件修改/);
    assert.ok(prompt.includes(buildStructuredSvgSummaryPromptInstruction("finalSummary")));
    assert.ok(prompt.includes(LOOP_BLOCKED_SUMMARY_INSTRUCTION));
    assert.ok(prompt.includes(JSON.stringify({ status: "blocked", blocker: LOOP_BLOCKER_EXAMPLE, finalSummary: LOOP_BLOCKED_SUMMARY_EXAMPLE })));
    assert.doesNotMatch(prompt, /\[final_answer\]/u);
    assert.match(prompt, /相信子任务汇报的结果/u);
    assert.match(prompt, /当前总体进度：0%/u);
    assert.match(prompt, /总体进度 progressPercent 根据原始目标、全部补充需求、已结束批次的子任务汇报和剩余工作判断/u);
    assert.match(prompt, /只在一个批次全部结束、准备下一批次的主任务决策时重新估算/u);
    assert.match(prompt, /不为估算进度执行验收/u);
    assert.match(prompt, /主任务不验收子任务产物，不检查代码、文档或实现细节/u);
    assert.match(prompt, /不运行或重复运行测试、构建、启动和其它验证/u);
    assert.match(prompt, /子任务已明确汇报通过且覆盖当前改动的验证，直接采信并复用，不再另派重复验证任务/u);
    assert.match(prompt, /两者都未要求时默认不做/u);
    assert.match(prompt, /部分覆盖时只补缺失或失败项，后续改动使原结果失效时只补受影响项，不无理由重跑整套验证/u);
    assert.match(prompt, /汇报不清时优先续接来源子任务补充验证范围、命令或操作及结果说明，不因缺少报告细节直接要求重测/u);
    assert.match(prompt, /只有用户或项目规则明确要求独立验收或交叉复核，且尚无满足该独立要求的有效汇报时，才必须另派相应子任务/u);
    assert.match(prompt, /已有符合独立要求且仍有效的结果也直接复用/u);
    assert.match(prompt, /实现后集成验证若未被现有有效结果覆盖，仅补该缺口/u);
    assert.match(prompt, /历史沟通模板或旧派发提示中的默认独立验证要求，不算用户或项目明确要求/u);
    assert.match(prompt, /要求测试、构建不等于要求独立验证/u);
    assert.match(prompt, /用户未提但项目规则要求的验证不能遗漏/u);
    assert.match(prompt, /原始目标以及用户或项目规则要求的验证均已完成，且现有结果仍覆盖当前改动时，返回 completed/u);
    assert.match(prompt, /需要补充验证时，在 prompt 中说明要求来源、已有验证结果、剩余缺口和本次范围/u);
    assert.match(prompt, /不要把已覆盖且仍有效的验证重复派发/u);
    assert.match(prompt, /明确要求的独立验收或交叉复核仍须完成，不因复用普通测试结果而省略/u);
    assert.doesNotMatch(prompt, /验收、测试必须单独派发子任务|任务完成后测试同样必须独立派发|必需的独立验收、测试任务/u);
    assert.match(prompt, /子任务遵循项目既有规则自主完成工作/u);
    assert.match(prompt, /不要求 acceptance、requirementCoverage 或 roundSummaries/u);
    assert.doesNotMatch(prompt, /主模型必须先把可执行界面设计写进 prompt|派发时禁止只给粗粒度目标/u);
  }
});

for (const mainCli of CLI_LIST) {
test(`Loop+ ${mainCli} directly handles initial and supplemental work without child sessions`, async () => {
  const fixture = createLoopPlusRuntimeFixture({ cli: mainCli });
  const firstFile = path.join(fixture.rootDir, "direct-first.txt");
  const supplementalFile = path.join(fixture.rootDir, "direct-supplemental.txt");
  let taskId: string | undefined;
  try {
    fixture.queueMain(async (input, tabId) => {
      await new Promise((resolve) => setImmediate(resolve));
      taskId = input.loopTaskId;
      assert.equal(input.taskRole, "main");
      assert.match(input.modelPrompt, /Direct completion available: yes/);
      fs.writeFileSync(firstFile, "首次事项已完成", "utf8");
      assert.equal(fixture.adapter.host().submitUserMessage(taskId ?? "", "处理一个独立简单补充事项"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: JSON.stringify({ status: "completed", directCompletion: true, answerConclusion: "首次完成", finalSummary: "首次事项已直接处理" }),
      });
    });
    fixture.queueMain((input, tabId) => {
      assert.match(input.modelPrompt, /处理一个独立简单补充事项/);
      assert.match(input.modelPrompt, /Direct completion available: yes/);
      fs.writeFileSync(supplementalFile, "补充事项已完成", "utf8");
      fixture.publish(input, tabId, {
        status: "end",
        content: JSON.stringify({ status: "completed", directCompletion: true, answerConclusion: "全部完成", finalSummary: "首次和补充事项均直接完成，未派发子任务" }),
      });
    });
    assert.equal(await fixture.adapter.runEventDriven({
      displayPrompt: "处理一个明确、低风险的简单事项",
      modelPrompt: "处理一个明确、低风险的简单事项",
      contextTags: [], loopSubtaskMode: "fullstack",
    }, { schedulingMode: "event_driven" }, fixture.target), true);
    assert.equal(fs.readFileSync(firstFile, "utf8"), "首次事项已完成");
    assert.equal(fs.readFileSync(supplementalFile, "utf8"), "补充事项已完成");
    assert.equal(fixture.readTask(taskId ?? "")?.status, "completed");
    assert.equal(fixture.readTask(taskId ?? "")?.answerConclusion, "全部完成");
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.attemptCalls.length, 0);
    assert.equal(fixture.createdSubtaskTargets.length, 0);
    assert.equal(fixture.completionMessages.length, 1);
  } finally {
    fixture.dispose();
  }
});
}

for (const subtaskCli of CLI_LIST) {
for (const mainCli of [subtaskCli, subtaskCli === "codex" ? "grok" : "codex"] as const) {
  const sameCli = subtaskCli === mainCli;
const focusScenarios = subtaskCli === "codex" && mainCli === "codex"
  ? ["background", "switch-before-subtask", "switch-during-subtask", "parallel-switch-during-subtask", "foreground"] as const
  : ["background", "switch-before-subtask", "switch-during-subtask", "foreground"] as const;
for (const focusScenario of focusScenarios) {
for (const reuseSession of focusScenario === "parallel-switch-during-subtask" ? [false] : [false, true]) {
test(`classic Loop ${focusScenario} focus while ${reuseSession ? "restoring a continuous task session" : "creating a fresh task session"} from ${mainCli} on ${subtaskCli}`, async () => {
  const created: PromptRunTarget[] = [];
  const systemMessages: Array<{ tabId: string; content: string }> = [];
  const prompts: Array<{ input: PromptRunInput; targetTabId?: string }> = [];
  const visibleTabSwitches: string[] = [];
  let activeTabId = focusScenario === "background" ? "other-main-tab" : "main-tab";
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
    prepareLoopSubtaskCommunicationFile: () => {
      if (focusScenario === "switch-before-subtask") activeTabId = "other-main-tab";
      return "/tmp/loop-comm/sub.md";
    },
    buildLoopSubtaskStartedText: () => "started",
    appendLoopMainSubChatSubtaskStarted: () => undefined,
    getLoopSubtaskDisplayTitle: (_index: number, subtask: { title?: string }) => subtask.title ?? "subtask",
    getLoopMainSubChatMainTitle: () => "Loop",
    buildLoopSubtaskExecutionPlan,
    buildLoopSubtaskBatchStartedText: () => "batch started",
    buildLoopSubtaskBatchCompletedText: () => "batch completed",
    formatLoopGroupChatMemberName: (title: string) => title,
    ensureLoopMainSubChatTranscript: () => "/tmp/loop-comm/main.md",
    appendTextFileEnsuringDir: () => undefined,
    getLastLoopAssistantContent: () => "done",
    mapLoopRunStatusToSubagentStatus: () => "completed",
    getActiveConversationTabId: () => activeTabId,
    switchVisibleConversationTabForLoop: async (tabId: string) => {
      activeTabId = tabId;
      visibleTabSwitches.push(tabId);
      return { cli: mainCli, sessionId: "main-session" };
    },
    isLoopTaskExecutionInterrupted: () => false,
    readLoopTaskRecord: () => task,
    getActiveLoopSubtaskIds: () => [],
    updateLoopTaskRecord: () => task,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: (input: PromptRunInput) => input.loopSubtaskModel ?? input.model,
    resolvePromptRunThinkingModeForRole: (input: PromptRunInput) => input.loopSubtaskThinkingMode,
    runPrompt: async (input: PromptRunInput, options: { targetTabId?: string }) => {
      prompts.push({ input, targetTabId: options.targetTabId });
      if (focusScenario === "switch-during-subtask" || focusScenario === "parallel-switch-during-subtask") {
        activeTabId = "other-main-tab";
      }
    },
    getLoopRoundRunStatus: () => "end",
    appendLoopRound: () => undefined,
    buildLoopRoundSummary: () => "summary",
    finalizeLoopSubtaskRun: async () => undefined,
    resolvePromptRunTargetSessionId: () => null,
  } as never);

  const subtask = { ...(reuseSession ? { continueFromSubtaskId: "previous" } : {}), id: "sub-1", title: "Implement", prompt: "do the work", status: "pending" as const };
  const subtasks = focusScenario === "parallel-switch-during-subtask"
    ? [subtask, { ...subtask, id: "sub-2", title: "Review" }]
    : [subtask];
  const runOptions: Parameters<typeof host.runLoopSubtasksBatchWithRetry>[0] = {
    input: { displayPrompt: "ship it", modelPrompt: "ship it", contextTags: [], model: "gpt-6.1-sol", loopSubtaskModel: "stale-subtask-model", loopSubtaskThinkingMode: "low" },
    target: parent,
    task,
    round: 1,
    subtasks,
  };
  const pending = host.runLoopSubtasksBatchWithRetry(runOptions);
  assert.equal(host.isSubtaskRunning(task.id, subtask.id), true);
  const duplicate = host.runLoopSubtaskWithRetry({ ...runOptions, subtask });
  const [status, resumedStatus] = await Promise.all([pending, duplicate]);

  assert.equal(status[0]?.status, "end");
  assert.equal(resumedStatus, "end");
  assert.equal(host.isSubtaskRunning(task.id, subtask.id), false);
  assert.equal(prompts.length, subtasks.length);
  assert.equal(parent.cli, mainCli);
  assert.equal(parent.sessionId, "main-session");
  assert.equal(created.length, subtasks.length);
  const expectedTabSwitches = focusScenario === "foreground"
    ? [`sub-${subtaskCli}`, "main-tab"]
    : focusScenario === "switch-during-subtask" ? [`sub-${subtaskCli}`] : [];
  assert.equal(activeTabId, focusScenario === "foreground" ? "main-tab" : "other-main-tab");
  assert.deepEqual(visibleTabSwitches, expectedTabSwitches);
  assert.equal(created[0]?.cli, subtaskCli);
  assert.equal(created[0]?.sessionId, reuseSession ? "claude-previous" : null);
  assert.equal(created[0]?.tabId, `sub-${subtaskCli}`);
  assert.notEqual(prompts[0]?.targetTabId, parent.tabId);
  assert.equal(prompts[0]?.input.loopSubtaskCli, subtaskCli);
  assert.equal(prompts[0]?.input.loopSubtaskConfigId, "claude-config");
  assert.equal(prompts[0]?.input.loopSubtaskModel, "gpt-6.1-terra");
  assert.equal(prompts[0]?.input.model, "gpt-6.1-terra");
  assert.equal(prompts[0]?.input.loopSubtaskThinkingMode, "high");
  assert.equal(prompts[0]?.input.thinkingModeOverride, "high");
  assert.equal(prompts[0]?.input.taskRole, "subtask");
  assert.equal(prompts[0]?.input.loopSubtaskId, "sub-1");
  assert.match(prompts[0]?.input.modelPrompt ?? "", /遵循用户要求和项目既有规则，自主选择完成任务的方法/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /主任务将信任你的汇报判断整体进度/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /可在本次实现中一并完成用户或项目规则要求的测试、构建等验证/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /已执行的验证请汇报覆盖范围、命令或操作、结果及未完成项，便于主任务复用/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /只有明确要求独立验收或交叉复核的部分，才报告给主任务另行安排/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /尚未覆盖的实现后集成验证也须说明/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /若本次就是补充验证任务，复用已有有效结果，只完成指定缺口或受影响项/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /若本次被明确派为独立验收或交叉复核任务，仍按独立要求执行并如实汇报，不能用实现任务的自测替代/u);
  assert.match(prompts[0]?.input.modelPrompt ?? "", /没有相关要求时不额外增加验收或测试/u);
  assert.doesNotMatch(prompts[0]?.input.modelPrompt ?? "", /验收、测试由主任务另行安排独立子任务|否则报告相关要求，供主任务安排/u);
  assert.doesNotMatch(prompts[0]?.input.modelPrompt ?? "", /如果当前子任务写了界面设计，按该设计实现/u);
  assert.ok(systemMessages.some((message) => message.tabId === parent.tabId && message.content === "started"));
  assert.equal(systemMessages.some((message) => message.tabId === created[0]?.tabId), false);
});

}
}
}
}

test("classic Loop settles interleaved live-dispatch batches without replacing active work", async (context) => {
  const store = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
  const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
  const logger = require("../../logger") as typeof import("../../logger");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classic-loop-live-dispatch-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  context.mock.method(logger, "logInfo", async () => undefined);

  let stored = loopTask({
    taskStoreFile: path.join(directory, "loop-tasks.json"),
    communicationDir: directory,
    mainCommunicationFile: path.join(directory, "main.md"),
    maxRounds: 4,
  });
  const readTask: typeof store.readLoopTaskRecord = (taskId) => taskId === stored.id ? stored : null;
  const updateTask: typeof store.updateLoopTaskRecord = (taskId, patch, options) => {
    assert.equal(taskId, stored.id);
    return (stored = store.mergeLoopTaskRecordPatch(stored, patch, options));
  };
  context.mock.method(store, "readLoopTaskRecord", readTask);
  context.mock.method(store, "updateLoopTaskRecord", updateTask);

  function signal() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  }
  const events: string[] = [];
  const errors: unknown[] = [];
  const logError = (event: string, detail?: unknown): void => { errors.push({ event, detail }); };
  context.mock.method(logger, "logError", async (event: string, detail?: unknown) => logError(event, detail));
  const workers = new Map(["a", "b", "c"].map((id) => [id, { started: signal(), exit: signal(), settled: signal() }]));
  const runningTabs = new Set<string>();
  const replies = new Map<string, string>();
  const settlements: Array<[string, string, string | null]> = [];
  const runtime = createPromptRunRuntimeHost({
    getActiveWorkspaceKey: () => stored.workspaceKey,
    appendLoopMainSubChatMainDecision: () => undefined,
    appendLoopMainSubChatSubtaskFinished: (_task, subtask, status, content) => {
      settlements.push([subtask.id, status, content]);
      events.push(`settled:${subtask.id}`);
      workers.get(subtask.id)?.settled.release();
    },
    closeConversationTabAndRefreshPanel: async (tabId) => { replies.delete(tabId); },
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
  } as Partial<Parameters<typeof createPromptRunRuntimeHost>[0]> as Parameters<typeof createPromptRunRuntimeHost>[0]);

  const subtask = (id: string) => ({
    id,
    title: `Worker ${id}`,
    prompt: `Implement the independent change in ${id}.ts, verify the affected behavior locally, and report the result in the assigned communication file.`,
    writeFiles: [`src/${id}.ts`],
  });
  const completed: LoopMainDecision = { status: "completed", finalSummary: "All three results accounted for." };
  const decisions: LoopMainDecision[] = [
    { status: "continue", subtasks: [subtask("a"), subtask("b")] },
    { status: "continue", subtasks: [subtask("c")] },
    completed,
    completed,
  ];
  const target: PromptRunTarget = { tabId: "main-tab", cli: "codex", sessionId: "main-session" };
  const input: PromptRunInput = { displayPrompt: stored.rootPrompt, modelPrompt: stored.rootPrompt, contextTags: [] };
  const host = createLoopOrchestrationHost({
    applyLoopMainDecision: runtime.applyLoopMainDecision,
    parseLoopMainDecision: runtime.parseLoopMainDecision,
    finalizeLoopSubtaskRun: runtime.finalizeLoopSubtaskRun,
    getActiveLoopSubtaskIds: runtime.getActiveLoopSubtaskIds,
    isLoopTaskExecutionInterrupted: runtime.isLoopTaskExecutionInterrupted,
    readLoopTaskRecord: readTask,
    updateLoopTaskRecord: updateTask,
    appendLoopRound: (taskId, record) => {
      assert.equal(taskId, stored.id);
      stored = store.mergeLoopTaskRound(stored, record);
    },
    buildResetLoopMainAiFailureState,
    buildLoopSubtaskExecutionPlan,
    getLoopCommunicationPaths: () => ({ dir: directory, mainFile: stored.mainCommunicationFile, subtasksDir: directory }),
    prepareLoopSubtaskCommunicationFile: (_task, item) => path.join(directory, `${item.id}.md`),
    buildLoopRoundSummary: (_round, role, id) => role === "subtask" ? `result:${id}` : "main decision",
    normalizeLoopContinuePromptForPrompt: () => null,
    buildLoopSupplementalRequirementsLines: (task) => task.supplementalRequirements ?? [],
    getLastLoopAssistantContent: (runTarget) => replies.get(runTarget.tabId) ?? null,
    getLoopRoundRunStatus: () => "end",
    createLoopSubtaskRunTarget: (cli, options) => ({ tabId: `worker-${options?.loopSubtaskId}`, cli, sessionId: null }),
    isTabRunActive: (tabId) => runningTabs.has(tabId ?? ""),
    runPrompt: async (prompt, options) => {
      const tabId = options?.targetTabId;
      assert.ok(tabId);
      if (prompt.taskRole === "main") {
        const decision = decisions.shift();
        assert.ok(decision, "unexpected main invocation");
        events.push(`decision:${prompt.loopRound}`);
        replies.set(tabId, JSON.stringify(decision));
        return;
      }
      const id = prompt.loopSubtaskId;
      const worker = id && workers.get(id);
      assert.ok(worker, `unexpected worker ${id}`);
      events.push(`started:${id}`);
      runningTabs.add(tabId);
      options.onStarted?.();
      worker.started.release();
      try {
        await worker.exit.promise;
        events.push(`exited:${id}`);
        replies.set(tabId, `result:${id}`);
      } finally {
        runningTabs.delete(tabId);
      }
    },
    appendSystemMessageForLoop: () => undefined,
    buildLoopSubtaskStartedText: () => "started",
    buildLoopSubtaskBatchStartedText: () => "batch started",
    buildLoopSubtaskBatchCompletedText: () => "batch completed",
    getLoopSubtaskDisplayTitle: (_index, item) => item.title,
    formatLoopGroupChatMemberName: (title) => title ?? "worker",
    ensureLoopMainSubChatTranscript: () => path.join(directory, "chat.md"),
    createSubagentProgressController: () => ({ getMessage: () => null, update: () => undefined, finishRunning: () => undefined }),
    buildSubagentProgressLabels: () => ({
      provider: { loop: "Loop", codex: "Codex", claude: "Claude", opencode: "OpenCode" },
      subagent: "worker",
      status: { running: "running", completed: "done", failed: "failed", interrupted: "stopped" },
      errorPrefix: "error",
    }),
    createLoopSubtaskProgressMonitor: () => ({ start: () => undefined, sync: () => undefined, finish: () => undefined, dispose: () => undefined }),
    getActiveConfigIdForCli: () => null,
    resolvePromptRunModelForRole: () => undefined,
    resolvePromptRunThinkingModeForRole: () => undefined,
    resolveLoopTaskSessionId: () => null,
    resolvePromptRunTargetSessionId: () => null,
    switchVisibleConversationTabForLoop: async () => target,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    sendPanelMessage: () => undefined,
    mapLoopRunStatusToSubagentStatus: () => "completed",
    t: (key) => key,
    errorToMessage: String,
    logError,
  });

  const observation = host.observeClassicLoop(stored.id);
  const batches: Array<ReturnType<typeof host.runLoopSubtasksBatchWithRetry>> = [];
  const decide = (round: number) => host.runClassicLoopMainDecision({ input, target, task: stored, round });
  function dispatch(round: number, decision: Awaited<ReturnType<typeof decide>>) {
    assert.equal(decision.status, "continue");
    const batch = host.runLoopSubtasksBatchWithRetry({ input, target, round, task: decision.task, subtasks: decision.subtasks })
      .finally(() => {
        events.push(`batch-settled:${round}`);
        host.wakeClassicLoop(stored.id);
      });
    batches.push(batch);
    void batch.catch(() => undefined);
    return batch;
  }
  async function checkpoint<Value>(pending: Promise<Value>, stage: string): Promise<Value> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} did not finish. Events: ${events.join(", ")}. Errors: ${JSON.stringify(errors)}`)), 5_000);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  function assertActive(ids: string[]) {
    assert.deepEqual(stored.activeSubtaskIds, ids);
    assert.equal(stored.activeSubtaskId, ids[0] ?? null);
  }

  const alpha = workers.get("a")!;
  const beta = workers.get("b")!;
  const gamma = workers.get("c")!;
  let finished = false;
  try {
    const first = dispatch(1, await decide(1));
    await checkpoint(Promise.all([alpha.started.promise, beta.started.promise]), "start A and B");
    assertActive(["a", "b"]);

    beta.exit.release();
    await checkpoint(beta.settled.promise, "settle B while A runs");
    assertActive(["a"]);
    assert.deepEqual(settlements, [["b", "end", "result:b"]]);
    assert.equal(stored.status, "running");
    const alphaRecord = stored.subTasks.find((item) => item.id === "a");
    assert.equal(alphaRecord?.status, "running");

    const revision = observation.revision();
    const requirement = "Also update the independent C file.";
    updateTask(stored.id, { supplementalRequirements: host.appendLoopSupplementalRequirement(stored.supplementalRequirements, requirement) });
    host.wakeClassicLoop(stored.id);
    await checkpoint(observation.wait(revision), "wake the main decision for C");
    const second = dispatch(2, await decide(2));
    await checkpoint(gamma.started.promise, "start C before A exits");
    assertActive(["a", "c"]);
    assert.deepEqual(stored.subTasks.find((item) => item.id === "a"), alphaRecord);
    assert.ok(runningTabs.has("worker-a"));
    assert.deepEqual(events, ["decision:1", "started:a", "started:b", "exited:b", "settled:b", "decision:2", "started:c"]);

    gamma.exit.release();
    const secondResults = await checkpoint(second, "settle C before A");
    assert.deepEqual(secondResults.map(({ subtask: item, status }) => [item.id, status]), [["c", "end"]]);
    assertActive(["a"]);
    assert.deepEqual(settlements, [["b", "end", "result:b"], ["c", "end", "result:c"]]);
    assert.deepEqual(events.slice(7), ["exited:c", "settled:c", "batch-settled:2"]);
    assert.equal((await decide(3)).status, "waiting");
    assert.equal(stored.status, "running");
    assertActive(["a"]);

    alpha.exit.release();
    const firstResults = await checkpoint(first, "settle the first batch after A exits");
    assert.deepEqual(firstResults.map(({ subtask: item, status }) => [item.id, status]), [["a", "end"], ["b", "end"]]);
    assertActive([]);
    assert.equal(stored.status, "running");
    assert.deepEqual(settlements, [["b", "end", "result:b"], ["c", "end", "result:c"], ["a", "end", "result:a"]]);
    assert.deepEqual(stored.subTasks.map(({ id, status, summary }) => [id, status, summary]), [
      ["a", "completed", "result:a"], ["b", "completed", "result:b"], ["c", "completed", "result:c"],
    ]);
    assert.deepEqual(stored.rounds.filter(({ role }) => role === "subtask").map(({ round, subtaskId }) => [round, subtaskId]), [
      [1, "b"], [2, "c"], [1, "a"],
    ]);
    assert.equal((await decide(4)).status, "completed");
    assert.equal(stored.status, "completed");
    assert.equal(stored.finalSummary, completed.finalSummary);
    assertActive([]);
    assert.equal(runningTabs.size, 0);
    assert.deepEqual(events.slice(7), ["exited:c", "settled:c", "batch-settled:2", "decision:3", "exited:a", "settled:a", "batch-settled:1", "decision:4"]);
    assert.deepEqual(errors, []);
    finished = true;
  } finally {
    for (const worker of workers.values()) worker.exit.release();
    if (!finished) {
      runtime.markLoopTaskStopped(stored.id);
      host.checkWaitingTasks();
    }
    observation.dispose();
    await Promise.allSettled(batches);
  }
});

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
    readLoopTaskRecord: () => task,
    markLoopSubtaskRunFinished: () => "committed",
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
