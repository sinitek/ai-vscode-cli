import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";

import { installVscodeMock } from "../vscodeMock";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";

installVscodeMock();

type MiniNode = {
  nodeType: number;
  nodeName: string;
  parentNode: MiniNode | null;
  childNodes: MiniNode[];
  textContent: string;
  appendChild: (child: MiniNode) => MiniNode;
  removeChild: (child: MiniNode) => MiniNode;
  readonly children: MiniElement[];
};

type MiniElement = MiniNode & {
  tagName: string;
  attrs: Record<string, string>;
  styleProps: Record<string, string>;
  classList: MiniClassList;
  style: { setProperty: (name: string, value: string) => void };
  className: string;
  listeners: Record<string, Array<() => void>>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, handler: () => void) => void;
  click: () => void;
  querySelector: (selector: string) => MiniElement | null;
  querySelectorAll: (selector: string) => MiniElement[];
};

class MiniClassList {
  readonly names = new Set<string>();

  add(...classNames: string[]): void {
    classNames.forEach((className) => {
      if (className) {
        this.names.add(className);
      }
    });
  }

  remove(...classNames: string[]): void {
    classNames.forEach((className) => this.names.delete(className));
  }

  toggle(className: string): boolean {
    if (this.names.has(className)) {
      this.names.delete(className);
      return false;
    }
    this.names.add(className);
    return true;
  }

  contains(className: string): boolean {
    return this.names.has(className);
  }

  setFrom(value: string): void {
    this.names.clear();
    String(value || "").split(/\s+/).filter(Boolean).forEach((className) => this.names.add(className));
  }
}

class MiniText implements MiniNode {
  nodeType = 3;
  nodeName = "#text";
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  nodeValue: string;

  constructor(value: string) {
    this.nodeValue = value;
  }

  get textContent(): string {
    return this.nodeValue;
  }

  set textContent(value: string) {
    this.nodeValue = String(value);
  }

  appendChild(child: MiniNode): MiniNode {
    return child;
  }

  removeChild(child: MiniNode): MiniNode {
    return child;
  }

  get children(): MiniElement[] {
    return [];
  }
}

class MiniElementImpl implements MiniElement {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  attrs: Record<string, string> = {};
  styleProps: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  classList = new MiniClassList();
  style = {
    setProperty: (name: string, value: string) => {
      this.styleProps[name] = value;
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) {
      this.appendChild(new MiniText(String(value)));
    }
  }

  get className(): string {
    return Array.from(this.classList.names).join(" ");
  }

  set className(value: string) {
    this.classList.setFrom(value);
  }

  set innerHTML(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: MiniNode): MiniNode {
    if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: MiniNode): MiniNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  get children(): MiniElement[] {
    return this.childNodes.filter((child): child is MiniElement => child.nodeType === 1);
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  addEventListener(type: string, handler: () => void): void {
    const handlers = this.listeners[type] || [];
    handlers.push(handler);
    this.listeners[type] = handlers;
  }

  click(): void {
    (this.listeners.click || []).forEach((handler) => handler());
  }

  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): MiniElement[] {
    const matches: MiniElement[] = [];
    const visit = (node: MiniElement) => {
      node.children.forEach((child) => {
        if (elementMatches(child, selector)) {
          matches.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

function elementMatches(element: MiniElement, selector: string): boolean {
  if (selector.startsWith(".") && !selector.includes(" ")) {
    return element.classList.contains(selector.slice(1));
  }
  const match = /^([a-z0-9]+)\.([\w-]+)$/i.exec(selector);
  if (!match) {
    return false;
  }
  return element.tagName.toLowerCase() === match[1] && element.classList.contains(match[2]);
}

function installMiniDocument(): MiniElement {
  const documentElement = new MiniElementImpl("html");
  const head = new MiniElementImpl("head");
  documentElement.appendChild(head);
  const documentStub = {
    createElement: (tagName: string) => new MiniElementImpl(tagName),
    createTextNode: (value: string) => new MiniText(value),
    head,
  };
  const globalObject = globalThis as typeof globalThis & {
    document?: typeof documentStub;
    window?: typeof globalThis;
    Node?: typeof MiniElementImpl;
  };
  globalObject.Node = MiniElementImpl;
  globalObject.document = documentStub;
  globalObject.window = globalObject.window || globalThis;
  return head;
}

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

type JsonTreeRuntime = {
  parseCompleteJsonContainer: (content: string) => unknown;
  renderMarkdown: (content: string) => string;
  renderAssistantMessageContent: (message: Record<string, unknown>, index: number) => string;
  mountJsonTreeHosts: (root: MiniElement) => void;
  createJsonTreeElement: (value: unknown) => MiniElement | null;
};

function loadJsonTreeRuntime(options: {
  JSONFormatter?: unknown;
  assistantStreamingMarkdownPending?: Record<string, boolean>;
  isFinal?: boolean;
} = {}): JsonTreeRuntime {
  const names = [
    "getMessageCollapseThreshold",
    "normalizeCollapsePreviewText",
    "shouldCollapseByContentLength",
    "buildBubbleCollapseSummaryText",
    "renderCollapsibleBubbleContent",
    "getAssistantMessageContentForDisplay",
    "isAssistantMarkdownRenderPending",
    "renderAssistantStreamingPlainText",
    "renderAssistantMessageContent",
    "parseJsonContainerText",
    "unwrapSingleMarkdownFence",
    "parseCompleteJsonContainer",
    "serializeJsonTreeSource",
    "renderJsonTreeHost",
    "createJsonTreeElement",
    "mountJsonTreeHosts",
    "renderMarkdown",
    "isLineNumberedLine",
    "wrapLineNumberedBlocks",
  ];
  const source = names.map((name) => extractFunctionSource(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING.replace(/\$\{FINAL_ANSWER_TEXT_MARKER\}/g, "[final_answer]"),
    name,
  )).join("\n");
  const markedCalls: string[] = [];
  return new Function(
    "JSONFormatter",
    "document",
    "t",
    "marked",
    "traceCollapsibleOpenKeys",
    "assistantStreamingMarkdownPending",
    "isFinalAssistantSummaryMessage",
    "markedCalls",
    `function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    function getTracePresentation() { return { type: "text" }; }
    function isTransparentBubbleMessage() { return false; }
    function isThinkingLikeMessage() { return false; }
    function isCodexReasoningStyleMessage() { return false; }
    ${source}
    return {
      parseCompleteJsonContainer,
      renderMarkdown,
      renderAssistantMessageContent,
      mountJsonTreeHosts,
      createJsonTreeElement,
    };`,
  )(
    options.JSONFormatter,
    (globalThis as { document?: unknown }).document,
    (key: string) => WEBVIEW_STRINGS[key as keyof typeof WEBVIEW_STRINGS] || key,
    {
      parse: (content: string) => {
        markedCalls.push(content);
        return `<p>${content}</p>`;
      },
      Renderer: class {
        html(value: string): string {
          return value;
        }
      },
    },
    new Set<string>(),
    options.assistantStreamingMarkdownPending || {},
    () => Boolean(options.isFinal),
    markedCalls,
  ) as JsonTreeRuntime;
}

function scriptPayload(html: string): unknown {
  const match = html.match(/<script type="application\/json" class="json-tree-source">([\s\S]*)<\/script>/);
  assert.ok(match, html);
  assert.doesNotMatch(match?.[1] || "", /[<>&]/);
  return JSON.parse(match?.[1] || "");
}

function rowsOf(element: MiniElement): MiniElement[] {
  const rows: MiniElement[] = [];
  const visit = (node: MiniElement) => {
    if (node.classList.contains("json-formatter-row")) {
      rows.push(node);
    }
    node.children.forEach(visit);
  };
  visit(element);
  return rows;
}

test("renders a complete JSON object or array as an expandable JSON tree host", () => {
  installMiniDocument();
  const runtime = loadJsonTreeRuntime();
  const payload = {
    title: "结果",
    ok: true,
    count: 2,
    note: "</script><img alt=\"x\">&",
    gap: `line${String.fromCharCode(8232)}break`,
    nested: { items: [null, "keep"] },
  };

  assert.deepEqual(runtime.parseCompleteJsonContainer(`\n${JSON.stringify(payload)}\n`), payload);
  assert.deepEqual(runtime.parseCompleteJsonContainer(`${String.fromCharCode(65279)}[]`), []);
  assert.deepEqual(runtime.parseCompleteJsonContainer("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(runtime.parseCompleteJsonContainer("~~~\n[{\"a\":true}]\n~~~"), [{ a: true }]);
  assert.equal(runtime.parseCompleteJsonContainer("\"text\""), null);
  assert.equal(runtime.parseCompleteJsonContainer("12"), null);
  assert.equal(runtime.parseCompleteJsonContainer("true"), null);
  assert.equal(runtime.parseCompleteJsonContainer("null"), null);
  assert.equal(runtime.parseCompleteJsonContainer("{broken"), null);
  assert.equal(runtime.parseCompleteJsonContainer("see {\"a\":1}"), null);
  assert.equal(runtime.parseCompleteJsonContainer("```json\n{\"a\":1}\n```\n\nmore"), null);
  assert.equal(runtime.parseCompleteJsonContainer(""), null);

  const html = runtime.renderMarkdown(JSON.stringify(payload));
  assert.deepEqual(scriptPayload(html), payload);
  assert.match(html, /^<div class="json-tree-host">/);
  assert.equal(runtime.renderMarkdown("hello **md**"), "<p>hello **md**</p>");
  assert.equal(runtime.renderMarkdown(""), "");

  const longJson = JSON.stringify({ message: "x".repeat(80), child: { open: true } });
  const bubble = runtime.renderAssistantMessageContent({ role: "assistant", content: longJson }, 0);
  assert.match(bubble, /json-tree-host/);
  assert.doesNotMatch(bubble, /trace-collapsible/);
  assert.match(
    runtime.renderAssistantMessageContent({ role: "assistant", content: "y".repeat(80) }, 0),
    /trace-collapsible/,
  );
  const streaming = loadJsonTreeRuntime({
    assistantStreamingMarkdownPending: { stream: true },
  });
  assert.match(
    streaming.renderAssistantMessageContent({ role: "assistant", id: "stream", content: longJson }, 0),
    /assistant-message-content-streaming/,
  );
});

test("mounts json-formatter-js with two expanded levels and lets a node collapse", () => {
  installMiniDocument();
  const JSONFormatter = require("json-formatter-js") as new (
    value: unknown,
    open?: number,
    config?: Record<string, unknown>,
  ) => { render: () => MiniElement };
  const runtime = loadJsonTreeRuntime({ JSONFormatter });
  const bubble = new MiniElementImpl("div");
  const host = new MiniElementImpl("div");
  host.className = "json-tree-host";
  const source = new MiniElementImpl("script");
  source.className = "json-tree-source";
  source.textContent = JSON.stringify({
    levelOne: {
      levelTwo: {
        levelThree: { enabled: false },
      },
    },
  });
  host.appendChild(source);
  bubble.appendChild(host);

  runtime.mountJsonTreeHosts(bubble);
  const renderedRows = rowsOf(host).filter((row) => row.querySelector(".json-formatter-toggler"));
  assert.equal(renderedRows.length, 3);
  assert.equal(renderedRows[0].classList.contains("json-formatter-open"), true);
  assert.equal(renderedRows[1].classList.contains("json-formatter-open"), true);
  assert.equal(renderedRows[2].classList.contains("json-formatter-open"), false);
  assert.equal(renderedRows[2].querySelector("div.json-formatter-children")?.children.length || 0, 0);
  assert.equal(host.styleProps["--json-tree-empty-object-label"], JSON.stringify(WEBVIEW_STRINGS.jsonTreeEmptyObject));
  assert.equal(host.getAttribute("data-json-tree-mounted"), "true");

  const root = renderedRows[0];
  const toggler = root.children.find((child) => child.classList.contains("json-formatter-toggler-link"));
  if (!toggler) {
    assert.fail("missing json toggler");
  }
  toggler.click();
  assert.equal(root.classList.contains("json-formatter-open"), false);
  const children = root.querySelector("div.json-formatter-children");
  assert.equal(children?.children.length || 0, 0);
  toggler.click();
  assert.equal(root.classList.contains("json-formatter-open"), true);
  assert.ok((root.querySelector("div.json-formatter-children")?.children.length || 0) > 0);

  runtime.mountJsonTreeHosts(bubble);
  assert.equal(host.children.filter((child) => child.classList.contains("json-formatter-row")).length, 1);

  const invalid = new MiniElementImpl("div");
  invalid.className = "json-tree-host";
  const invalidSource = new MiniElementImpl("script");
  invalidSource.className = "json-tree-source";
  invalidSource.textContent = "\"nope\"";
  invalid.appendChild(invalidSource);
  runtime.mountJsonTreeHosts(invalid);
  assert.equal(invalid.getAttribute("data-json-tree-mounted"), null);

  const fallback = loadJsonTreeRuntime().createJsonTreeElement({ a: 1 });
  assert.equal(fallback?.classList.contains("json-tree-fallback"), true);
  assert.match(fallback?.textContent || "", /"a": 1/);
  const broken = loadJsonTreeRuntime({
    JSONFormatter: function BrokenFormatter() {
      throw new Error("formatter failed");
    },
  }).createJsonTreeElement([1]);
  assert.equal(broken?.classList.contains("json-tree-fallback"), true);
});

test("inlines the JSON formatter runtime into the chat webview", () => {
  const viewContentPath = require.resolve("../../webview/viewContent");
  const loadHtml = () => {
    delete require.cache[viewContentPath];
    const { getWebviewHtml } = require("../../webview/viewContent") as typeof import("../../webview/viewContent");
    return getWebviewHtml({ cspSource: "vscode-resource://json-tree" });
  };
  const html = loadHtml();
  assert.match(html, /JSONFormatter=/);
  assert.match(html, /function parseCompleteJsonContainer/);
  assertInlineScriptsCanBeDocumentWritten(html);
  assert.equal(WEBVIEW_STRINGS.jsonTreeEmptyObject, "No properties");
  assert.equal(WEBVIEW_STRINGS.jsonTreeEmptyObject, "无属性");

  const fsModule = require("fs") as { readFileSync: (...args: any[]) => string };
  const originalReadFileSync = fsModule.readFileSync;
  fsModule.readFileSync = (target: fs.PathOrFileDescriptor, ...args: any[]) => {
    if (String(target).includes("json-formatter.umd.js")) {
      throw new Error("json formatter missing by test");
    }
    return originalReadFileSync(target, ...args);
  };
  try {
    const fallbackHtml = loadHtml();
    assert.match(fallbackHtml, /function parseCompleteJsonContainer/);
    assert.doesNotMatch(fallbackHtml, /\.JSONFormatter=/);
    assertInlineScriptsCanBeDocumentWritten(fallbackHtml);
  } finally {
    fsModule.readFileSync = originalReadFileSync;
    delete require.cache[viewContentPath];
  }
});

function extractInlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  const lower = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const open = lower.indexOf("<script", cursor);
    if (open < 0) {
      break;
    }
    const openEnd = html.indexOf(">", open);
    if (openEnd < 0) {
      throw new Error("inline script start tag was not closed");
    }
    const close = lower.indexOf("</script", openEnd + 1);
    if (close < 0) {
      throw new Error("inline script was not closed");
    }
    bodies.push(html.slice(openEnd + 1, close));
    const closeEnd = html.indexOf(">", close);
    cursor = closeEnd < 0 ? close + "</script".length : closeEnd + 1;
  }
  return bodies;
}

function assertInlineScriptsCanBeDocumentWritten(html: string): void {
  const scripts = extractInlineScriptBodies(html);
  assert.equal(scripts.length, 3);
  for (const body of scripts) {
    assert.doesNotMatch(body, /<\/script/i);
    new Script(body);
  }
  assert.match(scripts[2], /function renderJsonTreeHost/);
  assert.match(scripts[2], /vscode\.postMessage\(\{ type: "requestState" \}\)/);
  assert.ok(scripts[2].includes("<\\/script>"));
}
