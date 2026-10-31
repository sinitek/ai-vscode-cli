import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { installVscodeMock } from "../vscodeMock";
import type { LoopTaskRecord } from "../../loopTaskStore";

installVscodeMock();

const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");

function createRuntimeHost() {
  const deps: Parameters<typeof createPromptRunRuntimeHost>[0] = {
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
