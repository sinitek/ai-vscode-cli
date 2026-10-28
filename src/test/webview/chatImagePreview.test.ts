import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";
import { buildChatImagePreviewHtml, createChatSvgImageSource, normalizeChatImageSource } from "../../webview/chatImagePreview";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../../webview/viewContentScript/eventBindings";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { MARKDOWN_STYLES } from "../../webview/viewContentStyles/markdown";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";

function loadRenderer(overrides: Record<string, unknown> = {}) {
  const source = VIEW_CONTENT_SCRIPT_TRACE_RENDERING.slice(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING.indexOf("      function renderChatImage("),
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING.indexOf("      function isLineNumberedLine("),
  );
  const sandbox = { normalizeChatImageSource, createChatSvgImageSource, ...overrides };
  const markedPath = path.join(__dirname, "../../..", "media", "marked.min.js");
  return new Script(`${fs.readFileSync(markedPath, "utf8")}
    function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function parseCompleteJsonContainer() { return null; }
    function wrapLineNumberedBlocks(value) { return value; }
    ${source}
    Object.assign(renderMarkdown, { applyChatImageSource });
  `).runInNewContext(sandbox) as ((content: string) => string) & { applyChatImageSource: (data: Record<string, unknown>) => void };
}

test("requests local image bytes once, updates decoded images and retains readable load errors", () => {
  const posted: Array<{ type: string; source: string }> = [];
  const image = { src: "" };
  const status = { textContent: "" };
  const button = {
    getAttribute: () => "/tmp/图.png",
    querySelector: () => image,
    parentElement: { querySelector: () => status },
  };
  const render = loadRenderer({
    vscode: { postMessage: (message: { type: string; source: string }) => posted.push(message) },
    document: { querySelectorAll: () => [button] },
  });
  const markdown = "![本地](/tmp/图.png)";
  render(markdown);
  render(markdown);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "resolveChatImage");
  render.applyChatImageSource({ source: "/tmp/图.png", resolvedSource: pixel });
  assert.equal(image.src, pixel);
  assert.equal(status.textContent, "");
  assert.match(render(markdown), /<img src="data:image\/png;base64,/);
  render.applyChatImageSource({ source: "/tmp/图.png", error: "文件不存在" });
  assert.equal(status.textContent, "文件不存在");
  assert.match(render(markdown), /文件不存在/);
  render.applyChatImageSource({ source: "/tmp/unknown.png", resolvedSource: pixel });
  assert.equal(posted.length, 1);
});

test("allows HTTP(S), data images and local paths while rejecting executable sources", () => {
  for (const source of ["https://example.com/image.png?token=a&size=2", "http://127.0.0.1/image.png", pixel, "file:///tmp/image.png", "C:\\image.png", "/tmp/image.png", "../image.png", "~/图.png"]) {
    assert.equal(normalizeChatImageSource(source), source);
  }
  assert.equal(normalizeChatImageSource("https://file+.vscode-resource.vscode-cdn.net/tmp/image.png"), "file:///tmp/image.png");
  for (const source of [null, 123, "", "javascript:alert(1)", "javascript:fake.png", "file:///tmp/secret.txt", "//example.com/image.png", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA", "https://user:secret@example.com/image.png", "image\u0000.png"]) {
    assert.equal(normalizeChatImageSource(source), null);
  }
});

test("renders clickable images through the actual bundled Marked parser and escapes attributes", () => {
  const render = loadRenderer();
  const html = render('![图片" onerror="alert(1)](https://example.com/image.png "图片标题")');
  assert.match(html, /<button type="button" class="chat-image-preview"/);
  assert.match(html, /<img src="https:\/\/example.com\/image.png"/);
  assert.match(html, /&quot; onerror=&quot;/);
  assert.doesNotMatch(html, / onerror="/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.match(render(`![示例](${pixel})`), /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(render("![无效](javascript:alert%281%29)"), /<img|<button/);
  const localImage = render('![本地](file:///tmp/image.png)');
  assert.match(localImage, /data-image-src="file:\/\/\/tmp\/image.png"/);
  assert.doesNotMatch(localImage, /<img src="file:/);
  assert.match(localImage, /正在加载本地图片/);
  assert.match(html, /class="chat-image-download"[\s\S]*>下载图片<\/a>/);
  assert.doesNotMatch(render('`![代码](https://example.com/image.png)`'), /<img/);
  assert.doesNotMatch(render('<img src="https://example.com/image.png" onerror="alert(1)">'), /<img/);
  assert.match(render("![**重点**](https://example.com/image.png)"), /data-image-alt="\*\*重点\*\*"/);
});

test("normalizes self-contained SVG markup and encoded or base64 SVG data URLs", () => {
  const svg = '<svg viewBox="0 0 320 100"><text x="20" y="40">中文图示</text></svg>';
  const source = createChatSvgImageSource(svg);
  assert.ok(source);
  assert.match(decodeURIComponent(source), /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(decodeURIComponent(source), /<svg width="320" height="100"/);
  assert.match(decodeURIComponent(source), /中文图示/);
  assert.equal(normalizeChatImageSource(source), source);
  assert.equal(normalizeChatImageSource("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")), source);
  assert.equal(normalizeChatImageSource("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)), source);
  assert.ok(createChatSvgImageSource('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.match(decodeURIComponent(createChatSvgImageSource('<svg width="200" height="40" viewBox="0 0 320 100"/>')!), /<svg xmlns="[^"]+" width="200" height="40"/);
  for (const invalid of [null, "<html></html>", "<svg:invalid/>", "<svg>", "<svg><rect/>", "<svg/><rect/>", "<svg>\ud800</svg>", '<!DOCTYPE svg><svg/>', '<svg><!ENTITY test "text"></svg>', "<svg>" + " ".repeat(256 * 1024) + "</svg>", "<svg>" + "中".repeat(100000) + "</svg>"]) {
    assert.equal(createChatSvgImageSource(invalid), null);
  }
  for (const invalid of ["data:image/svg+xml,%ZZ", "data:image/svg+xml;base64,!!!", "data:image/svg+xml;base64,AAAA", "data:image/svg+xml,%3Chtml%2F%3E", "data:image/svg+xml," + " ".repeat(3 * 1024 * 1024)]) {
    assert.equal(normalizeChatImageSource(invalid), null);
  }
});

test("renders SVG fences as passive clickable images while retaining ordinary code and escaping HTML", () => {
  const render = loadRenderer();
  const svg = '<svg viewBox="0 0 320 100"><text x="20" y="40">中文图示</text></svg>';
  const html = render("图示如下：\n\n```svg\n" + svg + "\n```\n\n完成。");
  assert.match(html, /<img src="data:image\/svg\+xml,/);
  assert.match(html, /data-image-alt="SVG 图示"/);
  assert.match(html, />下载 SVG<\/a>/);
  assert.match(html, /图示如下/);
  assert.match(html, /完成/);
  assert.doesNotMatch(html, /<svg|<text|<pre|<script/);
  assert.match(render("```SVG diagram\n" + svg + "\n```"), /chat-image-preview/);
  assert.match(render("```xml\n" + svg + "\n```"), /<pre><code class="language-xml">/);
  assert.match(render("```svg\nnot svg\n```"), /<pre><code class="language-svg">/);
  assert.match(render("```svg\n<!DOCTYPE svg>\n<svg\/>\n```"), /<pre><code class="language-svg">/);
  assert.equal(render(svg), render("```svg\n" + svg + "\n```"));
  assert.doesNotMatch(render(svg), /<svg/);
  const preview = buildChatImagePreviewHtml(createChatSvgImageSource(svg)!, "SVG 图示");
  assert.match(preview, /<img src="data:image\/svg\+xml,/);
  assert.doesNotMatch(preview, /<svg|<script/);
});

test("delegates image clicks to the host and prevents surrounding links from opening", () => {
  const handlerSource = VIEW_CONTENT_SCRIPT_TRACE_RENDERING.slice(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING.indexOf("      function handleChatImageClick("),
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING.indexOf("      function renderChatImage("),
  );
  const source = VIEW_CONTENT_SCRIPT_EVENT_BINDINGS.slice(0, VIEW_CONTENT_SCRIPT_EVENT_BINDINGS.indexOf("\n      ["));
  const listeners: Record<string, (event: unknown) => void> = {};
  const posted: unknown[] = [];
  new Function("elements", "vscode", "normalizeChatImageSource", handlerSource + source)(
    { messages: { addEventListener: (name: string, handler: (event: unknown) => void) => { listeners[name] = handler; } } },
    { postMessage: (message: unknown) => posted.push(message) },
    normalizeChatImageSource,
  );
  let prevented = false;
  listeners.click({
    target: { closest: () => ({ getAttribute: (name: string) => name === "data-image-src" ? pixel : name === "data-image-alt" ? "测试图片" : null }) },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(posted, [{ type: "previewChatImage", source: pixel, alt: "测试图片" }]);
  listeners.click({ target: { closest: () => null } });
  assert.equal(posted.length, 1);
  listeners.click({
    target: { closest: () => ({ getAttribute: (name: string) => name === "data-image-src" ? "/tmp/local.svg" : name === "data-image-action" ? "download" : "本地 SVG" }) },
    preventDefault: () => undefined,
  });
  assert.deepEqual(posted[1], { type: "downloadChatImage", source: "/tmp/local.svg", alt: "本地 SVG" });
});

test("builds a script-free, escaped preview and enables supported image sources in the chat CSP", () => {
  const preview = buildChatImagePreviewHtml(pixel, '<script>"测试"</script>');
  assert.match(preview, /default-src 'none'/);
  assert.doesNotMatch(preview, /<script|onerror=/);
  assert.match(preview, /&lt;script&gt;&quot;测试&quot;&lt;\/script&gt;/);
  assert.throws(() => buildChatImagePreviewHtml("javascript:alert(1)", "图片"));
  assert.throws(() => buildChatImagePreviewHtml("file:///tmp/image.png", "图片"));
  const html = buildWebviewStaticHtml({
    cspSource: "self", nonce: "test", i18n: WEBVIEW_STRINGS, cliOptions: "",
    markedScript: "", webviewStyles: MARKDOWN_STYLES,
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent", loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });
  assert.match(html, /img-src self https: http: data:/);
  assert.match(html, /\.chat-image-preview \{[\s\S]*?height: auto;/);
  assert.match(html, /\.chat-image-preview img[\s\S]*?max-width: 100%;/);
  assert.match(html, /\.chat-image-preview:focus-visible/);
});
