import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { test } from "node:test";
import { normalizeChatLinkSource, resolveChatLocalLink } from "../../webview/chatLink";
import { CHAT_MARKDOWN_SCRIPT } from "../../webview/chatMarkdown";
import { getMarkedScript } from "../../webview/markdownAssets";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../../webview/viewContentScript/eventBindings";

function createRenderer() {
  const posted: unknown[] = [];
  const runtime = vm.runInNewContext(`${getMarkedScript()}
    function escapeHtml(value) {
      return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    ${CHAT_MARKDOWN_SCRIPT}
    ({ renderMarkdown, handleChatLinkClick });
  `, { URL, TextEncoder, vscode: { postMessage: (message: unknown) => posted.push(message) } });
  return { ...runtime, posted };
}

test("normalizes generated artifact links without treating Windows paths as protocols", () => {
  for (const source of ["/tmp/结果.pdf", "./output/报告.pptx", "../overview.png", "~/报告.md", "C:\\生成文件\\报告.pptx", "\\\\server\\share\\报告.pdf"]) {
    assert.equal(normalizeChatLinkSource(source), source);
  }
  assert.equal(normalizeChatLinkSource("sandbox:/mnt/data/report.pdf"), "/mnt/data/report.pdf");
  assert.equal(normalizeChatLinkSource("README.md:8"), "README.md:8");
  assert.equal(normalizeChatLinkSource("file:///tmp/report%20final.pdf"), "file:///tmp/report%20final.pdf");
  assert.equal(normalizeChatLinkSource("https://example.com/path?q=1&v=2"), "https://example.com/path?q=1&v=2");
  assert.equal(normalizeChatLinkSource("https://file+.vscode-resource.vscode-cdn.net/tmp/report.pdf"), "file:///tmp/report.pdf");
});

test("rejects executable protocols, credentials, control characters and malformed URLs", () => {
  for (const source of [undefined, null, 12, "", "  ", "#section", "//example.com/file", "sandbox://example.com/file", "sandbox:relative.pdf", "javascript:alert(1)", "command:workbench.action.closeWindow", "vscode://extension/command", "data:text/html,hello", "https://user:secret@example.com/file", "https://[invalid", "file:///tmp/file.pdf?query=1", "file://user:secret@server/file", "hello\u0000.pdf", "hello\n.pdf"]) {
    assert.equal(normalizeChatLinkSource(source), null, String(source));
  }
});

test("resolves local URI, encoded spaces, source positions, Windows and UNC paths", () => {
  const baseDirectory = path.resolve("/workspace");
  assert.deepEqual(resolveChatLocalLink("output/报告%20final.pdf#page=2", baseDirectory), {
    path: path.join(baseDirectory, "output", "报告 final.pdf"), fragment: "page=2",
  });
  assert.deepEqual(resolveChatLocalLink("src/main.ts#L12C3-L18", baseDirectory), {
    path: path.join(baseDirectory, "src", "main.ts"), fragment: "", line: 12, column: 3,
  });
  assert.deepEqual(resolveChatLocalLink("src/main.ts:12:3", baseDirectory), {
    path: path.join(baseDirectory, "src", "main.ts"), fragment: "", line: 12, column: 3,
  });
  assert.equal(resolveChatLocalLink("file:///C:/workspace/report%20final.pdf", "/workspace").path, "C:\\workspace\\report final.pdf");
  assert.equal(resolveChatLocalLink("file://server/share/report.pdf", "/workspace").path, "\\\\server\\share\\report.pdf");
  assert.equal(resolveChatLocalLink("output\\report.pdf", "C:\\workspace").path, "C:\\workspace\\output\\report.pdf");
  assert.equal(resolveChatLocalLink("~/report.pdf", "/workspace").path, path.join(os.homedir(), "report.pdf"));
  assert.equal(resolveChatLocalLink("src/main.ts:0", "/workspace").line, undefined);
});

test("bundled Markdown parser creates bridge links for PPTX, PDF and image overviews", () => {
  const { renderMarkdown } = createRenderer();
  const html = renderMarkdown([
    "[打开 **PPTX**（26 页）](<output/报告 final.pptx>)",
    "[查看 PDF 预览](sandbox:/mnt/data/report.pdf)",
    "[查看全部页面总览](file:///tmp/overview.png)",
    '[网页](https://example.com/?a=1&b=2 "标题含\\\"引号")',
    '[拒绝](command:workbench.action.closeWindow)',
  ].join("\n\n"));
  assert.match(html, /data-chat-link="output\/报告 final.pptx"/u);
  assert.match(html, /<strong>PPTX<\/strong>/u);
  assert.match(html, /data-chat-link="\/mnt\/data\/report.pdf"/u);
  assert.match(html, /data-chat-link="file:\/\/\/tmp\/overview.png"/u);
  assert.match(html, /a=1&amp;b=2/u);
  assert.match(html, /&quot;/u);
  assert.doesNotMatch(html, /command:|href="(?:file:|sandbox:|https?:)/u);
  assert.match(html, /拒绝/u);
});

test("delegated clicks preserve raw sources, suppress navigation and do not double-open images", () => {
  const { handleChatLinkClick, posted } = createRenderer();
  let prevented = 0;
  const event = {
    target: { closest: () => ({ getAttribute: () => "output/report.pdf" }) },
    preventDefault: () => { prevented += 1; },
  };
  assert.equal(handleChatLinkClick(event), true);
  assert.equal(prevented, 1);
  assert.equal(JSON.stringify(posted), JSON.stringify([{ type: "openChatLink", source: "output/report.pdf" }]));
  assert.equal(handleChatLinkClick({ ...event, defaultPrevented: true }), false);
  assert.equal(handleChatLinkClick({ target: null }), false);
  assert.equal(handleChatLinkClick({ target: { closest: () => null } }), false);
  handleChatLinkClick({ ...event, target: { closest: () => ({ getAttribute: () => "javascript:alert(1)" }) } });
  assert.equal(posted.length, 1);
  assert.match(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, /messages.addEventListener\("click", handleChatLinkClick\)/u);
});
