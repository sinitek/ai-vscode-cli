import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  collectLoopCommunicationPreviewRoots,
  isLoopCommunicationPreviewPath,
  readLoopCommunicationFilePreview,
  renderLoopCommunicationMarkdown,
  renderLoopGroupChatMessageText,
  type LoopCommunicationFilePreview,
} from "../../loopCommunicationFilePreview";

function previewError(result: LoopCommunicationFilePreview): string {
  assert.equal(result.ok, false);
  if (result.ok) {
    return "";
  }
  return result.error;
}

test("turns communication file paths into preview links and leaves other text escaped", () => {
  const filePath = "/Users/demo/.sinitek_cli/loop-communications/task-1/subtasks/round-1-demo.md";
  const html = renderLoopGroupChatMessageText([
    "子任务",
    `- 成员 ID：chain-scenario-architecture`,
    `- 沟通文件：${filePath}`,
    "- 主任务沟通文件：C:\\loop\\main-task.md",
    "- 说明：请查看沟通文件。",
    "- 沟通文件：relative/notes.md",
    "<script>alert(1)</script>",
  ].join("\n"), "查看沟通文件");

  assert.match(html, new RegExp(`data-file-path="${filePath}"`));
  assert.match(html, /data-action="openCommunicationFile"/u);
  assert.match(html, /title="查看沟通文件"/u);
  assert.match(html, /data-file-path="C:\\loop\\main-task.md"/u);
  assert.match(html, /- 说明：请查看沟通文件。/u);
  assert.match(html, /- 沟通文件：relative\/notes.md/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>/u);
});

test("rejects communication preview paths that are not absolute markdown files", () => {
  assert.equal(isLoopCommunicationPreviewPath("/tmp/notes.md"), true);
  assert.equal(isLoopCommunicationPreviewPath("C:\\temp\\notes.md"), true);
  assert.equal(isLoopCommunicationPreviewPath("\\\\server\\share\\notes.md"), true);
  assert.equal(isLoopCommunicationPreviewPath("/tmp/notes.txt"), false);
  assert.equal(isLoopCommunicationPreviewPath("notes.md"), false);
  assert.equal(isLoopCommunicationPreviewPath(""), false);
});

test("renders communication markdown and escapes raw html", () => {
  const html = renderLoopCommunicationMarkdown("# 标题\n\n- 条目 `code`\n\n<script>alert(1)</script>\n");
  assert.match(html, /<h1>标题<\/h1>/u);
  assert.match(html, /<li>条目 <code>code<\/code><\/li>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>/u);
});

test("reads a markdown file inside the task communication directory and blocks escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-communication-preview-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "loop-communication-outside-"));
  try {
    const subtasksDir = path.join(root, "subtasks");
    fs.mkdirSync(subtasksDir, { recursive: true });
    const filePath = path.join(subtasksDir, "round-1-demo.md");
    fs.writeFileSync(filePath, "# 子任务沟通记录\n\n执行完成。\n", "utf8");
    fs.writeFileSync(path.join(subtasksDir, "empty.md"), "   \n", "utf8");
    fs.writeFileSync(path.join(outside, "secret.md"), "# secret\n", "utf8");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(subtasksDir, "linked.md"));
    const roots = [root];

    const allowed = readLoopCommunicationFilePreview(filePath, roots);
    assert.equal(allowed.ok, true);
    if (allowed.ok) {
      assert.match(allowed.html, /<h1>子任务沟通记录<\/h1>/u);
    }

    assert.equal(previewError(readLoopCommunicationFilePreview(path.join(subtasksDir, "missing.md"), roots)), "missing");
    assert.equal(previewError(readLoopCommunicationFilePreview(path.join(subtasksDir, "empty.md"), roots)), "empty");
    assert.equal(previewError(readLoopCommunicationFilePreview(path.join(outside, "secret.md"), roots)), "forbidden");
    assert.equal(previewError(readLoopCommunicationFilePreview(path.join(subtasksDir, "linked.md"), roots)), "forbidden");
    assert.equal(previewError(readLoopCommunicationFilePreview(path.join(root, "..", "secret.md"), roots)), "forbidden");
    assert.equal(previewError(readLoopCommunicationFilePreview("relative.md", roots)), "invalid");
    assert.equal(previewError(readLoopCommunicationFilePreview(12, roots)), "invalid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("treats a realpath alias of the communication directory as the same root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-communication-alias-"));
  const aliasParent = fs.mkdtempSync(path.join(os.tmpdir(), "loop-communication-alias-parent-"));
  try {
    const filePath = path.join(root, "main-task.md");
    fs.writeFileSync(filePath, "# 主任务\n", "utf8");
    const alias = path.join(aliasParent, "communication");
    fs.symlinkSync(root, alias);
    const aliasFile = path.join(alias, "main-task.md");
    const preview = readLoopCommunicationFilePreview(aliasFile, [root]);
    assert.equal(preview.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(aliasParent, { recursive: true, force: true });
  }
});

test("collects the task communication directory and canonical loop directory", () => {
  const roots = collectLoopCommunicationPreviewRoots({
    id: "task-1",
    communicationDir: "/tmp/task-1",
    mainCommunicationFile: "/tmp/task-1/main-task.md",
  });
  assert.ok(roots.includes(path.resolve("/tmp/task-1")));
  assert.ok(roots.some((root) => root.endsWith(`${path.sep}loop-communications${path.sep}task-1`)));
  const widened = collectLoopCommunicationPreviewRoots({
    id: "task-1",
    communicationDir: "/",
    mainCommunicationFile: "/main-task.md",
  });
  assert.ok(widened.length > 0);
  assert.ok(widened.every((root) => root.split(path.sep).includes("task-1")));
});

test("rejects an unreadable communication file and a file above the preview limit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-communication-limits-"));
  try {
    const directoryPath = path.join(root, "not-a-file.md");
    fs.mkdirSync(directoryPath);
    const hugePath = path.join(root, "huge.md");
    fs.writeFileSync(hugePath, "a".repeat(1024 * 1024 + 1));
    const lockedPath = path.join(root, "locked.md");
    fs.writeFileSync(lockedPath, "# locked\n");
    fs.chmodSync(lockedPath, 0);
    assert.equal(previewError(readLoopCommunicationFilePreview(directoryPath, [root])), "forbidden");
    assert.equal(previewError(readLoopCommunicationFilePreview(hugePath, [root])), "too_large");
    assert.equal(previewError(readLoopCommunicationFilePreview(lockedPath, [root])), "unreadable");
    fs.chmodSync(lockedPath, 0o644);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
