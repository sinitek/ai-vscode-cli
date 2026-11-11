import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";
import { buildFinalAnswerMessageRuntimeSource } from "../../finalAnswerProtocol";
import { buildJsonContainerRuntimeSource } from "../../shared/jsonContainer";

type Message = { id: string; role: string; content: string; kind?: string; [key: string]: unknown };

function functionSource(source: string, name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n      \\}`));
  assert.ok(match, `Missing runtime helper ${name}`);
  return match[0];
}

function history(count: number, prefix = "message"): Message[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, role: "system", content: `process ${index}` }));
}

function createHarness(persistent = false) {
  const state = {
    messages: [] as Message[], chatMessageLimit: 500, onlyShowFinalResults: false, currentCli: "codex",
    conversationTabs: { activeTabId: "first", tabs: [{ id: "first", cli: "codex" }, { id: "second", cli: "claude" }] },
  };
  const chatArea = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) };
  const unobserved: unknown[] = [];
  const timers = new Map<number, () => void>();
  const posted: Record<string, any>[] = [];
  const runtimes: Record<string, any> = {};
  let timerId = 0;
  let created = 0;
  let updated = 0;
  let nearBottom = true;
  let searchAnchored = false;
  class Node {
    children: Node[] = [];
    parentNode: Node | null = null;
    dataset: Record<string, string> = {};
    bubble: Node | null = null;
    viewport: Node | null = null;
    get parentElement() { return this.parentNode; }
    get isConnected(): boolean { return this === root || Boolean(this.parentNode?.isConnected); }
    getBoundingClientRect() {
      const top = root.children.indexOf(this) * 30 - chatArea.scrollTop;
      return { top, bottom: top + 30 };
    }
    querySelector(selector: string): Node | null {
      return selector === ".bubble" ? this.bubble : selector === ".thinking-bubble-viewport" ? this.viewport : null;
    }
    querySelectorAll(selector: string): Node[] {
      if (selector === ".bubble") { return this.children.flatMap((child) => child.bubble ? [child.bubble] : []); }
      if (selector === ".thinking-bubble-viewport") { return this.children.flatMap((child) => child.bubble?.viewport ? [child.bubble.viewport] : []); }
      return [];
    }
    insertBefore(child: Node, before: Node | null) {
      child.parentNode?.removeChild(child);
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
      child.parentNode = this;
    }
    removeChild(child: Node) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
    }
    replaceChildren(...children: Node[]) {
      this.children.slice().forEach((child) => this.removeChild(child));
      children.forEach((child) => this.insertBefore(child, null));
    }
    set innerHTML(_value: string) { this.replaceChildren(); }
  }
  const root = new Node();
  const sandbox: Record<string, any> = {
    state, elements: { messages: root, chatArea, emptyState: { style: {} } },
    ResizeObserver: class {
      observe() {}
      unobserve(viewport: unknown) { unobserved.push(viewport); }
      disconnect() {}
    },
    traceCollapsibleOpenKeys: new Set(), instructionGroupOpenKeys: new Set(),
    getTracePresentation: (content: string) => ({ type: content.startsWith("thinking:") ? "thinking" : "normal", lines: [content], detail: content }),
    isToolActivityMessage: (message: Message) => message.kind === "tool-use",
    isThinkingLikeMessage: (message: Message) => message.kind === "thinking",
    isHiddenLoopPlusProtocolPrompt: (content: string) => content === "hidden protocol",
    shouldHideSystemRunStatusMessage: (message: Message) => message.content === "Task completed",
    shouldHideParsedTaskListMessage: (message: Message) => message.content === "parsed task list",
    getAssistantMessageContentForDisplay: (message: Message) => message.content,
    normalizeMessageActions: () => [], isInstructionBubble: () => false,
    isPreToolAssistantNarration: () => false,
    isChatNearBottom: () => nearBottom, isChatSearchAnchored: () => searchAnchored,
    restoreChatScrollTop: (value: number) => { chatArea.scrollTop = value; },
    stickChatToBottom() {}, scrollChatToBottom() {}, updateRunWait() {}, updateTaskList() {},
    refreshChatSearchHighlights() {}, updateScrollToBottomButton() {},
    rememberThinkingBubbleViewState() {},
    reportWebviewFailure: (_event: string, error: unknown) => { throw error; },
    t: (value: string) => value, escapeHtml: (value: string) => value,
    assistantRedirects: {}, assistantDeltaRenderTimers: {}, assistantStreamingMarkdownPending: {}, assistantStreamingRenderFrames: {},
    ASSISTANT_FINAL_MARKDOWN_IDLE_MS: 100, ASSISTANT_DELTA_MARKDOWN_IDLE_MS: 50,
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id), requestAnimationFrame: (callback: () => void) => callback(),
    createMessageId: () => `stream-${++timerId}`,
    isSameAssistantKind: (message: Message, kind: string) => (message.kind || "normal") === (kind || "normal"),
    isToolResultLikeMessage: () => false,
  };
  const helpers = ["isCodexReasoningStyleMessage", "isAssistantMarkdownRenderPending", "clearAssistantDeltaRenderTimer", "shouldDeferAssistantMarkdownWhileStreaming", "assistantMarkdownIdleDelay", "scheduleAssistantDeltaMarkdownRender", "scheduleAssistantStreamingRender", "flushAssistantDeltaMarkdownRenders", "appendAssistantDelta"];
  if (persistent) {
    sandbox.vscode = { postMessage: (message: Record<string, any>) => posted.push(message) };
    sandbox.getConversationRuntimeState = (tabId: string) => runtimes[tabId] ||= { messages: [] };
    sandbox.isRuntimeStateForActiveTab = (tabId: string) => state.conversationTabs.activeTabId === tabId;
    sandbox.normalizeMessageOrder = (messages: Message[]) => messages;
    sandbox.setMessagesForTab = (tabId: string, messages: Message[]) => {
      sandbox.getConversationRuntimeState(tabId).messages = messages;
      if (sandbox.isRuntimeStateForActiveTab(tabId)) state.messages = messages;
    };
    sandbox.showToast = (message: string) => posted.push({ type: "toast", message });
  }
  vm.createContext(sandbox);
  vm.runInContext([
    buildFinalAnswerMessageRuntimeSource(),
    buildJsonContainerRuntimeSource(),
    VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
    functionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isFinalAssistantSummaryMessage"),
    ...helpers.map((name) => functionSource(VIEW_CONTENT_SCRIPT_TRACE_RENDERING, name)),
  ].join("\n").replace(/\$\{FINAL_ANSWER_TEXT_MARKER\}/g, "[final_answer]"), sandbox);
  if (persistent) sandbox.isConversationTabBusy = () => false;
  sandbox.rememberThinkingBubbleViewState = () => undefined;
  sandbox.createMessageElement = (message: Message, index: number, renderState: unknown) => {
    created += 1;
    const node = new Node();
    node.dataset.messageId = message.id;
    node.bubble = new Node();
    if (message.kind === "thinking") {
      node.bubble.viewport = new Node();
      node.bubble.viewport.dataset.thinkingKey = message.id;
    }
    sandbox.rememberRenderedMessage(message, index, node, renderState);
    return node;
  };
  const updateMessage = (message: Message, index: number) => {
    const node = sandbox.findRenderedMessageElement(message.id);
    if (!node) { return false; }
    updated += 1;
    sandbox.rememberRenderedMessage(message, index, node);
    return true;
  };
  sandbox.updateRenderedAssistantMessage = updateMessage;
  sandbox.updateRenderedAssistantMessageStreaming = updateMessage;
  return {
    posted,
    confirmPruning: (messages?: Message[], error?: string) => {
      const request = posted.filter((message) => message.type === "pruneChatMessages").at(-1);
      assert.ok(request);
      const deletedIds = new Set(request.messages.map((message: Message) => message.id));
      const remaining = messages || state.messages.filter((message) => !deletedIds.has(message.id));
      sandbox.applyChatBubblePruningResult({ ...request, type: "chatMessagesPruned", messages: remaining, error });
    },
    state, sandbox, root, timers, chatArea, unobserved,
    render: () => {
      if (persistent) sandbox.getConversationRuntimeState(state.conversationTabs.activeTabId).messages = state.messages;
      sandbox.renderMessages({ incremental: true });
    },
    visible: () => Array.from(sandbox.getVisibleMessages(), (entry: any) => ({ id: entry.message.id, index: entry.index })),
    ids: () => root.children.map((child) => child.dataset.messageId),
    get created() { return created; }, get updated() { return updated; },
    setReading: (scrollTop: number, anchored = false) => { nearBottom = false; searchAnchored = anchored; chatArea.scrollTop = scrollTop; },
    flushTimers: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); },
  };
}

test("webview counts base display entries before result filtering and preserves raw message indices", () => {
  const harness = createHarness();
  const messages = history(497);
  messages.splice(0, 0, { id: "empty", role: "assistant", content: "" }, { id: "protocol", role: "user", content: "hidden protocol" }, { id: "status", role: "system", content: "Task completed" }, { id: "tasks", role: "assistant", content: "parsed task list" });
  messages.push({ id: "user", role: "user", content: "request" }, { id: "final", role: "assistant", content: "answer", codexFinalAnswer: true });
  harness.state.messages = messages;
  harness.render();
  assert.equal(harness.ids().length, 499);
  assert.equal(harness.visible()[0].index, 4);
  messages.push({ id: "process-new", role: "system", content: "new process" });
  harness.render();
  assert.equal(harness.ids().length, 375);
  assert.equal(harness.visible()[0].index, 129);
  const retained = harness.ids();
  harness.state.onlyShowFinalResults = true;
  harness.render();
  assert.deepEqual(harness.ids(), ["user", "final"]);
  harness.state.onlyShowFinalResults = false;
  harness.render();
  assert.deepEqual(harness.ids(), retained);
  assert.equal(messages.length, 504);
});

test("confirmed cleanup counts remaining messages across successive batches and cannot be undone by raising the limit", () => {
  const harness = createHarness(true);
  harness.state.messages = history(500);
  harness.render();
  assert.equal(harness.state.messages.length, 500);
  assert.equal(harness.posted.length, 1);
  harness.render();
  assert.equal(harness.posted.length, 1);
  harness.confirmPruning();
  assert.equal(harness.state.messages.length, 375);
  assert.equal(harness.state.messages[0].id, "message-125");
  harness.state.messages.push(...history(124, "second-batch"));
  harness.render();
  assert.equal(harness.posted.length, 1);
  harness.state.messages.push(...history(1, "trigger"));
  harness.render();
  assert.equal(harness.posted.length, 2);
  assert.equal(harness.posted[1].messages[0].id, "message-125");
  harness.confirmPruning();
  assert.equal(harness.state.messages.length, 375);
  assert.equal(harness.state.messages[0].id, "message-250");
  harness.state.chatMessageLimit = 1000;
  harness.render();
  assert.equal(harness.ids().length, 375);
  assert.equal(harness.posted.length, 2);
});

test("confirmed cleanup skips protected positions without repeated-render backfilling", () => {
  const harness = createHarness(true);
  harness.state.messages = history(500);
  for (let index = 0; index < 124; index++) harness.state.messages[index].role = "user";
  harness.render();
  assert.equal(harness.posted[0].messages.length, 1);
  harness.confirmPruning();
  assert.equal(harness.state.messages.length, 499);
  for (let index = 0; index < 4; index++) harness.render();
  assert.equal(harness.posted.length, 1);
  assert.ok(harness.state.messages.some((message) => message.id === "message-125"));
  harness.state.messages.push(...history(1, "new"));
  harness.render();
  assert.equal(harness.posted.length, 2);
  assert.equal(harness.posted[1].messages[0].id, "message-125");
});

test("background cleanup replies update only the matching Tab and stale session replies are ignored", () => {
  const harness = createHarness(true);
  harness.state.messages = history(500, "first");
  harness.render();
  const firstRequest = harness.posted[0];
  const firstRemaining = harness.state.messages.slice(125);
  harness.state.conversationTabs.activeTabId = "second";
  harness.state.messages = history(500, "second");
  harness.render();
  const secondMessages = harness.state.messages;
  harness.sandbox.applyChatBubblePruningResult({ ...firstRequest, type: "chatMessagesPruned", messages: firstRemaining });
  assert.equal(harness.state.messages, secondMessages);
  assert.equal(harness.sandbox.getConversationRuntimeState("first").messages.length, 375);
  Object.assign(harness.state.conversationTabs.tabs[1], { sessionId: "new-session" });
  harness.confirmPruning();
  assert.equal(harness.state.messages, secondMessages);
  assert.equal(harness.state.messages.length, 500);
});

test("failed persistence restores authoritative messages and does not retry on every render", () => {
  const harness = createHarness(true);
  harness.state.messages = history(500);
  harness.render();
  harness.confirmPruning(harness.state.messages, "保存失败");
  assert.equal(harness.state.messages.length, 500);
  assert.equal(harness.ids().length, 500);
  harness.render();
  assert.equal(harness.posted.filter((message) => message.type === "pruneChatMessages").length, 1);
  assert.equal(harness.posted.at(-1)?.message, "保存失败");
});

test("two Tab/CLI projections, cached DOM, configuration changes and history replacement remain isolated", () => {
  const harness = createHarness();
  const first = history(500, "first");
  const second = history(624, "second");
  harness.state.messages = first;
  harness.render();
  const original = harness.sandbox.findRenderedMessageElement("first-200");
  harness.state.conversationTabs.activeTabId = "second";
  harness.state.currentCli = "claude";
  harness.state.messages = second;
  harness.render();
  assert.equal(harness.ids().length, 499);
  assert.equal(harness.ids()[0], "second-125");
  assert.equal(harness.sandbox.renderedMessagesById.size, 499);
  harness.state.conversationTabs.activeTabId = "first";
  harness.state.messages = first;
  harness.render();
  assert.equal(harness.ids().length, 375);
  assert.equal(harness.sandbox.findRenderedMessageElement("first-200"), original);
  harness.state.chatMessageLimit = 100;
  harness.render();
  assert.equal(harness.ids().length, 75);
  assert.equal(harness.ids()[0], "first-425");
  harness.state.chatMessageLimit = 1000;
  harness.render();
  assert.equal(harness.ids().length, 500);
  harness.state.messages = first.map((message) => ({ ...message }));
  harness.render();
  assert.deepEqual(harness.ids(), first.map((message) => message.id));
  assert.equal(second.length, 624);
});

test("stream deltas crossing the threshold keep latest output and reuse retained bubbles through final upgrade", () => {
  const harness = createHarness();
  harness.state.messages = history(499);
  harness.render();
  const retainedNode = harness.sandbox.findRenderedMessageElement("message-200");
  harness.sandbox.appendAssistantDelta("incoming", "thinking", "thinking");
  assert.equal(harness.ids().length, 375);
  assert.equal(harness.ids()[0], "message-125");
  const latest = harness.state.messages[499];
  assert.equal(harness.ids()[374], latest.id);
  const created = harness.created;
  for (let index = 0; index < 20; index += 1) {
    harness.sandbox.appendAssistantDelta("incoming", " delta", "thinking");
  }
  assert.equal(harness.created, created);
  assert.equal(harness.updated, 20);
  assert.equal(harness.sandbox.findRenderedMessageElement("message-200"), retainedNode);
  harness.state.onlyShowFinalResults = true;
  harness.render();
  assert.deepEqual(harness.ids(), []);
  harness.sandbox.appendAssistantDelta("incoming", "", "thinking", { codexFinalAnswer: true });
  assert.deepEqual(harness.ids(), [latest.id]);
  harness.flushTimers();
  assert.deepEqual(harness.ids(), [latest.id]);
  assert.equal(harness.state.messages.length, 500);
  assert.match(latest.content, /delta/);
});

test("detached streaming output reappears and completion re-applies retention without deleting runtime history", () => {
  const harness = createHarness();
  const messages = history(500);
  messages[0] = { id: "worker", role: "assistant", kind: "thinking", subagentId: "worker", content: "working" };
  harness.state.messages = messages;
  harness.render();
  assert.ok(!harness.ids().includes("worker"));
  harness.sandbox.appendAssistantDelta("worker", " delta", "thinking");
  assert.ok(harness.ids().includes("worker"));
  assert.equal(harness.ids().length, 376);
  harness.flushTimers();
  assert.ok(!harness.ids().includes("worker"));
  assert.equal(messages[0].content, "working delta");
  harness.sandbox.appendAssistantDelta("worker", "", "thinking", { codexFinalAnswer: true });
  assert.ok(harness.ids().includes("worker"));
  assert.equal(harness.ids().length, 376);
});

test("only user requests and rendered final answers survive inside the oldest window", () => {
  const harness = createHarness();
  harness.state.chatMessageLimit = 1;
  harness.state.messages = [
    { id: "legacy", role: "assistant", content: "**Thinking** legacy answer" },
    { id: "narration", role: "assistant", content: "先检查代码" },
    { id: "user", role: "user", content: "修复问题" },
    { id: "explicit", role: "assistant", content: "[final_answer] done", kind: "thinking" },
    ...history(10),
  ];
  harness.render();
  assert.deepEqual(harness.ids(), ["user", "explicit"]);
  harness.state.onlyShowFinalResults = true;
  harness.render();
  assert.deepEqual(harness.ids(), ["user", "explicit"]);
});

test("mixed thinking and instruction history shares one oldest window and preserves newer instructions", () => {
  const harness = createHarness();
  const messages: Message[] = history(500).map((message, index) => ({
    ...message, role: "assistant", kind: index % 2 === 0 ? "thinking" : "tool-use",
  }));
  messages[0] = { id: "request", role: "user", content: "检查并修复", kind: "normal" };
  messages[50] = { id: "answer", role: "assistant", content: "修复完成", kind: "normal", codexFinalAnswer: true };
  messages[2] = { id: "unmarked-thinking", role: "assistant", content: "**Checking** current behavior", kind: "normal" };
  harness.state.messages = messages;
  harness.render();
  assert.equal(harness.ids().length, 377);
  assert.deepEqual(harness.ids().slice(0, 4), ["request", "answer", "message-125", "message-126"]);
  assert.ok(!harness.ids().includes("unmarked-thinking"));
  assert.ok(!harness.ids().includes("message-1"));
  assert.equal(messages.length, 500);
  harness.render();
  assert.equal(harness.ids().length, 377);
});

test("retention final protection matches the rendered final border predicate instead of assistant text heuristics", () => {
  const harness = createHarness();
  harness.state.messages = [
    { id: "user", role: "user", content: "需求", kind: "thinking" },
    { id: "codex", role: "assistant", content: "结论", codexFinalAnswer: true },
    { id: "loop-answer", role: "assistant", content: "结论", loopAnswerConclusion: true },
    { id: "loop-summary", role: "assistant", content: "结论", loopFinalSummary: true },
    { id: "marker", role: "assistant", content: "[final_answer] 结论", kind: "thinking", subagentId: "worker" },
    { id: "thinking", role: "assistant", content: "**Thinking** 过程正文" },
    { id: "pre-tool", role: "assistant", content: "接下来读取文件" },
    { id: "tool", role: "assistant", content: "读取结果", kind: "tool-result" },
    { id: "trace", role: "trace", content: "[final_answer] 不是助手答复" },
    { id: "last", role: "assistant", content: "尚未成为最终答复" },
  ];
  harness.state.messages.forEach((message, index) => {
    assert.equal(
      harness.sandbox.isChatBubbleRetentionProtectedMessage(message, index),
      message.role === "user" || harness.sandbox.isFinalAssistantSummaryMessage(index),
      message.id,
    );
  });
});

test("removed bubbles release rendering records and observers while preserving a non-bottom reading anchor", () => {
  const harness = createHarness();
  harness.state.messages = history(499).map((message) => ({ ...message, role: "assistant", kind: "thinking" }));
  harness.render();
  const removed = harness.sandbox.findRenderedMessageElement("message-0");
  const retained = harness.sandbox.findRenderedMessageElement("message-200");
  harness.setReading(6000, true);
  const priorTop = retained.getBoundingClientRect().top;
  harness.sandbox.thinkingBubbleViewStates.set("stale-key", { content: "old" });
  harness.state.messages.push({ id: "new", role: "system", content: "process" });
  harness.render();
  assert.equal(harness.sandbox.renderedMessagesById.size, 375);
  assert.equal(harness.sandbox.findRenderedMessageElement("message-0"), null);
  assert.ok(harness.unobserved.includes(removed.bubble.viewport));
  assert.equal(harness.sandbox.thinkingBubbleViewStates.has("stale-key"), false);
  assert.equal(retained.getBoundingClientRect().top, priorTop);
  assert.equal(harness.chatArea.scrollTop, 2250);
});
