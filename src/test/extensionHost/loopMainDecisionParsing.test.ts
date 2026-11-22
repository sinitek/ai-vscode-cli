import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { installVscodeMock } from "../vscodeMock";
import type { LoopTaskRecord } from "../../loopTaskStore";
import { LOOP_BLOCKER_EXAMPLE, buildLoopBlockerSummary } from "../../loopBlocker";

installVscodeMock();

const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
const { createLoopOrchestrationHost } = require("../../extensionHost/loopOrchestration") as typeof import("../../extensionHost/loopOrchestration");
const { resolveLoopResumeRound } = require("../../webviewCommandCoordinator") as typeof import("../../webviewCommandCoordinator");

function createRuntimeHost(decisionSubtaskMax?: () => number) {
  const deps: Parameters<typeof createPromptRunRuntimeHost>[0] = {
    decisionSubtaskMax,
    getActiveWorkspaceKey: () => "workspace",
    getConversationTabById: () => null,
    getConversationTabs: () => [],
    createConversationTabId: () => "tab-1",
    persistConversationTabsToWorkspaceSettings: () => undefined,
    postPanelState: async () => undefined,
    loadSessionMessages: () => [],
    persistMessagesForTab: () => undefined,
    getPendingSessionDraft: () => ({ messages: [] }),
    updatePendingSessionDraft: () => undefined,
    sendPanelMessage: () => undefined,
    createMessageId: () => "message-1",
    readTaskStore: () => ({ runs: [] }),
    writeTaskStore: () => undefined,
    appendLoopMainSubChatMainDecision: () => undefined,
    buildLoopGroupChatMessageAction: () => ({ type: "openLoopGroupChat", taskId: "task-1" }),
    runLoopPrompt: async () => undefined,
    isTabRunActive: () => false,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolveConversationTabLoopContext: () => ({}),
    resolveLoopTaskSessionId: () => null,
    isLoopTaskBlockedByMainAiFailureLimit: () => false,
    appendLoopMainSubChatSubtaskFinished: () => undefined,
    closeConversationTabAndRefreshPanel: async () => undefined,
  };
  return createPromptRunRuntimeHost(deps);
}

test("classic blocked decisions preserve diagnostic gaps and render complete structured diagnoses", () => {
  const host = createRuntimeHost();
  const legacy = host.parseLoopMainDecision(JSON.stringify({ status: "blocked", finalSummary: "缺少工具" }));
  assert.equal(legacy?.status, "blocked");
  assert.match(legacy?.blockerIssue ?? "", /缺少 blocker/);
  const complete = host.parseLoopMainDecision(JSON.stringify({
    status: "blocked", blocker: LOOP_BLOCKER_EXAMPLE, finalSummary: "已完成",
  }));
  assert.deepEqual(complete?.blocker, LOOP_BLOCKER_EXAMPLE);
  assert.equal(complete?.finalSummary, buildLoopBlockerSummary(LOOP_BLOCKER_EXAMPLE));
  assert.equal(complete?.blockerIssue, undefined);
  assert.equal(host.parseLoopMainDecision(JSON.stringify({ status: "waiting", finalSummary: "等待组长汇报" }))?.status, "waiting");
});

test("classic Loop main prompt reflects only the configured per-dispatch limit", async () => {
  let maximum = 10;
  const prompts: string[] = [];
  const host = createLoopOrchestrationHost({
    decisionSubtaskMax: () => maximum,
    getLoopCommunicationPaths: () => ({ dir: "comm", mainFile: "main.md", subtasksDir: "subtasks" }),
    normalizeLoopContinuePromptForPrompt: () => null,
    buildLoopSupplementalRequirementsLines: () => [],
    isLoopTaskExecutionInterrupted: () => false,
    readLoopTaskRecord: () => null,
    updateLoopTaskRecord: () => null,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: () => undefined,
    resolvePromptRunThinkingModeForRole: () => undefined,
    runPrompt: async (input) => { prompts.push(input.modelPrompt); },
    resolveLoopTaskSessionId: () => null,
    getLoopRoundRunStatus: () => "stopped",
    appendLoopRound: () => null,
    buildLoopRoundSummary: () => "",
  });
  const task = createNeedsReviewTask();
  const options = {
    input: { displayPrompt: "完成目标", modelPrompt: "完成目标", contextTags: [] },
    target: { tabId: "tab-limit", cli: "codex" as const, sessionId: null },
    task,
    round: 1,
  };
  await host.runClassicLoopMainDecision(options);
  const prompt = prompts[0];
  assert.match(prompt, /启动 1~10 个子任务/);
  assert.match(prompt, /每批最多 10 个子任务/);
  assert.match(prompt, /数组长度 1~10/);
  maximum = 1;
  await host.runClassicLoopMainDecision(options);
  const limited = prompts[1];
  assert.match(limited, /每批最多 1 个子任务/);
  assert.doesNotMatch(limited, /子任务轮次：|轮次额度已用尽|已用 \d+\/\d+/);
  const examples = limited.split("\n")
    .filter((line) => line.startsWith('{"status":"continue"'))
    .map((line) => JSON.parse(line) as { subtasks: unknown[] });
  assert.equal(examples.length, 2);
  assert.ok(examples.every((example) => example.subtasks.length <= 1));
});

test("classic Loop uses the configured dispatch limit instead of a fixed six-task cap", () => {
  let maximum = 10;
  const host = createRuntimeHost(() => maximum);
  const subtasks = Array.from({ length: 21 }, (_, index) => ({
    id: `task-${index}`,
    title: `独立任务 ${index}`,
    prompt: "完成当前独立交付，遵循项目既有规则并汇报实际修改和执行结果。".repeat(5),
  }));
  const parseBatch = (count: number) => host.parseLoopMainDecision(JSON.stringify({
    status: "continue",
    subtasks: subtasks.slice(0, count),
  }));
  assert.equal(parseBatch(10)?.subtasks?.length, 10);
  assert.equal(parseBatch(11), null);
  maximum = 2;
  assert.equal(parseBatch(2)?.subtasks?.length, 2);
  assert.equal(parseBatch(3), null);
  maximum = 99;
  assert.equal(parseBatch(20)?.subtasks?.length, 20);
  assert.equal(parseBatch(21), null);
  const defaults = createRuntimeHost();
  assert.equal(defaults.normalizeLoopSubtaskDecisions({ subtasks: subtasks.slice(0, 6) })?.length, 6);
  assert.equal(defaults.normalizeLoopSubtaskDecisions({ subtasks: subtasks.slice(0, 7) }), null);
});

test("parses classic Loop progress without requiring acceptance and rejects invalid percentages", () => {
  const host = createRuntimeHost();
  const decision = { status: "continue", subtasks: [{ title: "下一批次", prompt: "继续完成剩余工作，遵循项目规则并汇报实际结果。".repeat(8) }] };
  for (const progressPercent of [0, 20, 55, 99]) {
    const parsed = host.parseLoopMainDecision(JSON.stringify({ ...decision, progressPercent }));
    assert.equal(parsed?.progressPercent, progressPercent);
    assert.equal(parsed?.acceptance, undefined);
  }
  for (const progressPercent of [null, "20", -1, 20.5, 100, 101]) {
    assert.equal(host.parseLoopMainDecision(JSON.stringify({ ...decision, progressPercent })), null);
  }
  assert.equal(host.parseLoopMainDecision(JSON.stringify(decision))?.progressPercent, undefined);
  assert.equal(host.parseLoopMainDecision(JSON.stringify({
    status: "blocked", progressPercent: 55, finalSummary: "等待外部依赖",
  }))?.progressPercent, 55);
  assert.equal(host.parseLoopMainDecision(JSON.stringify({
    status: "completed", progressPercent: 100, finalSummary: "根据汇报确认完成",
  }))?.progressPercent, 100);
});

test("parses valid module progress weights and rejects malformed weights", () => {
  const host = createRuntimeHost();
  const subtask = { title: "模块", prompt: "完成模块目标并向主任务汇报实际结果。".repeat(8) };
  for (const progressWeightPercent of [1, 20, 100]) {
    const parsed = host.parseLoopMainDecision(JSON.stringify({ status: "continue", subtasks: [{
      ...subtask, progressWeightPercent,
    }] }));
    assert.equal(parsed?.subtasks?.[0].progressWeightPercent, progressWeightPercent);
  }
  for (const progressWeightPercent of [null, "20", 0, -1, 20.5, 101]) {
    assert.equal(host.parseLoopMainDecision(JSON.stringify({ status: "continue", subtasks: [{
      ...subtask, progressWeightPercent,
    }] })), null);
  }
  const updates = [{ moduleId: "existing", progressWeightPercent: 20 }];
  assert.deepEqual(host.parseLoopMainDecision(JSON.stringify({
    status: "continue", subtasks: [subtask], directorProgressWeights: updates,
  }))?.directorProgressWeights, updates);
  assert.equal(host.parseLoopMainDecision(JSON.stringify({
    status: "continue", subtasks: [subtask], directorProgressWeights: [...updates, ...updates],
  })), null);
});


function createNeedsReviewTask(): LoopTaskRecord {
  return {
    id: "task-needs-review",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/task-needs-review/loop-tasks.json",
    rootPrompt: "Finished review.",
    status: "needs-review",
    createdAt: 1,
    updatedAt: 2,
    maxRounds: 20,
    currentRound: 24,
    communicationDir: "/tmp/task-needs-review",
    mainCommunicationFile: "/tmp/task-needs-review/main-task.md",
    sessionId: "codex-session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

test("classic Loop resumes at the recorded round even past legacy maxRounds", () => {
  assert.equal(resolveLoopResumeRound(createNeedsReviewTask()), 24);
});

test("terminal Loop tasks do not regain a main tab unless continuation explicitly creates one", () => {
  const tabs: Array<{ id: string; cli: "codex"; sessionId: string | null; sessionIdByCli: { codex: string }; createdAt: number }> = [];
  const deps: Parameters<typeof createPromptRunRuntimeHost>[0] = {
    getActiveWorkspaceKey: () => "workspace",
    getConversationTabById: (tabId) => tabs.find((tab) => tab.id === tabId) ?? null,
    getConversationTabs: () => tabs,
    createConversationTabId: () => "reopened-tab",
    persistConversationTabsToWorkspaceSettings: () => undefined,
    postPanelState: async () => undefined,
    loadSessionMessages: () => [],
    persistMessagesForTab: () => undefined,
    getPendingSessionDraft: () => ({ messages: [] }),
    updatePendingSessionDraft: () => undefined,
    sendPanelMessage: () => undefined,
    createMessageId: () => "message-1",
    readTaskStore: () => ({ runs: [] }),
    writeTaskStore: () => undefined,
    appendLoopMainSubChatMainDecision: () => undefined,
    buildLoopGroupChatMessageAction: () => ({ type: "openLoopGroupChat", taskId: "task-needs-review" }),
    runLoopPrompt: async () => undefined,
    isTabRunActive: () => false,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolveConversationTabLoopContext: () => ({}),
    resolveLoopTaskSessionId: () => null,
    isLoopTaskBlockedByMainAiFailureLimit: () => false,
    appendLoopMainSubChatSubtaskFinished: () => undefined,
    closeConversationTabAndRefreshPanel: async () => undefined,
  };
  const host = createPromptRunRuntimeHost(deps);
  const task = createNeedsReviewTask();

  assert.equal(host.resolveLoopMainPromptTarget(task), null);
  assert.equal(tabs.length, 0);

  const created = host.resolveLoopMainPromptTarget(task, { createIfMissing: true });
  assert.equal(created?.tabId, "reopened-tab");
  assert.equal(tabs.length, 1);
});

function buildContinueDecision() {
  return {
    status: "continue",
    estimatedRemainingRounds: 2,
    acceptance: {
      passed: false,
      summary: "仍需派发业务规则子任务。",
      checks: [
        { name: "补充需求覆盖", passed: false, detail: "业务规则子任务尚未执行。" },
      ],
    },
    parallelReason: "子任务写入范围互不重叠，可以并发。",
    subtasks: [
      {
        id: "design-ontology-business-rules",
        title: "补充本体业务规则设计",
        conflictGroup: "docs-ontology-business-rules",
        writeFiles: ["docs/ontology.md"],
        prompt: [
          "背景目标：补充本体业务规则设计，保留 AI 友好的 JSON DSL，并写入执行报告。",
          "示例规则必须写进 prompt，且不能干扰外层 LoopMainDecision 解析。",
          "```json",
          "{",
          "  \"id\": \"customer-credit-limit-requires-owner\",",
          "  \"when\": { \"subject\": \"node\", \"operator\": \"gt\", \"value\": 100 },",
          "  \"then\": { \"effect\": \"require_property\", \"propertyPath\": \"properties.owner\" }",
          "}",
          "```",
          "验收标准：设计文档覆盖 operator、selector、effect、安全点路径、版本化和权限边界。",
        ].join("\n"),
      },
    ],
  };
}

test("parses a LoopMainDecision JSON object whose subtask prompt contains fenced JSON examples", () => {
  const host = createRuntimeHost();
  const content = JSON.stringify(buildContinueDecision());

  assert.equal(host.extractJsonObjectText(content), content);

  const parsed = host.parseLoopMainDecision(content);
  assert.equal(parsed?.status, "continue");
  assert.equal(parsed?.subtasks?.length, 1);
  assert.equal(parsed?.subtasks?.[0].id, "design-ontology-business-rules");
  assert.match(parsed?.subtasks?.[0].prompt ?? "", /```json/);
});

test("continues scanning after non-decision JSON objects and accepts a later LoopMainDecision", () => {
  const host = createRuntimeHost();
  const content = [
    "示例：",
    "```json",
    JSON.stringify({ id: "example-rule", enabled: true }),
    "```",
    "最终决策：",
    "```json",
    JSON.stringify(buildContinueDecision()),
    "```",
  ].join("\n");

  const candidates = host.extractJsonObjectTexts(content);
  assert.equal(candidates.length, 2);
  assert.deepEqual(JSON.parse(candidates[0]), { id: "example-rule", enabled: true });

  const parsed = host.parseLoopMainDecision(content);
  assert.equal(parsed?.status, "continue");
  assert.equal(parsed?.subtasks?.[0].title, "补充本体业务规则设计");
});

test("accepts a Loop clarify decision only when the form can be shown", () => {
  const host = createRuntimeHost();
  const parsed = host.parseLoopMainDecision(JSON.stringify({
    status: "clarify",
    estimatedRemainingRounds: 2,
    finalSummary: "需要用户确认范围后再拆分",
    clarification: {
      title: "需要确认需求",
      instruction: "请选择本次范围",
      formFields: [{
        id: "scope",
        label: "范围",
        type: "radio",
        required: true,
        options: [
          { label: "只改接口", value: "api" },
          { label: "接口和调用方", value: "all" },
        ],
      }],
    },
  }));
  assert.equal(parsed?.status, "clarify");
  assert.equal(parsed?.clarification?.formFields[0]?.id, "scope");
  assert.equal(parsed?.clarification?.formFields[0]?.options?.length, 2);
  assert.equal(parsed?.subtasks, undefined);

  assert.equal(host.parseLoopMainDecision(JSON.stringify({
    status: "clarify",
    clarification: { formFields: [] },
  })), null);
  assert.equal(host.parseLoopMainDecision(JSON.stringify({
    status: "clarify",
    formFields: [{ id: "scope", label: "范围", type: "radio", required: true }],
  })), null);
});

test("classic Loop completes from a reported summary without acceptance or coverage gates", () => {
  const host = createRuntimeHost();
  const parsed = host.parseLoopMainDecision(JSON.stringify({
    status: "completed",
    finalSummary: " 子任务汇报目标已经完成。 ",
  }));
  assert.deepEqual(parsed, {
    status: "completed",
    finalSummary: "子任务汇报目标已经完成。",
    estimatedRemainingRounds: 0,
  });
});

test("classic Loop preserves optional legacy acceptance fields without making them completion gates", () => {
  const host = createRuntimeHost();
  for (const passed of [true, false]) {
    const acceptance = { passed, summary: "历史验收字段", checks: [{ name: "历史检查", passed, detail: "历史结果" }] };
    const requirementCoverage = [{ name: "历史需求", passed, detail: "历史记录" }];
    const roundSummaries = [{ round: 1, subtaskId: "implementation", title: "实施", summary: "子任务执行完毕" }];
    const parsed = host.parseLoopMainDecision(JSON.stringify({
      status: "completed",
      finalSummary: "根据汇报完成",
      answerConclusion: " 已完成 ",
      acceptance,
      requirementCoverage,
      roundSummaries,
    }));
    assert.equal(parsed?.status, "completed");
    assert.equal(parsed?.answerConclusion, "已完成");
    assert.deepEqual(parsed?.acceptance, acceptance);
    assert.deepEqual(parsed?.requirementCoverage, requirementCoverage);
    assert.deepEqual(parsed?.roundSummaries, roundSummaries);
  }
});

test("classic Loop normalizes mixed completion summaries and acceptance checks", () => {
  const host = createRuntimeHost();
  const checks = [
    null,
    "invalid",
    { name: " coverage ", passed: true, detail: " evidence " },
    { name: " ", passed: "true", detail: " missing name " },
    { passed: 1, detail: 42 },
  ];
  const expectedChecks = [
    { name: "coverage", passed: true, detail: " evidence " },
    { name: "acceptance", passed: false, detail: " missing name " },
    { name: "acceptance", passed: false, detail: undefined },
  ];
  const parsed = host.parseLoopMainDecision(JSON.stringify({
    status: "completed",
    finalSummary: "Summary",
    estimatedRemainingRounds: 30,
    roundSummaries: [
      null,
      { round: 0, title: "Bad round", summary: "Ignored" },
      { round: 1.9, title: " Summary title ", summary: " Summary text ", subtaskId: " subtask " },
      { round: 2, title: "", summary: "Ignored" },
      { round: 3, title: "Ignored", summary: "" },
      { round: 4, title: 123, summary: 456 },
    ],
    requirementCoverage: checks,
    acceptance: { passed: "true", summary: " evidence ", checks },
  }));
  assert.equal(parsed?.estimatedRemainingRounds, 0);
  assert.deepEqual(parsed?.roundSummaries, [{
    round: 1,
    subtaskId: "subtask",
    title: "Summary title",
    summary: "Summary text",
  }]);
  assert.deepEqual(parsed?.requirementCoverage, expectedChecks);
  assert.deepEqual(parsed?.acceptance, { passed: false, summary: " evidence ", checks: expectedChecks });
});

test("classic Loop completion preserves explicit empty summaries and omits absent or malformed ones", () => {
  const host = createRuntimeHost();
  for (const entries of [undefined, null, {}, []]) {
    const parsed = host.parseLoopMainDecision(JSON.stringify({
      status: "completed",
      finalSummary: "Summary",
      roundSummaries: entries,
      requirementCoverage: entries,
    }));
    assert.deepEqual(parsed, {
      status: "completed",
      finalSummary: "Summary",
      estimatedRemainingRounds: 0,
      ...(Array.isArray(entries) ? { roundSummaries: [] } : {}),
    });
  }
});

test("classic Loop decisions normalize finite round estimates and reject invalid estimates", () => {
  const host = createRuntimeHost();
  const cases = [
    [undefined, undefined], [null, undefined], [false, undefined],
    [" ", undefined], ["NaN", undefined], ["Infinity", undefined],
    [7.9, 7], [" 7.9 ", 7], [-0.1, 0], ["-1", 0], [0, 0],
    [100, 100], ["101.8", 100], [101.8, 100],
  ] as const;
  for (const [input, expected] of cases) {
    const parsed = host.parseLoopMainDecision(JSON.stringify({
      ...buildContinueDecision(),
      estimatedRemainingRounds: input,
    }));
    assert.equal(parsed?.status, "continue");
    assert.equal(parsed.estimatedRemainingRounds, expected, String(input));
  }
});

test("classic Loop still rejects completion without a non-empty summary", () => {
  const host = createRuntimeHost();
  for (const finalSummary of [undefined, "", "   "]) {
    assert.equal(host.parseLoopMainDecision(JSON.stringify({ status: "completed", finalSummary })), null);
  }
});

test("classic Loop continues without inventing a failed acceptance record", () => {
  const host = createRuntimeHost();
  const { acceptance: _acceptance, ...decision } = buildContinueDecision();
  const parsed = host.parseLoopMainDecision(JSON.stringify(decision));
  assert.equal(parsed?.status, "continue");
  assert.equal(parsed?.subtasks?.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed ?? {}, "acceptance"), false);
});

test("classic Loop preserves explicit continuation sources and rejects malformed sources", () => {
  const host = createRuntimeHost();
  const subtask = buildContinueDecision().subtasks[0];
  assert.equal(host.normalizeSingleLoopSubtaskDecision({ ...subtask, continueFromSubtaskId: " previous " })?.continueFromSubtaskId, "previous");
  for (const value of [false, {}, 1, " "]) {
    assert.equal(host.normalizeSingleLoopSubtaskDecision({ ...subtask, continueFromSubtaskId: value }), null);
  }
});

for (const schedulingMode of [undefined, "classic", "event_driven"] as const) {
  test(`Loop ${schedulingMode ?? "legacy"} completion logs preserve mode-specific verification policy`, () => {
    const communicationDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-completion-log-"));
    try {
      const task: LoopTaskRecord = { ...createNeedsReviewTask(), schedulingMode, communicationDir };
      const communicationFile = path.join(communicationDir, "subtask.md");
      createRuntimeHost().appendLoopSubtaskCompletionAutoLog(task, {
        id: "implementation",
        title: "完成实施",
        status: "completed",
        communicationFile,
      }, "end", "子任务已汇报完成", "已按项目规则完成实施。");
      const content = fs.readFileSync(communicationFile, "utf8");
      assert.match(content, /运行状态：completed/);
      assert.match(content, /输出摘要：子任务已汇报完成/);
      if (schedulingMode === "event_driven") {
        assert.match(content, /主任务复核时需重点确认/);
        assert.doesNotMatch(content, /另派独立子任务/);
      } else {
        assert.match(content, /仅当用户或项目规则要求时，另派独立子任务完成相关验证/);
        assert.doesNotMatch(content, /主任务复核时需重点确认/);
      }
    } finally {
      fs.rmSync(communicationDir, { recursive: true, force: true });
    }
  });

  test(`Loop ${schedulingMode ?? "legacy"} main logs use mode-specific decision headings`, () => {
    const communicationDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-main-log-"));
    try {
      const mainCommunicationFile = path.join(communicationDir, "main-task.md");
      const task: LoopTaskRecord = { ...createNeedsReviewTask(), schedulingMode, communicationDir, mainCommunicationFile };
      const host = createRuntimeHost();
      host.appendLoopMainDecisionSummary(task, { status: "completed", finalSummary: "根据汇报完成" });
      const continueDecision = host.normalizeLoopMainDecision(buildContinueDecision());
      assert.ok(continueDecision);
      host.appendLoopMainDecisionSummary(task, continueDecision);
      const content = fs.readFileSync(mainCommunicationFile, "utf8");
      if (schedulingMode === "event_driven") {
        assert.match(content, /## 主任务最终验收/);
        assert.match(content, /## 主任务复核结论/);
      } else {
        assert.match(content, /## 主任务完成结论/);
        assert.match(content, /## 主任务进度判断/);
        assert.doesNotMatch(content, /## 主任务(?:最终验收|复核结论)/);
      }
    } finally {
      fs.rmSync(communicationDir, { recursive: true, force: true });
    }
  });
}
