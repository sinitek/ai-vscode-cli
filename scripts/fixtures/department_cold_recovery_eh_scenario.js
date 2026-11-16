"use strict";
const assert = require("node:assert/strict");
const { createDepartmentFullEhScenario, latestUserText } = require("./department_full_eh_scenario");

/** Provider latches only. Task, capacity, receipts and authority state are always
 * produced by the installed extension and its original independent runtimes. */
function createDepartmentColdRecoveryEhScenario(options) {
  const continuationPrompt = `${options.prompt}\n明确继续原组织及原生会话；本轮只验证冷恢复后继真实执行，等待用户公开停止，不新增模块。`;
  const base = createDepartmentFullEhScenario({ ...options, continuationPrompt, holdEmployee: false });
  let continuing = false, successor = null, releaseSuccessor;
  async function respond(body, context) {
    const text = latestUserText(body);
    if (continuing && text.includes("You are the Loop+ main reviewer.")) {
      assert.equal(successor, null, "cold successor dispatched more than once");
      const leaderId = text.match(/^Parent task: (\S+)/m)?.[1];
      assert.equal(leaderId, base.snapshot().employees[0].leaderTaskId);
      const leader = options.readTasks().find(t => t.id === leaderId);
      assert.equal(leader?.department?.rootTaskId, base.snapshot().rootId);
      successor = { leaderTaskId: leaderId, localSessionId: leader.sessionId, executionSession: structuredClone(leader.executionSession) };
      context.request.stage = "cold-successor-real-request";
      base.history.push({ index: context.index, stage: context.request.stage, identity: successor });
      await new Promise(resolve => { releaseSuccessor = resolve; });
      return JSON.stringify({ status: "wait" });
    }
    if (!continuing && text.includes("You are the Loop+ main reviewer.") && text.includes("Snapshot says completion is allowed: yes")
      && base.history.some(e => e.stage === "leader-accept")) {
      const leaderId = text.match(/^Parent task: (\S+)/m)?.[1];
      assert.equal(leaderId, base.snapshot().employees[0].leaderTaskId);
      context.request.stage = "cold-original-await-control";
      base.history.push({ index: context.index, stage: context.request.stage, identity: leaderId });
      return JSON.stringify({ status: "blocked", finalSummary: "原员工已实际验收；保留组织等待用户显式冷停止及继续。" });
    }
    return base.respond(body, context);
  }
  return { respond, respondChat: (body, context) => base.respondChat(body, context, respond), history: base.history,
    snapshot: () => ({ ...base.snapshot(), coldRecovery: { continuing, successor } }),
    beginContinue(evidence) {
      assert.equal(continuing, false, "duplicate cold continue");
      assert.equal(evidence.complete, true, "cold continue lacks original complete cleanup and durable capacity removal");
      assert.equal(evidence.rootId, base.snapshot().rootId);
      continuing = true; return continuationPrompt;
    },
    releaseEmployee: base.releaseHeldEmployee,
    releaseAll() { base.releaseHeldEmployee(); releaseSuccessor?.(); releaseSuccessor = undefined; },
  };
}
module.exports = { createDepartmentColdRecoveryEhScenario };

// Uses the shared public adapter (including its exact-root/visibility guards).
async function clickColdPublicControl(adapter, selector, deadline, now = Date.now) {
  const remaining = deadline - now();
  assert.ok(remaining > 0, "cold public control absolute deadline exhausted");
  const control = adapter.locator(selector);
  await control.waitFor({ state: "visible", timeout: remaining });
  assert.ok(deadline > now(), "cold public control absolute deadline exhausted");
  await control.click();
}
function assertColdSuccessorNotRejected(tasks, runtime, originalGeneration) {
  const failed = runtime.runtime.leaders.find(m => m.generation > originalGeneration && m.status === "blocked");
  const task = failed && tasks.find(t => t.id === failed.taskId);
  if (task?.mainAiLastFailureMessage) throw new Error(`cold successor production rejection: ${task.mainAiLastFailureMessage}`);
}
module.exports.clickColdPublicControl = clickColdPublicControl;
module.exports.assertColdSuccessorNotRejected = assertColdSuccessorNotRejected;
