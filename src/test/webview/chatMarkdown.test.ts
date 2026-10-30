import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { CHAT_MARKDOWN_SCRIPT } = require("../../webview/chatMarkdown") as typeof import("../../webview/chatMarkdown");
const { getMarkedScript } = require("../../webview/markdownAssets") as typeof import("../../webview/markdownAssets");
const { getWebviewHtml } = require("../../webview/viewContent") as typeof import("../../webview/viewContent");
const { buildLoopDebateChatPanelHtml } = require("../../webview/loopDebatePanel") as typeof import("../../webview/loopDebatePanel");
const { neutralizeInlineScriptEndTags } = require("../../webview/viewContentHtml") as typeof import("../../webview/viewContentHtml");
const { getMarkdownStyles, MARKDOWN_STYLES } = require("../../webview/viewContentStyles/markdown") as typeof import("../../webview/viewContentStyles/markdown");

function loadRenderer(): (content: string) => string {
  const source = `${getMarkedScript()}
    function escapeHtml(value) {
      return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    ${CHAT_MARKDOWN_SCRIPT}
    renderMarkdown;
  `;
  return vm.runInNewContext(source, { TextEncoder });
}

test("shared renderer formats Markdown, code, SVG and JSON with the bundled parser", () => {
  const render = loadRenderer();
  const markdown = "## 验证结果\n\n**成功**\n\n- 任务完成\n\n| 检查 | 结果 |\n| --- | --- |\n| 构建 | 通过 |\n\n> 验证证据\n\n```ts\nconst result = true;\n```";
  const html = render(markdown);
  for (const tag of ["h2", "strong", "ul", "table", "blockquote", "pre"]) {
    assert.ok(html.includes(`<${tag}`), tag);
  }
  assert.match(html, /<div class="markdown-table-wrap"><table>/u);
  assert.match(html, /<th>检查<\/th>/u);
  assert.match(html, /<td>通过<\/td>/u);
  assert.match(render("| 左 | 右 |\n| :--- | ---: |\n| a | 1 |\n"), /<td align="right">1<\/td>/u);
  const separatedEmphasisHtml = render("**Sizing tooltip for scripts**\n\n**Inspecting tooltip conventions**");
  assert.equal((separatedEmphasisHtml.match(/<strong>/gu) || []).length, 2);
  assert.match(separatedEmphasisHtml, /<\/p>\n<p>/u);
  assert.match(html, /language-ts/u);
  assert.match(render('```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text y="20">完成</text></svg>\n```'), /chat-image-preview/u);
  assert.match(render('{"任务":"完成","检查":[true]}'), /json-tree-host/u);
  assert.equal(render(""), "");
  assert.doesNotMatch(render('<script>alert("不执行")</script>'), /<script>/u);
  assert.doesNotMatch(render('![图片](javascript:alert(1))'), /<img/u);
  assert.match(render("```svg\n非 SVG 内容\n```"), /language-svg/u);
});

test("self-closing SVG animation tags with a following end tag still render as images", () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">',
    '  <animate attributeName="opacity" values="0;1"/>',
    "  </animate>",
    '  <text y="20">完成</text>',
    "</svg>",
  ].join("\n");
  const render = loadRenderer();
  const html = render("```svg\n" + svg + "\n```");
  assert.match(html, /<img src="data:image\/svg\+xml,/u);
  assert.match(html, /chat-image-preview/u);
  assert.match(html, /下载 SVG/u);
  assert.doesNotMatch(html, /<pre/u);
  assert.match(render(svg), /chat-image-preview/u);
  assert.match(render("```svg\n非 SVG 内容\n```"), /language-svg/u);
});

test("standalone raw SVG bubbles render exactly like SVG fences without changing the source", () => {
  const render = loadRenderer();
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text y="20">完成</text></svg>',
    '<svg viewBox="0 0 120 40">\n<text y="20">完成</text>\n</svg>',
    '<svg\nviewBox="0 0 120 40">\r\n<text y="20">完成</text>\r\n</svg>',
  ]) {
    const fenced = "```svg\n" + svg + "\n```";
    const expected = render(fenced);
    assert.match(expected, /chat-image-preview/u);
    assert.match(expected, /下载 SVG/u);
    assert.equal(render(svg), expected);
    assert.equal(render("\uFEFF \r\n" + svg + "\r\n "), expected);
    assert.equal(render(fenced), expected);
  }
});

test("raw SVG compatibility leaves mixed, incomplete and non-SVG bubbles unconverted", () => {
  const render = loadRenderer();
  const svg = '<svg viewBox="0 0 120 40"><text y="20">完成</text></svg>';
  for (const content of [
    "说明\n" + svg,
    svg + "\n说明",
    '<svg viewBox="0 0 120 40"><text y="20">完成</text>',
    '<svg-preview>不是 SVG</svg>',
    '<div>不是 SVG</div>',
    "```xml\n" + svg + "\n```",
    "```text\n" + svg + "\n```",
  ]) {
    const html = render(content);
    assert.doesNotMatch(html, /chat-image-preview/u, content);
    assert.doesNotMatch(html, /<svg[\s>]/iu, content);
  }
});

test("raw SVG compatibility preserves image size and entity validation", () => {
  const render = loadRenderer();
  for (const svg of [
    '<svg><!ENTITY unsafe "不执行"></svg>',
    "<svg>" + "x".repeat(256 * 1024) + "</svg>",
  ]) {
    const html = render(svg);
    assert.doesNotMatch(html, /chat-image-preview/u);
    assert.match(html, /language-svg/u);
  }
});

test("Loop and Loop+ embed the same renderer as AI chat for initial and patched bubbles", () => {
  const shared = neutralizeInlineScriptEndTags(CHAT_MARKDOWN_SCRIPT);
  assert.ok(getWebviewHtml({ cspSource: "self" }).includes(shared));
  for (const schedulingMode of ["classic", "event_driven"] as const) {
    const html = buildLoopDebateChatPanelHtml({ cspSource: "self" } as never, {
      mode: "main_sub",
      task: {
        id: "md-task", cli: "codex", status: "running", rootPrompt: "验证 Markdown",
        taskStoreFile: "/tmp/md-task.json", mainCommunicationFile: "/tmp/md-task/main.md",
        currentRound: 1, updatedAt: 1, canSupplement: true, canContinue: false, canStop: true,
      },
      loopPlus: schedulingMode === "event_driven" ? { ok: false, schedulingMode, activity: "invalid", phase: "invalid", error: "验证空态" } : undefined,
      rounds: [{ key: "execution-1", kind: "execution", loopRound: 1, debateRound: 0, status: "running", startedAt: 1, participants: [], moderatorDecisions: [] }],
      chatMarkdown: "# 群聊\n\n## 补充需求\n\n**必须验证**\n\n<script>不会执行</script>",
    });
    assert.ok(html.includes(shared));
    assert.match(html, /data-markdown-source=/u);
    assert.ok(html.includes("&lt;script&gt;不会执行&lt;/script&gt;"));
    assert.ok(html.includes('mountGroupChatMarkdown(document)'));
    assert.ok(html.includes('mountGroupChatMarkdown(slot)'));
    assert.ok(html.includes('renderMarkdown(message.content'));
    assert.match(html, /img-src self https: http: data:/u);
    assert.ok(getMarkdownStyles(".markdown-body").includes(".markdown-body .chat-image-preview img"));
    const markdownStyles = getMarkdownStyles(".markdown-body");
    assert.match(markdownStyles, /\.markdown-body table \{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--vscode-foreground\) 32%, transparent\)/u);
    assert.match(markdownStyles, /\.markdown-body th,\s*\.markdown-body td \{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--vscode-foreground\) 32%, transparent\)/u);
    assert.match(MARKDOWN_STYLES, /\.message\.assistant \.bubble table \{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--vscode-foreground\) 32%, transparent\)/u);
    assert.match(MARKDOWN_STYLES, /\.message\.assistant \.bubble th,\s*\.message\.assistant \.bubble td \{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--vscode-foreground\) 32%, transparent\)/u);
  }
});
