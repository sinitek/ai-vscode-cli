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

const executionPlanTypes = ["feature", "bugfix", "refactor", "perf"];
const harnessRoots = ["", "media/workspace-scaffold/"];

function assertExcludedExecutionPlanTypes(content: string, relativePath: string): void {
  assert.match(content, /`test`、`chore`、`doc`（含 `docs`）(?:类型)?任务[^。\n]*不在[^。\n]*创建或归档计划/u, relativePath);
  assert.match(content, /`test`、`chore`、`doc`（含 `docs`）[^。\n]*不参与(?:计划)?拆分/u, relativePath);
  assert.match(content, /(?:测试、验证和文档同步要求仍需执行|不免除(?:相应)?(?:测试、)?验证和文档同步要求)/u, relativePath);
}

test("execution plan typed contracts keep strict names, four allowed types and real cross-type splits", () => {
  for (const prefix of harnessRoots) {
    const relativePath = `${prefix}.ch/docs/exec-plans/README.md`;
    const content = readRepoText(relativePath);
    assert.ok(content.includes("YYYY-MM-DD-<type>-<kebab-case-slug>.md"), relativePath);
    assert.match(content, /日期后[^。\n]*(?:只出现一个|只能有一个) type/u, relativePath);
    const tableTypes = Array.from(content.matchAll(/^\| `([a-z]+)` \|/gmu), (match) => match[1]);
    assert.deepEqual(tableTypes, executionPlanTypes, relativePath);
    assert.match(content, /(?:不要使用|不得缩写为) `feat` 或 `fix`/u, relativePath);
    assert.match(content, /`bugfix`[^\n]*已发布版本/u, relativePath);
    assert.match(content, /多个允许的实质工作类型[^。]*按允许类型分别(?:建立计划文件|建计划)/u, relativePath);
    assert.match(content, /关联计划[^。]*具体相对路径[^。]*共同背景[^。]*依赖/u, relativePath);
    assert.match(content, /(?:禁止|不)[^。]*复制[^。]*混合正文/u, relativePath);
    assert.match(content, /实际跨类型工作不得[^。]*附带事项/u, relativePath);
    assertExcludedExecutionPlanTypes(content, relativePath);
    assert.match(content, /不得改名为允许类型[^。]*绕过排除规则/u, relativePath);
    assert.match(content, /真实状态/u, relativePath);
    assert.match(content, /(?:不因关联关系伪造完成|拆分不伪造完成)/u, relativePath);
    assert.match(content, /不(?:得)?改变既有阻塞状态/u, relativePath);
    const examplePaths = Array.from(
      content.matchAll(/`(active\/\d{4}-\d{2}-\d{2}-[a-z]+-[a-z0-9]+(?:-[a-z0-9]+)*\.md)`/gu),
      (match) => match[1],
    );
    assert.ok(examplePaths.some((planPath) => planPath.includes("-feature-")), relativePath);
    assert.ok(examplePaths.some((planPath) => planPath.includes("-perf-")), relativePath);
    for (const planPath of examplePaths) {
      const planType = planPath.match(/^active\/\d{4}-\d{2}-\d{2}-([a-z]+)-/u)?.[1];
      assert.ok(planType && executionPlanTypes.includes(planType), `${relativePath}: ${planPath}`);
    }
    assert.match(content, /互链[^。]*依赖/u, relativePath);
    assert.match(content, /回归测试开发和文档同步直接记入功能计划，不创建 `test` 或 `doc` \/ `docs` 计划/u, relativePath);
  }
});

test("execution plan typed contracts retain four-type skill scope, exclusions and independent state", () => {
  for (const prefix of harnessRoots) {
    const relativePath = `${prefix}.agents/skills/execution-plan/SKILL.md`;
    const content = readRepoText(relativePath);
    assert.ok(content.includes(".ch/docs/exec-plans/README.md"), relativePath);
    assert.ok(content.includes(".ch/docs/exec-plans/TEMPLATE.md"), relativePath);
    assert.ok(content.includes("active/YYYY-MM-DD-<type>-<kebab-case-slug>.md"), relativePath);
    assert.match(content, /日期后只能(?:有|出现)一个 type/u, relativePath);
    const allowedScope = content.match(/^仅适用于 (.+?) 类型/gmu)?.[0] ?? "";
    const scopeTypes = Array.from(allowedScope.matchAll(/`([a-z]+)`/gu), (match) => match[1]);
    assert.deepEqual(scopeTypes, executionPlanTypes, relativePath);
    assertExcludedExecutionPlanTypes(content, relativePath);
    assert.match(content, /不得改名为允许类型绕过排除规则/u, relativePath);
    assert.match(content, /不要使用 `feat` (?:\/|或) `fix`/u, relativePath);
    assert.match(content, /多个允许的实质工作类型[^。;；]*按允许类型分别建计划/u, relativePath);
    assert.match(content, /关联计划[^。]*具体(?:相对)?路径[^。]*依赖/u, relativePath);
    assert.match(content, /目标、范围、验收、验证和真实状态/u, relativePath);
    assert.match(content, /不伪造完成[^。]*不改变既有阻塞/u, relativePath);
    assert.match(content, /(?:禁止|不)[^。]*复制[^。]*混合正文/u, relativePath);
    assert.match(content, /测试、维护和文档工作直接记录在所属计划，不拆出上述类型的计划/u, relativePath);
    assert.match(content, /失败[^。\n]*处理结论/u, relativePath);
  }
});

test("execution plan typed contracts preserve four-type templates, exclusions, handoff and verification fields", () => {
  for (const prefix of harnessRoots) {
    const relativePath = `${prefix}.ch/docs/exec-plans/TEMPLATE.md`;
    const content = readRepoText(relativePath);
    assert.ok(content.includes("YYYY-MM-DD-<type>-<kebab-case-slug>.md"), relativePath);
    const typeLine = content.match(/^- 类型：(.+)$/mu)?.[1];
    assert.deepEqual(typeLine?.split(" / "), executionPlanTypes, relativePath);
    assertExcludedExecutionPlanTypes(content, relativePath);
    for (const field of [
      "日期", "状态", "关联计划", "owner", "claimed_at", "claim_ttl", "handoff_to",
      "单元自测命令", "单元测试新增/更新", "单元自测结果", "失败处理记录", "功能清单", "相关文档同步",
    ]) {
      assert.ok(content.includes(`- ${field}：`), `${relativePath}: ${field}`);
    }
    for (const heading of ["目标", "范围", "非目标", "验收标准", "验证计划", "任务列表", "决策记录"]) {
      assert.ok(content.includes(`## ${heading}\n`), `${relativePath}: ${heading}`);
    }
    assert.match(content, /真实状态/u, relativePath);
    assert.match(content, /关联计划[^。]*具体互链路径[^。]*依赖/u, relativePath);
  }
});

test("execution plan typed contracts keep root entries as navigation to the canonical rules", () => {
  for (const prefix of harnessRoots) {
    const agentsPath = `${prefix}AGENTS.md`;
    const agents = readRepoText(agentsPath);
    assert.ok(agents.includes("`execution-plan`"), agentsPath);
    assert.ok(agents.includes(".ch/docs/exec-plans/README.md"), agentsPath);
    assert.ok(agents.includes("TEMPLATE.md"), agentsPath);
    const docsPath = `${prefix}.ch/docs/README.md`;
    assert.ok(readRepoText(docsPath).includes(".ch/docs/exec-plans/README.md"), docsPath);
  }
});
