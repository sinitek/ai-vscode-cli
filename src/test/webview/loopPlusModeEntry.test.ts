import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_I18N } from "../../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";

const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "main_sub_multi_agent";
const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT = "debate_multi_agent";

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  let cursor = script.indexOf("(", start);
  let parens = 0;
  for (; cursor < script.length; cursor += 1) {
    const char = script[cursor];
    if (char === "(") {
      parens += 1;
    } else if (char === ")") {
      parens -= 1;
      if (parens === 0) {
        cursor += 1;
        break;
      }
    }
  }
  const bodyStart = script.indexOf("{", cursor);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === "{") {
      depth += 1;
    } else if (script[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${name} was not terminated`);
}

function extractBlockSource(script: string, marker: string): string {
  const start = script.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  const bodyStart = script.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === "{") {
      depth += 1;
    } else if (script[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${marker} was not terminated`);
}

function buildHtml(locale: "en" | "zh-CN"): string {
  return buildWebviewStaticHtml({
    locale,
    cspSource: "vscode-resource://test-authority",
    nonce: "loop-plus-entry-nonce",
    i18n: getWebviewStrings(locale),
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT,
    loopExecutionModeDebateMultiAgent: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
  });
}

function modeSelects(html: string): string[] {
  return html.match(/<select id="[^"]*" class="interactive-mode-select"[\s\S]*?<\/select>/g) ?? [];
}

type ModeControl = {
  style: { display: string };
  disabled: boolean;
  value: string;
  parentElement: { style: { display: string } };
  addEventListener(type: string, listener: (event: { target: ModeControl }) => void): void;
  dispatchChange(value: string): void;
};

function createModeControl(): ModeControl {
  let changeListener: ((event: { target: ModeControl }) => void) | undefined;
  const control: ModeControl = {
    style: { display: "" },
    disabled: false,
    value: "",
    parentElement: { style: { display: "" } },
    addEventListener(type, listener) {
      if (type === "change") {
        changeListener = listener;
      }
    },
    dispatchChange(value) {
      control.value = value;
      assert.ok(changeListener, "change listener should be registered");
      changeListener({ target: control });
    },
  };
  return control;
}

test("renders Loop+ in both interactive mode selects without disturbing help or debate", () => {
  assert.equal(WEBVIEW_I18N.en.interactiveModeLoopPlus, "Loop+");
  assert.equal(WEBVIEW_I18N["zh-CN"].interactiveModeLoopPlus, "Loop+");
  assert.equal(
    WEBVIEW_I18N.en.interactiveModeLoopPlusHint,
    "Accept each finished subtask immediately, and queue other completions.",
  );
  assert.equal(
    WEBVIEW_I18N["zh-CN"].interactiveModeLoopPlusHint,
    "单个子任务执行结束后立即验收，其它完成进入队列。",
  );

  for (const locale of ["en", "zh-CN"] as const) {
    const html = buildHtml(locale);
    const selects = modeSelects(html);
    assert.equal(selects.length, 2);
    for (const select of selects) {
      assert.match(select, /value="coding"/);
      assert.match(select, /value="loop"/);
      assert.match(select, /value="loop_plus"/);
      assert.match(select, /value="graph"/);
      assert.ok(select.indexOf('value="loop"') < select.indexOf('value="loop_plus"'));
      assert.ok(select.indexOf('value="loop_plus"') < select.indexOf('value="graph"'));
      assert.match(select, />Loop\+</);
    }
    assert.match(html, /value="debate_multi_agent"/);
    assert.doesNotMatch(html, /automatic conflict resolution|自动解冲突|不能自动解冲突|没有自动解冲突/);
    assert.match(html, locale === "en" ? /visible queue/ : /可见队列/);
    assert.match(html, locale === "en" ? /execution end is not acceptance complete/ : /执行结束不等于验收完成/);
  }
});

test("keeps loop_plus in the browser normalizer and still folds plan and lobster", () => {
  const normalizeInteractiveMode = new Function(
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode")}; return normalizeInteractiveMode;`,
  )() as (value: unknown) => string;

  assert.equal(normalizeInteractiveMode("loop_plus"), "loop_plus");
  assert.equal(normalizeInteractiveMode("loop"), "loop");
  assert.equal(normalizeInteractiveMode("graph"), "graph");
  assert.equal(normalizeInteractiveMode("coding"), "coding");
  assert.equal(normalizeInteractiveMode("plan"), "coding");
  assert.equal(normalizeInteractiveMode("lobster"), "coding");
  assert.equal(normalizeInteractiveMode("unknown"), "coding");
  assert.equal(normalizeInteractiveMode(""), "coding");
});

test("restores Loop+, posts the setting, and hides debate without deleting it", () => {
  const normalizeInteractiveMode = new Function(
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode")}; return normalizeInteractiveMode;`,
  )() as (value: string) => string;
  const state = {
    currentCli: "codex",
    interactiveMode: "loop_plus",
    interactive: { supported: true, enabled: true },
    isRunning: false,
    loopExecutionModeByCli: {
      codex: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
      claude: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
      opencode: LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT,
    },
  };
  const elements = {
    interactiveModeSelect: createModeControl(),
    codexLoopModelGroup: createModeControl(),
    codexLoopMainModelSelect: createModeControl(),
    codexLoopMainThinkingMode: createModeControl(),
    codexLoopSubtaskModelSelect: createModeControl(),
    codexLoopSubtaskThinkingMode: createModeControl(),
    openCodeModelGroup: createModeControl(),
    openCodePrimaryModelSelect: createModeControl(),
    openCodeSmallModelSelect: createModeControl(),
    modelSelect: createModeControl(),
    loopExecutionModeSelect: createModeControl(),
    commonCommandButton: createModeControl(),
    commandCompact: createModeControl(),
  };
  const posted: Array<{ type?: string; key?: string; value?: string }> = [];
  const modelSource = [
    ...[
      "cliSupportsManagedModelSelection",
      "cliSupportsLoopRoleModelSelection",
      "isLoopRoleModelMode",
      "isOpenCodeRoleModelMode",
      "syncModelSelectorByInteractiveMode",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)),
  ].join("\n");
  const syncModelSelectorByInteractiveMode = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "getLoopExecutionModeForCli",
    "hideAddModelDialog",
    `${modelSource}; return syncModelSelectorByInteractiveMode;`,
  )(
    state,
    elements,
    normalizeInteractiveMode,
    (cli?: string) => state.loopExecutionModeByCli[(cli || state.currentCli) as "codex"],
    () => undefined,
  ) as () => void;
  const syncInteractiveModeSelector = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "syncModelSelectorByInteractiveMode",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "syncInteractiveModeSelector")}; return syncInteractiveModeSelector;`,
  )(
    state,
    elements,
    normalizeInteractiveMode,
    syncModelSelectorByInteractiveMode,
  ) as () => void;
  new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "syncModelSelectorByInteractiveMode",
    "vscode",
    extractBlockSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "if (elements.interactiveModeSelect) {"),
  )(
    state,
    elements,
    normalizeInteractiveMode,
    syncModelSelectorByInteractiveMode,
    { postMessage: (message: { type?: string; key?: string; value?: string }) => posted.push(message) },
  );

  syncInteractiveModeSelector();
  assert.equal(elements.interactiveModeSelect.value, "loop_plus");
  assert.equal(elements.codexLoopModelGroup.style.display, "");
  assert.equal(elements.codexLoopMainThinkingMode.style.display, "");
  assert.equal(elements.codexLoopSubtaskThinkingMode.style.display, "");
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(elements.loopExecutionModeSelect.value, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);

  elements.interactiveModeSelect.dispatchChange("loop");
  assert.equal(state.interactiveMode, "loop");
  assert.equal(elements.loopExecutionModeSelect.style.display, "");
  assert.equal(elements.loopExecutionModeSelect.value, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);
  assert.equal(state.loopExecutionModeByCli.codex, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);

  elements.interactiveModeSelect.dispatchChange("loop_plus");
  assert.deepEqual(posted.at(-1), {
    type: "updateSetting",
    key: "interactiveMode.codex",
    value: "loop_plus",
  });
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(state.loopExecutionModeByCli.codex, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);
  assert.equal(posted.some((message) => String(message.key || "").startsWith("loopExecutionMode.")), false);

  state.currentCli = "opencode";
  elements.interactiveModeSelect.dispatchChange("loop_plus");
  assert.equal(elements.openCodeSmallModelSelect.disabled, false);
  assert.equal(elements.openCodeSmallModelSelect.parentElement.style.display, "");
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(elements.codexLoopModelGroup.style.display, "none");

  state.currentCli = "claude";
  elements.interactiveModeSelect.dispatchChange("loop_plus");
  assert.equal(elements.codexLoopModelGroup.style.display, "none");
  assert.equal(elements.modelSelect.style.display, "none");
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");
  assert.deepEqual(posted.at(-1), {
    type: "updateSetting",
    key: "interactiveMode.claude",
    value: "loop_plus",
  });

  elements.interactiveModeSelect.dispatchChange("plan");
  assert.equal(state.interactiveMode, "coding");
  assert.deepEqual(posted.at(-1), {
    type: "updateSetting",
    key: "interactiveMode.claude",
    value: "coding",
  });
  elements.interactiveModeSelect.dispatchChange("lobster");
  assert.equal(state.interactiveMode, "coding");
  assert.equal(state.loopExecutionModeByCli.claude, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);
});

test("switches classic and Loop+ main tabs from loopSchedulingMode without cross-tab pollution", () => {
  const state = {
    currentCli: "codex",
    interactiveMode: "loop_plus",
    conversationTabs: {
      activeTabId: "classic-main",
      tabs: [] as Array<Record<string, string>>,
    },
    loopExecutionModeByCli: { codex: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT },
  };
  const elements = {
    interactiveModeSelect: createModeControl(),
    codexLoopModelGroup: createModeControl(),
    codexLoopMainModelSelect: createModeControl(),
    codexLoopMainThinkingMode: createModeControl(),
    codexLoopSubtaskModelSelect: createModeControl(),
    codexLoopSubtaskThinkingMode: createModeControl(),
    openCodeModelGroup: createModeControl(),
    openCodePrimaryModelSelect: createModeControl(),
    openCodeSmallModelSelect: createModeControl(),
    modelSelect: createModeControl(),
    loopExecutionModeSelect: createModeControl(),
    conversationTabs: null as null,
  };
  const classicTab = { id: "classic-main", loopTaskRole: "main", loopTaskId: "task-classic" };
  const loopPlusTab = {
    id: "loop-plus-main",
    loopTaskRole: "main",
    loopTaskId: "task-plus",
    loopSchedulingMode: "event_driven",
  };
  const unknownTab = {
    id: "unknown-main",
    loopTaskRole: "main",
    loopTaskId: "task-unknown",
    loopSchedulingMode: "scheduled",
  };
  const subtaskTab = {
    id: "subtask",
    loopTaskRole: "subtask",
    loopTaskId: "task-plus",
    loopSchedulingMode: "event_driven",
  };
  const graphTab = {
    id: "graph-main",
    loopTaskRole: "main",
    loopTaskId: "task-graph",
    loopSchedulingMode: "event_driven",
    graphRunId: "graph-1",
  };
  state.conversationTabs.tabs = [classicTab, loopPlusTab, unknownTab, subtaskTab, graphTab];
  const api = new Function(
    "state",
    "elements",
    "getLoopExecutionModeForCli",
    "hideAddModelDialog",
    "getActiveConversationTabId",
    "getConversationTabSummary",
    [
      "var lastAutoInteractiveModeTabKey = \"\";",
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "resolveAutoInteractiveModeForTab"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "applyAutoInteractiveModeForTab"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "autoInteractiveModeTabKey"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "syncAutoInteractiveModeForActiveTab"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "renderConversationTabs"),
      ...[
        "cliSupportsManagedModelSelection",
        "cliSupportsLoopRoleModelSelection",
        "isLoopRoleModelMode",
        "isOpenCodeRoleModelMode",
        "syncModelSelectorByInteractiveMode",
      ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)),
      "function getLoopMetaForTabSummary(tab) {",
      "  if (!tab || !tab.loopTaskId || (tab.loopTaskRole !== \"main\" && tab.loopTaskRole !== \"subtask\")) {",
      "    return null;",
      "  }",
      "  return { taskRole: tab.loopTaskRole, loopTaskId: tab.loopTaskId };",
      "}",
      "function getGraphMetaForTabSummary(tab) {",
      "  return tab && tab.graphRunId ? { graphRunId: tab.graphRunId } : null;",
      "}",
      "return { resolveAutoInteractiveModeForTab, applyAutoInteractiveModeForTab, syncAutoInteractiveModeForActiveTab, renderConversationTabs, syncModelSelectorByInteractiveMode };",
    ].join("\n"),
  )(
    state,
    elements,
    () => state.loopExecutionModeByCli.codex,
    () => undefined,
    () => state.conversationTabs.activeTabId,
    (tabId: string) => state.conversationTabs.tabs.find((tab) => tab.id === tabId) || null,
  ) as {
    resolveAutoInteractiveModeForTab(tab: Record<string, string>): string;
    applyAutoInteractiveModeForTab(tab: Record<string, string>): boolean;
    syncAutoInteractiveModeForActiveTab(): boolean;
    renderConversationTabs(): void;
    syncModelSelectorByInteractiveMode(): void;
  };

  assert.equal(api.resolveAutoInteractiveModeForTab(classicTab), "loop");
  assert.equal(api.resolveAutoInteractiveModeForTab(loopPlusTab), "loop_plus");
  assert.equal(api.resolveAutoInteractiveModeForTab({ ...classicTab, loopSchedulingMode: "classic" }), "loop");
  assert.equal(api.resolveAutoInteractiveModeForTab(unknownTab), "loop");
  assert.equal(api.resolveAutoInteractiveModeForTab(subtaskTab), "coding");
  assert.equal(api.resolveAutoInteractiveModeForTab(graphTab), "graph");
  assert.equal(api.resolveAutoInteractiveModeForTab({}), "coding");

  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "loop");
  assert.equal(elements.interactiveModeSelect.value, "loop");
  assert.equal(elements.loopExecutionModeSelect.style.display, "");
  assert.equal(state.loopExecutionModeByCli.codex, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);

  state.interactiveMode = "loop_plus";
  elements.interactiveModeSelect.value = "loop_plus";
  assert.equal(api.syncAutoInteractiveModeForActiveTab(), false);
  assert.equal(state.interactiveMode, "loop_plus");

  state.interactiveMode = "loop";
  state.conversationTabs.activeTabId = "loop-plus-main";
  assert.equal(api.syncAutoInteractiveModeForActiveTab(), true);
  assert.equal(state.interactiveMode, "loop_plus");
  assert.equal(elements.interactiveModeSelect.value, "loop_plus");
  assert.equal(elements.codexLoopModelGroup.style.display, "");
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");

  state.conversationTabs.activeTabId = "classic-main";
  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "loop");
  assert.equal(elements.interactiveModeSelect.value, "loop");

  state.conversationTabs.activeTabId = "subtask";
  assert.equal(api.syncAutoInteractiveModeForActiveTab(), true);
  assert.equal(state.interactiveMode, "coding");

  state.conversationTabs.activeTabId = "graph-main";
  assert.equal(api.syncAutoInteractiveModeForActiveTab(), true);
  assert.equal(state.interactiveMode, "graph");
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");
});

test("restores each main tab mode from its summary after a fresh page load", () => {
  const classicTab = { id: "classic-main", loopTaskRole: "main", loopTaskId: "task-classic", loopSchedulingMode: "classic" };
  const loopPlusTab = { id: "loop-plus-main", loopTaskRole: "main", loopTaskId: "task-plus", loopSchedulingMode: "event_driven" };

  const restore = (activeTabId: string, savedMode: string) => {
    const state = {
      currentCli: "codex",
      interactiveMode: savedMode,
      conversationTabs: { activeTabId, tabs: [classicTab, loopPlusTab] },
      loopExecutionModeByCli: { codex: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT },
    };
    const elements = {
      interactiveModeSelect: createModeControl(),
      codexLoopModelGroup: createModeControl(),
      codexLoopMainModelSelect: createModeControl(),
      codexLoopMainThinkingMode: createModeControl(),
      codexLoopSubtaskModelSelect: createModeControl(),
      codexLoopSubtaskThinkingMode: createModeControl(),
      openCodeModelGroup: createModeControl(),
      openCodePrimaryModelSelect: createModeControl(),
      openCodeSmallModelSelect: createModeControl(),
      modelSelect: createModeControl(),
      loopExecutionModeSelect: createModeControl(),
      conversationTabs: null as null,
    };
    const api = new Function(
      "state",
      "elements",
      "getLoopExecutionModeForCli",
      "hideAddModelDialog",
      "getActiveConversationTabId",
      "getConversationTabSummary",
      [
        "var lastAutoInteractiveModeTabKey = \"\";",
        extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
        extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "resolveAutoInteractiveModeForTab"),
        extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "applyAutoInteractiveModeForTab"),
        extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "autoInteractiveModeTabKey"),
        extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "syncAutoInteractiveModeForActiveTab"),
        extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "renderConversationTabs"),
        ...[
          "cliSupportsManagedModelSelection",
          "cliSupportsLoopRoleModelSelection",
          "isLoopRoleModelMode",
          "isOpenCodeRoleModelMode",
          "syncModelSelectorByInteractiveMode",
        ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)),
        "function getLoopMetaForTabSummary(tab) {",
        "  if (!tab || !tab.loopTaskId || (tab.loopTaskRole !== \"main\" && tab.loopTaskRole !== \"subtask\")) return null;",
        "  return { taskRole: tab.loopTaskRole, loopTaskId: tab.loopTaskId };",
        "}",
        "function getGraphMetaForTabSummary() { return null; }",
        "return { renderConversationTabs };",
      ].join("\n"),
    )(
      state,
      elements,
      () => state.loopExecutionModeByCli.codex,
      () => undefined,
      () => state.conversationTabs.activeTabId,
      (tabId: string) => state.conversationTabs.tabs.find((tab) => tab.id === tabId) || null,
    ) as { renderConversationTabs(): void };
    api.renderConversationTabs();
    return { mode: state.interactiveMode, select: elements.interactiveModeSelect.value };
  };

  assert.deepEqual(restore("classic-main", "loop_plus"), { mode: "loop", select: "loop" });
  assert.deepEqual(restore("loop-plus-main", "loop"), { mode: "loop_plus", select: "loop_plus" });
});

type SendMessage = {
  type?: string;
  prompt?: string;
  interactiveMode?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: string;
  loopSubtaskThinkingMode?: string;
  loopExecutionMode?: string;
  cli?: string;
  model?: string;
  skipPromptHistory?: boolean;
  contextOptions?: unknown;
  scheduledAt?: number;
  files?: unknown[];
};

function buildDispatchHarness() {
  const state = {
    currentCli: "codex",
    interactiveMode: "loop_plus",
    selectedConfigId: "config-1",
    configState: { activeConfigId: "config-1" },
    pendingConfigApply: null as { cli?: string; configId?: string } | null,
    selectedModelsByCli: { codex: "single-model", claude: "claude-model" } as Record<string, string>,
    loopExecutionModeByCli: { codex: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT },
  };
  const runtime = {
    pendingPromptQueue: [] as Array<Record<string, unknown>>,
    queueEditingIndex: -1,
    queueEditingDraft: "",
    suppressQueueFlushOnce: false,
  };
  let activeTabId = "tab-active";
  const posted: SendMessage[] = [];
  const source = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "normalizePromptPayload"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeThinkingModeSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
    ...[
      "normalizePromptPayloadWithModelFields",
      "shouldIncludeCodexLoopRoleModels",
      "resolvePromptLoopRoleModel",
      "applyCodexLoopRoleModelsToPromptPayload",
      "snapshotPromptPayloadForQueue",
      "isConfigApplyPendingForCli",
      "dispatchPrompt",
      "resolveDispatchInteractiveMode",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, name)),
    ...[
      "queuePromptForLater",
      "saveQueuedPromptEdit",
      "flushPendingPromptQueue",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, name)),
    "return { dispatchPrompt, queuePromptForLater, saveQueuedPromptEdit, flushPendingPromptQueue };",
  ].join("\n");
  const api = new Function(
    "state",
    "vscode",
    "getActiveConversationTabId",
    "getConversationTabSummary",
    "getConversationRuntimeState",
    "getActiveConversationRuntimeState",
    "isTabRunning",
    "isConversationTabBusy",
    "isRuntimeStateForActiveTab",
    "showToast",
    "updateQueueIndicator",
    "renderQueueOverlay",
    "closeQueueOverlay",
    "resetTaskListForRunStart",
    "appendMessage",
    "createMessageId",
    "t",
    "cliSupportsManagedModelSelection",
    "getLoopExecutionModeForCli",
    "getSelectedLoopRoleModelForCli",
    "getSelectedLoopRoleThinkingModeForCli",
    source,
  )(
    state,
    { postMessage: (message: SendMessage) => posted.push(message) },
    () => activeTabId,
    (tabId: string) => ({ id: tabId, cli: state.currentCli }),
    () => runtime,
    () => runtime,
    () => false,
    () => false,
    (tabId: string) => tabId === activeTabId,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => "message-id",
    (key: string) => key,
    (cli: string) => cli === "codex",
    () => state.loopExecutionModeByCli.codex,
    (_cli: string, role: string) => (role === "subtask" ? "saved-sub-model" : "saved-main-model"),
    (_cli: string, role: string) => (role === "subtask" ? "medium" : "high"),
  ) as {
    dispatchPrompt(payload: Record<string, unknown>, options?: { tabId?: string }): boolean;
    queuePromptForLater(payload: Record<string, unknown>): void;
    saveQueuedPromptEdit(): void;
    flushPendingPromptQueue(tabId?: string): boolean;
  };
  return {
    state,
    runtime,
    posted,
    api,
    setActiveTab(tabId: string) {
      activeTabId = tabId;
    },
  };
}

test("sends, queues, and flushes Loop+ with role models and without debate", () => {
  const harness = buildDispatchHarness();
  const basePayload = {
    prompt: "review the next result",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  };

  assert.equal(harness.api.dispatchPrompt(basePayload), true);
  const sent = harness.posted.find((message) => message.type === "sendPrompt");
  assert.ok(sent);
  assert.equal(sent.interactiveMode, "loop_plus");
  assert.equal(sent.loopMainModel, "saved-main-model");
  assert.equal(sent.loopSubtaskModel, "saved-sub-model");
  assert.equal(sent.loopMainThinkingMode, "high");
  assert.equal(sent.loopSubtaskThinkingMode, "medium");
  assert.equal(sent.model, "saved-main-model");
  assert.equal(Object.prototype.hasOwnProperty.call(sent, "loopExecutionMode"), false);

  harness.posted.length = 0;
  harness.api.queuePromptForLater(basePayload);
  assert.equal(harness.runtime.pendingPromptQueue.length, 1);
  assert.equal(harness.runtime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(harness.runtime.pendingPromptQueue[0].loopMainModel, "saved-main-model");
  assert.equal(harness.runtime.pendingPromptQueue[0].loopSubtaskModel, "saved-sub-model");
  assert.equal(harness.runtime.pendingPromptQueue[0].loopMainThinkingMode, "high");
  assert.equal(harness.runtime.pendingPromptQueue[0].loopSubtaskThinkingMode, "medium");
  assert.equal(harness.runtime.pendingPromptQueue[0].skipPromptHistory, true);

  harness.state.interactiveMode = "coding";
  harness.setActiveTab("tab-active");
  assert.equal(harness.api.flushPendingPromptQueue("tab-other"), true);
  const flushed = harness.posted.find((message) => message.type === "sendPrompt");
  assert.ok(flushed);
  assert.equal(flushed.interactiveMode, "loop_plus");
  assert.equal(flushed.cli, "codex");
  assert.equal(flushed.loopMainModel, "saved-main-model");
  assert.equal(flushed.loopSubtaskModel, "saved-sub-model");
  assert.equal(flushed.loopMainThinkingMode, "high");
  assert.equal(flushed.loopSubtaskThinkingMode, "medium");
  assert.equal(Object.prototype.hasOwnProperty.call(flushed, "loopExecutionMode"), false);

  harness.state.interactiveMode = "loop_plus";
  harness.api.queuePromptForLater({ ...basePayload, prompt: "edit me" });
  harness.state.interactiveMode = "coding";
  harness.runtime.queueEditingIndex = 0;
  harness.runtime.queueEditingDraft = "edited prompt";
  harness.api.saveQueuedPromptEdit();
  assert.equal(harness.runtime.pendingPromptQueue[0].prompt, "edited prompt");
  assert.equal(harness.runtime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(harness.runtime.pendingPromptQueue[0].loopMainModel, "saved-main-model");
  assert.equal(harness.runtime.pendingPromptQueue[0].loopSubtaskThinkingMode, "medium");

  harness.runtime.pendingPromptQueue.length = 0;
  harness.state.interactiveMode = "loop";
  harness.setActiveTab("tab-active");
  assert.equal(harness.api.dispatchPrompt({ ...basePayload, prompt: "classic loop" }), true);
  const classic = harness.posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(classic);
  assert.equal(classic.interactiveMode, "loop");
  assert.equal(classic.loopExecutionMode, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);
  assert.equal(classic.loopMainModel, "saved-main-model");

  harness.state.interactiveMode = "coding";
  assert.equal(harness.api.dispatchPrompt({
    ...basePayload,
    prompt: "vibe",
    loopMainModel: "stale-main",
    loopSubtaskModel: "stale-sub",
    loopMainThinkingMode: "max",
    loopSubtaskThinkingMode: "low",
  }), true);
  const vibe = harness.posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(vibe);
  assert.equal(vibe.interactiveMode, "coding");
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopMainModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopSubtaskModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopExecutionMode"), false);
  assert.equal(vibe.model, "single-model");

  harness.state.currentCli = "claude";
  harness.state.interactiveMode = "loop_plus";
  assert.equal(harness.api.dispatchPrompt({ ...basePayload, prompt: "claude loop plus" }), true);
  const claude = harness.posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(claude);
  assert.equal(claude.cli, "claude");
  assert.equal(claude.interactiveMode, "loop_plus");
  assert.equal(Object.prototype.hasOwnProperty.call(claude, "loopMainModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(claude, "loopExecutionMode"), false);
  assert.equal(claude.model, undefined);
});

test("snapshots Loop+ scheduled tasks without debate and keeps classic Loop debate", () => {
  const state = {
    currentCli: "codex",
    interactiveMode: "loop_plus",
    selectedModelsByCli: { codex: "single-model" },
    selectedLoopModelsByCli: { codex: { main: "main-model", subtask: "sub-model" } },
    selectedLoopThinkingByCli: { codex: { main: "xhigh", subtask: "low" } },
  };
  const elements = {
    scheduledTaskPrompt: { value: "run this later" },
    scheduledTaskTime: { value: "2099-01-01T00:00" },
    scheduledTaskMode: { value: "loop_plus" },
    saveScheduledTask: { disabled: false },
  };
  const posted: SendMessage[] = [];
  const api = new Function(
    "state",
    "elements",
    "scheduledTaskFiles",
    "vscode",
    "getActiveConversationTabId",
    "getLoopExecutionModeForCli",
    "buildPromptPayload",
    "setScheduledTaskError",
    "t",
    [
      extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "getScheduledTaskSelectedMode"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "saveScheduledTask"),
      "return { getScheduledTaskSelectedMode, saveScheduledTask };",
    ].join("\n"),
  )(
    state,
    elements,
    [],
    { postMessage: (message: SendMessage) => posted.push(message) },
    () => "tab-scheduled",
    () => LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
    (prompt: string) => ({
      prompt,
      contextOptions: { includeCurrentFile: true, includeSelection: false },
    }),
    () => undefined,
    (key: string) => key,
  ) as {
    getScheduledTaskSelectedMode(): string;
    saveScheduledTask(): void;
  };

  assert.equal(api.getScheduledTaskSelectedMode(), "loop_plus");
  api.saveScheduledTask();
  assert.equal(posted[0].type, "scheduleTask");
  assert.equal(posted[0].interactiveMode, "loop_plus");
  assert.equal(posted[0].loopMainModel, "main-model");
  assert.equal(posted[0].loopSubtaskModel, "sub-model");
  assert.equal(posted[0].loopMainThinkingMode, "xhigh");
  assert.equal(posted[0].loopSubtaskThinkingMode, "low");
  assert.equal(posted[0].model, "single-model");
  assert.equal(Object.prototype.hasOwnProperty.call(posted[0], "loopExecutionMode") ? posted[0].loopExecutionMode : undefined, undefined);
  assert.equal(elements.saveScheduledTask.disabled, true);

  elements.scheduledTaskMode.value = "loop";
  elements.saveScheduledTask.disabled = false;
  api.saveScheduledTask();
  assert.equal(posted[1].interactiveMode, "loop");
  assert.equal(posted[1].loopExecutionMode, LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT);
  assert.equal(posted[1].loopMainModel, "main-model");

  elements.scheduledTaskMode.value = "plan";
  assert.equal(api.getScheduledTaskSelectedMode(), "coding");
  elements.scheduledTaskMode.value = "lobster";
  assert.equal(api.getScheduledTaskSelectedMode(), "coding");
  elements.scheduledTaskMode.value = "";
  state.interactiveMode = "loop_plus";
  assert.equal(api.getScheduledTaskSelectedMode(), "loop_plus");
});

test("keeps loop_plus and role fields in the base prompt normalizer", () => {
  const normalizePromptPayload = new Function(
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "normalizePromptPayload")}; return normalizePromptPayload;`,
  )() as (payload: unknown) => Record<string, unknown> | null;

  assert.deepEqual(normalizePromptPayload({
    prompt: "review",
    interactiveMode: "loop_plus",
    loopMainModel: " main ",
    lobsterSubtaskModel: " sub ",
    loopMainThinkingMode: " off ",
    loopSubtaskThinkingMode: "nope",
    skipPromptHistory: true,
    contextOptions: { includeCurrentFile: false, includeSelection: true },
  }), {
    prompt: "review",
    contextOptions: { includeCurrentFile: false, includeSelection: true },
    interactiveMode: "loop_plus",
    skipPromptHistory: true,
    loopMainModel: "main",
    loopSubtaskModel: "sub",
    loopMainThinkingMode: "low",
  });
  assert.deepEqual(normalizePromptPayload({
    prompt: "build graph",
    interactiveMode: "graph",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  }), {
    prompt: "build graph",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
    interactiveMode: "graph",
  });
  assert.deepEqual(normalizePromptPayload({
    prompt: "run",
    contextOptions: { includeSelection: false },
    interactiveMode: "plan",
  }), {
    prompt: "run",
    contextOptions: { includeCurrentFile: true, includeSelection: false },
  });
  assert.equal(normalizePromptPayload({ prompt: "" }), null);
});

test("keeps the busy-overlay snapshot through queue later, pause send, edit, and auto send", () => {
  const state = {
    currentCli: "codex",
    interactiveMode: "loop_plus",
    selectedConfigId: "config-1",
    configState: { activeConfigId: "config-1" },
    pendingConfigApply: null as { cli?: string; configId?: string } | null,
    selectedModelsByCli: { codex: "single-model" } as Record<string, string>,
    loopExecutionModeByCli: { codex: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT },
    selectedLoopModels: { main: "entry-main", subtask: "entry-sub" },
    selectedLoopThinking: { main: "xhigh", subtask: "low" },
  };
  const runtime = {
    pendingPromptQueue: [] as Array<Record<string, unknown>>,
    pendingRunPrompt: null as Record<string, unknown> | null,
    queueEditingIndex: -1,
    queueEditingDraft: "",
    suppressQueueFlushOnce: false,
    overlays: { runConflict: false },
  };
  const elements = {
    promptInput: { value: "draft" },
    runConflictOverlay: { classList: { toggle() { return undefined; } } },
    runConflictPrompt: { textContent: "" },
  };
  const posted: SendMessage[] = [];
  let loopMainRunning = false;
  let activeTabId = "tab-active";
  const source = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "normalizePromptPayload"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeThinkingModeSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
    ...[
      "normalizePromptPayloadWithModelFields",
      "shouldIncludeCodexLoopRoleModels",
      "resolvePromptLoopRoleModel",
      "applyCodexLoopRoleModelsToPromptPayload",
      "snapshotPromptPayloadForQueue",
      "isConfigApplyPendingForCli",
      "dispatchPrompt",
      "resolveDispatchInteractiveMode",
      "syncRunConflictOverlay",
      "openRunConflictOverlay",
      "closeRunConflictOverlay",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, name)),
    ...[
      "queuePromptForLater",
      "saveQueuedPromptEdit",
      "flushPendingPromptQueue",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, name)),
    ...[
      "queueConflictPromptForLater",
      "pauseAndSendConflictPrompt",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, name)),
    "return { openRunConflictOverlay, queueConflictPromptForLater, pauseAndSendConflictPrompt, saveQueuedPromptEdit, flushPendingPromptQueue, dispatchPrompt };",
  ].join("\n");
  const api = new Function(
    "state",
    "elements",
    "vscode",
    "getActiveConversationTabId",
    "getConversationTabSummary",
    "getConversationRuntimeState",
    "getActiveConversationRuntimeState",
    "isTabRunning",
    "isConversationTabBusy",
    "isRuntimeStateForActiveTab",
    "isLoopMainConversationTabRunning",
    "showToast",
    "updateQueueIndicator",
    "renderQueueOverlay",
    "resetPromptContextForNextPrompt",
    "resetTaskListForRunStart",
    "appendMessage",
    "createMessageId",
    "t",
    "cliSupportsManagedModelSelection",
    "getLoopExecutionModeForCli",
    "getSelectedLoopRoleModelForCli",
    "getSelectedLoopRoleThinkingModeForCli",
    source,
  )(
    state,
    elements,
    { postMessage: (message: SendMessage) => posted.push(message) },
    () => activeTabId,
    (tabId: string) => ({ id: tabId, cli: state.currentCli }),
    () => runtime,
    () => runtime,
    () => false,
    () => false,
    (tabId: string) => tabId === activeTabId,
    () => loopMainRunning,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => "message-id",
    (key: string) => key,
    (cli: string) => cli === "codex",
    () => state.loopExecutionModeByCli.codex,
    (_cli: string, role: "main" | "subtask") => state.selectedLoopModels[role],
    (_cli: string, role: "main" | "subtask") => state.selectedLoopThinking[role],
  ) as {
    openRunConflictOverlay(payload: Record<string, unknown>): void;
    queueConflictPromptForLater(): boolean;
    pauseAndSendConflictPrompt(): boolean;
    saveQueuedPromptEdit(): void;
    flushPendingPromptQueue(tabId?: string): boolean;
    dispatchPrompt(payload: Record<string, unknown>): boolean;
  };
  const entryPayload = {
    prompt: "accept the finished subtask",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  };

  api.openRunConflictOverlay(entryPayload);
  assert.equal(runtime.pendingRunPrompt?.interactiveMode, "loop_plus");
  assert.equal(runtime.pendingRunPrompt?.loopMainModel, "entry-main");
  assert.equal(runtime.pendingRunPrompt?.loopSubtaskModel, "entry-sub");
  assert.equal(runtime.pendingRunPrompt?.loopMainThinkingMode, "xhigh");
  assert.equal(runtime.pendingRunPrompt?.loopSubtaskThinkingMode, "low");

  state.interactiveMode = "coding";
  state.selectedLoopModels = { main: "changed-main", subtask: "changed-sub" };
  state.selectedLoopThinking = { main: "max", subtask: "medium" };
  assert.equal(api.queueConflictPromptForLater(), true);
  assert.equal(runtime.pendingPromptQueue.length, 1);
  assert.equal(runtime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(runtime.pendingPromptQueue[0].loopMainModel, "entry-main");
  assert.equal(runtime.pendingPromptQueue[0].loopSubtaskModel, "entry-sub");
  assert.equal(runtime.pendingPromptQueue[0].loopMainThinkingMode, "xhigh");
  assert.equal(runtime.pendingPromptQueue[0].loopSubtaskThinkingMode, "low");
  assert.equal(runtime.pendingPromptQueue[0].skipPromptHistory, true);
  assert.equal(elements.promptInput.value, "");
  assert.equal(runtime.pendingRunPrompt, null);

  runtime.queueEditingIndex = 0;
  runtime.queueEditingDraft = "edited after the dropdown changed";
  api.saveQueuedPromptEdit();
  assert.equal(runtime.pendingPromptQueue[0].prompt, "edited after the dropdown changed");
  assert.equal(runtime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(runtime.pendingPromptQueue[0].loopMainModel, "entry-main");

  activeTabId = "tab-active";
  assert.equal(api.flushPendingPromptQueue("tab-later"), true);
  const queuedSend = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(queuedSend);
  assert.equal(queuedSend.prompt, "edited after the dropdown changed");
  assert.equal(queuedSend.interactiveMode, "loop_plus");
  assert.equal(queuedSend.loopMainModel, "entry-main");
  assert.equal(queuedSend.loopSubtaskModel, "entry-sub");
  assert.equal(queuedSend.loopMainThinkingMode, "xhigh");
  assert.equal(queuedSend.loopSubtaskThinkingMode, "low");
  assert.equal(Object.prototype.hasOwnProperty.call(queuedSend, "loopExecutionMode"), false);

  state.interactiveMode = "loop_plus";
  state.selectedLoopModels = { main: "entry-main", subtask: "entry-sub" };
  state.selectedLoopThinking = { main: "high", subtask: "medium" };
  elements.promptInput.value = "pause me";
  api.openRunConflictOverlay({ ...entryPayload, prompt: "pause me" });
  state.interactiveMode = "loop";
  state.selectedLoopModels = { main: "changed-main", subtask: "changed-sub" };
  loopMainRunning = true;
  api.pauseAndSendConflictPrompt();
  assert.equal(posted.filter((message) => message.type === "sendPrompt").length, 1);
  assert.equal(runtime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(runtime.pendingPromptQueue[0].loopMainModel, "entry-main");
  assert.equal(runtime.pendingPromptQueue[0].loopMainThinkingMode, "high");

  runtime.pendingPromptQueue.length = 0;
  state.interactiveMode = "loop_plus";
  state.selectedLoopModels = { main: "entry-main", subtask: "entry-sub" };
  api.openRunConflictOverlay({ ...entryPayload, prompt: "send without waiting" });
  state.interactiveMode = "coding";
  state.selectedLoopModels = { main: "changed-main", subtask: "changed-sub" };
  loopMainRunning = false;
  elements.promptInput.value = "pause me";
  assert.equal(api.pauseAndSendConflictPrompt(), true);
  const pausedSend = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(pausedSend);
  assert.equal(pausedSend.prompt, "send without waiting");
  assert.equal(pausedSend.interactiveMode, "loop_plus");
  assert.equal(pausedSend.loopMainModel, "entry-main");
  assert.equal(pausedSend.loopSubtaskModel, "entry-sub");
  assert.equal(pausedSend.loopMainThinkingMode, "high");
  assert.equal(pausedSend.loopSubtaskThinkingMode, "medium");
  assert.equal(Object.prototype.hasOwnProperty.call(pausedSend, "loopExecutionMode"), false);
  assert.equal(elements.promptInput.value, "");
});

test("labels scheduled Loop+ tasks with the existing Loop+ copy", () => {
  const state = {
    scheduledTasks: [
      {
        id: "task-plus",
        prompt: "run loop plus",
        scheduledAt: Date.parse("2099-01-01T00:00:00Z"),
        status: "pending",
        cli: "codex",
        interactiveMode: "loop_plus",
        attachmentNames: [],
      },
      {
        id: "task-loop",
        prompt: "run classic",
        scheduledAt: Date.parse("2099-01-02T00:00:00Z"),
        status: "pending",
        cli: "codex",
        interactiveMode: "loop",
        attachmentNames: [],
      },
    ],
  };
  const list = {
    innerHTML: "",
    children: [] as Array<{ className: string; textContent: string; children: Array<{ className: string; textContent: string; children: unknown[] }> }>,
    appendChild(child: { className: string; textContent: string; children: unknown[] }) {
      this.children.push(child as never);
    },
  };
  const elements = { scheduledTaskList: list };
  const labels: Record<string, string> = {
    interactiveModeLoopPlus: "Loop+",
    interactiveModeLoop: "Loop",
    interactiveModeGraph: "Graph",
    interactiveModeCoding: "Vibe",
    scheduledTaskStatusPending: "Pending",
    scheduledTaskDelete: "Delete",
  };
  const nodes: Array<{ className: string; textContent: string; children: unknown[]; appendChild: (child: unknown) => unknown; addEventListener: () => void }> = [];
  const api = new Function(
    "state",
    "elements",
    "document",
    "vscode",
    "t",
    "formatDateTime",
    [
      extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "scheduledTaskModeLabel"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "scheduledTaskStatusLabel"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "renderScheduledTaskList"),
      "return { scheduledTaskModeLabel, renderScheduledTaskList };",
    ].join("\n"),
  )(
    state,
    elements,
    {
      createElement() {
        const node = {
          className: "",
          textContent: "",
          children: [] as unknown[],
          appendChild(child: unknown) {
            this.children.push(child);
            return child;
          },
          addEventListener() {
            return undefined;
          },
        };
        nodes.push(node);
        return node;
      },
    },
    { postMessage() { return undefined; } },
    (key: string) => labels[key] || key,
    () => "2099-01-01 00:00",
  ) as {
    scheduledTaskModeLabel(mode: string): string;
    renderScheduledTaskList(): void;
  };

  assert.equal(api.scheduledTaskModeLabel("loop_plus"), "Loop+");
  assert.equal(api.scheduledTaskModeLabel("loop"), "Loop");
  assert.equal(api.scheduledTaskModeLabel("graph"), "Graph");
  assert.equal(api.scheduledTaskModeLabel("coding"), "Vibe");
  assert.equal(api.scheduledTaskModeLabel("plan"), "");
  api.renderScheduledTaskList();
  const statuses = nodes
    .filter((node) => node.className === "scheduled-task-status")
    .map((node) => node.textContent);
  assert.deepEqual(statuses, [
    "Pending · codex · Loop+",
    "Pending · codex · Loop",
  ]);
});
