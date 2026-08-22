import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const { createPromptRunRuntimeHost } = require("../extensionHost/promptRunRuntime") as typeof import("../extensionHost/promptRunRuntime");

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
    buildLoopDebateChatMessageAction: () => ({ type: "openLoopGroupChat", taskId: "task-1" }),
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
