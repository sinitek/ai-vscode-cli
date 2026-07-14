import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLoopDebatePaths,
  type LoopDebateParticipantRecord,
} from "../loopDebate";
import {
  buildLoopDebateBriefMarkdown,
  buildLoopDebateConsensusModelPrompt,
} from "../loopPromptBuilders";
import type {
  LoopTaskKind,
  LoopTaskRecord,
} from "../loopTaskStore";

const compactSkillCatalogSection = [
  "高级开发 Skill 候选目录（宿主已校验，仅 development Loop 可用）：",
  "主模型只能为每个子任务返回 skillIds；不得返回路径、Markdown 正文或 skillGuidance。",
  "候选 compact metadata：",
  '- {"id":"test-driven-development","name":"test-driven-development","description":"Test first.","phases":["verify"],"taskKinds":["test"],"roles":["subtask"],"requiredCapabilities":[],"priority":10,"positiveTriggers":["tests"],"negativeTriggers":[]}',
  '- {"id":"interview-me","name":"interview-me","description":"Interactive discovery.","phases":["plan"],"taskKinds":["requirements"],"roles":["main"],"requiredCapabilities":["interactive-user"],"priority":20,"positiveTriggers":["interview"],"negativeTriggers":[]}',
].join("\n");

function createTask(taskKind?: LoopTaskKind): LoopTaskRecord {
  const now = Date.UTC(2026, 6, 12, 8, 0, 0);
  return {
    id: "prompt-builder-task",
    cli: "codex",
    workspaceKey: "prompt-builder-workspace",
    taskStoreFile: "/tmp/loop-tasks.json",
    rootPrompt: "ROOT_OBJECTIVE_MARKER",
    ...(taskKind ? { taskKind } : {}),
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: 20,
    currentRound: 1,
    communicationDir: "/tmp/loop-communications/prompt-builder-task",
    mainCommunicationFile: "/tmp/loop-communications/prompt-builder-task/main-task.md",
    subTasks: [{
      id: "existing-subtask",
      title: "Existing subtask",
      prompt: "Preserve the existing workflow.",
      status: "completed",
      updatedAt: now,
    }],
    rounds: [],
    supplementalRequirements: ["SUPPLEMENTAL_REQUIREMENT_MARKER"],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function createParticipants(): LoopDebateParticipantRecord[] {
  return [
    {
      id: "blue_planner",
      role: "blue_team",
      title: "蓝队方案方",
      status: "completed",
      artifactFile: "/tmp/blue-planner.md",
      updatedAt: 1,
    },
    {
      id: "red_attacker",
      role: "red_team",
      title: "红队攻击方",
      status: "completed",
      artifactFile: "/tmp/red-attacker.md",
      updatedAt: 2,
    },
  ];
}

function normalizeGeneratedTime(markdown: string): string {
  return markdown.replace(/^- 生成时间：.*$/mu, "- 生成时间：<normalized>");
}

function countOccurrences(value: string, expected: string): number {
  return value.split(expected).length - 1;
}

function hasOwnProperty(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

test("keeps legacy debate prompts free of Skill catalog markers", () => {
  const task = createTask();
  const paths = buildLoopDebatePaths(task.communicationDir, 1);

  const brief = buildLoopDebateBriefMarkdown(task, { cli: "codex" }, 1, paths);
  const consensus = buildLoopDebateConsensusModelPrompt(task, 1, paths, createParticipants());

  assert.doesNotMatch(brief, /高级开发 Skill 候选目录/u);
  assert.doesNotMatch(brief, /skillIds/u);
  assert.doesNotMatch(consensus, /高级开发 Skill 候选目录/u);
  assert.doesNotMatch(consensus, /skillIds/u);
});

test("injects one complete compact Skill catalog into development debate briefs", () => {
  const task = createTask("development");
  const paths = buildLoopDebatePaths(task.communicationDir, 1);

  const brief = buildLoopDebateBriefMarkdown(
    task,
    { cli: "codex" },
    1,
    paths,
    "CONTINUE_PROMPT_MARKER",
    `\n${compactSkillCatalogSection}\n`,
  );

  assert.equal(countOccurrences(brief, compactSkillCatalogSection), 1);
  assert.ok(brief.indexOf("ROOT_OBJECTIVE_MARKER") < brief.indexOf("CONTINUE_PROMPT_MARKER"));
  assert.ok(brief.indexOf("CONTINUE_PROMPT_MARKER") < brief.indexOf("SUPPLEMENTAL_REQUIREMENT_MARKER"));
  assert.ok(brief.indexOf("SUPPLEMENTAL_REQUIREMENT_MARKER") < brief.indexOf("## 子任务概要"));
  assert.ok(brief.indexOf("## 子任务概要") < brief.indexOf(compactSkillCatalogSection));
  assert.ok(brief.indexOf(compactSkillCatalogSection) < brief.indexOf("## 红蓝对抗约束"));
});

test("ignores compact Skill catalogs for non-development and unknown debate briefs", () => {
  for (const taskKind of ["non_development", undefined] as const) {
    const task = createTask(taskKind);
    const paths = buildLoopDebatePaths(task.communicationDir, 1);
    const baseline = buildLoopDebateBriefMarkdown(task, { cli: "codex" }, 1, paths, "continue");
    const withCatalog = buildLoopDebateBriefMarkdown(
      task,
      { cli: "codex" },
      1,
      paths,
      "continue",
      compactSkillCatalogSection,
    );

    assert.equal(normalizeGeneratedTime(withCatalog), normalizeGeneratedTime(baseline));
    assert.doesNotMatch(withCatalog, /高级开发 Skill 候选目录/u);
  }
});

test("treats a blank development Skill catalog as missing", () => {
  const task = createTask("development");
  const paths = buildLoopDebatePaths(task.communicationDir, 1);
  const baseline = buildLoopDebateBriefMarkdown(task, { cli: "codex" }, 1, paths);
  const withBlankCatalog = buildLoopDebateBriefMarkdown(
    task,
    { cli: "codex" },
    1,
    paths,
    undefined,
    " \n\t ",
  );

  assert.equal(normalizeGeneratedTime(withBlankCatalog), normalizeGeneratedTime(baseline));
  assert.doesNotMatch(withBlankCatalog, /高级开发 Skill 候选目录/u);
});

test("limits development consensus decisions to optional catalog Skill IDs", () => {
  const task = createTask("development");
  const paths = buildLoopDebatePaths(task.communicationDir, 1);

  const prompt = buildLoopDebateConsensusModelPrompt(
    task,
    1,
    paths,
    createParticipants(),
    compactSkillCatalogSection,
  );
  const continueExample = prompt
    .split("\n")
    .find((line) => line.startsWith('{"status":"continue"'));

  assert.ok(continueExample);
  const continueDecision = JSON.parse(continueExample) as {
    subtasks: Array<Record<string, unknown>>;
  };
  assert.deepEqual(continueDecision.subtasks[0].skillIds, ["test-driven-development"]);
  assert.equal(hasOwnProperty(continueDecision.subtasks[0], "skillGuidance"), false);
  assert.equal(hasOwnProperty(continueDecision.subtasks[0], "path"), false);
  assert.equal(hasOwnProperty(continueDecision.subtasks[0], "hash"), false);
  assert.equal(hasOwnProperty(continueDecision.subtasks[0], "command"), false);
  assert.equal(hasOwnProperty(continueDecision.subtasks[0], "cli"), false);
  assert.equal(hasOwnProperty(continueDecision.subtasks[0], "model"), false);
  assert.match(prompt, /skillIds\?: string\[\]/u);
  assert.match(prompt, /phases/u);
  assert.match(prompt, /taskKinds/u);
  assert.match(prompt, /roles/u);
  assert.match(prompt, /main-only/u);
  assert.match(prompt, /interactive\/main-only/u);
  assert.match(prompt, /requiredCapabilities/u);
  assert.match(prompt, /不得返回或复制 Skill path、hash、Markdown 正文、skillGuidance、CLI、model、command/u);
});

test("keeps consensus prompts unchanged without an eligible development catalog", () => {
  for (const taskKind of ["development", "non_development", undefined] as const) {
    const task = createTask(taskKind);
    const paths = buildLoopDebatePaths(task.communicationDir, 1);
    const baseline = buildLoopDebateConsensusModelPrompt(task, 1, paths, createParticipants());
    const catalog = taskKind === "development" ? " \n\t " : compactSkillCatalogSection;
    const withIneligibleCatalog = buildLoopDebateConsensusModelPrompt(
      task,
      1,
      paths,
      createParticipants(),
      catalog,
    );

    assert.equal(withIneligibleCatalog, baseline);
    assert.doesNotMatch(withIneligibleCatalog, /skillIds/u);
  }
});
