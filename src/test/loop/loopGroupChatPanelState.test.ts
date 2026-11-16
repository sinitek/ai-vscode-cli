import assert = require("node:assert/strict");
import test = require("node:test");

const {
  buildLoopGroupChatPanelStateWithDeps,
  ensureLoopMainSubChatTranscriptWithDeps,
} = require("../../loopGroupChatPanelState") as typeof import("../../loopGroupChatPanelState");
const { projectLoopPlusPanel } = require("../../loopPlusPanelProjection") as typeof import("../../loopPlusPanelProjection");
const { createLoopPlusScheduler } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
type LoopTaskRecord = import("../../loopTaskStore").LoopTaskRecord;

function task(loopPlus: unknown): LoopTaskRecord {
  return {
    id: "direct-panel-state",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/task.json",
    rootPrompt: "prompt",
    schedulingMode: "event_driven",
    status: "running",
    createdAt: 10,
    updatedAt: 20,
    maxRounds: 2,
    currentRound: 1,
    communicationDir: "/tmp/loop-chat",
    mainCommunicationFile: "/tmp/main.md",
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    loopPlus,
  };
}

function dependencies(fileExists = true, content: string | null = "# transcript\n") {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    deps: {
      collectRunningLoopTaskIds: () => new Set<string>(),
      readTextFileIfNonEmpty: () => content,
      fileExists: () => fileExists,
      writeTextFileEnsuringDir: (path: string, value: string) => {
        writes.push({ path, content: value });
        return true;
      },
      getActiveLoopSubtaskIds: () => [],
      buildLoopCompletedConclusionAndSummaryMarkdown: () => "done",
      t: (key: string) => key,
    },
  };
}

test("compatibility facade re-exports the original function objects", () => {
  require("../vscodeMock").installVscodeMock();
  const facade = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");
  assert.equal(facade.buildLoopGroupChatPanelStateWithDeps, buildLoopGroupChatPanelStateWithDeps);
  assert.equal(facade.projectLoopPlusPanel, projectLoopPlusPanel);
  assert.equal(facade.ensureLoopMainSubChatTranscriptWithDeps, ensureLoopMainSubChatTranscriptWithDeps);
});

test("direct Loop+ projection reads a scheduler copy without mutating the snapshot", () => {
  const snapshot = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
  const source = task(snapshot);
  const before = JSON.stringify(source);
  const projection = projectLoopPlusPanel(source);
  assert.ok(projection?.ok);
  assert.equal(JSON.stringify(source), before);
});

test("main activity stays visible beside a running child attempt", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const dispatched = scheduler.dispatch([{
    subtaskId: "child",
    attemptId: "child-attempt",
    title: "子任务",
    writeFiles: ["src/child.ts"],
  }]);
  assert.equal(dispatched.started.length, 1);
  const source = task(scheduler.snapshot());
  source.subTasks = [{ id: "child", title: "子任务", status: "running", updatedAt: 30 }];
  const { deps } = dependencies();
  const state = buildLoopGroupChatPanelStateWithDeps(source, { ...deps, mainModelRunning: true });
  assert.equal(state.loopPlus?.activity, "running");
  assert.equal(state.loopPlus?.runningCount, 1);
  assert.equal(state.rounds[0]?.participants.find((participant) => participant.id === "main")?.status, "running");
  assert.equal(state.rounds[0]?.participants.find((participant) => participant.id === "child")?.status, "running");
});

test("direct Loop+ projection preserves invalid snapshot and classic shapes", () => {
  assert.deepEqual(projectLoopPlusPanel(task(undefined)), {
    ok: false, schedulingMode: "event_driven", activity: "invalid", phase: "invalid", error: "missing",
  });
  assert.equal(projectLoopPlusPanel({ ...task({}), schedulingMode: "classic" }), null);
});

test("direct group chat state creates the initial transcript and reports a missing transcript", () => {
  const missing = dependencies(false, null);
  const state = buildLoopGroupChatPanelStateWithDeps(task(undefined), missing.deps);
  assert.equal(missing.writes.length, 1);
  assert.match(missing.writes[0]!.content, /^# Loop 主从群聊记录/mu);
  assert.match(state.error ?? "", /loopGroupChatChat\.transcriptMissing/u);
});

test("one state build reads each transcript once while a later refresh sees updated content", () => {
  const env = dependencies();
  let reads = 0;
  let content: string | null = "# 群聊\n\n## 任务事件\n首次内容\n";
  env.deps.readTextFileIfNonEmpty = () => { reads += 1; return content; };
  const source = task(undefined);
  const first = buildLoopGroupChatPanelStateWithDeps(source, env.deps);
  assert.match(first.chatMarkdown, /首次内容/u);
  assert.equal(reads, 1);
  content = "# 群聊\n\n## 任务事件\n刷新内容\n";
  assert.match(buildLoopGroupChatPanelStateWithDeps(source, env.deps).chatMarkdown, /刷新内容/u);
  assert.equal(reads, 2);
  content = null;
  const missing = buildLoopGroupChatPanelStateWithDeps(source, env.deps);
  assert.match(missing.error ?? "", /transcriptMissing/u);
  assert.equal(reads, 3);
});
