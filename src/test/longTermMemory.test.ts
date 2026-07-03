import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { persistPromptRunSummary } from "../memory/memoryConsolidator";
import {
  appendMemoryEntry,
  ensureMemoryWorkspaceScaffold,
  getMemoryHotFilePath,
  readMemoryHotFiles,
} from "../memory/memoryFiles";
import { buildWorkspaceMemoryIndex } from "../memory/memoryIndexer";
import { resolveWorkspaceMemoryPaths, workspaceHasProjectChDirectory } from "../memory/memoryPaths";
import { buildLongTermMemoryPromptBlock, injectLongTermMemoryPrompt } from "../memory/memoryPrompt";
import { buildWorkspaceMemoryRecallPack } from "../memory/memoryRecall";

function withTempWorkspace<T>(run: (workspaceRoot: string) => T): T {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-memory-"));
  try {
    return run(workspaceRoot);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

test("creates workspace-local long-term memory scaffold", () => {
  withTempWorkspace((workspaceRoot) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot);
    assert.ok(paths);
    ensureMemoryWorkspaceScaffold(paths);

    const hotFiles = readMemoryHotFiles(paths);
    assert.equal(hotFiles.length, 7);
    assert.ok(fs.existsSync(path.join(paths.memoryDir, "README.md")));
    assert.ok(fs.existsSync(paths.generatedDir));
    assert.equal(workspaceHasProjectChDirectory(paths), false);

    fs.mkdirSync(paths.projectChDir, { recursive: true });
    assert.equal(workspaceHasProjectChDirectory(paths), true);
  });
});

test("builds recall pack from workspace-local memory files and injects prompt block", () => {
  withTempWorkspace((workspaceRoot) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot);
    assert.ok(paths);
    ensureMemoryWorkspaceScaffold(paths);

    appendMemoryEntry(paths, "projectContext", {
      title: "workspace-memory-path",
      lines: [
        "Long-term memory content is stored under .sinitek_cli/memory in the current workspace.",
      ],
    });
    appendMemoryEntry(paths, "lessonsLearned", {
      title: "memory-injection",
      lines: [
        "Use supplemental prompt injection for recall instead of rewriting AGENTS.md or .ch/docs files.",
      ],
    });

    const index = buildWorkspaceMemoryIndex(paths);
    assert.ok(index.observations.some((item) => item.fileId === "projectContext"));

    const pack = buildWorkspaceMemoryRecallPack(paths, {
      prompt: "Where is long-term memory stored, and should AGENTS.md be modified?",
    });
    assert.ok(pack.sections.length >= 1);
    assert.ok(pack.observationIds.length >= 1);

    const block = buildLongTermMemoryPromptBlock(pack, "en");
    assert.match(block, /\[Plugin Memory Context\]/);
    assert.match(block, /Project Context:/);
    assert.match(block, /Lessons Learned:/);

    const injected = injectLongTermMemoryPrompt("Answer the user question.", block);
    assert.match(injected, /Plugin Memory Context/);
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "recall-pack.md")));
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "observations.jsonl")));
  });
});

test("persists successful prompt summaries back into workspace-local memory files", () => {
  withTempWorkspace((workspaceRoot) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot);
    assert.ok(paths);

    const result = persistPromptRunSummary(paths, {
      cli: "codex",
      prompt: "Implement workspace local long-term memory.",
      assistantResponse: "Updated the memory modules, wired prompt injection, and added tests.",
      taskRole: "main",
      lobsterTaskId: "lobster-123",
      lobsterRound: 2,
    });

    assert.equal(result.skipped, false);
    assert.ok(result.updatedFiles.length >= 2);

    const rollingSummaryPath = getMemoryHotFilePath(paths, "rollingSummary");
    const eventMemoryPath = getMemoryHotFilePath(paths, "eventMemory");
    assert.match(fs.readFileSync(rollingSummaryPath, "utf8"), /Implement workspace local long-term memory/);
    assert.match(fs.readFileSync(eventMemoryPath, "utf8"), /lobster-123/);
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "manifest.json")));
  });
});
