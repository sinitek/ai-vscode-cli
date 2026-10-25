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
const { getMarkdownStyles } = require("../../webview/viewContentStyles/markdown") as typeof import("../../webview/viewContentStyles/markdown");

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
  }
});
