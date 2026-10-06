import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { persistPromptRunSummary, type PromptRunMemoryCaptureInput } from "../../memory/memoryConsolidator";
import {
  appendMemoryEntry,
  ensureMemoryWorkspaceScaffold,
  getMemoryHotFilePath,
  readMemoryHotFiles,
} from "../../memory/memoryFiles";
import { buildWorkspaceMemoryIndex } from "../../memory/memoryIndexer";
import { resolveWorkspaceMemoryPaths } from "../../memory/memoryPaths";
import { buildLongTermMemoryPromptBlock, injectLongTermMemoryPrompt } from "../../memory/memoryPrompt";
import { buildWorkspaceMemoryRecallPack } from "../../memory/memoryRecall";
import { ensureWorkspaceHarnessScaffold, isWorkspaceHarnessInstalled, workspaceAgentsAppendMarker } from "../../workspaceScaffold";

function withTempWorkspace<T>(run: (workspaceRoot: string, runtimeDataDir: string) => T): T {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-memory-"));
  const runtimeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-memory-runtime-"));
  try {
    return run(workspaceRoot, runtimeDataDir);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(runtimeDataDir, { recursive: true, force: true });
  }
}

test("creates workspace-local long-term memory scaffold with runtime generated recall", () => {
  withTempWorkspace((workspaceRoot, runtimeDataDir) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot, { runtimeDataDir });
    assert.ok(paths);
    ensureMemoryWorkspaceScaffold(paths);

    const hotFiles = readMemoryHotFiles(paths);
    assert.equal(hotFiles.length, 7);
    assert.ok(fs.existsSync(path.join(paths.memoryDir, "README.md")));
    assert.ok(fs.existsSync(paths.runbooksDir));
    assert.equal(paths.memoryDir.endsWith(path.join(".ch", "docs", "memory")), true);
    assert.equal(paths.runtimeDataDir, path.resolve(runtimeDataDir));
    const expectedGeneratedRoot = path.join(path.resolve(runtimeDataDir), "memory-generated");
    assert.equal(paths.generatedDir.startsWith(expectedGeneratedRoot), true);
    assert.equal(paths.generatedDir.endsWith("memory-index"), true);
    assert.equal(paths.generatedDir.includes(path.join(".ch", "docs", "generated")), false);
    assert.ok(fs.existsSync(paths.generatedDir));
  });
});

test("treats an existing .ch directory as an installed workspace harness", () => {
  withTempWorkspace((workspaceRoot) => {
    assert.equal(isWorkspaceHarnessInstalled(null), false);
    assert.equal(isWorkspaceHarnessInstalled(workspaceRoot), false);
    fs.writeFileSync(path.join(workspaceRoot, ".ch"), "not-a-directory");
    assert.equal(isWorkspaceHarnessInstalled(workspaceRoot), false);
    fs.rmSync(path.join(workspaceRoot, ".ch"));
    fs.mkdirSync(path.join(workspaceRoot, ".ch"));
    assert.equal(isWorkspaceHarnessInstalled(workspaceRoot), true);
  });
});

test("installs workspace harness scaffold and appends AGENTS.md only once", () => {
  withTempWorkspace((workspaceRoot, runtimeDataDir) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot, { runtimeDataDir });
    assert.ok(paths);

    ensureWorkspaceHarnessScaffold(process.cwd(), paths);
    assert.ok(fs.existsSync(paths.projectChDir));
    assert.ok(fs.existsSync(paths.workspaceAgentsDir));
    assert.ok(fs.existsSync(paths.architectureFile));
    assert.ok(fs.existsSync(paths.workspaceAgentsFile));
    assert.ok(fs.existsSync(paths.claudeFile));
    assert.ok(fs.existsSync(path.join(workspaceRoot, ".gitignore")));

    const firstAgents = fs.readFileSync(paths.workspaceAgentsFile, "utf8");
    const firstClaude = fs.readFileSync(paths.claudeFile, "utf8");
    const firstGitignore = fs.readFileSync(path.join(workspaceRoot, ".gitignore"), "utf8");
    const markers = workspaceAgentsAppendMarker();
    fs.writeFileSync(paths.workspaceAgentsFile, `# Existing\n`, "utf8");
    fs.writeFileSync(paths.claudeFile, `# Existing Claude\n`, "utf8");
    ensureWorkspaceHarnessScaffold(process.cwd(), paths);
    ensureWorkspaceHarnessScaffold(process.cwd(), paths);
    const secondAgents = fs.readFileSync(paths.workspaceAgentsFile, "utf8");
    const secondClaude = fs.readFileSync(paths.claudeFile, "utf8");
    const secondGitignore = fs.readFileSync(path.join(workspaceRoot, ".gitignore"), "utf8");

    assert.ok(firstAgents.includes("仓库工作指南"));
    assert.match(firstClaude, /AGENTS\.md/);
    assert.match(firstGitignore, /^\.codegraph\/$/m);
    assert.ok(secondAgents.includes("# Existing"));
    assert.equal(secondAgents.includes(markers.start), true);
    assert.equal(secondAgents.split(markers.start).length - 1, 1);
    assert.equal(secondClaude, "# Existing Claude\n");
    assert.equal(secondGitignore.split(".codegraph/").length - 1, 1);
  });
});

test("builds recall pack from workspace-local memory files and writes generated artifacts to runtime dir", () => {
  withTempWorkspace((workspaceRoot, runtimeDataDir) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot, { runtimeDataDir });
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

    const block = buildLongTermMemoryPromptBlock(pack);
    assert.match(block, /\[插件长期记忆上下文\]/);
    assert.match(block, /项目上下文:/);
    assert.match(block, /经验教训:/);

    const injected = injectLongTermMemoryPrompt("Answer the user question.", block);
    assert.match(injected, /插件长期记忆上下文/);
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "recall-pack.md")));
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "observations.jsonl")));
    assert.equal(paths.generatedDir.startsWith(path.join(path.resolve(runtimeDataDir), "memory-generated")), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, ".ch", "docs", "generated", "memory-index", "recall-pack.md")), false);
  });
});

test("records pitfall summaries as structured workspace-local memory", () => {
  withTempWorkspace((workspaceRoot, runtimeDataDir) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot, { runtimeDataDir });
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

test("does not auto-write routine prompt summaries into rolling or event memory", () => {
  withTempWorkspace((workspaceRoot, runtimeDataDir) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot, { runtimeDataDir });
    assert.ok(paths);

    const result = persistPromptRunSummary(paths, {
      cli: "codex",
      prompt: "Implement workspace local harness scaffold memory.",
      assistantResponse: "Updated the memory modules, wired prompt injection, and added tests.",
      taskRole: "main",
      loopTaskId: "loop-123",
      loopRound: 2,
    });

    assert.equal(result.skipped, true);
    assert.deepEqual(result.updatedFiles, []);
    assert.equal(result.reason, "no-memory-capture-signals");

    const rollingSummary = fs.readFileSync(getMemoryHotFilePath(paths, "rollingSummary"), "utf8");
    const eventMemory = fs.readFileSync(getMemoryHotFilePath(paths, "eventMemory"), "utf8");
    assert.doesNotMatch(rollingSummary, /Implement workspace local harness scaffold memory/);
    assert.doesNotMatch(rollingSummary, /loop-123/);
    assert.doesNotMatch(eventMemory, /loop-123/);
    assert.doesNotMatch(eventMemory, /Updated the memory modules/);
  });
});

test("stores reusable decisions only in event memory", () => {
  withTempWorkspace((workspaceRoot, runtimeDataDir) => {
    const paths = resolveWorkspaceMemoryPaths(workspaceRoot, { runtimeDataDir });
    assert.ok(paths);

    const input: PromptRunMemoryCaptureInput = {
      cli: "codex",
      prompt: "Split harness rolling summary and event memory.",
      assistantResponse: "关键决策：后续只把可复用事件写入事件记忆，滚动摘要不自动写入。\n普通完成结果不落盘。",
      loopTaskId: "loop-456",
    };
    const result = persistPromptRunSummary(paths, input);

    assert.equal(result.skipped, false);
    assert.equal(result.updatedFiles.length, 1);
    assert.ok(result.updatedFiles[0].endsWith("EVENT_MEMORY.md"));

    const rollingSummary = fs.readFileSync(getMemoryHotFilePath(paths, "rollingSummary"), "utf8");
    const eventMemory = fs.readFileSync(getMemoryHotFilePath(paths, "eventMemory"), "utf8");
    assert.doesNotMatch(rollingSummary, /Split harness rolling summary and event memory/);
    assert.doesNotMatch(rollingSummary, /关键决策/);
    assert.match(eventMemory, /Event: 关键决策：后续只把可复用事件写入事件记忆，滚动摘要不自动写入。/);
    assert.match(eventMemory, /loop-456/);
    assert.doesNotMatch(eventMemory, /Split harness rolling summary and event memory/);
    assert.doesNotMatch(eventMemory, /普通完成结果不落盘/);
    assert.ok(fs.existsSync(path.join(paths.generatedDir, "manifest.json")));

    const duplicate = persistPromptRunSummary(paths, input);
    assert.equal(duplicate.skipped, true);
    assert.equal(fs.readFileSync(getMemoryHotFilePath(paths, "eventMemory"), "utf8"), eventMemory);
  });
});
