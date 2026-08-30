import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = process.cwd();
const scaffoldRoot = path.join(repoRoot, "media", "workspace-scaffold");
const scaffoldSkillsRoot = path.join(scaffoldRoot, ".agents", "skills");

function readRepoText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function existingDirectories(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function assertPathExists(relativePath: string): void {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
}

function assertPathMissing(relativePath: string): void {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false, `${relativePath} should not exist`);
}

test("workspace scaffold keeps only the lightweight harness skills and docs", () => {
  assert.deepEqual(existingDirectories(scaffoldSkillsRoot), ["codegraph", "execution-plan", "ontology"]);

  const requiredPaths = [
    "media/workspace-scaffold/AGENTS.md",
    "media/workspace-scaffold/ARCHITECTURE.md",
    "media/workspace-scaffold/.agents/skills/AGENTS.md",
    "media/workspace-scaffold/.agents/skills/codegraph/SKILL.md",
    "media/workspace-scaffold/.agents/skills/execution-plan/SKILL.md",
    "media/workspace-scaffold/.agents/skills/ontology/SKILL.md",
    "media/workspace-scaffold/.ch/docs/README.md",
    "media/workspace-scaffold/.ch/docs/SECURITY.md",
    "media/workspace-scaffold/.ch/docs/TOOL_POLICY.md",
    "media/workspace-scaffold/.ch/docs/TESTING.md",
    "media/workspace-scaffold/.ch/docs/MEMORY.md",
    "media/workspace-scaffold/.ch/docs/product-specs/FEATURE_INVENTORY.md",
    "media/workspace-scaffold/.ch/docs/product-specs/TEMPLATE.md",
    "media/workspace-scaffold/.ch/docs/ontology/README.md",
    "media/workspace-scaffold/.ch/docs/exec-plans/README.md",
    "media/workspace-scaffold/.ch/docs/memory/README.md",
    "media/workspace-scaffold/.ch/docs/runbooks/README.md",
    "media/workspace-scaffold/.ch/docs/runbooks/PITFALLS.md",
  ];

  for (const relativePath of requiredPaths) {
    assertPathExists(relativePath);
  }

  const removedPaths = [
    "media/workspace-scaffold/.agents/profiles",
    "media/workspace-scaffold/.agents/skills/task-board",
    "media/workspace-scaffold/.agents/skills/work-frontier",
    "media/workspace-scaffold/.agents/skills/memory-indexer",
    "media/workspace-scaffold/.agents/skills/memory-recall",
    "media/workspace-scaffold/.agents/skills/reference-pack",
    "media/workspace-scaffold/.ch/docs/AGENTS.md",
    "media/workspace-scaffold/.ch/docs/FEATURE_CHECKLISTS.md",
    "media/workspace-scaffold/.ch/docs/PLANS.md",
    "media/workspace-scaffold/.ch/docs/DESIGN.md",
    "media/workspace-scaffold/.ch/docs/FRONTEND.md",
    "media/workspace-scaffold/.ch/docs/PRODUCT_SENSE.md",
    "media/workspace-scaffold/.ch/docs/RELIABILITY.md",
    "media/workspace-scaffold/.ch/docs/design-docs",
    "media/workspace-scaffold/.ch/docs/generated",
    "media/workspace-scaffold/.ch/docs/handoffs",
    "media/workspace-scaffold/.ch/docs/references",
    "media/workspace-scaffold/.ch/docs/product-specs/index.md",
  ];

  for (const relativePath of removedPaths) {
    assertPathMissing(relativePath);
  }

  const featureInventory = readRepoText("media/workspace-scaffold/.ch/docs/product-specs/FEATURE_INVENTORY.md");
  assert.match(featureInventory, /\| 能力 \| 状态 \| 角色 \| 规格来源 \| 实现入口 \| 最近验证链接 \|/u);
  assert.doesNotMatch(featureInventory, /\|[^\n]*(测试状态|备注)[^\n]*\|/u);
});

test("workspace scaffold ontology validates from the scaffold root", () => {
  childProcess.execFileSync(
    "python3",
    [
      path.join(scaffoldSkillsRoot, "ontology", "scripts", "search_ontology.py"),
      "--root",
      scaffoldRoot,
      "--validate",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
});

test("exec plan completed archives use month directories in repo and scaffold", () => {
  const conventionFiles = [
    ".ch/docs/exec-plans/README.md",
    ".agents/skills/execution-plan/SKILL.md",
    "media/workspace-scaffold/.ch/docs/exec-plans/README.md",
    "media/workspace-scaffold/.agents/skills/execution-plan/SKILL.md",
  ];

  for (const relativePath of conventionFiles) {
    const content = readRepoText(relativePath);
    assert.match(content, /completed\/(?:<YYYY-MM>|YYYY-MM)\//u, `${relativePath} should document month archives`);
  }

  assert.match(readRepoText(".ch/docs/exec-plans/README.md"), /completed\/\*\*\/\*\.md/u);
  assert.match(readRepoText("media/workspace-scaffold/.ch/docs/exec-plans/README.md"), /completed\/\*\*\/\*\.md/u);

  const completedRoot = path.join(repoRoot, ".ch", "docs", "exec-plans", "completed");
  const flatCompletedPlans = fs
    .readdirSync(completedRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
  assert.deepEqual(flatCompletedPlans, []);
});
