"use strict";

const assert = require("node:assert/strict");
const { createDepartmentFullEhScenario, latestUserText } = require("./department_full_eh_scenario");

const roles = Object.freeze({ director: "opencode", leader: "opencode", employee: "opencode" });
const checks = ["dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions"]
  .map((name) => ({ name, passed: true, detail: "连续停止续接本机文本协议，不代表真实模型审查" }));

// Loop+ projects a public stopped attempt as blocked with its stopped detail;
// the exact attempt/event checks remain separate and mandatory.
function isStoppedTaskRecord(record) {
  return !!record && (["stopped", "failed"].includes(record.status)
    || record.status === "blocked" && record.summary === "stopped");
}

function createDepartmentSuccessiveContinuationEhScenario(options) {
  assert.equal(options.roles?.director, roles.director, "successive continuation requires an OpenCode director");
  assert.equal(options.roles?.leader, roles.leader, "successive continuation requires an OpenCode leader");
  assert.equal(options.roles?.employee, roles.employee, "successive continuation requires an OpenCode employee");
  const prompt = options.prompt;
  assert.equal(typeof prompt, "string");
  assert.ok(prompt.trim());
  const continuationPrompts = [1, 2].map((round) => `${prompt}\n公开连续续接第 ${round} 次：保持原组织、组长、根验收方案和原生会话，按当前被停止员工的精确任务来源继续 isolated protocol 文本转换；不得重放已停止执行。`);
  const base = createDepartmentFullEhScenario({ ...options, roles, continuationPrompt: undefined, continuationPrompts });
  const rounds = [1, 2].map((number) => ({ number, held: null, released: false, stopped: null, pendingEvent: null,
    stoppedReview: null, continuePrompt: null, continueSubmitted: false, nextSubtaskId: null, noRevival: null }));
  const employeeAttempts = new Set();
  const employeeSubtasks = new Set();
  const seenEvents = new Set();
  const pendingLatches = new Map();
  const heldWaiters = new Map();
  const reviewWaiters = new Map();
  let continueCount = 0;
  let acceptedFinalEvent = null;
  let leaderReport = false;
  let heldIndex = 0;
  let successiveLeaderId = null;
  let firstEmployeeSubtaskId = null;

  const eventFields = (text) => {
    const eventId = text.match(/^Current review eventId: (\S+)/m)?.[1];
    const batchCount = Number(text.match(/^Acceptance batch count: (\d+)/m)?.[1]);
    const observed = text.match(/^- current eventId=(\S+) subtask=(\S+) attempt=(\S+) outcome=(\S+) detail=([\s\S]*?)\nAcceptance batch count:/m);
    const batchSection = text.split(/^Acceptance batch, oldest first\. Confirm this whole list in this decision:\s*$/m)[1]?.split(/^FIFO review queue count:/m)[0] ?? "";
    const batch = [...batchSection.matchAll(/^\d+\. (\S+)$/gm)].map((match) => match[1]);
    return { eventId, batchCount, batch, observed };
  };
  const leaderTask = (id) => {
    const value = options.readTasks().find((task) => task.id === id);
    assert.ok(value && value.department?.role === "leader", "successive event does not target a persisted leader");
    assert.equal(value.department.rootTaskId, base.snapshot().rootId, "successive event changed the root identity");
    return value;
  };
  const publish = (context, stage, identity, answer) => {
    base.history.push({ index: context.index, stage, identity, answer });
    context.request.stage = stage;
    return JSON.stringify(answer);
  };
  const releaseLatch = (round) => {
    const latch = pendingLatches.get(round);
    if (!latch) return false;
    clearTimeout(latch.timer);
    pendingLatches.delete(round);
    latch.resolve("Input: isolated protocol\nOutput: ISOLATED PROTOCOL\nDeterministic local protocol fixture; no code changes, external model, or independent review claimed.");
    rounds[round - 1].released = true;
    return true;
  };
  function waitFor(map, round, getter, label) {
    const current = getter(round);
    if (current) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { map.delete(round); reject(new Error(`${label} ${round} timed out`)); }, options.holdTimeoutMs ?? 45000);
      map.set(round, {
        resolve: value => { clearTimeout(timer); map.delete(round); resolve(value); },
        reject: error => { clearTimeout(timer); map.delete(round); reject(error); },
      });
    });
  }
  function notify(map, round, value) {
    const waiter = map.get(round);
    if (waiter) waiter.resolve(value);
  }

  async function respond(body, context) {
    assert.ok(context.index <= (options.maxRequests ?? 32), "successive continuation request budget exceeded");
    const text = latestUserText(body);
    context.request.prompt = text;
    if (text.includes("You are one independent Loop+ execution attempt.")) {
      const answer = await base.respond(body, context);
      const identity = base.snapshot().employees.at(-1);
      assert.ok(identity, "employee execution has no persisted report identity");
      if (successiveLeaderId && identity.leaderTaskId !== successiveLeaderId) return answer;
      const leader = leaderTask(identity.leaderTaskId);
      const subtask = leader.subTasks.find((value) => value.id === identity.subtaskId && value.communicationFile === identity.reportFile);
      assert.ok(subtask, "employee report does not map to a current leader subtask");
      const active = leader.loopPlus?.running?.filter((attempt) => attempt.subtaskId === identity.subtaskId);
      assert.equal(active?.length, 1, "employee attempt is not uniquely active");
      assert.equal(active[0].attemptId, identity.attemptId, "employee attempt changed during request adoption");
      const expectedRound = heldIndex < 2 ? heldIndex + 1 : 3;
      assert.equal(employeeAttempts.has(JSON.stringify([identity.leaderTaskId, identity.subtaskId, identity.attemptId])), false, "duplicate employee request");
      assert.equal(employeeSubtasks.has(JSON.stringify([identity.leaderTaskId, identity.subtaskId])), false, "employee subtask was retried or dispatched twice");
      if (expectedRound === 1) {
        assert.ok(firstEmployeeSubtaskId, "initial leader dispatch was not observed by this scenario");
        assert.equal(identity.subtaskId, firstEmployeeSubtaskId, "first employee request is not the one actual initial dispatch");
        assert.equal(subtask.continueFromSubtaskId, undefined, "first employee unexpectedly reuses a continuation source");
      } else {
        const source = rounds[expectedRound - 2];
        assert.equal(source.continueSubmitted, true, "successor employee ran before public continue");
        assert.equal(identity.subtaskId, source.nextSubtaskId, "employee request is not the exact successor dispatched for this stop");
        assert.equal(subtask.continueFromSubtaskId, source.held.subtaskId, "successor did not name the exact immediately preceding stopped source");
        const sourceRecord = leader.subTasks.find((value) => value.id === source.held.subtaskId);
        assert.ok(isStoppedTaskRecord(sourceRecord), "continuation source was not durably stopped/failed");
      }
      employeeAttempts.add(JSON.stringify([identity.leaderTaskId, identity.subtaskId, identity.attemptId]));
      employeeSubtasks.add(JSON.stringify([identity.leaderTaskId, identity.subtaskId]));
      if (expectedRound === 3) {
        assert.equal(continueCount, 2, "final employee ran before two public continue actions");
        return answer;
      }
      heldIndex++;
      const round = rounds[expectedRound - 1];
      assert.equal(round.held, null, "round already owns a held employee");
      round.held = structuredClone(identity);
      notify(heldWaiters, expectedRound, round.held);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingLatches.delete(expectedRound);
          reject(new Error(`employee response latch ${expectedRound} was not released by public stop`));
        }, options.holdTimeoutMs ?? 45000);
        pendingLatches.set(expectedRound, { resolve: (value) => { clearTimeout(timer); resolve(value); }, timer });
      });
      return "Input: isolated protocol\nOutput: ISOLATED PROTOCOL\nDeterministic local protocol fixture; no code changes, external model, or independent review claimed.";
    }

    if (text.includes("You are the Loop+ main reviewer.")) {
      const leaderId = text.match(/^Parent task: (\S+)/m)?.[1];
      const leader = leaderTask(leaderId);
      if (successiveLeaderId === null) successiveLeaderId = leaderId;
      if (leaderId !== successiveLeaderId) return base.respond(body, context);
      const { eventId, batchCount, batch, observed } = eventFields(text);
      if (eventId && eventId !== "(none)") {
        assert.equal(seenEvents.has(eventId), false, "duplicate successive event acceptance");
        assert.ok(observed && observed[1] === eventId, "review event identity is malformed");
        assert.equal(batchCount, batch.length, "acceptance batch count differs from the production prompt list");
        assert.equal(batch.length, 1, "successive continuation expects exactly one persisted event in the batch");
        assert.equal(batch[0], eventId, "current event is not the exact first event in the acceptance batch");
        const current = leader.loopPlus?.currentReview;
        assert.ok(current && current.eventId === eventId && current.subtaskId === observed[2]
          && current.attemptId === observed[3] && current.outcome === observed[4]
          && current.detail === observed[5], "review event differs from persisted current attempt or detail");
        const seen = leader.loopPlus?.seenAttempts?.filter((attempt) => attempt.subtaskId === current.subtaskId
          && attempt.attemptId === current.attemptId);
        assert.equal(seen?.length, 1, "review event is not backed by one persisted attempt");
        assert.equal(seen[0].outcome, current.outcome, "review outcome differs from persisted attempt outcome");
        if (current.outcome === "stopped") {
          const round = rounds.find((value) => value.held?.subtaskId === current.subtaskId && value.held?.attemptId === current.attemptId);
          assert.ok(round, "stopped event is not one of the two held original attempts");
          assert.equal(round.continueSubmitted, true, "stopped event was reviewed before its public continuation");
          assert.equal(round.stoppedReview, null, "stopped event was already accepted");
          assert.equal(continueCount, round.number, "stopped source arrived outside its public continuation generation");
          assert.deepEqual(round.pendingEvent, { eventId, subtaskId: current.subtaskId, attemptId: current.attemptId,
            outcome: current.outcome, detail: current.detail }, "post-continue event changed from the pre-continue persisted event");
          const record = leader.subTasks.find((value) => value.id === current.subtaskId);
          assert.ok(isStoppedTaskRecord(record), "stopped event source is not durably stopped");
          const nextSubtaskId = `text-protocol-continued-${round.number}`;
          const next = { id: nextSubtaskId, title: "继续停止后的文本答复", taskType: "backend", writeFiles: [],
            continueFromSubtaskId: current.subtaskId,
            prompt: `${continuationPrompts[round.number - 1]}\n只将 isolated protocol 转为 ISOLATED PROTOCOL，报告输入、输出和本机协议范围；不改文件、不访问外网、不修改任务或调度状态。` };
          round.nextSubtaskId = nextSubtaskId;
          round.stoppedReview = { eventId, subtaskId: current.subtaskId, attemptId: current.attemptId,
            outcome: current.outcome, acceptance: "failed", subtaskIds: [nextSubtaskId] };
          seenEvents.add(eventId);
          notify(reviewWaiters, round.number, round.stoppedReview);
          return publish(context, "successive-review-stopped", leaderId, { status: "accept", reviewEventId: eventId,
            reviews: [{ reviewEventId: eventId, acceptance: "failed", reason: "公开停止保留为失败历史，显式派发直接后继 attempt", subtaskIds: [nextSubtaskId] }],
            progressPercent: 10, acceptance: { passed: false, checks: checks.map((check) => check.name === "omissions and regressions"
              ? { ...check, passed: false, detail: "员工执行由公开停止中断，需用户显式续接" } : check) }, subtasks: [next] });
        }
        assert.equal(current.outcome, "completed", "unknown successive event outcome");
        assert.equal(continueCount, 2, "completed event arrived before both public continuations");
        const employee = base.snapshot().employees.find((value) => value.leaderTaskId === leaderId
          && value.subtaskId === current.subtaskId && value.attemptId === current.attemptId);
        assert.ok(employee && current.subtaskId === rounds[1].nextSubtaskId, "final completed event has no real C employee request");
        assert.equal(acceptedFinalEvent, null, "duplicate final event acceptance");
        acceptedFinalEvent = eventId;
        seenEvents.add(eventId);
        return publish(context, "successive-final-accept", leaderId, { status: "accept", reviewEventId: eventId,
          reviews: [{ reviewEventId: eventId, acceptance: "passed", reason: "C 的真实运行事件完成并匹配持久 attempt" }],
          progressPercent: 90, acceptance: { passed: true, checks } });
      }
      if (text.includes("Snapshot says completion is allowed: yes") && acceptedFinalEvent) {
        assert.ok(acceptedFinalEvent, "leader closeout lacks C event acceptance");
        assert.equal(leader.subTasks.length, 3, "successive leader task set is not A, B and C");
        assert.equal(leader.subTasks.find((value) => value.id === rounds[1].nextSubtaskId)?.status, "completed", "C is not durably completed");
        assert.ok(rounds.every((round) => round.stoppedReview?.acceptance === "failed"), "historical stopped events were not preserved as failed");
        leaderReport = true;
        return publish(context, "successive-leader-report", leaderId, { status: "completed", progressPercent: 100,
          answerConclusion: "ISOLATED PROTOCOL", finalSummary: "A、B 的公开停止保留为失败历史；C 经真实事件验收后完成。",
          acceptance: { passed: true, checks }, requirementCoverage: [{ name: "两次公开停止续接后的文本转换", passed: true }] });
      }
      if (Number(text.match(/^Still running count: (\d+)/m)?.[1]) > 0) return publish(context, "successive-leader-wait", leaderId, { status: "wait" });
      if (!eventId || eventId === "(none)") {
        const answer = await base.respond(body, context);
        if (firstEmployeeSubtaskId === null) {
          const value = JSON.parse(answer);
          assert.equal(value.status, "dispatch", "initial leader response did not dispatch the first employee");
          assert.equal(value.subtasks?.length, 1, "initial leader must dispatch exactly one first employee");
          firstEmployeeSubtaskId = value.subtasks[0].id;
        }
        return answer;
      }
      return base.respond(body, context);
    }
    return base.respond(body, context);
  }

  const snapshot = () => ({ ...base.snapshot(), continuation: { rounds: structuredClone(rounds), continueCount,
    acceptedFinalEvent, leaderReport, heldEmployeeCount: heldIndex, prompt: continuationPrompts } });
  return {
    respond,
    respondChat: (body, context) => base.respondChat(body, context, respond),
    history: base.history,
    snapshot,
    waitForHeldEmployee: (round) => {
      assert.ok(Number.isInteger(round) && round >= 1 && round <= 2, "unknown held employee round");
      return waitFor(heldWaiters, round, (index) => rounds[index - 1].held, "held employee");
    },
    waitForStoppedReview: (round) => {
      assert.ok(Number.isInteger(round) && round >= 1 && round <= 2, "unknown stopped event round");
      return waitFor(reviewWaiters, round, (index) => rounds[index - 1].stoppedReview, "stopped event review");
    },
    releaseEmployee(round) { return releaseLatch(round); },
    releaseAll() {
      for (const round of [1, 2]) releaseLatch(round);
      for (const map of [heldWaiters, reviewWaiters]) for (const waiter of [...map.values()]) waiter.reject(new Error("scenario released"));
    },
    beginContinue(evidence, round, persistedEvent) {
      assert.ok(Number.isInteger(round) && round >= 1 && round <= 2, "unknown public continuation round");
      const state = rounds[round - 1];
      assert.equal(round, continueCount + 1, "duplicate or out-of-order public continue");
      assert.ok(!state.continuePrompt, "duplicate or out-of-order public continue");
      assert.ok(state.held && state.released && !state.stoppedReview,
        "continue requires a stopped execution with no prior continuation");
      assert.equal(evidence.complete, true, "continue lacks original Owner cleanup and capacity proof");
      assert.equal(evidence.rootId, base.snapshot().rootId, "cleanup belongs to another root");
      assert.ok(evidence.saved.runtime.leaders.some((leader) => leader.taskId === state.held.leaderTaskId && leader.status === "paused"), "original leader is not cleanly paused");
      assert.ok(persistedEvent && typeof persistedEvent.eventId === "string" && persistedEvent.subtaskId === state.held.subtaskId
        && persistedEvent.attemptId === state.held.attemptId && persistedEvent.outcome === "stopped"
        && typeof persistedEvent.detail === "string", "continue requires the exact durable stopped event before review");
      const snapshot = options.readTasks().find((task) => task.id === state.held.leaderTaskId)?.loopPlus;
      const queueMatches = (snapshot?.reviewQueue ?? []).filter((item) => item.eventId === persistedEvent.eventId
        && item.subtaskId === persistedEvent.subtaskId && item.attemptId === persistedEvent.attemptId
        && item.outcome === "stopped" && item.detail === persistedEvent.detail);
      assert.equal(queueMatches.length, 1, "continue event is not the unique persisted pending review");
      const attempts = (snapshot?.seenAttempts ?? []).filter((item) => item.subtaskId === persistedEvent.subtaskId
        && item.attemptId === persistedEvent.attemptId);
      assert.equal(attempts.length, 1, "continue event has no unique persisted attempt");
      assert.equal(attempts[0].outcome, "stopped", "continue event attempt is not durably stopped");
      assert.equal(attempts[0].disposition, "finished", "continue event attempt is not awaiting review");
      state.stopped = structuredClone(evidence);
      state.pendingEvent = structuredClone(persistedEvent);
      state.continuePrompt = continuationPrompts[round - 1];
      return continuationPrompts[round - 1];
    },
    confirmContinue(round) {
      assert.ok(Number.isInteger(round) && round >= 1 && round <= 2, "unknown public continuation round");
      const state = rounds[round - 1];
      assert.equal(round, continueCount + 1, "duplicate or out-of-order public continue confirmation");
      assert.ok(state.continuePrompt && !state.continueSubmitted, "no validated public continue is awaiting submission");
      state.continueSubmitted = true;
      continueCount++;
    },
  };
}

module.exports = { createDepartmentSuccessiveContinuationEhScenario, isStoppedTaskRecord };
