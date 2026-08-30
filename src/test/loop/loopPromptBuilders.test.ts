import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLoopDebateBriefMarkdown,
  buildLoopDebateConsensusModelPrompt,
} from "../../loopPromptBuilders";
import { buildLoopDebatePaths, type LoopDebateParticipantRecord } from "../../loopDebate";
import type { LoopTaskRecord } from "../../loopTaskStore";

function createTask(): LoopTaskRecord {
  const now = Date.UTC(2026, 6, 15, 8, 0, 0);
  return {
    id: "prompt-builder-task",
    cli: "codex",
    workspaceKey: "prompt-builder-workspace",
    taskStoreFile: "/tmp/loop-tasks.json",
    rootPrompt: "ROOT_OBJECTIVE_MARKER",
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: 20,
    currentRound: 1,
    communicationDir: "/tmp/loop-communications/prompt-builder-task",
    mainCommunicationFile: "/tmp/loop-communications/prompt-builder-task/main-task.md",
    subTasks: [],
    rounds: [],
    supplementalRequirements: ["SUPPLEMENTAL_REQUIREMENT_MARKER"],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function createParticipants(): LoopDebateParticipantRecord[] {
  return [
    { id: "blue", role: "blue_team", title: "Blue", status: "completed", artifactFile: "/tmp/blue.md", updatedAt: 1 },
    { id: "red", role: "red_team", title: "Red", status: "completed", artifactFile: "/tmp/red.md", updatedAt: 2 },
  ];
}

test("keeps Loop debate prompts free of Workflow Skill catalogs and skill IDs", () => {
  const task = createTask();
  const paths = buildLoopDebatePaths(task.communicationDir, 1);
  const brief = buildLoopDebateBriefMarkdown(task, { cli: "codex" }, 1, paths, "CONTINUE_PROMPT_MARKER");
  const consensus = buildLoopDebateConsensusModelPrompt(task, 1, paths, createParticipants());

  assert.doesNotMatch(brief, /Skill|skillIds|catalog/u);
  assert.doesNotMatch(consensus, /Skill|skillIds|catalog/u);
  assert.match(brief, /CONTINUE_PROMPT_MARKER/u);
  assert.match(consensus, /"subtasks"/u);
  assert.doesNotMatch(consensus, /"status":"sleep"/u);
  assert.doesNotMatch(consensus, /wakeAfterSeconds|sleepReason|自动睡眠/u);
});
