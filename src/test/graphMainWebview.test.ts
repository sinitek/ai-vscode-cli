import * as assert from "node:assert/strict";
import { test } from "node:test";

import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../webview/viewContentScript/messageRendering";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

test("preserves Graph mode through webview normalization and queued prompt payloads", () => {
  const normalizeInteractiveMode = new Function(
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode")}; return normalizeInteractiveMode;`,
  )() as (value: string) => string;
  const normalizePromptPayload = new Function(
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "normalizePromptPayload")}; return normalizePromptPayload;`,
  )() as (payload: unknown) => { prompt: string; interactiveMode?: string } | null;

  assert.equal(normalizeInteractiveMode("graph"), "graph");
  assert.equal(normalizeInteractiveMode("loop"), "loop");
  assert.equal(normalizeInteractiveMode("other"), "coding");
  assert.deepEqual(normalizePromptPayload({
    prompt: "build graph",
    interactiveMode: "graph",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  }), {
    prompt: "build graph",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
    interactiveMode: "graph",
  });
});

test("normalizes and dispatches openGraphRun message actions", () => {
  const posted: unknown[] = [];
  const t = (key: string) => ({
    openGraphRunAction: "Open Graph run",
    openGraphRunActionTitle: "Open Graph run panel",
  }[key] ?? key);
  const normalizeMessageAction = new Function(
    "t",
    "normalizeLoopTaskId",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeMessageAction")}; return normalizeMessageAction;`,
  )(t, (value: unknown) => typeof value === "string" ? value.trim() : "") as (action: unknown) => unknown;
  const handleMessageAction = new Function(
    "vscode",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "handleMessageAction")}; return handleMessageAction;`,
  )({ postMessage: (message: unknown) => posted.push(message) }) as (action: any) => void;

  assert.deepEqual(normalizeMessageAction({
    type: "openGraphRun",
    graphRunId: " graph-1 ",
    nodeId: " node-2 ",
  }), {
    type: "openGraphRun",
    graphRunId: "graph-1",
    nodeId: "node-2",
    label: "Open Graph run",
  });
  assert.equal(normalizeMessageAction({ type: "openGraphRun" }), null);
  assert.deepEqual(normalizeMessageAction({
    type: "openGraphRun",
    graphRunId: " graph-2 ",
    nodeId: " gate ",
    label: " 请你审批，点击这里 ",
  }), {
    type: "openGraphRun",
    graphRunId: "graph-2",
    nodeId: "gate",
    label: "请你审批，点击这里",
  });

  handleMessageAction({
    type: "openGraphRun",
    graphRunId: "graph-1",
    nodeId: "node-2",
    label: "Open Graph run",
  });
  assert.deepEqual(posted, [{
    type: "openGraphRun",
    graphRunId: "graph-1",
    nodeId: "node-2",
  }]);
});

test("marks Graph conversation tabs with an icon and auto-selects Graph mode", () => {
  const graphMetaByTabId = Object.create(null);
  const helpers = new Function(
    "graphMetaByTabId",
    "getLoopMetaForTabSummary",
    [
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeGraphRunId"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "findGraphRunIdInMessage"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "setGraphMetaForTab"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "updateGraphMetaForTabFromMessage"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "updateGraphMetaForTabFromMessages"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "updateGraphMetaForTabFromRunStatus"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getGraphMetaForTabSummary"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "formatConversationTabLabel"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "resolveAutoInteractiveModeForTab"),
      "return { updateGraphMetaForTabFromMessage, updateGraphMetaForTabFromMessages, updateGraphMetaForTabFromRunStatus, formatConversationTabLabel, resolveAutoInteractiveModeForTab };",
    ].join("\n"),
  )(graphMetaByTabId, () => null) as {
    updateGraphMetaForTabFromMessage(tabId: string, message: unknown): boolean;
    updateGraphMetaForTabFromMessages(tabId: string, messages: unknown[]): boolean;
    updateGraphMetaForTabFromRunStatus(tabId: string, runStatus: unknown): boolean;
    formatConversationTabLabel(tab: { id: string }, baseLabel: string): string;
    resolveAutoInteractiveModeForTab(tab: { id: string }): string;
  };

  assert.equal(helpers.updateGraphMetaForTabFromMessage("tab-1", {
    role: "system",
    actions: [{ type: "openGraphRun", graphRunId: " graph-1 " }],
  }), true);
  assert.equal(helpers.formatConversationTabLabel({ id: "tab-1" }, "codex"), "🗺️ codex");
  assert.equal(helpers.resolveAutoInteractiveModeForTab({ id: "tab-1" }), "graph");
  assert.equal(helpers.updateGraphMetaForTabFromRunStatus("tab-2", {
    status: "start",
    graphRunId: " graph-2 ",
    graphNodeId: "plan",
  }), true);
  assert.equal(helpers.formatConversationTabLabel({ id: "tab-2" }, "opencode"), "🗺️ opencode");
  assert.equal(helpers.resolveAutoInteractiveModeForTab({ id: "tab-2" }), "graph");
  assert.equal(helpers.updateGraphMetaForTabFromMessages("tab-3", [{
    role: "system",
    actions: [{ type: "openGraphRun", graphRunId: " graph-3 " }],
  }, {
    role: "user",
    content: "继续处理",
  }]), true);
  assert.equal(helpers.formatConversationTabLabel({ id: "tab-3" }, "codex"), "🗺️ codex");
  assert.equal(helpers.updateGraphMetaForTabFromMessage("tab-3", {
    role: "user",
    content: "再补充一条",
  }), false);
  assert.equal(helpers.resolveAutoInteractiveModeForTab({ id: "tab-3" }), "graph");
});
