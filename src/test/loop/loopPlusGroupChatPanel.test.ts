import assert = require("node:assert/strict");
import test = require("node:test");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Isolate before importing modules that capture os.homedir() at load time.
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-plus-group-chat-panel-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
assert.equal(os.homedir(), testHome);
test.after(() => {
  try {
    assert.equal(path.dirname(testHome), path.resolve(os.tmpdir()));
    assert.ok(path.basename(testHome).startsWith("sinitek-loop-plus-group-chat-panel-"));
    fs.rmSync(testHome, { recursive: true, force: true });
    assert.equal(fs.existsSync(testHome), false);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  }
});

import { installVscodeMock } from "../vscodeMock";
import { buildLoopPlusAcceptanceFeedbackSection } from "../../loopPlusAcceptancePlan";
import { buildLoopBlockerSummary, LOOP_BLOCKER_EXAMPLE } from "../../loopBlocker";

installVscodeMock();

const {
  buildLoopGroupChatPanelStateWithDeps,
} = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");
const {
  buildLoopGroupChatPanelHtml,
  buildLoopGroupChatPanelContentPatch,
} = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");
const {
  createLoopPlusScheduler,
  buildLoopPlusFinishEventId,
} = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");

type LoopPlusScheduler = ReturnType<typeof createLoopPlusScheduler>;
type LoopTaskRecord = import("../../loopTaskStore").LoopTaskRecord;
type PanelState = ReturnType<typeof buildLoopGroupChatPanelStateWithDeps>;

function spec(subtaskId: string, attemptId: string, title?: string) {
  return {
    subtaskId,
    attemptId,
    ...(title ? { title } : {}),
    writeFiles: [`loop-plus/${subtaskId}-${attemptId}.txt`],
  };
}

function dispatchAndFinish(
  scheduler: LoopPlusScheduler,
  subtaskId: string,
  attemptId: string,
  detail?: string,
): void {
  const dispatched = scheduler.dispatch([spec(subtaskId, attemptId)]);
  assert.equal(dispatched.started.length, 1, subtaskId);
  const finished = scheduler.finish({
    subtaskId,
    attemptId,
    outcome: "completed",
    ...(detail ? { detail } : {}),
  });
  assert.equal(finished.applied, true, subtaskId);
}

function task(loopPlus: unknown, overrides: Partial<LoopTaskRecord> = {}): LoopTaskRecord {
  return {
    id: "loop-plus-visible-task",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/loop-plus-tasks.json",
    rootPrompt: "Keep the queue visible <b>raw</b>.",
    schedulingMode: "event_driven",
    status: "running",
    createdAt: 10,
    updatedAt: 20,
    maxRounds: 6,
    currentRound: 4,
    communicationDir: "/tmp/loop-plus-visible",
    mainCommunicationFile: "/tmp/loop-plus-visible/main.md",
    activeSubtaskIds: [],
    subTasks: [
      { id: "A", title: "Alpha", status: "completed", updatedAt: 11 },
      { id: "B", title: "Bravo", status: "completed", updatedAt: 12 },
      { id: "C", title: "Charlie", status: "completed", updatedAt: 13 },
      { id: "D", title: "Delta", status: "running", updatedAt: 14 },
      { id: "E", title: "Echo", status: "pending", updatedAt: 15 },
    ],
    rounds: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    loopPlus,
    ...overrides,
  };
}

function build(
  loopPlus: unknown,
  overrides: Partial<LoopTaskRecord> = {},
  frozenEventIds?: readonly string[],
): PanelState {
  return buildWithChat(loopPlus, overrides, "# Loop chat\n\nhello\n", frozenEventIds);
}

function buildWithChat(
  loopPlus: unknown,
  overrides: Partial<LoopTaskRecord>,
  chat: string,
  frozenEventIds?: readonly string[],
  runningTaskIds: readonly string[] = ["loop-plus-visible-task"],
  mainModelRunning = false,
): PanelState {
  let snapshot = loopPlus;
  let activeReviewEventIds = frozenEventIds ? [...frozenEventIds] : [];
  if (loopPlus && typeof loopPlus === "object") {
    try {
      const rawSnapshot = loopPlus as { currentReview?: unknown };
      if (rawSnapshot.currentReview) {
        const scheduler = createLoopPlusScheduler({ snapshot: loopPlus as any });
        const claimed = scheduler.claimNextReview();
        if (claimed.ok && claimed.item) {
          snapshot = scheduler.snapshot();
          activeReviewEventIds = frozenEventIds
            ? [...frozenEventIds]
            : [claimed.item.eventId];
        }
      }
    } catch {
      // Invalid-snapshot rendering remains covered by the projection tests.
    }
  }
  return buildLoopGroupChatPanelStateWithDeps(task(snapshot, overrides), {
    collectRunningLoopTaskIds: () => new Set(runningTaskIds),
    readTextFileIfNonEmpty: () => chat,
    fileExists: () => true,
    writeTextFileEnsuringDir: () => {
      throw new Error("projection must not write");
    },
    getActiveLoopSubtaskIds: () => [],
    mainModelRunning,
    getActiveReviewEventIds: () => (overrides.status ?? "running") === "running" ? activeReviewEventIds.slice() : [],
    buildLoopCompletedConclusionAndSummaryMarkdown: () => "done",
    t: (key: string) => key,
  });
}

function html(state: PanelState): string {
  return buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
}

function countValue(page: string, name: string): string {
  const match = page.match(new RegExp(
    `data-loop-plus-count="${name}">([^<]+)</span>`,
  ));
  assert.ok(match, name);
  return match?.[1]?.match(/(\d+)$/u)?.[1] ?? "";
}

function loopPlusPanel(page: string): string {
  return page.match(/<section class="panel" data-loop-plus-mode="event_driven"[\s\S]*?<\/section>/u)?.[0] ?? "";
}

function assertLoopPlusDetailCardsHidden(page: string): void {
  assert.doesNotMatch(page, /data-loop-plus-list=|data-loop-plus-role=|data-loop-plus-acceptance=/u);
  assert.doesNotMatch(
    page,
    /<h2>(?:当前验收|待验收队列|仍在运行|待启动|验收结果)<\/h2>/u,
  );
}

function parallelSnapshot() {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1", "<script>alert(1)</script>");
  dispatchAndFinish(scheduler, "B", "b-1", "report-B");
  dispatchAndFinish(scheduler, "C", "c-1", "report-C");
  assert.equal(scheduler.dispatch([spec("D", "d-1", "<b>running</b>")]).started[0]?.subtaskId, "D");
  assert.equal(scheduler.dispatch([spec("E", "e-1", "Echo")]).started.length, 0);
  return scheduler.snapshot();
}

test("renders the Loop+ queue and parallel execution", () => {
  const state = build(parallelSnapshot());
  assert.equal(state.task.currentRound, 4);
  {
    const page = html(state);
    assert.match(page, /<h1 id="panelHeading">Loop\+ 群聊<\/h1>/u);
    assert.match(page, /最后启动/u);
    assert.match(page, /子任务 1：Alpha/u);
    assert.doesNotMatch(page, /会话：|Session：|无会话|No session/u);
    assert.equal(countValue(page, "queue"), "2");
    assert.equal(countValue(page, "reviewing"), "1");
    assert.equal(countValue(page, "running"), "1");
    assert.equal(countValue(page, "repairing"), "0");
    assert.equal(countValue(page, "pending"), "1");
    assert.deepEqual([...page.matchAll(/class="loop-plus-status-tag"[^>]*>([^<]+)<\/span>/gu)].map((match) => match[1]), [
      "运行中 1", "修复中 0", "验收中 1", "待验收 2", "待启动 1", "验收失败 0", "已阻塞 0", "已完成 0",
    ]);
    assert.match(page, /class="meta-row loop-plus-activity"[^>]*><div class="meta-label">状态<\/div><div class="meta-value">/u);
    assert.doesNotMatch(loopPlusPanel(page), /data-loop-plus-count="visible"|data-loop-plus-field="(?:mode|phase|wake)"|<div class="meta-label">状态<\/div>[\s\S]*?<div class="meta-label">状态<\/div>/u);
    assert.doesNotMatch(page, /依赖\[/u);
    assert.doesNotMatch(page, /data-loop-plus-count="reviewed"/u);
    assertLoopPlusDetailCardsHidden(page);
    assert.doesNotMatch(page, new RegExp(buildLoopPlusFinishEventId("A", "a-1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(page, /<script>alert\(1\)<\/script>|&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
    assert.doesNotMatch(page, /<b>running<\/b>|&lt;b&gt;running&lt;\/b&gt;/u);
    assert.match(page, /<button[^>]*data-action="stopTask"/u);
    assert.match(page, /<button[^>]*data-action="supplementTask"/u);
    assert.doesNotMatch(page, /<button[^>]*data-action="continueTask"/u);
    assert.doesNotMatch(page, /loopPlus:|claimNextReview|submitReview|resumeParent/u);
    assert.match(page, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
    assert.match(page, /data-thinking-kind="main" data-thinking-id="main"/u);
    assert.match(page, /typing-dots/u);
    assert.doesNotMatch(page, /data-thinking-kind="moderator"|<b>running<\/b>/u);
    assert.doesNotMatch(page, /<p id="panelSubtitle">[^<]*事件驱动逐项验收/u);
    assert.match(page, /验收中（子任务 1：Alpha）。/u);
    assert.equal((page.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 2);
    assert.equal((page.match(/<div class="member-meta">待验收<\/div>/gu) ?? []).length, 2);
    assert.match(page, /\.member-status-reviewing,[^}]*--vscode-charts-blue/u);
    assert.doesNotMatch(page, /尝试|已验收尝试/u);
    assert.match(page, /待验收/u);
    assert.doesNotMatch(page, /<div class="meta-label">当前轮次<\/div>/u);
    assert.match(page, /子任务 4：Delta 思考中/u);
    assert.match(page, /主任务 0% 思考中/u);
    assert.doesNotMatch(page, /已全部收口/u);
  }
});

test("shows only unmet dependencies on pending members and refreshes the labels after execution", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  dispatchAndFinish(scheduler, "B", "b-1");
  assert.equal(scheduler.submitReviewBatch([buildLoopPlusFinishEventId("B", "b-1")], "passed").ok, true);
  assert.equal(scheduler.dispatch([spec("A", "a-1"), spec("C", "c-1")]).started.length, 2);
  assert.equal(scheduler.dispatch([{ ...spec("E", "e-1"), dependsOn: ["C", "B", "A"] }]).started.length, 0);

  const memberStatus = (page: string) => page.match(/子任务 5：Echo<\/div>\s*<div class="member-meta">([^\n]+)<\/div>/u)?.[1];
  const rosterOnRefresh = () => buildLoopGroupChatPanelContentPatch(build(scheduler.snapshot()), 1).rosterPanelHtml;
  const pendingLabel = '<span class="member-status-pending">待启动</span>';
  assert.equal(memberStatus(html(build(scheduler.snapshot()))), `${pendingLabel} 依赖[子任务 3、子任务 1]`);

  assert.equal(scheduler.finish({ subtaskId: "C", attemptId: "c-1", outcome: "completed" }).applied, true);
  assert.equal(memberStatus(rosterOnRefresh()), `${pendingLabel} 依赖[子任务 1]`);

  assert.equal(scheduler.dispatch([spec("D", "d-1")]).started.length, 1);
  assert.equal(scheduler.finish({ subtaskId: "A", attemptId: "a-1", outcome: "completed" }).started[0]?.subtaskId, "E");
  assert.equal(memberStatus(rosterOnRefresh()), '<span class="member-status-running">运行中</span>');
});

test("shows continue instead of stop when the host no longer owns the Loop+ run", () => {
  const snapshot = parallelSnapshot();
  const page = html(buildWithChat(snapshot, {}, "# chat\n", undefined, []));
  assert.doesNotMatch(page, /<button[^>]*data-action="stopTask"/u);
  assert.match(page, /<button[^>]*data-action="continueTask"/u);
  assert.match(page, /loopGroupChatChat:stopTask/u);
  assert.equal(countValue(page, "running"), "1");
});

test("renders a single review in blue and includes new batch members without marking running work", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  const single = html(build(scheduler.snapshot()));
  assert.match(single, /验收中（子任务 1：Alpha）。/u);
  assert.equal((single.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 2);

  dispatchAndFinish(scheduler, "B", "b-1");
  assert.equal(scheduler.dispatch([spec("D", "d-1")]).started.length, 1);
  const snapshot = scheduler.snapshot();
  const before = JSON.stringify(snapshot);
  const state = build(snapshot);
  const batch = html(state);
  assert.equal(JSON.stringify(snapshot), before);
  assert.match(batch, /验收中（子任务 1：Alpha）。/u);
  assert.equal((batch.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 2);
  assert.equal((batch.match(/<div class="member-meta">待验收<\/div>/gu) ?? []).length, 1);
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "D")?.status, "running");
});

test("renders only the frozen review prefix as active while counting the full FIFO queue", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  dispatchAndFinish(scheduler, "B", "b-1");
  dispatchAndFinish(scheduler, "C", "c-1");
  const snapshot = scheduler.snapshot();
  const frozenIds = [snapshot.currentReview?.eventId].filter((id): id is string => Boolean(id));
  assert.deepEqual(frozenIds, [snapshot.currentReview?.eventId]);

  const state = build(snapshot, {}, frozenIds);
  const page = html(state);
  assert.equal(state.loopPlus?.ok && state.loopPlus.reviewQueueCount, 2);
  assert.deepEqual(state.loopPlus?.ok && state.loopPlus.activeReviewEventIds, frozenIds);
  assert.match(page, /验收中（子任务 1：Alpha）。/u);
  assert.doesNotMatch(page, /正在验收/u);
  assert.doesNotMatch(page, /验收中（子任务 [23]：/u);
  assert.equal((page.match(/<div class="member-meta">待验收<\/div>/gu) ?? []).length, 2);
  assert.equal((page.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 2);
  assert.equal(countValue(page, "queue"), "2");
  assert.equal(countValue(page, "queue"), "2");
  assert.equal(countValue(page, "reviewing"), "1");

  const twoItemBatchIds = [frozenIds[0], snapshot.reviewQueue[0]?.eventId]
    .filter((id): id is string => Boolean(id));
  const twoItemState = build(snapshot, {}, twoItemBatchIds);
  const twoItemBatch = html(twoItemState);
  assert.deepEqual(twoItemBatchIds, [frozenIds[0], snapshot.reviewQueue[0]?.eventId]);
  assert.match(twoItemBatch, /验收中（子任务 1：Alpha、子任务 2：Bravo）。/u);
  assert.doesNotMatch(twoItemBatch, /验收中（子任务 3：Charlie/u);
  assert.equal((twoItemBatch.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 3);
  assert.equal(countValue(twoItemBatch, "reviewing"), "2");
  assert.equal((twoItemBatch.match(/<div class="member-meta">待验收<\/div>/gu) ?? []).length, 1);
  const patch = buildLoopGroupChatPanelContentPatch(twoItemState, 2);
  assert.match(patch.statusBarHtml, /待验收<\/span> <strong>1<\/strong>/u);
  assert.match(patch.statusBarHtml, /验收中<\/span> <strong>2<\/strong>/u);
});

test("renders waiting, a non-empty queue with zero running work, and a damaged snapshot", () => {
  const waitingScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(waitingScheduler.dispatch([spec("D", "d-1")]).started.length, 1);
  const waiting = html(build(waitingScheduler.snapshot()));
  assert.match(waiting, /data-loop-plus-status="waiting"/u);
  assert.match(waiting, /等待执行结束。主任务没有在生成。/u);
  assert.equal(countValue(waiting, "running"), "1");
  assert.equal(countValue(waiting, "reviewing"), "0");
  assert.match(waiting, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
  assert.match(waiting, /子任务 4：Delta 思考中/u);
  assert.match(waiting, /typing-dots/u);
  assert.doesNotMatch(waiting, /data-thinking-kind="main"|主任务 0% 思考中|已全部收口|member-status-reviewing">验收中|验收中（/u);
  const mainRunning = buildWithChat(waitingScheduler.snapshot(), {}, "# Loop chat\n", undefined, undefined, true);
  assert.equal(countValue(buildLoopGroupChatPanelContentPatch(mainRunning, 1).taskPanelHtml, "running"), "2");

  const queuedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(queuedScheduler, "A", "a-1");
  dispatchAndFinish(queuedScheduler, "B", "b-1");
  dispatchAndFinish(queuedScheduler, "C", "c-1");
  const current = queuedScheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(queuedScheduler.submitReview(current.eventId).ok, true);
  const queued = html(build(queuedScheduler.snapshot()));
  assert.match(queued, /data-loop-plus-phase="review_ready"/u);
  assert.match(queued, /data-loop-plus-status="review_pending"/u);
  assert.equal(countValue(queued, "running"), "0");
  assert.equal(countValue(queued, "queue"), "3");
  assert.equal(countValue(queued, "reviewing"), "0");
  assertLoopPlusDetailCardsHidden(queued);
  assert.match(queued, /已有子任务排队等待验收，当前验收尚未开始。任务不能视为已完成。/u);
  assert.doesNotMatch(queued, /已全部收口|member-status-reviewing">验收中|验收中（/u);

  const missing = html(build(undefined));
  assert.match(missing, /data-loop-plus-status="invalid"/u);
  assert.match(missing, /快照缺失或损坏（missing）/u);
  assert.match(missing, /不能把该任务显示成空队列或已完成/u);
  assert.doesNotMatch(missing, /data-loop-plus-count=/u);
  assert.doesNotMatch(missing, /没有排队等待验收的项|已全部收口|member-status-reviewing">验收中|验收中（/u);

  const damaged = html(build({ version: 1 }));
  assert.match(damaged, /data-loop-plus-status="invalid"/u);
  assert.match(damaged, /快照缺失或损坏/u);
  assert.match(damaged, /不能把该任务显示成空队列或已完成/u);
  assert.doesNotMatch(damaged, /data-loop-plus-count=|已全部收口|member-status-reviewing">验收中|验收中（/u);
  assert.equal(buildLoopGroupChatPanelContentPatch(build({ version: 1 }), 1).statusBarHtml, "");
});

test("renders the Loop+ status tags and keeps continuation waiting out of active counts", () => {
  const state = build(createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot(), {
    subTasks: [
      { id: "A", title: "Alpha", status: "running", updatedAt: 11 },
      { id: "B", title: "Bravo", status: "completed", updatedAt: 12 },
      { id: "C", title: "Charlie", status: "blocked", updatedAt: 13 },
      { id: "D", title: "Delta", status: "completed", updatedAt: 14 },
      { id: "E", title: "Echo", status: "completed", updatedAt: 15 },
    ],
  });
  state.rounds[0].participants = [
    { id: "A", title: "子任务 1：Alpha", role: "subtask", status: "running" },
    { id: "B", title: "子任务 2：Bravo", role: "subtask", status: "reviewing" },
    { id: "C", title: "子任务 3：Charlie", role: "subtask", status: "blocked" },
    { id: "D", title: "子任务 4：Delta", role: "subtask", status: "acceptance_failed" },
    { id: "E", title: "子任务 5：Echo", role: "subtask", status: "no_acceptance" },
  ];
  const page = html(state);
  assert.deepEqual([...page.matchAll(/class="loop-plus-status-tag"[^>]*>([^<]+)<\/span>/gu)].map((match) => match[1]), [
    "运行中 1", "修复中 0", "验收中 1", "待验收 0", "待启动 0", "验收失败 1", "已阻塞 1", "已完成 1",
  ]);
  assert.match(page, /class="member-status-pending">已阻塞<\/span>/u);

  const failed = state.rounds[0].participants[3];
  const main = { id: "main", title: "主任务", role: "main" as const, status: "running" };
  state.rounds[0].participants.unshift(main);
  const latestRound = {
    ...state.rounds[0],
    participants: [{ ...main, status: "reviewing" }, { ...failed, status: "repairing" }],
  };
  state.rounds.push(latestRound);
  const repairing = html(state);
  assert.equal(countValue(repairing, "running"), "1");
  assert.equal(countValue(repairing, "reviewing"), "1");
  assert.equal(countValue(repairing, "repairing"), "1");
  assert.equal(countValue(repairing, "completed"), "1");
  assert.match(repairing, /data-loop-plus-tone="empty" data-loop-plus-count="acceptance_failed">验收失败 0<\/span>/u);

  latestRound.participants[1].status = "acceptance_passed";
  const passed = html(state);
  assert.equal(countValue(passed, "repairing"), "0");
  assert.equal(countValue(passed, "acceptance_failed"), "0");
  assert.equal(countValue(passed, "completed"), "2");
});

test("counts the paused main task together with a blocked subtask only after confirmed blockage", () => {
  const snapshot = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
  const finalSummary = buildLoopBlockerSummary(LOOP_BLOCKER_EXAMPLE);
  const state = build(snapshot, {
    status: "needs-review",
    loopPlusBlockReview: { state: "reviewed" },
    finalSummary,
    subTasks: [{ id: "main", title: "Blocked subtask", status: "blocked", updatedAt: 21 }],
  });
  assert.match(html(state), /aria-label="任务状态汇总"/u);
  assert.equal(countValue(html(state), "blocked"), "2");

  for (const overrides of [
    { status: "needs-review", loopPlusBlockReview: { state: "pending" }, finalSummary },
    { status: "needs-review", loopPlusBlockReview: { state: "reviewed" }, finalSummary: "协议错误" },
    { status: "error", loopPlusBlockReview: { state: "reviewed" }, finalSummary },
    { status: "running", loopPlusBlockReview: { state: "reviewed" }, finalSummary },
  ] satisfies Array<Partial<LoopTaskRecord>>) {
    assert.equal(countValue(html(build(snapshot, overrides)), "blocked"), "0");
  }
});

test("shows an in-place failed-acceptance repair without creating another member", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  const review = scheduler.snapshot().currentReview;
  assert.ok(review);
  assert.equal(scheduler.submitReviewBatch([review.eventId], "failed").ok, true);
  assert.equal(scheduler.dispatch([spec("A", "a-2", "Alpha repair")]).started.length, 1);
  const state = build(scheduler.snapshot(), {
    subTasks: [{ id: "A", title: "Alpha", status: "running", updatedAt: 22 }],
  });
  const participant = state.rounds[0].participants.filter((item) => item.role === "subtask");
  assert.equal(participant.length, 1);
  assert.equal(participant[0].id, "A");
  assert.equal(participant[0].status, "repairing");
  const page = html(state);
  assert.match(page, /<span class="member-status-repairing">修复中<\/span>/u);
  assert.match(page, /class="loop-plus-status-tag" data-loop-plus-count="repairing">修复中 1<\/span>/u);
  assert.match(page, /class="loop-plus-status-tag" data-loop-plus-tone="empty" data-loop-plus-count="running">运行中 0<\/span>/u);
  assert.equal(countValue(page, "repairing"), "1");
  assert.equal(countValue(page, "running"), "0");
  assert.match(page, /data-action="openSubtaskConversation" data-subtask-id="A"/u);
  assert.match(page, /\.member-status-repairing[\s\S]*--vscode-editorWarning-foreground/u);
});

test("shows active repair reviews and resolves each failed state", () => {
  const queuedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(queuedScheduler, "A", "a-1");
  const failedReview = queuedScheduler.snapshot().currentReview;
  assert.ok(failedReview);
  assert.equal(queuedScheduler.submitReviewBatch([failedReview.eventId], "failed").ok, true);
  assert.equal(queuedScheduler.dispatch([spec("B", "b-1")]).started.length, 1);
  queuedScheduler.dispatch([spec("A", "a-2")]);
  assert.equal(queuedScheduler.snapshot().pending.length, 1);
  const queuedPage = html(build(queuedScheduler.snapshot()));
  assert.match(queuedPage, /子任务 1：Alpha[\s\S]*?<span class="member-status-repairing">修复中<\/span>/u);
  assert.match(queuedPage, /data-loop-plus-count="repairing">修复中 1/u);

  const completedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(completedScheduler, "A", "a-1");
  const current = completedScheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(completedScheduler.submitReviewBatch([current.eventId], [{
    eventId: current.eventId,
    acceptance: "failed",
    noRepairReason: "替代目标已经交付",
  }]).ok, true);
  const completedPage = html(build(completedScheduler.snapshot()));
  assert.match(completedPage, /<span class="member-status-passed">验收成功<\/span>/u);
  assert.equal(countValue(completedPage, "completed"), "1");
  assert.equal(countValue(completedPage, "acceptance_failed"), "0");
  assert.equal(completedScheduler.snapshot().seenAttempts.at(-1)?.acceptance, "failed");
  assert.equal(completedScheduler.snapshot().seenAttempts.at(-1)?.noRepairReason, "替代目标已经交付");

  const successfulRepairScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(successfulRepairScheduler, "A", "a-1");
  const initialSuccessRepairReview = successfulRepairScheduler.snapshot().currentReview;
  assert.ok(initialSuccessRepairReview);
  assert.equal(successfulRepairScheduler.submitReviewBatch([initialSuccessRepairReview.eventId], "failed").ok, true);
  assert.equal(successfulRepairScheduler.dispatch([spec("A", "a-2", "Alpha repair")]).started.length, 1);
  successfulRepairScheduler.finish({ subtaskId: "A", attemptId: "a-2", outcome: "completed", detail: "修复完成" });
  const successfulRepairReview = successfulRepairScheduler.snapshot().currentReview;
  assert.ok(successfulRepairReview);
  const revalidatingPage = html(build(successfulRepairScheduler.snapshot()));
  assert.equal((revalidatingPage.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 2);
  assert.equal(successfulRepairScheduler.submitReviewBatch([successfulRepairReview.eventId], "passed").ok, true);
  const successfulRepairPage = html(build(successfulRepairScheduler.snapshot()));
  assert.match(successfulRepairPage, /<span class="member-status-passed">验收成功<\/span>/u);
  assert.equal(countValue(successfulRepairPage, "repairing"), "0");
  assert.equal(countValue(successfulRepairPage, "acceptance_failed"), "0");
  assert.equal(countValue(successfulRepairPage, "completed"), "1");

  const failedRepairScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(failedRepairScheduler, "A", "a-1");
  const initialReview = failedRepairScheduler.snapshot().currentReview;
  assert.ok(initialReview);
  assert.equal(failedRepairScheduler.submitReviewBatch([initialReview.eventId], "failed").ok, true);
  assert.equal(failedRepairScheduler.dispatch([spec("A", "a-2", "Alpha repair")]).started.length, 1);
  failedRepairScheduler.finish({ subtaskId: "A", attemptId: "a-2", outcome: "failed", detail: "repair failed" });
  const repairReview = failedRepairScheduler.snapshot().currentReview;
  assert.ok(repairReview);
  const awaitingRepairReview = html(build(failedRepairScheduler.snapshot()));
  assert.equal((awaitingRepairReview.match(/<span class="member-status-reviewing">验收中<\/span>/gu) ?? []).length, 2);
  assert.equal(failedRepairScheduler.submitReviewBatch([repairReview.eventId], "failed").ok, true);
  const failedRepairPage = html(build(failedRepairScheduler.snapshot()));
  assert.match(failedRepairPage, /<span class="member-status-failed">验收失败<\/span>/u);
  assert.equal(countValue(failedRepairPage, "acceptance_failed"), "1");
  assert.equal(countValue(failedRepairPage, "completed"), "0");
});

test("moves a repeated repair into the review count only for its active batch", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const rejectCurrentReview = () => {
    const review = scheduler.snapshot().currentReview;
    assert.equal(review?.subtaskId, "A");
    assert.ok(review);
    assert.equal(scheduler.submitReviewBatch([review.eventId], "failed").ok, true);
  };
  const assertRepairLabel = (label: string) => {
    const state = build(scheduler.snapshot());
    assert.equal(state.rounds[0].participants.find((participant) => participant.id === "A")?.status, "repairing");
    const patch = buildLoopGroupChatPanelContentPatch(state, 1);
    assert.deepEqual([...patch.rosterPanelHtml.matchAll(/class="member-status-repairing">([^<]+)<\/span>/gu)]
      .map((match) => match[1]), [label]);
    assert.match(patch.taskPanelHtml, /data-loop-plus-count="repairing">修复中 1<\/span>/u);
  };

  dispatchAndFinish(scheduler, "A", "initial");
  rejectCurrentReview();
  dispatchAndFinish(scheduler, "A", "first-repair");
  rejectCurrentReview();

  dispatchAndFinish(scheduler, "C", "other-review");
  assert.equal(scheduler.dispatch([{ ...spec("B", "unrelated"), requiresAcceptance: false }]).started.length, 1);
  scheduler.dispatch([spec("A", "second-repair")]);
  assert.equal(scheduler.snapshot().pending[0]?.attemptId, "second-repair");
  assertRepairLabel("修复中 x2");
  assert.equal(scheduler.finish({ subtaskId: "B", attemptId: "unrelated", outcome: "completed" }).applied, true);
  assert.equal(scheduler.snapshot().running[0]?.attemptId, "second-repair");
  assertRepairLabel("修复中 x2");
  assert.equal(scheduler.finish({ subtaskId: "A", attemptId: "second-repair", outcome: "completed" }).applied, true);
  assertRepairLabel("修复中 x2");

  const snapshot = scheduler.snapshot();
  assert.ok(snapshot.currentReview);
  assert.equal(snapshot.currentReview.subtaskId, "C");
  assert.equal(snapshot.reviewQueue[0]?.subtaskId, "A");
  const bothReviews = build(snapshot, {}, [snapshot.currentReview.eventId, snapshot.reviewQueue[0].eventId]);
  const patch = buildLoopGroupChatPanelContentPatch(bothReviews, 2);
  assert.match(patch.rosterPanelHtml, /class="member-status-reviewing">验收中 x2<\/span>/u);
  assert.match(patch.taskPanelHtml, /data-loop-plus-count="reviewing">验收中 2<\/span>/u);
  assert.match(patch.taskPanelHtml, /data-loop-plus-count="repairing">修复中 0<\/span>/u);

  assert.equal(scheduler.submitReviewBatch([snapshot.currentReview.eventId], "passed").ok, true);
  assert.equal(scheduler.claimNextReview().item?.eventId, snapshot.reviewQueue[0].eventId);
  rejectCurrentReview();

  assert.equal(scheduler.dispatch([spec("A", "third-repair")]).started.length, 1);
  assertRepairLabel("修复中 x3");
});

test("renders stopped and resumed Loop+ snapshots in the group chat", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  dispatchAndFinish(scheduler, "B", "b-1");
  assert.equal(scheduler.stopParent().reason, "stopped");
  const stoppedPage = html(build(scheduler.snapshot(), { status: "stopped" }));
  assert.match(stoppedPage, /data-loop-plus-status="stopped"/u);
  assert.match(stoppedPage, /不会自动验收/u);
  assertLoopPlusDetailCardsHidden(stoppedPage);
  assert.equal((stoppedPage.match(/<div class="member-meta">待验收<\/div>/gu) ?? []).length, 2);
  assert.doesNotMatch(stoppedPage, /验收已暂停|member-status-reviewing">验收中|验收中（|思考中/u);
  assert.match(stoppedPage, /<button[^>]*data-action="continueTask"/u);
  assert.doesNotMatch(stoppedPage, /<button[^>]*data-action="stopTask"/u);

  const resumedResult = scheduler.resumeParent();
  assert.equal(resumedResult.reason, "resumed");
  const resumedPage = html(build(scheduler.snapshot()));
  assert.match(resumedPage, /data-loop-plus-phase="review_ready"/u);
  assert.match(resumedPage, /data-loop-plus-status="review_pending"/u);
  assert.doesNotMatch(loopPlusPanel(resumedPage), /data-loop-plus-field="(?:mode|phase|wake)"/u);
  assertLoopPlusDetailCardsHidden(resumedPage);
  assert.match(resumedPage, /已有子任务排队等待验收，当前验收尚未开始。任务不能视为已完成。/u);
  assert.equal((resumedPage.match(/<div class="member-meta">待验收<\/div>/gu) ?? []).length, 3);
  assert.doesNotMatch(resumedPage, /member-status-reviewing">验收中|验收中（|已全部收口|思考中/u);
});

test("shows the Loop+ main reviewer animation in the shared group chat", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "B", "b-1");
  const state = buildLoopGroupChatPanelStateWithDeps(task(scheduler.snapshot(), {
    status: "running",
  }), {
    collectRunningLoopTaskIds: () => new Set<string>(),
    readTextFileIfNonEmpty: () => "# Loop+ 群聊\n",
    fileExists: () => false,
    writeTextFileEnsuringDir: () => false,
    getActiveLoopSubtaskIds: () => [],
    getActiveReviewEventIds: () => [scheduler.snapshot().currentReview?.eventId ?? ""].filter(Boolean),
    buildLoopCompletedConclusionAndSummaryMarkdown: () => "done",
    t: (key: string) => key,
  });
  const page = html(state);
  assert.match(page, /<h1 id="panelHeading">Loop\+ 群聊<\/h1>/u);
  assertLoopPlusDetailCardsHidden(page);
  assert.match(page, /data-thinking-kind="main" data-thinking-id="main"/u);
  assert.match(page, /主任务 0% 思考中/u);
  assert.doesNotMatch(page, /data-thinking-kind="moderator"|裁判主持人 思考中|红蓝辩论群聊/u);
  assert.doesNotMatch(page, /<p id="panelSubtitle">[^<]*事件驱动逐项验收/u);
});

test("renders a paused Loop+ review separately from active review and restores it after continue", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1", "report-A");
  dispatchAndFinish(scheduler, "B", "b-1", "report-B");
  assert.equal(scheduler.dispatch([spec("D", "d-1")]).started[0]?.subtaskId, "D");
  assert.equal(scheduler.dispatch([spec("E", "e-1")]).started.length, 0);
  const snapshot = scheduler.snapshot();
  const before = JSON.stringify(snapshot);
  const held = build(snapshot, { status: "needs-review", activeSubtaskIds: [] });
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(held.loopPlus?.ok, true);
  if (!held.loopPlus?.ok) {
    return;
  }
  assert.equal(held.loopPlus.activity, "paused");
  assert.equal(held.loopPlus.phase, "reviewing");
  const heldPage = html(held);
  assert.match(heldPage, /data-loop-plus-status="paused"/u);
  assert.match(heldPage, /data-loop-plus-phase="reviewing"/u);
  assert.match(heldPage, /任务已暂停，尚未完成；点击继续执行可恢复。/u);
  const erroredPage = html(build(snapshot, { status: "error" }));
  assert.match(erroredPage, /data-loop-plus-status="paused"/u);
  assert.match(erroredPage, /data-loop-plus-phase="reviewing"/u);
  assert.match(erroredPage, /自动验收已暂停，需要继续后才会恢复。/u);
  for (const page of [heldPage, erroredPage]) {
    assert.match(page, /<div class="member-name">子任务 1：Alpha<\/div>\s*<div class="member-meta">待验收<\/div>/u);
    assert.match(page, /<div class="member-name">子任务 2：Bravo<\/div>\s*<div class="member-meta">待验收<\/div>/u);
    assert.doesNotMatch(page, /<div class="member-meta">验收已暂停<\/div>|member-status-reviewing">验收中|验收中（/u);
  }
  assert.equal(countValue(heldPage, "queue"), "2");
  assert.equal(countValue(heldPage, "reviewing"), "0");
  assert.equal(countValue(heldPage, "running"), "1");
  assert.equal(countValue(heldPage, "pending"), "1");
  assertLoopPlusDetailCardsHidden(heldPage);
  assert.match(heldPage, /任务已暂停/u);
  assert.match(heldPage, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
  assert.match(heldPage, /子任务 4：Delta 思考中/u);
  assert.doesNotMatch(heldPage, /data-thinking-kind="main"|主任务 0% 思考中|member-status-reviewing">验收中|验收中（|已全部收口/u);
  assert.match(heldPage, /<button[^>]*data-action="continueTask"/u);
  assert.doesNotMatch(heldPage, /<button[^>]*data-action="stopTask"/u);

  const resumedPage = html(build(snapshot, { status: "running", activeSubtaskIds: [] }));
  assert.equal(JSON.stringify(snapshot), before);
  assert.match(resumedPage, /data-loop-plus-status="reviewing"/u);
  assert.match(resumedPage, /data-loop-plus-phase="reviewing"/u);
  assert.match(resumedPage, /验收中（子任务 1：Alpha）。/u);
  assert.match(resumedPage, /<div class="member-name">子任务 1：Alpha<\/div>\s*<div class="member-meta"><span class="member-status-reviewing">验收中<\/span><\/div>/u);
  assert.match(resumedPage, /<div class="member-name">子任务 2：Bravo<\/div>\s*<div class="member-meta">待验收<\/div>/u);
  assert.doesNotMatch(resumedPage, /尝试|已验收尝试/u);
  assertLoopPlusDetailCardsHidden(resumedPage);
  assert.match(resumedPage, /子任务 4：Delta 思考中/u);
  assert.match(resumedPage, /主任务 0% 思考中/u);
  assert.doesNotMatch(resumedPage, /自动验收已暂停/u);
  assert.match(resumedPage, /<button[^>]*data-action="stopTask"/u);
  assert.doesNotMatch(resumedPage, /<button[^>]*data-action="continueTask"/u);

  const queueScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(queueScheduler, "A", "a-1");
  dispatchAndFinish(queueScheduler, "B", "b-1");
  const current = queueScheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(queueScheduler.submitReview(current.eventId).ok, true);
  const queueSnapshot = queueScheduler.snapshot();
  const queueBefore = JSON.stringify(queueSnapshot);
  const queuedPage = html(build(queueSnapshot, { status: "error", activeSubtaskIds: [] }));
  assert.equal(JSON.stringify(queueSnapshot), queueBefore);
  assert.match(queuedPage, /data-loop-plus-status="paused"/u);
  assert.match(queuedPage, /data-loop-plus-phase="review_ready"/u);
  assert.match(queuedPage, /自动验收已暂停，需要继续后才会恢复/u);
  assert.equal(countValue(queuedPage, "queue"), "1");
  assert.equal(countValue(queuedPage, "reviewing"), "0");
  assertLoopPlusDetailCardsHidden(queuedPage);
  assert.doesNotMatch(queuedPage, /member-status-reviewing">验收中|验收中（|思考中|已全部收口/u);
  assert.match(queuedPage, /<button[^>]*data-action="continueTask"/u);

  const queueResumedPage = html(build(queueSnapshot, { status: "running", activeSubtaskIds: [] }));
  assert.equal(JSON.stringify(queueSnapshot), queueBefore);
  assert.match(queueResumedPage, /data-loop-plus-status="review_pending"/u);
  assert.match(queueResumedPage, /data-loop-plus-phase="review_ready"/u);
  assert.match(queueResumedPage, /已有子任务排队等待验收，当前验收尚未开始。任务不能视为已完成。/u);
  assert.doesNotMatch(queueResumedPage, /自动验收已暂停|member-status-reviewing">验收中|验收中（|思考中/u);

  assert.equal(scheduler.stopParent().reason, "stopped");
  const stoppedPage = html(build(scheduler.snapshot(), { status: "needs-review" }));
  assert.match(stoppedPage, /data-loop-plus-status="stopped"/u);
  assert.match(stoppedPage, /data-loop-plus-phase="stopped"/u);
  assertLoopPlusDetailCardsHidden(stoppedPage);
  assert.match(stoppedPage, /data-thinking-kind="subtask" data-thinking-id="D"/u);
  assert.match(stoppedPage, /子任务 4：Delta 思考中/u);
  assert.doesNotMatch(stoppedPage, /data-thinking-kind="main"|自动验收已暂停|member-status-reviewing">验收中|验收中（|主任务 0% 思考中/u);

  const completedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(completedScheduler.complete().ok, true);
  const completedPage = html(build(completedScheduler.snapshot(), { status: "error" }));
  assert.match(completedPage, /data-loop-plus-status="completed"/u);
  assert.equal(countValue(completedPage, "completed"), "1");
  assert.match(completedPage, /Loop\+ 已全部收口。/u);
  assert.doesNotMatch(completedPage, /自动验收已暂停|member-status-reviewing">验收中|验收中（/u);

  const missingPage = html(build(undefined, { status: "needs-review" }));
  assert.match(missingPage, /data-loop-plus-status="invalid"/u);
  assert.match(missingPage, /快照缺失或损坏（missing）/u);
  assert.doesNotMatch(missingPage, /自动验收已暂停|member-status-reviewing">验收中|验收中（|data-loop-plus-count=/u);
});

test("renders an interrupted idle Loop+ task as paused with explicit continuation", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const state = buildWithChat(scheduler.snapshot(), {
    status: "stopped",
    runtimeInterrupted: true,
    loopPlusProgressPercent: 92,
    subTasks: [],
  }, "# Loop chat\n\nhello\n", undefined, []);

  assert.equal(state.task.progressPercent, 92);
  assert.equal(state.task.canContinue, true);
  const page = html(state);
  assert.match(page, /data-loop-plus-status="paused"/u);
  assert.match(page, /data-loop-plus-phase="idle"/u);
  assert.match(page, /任务已暂停，尚未完成；点击继续执行可恢复。/u);
  assert.match(page, /<button[^>]*data-action="continueTask"/u);
  assert.doesNotMatch(page, /<button[^>]*data-action="stopTask"/u);
});

test("shows one execution animation for every running Loop+ subtask without pretending the waiting main task is generating", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const dispatched = scheduler.dispatch([spec("D", "d-1"), spec("E", "e-1")]);
  assert.deepEqual(dispatched.started.map((item) => item.subtaskId), ["D", "E"]);
  const page = html(build(scheduler.snapshot()));
  assert.match(page, /data-loop-plus-status="waiting"/u);
  assert.match(page, /等待执行结束。主任务没有在生成。/u);
  const delta = page.indexOf('data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"');
  const echo = page.indexOf('data-thinking-kind="subtask" data-thinking-id="E" data-thinking-attempt="e-1"');
  assert.ok(delta >= 0 && echo > delta);
  assert.match(page, /子任务 4：Delta 思考中/u);
  assert.match(page, /子任务 5：Echo 思考中/u);
  assert.equal(page.match(/data-thinking-kind="subtask"/gu)?.length, 2);
  assert.equal(page.match(/data-thinking-kind="subtask"[^>]*>[\s\S]*?<span class="typing-dots"/gu)?.length, 2);
  assert.doesNotMatch(page, /data-thinking-kind="main"|主任务 0% 思考中|member-status-reviewing">验收中|验收中（/u);
});

test("renders short default and optional acceptance reasons in the group chat bubble", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const section = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: ["修复空值分支"],
    checks: [{ name: "tests", passed: false, detail: "新增断言失败，需要修复空值分支" }],
    snapshot: { id: "plan-a", name: "安全加严", checks: ["security"], otherText: "", systemDefault: false },
    planResults: [{ key: "security", passed: true, reason: "输入边界已校验，日志不含令牌" }],
  });
  assert.ok(section);
  const page = html(buildWithChat(scheduler.snapshot(), {}, `# Loop+ chat\n\n## ${section.heading}\n\n${section.body}\n`));
  assert.match(page, /\| 审查内容 \| 审查结果 \|/u);
  assert.match(page, /\*\*子任务：修复空值分支\*\*[\s\S]*\*\*整体验收结果：❌ 未通过\*\*[\s\S]*\| 审查内容/u);
  assert.doesNotMatch(page, /\| 验收事件|\| 整体验收结果/u);
  assert.match(page, /\| 默认验收·测试验证 \| ❌ 新增断言失败，需要修复空值分支 \|/u);
  assert.match(page, /\| 安全审查 \| ✅ 输入边界已校验，日志不含令牌 \|/u);
  assert.doesNotMatch(page, /默认验收·tests/u);
  assert.doesNotMatch(page, /默认验收·测试验证：未通过/u);
});

test("shows acceptance passed or failed instead of reviewed attempts", () => {
  const passedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(passedScheduler, "A", "a-1");
  const passedCurrent = passedScheduler.snapshot().currentReview;
  assert.ok(passedCurrent);
  assert.equal(passedScheduler.submitReview(passedCurrent.eventId).ok, true);
  const passedPage = html(build(passedScheduler.snapshot()));
  assertLoopPlusDetailCardsHidden(passedPage);
  assert.match(passedPage, /子任务 1：Alpha/u);
  assert.match(passedPage, /<span class="member-status-passed">验收成功<\/span>/u);
  assert.match(passedPage, /已验收<\/span> <strong>1<\/strong>/u);
  assert.doesNotMatch(passedPage, /子任务 1：Alpha · 验收成功/u);
  assert.doesNotMatch(passedPage, /尝试|已验收尝试/u);

  const failedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(failedScheduler.dispatch([spec("B", "b-1")]).started.length, 1);
  const failedFinish = failedScheduler.finish({
    subtaskId: "B",
    attemptId: "b-1",
    outcome: "failed",
    detail: "boom",
  });
  assert.equal(failedFinish.applied, true);
  const failedCurrent = failedScheduler.snapshot().currentReview;
  assert.ok(failedCurrent);
  assert.equal(failedScheduler.submitReview(failedCurrent.eventId).ok, true);
  const failedPage = html(build(failedScheduler.snapshot()));
  assertLoopPlusDetailCardsHidden(failedPage);
  assert.match(failedPage, /子任务 2：Bravo/u);
  assert.match(failedPage, /<span class="member-status-failed">验收失败<\/span>/u);
  assert.match(failedPage, /已验收<\/span> <strong>1<\/strong>/u);
  assert.doesNotMatch(failedPage, /子任务 2：Bravo · 验收失败/u);
  assert.doesNotMatch(failedPage, /验收成功|尝试/u);

  const stoppedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(stoppedScheduler.dispatch([spec("C", "c-1")]).started.length, 1);
  assert.equal(stoppedScheduler.finish({
    subtaskId: "C",
    attemptId: "c-1",
    outcome: "stopped",
  }).applied, true);
  const stoppedCurrent = stoppedScheduler.snapshot().currentReview;
  assert.ok(stoppedCurrent);
  assert.equal(stoppedScheduler.submitReview(stoppedCurrent.eventId).ok, true);
  const stoppedPage = html(build(stoppedScheduler.snapshot()));
  assertLoopPlusDetailCardsHidden(stoppedPage);
  assert.match(stoppedPage, /子任务 3：Charlie/u);
  assert.match(stoppedPage, /<span class="member-status-failed">验收失败<\/span>/u);
  assert.doesNotMatch(stoppedPage, /子任务 3：Charlie · 验收失败/u);
  assert.doesNotMatch(stoppedPage, /尝试|已验收尝试/u);

  const legacy = passedScheduler.snapshot();
  const seen = legacy.seenAttempts.find((item) => item.attemptId === "a-1");
  assert.ok(seen);
  delete seen.outcome;
  const legacyFailed = html(build(legacy, {
    subTasks: [{ id: "A", title: "Alpha", status: "blocked", updatedAt: 11 }],
  }));
  assertLoopPlusDetailCardsHidden(legacyFailed);
  assert.match(legacyFailed, /子任务 1：Alpha/u);
  assert.match(legacyFailed, /验收失败/u);
  assert.doesNotMatch(legacyFailed, /验收成功|子任务 1：Alpha · 验收失败/u);
  const legacyPassed = html(build(legacy, {
    subTasks: [{ id: "A", title: "Alpha", status: "completed", updatedAt: 11 }],
  }));
  assertLoopPlusDetailCardsHidden(legacyPassed);
  assert.match(legacyPassed, /子任务 1：Alpha/u);
  assert.match(legacyPassed, /验收成功/u);
  assert.doesNotMatch(legacyPassed, /子任务 1：Alpha · 验收成功/u);
});

test("shows no-acceptance status as soon as a marked successful attempt finishes", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{ ...spec("report-only", "report-only-1"), requiresAcceptance: false }]);
  const finished = scheduler.finish({
    subtaskId: "report-only",
    attemptId: "report-only-1",
    outcome: "completed",
    detail: "命令 npm test 已通过，未覆盖集成场景",
  });
  assert.equal(finished.applied, true);
  assert.equal(finished.view.reportQueue?.length, 1);
  const page = html(build(scheduler.snapshot(), {
    subTasks: [{ id: "report-only", title: "测试报告", status: "completed", updatedAt: 21 }],
  }));
  assert.match(page, /<span class="member-status-inactive">无需验收<\/span>/u);
  assert.match(page, /已验收<\/span> <strong>0<\/strong>/u);
  assert.doesNotMatch(page, /验收成功/u);
});

test("shows a completed attempt as acceptance failed when the review starts a repair", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  dispatchAndFinish(scheduler, "A", "a-1");
  const current = scheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(scheduler.submitReviewBatch([current.eventId], "failed").ok, true);
  assert.equal(scheduler.dispatch([spec("B", "b-1")]).started.length, 1);
  const page = html(build(scheduler.snapshot()));
  assert.match(page, /<span class="member-status-failed">验收失败<\/span>/u);
  assert.doesNotMatch(page, /<span class="member-status-passed">验收成功<\/span>/u);
  assert.match(page, /\.member-status-passed\s*\{[^}]*--vscode-charts-green/u);
  assert.match(page, /\.member-status-failed\s*\{[^}]*--vscode-charts-orange/u);
  assert.doesNotMatch(page, /member-status-passed[\s\S]{0,180}#[0-9a-fA-F]{3,8}/u);
  assert.doesNotMatch(page, /member-status-failed[\s\S]{0,180}#[0-9a-fA-F]{3,8}/u);
});

function memberLastStartedStamp(page: string, title: string): string {
  const match = page.match(new RegExp(
    `class="member-name">${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?data-member-last-started="([^"]*)"`,
  ));
  assert.ok(match, title);
  return match?.[1] ?? "";
}

test("shows each subtask's own last execution start instead of a shared update time", () => {
  const sharedUpdatedAt = Date.UTC(2026, 8, 29, 12, 0, 0);
  const alphaStartedAt = Date.UTC(2026, 8, 29, 8, 0, 0);
  const bravoStartedAt = Date.UTC(2026, 8, 29, 9, 30, 0);
  const deltaStartedAt = Date.UTC(2026, 8, 29, 7, 0, 0);
  const state = build(undefined, {
    schedulingMode: "classic",
    updatedAt: sharedUpdatedAt,
    subTasks: [
      { id: "A", title: "Alpha", status: "running", updatedAt: sharedUpdatedAt, lastStartedAt: alphaStartedAt },
      { id: "B", title: "Bravo", status: "completed", updatedAt: sharedUpdatedAt, lastStartedAt: bravoStartedAt },
      { id: "C", title: "Charlie", status: "pending", updatedAt: sharedUpdatedAt },
      { id: "D", title: "Delta", status: "running", updatedAt: sharedUpdatedAt },
    ],
    rounds: [{
      round: 1,
      role: "subtask",
      subtaskId: "D",
      status: "end",
      startedAt: deltaStartedAt,
      endedAt: Date.UTC(2026, 8, 29, 7, 5, 0),
    }],
  });
  const execution = state.rounds.find((round) => round.kind === "execution");
  assert.ok(execution);
  const startedAtById = new Map(execution.participants.map((item) => [item.id, item.lastStartedAt]));
  assert.equal(startedAtById.get("A"), alphaStartedAt);
  assert.equal(startedAtById.get("B"), bravoStartedAt);
  assert.equal(startedAtById.get("C"), null);
  assert.equal(startedAtById.get("D"), deltaStartedAt);
  const page = html(state);
  const alpha = memberLastStartedStamp(page, "子任务 1：Alpha");
  const bravo = memberLastStartedStamp(page, "子任务 2：Bravo");
  const charlie = memberLastStartedStamp(page, "子任务 3：Charlie");
  const delta = memberLastStartedStamp(page, "子任务 4：Delta");
  assert.notEqual(alpha, "");
  assert.notEqual(bravo, "");
  assert.notEqual(alpha, bravo);
  assert.notEqual(delta, alpha);
  assert.equal(charlie, "");
  assert.match(page, /子任务 3：Charlie[\s\S]*最后启动：未启动/u);
});

test("recovers distinct historical start times from subtask join events", () => {
  const sharedUpdatedAt = Date.UTC(2026, 8, 29, 10, 58, 54);
  const alphaStartedAt = Date.parse("2026-09-29T05:59:34.578Z");
  const bravoRestartedAt = Date.parse("2026-09-29T07:27:25.803Z");
  const echoRoundStartedAt = Date.parse("2026-09-29T04:15:00.000Z");
  const deltaRecordedAt = Date.parse("2026-09-29T03:05:00.000Z");
  const chat = [
    "# Loop 主从群聊记录",
    "## 子任务加入：【子任务 1：Alpha】",
    "- 成员 ID：A",
    "- 时间：2026-09-29T05:59:34.578Z",
    "## 子任务加入：【子任务 2：Bravo】",
    "- 成员 ID：B",
    "- 时间：2026-09-29T06:10:00.000Z",
    "## 子任务加入：【子任务 2：Bravo】",
    "- 成员 ID：B",
    "- 时间：2026-09-29T07:27:25.803Z",
    "## 子任务发言：【子任务 3：Charlie】",
    "- 成员 ID：C",
    "- 时间：2026-09-29T08:00:00.000Z",
    "## 子任务加入：【子任务 4：Delta】",
    "- 成员 ID：D",
    "- 时间：2026-09-29T09:00:00.000Z",
  ].join("\n");
  const subTasks = [
    { id: "A", title: "Alpha", status: "completed" as const, updatedAt: sharedUpdatedAt },
    { id: "B", title: "Bravo", status: "completed" as const, updatedAt: sharedUpdatedAt },
    { id: "C", title: "Charlie", status: "completed" as const, updatedAt: sharedUpdatedAt },
    { id: "D", title: "Delta", status: "completed" as const, updatedAt: sharedUpdatedAt, lastStartedAt: deltaRecordedAt },
    { id: "E", title: "Echo", status: "completed" as const, updatedAt: sharedUpdatedAt },
  ];
  const rounds = [{
    round: 1,
    role: "subtask" as const,
    subtaskId: "E",
    status: "end" as const,
    startedAt: echoRoundStartedAt,
    endedAt: echoRoundStartedAt + 1_000,
  }];
  for (const loopPlus of [parallelSnapshot(), undefined]) {
    const state = buildWithChat(loopPlus, {
      ...(loopPlus ? { schedulingMode: "event_driven" as const } : { schedulingMode: "classic" as const, loopPlus: undefined }),
      updatedAt: sharedUpdatedAt,
      subTasks,
      rounds,
    }, chat);
    const execution = state.rounds.find((round) => round.kind === "execution");
    assert.ok(execution);
    const startedAtById = new Map(execution.participants.map((item) => [item.id, item.lastStartedAt]));
    assert.equal(startedAtById.get("A"), alphaStartedAt);
    assert.equal(startedAtById.get("B"), bravoRestartedAt);
    assert.equal(startedAtById.get("C"), null);
    assert.equal(startedAtById.get("D"), deltaRecordedAt);
    assert.equal(startedAtById.get("E"), echoRoundStartedAt);
    assert.notEqual(startedAtById.get("A"), sharedUpdatedAt);
    assert.notEqual(startedAtById.get("B"), sharedUpdatedAt);
  }
});

test("shows the main task as decomposing subtasks while Loop+ is just starting", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const snapshot = scheduler.snapshot();
  const before = JSON.stringify(snapshot);
  const starting = html(build(snapshot, {
    subTasks: [],
    activeSubtaskIds: [],
    currentRound: 0,
    loopPlusMainPhase: "decomposing",
  }));
  assert.equal(JSON.stringify(snapshot), before);
  assert.match(starting, /data-loop-plus-status="decomposing"/u);
  assert.match(starting, /data-loop-plus-phase="idle"/u);
  assert.match(starting, /主任务正在分解子任务。/u);
  assert.match(starting, /<div class="member-name">主任务 0%<\/div>\s*<div class="member-meta">分解子任务<\/div>/u);
  assert.match(starting, /data-thinking-kind="main" data-thinking-id="main"/u);
  assert.match(starting, /主任务 0% 思考中/u);
  assert.equal(countValue(starting, "running"), "1");

  const idle = html(build(snapshot, {
    subTasks: [],
    activeSubtaskIds: [],
    currentRound: 0,
  }));
  assert.match(idle, /data-loop-plus-status="idle"/u);
  assert.match(idle, /<div class="member-name">主任务 0%<\/div>\s*<div class="member-meta">空闲<\/div>/u);
  assert.equal(countValue(idle, "running"), "0");
  assert.doesNotMatch(idle, /分解子任务|data-thinking-kind="main"|主任务 0% 思考中/u);

  const stale = html(build(snapshot, { loopPlusMainPhase: "decomposing" }));
  assert.match(stale, /data-loop-plus-status="idle"/u);
  assert.doesNotMatch(stale, /分解子任务|data-thinking-kind="main"/u);
});

test("pause evidence is visible while persistence metadata stays out of rendered messages", () => {
  const snapshot = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
  const reason = "真实联调未完成，需要补充隔离证据。";
  const chat = [
    "# Loop 群聊",
    "## 主任务暂停",
    "<!-- loop-plus-pause:task:2:loop-plus-blocked -->",
    "- 时间：2026-11-05T01:00:00.000Z",
    "",
    "Loop+ 已暂停，整体任务尚未完成。",
    "",
    "### 暂停原因与未完成事项",
    reason,
    "",
    "### 如何继续",
    "补充证据后点击继续执行，不会自动移除安全门槛。",
  ].join("\n");
  const rendered = html(buildWithChat(snapshot, { status: "needs-review", finalSummary: reason, subTasks: [] }, chat));
  assert.match(rendered, /Loop\+ 已暂停，整体任务尚未完成。/);
  assert.match(rendered, /真实联调未完成，需要补充隔离证据。/);
  assert.match(rendered, /不会自动移除安全门槛/);
  assert.doesNotMatch(rendered, /loop-plus-pause:|\[object Object\]/);
  assert.doesNotMatch(rendered, /Loop\+ 全部任务已完成/);
});

test("interrupted open subtasks wait for continuation without thinking bubbles or review counts", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  scheduler.dispatch([spec("D", "D-1", "Delta")]);
  const state = build(scheduler.snapshot(), {
    subTasks: [{ id: "D", title: "Delta", status: "blocked", updatedAt: 20 }],
  });
  assert.ok(state.loopPlus?.ok);
  assert.equal(state.loopPlus.running[0]?.interrupted, true);
  assert.equal(state.loopPlus.runningCount, 0);
  assert.equal(state.loopPlus.visibleReviewCount, 0);
  const rendered = html(state);
  assert.match(rendered, /已中断，等待续跑/);
  assert.match(rendered, /等待在子任务对话中续跑并通知验收/);
  assert.doesNotMatch(rendered, /data-thinking-id=/);
  assert.doesNotMatch(rendered, /data-loop-plus-count="reviewed"/u);
  assert.equal(countValue(rendered, "running"), "0");
  assert.equal(countValue(rendered, "blocked"), "0");
  assert.match(rendered, /class="member-status-inactive">已中断，等待续跑<\/span>/u);

  scheduler.finish({ subtaskId: "D", attemptId: "D-1", outcome: "completed" });
  scheduler.claimNextReview();
  const resumed = html(build(scheduler.snapshot(), {
    subTasks: [{ id: "D", title: "Delta", status: "completed", updatedAt: 21 }],
  }));
  assert.match(resumed, /member-status-reviewing">验收中/);
  assert.match(resumed, /data-thinking-kind="main" data-thinking-id="main"/);
  assert.doesNotMatch(resumed, /已中断，等待续跑/);
});

test("群聊显示验收已撤销和已关闭，并可定位撤销原因", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  const eventId = scheduler.snapshot().currentReview!.eventId;
  scheduler.submitReviewBatch([eventId], [{ eventId, acceptance: "cancelled", reason: "用户取消旧需求" }]);
  scheduler.dispatch([spec("B", "b-1")]);
  scheduler.applyControls([{ subtaskId: "B", action: "close" }]);
  const section = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: ["Alpha"], reviews: [{ eventId, acceptance: "cancelled", reason: "用户取消旧需求" }],
  });
  assert.ok(section);
  const state = buildWithChat(scheduler.snapshot(), {}, `# Loop chat\n\n## ${section.heading}\n\n${section.body}\n`);
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
  assert.match(html, /验收已撤销/u);
  assert.match(html, /已验收<\/span> <strong>0<\/strong>/u);
  assert.match(html, /已关闭/u);
  assert.match(html, /用户取消旧需求/u);
  assert.match(html, /data-action="jumpToAcceptance"/u);
  assert.doesNotMatch(html, /❌ 未通过/u);
});
