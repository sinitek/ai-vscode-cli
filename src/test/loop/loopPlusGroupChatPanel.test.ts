import assert = require("node:assert/strict");
import test = require("node:test");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildLoopDebateChatPanelStateWithDeps,
} = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");
const {
  buildLoopDebateChatPanelHtml,
} = require("../../webview/loopDebatePanel") as typeof import("../../webview/loopDebatePanel");
const {
  createLoopPlusScheduler,
  buildLoopPlusFinishEventId,
} = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");

type LoopPlusScheduler = ReturnType<typeof createLoopPlusScheduler>;
type LoopTaskRecord = import("../../loopTaskStore").LoopTaskRecord;
type PanelState = ReturnType<typeof buildLoopDebateChatPanelStateWithDeps>;

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

function build(loopPlus: unknown, overrides: Partial<LoopTaskRecord> = {}): PanelState {
  return buildLoopDebateChatPanelStateWithDeps(task(loopPlus, overrides), {
    collectRunningLoopTaskIds: () => new Set<string>(),
    readTextFileIfNonEmpty: () => "# Loop chat\n\nhello\n",
    fileExists: () => true,
    writeTextFileEnsuringDir: () => {
      throw new Error("projection must not write");
    },
    getActiveLoopSubtaskIds: () => [],
    buildLoopCompletedConclusionAndSummaryMarkdown: () => "done",
    t: (key: string) => key,
  });
}

function html(state: PanelState, locale: "zh-CN" | "en"): string {
  return buildLoopDebateChatPanelHtml({ cspSource: "self" } as any, state, locale);
}

function countValue(page: string, name: string): string {
  const match = page.match(new RegExp(
    `data-loop-plus-count="${name}"[\\s\\S]*?<div class="meta-value">([^<]+)</div>`,
  ));
  assert.ok(match, name);
  return match?.[1] ?? "";
}

function assertLoopPlusDetailCardsHidden(page: string): void {
  assert.doesNotMatch(page, /data-loop-plus-list=|data-loop-plus-role=|data-loop-plus-acceptance=/u);
  assert.doesNotMatch(
    page,
    /<h2>(?:当前验收|待验收队列|仍在运行|待启动|验收结果|Current review|Review queue|Still running|Waiting to start|Acceptance results)<\/h2>/u,
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

test("renders the Loop+ queue and parallel execution in zh-CN and English", () => {
  const state = build(parallelSnapshot());
  assert.equal(state.task.currentRound, 4);
  for (const locale of ["zh-CN", "en"] as const) {
    const page = html(state, locale);
    assert.match(page, locale === "zh-CN" ? /<h1>Loop\+ 群聊<\/h1>/u : /<h1>Loop\+ Group Chat<\/h1>/u);
    assert.match(page, locale === "zh-CN" ? /最后启动/u : /Last started/u);
    assert.match(page, /子任务 1：Alpha/u);
    assert.doesNotMatch(page, /会话：|Session：|无会话|No session/u);
    assert.equal(countValue(page, "current"), "1");
    assert.equal(countValue(page, "queue"), "2");
    assert.equal(countValue(page, "visible"), "3");
    assert.equal(countValue(page, "running"), "1");
    assert.equal(countValue(page, "pending"), "1");
    assert.equal(countValue(page, "reviewed"), "0");
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
    if (locale === "zh-CN") {
      assert.match(page, /事件驱动逐项验收/u);
      assert.match(page, /正在验收 子任务 1：Alpha。/u);
      assert.doesNotMatch(page, /尝试|已验收尝试/u);
      assert.doesNotMatch(page, /执行结束，尚未验收|待验收队列/u);
      assert.doesNotMatch(page, /<div class="meta-label">当前轮次<\/div>/u);
      assert.match(page, /子任务 4：Delta 思考中/u);
      assert.match(page, /主任务 思考中/u);
      assert.doesNotMatch(page, /已全部收口/u);
    } else {
      assert.match(page, /Event-driven review/u);
      assert.match(page, /Reviewing 子任务 1：Alpha\./u);
      assert.doesNotMatch(page, /Accepted attempts|Attempt /u);
      assert.doesNotMatch(page, /Execution finished, not accepted|Review queue/u);
      assert.doesNotMatch(page, /<div class="meta-label">Current round<\/div>/u);
      assert.match(page, /子任务 4：Delta is thinking/u);
      assert.match(page, /主任务 is thinking/u);
      assert.doesNotMatch(page, /fully closed/u);
    }
  }
});

test("renders waiting, a non-empty queue with zero running work, and a damaged snapshot", () => {
  const waitingScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(waitingScheduler.dispatch([spec("D", "d-1")]).started.length, 1);
  const waiting = html(build(waitingScheduler.snapshot()), "zh-CN");
  assert.match(waiting, /data-loop-plus-status="waiting"/u);
  assert.match(waiting, /等待执行结束。主任务没有在生成。/u);
  assert.equal(countValue(waiting, "running"), "1");
  assert.equal(countValue(waiting, "visible"), "0");
  assert.match(waiting, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
  assert.match(waiting, /子任务 4：Delta 思考中/u);
  assert.match(waiting, /typing-dots/u);
  assert.doesNotMatch(waiting, /data-thinking-kind="main"|主任务 思考中|已全部收口|正在验收/u);

  const queuedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(queuedScheduler, "A", "a-1");
  dispatchAndFinish(queuedScheduler, "B", "b-1");
  dispatchAndFinish(queuedScheduler, "C", "c-1");
  const current = queuedScheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(queuedScheduler.submitReview(current.eventId).ok, true);
  const queued = html(build(queuedScheduler.snapshot()), "en");
  assert.match(queued, /data-loop-plus-phase="review_ready"/u);
  assert.match(queued, /data-loop-plus-status="review_pending"/u);
  assert.equal(countValue(queued, "running"), "0");
  assert.equal(countValue(queued, "queue"), "2");
  assert.equal(countValue(queued, "visible"), "2");
  assertLoopPlusDetailCardsHidden(queued);
  assert.match(queued, /This task is not complete\./u);
  assert.doesNotMatch(queued, /fully closed|Reviewing /u);

  const missing = html(build(undefined), "zh-CN");
  assert.match(missing, /data-loop-plus-status="invalid"/u);
  assert.match(missing, /快照缺失或损坏（missing）/u);
  assert.match(missing, /不能把该任务显示成空队列或已完成/u);
  assert.doesNotMatch(missing, /data-loop-plus-count=/u);
  assert.doesNotMatch(missing, /没有排队等待验收的项|已全部收口|正在验收/u);

  const damaged = html(build({ version: 1 }), "en");
  assert.match(damaged, /data-loop-plus-status="invalid"/u);
  assert.match(damaged, /missing or damaged \(Invalid Loop\+ scheduler snapshot:/u);
  assert.match(damaged, /cannot be shown as an empty queue or complete/u);
  assert.doesNotMatch(damaged, /data-loop-plus-count=|fully closed|Reviewing /u);
});

test("renders stopped and resumed Loop+ snapshots in the group chat", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  dispatchAndFinish(scheduler, "B", "b-1");
  assert.equal(scheduler.stopParent().reason, "stopped");
  const stoppedPage = html(build(scheduler.snapshot(), { status: "stopped" }), "zh-CN");
  assert.match(stoppedPage, /data-loop-plus-status="stopped"/u);
  assert.match(stoppedPage, /不会自动验收/u);
  assertLoopPlusDetailCardsHidden(stoppedPage);
  assert.match(stoppedPage, /验收已暂停/u);
  assert.doesNotMatch(stoppedPage, /正在验收|思考中/u);
  assert.match(stoppedPage, /<button[^>]*data-action="continueTask"/u);
  assert.doesNotMatch(stoppedPage, /<button[^>]*data-action="stopTask"/u);

  const resumedResult = scheduler.resumeParent();
  assert.equal(resumedResult.reason, "resumed");
  const resumedPage = html(build(scheduler.snapshot()), "en");
  assert.match(resumedPage, /data-loop-plus-phase="review_ready"/u);
  assert.match(resumedPage, /data-loop-plus-status="review_pending"/u);
  assert.match(resumedPage, /data-loop-plus-field="wake"[\s\S]*?<div class="meta-value">Yes<\/div>/u);
  assertLoopPlusDetailCardsHidden(resumedPage);
  assert.match(resumedPage, /not complete/u);
  assert.doesNotMatch(resumedPage, /Reviewing |fully closed|is thinking/u);
});

test("shows the Loop+ main reviewer animation without reusing a debate active speaker", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "B", "b-1");
  const state = buildLoopDebateChatPanelStateWithDeps(task(scheduler.snapshot(), {
    executionMode: "debate_multi_agent",
    status: "running",
    debateRounds: [{
      loopRound: 2,
      debateRound: 1,
      status: "running",
      startedAt: 30,
      briefFile: "/tmp/debate-brief.md",
      activeSpeaker: { kind: "moderator", id: "moderator", title: "Judge", dialogueTurn: 2, updatedAt: 31 },
      participants: [],
      moderatorDecisions: [],
    }],
  }), {
    collectRunningLoopTaskIds: () => new Set<string>(),
    readTextFileIfNonEmpty: () => "# debate\n",
    fileExists: () => false,
    writeTextFileEnsuringDir: () => false,
    getActiveLoopSubtaskIds: () => [],
    buildLoopCompletedConclusionAndSummaryMarkdown: () => "done",
    t: (key: string) => key,
  });
  const page = html(state, "en");
  assert.equal(state.mode, "debate");
  assert.match(page, /<h1>Loop\+ Group Chat<\/h1>/u);
  assertLoopPlusDetailCardsHidden(page);
  assert.match(page, /data-thinking-kind="main" data-thinking-id="main"/u);
  assert.match(page, /主持人主智能体 is thinking/u);
  assert.doesNotMatch(page, /data-thinking-kind="moderator"|Judge is thinking|Red\/Blue debate group chat/u);
  assert.match(page, /Event-driven review/u);
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
  const heldPage = html(held, "zh-CN");
  assert.match(heldPage, /data-loop-plus-status="paused"/u);
  assert.match(heldPage, /data-loop-plus-phase="reviewing"/u);
  assert.match(heldPage, /自动验收已暂停，需要继续后才会恢复/u);
  assert.equal(countValue(heldPage, "current"), "1");
  assert.equal(countValue(heldPage, "queue"), "1");
  assert.equal(countValue(heldPage, "visible"), "2");
  assert.equal(countValue(heldPage, "running"), "1");
  assert.equal(countValue(heldPage, "pending"), "1");
  assertLoopPlusDetailCardsHidden(heldPage);
  assert.match(heldPage, /自动验收已暂停/u);
  assert.match(heldPage, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
  assert.match(heldPage, /子任务 4：Delta 思考中/u);
  assert.doesNotMatch(heldPage, /data-thinking-kind="main"|主任务 思考中|正在验收|已全部收口/u);
  assert.match(heldPage, /<button[^>]*data-action="continueTask"/u);
  assert.doesNotMatch(heldPage, /<button[^>]*data-action="stopTask"/u);

  const resumedPage = html(build(snapshot, { status: "running", activeSubtaskIds: [] }), "zh-CN");
  assert.equal(JSON.stringify(snapshot), before);
  assert.match(resumedPage, /data-loop-plus-status="reviewing"/u);
  assert.match(resumedPage, /data-loop-plus-phase="reviewing"/u);
  assert.match(resumedPage, /正在验收 子任务 1：Alpha。/u);
  assert.doesNotMatch(resumedPage, /尝试|已验收尝试/u);
  assertLoopPlusDetailCardsHidden(resumedPage);
  assert.match(resumedPage, /子任务 4：Delta 思考中/u);
  assert.match(resumedPage, /主任务 思考中/u);
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
  const queuedPage = html(build(queueSnapshot, { status: "error", activeSubtaskIds: [] }), "en");
  assert.equal(JSON.stringify(queueSnapshot), queueBefore);
  assert.match(queuedPage, /data-loop-plus-status="paused"/u);
  assert.match(queuedPage, /data-loop-plus-phase="review_ready"/u);
  assert.match(queuedPage, /Automatic review is paused until you continue/u);
  assert.equal(countValue(queuedPage, "current"), "0");
  assert.equal(countValue(queuedPage, "queue"), "1");
  assert.equal(countValue(queuedPage, "visible"), "1");
  assertLoopPlusDetailCardsHidden(queuedPage);
  assert.doesNotMatch(queuedPage, /Reviewing |is thinking|fully closed/u);
  assert.match(queuedPage, /<button[^>]*data-action="continueTask"/u);

  const queueResumedPage = html(build(queueSnapshot, { status: "running", activeSubtaskIds: [] }), "en");
  assert.equal(JSON.stringify(queueSnapshot), queueBefore);
  assert.match(queueResumedPage, /data-loop-plus-status="review_pending"/u);
  assert.match(queueResumedPage, /data-loop-plus-phase="review_ready"/u);
  assert.match(queueResumedPage, /has not started/u);
  assert.doesNotMatch(queueResumedPage, /Automatic review is paused|Reviewing |is thinking/u);

  assert.equal(scheduler.stopParent().reason, "stopped");
  const stoppedPage = html(build(scheduler.snapshot(), { status: "needs-review" }), "zh-CN");
  assert.match(stoppedPage, /data-loop-plus-status="stopped"/u);
  assert.match(stoppedPage, /data-loop-plus-phase="stopped"/u);
  assertLoopPlusDetailCardsHidden(stoppedPage);
  assert.match(stoppedPage, /data-thinking-kind="subtask" data-thinking-id="D"/u);
  assert.match(stoppedPage, /子任务 4：Delta 思考中/u);
  assert.doesNotMatch(stoppedPage, /data-thinking-kind="main"|自动验收已暂停|正在验收|主任务 思考中/u);

  const completedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(completedScheduler.complete().ok, true);
  const completedPage = html(build(completedScheduler.snapshot(), { status: "error" }), "en");
  assert.match(completedPage, /data-loop-plus-status="completed"/u);
  assert.match(completedPage, /fully closed/u);
  assert.doesNotMatch(completedPage, /Automatic review is paused|Reviewing /u);

  const missingPage = html(build(undefined, { status: "needs-review" }), "zh-CN");
  assert.match(missingPage, /data-loop-plus-status="invalid"/u);
  assert.match(missingPage, /快照缺失或损坏（missing）/u);
  assert.doesNotMatch(missingPage, /自动验收已暂停|正在验收|data-loop-plus-count=/u);
});


test("shows one execution animation for every running Loop+ subtask without pretending the waiting main task is generating", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const dispatched = scheduler.dispatch([spec("D", "d-1"), spec("E", "e-1")]);
  assert.deepEqual(dispatched.started.map((item) => item.subtaskId), ["D", "E"]);
  const page = html(build(scheduler.snapshot()), "zh-CN");
  assert.match(page, /data-loop-plus-status="waiting"/u);
  assert.match(page, /等待执行结束。主任务没有在生成。/u);
  const delta = page.indexOf('data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"');
  const echo = page.indexOf('data-thinking-kind="subtask" data-thinking-id="E" data-thinking-attempt="e-1"');
  assert.ok(delta >= 0 && echo > delta);
  assert.match(page, /子任务 4：Delta 思考中/u);
  assert.match(page, /子任务 5：Echo 思考中/u);
  assert.equal(page.match(/data-thinking-kind="subtask"/gu)?.length, 2);
  assert.equal(page.match(/class="typing-dots"/gu)?.length, 2);
  assert.doesNotMatch(page, /data-thinking-kind="main"|主任务 思考中|正在验收/u);
});

test("shows acceptance passed or failed instead of reviewed attempts", () => {
  const passedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(passedScheduler, "A", "a-1");
  const passedCurrent = passedScheduler.snapshot().currentReview;
  assert.ok(passedCurrent);
  assert.equal(passedScheduler.submitReview(passedCurrent.eventId).ok, true);
  const passedPage = html(build(passedScheduler.snapshot()), "zh-CN");
  assertLoopPlusDetailCardsHidden(passedPage);
  assert.match(passedPage, /验收结果/u);
  assert.match(passedPage, /子任务 1：Alpha/u);
  assert.match(passedPage, /验收成功/u);
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
  const failedPage = html(build(failedScheduler.snapshot()), "zh-CN");
  assertLoopPlusDetailCardsHidden(failedPage);
  assert.match(failedPage, /子任务 2：Bravo/u);
  assert.match(failedPage, /验收失败/u);
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
  const stoppedPage = html(build(stoppedScheduler.snapshot()), "en");
  assertLoopPlusDetailCardsHidden(stoppedPage);
  assert.match(stoppedPage, /子任务 3：Charlie/u);
  assert.match(stoppedPage, /Acceptance failed/u);
  assert.doesNotMatch(stoppedPage, /子任务 3：Charlie · Acceptance failed/u);
  assert.doesNotMatch(stoppedPage, /Accepted attempts|Attempt /u);

  const legacy = passedScheduler.snapshot();
  const seen = legacy.seenAttempts.find((item) => item.attemptId === "a-1");
  assert.ok(seen);
  delete seen.outcome;
  const legacyFailed = html(build(legacy, {
    subTasks: [{ id: "A", title: "Alpha", status: "blocked", updatedAt: 11 }],
  }), "zh-CN");
  assertLoopPlusDetailCardsHidden(legacyFailed);
  assert.match(legacyFailed, /子任务 1：Alpha/u);
  assert.match(legacyFailed, /验收失败/u);
  assert.doesNotMatch(legacyFailed, /验收成功|子任务 1：Alpha · 验收失败/u);
  const legacyPassed = html(build(legacy, {
    subTasks: [{ id: "A", title: "Alpha", status: "completed", updatedAt: 11 }],
  }), "zh-CN");
  assertLoopPlusDetailCardsHidden(legacyPassed);
  assert.match(legacyPassed, /子任务 1：Alpha/u);
  assert.match(legacyPassed, /验收成功/u);
  assert.doesNotMatch(legacyPassed, /子任务 1：Alpha · 验收成功/u);
});
