import assert = require("node:assert/strict");
import test = require("node:test");
import { buildTimedOutHumanInteractionSubmission, HUMAN_INTERACTION_TIMEOUT_TEXT } from "../../humanInteraction";
import {
  buildGrokHumanInteractionResolution,
  isGrokUserQuestionMethod,
  normalizeHumanInteractionRequestFromGrok,
  readGrokUserQuestionParams,
  readGrokUserQuestionResponse,
} from "../../interactive/grokUserQuestion";

const params = {
  sessionId: "grok-session",
  questions: [
    { question: "选择方案？", options: [{ label: "方案一", description: "推荐方案", preview: "方案预览" }, { label: "方案二" }] },
    { question: "选择平台？", options: [{ label: "Linux" }, { label: "Windows" }], multiSelect: true },
  ],
};

function request() {
  return normalizeHumanInteractionRequestFromGrok({ params, tabId: "grok-tab", fallbackInteractionId: "interaction-1" });
}

test("normalizes Grok single and multiple choices with independent custom answers", () => {
  const form = request();
  assert.equal(form.interactionId, "interaction-1");
  assert.equal(form.tabId, "grok-tab");
  assert.deepEqual(form.formFields.map((field) => [field.id, field.type, field.required]), [
    ["answer_1", "radio", false], ["answer_1_other", "textarea", false],
    ["answer_2", "checkbox", false], ["answer_2_other", "textarea", false],
  ]);
  assert.equal(form.formFields[0].options?.[0].description, "推荐方案\n\n方案预览");
  assert.deepEqual(buildGrokHumanInteractionResolution(params, {
    interactionId: form.interactionId,
    status: "completed",
    values: { answer_1: "方案一", answer_1_other: " 自定义方案 ", answer_2: ["Windows", "Linux"], answer_2_other: "macOS" },
  }), { result: { outcome: "accepted", answers: { "选择方案？": ["自定义方案"], "选择平台？": ["Windows", "Linux", "macOS"] } } });
});

test("supports snake-case multi_select and questions with no options", () => {
  assert.equal(readGrokUserQuestionParams({ ...params, questions: [{ ...params.questions[1], multiSelect: undefined, multi_select: true }] })?.questions[0].multiSelect, true);
  const textParams = { sessionId: "session", questions: [{ question: "补充说明？", options: [] }] };
  const form = normalizeHumanInteractionRequestFromGrok({ params: textParams, tabId: "tab", fallbackInteractionId: "one" });
  assert.equal(form.formFields[0].type, "textarea");
  assert.equal(form.formFields[0].required, true);
  assert.deepEqual(buildGrokHumanInteractionResolution(textParams, {
    interactionId: "one", status: "completed", values: { answer_1: "具体要求" },
  }), { result: { outcome: "accepted", answers: { "补充说明？": ["具体要求"] } } });
});

test("rejects malformed Grok question params instead of inventing a form", () => {
  for (const value of [null, [], {}, { ...params, sessionId: "" }, { ...params, questions: [] },
    { ...params, questions: [null] }, { ...params, questions: [{ question: "问题", options: "bad" }] },
    { ...params, questions: [{ question: "问题", options: [null] }] },
    { ...params, questions: [{ question: "问题", options: [{ label: "" }] }] },
    { ...params, questions: [{ question: "问题", options: [], multiSelect: "yes" }] }]) {
    assert.equal(readGrokUserQuestionParams(value), null);
  }
  assert.throws(() => normalizeHumanInteractionRequestFromGrok({ params: {}, tabId: "tab", fallbackInteractionId: "one" }), /无效/);
});

test("returns native cancellation for rejection or an entirely unanswered form", () => {
  for (const status of ["aborted", "completed"] as const) {
    assert.deepEqual(buildGrokHumanInteractionResolution(params, { interactionId: "one", status, values: {} }), { result: { outcome: "cancelled" } });
  }
  assert.deepEqual(buildGrokHumanInteractionResolution(params, {
    interactionId: "one", status: "completed", values: { answer_1: "非法选项", answer_2: ["Linux", "Linux", 42] },
  }), { result: { outcome: "accepted", answers: { "选择平台？": ["Linux"] } } });
});

test("timeouts continue autonomously and never turn into user rejection", () => {
  const form = request();
  assert.deepEqual(buildGrokHumanInteractionResolution(params, buildTimedOutHumanInteractionSubmission(form)), {
    result: { outcome: "accepted", answers: { "选择方案？": [HUMAN_INTERACTION_TIMEOUT_TEXT], "选择平台？": [HUMAN_INTERACTION_TIMEOUT_TEXT] } },
  });
});

test("validates native response shapes and recognizes only supported methods", () => {
  assert.equal(isGrokUserQuestionMethod("_x.ai/ask_user_question"), true);
  assert.equal(isGrokUserQuestionMethod("x.ai/ask_user_question"), true);
  assert.equal(isGrokUserQuestionMethod("ask_user_question"), false);
  assert.deepEqual(readGrokUserQuestionResponse({ outcome: "cancelled" }), { outcome: "cancelled" });
  assert.deepEqual(readGrokUserQuestionResponse({ outcome: "accepted", answers: { question: ["answer"] } }), { outcome: "accepted", answers: { question: ["answer"] } });
  for (const value of [null, [], {}, { outcome: "accepted" }, { outcome: "accepted", answers: [] }, { outcome: "accepted", answers: { question: "answer" } }]) {
    assert.equal(readGrokUserQuestionResponse(value), null);
  }
});

test("question text remains a literal key even when it matches an object prototype property", () => {
  const special = { sessionId: "session", questions: [{ question: "__proto__", options: [] }] };
  const resolution = buildGrokHumanInteractionResolution(special, { interactionId: "one", status: "completed", values: { answer_1: "literal" } });
  assert.equal(Object.prototype.hasOwnProperty.call(resolution.result.outcome === "accepted" ? resolution.result.answers : {}, "__proto__"), true);
});
