"use strict";
const assert = require("node:assert/strict");
const { createDepartmentFullEhScenario, latestUserText } = require("./department_full_eh_scenario");

// Reuse the new-root protocol. Only the interrupted event and its explicitly
// authorized successor differ; this latch never writes a task or grants a run.
function createDepartmentContinuationEhScenario(options) {
  const continuationPrompt = `${options.prompt}\n明确继续原组织、原组长与原生会话，完成中断的文本转换，并按真实事件验收和汇报。`;
  const base = createDepartmentFullEhScenario({ ...options, continuationPrompt });
  let release, timer, held, stopped, continuing = false, repaired = false, accepted = false;
  const continuationHistory = [];
  const checks = ["dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions"]
    .map((name) => ({ name, passed: true, detail: "本机停止续接协议，不代表真实模型审查" }));
  const snapshot = () => ({ ...base.snapshot(), continuation: { held, stopped, continuing, repaired, accepted,
    prompt: continuationPrompt, history: continuationHistory } });
  const record = (context, stage, identity, answer) => {
    base.history.push({ index: context.index, stage, identity, answer });
    continuationHistory.push({ index: context.index, stage, identity });
    context.request.stage = stage;
    return JSON.stringify(answer);
  };
  async function respond(body, context) {
    assert.ok(context.index <= (options.maxRequests ?? 32), "continuation request budget exceeded");
    const text = latestUserText(body);
    context.request.prompt = text;
    if (continuing && text.includes("You are the Loop+ main reviewer.")) {
      const id = text.match(/^Parent task: (\S+)/m)?.[1];
      if (id === held.leaderTaskId) {
        const leader = options.readTasks().find((task) => task.id === id);
        assert.ok(leader && leader.department.rootTaskId === base.snapshot().rootId && leader.schedulingMode === "event_driven", "resumed leader identity changed");
        const event = text.match(/^Current review eventId: (\S+)/m)?.[1];
        if (event && event !== "(none)") {
          const current = leader.loopPlus?.currentReview;
          const observed = text.match(/^- current eventId=(\S+) subtask=(\S+) attempt=(\S+) outcome=(\S+)/m);
          assert.equal(Number(text.match(/^Acceptance batch count: (\d+)/m)?.[1]), 1);
          assert.ok(current && observed && current.eventId === event && observed[1] === event
            && observed[2] === current.subtaskId && observed[3] === current.attemptId && observed[4] === current.outcome, "resumed event differs from persisted attempt");
          if (current.outcome === "stopped") {
            assert.equal(repaired, false, "duplicate interrupted event");
            assert.equal(current.subtaskId, held.subtaskId); assert.equal(current.attemptId, held.attemptId);
            repaired = true;
            const next = { id: "text-protocol-continued", title: "完成停止后的文本答复", taskType: "backend", writeFiles: [],
              continueFromSubtaskId: held.subtaskId,
              prompt: `${continuationPrompt}\n修复检查 omissions and regressions：前次被用户停止，未完成答复。仅将 isolated protocol 转为 ISOLATED PROTOCOL，报告输入、输出和本机协议范围，不改文件、不访问外网、不修改任务或调度状态。` };
            return record(context, "leader-review-stopped", id, { status: "accept", reviewEventId: event,
              reviews: [{ reviewEventId: event, acceptance: "failed", reason: "原员工被公开停止，需显式续接完成", subtaskIds: [next.id] }],
              progressPercent: 10, acceptance: { passed: false, checks: checks.map((check) => check.name === "omissions and regressions" ? { ...check, passed: false, detail: "用户停止导致答复未完成" } : check) }, subtasks: [next] });
          }
          assert.equal(current.outcome, "completed", "unknown resumed outcome");
          assert.equal(repaired, true, "completed successor without interrupted-event review");
          const employees = base.snapshot().employees;
          assert.ok(employees.some((employee) => employee.leaderTaskId === id && employee.subtaskId === current.subtaskId && employee.attemptId === current.attemptId), "successor event has no real employee request");
          assert.equal(accepted, false, "duplicate successor acceptance"); accepted = true;
          return record(context, "leader-accept", id, { status: "accept", reviewEventId: event,
            reviews: [{ reviewEventId: event, acceptance: "passed", reason: "续接员工已完成确定性文本答复" }], progressPercent: 90, acceptance: { passed: true, checks } });
        }
        if (text.includes("Snapshot says completion is allowed: yes")) {
          assert.equal(accepted, true, "resumed closeout lacks successor event acceptance");
          const successorId = options.ordinaryContinuation ? held.subtaskId : "text-protocol-continued";
          assert.equal(leader.subTasks.length, options.ordinaryContinuation ? 1 : 2, "unexpected resumed work");
          assert.equal(leader.subTasks.find((subtask) => subtask.id === successorId)?.status, "completed");
          assert.ok(leader.loopPlus.seenAttempts.some(attempt => attempt.subtaskId === held.subtaskId
            && attempt.attemptId === held.attemptId && attempt.outcome === "stopped" && attempt.acceptance === "failed"), "original attempt was not retained");
          return record(context, "leader-report", id, { status: "completed", progressPercent: 100,
            answerConclusion: "ISOLATED PROTOCOL", finalSummary: "公开停止后原组织续接并完成事件验收。",
            acceptance: { passed: true, checks }, requirementCoverage: [{ name: "停止后明确续接文本转换", passed: true }] });
        }
        if (Number(text.match(/^Still running count: (\d+)/m)?.[1]) > 0) return record(context, "leader-wait", id, { status: "wait" });
        throw new Error("unknown resumed leader stage");
      }
    }
    const answer = await base.respond(body, context);
    if (!held && base.history.at(-1)?.stage === "employee-result") {
      held = structuredClone(base.history.at(-1).identity);
      await new Promise((resolve, reject) => {
        release = resolve;
        timer = setTimeout(() => { release = undefined; reject(new Error("public stop did not release the bounded employee response latch")); }, options.holdTimeoutMs ?? 45000);
      });
    }
    return answer;
  }
  return { respond, respondChat: (body, context) => base.respondChat(body, context, respond), history: base.history, snapshot,
    releaseEmployee() { clearTimeout(timer); release?.(); release = undefined; },
    beginContinue(evidence) {
      assert.ok(held && !continuing, "continue requires exactly one held original execution");
      assert.equal(evidence.complete, true, "continue lacks original cleanup/capacity proof");
      assert.equal(evidence.rootId, base.snapshot().rootId, "cleanup belongs to another root");
      assert.ok(evidence.saved.runtime.leaders.some((leader) => leader.taskId === held.leaderTaskId && leader.status === "paused"), "original leader is not cleanly paused");
      stopped = structuredClone(evidence); continuing = true;
      return continuationPrompt;
    },
  };
}
module.exports = { createDepartmentContinuationEhScenario };
