import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  LOOP_PLUS_DISPLAY_NAME,
  LOOP_PLUS_INTERACTIVE_MODE,
  type CliName,
  type InteractiveMode,
  type ThinkingMode,
} from "../../cli/types";
import { LEGACY_LOOP_INTERACTIVE_MODE } from "../../loopLegacyMigration";
import {
  isInteractiveMode,
  normalizeVisibleInteractiveMode,
} from "../../promptRunState";
import {
  createScheduledTaskRecord,
  normalizeScheduledTaskRecord,
  readScheduledTaskStore,
  resolveScheduledTaskExecutionConfig,
  resolveScheduledTaskExecutionConfigForTask,
  writeScheduledTaskStore,
} from "../../scheduledTaskStore";
import {
  loadWorkspaceSettings,
  saveWorkspaceSettings,
  type WorkspaceSettingsStoreOptions,
} from "../../workspaceSettingsStore";

const originalHome = process.env.HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-plus-contract-"));
process.env.HOME = testHome;
const loopTaskStore = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
if (originalHome === undefined) {
  delete process.env.HOME;
} else {
  process.env.HOME = originalHome;
}

const scheduledDeps = {
  isCliName: (value: string): value is CliName => (
    value === "codex" || value === "claude" || value === "opencode"
  ),
  isInteractiveMode: (value: unknown): value is InteractiveMode => (
    value === "coding" || value === "plan" || value === "loop" || value === "graph"
  ),
  isThinkingMode: (value: unknown): value is ThinkingMode => value === "high" || value === "medium",
};

test.after(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});

test("keeps loop_plus visible and preserves plan-to-coding plus legacy loop migration", () => {
  assert.equal(LOOP_PLUS_INTERACTIVE_MODE, "loop_plus");
  assert.equal(LOOP_PLUS_DISPLAY_NAME, "Loop+");
  assert.equal(isInteractiveMode("loop_plus"), true);
  assert.equal(normalizeVisibleInteractiveMode("loop_plus"), "loop_plus");
  assert.notEqual(normalizeVisibleInteractiveMode("loop_plus"), "coding");
  assert.equal(normalizeVisibleInteractiveMode("plan"), "coding");
  assert.equal(normalizeVisibleInteractiveMode(LEGACY_LOOP_INTERACTIVE_MODE), "loop");
  assert.equal(normalizeVisibleInteractiveMode("loop"), "loop");
  assert.equal(normalizeVisibleInteractiveMode("graph"), "graph");
  assert.equal(normalizeVisibleInteractiveMode("vibe"), "coding");
  assert.equal(normalizeVisibleInteractiveMode(undefined), "coding");
});

test("restores loop_plus from workspace settings without collapsing it to Vibe", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(testHome, "workspace-settings-"));
  const realOptions = createWorkspaceOptions(workspaceSettingsDir, {
    isInteractiveMode,
    normalizeVisibleInteractiveMode,
  });
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  fs.writeFileSync(filePath, JSON.stringify({
    interactiveModeByCli: {
      codex: "loop_plus",
      claude: "plan",
      opencode: LEGACY_LOOP_INTERACTIVE_MODE,
    },
    loopExecutionModeByCli: {
      codex: "debate_multi_agent",
    },
  }), "utf8");

  const loaded = loadWorkspaceSettings(realOptions);
  assert.equal(loaded.interactiveModeByCli?.codex, "loop_plus");
  assert.equal(loaded.interactiveModeByCli?.claude, "coding");
  assert.equal(loaded.interactiveModeByCli?.opencode, "loop");
  assert.equal(loaded.loopExecutionModeByCli?.codex, "debate_multi_agent");
  saveWorkspaceSettings(loaded, realOptions);
  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    interactiveModeByCli?: Record<string, string>;
  };
  assert.equal(persisted.interactiveModeByCli?.codex, "loop_plus");
  assert.equal(loadWorkspaceSettings(realOptions).interactiveModeByCli?.codex, "loop_plus");

  const staleOptions = createWorkspaceOptions(workspaceSettingsDir, {
    isInteractiveMode: (value): value is InteractiveMode => (
      value === "coding" || value === "plan" || value === "loop"
    ),
    normalizeVisibleInteractiveMode: (value) => (
      value === "plan" || value === "loop" ? value : "coding"
    ),
  });
  fs.writeFileSync(filePath, JSON.stringify({
    interactiveModeByCli: { codex: "loop_plus", claude: "plan" },
  }), "utf8");
  const staleLoaded = loadWorkspaceSettings(staleOptions);
  assert.equal(staleLoaded.interactiveModeByCli?.codex, "loop_plus");
  assert.equal(staleLoaded.interactiveModeByCli?.claude, "plan");
});

test("stores a Loop+ scheduled task without a debate execution mode", () => {
  const created = createScheduledTaskRecord({
    id: "loop-plus-scheduled",
    prompt: "按 Loop+ 执行定时任务",
    scheduledAt: Date.now() + 60_000,
    cli: "codex",
    workspaceKey: "loop-plus-contract",
    interactiveMode: "loop_plus",
    loopMainModel: "main-model",
    loopSubtaskModel: "subtask-model",
    loopMainThinkingMode: "high",
    loopSubtaskThinkingMode: "medium",
    loopExecutionMode: "debate_multi_agent",
  }, 1_700_000_000_000);
  assert.equal(created.interactiveMode, "loop_plus");
  assert.equal(Object.prototype.hasOwnProperty.call(created, "loopExecutionMode"), false);
  assert.equal(created.loopMainModel, "main-model");

  const storeDir = fs.mkdtempSync(path.join(testHome, "scheduled-"));
  const storeFile = path.join(storeDir, "scheduled-tasks.json");
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile, JSON.stringify({
    tasks: [{
      ...created,
      loopExecutionMode: "debate_multi_agent",
    }],
  }), "utf8");
  const deps = { ...scheduledDeps, storeFile, logError: () => undefined };
  const loaded = readScheduledTaskStore(deps).tasks[0];
  assert.ok(loaded);
  assert.equal(loaded.interactiveMode, "loop_plus");
  assert.equal(Object.prototype.hasOwnProperty.call(loaded, "loopExecutionMode"), false);
  writeScheduledTaskStore({ tasks: [loaded] }, deps);
  const persisted = JSON.parse(fs.readFileSync(storeFile, "utf8")) as {
    tasks: Array<{ interactiveMode?: string; loopExecutionMode?: string }>;
  };
  assert.equal(persisted.tasks[0].interactiveMode, "loop_plus");
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.tasks[0], "loopExecutionMode"), false);

  assert.deepEqual(
    resolveScheduledTaskExecutionConfig("loop_plus", "debate_multi_agent"),
    { interactiveMode: "loop_plus" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfigForTask(
      { interactiveMode: "loop_plus", loopExecutionMode: "debate_multi_agent" },
      "loop",
      "debate_multi_agent",
    ),
    { interactiveMode: "loop_plus" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfigForTask({}, "loop_plus", "main_sub_multi_agent"),
    { interactiveMode: "loop_plus" },
  );
  assert.equal(
    normalizeScheduledTaskRecord({
      ...created,
      interactiveMode: "loop",
      loopExecutionMode: "debate_multi_agent",
    }, scheduledDeps)?.loopExecutionMode,
    "debate_multi_agent",
  );
});

test("round-trips Loop+ scheduling mode and raw snapshots from disk", () => {
  const snapshot = {
    version: 1,
    phase: "waiting",
    currentReview: {
      eventId: "loop-plus-finish:当前:1",
      subtaskId: "current",
      attemptId: "1",
      outcome: "completed",
      detail: "待验收",
    },
    reviewQueue: [{
      eventId: "loop-plus-finish:排队:2",
      subtaskId: "queued",
      attemptId: "2",
      outcome: "failed",
      detail: null,
    }],
    pending: [{ subtaskId: "pending", attemptId: "3", state: "pending" }],
    running: [{ subtaskId: "running-subtask", attemptId: "4", state: "running" }],
    seenAttempts: [{ subtaskId: "running-subtask", attemptId: "4", disposition: "open" }],
    futureHostField: { nested: ["队列", 1] },
  };
  const task = writeRawTask("event-snapshot", {
    schedulingMode: " event_driven ",
    status: "running",
    activeSubtaskIds: ["running-subtask"],
    loopPlus: snapshot,
  });

  const loaded = loopTaskStore.readLoopTaskStore(task.taskStoreFile).tasks[0];
  assert.equal(loaded.schedulingMode, "event_driven");
  assert.equal(loopTaskStore.resolveLoopSchedulingMode(loaded.schedulingMode), "event_driven");
  assert.equal(loaded.status, "running");
  assert.deepEqual(loaded.activeSubtaskIds, ["running-subtask"]);
  assert.deepEqual(loaded.loopPlus, snapshot);

  loopTaskStore.writeLoopTaskStore(task.taskStoreFile, { tasks: [loaded] });
  const persisted = JSON.parse(fs.readFileSync(task.taskStoreFile, "utf8")) as {
    tasks: Array<{ schedulingMode?: string; status?: string; loopPlus?: unknown }>;
  };
  assert.equal(persisted.tasks[0].schedulingMode, "event_driven");
  assert.equal(persisted.tasks[0].status, "running");
  assert.deepEqual(persisted.tasks[0].loopPlus, snapshot);

  const updated = loopTaskStore.updateLoopTaskRecord(task.id, {
    finalSummary: "只更新摘要，不能重置快照。",
    updatedAt: Date.now(),
  });
  assert.equal(updated?.finalSummary, "只更新摘要，不能重置快照。");
  const reread = loopTaskStore.readLoopTaskStore(task.taskStoreFile).tasks[0];
  assert.equal(reread.status, "running");
  assert.equal(reread.schedulingMode, "event_driven");
  assert.deepEqual(reread.loopPlus, snapshot);
  assert.notEqual(path.resolve(task.taskStoreFile).startsWith(path.resolve(testHome)), false);
});

test("does not downgrade a damaged event-driven snapshot or classic compatibility records", () => {
  const missing = writeRawTask("event-missing", {
    schedulingMode: "event_driven",
    status: "running",
  });
  const missingLoaded = loopTaskStore.readLoopTaskStore(missing.taskStoreFile).tasks[0];
  assert.equal(missingLoaded.schedulingMode, "event_driven");
  assert.equal(Object.prototype.hasOwnProperty.call(missingLoaded, "loopPlus"), false);
  assert.equal(missingLoaded.status, "running");

  const damagedValues = [null, "not-an-object", [], { reviewQueue: null, currentReview: 5, pending: "bad" }];
  damagedValues.forEach((loopPlus, index) => {
    const damaged = writeRawTask(`event-damaged-${index}`, {
      schedulingMode: "event_driven",
      status: "running",
      loopPlus,
    });
    const loaded = loopTaskStore.readLoopTaskStore(damaged.taskStoreFile).tasks[0];
    assert.equal(loaded.schedulingMode, "event_driven");
    assert.equal(loaded.status, "running");
    assert.deepEqual(loaded.loopPlus, loopPlus);
    assert.notEqual(loaded.status, "completed");
  });

  const classic = writeRawTask("classic-missing", { status: "running" });
  const explicitClassic = writeRawTask("classic-explicit", {
    schedulingMode: "classic",
    status: "running",
    loopPlus: { reviewQueue: [{ eventId: "keep-raw" }] },
  });
  const unknown = writeRawTask("classic-unknown", {
    schedulingMode: "fifo",
    status: "running",
    loopPlus: { reviewQueue: [{ eventId: "do-not-drop" }] },
  });
  const classicLoaded = loopTaskStore.readLoopTaskStore(classic.taskStoreFile).tasks[0];
  const explicitLoaded = loopTaskStore.readLoopTaskStore(explicitClassic.taskStoreFile).tasks[0];
  const unknownLoaded = loopTaskStore.readLoopTaskStore(unknown.taskStoreFile).tasks[0];
  assert.equal(Object.prototype.hasOwnProperty.call(classicLoaded, "schedulingMode"), false);
  assert.equal(loopTaskStore.resolveLoopSchedulingMode(classicLoaded.schedulingMode), "classic");
  assert.equal(explicitLoaded.schedulingMode, "classic");
  assert.deepEqual(explicitLoaded.loopPlus, { reviewQueue: [{ eventId: "keep-raw" }] });
  assert.equal(Object.prototype.hasOwnProperty.call(unknownLoaded, "schedulingMode"), false);
  assert.equal(loopTaskStore.resolveLoopSchedulingMode("fifo"), "classic");
  assert.deepEqual(unknownLoaded.loopPlus, { reviewQueue: [{ eventId: "do-not-drop" }] });
  assert.equal(unknownLoaded.status, "running");
});

function createWorkspaceOptions(
  workspaceSettingsDir: string,
  modeOptions: Pick<WorkspaceSettingsStoreOptions, "isInteractiveMode" | "normalizeVisibleInteractiveMode">,
): WorkspaceSettingsStoreOptions {
  return {
    workspaceSettingsDir,
    workspaceKey: "workspace",
    isCliName: (value): value is CliName => (
      value === "codex" || value === "claude" || value === "opencode"
    ),
    isThinkingMode: (value): value is ThinkingMode => value === "off" || value === "high",
    normalizeLoopMaxRounds: () => 20,
    sanitizeConversationTabRecord: () => null,
    ...modeOptions,
  };
}

function writeRawTask(id: string, extra: Record<string, unknown>): { id: string; taskStoreFile: string } {
  const now = Date.now();
  const taskStoreFile = loopTaskStore.buildLoopTaskStoreFile(
    "codex",
    "loop-plus-contract",
    `session-${id}`,
    id,
  );
  const task = {
    id,
    cli: "codex",
    workspaceKey: "loop-plus-contract",
    taskStoreFile,
    rootPrompt: "Loop+ contract storage fixture.",
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: 20,
    currentRound: 1,
    communicationDir: path.join(testHome, "communications", id),
    mainCommunicationFile: path.join(testHome, "communications", id, "main-task.md"),
    sessionId: `session-${id}`,
    activeSubtaskId: "running-subtask",
    activeSubtaskIds: ["running-subtask"],
    subTasks: [],
    rounds: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    ...extra,
  };
  fs.mkdirSync(path.dirname(taskStoreFile), { recursive: true });
  fs.writeFileSync(taskStoreFile, JSON.stringify({ tasks: [task] }, null, 2), "utf8");
  return { id, taskStoreFile };
}
