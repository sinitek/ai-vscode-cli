import test = require("node:test");
import assert = require("node:assert/strict");
import {
  LOOP_PLUS_ACCEPTANCE_BATCH_MAX,
  LOOP_PLUS_DECISION_STATUSES,
  LOOP_PLUS_DECISION_SUBTASK_LIMIT,
  LOOP_PLUS_DECISION_SUBTASK_MAX,
  LOOP_PLUS_DECISION_SUBTASK_MIN,
  normalizeLoopPlusDecision,
  parseLoopPlusDecision,
  parseLoopPlusDecisionWithFeedback,
  resolveLoopPlusDecisionSubtaskMax,
  type LoopPlusDecision,
  type LoopPlusDecisionStatus,
} from "../../loopPlusDecision";
import { LOOP_PLUS_TASK_TYPES } from "../../loopTaskStore";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";

const CHINESE_PROMPT = [
  "背景：独立实现 Loop+ 的模式存储和决策协议，不改经典 Loop 的整批屏障。",
  "范围：只处理当前授权文件，保留中文需求、验收标准和写文件边界。",
  "验收：模式保持 loop_plus，快照原样保存，解析器不调度也不改任务记录。",
].join("");

test("four-event confirmations retain caller order and independent verdicts without host scheduling in the parser", () => {
  assert.equal(LOOP_PLUS_ACCEPTANCE_BATCH_MAX, 4);
  const eventIds = ["event-prerequisite-z", "event-successor-a", "event-ready-c", "event-ready-b"];
  const reviews = eventIds.map((reviewEventId, index) => ({
    reviewEventId,
    acceptance: index === 0 ? "failed" : "passed",
    reason: index === 0 ? "前置用例失败" : "本项交付已独立核对",
    ...(index === 0 ? { noRepairReason: "旧前置已被独立交付取代" } : {}),
  }));
  const candidate = {
    status: "accept", progressPercent: 50, reviewEventIds: eventIds, reviews,
    acceptance: { passed: false, checks: loopPlusAcceptanceChecksFixture() },
  };
  const parsed = normalizeLoopPlusDecision(candidate, { requireAcceptanceFeedback: true, requireProgressPercent: true });
  assert.deepEqual(parsed?.reviewEventIds, eventIds);
  assert.deepEqual(parsed?.reviews?.map((item) => item.acceptance), ["failed", "passed", "passed", "passed"]);
  assert.equal(parsed?.reviewEventId, undefined);
  assert.deepEqual(normalizeLoopPlusDecision({ ...completedFields(), reviewEventIds: eventIds })?.reviewEventIds, eventIds);
  for (const extra of [
    { reviewEventId: eventIds[0] },
    { reviewEventIds: [...eventIds, eventIds[0]] },
    { reviews: reviews.slice(1) },
    { reviews: reviews.slice().reverse() },
  ]) {
    assert.equal(normalizeLoopPlusDecision({ ...candidate, ...extra }), null);
  }
  // The parser validates protocol shape; the host matches the frozen batch's size and order.
  const extraEventId = "host-must-reject-unfrozen-event";
  assert.ok(normalizeLoopPlusDecision({
    ...candidate,
    reviewEventIds: [...eventIds, extraEventId],
    reviews: [...reviews, { reviewEventId: extraEventId, acceptance: "passed" }],
  }));
});

test("report confirmations retain FIFO input order and reject malformed ids without sorting", () => {
  const reportEventIds = ["report-z-first", "report-a-second"];
  assert.deepEqual(normalizeLoopPlusDecision({ status: "wait", reportEventIds })?.reportEventIds, reportEventIds);
  for (const value of [null, "report-z-first", [""], ["report-z-first", "report-z-first"], [1]]) {
    assert.equal(normalizeLoopPlusDecision({ status: "wait", reportEventIds: value }), null);
  }
});

test("next-step plans accept long objectives and multiple criteria without relaxing terminal rules", () => {
  const acceptanceCriteria = ["目标范围已覆盖", "保留现有验收门禁", "核对后续交付结果", "记录验证证据", "验收证据".repeat(40)];
  const objective = "验收完成后推进剩余交付".repeat(30);
  const nextStepPlan = {
    objective: `  ${objective}  `,
    acceptanceCriteria,
  };
  assert.deepEqual(normalizeLoopPlusDecision({ status: "wait", nextStepPlan }), {
    status: "wait",
    nextStepPlan: {
      objective,
      acceptanceCriteria,
    },
  });
  assert.deepEqual(normalizeLoopPlusDecision({ status: "wait", nextStepPlan: { objective, acceptanceCriteria: [] } })?.nextStepPlan, { objective });
  assert.deepEqual(normalizeLoopPlusDecision({ status: "wait" }), { status: "wait" });
  for (const status of ["clarify", "blocked", "completed"]) {
    assert.equal(normalizeLoopPlusDecision({ status, nextStepPlan }), null, status);
  }
  for (const plan of [
    null,
    {},
    { objective: " " },
    { objective: "valid", acceptanceCriteria: [" "] },
    { objective: "valid", acceptanceCriteria: "不是数组" },
  ]) {
    assert.equal(normalizeLoopPlusDecision({ status: "wait", nextStepPlan: plan }), null);
  }
});

test("direct completion needs explicit host permission but no acceptance payload", () => {
  const candidate = {
    status: "completed",
    directCompletion: true,
    answerConclusion: "已处理",
    finalSummary: "已直接完成简单事项，无需子任务或独立验收。",
  };
  assert.deepEqual(parseLoopPlusDecision(JSON.stringify(candidate), {
    allowDirectCompletion: true,
    requireAcceptanceFeedback: true,
  }), candidate);
  assert.equal(withLoopPlusAcceptReviews(candidate), candidate);
  assert.equal(normalizeLoopPlusDecision(candidate), null);
  assert.equal(normalizeLoopPlusDecision(candidate, { allowDirectCompletion: false }), null);
  assert.equal(normalizeLoopPlusDecision({ ...candidate, directCompletion: undefined }, { allowDirectCompletion: true }), null);
  assert.equal(normalizeLoopPlusDecision({ status: "completed", answerConclusion: "已处理", finalSummary: "已处理" }, { allowDirectCompletion: true }), null);
});

test("direct completion rejects missing results, review bypasses and mixed protocol fields", () => {
  const candidate = { status: "completed", directCompletion: true, answerConclusion: "已处理", finalSummary: "已处理" };
  for (const extra of [
    { answerConclusion: " " }, { finalSummary: " " },
    { directCompletion: false }, { directCompletion: "true" }, { directCompletion: null },
    { reviewEventId: "event" }, { reviewEventIds: [] }, { reviews: [] },
    { controls: [] }, { subtasks: [] }, { acceptance: { passed: false } },
    { requirementCoverage: [] }, { acceptancePlanResults: [] },
    { confirmedEventIds: [] }, { acceptedEventIds: [] },
  ]) {
    assert.equal(normalizeLoopPlusDecision({ ...candidate, ...extra }, { allowDirectCompletion: true }), null, JSON.stringify(extra));
  }
  assert.equal(normalizeLoopPlusDecision(candidate, { allowDirectCompletion: true, acceptancePlanKeys: ["security"] }), null);
  for (const status of ["dispatch", "accept", "wait", "steer", "blocked", "clarify"]) {
    assert.equal(normalizeLoopPlusDecision({ ...candidate, status }, { allowDirectCompletion: true }), null);
  }
});

function subtask(id: string, prompt = CHINESE_PROMPT, title = `子任务 ${id}`) {
  return {
    id,
    title,
    prompt,
    conflictGroup: `group-${id}`,
    writeFiles: [`src/${id}.ts`],
  };
}

function completedFields(reviewEventId?: string) {
  return {
    status: "completed",
    ...(reviewEventId === undefined ? {} : { reviewEventId }),
    answerConclusion: "Loop+ 契约已落地，宿主和界面尚未接入。",
    finalSummary: "模式、快照和独立决策协议已分开实现。",
    acceptance: {
      passed: true,
      summary: "全部验收通过。",
      checks: [{ name: "契约", passed: true, detail: "存储与解析均符合约定。" }],
    },
    requirementCoverage: [{ name: "原始需求", passed: true, detail: "完成即验收、等待和增量派发已区分。" }],
  };
}

test("every declared status normalizes through its strategy and retains shared guards", () => {
  const candidates: Record<LoopPlusDecisionStatus, Record<string, unknown>> = {
    dispatch: { status: "dispatch", subtasks: [subtask("alpha")] },
    accept: {
      status: "accept",
      reviewEventId: "event-alpha",
      reviews: [{ reviewEventId: "event-alpha", acceptance: "passed" }],
    },
    wait: { status: "wait" },
    steer: { status: "steer", controls: [{ id: "alpha", action: "close" }] },
    blocked: { status: "blocked", finalSummary: "需要用户确认" },
    completed: completedFields(),
    clarify: {
      status: "clarify",
      clarification: { formFields: [{ id: "scope", label: "范围", type: "text" }] },
    },
  };
  for (const status of LOOP_PLUS_DECISION_STATUSES) {
    const candidate = { ...candidates[status], estimatedRemainingRounds: "3.9" };
    for (const decision of [
      normalizeLoopPlusDecision(candidate),
      parseLoopPlusDecision(JSON.stringify(candidate)),
    ]) {
      assert.equal(decision?.status, status);
      assert.equal(decision?.estimatedRemainingRounds, 3, status);
    }
    for (const key of ["confirmedEventIds", "acceptedEventIds"]) {
      assert.equal(normalizeLoopPlusDecision({ ...candidate, [key]: [] }), null, `${status}: ${key}`);
    }
    assert.equal(normalizeLoopPlusDecision({ ...candidate, directCompletion: false }), null, status);
    if (status !== "completed") {
      assert.equal(normalizeLoopPlusDecision({ ...candidate, directCompletion: true }, {
        allowDirectCompletion: true,
      }), null, status);
    }
  }
});

test("rejects unknown statuses including prototype keys without coercing them", () => {
  const statuses: unknown[] = [
    ...Object.getOwnPropertyNames(Object.prototype),
    "sleeping", "DISPATCH", " wait ", "", null, undefined, 0, true, [], {}, ["wait"],
    { toString: () => "wait" },
    { toString: () => { throw new Error("status must not be coerced"); } },
    Symbol("wait"),
  ];
  for (const status of statuses) {
    assert.equal(normalizeLoopPlusDecision({ status }), null, `unknown status of type ${typeof status}`);
    assert.equal(parseLoopPlusDecision(JSON.stringify({ status })), null);
  }
});

test("scans past malformed, unknown and rejected candidates and returns the first valid decision", () => {
  const content = [
    '{"status": invalid}',
    ...Object.getOwnPropertyNames(Object.prototype).map((status) => JSON.stringify({ status })),
    JSON.stringify({ status: "accept", reviewEventId: "event-without-verdict" }),
    JSON.stringify({ status: "wait", confirmedEventIds: [] }),
    JSON.stringify({ status: "wait", estimatedRemainingRounds: "2.9" }),
    JSON.stringify({ status: "blocked", finalSummary: "后续候选" }),
  ].join("\n");
  assert.deepEqual(parseLoopPlusDecision(content), { status: "wait", estimatedRemainingRounds: 2 });
});

test("parses a dispatch with one through six self-contained Chinese prompts", () => {
  const single = parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("alpha")],
  }));
  assert.equal(single?.status, "dispatch");
  assert.equal(single?.subtasks?.length, 1);
  assert.equal(single?.subtasks?.[0].prompt, CHINESE_PROMPT);
  assert.equal(single?.reviewEventId, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(single, "estimatedRemainingRounds"), false);

  const maxSubtasks = Array.from({ length: LOOP_PLUS_DECISION_SUBTASK_MAX }, (_, index) => (
    subtask(`item-${index}`)
  ));
  const full = normalizeLoopPlusDecision({
    status: "dispatch",
    estimatedRemainingRounds: "2",
    subtask: subtask("ignored-because-array-wins"),
    subtasks: maxSubtasks,
  });
  assert.equal(full?.subtasks?.length, LOOP_PLUS_DECISION_SUBTASK_MAX);
  assert.equal(full?.estimatedRemainingRounds, 2);
  assert.equal(full?.subtasks?.some((item) => item.id === "ignored-because-array-wins"), false);
});

test("parses explicit dependencies on dispatch and accept subtasks", () => {
  const dispatch = normalizeLoopPlusDecision({
    status: "dispatch",
    subtasks: [
      subtask("base"),
      { ...subtask("follow-up"), dependsOn: [" base "] },
    ],
  });
  assert.equal(dispatch?.subtasks?.[0].dependsOn, undefined);
  assert.deepEqual(dispatch?.subtasks?.[1].dependsOn, ["base"]);

  const accepted = normalizeLoopPlusDecision({
    status: "accept",
    reviewEventId: "event-1",
    reviews: [{ reviewEventId: "event-1", acceptance: "passed", subtaskIds: ["repair"] }],
    subtasks: [{ ...subtask("repair"), dependsOn: ["base"] }],
  });
  assert.deepEqual(accepted?.subtasks?.[0].dependsOn, ["base"]);

  for (const dependsOn of [null, "base", ["repair"], [" "], ["base", " base "], ["base", 1]]) {
    assert.equal(normalizeLoopPlusDecision({
      status: "dispatch",
      subtasks: [{ ...subtask("repair"), dependsOn }],
    }), null, `invalid dependsOn ${JSON.stringify(dependsOn)}`);
  }
});

test("retains per-attempt acceptance decisions and rejects non-boolean markers", () => {
  const base = { status: "dispatch", subtasks: [subtask("report")] };
  const parsed = parseLoopPlusDecision(JSON.stringify({
    ...base,
    subtasks: [{ ...subtask("report"), requiresAcceptance: false }],
  }));
  assert.equal(parsed?.subtasks?.[0].requiresAcceptance, false);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    ...base,
    subtasks: [{ ...subtask("report"), requiresAcceptance: "false" }],
  })), null);

  const reprompt = "继续处理同一子任务并修正已知问题，保留任务约定和现有接口。".padEnd(80, "。");
  const controlled = parseLoopPlusDecision(JSON.stringify({
    status: "steer",
    controls: [{ id: "report", action: "reprompt", title: "补充核对", prompt: reprompt, requiresAcceptance: false }],
  }));
  assert.equal(controlled?.controls?.[0].requiresAcceptance, false);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "steer",
    controls: [{ id: "report", action: "reprompt", title: "补充核对", prompt: reprompt, requiresAcceptance: 0 }],
  })), null);
});


test("Loop+ preserves continuation sources and rejects malformed source fields", () => {
  const candidate = { id: "repair", title: "修补", prompt: "根据此前子任务的执行上下文，修复验收反馈中的具体问题并汇报处理结果。".repeat(5), continueFromSubtaskId: " previous " };
  assert.equal(normalizeLoopPlusDecision({ status: "dispatch", subtasks: [candidate] })?.subtasks?.[0].continueFromSubtaskId, "previous");
  for (const value of [false, {}, 1, " "]) {
    assert.equal(normalizeLoopPlusDecision({ status: "dispatch", subtasks: [{ ...candidate, continueFromSubtaskId: value }] }), null);
  }
});

test("accepts a singular subtask and skips illustrative JSON before the decision", () => {
  const decision = {
    status: "dispatch",
    subtask: {
      title: "中文自包含任务",
      prompt: `${CHINESE_PROMPT}\n示例 {"id":"not-a-decision"} 不能抢先成为决策。`,
      writeFiles: ["src/example.ts"],
    },
  };
  const content = [
    "```json",
    JSON.stringify({ id: "示例", enabled: true }),
    "```",
    JSON.stringify(decision),
  ].join("\n");
  const parsed = parseLoopPlusDecision(content);
  assert.equal(parsed?.status, "dispatch");
  assert.equal(parsed?.subtasks?.length, 1);
  assert.equal(parsed?.subtasks?.[0].title, "中文自包含任务");
  assert.match(parsed?.subtasks?.[0].prompt ?? "", /not-a-decision/);
  assert.ok(parsed?.subtasks?.[0].id);
});

test("accepts zero-subtask review and explicit wait without confirming the current item", () => {
  const accept = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: " loop-plus-finish:子任务:a:b ",
    reviews: [{ reviewEventId: " loop-plus-finish:子任务:a:b ", acceptance: "passed" }],
    subtasks: [],
  }));
  assert.deepEqual(accept, {
    status: "accept",
    reviewEventId: "loop-plus-finish:子任务:a:b",
    reviews: [{ reviewEventId: "loop-plus-finish:子任务:a:b", acceptance: "passed" }],
  });

  const withResults = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "loop-plus-finish:子任务:a:b",
    reviews: [{ reviewEventId: "loop-plus-finish:子任务:a:b", acceptance: "failed", noRepairReason: "目标已由新的补充需求取代" }],
    subtasks: [],
    acceptancePlanResults: [
      { key: "security", passed: false },
      { key: "other", passed: true },
    ],
  }));
  assert.deepEqual(withResults?.acceptancePlanResults, [
    { key: "security", passed: false },
    { key: "other", passed: true },
  ]);
  const ignored = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "loop-plus-finish:子任务:a:b",
    reviews: [{ reviewEventId: "loop-plus-finish:子任务:a:b", acceptance: "passed" }],
    subtasks: [],
    acceptancePlanResults: [{ key: "security" }],
  }));
  assert.equal(ignored?.status, "accept");
  assert.equal(ignored?.acceptancePlanResults, undefined);

  const waiting = parseLoopPlusDecision([
    "当前验收后没有新的子任务，仍有任务在执行，所以继续等待。",
    JSON.stringify({ status: "wait" }),
  ].join("\n"));
  assert.deepEqual(waiting, { status: "wait" });
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "subtasks"), false);
});


test("accept records each review verdict and the subtasks that review launches", () => {
  const repair = subtask("repair-beta");
  const followUp = subtask("follow-up-alpha");
  const accepted = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventIds: ["event-alpha", "event-beta"],
    reviews: [
      { reviewEventId: "event-alpha", acceptance: "passed", subtaskIds: ["follow-up-alpha"] },
      { reviewEventId: "event-beta", acceptance: "failed", subtaskIds: ["repair-beta"] },
    ],
    subtasks: [repair, followUp],
  }));
  assert.deepEqual(accepted?.reviews, [
    { reviewEventId: "event-alpha", acceptance: "passed", subtaskIds: ["follow-up-alpha"] },
    { reviewEventId: "event-beta", acceptance: "failed", subtaskIds: ["repair-beta"] },
  ]);
  assert.deepEqual(accepted?.subtasks?.map((item) => item.id), ["repair-beta", "follow-up-alpha"]);

  const rejected = [
    {
      status: "accept",
      reviewEventIds: ["event-alpha", "event-beta"],
      subtasks: [],
    },
    {
      status: "accept",
      reviewEventIds: ["event-alpha", "event-beta"],
      reviews: [
        { reviewEventId: "event-beta", acceptance: "failed" },
        { reviewEventId: "event-alpha", acceptance: "passed" },
      ],
      subtasks: [],
    },
    {
      status: "accept",
      reviewEventId: "event-alpha",
      reviews: [{ reviewEventId: "event-alpha", acceptance: "failed", subtaskIds: ["missing"] }],
      subtasks: [],
    },
    {
      status: "accept",
      reviewEventId: "event-alpha",
      reviews: [{ reviewEventId: "event-alpha", acceptance: "passed" }],
      subtasks: [subtask("orphan")],
    },
    {
      status: "accept",
      reviewEventIds: ["event-alpha", "event-beta"],
      reviews: [
        { reviewEventId: "event-alpha", acceptance: "passed", subtaskIds: ["shared"] },
        { reviewEventId: "event-beta", acceptance: "failed", subtaskIds: ["shared"] },
      ],
      subtasks: [subtask("shared")],
    },
  ];
  rejected.forEach((value) => {
    assert.equal(parseLoopPlusDecision(JSON.stringify(value)), null);
  });
});

test("failed acceptance requires one linked repair or an explicit no-repair completion reason", () => {
  const base = {
    status: "accept",
    reviewEventId: "event-alpha",
    reviews: [{ reviewEventId: "event-alpha", acceptance: "failed", reason: "目标交付未达标" }],
    subtasks: [],
  };
  assert.equal(normalizeLoopPlusDecision(base), null);
  const completed = normalizeLoopPlusDecision({
    ...base,
    reviews: [{ ...base.reviews[0], noRepairReason: "原需求已由后续目标覆盖" }],
  });
  assert.deepEqual(completed?.reviews, [{
    reviewEventId: "event-alpha",
    acceptance: "failed",
    reason: "目标交付未达标",
    noRepairReason: "原需求已由后续目标覆盖",
  }]);
  assert.equal(normalizeLoopPlusDecision({
    ...base,
    reviews: [{ ...base.reviews[0], noRepairReason: "字".repeat(51) }],
  })?.reviews?.[0]?.noRepairReason, "字".repeat(51));
  assert.equal(normalizeLoopPlusDecision({
    ...base,
    reviews: [{ ...base.reviews[0], noRepairReason: "不派修", subtaskIds: ["repair"] }],
    subtasks: [subtask("repair")],
  }), null);
  assert.equal(normalizeLoopPlusDecision({
    ...base,
    independentSubtaskIds: ["independent"],
    subtasks: [subtask("independent")],
  }), null);
  assert.ok(normalizeLoopPlusDecision({
    ...base,
    reviews: [{ ...base.reviews[0], subtaskIds: ["repair"] }],
    subtasks: [subtask("repair")],
  }));
});

test("accept combines event repairs with explicitly independent remaining-goal work", () => {
  const candidate = {
    status: "accept", reviewEventId: "event-alpha", progressPercent: 45,
    reviews: [{ reviewEventId: "event-alpha", acceptance: "failed", reason: "校验分支有遗漏", subtaskIds: ["repair"] }],
    subtasks: [subtask("repair"), subtask("independent-feature"), subtask("independent-docs")],
    independentSubtaskIds: ["independent-feature", "independent-docs"],
    acceptance: { passed: false, checks: loopPlusAcceptanceChecksFixture().map((check) => ({ ...check, passed: false })) },
  };
  const accepted = normalizeLoopPlusDecision(candidate, { requireAcceptanceFeedback: true, requireProgressPercent: true });
  assert.equal(accepted?.status, "accept");
  assert.deepEqual(accepted?.independentSubtaskIds, ["independent-feature", "independent-docs"]);
  assert.deepEqual(accepted?.reviews, candidate.reviews);
  assert.deepEqual(accepted?.subtasks?.map((item) => item.id), ["repair", "independent-feature", "independent-docs"]);

  const withoutRepair = normalizeLoopPlusDecision({
    ...candidate,
    reviews: [{ reviewEventId: "event-alpha", acceptance: "passed" }],
    subtasks: [subtask("independent-feature")],
    independentSubtaskIds: ["independent-feature"],
  });
  assert.equal(withoutRepair?.reviews?.[0].acceptance, "passed");
  assert.deepEqual(withoutRepair?.independentSubtaskIds, ["independent-feature"]);
  const empty = normalizeLoopPlusDecision({
    ...candidate, subtasks: [], independentSubtaskIds: [],
    reviews: [{ reviewEventId: "event-alpha", acceptance: "passed" }],
  });
  assert.equal(empty?.status, "accept");
  assert.equal(empty?.independentSubtaskIds, undefined);
});

test("independent accept tasks still require unique complete ownership and share the decision limit", () => {
  const candidate = {
    status: "accept", reviewEventId: "event-alpha",
    reviews: [{ reviewEventId: "event-alpha", acceptance: "failed", subtaskIds: ["repair"] }],
    subtasks: [subtask("repair"), subtask("delivery")],
    independentSubtaskIds: ["delivery"],
  };
  for (const independentSubtaskIds of [null, "delivery", [""], [1], ["delivery", "delivery"], ["unknown"], ["repair", "delivery"], []]) {
    const rejected = parseLoopPlusDecisionWithFeedback(JSON.stringify({ ...candidate, independentSubtaskIds }));
    assert.equal(rejected.decision, null, JSON.stringify(independentSubtaskIds));
    assert.match(rejected.rejectionReason ?? "", /independentSubtaskIds/);
  }
  assert.equal(normalizeLoopPlusDecision(candidate, { subtaskMax: 1 }), null);
  assert.equal(normalizeLoopPlusDecision(candidate, { subtaskMax: 2 })?.status, "accept");
  for (const value of [{ status: "wait" }, { status: "dispatch", subtasks: [subtask("delivery")] }, completedFields()]) {
    assert.ok(normalizeLoopPlusDecision(value));
    assert.equal(normalizeLoopPlusDecision({ ...value, independentSubtaskIds: [] }), null);
  }
});

test("protocol feedback identifies orphan, unknown and duplicate follow-up links without accepting them", () => {
  const candidate = {
    status: "accept", reviewEventIds: ["event-alpha", "event-beta"],
    reviews: [
      { reviewEventId: "event-alpha", acceptance: "passed", subtaskIds: ["repair"] },
      { reviewEventId: "event-beta", acceptance: "failed", subtaskIds: ["repair", "unknown"] },
    ],
    subtasks: [subtask("repair"), subtask("independent-research")],
  };
  const rejected = parseLoopPlusDecisionWithFeedback(JSON.stringify(candidate));
  assert.equal(rejected.decision, null);
  assert.equal(rejected.rejectionKind, "validation");
  assert.equal(rejected.formatDiagnostic, undefined);
  assert.match(rejected.rejectionReason ?? "", /有 1 项任务未关联/);
  assert.match(rejected.rejectionReason ?? "", /有 1 项关联指向 subtasks 中不存在的任务/);
  assert.match(rejected.rejectionReason ?? "", /有 1 项任务被重复关联/);
  assert.doesNotMatch(rejected.rejectionReason ?? "", /independent-research|unknown|repair/);
  candidate.reviews[0].subtaskIds = ["independent-research"];
  candidate.reviews[1].subtaskIds = ["repair"];
  const corrected = parseLoopPlusDecisionWithFeedback(JSON.stringify(candidate));
  assert.equal(corrected.decision?.status, "accept");
  assert.equal(corrected.decision?.reviews?.[0].acceptance, "passed");
  assert.equal(corrected.rejectionReason, null);
});

test("subtask validation feedback identifies controlled field and array index without echoing content", () => {
  const cases = [
    { subtasks: "secret title", code: "InvalidSubtaskList", field: "subtasks" },
    { subtasks: [{ id: "secret-id", title: " ", prompt: "secret prompt" }], code: "MissingSubtaskTitle", field: "title", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title", prompt: "secret prompt", dependsOn: "secret-path" }], code: "InvalidSubtaskDependencies", field: "dependsOn", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title", prompt: "secret prompt", dependsOn: ["secret-id"] }], code: "InvalidSubtaskDependencies", field: "dependsOn", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title", prompt: "secret prompt", codingDelivery: "secret-delivery" }], code: "InvalidCodingDelivery", field: "codingDelivery", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title", prompt: "secret prompt", requiresAcceptance: "secret-acceptance" }], code: "InvalidRequiresAcceptance", field: "requiresAcceptance", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title", prompt: "secret prompt", continueFromSubtaskId: ["secret-source"] }], code: "InvalidSubtaskContinuation", field: "continueFromSubtaskId", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title" }], code: "MissingSubtaskPrompt", field: "prompt", index: 0 },
    { subtasks: [{ id: "secret-id", title: "secret title", prompt: "secret prompt" }, { id: "secret-id", title: "another secret", prompt: "another secret" }], code: "DuplicateSubtaskId", field: "id", index: 1 },
    { subtasks: Array.from({ length: 7 }, (_, index) => ({ id: `secret-${index}`, title: `secret ${index}`, prompt: "secret prompt" })), code: "InvalidSubtaskCount", field: "subtasks" },
  ] as const;
  for (const candidate of cases) {
    const result = parseLoopPlusDecisionWithFeedback(JSON.stringify({ status: "dispatch", ...candidate }));
    assert.equal(result.rejectionKind, "validation");
    assert.deepEqual(result.validationDiagnostic, {
      code: candidate.code, status: "dispatch", field: candidate.field,
      ...("index" in candidate ? { index: candidate.index } : {}),
    });
    assert.match(result.rejectionReason ?? "", new RegExp(candidate.code));
    assert.doesNotMatch(result.rejectionReason ?? "", /secret/);
    assert.equal(result.formatDiagnostic, undefined);
  }
  const omitted = parseLoopPlusDecisionWithFeedback(JSON.stringify(withLoopPlusAcceptReviews({
    status: "accept", progressPercent: 25, reviewEventId: "review",
  })));
  assert.equal(omitted.decision?.status, "accept");
});

test("subtask classification feedback recommends task types that repair the rejected decision", () => {
  const item = { id: "secret-id", title: "secret title", prompt: "secret prompt" };
  const cases = [
    { fields: { taskType: "coding" }, code: "InvalidSubtaskType", field: "taskType", recommended: LOOP_PLUS_TASK_TYPES },
    { fields: { taskType: 1 }, code: "InvalidSubtaskType", field: "taskType", recommended: LOOP_PLUS_TASK_TYPES },
    { fields: { taskType: "general", codingDelivery: true }, code: "SubtaskClassificationConflict", field: "codingDelivery", recommended: ["backend", "frontend"] },
    { fields: { taskType: "general", writeFiles: ["src/secret-path.ts"] }, code: "SubtaskClassificationConflict", field: "writeFiles", recommended: ["backend", "frontend"] },
  ];
  for (const status of ["dispatch", "accept"] as const) {
    const parse = (fields: Record<string, unknown>) => parseLoopPlusDecisionWithFeedback(JSON.stringify(withLoopPlusAcceptReviews({
      status,
      subtasks: [{ ...item, ...fields }],
      ...(status === "accept" ? {
        progressPercent: 25,
        reviewEventId: "review",
        reviews: [{ reviewEventId: "review", acceptance: "passed" }],
        independentSubtaskIds: [item.id],
      } : {}),
    })));
    for (const { fields, code, field, recommended } of cases) {
      const rejected = parse(fields);
      assert.equal(rejected.decision, null);
      assert.equal(rejected.rejectionKind, "validation");
      assert.equal(rejected.formatDiagnostic, undefined);
      assert.deepEqual(rejected.validationDiagnostic, { code, status, field, index: 0 });
      const reason = rejected.rejectionReason ?? "";
      assert.match(reason, new RegExp(code));
      assert.doesNotMatch(reason, /secret/);
      assert.doesNotMatch(JSON.stringify(rejected.validationDiagnostic), /secret/);
      const suggestedTypes = /将 taskType 设为 ([^，。]+)[，。]/u.exec(reason)?.[1].split("、") ?? [];
      assert.deepEqual(suggestedTypes, recommended);
      for (const taskType of suggestedTypes) {
        const corrected = parse({ ...fields, taskType });
        assert.equal(corrected.decision?.status, status);
        assert.equal(corrected.decision?.subtasks?.[0].taskType, taskType);
        assert.equal(corrected.rejectionReason, null);
        assert.equal(corrected.validationDiagnostic, undefined);
      }
    }
    for (const taskType of [undefined, null, "", "  "]) {
      const legacy = parse({ taskType, writeFiles: ["src/secret-path.ts"] });
      assert.equal(legacy.decision?.status, status);
      assert.equal(legacy.decision?.subtasks?.[0].taskType, undefined);
      assert.equal(legacy.rejectionReason, null);
    }
  }
});

test("protocol feedback distinguishes empty and incomplete replies and clears earlier candidate errors", () => {
  for (const content of [null, undefined, " "]) {
    const parsed = parseLoopPlusDecisionWithFeedback(content);
    assert.equal(parsed.rejectionKind, "format");
    assert.deepEqual(parsed.formatDiagnostic, { code: "EmptyResponse" });
    assert.match(parsed.rejectionReason ?? "", /未返回决策 JSON/);
  }
  const missing = parseLoopPlusDecisionWithFeedback("Explanation with no object");
  assert.equal(missing.rejectionKind, "format");
  assert.deepEqual(missing.formatDiagnostic, { code: "ObjectNotFound" });
  const incomplete = parseLoopPlusDecisionWithFeedback('{"status":');
  assert.equal(incomplete.rejectionKind, "format");
  assert.deepEqual(incomplete.formatDiagnostic, { code: "ValueExpected", position: { line: 1, column: 11 } });
  assert.match(incomplete.rejectionReason ?? "", /未找到可解析/);
  assert.match(parseLoopPlusDecisionWithFeedback('{"status": nope}').rejectionReason ?? "", /语法错误/);
  const invalidStatus = parseLoopPlusDecisionWithFeedback('{"status": nope}\n{"status":"unknown"}');
  assert.equal(invalidStatus.rejectionKind, "validation");
  assert.equal(invalidStatus.formatDiagnostic, undefined);
  assert.match(invalidStatus.rejectionReason ?? "", /status 缺失或无效/);
  const invalid = parseLoopPlusDecisionWithFeedback('{"status":"completed"}');
  assert.equal(invalid.rejectionKind, "validation");
  assert.match(invalid.rejectionReason ?? "", /requirementCoverage/);
  assert.deepEqual(parseLoopPlusDecisionWithFeedback('{"status":"accept"}\n{"status":"wait"}'), {
    decision: { status: "wait" }, rejectionReason: null,
  });
});

test("reports candidate-relative format coordinates for fenced JSON with CRLF", () => {
  const content = ['说明', '```json', '{', '  "status" "synthetic-secret"', '}', '```'].join("\r\n");
  const parsed = parseLoopPlusDecisionWithFeedback(content);
  assert.equal(parsed.decision, null);
  assert.equal(parsed.rejectionKind, "format");
  assert.deepEqual(parsed.formatDiagnostic, { code: "ColonExpected", position: { line: 2, column: 12 } });
  assert.doesNotMatch(JSON.stringify(parsed), /synthetic-secret/);
});

test("accepts comments and trailing commas around decisions without altering strings or inferring fields", () => {
  const content = [
    "[final_answer] 这是调度结果：", "```jsonc", "{", '  // { "注释中的括号和引号"',
    '  "status": "wait", /* } */', '  "reportEventIds": ["https://host/a,]/*",],', "}", "```",
  ].join("\n");
  assert.deepEqual(parseLoopPlusDecision(content), { status: "wait", reportEventIds: ["https://host/a,]/*"] });
  assert.equal(parseLoopPlusDecisionWithFeedback('{"status":"wait","reportEventIds":[,]}').rejectionKind, "format");
  assert.equal(parseLoopPlusDecisionWithFeedback('{"status":"wait",,}').rejectionKind, "format");
  assert.equal(parseLoopPlusDecisionWithFeedback('{"status":"completed", /* 无交付证据 */ }').rejectionKind, "validation");
  assert.equal(parseLoopPlusDecision('{"__proto__":{"status":"wait"}, /* 不继承字段 */ }'), null);
});

test("JSONC fallback keeps malformed separators and split tokens as format errors", () => {
  for (const [content, code] of [
    ['{"status":"wait","extra":{/* 无成员 */,}}', "ValueExpected"],
    ['{"status":"wait","extra":[/* 无元素 */, /* 尾注释 */]}', "ValueExpected"],
    ['{"status":"wait","extra":[1, /* 无下一项 */ ,]}', "ValueExpected"],
    ['{"status":"wait","extra":tr/* 不拼接 */ue}', "InvalidSymbol"],
  ]) {
    const parsed = parseLoopPlusDecisionWithFeedback(content);
    assert.equal(parsed.decision, null, content);
    assert.equal(parsed.rejectionKind, "format", content);
    assert.equal(parsed.formatDiagnostic?.code, code, content);
  }
  const unclosedComment = parseLoopPlusDecisionWithFeedback('{"status":"wait", /* 未闭合 }');
  assert.equal(unclosedComment.decision, null);
  assert.equal(unclosedComment.rejectionKind, "format");
  assert.deepEqual(unclosedComment.formatDiagnostic, {
    code: "UnexpectedEndOfComment", position: { line: 1, column: 19 },
  });
});

test("retains a format rejection when nested syntax exceeds the diagnostic parser stack", () => {
  const content = `{"status":"wait","extra":${"[".repeat(12000)}nope${"]".repeat(12000)}}`;
  const parsed = parseLoopPlusDecisionWithFeedback(content);
  assert.equal(parsed.decision, null);
  assert.equal(parsed.rejectionKind, "format");
  assert.ok(parsed.formatDiagnostic?.code);
});

test("scans BOM-prefixed JSONC candidates without promoting a nested decision", () => {
  const reportId = 'https://host/a/* 保留 */\\"quoted,]"';
  const content = [
    '\uFEFF{"status":"wait","extra":{,}}',
    '{"status":"unknown", /* 无效状态 */ }',
    '{"example":{"status":"wait",},}',
    `{"status":"wait", // 选中首个合法对象\r\n"reportEventIds":[${JSON.stringify(reportId)}, /* } */],}`,
    '{"status":"wait","reportEventIds":["later"]}',
  ].join("\n");
  assert.deepEqual(parseLoopPlusDecisionWithFeedback(content), {
    decision: { status: "wait", reportEventIds: [reportId] },
    rejectionReason: null,
  });
});

test("strict acceptance feedback mode parses short reasons and rejects missing reasons", () => {
  const accepted = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "event-reason",
    reviews: [{ reviewEventId: "event-reason", acceptance: "passed", reason: "测试通过" }],
    acceptance: {
      passed: true,
      checks: ["dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions"]
        .map((name) => ({ name, passed: true, detail: "测试通过" })),
    },
    subtasks: [],
  }), { requireAcceptanceFeedback: true });
  assert.equal(accepted?.reviews?.[0]?.reason, "测试通过");
  assert.equal(accepted?.acceptance?.checks[0]?.detail, "测试通过");
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "event-reason",
    reviews: [{ reviewEventId: "event-reason", acceptance: "passed" }],
    subtasks: [],
  }), { requireAcceptanceFeedback: true }), null);
});

test("strict feedback rejects missing reasons but preserves long evidence for every result type", () => {
  const checks = loopPlusAcceptanceChecksFixture();
  const base = {
    status: "accept", reviewEventId: "event-a",
    reviews: [{ reviewEventId: "event-a", acceptance: "passed", reason: "用例已通过" }],
    acceptance: { passed: true, checks },
  };
  const options = { requireAcceptanceFeedback: true };
  for (const reason of [undefined, "", "  ", 123]) {
    assert.equal(normalizeLoopPlusDecision({ ...base, reviews: [{ ...base.reviews[0], reason }] }, options), null);
    assert.equal(normalizeLoopPlusDecision({
      ...base, acceptance: { passed: true, checks: checks.map((check, index) => index === 0 ? { ...check, detail: reason } : check) },
    }, options), null);
    assert.equal(normalizeLoopPlusDecision({
      ...base, acceptancePlanResults: [{ key: "security", passed: true, reason }],
    }, { ...options, acceptancePlanKeys: ["security"] }), null);
  }
  const longReason = "😀".repeat(100);
  const parsed = normalizeLoopPlusDecision({
    ...base,
    reviews: [{ ...base.reviews[0], reason: longReason }],
    acceptance: { passed: true, checks: checks.map((check) => ({ ...check, detail: longReason })) },
    acceptancePlanResults: [{ key: "security", passed: true, reason: longReason }],
  }, { ...options, acceptancePlanKeys: ["security"] });
  assert.equal(parsed?.reviews?.[0]?.reason, longReason);
  assert.equal(parsed?.acceptance?.checks[0]?.detail, longReason);
  assert.equal(parsed?.acceptancePlanResults?.[0]?.reason, longReason);
});

test("strict feedback requires each default check once but accepts a different order", () => {
  const base = {
    status: "accept", reviewEventId: "event-a",
    reviews: [{ reviewEventId: "event-a", acceptance: "failed", reason: "回归断言失败", noRepairReason: "旧交付已被取代" }],
  };
  const checks = loopPlusAcceptanceChecksFixture();
  const options = { requireAcceptanceFeedback: true };
  for (const invalidChecks of [[], checks.slice(1), [...checks.slice(1), checks[1]]]) {
    assert.equal(normalizeLoopPlusDecision({ ...base, acceptance: { passed: false, checks: invalidChecks } }, options), null);
  }
  const reversed = checks.slice().reverse().map((check) => check.name === "tests"
    ? { ...check, passed: false, detail: "回归断言失败" } : check);
  const parsed = normalizeLoopPlusDecision({ ...base, acceptance: { passed: false, checks: reversed } }, options);
  assert.equal(parsed?.acceptance?.checks.find((check) => check.name === "tests")?.passed, false);
});

test("strict feedback requires all selected plan results and accepts concise failure reasons", () => {
  const base = withLoopPlusAcceptReviews({ status: "accept", reviewEventId: "event-a" });
  const options = { requireAcceptanceFeedback: true, acceptancePlanKeys: ["security", "performance"] };
  const results = [
    { key: "security", passed: false, reason: "错误日志仍输出令牌" },
    { key: "performance", passed: true, reason: "未增加重复请求" },
  ];
  for (const acceptancePlanResults of [undefined, [], results.slice(1), [results[0], results[0]]]) {
    assert.equal(normalizeLoopPlusDecision({ ...base, acceptancePlanResults }, options), null);
  }
  assert.equal(normalizeLoopPlusDecision({ ...base, acceptancePlanResults: results }, options)?.acceptancePlanResults?.[0]?.reason, "错误日志仍输出令牌");
  const shuffled = [results[1], { key: "other", passed: true, reason: "未勾选" }, results[0]];
  assert.deepEqual(normalizeLoopPlusDecision({ ...base, acceptancePlanResults: shuffled }, options)?.acceptancePlanResults, results.slice().reverse());
  const noSelected = normalizeLoopPlusDecision({ ...base, acceptancePlanResults: results }, {
    requireAcceptanceFeedback: true, acceptancePlanKeys: [],
  });
  assert.equal(noSelected?.status, "accept");
  assert.equal(noSelected?.acceptancePlanResults, undefined);
});

test("production acceptance requires an integer overall progress below completion", () => {
  const base = withLoopPlusAcceptReviews({ status: "accept", reviewEventId: "event-progress" }) as Record<string, unknown>;
  for (const progressPercent of [undefined, null, "23", 23.5, -1, 100, 101]) {
    const decision = { ...base };
    if (progressPercent === undefined) {
      delete decision.progressPercent;
    } else {
      decision.progressPercent = progressPercent;
    }
    assert.equal(parseLoopPlusDecision(JSON.stringify(decision), { requireProgressPercent: true }), null);
  }
  const parsed = parseLoopPlusDecision(JSON.stringify({ ...base, progressPercent: 23 }), { requireProgressPercent: true });
  assert.equal(parsed?.status, "accept");
  assert.equal(parsed?.progressPercent, 23);
  assert.equal(parseLoopPlusDecision(JSON.stringify({ ...base, progressPercent: 0 }), { requireProgressPercent: true })?.progressPercent, 0);
  assert.equal(parseLoopPlusDecision(JSON.stringify({ ...base, progressPercent: 99 }), { requireProgressPercent: true })?.progressPercent, 99);
  assert.equal(parseLoopPlusDecision(JSON.stringify({ ...base, progressPercent: 100 })), null);
});

test("completed feedback requires non-empty default reasons without truncating long evidence", () => {
  const detail = "需求覆盖证据".repeat(20);
  const base = {
    ...completedFields(),
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    requirementCoverage: [{ name: "原始需求", passed: true, detail }],
  };
  const options = { requireAcceptanceFeedback: true };
  assert.equal(normalizeLoopPlusDecision(base, options)?.requirementCoverage?.[0]?.detail, detail);
  for (const reason of [undefined, ""]) {
    assert.equal(normalizeLoopPlusDecision({
      ...base, acceptance: { passed: true, checks: base.acceptance.checks.map((check) => ({ ...check, detail: reason })) },
    }, options), null);
  }
  const longDetail = "验收证据".repeat(40);
  assert.equal(normalizeLoopPlusDecision({
    ...base,
    acceptance: { passed: true, checks: base.acceptance.checks.map((check) => ({ ...check, detail: longDetail })) },
  }, options)?.acceptance?.checks[0]?.detail, longDetail);
});

test("feedback fixtures never overwrite an existing failed check", () => {
  const acceptance = { passed: false, checks: [{ name: "tests", passed: false, detail: "测试失败" }] };
  const fixture = withLoopPlusAcceptReviews({ status: "completed", acceptance });
  assert.deepEqual(fixture.acceptance, acceptance);
});

test("rejects malformed JSON, empty event ids, duplicates, overflow, and unknown status", () => {
  assert.equal(parseLoopPlusDecision("{status:dispatch"), null);
  assert.equal(parseLoopPlusDecision("完全不是 JSON"), null);
  assert.equal(parseLoopPlusDecision(""), null);
  assert.equal(normalizeLoopPlusDecision(["dispatch"]), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "   ",
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "",
    subtasks: [],
  })), null);
  assert.equal(normalizeLoopPlusDecision({
    status: "accept",
    subtasks: [],
  }), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("same"), subtask("same")],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: Array.from({ length: LOOP_PLUS_DECISION_SUBTASK_MAX + 1 }, (_, index) => subtask(`extra-${index}`)),
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "continue",
    subtasks: [subtask("classic")],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({ status: "sleeping" })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("blank", " ")],
  })), null);
});

test("applies a configured Loop+ dispatch subtask maximum", () => {
  assert.equal(resolveLoopPlusDecisionSubtaskMax(undefined), LOOP_PLUS_DECISION_SUBTASK_MAX);
  assert.equal(resolveLoopPlusDecisionSubtaskMax("2.9"), 2);
  assert.equal(resolveLoopPlusDecisionSubtaskMax(0), LOOP_PLUS_DECISION_SUBTASK_MIN);
  assert.equal(resolveLoopPlusDecisionSubtaskMax(99), LOOP_PLUS_DECISION_SUBTASK_LIMIT);

  const two = parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("alpha"), subtask("beta")],
  }), { subtaskMax: 2 });
  assert.equal(two?.subtasks?.length, 2);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("alpha"), subtask("beta"), subtask("gamma")],
  }), { subtaskMax: 2 }), null);

  const raised = Array.from({ length: LOOP_PLUS_DECISION_SUBTASK_MAX + 1 }, (_, index) => subtask(`raised-${index}`));
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: raised,
  })), null);
  assert.equal(normalizeLoopPlusDecision({
    status: "dispatch",
    subtasks: raised,
  }, { subtaskMax: raised.length })?.subtasks?.length, raised.length);
});

test("rejects decisions that would confirm a review implicitly or dispatch while waiting", () => {
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    reviewEventId: "event-1",
    subtasks: [subtask("alpha")],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "wait",
    reviewEventId: "event-1",
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "wait",
    subtasks: [subtask("alpha")],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "blocked",
    reviewEventId: "event-1",
    subtasks: [subtask("alpha")],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "event-1",
    reviewEventIds: ["event-1", "event-2"],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    reviewEventIds: ["event-1"],
    subtasks: [subtask("alpha")],
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventIds: ["event-1"],
    confirmedEventIds: ["event-1"],
  })), null);
  const batch = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventIds: [" event-1 ", "event-2"],
    reviews: [
      { reviewEventId: "event-1", acceptance: "passed" },
      { reviewEventId: "event-2", acceptance: "passed" },
    ],
    subtasks: [],
  }));
  assert.deepEqual(batch?.reviewEventIds, ["event-1", "event-2"]);
  assert.equal(batch?.reviewEventId, undefined);
  assert.equal(batch?.reviews?.[0]?.acceptance, "passed");
  assert.equal(batch?.reviews?.[1]?.acceptance, "passed");
});

test("parses blocked and completed without requiring estimated rounds", () => {
  const blocked = parseLoopPlusDecision(JSON.stringify({
    status: "blocked",
    finalSummary: " 需要人工确认外部依赖。 ",
  }));
  assert.deepEqual(blocked, {
    status: "blocked",
    finalSummary: "需要人工确认外部依赖。",
    blockerIssue: "blocked 缺少 blocker 诊断对象，不能只提供一句 finalSummary。",
  });

  const completed = parseLoopPlusDecision(JSON.stringify(completedFields(" event-current ")));
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.reviewEventId, "event-current");
  assert.equal(completed?.answerConclusion?.includes("宿主"), true);
  assert.equal(completed?.acceptance?.passed, true);
  assert.equal(completed?.requirementCoverage?.[0].passed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "estimatedRemainingRounds"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "subtasks"), false);

  const withoutEvent = normalizeLoopPlusDecision({
    ...completedFields(),
    roundSummaries: [{ round: 1, title: "忽略轮次", summary: "Loop+ 不要求轮次。" }],
    estimatedRemainingRounds: 4,
  });
  assert.equal(withoutEvent?.reviewEventId, undefined);
  assert.equal(withoutEvent?.estimatedRemainingRounds, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutEvent ?? {}, "roundSummaries"), false);

  const batch = parseLoopPlusDecision(JSON.stringify({
    ...completedFields(),
    reviewEventIds: [" event-1 ", "event-2"],
  }));
  assert.deepEqual(batch?.reviewEventIds, ["event-1", "event-2"]);
  assert.equal(batch?.reviewEventId, undefined);
});

test("rejects illegal completed decisions instead of dropping failed evidence", () => {
  const cases: unknown[] = [
    { ...completedFields(), answerConclusion: "  " },
    { ...completedFields(), finalSummary: "" },
    { ...completedFields(), acceptance: { passed: false, checks: [{ name: "契约", passed: true }] } },
    { ...completedFields(), acceptance: { passed: true, checks: [{ name: "契约", passed: false }] } },
    { ...completedFields(), acceptance: { passed: true, checks: [] } },
    { ...completedFields(), requirementCoverage: [] },
    { ...completedFields(), requirementCoverage: [{ name: "原始需求", passed: false }] },
    { ...completedFields(), reviewEventId: " " },
    { ...completedFields(), subtasks: [subtask("alpha")] },
    { ...completedFields("event-1"), reviewEventIds: ["event-2"] },
    { ...completedFields(), reviewEventIds: ["event-2", "event-2"] },
    { ...completedFields(), reviewEventIds: [] },
    { ...completedFields(), reviewEventIds: ["  "] },
    { ...completedFields("event-1"), reviews: [{ reviewEventId: "event-1", acceptance: "passed" }] },
  ];
  cases.forEach((value) => {
    assert.equal(normalizeLoopPlusDecision(value), null);
  });
});

test("completed requires every selected acceptance-plan result to pass", () => {
  const options = { requireAcceptanceFeedback: true, acceptancePlanKeys: ["security", "performance"] };
  const base = {
    ...completedFields(),
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
  };
  const allPassed = [
    { key: "security", passed: true, reason: "输入边界已核对" },
    { key: "performance", passed: true, reason: "未增加重复请求" },
  ];
  assert.equal(normalizeLoopPlusDecision({ ...base, acceptancePlanResults: allPassed }, options)?.status, "completed");
  const shuffled = [allPassed[1], { key: "other", passed: false, reason: "未选择此项" }, allPassed[0]];
  assert.deepEqual(normalizeLoopPlusDecision({ ...base, acceptancePlanResults: shuffled }, options)?.acceptancePlanResults, [allPassed[1], allPassed[0]]);

  for (const acceptancePlanResults of [
    allPassed.map((result, index) => index === 0 ? { ...result, passed: false } : result),
    allPassed.map((result, index) => index === 1 ? { ...result, passed: false } : result),
    allPassed.map((result) => ({ ...result, passed: false })),
  ]) {
    assert.equal(normalizeLoopPlusDecision({ ...base, acceptancePlanResults }, options), null);
  }
  for (const acceptancePlanResults of [
    undefined,
    [],
    [allPassed[0]],
  ]) {
    assert.equal(normalizeLoopPlusDecision({ ...base, acceptancePlanResults }, options), null);
  }

  const rejected = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    ...base,
    acceptancePlanResults: [{ ...allPassed[0], passed: false }, allPassed[1]],
  }), options);
  assert.equal(rejected.decision, null);
  assert.match(rejected.rejectionReason ?? "", /accept 保留真实失败并派发修复/);
  assert.equal(normalizeLoopPlusDecision(completedFields())?.status, "completed");
});

test("does not mutate the input decision", () => {
  const input = {
    status: "accept",
    reviewEventId: "event-1",
    reviews: [{ reviewEventId: "event-1", acceptance: "passed" }],
    subtasks: [],
  };
  const before = JSON.stringify(input);
  const parsed: LoopPlusDecision | null = normalizeLoopPlusDecision(input);
  assert.equal(parsed?.status, "accept");
  assert.equal(JSON.stringify(input), before);
});

test("parses steer and controls without treating them as acceptance", () => {
  const steered = parseLoopPlusDecision(JSON.stringify({
    status: "steer",
    controls: [
      { id: "alpha", action: "close" },
      { id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "重做 beta" },
    ],
  }));
  assert.equal(steered?.status, "steer");
  assert.equal(steered?.reviewEventId, undefined);
  assert.equal(steered?.subtasks, undefined);
  assert.deepEqual(steered?.controls, [
    { id: "alpha", action: "close" },
    { id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "重做 beta" },
  ]);

  const dispatched = parseLoopPlusDecision(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("alpha")],
    controls: [{ id: "beta", action: "close" }],
  }));
  assert.equal(dispatched?.status, "dispatch");
  assert.equal(dispatched?.controls?.[0]?.id, "beta");

  const accepted = parseLoopPlusDecision(JSON.stringify({
    status: "accept",
    reviewEventId: "event-1",
    reviews: [{ reviewEventId: "event-1", acceptance: "passed" }],
    controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "重做 beta" }],
  }));
  assert.equal(accepted?.status, "accept");
  assert.equal(accepted?.controls?.[0]?.action, "reprompt");
  assert.equal(accepted?.subtasks, undefined);
});

test("reprompt preserves omitted dependencies separately from explicit clearing", () => {
  const omitted = normalizeLoopPlusDecision({
    status: "steer",
    controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "重做 beta" }],
  });
  const cleared = normalizeLoopPlusDecision({
    status: "steer",
    controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "重做 beta", dependsOn: [] }],
  });
  assert.equal(omitted?.controls?.[0].dependsOn, undefined);
  assert.deepEqual(cleared?.controls?.[0].dependsOn, []);
  assert.equal(omitted?.controls?.[0].requiresAcceptance, undefined);
  assert.equal(cleared?.controls?.[0].requiresAcceptance, undefined);
  for (const dependsOn of [null, "alpha", ["beta"], [" "]]) {
    assert.equal(normalizeLoopPlusDecision({
      status: "steer",
      controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "重做 beta", dependsOn }],
    }), null);
  }
});

test("reprompt requires a non-empty corrected title on every supported decision", () => {
  const decisions = [
    { status: "steer" },
    { status: "dispatch", subtasks: [subtask("alpha")] },
    {
      status: "accept",
      reviewEventId: "event-1",
      reviews: [{ reviewEventId: "event-1", acceptance: "passed" }],
    },
  ];
  for (const decision of decisions) {
    for (const title of [undefined, "", " \n ", null, 42]) {
      assert.equal(parseLoopPlusDecision(JSON.stringify({
        ...decision,
        controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title }],
      })), null, `${decision.status} must reject an invalid reprompt title: ${String(title)}`);
    }
    const parsed = parseLoopPlusDecision(JSON.stringify({
      ...decision,
      controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT, title: "  修正 beta 校验逻辑  " }],
    }));
    assert.equal(parsed?.controls?.[0]?.title, "修正 beta 校验逻辑");
  }
});

test("accepts short dispatch and reprompt instructions but rejects blank prompts", () => {
  const prompt = "修复空输入校验并运行回归。";
  assert.equal(normalizeLoopPlusDecision({ status: "dispatch", subtasks: [subtask("alpha", prompt)] })?.subtasks?.[0]?.prompt, prompt);
  const control = { id: "alpha", action: "reprompt", prompt, title: "修正 alpha" };
  assert.deepEqual(normalizeLoopPlusDecision({ status: "steer", controls: [control] })?.controls, [control]);
  assert.equal(normalizeLoopPlusDecision({ status: "steer", controls: [{ ...control, prompt: " " }] }), null);
});

test("rejects controls that would confirm or overlap", () => {
  const rejected = [
    { status: "steer", controls: [] },
    { status: "steer", subtasks: [subtask("alpha")], controls: [{ id: "beta", action: "close" }] },
    { status: "steer", reviewEventId: "event-1", controls: [{ id: "alpha", action: "close" }] },
    {
      status: "steer",
      controls: [
        { id: "alpha", action: "close" },
        { id: "alpha", action: "close" },
      ],
    },
    {
      status: "dispatch",
      subtasks: [subtask("alpha")],
      controls: [{ id: "alpha", action: "close" }],
    },
    { status: "wait", controls: [{ id: "alpha", action: "close" }] },
    { status: "blocked", finalSummary: "需要人工决定", controls: [{ id: "alpha", action: "close" }] },
    { ...completedFields("event-1"), controls: [{ id: "alpha", action: "close" }] },
    {
      status: "steer",
      controls: Array.from({ length: LOOP_PLUS_DECISION_SUBTASK_MAX + 1 }, (_, index) => ({
        id: `item-${index}`,
        action: "close",
      })),
    },
  ];
  rejected.forEach((value) => {
    assert.equal(parseLoopPlusDecision(JSON.stringify(value)), null);
  });
});

test("parses clarify without subtasks and rejects a form that cannot be shown", () => {
  const parsed = parseLoopPlusDecision(JSON.stringify({
    status: "clarify",
    finalSummary: "需要用户确认范围",
    clarification: {
      title: "需要确认需求",
      instruction: "请选择范围",
      formFields: [{
        id: "scope",
        label: "范围",
        type: "radio",
        required: true,
        options: [
          { label: "只改接口", value: "api" },
          { label: "接口和调用方", value: "all" },
        ],
      }],
    },
  }));
  assert.equal(parsed?.status, "clarify");
  assert.equal(parsed?.clarification?.formFields.length, 1);
  assert.equal(parsed?.subtasks, undefined);
  assert.equal(parsed?.controls, undefined);

  const reported = parseLoopPlusDecision(JSON.stringify({
    status: "clarify",
    finalSummary: "图片替换的处理方式已明确。当前审计还显示，候选页的版式和原文授权也未解决。",
    clarification: {
      title: "确认无授权页面的处理方式",
      instruction: "图片可以按你的新指示换成许可明确、尺寸与槽位匹配的替代素材，无需重复确认。请只确认版式或原文也未获授权时如何处理。",
      submitLabel: "提交选择",
      cancelLabel: "暂不继续",
      formFields: [{
        id: "unlicensed_page_scope",
        label: "版式或原文未获授权时",
        type: "radio",
        required: true,
        options: [
          { label: "只替换独立素材", value: "replace-media-only", description: "保留技能中的原页面。" },
          { label: "整体替换页面", value: "replace-unlicensed-page", description: "改用许可明确的页面。" },
        ],
      }],
    },
  }));
  assert.equal(reported?.status, "clarify");
  assert.equal(reported?.clarification?.title, "确认无授权页面的处理方式");
  assert.equal(reported?.clarification?.formFields[0]?.id, "unlicensed_page_scope");
  assert.deepEqual(reported?.clarification?.formFields[0]?.options?.map((option) => option.value), [
    "replace-media-only",
    "replace-unlicensed-page",
  ]);

  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "clarify",
    subtasks: [subtask("alpha")],
    clarification: {
      formFields: [{ id: "scope", label: "范围", type: "text" }],
    },
  })), null);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    status: "clarify",
    clarification: { formFields: [] },
  })), null);
});

test("撤销验收要求原因，全撤销不要求检查，混合批次保留其余验收", () => {
  const cancelled = {
    status: "accept", progressPercent: 60, reviewEventId: "obsolete",
    reviews: [{ reviewEventId: "obsolete", acceptance: "cancelled", reason: "用户取消了这项需求" }],
  };
  const options = { requireAcceptanceFeedback: true, acceptancePlanKeys: ["security"] };
  assert.equal(normalizeLoopPlusDecision(cancelled, options)?.reviews?.[0].acceptance, "cancelled");
  for (const reason of [undefined, " "]) {
    assert.equal(normalizeLoopPlusDecision({ ...cancelled, reviews: [{ ...cancelled.reviews[0], reason }] }), null);
  }
  const mixed = { ...cancelled, reviewEventId: undefined, reviewEventIds: ["obsolete", "needed"],
    reviews: [...cancelled.reviews, { reviewEventId: "needed", acceptance: "passed", reason: "定向测试通过" }] };
  delete mixed.reviewEventId;
  assert.equal(normalizeLoopPlusDecision(mixed, options), null);
  const parsed = normalizeLoopPlusDecision({ ...mixed,
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    acceptancePlanResults: [{ key: "security", passed: true, reason: "权限检查通过" }],
  }, options);
  assert.deepEqual(parsed?.reviews?.map((review) => review.acceptance), ["cancelled", "passed"]);
  const close = normalizeLoopPlusDecision({ status: "steer", controls: [{ id: "obsolete", action: "close", reason: "范围调整" }] });
  assert.equal(close?.controls?.[0].reason, "范围调整");
  assert.equal(normalizeLoopPlusDecision({ status: "steer", controls: [{ id: "obsolete", action: "close", reason: " " }] }), null);
});
