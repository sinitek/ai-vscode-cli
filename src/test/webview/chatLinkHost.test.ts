import * as assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const vscode = require("vscode");
const { isChatLinkMessage, openChatLink } = require("../../webview/chatLinkHost") as typeof import("../../webview/chatLinkHost");
const baseDirectory = path.resolve("/workspace");

function createHarness(context: TestContext) {
  const commands: unknown[][] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const external: string[] = [];
  const images: string[] = [];
  let statError = false;
  let fileType = 1;
  let failOpen = false;
  let action: string | undefined;
  let externalResult = true;
  const extensions = { all: [{ packageJSON: { contributes: { customEditors: [{
    viewType: "test.documentPreview",
    selector: [{ filenamePattern: "**/*.{pdf,pptx}" }],
  }] } } }] };
  const uri = (fsPath: string, fragment = "") => ({
    fsPath,
    fragment,
    with: (changes: { fragment: string }) => uri(fsPath, changes.fragment),
    toString: () => pathToFileURL(fsPath).href + (fragment ? "#" + fragment : ""),
  });
  const patch = (object: Record<string, unknown>, key: string, value: unknown) => {
    const previous = object[key];
    object[key] = value;
    context.after(() => { object[key] = previous; });
  };
  patch(vscode.workspace, "workspaceFolders", [{ uri: { fsPath: baseDirectory } }]);
  patch(vscode.workspace, "fs", { stat: async () => {
    if (statError) { throw new Error("ENOENT"); }
    return { type: fileType };
  } });
  patch(vscode, "FileType", { Directory: 2 });
  patch(vscode, "extensions", extensions);
  patch(vscode, "Position", class { constructor(public line: number, public character: number) {} });
  patch(vscode, "Range", class { constructor(public start: unknown, public end: unknown) {} });
  patch(vscode.Uri, "file", uri);
  patch(vscode.commands, "executeCommand", async (...args: unknown[]) => {
    commands.push(args);
    if (failOpen && (args[0] === "vscode.open" || args[0] === "vscode.openWith" && args[2] === "test.documentPreview")) { throw new Error("无可用编辑器"); }
  });
  patch(vscode.window, "showErrorMessage", async (message: string) => { errors.push(message); });
  patch(vscode.window, "showWarningMessage", async (message: string) => { warnings.push(message); return action; });
  patch(vscode.env, "openExternal", async (target: { toString: () => string }) => {
    external.push(target.toString());
    return externalResult;
  });
  return {
    commands, errors, warnings, external, images,
    open: (source: unknown) => openChatLink(source, async (source) => { images.push(source); }),
    missing: () => { statError = true; },
    directory: () => { fileType = 2; },
    failOpen: (choice?: string) => { failOpen = true; action = choice; },
    failExternal: () => { externalResult = false; },
    noPreviewEditor: (choice?: string) => { extensions.all = []; action = choice; },
  };
}

test("routes only typed link messages", () => {
  assert.equal(isChatLinkMessage({ type: "openChatLink", source: 12 }), true);
  for (const message of [null, 12, {}, { type: "previewChatImage" }]) {
    assert.equal(isChatLinkMessage(message), false);
  }
});

test("opens relative PPTX/PDF in the editor and keeps page fragments", async (context) => {
  const harness = createHarness(context);
  await harness.open("output/报告.pptx");
  await harness.open("sandbox:/mnt/data/report.pdf#page=2");
  assert.equal(harness.commands[0][0], "vscode.openWith");
  assert.equal((harness.commands[0][1] as { fsPath: string }).fsPath, path.join(baseDirectory, "output", "报告.pptx"));
  assert.equal((harness.commands[1][1] as { fragment: string }).fragment, "page=2");
  assert.equal(harness.commands[0][2], "test.documentPreview");
  assert.deepEqual(harness.commands[0][3], { preview: true });
  assert.equal(harness.external.length, 0);
});

test("reuses image and Markdown previews and supports source selections", async (context) => {
  const harness = createHarness(context);
  await harness.open("overview.png");
  await harness.open("README.md#标题");
  await harness.open("src/main.ts#L12C3");
  await harness.open("README.md:8");
  assert.deepEqual(harness.images, [pathToFileURL(path.join(baseDirectory, "overview.png")).href]);
  assert.equal(harness.commands[0][0], "markdown.showPreview");
  assert.equal((harness.commands[0][1] as { fragment: string }).fragment, "标题");
  const options = harness.commands[1][2] as { selection: { start: { line: number; character: number } } };
  assert.equal(options.selection.start.line, 11);
  assert.equal(options.selection.start.character, 2);
  assert.equal(harness.commands[2][0], "vscode.open");
});

test("reveals directories and opens HTTP(S) only through the external browser", async (context) => {
  const harness = createHarness(context);
  harness.directory();
  await harness.open("output");
  await harness.open("https://example.com/result");
  assert.equal(harness.commands[0][0], "revealInExplorer");
  assert.deepEqual(harness.external, ["https://example.com/result"]);
});

test("rejects dangerous links and reports missing artifacts without opening anything", async (context) => {
  const harness = createHarness(context);
  await harness.open("command:workbench.action.closeWindow");
  harness.missing();
  await harness.open("missing.pdf");
  assert.match(harness.errors[0], /不受支持的协议/u);
  assert.match(harness.errors[1], /文件不存在或无法访问/u);
  assert.equal(harness.commands.length, 0);
  assert.equal(harness.external.length, 0);
});

test("unsupported editors offer explicit recovery without silently using external apps", async (context) => {
  const harness = createHarness(context);
  harness.failOpen();
  await harness.open("report.pdf");
  assert.match(harness.warnings[0], /预览扩展/u);
  assert.equal(harness.external.length, 0);
  harness.failOpen("选择打开方式");
  await harness.open("report.pdf");
  assert.equal(harness.commands.at(-1)?.[0], "vscode.openWith");
  harness.failOpen("使用系统应用打开");
  await harness.open("report.pptx");
  assert.deepEqual(harness.external, [pathToFileURL(path.join(baseDirectory, "report.pptx")).href]);
});

test("failed browser and system opens give actionable errors", async (context) => {
  const harness = createHarness(context);
  harness.failExternal();
  await harness.open("https://example.com");
  harness.failOpen("使用系统应用打开");
  await harness.open("report.pdf");
  assert.equal(harness.errors.length, 2);
  assert.match(harness.errors[0], /链接打开失败/u);
});

test("missing PDF/Office viewers never fall through to the binary text editor", async (context) => {
  const harness = createHarness(context);
  harness.noPreviewEditor();
  await harness.open("report.pdf");
  assert.equal(harness.commands.length, 0);
  assert.match(harness.warnings[0], /预览扩展/u);
  assert.equal(harness.external.length, 0);
  harness.noPreviewEditor("查找预览扩展");
  await harness.open("report.pptx");
  assert.deepEqual(harness.commands[0], ["workbench.extensions.search", "pptx"]);
});
