import test = require("node:test");
import assert = require("node:assert/strict");
import { buildLoopPlusProtocolContinuationPrompt, buildLoopPlusProtocolPauseSummary, readLoopPlusProtocolFailureFromSummary, readLoopPlusProtocolRecoveryFromSummary } from "../../loopPlusProtocolRepair";
import { loopPlusProtocolBranchDiagnostic, loopPlusProtocolDiagnosticHint, loopPlusProtocolParseDiagnostic } from "../../loopPlusProtocolDiagnostics";
import { parseLoopPlusDecisionForFrozenInput, parseLoopPlusDecisionWithFeedback } from "../../loopPlusDecision";

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
  assert.equal(diagnostic.fieldPath, "accept.reviews[0].subtaskIds");
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

test("second-item review fields survive recovery and the next correction prompt", () => {
  const misordered = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "accept",
    reviewEventIds: ["event-alpha", "event-beta"],
    reviews: [
      { reviewEventId: "event-alpha", acceptance: "passed" },
      { reviewEventId: "event-beta-secret", acceptance: "failed", reason: "模型原文" },
    ],
  }));
  const orderDiagnostic = loopPlusProtocolParseDiagnostic(misordered);
  assert.equal(orderDiagnostic.reasonCode, "validation.accept.invalid_reviews");
  assert.equal(orderDiagnostic.fieldPath, "accept.reviews[1].reviewEventId");
  assert.doesNotMatch(JSON.stringify(orderDiagnostic), /event-beta-secret|模型原文/);
  const orderHint = loopPlusProtocolDiagnosticHint(orderDiagnostic);
  assert.doesNotMatch(orderHint, /reviews\[1\]|event-beta-secret|请将 acceptance 设为/);
  const orderSummary = buildLoopPlusProtocolPauseSummary("安全摘要", "continuation-rejected", orderDiagnostic);
  const orderRecovery = readLoopPlusProtocolRecoveryFromSummary(orderSummary);
  assert.equal(orderRecovery?.diagnostic.reasonCode, "validation.accept.invalid_reviews");
  assert.equal(orderRecovery?.diagnostic.fieldPath, "accept.reviews[1].reviewEventId");
  const orderPrompt = buildLoopPlusProtocolContinuationPrompt("模型原文不应进入纠正提示 event-beta-secret", orderRecovery ?? undefined);
  assert.match(orderPrompt, /受控字段：accept\.reviews\[1\]\.reviewEventId/);
  assert.match(orderPrompt, /真实 passed、failed 或 cancelled/);
  assert.doesNotMatch(orderPrompt, /event-beta-secret|模型原文/);

  const missing = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "accept",
    reviewEventIds: ["event-alpha", "event-beta"],
    reviews: [
      { reviewEventId: "event-alpha", acceptance: "passed" },
      { reviewEventId: "event-beta", acceptance: "failed" },
    ],
  }));
  const missingDiagnostic = loopPlusProtocolParseDiagnostic(missing);
  assert.equal(missingDiagnostic.reasonCode, "validation.accept.failed_repair_missing");
  assert.equal(missingDiagnostic.fieldPath, "accept.reviews[1].subtaskIds");
  const missingHint = loopPlusProtocolDiagnosticHint(missingDiagnostic);
  assert.match(missingHint, /每个实际失败的 reviews\[i\]/);
  assert.match(missingHint, /恰好派发一项同 ID 返工/);
  assert.match(missingHint, /noRepairReason/);
  assert.doesNotMatch(missingHint, /reviews\[1\]/);
  const missingRecovery = readLoopPlusProtocolRecoveryFromSummary(
    buildLoopPlusProtocolPauseSummary("安全摘要", undefined, missingDiagnostic),
  );
  assert.equal(missingRecovery?.diagnostic.fieldPath, "accept.reviews[1].subtaskIds");
  const missingPrompt = buildLoopPlusProtocolContinuationPrompt("raw model text", missingRecovery ?? undefined);
  assert.match(missingPrompt, /受控字段：accept\.reviews\[1\]\.subtaskIds/);
  assert.match(missingPrompt, /同 ID 返工/);
  assert.match(missingPrompt, /noRepairReason/);
  assert.doesNotMatch(missingPrompt, /raw model text|event-beta/);
});

test("old summaries stay readable and uncontrolled review paths are dropped", () => {
  const legacy = "### 调度协议校验失败\n旧暂停\n\n### 具体原因\n历史原因\n\n### 恢复条件\n历史提示";
  assert.equal(readLoopPlusProtocolRecoveryFromSummary(legacy)?.diagnostic.reasonCode, "validation.invalid_decision");
  assert.equal(readLoopPlusProtocolRecoveryFromSummary(legacy)?.diagnostic.fieldPath, undefined);
  assert.equal(readLoopPlusProtocolFailureFromSummary(legacy), "历史原因");

  const branchOnly = buildLoopPlusProtocolPauseSummary(
    "安全摘要",
    undefined,
    loopPlusProtocolBranchDiagnostic("validation.accept.failed_repair_missing"),
  );
  const restored = readLoopPlusProtocolRecoveryFromSummary(branchOnly);
  assert.equal(restored?.diagnostic.reasonCode, "validation.accept.failed_repair_missing");
  assert.equal(restored?.diagnostic.fieldPath, undefined);
  assert.match(restored?.hint ?? "", /reviews\[i\]/);
  assert.doesNotMatch(restored?.hint ?? "", /reviews\[\d\]/);

  const dirty = buildLoopPlusProtocolPauseSummary("安全摘要", undefined, {
    rejectionKind: "validation",
    reasonCode: "validation.accept.failed_repair_missing",
    fieldPath: "reviews[1].subtaskIds event-beta /tmp/secret.ts",
  });
  assert.doesNotMatch(dirty, /event-beta|secret\.ts/);
  assert.equal(readLoopPlusProtocolRecoveryFromSummary(dirty)?.diagnostic.fieldPath, undefined);

  const handwritten = [
    "### 调度协议校验失败",
    "旧摘要",
    "",
    "### 协议原因码",
    "validation.accept.invalid_reviews|field=accept.reviews[4].reviewEventId /tmp/secret.ts",
    "",
    "### 具体原因",
    "历史原因",
    "",
    "### 恢复条件",
    "旧条件",
  ].join("\n");
  const outOfBatch = readLoopPlusProtocolRecoveryFromSummary(handwritten);
  assert.equal(outOfBatch?.diagnostic.reasonCode, "validation.accept.invalid_reviews");
  assert.equal(outOfBatch?.diagnostic.fieldPath, "accept.reviews");
  assert.equal(readLoopPlusProtocolFailureFromSummary(handwritten), "历史原因");

  const subtask = loopPlusProtocolParseDiagnostic(parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "dispatch",
    subtasks: [{ id: "private-id", title: "private title", prompt: "private prompt", dependsOn: "private path" }],
  })));
  const subtaskSummary = buildLoopPlusProtocolPauseSummary("安全摘要", undefined, subtask);
  assert.equal(readLoopPlusProtocolRecoveryFromSummary(subtaskSummary)?.diagnostic.fieldPath, "dispatch.subtasks[0].dependsOn");
  assert.doesNotMatch(subtaskSummary, /private/);
});

test("expanded replies keep pause and correction at the captured frozen batch", () => {
  const expanded = loopPlusProtocolParseDiagnostic(parseLoopPlusDecisionForFrozenInput(JSON.stringify({
    status: "accept",
    reviewEventIds: ["event-alpha", "event-late"],
    reviews: [
      { reviewEventId: "event-alpha", acceptance: "passed", reason: "第一项符合要求" },
      { reviewEventId: "event-late", acceptance: "maybe", reason: "模型原文" },
    ],
  }), { frozenReviewEventIds: ["event-alpha"] }));
  assert.equal(expanded.reasonCode, "validation.accept.invalid_reviews");
  assert.equal(expanded.fieldPath, "accept.reviews");
  const summary = buildLoopPlusProtocolPauseSummary("安全摘要", "continuation-rejected", expanded);
  const recovery = readLoopPlusProtocolRecoveryFromSummary(summary);
  const prompt = buildLoopPlusProtocolContinuationPrompt("模型原文不应进入纠正提示", recovery ?? undefined);
  assert.doesNotMatch(summary, /reviews\[1\]/);
  assert.doesNotMatch(prompt, /reviews\[1\]/);
  assert.match(prompt, /修正提示：/);
  assert.match(prompt, /真实 passed、failed 或 cancelled/);
  assert.doesNotMatch(`${summary}\n${prompt}`, /event-late|模型原文/);

  const accurate = loopPlusProtocolParseDiagnostic(parseLoopPlusDecisionForFrozenInput(JSON.stringify({
    status: "accept",
    reviewEventIds: ["event-alpha", "event-beta"],
    reviews: [
      { reviewEventId: "event-alpha", acceptance: "passed", reason: "第一项符合要求" },
      { reviewEventId: "event-beta", acceptance: "maybe", reason: "第二项结论无效" },
    ],
  }), { frozenReviewEventIds: ["event-alpha", "event-beta"] }));
  assert.equal(accurate.fieldPath, "accept.reviews[1].acceptance");
  const accurateSummary = buildLoopPlusProtocolPauseSummary("安全摘要", "continuation-rejected", accurate);
  const accuratePrompt = buildLoopPlusProtocolContinuationPrompt(
    "raw",
    readLoopPlusProtocolRecoveryFromSummary(accurateSummary) ?? undefined,
  );
  assert.match(accurateSummary, /accept\.reviews\[1\]\.acceptance/);
  assert.match(accuratePrompt, /受控字段：accept\.reviews\[1\]\.acceptance/);
  assert.doesNotMatch(`${accurateSummary}\n${accuratePrompt}`, /event-beta|第二项结论无效/);
});
