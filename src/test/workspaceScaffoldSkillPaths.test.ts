import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = process.cwd();
const scaffoldSkillsRoot = path.join(repoRoot, "media", "workspace-scaffold", ".agents", "skills");

function readRepoText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function withTempDir<T>(prefix: string, run: (tempRoot: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runPythonSkill(scriptRelativePath: string, args: string[]): void {
  const scriptPath = path.join(scaffoldSkillsRoot, scriptRelativePath);
  childProcess.execFileSync("python3", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function seedMinimalHarnessRepo(root: string): void {
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# AGENTS\n\nUse relative paths in generated artifacts.\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "# Test Repo\n", "utf8");
  fs.writeFileSync(path.join(root, "ARCHITECTURE.md"), "# Architecture\n", "utf8");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { build: "tsc -p .", test: "node --test" } }, null, 2),
    "utf8",
  );
  fs.mkdirSync(path.join(root, ".ch", "docs", "exec-plans", "active"), { recursive: true });
  fs.mkdirSync(path.join(root, ".ch", "docs", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, ".ch", "docs", "MEMORY.md"), "# Memory\n\nStarter rules.\n", "utf8");
  fs.writeFileSync(
    path.join(root, ".ch", "docs", "memory", "PROJECT.md"),
    "---\nmemory_type: project_context\n---\n# Project\n\nAll referenced files are repo-relative.\n",
    "utf8",
  );
}

function collectGeneratedTextFiles(root: string): string[] {
  const generatedRoot = path.join(root, ".ch", "docs", "generated");
  if (!fs.existsSync(generatedRoot)) {
    return [];
  }
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (/\.(json|jsonl|md)$/u.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  visit(generatedRoot);
  return files;
}

function normalizedPathForms(value: string): string[] {
  const forms = new Set<string>();
  forms.add(value);
  try {
    forms.add(fs.realpathSync(value));
  } catch {
    // The unresolved form is still useful for checking generated text.
  }
  return Array.from(forms).map((item) => item.split(path.sep).join("/"));
}

function assertGeneratedFilesDoNotContainLocalAbsolutePaths(root: string, extraForbidden: string[] = []): void {
  const forbidden = [
    ...normalizedPathForms(root),
    ...extraForbidden.flatMap((item) => normalizedPathForms(item)),
    "/Users/example/local-repo",
  ];
  const generatedFiles = collectGeneratedTextFiles(root);
  assert.ok(generatedFiles.length > 0);
  for (const filePath of generatedFiles) {
    const content = fs.readFileSync(filePath, "utf8").split(path.sep).join("/");
    for (const forbiddenPath of forbidden) {
      assert.equal(
        content.includes(forbiddenPath),
        false,
        `${path.relative(root, filePath)} should not contain local absolute path ${forbiddenPath}`,
      );
    }
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

test("workspace scaffold skill artifacts use relative paths instead of local absolute paths", () => {
  withTempDir("sinitek-scaffold-paths-", (workspaceRoot) => {
    seedMinimalHarnessRepo(workspaceRoot);

    runPythonSkill("repo-indexer/scripts/generate_repo_index.py", ["--root", workspaceRoot]);
    runPythonSkill("memory-indexer/scripts/generate_memory_index.py", ["--root", workspaceRoot]);
    runPythonSkill("memory-consolidator/scripts/consolidate_memory.py", ["--root", workspaceRoot]);
    runPythonSkill("memory-recall/scripts/build_recall_pack.py", ["--root", workspaceRoot]);
    runPythonSkill("memory-eval/scripts/evaluate_memory_recall.py", ["--root", workspaceRoot]);
    runPythonSkill("work-frontier/scripts/build_work_frontier.py", ["--root", workspaceRoot]);
    runPythonSkill("claim-release-auditor/scripts/audit_plan_claims.py", ["--root", workspaceRoot]);
    runPythonSkill("reference-pack-drift-auditor/scripts/audit_reference_pack_drift.py", ["--root", workspaceRoot]);

    withTempDir("sinitek-reference-pack-", (packRoot) => {
      const bundleRoot = path.join(packRoot, "bundle");
      fs.mkdirSync(bundleRoot, { recursive: true });
      fs.writeFileSync(path.join(bundleRoot, "AGENTS.md"), "# Imported Agents\n", "utf8");
      fs.writeFileSync(
        path.join(packRoot, "manifest.json"),
        JSON.stringify(
          {
            generator: "test",
            pack_name: "sample-pack",
            repo_root: "/Users/example/local-repo",
            output_dir: "/Users/example/local-repo/.ch/docs/generated/reference-packs",
            source_root: "/Users/example/local-repo",
            pack_dir: "/Users/example/local-repo/pack",
            items: [
              {
                path: "AGENTS.md",
                source_path: "/Users/example/local-repo/AGENTS.md",
                absolute_path: "/Users/example/local-repo/AGENTS.md",
                sha256: "test",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );
      runPythonSkill("reference-pack-importer/scripts/inspect_reference_pack_import.py", [
        "--root",
        workspaceRoot,
        "--pack-dir",
        packRoot,
      ]);

      assertGeneratedFilesDoNotContainLocalAbsolutePaths(workspaceRoot, [packRoot]);
    });

    const repoManifest = readJson<{ repo_root: string; output_dir: string }>(
      path.join(workspaceRoot, ".ch", "docs", "generated", "repo-index", "manifest.json"),
    );
    assert.deepEqual(
      { repo_root: repoManifest.repo_root, output_dir: repoManifest.output_dir },
      { repo_root: ".", output_dir: ".ch/docs/generated/repo-index" },
    );

    const memorySummary = readJson<{ repo_root: string }>(
      path.join(workspaceRoot, ".ch", "docs", "generated", "memory-index", "summary.json"),
    );
    assert.equal(memorySummary.repo_root, ".");

    const recallSummary = readJson<{ repo_root: string }>(
      path.join(workspaceRoot, ".ch", "docs", "generated", "memory-index", ".local", "recall-summary.json"),
    );
    assert.equal(recallSummary.repo_root, ".");

    assertGeneratedFilesDoNotContainLocalAbsolutePaths(workspaceRoot);
  });
});

test("exec plan completed archives use month directories in repo and scaffold", () => {
  const conventionFiles = [
    ".ch/docs/exec-plans/README.md",
    ".ch/docs/PLANS.md",
    ".agents/skills/execution-plan/SKILL.md",
    "media/workspace-scaffold/.ch/docs/exec-plans/README.md",
    "media/workspace-scaffold/.ch/docs/PLANS.md",
    "media/workspace-scaffold/.agents/skills/execution-plan/SKILL.md",
  ];

  for (const relativePath of conventionFiles) {
    const content = readRepoText(relativePath);
    assert.match(content, /completed\/(?:<YYYY-MM>|YYYY-MM)\//u, `${relativePath} should document month archives`);
  }

  assert.match(readRepoText(".ch/docs/exec-plans/README.md"), /completed\/\*\*\/\*\.md/u);
  assert.match(readRepoText("media/workspace-scaffold/.ch/docs/exec-plans/README.md"), /completed\/\*\*\/\*\.md/u);
  assert.match(readRepoText(".agents/skills/execution-plan/SKILL.md"), /completed\/\*\*\/\*\.md/u);
  assert.match(
    readRepoText("media/workspace-scaffold/.agents/skills/execution-plan/SKILL.md"),
    /completed\/\*\*\/\*\.md/u,
  );

  const completedRoot = path.join(repoRoot, ".ch", "docs", "exec-plans", "completed");
  const flatCompletedPlans = fs
    .readdirSync(completedRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
  assert.deepEqual(flatCompletedPlans, []);
});
