import assert = require("node:assert/strict");
import test = require("node:test");

const {
  buildLoopGroupChatPanelStateWithDeps,
  ensureLoopMainSubChatTranscriptWithDeps,
  resolveLoopPlusSubtaskMemberStatus,
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

  const readOnly = dependencies(false, null);
  const readOnlyState = buildLoopGroupChatPanelStateWithDeps(task(undefined), {
    ...readOnly.deps,
    readOnlyTranscript: true,
  });
  assert.equal(readOnly.writes.length, 0);
  assert.match(readOnlyState.error ?? "", /loopGroupChatChat\.transcriptMissing/u);
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

test("repairing member status follows the live phase instead of pending or historical flags", () => {
  const projection = {
    ok: true as const,
    schedulingMode: "event_driven" as const,
    activity: "idle" as const,
    phase: "idle" as const,
    wakePending: false,
    currentReview: {
      eventId: "review-d",
      subtaskId: "D",
      attemptId: "d-2",
      outcome: "completed" as const,
      detail: null,
      repairRound: 2,
    },
    reviewQueue: [],
    activeReviewEventIds: [] as string[],
    currentReviewCount: 1,
    reviewQueueCount: 0,
    visibleReviewCount: 1,
    running: [
      { subtaskId: "A", attemptId: "a-2", title: "返工", state: "running" as const, repairing: true },
      { subtaskId: "E", attemptId: "e-1", title: "首次", state: "running" as const },
      { subtaskId: "F", attemptId: "f-2", title: "中断返工", state: "running" as const, interrupted: true, repairing: true },
    ],
    pending: [
      { subtaskId: "B", attemptId: "b-2", title: "排队返工", state: "pending" as const, repairing: true },
    ],
    runningCount: 2,
    pendingCount: 1,
    repairRoundsBySubtask: { A: 1, B: 2, D: 2, F: 1, H: 3 },
    seenAttempts: [
      { subtaskId: "C", attemptId: "c-1", disposition: "reviewed" as const, outcome: "completed" as const, acceptance: "failed" as const },
      { subtaskId: "H", attemptId: "h-4", disposition: "reviewed" as const, outcome: "failed" as const, acceptance: "failed" as const },
    ],
  };
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "A", "running"), "repairing");
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "B", "pending"), "pending");
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "C", "completed"), "acceptance_failed");
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "D", "completed"), "queued_review");
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "E", "running"), "running");
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "F", "running"), "waiting_continuation");
  assert.equal(resolveLoopPlusSubtaskMemberStatus(projection, "H", "blocked"), "acceptance_failed");

  const classic = task(undefined);
  classic.schedulingMode = "classic";
  classic.loopPlus = undefined;
  classic.subTasks = [{ id: "classic-child", title: "经典", status: "running", updatedAt: 30 }];
  const { deps } = dependencies();
  const state = buildLoopGroupChatPanelStateWithDeps(classic, deps);
  assert.equal(state.loopPlus, undefined);
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "classic-child")?.status, "running");
});
