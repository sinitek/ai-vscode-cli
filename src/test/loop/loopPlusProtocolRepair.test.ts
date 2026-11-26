import test = require("node:test");
import assert = require("node:assert/strict");
import { buildLoopPlusProtocolContinuationPrompt, buildLoopPlusProtocolPauseSummary, readLoopPlusProtocolFailureFromSummary, readLoopPlusProtocolRecoveryFromSummary } from "../../loopPlusProtocolRepair";
import { loopPlusProtocolBranchDiagnostic, loopPlusProtocolDiagnosticHint, loopPlusProtocolParseDiagnostic } from "../../loopPlusProtocolDiagnostics";
import { parseLoopPlusDecisionWithFeedback } from "../../loopPlusDecision";

test("continuation uses bounded controlled diagnostics and the latest snapshot", () => {
  const diagnostic = loopPlusProtocolBranchDiagnostic("state.review_batch_open.dispatch_forbidden");
  const prompt = buildLoopPlusProtocolContinuationPrompt("untrusted raw response", { diagnostic, hint: loopPlusProtocolDiagnosticHint(diagnostic) });
  assert.match(prompt, /Loop\+ 继续执行/);
  assert.match(prompt, /拒绝类别：state/);
  assert.match(prompt, /state.review_batch_open.dispatch_forbidden/);
  assert.match(prompt, /不能 dispatch/);
  assert.doesNotMatch(prompt, /untrusted raw response/);
  assert.match(prompt, /依据上方当前调度快照继续同一任务/);
  assert.match(prompt, /返回一个完整的决策 JSON 对象/);
  assert.match(prompt, /复用已有验收和执行证据/);
});

test("classifies format, typed field validation and host-state rejection without exposing raw data", () => {
  const format = parseLoopPlusDecisionWithFeedback("{ broken secret");
  const formatDiagnostic = loopPlusProtocolParseDiagnostic(format);
  assert.equal(formatDiagnostic.rejectionKind, "format");
  assert.match(formatDiagnostic.reasonCode, /^format\./);

  const field = parseLoopPlusDecisionWithFeedback(JSON.stringify({ status: "dispatch", subtasks: [{ id: "private-id", title: "private title", prompt: "private prompt", dependsOn: "private path" }] }));
  const fieldDiagnostic = loopPlusProtocolParseDiagnostic(field);
  assert.equal(fieldDiagnostic.rejectionKind, "validation");
  assert.equal(fieldDiagnostic.reasonCode, "validation.subtasks.InvalidSubtaskDependencies");
  assert.equal(fieldDiagnostic.fieldPath, "dispatch.subtasks[0].dependsOn");

  const host = loopPlusProtocolBranchDiagnostic("state.report_batch.mismatch");
  assert.equal(host.rejectionKind, "state");
  assert.equal(host.reasonCode, "state.report_batch.mismatch");
});

test("failed accept repair diagnostic handles each review and preserves independent-work linkage", () => {
  const parsed = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "accept",
    reviewEventIds: ["review-1", "review-2"],
    reviews: [
      { reviewEventId: "review-1", acceptance: "failed" },
      { reviewEventId: "review-2", acceptance: "failed" },
    ],
  }));
  const diagnostic = loopPlusProtocolParseDiagnostic(parsed);
  assert.equal(diagnostic.reasonCode, "validation.accept.failed_repair_missing");
  const hint = loopPlusProtocolDiagnosticHint(diagnostic);
  assert.match(hint, /每个实际失败的 reviews\[i\]/);
  assert.doesNotMatch(hint, /reviews\[0\]/);
  assert.match(hint, /快照中的原逻辑 ID/);
  assert.match(hint, /恰好派发一项同 ID 返工/);
  assert.match(hint, /noRepairReason/);
  assert.match(hint, /独立的剩余目标工作使用 independentSubtaskIds/);
  assert.doesNotMatch(hint, /review-event|private/);
});

test("task type recovery only recommends legal task types", () => {
  const invalidType = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "dispatch",
    subtasks: [{ title: "分析", prompt: "分析实现方案", taskType: "coding" }],
  }));
  const invalidTypeHint = loopPlusProtocolDiagnosticHint(loopPlusProtocolParseDiagnostic(invalidType));
  assert.match(invalidTypeHint, /backend、frontend 或 general/);
  assert.doesNotMatch(invalidTypeHint, /coding/);

  const conflictingGeneral = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "dispatch",
    subtasks: [{ title: "分析", prompt: "只读分析", taskType: "general", writeFiles: ["src/file.ts"] }],
  }));
  const conflictHint = loopPlusProtocolDiagnosticHint(loopPlusProtocolParseDiagnostic(conflictingGeneral));
  assert.match(conflictHint, /backend 或 frontend/);
  assert.doesNotMatch(conflictHint, /coding/);
});

test("unlinked accept diagnostic distinguishes event work from independent remaining work", () => {
  const diagnostic = loopPlusProtocolBranchDiagnostic("validation.accept.unlinked_subtasks");
  const hint = loopPlusProtocolDiagnosticHint(diagnostic);
  assert.match(hint, /reviews\[i\]\.subtaskIds/);
  assert.match(hint, /independentSubtaskIds/);
  assert.match(hint, /不得把独立工作挂到失败项/);
});

test("accept keeps independent remaining work separate from failed-review repair ownership", () => {
  const independentSubtask = { id: "independent", title: "独立目标", prompt: "推进无关剩余目标", taskType: "general" };
  const accepted = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "accept",
    reviewEventId: "review",
    reviews: [{ reviewEventId: "review", acceptance: "failed", noRepairReason: "该项无需返工" }],
    subtasks: [independentSubtask],
    independentSubtaskIds: ["independent"],
  }));
  assert.deepEqual(accepted.decision?.independentSubtaskIds, ["independent"]);

  const unlinked = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "accept",
    reviewEventId: "review",
    reviews: [{ reviewEventId: "review", acceptance: "failed", noRepairReason: "该项无需返工" }],
    subtasks: [independentSubtask],
  }));
  assert.equal(loopPlusProtocolParseDiagnostic(unlinked).reasonCode, "validation.accept.unlinked_subtasks");
});

test("general classification rejects codingDelivery even when false", () => {
  const parsed = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "dispatch",
    subtasks: [{ id: "analysis", title: "分析", prompt: "只读分析", taskType: "general", codingDelivery: false }],
  }));
  assert.equal(parsed.decision, null);
  assert.equal(parsed.validationDiagnostic?.code, "SubtaskClassificationConflict");
});

test("restores the reason from a persisted pause without replaying stale recovery instructions", () => {
  const reason = "缺少验收证据\n请核对构建输出";
  assert.equal(readLoopPlusProtocolFailureFromSummary(buildLoopPlusProtocolPauseSummary(reason, "continuation-rejected")), reason);
  const controlled = buildLoopPlusProtocolPauseSummary("安全摘要", "continuation-rejected", loopPlusProtocolBranchDiagnostic("state.completion.repair_required"));
  const recovery = readLoopPlusProtocolRecoveryFromSummary(controlled);
  assert.equal(recovery?.diagnostic.reasonCode, "state.completion.repair_required");
  assert.match(recovery?.hint ?? "", /尚欠返工/);
  assert.equal(readLoopPlusProtocolRecoveryFromSummary(`### 调度协议校验失败\n旧暂停\n\n### 具体原因\n${reason}`)?.diagnostic.reasonCode, "validation.invalid_decision");
  const historical = `### 调度协议校验失败\n已自动请求纠正 2 次\n\n### 具体原因\n${reason}\n\n### 恢复条件\n历史提示`;
  assert.equal(readLoopPlusProtocolFailureFromSummary(historical), reason);
  assert.equal(readLoopPlusProtocolFailureFromSummary("其他暂停原因"), null);
});
