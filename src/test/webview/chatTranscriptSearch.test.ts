import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";

import {
  buildChatTranscriptSearchRuntimeSource,
  collectChatSearchBlocks,
  findChatSearchHits,
  formatChatSearchCounter,
  moveChatSearchIndex,
  type ChatSearchDomNode,
} from "../../webview/chatTranscriptSearch";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_I18N } from "../../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_CHAT_SEARCH } from "../../webview/viewContentScript/chatSearch";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";
import { HEADER_TABS_STYLES } from "../../webview/viewContentStyles/headerTabs";
import { MESSAGE_BLOCK_STYLES } from "../../webview/viewContentStyles/messages";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function elementNode(tagName: string, ...children: ChatSearchDomNode[]): ChatSearchDomNode {
  return {
    nodeType: ELEMENT_NODE,
    tagName,
    childNodes: children,
  };
}

function textNode(value: string): ChatSearchDomNode {
  return {
    nodeType: TEXT_NODE,
    nodeValue: value,
    childNodes: [],
  };
}

test("finds literal matches inside one block and ignores other blocks, buttons, and blank queries", () => {
  const root = elementNode(
    "div",
    elementNode(
      "p",
      textNode("Alpha "),
      elementNode("strong", textNode("关")),
      elementNode("em", textNode("键词")),
    ),
    elementNode("p", textNode("ab")),
    elementNode("br"),
    elementNode("p", textNode("cd")),
    elementNode("button", textNode("关键词")),
    elementNode("p", textNode("aaaa")),
    elementNode("p", textNode("aaa")),
    elementNode("p", textNode("use a.b literally")),
  );
  const blocks = collectChatSearchBlocks(root);

  const chinese = findChatSearchHits(blocks, " 关键词 ");
  assert.equal(chinese.length, 1);
  assert.equal(chinese[0].ranges.length, 2);
  assert.equal(chinese[0].ranges[0].start, 0);
  assert.equal(chinese[0].ranges[0].end, 1);
  assert.equal(chinese[0].ranges[1].end, 2);

  assert.equal(findChatSearchHits(blocks, "abcd").length, 0);
  assert.equal(findChatSearchHits(blocks, "AB").length, 1);
  assert.equal(findChatSearchHits(blocks, "aaaa").length, 1);
  assert.equal(findChatSearchHits(blocks, "aa").length, 3);
  assert.equal(findChatSearchHits(blocks, ".*").length, 0);
  assert.equal(findChatSearchHits(blocks, "a.b").length, 1);
  assert.deepEqual(findChatSearchHits(blocks, "   "), []);
  assert.deepEqual(findChatSearchHits(blocks, 12), []);
  assert.deepEqual(collectChatSearchBlocks(null), []);
  assert.deepEqual(findChatSearchHits(null, "关键词"), []);
});

test("moves the active match with wraparound and formats an empty counter", () => {
  assert.equal(moveChatSearchIndex(0, 0, 1), -1);
  assert.equal(moveChatSearchIndex(Number.NaN, 3, 1), 0);
  assert.equal(moveChatSearchIndex(2, 3, 1), 0);
  assert.equal(moveChatSearchIndex(0, 3, -1), 2);
  assert.equal(moveChatSearchIndex(0, 1, -1), 0);
  assert.equal(formatChatSearchCounter(-1, 0), "0/0");
  assert.equal(formatChatSearchCounter(0, 2), "1/2");
  assert.equal(formatChatSearchCounter(5, 2), "0/2");
});

test("embeds executable search helpers without TypeScript syntax", () => {
  const source = buildChatTranscriptSearchRuntimeSource();
  assert.match(source, /function collectChatSearchBlocks/);
  assert.match(source, /function findChatSearchHits/);
  assert.doesNotMatch(source, /:\s*(string|number|boolean)/);

  const sandbox: { module: { exports: Record<string, unknown> }; exports: Record<string, unknown> } = {
    module: { exports: {} },
    exports: {},
  };
  vm.runInNewContext(
    `${source}
      module.exports = { collectChatSearchBlocks, findChatSearchHits, formatChatSearchCounter };`,
    sandbox,
  );
  const exported = sandbox.module.exports as {
    collectChatSearchBlocks: typeof collectChatSearchBlocks;
    findChatSearchHits: typeof findChatSearchHits;
    formatChatSearchCounter: typeof formatChatSearchCounter;
  };
  const blocks = exported.collectChatSearchBlocks(elementNode("p", textNode("Hello KEY")));
  assert.equal(exported.findChatSearchHits(blocks, "key").length, 1);
  assert.equal(exported.formatChatSearchCounter(0, 1), "1/1");
});

class SearchNode {
  nodeType: number;
  nodeValue: string | null;
  tagName: string;
  className = "";
  childNodes: SearchNode[] = [];
  parentNode: SearchNode | null = null;
  attributes: Record<string, string> = {};
  hidden = false;
  open = false;
  value = "";
  textContent = "";
  focused = false;
  selected = false;
  scrolled = 0;
  listeners: Record<string, Array<(event?: any) => void>> = {};

  constructor(nodeType: number, tagName = "") {
    this.nodeType = nodeType;
    this.tagName = tagName.toUpperCase();
    this.nodeValue = nodeType === TEXT_NODE ? "" : null;
  }

  get firstChild(): SearchNode | null {
    return this.childNodes[0] || null;
  }

  get parentElement(): SearchNode | null {
    return this.parentNode && this.parentNode.nodeType === ELEMENT_NODE ? this.parentNode : null;
  }

  get classList(): { add: (name: string) => void; remove: (name: string) => void } {
    return {
      add: (name: string) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        names.add(name);
        this.className = Array.from(names).join(" ");
      },
      remove: (name: string) => {
        this.className = this.className.split(/\s+/).filter((item) => item && item !== name).join(" ");
      },
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
    if (name === "class") {
      this.className = String(value);
    }
    if (name === "hidden") {
      this.hidden = true;
    }
    if (name === "open") {
      this.open = true;
    }
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === "hidden") {
      this.hidden = false;
    }
    if (name === "open") {
      this.open = false;
    }
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  appendChild(child: SearchNode): SearchNode {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: SearchNode, before: SearchNode | null): SearchNode {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index >= 0) {
      this.childNodes.splice(index, 0, child);
    } else {
      this.childNodes.push(child);
    }
    return child;
  }

  removeChild(child: SearchNode): SearchNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  splitText(offset: number): SearchNode {
    const value = this.nodeValue || "";
    const next = new SearchNode(TEXT_NODE);
    next.nodeValue = value.slice(offset);
    this.nodeValue = value.slice(0, offset);
    if (this.parentNode) {
      const index = this.parentNode.childNodes.indexOf(this);
      next.parentNode = this.parentNode;
      this.parentNode.childNodes.splice(index + 1, 0, next);
    }
    return next;
  }

  normalize(): void {
    for (let index = 0; index < this.childNodes.length; index += 1) {
      const current = this.childNodes[index];
      const next = this.childNodes[index + 1];
      if (current.nodeType === TEXT_NODE && next && next.nodeType === TEXT_NODE) {
        current.nodeValue = `${current.nodeValue || ""}${next.nodeValue || ""}`;
        this.childNodes.splice(index + 1, 1);
        next.parentNode = null;
        index -= 1;
        continue;
      }
      if (current.nodeType === ELEMENT_NODE) {
        current.normalize();
      }
    }
  }

  querySelectorAll(selector: string): SearchNode[] {
    const result: SearchNode[] = [];
    const visit = (node: SearchNode): void => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === ELEMENT_NODE && child.matches(selector)) {
          result.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return result;
  }

  matches(selector: string): boolean {
    if (selector !== "mark.chat-search-hit") {
      return false;
    }
    return this.tagName === "MARK" && this.className.split(/\s+/).includes("chat-search-hit");
  }

  addEventListener(type: string, listener: (event?: any) => void): void {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): Record<string, unknown> {
    const normalized = event;
    normalized.type = type;
    normalized.target ||= this;
    normalized.defaultPrevented = false;
    normalized.preventDefault ||= () => {
      normalized.defaultPrevented = true;
    };
    (this.listeners[type] || []).forEach((listener) => listener(normalized));
    return normalized;
  }

  click(): void {
    this.dispatch("click");
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {
    this.selected = true;
  }

  scrollIntoView(): void {
    this.scrolled += 1;
  }
}

function searchElement(tagName: string, ...children: SearchNode[]): SearchNode {
  const node = new SearchNode(ELEMENT_NODE, tagName);
  children.forEach((child) => node.appendChild(child));
  return node;
}

function searchText(value: string): SearchNode {
  const node = new SearchNode(TEXT_NODE);
  node.nodeValue = value;
  return node;
}

function nodeText(node: SearchNode): string {
  if (node.nodeType === TEXT_NODE) {
    return node.nodeValue || "";
  }
  return node.childNodes.map((child) => nodeText(child)).join("");
}

test("highlights the active tab, anchors the current match, and restores text on close", () => {
  const outside = searchText("outside keyword");
  const hiddenDetails = searchElement("details", searchElement("p", searchText("hidden keyword")));
  const firstParagraph = searchElement(
    "p",
    searchText("Alpha "),
    searchElement("strong", searchText("keyword")),
    searchText(" tail"),
  );
  const messages = searchElement(
    "div",
    searchElement(
      "div",
      firstParagraph,
      searchElement("p", searchText("other keyword")),
      searchElement("button", searchText("keyword action")),
      hiddenDetails,
    ),
  );
  const button = new SearchNode(ELEMENT_NODE, "svg");
  const bar = new SearchNode(ELEMENT_NODE, "div");
  const input = new SearchNode(ELEMENT_NODE, "input");
  const count = new SearchNode(ELEMENT_NODE, "span");
  const previous = new SearchNode(ELEMENT_NODE, "button");
  const next = new SearchNode(ELEMENT_NODE, "button");
  const close = new SearchNode(ELEMENT_NODE, "button");
  const listeners: Record<string, Array<(event?: any) => void>> = {};
  const world = { tabId: "tab-a" };
  const sandbox = {
    elements: {
      messages,
      chatSearchButton: button,
      chatSearchBar: bar,
      chatSearchInput: input,
      chatSearchCount: count,
      chatSearchPrev: previous,
      chatSearchNext: next,
      chatSearchClose: close,
    },
    document: {
      body: new SearchNode(ELEMENT_NODE, "body"),
      documentElement: new SearchNode(ELEMENT_NODE, "html"),
      createElement: (tagName: string) => new SearchNode(ELEMENT_NODE, tagName),
    },
    window: {
      addEventListener(type: string, listener: (event?: any) => void) {
        (listeners[type] ||= []).push(listener);
      },
      dispatch(type: string, event: Record<string, unknown>) {
        (listeners[type] || []).forEach((listener) => listener(event));
      },
    },
    t(key: string, params?: Record<string, string>) {
      const template = key === "chatSearchCountAria" ? "第 {current} 条，共 {total} 条" : key;
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => (
        params && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : _match
      ));
    },
    getActiveConversationTabId: () => world.tabId,
    outside,
    console,
  };
  vm.runInNewContext(
    `${VIEW_CONTENT_SCRIPT_CHAT_SEARCH}
      this.openChatSearch = openChatSearch;
      this.closeChatSearch = closeChatSearch;
      this.refreshChatSearchHighlights = refreshChatSearchHighlights;
      this.isChatSearchAnchored = isChatSearchAnchored;`,
    sandbox,
  );
  const api = sandbox as typeof sandbox & {
    openChatSearch: () => void;
    closeChatSearch: () => void;
    refreshChatSearchHighlights: (options?: { reveal?: boolean; resetIndex?: boolean }) => void;
    isChatSearchAnchored: () => boolean;
  };

  assert.equal(bar.hidden, true);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(api.isChatSearchAnchored(), false);

  button.click();
  assert.equal(bar.hidden, false);
  assert.equal(button.className, "is-open");
  assert.equal(input.focused, true);
  assert.equal(input.selected, true);

  input.value = "keyword";
  input.dispatch("input");
  const marks = () => messages.querySelectorAll("mark.chat-search-hit");
  const active = () => marks().filter((mark) => mark.className.split(/\s+/).includes("is-active"));
  assert.equal(marks().length, 3);
  assert.equal(active().length, 1);
  assert.equal(active()[0].textContent || nodeText(active()[0]), "keyword");
  assert.equal(count.textContent, "1/3");
  assert.equal(count.getAttribute("aria-label"), "第 1 条，共 3 条");
  assert.equal(active()[0].scrolled, 1);
  assert.equal(hiddenDetails.open, false);
  assert.equal(nodeText(outside), "outside keyword");
  assert.equal(api.isChatSearchAnchored(), true);

  next.click();
  assert.equal(count.textContent, "2/3");
  assert.equal(nodeText(active()[0]), "keyword");
  const activeParent = active()[0].parentNode;
  if (!activeParent) {
    throw new Error("active match has no parent");
  }
  assert.equal(nodeText(activeParent), "other keyword");

  input.dispatch("keydown", { key: "Enter", shiftKey: false });
  assert.equal(count.textContent, "3/3");
  assert.equal(hiddenDetails.open, true);
  assert.equal(active()[0].scrolled, 1);

  previous.click();
  assert.equal(count.textContent, "2/3");
  sandbox.window.dispatch("keydown", { key: "F3", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(count.textContent, "3/3");
  sandbox.window.dispatch("keydown", { key: "F3", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(count.textContent, "2/3");

  input.value = "KEY";
  input.dispatch("compositionstart");
  input.dispatch("input");
  assert.equal(count.textContent, "2/3");
  input.dispatch("compositionend");
  assert.equal(count.textContent, "1/3");

  input.value = ".*";
  input.dispatch("input");
  assert.equal(count.textContent, "0/0");
  assert.equal(marks().length, 0);
  next.click();
  assert.equal(count.textContent, "0/0");

  input.value = "keyword";
  input.dispatch("input");
  world.tabId = "tab-b";
  messages.childNodes.splice(0, messages.childNodes.length);
  messages.appendChild(searchElement("p", searchText("no match")));
  api.refreshChatSearchHighlights();
  assert.equal(count.textContent, "0/0");
  assert.equal(marks().length, 0);

  world.tabId = "tab-a";
  messages.childNodes.splice(0, messages.childNodes.length);
  messages.appendChild(firstParagraph);
  api.refreshChatSearchHighlights({ reveal: true, resetIndex: true });
  assert.equal(count.textContent, "1/1");
  input.dispatch("keydown", { key: "Escape" });
  assert.equal(bar.hidden, true);
  assert.equal(marks().length, 0);
  assert.equal(nodeText(firstParagraph), "Alpha keyword tail");
  assert.equal(input.value, "keyword");
  assert.equal(api.isChatSearchAnchored(), false);

  api.openChatSearch();
  assert.equal(marks().length, 1);
  close.click();
  assert.equal(marks().length, 0);

  const prevented = { key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
  sandbox.window.dispatch("keydown", prevented);
  assert.equal(prevented.defaultPrevented, true);
  assert.equal(bar.hidden, false);
  const ignored = { key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
  sandbox.window.dispatch("keydown", ignored);
  assert.equal(ignored.defaultPrevented, false);

  messages.querySelectorAll = () => {
    throw new Error("search root failed");
  };
  assert.doesNotThrow(() => api.refreshChatSearchHighlights());
});

test("keeps the search shell, theme tokens, and rerender hook together", () => {
  for (const key of [
    "headerChatSearch",
    "chatSearchPlaceholder",
    "chatSearchPrev",
    "chatSearchNext",
    "chatSearchClose",
    "chatSearchCountAria",
  ]) {
    assert.equal(typeof WEBVIEW_I18N.en[key as keyof typeof WEBVIEW_I18N.en], "string");
    assert.equal(typeof WEBVIEW_I18N["zh-CN"][key as keyof typeof WEBVIEW_I18N["zh-CN"]], "string");
  }
  const html = buildWebviewStaticHtml({
    locale: "zh-CN",
    cspSource: "vscode-resource://test",
    nonce: "nonce",
    i18n: getWebviewStrings("zh-CN"),
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main",
    loopExecutionModeDebateMultiAgent: "debate",
  });
  assert.match(html, /id="chatSearchButton"[\s\S]*id="newSession"[\s\S]*id="resetSession"/);
  assert.match(html, /id="chatSearchInput"[^>]*placeholder="关键词"/);
  assert.match(html, /id="chatSearchCount"[^>]*>0\/0</);
  assert.match(HEADER_TABS_STYLES, /\.chat-search-bar \{[\s\S]*var\(--vscode-editorWidget-background/);
  assert.match(MESSAGE_BLOCK_STYLES, /mark\.chat-search-hit \{[\s\S]*background: #fff2a8;[\s\S]*color: #000000;/);
  assert.match(MESSAGE_BLOCK_STYLES, /mark\.chat-search-hit\.is-active \{[\s\S]*background: #fff2a8;[\s\S]*color: #000000;/);
  assert.doesNotMatch(HEADER_TABS_STYLES.slice(HEADER_TABS_STYLES.indexOf(".chat-search-bar")), /#[0-9a-fA-F]{3,8}/);
  assert.match(
    VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
    /forceCollapseToolResultBubbles\(\);[\s\S]*updateTaskList\(\);[\s\S]*refreshChatSearchHighlights\(\);/,
  );
  assert.match(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, /const chatSearchAnchored = typeof isChatSearchAnchored/);
  assert.match(VIEW_CONTENT_SCRIPT_TRACE_RENDERING, /const chatSearchAnchored = typeof isChatSearchAnchored === "function" && isChatSearchAnchored\(\);/);
});
