import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { spawnSync } from "node:child_process";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const previousHome = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-history-reader-home-"));
process.env.HOME = home;
require("../../extensionHost/departmentGroupChatProjection");
const { createDepartmentProductionTaskStore, createDepartmentProductionTaskStoreForHost } = require("../../extensionHost/departmentProductionTaskStore") as typeof import("../../extensionHost/departmentProductionTaskStore");
const { prepareDepartmentTaskRecord } = require("../../extensionHost/departmentOwnedTaskRepository") as typeof import("../../extensionHost/departmentOwnedTaskRepository");
const { buildSystemLoopPlusAcceptancePlanSnapshot } = require("../../loopPlusAcceptancePlan") as typeof import("../../loopPlusAcceptancePlan");
const { readDepartmentHistoricalLeaderIds, readDepartmentHistoricalTask } = require("../../extensionHost/departmentHistoricalTaskStore") as typeof import("../../extensionHost/departmentHistoricalTaskStore");
const { departmentRecords } = require("../loop/departmentGroupChatHost.fixture") as typeof import("../loop/departmentGroupChatHost.fixture");
if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test("historical owner observation distinguishes a dead local PID from live, legacy or foreign markers", () => {
  const { readHistoricalDepartmentSourceState } = require("../../extensionHost/departmentOwnedTaskSource") as typeof import("../../extensionHost/departmentOwnedTaskSource");
  const root = fs.mkdtempSync(path.join(home, "marker-"));
  const file = path.join(root, ".department-owner.json");
  const sourceId = "department-production-v1";
  const exited = spawnSync(process.execPath, ["-e", ""], { timeout: 10000 });
  assert.equal(exited.status, 0);
  const original = { version: 1, sourceId, token: "a".repeat(64), revision: 2 };
  for (const [marker, expected] of [
    [original, "unverified"], [{ ...original, hostname: os.hostname(), pid: process.pid }, "unverified"],
    [{ ...original, hostname: `${os.hostname()}-other`, pid: exited.pid }, "unverified"],
    [{ ...original, hostname: os.hostname(), pid: -1 }, "unverified"],
    [{ ...original, hostname: os.hostname(), pid: exited.pid }, "inactive"],
  ] as const) {
    const bytes = JSON.stringify(marker);
    fs.writeFileSync(file, bytes);
    assert.equal(readHistoricalDepartmentSourceState(root, sourceId), expected);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
  }
});

test("cold host reads a held department source as history without claiming or mutating it", async () => {
  const dataDirectory = path.join(home, ".sinitek_cli");
  const first = createDepartmentProductionTaskStore(path.join(dataDirectory, "department-tasks-v1"), true);
  const records = departmentRecords();
  const now = Date.now();
  records.root.createdAt = now;
  records.root.updatedAt = now;
  records.root.sessionId = "historical-director-session";
  records.leader.createdAt = now;
  records.leader.updatedAt = now;
  records.leader.sessionId = "historical-leader-session";
  const preparedTask = (task: typeof records.root) => {
    const metadata = structuredClone(task.department!);
    metadata.routes = { director: { cli: "codex" }, leader: { cli: "codex" }, employee: { cli: "codex" } };
    return prepareDepartmentTaskRecord(task, metadata, buildSystemLoopPlusAcceptancePlanSnapshot());
  };
  const root = first.create(preparedTask(records.root));
  const leader = first.create(preparedTask(records.leader));
  const sourceFile = root.taskStoreFile;
  const before = fs.readFileSync(sourceFile, "utf8");

  const second = createDepartmentProductionTaskStoreForHost(dataDirectory);
  try {
    assert.equal(second.readTaskRecord(leader.id), null, "the second host does not gain write ownership of the held source");
    const observedLeader = readDepartmentHistoricalTask(leader.id);
    assert.equal(observedLeader?.task.id, leader.id);
    assert.equal(observedLeader?.sourceState, "unverified");
    assert.deepEqual(readDepartmentHistoricalLeaderIds(root.id, records.root.subTasks[0]!.id), [leader.id]);
    assert.equal(fs.readFileSync(sourceFile, "utf8"), before, "historical reads never alter persisted task state");
    assert.equal(fs.existsSync(path.join(path.dirname(sourceFile), ".department-owner.json")), true,
      "the history reader leaves the original host's owner marker untouched");
  } finally {
    assert.equal(await second.close(), true);
    assert.equal(await first.close(), true);
  }
  assert.equal(fs.existsSync(path.join(path.dirname(sourceFile), ".department-owner.json")), false);
  const unusedRoot = path.join(dataDirectory, "department-empty-unused-v1");
  const unusedSource = createDepartmentProductionTaskStore(unusedRoot, true);
  assert.equal(await unusedSource.close(), true);
  fs.rmSync(unusedRoot, { recursive: true, force: true });
  const inactiveLeader = readDepartmentHistoricalTask(leader.id);
  assert.equal(inactiveLeader?.task.id, leader.id);
  assert.equal(inactiveLeader?.sourceState, "inactive");
  const leaderIds = readDepartmentHistoricalLeaderIds(root.id, records.root.subTasks[0]!.id);
  assert.deepEqual(leaderIds, [leader.id]);
  assert.equal(fs.readFileSync(sourceFile, "utf8"), before, "cold historical reads do not reconcile the task or transcript status");

  const { projectDepartmentConversationTab } = require("../../extensionHost/departmentConversationTabs") as typeof import("../../extensionHost/departmentConversationTabs");
  const summary = projectDepartmentConversationTab({
    id: "restored-leader-tab",
    cli: leader.cli,
    sessionId: leader.sessionId!,
    createdAt: now,
    loopTaskRole: "main",
    loopTaskId: leader.id,
  }, inactiveLeader!.task, [], {
    readTaskRecord: (taskId) => readDepartmentHistoricalTask(taskId)?.task ?? null,
    readDepartmentLeaderTaskIds: readDepartmentHistoricalLeaderIds,
  });
  assert.equal(summary.departmentPresentation?.role, "leader",
    "a restored conversation tab remains linked to its verified leader task after the owner releases the source");
  assert.equal(summary.departmentPresentation?.taskId, leader.id);
});
