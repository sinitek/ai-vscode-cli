import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";

import { getWebviewStrings } from "../../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "../../webview/viewContentScript/coreBootstrap";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";

const LOOP_EXECUTION_MODE_DEBATE = "debate_multi_agent";

type RoleMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  taskRole?: "main" | "subtask";
  loopTaskId?: string;
  loopRound?: number;
  kind?: "thinking" | "normal";
};

type TabSummary = {
  id: string;
  cli: string;
  loopTaskRole?: "main" | "subtask";
  loopTaskId?: string;
  loopSchedulingMode?: string;
  loopTaskRunning?: boolean;
  graphRunId?: string;
};

type BrowserState = {
  currentCli: string;
  interactiveMode: string;
  onlyShowFinalResults: boolean;
  messages: RoleMessage[];
  conversationTabs: {
    activeTabId: string | null;
    tabs: TabSummary[];
  };
  selectedConfigId: string;
  configState: { activeConfigId: string };
  pendingConfigApply: { cli?: string; configId?: string } | null;
  selectedModelsByCli: Record<string, string>;
  loopModelsByCli: Record<string, { main: string[]; subtask: string[] }>;
  selectedLoopModelsByCli: Record<string, { main: string; subtask: string }>;
  selectedLoopThinkingByCli: Record<string, { main: string; subtask: string }>;
  loopExecutionModeByCli: Record<string, string>;
};

type RuntimeState = {
  messages: RoleMessage[];
  pendingPromptQueue: Array<Record<string, unknown>>;
  pendingRunPrompt: Record<string, unknown> | null;
  queueEditingIndex: number;
  queueEditingDraft: string;
};

type PostedMessage = {
  type?: string;
  prompt?: string;
  interactiveMode?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: string;
  loopSubtaskThinkingMode?: string;
  loopExecutionMode?: string;
  model?: string;
  tabId?: string;
  skipPromptHistory?: boolean;
};

type BrowserApi = {
  getMessageTaskRoleLabel(message: RoleMessage | null): string;
  renderMessages(): void;
  renderConversationTabs(): void;
  syncActiveMessagesFromRuntime(): void;
  resetAutoInteractiveModeMemoryForTest(): void;
  getConversationRuntimeState(tabId: string): RuntimeState;
  openRunConflictOverlay(payload: Record<string, unknown>): void;
  queueConflictPromptForLater(): boolean;
  pauseAndSendConflictPrompt(): boolean | undefined;
  saveQueuedPromptEdit(): void;
  flushPendingPromptQueue(tabId?: string): boolean;
  dispatchPrompt(payload: Record<string, unknown>): boolean;
  queuePromptForLater(payload: Record<string, unknown>): void;
  resolveAutoInteractiveModeForTab(tab: TabSummary | null): string;
};

class FakeElement {
  className = "";
  textContent = "";
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  style = { display: "" };
  disabled = false;
  value = "";
  private html = "";
  readonly classList: {
    add: (...tokens: string[]) => void;
    toggle: (token: string, force?: boolean) => boolean;
    contains: (token: string) => boolean;
  };

  constructor(readonly tag = "div") {
    this.classList = {
      add: (...tokens: string[]) => {
        const existing = new Set(this.className.split(/\s+/).filter(Boolean));
        tokens.forEach((token) => existing.add(token));
        this.className = Array.from(existing).join(" ");
      },
      toggle: (token: string, force?: boolean) => {
        const existing = new Set(this.className.split(/\s+/).filter(Boolean));
        const has = existing.has(token);
        const next = typeof force === "boolean" ? force : !has;
        if (next) {
          existing.add(token);
        } else {
          existing.delete(token);
        }
        this.className = Array.from(existing).join(" ");
        return next;
      },
      contains: (token: string) => this.className.split(/\s+/).includes(token),
    };
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    if (value === "") {
      this.children.forEach((child) => {
        child.parentElement = null;
      });
      this.children = [];
    }
  }

  get childElementCount(): number {
    return this.children.length;
  }

  appendChild<T extends FakeElement>(child: T): T {
    this.detach(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore<T extends FakeElement>(child: T, reference: FakeElement | null): T {
    this.detach(child);
    child.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  remove(): void {
    this.parentElement?.detach(this);
    this.parentElement = null;
  }

  querySelector(selector: string): FakeElement | null {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    for (const child of this.children) {
      if (child.className.split(/\s+/).includes(className)) {
        return child;
      }
      const nested = child.querySelector(selector);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }

  addEventListener(): void {
    return undefined;
  }

  setAttribute(): void {
    return undefined;
  }

  removeAttribute(): void {
    return undefined;
  }

  private detach(child: FakeElement): void {
    if (!child.parentElement) {
      return;
    }
    child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
    child.parentElement = null;
  }
}

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
  let quote = "";
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index];
    const next = script[index + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${name} was not terminated`);
}

function control(): FakeElement {
  return new FakeElement("select");
}

function createTabs(): TabSummary[] {
  return [
    { id: "classic-main", cli: "codex", loopTaskRole: "main", loopTaskId: "task-classic", loopSchedulingMode: "classic" },
    { id: "classic-sub", cli: "codex", loopTaskRole: "subtask", loopTaskId: "task-classic", loopSchedulingMode: "classic" },
    { id: "plus-main", cli: "codex", loopTaskRole: "main", loopTaskId: "task-plus", loopSchedulingMode: "event_driven" },
    { id: "plus-sub", cli: "codex", loopTaskRole: "subtask", loopTaskId: "task-plus", loopSchedulingMode: " event_driven " },
    { id: "unknown-main", cli: "codex", loopTaskRole: "main", loopTaskId: "task-unknown", loopSchedulingMode: "scheduled" },
    { id: "blank-main", cli: "codex", loopTaskRole: "main", loopTaskId: "task-blank" },
    {
      id: "conflict-main",
      cli: "codex",
      loopTaskRole: "main",
      loopTaskId: "task-conflict",
      loopSchedulingMode: "event_driven",
    },
    {
      id: "conflict-sub",
      cli: "codex",
      loopTaskRole: "subtask",
      loopTaskId: "task-conflict",
      loopSchedulingMode: "classic",
    },
    { id: "spaced-main", cli: "codex", loopTaskRole: "main", loopTaskId: "task-spaced", loopSchedulingMode: " event_driven " },
    {
      id: "graph-main",
      cli: "codex",
      loopTaskRole: "main",
      loopTaskId: "task-graph",
      loopSchedulingMode: "event_driven",
      graphRunId: "graph-1",
    },
    { id: "vibe-tab", cli: "codex" },
  ];
}

function createState(activeTabId: string): BrowserState {
  return {
    currentCli: "codex",
    interactiveMode: "coding",
    onlyShowFinalResults: false,
    messages: [],
    conversationTabs: { activeTabId, tabs: createTabs() },
    selectedConfigId: "config-1",
    configState: { activeConfigId: "config-1" },
    pendingConfigApply: null,
    selectedModelsByCli: { codex: "single-model" },
    loopModelsByCli: {
      codex: {
        main: ["entry-main", "changed-main"],
        subtask: ["entry-sub", "changed-sub"],
      },
    },
    selectedLoopModelsByCli: { codex: { main: "entry-main", subtask: "entry-sub" } },
    selectedLoopThinkingByCli: { codex: { main: "xhigh", subtask: "low" } },
    loopExecutionModeByCli: { codex: LOOP_EXECUTION_MODE_DEBATE },
  };
}

function browserScript(): string {
  const names: Array<[string, string]> = [
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "normalizePromptPayload"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "createTaskListState"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "createConversationRuntimeState"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "resolveConversationRuntimeKey"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "getConversationRuntimeState"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "getActiveConversationRuntimeState"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "ensureRuntimeStateMessages"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "syncActiveMessagesFromRuntime"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isRuntimeStateForActiveTab"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isRunStatusSummaryText"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "shouldHideSystemRunStatusMessage"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeLoopTaskRole"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeLoopTaskId"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeGraphRunId"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getActiveConversationTabId"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getConversationTabSummary"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getLoopMetaForTabSummary"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getGraphMetaForTabSummary"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isLoopMainTab"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isLoopMainTabCloseLocked"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isConversationTabRunning"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isConversationTabBusy"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isLoopMainConversationTabRunning"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isMessageLoopTaskEventDriven"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getMessageTaskRoleLabel"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "createMessageTaskRoleElement"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "applyMessageElementClasses"],
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isHiddenLoopPlusProtocolPrompt"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "shouldShowMessageInResultOnlyMode"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "getVisibleMessages"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "captureOpenTraceCollapsibleKeys"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "forceCollapseToolResultBubbles"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "createMessageElement"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "renderMessages"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "resolveAutoInteractiveModeForTab"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "applyAutoInteractiveModeForTab"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "autoInteractiveModeTabKey"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "syncAutoInteractiveModeForActiveTab"],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "renderConversationTabs"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsManagedModelSelection"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsLoopRoleModelSelection"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isLoopRoleModelMode"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isOpenCodeRoleModelMode"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getLoopRoleModelsForCli"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getSelectedLoopRoleModelForCli"],
    [VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "syncModelSelectorByInteractiveMode"],
    [VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeModelSelection"],
    [VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeThinkingModeSelection"],
    [VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "getSelectedLoopRoleThinkingModeForCli"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "normalizePromptPayloadWithModelFields"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "shouldIncludeCodexLoopRoleModels"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "resolvePromptLoopRoleModel"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "applyCodexLoopRoleModelsToPromptPayload"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "snapshotPromptPayloadForQueue"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "isConfigApplyPendingForCli"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "dispatchPrompt"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "resolveDispatchInteractiveMode"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "syncRunConflictOverlay"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "openRunConflictOverlay"],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "closeRunConflictOverlay"],
    [VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "queuePromptForLater"],
    [VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "saveQueuedPromptEdit"],
    [VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "flushPendingPromptQueue"],
    [VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "queueConflictPromptForLater"],
    [VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "pauseAndSendConflictPrompt"],
  ];
  return [
    "var lastAutoInteractiveModeTabKey = \"\";",
    "var traceCollapsibleOpenKeys = new Set();",
    "var conversationRuntimeByTabId = Object.create(null);",
    "var loopMetaByTabId = Object.create(null);",
    "var graphMetaByTabId = Object.create(null);",
    "var TAB_RUNTIME_DEFAULT_KEY = \"__default__\";",
    "function formatTemplate(template, params) {",
    "  if (!params) return template;",
    "  return String(template).replace(/\\{(\\w+)\\}/g, function (match, key) {",
    "    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;",
    "  });",
    "}",
    "function t(key, params) {",
    "  labelCalls.push({ key: key, round: params && params.round });",
    "  return formatTemplate(i18n[key] || key, params);",
    "}",
    "function isTabRunning(tabId) { return runningTabIds.has(tabId); }",
    "function getLoopExecutionModeForCli(cli) {",
    "  var targetCli = cli || state.currentCli;",
    "  var value = state.loopExecutionModeByCli && state.loopExecutionModeByCli[targetCli];",
    "  return value === \"debate_multi_agent\" ? value : \"main_sub_multi_agent\";",
    "}",
    "function hideAddModelDialog() {}",
    "function showToast() {}",
    "function updateQueueIndicator() {}",
    "function resetPromptContextForNextPrompt() {}",
    "function resetTaskListForRunStart() {}",
    "function appendMessage() {}",
    "function createMessageId() { return \"message-id\"; }",
    "function reportWebviewFailure(message, error) { throw error || new Error(message); }",
    "function shouldHideParsedTaskListMessage() { return false; }",
    "function getTracePresentation() { return {}; }",
    "function safelyRenderMessageContent(message) { return String(message && message.content || \"\"); }",
    "function formatDateTime() { return \"\"; }",
    "function isFinalAssistantSummaryMessage() { return false; }",
    "function updateRunWait() {}",
    "function stickChatToBottom() {}",
    "function updateScrollToBottomButton() {}",
    "function updateTaskList() {}",
    "function isChatNearBottom() { return true; }",
    "function shouldFollowLatestMessagesForActiveTab() { return false; }",
    "function createMessageActionsElement() { return null; }",
    "function resetAutoInteractiveModeMemoryForTest() { lastAutoInteractiveModeTabKey = \"\"; }",
    ...names.map(([source, name]) => extractFunctionSource(source, name)),
    "this.api = {",
    "  getMessageTaskRoleLabel: getMessageTaskRoleLabel,",
    "  renderMessages: renderMessages,",
    "  renderConversationTabs: renderConversationTabs,",
    "  syncActiveMessagesFromRuntime: syncActiveMessagesFromRuntime,",
    "  resetAutoInteractiveModeMemoryForTest: resetAutoInteractiveModeMemoryForTest,",
    "  getConversationRuntimeState: getConversationRuntimeState,",
    "  openRunConflictOverlay: openRunConflictOverlay,",
    "  queueConflictPromptForLater: queueConflictPromptForLater,",
    "  pauseAndSendConflictPrompt: pauseAndSendConflictPrompt,",
    "  saveQueuedPromptEdit: saveQueuedPromptEdit,",
    "  flushPendingPromptQueue: flushPendingPromptQueue,",
    "  dispatchPrompt: dispatchPrompt,",
    "  queuePromptForLater: queuePromptForLater,",
    "  resolveAutoInteractiveModeForTab: resolveAutoInteractiveModeForTab",
    "};",
  ].join("\n");
}

type LabelCall = { key: string; round?: number };

function loadBrowser(activeTabId: string): {
  api: BrowserApi;
  state: BrowserState;
  messages: FakeElement;
  elements: {
    interactiveModeSelect: FakeElement;
    loopExecutionModeSelect: FakeElement;
    codexLoopModelGroup: FakeElement;
    modelSelect: FakeElement;
    promptInput: { value: string };
  };
  posted: PostedMessage[];
  labelCalls: LabelCall[];
  i18n: Record<string, string>;
  runningTabIds: Set<string>;
} {
  const state = createState(activeTabId);
  const messages = new FakeElement("div");
  const emptyState = new FakeElement("div");
  const interactiveModeSelect = control();
  const loopExecutionModeSelect = control();
  const codexLoopModelGroup = control();
  const modelSelect = control();
  const promptInput = { value: "" };
  const runConflictOverlay = new FakeElement("div");
  const runConflictPrompt = new FakeElement("div");
  const openCodeSmallModelSelect = control();
  openCodeSmallModelSelect.parentElement = new FakeElement("div");
  const elements = {
    messages,
    emptyState,
    interactiveModeSelect,
    loopExecutionModeSelect,
    codexLoopModelGroup,
    codexLoopMainModelSelect: control(),
    codexLoopMainThinkingMode: control(),
    codexLoopSubtaskModelSelect: control(),
    codexLoopSubtaskThinkingMode: control(),
    openCodeModelGroup: control(),
    openCodePrimaryModelSelect: control(),
    openCodeSmallModelSelect,
    modelSelect,
    promptInput,
    runConflictOverlay,
    runConflictPrompt,
    conversationTabs: null,
  };
  const posted: PostedMessage[] = [];
  const labelCalls: LabelCall[] = [];
  const runningTabIds = new Set<string>();
  const i18n = { ...getWebviewStrings("zh-CN") };
  const sandbox = {
    state,
    elements,
    document: { createElement: (tag?: string) => new FakeElement(tag || "div") },
    vscode: { postMessage: (message: PostedMessage) => posted.push(message) },
    i18n,
    labelCalls,
    runningTabIds,
  };
  vm.runInNewContext(browserScript(), sandbox);
  return {
    api: (sandbox as unknown as { api: BrowserApi }).api,
    state,
    messages,
    elements,
    posted,
    labelCalls,
    i18n,
    runningTabIds,
  };
}

function badgeText(messageNode: FakeElement): string {
  const badge = messageNode.children.find((child) => child.className.split(/\s+/).includes("message-task-role"));
  return badge ? badge.textContent : "";
}

function badgeClass(messageNode: FakeElement): string {
  const badge = messageNode.children.find((child) => child.className.split(/\s+/).includes("message-task-role"));
  return badge ? badge.className : "";
}

function renderedBadges(messages: FakeElement): string[] {
  return messages.children.map((message) => badgeText(message));
}

function message(partial: RoleMessage): RoleMessage {
  return partial;
}

test("splits historical message labels by task identity across classic and Loop+ tab refresh", () => {
  const browser = loadBrowser("classic-main");
  const { api, state, messages } = browser;
  const plusSubtask = message({
    id: "plus-subtask",
    role: "assistant",
    content: "accepted alone",
    taskRole: "subtask",
    loopTaskId: " task-plus ",
    loopRound: 1,
    kind: "thinking",
  });
  const classicSubtask = message({
    id: "classic-subtask",
    role: "assistant",
    content: "batch review",
    taskRole: "subtask",
    loopTaskId: "task-classic",
    loopRound: 2,
  });
  const plusMain = message({
    id: "plus-main-message",
    role: "assistant",
    content: "main",
    taskRole: "main",
    loopTaskId: "task-plus",
    loopRound: 1,
  });
  const unknownSubtask = message({
    id: "unknown-subtask",
    role: "assistant",
    content: "unknown",
    taskRole: "subtask",
    loopTaskId: "task-unknown",
    loopRound: 3,
  });
  const missingSubtask = message({
    id: "missing-subtask",
    role: "assistant",
    content: "missing",
    taskRole: "subtask",
    loopTaskId: "task-missing",
    loopRound: 4,
  });
  const blankSubtask = message({
    id: "blank-subtask",
    role: "assistant",
    content: "blank",
    taskRole: "subtask",
    loopTaskId: "task-blank",
    loopRound: 1,
  });
  const conflictSubtask = message({
    id: "conflict-subtask",
    role: "assistant",
    content: "conflict",
    taskRole: "subtask",
    loopTaskId: "task-conflict",
    loopRound: 1,
  });
  const spacedSubtask = message({
    id: "spaced-subtask",
    role: "assistant",
    content: "spaced",
    taskRole: "subtask",
    loopTaskId: "task-spaced",
    loopRound: 1,
  });
  const fractionalSubtask = message({
    id: "fractional-subtask",
    role: "assistant",
    content: "fraction",
    taskRole: "subtask",
    loopTaskId: "task-classic",
    loopRound: 1.9,
  });
  const zeroRoundSubtask = message({
    id: "zero-round",
    role: "assistant",
    content: "zero",
    taskRole: "subtask",
    loopTaskId: "task-classic",
    loopRound: 0,
  });
  const textRoundSubtask = message({
    id: "text-round",
    role: "assistant",
    content: "text",
    taskRole: "subtask",
    loopTaskId: "task-classic",
  });
  const plainMessage = message({
    id: "plain",
    role: "assistant",
    content: "plain",
  });
  const originalRounds = [plusSubtask, classicSubtask, plusMain].map((item) => item.loopRound);

  api.getConversationRuntimeState("classic-main").messages = [classicSubtask, plusSubtask, plusMain];
  api.getConversationRuntimeState("plus-main").messages = [plusSubtask, plusMain];
  api.getConversationRuntimeState("plus-sub").messages = [plusSubtask];
  api.getConversationRuntimeState("classic-sub").messages = [classicSubtask];

  const show = (tabId: string) => {
    state.conversationTabs.activeTabId = tabId;
    api.renderConversationTabs();
    api.syncActiveMessagesFromRuntime();
  };

  show("classic-main");
  assert.equal(state.interactiveMode, "loop");
  assert.equal(browser.elements.interactiveModeSelect.value, "loop");
  assert.equal(browser.elements.loopExecutionModeSelect.style.display, "");
  assert.equal(browser.elements.loopExecutionModeSelect.value, LOOP_EXECUTION_MODE_DEBATE);
  assert.deepEqual(renderedBadges(messages), ["子任务·第2轮", "子任务", "Loop"]);

  show("plus-main");
  assert.equal(state.interactiveMode, "loop_plus");
  assert.equal(browser.elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(browser.elements.loopExecutionModeSelect.value, LOOP_EXECUTION_MODE_DEBATE);
  assert.equal(state.loopExecutionModeByCli.codex, LOOP_EXECUTION_MODE_DEBATE);
  assert.deepEqual(renderedBadges(messages), ["子任务", "Loop"]);
  assert.equal(messages.children[0] ? badgeClass(messages.children[0]) : "", "message-task-role message-task-role-subtask");
  assert.equal(renderedBadges(messages).some((label) => label.includes("第")), false);

  show("plus-sub");
  assert.equal(state.interactiveMode, "coding");
  assert.equal(browser.elements.codexLoopModelGroup.style.display, "none");
  assert.deepEqual(renderedBadges(messages), ["子任务"]);

  show("graph-main");
  assert.equal(state.interactiveMode, "graph");
  assert.equal(browser.elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(browser.elements.codexLoopModelGroup.style.display, "");

  show("vibe-tab");
  assert.equal(
    api.resolveAutoInteractiveModeForTab(state.conversationTabs.tabs.find((tab) => tab.id === "vibe-tab") || null),
    "coding",
  );
  assert.equal(state.interactiveMode, "graph");
  assert.equal(state.conversationTabs.tabs.find((tab) => tab.id === "plus-main")?.loopSchedulingMode, "event_driven");
  assert.equal(state.conversationTabs.tabs.find((tab) => tab.id === "classic-main")?.loopSchedulingMode, "classic");
  assert.equal(state.conversationTabs.tabs.find((tab) => tab.id === "graph-main")?.graphRunId, "graph-1");

  show("classic-main");
  show("plus-main");
  show("classic-main");
  assert.equal(state.interactiveMode, "loop");
  assert.deepEqual(renderedBadges(messages), ["子任务·第2轮", "子任务", "Loop"]);

  state.interactiveMode = "loop_plus";
  state.conversationTabs.activeTabId = "classic-main";
  api.resetAutoInteractiveModeMemoryForTest();
  api.renderConversationTabs();
  api.syncActiveMessagesFromRuntime();
  assert.equal(state.interactiveMode, "loop");

  state.interactiveMode = "loop";
  state.conversationTabs.activeTabId = "plus-main";
  api.resetAutoInteractiveModeMemoryForTest();
  api.renderConversationTabs();
  api.syncActiveMessagesFromRuntime();
  assert.equal(state.interactiveMode, "loop_plus");
  assert.deepEqual(renderedBadges(messages), ["子任务", "Loop"]);

  state.conversationTabs = {
    activeTabId: "classic-main",
    tabs: createTabs().map((tab) => ({ ...tab })),
  };
  state.interactiveMode = "loop_plus";
  api.resetAutoInteractiveModeMemoryForTest();
  api.renderConversationTabs();
  state.messages = [
    plusSubtask,
    classicSubtask,
    unknownSubtask,
    missingSubtask,
    blankSubtask,
    conflictSubtask,
    spacedSubtask,
    fractionalSubtask,
    zeroRoundSubtask,
    textRoundSubtask,
    plainMessage,
  ];
  api.renderMessages();
  assert.equal(state.interactiveMode, "loop");
  assert.deepEqual(renderedBadges(messages), [
    "子任务",
    "子任务·第2轮",
    "子任务·第3轮",
    "子任务·第4轮",
    "子任务·第1轮",
    "子任务·第1轮",
    "子任务",
    "子任务·第1轮",
    "子任务",
    "子任务",
    "",
  ]);
  browser.labelCalls.length = 0;
  assert.equal(api.getMessageTaskRoleLabel(plusSubtask), "子任务");
  assert.equal(browser.labelCalls.length, 1);
  assert.equal(browser.labelCalls[0]?.key, "taskRoleSubtask");
  assert.equal(browser.labelCalls[0]?.round, undefined);
  assert.deepEqual([plusSubtask.loopRound, classicSubtask.loopRound, plusMain.loopRound], originalRounds);
  assert.equal(api.getMessageTaskRoleLabel(null), "");
  assert.equal(api.getMessageTaskRoleLabel({
    id: "negative",
    role: "assistant",
    content: "negative",
    taskRole: "subtask",
    loopTaskId: "task-classic",
    loopRound: -1,
  }), "子任务");

  const refreshedTabs = createTabs().map((tab) => (
    tab.loopTaskId === "task-plus" ? { ...tab, loopSchedulingMode: undefined } : { ...tab }
  ));
  state.conversationTabs = { activeTabId: "plus-main", tabs: refreshedTabs };
  state.interactiveMode = "coding";
  api.resetAutoInteractiveModeMemoryForTest();
  api.renderConversationTabs();
  state.messages = [plusSubtask];
  api.renderMessages();
  assert.equal(state.interactiveMode, "loop");
  assert.equal(renderedBadges(messages)[0], "子任务·第1轮");
  assert.equal(plusSubtask.loopRound, 1);

  state.conversationTabs = { activeTabId: "vibe-tab", tabs: createTabs() };
  state.interactiveMode = "loop_plus";
  api.resetAutoInteractiveModeMemoryForTest();
  api.renderConversationTabs();
  state.messages = [plusSubtask, classicSubtask];
  api.renderMessages();
  assert.equal(state.interactiveMode, "loop_plus");
  assert.deepEqual(renderedBadges(messages), ["子任务", "子任务·第2轮"]);

  browser.labelCalls.length = 0;
  api.renderMessages();
  const roleCalls = browser.labelCalls.filter((call) => call.key.startsWith("taskRole"));
  assert.deepEqual(roleCalls.map((call) => [call.key, call.round ?? null]), [
    ["taskRoleSubtask", null],
    ["taskRoleSubtaskWithRound", 2],
  ]);
  Object.assign(browser.i18n, getWebviewStrings("en"));
  api.renderMessages();
  assert.deepEqual(renderedBadges(messages), ["Subtask", "Subtask · Round 2"]);
  assert.equal(renderedBadges(messages).some((label) => label.includes("Round 1")), false);
});

test("keeps Loop+ busy-send payload while classic debate, Graph priority, and Vibe stay unchanged", () => {
  const browser = loadBrowser("plus-main");
  const { api, state, posted } = browser;
  const entry = {
    prompt: "accept the finished subtask",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  };

  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "loop_plus");
  api.openRunConflictOverlay(entry);
  const plusRuntime = api.getConversationRuntimeState("plus-main");
  assert.equal(plusRuntime.pendingRunPrompt?.interactiveMode, "loop_plus");
  assert.equal(plusRuntime.pendingRunPrompt?.loopMainModel, "entry-main");
  assert.equal(plusRuntime.pendingRunPrompt?.loopSubtaskModel, "entry-sub");
  assert.equal(plusRuntime.pendingRunPrompt?.loopMainThinkingMode, "xhigh");
  assert.equal(plusRuntime.pendingRunPrompt?.loopSubtaskThinkingMode, "low");
  assert.equal(Object.prototype.hasOwnProperty.call(plusRuntime.pendingRunPrompt, "loopExecutionMode"), false);

  state.interactiveMode = "coding";
  state.selectedLoopModelsByCli.codex = { main: "changed-main", subtask: "changed-sub" };
  state.selectedLoopThinkingByCli.codex = { main: "max", subtask: "medium" };
  browser.elements.promptInput.value = "draft";
  assert.equal(api.queueConflictPromptForLater(), true);
  assert.equal(plusRuntime.pendingPromptQueue.length, 1);
  assert.equal(plusRuntime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopMainModel, "entry-main");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopSubtaskModel, "entry-sub");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopMainThinkingMode, "xhigh");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopSubtaskThinkingMode, "low");
  assert.equal(plusRuntime.pendingPromptQueue[0].skipPromptHistory, true);
  assert.equal(browser.elements.promptInput.value, "");

  plusRuntime.queueEditingIndex = 0;
  plusRuntime.queueEditingDraft = "   ";
  api.saveQueuedPromptEdit();
  assert.equal(plusRuntime.pendingPromptQueue[0].prompt, "accept the finished subtask");
  plusRuntime.queueEditingIndex = 0;
  plusRuntime.queueEditingDraft = "edited after the dropdown changed";
  api.saveQueuedPromptEdit();
  assert.equal(plusRuntime.pendingPromptQueue[0].prompt, "edited after the dropdown changed");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopMainThinkingMode, "xhigh");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopSubtaskThinkingMode, "low");

  state.conversationTabs.activeTabId = "classic-main";
  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "loop");
  assert.equal(api.getConversationRuntimeState("classic-main").pendingPromptQueue.length, 0);
  assert.equal(api.flushPendingPromptQueue("plus-main"), true);
  const queuedSend = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(queuedSend);
  assert.equal(queuedSend.prompt, "edited after the dropdown changed");
  assert.equal(queuedSend.interactiveMode, "loop_plus");
  assert.equal(queuedSend.tabId, "plus-main");
  assert.equal(queuedSend.loopMainModel, "entry-main");
  assert.equal(queuedSend.loopSubtaskModel, "entry-sub");
  assert.equal(queuedSend.loopMainThinkingMode, "xhigh");
  assert.equal(queuedSend.loopSubtaskThinkingMode, "low");
  assert.equal(Object.prototype.hasOwnProperty.call(queuedSend, "loopExecutionMode"), false);

  assert.equal(api.dispatchPrompt({
    prompt: "classic loop",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  }), true);
  const classicSend = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(classicSend);
  assert.equal(classicSend.interactiveMode, "loop");
  assert.equal(classicSend.loopExecutionMode, LOOP_EXECUTION_MODE_DEBATE);
  assert.equal(classicSend.loopMainModel, "changed-main");
  assert.equal(classicSend.loopMainThinkingMode, "max");

  state.conversationTabs.tabs.find((tab) => tab.id === "plus-main")!.loopTaskRunning = true;
  state.conversationTabs.activeTabId = "plus-main";
  state.selectedLoopModelsByCli.codex = { main: "entry-main", subtask: "entry-sub" };
  state.selectedLoopThinkingByCli.codex = { main: "high", subtask: "medium" };
  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "loop_plus");
  api.openRunConflictOverlay({ ...entry, prompt: "pause me" });
  state.interactiveMode = "loop";
  state.selectedLoopModelsByCli.codex = { main: "changed-main", subtask: "changed-sub" };
  const sentBeforePause = posted.filter((message) => message.type === "sendPrompt").length;
  assert.equal(api.pauseAndSendConflictPrompt(), undefined);
  assert.equal(posted.filter((message) => message.type === "sendPrompt").length, sentBeforePause);
  assert.equal(plusRuntime.pendingPromptQueue[0].interactiveMode, "loop_plus");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopMainModel, "entry-main");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopMainThinkingMode, "high");
  assert.equal(plusRuntime.pendingPromptQueue[0].loopSubtaskThinkingMode, "medium");
  assert.equal(api.flushPendingPromptQueue("plus-main"), false);
  assert.equal(plusRuntime.pendingPromptQueue.length, 1);

  state.conversationTabs.tabs.find((tab) => tab.id === "plus-main")!.loopTaskRunning = false;
  assert.equal(api.flushPendingPromptQueue("plus-main"), true);
  const pausedLater = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(pausedLater);
  assert.equal(pausedLater.prompt, "pause me");
  assert.equal(pausedLater.interactiveMode, "loop_plus");
  assert.equal(pausedLater.loopMainThinkingMode, "high");
  assert.equal(Object.prototype.hasOwnProperty.call(pausedLater, "loopExecutionMode"), false);

  state.selectedLoopModelsByCli.codex = { main: "entry-main", subtask: "entry-sub" };
  state.selectedLoopThinkingByCli.codex = { main: "high", subtask: "medium" };
  state.interactiveMode = "loop_plus";
  api.openRunConflictOverlay({ ...entry, prompt: "send without waiting" });
  state.interactiveMode = "coding";
  state.selectedLoopModelsByCli.codex = { main: "changed-main", subtask: "changed-sub" };
  browser.elements.promptInput.value = "pause me";
  assert.equal(api.pauseAndSendConflictPrompt(), true);
  const immediate = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(immediate);
  assert.equal(immediate.prompt, "send without waiting");
  assert.equal(immediate.interactiveMode, "loop_plus");
  assert.equal(immediate.loopMainModel, "entry-main");
  assert.equal(immediate.loopSubtaskModel, "entry-sub");
  assert.equal(immediate.loopMainThinkingMode, "high");
  assert.equal(immediate.loopSubtaskThinkingMode, "medium");
  assert.equal(Object.prototype.hasOwnProperty.call(immediate, "loopExecutionMode"), false);
  assert.equal(browser.elements.promptInput.value, "");

  state.conversationTabs.activeTabId = "vibe-tab";
  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "coding");
  assert.equal(api.dispatchPrompt({
    prompt: "vibe",
    contextOptions: { includeCurrentFile: true, includeSelection: true },
    loopMainModel: "stale-main",
    loopSubtaskModel: "stale-sub",
    loopMainThinkingMode: "max",
    loopSubtaskThinkingMode: "low",
  }), true);
  const vibe = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(vibe);
  assert.equal(vibe.interactiveMode, "coding");
  assert.equal(vibe.model, "single-model");
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopMainModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopSubtaskModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopMainThinkingMode"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vibe, "loopExecutionMode"), false);

  state.conversationTabs.activeTabId = "graph-main";
  state.interactiveMode = "loop_plus";
  api.resetAutoInteractiveModeMemoryForTest();
  api.renderConversationTabs();
  assert.equal(state.interactiveMode, "graph");
  state.selectedLoopModelsByCli.codex = { main: "entry-main", subtask: "entry-sub" };
  state.selectedLoopThinkingByCli.codex = { main: "xhigh", subtask: "low" };
  assert.equal(api.dispatchPrompt({
    prompt: "graph first",
    contextOptions: { includeCurrentFile: false, includeSelection: false },
  }), true);
  const graph = posted.filter((message) => message.type === "sendPrompt").at(-1);
  assert.ok(graph);
  assert.equal(graph.interactiveMode, "graph");
  assert.equal(graph.loopMainModel, "entry-main");
  assert.equal(graph.loopSubtaskThinkingMode, "low");
  assert.equal(Object.prototype.hasOwnProperty.call(graph, "loopExecutionMode"), false);

  posted.length = 0;
  api.queuePromptForLater({ prompt: "", contextOptions: { includeCurrentFile: true, includeSelection: true } });
  api.openRunConflictOverlay({ prompt: "", contextOptions: { includeCurrentFile: true, includeSelection: true } });
  assert.equal(posted.filter((message) => message.type === "sendPrompt").length, 0);
  assert.equal(api.getConversationRuntimeState("graph-main").pendingPromptQueue.length, 0);
});

test("hides Loop+ protocol prompts from message bubbles", () => {
  const browser = loadBrowser("plus-main");
  const userPrompt = "真实用户目标";
  const mentioned = "请看 You are the Loop+ main reviewer. 这不是协议开头";
  browser.state.messages = [
    { id: "user", role: "user", content: userPrompt },
    { id: "main", role: "user", content: "You are the Loop+ main reviewer.\nMAIN_PROTOCOL_SECRET", taskRole: "main" },
    { id: "sub", role: "system", content: "  You are one independent Loop+ execution attempt.\nSUB_PROTOCOL_SECRET", taskRole: "subtask" },
    { id: "mention", role: "user", content: mentioned },
  ];
  browser.api.renderMessages();
  const bubbles = browser.messages.children.map((node) => node.querySelector(".bubble")?.innerHTML ?? "");
  assert.equal(bubbles.some((html) => html.includes(userPrompt)), true);
  assert.equal(bubbles.some((html) => html.includes(mentioned)), true);
  assert.equal(bubbles.some((html) => html.includes("MAIN_PROTOCOL_SECRET")), false);
  assert.equal(bubbles.some((html) => html.includes("SUB_PROTOCOL_SECRET")), false);

  browser.state.onlyShowFinalResults = true;
  browser.api.renderMessages();
  const resultBubbles = browser.messages.children.map((node) => node.querySelector(".bubble")?.innerHTML ?? "");
  assert.equal(resultBubbles.some((html) => html.includes(userPrompt)), true);
  assert.equal(resultBubbles.some((html) => html.includes("MAIN_PROTOCOL_SECRET")), false);
});

