import * as assert from "node:assert/strict";
import { test } from "node:test";
import { CLI_LIST } from "../../cli/types";

import { createZcodeExampleText, readZcodeConfigModels, ZCODE_EXAMPLE_MODEL_ID } from "../../config/zcodeConfig";
import { buildWebviewRuntimeScript } from "../../webview/viewContentScript";
import { VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME } from "../../webview/viewContentScript/attachmentsAndTime";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../../webview/viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_HISTORY_PANELS } from "../../webview/viewContentScript/historyPanels";
import { VIEW_CONTENT_SCRIPT_HUMAN_INTERACTION_HISTORY } from "../../webview/viewContentScript/humanInteractionHistory";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { OVERLAYS_MODALS_STYLES } from "../../webview/viewContentStyles/overlaysModals";

type Listener = (event?: any) => void;

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = start + signature.length; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parameterDepth += 1;
    } else if (char === ")") {
      parameterDepth -= 1;
    } else if (char === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
  let depth = 0;
  let quote: string | null = null;
  let inRegex = false;
  let inRegexCharClass = false;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (inRegex) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "[") {
        inRegexCharClass = true;
      } else if (char === "]") {
        inRegexCharClass = false;
      } else if (char === "/" && !inRegexCharClass) {
        inRegex = false;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (
      char === "/"
      && source[index + 1] !== "/"
      && source[index + 1] !== "*"
      && isLikelyRegexLiteralStart(source, index)
    ) {
      inRegex = true;
      inRegexCharClass = false;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
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

function isLikelyRegexLiteralStart(source: string, slashIndex: number): boolean {
  for (let index = slashIndex - 1; index >= 0; index -= 1) {
    const char = source[index];
    if (/\s/.test(char)) {
      continue;
    }
    if ("({[=,:;!?&|+-*~^<>".includes(char)) {
      return true;
    }
    const prefix = source.slice(Math.max(0, index - 8), index + 1);
    return /\b(?:return|case|throw|typeof|delete|void|new|in|of)$/.test(prefix);
  }
  return true;
}

function extractWindowMessageHandlerSource(): string {
  const start = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.indexOf("window.addEventListener(\"message\"");
  assert.notEqual(start, -1, "Missing window message listener");
  const callbackStart = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.indexOf("(event) => {", start);
  assert.notEqual(callbackStart, -1, "Missing window message callback");
  const bodyStart = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.indexOf("{", callbackStart);
  let depth = 0;
  for (let index = bodyStart; index < VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.length; index += 1) {
    const char = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return `function handleWindowMessage(event) ${VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.slice(bodyStart, index + 1)}`;
      }
    }
  }
  throw new Error("Unterminated window message callback");
}

class FakeClassList {
  private readonly names = new Set<string>();

  constructor(private readonly sync: (value: string) => void) {}

  setFromClassName(value: string): void {
    this.names.clear();
    String(value || "").split(/\s+/).filter(Boolean).forEach((name) => this.names.add(name));
    this.flush();
  }

  add(...names: string[]): void {
    names.filter(Boolean).forEach((name) => this.names.add(name));
    this.flush();
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.names.delete(name));
    this.flush();
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force === undefined ? !this.names.has(name) : Boolean(force);
    if (next) {
      this.names.add(name);
    } else {
      this.names.delete(name);
    }
    this.flush();
    return next;
  }

  private flush(): void {
    this.sync(Array.from(this.names).join(" "));
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly listeners: Record<string, Listener[]> = {};
  readonly style: Record<string, any> = {
    display: "",
    setProperty(name: string, value: string): void {
      this[name] = value;
    },
  };
  readonly classList = new FakeClassList((value) => {
    this.classNameValue = value;
  });
  classNameValue = "";
  id = "";
  tagName = "";
  textContent = "";
  value = "";
  type = "";
  title = "";
  checked = false;
  disabled = false;
  open = false;
  tabIndex = 0;
  selectionStart = 0;
  selectionEnd = 0;
  scrollTop = 0;
  scrollHeight = 100;
  clientHeight = 100;
  focused = false;
  selected = false;
  parentNode: FakeElement | null = null;
  private innerHtmlValue = "";

  get parentElement(): FakeElement | null {
    return this.parentNode;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] || null;
  }

  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
  }

  get className(): string {
    return this.classNameValue;
  }

  set className(value: string) {
    this.classList.setFromClassName(value);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get innerHTML(): string {
    return this.innerHtmlValue;
  }

  set innerHTML(value: string) {
    this.innerHtmlValue = String(value || "");
    this.children.splice(0, this.children.length);
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore<T extends FakeElement>(child: T, before: FakeElement | null): T {
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) {
      this.children.splice(index, 0, child);
    } else {
      this.children.push(child);
    }
    return child;
  }

  removeChild<T extends FakeElement>(child: T): T {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length);
    this.innerHtmlValue = "";
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatchEvent(event: any): boolean {
    const normalized = normalizeEvent(event, this);
    (this.listeners[normalized.type] || []).forEach((listener) => listener(normalized));
    return !normalized.defaultPrevented;
  }

  click(): void {
    this.dispatchEvent({ type: "click" });
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {
    this.selected = true;
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  scrollTo(options: { top?: number }): void {
    this.scrollTop = typeof options.top === "number" ? options.top : this.scrollTop;
  }

  setAttribute(name: string, value: string): void {
    const normalized = String(value);
    this.attributes[name] = normalized;
    if (name === "class") {
      this.className = normalized;
    }
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
      this.dataset[key] = normalized;
    }
  }

  getAttribute(name: string): string | null {
    if (name === "class") {
      return this.className;
    }
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === "open") {
      this.open = false;
    }
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      node.children.forEach((child) => {
        if (matchesSelector(child, selector)) {
          result.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return result;
  }
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  const tagMatch = selector.match(/^[a-z]+/i);
  if (tagMatch && element.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) {
    return false;
  }
  const classMatches = Array.from(selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map((match) => match[1]);
  if (classMatches.some((className) => !element.classList.contains(className))) {
    return false;
  }
  if (selector.includes("[open]") && !element.open) {
    return false;
  }
  if (selector.includes("[data-trace-key]") && !element.getAttribute("data-trace-key")) {
    return false;
  }
  if (selector.includes("[data-stream-record-id]") && !element.getAttribute("data-stream-record-id")) {
    return false;
  }
  return true;
}

function normalizeEvent(event: any, target: FakeElement): any {
  const normalized = event || {};
  normalized.type ||= "event";
  normalized.target ||= target;
  normalized.currentTarget ||= target;
  normalized.defaultPrevented = false;
  normalized.preventDefault ||= () => {
    normalized.defaultPrevented = true;
  };
  normalized.stopPropagation ||= () => undefined;
  return normalized;
}

function createFakeDocument(): any {
  const elements = new Map<string, FakeElement>();
  const document = {
    body: new FakeElement("body", "body"),
    documentElement: new FakeElement("html", "html"),
    getElementById(id: string): FakeElement {
      if (!elements.has(id)) {
        elements.set(id, new FakeElement("div", id));
      }
      return elements.get(id) as FakeElement;
    },
    createElement(tagName: string): FakeElement {
      return new FakeElement(tagName);
    },
    execCommand(command: string): boolean {
      return command === "copy";
    },
    elements,
  };
  return document;
}

function createFakeWindow(): any {
  const listeners: Record<string, Listener[]> = {};
  let nextTimerId = 1;
  const timers = new Map<number, Listener>();
  const timerDelays = new Map<number, number>();
  return {
    innerHeight: 720,
    listeners,
    timers,
    timerDelays,
    addEventListener(type: string, listener: Listener): void {
      (listeners[type] ||= []).push(listener);
    },
    dispatchMessage(data: unknown): void {
      (listeners.message || []).forEach((listener) => listener({ type: "message", data }));
    },
    dispatchEvent(event: any): void {
      const normalized = event || {};
      (listeners[normalized.type] || []).forEach((listener) => listener(normalized));
    },
    setInterval(listener: Listener): number {
      const id = nextTimerId++;
      timers.set(id, listener);
      return id;
    },
    clearInterval(id: number): void {
      timers.delete(id);
      timerDelays.delete(id);
    },
    setTimeout(listener: Listener, delay?: number): number {
      const id = nextTimerId++;
      timers.set(id, listener);
      timerDelays.set(id, Number(delay) || 0);
      return id;
    },
    clearTimeout(id: number): void {
      timers.delete(id);
      timerDelays.delete(id);
    },
    requestAnimationFrame(listener: Listener): number {
      listener();
      return nextTimerId++;
    },
    cancelAnimationFrame(): void {
      return undefined;
    },
  };
}

function runLatestTimer(fakeWindow: { timers: Map<number, Listener>; timerDelays: Map<number, number> }): void {
  const latest = Array.from(fakeWindow.timers.entries())
    .filter(([timerId]) => fakeWindow.timerDelays.has(timerId))
    .at(-1);
  assert.ok(latest, "Expected a pending timer");
  fakeWindow.timers.delete(latest[0]);
  latest[1]();
}

function createRuntimeHarness(
  markedOverride?: unknown,
  fileReaderOverride?: unknown,
  cliListOverride?: string[],
) {
  const document = createFakeDocument();
  const fakeWindow = createFakeWindow();
  const posted: any[] = [];
  const vscode = {
    getState: () => ({ onlyShowFinalResults: true }),
    setState: (state: unknown) => {
      posted.push({ type: "setState", state });
    },
    postMessage: (message: unknown) => {
      posted.push(message);
    },
  };
  const navigator = {
    clipboard: {
      writeText(value: string) {
        posted.push({ type: "clipboard", value });
        return Promise.resolve();
      },
    },
  };
  const script = buildWebviewRuntimeScript({
    i18n: WEBVIEW_STRINGS,
    cliList: cliListOverride ?? ["codex", "claude", "opencode"],
    loopMaxRoundsDefault: 5,
    loopMaxRoundsMin: 1,
    loopMaxRoundsMax: 12,
    loopSubtaskMaxThinkingModeDefault: "high",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
    finalAnswerTextMarker: "<FINAL>",
  });
  const runtimeFactory = new Function(
    "acquireVsCodeApi",
    "document",
    "window",
    "navigator",
    "FileReader",
    "marked",
    "console",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    `${script}
      return {
        state,
        elements,
        appendRunRawStream,
        applyExternalTaskListUpdate,
        buildInsertText,
        buildPromptPayload,
        buildRunStreamExportPayload,
        closeHistorySessionMessages,
        continueQueuedPrompts,
        dispatchPrompt,
        formatDateTime,
        formatDateTimeWithMs,
        getActiveConversationRuntimeState,
        getConversationRuntimeState,
        getAssistantMessageContentForDisplay,
        getRunPromptHistory,
        handleFileSelection,
        humanInteractionHistoryAnswer,
        appendAssistantDelta,
        openHistorySessionMessages,
        openQueueOverlay,
        openRunStreamOverlay,
        parseTaskListFromText,
        queuePromptForLater,
        removePromptContextTag,
        renderMessages,
        requestRunStreamExport,
        resetConversationRuntimeState,
        updateContextTokenUsage,
        updateRunStreamButton,
        sendPrompt,
        setMessagesForTab,
        shouldHideParsedTaskListMessage,
        stripParsedTaskListContentFromText,
        forceRenderMarkdownFailure: () => {
          renderMarkdown = () => { throw new Error("markdown failed"); };
          renderMessages();
        },
      };`,
  );
  const api = runtimeFactory(
    () => vscode,
    document,
    fakeWindow,
    navigator,
    fileReaderOverride,
    markedOverride,
    console,
    fakeWindow.setTimeout,
    fakeWindow.clearTimeout,
    fakeWindow.setInterval,
    fakeWindow.clearInterval,
    fakeWindow.requestAnimationFrame,
    fakeWindow.cancelAnimationFrame,
    () => ({ lineHeight: "22.4px" }),
  );
  return { api, document, window: fakeWindow, posted };
}

function createPanelState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currentCli: "codex",
    sessionState: {
      currentSessionId: "session-1",
      sessions: [
        {
          id: "session-1",
          cli: "codex",
          firstPrompt: "inspect project",
          createdAt: 1_700_000_000_000,
          isLoopSession: true,
          isOpenInConversationTabs: true,
          openConversationTabId: "tab-1",
        },
      ],
    },
    conversationTabs: {
      activeTabId: "tab-1",
      tabs: [
        { id: "tab-1", cli: "codex", loopTaskRole: "main", loopTaskId: "task-1", loopTaskStatus: "running" },
        { id: "tab-2", cli: "claude" },
      ],
    },
    promptHistory: [{ id: "p-1", prompt: "previous prompt", cli: "codex", createdAt: 1_700_000_000_001 }],
    configState: {
      activeConfigId: "cfg-1",
      configs: [{ id: "cfg-1", name: "Default" }],
    },
    modelState: {
      optionsByCli: { codex: ["gpt-5", "gpt-5"], claude: [], opencode: [] },
      managedByCli: { codex: ["gpt-5"], claude: [], opencode: [] },
      selectedByCli: { codex: "gpt-5", claude: "", opencode: "" },
      loopOptionsByCli: {
        codex: { main: ["gpt-5-main", "gpt-5-main"], subtask: ["gpt-5-subtask"] },
        claude: { main: [], subtask: [] },
        opencode: { main: [], subtask: [] },
      },
      selectedLoopByCli: {
        codex: { main: "gpt-5-main", subtask: "gpt-5-subtask" },
        claude: { main: "", subtask: "" },
        opencode: { main: "", subtask: "" },
      },
      selectedLoopThinkingByCli: {
        codex: { main: "high", subtask: "low" },
        claude: { main: "", subtask: "" },
        opencode: { main: "", subtask: "" },
      },
    },
    thinkingMode: "medium",
    openCodeThinking: { selectedVariant: "high", options: [{ value: "high", label: "High" }] },
    openCodeSmallThinking: { selectedVariant: null, options: [] },
    openCodeModels: {
      models: [{ ref: "provider/model", label: "Provider Model", providerId: "provider", modelId: "model" }],
      selectedPrimaryRef: "provider/model",
      selectedSmallRef: "provider/model",
      issues: [],
    },
    interactiveMode: "loop",
    debug: true,
    autoAddEditorContextTags: true,
    longTermMemoryEnabled: true,
    workspaceMemoryEnabled: true,
    autoCompactContextAfterRun: true,
    loopMaxRounds: 99,
    loopSubtaskMaxThinkingMode: "xhigh",
    loopExecutionModeByCli: { codex: "debate_multi_agent" },
    isMac: true,
    macTaskShell: "bash",
    interactive: { supported: true, enabled: true },
    rulePaths: { global: { codex: "/global/AGENTS.md" }, project: { codex: "/project/AGENTS.md" } },
    editorContext: {
      filePath: "/repo/src/index.ts",
      fileLabel: "src/index.ts",
      hasSelection: true,
      selectionLabel: "1:1-2:1",
    },
    ...overrides,
  };
}

function childValueTextPairs(element: FakeElement): Array<[string, string]> {
  return element.children.map((child) => [child.value, child.textContent]);
}

function conversationTabByLabel(document: { getElementById(id: string): FakeElement }, label: string): FakeElement | undefined {
  return document.getElementById("conversationTabs")
    .querySelectorAll(".conversation-tab")
    .find((item) => item.querySelector(".conversation-tab-label")?.textContent === label);
}

function postedTabActions(posted: Array<{ type?: string }>, start: number): Array<{ type?: string }> {
  return posted.slice(start).filter((message) => (
    message.type === "selectConversationTab"
    || message.type === "openLoopGroupChat"
    || message.type === "closeConversationTab"
  ));
}

test("opens the Loop group chat when the main task tab is clicked", () => {
  const { document, window, posted } = createRuntimeHarness();
  const tabs = {
    activeTabId: "sub-tab",
    tabs: [
      { id: "main-tab", cli: "codex", loopTaskRole: "main", loopTaskId: " task-main ", loopSchedulingMode: "event_driven" },
      { id: "sub-tab", cli: "codex", loopTaskRole: "subtask", loopTaskId: "task-main" },
      { id: "plain-tab", cli: "claude" },
      { id: "blank-main-tab", cli: "codex", loopTaskRole: "main", loopTaskId: " " },
    ],
  };
  window.dispatchMessage({ type: "state", payload: createPanelState({ conversationTabs: tabs }) });

  const beforeMain = posted.length;
  const mainTab = conversationTabByLabel(document, "☀️ Codex");
  assert.ok(mainTab);
  mainTab.click();
  assert.deepEqual(postedTabActions(posted, beforeMain), [
    { type: "selectConversationTab", tabId: "main-tab", cli: "codex" },
    { type: "openLoopGroupChat", taskId: "task-main" },
  ]);

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({ conversationTabs: { ...tabs, activeTabId: "main-tab" } }),
  });
  const beforeRepeat = posted.length;
  const activeMainTab = conversationTabByLabel(document, "☀️ Codex");
  assert.ok(activeMainTab);
  activeMainTab.click();
  activeMainTab.dispatchEvent({ type: "keydown", key: "Enter" });
  activeMainTab.dispatchEvent({ type: "keydown", key: " " });
  assert.deepEqual(postedTabActions(posted, beforeRepeat), [
    { type: "openLoopGroupChat", taskId: "task-main" },
    { type: "openLoopGroupChat", taskId: "task-main" },
    { type: "openLoopGroupChat", taskId: "task-main" },
  ]);

  const beforeOthers = posted.length;
  conversationTabByLabel(document, "🌛 Codex2")?.click();
  conversationTabByLabel(document, "Claude")?.click();
  conversationTabByLabel(document, "Codex3")?.click();
  assert.deepEqual(postedTabActions(posted, beforeOthers), [
    { type: "selectConversationTab", tabId: "sub-tab", cli: "codex" },
    { type: "selectConversationTab", tabId: "plain-tab", cli: "claude" },
    { type: "selectConversationTab", tabId: "blank-main-tab", cli: "codex" },
  ]);

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({ conversationTabs: { ...tabs, activeTabId: "main-tab" } }),
  });
  const beforeClose = posted.length;
  conversationTabByLabel(document, "☀️ Codex")?.querySelector(".conversation-tab-close")?.click();
  assert.deepEqual(postedTabActions(posted, beforeClose), [
    { type: "closeConversationTab", tabId: "main-tab", cli: "codex" },
  ]);
  assert.deepEqual(posted.slice(beforeMain).filter((message) => message.type === "webviewError"), []);
});

test("shows the workspace harness toggle as checked and disabled when .ch already exists", () => {
  const { document, window } = createRuntimeHarness();
  const idleTabs = { activeTabId: "tab-1", tabs: [{ id: "tab-1", cli: "codex" }] };
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      longTermMemoryEnabled: false,
      workspaceMemoryEnabled: false,
      workspaceHarnessInstalled: true,
      conversationTabs: idleTabs,
    }),
  });
  const toggle = document.getElementById("longTermMemoryEnabled");
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, true);
  assert.equal(
    document.getElementById("longTermMemoryNote").textContent,
    WEBVIEW_STRINGS.toolSettingsLongTermMemoryInstalledHint,
  );

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      longTermMemoryEnabled: false,
      workspaceMemoryEnabled: false,
      workspaceHarnessInstalled: false,
      conversationTabs: idleTabs,
    }),
  });
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, false);
  assert.equal(
    document.getElementById("longTermMemoryNote").textContent,
    WEBVIEW_STRINGS.toolSettingsLongTermMemoryHint,
  );
});

test("shows the CodeGraph toggle as checked and disabled when the workspace is ready", () => {
  const { document, window } = createRuntimeHarness();
  const idleTabs = { activeTabId: "tab-1", tabs: [{ id: "tab-1", cli: "codex" }] };
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      codeGraphInstalled: true,
      codeGraphInstalling: false,
      conversationTabs: idleTabs,
    }),
  });
  const toggle = document.getElementById("codeGraphEnabled");
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, true);
  assert.equal(
    document.getElementById("codeGraphNote").textContent,
    WEBVIEW_STRINGS.toolSettingsInstallCodeGraphInstalledHint,
  );

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      codeGraphInstalled: false,
      codeGraphInstalling: true,
      conversationTabs: idleTabs,
    }),
  });
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, true);
  assert.equal(
    document.getElementById("codeGraphNote").textContent,
    WEBVIEW_STRINGS.toolSettingsInstallCodeGraphInstallingHint,
  );

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      codeGraphInstalled: false,
      codeGraphInstalling: false,
      conversationTabs: idleTabs,
    }),
  });
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, false);
  assert.equal(
    document.getElementById("codeGraphNote").textContent,
    WEBVIEW_STRINGS.toolSettingsInstallCodeGraphHint,
  );
});

test("keeps uninstalled workspace toggles clickable while a Loop main task is running", () => {
  const { document, window } = createRuntimeHarness();
  const runningLoopMainTabs = {
    activeTabId: "tab-1",
    tabs: [{
      id: "tab-1",
      cli: "codex",
      loopTaskRole: "main",
      loopTaskId: "task-1",
      loopTaskStatus: "running",
      loopTaskRunning: true,
    }],
  };
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      longTermMemoryEnabled: false,
      workspaceMemoryEnabled: false,
      workspaceHarnessInstalled: false,
      codeGraphInstalled: false,
      codeGraphInstalling: false,
      conversationTabs: runningLoopMainTabs,
    }),
  });
  const harnessToggle = document.getElementById("longTermMemoryEnabled");
  const codeGraphToggle = document.getElementById("codeGraphEnabled");
  assert.equal(harnessToggle.checked, false);
  assert.equal(harnessToggle.disabled, false);
  assert.equal(codeGraphToggle.checked, false);
  assert.equal(codeGraphToggle.disabled, false);
  assert.equal(
    document.getElementById("longTermMemoryNote").textContent,
    WEBVIEW_STRINGS.toolSettingsLongTermMemoryHint,
  );
  assert.equal(
    document.getElementById("codeGraphNote").textContent,
    WEBVIEW_STRINGS.toolSettingsInstallCodeGraphHint,
  );

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000, prompt: "run task" });
  assert.equal(harnessToggle.disabled, false);
  assert.equal(codeGraphToggle.disabled, false);

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      workspaceHarnessInstalled: true,
      codeGraphInstalled: false,
      codeGraphInstalling: true,
      conversationTabs: runningLoopMainTabs,
    }),
  });
  assert.equal(harnessToggle.checked, true);
  assert.equal(harnessToggle.disabled, true);
  assert.equal(codeGraphToggle.checked, false);
  assert.equal(codeGraphToggle.disabled, true);
});

test("builds the split page runtime script with configured literals", () => {
  const script = buildWebviewRuntimeScript({
    i18n: { ok: "OK" },
    cliList: ["codex"],
    loopMaxRoundsDefault: 4,
    loopMaxRoundsMin: 2,
    loopMaxRoundsMax: 9,
    loopSubtaskMaxThinkingModeDefault: "medium",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
    finalAnswerTextMarker: "<FINAL>",
  });

  assert.match(script, /const i18n = \{"ok":"OK"\}/);
  assert.match(script, /const CLI_NAMES = \["codex"\]/);
  assert.match(script, /loopMaxRounds: 4/);
  assert.match(script, /Math\.max\(Math\.floor\(numeric\), 2\)/);
  assert.match(script, /"medium"/);
  assert.match(script, /"<FINAL>"/);
  assert.doesNotMatch(script, /\$\{JSON\.stringify|\$\{LOOP_|\$\{FINAL_/);
});

function createProfilePanelState(cli: string, configId: string, overrides: Record<string, unknown> = {}) {
  const model = `${configId}-model`;
  const modelRef = `provider/${model}`;
  const thinkingMode = configId === "config-a" ? "high" : "low";
  return createPanelState({
    currentCli: cli,
    configState: {
      activeConfigId: configId,
      configs: ["config-a", "config-b"].map((id) => ({ id, name: id, platform: cli })),
    },
    modelState: {
      optionsByCli: { [cli]: [model] },
      managedByCli: { [cli]: [model] },
      selectedByCli: { [cli]: model },
      loopOptionsByCli: { [cli]: { main: [model], subtask: [model] } },
      selectedLoopByCli: { [cli]: { main: model, subtask: model } },
      selectedLoopThinkingByCli: { [cli]: { main: thinkingMode, subtask: thinkingMode } },
    },
    thinkingMode,
    openCodeModels: {
      models: [{ ref: modelRef, label: model, providerId: "provider", modelId: model }],
      selectedMainRef: modelRef,
      selectedSubtaskRef: modelRef,
      issues: [],
    },
    openCodeThinking: { selectedVariant: thinkingMode, options: [{ value: thinkingMode, label: thinkingMode }] },
    openCodeSmallThinking: { selectedVariant: thinkingMode, options: [{ value: thinkingMode, label: thinkingMode }] },
    ...overrides,
  });
}

for (const cli of ["codex", "claude", "opencode"]) {
  test(`${cli} preserves a pending profile selection when resetting the conversation`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    const conversationTabs = {
      activeTabId: "old-tab",
      tabs: [{ id: "old-tab", cli, sessionId: "old-session" }],
    };
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-a", { conversationTabs }),
    });
    const configSelect = document.getElementById("configSelect");
    configSelect.value = "config-b";
    configSelect.dispatchEvent({ type: "change" });
    const pendingConfigApply = api.state.pendingConfigApply;
    const pendingOpenCodeRoleSelection = { configId: "config-b", role: "main", value: "provider/model" };
    api.state.pendingOpenCodeRoleSelection = pendingOpenCodeRoleSelection;
    api.setMessagesForTab("old-tab", [{ id: "old-message", role: "user", content: "old prompt" }]);
    document.getElementById("resetSession").dispatchEvent({ type: "click" });
    assert.equal(posted.filter((message) => message.type === "resetConversationTabSession").length, 1);
    const postedBeforeReset = posted.length;

    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-a", {
        conversationTabs: { activeTabId: "new-tab", tabs: [{ id: "new-tab", cli, sessionId: null }] },
      }),
    });

    assert.equal(api.state.currentCli, cli);
    assert.equal(api.state.conversationTabs.activeTabId, "new-tab");
    assert.equal(configSelect.value, "config-b");
    assert.equal(api.state.pendingConfigApply, pendingConfigApply);
    assert.equal(api.state.pendingOpenCodeRoleSelection, pendingOpenCodeRoleSelection);
    assert.deepEqual(api.state.messages, []);
    assert.deepEqual(posted.slice(postedBeforeReset).filter((message) => message.type === "applyConfig"), []);

    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-b", {
        conversationTabs: { activeTabId: "new-tab", tabs: [{ id: "new-tab", cli, sessionId: null }] },
      }),
    });
    assert.equal(configSelect.value, "config-b");
    assert.equal(api.state.pendingConfigApply, null);
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-a", {
        conversationTabs: {
          activeTabId: "other-tab",
          tabs: [{ id: "new-tab", cli }, { id: "other-tab", cli, sessionId: "other-session" }],
        },
      }),
    });
    assert.equal(configSelect.value, "config-a");
    assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  });

  test(`${cli} preserves the selected profile across a reset with a stale configuration refresh`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-b", {
        conversationTabs: { activeTabId: "old-tab", tabs: [{ id: "old-tab", cli, sessionId: "session" }] },
      }),
    });
    document.getElementById("resetSession").dispatchEvent({ type: "click" });
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-a", {
        conversationTabs: { activeTabId: "new-tab", tabs: [{ id: "new-tab", cli, sessionId: null }] },
      }),
    });

    assert.equal(document.getElementById("configSelect").value, "config-b");
    assert.equal(api.state.pendingConversationReset, null);
    assert.deepEqual(posted.filter((message) => message.type === "applyConfig"), [
      { type: "applyConfig", cli, configId: "config-b" },
    ]);
    assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  });

  test(`${cli} does not preserve a reset profile when switching to an existing empty tab instead`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-b", {
        conversationTabs: {
          activeTabId: "old-tab",
          tabs: [{ id: "old-tab", cli, sessionId: "old-session" }, { id: "existing-tab", cli, sessionId: null }],
        },
      }),
    });
    document.getElementById("resetSession").dispatchEvent({ type: "click" });
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-a", {
        conversationTabs: { activeTabId: "existing-tab", tabs: [{ id: "existing-tab", cli, sessionId: null }] },
      }),
    });
    assert.equal(document.getElementById("configSelect").value, "config-a");
    assert.equal(api.state.pendingConversationReset, null);
    assert.deepEqual(posted.filter((message) => message.type === "applyConfig" || message.type === "webviewError"), []);
  });

  test(`${cli} isolates model snapshots while switching profiles and after a delayed refresh`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    const dispatchState = (configId: string, overrides: Record<string, unknown> = {}) => {
      window.dispatchMessage({ type: "state", payload: createProfilePanelState(cli, configId, overrides) });
    };
    dispatchState("config-b");
    const configSelect = document.getElementById("configSelect");
    configSelect.value = "config-a";
    configSelect.dispatchEvent({ type: "change" });
    dispatchState("config-b");
    assert.equal(configSelect.value, "config-a");
    assert.deepEqual(api.state.modelsByCli[cli], []);
    assert.deepEqual(api.state.managedModelsByCli[cli], []);

    dispatchState("config-a");
    assert.equal(api.state.pendingConfigApply, null);
    const acceptedModels = {
      models: api.state.modelsByCli,
      managed: api.state.managedModelsByCli,
      selected: api.state.selectedModelsByCli,
      selectedModel: api.state.selectedModel,
      loopModels: api.state.loopModelsByCli,
      loopSelected: api.state.selectedLoopModelsByCli,
      loopThinking: api.state.selectedLoopThinkingByCli,
      thinking: api.state.thinkingMode,
      openCodeModels: api.state.openCodeModels,
      openCodeThinking: api.state.openCodeThinking,
      openCodeSmallThinking: api.state.openCodeSmallThinking,
    };
    assert.deepEqual(acceptedModels.models[cli], ["config-a-model"]);
    dispatchState("config-b", { debug: false });
    assert.equal(configSelect.value, "config-a");
    assert.equal(api.state.debug, false);
    assert.deepEqual({
      models: api.state.modelsByCli,
      managed: api.state.managedModelsByCli,
      selected: api.state.selectedModelsByCli,
      selectedModel: api.state.selectedModel,
      loopModels: api.state.loopModelsByCli,
      loopSelected: api.state.selectedLoopModelsByCli,
      loopThinking: api.state.selectedLoopThinkingByCli,
      thinking: api.state.thinkingMode,
      openCodeModels: api.state.openCodeModels,
      openCodeThinking: api.state.openCodeThinking,
      openCodeSmallThinking: api.state.openCodeSmallThinking,
    }, acceptedModels);
    const modelSelectId = cli === "codex" ? "codexLoopMainModelSelect"
      : cli === "opencode" ? "openCodePrimaryModelSelect" : "modelSelect";
    const modelOptions = childValueTextPairs(document.getElementById(modelSelectId));
    assert.ok(modelOptions.some(([value]) => value.includes("config-a-model")));
    assert.ok(modelOptions.every(([value]) => !value.includes("config-b-model")));

    dispatchState("config-a", { modelState: {}, openCodeModels: {}, thinkingMode: "medium" });
    assert.deepEqual(api.state.modelsByCli[cli], []);
    assert.deepEqual(api.state.loopModelsByCli[cli], { main: [], subtask: [] });
    assert.deepEqual(api.state.openCodeModels.models, []);
    assert.equal(api.state.thinkingMode, "medium");

    dispatchState("config-a");
    assert.deepEqual(api.state.modelsByCli[cli], ["config-a-model"]);
    assert.equal(api.state.thinkingMode, "high");

    dispatchState("config-b", {
      configState: { activeConfigId: "config-b", configs: [{ id: "config-b", name: "config-b", platform: cli }] },
    });
    assert.equal(configSelect.value, "config-b");
    assert.deepEqual(api.state.modelsByCli[cli], ["config-b-model"]);
    assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  });

  test(`${cli} accepts a tab restored profile even when the webview optimistically selected the new tab`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    window.dispatchMessage({ type: "state", payload: createProfilePanelState(cli, "config-a") });
    api.state.conversationTabs.activeTabId = "tab-2";
    api.state.pendingConfigApply = { cli, configId: "config-a" };
    api.state.pendingOpenCodeRoleSelection = { configId: "config-a", role: "main", value: "provider/old" };
    const postedBeforeSwitch = posted.length;
    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-b", {
        conversationTabs: { activeTabId: "tab-2", tabs: [{ id: "tab-1", cli }, { id: "tab-2", cli }] },
      }),
    });
    assert.equal(document.getElementById("configSelect").value, "config-b");
    assert.deepEqual(api.state.modelsByCli[cli], ["config-b-model"]);
    assert.equal(api.state.selectedLoopModelsByCli[cli].main, "config-b-model");
    assert.equal(api.state.thinkingMode, "low");
    assert.equal(api.state.pendingConfigApply, null);
    assert.equal(api.state.pendingOpenCodeRoleSelection, null);
    assert.deepEqual(posted.slice(postedBeforeSwitch).filter((message) => message.type === "applyConfig"), []);
  });

  test(`${cli} restores models after a failed profile switch and clears them when all profiles are removed`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    const activeState = createProfilePanelState(cli, "config-b");
    window.dispatchMessage({ type: "state", payload: activeState });
    const configSelect = document.getElementById("configSelect");
    configSelect.value = "config-a";
    configSelect.dispatchEvent({ type: "change" });
    window.dispatchMessage({ type: "state", payload: activeState });
    assert.deepEqual(api.state.modelsByCli[cli], []);
    window.dispatchMessage({ type: "configApplyError", cli, configId: "config-a", error: "Invalid config" });
    window.dispatchMessage({ type: "state", payload: activeState });
    assert.equal(configSelect.value, "config-b");
    assert.equal(api.state.pendingConfigApply, null);
    assert.deepEqual(api.state.modelsByCli[cli], ["config-b-model"]);

    window.dispatchMessage({
      type: "state",
      payload: createProfilePanelState(cli, "config-b", {
        configState: { activeConfigId: null, configs: [] },
        modelState: {},
        openCodeModels: {},
      }),
    });
    assert.equal(api.state.selectedConfigId, "");
    assert.deepEqual(api.state.modelsByCli[cli], []);
    assert.deepEqual(api.state.openCodeModels.models, []);
    assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  });
}

test("renders multiline Grok thinking in the generated webview runtime without module globals", () => {
  const { api, document, posted, window } = createRuntimeHarness();
  const stored = "First paragraph\n continues here.\n\n# Heading\n- first\n- second";
  const thinkingMessage = { id: "grok-thinking", role: "assistant", kind: "thinking", content: stored };
  api.state.currentCli = "grok";
  api.state.onlyShowFinalResults = false;

  window.dispatchMessage({ type: "setMessages", messages: [thinkingMessage] });

  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  assert.equal(document.getElementById("messages").children.length, 1);
  assert.equal(
    api.getAssistantMessageContentForDisplay(thinkingMessage),
    "First paragraph continues here.\n\n# Heading\n- first\n- second",
  );
  assert.equal(api.state.messages[0].content, stored);
  assert.equal(api.getAssistantMessageContentForDisplay({ ...thinkingMessage, kind: "normal" }), stored);
  assert.equal(api.getAssistantMessageContentForDisplay({ ...thinkingMessage, role: "user" }), stored);

  window.dispatchMessage({
    type: "appendMessage",
    message: { id: "grok-reply", role: "assistant", content: "<FINAL> Completed." },
  });

  assert.equal(document.getElementById("messages").children.length, 2);
  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);

  for (const cli of ["codex", "claude", "opencode"]) {
    api.state.currentCli = cli;
    assert.equal(api.getAssistantMessageContentForDisplay(thinkingMessage), stored);
  }
});

test("boots the runtime and dispatches state, message, stream, history, settings, and queue events", () => {
  const harness = createRuntimeHarness();
  const { api, document, posted, window } = harness;

  assert.deepEqual(posted[0], { type: "requestState" });
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  assert.equal(api.state.currentCli, "codex");
  assert.equal(api.state.loopMaxRounds, 12);
  assert.equal(api.state.macTaskShell, "bash");
  assert.equal(document.getElementById("codexLoopModelGroup").style.display, "");
  assert.equal(document.getElementById("codexLoopMainModelSelect").disabled, false);
  assert.equal(document.getElementById("codexLoopSubtaskModelSelect").disabled, false);
  assert.equal(document.getElementById("modelSelect").style.display, "none");
  assert.deepEqual(childValueTextPairs(document.getElementById("codexLoopMainModelSelect")), [
      ["", "默认"],
    ["gpt-5-main", "gpt-5-main"],
  ]);
  assert.deepEqual(childValueTextPairs(document.getElementById("codexLoopSubtaskModelSelect")), [
    ["", "默认"],
    ["gpt-5-subtask", "gpt-5-subtask"],
  ]);
  assert.equal(document.getElementById("codexLoopMainModelSelect").value, "gpt-5-main");
  assert.equal(document.getElementById("codexLoopSubtaskModelSelect").value, "gpt-5-subtask");
  assert.equal(document.getElementById("configSelect").children.length, 1);
  assert.equal(document.getElementById("sessionList").children.length, 1);
  assert.equal(document.getElementById("promptHistoryList").children.length, 1);
  assert.equal(document.getElementById("promptContextTags").style.display, "flex");
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist:\n\n[in_progress] Map code\n[pending] Add tests\n[completed] Build"),
    [
      { done: false, text: "Map code" },
      { done: false, text: "Add tests" },
      { done: true, text: "Build" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist update:\n- [completed] Locate parser\n- [in_progress] Add coverage\n- [pending] Build"),
    [
      { done: true, text: "Locate parser" },
      { done: false, text: "Add coverage" },
      { done: false, text: "Build" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist: [completed] Locate parser；[in_progress] Add coverage；[pending] Build。"),
    [
      { done: true, text: "Locate parser" },
      { done: false, text: "Add coverage" },
      { done: false, text: "Build" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist 更新：\n- [已完成] 定位日志格式\n- [进行中] 补解析\n- [待办] 跑验证"),
    [
      { done: true, text: "定位日志格式" },
      { done: false, text: "补解析" },
      { done: false, text: "跑验证" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist：定位接口实现、核对前端调用、确认分页方向与触发场景。"),
    [
      { done: false, text: "定位接口实现" },
      { done: false, text: "核对前端调用" },
      { done: false, text: "确认分页方向与触发场景" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist：定位接口实现、核对前端调用、确认分页方向与触发场景。CodeGraph 索引已存在。"),
    [
      { done: false, text: "定位接口实现" },
      { done: false, text: "核对前端调用" },
      { done: false, text: "确认分页方向与触发场景" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist：1) 确认现有消息渲染和滚动容器 2) 改后端支持倒序分页并返回 hasMore 3) 改前端首屏分页与顶部加载 4) 补最小测试并跑构建/相关测试。"),
    [
      { done: false, text: "确认现有消息渲染和滚动容器" },
      { done: false, text: "改后端支持倒序分页并返回 hasMore" },
      { done: false, text: "改前端首屏分页与顶部加载" },
      { done: false, text: "补最小测试并跑构建/相关测试" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist:\n- 读取上下文与现状\n- 接入 writer pump fanout\n- 运行指定验证"),
    [
      { done: false, text: "读取上下文与现状" },
      { done: false, text: "接入 writer pump fanout" },
      { done: false, text: "运行指定验证" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist: `[completed]` inspect current git state; `[in_progress]` run targeted tests; `[pending]` build."),
    [
      { done: true, text: "inspect current git state" },
      { done: false, text: "run targeted tests" },
      { done: false, text: "build" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("任务列表：1) 读取约束与现状已完成；2) 补 resume 写入/积压边界进行中；3) 更新测试与验证待执行；4) 写沟通与任务记录待执行。"),
    [
      { done: true, text: "读取约束与现状" },
      { done: false, text: "补 resume 写入/积压边界" },
      { done: false, text: "更新测试与验证" },
      { done: false, text: "写沟通与任务记录" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist 更新：定位完成，开始修改。目标是让导航管理右侧只渲染表格区域。"),
    [
      { done: true, text: "定位" },
      { done: false, text: "修改" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("任务列表状态：前端调用点已定位；后端实现还没被 CodeGraph 直接列出。接下来用精确文本检索补齐路由位置。"),
    [
      { done: true, text: "前端调用点" },
      { done: false, text: "后端实现还没被 CodeGraph 直接列出" },
    ]
  );
  assert.deepEqual(
    api.parseTaskListFromText("Tasklist: 1) 已确认仓库与 CodeGraph 存在；2) 正在读取规范、方案和目标 utils；3) 随后补边界与测试；4) 最后跑最小验证并写回子任务记录。"),
    [
      { done: true, text: "仓库与 CodeGraph 存在" },
      { done: false, text: "读取规范、方案和目标 utils" },
      { done: false, text: "补边界与测试" },
      { done: false, text: "跑最小验证并写回子任务记录" },
    ]
  );
  assert.equal(
    api.shouldHideParsedTaskListMessage({
      role: "assistant",
      content: "Tasklist:\n\n[in_progress] Map code\n[pending] Add tests",
    }),
    true
  );
  assert.equal(
    api.shouldHideParsedTaskListMessage({
      role: "assistant",
      content: "Tasklist update:\n- [completed] Locate parser\n- [pending] Build",
    }),
    true
  );
  assert.equal(
    api.shouldHideParsedTaskListMessage({
      role: "assistant",
      content: "Tasklist:\n[pending] Add tests\n\nFinal response",
    }),
    false
  );
  assert.equal(
    api.shouldHideParsedTaskListMessage({
      role: "assistant",
      content: "验证通过。Tasklist: [completed] Locate parser；[pending] Build。",
    }),
    false
  );
  assert.equal(
    api.stripParsedTaskListContentFromText("验证通过。Tasklist: [completed] Locate parser；[pending] Build。"),
    "验证通过。"
  );
  assert.equal(
    api.getAssistantMessageContentForDisplay({
      role: "assistant",
      content: "验证通过。Tasklist: [completed] Locate parser；[pending] Build。",
    }),
    "验证通过。"
  );

  window.dispatchMessage({
    type: "setMessages",
    tabId: "tab-1",
    messages: [
      { id: "m-2", role: "assistant", sequence: 2, content: "Tasklist update:\n- [in_progress] map code\n- [pending] add tests" },
      { id: "m-1", role: "user", sequence: 1, content: "hello", createdAt: 1_700_000_000_000, contextTags: ["src/index.ts"] },
      { id: "m-3", role: "system", sequence: 3, content: "Task completed" },
    ],
  });
  assert.equal(api.state.messages[0].id, "m-1");
  assert.equal(document.getElementById("messages").children.length, 1);
  assert.equal(document.getElementById("taskListPanel").style.display, "none");
  assert.equal(document.getElementById("taskListCount").textContent, "");

  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "trace-1", role: "trace", kind: "tool-use", content: "tool: read\nsrc/file.ts" },
  });
  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "assistant-1",
    content: "partial answer",
    kind: "normal",
  });
  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "assistant-1",
    content: "",
    codexFinalAnswer: true,
  });
  assert.ok(api.state.messages.some((message: any) => message.role === "assistant" && message.codexFinalAnswer === true));

  window.dispatchMessage({ type: "rawStreamDelta", tabId: "tab-1", stream: "stderr", content: "{\"event\":true}" });
  assert.equal(api.getActiveConversationRuntimeState().runStreamRecords.length, 1);
  document.getElementById("runStreamButton").click();
  assert.equal(document.getElementById("runStreamOverlay").classList.contains("visible"), true);
  document.getElementById("exportRunStream").click();
  assert.equal(posted.at(-1).type, "exportRunStream");
  window.dispatchMessage({ type: "runStreamExportResult", tabId: "tab-1", path: "/tmp/run-stream.json" });
  assert.match(document.getElementById("toast").textContent, /tmp\/run-stream\.json/);

  const staleTaskList = api.getActiveConversationRuntimeState().taskList;
  const taskListTab = api.state.conversationTabs.tabs[0];
  taskListTab.loopTaskRole = "subtask";
  staleTaskList.items = [{ text: "stale task", done: false }];
  staleTaskList.open = true;
  staleTaskList.source = "external";
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000, prompt: "run task" });
  assert.equal(document.getElementById("taskListPanel").style.display, "none");
  assert.deepEqual(api.getActiveConversationRuntimeState().taskList.items, []);
  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "tasklist-text",
    content: "Tasklist: [completed] inspect logs；[in_progress] patch parser；[pending] run tests",
    kind: "normal",
  });
  assert.equal(document.getElementById("taskListPanel").style.display, "none");
  runLatestTimer(window);
  assert.equal(document.getElementById("taskListPanel").style.display, "block");
  assert.equal(document.getElementById("taskListCount").textContent, "1/3");
  window.dispatchMessage({ type: "taskListUpdate", tabId: "tab-1", items: [{ text: "external task", completed: false }] });
  assert.equal(document.getElementById("taskListCount").textContent, "0/1");
  assert.equal(document.getElementById("taskListPanel").style.display, "block");
  window.dispatchMessage({ type: "taskListUpdate", tabId: "tab-1", items: [{ text: "external task", completed: true }] });
  assert.equal(document.getElementById("taskListPanel").style.display, "block");
  assert.equal(document.getElementById("taskListCount").textContent, "1/1");
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end", message: "Task completed" });
  assert.equal(document.getElementById("taskListPanel").style.display, "none");
  window.dispatchMessage({ type: "taskListUpdate", tabId: "tab-1", items: [{ text: "late task", completed: false }] });
  assert.equal(document.getElementById("taskListPanel").style.display, "none");
  window.dispatchMessage({ type: "taskListUpdate", tabId: "tab-1", items: [] });
  assert.equal(document.getElementById("taskListPanel").style.display, "none");
  taskListTab.loopTaskRole = "main";

  api.openHistorySessionMessages({ id: "session-1", cli: "codex", firstPrompt: "inspect", createdAt: 1_700_000_000_000 });
  assert.equal(posted.at(-1).type, "loadHistorySessionMessages");
  window.dispatchMessage({
    type: "historySessionMessages",
    cli: "codex",
    sessionId: "session-1",
    resolvedSessionId: "resolved-1",
    messages: [
      { role: "assistant", content: "answer", sequence: 2 },
      { role: "user", content: "question", sequence: 1 },
      { role: "system", content: "  " },
    ],
  });
  assert.equal(api.state.historySessionMessages.messages.length, 2);
  document.getElementById("exportHistoryMessages").click();
  assert.equal(posted.at(-1).type, "exportHistorySessionMessages");
  window.dispatchMessage({ type: "historySessionExportResult", cli: "codex", sessionId: "session-1", fileName: "history.md" });
  assert.match(document.getElementById("toast").textContent, /history\.md/);

  document.getElementById("toolSettingsButton").click();
  assert.equal(document.getElementById("toolSettingsOverlay").classList.contains("visible"), true);
  assert.equal(document.getElementById("toolSettingsGeneralPanel").classList.contains("active"), true);
  document.getElementById("toolSettingsAiTaskTab").click();
  assert.equal(document.getElementById("toolSettingsAiTaskPanel").classList.contains("active"), true);
  document.getElementById("toolSettingsWorkspaceTab").click();
  assert.equal(document.getElementById("toolSettingsWorkspacePanel").classList.contains("active"), true);
  document.getElementById("toolSettingsRepairTab").click();
  assert.equal(document.getElementById("toolSettingsRepairPanel").classList.contains("active"), true);
  assert.equal(posted.at(-1).type, "inspectCliRepairs");
  window.dispatchMessage({
    type: "cliRepairIssues",
    issues: [{ cli: "codex", command: "codex", summary: "spawn codex ENOENT" }],
  });
  const repairBody = document.getElementById("toolSettingsRepairBody");
  assert.equal(repairBody.children.length, 1);
  assert.equal(repairBody.children[0].children[0].children[0].textContent, "spawn codex ENOENT");
  assert.equal(document.getElementById("toolSettingsRepairEmpty").hidden, true);
  repairBody.children[0].children[1].children[0].click();
  assert.deepEqual(posted.at(-1), { type: "repairCliCommand", cli: "codex" });
  window.dispatchMessage({
    type: "cliRepairResult",
    cli: "codex",
    status: "repaired",
    message: "Updated codex command",
  });
  assert.match(document.getElementById("toast").textContent, /Updated codex/);
  assert.equal(posted.at(-1).type, "inspectCliRepairs");
  document.getElementById("toolSettingsGeneralTab").click();
  assert.equal(document.getElementById("toolSettingsGeneralPanel").classList.contains("active"), true);
  document.getElementById("historyRetentionDays").value = "0";
  document.getElementById("historyRetentionDays").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "historyRetentionDays", value: 1 });
  const codeGraphToggle = document.getElementById("codeGraphEnabled");
  codeGraphToggle.checked = true;
  codeGraphToggle.dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "installCodeGraph" });
  document.getElementById("loopMaxRounds").value = "0";
  document.getElementById("loopMaxRounds").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "loopMaxRounds", value: 1 });
  document.getElementById("loopPlusDecisionSubtaskMax").value = "0";
  document.getElementById("loopPlusDecisionSubtaskMax").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "loopPlusDecisionSubtaskMax", value: 1 });
  document.getElementById("loopPlusDecisionSubtaskMax").value = "99";
  document.getElementById("loopPlusDecisionSubtaskMax").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "loopPlusDecisionSubtaskMax", value: 20 });
  document.getElementById("promptInput").value = " queued work ";
  api.queuePromptForLater({ prompt: "queued work", contextOptions: { includeCurrentFile: false } });
  document.getElementById("queueIndicator").click();
  assert.equal(document.getElementById("queueOverlay").classList.contains("visible"), true);
  assert.equal(document.getElementById("queueCount").textContent, "1");
  api.state.conversationTabs.tabs[0].loopTaskStatus = "completed";
  api.state.conversationTabs.tabs[0].loopTaskRunning = false;
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end", message: "Task completed" });
  assert.equal(posted.at(-1).type, "sendPrompt");
  assert.equal(posted.at(-1).model, "gpt-5-main");
  assert.equal(posted.at(-1).loopMainModel, "gpt-5-main");
  assert.equal(posted.at(-1).loopSubtaskModel, "gpt-5-subtask");
  assert.equal(posted.at(-1).interactiveMode, "loop");

  window.dispatchMessage({ type: "uploadResult", paths: ["/tmp/a.png"] });
  assert.match(document.getElementById("promptInput").value, /@\/tmp\/a\.png/);
  window.dispatchMessage({ type: "pickWorkspacePathResult", canceled: true });
  assert.match(document.getElementById("promptInput").value, /@/);
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      configState: {
        activeConfigId: "cfg-1",
        configs: [
          { id: "cfg-1", name: "Default" },
          { id: "bad-cfg", name: "Bad" },
        ],
      },
    }),
  });
  const configSelect = document.getElementById("configSelect");
  configSelect.value = "bad-cfg";
  configSelect.dispatchEvent({ type: "change" });
  assert.deepEqual(api.state.pendingConfigApply, { cli: "codex", configId: "bad-cfg" });
  assert.deepEqual(posted.at(-1), { type: "applyConfig", cli: "codex", configId: "bad-cfg" });
  const postedBeforeBlockedSend = posted.length;
  document.getElementById("promptInput").value = "send after config";
  document.getElementById("sendPrompt").click();
  assert.equal(posted.length, postedBeforeBlockedSend);
  assert.equal(document.getElementById("promptInput").value, "send after config");
  window.dispatchMessage({ type: "configApplyError", error: "bad config", cli: "codex", configId: "bad-cfg" });
  assert.equal(api.state.pendingConfigApply, null);
  assert.equal(configSelect.value, "cfg-1");
  assert.equal(document.getElementById("configApplyErrorOverlay").classList.contains("visible"), true);
  assert.equal(document.getElementById("configApplyErrorContent").textContent, "bad config");
  document.getElementById("copyConfigApplyError").click();
  assert.equal(posted.at(-1).type, "clipboard");

  api.state.pendingConfigApply = { cli: "opencode", configId: "opencode-cfg" };
  window.dispatchMessage({ type: "configApplyApplied", cli: "opencode", configId: "opencode-cfg" });
  assert.equal(api.state.pendingConfigApply, null);

  api.state.pendingConfigApply = { cli: "opencode", configId: "opencode-cfg-2" };
  window.dispatchMessage({ type: "configApplyError", error: "opencode config bad", cli: "opencode", configId: "opencode-cfg-2" });
  assert.equal(api.state.pendingConfigApply, null);

  const errors = posted.filter((message) => message && message.type === "webviewError");
  assert.deepEqual(errors, []);
});

test("normalizes the human interaction timeout from the AI task settings input", () => {
  const { document, posted } = createRuntimeHarness();
  document.getElementById("humanInteractionTimeoutMinutes").value = "0";
  document.getElementById("humanInteractionTimeoutMinutes").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: 1 });
  document.getElementById("humanInteractionTimeoutMinutes").value = "999";
  document.getElementById("humanInteractionTimeoutMinutes").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: 999 });
  document.getElementById("humanInteractionTimeoutMinutes").value = "9999";
  document.getElementById("humanInteractionTimeoutMinutes").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: 1440 });
});

test("opens human interaction history from the bottom icon and renders automatic selection details", () => {
  const { api, document, window, posted } = createRuntimeHarness();
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      humanInteractionHistory: [{
        id: "history-1",
        interactionId: "question-1",
        source: "orchestrator",
        title: "确认实现方案",
        instruction: "请选择后续执行方案。",
        formFields: [{ id: "mode", label: "请选择后续执行方案并确认是否继续", type: "radio", options: [{ label: "兼容方案", value: "safe" }, { label: "重写方案", value: "rewrite" }] }],
        status: "completed",
        timedOut: true,
        values: { mode: "safe" },
        createdAt: 1_700_000_000_000,
      }],
    }),
  });

  document.getElementById("humanInteractionHistoryButton").click();
  assert.deepEqual(posted.at(-1), { type: "requestHumanInteractionHistory" });
  api.state.humanInteractionHistory = api.state.humanInteractionHistory;
  window.dispatchMessage({ type: "humanInteractionHistory", items: api.state.humanInteractionHistory });
  assert.equal(document.getElementById("humanInteractionHistoryOverlay").classList.contains("visible"), true);
  const list = document.getElementById("humanInteractionHistoryList");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children.length, 3);
  assert.equal(list.children[0].children[0].className, "human-interaction-history-icon automatic");
  assert.equal(list.children[0].children[1].textContent, "请选择后续执行方案并确认是否继续".slice(0, 20));
  assert.equal(list.children[0].children[1].className, "human-interaction-history-question");
  assert.equal(list.children[0].children[2].className, "human-interaction-history-meta");
  const longQuestion = "这是一次用于验证人机交互历史列表双行摘要的长问题，摘要应该保留前五十个字而不是二十个字，并且在弹窗中以更清晰的文字颜色显示";
  const originalRecord = structuredClone(api.state.humanInteractionHistory[0]);
  const longRecord = { ...originalRecord, id: "history-long", formFields: [{ id: "long", label: longQuestion, type: "text" }] };
  window.dispatchMessage({ type: "humanInteractionHistory", items: [longRecord] });
  assert.equal(list.children[0].children[1].textContent, Array.from(longQuestion).slice(0, 50).join(""));
  assert.equal(Array.from(list.children[0].children[1].textContent).length, 50);
  assert.match(OVERLAYS_MODALS_STYLES, /\.human-interaction-history-item\s*\{[^}]*min-height:\s*64px;[^}]*padding:\s*12px;/);
  assert.match(OVERLAYS_MODALS_STYLES, /\.human-interaction-history-question\s*\{[^}]*display:\s*-webkit-box;[^}]*line-height:\s*18px;[^}]*-webkit-line-clamp:\s*2;/);
  assert.match(OVERLAYS_MODALS_STYLES, /\.human-interaction-history-question,\s*\.human-interaction-history-meta\s*\{[^}]*color:\s*var\(--vscode-foreground\);/);

  window.dispatchMessage({ type: "humanInteractionHistory", items: [originalRecord] });
  list.children[0].click();
  assert.equal(document.getElementById("humanInteractionHistoryDetailOverlay").classList.contains("visible"), true);
  assert.equal(document.getElementById("humanInteractionHistoryDetailTitle").textContent, "确认实现方案");
  assert.match(document.getElementById("humanInteractionHistoryDetailMeta").textContent, /AI 自动选择/u);
  const detail = document.getElementById("humanInteractionHistoryDetailContent");
  assert.equal(detail.children[0].textContent, "请选择后续执行方案。");
  assert.equal(detail.children[1].children[0].textContent, "问题：请选择后续执行方案并确认是否继续");
  assert.equal(detail.children[1].children[1].textContent, "选择结果：兼容方案");
  const options = detail.children[1].children[2];
  assert.equal(options.children[0].className, "human-interaction-history-detail-option selected");
  assert.equal(options.children[0].children[0].textContent, "✓");
  assert.equal(options.children[1].className, "human-interaction-history-detail-option");
  assert.equal(options.children[1].children[0].textContent, "");

  const record = api.state.humanInteractionHistory[0];
  assert.equal(api.humanInteractionHistoryAnswer({ ...record, timedOut: false, values: { mode: "safe" } }, record.formFields[0]), "兼容方案");
  assert.equal(api.humanInteractionHistoryAnswer(record, { id: "token", label: "令牌", type: "password" }), "已隐藏");
  assert.equal(api.humanInteractionHistoryAnswer({ ...record, values: { mode: "已隐藏" } }, record.formFields[0]), "AI 自动选择");
});

test("distinguishes manual and automatic interaction history with accessible SVG icons", () => {
  const { document, window } = createRuntimeHarness();
  const record = {
    interactionId: "question-icons",
    source: "vibe",
    title: "确认方案",
    instruction: "请选择方案。",
    formFields: [{ id: "mode", label: "请选择方案", type: "radio" }],
    status: "completed",
    values: { mode: "safe" },
    createdAt: 1_700_000_000_000,
  };
  document.getElementById("humanInteractionHistoryButton").click();
  window.dispatchMessage({
    type: "humanInteractionHistory",
    items: [
      { ...record, id: "manual", timedOut: false },
      { ...record, id: "automatic", timedOut: true },
      { ...record, id: "rejected", status: "aborted", timedOut: false },
      { ...record, id: "legacy" },
    ],
  });

  const list = document.getElementById("humanInteractionHistoryList");
  assert.equal(list.children.length, 4);
  const statuses = ["用户选择", "AI 自动选择", "已拒绝", "用户选择"];
  list.children.forEach((button: FakeElement, index: number) => {
    const icon = button.children[0];
    assert.equal(icon.className, "human-interaction-history-icon" + (index === 1 ? " automatic" : ""));
    assert.equal(icon.title, statuses[index]);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.match(icon.innerHTML, /^<svg\b/u);
    assert.match(icon.innerHTML, /stroke="currentColor"/u);
    assert.match(icon.innerHTML, /focusable="false"/u);
    assert.equal(button.getAttribute("aria-label"), statuses[index] + " · 请选择方案 · " + WEBVIEW_STRINGS.humanInteractionHistoryDetail);
  });
  const manualIcon = list.children[0].children[0].innerHTML;
  const automaticIcon = list.children[1].children[0].innerHTML;
  assert.match(manualIcon, /<circle\b/u);
  assert.match(automaticIcon, /<rect\b/u);
  assert.notEqual(manualIcon, automaticIcon);
  assert.equal(list.children[2].children[0].innerHTML, manualIcon);
  assert.equal(list.children[3].children[0].innerHTML, manualIcon);
  assert.match(OVERLAYS_MODALS_STYLES, /\.human-interaction-history-item\s*\{[^}]*grid-template-columns:\s*20px minmax\(0, 1fr\) auto;/u);
  assert.match(OVERLAYS_MODALS_STYLES, /\.human-interaction-history-icon\.automatic\s*\{[^}]*color:\s*var\(--vscode-charts-blue, var\(--vscode-foreground\)\);/u);
});

test("normalizes the Loop+ acceptance limit from the AI task settings input", () => {
  const { document, posted } = createRuntimeHarness();
  document.getElementById("loopPlusMaxAcceptances").value = "0";
  document.getElementById("loopPlusMaxAcceptances").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "loopPlusMaxAcceptances", value: 1 });
  document.getElementById("loopPlusMaxAcceptances").value = "5000";
  document.getElementById("loopPlusMaxAcceptances").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "loopPlusMaxAcceptances", value: 999 });
});

test("renders prompt history favorites and filters to favorite prompts", () => {
  const harness = createRuntimeHarness();
  const { api, document, posted, window } = harness;

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      promptHistory: [
        { id: "fav", prompt: "favorite prompt", cli: "codex", createdAt: 1_700_000_000_002, favorite: true },
        { id: "plain", prompt: "plain prompt", cli: "codex", createdAt: 1_700_000_000_001, favorite: false },
      ],
    }),
  });

  const list = document.getElementById("promptHistoryList");
  assert.equal(list.children.length, 2);
  assert.equal(document.getElementById("promptHistorySummary").textContent, "已收藏 1/2");

  const favoritesOnly = document.getElementById("promptHistoryFavoritesOnly");
  favoritesOnly.checked = true;
  favoritesOnly.dispatchEvent({ type: "change", target: favoritesOnly });
  assert.equal(api.state.promptHistoryFavoritesOnly, true);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].querySelector(".prompt-preview")?.textContent, "favorite prompt");
  assert.deepEqual(posted.at(-1), {
    type: "setState",
    state: { onlyShowFinalResults: true, promptHistoryFavoritesOnly: true },
  });

  const favoriteButton = list.children[0].querySelector("button.prompt-favorite-button");
  assert.ok(favoriteButton);
  favoriteButton.click();
  assert.deepEqual(posted.at(-1), {
    type: "togglePromptHistoryFavorite",
    id: "fav",
    favorite: false,
  });
  assert.equal(api.state.promptHistory[0].favorite, false);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].textContent, "暂无收藏提示词");
});

test("expands and collapses prompt history only from the view button", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      promptHistory: [
        { id: "prompt-1", prompt: "line one\nline two", cli: "codex", createdAt: 1_700_000_000_001 },
      ],
    }),
  });

  const list = document.getElementById("promptHistoryList");
  const findButton = (label: string): FakeElement | undefined => list.children[0]
    .querySelectorAll("button")
    .find((button: FakeElement) => button.textContent === label);

  const collapsedPreview = list.children[0].querySelector(".prompt-preview");
  const collapsedHeader = list.children[0].querySelector(".prompt-header");
  assert.ok(collapsedPreview);
  assert.ok(collapsedHeader);
  collapsedPreview.click();
  collapsedHeader.click();
  list.children[0].click();
  assert.equal(list.children[0].classList.contains("expanded"), false);
  assert.equal(api.state.promptHistoryExpandedId, null);

  const viewButton = findButton("查看");
  assert.ok(viewButton);
  viewButton.click();
  assert.equal(list.children[0].classList.contains("expanded"), true);
  assert.equal(api.state.promptHistoryExpandedId, "prompt-1");

  const expandedPreview = list.children[0].querySelector(".prompt-preview");
  const expandedFull = list.children[0].querySelector(".prompt-full");
  assert.ok(expandedPreview);
  assert.ok(expandedFull);
  assert.equal(expandedFull.textContent, "line one\nline two");
  expandedPreview.click();
  expandedFull.click();
  list.children[0].click();
  assert.equal(list.children[0].classList.contains("expanded"), true);
  assert.equal(api.state.promptHistoryExpandedId, "prompt-1");

  const collapseButton = findButton("收起");
  assert.ok(collapseButton);
  collapseButton.click();
  assert.equal(list.children[0].classList.contains("expanded"), false);
  assert.equal(api.state.promptHistoryExpandedId, null);
});

test("filters prompt and session history by the shared keyword search", () => {
  const harness = createRuntimeHarness();
  const { api, document, window } = harness;

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      sessionState: {
        currentSessionId: "session-1",
        sessions: [
          { id: "session-1", cli: "codex", firstPrompt: "Deploy release notes", label: "Release", createdAt: 1 },
          { id: "session-2", cli: "claude", firstPrompt: "Fix parser", label: "Parser", createdAt: 2 },
        ],
      },
      promptHistory: [
        { id: "prompt-1", prompt: "Deploy release notes", cli: "codex", createdAt: 1 },
        { id: "prompt-2", prompt: "Fix parser", cli: "claude", createdAt: 2 },
      ],
    }),
  });

  const searchInput = document.getElementById("historySearchInput");
  searchInput.value = "RELEASE";
  searchInput.dispatchEvent({ type: "input", target: searchInput });

  assert.equal(api.state.historySearchQuery, "RELEASE");
  assert.equal(document.getElementById("sessionList").children.length, 1);
  assert.equal(document.getElementById("sessionList").children[0].querySelector(".session-label")?.textContent, "[Codex] Deploy release notes");

  document.getElementById("historyTabPrompts").click();
  const promptList = document.getElementById("promptHistoryList");
  assert.equal(promptList.children.length, 1);
  assert.equal(promptList.children[0].querySelector(".prompt-preview")?.textContent, "Deploy release notes");

  searchInput.value = "missing";
  searchInput.dispatchEvent({ type: "input", target: searchInput });
  assert.equal(promptList.children.length, 1);
  assert.equal(promptList.children[0].textContent, "没有匹配的历史提示词。");
});

test("keeps run stream records beyond the former 2000 count cap", () => {
  const { api, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });

  for (let index = 0; index < 2001; index += 1) {
    api.appendRunRawStream(`record-${index}`, "stdout", "tab-2");
  }

  const runtimeState = api.getConversationRuntimeState("tab-2");
  assert.equal(runtimeState.runStreamRecords.length, 2001);
  assert.equal(runtimeState.runStreamRecords[0].content, "record-0");
  assert.equal(runtimeState.runStreamRecords.at(-1).content, "record-2000");
  assert.equal(runtimeState.runStreamDiscardedRecordCount, 0);
  assert.equal(api.buildRunStreamExportPayload(runtimeState)[0].id, "stream-record-1");
});

test("keeps run stream records beyond the former total byte budget", () => {
  const { api, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  const chunk = "y".repeat(250 * 1024);

  for (let index = 0; index < 40; index += 1) {
    api.appendRunRawStream(`${index}:${chunk}`, "stdout", "tab-2");
  }

  const runtimeState = api.getConversationRuntimeState("tab-2");
  assert.equal(runtimeState.runStreamRecords.length, 40);
  assert.equal(runtimeState.runStreamDiscardedRecordCount, 0);
  assert.equal(runtimeState.runStreamTruncatedRecordCount, 0);
  assert.ok(runtimeState.runStreamRetainedBytes > 8 * 1024 * 1024);
  assert.equal(runtimeState.runStreamRecords[0].content.startsWith("0:"), true);
  assert.equal(runtimeState.runStreamRecords.at(-1).content.startsWith("39:"), true);
  assert.equal(api.buildRunStreamExportPayload(runtimeState)[0].id, "stream-record-1");
});

test("defers run stream DOM rendering while overlay is closed", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });

  api.appendRunRawStream("record while closed", "stdout", "tab-1");

  const runStreamContent = document.getElementById("runStreamContent");
  assert.equal(runStreamContent.children.length, 0);
  api.openRunStreamOverlay();
  assert.equal(runStreamContent.querySelectorAll("details.run-stream-item").length, 1);
});

test("truncates oversized run stream records within the per-record byte budget", () => {
  const { api, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });

  api.appendRunRawStream("x".repeat(300 * 1024), "stdout", "tab-1");

  const runtimeState = api.getConversationRuntimeState("tab-1");
  assert.equal(runtimeState.runStreamRecords.length, 1);
  assert.equal(runtimeState.runStreamTruncatedRecordCount, 1);
  assert.match(runtimeState.runStreamRecords[0].content, /该回放记录已丢弃前部/);
  assert.ok(new TextEncoder().encode(runtimeState.runStreamRecords[0].content).length <= 256 * 1024);
  assert.equal(JSON.parse(api.buildRunStreamExportPayload(runtimeState)[0].content).truncatedRecordCount, 1);
});

test("filtered activity refreshes only its tab without adding replay records and resets with the conversation", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.conversationTabs.activeTabId = "tab-2";
  api.state.isRunning = true;
  api.appendRunRawStream("started", "event", "tab-2");
  const active = api.getConversationRuntimeState("tab-2");
  active.runStreamRecords[0].createdAt = Date.now() - 4 * 60 * 1000;
  api.updateRunStreamButton();
  const badge = document.getElementById("runStreamStaleBadge");
  assert.equal(badge.style.display, "inline-flex");
  window.dispatchMessage({ type: "runActivity", tabId: "tab-1" });
  assert.equal(badge.style.display, "inline-flex");
  window.dispatchMessage({ type: "runActivity", tabId: "tab-2" });
  assert.equal(badge.style.display, "none");
  assert.equal(active.runStreamRecords.length, 1);
  assert.ok(active.runStreamActivityAt > 0);
  api.resetConversationRuntimeState("tab-2");
  assert.equal(active.runStreamActivityAt, 0);
});

test("hides stale run stream labels for Loop main tabs but keeps them for other runs", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.isRunning = true;

  api.appendRunRawStream("Loop main output", "stdout", "tab-1");
  const loopMainRuntime = api.getConversationRuntimeState("tab-1");
  loopMainRuntime.runStreamRecords[0].createdAt = Date.now() - 4 * 60 * 1000;
  api.updateRunStreamButton();

  const staleBadge = document.getElementById("runStreamStaleBadge");
  assert.equal(staleBadge.style.display, "none");
  Array.from(window.timers.values()).forEach((listener) => (listener as Listener)());
  assert.equal(staleBadge.style.display, "none");

  api.state.conversationTabs.activeTabId = "tab-2";
  api.appendRunRawStream("regular output", "stdout", "tab-2");
  const regularRuntime = api.getConversationRuntimeState("tab-2");
  regularRuntime.runStreamRecords[0].createdAt = Date.now() - 60 * 1000;
  api.updateRunStreamButton();
  assert.equal(staleBadge.style.display, "inline-flex");
  assert.equal(staleBadge.textContent, "慢");

  api.state.conversationTabs.tabs.push({
    id: "tab-3",
    cli: "codex",
    loopTaskRole: "subtask",
    loopTaskId: "task-1",
    loopTaskStatus: "running",
  });
  api.state.conversationTabs.activeTabId = "tab-3";
  api.appendRunRawStream("Loop subtask output", "stdout", "tab-3");
  const loopSubtaskRuntime = api.getConversationRuntimeState("tab-3");
  loopSubtaskRuntime.runStreamRecords[0].createdAt = Date.now() - 4 * 60 * 1000;
  api.updateRunStreamButton();
  assert.equal(staleBadge.style.display, "inline-flex");
  assert.equal(staleBadge.textContent, "极慢");
});

for (const cli of ["codex", "grok"]) {
test(`shows ${cli} used context tokens to the right of the stream button while running`, () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState({
    currentCli: cli,
    conversationTabs: { activeTabId: "tab-1", tabs: [{ id: "tab-1", cli }, { id: "tab-2", cli }] },
  }) });
  const label = document.getElementById("runContextTokens");

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000, prompt: "run task" });
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "—");
  assert.equal(label.getAttribute("aria-label"), "正在等待已用上下文");

  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-1",
    tokensInContextWindow: 12345,
    modelContextWindow: 272000,
  });
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "12k");
  assert.equal(label.getAttribute("aria-label"), "已用上下文 12k");
  assert.match(String(label.getAttribute("title") || label.title), /12345 \/ 272000/);

  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-2",
    tokensInContextWindow: 500,
    modelContextWindow: 128000,
  });
  assert.equal(label.textContent, "12k");

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end", message: "Task completed" });
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "12k");
  api.state.conversationTabs.activeTabId = "tab-2";
  api.updateContextTokenUsage();
  assert.equal(label.textContent, "0.5k");
  api.state.conversationTabs.activeTabId = "tab-1";
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 3_000 });
  assert.equal(label.textContent, "—");
  window.dispatchMessage({ type: "contextTokenUsage", tabId: "tab-1", tokensInContextWindow: 0, modelContextWindow: null });
  assert.equal(label.textContent, "0k");
});
}

test("SVG common-command buttons support Enter and Space without an HTMLElement click method", () => {
  const button = new FakeElement("svg", "commonCommandButton");
  Object.defineProperty(button, "click", { value: undefined });
  let clicks = 0;
  button.addEventListener("click", () => { clicks += 1; });
  const end = VIEW_CONTENT_SCRIPT_EVENT_BINDINGS.indexOf('      elements.currentCli.addEventListener');
  assert.ok(end > 0);
  const bind = new Function("elements", "MouseEvent", VIEW_CONTENT_SCRIPT_EVENT_BINDINGS.slice(0, end));
  bind({ commonCommandButton: button }, class {
    public constructor(public readonly type: string) {}
  });
  button.dispatchEvent({ type: "keydown", key: "Enter" });
  button.dispatchEvent({ type: "keydown", key: " " });
  assert.equal(clicks, 2);
  button.setAttribute("aria-disabled", "true");
  button.dispatchEvent({ type: "keydown", key: "Enter" });
  button.dispatchEvent({ type: "keydown", key: " " });
  button.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(clicks, 2);
});

for (const cli of ["grok", "zcode"]) {
test(`${cli} exposes the same common-command compaction interaction and running state as Codex`, () => {
  const { document, window, posted } = createRuntimeHarness(undefined, undefined, ["codex", "grok", "zcode"]);
  window.dispatchMessage({ type: "state", payload: createPanelState({
    currentCli: cli,
    interactive: { supported: true, enabled: true },
    interactiveMode: "coding",
    conversationTabs: { activeTabId: "tab-compact", tabs: [{ id: "tab-compact", cli }] },
  }) });
  const button = document.getElementById("commonCommandButton");
  const compact = document.getElementById("commandCompact");
  const overlay = document.getElementById("commonCommandsOverlay");
  assert.equal(button.style.display, "inline-flex");
  assert.equal(button.getAttribute("aria-disabled"), "false");
  assert.equal(compact.disabled, false);
  button.click();
  assert.equal(overlay.classList.contains("visible"), true);
  compact.click();
  assert.equal(overlay.classList.contains("visible"), false);
  assert.deepEqual(posted.filter((message) => message.type === "runCommonCommand"), [{ type: "runCommonCommand", command: "compactContext" }]);
  window.dispatchMessage({ type: "runStatus", tabId: "tab-compact", status: "start", activity: "contextCompaction", startedAt: 3000 });
  assert.equal(document.getElementById("runStatusText").textContent, "压缩中");
  assert.equal(document.getElementById("runStatusText").classList.contains("compacting"), true);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(compact.disabled, true);
  button.click();
  assert.equal(overlay.classList.contains("visible"), false);
  assert.equal(document.getElementById("stopRun").disabled, false);
  document.getElementById("stopRun").click();
  assert.equal(posted.at(-1)?.type, "stopRun");
  for (const status of ["end", "error", "stopped"]) {
    window.dispatchMessage({ type: "runStatus", tabId: "tab-compact", status });
    assert.equal(button.getAttribute("aria-disabled"), "false");
    assert.equal(compact.disabled, false);
    assert.equal(document.getElementById("runStatusText").classList.contains("compacting"), false);
  }
});

test(`common commands remain hidden when ${cli} interactive support is unavailable`, () => {
  const { document, window } = createRuntimeHarness(undefined, undefined, ["codex", "grok", "zcode"]);
  window.dispatchMessage({ type: "state", payload: createPanelState({
    currentCli: cli, interactive: { supported: false, enabled: false },
  }) });
  assert.equal(document.getElementById("commonCommandButton").style.display, "none");
  assert.equal(document.getElementById("commandCompact").disabled, true);
});

test("hides the context size label while compacting and restores it afterwards", () => {
  const { document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  const label = document.getElementById("runContextTokens");
  const status = document.getElementById("runStatusText");

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000, prompt: "run task" });
  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-1",
    tokensInContextWindow: 12345,
    modelContextWindow: 272000,
  });
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end", message: "Task completed" });
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "12k");

  window.dispatchMessage({
    type: "runStatus",
    tabId: "tab-1",
    status: "start",
    startedAt: 3_000,
    activity: "contextCompaction",
  });
  assert.equal(status.textContent, "压缩中");
  assert.equal(status.style.display, "inline-flex");
  assert.equal(label.style.display, "none");
  assert.equal(label.textContent, "");

  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-1",
    tokensInContextWindow: 4000,
    modelContextWindow: 272000,
  });
  assert.equal(label.style.display, "none");
  assert.equal(label.textContent, "");

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end" });
  assert.equal(status.textContent, "");
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "4k");

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end" });
  window.dispatchMessage({ type: "kimiCompactionUpdate", tabId: "tab-1", status: "started" });
  assert.equal(document.getElementById("runStatusText").textContent, "压缩中");
  assert.equal(label.style.display, "none");
}

test("ZCode hides unknown and initialization context usage while keeping real usage isolated by tab", () => {
  const { api, document, window } = createRuntimeHarness(undefined, undefined, ["codex", "zcode"]);
  window.dispatchMessage({ type: "state", payload: createPanelState({
    currentCli: "zcode",
    conversationTabs: {
      activeTabId: "tab-1", tabs: [{ id: "tab-1", cli: "zcode" }, { id: "tab-2", cli: "zcode" }],
    },
  }) });
  const label = document.getElementById("runContextTokens");
  assert.equal(label.style.display, "none");
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start" });
  assert.equal(label.style.display, "none");
  window.dispatchMessage({
    type: "contextTokenUsage", tabId: "tab-1", tokensInContextWindow: 0,
    modelContextWindow: 200000, contextWindowSource: "zcode-projection",
  });
  assert.equal(label.style.display, "none");
  assert.equal(label.textContent, "");
  assert.equal(label.getAttribute("title"), null);
  assert.equal(label.getAttribute("aria-label"), null);
  window.dispatchMessage({
    type: "contextTokenUsage", tabId: "tab-2", tokensInContextWindow: 7733,
    modelContextWindow: 200000, contextWindowSource: "zcode-projection",
  });
  assert.equal(label.style.display, "none");
  window.dispatchMessage({
    type: "contextTokenUsage", tabId: "tab-1", tokensInContextWindow: 17956,
    modelContextWindow: 200000, contextWindowSource: "zcode-projection",
  });
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "18k");
  assert.match(String(label.getAttribute("title")), /17956 \/ 200000/);
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end" });
  assert.equal(label.textContent, "18k");
  api.state.conversationTabs.activeTabId = "tab-2";
  api.updateContextTokenUsage();
  assert.equal(label.textContent, "7.7k");
  api.state.conversationTabs.activeTabId = "tab-1";
  api.updateContextTokenUsage();
  assert.equal(label.textContent, "18k");
});
  window.dispatchMessage({ type: "kimiCompactionUpdate", tabId: "tab-1", status: "completed" });
  assert.equal(document.getElementById("runStatusText").style.display, "none");
  assert.equal(label.style.display, "inline-flex");
});

test("does not show context tokens for runs without native usage support", () => {
  const { document, window } = createRuntimeHarness();
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      currentCli: "claude",
      conversationTabs: {
        activeTabId: "tab-2",
        tabs: [
          { id: "tab-1", cli: "codex" },
          { id: "tab-2", cli: "claude" },
        ],
      },
    }),
  });
  const label = document.getElementById("runContextTokens");
  window.dispatchMessage({ type: "runStatus", tabId: "tab-2", status: "start", startedAt: 2_000, prompt: "run task" });
  assert.equal(label.style.display, "none");
  assert.equal(label.textContent, "");
});

test("keeps ordinary assistant bubbles formatted while throttling continuous appends", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.renderMessages();

  const appendContent = (content: string) => window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "ordinary-stream",
    content,
    kind: "normal",
  });
  appendContent("formatted reply");
  const bubble = document.getElementById("messages").querySelector(".bubble");
  assert.ok(bubble);
  const initialHtml = bubble.innerHTML;
  const renderTimerId = Array.from(window.timers.keys()).find((timerId) => window.timerDelays.get(timerId) === 180);
  assert.ok(renderTimerId);

  appendContent(" first addition");
  appendContent(" second addition");
  assert.equal(document.getElementById("messages").querySelector(".assistant-message-content-streaming"), null);
  assert.equal(bubble.innerHTML, initialHtml);
  assert.ok(window.timers.has(renderTimerId));

  const render = window.timers.get(renderTimerId);
  window.timers.delete(renderTimerId);
  render?.();
  assert.match(bubble.innerHTML, /first addition second addition/);
  assert.doesNotMatch(bubble.innerHTML, /assistant-message-content-streaming/);

  appendContent(" third addition");
  const nextRenderTimerId = Array.from(window.timers.keys()).find((timerId) => window.timerDelays.get(timerId) === 180);
  assert.ok(nextRenderTimerId);
  assert.notEqual(nextRenderTimerId, renderTimerId);
  window.timers.get(nextRenderTimerId)?.();
  assert.match(bubble.innerHTML, /third addition/);
});

test("auto-scrolls the chat only while the viewport is within 75px of the bottom", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  const chatArea = document.getElementById("chatArea");
  const place = (scrollHeight: number, clientHeight: number, scrollTop: number) => {
    chatArea.scrollHeight = scrollHeight;
    chatArea.clientHeight = clientHeight;
    chatArea.scrollTop = scrollTop;
  };
  const appendDelta = (id: string, content: string, kind: "normal" | "thinking") => {
    window.dispatchMessage({
      type: "assistantDelta",
      tabId: "tab-1",
      id,
      content,
      kind,
    });
  };

  place(1000, 400, 100);
  api.state.messages.push(
    { id: "history-user", role: "user", content: "look at history", createdAt: 1 },
    { id: "history-assistant", role: "assistant", content: "older answer", createdAt: 2 },
  );
  api.renderMessages();
  assert.equal(chatArea.scrollTop, 100);

  place(1000, 400, 100);
  appendDelta("new-bubble", "a new bubble", "normal");
  assert.equal(chatArea.scrollTop, 100);

  place(1000, 400, 526);
  appendDelta("near-bubble", "near bottom", "normal");
  assert.equal(chatArea.scrollTop, chatArea.scrollHeight);

  place(1000, 400, 525);
  appendDelta("boundary-bubble", "at the threshold", "normal");
  assert.equal(chatArea.scrollTop, chatArea.scrollHeight);

  place(1000, 400, 524);
  appendDelta("far-bubble", "still reading", "normal");
  assert.equal(chatArea.scrollTop, 524);

  place(1000, 400, 100);
  appendDelta("think-1", "thinking", "thinking");
  assert.equal(chatArea.scrollTop, 100);

  place(1000, 400, 525);
  appendDelta("think-1", " more", "thinking");
  assert.equal(chatArea.scrollTop, chatArea.scrollHeight);

  place(1600, 400, 200);
  appendDelta("think-1", " still", "thinking");
  assert.equal(chatArea.scrollTop, 200);
});

test("collapses two or more consecutive instruction bubbles until toggled", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.state.messages.push(
    { id: "user-1", role: "user", content: "start", createdAt: 1 },
    { id: "cmd-1", role: "trace", content: "command one", createdAt: 2 },
    { id: "cmd-2", role: "assistant", content: "command two", createdAt: 3 },
    { id: "think-1", role: "assistant", kind: "thinking", content: "planning", createdAt: 4 },
    { id: "cmd-3", role: "trace", content: "command three", createdAt: 5 },
    { id: "cmd-4", role: "trace", content: "command four", createdAt: 6 },
    { id: "cmd-5", role: "assistant", content: "command five", createdAt: 7 },
    { id: "reason-1", role: "assistant", content: "**Thinking** still reasoning", createdAt: 8 },
    { id: "final-1", role: "assistant", content: "final answer", codexFinalAnswer: true, createdAt: 9 },
    { id: "cmd-6", role: "trace", content: "tail one", createdAt: 10 },
    { id: "cmd-7", role: "trace", content: "tail two", createdAt: 11 },
  );
  api.renderMessages();

  const messages = document.getElementById("messages");
  const messageNode = (id: string) => {
    const queue = [messages];
    while (queue.length) {
      const node = queue.shift();
      for (const child of node?.children || []) {
        if (child.dataset && child.dataset.messageId === id) {
          return child;
        }
        queue.push(child);
      }
    }
    return null;
  };
  const groups = messages.querySelectorAll("details.instruction-group");
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((group: { querySelector: (selector: string) => { textContent: string } }) => group.querySelector("summary").textContent),
    ["(2) command two", "(3) command five", "(2) tail two"],
  );
  groups.forEach((group: { open: boolean }) => assert.equal(group.open, false));
  assert.deepEqual(
    groups.map((group: { querySelector: (selector: string) => { children: Array<{ dataset: { messageId?: string } }> } }) => group.querySelector(".instruction-group-body").children.map((node) => node.dataset.messageId)),
    [
      ["cmd-1", "cmd-2"],
      ["cmd-3", "cmd-4", "cmd-5"],
      ["cmd-6", "cmd-7"],
    ],
  );
  assert.equal(String(messageNode("user-1")?.parentNode?.className || "").includes("instruction-group-body"), false);
  assert.equal(String(messageNode("think-1")?.parentNode?.className || "").includes("instruction-group-body"), false);
  assert.equal(String(messageNode("reason-1")?.parentNode?.className || "").includes("instruction-group-body"), false);
  assert.equal(String(messageNode("final-1")?.parentNode?.className || "").includes("instruction-group-body"), false);
  assert.ok(messageNode("think-1")?.querySelector(".thinking-bubble"));
  assert.ok(messageNode("reason-1")?.querySelector(".thinking-bubble"));
  assert.ok(messageNode("final-1"));
  assert.equal(messageNode("final-1")?.className.includes("message-final-summary"), true);

  const summary = groups[1].querySelector("summary");
  summary.click();
  assert.equal(groups[1].open, true);
  assert.equal(summary.textContent, "收起 (3)");
  api.renderMessages();
  const reopened = messages.querySelectorAll("details.instruction-group")[1];
  assert.equal(reopened.open, true);
  assert.equal(reopened.querySelector("summary").textContent, "收起 (3)");

  reopened.querySelector("summary").click();
  assert.equal(reopened.open, false);
  assert.equal(reopened.querySelector("summary").textContent, "(3) command five");
});

test("keeps Loop, Loop+, and Graph control bubbles outside collapsed instruction groups", () => {
  const scenarios = [
    { mode: "loop", title: "Loop", action: { type: "openLoopGroupChat", taskId: "loop-task", roundKey: "1" } },
    { mode: "loop_plus", title: "Loop+", action: { type: "openLoopGroupChat", taskId: "loop-plus-task" } },
    { mode: "graph", title: "Graph", action: { type: "openGraphRun", graphRunId: "graph-run", nodeId: "node-1" } },
  ];
  for (const scenario of scenarios) {
    const { api, document, window, posted } = createRuntimeHarness();
    window.dispatchMessage({ type: "state", payload: createPanelState({ interactiveMode: scenario.mode }) });
    api.state.onlyShowFinalResults = false;
    window.dispatchMessage({
      type: "setMessages",
      tabId: "tab-1",
      messages: [
        { id: "before-1", role: "trace", content: "exec pwd", loopTaskId: "task", graphRunId: "run" },
        { id: "before-2", role: "trace", content: "exec ls", loopTaskId: "task", graphRunId: "run" },
        { id: "started", role: "system", content: `已开始 ${scenario.title} 任务：task\n记录文件：任务记录`, createdAt: 1_700_000_000_000, actions: [scenario.action] },
        { id: "middle-1", role: "trace", content: "exec git status" },
        { id: "middle-2", role: "assistant", content: "继续检查实现。" },
        { id: "notice", role: "system", content: `${scenario.title} 子任务已派发，等待执行结果。` },
        { id: "action-only", role: "assistant", content: "", actions: [scenario.action] },
        { id: "after-1", role: "trace", content: "exec npm test" },
        { id: "after-2", role: "trace", content: "exec git diff" },
      ],
    });
    const messages = document.getElementById("messages");
    const assertControlBubblesVisible = () => {
      assert.deepEqual(
        messages.children.map((child: FakeElement) => child.dataset.messageId || child.className),
        ["instruction-group", "started", "instruction-group", "notice", "action-only", "instruction-group"],
        scenario.title,
      );
      assert.deepEqual(
        messages.querySelectorAll("details.instruction-group").map((group: FakeElement) => group.querySelector(".instruction-group-body")?.children.map((child) => child.dataset.messageId)),
        [["before-1", "before-2"], ["middle-1", "middle-2"], ["after-1", "after-2"]],
      );
      const started = messages.children.find((child: FakeElement) => child.dataset.messageId === "started");
      assert.match(started?.querySelector(".bubble")?.innerHTML || "", /class="system-time"/);
      assert.ok(started?.querySelector(".message-action-link"));
      assert.ok(messages.children.find((child: FakeElement) => child.dataset.messageId === "action-only")?.querySelector(".message-action-link"));
    };
    assertControlBubblesVisible();
    messages.children.find((child: FakeElement) => child.dataset.messageId === "started")?.querySelector(".message-action-link")?.click();
    const actionMessage = posted.find((message) => message.type === scenario.action.type);
    assert.ok(actionMessage);
    if ("taskId" in scenario.action) {
      assert.equal(actionMessage.taskId, scenario.action.taskId);
    } else {
      assert.equal(actionMessage.graphRunId, scenario.action.graphRunId);
      assert.equal(actionMessage.nodeId, scenario.action.nodeId);
    }
    api.renderMessages();
    assertControlBubblesVisible();
    window.dispatchMessage({
      type: "appendMessage",
      tabId: "tab-1",
      message: { id: "live-notice", role: "system", content: `${scenario.title} 任务状态已更新。`, actions: [scenario.action] },
    });
    assert.equal(messages.children[messages.children.length - 1].dataset.messageId, "live-notice");
    assert.ok(messages.children[messages.children.length - 1].querySelector(".message-action-link"));
  }
});

test("does not exempt ordinary instruction bubbles with empty or invalid task actions", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.state.messages = [
    { id: "empty-actions", role: "trace", content: "exec pwd", actions: [] },
    { id: "invalid-actions", role: "assistant", content: "普通指令。", actions: [{ type: "openLoopGroupChat", taskId: " " }, { type: "openGraphRun", graphRunId: "" }, null] },
  ];
  api.renderMessages();
  const messages = document.getElementById("messages");
  assert.equal(messages.children.length, 1);
  assert.equal(messages.children[0].className, "instruction-group");
  assert.deepEqual(
    messages.querySelector(".instruction-group-body").children.map((child: FakeElement) => child.dataset.messageId),
    ["empty-actions", "invalid-actions"],
  );
});

for (const kind of ["normal", "thinking", "tool-use"]) {
  test(`appends the first ${kind} trace to an empty conversation without a dispatch error`, () => {
    const { api, document, window, posted } = createRuntimeHarness();
    window.dispatchMessage({ type: "state", payload: createPanelState() });
    api.state.onlyShowFinalResults = false;
    window.dispatchMessage({ type: "setMessages", tabId: "tab-1", messages: [] });

    window.dispatchMessage({
      type: "appendMessage",
      tabId: "tab-1",
      message: { id: "first-trace", role: "trace", kind, content: "首条执行记录" },
    });

    assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
    assert.equal(api.state.messages.length, 1);
    assert.equal(api.state.messages[0].id, "first-trace");
    const contentSelector = kind === "thinking" ? ".thinking-bubble-viewport" : ".bubble";
    assert.match(document.getElementById("messages").querySelector(contentSelector)?.innerHTML || "", /首条执行记录/);
  });
}

test("receives trace messages and an assistant reply after retrying an initially failed conversation", () => {
  const { api, document, window, posted } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start" });
  window.dispatchMessage({
    type: "setMessages",
    tabId: "tab-1",
    messages: [
      { id: "initial-user", role: "user", content: "执行任务" },
      { id: "initial-error", role: "trace", content: "error\n模型启动失败" },
    ],
  });
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "error" });
  window.dispatchMessage({ type: "setMessages", tabId: "tab-1", messages: [] });
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start" });

  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "retry-trace", role: "trace", content: "重试执行记录" },
  });
  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "retry-answer", role: "assistant", content: "重试成功", codexFinalAnswer: true },
  });
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end" });

  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  assert.deepEqual(api.state.messages.map((message: any) => message.id), ["retry-trace", "retry-answer"]);
  assert.match(document.getElementById("messages").children[1].querySelector(".bubble")?.innerHTML || "", /重试成功/);
});

test("preserves trace merging rules when the conversation starts with a trace", () => {
  const { api, window, posted } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  window.dispatchMessage({ type: "setMessages", tabId: "tab-1", messages: [] });

  for (const message of [
    { id: "trace-1", role: "trace", kind: "normal", content: "第一条执行记录" },
    { id: "trace-2", role: "trace", kind: "normal", content: "第二条执行记录" },
    { id: "thinking-1", role: "trace", kind: "thinking", content: "思考记录" },
    { id: "tool-1", role: "trace", kind: "tool-use", content: "第一条工具调用" },
    { id: "tool-2", role: "trace", kind: "tool-use", content: "第二条工具调用" },
    { id: "separate-1", role: "trace", kind: "normal", content: "独立执行记录", merge: false },
    { id: "separate-2", role: "trace", kind: "normal", content: "后续执行记录" },
  ]) {
    window.dispatchMessage({ type: "appendMessage", tabId: "tab-1", message });
  }

  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
  assert.deepEqual(api.state.messages.map((message: any) => message.id), [
    "trace-1", "thinking-1", "tool-1", "tool-2", "separate-1", "separate-2",
  ]);
  assert.equal(api.state.messages[0].content, "第一条执行记录\n第二条执行记录");
});

test("keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      interactiveMode: "coding",
      conversationTabs: { activeTabId: "tab-1", tabs: [{ id: "tab-1", cli: "codex" }, { id: "tab-2", cli: "claude" }] },
    }),
  });
  api.state.onlyShowFinalResults = false;
  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "user-start", role: "user", content: "start conversation" },
  });

  const tab = (label: string) => document.getElementById("conversationTabs")
    .querySelectorAll(".conversation-tab")
    .find((item: FakeElement) => item.querySelector(".conversation-tab-label")?.textContent === label);
  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "error-1", role: "trace", kind: "normal", content: "error\nfirst failure", merge: false },
  });
  assert.equal(tab("codex")?.classList.contains("errored"), true);
  assert.equal(tab("claude")?.classList.contains("errored"), false);
  assert.ok(api.state.messages.some((message: any) => message.id === "error-1"), JSON.stringify(api.state.messages));

  window.dispatchMessage({
    type: "traceSegment",
    tabId: "tab-1",
    id: "error-1",
    content: "error\nupdated failure",
    kind: "normal",
    merge: false,
  });
  assert.equal(api.state.messages.find((message: any) => message.id === "error-1")?.content.includes("updated failure"), true);
  assert.equal(tab("codex")?.classList.contains("errored"), true);

  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "error-2", role: "trace", kind: "normal", content: "error\nsecond failure", merge: false },
  });
  const errorGroup = document.getElementById("messages").querySelector("details.instruction-group");
  assert.ok(errorGroup);
  assert.equal(errorGroup.open, false);
  assert.equal(errorGroup.querySelector(".instruction-group-body").children.length, 2);
  assert.equal(tab("codex")?.classList.contains("errored"), true);
  errorGroup.querySelector("summary").click();
  assert.equal(errorGroup.open, true);
  assert.equal(tab("codex")?.classList.contains("errored"), true);
  errorGroup.querySelector("summary").click();
  assert.equal(tab("codex")?.classList.contains("errored"), true);

  window.dispatchMessage({ type: "traceSegment", tabId: "tab-2", id: "background-error", content: "error\nbackground failure", kind: "normal", merge: false });
  assert.equal(tab("claude")?.classList.contains("errored"), true);
  assert.equal(tab("codex")?.classList.contains("errored"), true);
  window.dispatchMessage({ type: "rawStreamDelta", tabId: "tab-2", content: "recovered output", stream: "stdout" });
  assert.equal(tab("claude")?.classList.contains("errored"), false);

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "error" });
  assert.equal(tab("codex")?.classList.contains("errored"), true);
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end" });
  assert.equal(tab("codex")?.classList.contains("errored"), false);
});

test("restarts instruction folding after each thinking bubble", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  const trace = (id: string, content: string) => ({ id, role: "trace", kind: "tool-use", content, merge: false });
  api.state.messages.push(
    trace("t1", "exec one"),
    trace("t2", "exec two"),
    trace("t3", "exec three"),
    trace("t4", "exec four"),
    trace("t5", "exec five"),
    trace("t6", "exec six"),
    trace("t7", "exec seven"),
    trace("t8", "exec eight"),
  );
  api.renderMessages();
  assert.equal(document.getElementById("messages").querySelectorAll("details.instruction-group").length, 1);

  api.state.messages.splice(4, 0, { id: "think-a", role: "assistant", kind: "thinking", content: "正在分析折叠计数" });
  api.state.messages.splice(9, 0, {
    id: "think-b",
    role: "assistant",
    content: "**Figuring out the next count**\n\nThe previous fold must stay separate.",
  });
  api.state.messages.push(
    trace("t9", "exec nine"),
    trace("t10", "exec ten"),
    { id: "think-c", role: "trace", content: "thinking: 这里再次打断" },
    trace("t11", "exec eleven"),
    trace("t12", "exec twelve"),
    trace("t13", "exec thirteen"),
  );
  api.renderMessages();

  const messages = document.getElementById("messages");
  const messageNode = (id: string) => {
    const queue = [messages];
    while (queue.length) {
      const node = queue.shift();
      for (const child of node?.children || []) {
        if (child.dataset && child.dataset.messageId === id) {
          return child;
        }
        queue.push(child);
      }
    }
    return null;
  };
  const groups = messages.querySelectorAll("details.instruction-group");
  assert.deepEqual(
    groups.map((group: { querySelector: (selector: string) => { textContent: string; children: Array<{ dataset: { messageId?: string } }> } }) => group.querySelector("summary").textContent),
    ["(4) 执行命令： four", "(4) 执行命令： eight", "(2) 执行命令： ten", "(3) 执行命令： thirteen"],
  );
  assert.deepEqual(
    groups.map((group: { querySelector: (selector: string) => { children: Array<{ dataset: { messageId?: string } }> } }) => group.querySelector(".instruction-group-body").children.map((node) => node.dataset.messageId)),
    [
      ["t1", "t2", "t3", "t4"],
      ["t5", "t6", "t7", "t8"],
      ["t9", "t10"],
      ["t11", "t12", "t13"],
    ],
  );
  for (const id of ["think-a", "think-b", "think-c"]) {
    const node = messageNode(id);
    assert.ok(node);
    assert.equal(String(node?.parentNode?.className || "").includes("instruction-group-body"), false);
  }
  assert.ok(messageNode("think-a")?.querySelector(".thinking-bubble"));
  assert.ok(messageNode("think-b")?.querySelector(".thinking-bubble"));
  assert.ok(messageNode("think-c")?.querySelector(".thinking-bubble"));
  assert.equal(messages.querySelectorAll(".thinking-bubble").length, 3);
  groups.forEach((group: { querySelectorAll: (selector: string) => unknown[] }) => {
    assert.equal(group.querySelectorAll(".thinking-bubble").length, 0);
  });
});

test("collapsed instruction group summary uses the latest bubble title", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.state.messages.push(
    { id: "tool-bash", role: "trace", content: "tool: bash" },
    { id: "tool-grep", role: "trace", content: "tool: grep" },
    { id: "tool-read", role: "trace", content: "tool: read" },
  );
  api.renderMessages();

  const messages = document.getElementById("messages");
  const group = messages.querySelector("details.instruction-group");
  const summary = group.querySelector("summary");
  assert.equal(summary.textContent, "(3) 读取文件");

  summary.click();
  assert.equal(summary.textContent, "收起 (3)");
  summary.click();
  assert.equal(summary.textContent, "(3) 读取文件");

  const summaryText = () => {
    const nextGroup = document.getElementById("messages").querySelector("details.instruction-group");
    assert.ok(nextGroup);
    return nextGroup.querySelector("summary").textContent;
  };

  api.state.messages[2].content = "tool: edit\ninput:\n{}\n";
  api.renderMessages();
  assert.equal(summaryText(), "(3) 编辑文件");

  api.state.messages.splice(0, api.state.messages.length,
    { id: "blank-1", role: "trace", content: "   " },
    { id: "blank-2", role: "trace", content: "\n" },
    { id: "blank-3", role: "trace", content: "" },
  );
  api.renderMessages();
  assert.equal(summaryText(), "(3) 已折叠");

  const longText = "这是一段没有工具标题的中间说明文字，需要在折叠摘要里被截断后继续显示";
  api.state.messages.splice(0, api.state.messages.length,
    { id: "note-1", role: "assistant", content: "先看上下文" },
    { id: "note-2", role: "assistant", content: "再核对边界" },
    { id: "note-3", role: "assistant", content: longText },
  );
  api.renderMessages();
  assert.equal(summaryText(), `(3) ${longText.slice(0, 32)}…`);
});

test("treats assistant narration immediately before a tool call as a thinking bubble", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.state.messages.push(
    { id: "think-en", role: "assistant", kind: "thinking", content: "I have enough information to write a precise dispatch." },
    { id: "narration", role: "assistant", content: "交互运行时是当前最值得拆的点：把三套轮次拆开，公共循环保持不动。" },
    { id: "tool-1", role: "trace", kind: "tool-use", content: "tool: run_terminal_command\nstatus: completed" },
    { id: "tool-2", role: "trace", kind: "tool-use", content: "tool: read_file\nstatus: completed" },
    { id: "tool-3", role: "trace", kind: "tool-use", content: "tool: grep\nstatus: completed" },
    { id: "final-json", role: "assistant", content: "{\"status\":\"dispatch\",\"subtasks\":[]}" },
    { id: "user-2", role: "user", content: "继续" },
    { id: "plain-1", role: "assistant", content: "这段说明后面没有工具，仍是普通气泡。" },
    { id: "plain-2", role: "assistant", content: "第二段普通说明。" },
    { id: "plain-3", role: "assistant", content: "第三段普通说明。" },
  );
  api.renderMessages();

  const messages = document.getElementById("messages");
  const messageNode = (id: string) => {
    const queue = [messages];
    while (queue.length) {
      const node = queue.shift();
      for (const child of node?.children || []) {
        if (child.dataset && child.dataset.messageId === id) {
          return child;
        }
        queue.push(child);
      }
    }
    return null;
  };
  const narration = messageNode("narration");
  assert.ok(narration?.querySelector(".thinking-bubble"));
  assert.equal(String(narration?.parentNode?.className || "").includes("instruction-group-body"), false);
  assert.equal(messageNode("final-json")?.querySelector(".thinking-bubble"), null);
  const groups = messages.querySelectorAll("details.instruction-group");
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group: { querySelector: (selector: string) => { children: Array<{ dataset: { messageId?: string } }> } }) => group.querySelector(".instruction-group-body").children.map((node) => node.dataset.messageId)),
    [
      ["tool-1", "tool-2", "tool-3", "final-json"],
      ["plain-1", "plain-2", "plain-3"],
    ],
  );
});

const streamCompletionCases = (["normal", "thinking"] as const).flatMap((messageKind) =>
  (["end", "error", "stopped"] as const).map((completionStatus) => ({ messageKind, completionStatus }))
);
for (const { messageKind, completionStatus } of streamCompletionCases) {
  test(`formats running ${messageKind === "normal" ? "final" : "thinking"} bubbles after an idle pause before ${completionStatus}`, (testContext) => {
    const marked = {
      Renderer: class {
        code(): string {
          return "";
        }

        html(): string {
          return "";
        }
      },
      parse(value: string): string {
        return `<p>${value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`;
      },
    };
    const { api, document, window } = createRuntimeHarness(marked);
    testContext.after(() => window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end" }));
    window.dispatchMessage({ type: "state", payload: createPanelState() });
    api.state.onlyShowFinalResults = false;
    window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000, prompt: "run task" });
    const appendContent = (content: string) => window.dispatchMessage({
      type: "assistantDelta",
      tabId: "tab-1",
      id: "stable-stream",
      content,
      kind: messageKind,
      ...(messageKind === "normal" ? { codexFinalAnswer: true } : {}),
    });
    appendContent("hello");
    appendContent(" **world**");
    const streamingNode = document.getElementById("messages").querySelector(".assistant-message-content-streaming");
    assert.ok(streamingNode);

    const idleTimerId = Array.from(window.timers.keys()).find((timerId) => window.timerDelays.get(timerId) === 3000);
    assert.ok(idleTimerId);
    const idleRender = window.timers.get(idleTimerId);
    window.timers.delete(idleTimerId);
    idleRender?.();
    const formattedBubble = document.getElementById("messages").querySelector(".bubble");
    assert.ok(formattedBubble);
    assert.equal(formattedBubble.querySelector(".assistant-message-content-streaming"), null);
    assert.match((formattedBubble.querySelector(".thinking-bubble-viewport") || formattedBubble).innerHTML, /<strong>world<\/strong>/);

    appendContent(" again");
    const resumedStreamingNode = document.getElementById("messages").querySelector(".assistant-message-content-streaming");
    assert.ok(resumedStreamingNode);
    assert.notEqual(resumedStreamingNode, streamingNode);
    assert.match(resumedStreamingNode.textContent, /hello \*\*world\*\* again/);
    window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: completionStatus });
    const bubble = document.getElementById("messages").querySelector(".bubble");
    assert.ok(bubble);
    assert.doesNotMatch(bubble.innerHTML, /assistant-message-content-streaming/);
    assert.match((bubble.querySelector(".thinking-bubble-viewport") || bubble).innerHTML, /<strong>world<\/strong> again/);
    if (messageKind === "normal") {
      assert.match(bubble.innerHTML, /assistant-message-content-final/);
    }
  });
}

test("batches assistant delta markdown rendering while streaming", () => {
  let markdownParseCount = 0;
  const marked = {
    Renderer: class {
      code(): string {
        return "";
      }

      html(): string {
        return "";
      }
    },
    parse(value: string): string {
      markdownParseCount += 1;
      return `<p>${value}</p>`;
    },
  };
  const { api, document, window } = createRuntimeHarness(marked);
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.renderMessages();

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "assistant-stream",
    content: "hello",
    kind: "normal",
  });
  assert.equal(markdownParseCount, 1);

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "assistant-stream",
    content: " **world**",
    kind: "normal",
  });
  assert.equal(markdownParseCount, 1);
  const formattedBubble = document.getElementById("messages").querySelector(".bubble");
  assert.ok(formattedBubble);
  assert.equal(document.getElementById("messages").querySelectorAll(".assistant-message-content-streaming").length, 0);
  assert.match(formattedBubble.innerHTML, /<p>hello<\/p>/);

  const idleTimerId = Array.from(window.timers.keys()).find((timerId) => window.timerDelays.get(timerId) === 180);
  const idleRender = window.timers.get(idleTimerId) as (() => void) | undefined;
  assert.equal(typeof idleRender, "function");
  window.timers.delete(idleTimerId);
  idleRender?.();
  assert.equal(markdownParseCount, 2);
  assert.match(formattedBubble.innerHTML, /hello \*\*world\*\*/);

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "assistant-stream",
    content: "!",
    kind: "normal",
    codexFinalAnswer: true,
  });
  assert.equal(markdownParseCount, 2);
  assert.equal(document.getElementById("messages").querySelectorAll(".assistant-message-content-streaming").length, 1);
  assert.equal(document.getElementById("messages").querySelectorAll(".assistant-message-content-final").length, 0);
  const finalTimerId = Array.from(window.timers.keys()).at(-1);
  assert.equal(window.timerDelays.get(finalTimerId), 3000);

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "assistant-stream",
    content: " more",
    kind: "normal",
    codexFinalAnswer: true,
  });
  assert.equal(markdownParseCount, 2);
  assert.equal(document.getElementById("messages").querySelectorAll(".assistant-message-content-final").length, 0);
  const resetTimerId = Array.from(window.timers.keys()).at(-1);
  assert.equal(window.timerDelays.get(resetTimerId), 3000);

  const finalRender = window.timers.get(resetTimerId) as (() => void) | undefined;
  assert.equal(typeof finalRender, "function");
  window.timers.delete(resetTimerId);
  finalRender?.();
  assert.equal(markdownParseCount, 3);
  const finalBubble = document.getElementById("messages").querySelector(".bubble");
  assert.match(finalBubble?.innerHTML || "", /assistant-message-content-final/);
  assert.doesNotMatch(finalBubble?.innerHTML || "", /assistant-message-content-streaming/);
});

test("hides empty assistant placeholders until text arrives after a tool trace", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "thinking-placeholder", role: "assistant", kind: "thinking", content: "" },
  });
  assert.equal(api.state.messages.length, 1);
  assert.equal(document.getElementById("messages").children.length, 0);
  assert.equal(document.getElementById("emptyState").style.display, "block");

  window.dispatchMessage({
    type: "assistantDelta", tabId: "tab-1", id: "thinking-placeholder", kind: "thinking", content: " \n",
  });
  assert.equal(document.getElementById("messages").children.length, 0);
  assert.equal(document.getElementById("emptyState").style.display, "block");
  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-1",
    message: { id: "tool-between", role: "trace", content: "exec\npwd", merge: false },
  });
  window.dispatchMessage({
    type: "assistantDelta", tabId: "tab-1", id: "thinking-placeholder", kind: "thinking", content: "Inspecting the renderer.",
  });
  assert.equal(api.state.messages.length, 2);
  assert.equal(api.state.messages[0].id, "thinking-placeholder");
  assert.equal(api.state.messages[0].content, " \nInspecting the renderer.");
  assert.equal(document.getElementById("messages").children.length, 2);
  assert.equal(document.getElementById("messages").children[0].dataset.messageId, "thinking-placeholder");
  assert.equal(document.getElementById("emptyState").style.display, "none");
});

test("hides historical empty thinking and final markers without hiding real text or actions", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  window.dispatchMessage({
    type: "setMessages",
    tabId: "tab-1",
    messages: [
      { id: "blank-thinking", role: "assistant", kind: "thinking", content: " \n\t" },
      { id: "empty-thinking-trace", role: "trace", kind: "thinking", content: "" },
      { id: "heading-only-thinking", role: "trace", content: "thinking\n \t" },
      { id: "empty-final", role: "assistant", content: "<FINAL> \n", codexFinalAnswer: true },
      { id: "real-thinking", role: "assistant", kind: "thinking", content: "Inspecting the logs." },
      { id: "real-thinking-trace", role: "trace", kind: "thinking", content: "thinking: Checking events." },
      { id: "tool-trace", role: "trace", content: "exec\npwd" },
      { id: "actions-only", role: "assistant", content: "", actions: [{ type: "openLoopGroupChat", taskId: "task-1", label: "Open discussion" }] },
    ],
  });
  const messages = document.getElementById("messages");
  assert.deepEqual(
    messages.children.map((child: FakeElement) => child.dataset.messageId || child.className),
    ["real-thinking", "real-thinking-trace", "tool-trace", "actions-only"],
  );
  assert.equal(api.state.messages.length, 8);
  assert.ok(document.getElementById("messages").querySelector(".message-action-link"));
});

test("hides whitespace-only assistant deltas and restores visibility when text arrives", () => {
  const { api, document, window } = createRuntimeHarness();
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  window.dispatchMessage({ type: "assistantDelta", tabId: "tab-1", id: "blank-delta", kind: "normal", content: " " });
  assert.equal(document.getElementById("messages").children.length, 0);
  assert.equal(document.getElementById("emptyState").style.display, "block");
  window.dispatchMessage({ type: "assistantDelta", tabId: "tab-1", id: "blank-delta", kind: "normal", content: "Actual reply." });
  assert.equal(api.state.messages.length, 1);
  assert.equal(api.state.messages[0].content, " Actual reply.");
  assert.equal(document.getElementById("messages").children.length, 1);
  assert.match(document.getElementById("messages").querySelector(".bubble")?.innerHTML || "", /Actual reply/);
});

test("keeps thinking bubbles as plain text while streaming appends", () => {
  let markdownParseCount = 0;
  const marked = {
    Renderer: class {
      code(): string {
        return "";
      }

      html(): string {
        return "";
      }
    },
    parse(value: string): string {
      markdownParseCount += 1;
      return `<p>${value}</p>`;
    },
  };
  const { api, document, window } = createRuntimeHarness(marked);
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  api.state.onlyShowFinalResults = false;
  api.renderMessages();

  const bubbleHtml = (): string => {
    const bubble = document.getElementById("messages").querySelector(".bubble");
    return (bubble?.querySelector(".thinking-bubble-viewport") || bubble)?.innerHTML || "";
  };
  const latestDeferredTimerId = (): number | undefined => {
    const deferred = (Array.from(window.timerDelays.entries()) as Array<[number, number]>)
      .filter((entry) => entry[1] === 3000);
    return deferred.length ? deferred[deferred.length - 1][0] : undefined;
  };

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "thinking-stream",
    content: "hello",
    kind: "thinking",
  });
  assert.equal(markdownParseCount, 0);
  assert.match(bubbleHtml(), /assistant-message-content-streaming/);
  assert.match(bubbleHtml(), /hello/);
  assert.doesNotMatch(bubbleHtml(), /<p>/);
  const firstTimerId = latestDeferredTimerId();
  assert.equal(typeof firstTimerId, "number");

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "thinking-stream",
    content: "\n**world**",
    kind: "thinking",
  });
  assert.equal(markdownParseCount, 0);
  const streaming = document.getElementById("messages").querySelector(".assistant-message-content-streaming");
  assert.ok(streaming);
  assert.match(streaming?.textContent || "", /hello/);
  assert.match(streaming?.textContent || "", /\*\*world\*\*/);
  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "thinking-stream",
    content: " more",
    kind: "thinking",
  });
  assert.equal(document.getElementById("messages").querySelector(".assistant-message-content-streaming"), streaming);
  const resetTimerId = latestDeferredTimerId();
  assert.equal(typeof resetTimerId, "number");
  assert.notEqual(resetTimerId, firstTimerId);

  api.renderMessages();
  assert.equal(markdownParseCount, 0);
  assert.match(bubbleHtml(), /assistant-message-content-streaming/);
  assert.match(bubbleHtml(), /\*\*world\*\*/);
  assert.doesNotMatch(bubbleHtml(), /<p>/);

  const idleRender = window.timers.get(resetTimerId as number) as (() => void) | undefined;
  assert.equal(typeof idleRender, "function");
  window.timers.delete(resetTimerId as number);
  idleRender?.();
  assert.equal(markdownParseCount, 1);
  assert.match(bubbleHtml(), /<p>hello/);
  assert.doesNotMatch(bubbleHtml(), /assistant-message-content-streaming/);

  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "thinking-stream",
    content: " more",
    kind: "thinking",
  });
  assert.equal(markdownParseCount, 1);
  assert.ok(document.getElementById("messages").querySelector(".assistant-message-content-streaming"));
  assert.equal(typeof latestDeferredTimerId(), "number");
});

test("rejects attachment selections over webview limits before reading", async () => {
  const { api, document, posted } = createRuntimeHarness();
  const files = Array.from({ length: 11 }, (_, index) => ({
    name: `file-${index}.txt`,
    type: "text/plain",
    size: 1,
  }));

  await api.handleFileSelection(files);

  assert.equal(posted.some((message) => message && message.type === "uploadFiles"), false);
  assert.match(document.getElementById("toast").textContent, /附件数量过多/);
  assert.ok(api.state.messages.some((message: any) => /附件数量过多/.test(message.content)));
});

test("dispatches background prompts for Graph tabs as Graph runs", () => {
  const harness = createRuntimeHarness();
  const { api, posted, window } = harness;

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      conversationTabs: {
        activeTabId: "tab-1",
        tabs: [
          { id: "tab-1", cli: "codex" },
          { id: "tab-2", cli: "opencode" },
        ],
      },
      interactiveMode: "coding",
    }),
  });
  window.dispatchMessage({
    type: "appendMessage",
    tabId: "tab-2",
    message: {
      id: "graph-started",
      role: "system",
      content: "Graph run started",
      createdAt: Date.now(),
      actions: [{ type: "openGraphRun", graphRunId: "graph-1" }],
    },
  });

  const beforeDispatch = posted.length;
  assert.equal(api.dispatchPrompt({ prompt: "continue graph task" }, {
    tabId: "tab-2",
    preserveActiveTab: true,
  }), true);
  const sendPromptMessage = posted
    .slice(beforeDispatch)
    .find((message) => message && message.type === "sendPrompt");

  assert.ok(sendPromptMessage);
  assert.equal(sendPromptMessage.tabId, "tab-2");
  assert.equal(sendPromptMessage.cli, "opencode");
  assert.equal(sendPromptMessage.interactiveMode, "graph");
  assert.equal(sendPromptMessage.preserveActiveTab, true);
});

test("uses the selected foreground mode after a Graph run on the same tab", () => {
  const harness = createRuntimeHarness();
  const { api, posted, window } = harness;

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      conversationTabs: {
        activeTabId: "tab-graph",
        tabs: [{ id: "tab-graph", cli: "codex", graphRunId: "graph-1" }],
      },
      interactiveMode: "coding",
    }),
  });

  const beforeCodingDispatch = posted.length;
  assert.equal(api.dispatchPrompt({ prompt: "switch to vibe" }), true);
  const codingSendPromptMessage = posted
    .slice(beforeCodingDispatch)
    .find((message) => message && message.type === "sendPrompt");

  assert.ok(codingSendPromptMessage);
  assert.equal(codingSendPromptMessage.tabId, "tab-graph");
  assert.equal(codingSendPromptMessage.cli, "codex");
  assert.equal(codingSendPromptMessage.interactiveMode, "coding");
  assert.equal(Object.prototype.hasOwnProperty.call(codingSendPromptMessage, "loopMainModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(codingSendPromptMessage, "loopSubtaskModel"), false);

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      conversationTabs: {
        activeTabId: "tab-graph",
        tabs: [{ id: "tab-graph", cli: "codex", graphRunId: "graph-1" }],
      },
      interactiveMode: "loop",
    }),
  });

  const beforeLoopDispatch = posted.length;
  assert.equal(api.dispatchPrompt({ prompt: "switch to loop" }), true);
  const loopSendPromptMessage = posted
    .slice(beforeLoopDispatch)
    .find((message) => message && message.type === "sendPrompt");

  assert.ok(loopSendPromptMessage);
  assert.equal(loopSendPromptMessage.tabId, "tab-graph");
  assert.equal(loopSendPromptMessage.cli, "codex");
  assert.equal(loopSendPromptMessage.interactiveMode, "loop");
  assert.equal(loopSendPromptMessage.loopExecutionMode, "debate_multi_agent");
  assert.equal(loopSendPromptMessage.loopMainModel, "gpt-5-main");
  assert.equal(loopSendPromptMessage.loopSubtaskModel, "gpt-5-subtask");
});

test("dispatches Codex Graph prompts with role models and strips stale role models from coding sends", () => {
  const harness = createRuntimeHarness();
  const { api, posted, window } = harness;

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      conversationTabs: {
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1", cli: "codex" }],
      },
      interactiveMode: "graph",
    }),
  });

  const beforeGraphDispatch = posted.length;
  assert.equal(api.dispatchPrompt({ prompt: "run graph" }), true);
  const graphSendPromptMessage = posted
    .slice(beforeGraphDispatch)
    .find((message) => message && message.type === "sendPrompt");
  assert.ok(graphSendPromptMessage);
  assert.equal(graphSendPromptMessage.cli, "codex");
  assert.equal(graphSendPromptMessage.interactiveMode, "graph");
  assert.equal(graphSendPromptMessage.model, "gpt-5-main");
  assert.equal(graphSendPromptMessage.loopMainModel, "gpt-5-main");
  assert.equal(graphSendPromptMessage.loopSubtaskModel, "gpt-5-subtask");
  assert.equal(graphSendPromptMessage.loopMainThinkingMode, "high");
  assert.equal(graphSendPromptMessage.loopSubtaskThinkingMode, "low");
  assert.equal(
    Object.prototype.hasOwnProperty.call(graphSendPromptMessage, "loopExecutionMode"),
    false,
  );

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      conversationTabs: {
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1", cli: "codex" }],
      },
      interactiveMode: "coding",
    }),
  });

  const beforeCodingDispatch = posted.length;
  assert.equal(api.dispatchPrompt({
    prompt: "run coding",
    loopMainModel: "stale-main",
    loopSubtaskModel: "stale-subtask",
  }), true);
  const codingSendPromptMessage = posted
    .slice(beforeCodingDispatch)
    .find((message) => message && message.type === "sendPrompt");
  assert.ok(codingSendPromptMessage);
  assert.equal(codingSendPromptMessage.cli, "codex");
  assert.equal(codingSendPromptMessage.interactiveMode, "coding");
  assert.equal(codingSendPromptMessage.model, "gpt-5");
  assert.equal(Object.prototype.hasOwnProperty.call(codingSendPromptMessage, "loopMainModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(codingSendPromptMessage, "loopSubtaskModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(codingSendPromptMessage, "loopMainThinkingMode"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(codingSendPromptMessage, "loopSubtaskThinkingMode"), false);
});

test("reports runtime render and window-dispatch failures through the vscode bridge", () => {
  const renderHarness = createRuntimeHarness();
  renderHarness.window.dispatchMessage({ type: "state", payload: createPanelState() });
  renderHarness.window.dispatchMessage({
    type: "setMessages",
    tabId: "tab-1",
    messages: [{ id: "assistant-1", role: "assistant", content: "boom", codexFinalAnswer: true }],
  });

  renderHarness.api.forceRenderMarkdownFailure();
  assert.ok(
    renderHarness.posted.some((message) => message.type === "webviewError" && message.message === "render-message-failed"),
  );
  assert.match(
    renderHarness.document.getElementById("messages").children[0].children[0].innerHTML,
    /render-message-failed/,
  );

  const dispatchHarness = createRuntimeHarness();
  dispatchHarness.window.dispatchMessage({ type: "state", payload: null });
  assert.ok(
    dispatchHarness.posted.some((message) => message.type === "webviewError" && message.message === "window-message-handler-failed"),
  );

  const windowEventHarness = createRuntimeHarness();
  windowEventHarness.window.dispatchEvent({ type: "error", message: "script failed", filename: "runtime.js", lineno: 1, colno: 2 });
  windowEventHarness.window.dispatchEvent({ type: "unhandledrejection", reason: new Error("promise failed") });
  assert.ok(windowEventHarness.posted.some((message) => message.type === "webviewError" && message.message === "script failed"));
  assert.ok(windowEventHarness.posted.some((message) => message.type === "webviewError" && message.message === "webview-unhandledrejection"));
});

test("normalizes core runtime state and prompt context edge cases in isolation", () => {
  const source = [
    "createTaskListState",
    "createConversationRuntimeState",
    "ensureRuntimeStateMessages",
    "ensureRuntimeTaskList",
    "resetTaskListState",
    "normalizeEditorContext",
    "normalizePromptPayload",
    "buildQueuePausedStatusText",
    "isRunStatusSummaryText",
    "isHiddenLoopPlusProtocolPrompt",
    "deriveLatestRunPromptFromMessages",
    "deriveLatestRunStatusMessageFromMessages",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, name)).join("\n");
  const helpers = new Function(
    "t",
    `${source}; return {
      createTaskListState,
      createConversationRuntimeState,
      ensureRuntimeStateMessages,
      ensureRuntimeTaskList,
      resetTaskListState,
      normalizeEditorContext,
      normalizePromptPayload,
      buildQueuePausedStatusText,
      isRunStatusSummaryText,
      deriveLatestRunPromptFromMessages,
      deriveLatestRunStatusMessageFromMessages,
    };`,
  )((key: string, params: { count?: string } = {}) => key === "toastQueuePaused" ? `paused ${params.count}` : key);

  const runtimeState = helpers.createConversationRuntimeState();
  assert.deepEqual(runtimeState.taskList, { items: [], open: false, source: "auto", startIndex: 0 });
  assert.deepEqual(helpers.ensureRuntimeStateMessages({ messages: "bad" }), []);
  const invalidTaskList = { taskList: { items: "bad", open: 1, source: "external", startIndex: -2 } };
  assert.deepEqual(helpers.ensureRuntimeTaskList(invalidTaskList), {
    items: [],
    open: true,
    source: "external",
    startIndex: 0,
  });
  helpers.resetTaskListState(invalidTaskList.taskList, -10);
  assert.deepEqual(invalidTaskList.taskList, { items: [], open: false, source: "auto", startIndex: 0 });
  assert.deepEqual(helpers.normalizeEditorContext({ filePath: "/a.ts", hasSelection: true }), {
    filePath: "/a.ts",
    fileLabel: "/a.ts",
    hasSelection: true,
    selectionLabel: null,
  });
  assert.equal(helpers.normalizePromptPayload(null), null);
  assert.deepEqual(helpers.normalizePromptPayload("run"), {
    prompt: "run",
    contextOptions: { includeCurrentFile: true, includeSelection: true },
  });
  assert.deepEqual(helpers.normalizePromptPayload({ prompt: "run", contextOptions: { includeSelection: false }, interactiveMode: "plan" }), {
    prompt: "run",
    contextOptions: { includeCurrentFile: true, includeSelection: false },
  });
  assert.equal(helpers.buildQueuePausedStatusText("done", 3), "done paused 3");
  assert.equal(helpers.isRunStatusSummaryText("Task completed"), true);
  assert.equal(helpers.isRunStatusSummaryText("still running"), false);
  assert.equal(helpers.deriveLatestRunPromptFromMessages([{ role: "user", content: " first " }, { role: "user", content: " latest " }]), "latest");
  assert.equal(helpers.deriveLatestRunPromptFromMessages([
    { role: "user", content: "real goal" },
    { role: "user", content: "You are the Loop+ main reviewer.\nsecret" },
  ]), "real goal");
  assert.equal(helpers.deriveLatestRunStatusMessageFromMessages([{ role: "system", content: "Task completed" }]), "Task completed");
});

test("treats final-answer type or [final_answer] text as final assistant bubbles", () => {
  const source = [
    "isRunStatusSummaryText",
    "isFinalAssistantSummaryMessage",
  ].map((name) => extractFunctionSource(
    VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE.replace(/\$\{FINAL_ANSWER_TEXT_MARKER\}/g, "[final_answer]"),
    name,
  )).join("\n");
  const helpers = new Function(
    `const state = { messages: [] };
    ${source};
    return {
      setMessages(messages) { state.messages = messages; },
      isFinal(index) { return isFinalAssistantSummaryMessage(index); },
    };`,
  )() as {
    setMessages: (messages: Array<Record<string, unknown>>) => void;
    isFinal: (index: number) => boolean;
  };

  helpers.setMessages([
    { role: "assistant", content: "working" },
    { role: "assistant", content: "[final_answer] done" },
    { role: "assistant", content: "typed final", codexFinalAnswer: true },
    { role: "assistant", content: "thinking about [final_answer]", kind: "thinking" },
    { role: "assistant", content: "truncated thinking...", kind: "thinking" },
    { role: "system", content: "Task completed" },
  ]);

  assert.equal(helpers.isFinal(0), false);
  assert.equal(helpers.isFinal(1), true);
  assert.equal(helpers.isFinal(2), true);
  assert.equal(helpers.isFinal(3), false);
  assert.equal(helpers.isFinal(4), false);

  helpers.setMessages([
    { role: "assistant", content: "ordinary completion-like text" },
    { role: "system", content: "Task completed" },
  ]);
  assert.equal(helpers.isFinal(0), false);
});

test("renders message and trace helpers across final, collapsed, tool-result, and fallback paths", () => {
  const traceSource = `${VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI}\n${VIEW_CONTENT_SCRIPT_TRACE_RENDERING}`
    .replace(/\$\{FINAL_ANSWER_TEXT_MARKER\}/g, "<FINAL>");
  const source = [
    "escapeHtml",
    "getMessageCollapseThreshold",
    "normalizeCollapsePreviewText",
    "shouldCollapseByContentLength",
    "buildBubbleCollapseSummaryText",
    "renderCollapsibleBubbleContent",
    "resolveRenderedMessageIndex",
    "isToolActivityMessage",
    "isPreToolAssistantNarration",
    "isThinkingLikeMessage",
    "isCodexReasoningStyleMessage",
    "isTransparentBubbleMessage",
    "renderUserMessageContent",
    "getAssistantMessageContentForDisplay",
    "isToolResultLikeMessage",
    "shouldShowBubbleTimestamp",
    "appendBubbleTimestamp",
    "renderToolResultLikeMessage",
    "isAssistantMarkdownRenderPending",
    "renderAssistantMessageContent",
    "renderTraceMessageContent",
    "renderMessageContent",
    "safelyRenderMessageContent",
    "getTraceExpandedLines",
    "renderTraceContent",
    "renderTraceBodyLines",
    "shouldCollapseTraceContent",
    "traceDetailDuplicatesExpandedBody",
    "getTraceCollapseSummaryText",
    "getToolResultCollapseSummaryText",
    "hasDiffLikeLines",
    "getTracePresentation",
    "classifyCommandPurposeTag",
    "unwrapShellCommand",
    "stripWrappedQuotes",
    "normalizeCommandForMatching",
    "getToolStyleBucket",
    "getLocalizedToolTitle",
    "getTraceTypeDefinition",
    "isLineNumberedLine",
    "wrapLineNumberedBlocks",
    "parseJsonContainerText",
    "unwrapSingleMarkdownFence",
    "parseCompleteJsonContainer",
    "serializeJsonTreeSource",
    "renderJsonTreeHost",
    "renderChatImage",
    "renderMarkdown",
  ].map((name) => extractFunctionSource(traceSource, name)).join("\n");
  const failures: any[] = [];
  const context = new Function(
    "traceCollapsibleOpenKeys",
    "t",
    "formatDateTime",
    "formatDateTimeWithMs",
    "isFinalAssistantSummaryMessage",
    "reportWebviewFailure",
    "marked",
    "stripAnsi",
    "getDiffLineKind",
    "ensureDiffPrefix",
    "isLineNumberedLine",
    "expandFileChangeTraceContent",
    "stripLeadingEmptyLines",
    `var state = { messages: [] };
    ${source}; return {
      buildBubbleCollapseSummaryText,
      classifyCommandPurposeTag,
      getAssistantMessageContentForDisplay,
      getTracePresentation,
      renderMessageContent,
      renderTraceContent,
      safelyRenderMessageContent,
      shouldCollapseByContentLength,
      unwrapShellCommand,
    };`,
  )(
    new Set(["trace-open"]),
    (key: string, params: Record<string, string> = {}) => {
      const map: Record<string, string> = {
        ...WEBVIEW_STRINGS,
        traceExec: "Exec",
        traceExecTagBuild: "build",
        traceExecTagGitRead: "git-read",
        traceExpandToolResult: `tool ${params.tool}`,
        traceToolResult: "Tool result",
        traceToolFallback: "Tool",
      };
      return map[key] || key;
    },
    () => "date",
    () => "date.ms",
    (index: number) => index === 99,
    (message: string, error: unknown, extra: unknown) => failures.push({ message, error, extra }),
    undefined,
    (value: string) => value.replace(/\u001b\[[0-9;]*m/g, ""),
    (line: string) => line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "",
    (line: string) => line,
    (line: string) => /^\d+/.test(line),
    (value: string) => value,
    (lines: string[]) => {
      const next = lines.slice();
      while (next.length && !next[0].trim()) {
        next.shift();
      }
      return next;
    },
  );

  assert.equal(context.shouldCollapseByContentLength("x".repeat(50)), true);
  assert.equal(context.buildBubbleCollapseSummaryText("a".repeat(60)), `${"a".repeat(50)}…`);
  assert.equal(context.getAssistantMessageContentForDisplay({ role: "assistant", content: "<FINAL> answer" }), "answer");
  assert.equal(
    context.getAssistantMessageContentForDisplay({
      role: "assistant",
      content: "最终气泡判定包含 `<FINAL>` 标记。",
    }),
    "最终气泡判定包含 `<FINAL>` 标记。",
  );
  assert.match(context.renderMessageContent({ role: "assistant", content: "answer" }, 99), /assistant-message-content-final/);
  assert.match(context.renderMessageContent({ role: "user", content: "<tag>", contextTags: ["src/a.ts"] }, 0), /&lt;tag&gt;/);
  assert.match(context.renderTraceContent({ id: "trace-open", role: "trace", content: "exec: npm run build\n+ added" }), /cmd-purpose-build/);
  const dshCommand = context.renderTraceContent({
    id: "dsh-command",
    role: "trace",
    content: "exec rg -n 'taskList' src\n" + "src/task.ts:1: taskList\n".repeat(6),
  });
  assert.match(dshCommand, /cmd-purpose-search/);
  assert.match(dshCommand, /trace-collapsible/);
  assert.match(dshCommand, /rg -n/);
  const dshRead = context.renderTraceContent({
    id: "dsh-read",
    role: "trace",
    content: 'tool read\n{\n  "path": "src/example.ts"\n}\nconst answer = 42;',
  });
  assert.match(dshRead, new RegExp(`<span class="trace-title">${WEBVIEW_STRINGS.traceToolReadFile}<\\/span>`));
  assert.match(dshRead, /src\/example.ts/);
  assert.doesNotMatch(dshRead, /in_progress|pending/);
  const collapsedToolResult = context.renderTraceContent({ id: "tool", role: "trace", content: "Tool result: shell\n" + "x".repeat(70) });
  assert.match(collapsedToolResult, /trace-collapsible trace-collapsible-tool-result/);
  assert.match(collapsedToolResult, /trace-title">Exec<\/span>/);
  assert.doesNotMatch(collapsedToolResult, /class="trace-detail"/);
  const longCommand = "/bin/zsh -lc \"" + "sed -n '45,121p' search_ontology.py; ".repeat(4) + "\"";
  const collapsedExec = context.renderTraceContent({ id: "exec-long", role: "trace", content: "exec " + longCommand });
  assert.match(collapsedExec, /trace-collapsible/);
  assert.match(collapsedExec, /trace-title/);
  assert.doesNotMatch(collapsedExec, /class="trace-detail"/);
  assert.match(collapsedExec, /sed -n '45,121p'/);
  assert.doesNotMatch(context.renderTraceContent({ id: "exec-short", role: "trace", content: "exec ls" }), /trace-collapsible/);
  assert.doesNotMatch(
    context.renderMessageContent({ role: "trace", content: "exec ls", createdAt: 1 }, 0),
    /trace-time/,
  );
  assert.doesNotMatch(
    context.renderMessageContent({ role: "assistant", content: "Tool result: shell\nok", createdAt: 1 }, 0),
    /trace-time/,
  );
  assert.match(
    context.renderMessageContent({ role: "trace", kind: "thinking", content: "thinking: note", createdAt: 1 }, 0),
    /trace-time/,
  );
  const collapsedClaudeResult = context.renderTraceContent({
    id: "claude-result",
    role: "trace",
    content: "工具结果: Edit\n" + "changed line\n".repeat(8),
  });
  assert.match(collapsedClaudeResult, /trace-collapsible/);
  const collapsedOpenCode = context.renderTraceContent({
    id: "opencode-tool",
    role: "trace",
    content: "tool bash\n" + "npm test output\n".repeat(6),
  });
  assert.match(collapsedOpenCode, /trace-collapsible/);
  const cliTraces = {
    codex: "exec /bin/zsh -lc \"apply_patch <<'PATCH'\"\n" + "updated file\n".repeat(8),
    claude: "工具结果: Edit\n" + "changed line\n".repeat(8),
    opencode: "tool bash\n" + "npm test output\n".repeat(8),
    grok: "tool: exec_command\ncommand: npm run build\n" + "build output\n".repeat(8),
    dsh: "exec rg -n taskList src\n" + "search output\n".repeat(8),
    "kimi-code": "exec node example.js\n" + "node output\n".repeat(8),
    zcode: "exec /bin/zsh -lc \"apply_patch <<'PATCH'\"\n" + "patch output\n".repeat(8),
  };
  for (const [cli, content] of Object.entries(cliTraces)) {
    const html = context.renderTraceContent({ id: `${cli}-no-subtitle`, role: "trace", content });
    assert.doesNotMatch(html, /class="trace-detail"/, cli);
    assert.match(html, /class="trace-title"/, cli);
    assert.match(html, /trace-collapsible/, cli);
    assert.match(html, /trace-content/, cli);
  }
  assert.equal(context.classifyCommandPurposeTag("git status").type, "git-read");
  assert.equal(context.unwrapShellCommand("bash -lc \"npm test\""), "npm test");
  assert.equal(context.getTracePresentation("unknown").type, "");
  const untitledTraceCases = [
    {
      content: 'mcp codegraph :: codegraph_explore\nparams: {\n  "query": "allocateVersion"\n}',
      title: "mcp codegraph :: cod",
    },
    { content: "短日志", title: "短日志" },
    { content: "12345678901234567890", title: "12345678901234567890" },
    { content: "12345678901234567890x", title: "12345678901234567890" },
    { content: " \r\n  first\tsecond \n third  ", title: "first second third" },
    { content: "一二三四五六七八九十".repeat(3), title: "一二三四五六七八九十".repeat(2) },
    { content: "😀".repeat(19) + "📋extra", title: "😀".repeat(19) + "📋" },
    { content: "<标题>&内容", title: "&lt;标题&gt;&amp;内容" },
  ];
  for (const { content, title } of untitledTraceCases) {
    const html = context.renderTraceContent({ role: "trace", content });
    assert.ok(html.includes('<span class="trace-title">' + title + "</span>"), content);
  }
  const untitledMcpTrace = context.renderTraceContent({ role: "trace", content: untitledTraceCases[0].content });
  assert.match(untitledMcpTrace, /codegraph_explore/);
  assert.match(untitledMcpTrace, /allocateVersion/);
  assert.match(untitledMcpTrace, /trace-collapsible/);
  assert.match(collapsedExec, /<span class="trace-title">Exec<\/span>/);
  assert.doesNotMatch(context.renderTraceContent({ role: "trace", content: "" }), /trace-header/);
  assert.doesNotMatch(context.renderTraceContent({ role: "trace", content: " \r\n\t" }), /trace-header/);
  assert.doesNotMatch(context.renderMessageContent({ role: "assistant", content: "普通助手回复" }, 0), /trace-header/);
  const fallback = context.safelyRenderMessageContent({ role: "assistant", content: "broken" }, 0);
  assert.doesNotMatch(fallback, /render-message-failed/);
  assert.deepEqual(failures, []);
});

test("applies model, panel, and selector state without preserving invalid snapshots", () => {
  const runtimeScript = buildWebviewRuntimeScript({
    i18n: WEBVIEW_STRINGS,
    cliList: ["codex", "claude", "opencode"],
    loopMaxRoundsDefault: 5,
    loopMaxRoundsMin: 1,
    loopMaxRoundsMax: 12,
    loopSubtaskMaxThinkingModeDefault: "high",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
    finalAnswerTextMarker: "<FINAL>",
  });
  const functionSource = [
    "normalizeLoopExecutionMode",
    "normalizeLoopExecutionModeByCli",
    "normalizeLoopSubtaskMaxThinkingMode",
    "normalizeLoopMaxRounds",
    "normalizeModelNameList",
    "normalizeModelSelection",
    "normalizeLoopRoleModelsPayload",
    "normalizeLoopRoleSelectionPayload",
    "normalizeThinkingModeSelection",
    "normalizeLoopRoleThinkingPayload",
    "normalizeOpenCodeThinkingPayload",
    "normalizeOpenCodeModelsPayload",
    "shouldPreserveCurrentCliModelsOnEmptySnapshot",
    "applyModelState",
    "getNewlyCompletedLoopTabIds",
    "getOpenCodeModelIssueMessage",
    "getOpenCodeModelOptionLabel",
  ].map((name) => extractFunctionSource(runtimeScript, name)).join("\n");
  const state = {
    currentCli: "codex",
    selectedConfigId: "draft",
    configState: { activeConfigId: "active" },
    modelsByCli: { codex: ["old"], claude: [], opencode: [] },
    managedModelsByCli: { codex: ["old"], claude: [], opencode: [] },
    selectedModelsByCli: { codex: "old", claude: "", opencode: "" },
    selectedModel: "",
  };
  const helpers = new Function(
    "state",
    "CLI_NAMES",
    "t",
    "LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT",
    "LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT",
    "LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT",
    `${functionSource}; return {
      normalizeLoopExecutionMode,
      normalizeLoopExecutionModeByCli,
      normalizeLoopSubtaskMaxThinkingMode,
      normalizeLoopMaxRounds,
      normalizeModelNameList,
      normalizeOpenCodeThinkingPayload,
      normalizeOpenCodeModelsPayload,
      applyModelState,
      getNewlyCompletedLoopTabIds,
      getOpenCodeModelIssueMessage,
      getOpenCodeModelOptionLabel,
    };`,
  )(
    state,
    ["codex", "claude", "opencode"],
    (key: string) => key,
    "main_sub_multi_agent",
    "debate_multi_agent",
    "high",
  );

  assert.equal(helpers.normalizeLoopExecutionMode("debate_multi_agent"), "debate_multi_agent");
  assert.equal(helpers.normalizeLoopExecutionMode("bad"), "main_sub_multi_agent");
  assert.deepEqual(helpers.normalizeLoopExecutionModeByCli({ codex: "bad", claude: "debate_multi_agent" }, null), {
    codex: "main_sub_multi_agent",
    claude: "debate_multi_agent",
    opencode: "main_sub_multi_agent",
  });
  assert.equal(helpers.normalizeLoopSubtaskMaxThinkingMode("bad"), "high");
  assert.equal(helpers.normalizeLoopMaxRounds("99"), 12);
  assert.deepEqual(helpers.normalizeModelNameList([" GPT ", "gpt", "", 42]), ["GPT"]);
  assert.deepEqual(helpers.normalizeOpenCodeThinkingPayload({
    selectedVariant: " high ",
    configuredDefaultVariant: "missing",
    options: [{ value: "high", label: "High", source: "config" }, { value: "high" }],
    disabled: true,
  }), {
    selectedVariant: "high",
    configuredDefaultVariant: null,
    options: [{ value: "high", label: "High", source: "config" }],
    disabled: true,
    messageKey: "",
  });
  assert.deepEqual(helpers.normalizeOpenCodeModelsPayload({
    models: [{ ref: "p/model", label: "Provider (p/model)", providerId: "p", modelId: "model" }, { ref: "p/model" }],
    issues: [{ code: "missing-role-model", role: "small" }, { code: "" }],
  }).issues, [{ role: "subtask", code: "missing-role-model", messageKey: undefined }]);
  helpers.applyModelState({ optionsByCli: { codex: [] }, managedByCli: { codex: [] }, selectedByCli: {} }, "codex");
  assert.deepEqual(state.modelsByCli.codex, ["old"]);
  helpers.applyModelState({ optionsByCli: { codex: ["new"] }, managedByCli: { codex: ["new"] }, selectedByCli: { codex: "new" } }, "codex");
  assert.equal(state.selectedModel, "new");
  assert.deepEqual(helpers.getNewlyCompletedLoopTabIds(
    { tabs: [{ id: "done", loopTaskRunning: true, loopTaskStatus: "running" }] },
    { tabs: [{ id: "done", loopTaskRunning: false, loopTaskStatus: "completed" }] },
  ), ["done"]);
  assert.equal(helpers.getOpenCodeModelIssueMessage({ code: "provider-disabled" }), "openCodeModelIssueProviderDisabled");
  assert.equal(helpers.getOpenCodeModelOptionLabel({ ref: "provider/model", label: "Provider (provider/model)", modelId: "model" }), "Provider");
});

test("parses Explorer file and directory drops without treating ordinary text as references", () => {
  const getDropUris = new Function(`${extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "getDropUris")}; return getDropUris;`)();
  const parseDrop = (data: Record<string, string>) => getDropUris({
    dataTransfer: { getData: (type: string) => data[type] || "" },
  });

  assert.deepEqual(parseDrop({
    ResourceURLs: JSON.stringify(["file:///workspace/src/app.ts"]),
    CodeFiles: JSON.stringify(["/workspace/src/app.ts", "/workspace/src"]),
    "text/plain": "/workspace/src/app.ts\n/workspace/src",
  }), ["file:///workspace/src/app.ts", "file:///workspace/src"]);
  assert.deepEqual(parseDrop({ CodeFiles: JSON.stringify(["C:\\workspace\\my folder", "\\\\server\\share\\项目"]) }), [
    "file:///C:/workspace/my%20folder",
    "file://server/share/%E9%A1%B9%E7%9B%AE",
  ]);
  assert.deepEqual(parseDrop({ "text/plain": "/workspace/a #1?.ts\r\n/workspace/目录" }), [
    "file:///workspace/a%20%231%3F.ts",
    "file:///workspace/%E7%9B%AE%E5%BD%95",
  ]);
  assert.deepEqual(parseDrop({
    ResourceURLs: "invalid JSON",
    CodeFiles: JSON.stringify({ invalid: true }),
    "application/vnd.code.uri-list": "#comment\nfile:///workspace/src\nvscode-remote://ssh-remote+host/workspace/src",
  }), ["file:///workspace/src", "vscode-remote://ssh-remote+host/workspace/src"]);
  assert.deepEqual(parseDrop({ ResourceURLs: JSON.stringify([null, 1, {}, "", "relative.txt"]) }), []);
  assert.deepEqual(parseDrop({ "text/plain": "ordinary text\nhttps://example.com" }), []);
  assert.deepEqual(getDropUris({}), []);
  assert.deepEqual(getDropUris({ dataTransfer: { getData: () => { throw new Error("unavailable"); } } }), []);
});

test("Explorer drops resolve workspace references and insert them at the prompt selection", () => {
  const { document, window, posted } = createRuntimeHarness();
  const input = document.getElementById("promptInput");
  input.value = "请查看旧引用再修改";
  input.selectionStart = 3;
  input.selectionEnd = 6;
  let prevented = false;
  input.dispatchEvent({
    type: "drop",
    preventDefault: () => { prevented = true; },
    stopPropagation: () => undefined,
    dataTransfer: {
      getData: (type: string) => type === "CodeFiles"
        ? JSON.stringify(["/workspace/src", "/workspace/my folder/app.ts"])
        : "",
      files: [{ name: "app.ts", size: 3 }],
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(posted.at(-1), {
    type: "resolveDropPaths",
    uris: ["file:///workspace/src", "file:///workspace/my%20folder/app.ts"],
  });
  window.dispatchMessage({ type: "dropPathsResult", paths: ["src", "my folder/app.ts"] });
  assert.equal(input.value, '请查看@src @"my folder/app.ts" 再修改');
  assert.equal(input.selectionStart, input.value.indexOf("再修改"));
  assert.equal(input.selectionEnd, input.selectionStart);
});

test("Explorer context references insert files and directories at the prompt selection", () => {
  const { document, window } = createRuntimeHarness();
  const input = document.getElementById("promptInput");
  input.value = "请查看旧引用再修改";
  input.selectionStart = 3;
  input.selectionEnd = 6;
  window.dispatchMessage({ type: "insertPromptPaths", paths: ["src/app.ts", "my folder/项目", "."] });
  assert.equal(input.value, '请查看@src/app.ts @"my folder/项目" @. 再修改');
  assert.equal(input.selectionStart, input.value.indexOf("再修改"));
  assert.equal(input.selectionEnd, input.selectionStart);
});

test("Explorer context references append to multiline prompts without changing other content", () => {
  const { document, window } = createRuntimeHarness();
  const input = document.getElementById("promptInput");
  input.value = "保留第一行\n请检查 ";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  window.dispatchMessage({ type: "insertPromptPaths", paths: ["src"] });
  assert.equal(input.value, "保留第一行\n请检查 @src ");
  assert.equal(input.selectionStart, input.value.length);
  assert.equal(input.selectionEnd, input.value.length);
});

test("empty Explorer context reference messages do not overwrite selected text", () => {
  const { document, window } = createRuntimeHarness();
  const input = document.getElementById("promptInput");
  input.value = "保留提示词";
  input.selectionStart = 0;
  input.selectionEnd = input.value.length;
  window.dispatchMessage({ type: "insertPromptPaths", paths: [] });
  window.dispatchMessage({ type: "insertPromptPaths" });
  assert.equal(input.value, "保留提示词");
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, input.value.length);
});

test("prompt drops keep attachment uploads and ordinary text fallback", async () => {
  class DropFileReader {
    result = "data:text/plain;base64,aGVsbG8=";
    onload?: () => void;
    readAsDataURL(): void {
      this.onload?.();
    }
  }
  const { document, posted } = createRuntimeHarness(undefined, DropFileReader);
  const input = document.getElementById("promptInput");
  input.value = "原有提示词";
  let prevented = false;
  const dispatchDrop = (data: Record<string, string>, files: unknown[]) => input.dispatchEvent({
    type: "drop",
    preventDefault: () => { prevented = true; },
    dataTransfer: { getData: (type: string) => data[type] || "", files },
  });

  dispatchDrop({ "text/plain": "普通文本" }, []);
  assert.equal(prevented, false);
  assert.equal(input.value, "原有提示词");
  assert.equal(posted.some((message) => message.type === "resolveDropPaths"), false);
  dispatchDrop({ CodeFiles: "invalid JSON" }, [{ name: "hello.txt", type: "text/plain", size: 5 }]);
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.deepEqual(posted.at(-1), {
    type: "uploadFiles",
    files: [{ name: "hello.txt", type: "text/plain", dataUrl: "data:text/plain;base64,aGVsbG8=" }],
  });
});

test("handles run stream, queue, attachments, history, and settings function branches in isolation", async () => {
  const streamQueueSource = [
    "normalizeRunStreamSource",
    "normalizeRunStreamRecordContent",
    "getRunStreamContentByteLength",
    "trimRunStreamContentToMaxBytes",
    "normalizeRunStreamRecordForStorage",
    "buildRunStreamPreview",
    "tryFormatRunStreamJsonContent",
    "formatRunStreamExpandedContent",
    "buildRunStreamExportPayload",
    "normalizeQueueEditingState",
    "saveQueuedPromptEdit",
    "moveQueuedPrompt",
    "clearQueuedPromptIndex",
    "buildInsertText",
    "readFileAsDataUrl",
    "formatUploadLimitBytes",
    "validateUploadFiles",
    "getClipboardFiles",
    "getDropUris",
  ].map((name) => extractFunctionSource(`${VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE}\n${VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME}`, name)).join("\n");
  const runtimeState: any = {
    pendingPromptQueue: [{ prompt: "first" }, { prompt: "second" }],
    queueEditingIndex: 0,
    queueEditingDraft: "updated",
    runStreamRecords: [{ id: "1", content: "{\"ok\":true}", source: "stdout", createdAt: 1 }],
  };
  const toasts: string[] = [];
  const helpers = new Function(
    "RUN_STREAM_PREVIEW_MAX_LENGTH",
    "RUN_STREAM_MAX_RECORD_BYTES",
    "UPLOAD_MAX_FILES",
    "UPLOAD_MAX_FILE_BYTES",
    "t",
    "normalizePromptPayload",
    "getActiveConversationRuntimeState",
    "renderQueueOverlay",
    "updateQueueIndicator",
    "showToast",
    "FileReader",
    `${streamQueueSource}; return {
      normalizeRunStreamSource,
      normalizeRunStreamRecordContent,
      normalizeRunStreamRecordForStorage,
      buildRunStreamPreview,
      tryFormatRunStreamJsonContent,
      formatRunStreamExpandedContent,
      buildRunStreamExportPayload,
      normalizeQueueEditingState,
      saveQueuedPromptEdit,
      moveQueuedPrompt,
      clearQueuedPromptIndex,
      buildInsertText,
      readFileAsDataUrl,
      formatUploadLimitBytes,
      validateUploadFiles,
      getClipboardFiles,
      getDropUris,
    };`,
  )(
    20,
    256 * 1024,
    10,
    20 * 1024 * 1024,
    (key: string) => key,
    (payload: any) => payload && payload.prompt ? payload : null,
    () => runtimeState,
    () => undefined,
    () => undefined,
    (message: string) => toasts.push(message),
    class {
      result: string | null = null;
      onload: Listener | null = null;
      onerror: Listener | null = null;
      readAsDataURL(file: { name: string }): void {
        if (file.name === "bad") {
          this.onerror?.();
          return;
        }
        this.result = `data:${file.name}`;
        this.onload?.();
      }
    },
  );

  assert.equal(helpers.normalizeRunStreamSource("stderr"), "stderr");
  assert.equal(helpers.normalizeRunStreamSource("other"), "stdout");
  assert.equal(helpers.normalizeRunStreamRecordContent(42), "42");
  assert.equal(helpers.buildRunStreamPreview(""), "runStreamRecordEmpty");
  assert.match(helpers.buildRunStreamPreview("line1\nline2".repeat(5)), /\.\.\.$/);
  assert.equal(helpers.tryFormatRunStreamJsonContent("{\"ok\":true}"), "{\n  \"ok\": true\n}");
  assert.equal(helpers.tryFormatRunStreamJsonContent("plain"), null);
  assert.equal(helpers.formatRunStreamExpandedContent(""), "runStreamRecordEmpty");
  assert.deepEqual(helpers.buildRunStreamExportPayload(runtimeState), runtimeState.runStreamRecords);
  runtimeState.runStreamDiscardedRecordCount = 1;
  runtimeState.runStreamDiscardedBytes = 20;
  runtimeState.runStreamRetainedBytes = 10;
  assert.equal(JSON.parse(helpers.buildRunStreamExportPayload(runtimeState)[0].content).discardedBytes, 20);
  runtimeState.runStreamDiscardedRecordCount = 0;
  runtimeState.runStreamDiscardedBytes = 0;
  const trimmedRecord = helpers.normalizeRunStreamRecordForStorage("x".repeat(300 * 1024));
  assert.equal(trimmedRecord.truncated, true);
  assert.ok(new TextEncoder().encode(trimmedRecord.content).length <= 256 * 1024);
  helpers.saveQueuedPromptEdit();
  assert.equal(runtimeState.pendingPromptQueue[0].prompt, "updated");
  assert.equal(toasts.at(-1), "toastQueueUpdated");
  helpers.moveQueuedPrompt(0, 1);
  assert.deepEqual(runtimeState.pendingPromptQueue.map((item: any) => item.prompt), ["second", "updated"]);
  helpers.clearQueuedPromptIndex(1);
  assert.deepEqual(runtimeState.pendingPromptQueue.map((item: any) => item.prompt), ["second"]);
  runtimeState.queueEditingIndex = 4;
  helpers.normalizeQueueEditingState(runtimeState);
  assert.equal(runtimeState.queueEditingIndex, -1);
  assert.equal(helpers.buildInsertText(["a", "b"], "#"), "#a #b ");
  assert.equal(helpers.formatUploadLimitBytes(20 * 1024 * 1024), "20 MB");
  assert.equal(helpers.validateUploadFiles(Array.from({ length: 11 }, () => ({ size: 1 }))), "toastUploadTooManyFiles");
  assert.equal(helpers.validateUploadFiles([{ name: "big.bin", size: 21 * 1024 * 1024 }]), "toastUploadFileTooLarge");
  assert.equal(helpers.validateUploadFiles([{ size: 19 * 1024 * 1024 }, { size: 19 * 1024 * 1024 }]), "");
  assert.equal(await helpers.readFileAsDataUrl({ name: "ok" }), "data:ok");
  await assert.rejects(() => helpers.readFileAsDataUrl({ name: "bad" }));
  assert.deepEqual(helpers.getClipboardFiles({
    clipboardData: { items: [{ kind: "file", getAsFile: () => ({ name: "a" }) }, { kind: "string", getAsFile: () => null }] },
  }), [{ name: "a" }]);
  assert.deepEqual(helpers.getDropUris({
    dataTransfer: {
      getData: (type: string) => type === "text/uri-list" ? "#comment\nfile:///a\n" : "file:///b",
    },
  }), ["file:///a", "file:///b"]);

  const historySource = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isHiddenLoopPlusProtocolPrompt"),
    ...[
      "buildHistorySessionKey",
      "normalizeHistorySessionMessages",
      "resolveHistoryMessageRoleLabel",
      "resolveHistoryMessageKindLabel",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_HISTORY_PANELS, name)),
  ].join("\n");
  const historyHelpers = new Function(
    "normalizeMessageOrder",
    "t",
    `${historySource}; return {
      buildHistorySessionKey,
      normalizeHistorySessionMessages,
      resolveHistoryMessageRoleLabel,
      resolveHistoryMessageKindLabel,
    };`,
  )(
    (messages: any[]) => messages.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
    (key: string) => key,
  );
  assert.equal(historyHelpers.buildHistorySessionKey("codex", "s1"), "codex:s1");
  assert.deepEqual(historyHelpers.normalizeHistorySessionMessages([
    { content: "two", sequence: 2 },
    { content: "one", sequence: 1 },
    { content: " " },
    { content: "You are one independent Loop+ execution attempt.\nhidden", sequence: 3 },
  ]).map((item: any) => item.content), ["one", "two"]);
  assert.equal(historyHelpers.resolveHistoryMessageRoleLabel("trace"), "historySessionMessageTrace");
  assert.equal(historyHelpers.resolveHistoryMessageKindLabel("tool-use"), "historySessionMessageToolUse");

  const settingsSource = [
    "getActiveLoopMainTaskId",
    "enabledRuleCliNames",
    "collectRuleTargets",
    "buildPromptPreview",
  ].map((name) => extractFunctionSource(`${VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS}\n${VIEW_CONTENT_SCRIPT_HISTORY_PANELS}`, name)).join("\n");
  const settingsState = {
    conversationTabs: { activeTabId: "tab-1", tabs: [{ id: "tab-1", loopTaskRole: "main", loopTaskId: " task-1 " }] },
  };
  const settingsElements = {
    rulesSaveCodex: { checked: true },
    rulesSaveClaude: { checked: false },
    rulesSaveOpenCode: { checked: true },
    rulesSaveGrok: { checked: false },
  };
  const settingsHelpers = new Function(
    "state",
    "elements",
    "t",
    "CLI_NAMES",
    `${settingsSource}; return { getActiveLoopMainTaskId, collectRuleTargets, buildPromptPreview };`,
  )(settingsState, settingsElements, (key: string) => key, ["codex", "claude", "opencode", "grok"]);
  assert.equal(settingsHelpers.getActiveLoopMainTaskId(), "task-1");
  assert.deepEqual(settingsHelpers.collectRuleTargets(), ["codex", "opencode"]);
  assert.equal(settingsHelpers.buildPromptPreview("  a\n b  "), "a b");
  assert.equal(settingsHelpers.buildPromptPreview(" "), "promptEmptyLabel");
});

test("routes window message handler branches without a real webview", () => {
  const handlerSource = extractWindowMessageHandlerSource();
  const calls: string[] = [];
  const messages = [{ id: "m-1", role: "user", content: "hello" }];
  const handler = new Function(
    "applyState",
    "applyEditorContext",
    "getActiveConversationTabId",
    "normalizeMessageOrder",
    "setMessagesForTab",
    "shouldHandleTabScopedEvent",
    "traceCollapsibleOpenKeys",
    "syncConversationControlsForActiveTab",
    "renderMessages",
    "updateLoopMetaForTabFromMessage",
    "updateGraphMetaForTabFromMessage",
    "updateGraphMetaForTabFromRunStatus",
    "renderConversationTabs",
    "getConversationRuntimeState",
    "isHiddenRetryQueuedMessage",
    "setTabErrored",
    "syncTabErrorFromMessage",
    "isHiddenRetryStartedMessage",
    "isRunStatusSummaryText",
    "appendMessage",
    "appendAssistantDelta",
    "appendRunRawStream",
    "applyTraceSegment",
    "resetRunRawStream",
    "updateCurrentRunPrompt",
    "normalizeRunActivity",
    "resetTaskListForRunStart",
    "closeTaskListForRunCompletion",
    "buildQueuePausedStatusText",
    "runningTabStartedAtById",
    "getTabRunStartedAt",
    "updateRunningState",
    "assistantRedirects",
    "createMessageId",
    "isDuplicateSystemStatusMessage",
    "showToast",
    "flushPendingPromptQueue",
    "isTabRunning",
    "buildInsertText",
    "insertPromptText",
    "handleRunStreamExportResult",
    "handleHistorySessionMessages",
    "handleHistorySessionExportResult",
    "openConfigApplyErrorOverlay",
    "applyExternalTaskListUpdate",
    "setRulesHint",
    "elements",
    "t",
    "console",
    "reportWebviewFailure",
    "Date",
    `${handlerSource}; return handleWindowMessage;`,
  )(
    () => calls.push("state"),
    () => calls.push("editor"),
    () => "tab-1",
    (incoming: unknown[]) => incoming,
    () => calls.push("setMessages"),
    (data: any) => data.tabId !== "other",
    { clear: () => calls.push("traceClear") },
    () => calls.push("syncControls"),
    () => calls.push("render"),
    () => true,
    () => false,
    () => false,
    () => calls.push("tabs"),
    () => ({ pendingPromptQueue: [{ prompt: "queued" }], suppressQueueFlushOnce: false, lastRunStatusMessage: "", activeRunActivity: "" }),
    (content: string) => /retry/.test(content),
    () => calls.push("errored"),
    (_tabId: string, message: any) => calls.push(message?.role === "trace" && String(message?.content || "").startsWith("error") ? "errorMessage" : "syncMessage"),
    () => false,
    (content: string) => /Task completed|Run stopped/.test(content),
    () => calls.push("append"),
    () => calls.push("delta"),
    () => calls.push("stream"),
    () => calls.push("trace"),
    () => calls.push("resetStream"),
    () => calls.push("prompt"),
    (activity: string) => activity,
    () => calls.push("resetTask"),
    () => calls.push("closeTask"),
    () => "paused",
    {},
    () => 123,
    () => calls.push("running"),
    { old: "id" },
    () => false,
    () => "web-id",
    () => calls.push("toast"),
    () => {
      calls.push("flush");
      return true;
    },
    () => false,
    () => "@file ",
    () => calls.push("insert"),
    () => calls.push("streamExport"),
    () => calls.push("historyMessages"),
    () => calls.push("historyExport"),
    () => calls.push("configError"),
    () => calls.push("taskList"),
    () => calls.push("rulesHint"),
    { rulesInput: { value: "" } },
    (key: string) => key,
    console,
    () => calls.push("error"),
    Date,
  ) as (event: { data: Record<string, any> }) => void;

  [
    { type: "state", payload: {} },
    { type: "editorContext", payload: {} },
    { type: "setMessages", messages },
    { type: "appendMessage", message: { role: "system", content: "Task completed" } },
    { type: "appendMessage", tabId: "other", message: { role: "system", content: "retry soon" } },
    { type: "assistantDelta", content: "answer" },
    { type: "rawStreamDelta", content: "raw", tabId: "tab-1" },
    { type: "traceSegment" },
    { type: "appendMessage", tabId: "tab-1", message: { role: "trace", content: "error\nfailed" } },
    { type: "runStatus", status: "start", startedAt: 99, prompt: "run", activity: "contextCompaction" },
    { type: "runStatus", status: "end", message: "Task completed" },
    { type: "removeMessage", id: "m-1" },
    { type: "uploadResult", paths: ["/a"] },
    { type: "dropPathsResult", paths: ["/b"], error: "drop failed" },
    { type: "pickWorkspacePathResult", canceled: true },
    { type: "runStreamExportResult" },
    { type: "historySessionMessages" },
    { type: "historySessionExportResult" },
    { type: "configApplyError", error: "bad" },
    { type: "taskListUpdate", items: [] },
    { type: "rulesContent", content: "rules", scope: "project", cli: "codex" },
    { type: "rulesSaved", scope: "global", targets: ["codex"] },
  ].forEach((data) => handler({ data }));

  assert.ok(calls.includes("state"));
  assert.ok(calls.includes("editor"));
  assert.ok(calls.includes("setMessages"));
  assert.ok(calls.includes("append"));
  assert.ok(calls.includes("delta"));
  assert.ok(calls.includes("stream"));
  assert.ok(calls.includes("trace"));
  assert.ok(calls.includes("syncMessage"));
  assert.ok(calls.includes("resetStream"));
  assert.ok(calls.includes("flush"));
  assert.ok(calls.includes("insert"));
  assert.ok(calls.includes("streamExport"));
  assert.ok(calls.includes("historyMessages"));
  assert.ok(calls.includes("historyExport"));
  assert.ok(calls.includes("configError"));
  assert.ok(calls.includes("taskList"));
  assert.ok(calls.includes("rulesHint"));

  handler({ data: { type: "state", payload: { fail: true } } });
  assert.ok(!calls.includes("unreachable"));
});

test("thinking deltas continue the original bubble after a tool trace is inserted", () => {
  const { api } = createRuntimeHarness();
  api.state.messages.push({ id: "think-1", role: "assistant", kind: "thinking", content: "partial thought" });
  api.state.messages.push({ id: "trace-1", role: "trace", content: "exec ls" });

  api.appendAssistantDelta("think-1", " continues", "thinking");

  assert.equal(api.state.messages.length, 2);
  assert.equal(api.state.messages[0].id, "think-1");
  assert.equal(api.state.messages[0].content, "partial thought continues");
  assert.equal(api.state.messages[1].role, "trace");

  api.appendAssistantDelta("think-2", "next thought", "thinking");
  assert.equal(api.state.messages.length, 3);
  assert.equal(api.state.messages[2].kind, "thinking");
  assert.equal(api.state.messages[2].content, "next thought");
  assert.equal(api.state.messages[0].content, "partial thought continues");
});

test("thinking viewports exclude final answers, ordinary replies, users, and tool results", () => {
  const { api, document } = createRuntimeHarness();
  api.state.onlyShowFinalResults = false;
  api.state.messages.push(
    { id: "thinking", role: "assistant", kind: "thinking", content: "reasoning" },
    { id: "legacy-thinking", role: "assistant", content: "**Thinking** through the implementation" },
    { id: "trace-thinking", role: "trace", kind: "thinking", content: "thinking\nreasoning" },
    { id: "user", role: "user", content: "thinking about a change" },
    { id: "ordinary", role: "assistant", content: "An ordinary reply" },
    { id: "narration", role: "assistant", content: "我先看目录再执行。" },
    { id: "tool", role: "trace", content: "exec ls" },
    { id: "final", role: "assistant", codexFinalAnswer: true, content: "**Thinking** is complete" },
  );
  api.renderMessages();

  const thinkingMessages = document.getElementById("messages").querySelectorAll(".message")
    .filter((message: FakeElement) => message.querySelector(".thinking-bubble-viewport"))
    .map((message: FakeElement) => message.dataset.messageId);
  assert.deepEqual(thinkingMessages, ["thinking", "legacy-thinking", "trace-thinking", "narration"]);
});

test("thinking streams scroll internally and expose an accessible SVG expand/collapse button", () => {
  const { api, document, window } = createRuntimeHarness();
  api.state.onlyShowFinalResults = false;
  const append = (content: string) => window.dispatchMessage({
    type: "assistantDelta", id: "scrolling-thinking", content, kind: "thinking",
  });
  append("first thought");
  const viewport = document.getElementById("messages").querySelector(".thinking-bubble-viewport");
  assert.ok(viewport);
  const container = viewport.parentElement;
  const button = container.querySelector(".thinking-bubble-toggle");
  const collapseButton = container.querySelector(".thinking-bubble-collapse");
  assert.equal(button.hidden, true);
  assert.equal(collapseButton.hidden, true);
  viewport.scrollHeight = 224;
  viewport.clientHeight = 112;
  viewport.scrollTop = 0;

  append("\nlatest thought");
  assert.equal(document.getElementById("messages").querySelector(".thinking-bubble-viewport"), viewport);
  assert.equal(viewport.scrollTop, 224);
  assert.equal(button.hidden, false);
  assert.equal(collapseButton.hidden, true);
  assert.match(button.innerHTML, /<svg[^>]*aria-hidden="true"/);
  assert.equal(button.getAttribute("aria-controls"), viewport.id);
  assert.equal(button.getAttribute("aria-label"), WEBVIEW_STRINGS.thinkingBubbleExpand);
  assert.equal(button.getAttribute("aria-expanded"), "false");

  button.click();
  assert.equal(container.classList.contains("is-expanded"), true);
  assert.equal(button.getAttribute("aria-label"), WEBVIEW_STRINGS.thinkingBubbleCollapse);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(collapseButton.hidden, false);
  assert.equal(collapseButton.getAttribute("aria-label"), WEBVIEW_STRINGS.thinkingBubbleCollapse);
  assert.equal(collapseButton.getAttribute("aria-controls"), viewport.id);
  assert.match(collapseButton.innerHTML, /<path d="m6 14 6-6 6 6"/);
  viewport.scrollTop = 12;
  append("\nmore thought");
  assert.equal(container.classList.contains("is-expanded"), true);
  assert.equal(collapseButton.hidden, false);
  assert.equal(viewport.scrollTop, 12);

  collapseButton.click();
  assert.equal(container.classList.contains("is-expanded"), false);
  assert.equal(collapseButton.hidden, true);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(viewport.scrollTop, 224);

  button.click();
  button.click();
  assert.equal(container.classList.contains("is-expanded"), false);
  assert.equal(collapseButton.hidden, true);
});

test("thinking expansion and manual scroll survive rerenders and Markdown formatting", () => {
  const { api, document, window } = createRuntimeHarness();
  api.state.onlyShowFinalResults = false;
  api.state.messages.push({ id: "retained-thinking", role: "assistant", kind: "thinking", content: "**reasoning**" });
  api.renderMessages();
  const getViewport = () => document.getElementById("messages").querySelector(".thinking-bubble-viewport");
  let viewport = getViewport();
  viewport.scrollHeight = 224;
  viewport.scrollTop = 32;
  api.renderMessages();
  viewport = getViewport();
  assert.equal(viewport.scrollTop, 32);
  viewport.parentElement.querySelector(".thinking-bubble-toggle").click();
  api.renderMessages();
  assert.equal(getViewport().parentElement.classList.contains("is-expanded"), true);

  window.dispatchMessage({ type: "assistantDelta", id: "retained-thinking", content: "\nupdated", kind: "thinking" });
  assert.equal(getViewport().parentElement.classList.contains("is-expanded"), true);
  const idleTimerId = Array.from(window.timers.keys()).find((timerId) => window.timerDelays.get(timerId) === 3000);
  assert.ok(idleTimerId);
  window.timers.get(idleTimerId)?.();
  assert.equal(getViewport().parentElement.classList.contains("is-expanded"), true);
  assert.equal(getViewport().querySelector(".assistant-message-content-streaming"), null);
});

test("thinking overflow control stays hidden through five lines and appears beyond them", () => {
  const { api, document, window } = createRuntimeHarness();
  api.state.onlyShowFinalResults = false;
  const append = () => window.dispatchMessage({
    type: "assistantDelta", id: "boundary-thinking", content: "line\n", kind: "thinking",
  });
  append();
  const viewport = document.getElementById("messages").querySelector(".thinking-bubble-viewport");
  const button = viewport.parentElement.querySelector(".thinking-bubble-toggle");
  viewport.scrollHeight = 112;
  append();
  assert.equal(button.hidden, true);
  viewport.scrollHeight = 134;
  append();
  assert.equal(button.hidden, false);
  assert.equal(viewport.parentElement.querySelector(".thinking-bubble-collapse").hidden, true);
});

function createKimiPanelState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return createPanelState({
    currentCli: "kimi-code",
    interactiveMode: "coding",
    conversationTabs: {
      activeTabId: "tab-1",
      tabs: [
        { id: "tab-1", cli: "kimi-code" },
        { id: "tab-2", cli: "kimi-code" },
      ],
    },
    modelState: {
      optionsByCli: { "kimi-code": ["subcoco/kimi-k3.1-pro"] },
      managedByCli: { "kimi-code": [] },
      selectedByCli: { "kimi-code": "subcoco/kimi-k3.1-pro" },
      loopOptionsByCli: { "kimi-code": { main: [], subtask: [] } },
      selectedLoopByCli: { "kimi-code": { main: "", subtask: "" } },
      selectedLoopThinkingByCli: { "kimi-code": { main: "", subtask: "" } },
    },
    thinkingMode: "high",
    ...overrides,
  });
}

test("ZCode model dropdown displays modelId while keeping provider-qualified selection values", () => {
  const { api, document, window, posted } = createRuntimeHarness(undefined, undefined, ["codex", "zcode"]);
  const config = JSON.parse(createZcodeExampleText());
  config.config.providerConfigRules.providerRules[0].config.personalModelIds.push("vendor/second-model");
  const models = readZcodeConfigModels(JSON.stringify(config));
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      currentCli: "zcode",
      interactiveMode: "coding",
      conversationTabs: { activeTabId: "zcode-tab", tabs: [{ id: "zcode-tab", cli: "zcode" }] },
      sessionState: { currentSessionId: null, sessions: [] },
      modelState: {
        optionsByCli: { zcode: models.models },
        labelsByCli: { zcode: models.labels },
        managedByCli: { zcode: [] },
        selectedByCli: { zcode: models.defaultModel },
      },
    }),
  });
  const select = document.getElementById("modelSelect");
  assert.notEqual(select.style.display, "none");
  assert.equal(select.disabled, false);
  assert.deepEqual(childValueTextPairs(select).map(([value]) => value), models.models);
  assert.deepEqual(childValueTextPairs(select).filter(([value]) => value), [
    [`local-glm/${ZCODE_EXAMPLE_MODEL_ID}`, ZCODE_EXAMPLE_MODEL_ID],
    ["local-glm/vendor/second-model", "vendor/second-model"],
  ]);
  assert.equal(select.value, `local-glm/${ZCODE_EXAMPLE_MODEL_ID}`);
  select.value = "local-glm/vendor/second-model";
  select.dispatchEvent({ type: "change" });
  assert.equal(api.state.selectedModel, "local-glm/vendor/second-model");
  assert.equal(posted.filter((message) => message.type === "selectCliModel").slice(-1)[0]?.model, "local-glm/vendor/second-model");
  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
});

test("ZCode model selectors follow interaction modes and recover after CLI switches", () => {
  const { document, window, posted } = createRuntimeHarness(undefined, undefined, ["codex", "zcode"]);
  const models = readZcodeConfigModels(createZcodeExampleText());
  for (const interactiveMode of ["coding", "loop", "graph", "loop_plus"]) {
    const roleMode = interactiveMode !== "coding";
    window.dispatchMessage({
      type: "state",
      payload: createPanelState({
        currentCli: "zcode",
        interactiveMode,
        conversationTabs: { activeTabId: "zcode-tab", tabs: [{ id: "zcode-tab", cli: "zcode" }] },
        sessionState: { currentSessionId: null, sessions: [] },
        modelState: {
          optionsByCli: { zcode: models.models },
          labelsByCli: { zcode: models.labels },
          managedByCli: { zcode: models.models },
          selectedByCli: { zcode: models.defaultModel },
          loopOptionsByCli: { zcode: { main: models.models, subtask: models.models } },
          selectedLoopByCli: { zcode: { main: models.defaultModel, subtask: models.defaultModel } },
        },
      }),
    });
    assert.equal(document.getElementById("modelSelect").style.display, roleMode ? "none" : "");
    assert.equal(document.getElementById("modelSelect").disabled, roleMode);
    assert.equal(document.getElementById("codexLoopModelGroup").style.display, roleMode ? "" : "none");
    const mainSelect = document.getElementById("codexLoopMainModelSelect");
    assert.equal(mainSelect.disabled, !roleMode);
    assert.equal(mainSelect.getAttribute("aria-label"), "ZCode Loop/Graph 主模型选择");
    assert.deepEqual(childValueTextPairs(mainSelect), [[models.defaultModel, ZCODE_EXAMPLE_MODEL_ID]]);
    assert.equal(document.getElementById("codexLoopSubtaskModelSelect").disabled, !roleMode);
    window.dispatchMessage({
      type: "state",
      payload: createPanelState({
        currentCli: "codex",
        interactiveMode: "coding",
        conversationTabs: { activeTabId: "codex-tab", tabs: [{ id: "codex-tab", cli: "codex" }] },
        sessionState: { currentSessionId: null, sessions: [] },
      }),
    });
    assert.notEqual(document.getElementById("modelSelect").style.display, "none");
  }
  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
});

test("all CLI child routes initialize and refresh in loop, loop+ and graph without visiting target CLIs", () => {
  const activeConfigIdByCli = Object.fromEntries(CLI_LIST.map((cli) => [cli, `${cli}-profile`]));
  const optionsByCli = Object.fromEntries(CLI_LIST.map((cli) => [cli, cli === "claude" ? [] : [`synthetic-${cli}`]]));
  const selectedByCli = Object.fromEntries(CLI_LIST.map((cli) => [cli, optionsByCli[cli][0] ?? ""]));
  const loopOptionsByCli = Object.fromEntries(CLI_LIST.map((cli) => [cli, { main: optionsByCli[cli], subtask: optionsByCli[cli] }]));
  const selectedLoopByCli = Object.fromEntries(CLI_LIST.map((cli) => [cli, { main: selectedByCli[cli], subtask: selectedByCli[cli] }]));
  const openCodeModels = {
    models: [{ ref: "fixture/child", label: "子模型", providerId: "fixture", modelId: "child" }],
    selectedMainRef: "fixture/child", selectedSubtaskRef: "fixture/child", issues: [],
  };
  for (const mainCli of CLI_LIST) {
    for (const mode of ["loop", "loop_plus", "graph"]) {
      const { document, window, api, posted } = createRuntimeHarness(undefined, undefined, [...CLI_LIST]);
      for (const targetCli of CLI_LIST) {
        const payload = createPanelState({
          currentCli: mainCli,
          interactiveMode: mode,
          conversationTabs: { activeTabId: "fixture", tabs: [{ id: "fixture", cli: mainCli }] },
          configState: { activeConfigId: activeConfigIdByCli[mainCli], configs: [{ id: activeConfigIdByCli[mainCli], name: "当前配置" }] },
          modelState: {
            optionsByCli, managedByCli: optionsByCli, selectedByCli, loopOptionsByCli, selectedLoopByCli,
            activeConfigIdByCli,
            selectedLoopSubtaskCliByConfigId: { [activeConfigIdByCli[mainCli]]: targetCli },
          },
          openCodeModels,
          loopSubtaskOpenCodeModels: openCodeModels,
        });
        window.dispatchMessage({ type: "state", payload });
        const prefix = mainCli === "claude" ? "claudeLoop" : mainCli === "opencode" ? "openCodeLoop" : "codexLoop";
        const modelId = mainCli === "opencode" ? "openCodeSmallModelSelect" : `${prefix}SubtaskModelSelect`;
        const cliSelect = document.getElementById(`${prefix}SubtaskCliSelect`);
        assert.equal(cliSelect.disabled, false, `${mainCli}/${mode}/${targetCli}`);
        assert.equal(cliSelect.value, targetCli);
        assert.equal(api.state.loopSubtaskRoute.configPending, false);
        assert.equal(api.state.loopSubtaskRoute.unavailableReason, "");
        assert.equal(document.getElementById("loopSubtaskRouteIssue").style.display, "none");
        const select = document.getElementById(modelId);
        assert.equal(select.disabled, targetCli === "claude");
        if (targetCli !== "claude") {
          assert.equal(select.value, targetCli === "opencode" ? "fixture/child" : `synthetic-${targetCli}`);
          const updatedModel = targetCli === "opencode" ? "fixture/saved" : `saved-${targetCli}`;
          const updatedOpenCodeModels = {
            models: [{ ref: "fixture/saved", label: "已保存子模型", providerId: "fixture", modelId: "saved" }],
            selectedMainRef: "fixture/saved", selectedSubtaskRef: "fixture/saved", issues: [],
          };
          window.dispatchMessage({ type: "state", payload: {
            ...payload,
            modelState: {
              ...(payload.modelState as Record<string, unknown>),
              optionsByCli: { ...optionsByCli, [targetCli]: [updatedModel] },
              selectedByCli: { ...selectedByCli, [targetCli]: updatedModel },
              loopOptionsByCli: { ...loopOptionsByCli, [targetCli]: { main: [updatedModel], subtask: [updatedModel] } },
              selectedLoopByCli: { ...selectedLoopByCli, [targetCli]: { main: updatedModel, subtask: updatedModel } },
            },
            openCodeModels: updatedOpenCodeModels,
            loopSubtaskOpenCodeModels: updatedOpenCodeModels,
          } });
          assert.equal(select.value, updatedModel, `${mainCli}/${mode}/${targetCli} 保存刷新`);
          assert.equal(select.disabled, false);
        }
        assert.equal(api.state.currentCli, mainCli);
      }
      assert.deepEqual(posted.filter((message) => message.type === "webviewError" || message.type === "applyConfig"), []);
    }
  }
});

test("shared child routes distinguish loading, missing profiles and read failures in every role mode", () => {
  for (const mode of ["loop", "loop_plus", "graph"]) {
    const { document, window, api } = createRuntimeHarness(undefined, undefined, ["codex", "zcode"]);
    const payload = createPanelState({
      interactiveMode: mode,
      conversationTabs: { activeTabId: "fixture", tabs: [{ id: "fixture", cli: "codex" }] },
      modelState: {
        optionsByCli: { codex: ["main"], zcode: [] },
        selectedByCli: { codex: "main", zcode: "" },
        managedByCli: {},
        activeConfigIdByCli: { codex: "cfg-1", zcode: null },
        selectedLoopSubtaskCliByConfigId: { "cfg-1": "zcode" },
      },
    });
    window.dispatchMessage({ type: "state", payload });
    assert.equal(api.state.loopSubtaskRoute.configPending, true);
    assert.equal(document.getElementById("loopSubtaskRouteIssue").textContent, WEBVIEW_STRINGS.loopSubtaskRouteConfigSyncing);
    payload.configStateByCli = { zcode: { configs: [], activeConfigId: null } };
    window.dispatchMessage({ type: "state", payload });
    assert.equal(api.state.loopSubtaskRoute.configPending, false);
    assert.equal(document.getElementById("loopSubtaskRouteIssue").textContent, WEBVIEW_STRINGS.loopSubtaskRouteMissingConfig);
    assert.equal(document.getElementById("codexLoopSubtaskModelSelect").disabled, true);
    const modelState = payload.modelState as Record<string, unknown>;
    modelState.issuesByCli = { zcode: "目标 CLI 配置读取失败，不能派发子任务。" };
    window.dispatchMessage({ type: "state", payload });
    assert.match(document.getElementById("loopSubtaskRouteIssue").textContent, /配置读取失败/);
    assert.equal(api.state.loopSubtaskRoute.configPending, false);
    modelState.issuesByCli = {};
    modelState.activeConfigIdByCli = { codex: "cfg-1", zcode: "zcode-profile" };
    modelState.optionsByCli = { codex: ["main"], zcode: ["configured-model"] };
    modelState.selectedByCli = { codex: "main", zcode: "configured-model" };
    modelState.selectedLoopByCli = { zcode: { main: "configured-model", subtask: "configured-model" } };
    window.dispatchMessage({ type: "state", payload });
    assert.equal(document.getElementById("loopSubtaskRouteIssue").style.display, "none");
    assert.equal(document.getElementById("codexLoopSubtaskModelSelect").disabled, false);
    assert.equal(document.getElementById("codexLoopSubtaskModelSelect").value, "configured-model");
  }
});

test("ZCode empty configuration shows a disabled configuration hint without model management", () => {
  const { document, window, posted } = createRuntimeHarness(undefined, undefined, ["codex", "zcode"]);
  for (const interactiveMode of ["coding", "loop", "graph", "loop_plus"]) {
    window.dispatchMessage({
      type: "state",
      payload: createPanelState({
        currentCli: "zcode",
        interactiveMode,
        conversationTabs: { activeTabId: "zcode-tab", tabs: [{ id: "zcode-tab", cli: "zcode" }] },
        sessionState: { currentSessionId: null, sessions: [] },
        modelState: {
          optionsByCli: { zcode: [] },
          managedByCli: { zcode: [] },
          selectedByCli: { zcode: null },
        },
      }),
    });
    const select = document.getElementById(interactiveMode === "coding" ? "modelSelect" : "codexLoopMainModelSelect");
    assert.equal(select.disabled, false);
    assert.deepEqual(childValueTextPairs(select), [["", "请在 ZCode 配置文件 provider_config.json 中添加模型"]]);
    assert.equal(select.children[0].disabled, true);
    assert.equal(select.value, "");
  }
  assert.deepEqual(posted.filter((message) => message.type === "webviewError"), []);
});

test("ZCode preserves explicit UI reasoning and uses only the current session's advertised levels", () => {
  const { api, document, window } = createRuntimeHarness(undefined, undefined, ["codex", "zcode"]);
  const panel = createPanelState({
    currentCli: "zcode",
    interactiveMode: "coding",
    conversationTabs: { activeTabId: "tab-1", tabs: [{ id: "tab-1", cli: "zcode" }, { id: "tab-2", cli: "zcode" }] },
    modelState: {
      optionsByCli: { zcode: ["local-glm/glm-5.3-flash"] },
      managedByCli: { zcode: [] },
      selectedByCli: { zcode: "local-glm/glm-5.3-flash" },
    },
    thinkingMode: "max",
  });
  window.dispatchMessage({ type: "state", payload: panel });
  const select = document.getElementById("thinkingMode");
  assert.equal(select.value, "max");
  assert.equal(api.state.thinkingMode, "max");
  api.state.thinkingMode = "high";
  window.dispatchMessage({ type: "zcodeThinkingOptions", tabId: "tab-1", options: ["low", "high", "max", "ultra", "bogus"], currentValue: "max" });
  assert.deepEqual(api.state.zcodeThinkingOptions, ["low", "high", "max"]);
  assert.deepEqual(childValueTextPairs(select), [["low", "low"], ["high", "high"], ["max", "max"]]);
  assert.equal(api.state.thinkingMode, "high");
  assert.equal(select.value, "high");
  window.dispatchMessage({ type: "zcodeThinkingOptions", tabId: "tab-2", options: ["low"], currentValue: "low" });
  assert.deepEqual(api.state.zcodeThinkingOptions, ["low", "high", "max"]);
  assert.equal(api.state.thinkingMode, "high");
  window.dispatchMessage({ type: "zcodeThinkingOptions", tabId: "tab-1", options: [], currentValue: null });
  assert.equal(select.disabled, true);
  assert.deepEqual(childValueTextPairs(select), []);
  window.dispatchMessage({ type: "state", payload: { ...panel, conversationTabs: { activeTabId: "tab-2", tabs: [{ id: "tab-2", cli: "zcode" }] } } });
  assert.equal(api.state.zcodeThinkingOptions, null);
  assert.equal(select.disabled, false);
  window.dispatchMessage({ type: "state", payload: createPanelState({ currentCli: "codex" }) });
  window.dispatchMessage({ type: "zcodeThinkingOptions", options: ["low"], currentValue: "low" });
  assert.equal(api.state.zcodeThinkingOptions, null);
});

test("Kimi thinking options come from ACP, drop off, and never cross tabs or CLIs", () => {
  const { api, document, window } = createRuntimeHarness(undefined, undefined, [
    "codex",
    "claude",
    "opencode",
    "kimi-code",
  ]);
  window.dispatchMessage({ type: "state", payload: createKimiPanelState() });
  const select = document.getElementById("thinkingMode");
  // 未收到 ACP 广告时保留官方默认五档
  assert.deepEqual(childValueTextPairs(select), [
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
  ]);
  assert.equal(select.value, "high");

  window.dispatchMessage({
    type: "kimiThinkingOptions",
    tabId: "tab-1",
    options: ["off", "low", "high", "bogus", "max"],
    currentValue: "high",
  });
  assert.deepEqual(api.state.kimiThinkingOptions, ["low", "high", "max"]);
  assert.deepEqual(childValueTextPairs(select), [["low", "low"], ["high", "high"], ["max", "max"]]);
  assert.equal(select.value, "high");
  assert.equal(api.state.thinkingMode, "high");

  // 其它标签页的广告不能覆盖当前标签页
  window.dispatchMessage({
    type: "kimiThinkingOptions",
    tabId: "tab-2",
    options: ["low"],
    currentValue: "low",
  });
  assert.deepEqual(api.state.kimiThinkingOptions, ["low", "high", "max"]);
  assert.equal(api.state.thinkingMode, "high");

  // 未广告的当前值不得被选中：回落到广告集合内的高档/首档，绝不发 xhigh
  window.dispatchMessage({
    type: "kimiThinkingOptions",
    tabId: "tab-1",
    options: ["low", "medium"],
    currentValue: "xhigh",
  });
  assert.deepEqual(childValueTextPairs(select), [["low", "low"], ["medium", "medium"]]);
  assert.equal(select.value, "low", "界面回落到广告集合内的档位");
  assert.equal(api.state.thinkingMode, "low", "只会在广告集合内取值");
  assert.equal(["low", "medium"].includes(api.state.thinkingMode), true);

  // env-only 通道只广告 off/on：没有真实努力档时禁用选择框，绝不下发改写值
  window.dispatchMessage({
    type: "kimiThinkingOptions",
    tabId: "tab-1",
    options: ["off", "on"],
    currentValue: "high",
  });
  assert.deepEqual(api.state.kimiThinkingOptions, []);
  assert.equal(select.disabled, true);
  assert.deepEqual(childValueTextPairs(select), []);

  // 切到别的 CLI 后必须丢掉 Kimi 的广告集合
  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      interactiveMode: "coding",
      conversationTabs: { activeTabId: "tab-9", tabs: [{ id: "tab-9", cli: "claude" }] },
    }),
  });
  assert.deepEqual(api.state.kimiThinkingOptions, []);
  assert.equal(api.state.kimiThinkingOptionsAdvertised, false);
});

test("Kimi ACP mode updates stay on their own tab and add no new UI", () => {
  const { api, window } = createRuntimeHarness(undefined, undefined, [
    "codex",
    "claude",
    "opencode",
    "kimi-code",
  ]);
  window.dispatchMessage({ type: "state", payload: createKimiPanelState() });
  window.dispatchMessage({ type: "kimiModeUpdate", tabId: "tab-1", modeId: "plan" });
  assert.equal(api.getConversationRuntimeState("tab-1").kimiAcpModeId, "plan");
  // 非当前标签页的模式更新不得落盘：消息按 tab 隔离
  window.dispatchMessage({ type: "kimiModeUpdate", tabId: "tab-2", modeId: "yolo" });
  assert.equal(api.getConversationRuntimeState("tab-2").kimiAcpModeId, null);
  assert.equal(api.getConversationRuntimeState("tab-1").kimiAcpModeId, "plan");
  // 切到 tab-2 后只接受 tab-2 自己的模式更新
  api.state.conversationTabs.activeTabId = "tab-2";
  window.dispatchMessage({ type: "kimiModeUpdate", tabId: "tab-1", modeId: "auto" });
  assert.equal(api.getConversationRuntimeState("tab-1").kimiAcpModeId, "plan");
  window.dispatchMessage({ type: "kimiModeUpdate", tabId: "tab-2", modeId: "yolo" });
  assert.equal(api.getConversationRuntimeState("tab-2").kimiAcpModeId, "yolo");
});

test("Kimi keeps the compact entry hidden while other CLIs still show it", () => {
  const { document, window } = createRuntimeHarness(undefined, undefined, [
    "codex",
    "claude",
    "opencode",
    "kimi-code",
  ]);
  const button = document.getElementById("commonCommandButton");
  window.dispatchMessage({ type: "state", payload: createKimiPanelState() });
  assert.equal(button.style.display, "none", "Kimi 没有 ACP 压缩方法，不得显示入口");
  assert.equal(button.disabled, true);

  window.dispatchMessage({
    type: "state",
    payload: createPanelState({
      interactiveMode: "coding",
      conversationTabs: { activeTabId: "tab-9", tabs: [{ id: "tab-9", cli: "claude" }] },
    }),
  });
  assert.notEqual(button.style.display, "none", "其它 CLI 的入口不受影响");
});

test("Kimi context window is labelled as the configured max_context_size", () => {
  const { api, document, window } = createRuntimeHarness(undefined, undefined, [
    "codex",
    "claude",
    "opencode",
    "kimi-code",
  ]);
  window.dispatchMessage({ type: "state", payload: createKimiPanelState() });
  api.state.isRunning = true;
  const label = document.getElementById("runContextTokens");

  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-1",
    tokensInContextWindow: 4000,
    modelContextWindow: 262144,
    contextWindowSource: "kimi-config-window",
  });
  assert.equal(api.getConversationRuntimeState("tab-1").contextWindowSource, "kimi-config-window");
  assert.equal(label.textContent, "4k");
  const title = String(label.getAttribute("title") || label.title);
  assert.match(title, /4000 \/ 262144/);
  assert.match(title, /max_context_size/);
  assert.doesNotMatch(title, /adapter fallback|适配器 fallback/);

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000 });
  assert.equal(label.style.display, "none");
  assert.equal(label.textContent, "");

  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-1",
    tokensInContextWindow: 4000,
    modelContextWindow: 262144,
    contextWindowSource: "kimi-config-window",
  });
  assert.equal(label.style.display, "inline-flex");
  assert.equal(label.textContent, "4k");

  // DSH 的 fallback 语义不受影响
  window.dispatchMessage({
    type: "contextTokenUsage",
    tabId: "tab-1",
    tokensInContextWindow: 4000,
    modelContextWindow: 262144,
    contextWindowSource: "adapter-fallback",
  });
  assert.match(String(label.getAttribute("title") || label.title), /适配器 fallback/);
  assert.equal(api.getConversationRuntimeState("tab-1").contextWindowSource, "adapter-fallback");
});
