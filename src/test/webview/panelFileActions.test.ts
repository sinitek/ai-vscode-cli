import * as assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type * as vscode from "vscode";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import {
  buildExplorerReferencePaths,
  buildRunStreamExportFileName,
  formatRunStreamExportJsonl,
} from "../../webview/panelFileActions";

function createWorkspaceReferenceHarness(testContext: TestContext) {
  const workspace = require("vscode").workspace;
  const originalGetWorkspaceFolder = workspace.getWorkspaceFolder;
  const originalAsRelativePath = workspace.asRelativePath;
  const entries = new Map<string, { folder: vscode.Uri; path: string }>();
  const createUri = (value: string): vscode.Uri => ({
    scheme: value.split(":")[0],
    toString: () => value,
  } as vscode.Uri);
  workspace.getWorkspaceFolder = (uri: vscode.Uri) => {
    const entry = entries.get(uri.toString());
    return entry ? { uri: entry.folder } : undefined;
  };
  workspace.asRelativePath = (uri: vscode.Uri, includeWorkspaceFolder: boolean) => {
    assert.equal(includeWorkspaceFolder, false);
    return entries.get(uri.toString())?.path;
  };
  testContext.after(() => {
    workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
    workspace.asRelativePath = originalAsRelativePath;
  });
  return {
    createUri,
    addResource(value: string, relativePath: string, root = "file:///workspace") {
      const uri = createUri(value);
      entries.set(value, { folder: createUri(root), path: relativePath });
      return uri;
    },
  };
}

test("builds relative references for Explorer files and directories", (testContext) => {
  const harness = createWorkspaceReferenceHarness(testContext);
  const file = harness.addResource("file:///workspace/src/app.ts", "src/app.ts");
  const directory = harness.addResource("file:///workspace/src", "src");
  assert.deepEqual(buildExplorerReferencePaths(file), ["src/app.ts"]);
  assert.deepEqual(buildExplorerReferencePaths(directory, []), ["src"]);
  assert.deepEqual(buildExplorerReferencePaths(file, [file, directory, file]), ["src/app.ts", "src"]);
});

test("normalizes Windows and UNC reference paths without losing spaces or Unicode", (testContext) => {
  const harness = createWorkspaceReferenceHarness(testContext);
  const windowsFile = harness.addResource("file:///C:/workspace/my%20folder/项目.ts", "my folder\\项目.ts", "file:///C:/workspace");
  const uncDirectory = harness.addResource("file://server/share/workspace/src", "src\\目录", "file://server/share/workspace");
  assert.deepEqual(buildExplorerReferencePaths(undefined, [windowsFile, uncDirectory]), ["my folder/项目.ts", "src/目录"]);
});

test("supports remote resources and references a workspace root as dot", (testContext) => {
  const harness = createWorkspaceReferenceHarness(testContext);
  const root = harness.addResource("file:///workspace", "/workspace");
  const remote = harness.addResource("vscode-remote://ssh-remote+host/workspace/src", "src", "vscode-remote://ssh-remote+host/workspace");
  assert.deepEqual(buildExplorerReferencePaths(root), ["."]);
  assert.deepEqual(buildExplorerReferencePaths(remote), ["src"]);
});

test("ignores missing, out-of-workspace, and unsupported Explorer resources", (testContext) => {
  const harness = createWorkspaceReferenceHarness(testContext);
  const outside = harness.createUri("file:///outside/app.ts");
  const unsupported = harness.addResource("untitled:///workspace/app.ts", "app.ts");
  const empty = harness.addResource("file:///workspace/empty", "");
  assert.deepEqual(buildExplorerReferencePaths(), []);
  assert.deepEqual(buildExplorerReferencePaths(undefined, []), []);
  assert.deepEqual(buildExplorerReferencePaths(outside, [outside, unsupported, empty]), []);
});

test("builds a JSONL filename for replay exports", () => {
  assert.equal(
    buildRunStreamExportFileName(Date.parse("2026-10-02T12:34:56.789Z")),
    "sinitek-run-stream-2026-10-02T12-34-56-789Z.jsonl",
  );
});

test("formats replay export metadata and records as JSONL", () => {
  const content = formatRunStreamExportJsonl(
    [
      {
        index: 1,
        content: "first line\nsecond line",
        source: "stdout",
        createdAt: Date.parse("2026-10-02T12:00:00.000Z"),
      },
      {
        index: 2,
        content: "stderr output",
        source: "stderr",
        createdAt: Date.parse("2026-10-02T12:00:01.000Z"),
      },
    ],
    {
      cli: "codex",
      tabId: "tab-1",
      exportedAt: Date.parse("2026-10-02T12:01:00.000Z"),
    },
  );

  const lines = content.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(content.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(lines[0]), {
    type: "metadata",
    format: "sinitek.run-stream",
    version: 1,
    exportedAt: "2026-10-02T12:01:00.000Z",
    cli: "codex",
    tabId: "tab-1",
    recordCount: 2,
  });
  assert.deepEqual(JSON.parse(lines[1]), {
    type: "record",
    index: 1,
    source: "stdout",
    createdAt: Date.parse("2026-10-02T12:00:00.000Z"),
    createdAtIso: "2026-10-02T12:00:00.000Z",
    content: "first line\nsecond line",
  });
  assert.deepEqual(JSON.parse(lines[2]), {
    type: "record",
    index: 2,
    source: "stderr",
    createdAt: Date.parse("2026-10-02T12:00:01.000Z"),
    createdAtIso: "2026-10-02T12:00:01.000Z",
    content: "stderr output",
  });
});
