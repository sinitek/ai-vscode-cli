import test = require("node:test");
import assert = require("node:assert/strict");
import {
  LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH,
  LOOP_PLUS_DECISION_SUBTASK_LIMIT,
  LOOP_PLUS_DECISION_SUBTASK_MAX,
  LOOP_PLUS_DECISION_SUBTASK_MIN,
  normalizeLoopPlusDecision,
  parseLoopPlusDecision,
  LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT,
  LOOP_PLUS_MAX_ACCEPTANCES_LIMIT,
  LOOP_PLUS_MAX_ACCEPTANCES_MIN,
  resolveLoopPlusDecisionSubtaskMax,
  resolveLoopPlusMaxAcceptances,
  type LoopPlusDecision,
} from "../../loopPlusDecision";

const CHINESE_PROMPT = [
  "背景：独立实现 Loop+ 的模式存储和决策协议，不改经典 Loop 的整批屏障。",
  "范围：只处理当前授权文件，保留中文需求、验收标准和写文件边界。",
  "验收：模式保持 loop_plus，快照原样保存，解析器不调度也不改任务记录。",
].join("");

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

test("parses a dispatch with one through six self-contained Chinese prompts", () => {
  assert.ok(CHINESE_PROMPT.length >= LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH);
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
    subtasks: [subtask("short", "太短")],
  })), null);
});

test("normalizes the Loop+ acceptance limit", () => {
  assert.equal(resolveLoopPlusMaxAcceptances(undefined), LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT);
  assert.equal(resolveLoopPlusMaxAcceptances(""), LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT);
  assert.equal(resolveLoopPlusMaxAcceptances("100.9"), 100);
  assert.equal(resolveLoopPlusMaxAcceptances(0), LOOP_PLUS_MAX_ACCEPTANCES_MIN);
  assert.equal(resolveLoopPlusMaxAcceptances(5000), LOOP_PLUS_MAX_ACCEPTANCES_LIMIT);
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
    controls: [{ id: "beta", action: "reprompt", prompt: CHINESE_PROMPT }],
  }));
  assert.equal(accepted?.status, "accept");
  assert.equal(accepted?.controls?.[0]?.action, "reprompt");
  assert.equal(accepted?.subtasks, undefined);
});

test("rejects controls that would confirm, overlap, or use a short prompt", () => {
  const rejected = [
    { status: "steer", controls: [{ id: "alpha", action: "reprompt", prompt: "太短" }] },
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
