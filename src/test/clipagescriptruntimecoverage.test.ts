import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewRuntimeScript } from "../webview/viewContentScript";
import { VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME } from "../webview/viewContentScript/attachmentsAndTime";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_HISTORY_PANELS } from "../webview/viewContentScript/historyPanels";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../webview/viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../webview/viewContentScript/windowMessageDispatch";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";

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
    if (char === "/" && source[index + 1] !== "/" && source[index + 1] !== "*") {
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
  return {
    innerHeight: 720,
    listeners,
    timers,
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
    },
    setTimeout(listener: Listener): number {
      const id = nextTimerId++;
      timers.set(id, listener);
      return id;
    },
    clearTimeout(id: number): void {
      timers.delete(id);
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

function createRuntimeHarness() {
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
    i18n: WEBVIEW_I18N.en,
    cliList: ["codex", "claude", "opencode"],
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
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    `${script}
      return {
        state,
        elements,
        appendRunRawStream,
        applyExternalTaskListUpdate,
        buildInsertText,
        buildPromptPayload,
        closeHistorySessionMessages,
        continueQueuedPrompts,
        dispatchPrompt,
        formatDateTime,
        formatDateTimeWithMs,
        getActiveConversationRuntimeState,
        getAssistantMessageContentForDisplay,
        getRunPromptHistory,
        handleFileSelection,
        openHistorySessionMessages,
        openQueueOverlay,
        openRunStreamOverlay,
        parseTaskListFromText,
        queuePromptForLater,
        removePromptContextTag,
        renderMessages,
        requestRunStreamExport,
        resetConversationRuntimeState,
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
    undefined,
    undefined,
    console,
    fakeWindow.setTimeout,
    fakeWindow.clearTimeout,
    fakeWindow.clearInterval,
    fakeWindow.requestAnimationFrame,
    fakeWindow.cancelAnimationFrame,
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
    multiAgentEnabled: true,
    loopMaxRounds: 99,
    loopSubtaskMaxThinkingMode: "xhigh",
    loopAutoCloseSubtaskTabs: false,
    loopExecutionModeByCli: { codex: "debate_multi_agent" },
    locale: "en",
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

test("boots the runtime and dispatches state, message, stream, history, settings, and queue events", () => {
  const harness = createRuntimeHarness();
  const { api, document, posted, window } = harness;

  assert.deepEqual(posted[0], { type: "requestState" });
  window.dispatchMessage({ type: "state", payload: createPanelState() });
  assert.equal(api.state.currentCli, "codex");
  assert.equal(api.state.loopMaxRounds, 12);
  assert.equal(api.state.macTaskShell, "bash");
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

  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "start", startedAt: 2_000, prompt: "run task" });
  window.dispatchMessage({
    type: "assistantDelta",
    tabId: "tab-1",
    id: "tasklist-text",
    content: "Tasklist: [completed] inspect logs；[inProgress] patch parser；[pending] run tests",
    kind: "normal",
  });
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
  document.getElementById("toolSettingsWorkspaceTab").click();
  assert.equal(document.getElementById("toolSettingsWorkspacePanel").classList.contains("active"), true);
  document.getElementById("installCodeGraph").click();
  assert.deepEqual(posted.at(-1), { type: "installCodeGraph" });
  document.getElementById("loopMaxRounds").value = "0";
  document.getElementById("loopMaxRounds").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "loopMaxRounds", value: 1 });
  document.getElementById("languageSelect").value = "zh-CN";
  document.getElementById("languageSelect").dispatchEvent({ type: "change" });
  assert.deepEqual(posted.at(-1), { type: "updateSetting", key: "locale", value: "zh-CN" });

  document.getElementById("promptInput").value = " queued work ";
  api.queuePromptForLater({ prompt: "queued work", contextOptions: { includeCurrentFile: false } });
  document.getElementById("queueIndicator").click();
  assert.equal(document.getElementById("queueOverlay").classList.contains("visible"), true);
  assert.equal(document.getElementById("queueCount").textContent, "1");
  api.state.conversationTabs.tabs[0].loopTaskStatus = "completed";
  api.state.conversationTabs.tabs[0].loopTaskRunning = false;
  window.dispatchMessage({ type: "runStatus", tabId: "tab-1", status: "end", message: "Task completed" });
  assert.equal(posted.at(-1).type, "sendPrompt");

  window.dispatchMessage({ type: "uploadResult", paths: ["/tmp/a.png"] });
  assert.match(document.getElementById("promptInput").value, /@\/tmp\/a\.png/);
  window.dispatchMessage({ type: "pickWorkspacePathResult", canceled: true });
  assert.match(document.getElementById("promptInput").value, /@/);
  window.dispatchMessage({ type: "configApplyError", error: "bad config" });
  assert.equal(document.getElementById("configApplyErrorOverlay").classList.contains("visible"), true);
  assert.equal(document.getElementById("configApplyErrorContent").textContent, "bad config");
  document.getElementById("copyConfigApplyError").click();
  assert.equal(posted.at(-1).type, "clipboard");

  const errors = posted.filter((message) => message && message.type === "webviewError");
  assert.deepEqual(errors, []);
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
  assert.equal(helpers.deriveLatestRunStatusMessageFromMessages([{ role: "system", content: "Task completed" }]), "Task completed");
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
    "isThinkingLikeMessage",
    "isCodexReasoningStyleMessage",
    "isTransparentBubbleMessage",
    "renderUserMessageContent",
    "getAssistantMessageContentForDisplay",
    "isToolResultLikeMessage",
    "renderToolResultLikeMessage",
    "renderAssistantMessageContent",
    "renderTraceMessageContent",
    "renderMessageContent",
    "safelyRenderMessageContent",
    "getTraceExpandedLines",
    "renderTraceContent",
    "renderTraceBodyLines",
    "shouldCollapseTraceContent",
    "getTraceCollapseSummaryText",
    "getToolResultCollapseSummaryText",
    "hasDiffLikeLines",
    "getTracePresentation",
    "classifyCommandPurposeTag",
    "unwrapShellCommand",
    "stripWrappedQuotes",
    "normalizeCommandForMatching",
    "getTraceTypeDefinition",
    "isLineNumberedLine",
    "wrapLineNumberedBlocks",
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
    `${source}; return {
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
  assert.match(context.renderMessageContent({ role: "assistant", content: "answer" }, 99), /assistant-message-content-final/);
  assert.match(context.renderMessageContent({ role: "user", content: "<tag>", contextTags: ["src/a.ts"] }, 0), /&lt;tag&gt;/);
  assert.match(context.renderTraceContent({ id: "trace-open", role: "trace", content: "exec: npm run build\n+ added" }), /cmd-purpose-build/);
  const collapsedToolResult = context.renderTraceContent({ id: "tool", role: "trace", content: "Tool result: shell\n" + "x".repeat(70) });
  assert.match(collapsedToolResult, /trace-collapsible message-collapsible-generic/);
  assert.match(collapsedToolResult, /Tool result: shell/);
  assert.equal(context.classifyCommandPurposeTag("git status").type, "git-read");
  assert.equal(context.unwrapShellCommand("bash -lc \"npm test\""), "npm test");
  assert.equal(context.getTracePresentation("unknown").type, "");
  const fallback = context.safelyRenderMessageContent({ role: "assistant", content: "broken" }, 0);
  assert.doesNotMatch(fallback, /render-message-failed/);
  assert.deepEqual(failures, []);
});

test("applies model, panel, and selector state without preserving invalid snapshots", () => {
  const runtimeScript = buildWebviewRuntimeScript({
    i18n: WEBVIEW_I18N.en,
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
  }).issues, [{ role: "small", code: "missing-role-model", messageKey: undefined }]);
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

test("handles run stream, queue, attachments, history, and settings function branches in isolation", async () => {
  const streamQueueSource = [
    "normalizeRunStreamSource",
    "normalizeRunStreamRecordContent",
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
    "getClipboardFiles",
    "getDropUris",
  ].map((name) => extractFunctionSource(`${VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE}\n${VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME}`, name)).join("\n");
  const runtimeState = {
    pendingPromptQueue: [{ prompt: "first" }, { prompt: "second" }],
    queueEditingIndex: 0,
    queueEditingDraft: "updated",
    runStreamRecords: [{ id: "1", content: "{\"ok\":true}", source: "stdout", createdAt: 1 }],
  };
  const toasts: string[] = [];
  const helpers = new Function(
    "RUN_STREAM_PREVIEW_MAX_LENGTH",
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
      getClipboardFiles,
      getDropUris,
    };`,
  )(
    20,
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
  helpers.saveQueuedPromptEdit();
  assert.equal(runtimeState.pendingPromptQueue[0].prompt, "updated");
  assert.equal(toasts.at(-1), "toastQueueUpdated");
  helpers.moveQueuedPrompt(0, 1);
  assert.deepEqual(runtimeState.pendingPromptQueue.map((item) => item.prompt), ["second", "updated"]);
  helpers.clearQueuedPromptIndex(1);
  assert.deepEqual(runtimeState.pendingPromptQueue.map((item) => item.prompt), ["second"]);
  runtimeState.queueEditingIndex = 4;
  helpers.normalizeQueueEditingState(runtimeState);
  assert.equal(runtimeState.queueEditingIndex, -1);
  assert.equal(helpers.buildInsertText(["a", "b"], "#"), "#a #b ");
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
    "buildHistorySessionKey",
    "normalizeHistorySessionMessages",
    "resolveHistoryMessageRoleLabel",
    "resolveHistoryMessageKindLabel",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_HISTORY_PANELS, name)).join("\n");
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
  ]).map((item: any) => item.content), ["one", "two"]);
  assert.equal(historyHelpers.resolveHistoryMessageRoleLabel("trace"), "historySessionMessageTrace");
  assert.equal(historyHelpers.resolveHistoryMessageKindLabel("tool-use"), "historySessionMessageToolUse");

  const settingsSource = [
    "getActiveLoopMainTaskId",
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
  };
  const settingsHelpers = new Function(
    "state",
    "elements",
    "t",
    `${settingsSource}; return { getActiveLoopMainTaskId, collectRuleTargets, buildPromptPreview };`,
  )(settingsState, settingsElements, (key: string) => key);
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
    "renderConversationTabs",
    "getConversationRuntimeState",
    "isHiddenRetryQueuedMessage",
    "setTabErrored",
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
    () => calls.push("tabs"),
    () => ({ pendingPromptQueue: [{ prompt: "queued" }], suppressQueueFlushOnce: false, lastRunStatusMessage: "", activeRunActivity: "" }),
    (content: string) => /retry/.test(content),
    () => calls.push("errored"),
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
