"use strict";

/*
 * macOS Loop+ 协议回归入口。
 *
 * 确定性夹具场景在普通 Node 进程里安装与扩展宿主测试相同的 vscode 替身，
 * 再调用生产适配器 runEventDriven。这是插件的事件驱动正常入口，但不是 Extension Host 进程。
 * success-baseline-extension-host 复用部门激活烟测的隔离启动方式，在真实 Extension Host 里
 * 跑同一条成功基线。关页身份由 lp495 负责，本入口只记录关页尝试，不把它当失败。
 * 最终候选的完整宿主验收不在本入口。
 */

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const product = path.resolve(__dirname, "..");
const dist = process.env.LOOP_PLUS_PROTOCOL_REGRESSION_DIST
  ? path.resolve(process.env.LOOP_PLUS_PROTOCOL_REGRESSION_DIST)
  : path.join(product, "dist");

const SCENARIOS = [
  {
    id: "success-baseline",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "合成根提示经 runEventDriven 进入，fullstack 与子任务模型都设为 sub-model。主回复派发一个子任务；子任务以 end 交付；验收 progressPercent=30 且通过；收口回复 completed，并带齐默认验收与 requirementCoverage。",
    expected: "子任务实际模型是 sub-model。同一任务完成，进度 100，恰好一条 loop-plus-completed，没有协议拒绝，会话仍是夹具会话。",
    failure: "超时、任务未完成、进度不是 100、完成消息不是一条、出现协议拒绝、attempt 数不是 1，或会话被替换。",
  },
  {
    id: "empty-reply-recovery",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "第一轮主回复是 status=end 的空字符串。自动续跑后的第二轮回复派发子任务 recovered。",
    expected: "先记录 format.EmptyResponse 和 continuation_requested，随后 recovered 子任务入运行，任务保持 running，并记录 protocol recovery 的 recovered。",
    failure: "超时、没有 EmptyResponse、空回复后直接暂停、没有派发 recovered，或任务不是 running。",
  },
  {
    id: "multi-failure-line-correlation",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "锚点验收后，left 与 right 组成冻结批次。先两行 failed 都不关联；再只关联 left；最后两行分别只关联自己的原逻辑 ID，并各派发一项同 ID 返工。",
    expected: "前两次拒绝的原因码都是 validation.accept.failed_repair_missing，冻结顺序不变，不新增 attempt。第三次后只新增 left 与 right 的新 attempt。",
    failure: "超时、任一次部分提交、冻结顺序变化、返工 ID 或 attempt 数不符。",
  },
  {
    id: "preflight-rejection",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "done 已进入首次验收且 busy 仍在运行。主回复 status=dispatch，nextStepPlan 指向原批次，子任务 overlap 写入 src/done.ts。",
    expected: "原因码 state.dispatch_window.preflight_failed。done 仍是活动验收，overlap 未启动，busy 仍是原 attempt，任务保持 running。",
    failure: "超时、验收被提交、overlap 启动、busy 被替换，或原因码不是预检失败。",
  },
  {
    id: "accept-committed-partial-dispatch-reject",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "done 的验收通过，progressPercent=33。fresh 与仍在运行的 busy 都以 independentSubtaskIds 在同一决策中派发。",
    expected: "done 已 reviewed/passed，进度 33，fresh 已启动，busy 仍只有原 attempt，原因码 state.dispatch.rejected，任务未完成。",
    failure: "超时、验收回滚、fresh 未启动、busy 被重复派发、进度丢失，或没有派发拒绝。",
  },
  {
    id: "consecutive-correction-progress",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "alpha 验收先缺 progressPercent，再以 20 通过，并把 beta 列为 independentSubtaskIds 派发。beta 验收再次缺进度，随后以 45 通过。",
    expected: "两次无效纠正都不改变已保存进度。有效验收后进度依次为 20 和 45，且都小于 100。",
    failure: "超时、无效纠正改写进度、有效验收没有前移，或进度变成 100。",
  },
  {
    id: "late-event-frozen-batch",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "source 的验收提示已经发出并保持冻结。此后 late 才以 end 交付。",
    expected: "活动验收仍只有 source。late 只出现在 reviewQueue。已发出的提示编号清单不含 late。",
    failure: "超时、活动验收被替换或清空、late 进入原冻结编号，或 source 不再是当前验收。",
  },
  {
    id: "resume-idempotent",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "连续四次空回复使任务进入 needs-review。随后对同一任务调用三次 resumeRequested 续跑，后两次发生在第一次续跑的主回合仍被挂起时。",
    expected: "仍是原任务和原会话。第一次续跑只增加一个主回合。挂起期间的重复续跑不再增加主回合或子任务。",
    failure: "超时、新建任务、重复主回合、出现子任务，或续跑绑定了另一个会话。",
  },
  {
    id: "completion-gate",
    lane: "deterministic-fixture",
    timeoutMs: 15000,
    input: "alpha 已可验收时，beta 仍在运行。此时提交带齐通过证据的 completed。等 beta 交付并单独验收后，再提交 completed。",
    expected: "过早 completed 不完成父任务，beta 继续运行，且没有完成消息。合法收口后父任务完成，进度 100，完成消息恰好一条。",
    failure: "超时、提前完成、丢失 beta、合法收口后未完成，或完成消息不是一条。",
  },
  {
    id: "success-baseline-extension-host",
    lane: "extension-host",
    timeoutMs: 180000,
    input: "用隔离 HOME、user-data 和 extensions 启动已安装的 VS Code，--extensionTestsPath 指向本次生成的测试入口。入口确认产品由 onStartupFinished 激活后，执行与成功基线相同的合成输入。",
    expected: "Extension Host 进程退出码 0。激活的是当前产品，HOME 被隔离。成功基线断言通过。",
    failure: "超时、退出码非 0、激活路径或 HOME 不符，或宿主内成功基线断言失败。",
  },
];

const FIXTURE_RUNNERS = {
  "success-baseline": successBaseline,
  "empty-reply-recovery": emptyReplyRecovery,
  "multi-failure-line-correlation": multiFailureLineCorrelation,
  "preflight-rejection": preflightRejection,
  "accept-committed-partial-dispatch-reject": acceptCommittedPartialDispatchReject,
  "consecutive-correction-progress": consecutiveCorrectionProgress,
  "late-event-frozen-batch": lateEventFrozenBatch,
  "resume-idempotent": resumeIdempotent,
  "completion-gate": completionGate,
};

let runtime;

function loadRuntime() {
  if (runtime) return runtime;
  const fixturePath = path.join(dist, "test/extensionHost/fixtures/loopPlusRuntimeFixture.js");
  if (!fs.existsSync(fixturePath) || !fs.existsSync(path.join(dist, "extension.js"))) {
    throw new Error("缺少 dist 产物。请先在仓库根目录执行 npm run build，再运行本入口。");
  }
  if (process.env.LOOP_PLUS_PROTOCOL_REGRESSION_INSIDE_HOST !== "1") {
    require(path.join(dist, "test/vscodeMock.js")).installVscodeMock();
  }
  const fixture = require(fixturePath);
  const scheduler = require(path.join(dist, "loopPlusScheduler.js"));
  const accept = require(path.join(dist, "test/loopPlusAcceptFixture.js"));
  runtime = {
    createLoopPlusRuntimeFixture: fixture.createLoopPlusRuntimeFixture,
    waitForLoopPlus: fixture.waitForLoopPlus,
    buildLoopPlusFinishEventId: scheduler.buildLoopPlusFinishEventId,
    createLoopPlusScheduler: scheduler.createLoopPlusScheduler,
    withLoopPlusAcceptReviews: accept.withLoopPlusAcceptReviews,
    loopPlusAcceptanceChecksFixture: accept.loopPlusAcceptanceChecksFixture,
  };
  return runtime;
}

function child(id, files = [`src/${id}.ts`]) {
  return {
    id,
    title: id,
    taskType: "backend",
    writeFiles: files,
    prompt: `Implement ${id} without editing the parent task record or scheduler snapshot. Write scope: ${files.join(", ")}. Report only the attempt result.`,
  };
}

function decisionText(value) {
  return JSON.stringify(loadRuntime().withLoopPlusAcceptReviews(value));
}

function completedDecision(extra = {}) {
  const checks = loadRuntime().loopPlusAcceptanceChecksFixture();
  return {
    status: "completed",
    answerConclusion: "synthetic completion",
    finalSummary: "synthetic final summary for the protocol regression gate",
    acceptance: { passed: true, checks },
    requirementCoverage: [{ name: "synthetic scope", passed: true, detail: "covered by the fixture evidence" }],
    ...extra,
  };
}

function createSession() {
  const fx = loadRuntime().createLoopPlusRuntimeFixture({ maxConcurrency: 5, decisionSubtaskMax: () => 5 });
  const session = {
    fixture: fx,
    running: undefined,
    resumePromises: [],
    arm(label) {
      let turn;
      fx.queueMain(async (input, tabId) => {
        const held = fx.holdMain();
        turn = {
          input,
          tabId,
          reply(value, content) {
            fx.publish(input, tabId, {
              status: "end",
              content: content === undefined ? decisionText(value) : content,
            });
            fx.releaseHeldMain();
          },
        };
        await held;
      });
      return () => waitUntil(() => Boolean(turn), label).then(() => turn);
    },
    start(prompt = "SYNTHETIC_PROTOCOL_ROOT") {
      this.running = fx.adapter.runEventDriven({
        displayPrompt: prompt,
        modelPrompt: prompt,
        contextTags: [],
        loopMainModel: "main-model",
        loopSubtaskModel: "sub-model",
        loopSubtaskMode: "fullstack",
        loopSubtaskFullstackModel: "sub-model",
      }, { schedulingMode: "event_driven" }, fx.target);
      return this.running;
    },
    resume(prompt = "SYNTHETIC_PROTOCOL_RESUME") {
      const promise = fx.adapter.runEventDriven({
        displayPrompt: prompt,
        modelPrompt: prompt,
        contextTags: [],
      }, {
        schedulingMode: "event_driven",
        resumeTaskId: taskRecord(this).id,
        resumeRequested: true,
      }, fx.target);
      this.resumePromises.push(promise);
      return promise;
    },
  };
  return session;
}

async function waitUntil(predicate, label) {
  const budgetAt = Date.now() + 8000;
  let last = new Error(`timed out: ${label}`);
  while (Date.now() < budgetAt) {
    if (predicate()) return;
    try {
      await loadRuntime().waitForLoopPlus(predicate, label);
      return;
    } catch (error) {
      last = error;
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  throw last;
}

function taskRecord(session) {
  const id = session.fixture.createdTaskIds[0];
  const record = id ? session.fixture.readTask(id) : null;
  assert.ok(record, "the original task must remain readable");
  return record;
}

function snapshotOf(session) {
  return loadRuntime().createLoopPlusScheduler({ snapshot: taskRecord(session).loopPlus }).snapshot();
}

function activeReviews(session) {
  return session.fixture.adapter.host().getActiveReviewEventIds(taskRecord(session).id);
}

function protocolMisses(session) {
  return session.fixture.logs
    .filter((item) => item.event === "loop-plus-protocol-miss")
    .map((item) => item.detail);
}

function recoveryResults(session) {
  return session.fixture.logs
    .filter((item) => item.event === "loop-plus-protocol-recovery")
    .map((item) => item.detail.result);
}

function captureFinish(session, subtaskId) {
  const parked = session.fixture.peekParked(subtaskId);
  assert.ok(parked, `parked attempt for ${subtaskId}`);
  const attemptId = parked.input.loopAttemptId;
  assert.ok(attemptId, `attempt id for ${subtaskId}`);
  return { attemptId, eventId: loadRuntime().buildLoopPlusFinishEventId(subtaskId, attemptId) };
}

function finishDelivery(session, subtaskId) {
  const captured = captureFinish(session, subtaskId);
  session.fixture.finishParked(subtaskId, { status: "end", content: `SYNTHETIC_DELIVERY ${subtaskId}` });
  return captured;
}

async function waitParked(session, ids) {
  await waitUntil(() => ids.every((id) => session.fixture.peekParked(id)), `parked ${ids.join(",")}`);
}

async function successBaseline(session) {
  const initial = session.arm("success initial");
  const running = session.start();
  const first = await initial();
  const review = session.arm("success review");
  first.reply({ status: "dispatch", subtasks: [child("baseline")] });
  await waitParked(session, ["baseline"]);
  assert.deepEqual(session.fixture.attemptCalls.map((call) => call.model), ["sub-model"]);
  const delivery = finishDelivery(session, "baseline");
  const reviewTurn = await review();
  const closeout = session.arm("success closeout");
  reviewTurn.reply({
    status: "accept",
    reviewEventId: delivery.eventId,
    progressPercent: 30,
    reviews: [{ reviewEventId: delivery.eventId, acceptance: "passed", reason: "基线交付与证据符合要求" }],
  });
  const closeTurn = await closeout();
  closeTurn.reply(completedDecision());
  await running;
  const task = taskRecord(session);
  assert.equal(task.status, "completed");
  assert.equal(task.loopPlusProgressPercent, 100);
  assert.equal(task.sessionId, session.fixture.target.sessionId);
  assert.equal(session.fixture.hostMessages.filter((message) => message === "loop-plus-completed").length, 1);
  assert.deepEqual(protocolMisses(session), []);
  assert.equal(session.fixture.createdTaskIds.length, 1);
  assert.equal(session.fixture.attemptCalls.length, 1);
}

async function emptyReplyRecovery(session) {
  session.fixture.queueMain(async (input, tabId) => {
    session.fixture.publish(input, tabId, { status: "end", content: "" });
  });
  const recovered = session.arm("empty recovery dispatch");
  session.start();
  const turn = await recovered();
  assert.equal(protocolMisses(session).at(-1)?.reasonCode, "format.EmptyResponse");
  assert.equal(recoveryResults(session).at(-1), "continuation_requested");
  turn.reply({ status: "dispatch", subtasks: [child("recovered")] });
  await waitParked(session, ["recovered"]);
  assert.equal(taskRecord(session).status, "running");
  assert.equal(recoveryResults(session).at(-1), "recovered");
  assert.equal(session.fixture.createdTaskIds.length, 1);
}

async function multiFailureLineCorrelation(session) {
  const initial = session.arm("correlation initial");
  session.start();
  const first = await initial();
  const anchorReview = session.arm("correlation anchor");
  first.reply({ status: "dispatch", subtasks: [child("anchor"), child("left"), child("right")] });
  await waitParked(session, ["anchor", "left", "right"]);
  const anchor = finishDelivery(session, "anchor");
  const anchorTurn = await anchorReview();
  const left = finishDelivery(session, "left");
  const right = finishDelivery(session, "right");
  await waitUntil(() => {
    const queued = snapshotOf(session).reviewQueue.map((item) => item.subtaskId);
    return queued.includes("left") && queued.includes("right");
  }, "left and right queued behind anchor");
  const batchWait = session.arm("correlation batch");
  anchorTurn.reply({
    status: "accept",
    reviewEventId: anchor.eventId,
    progressPercent: 10,
    reviews: [{ reviewEventId: anchor.eventId, acceptance: "passed", reason: "锚点证据符合要求" }],
  });
  const batch = await batchWait();
  const frozen = [left.eventId, right.eventId];
  assert.deepEqual(activeReviews(session), frozen);
  const missingBoth = session.arm("correlation missing both");
  batch.reply({
    status: "accept",
    reviewEventIds: frozen,
    progressPercent: 30,
    reviews: frozen.map((reviewEventId) => ({ reviewEventId, acceptance: "failed", reason: "证据未覆盖失败项" })),
  });
  const second = await missingBoth();
  assert.equal(protocolMisses(session).at(-1)?.reasonCode, "validation.accept.failed_repair_missing");
  assert.deepEqual(activeReviews(session), frozen);
  assert.equal(session.fixture.attemptCalls.length, 3);
  const missingRight = session.arm("correlation missing right");
  second.reply({
    status: "accept",
    reviewEventIds: frozen,
    progressPercent: 30,
    reviews: [
      { reviewEventId: left.eventId, acceptance: "failed", reason: "left 需要返工", subtaskIds: ["left"] },
      { reviewEventId: right.eventId, acceptance: "failed", reason: "right 尚未关联" },
    ],
    subtasks: [child("left")],
  });
  const third = await missingRight();
  assert.equal(protocolMisses(session).at(-1)?.reasonCode, "validation.accept.failed_repair_missing");
  assert.deepEqual(activeReviews(session), frozen);
  assert.equal(session.fixture.attemptCalls.length, 3);
  third.reply({
    status: "accept",
    reviewEventIds: frozen,
    progressPercent: 35,
    reviews: [
      { reviewEventId: left.eventId, acceptance: "failed", reason: "left 需要返工", subtaskIds: ["left"] },
      { reviewEventId: right.eventId, acceptance: "failed", reason: "right 需要返工", subtaskIds: ["right"] },
    ],
    subtasks: [child("left"), child("right")],
  });
  await waitParked(session, ["left", "right"]);
  assert.equal(session.fixture.attemptCalls.length, 5);
  assert.notEqual(session.fixture.peekParked("left").input.loopAttemptId, left.attemptId);
  assert.notEqual(session.fixture.peekParked("right").input.loopAttemptId, right.attemptId);
  assert.deepEqual(activeReviews(session), []);
  assert.equal(taskRecord(session).status, "running");
}

async function preflightRejection(session) {
  const initial = session.arm("preflight initial");
  session.start();
  const first = await initial();
  const review = session.arm("preflight review");
  first.reply({ status: "dispatch", subtasks: [child("done", ["src/done.ts"]), child("busy", ["src/busy.ts"])] });
  await waitParked(session, ["done", "busy"]);
  const done = finishDelivery(session, "done");
  const busyAttempt = session.fixture.peekParked("busy").input.loopAttemptId;
  const reviewTurn = await review();
  const correction = session.arm("preflight correction");
  reviewTurn.reply({
    status: "dispatch",
    nextStepPlan: { objective: "先保持当前冻结验收，不在预检失败时提交" },
    subtasks: [child("overlap", ["src/done.ts"])],
  });
  await correction();
  assert.equal(protocolMisses(session).at(-1)?.reasonCode, "state.dispatch_window.preflight_failed");
  assert.deepEqual(activeReviews(session), [done.eventId]);
  assert.equal(snapshotOf(session).currentReview?.eventId, done.eventId);
  assert.equal(session.fixture.peekParked("overlap"), null);
  assert.equal(session.fixture.peekParked("busy").input.loopAttemptId, busyAttempt);
  assert.equal(taskRecord(session).status, "running");
}

async function acceptCommittedPartialDispatchReject(session) {
  const initial = session.arm("partial initial");
  session.start();
  const first = await initial();
  const review = session.arm("partial review");
  first.reply({ status: "dispatch", subtasks: [child("done", ["src/done.ts"]), child("busy", ["src/busy.ts"])] });
  await waitParked(session, ["done", "busy"]);
  const done = finishDelivery(session, "done");
  const busyAttempt = session.fixture.peekParked("busy").input.loopAttemptId;
  const reviewTurn = await review();
  const correction = session.arm("partial correction");
  reviewTurn.reply({
    status: "accept",
    reviewEventId: done.eventId,
    progressPercent: 33,
    reviews: [{ reviewEventId: done.eventId, acceptance: "passed", reason: "done 的证据符合要求" }],
    independentSubtaskIds: ["fresh", "busy"],
    subtasks: [child("fresh", ["src/fresh.ts"]), child("busy", ["src/busy.ts"])],
  });
  await correction();
  const snap = snapshotOf(session);
  const reviewed = snap.seenAttempts.find((item) => item.subtaskId === "done" && item.disposition === "reviewed");
  assert.equal(reviewed?.acceptance, "passed");
  assert.equal(taskRecord(session).loopPlusProgressPercent, 33);
  assert.ok(session.fixture.peekParked("fresh"), "fresh must start");
  assert.equal(snap.seenAttempts.filter((item) => item.subtaskId === "busy").length, 1);
  assert.equal(session.fixture.peekParked("busy").input.loopAttemptId, busyAttempt);
  assert.equal(protocolMisses(session).at(-1)?.reasonCode, "state.dispatch.rejected");
  assert.equal(taskRecord(session).status, "running");
  assert.equal(session.fixture.hostMessages.includes("loop-plus-completed"), false);
}

async function consecutiveCorrectionProgress(session) {
  const initial = session.arm("progress initial");
  session.start();
  const first = await initial();
  const alphaReview = session.arm("progress alpha");
  first.reply({ status: "dispatch", subtasks: [child("alpha")] });
  await waitParked(session, ["alpha"]);
  assert.equal(taskRecord(session).loopPlusProgressPercent, 0);
  const alpha = finishDelivery(session, "alpha");
  const alphaTurn = await alphaReview();
  const alphaRetry = session.arm("progress alpha retry");
  alphaTurn.reply({
    status: "accept",
    reviewEventId: alpha.eventId,
    reviews: [{ reviewEventId: alpha.eventId, acceptance: "passed", reason: "alpha 证据符合要求" }],
  });
  const alphaRetryTurn = await alphaRetry();
  assert.match(alphaRetryTurn.input.modelPrompt, /progressPercent/);
  assert.equal(taskRecord(session).loopPlusProgressPercent, 0);
  alphaRetryTurn.reply({
    status: "accept",
    reviewEventId: alpha.eventId,
    progressPercent: 20,
    reviews: [{ reviewEventId: alpha.eventId, acceptance: "passed", reason: "alpha 证据符合要求" }],
    independentSubtaskIds: ["beta"],
    subtasks: [child("beta", ["src/beta.ts"])],
  });
  await waitParked(session, ["beta"]);
  assert.equal(taskRecord(session).loopPlusProgressPercent, 20);
  const betaReview = session.arm("progress beta");
  const beta = finishDelivery(session, "beta");
  const betaTurn = await betaReview();
  const betaRetry = session.arm("progress beta retry");
  betaTurn.reply({
    status: "accept",
    reviewEventId: beta.eventId,
    reviews: [{ reviewEventId: beta.eventId, acceptance: "passed", reason: "beta 证据符合要求" }],
  });
  const betaRetryTurn = await betaRetry();
  assert.equal(taskRecord(session).loopPlusProgressPercent, 20);
  const closeout = session.arm("progress closeout");
  betaRetryTurn.reply({
    status: "accept",
    reviewEventId: beta.eventId,
    progressPercent: 45,
    reviews: [{ reviewEventId: beta.eventId, acceptance: "passed", reason: "beta 证据符合要求" }],
  });
  await closeout();
  assert.equal(taskRecord(session).loopPlusProgressPercent, 45);
  assert.ok(taskRecord(session).loopPlusProgressPercent < 100);
}

async function lateEventFrozenBatch(session) {
  const initial = session.arm("late initial");
  session.start();
  const first = await initial();
  const anchorReview = session.arm("late anchor");
  first.reply({ status: "dispatch", subtasks: [child("anchor"), child("source"), child("late")] });
  await waitParked(session, ["anchor", "source", "late"]);
  const anchor = finishDelivery(session, "anchor");
  const anchorTurn = await anchorReview();
  const source = finishDelivery(session, "source");
  await waitUntil(() => snapshotOf(session).reviewQueue.some((item) => item.subtaskId === "source"), "source queued");
  const frozenWait = session.arm("late frozen");
  anchorTurn.reply({
    status: "accept",
    reviewEventId: anchor.eventId,
    progressPercent: 15,
    reviews: [{ reviewEventId: anchor.eventId, acceptance: "passed", reason: "锚点证据符合要求" }],
  });
  const frozenTurn = await frozenWait();
  assert.deepEqual(activeReviews(session), [source.eventId]);
  const late = finishDelivery(session, "late");
  await waitUntil(() => snapshotOf(session).reviewQueue.some((item) => item.eventId === late.eventId), "late queued behind frozen batch");
  assert.deepEqual(activeReviews(session), [source.eventId]);
  assert.match(frozenTurn.input.modelPrompt, new RegExp(`\\n1\\. ${escapeRegExp(source.eventId)}\\n`));
  assert.doesNotMatch(frozenTurn.input.modelPrompt, new RegExp(`\\n\\d+\\. ${escapeRegExp(late.eventId)}\\n`));
  assert.equal(snapshotOf(session).currentReview?.eventId, source.eventId);
}

async function resumeIdempotent(session) {
  for (let index = 0; index < 4; index += 1) {
    session.fixture.queueMain(async (input, tabId) => {
      session.fixture.publish(input, tabId, { status: "end", content: "" });
    });
  }
  const held = session.arm("resume hold");
  session.start();
  await waitUntil(() => {
    const id = session.fixture.createdTaskIds[0];
    const record = id ? session.fixture.readTask(id) : null;
    return record?.status === "needs-review" && session.fixture.mainCalls.length === 4;
  }, "protocol pause");
  const originalId = taskRecord(session).id;
  session.resume();
  const turn = await held();
  assert.equal(session.fixture.mainCalls.length, 5);
  assert.equal(session.fixture.createdTaskIds.length, 1);
  assert.equal(taskRecord(session).id, originalId);
  assert.equal(taskRecord(session).sessionId, session.fixture.target.sessionId);
  assert.equal(turn.input.loopTaskId, originalId);
  assert.equal(turn.tabId, session.fixture.target.tabId);
  session.resume();
  session.resume();
  const until = Date.now() + 300;
  while (Date.now() < until) {
    assert.equal(session.fixture.mainCalls.length, 5);
    assert.equal(session.fixture.attemptCalls.length, 0);
    assert.equal(session.fixture.createdTaskIds[0], originalId);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(taskRecord(session).status, "running");
}

async function completionGate(session) {
  const initial = session.arm("gate initial");
  session.start();
  const first = await initial();
  const alphaReview = session.arm("gate alpha review");
  first.reply({ status: "dispatch", subtasks: [child("alpha"), child("beta")] });
  await waitParked(session, ["alpha", "beta"]);
  const alpha = finishDelivery(session, "alpha");
  const alphaTurn = await alphaReview();
  alphaTurn.reply(completedDecision({ reviewEventId: alpha.eventId }));
  await waitUntil(() => {
    const snap = snapshotOf(session);
    return snap.seenAttempts.some((item) => item.attemptId === alpha.attemptId && item.disposition === "reviewed")
      && session.fixture.peekParked("beta");
  }, "early completion consumed only alpha");
  assert.equal(taskRecord(session).status, "running");
  assert.notEqual(taskRecord(session).loopPlusProgressPercent, 100);
  assert.equal(session.fixture.hostMessages.includes("loop-plus-completed"), false);
  const betaReview = session.arm("gate beta review");
  const beta = finishDelivery(session, "beta");
  const betaTurn = await betaReview();
  const closeout = session.arm("gate closeout");
  betaTurn.reply({
    status: "accept",
    reviewEventId: beta.eventId,
    progressPercent: 70,
    reviews: [{ reviewEventId: beta.eventId, acceptance: "passed", reason: "beta 证据符合要求" }],
  });
  const closeTurn = await closeout();
  const running = session.running;
  closeTurn.reply(completedDecision());
  await running;
  assert.equal(taskRecord(session).status, "completed");
  assert.equal(taskRecord(session).loopPlusProgressPercent, 100);
  assert.equal(session.fixture.hostMessages.filter((message) => message === "loop-plus-completed").length, 1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function settle(session) {
  const observation = {
    tabCloseAttempts: session.fixture.closeSubtaskTabAttempts.length,
    closedTabs: session.fixture.closedSubtaskTabs.length,
    fixtureRoot: session.fixture.rootDir,
  };
  const id = session.fixture.createdTaskIds[0];
  if (id) {
    try { session.fixture.adapter.host().stopParent(id); } catch { /* 收口只负责释放本次夹具。 */ }
  }
  session.fixture.releaseHeldMain();
  for (const subtaskId of session.fixture.parkedSubtaskIds()) session.fixture.releaseParkedIfPresent(subtaskId);
  const pending = [session.running, ...session.resumePromises].filter(Boolean);
  await Promise.all(pending.map((promise) => Promise.resolve(promise).catch(() => undefined)));
  session.fixture.dispose();
  observation.fixtureRootRemoved = !fs.existsSync(observation.fixtureRoot);
  return observation;
}

function printCatalog() {
  for (const scenario of SCENARIOS) {
    console.log([
      `scenario=${scenario.id}`,
      `lane=${scenario.lane}`,
      `timeoutMs=${scenario.timeoutMs}`,
      `input=${scenario.input}`,
      `expected=${scenario.expected}`,
      `failure=${scenario.failure}`,
    ].join("\n"));
    console.log("");
  }
}

function selectedScenarios(options) {
  return SCENARIOS.filter((scenario) => {
    if (options.ids.size > 0 && !options.ids.has(scenario.id)) return false;
    if (options.fixtureOnly && scenario.lane !== "deterministic-fixture") return false;
    if (options.extensionHostOnly && scenario.lane !== "extension-host") return false;
    if (!options.extensionHostOnly && !options.includeExtensionHost && scenario.lane === "extension-host") return false;
    return true;
  });
}

async function runFixtureScenario(scenario) {
  const started = Date.now();
  console.log(`[loop-plus-protocol-regression] START scenario=${scenario.id} lane=${scenario.lane} timeoutMs=${scenario.timeoutMs}`);
  const session = createSession();
  let timer;
  let observation;
  try {
    await Promise.race([
      FIXTURE_RUNNERS[scenario.id](session),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout ${scenario.timeoutMs}ms`)), scenario.timeoutMs);
      }),
    ]);
    const elapsedMs = Date.now() - started;
    console.log(`[loop-plus-protocol-regression] PASS scenario=${scenario.id} lane=${scenario.lane} elapsedMs=${elapsedMs}`);
    return { id: scenario.id, lane: scenario.lane, result: "pass", elapsedMs };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    console.error(`[loop-plus-protocol-regression] FAIL scenario=${scenario.id} lane=${scenario.lane} timeoutMs=${scenario.timeoutMs} elapsedMs=${elapsedMs}`);
    console.error(`[loop-plus-protocol-regression] failureCriterion=${scenario.failure}`);
    console.error(error && error.stack ? error.stack : String(error));
    try {
      console.error(`[loop-plus-protocol-regression] scenario=${scenario.id} recentProtocolMisses=${JSON.stringify(protocolMisses(session).slice(-4))}`);
    } catch { /* 失败输出保持场景 ID，不因诊断读取再次掩盖原始错误。 */ }
    return { id: scenario.id, lane: scenario.lane, result: "fail", elapsedMs, error: error && error.stack ? error.stack : String(error) };
  } finally {
    clearTimeout(timer);
    try { observation = await settle(session); } catch (error) { observation = { settleError: String(error) }; }
  }
}

function vscodeExecutable() {
  if (process.env.SINITEK_VSCODE_EXE) return process.env.SINITEK_VSCODE_EXE;
  if (process.platform === "darwin") return "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe");
  return "/usr/share/code/code";
}

function processesFor(token, pid) {
  if (process.platform === "win32") {
    const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
    if (result.status !== 0) return [];
    const parsed = JSON.parse(result.stdout || "[]");
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    return processes.filter((item) => item.CommandLine?.includes(token) || item.ParentProcessId === pid || item.ProcessId === pid);
  }
  const result = cp.spawnSync("ps", ["-axo", "pid=,pgid=,stat=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`无法核对本次进程：${result.stderr}`);
  return result.stdout.split("\n").filter((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return match && !match[3].includes("Z") && (Number(match[2]) === pid || match[4].includes(token));
  });
}

async function launchExtensionHost(scenario) {
  const started = Date.now();
  console.log(`[loop-plus-protocol-regression] START scenario=${scenario.id} lane=${scenario.lane} timeoutMs=${scenario.timeoutMs}`);
  const token = `sinitek-lp-protocol-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const root = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), `${token}-`));
  const home = path.join(root, "home");
  const code = vscodeExecutable();
  let child;
  let exited = false;
  let forced = false;
  const report = { id: scenario.id, lane: scenario.lane, root, token };
  try {
    assert.equal(process.platform === "win32" || fs.existsSync(code), true, `未找到 VS Code：${code}`);
    assert.ok(fs.existsSync(code), `未找到 VS Code：${code}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8"));
    for (const dir of [home, path.join(home, ".sinitek_cli"), path.join(root, "user-data/User"), path.join(root, "extensions"), path.join(root, "workspace")]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({
      humanInteractionEnabled: false,
      autoCompactContextAfterRun: false,
      memoryAutoExtractAfterCompact: false,
      memoryAutoExtractAfterLoopTask: false,
      cliEnabledByName: Object.fromEntries(clis.map((cli) => [cli, false])),
    }));
    fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify({
      "window.title": "Sinitek isolated Loop+ protocol regression",
      "workbench.startupEditor": "none",
      "security.workspace.trust.enabled": false,
      "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false,
      "update.mode": "none",
      "telemetry.telemetryLevel": "off",
      "window.restoreWindows": "none",
      "sinitek-cli-tools.autoOpenPanel": false,
      "sinitek-cli-tools.humanInteractionNotifications": false,
      ...Object.fromEntries(clis.map((cli) => [`sinitek-cli-tools.commands.${cli}`, process.execPath])),
    }));
    const testEntry = path.join(root, "extension-test.js");
    fs.writeFileSync(testEntry, `"use strict";
const fs = require("fs");
const os = require("os");
const vscode = require("vscode");
exports.run = async () => {
  const resultPath = process.env.LOOP_PLUS_PROTOCOL_RESULT;
  const write = (value) => fs.writeFileSync(resultPath, JSON.stringify(value, null, 2));
  try {
    const id = process.env.LOOP_PLUS_PROTOCOL_EXTENSION_ID;
    const until = Date.now() + Number(process.env.LOOP_PLUS_PROTOCOL_ACTIVATION_BUDGET_MS || 60000);
    let extension;
    while (Date.now() < until) {
      extension = vscode.extensions.getExtension(id);
      if (extension && extension.isActive) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!extension || !extension.isActive) throw new Error("onStartupFinished did not activate the product");
    if (fs.realpathSync(extension.extensionPath) !== fs.realpathSync(process.env.LOOP_PLUS_PROTOCOL_PRODUCT)) {
      throw new Error("activated extension path is not the product under test");
    }
    if (fs.realpathSync(os.homedir()) !== fs.realpathSync(process.env.LOOP_PLUS_PROTOCOL_HOME)) {
      throw new Error("Extension Host HOME was not isolated");
    }
    const smoke = require(process.env.LOOP_PLUS_PROTOCOL_SMOKE);
    const scenarioResult = await smoke.runExtensionHostScenario();
    write({ ok: true, scenario: scenarioResult, vscode: vscode.version, extensionPath: extension.extensionPath });
  } catch (error) {
    write({ ok: false, error: error && error.stack ? error.stack : String(error) });
    throw error;
  }
};
`);
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, "AppData/Roaming"),
      LOCALAPPDATA: path.join(home, "AppData/Local"),
      CODEX_HOME: path.join(home, ".codex"),
      LOOP_PLUS_PROTOCOL_REGRESSION_INSIDE_HOST: "1",
      LOOP_PLUS_PROTOCOL_SMOKE: __filename,
      LOOP_PLUS_PROTOCOL_RESULT: path.join(root, "scenario-result.json"),
      LOOP_PLUS_PROTOCOL_EXTENSION_ID: `${manifest.publisher}.${manifest.name}`,
      LOOP_PLUS_PROTOCOL_ACTIVATION_BUDGET_MS: "60000",
      LOOP_PLUS_PROTOCOL_PRODUCT: product,
      LOOP_PLUS_PROTOCOL_HOME: home,
      LOOP_PLUS_PROTOCOL_REGRESSION_DIST: dist,
    });
    const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage",
      `--user-data-dir=${path.join(root, "user-data")}`, `--extensions-dir=${path.join(root, "extensions")}`,
      `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${testEntry}`, path.join(root, "workspace")];
    const output = fs.openSync(path.join(root, "vscode.log"), "w");
    child = cp.spawn(code, args, { env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", output, output] });
    fs.closeSync(output);
    child.once("exit", (exitCode, signal) => { exited = true; report.exit = { exitCode, signal }; });
    child.once("error", (error) => { exited = true; report.spawnError = error.message; });
    const deadline = Date.now() + scenario.timeoutMs;
    while (!exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    if (!exited) throw new Error(`timeout ${scenario.timeoutMs}ms`);
    const resultPath = path.join(root, "scenario-result.json");
    if (fs.existsSync(resultPath)) report.scenario = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (report.exit?.exitCode !== 0 || report.scenario?.ok !== true) {
      throw new Error(report.scenario?.error || JSON.stringify(report.exit || report.spawnError));
    }
    const elapsedMs = Date.now() - started;
    report.result = "pass";
    report.elapsedMs = elapsedMs;
    report.outcome = { id: scenario.id, lane: scenario.lane, result: "pass", elapsedMs, extensionHost: report.scenario };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    console.error(`[loop-plus-protocol-regression] FAIL scenario=${scenario.id} lane=${scenario.lane} timeoutMs=${scenario.timeoutMs} elapsedMs=${elapsedMs}`);
    console.error(`[loop-plus-protocol-regression] failureCriterion=${scenario.failure}`);
    console.error(error && error.stack ? error.stack : String(error));
    if (fs.existsSync(path.join(root, "vscode.log"))) {
      console.error(fs.readFileSync(path.join(root, "vscode.log"), "utf8").slice(-4000));
    }
    report.result = "fail";
    report.elapsedMs = elapsedMs;
    report.error = error && error.stack ? error.stack : String(error);
    report.outcome = { id: scenario.id, lane: scenario.lane, result: "fail", elapsedMs, error: report.error };
  } finally {
    if (child?.pid) {
      try {
        let remaining = exited ? processesFor(token, child.pid) : [`pid ${child.pid}`];
        if (!exited || remaining.length) {
          forced = true;
          if (process.platform === "win32") cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
          else {
            try { process.kill(-child.pid, "SIGTERM"); } catch { /* 进程组可能已经退出。 */ }
          }
          for (let index = 0; index < 50 && processesFor(token, child.pid).length; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (process.platform !== "win32" && processesFor(token, child.pid).length) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { /* 只作用于本次进程组。 */ }
          }
        }
        report.remaining = processesFor(token, child.pid);
      } catch (error) {
        report.cleanupError = String(error);
      }
    }
    report.forcedCleanup = forced;
    if (report.remaining?.length) {
      report.result = "fail";
      report.outcome = {
        id: scenario.id,
        lane: scenario.lane,
        result: "fail",
        elapsedMs: report.elapsedMs ?? Date.now() - started,
        error: `本次创建的进程仍在运行：${report.remaining.join(" | ")}`,
      };
      console.error(`[loop-plus-protocol-regression] FAIL scenario=${scenario.id} lane=${scenario.lane} timeoutMs=${scenario.timeoutMs} remaining=${report.remaining.length}`);
    } else if (report.result === "pass") {
      console.log(`[loop-plus-protocol-regression] PASS scenario=${scenario.id} lane=${scenario.lane} elapsedMs=${report.elapsedMs}`);
    }
    const evidence = path.join(product, ".tmp/loop-plus-protocol-regression");
    fs.mkdirSync(evidence, { recursive: true });
    if (!report.remaining?.length) {
      fs.rmSync(root, { recursive: true, force: true });
      report.rootRemoved = !fs.existsSync(root);
    } else {
      report.rootRemoved = false;
    }
    fs.writeFileSync(path.join(evidence, "extension-host-last.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report.outcome;
}

async function runExtensionHostScenario() {
  const session = createSession();
  try {
    await successBaseline(session);
    return {
      id: "success-baseline-extension-host",
      lane: "extension-host",
      result: "pass",
      tabCloseAttempts: session.fixture.closeSubtaskTabAttempts.length,
      closedTabs: session.fixture.closedSubtaskTabs.length,
      tabCloseOwnedBy: "lp495",
    };
  } finally {
    await settle(session);
  }
}

function parseArgs(argv) {
  const options = { list: false, fixtureOnly: false, extensionHostOnly: false, includeExtensionHost: process.platform === "darwin", ids: new Set() };
  for (const arg of argv) {
    if (arg === "--list") options.list = true;
    else if (arg === "--fixture-only") options.fixtureOnly = true;
    else if (arg === "--extension-host-only") options.extensionHostOnly = true;
    else if (arg === "--extension-host") options.includeExtensionHost = true;
    else if (arg.startsWith("--scenario=")) options.ids.add(arg.slice("--scenario=".length));
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    printCatalog();
    return;
  }
  const chosen = selectedScenarios(options);
  if (chosen.length === 0) throw new Error("没有选中的场景。");
  const results = [];
  for (const scenario of chosen) {
    if (scenario.lane === "extension-host") results.push(await launchExtensionHost(scenario));
    else {
      const result = await runFixtureScenario(scenario);
      results.push(result);
    }
  }
  const failed = results.filter((result) => result.result !== "pass").map((result) => result.id);
  const summary = {
    ok: failed.length === 0,
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    dist,
    failed,
    results: results.map(({ id, lane, result, elapsedMs }) => ({ id, lane, result, elapsedMs })),
    tabCloseOwnedBy: "lp495 round-495-loopplus-noaccept-tab-identity-20261127",
    finalCandidateHostVerification: "separately assigned",
  };
  const evidence = path.join(product, ".tmp/loop-plus-protocol-regression");
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, "latest-report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[loop-plus-protocol-regression] SUMMARY ${JSON.stringify(summary)}`);
  if (!summary.ok) process.exitCode = 1;
}

module.exports = { SCENARIOS, runExtensionHostScenario };

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
