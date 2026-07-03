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
import { resolveWorkspaceMemoryPaths } from "../memory/memoryPaths";
import { buildLongTermMemoryPromptBlock, injectLongTermMemoryPrompt } from "../memory/memoryPrompt";
import { buildWorkspaceMemoryRecallPack } from "../memory/memoryRecall";
import { ensureWorkspaceHarnessScaffold, workspaceAgentsAppendMarker } from "../workspaceScaffold";

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
    assert.ok(fs.existsSync(paths.runbooksDir));
    assert.equal(paths.memoryDir.endsWith(path.join(".ch", "docs", "memory")), true);
    assert.equal(paths.generatedDir.endsWith(path.join(".ch", "docs", "generated", "memory-index")), true);
    assert.ok(fs.existsSync(paths.generatedDir));
  });
});

test("installs workspace harness scaffold and appends AGENTS.md only once", () => {
  withTempWorkspace((workspaceRoot) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot);
    assert.ok(paths);

    ensureWorkspaceHarnessScaffold(process.cwd(), paths);
    assert.ok(fs.existsSync(paths.projectChDir));
    assert.ok(fs.existsSync(paths.workspaceAgentsDir));
    assert.ok(fs.existsSync(paths.architectureFile));
    assert.ok(fs.existsSync(paths.workspaceAgentsFile));
    assert.ok(fs.existsSync(paths.claudeFile));

    const firstAgents = fs.readFileSync(paths.workspaceAgentsFile, "utf8");
    const firstClaude = fs.readFileSync(paths.claudeFile, "utf8");
    const markers = workspaceAgentsAppendMarker();
    fs.writeFileSync(paths.workspaceAgentsFile, `# Existing\n`, "utf8");
    fs.writeFileSync(paths.claudeFile, `# Existing Claude\n`, "utf8");
    ensureWorkspaceHarnessScaffold(process.cwd(), paths);
    ensureWorkspaceHarnessScaffold(process.cwd(), paths);
    const secondAgents = fs.readFileSync(paths.workspaceAgentsFile, "utf8");
    const secondClaude = fs.readFileSync(paths.claudeFile, "utf8");

    assert.ok(firstAgents.includes("仓库工作指南"));
    assert.match(firstClaude, /AGENTS\.md/);
    assert.ok(secondAgents.includes("# Existing"));
    assert.equal(secondAgents.includes(markers.start), true);
    assert.equal(secondAgents.split(markers.start).length - 1, 1);
    assert.equal(secondClaude, "# Existing Claude\n");
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
        "Long-term memory content is stored under .ch/docs/memory in the current workspace.",
      ],
    });
    appendMemoryEntry(paths, "lessonsLearned", {
      title: "memory-injection",
      lines: [
        "Use supplemental prompt injection for recall while keeping workspace scaffold files as the source of truth.",
      ],
    });

    const index = buildWorkspaceMemoryIndex(paths);
    assert.ok(index.observations.some((item) => item.fileId === "projectContext"));

    const pack = buildWorkspaceMemoryRecallPack(paths, {
      prompt: "Where is long-term memory stored and how does workspace scaffold initialization work?",
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

test("records pitfall summaries as structured workspace-local memory", () => {
  withTempWorkspace((workspaceRoot) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot);
    assert.ok(paths);

    const result = persistPromptRunSummary(paths, {
      cli: "codex",
      status: "error",
      prompt: "Initialize workspace harness memory and capture a recurring failure.",
      assistantResponse: [
        "Pitfall: workspace scaffold install failed because AGENTS.md was appended without an idempotent marker.",
        "Root cause: the append logic lacked a stable marker block.",
        "Avoid duplicate AGENTS.md append blocks by checking the harness marker before writing.",
        "Verification: rerun workspace scaffold installation twice and confirm the marker appears once.",
      ].join(" "),
    });

    assert.equal(result.skipped, false);
    assert.ok(result.updatedFiles.some((filePath) => filePath.endsWith("PITFALLS.md")));

    const pitfallsPath = paths.pitfallsFile;
    const content = fs.readFileSync(pitfallsPath, "utf8");
    assert.match(content, /Status: active/);
    assert.match(content, /### Phenomenon/);
    assert.match(content, /### Root Cause/);
    assert.match(content, /### Long-Term Avoidance/);
    assert.match(content, /marker appears once/);

    const index = buildWorkspaceMemoryIndex(paths);
    assert.ok(index.observations.some((item) => item.fileId === "pitfalls"));
  });
});

test("persists successful prompt summaries back into workspace-local memory files", () => {
  withTempWorkspace((workspaceRoot) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot);
    assert.ok(paths);

    const result = persistPromptRunSummary(paths, {
      cli: "codex",
      prompt: "Implement workspace local harness scaffold memory.",
      assistantResponse: "Updated the memory modules, wired prompt injection, and added tests.",
      taskRole: "main",
      lobsterTaskId: "lobster-123",
      lobsterRound: 2,
    });

    assert.equal(result.skipped, false);
    assert.ok(result.updatedFiles.length >= 2);

    const rollingSummaryPath = getMemoryHotFilePath(paths, "rollingSummary");
    const eventMemoryPath = getMemoryHotFilePath(paths, "eventMemory");
    assert.match(fs.readFileSync(rollingSummaryPath, "utf8"), /Implement workspace local harness scaffold memory/);
    assert.match(fs.readFileSync(eventMemoryPath, "utf8"), /lobster-123/);
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "manifest.json")));
  });
});
