import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";

import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { HEADER_TABS_STYLES } from "../../webview/viewContentStyles/headerTabs";

type TestEvent = {
  target: ElementDouble;
  relatedTarget?: ElementDouble | null;
  clientX?: number;
  clientY?: number;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
  stopped?: boolean;
};

class EventTargetDouble {
  listeners = new Map<string, Array<{ callback: (event: TestEvent) => void; capture: boolean }>>();
  addEventListener(type: string, callback: (event: TestEvent) => void, capture = false): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ callback, capture });
    this.listeners.set(type, listeners);
  }
  fire(type: string, event: TestEvent, capture = false): void {
    for (const listener of this.listeners.get(type) || []) {
      if (listener.capture === capture) {
        listener.callback(event);
      }
    }
  }
}

class ElementDouble extends EventTargetDouble {
  id = "";
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  type = "";
  title = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: ElementDouble[] = [];
  parentElement: ElementDouble | null = null;
  rect = { left: 20, top: 20, width: 100, height: 24 };
  classList = {
    add: (token: string) => { this.className += ` ${token}`; },
    toggle: (token: string, enabled: boolean) => {
      this.className = this.className.split(/\s+/).filter((item) => item !== token).join(" ");
      if (enabled) { this.classList.add(token); }
    },
  };
  constructor(readonly document: DocumentDouble) { super(); }
  set innerHTML(value: string) {
    assert.equal(value, "", "Only the original tab container may be cleared with innerHTML");
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
  }
  get isConnected(): boolean {
    return this === this.document.body || Boolean(this.parentElement?.isConnected);
  }
  appendChild(child: ElementDouble): void {
    child.parentElement = this;
    this.children.push(child);
  }
  contains(child: ElementDouble | null): boolean {
    return child === this || this.children.some((element) => element.contains(child));
  }
  closest(selector: string): ElementDouble | null {
    return this.className.split(/\s+/).includes(selector.slice(1))
      ? this : this.parentElement?.closest(selector) || null;
  }
  querySelector(selector: string): ElementDouble | null {
    for (const child of this.children) {
      if (child.className.split(/\s+/).includes(selector.slice(1))) { return child; }
      const found = child.querySelector(selector);
      if (found) { return found; }
    }
    return null;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getBoundingClientRect() {
    let { left, top, width, height } = this.rect;
    if (this.id === "conversationTabSummaryTooltip") {
      width = Math.min(Number.parseFloat(this.style.maxWidth), this.textContent.length * 12 + 18);
      height = Math.min(Number.parseFloat(this.style.maxHeight), Math.ceil(this.textContent.length * 12 / (width - 18)) * 16 + 10);
      left = Number.parseFloat(this.style.left) || 0;
      top = Number.parseFloat(this.style.top) || 0;
    }
    return { left, top, width, height, bottom: top + height, right: left + width };
  }
  dispatch(type: string, values: Partial<TestEvent> = {}): void {
    const event: TestEvent = {
      target: this, clientX: 30, clientY: 30,
      preventDefault() {}, stopPropagation() { this.stopped = true; }, ...values,
    };
    const ancestors: ElementDouble[] = [];
    let parent = this.parentElement;
    while (parent) { ancestors.unshift(parent); parent = parent.parentElement; }
    ancestors.forEach((ancestor) => ancestor.fire(type, event, true));
    this.fire(type, event);
    for (const ancestor of ancestors.reverse()) {
      if (event.stopped) { break; }
      ancestor.fire(type, event);
    }
  }
  focus(): void {
    const previous = this.document.activeElement;
    previous?.dispatch("focusout", { relatedTarget: this });
    this.document.activeElement = this;
    this.dispatch("focusin", { relatedTarget: previous });
  }
}

class DocumentDouble extends EventTargetDouble {
  body = new ElementDouble(this);
  activeElement: ElementDouble | null = null;
  hidden = false;
  hit: ElementDouble | null = null;
  createElement(): ElementDouble { return new ElementDouble(this); }
  elementFromPoint(): ElementDouble | null { return this.hit; }
}

type Tab = { id: string; cli: string; taskSummary?: unknown; running?: boolean; locked?: boolean; errored?: boolean };

function createHarness(tabs: Tab[] = [
  { id: "a", cli: "codex", taskSummary: "实现任务摘要悬浮提示" },
  { id: "b", cli: "claude", taskSummary: "修复分页交互" },
]) {
  const document = new DocumentDouble();
  const root = document.createElement();
  document.body.appendChild(root);
  const window = Object.assign(new EventTargetDouble(), { innerWidth: 800, innerHeight: 600 });
  const timers = new Map<number, { at: number; callback: () => void }>();
  const canceled: Array<() => void> = [];
  let now = 0;
  let sequence = 0;
  const posted: Array<{ type: string; tabId: string }> = [];
  const state = { conversationTabs: { tabs, activeTabId: tabs[0]?.id || null } };
  const start = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("      function getConversationTabPageCount(");
  const sandbox = {
    document, window, state, elements: { conversationTabs: root },
    CONVERSATION_TAB_PAGE_SIZE: 3, conversationTabPageIndex: 0, conversationTabPageAnchorTabId: null,
    syncConversationTabRunningFlowWatch() {}, syncAutoInteractiveModeForActiveTab() {},
    formatConversationTabCliLabel: (cli: string) => cli,
    formatConversationTabLabel: (_tab: Tab, label: string) => label,
    isTabErrored: (id: string) => tabs.find((tab) => tab.id === id)?.errored,
    isConversationTabRunning: (tab: Tab) => Boolean(tab.running),
    isLoopMainTabCloseLocked: (tab: Tab) => Boolean(tab.locked),
    applyAutoInteractiveModeForTab() {}, syncActiveMessagesFromRuntime() {}, syncRunningStateForActiveTab() {},
    armPromptContextForConversationStart() {}, openLoopGroupChatForMainTaskTab() {},
    t: (key: string) => key,
    vscode: { postMessage: (message: { type: string; tabId: string }) => posted.push(message) },
    setTimeout: (callback: () => void, delay: number) => {
      sequence += 1;
      timers.set(sequence, { at: now + delay, callback });
      return sequence;
    },
    clearTimeout: (timer: number) => {
      const entry = timers.get(timer);
      if (entry) { canceled.push(entry.callback); }
      timers.delete(timer);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.slice(start), sandbox);
  const render = () => vm.runInContext("renderConversationTabs()", sandbox);
  render();
  const tab = (id: string): ElementDouble => {
    const track = root.querySelector(".conversation-tabs-track");
    const result = track?.children.find((item) => item.dataset.conversationTabId === id);
    assert.ok(result, `Missing visible tab ${id}`);
    return result;
  };
  const hover = (id: string) => {
    const anchor = tab(id);
    document.hit = anchor;
    anchor.dispatch("mouseover");
    return anchor;
  };
  const refresh = () => {
    const hoveredId = document.hit?.dataset.conversationTabId;
    const originalHit = document.elementFromPoint;
    document.elementFromPoint = () => hoveredId ? tab(hoveredId) : null;
    render();
    document.elementFromPoint = originalHit;
    document.hit = hoveredId && root.querySelector(".conversation-tabs-track")?.children
      .find((item) => item.dataset.conversationTabId === hoveredId) || null;
  };
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [id, timer] of Array.from(timers)) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  };
  const tooltip = () => document.body.children.find((element) => element.id === "conversationTabSummaryTooltip");
  const visible = () => Boolean(tooltip() && !tooltip()?.hidden);
  return { document, root, window, timers, canceled, state, posted, render, refresh, tab, hover, advance, tooltip, visible };
}

test("summary appears at 1000ms, never 999ms, as a single accessible plain text tooltip", () => {
  const harness = createHarness();
  const anchor = harness.hover("a");
  anchor.setAttribute("aria-describedby", "existing-help");
  assert.equal(harness.visible(), false);
  harness.advance(999);
  assert.equal(harness.visible(), false);
  harness.advance(1);
  assert.equal(harness.tooltip()?.textContent, "实现任务摘要悬浮提示");
  assert.equal(harness.tooltip()?.getAttribute("role"), "tooltip");
  assert.equal(anchor.getAttribute("aria-describedby"), "existing-help conversationTabSummaryTooltip");
  anchor.dispatch("mouseout");
  assert.equal(harness.visible(), false);
  assert.equal(anchor.getAttribute("aria-describedby"), "existing-help");
});

test("leave cancels pending work; stale canceled callbacks and quick cross-tab moves cannot leak A", () => {
  const harness = createHarness();
  const first = harness.hover("a");
  harness.advance(700);
  first.dispatch("mouseout");
  harness.hover("b");
  harness.canceled.forEach((callback) => callback());
  harness.advance(999);
  assert.equal(harness.visible(), false);
  harness.advance(1);
  assert.equal(harness.tooltip()?.textContent, "修复分页交互");
  assert.equal(first.getAttribute("aria-describedby"), null);
  assert.equal(harness.document.body.children.filter((item) => item.id === "conversationTabSummaryTooltip").length, 1);
});

test("unrelated redraws preserve elapsed dwell and transfer a visible tooltip to the new anchor", () => {
  const harness = createHarness();
  const oldAnchor = harness.hover("a");
  for (let count = 0; count < 9; count += 1) {
    harness.advance(100);
    harness.refresh();
    assert.equal(harness.timers.size, 1);
  }
  harness.advance(99);
  assert.equal(harness.visible(), false);
  harness.advance(1);
  assert.equal(harness.visible(), true);
  harness.state.conversationTabs.tabs[0].taskSummary = "更新后的摘要";
  harness.refresh();
  assert.equal(oldAnchor.isConnected, false);
  assert.equal(oldAnchor.getAttribute("aria-describedby"), null);
  assert.equal(harness.tab("a").getAttribute("aria-describedby"), "conversationTabSummaryTooltip");
  assert.equal(harness.tooltip()?.textContent, "更新后的摘要");
  assert.equal(harness.timers.size, 0);
});

test("redraws keep listener counts bounded and do not attach listeners to detached tabs", () => {
  const harness = createHarness();
  const rootListeners = Array.from(harness.root.listeners.values()).flat().length;
  for (let count = 0; count < 100; count += 1) { harness.render(); }
  assert.equal(Array.from(harness.root.listeners.values()).flat().length, rootListeners);
  assert.equal(harness.window.listeners.get("resize")?.length, 1);
  assert.equal(harness.document.listeners.get("keydown")?.length, 1);
  assert.equal(harness.timers.size, 0);
});

test("deleted, paged-out, pointer-displaced and detached anchors cannot show late", () => {
  for (const change of ["deleted", "paged", "displaced", "detached", "empty"]) {
    const harness = createHarness(Array.from({ length: 4 }, (_item, index) => ({
      id: String(index), cli: "codex", taskSummary: "任务摘要",
    })));
    harness.hover("0");
    harness.advance(500);
    if (change === "deleted") {
      harness.state.conversationTabs.tabs.shift();
      harness.render();
    } else if (change === "paged") {
      harness.root.querySelector(".conversation-tabs-nav-next")?.dispatch("click");
    } else if (change === "displaced") {
      harness.document.hit = null;
      harness.render();
    } else if (change === "empty") {
      harness.state.conversationTabs.tabs = [];
      harness.render();
    } else {
      harness.root.innerHTML = "";
    }
    harness.advance(1000);
    assert.equal(harness.visible(), false, change);
    assert.equal(harness.timers.size, 0, change);
  }
});

test("missing, whitespace and non-string fields never fall back to labels or other tasks", () => {
  for (const taskSummary of [undefined, null, "", " \n\t ", 123, {}, ["摘要"]]) {
    const harness = createHarness([{ id: "a", cli: "original task prompt", taskSummary }]);
    harness.hover("a");
    harness.advance(2000);
    harness.tab("a").focus();
    harness.advance(2000);
    assert.equal(harness.visible(), false);
    assert.equal(harness.timers.size, 0);
    assert.deepEqual(harness.posted, []);
  }
});

test("summary renders markup-like input as text, not HTML", () => {
  const payload = '<img src=x onerror="alert(1)">';
  const harness = createHarness([{ id: "a", cli: "codex", taskSummary: payload }]);
  harness.hover("a");
  harness.advance(1000);
  assert.equal(harness.tooltip()?.textContent, payload);
  assert.equal(harness.tooltip()?.children.length, 0);
});

test("keyboard focus uses the same delay, survives redraw, and blur or Escape dismisses", () => {
  const harness = createHarness();
  harness.tab("a").focus();
  harness.advance(600);
  harness.refresh();
  assert.equal(harness.document.activeElement, harness.tab("a"));
  harness.advance(399);
  assert.equal(harness.visible(), false);
  harness.advance(1);
  assert.equal(harness.visible(), true);
  harness.document.fire("keydown", { target: harness.tab("a"), key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(harness.visible(), false);
  harness.tab("b").focus();
  harness.advance(1000);
  assert.equal(harness.visible(), true);
  harness.document.body.focus();
  assert.equal(harness.visible(), false);
});

test("Escape cancels pending focus dwell without selecting or posting hover requests", () => {
  const harness = createHarness();
  harness.tab("a").focus();
  harness.advance(999);
  harness.document.fire("keydown", { target: harness.tab("a"), key: "Escape", preventDefault() {}, stopPropagation() {} });
  harness.advance(1);
  assert.equal(harness.visible(), false);
  assert.equal(harness.timers.size, 0);
  assert.deepEqual(harness.posted, []);
});

test("click selection, Enter/Space selection, and close retain the original messages and dismiss", () => {
  for (const operation of ["click", "Enter", " ", "close"]) {
    const harness = createHarness();
    const anchor = harness.hover("b");
    harness.advance(1000);
    if (operation === "close") {
      anchor.querySelector(".conversation-tab-close")?.dispatch("click");
    } else {
      anchor.dispatch(operation === "click" ? "click" : "keydown", { key: operation });
    }
    assert.equal(harness.visible(), false, operation);
    assert.equal(harness.posted[0]?.type, operation === "close" ? "closeConversationTab" : "selectConversationTab");
    assert.equal(harness.posted[0]?.tabId, "b");
  }
});

test("running, errored and locked tabs remain readable while close stays disabled when required", () => {
  const harness = createHarness([
    { id: "a", cli: "codex", taskSummary: "正在运行的任务", running: true },
    { id: "b", cli: "codex", taskSummary: "执行失败的任务", errored: true },
    { id: "c", cli: "codex", taskSummary: "主任务摘要", locked: true },
  ]);
  for (const id of ["a", "b", "c"]) {
    harness.hover(id);
    harness.advance(1000);
    assert.equal(harness.visible(), true);
    assert.equal(harness.tab(id).querySelector(".conversation-tab-close")?.disabled, id !== "b");
    harness.tab(id).dispatch("mouseout");
  }
});

test("viewport invalidation dismisses visible and pending tooltips", () => {
  for (const type of ["resize", "scroll", "blur", "pagehide", "visibilitychange"]) {
    for (const delay of [500, 1000]) {
      const harness = createHarness();
      harness.hover("a");
      harness.advance(delay);
      if (type === "scroll") {
        harness.tab("a").rect.top -= 10;
      }
      const target = type === "visibilitychange" ? harness.document : harness.window;
      target.fire(type, { target: harness.root, preventDefault() {}, stopPropagation() {} }, type === "scroll");
      harness.advance(1000);
      assert.equal(harness.visible(), false, `${type}/${delay}`);
      assert.equal(harness.timers.size, 0);
    }
  }
});

test("positioning keeps 8px margins, wraps narrow content and flips above near the bottom", () => {
  for (const width of [800, 180]) {
    const harness = createHarness([{ id: "a", cli: "codex", taskSummary: "摘要".repeat(30) }]);
    harness.window.innerWidth = width;
    const anchor = harness.hover("a");
    anchor.rect = { left: width - 80, top: 550, width: 80, height: 24 };
    harness.advance(1000);
    const bounds = harness.tooltip()?.getBoundingClientRect();
    assert.ok(bounds);
    assert.ok(bounds.left >= 8);
    assert.ok(bounds.right <= width - 8);
    assert.ok(bounds.width <= 280);
    assert.ok(bounds.bottom <= anchor.rect.top - 8);
    assert.ok(bounds.top >= 8);
  }
  const harness = createHarness();
  harness.hover("a");
  harness.advance(1000);
  assert.equal(harness.tooltip()?.getBoundingClientRect().top, 52);
  assert.match(HEADER_TABS_STYLES, /\.conversation-tab-summary-tooltip\s*\{[^}]*position: fixed/);
  assert.match(HEADER_TABS_STYLES, /overflow-wrap: anywhere/);
  assert.match(HEADER_TABS_STYLES, /pointer-events: none/);
});

test("selecting the already active tab by keyboard still dismisses the summary", () => {
  for (const key of ["Enter", " "]) {
    const harness = createHarness();
    const anchor = harness.hover("a");
    harness.advance(1000);
    anchor.dispatch("keydown", { key });
    assert.equal(harness.visible(), false);
    assert.equal(harness.posted.length, 0);
  }
});

test("a queued focus scroll that leaves the anchor unchanged does not starve keyboard dwell", () => {
  const harness = createHarness();
  harness.tab("a").focus();
  harness.advance(500);
  harness.refresh();
  harness.window.fire("scroll", { target: harness.root, preventDefault() {}, stopPropagation() {} }, true);
  harness.advance(500);
  assert.equal(harness.visible(), true);
});

test("removing a summary during redraw cancels both pending and visible tooltips", () => {
  for (const delay of [500, 1000]) {
    const harness = createHarness();
    harness.hover("a");
    harness.advance(delay);
    harness.state.conversationTabs.tabs[0].taskSummary = "  ";
    harness.refresh();
    harness.advance(1000);
    assert.equal(harness.visible(), false);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.tab("a").getAttribute("aria-describedby"), null);
  }
});

test("paging away dismisses a visible tooltip without changing the selected tab", () => {
  const harness = createHarness(Array.from({ length: 4 }, (_item, index) => ({
    id: String(index), cli: "codex", taskSummary: "任务摘要",
  })));
  harness.hover("0");
  harness.advance(1000);
  harness.root.querySelector(".conversation-tabs-nav-next")?.dispatch("click");
  assert.equal(harness.visible(), false);
  assert.equal(harness.state.conversationTabs.activeTabId, "0");
  assert.equal(harness.tab("3").querySelector(".conversation-tab-label")?.textContent, "codex4");
  assert.deepEqual(harness.posted, []);
});

test("tiny viewports clamp vertically; hidden or zero-sized anchors cannot schedule", () => {
  const harness = createHarness([{ id: "a", cli: "codex", taskSummary: "摘要".repeat(30) }]);
  harness.window.innerWidth = 180;
  harness.window.innerHeight = 40;
  harness.tab("a").rect.top = 5;
  harness.hover("a");
  harness.advance(1000);
  const bounds = harness.tooltip()?.getBoundingClientRect();
  assert.ok(bounds);
  assert.equal(bounds.top, 8);
  assert.equal(bounds.bottom, 32);
  for (const condition of ["hidden", "zero", "outside", "too-small"]) {
    const invalid = createHarness();
    if (condition === "hidden") { invalid.document.hidden = true; }
    if (condition === "zero") { invalid.tab("a").rect.width = 0; }
    if (condition === "outside") { invalid.tab("a").rect.top = 700; }
    if (condition === "too-small") { invalid.window.innerWidth = 16; }
    invalid.hover("a");
    assert.equal(invalid.timers.size, 0);
    invalid.advance(1000);
    assert.equal(invalid.visible(), false);
  }
});
