import test = require("node:test");
import assert = require("node:assert/strict");

import { HUMAN_INTERACTION_TIMEOUT_TEXT } from "../../humanInteraction";
import {
  ORCHESTRATOR_CLARIFICATION_LIMIT,
  abortOrchestratorClarification,
  formatOrchestratorClarificationAnswer,
  loopClarificationScope,
  normalizeClarificationSubmission,
  parseOrchestratorClarification,
  rejectOrchestratorClarification,
  submitOrchestratorClarification,
  waitForOrchestratorClarification,
} from "../../orchestratorClarification";

const radioField = {
  id: "scope",
  label: "范围",
  type: "radio",
  required: true,
  options: [
    { label: "只改接口", value: "api" },
    { label: "接口和调用方", value: "all" },
  ],
};

function form(fields: unknown[]): Record<string, unknown> {
  return {
    title: "需要确认需求",
    instruction: "这个选择会改变后续方案。",
    submitLabel: "提交",
    cancelLabel: "拒绝",
    formFields: fields,
  };
}

test("accepts one to eight fields and rejects an empty, oversized, or choice-less form", () => {
  assert.equal(ORCHESTRATOR_CLARIFICATION_LIMIT, 8);
  const parsed = parseOrchestratorClarification(form([radioField]), "fallback-id");
  assert.equal(parsed?.title, "需要确认需求");
  assert.equal(parsed?.formFields.length, 1);
  assert.equal(parsed?.formFields[0]?.type, "radio");
  assert.ok(parsed?.interactionId);

  const nested = parseOrchestratorClarification({
    status: "clarify",
    clarification: form([radioField]),
  }, "nested-id");
  assert.equal(nested?.formFields[0]?.id, "scope");

  assert.equal(parseOrchestratorClarification(form([]), "empty"), null);
  assert.equal(parseOrchestratorClarification(form(Array.from({ length: 9 }, (_, index) => ({
    id: `field-${index}`,
    label: `字段 ${index}`,
    type: "text",
  }))), "too-many"), null);
  assert.equal(parseOrchestratorClarification(form([{
    id: "scope",
    label: "范围",
    type: "radio",
    required: true,
  }]), "missing-options"), null);
  assert.equal(parseOrchestratorClarification(form(["not-a-field"]), "bad-field"), null);
});

test("validates required answers and choice values before formatting the continuation", () => {
  const request = parseOrchestratorClarification(form([
    radioField,
    {
      id: "note",
      label: "补充",
      type: "textarea",
      required: false,
    },
    {
      id: "checks",
      label: "检查项",
      type: "multiselect",
      required: true,
      options: [
        { label: "接口", value: "api" },
        { label: "调用方", value: "caller" },
      ],
    },
  ]), "fallback-id");
  assert.ok(request);

  const missing = normalizeClarificationSubmission(request, { note: "保留兼容" });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.issue.code, "required");
    assert.equal(missing.issue.label, "范围");
  }

  const invalid = normalizeClarificationSubmission(request, {
    scope: "unknown",
    checks: ["api"],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.issue.code, "invalid-option");
  }

  const accepted = normalizeClarificationSubmission(request, {
    scope: "api",
    note: "保留兼容",
    checks: ["api", "caller"],
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    const answer = formatOrchestratorClarificationAnswer({
      interactionId: request.interactionId,
      status: "completed",
      values: accepted.values,
    }, request.formFields);
    assert.match(answer, /用户已提交主任务澄清表单/);
    assert.match(answer, /只改接口/);
    assert.match(answer, /调用方/);
    assert.doesNotMatch(answer, /unknown/);
  }
});

test("resolves only the matching in-process waiter and aborts the previous one", async () => {
  const scopeId = loopClarificationScope("task-clarification");
  const first = parseOrchestratorClarification(form([radioField]), "first-id");
  const second = parseOrchestratorClarification(form([radioField]), "second-id");
  assert.ok(first && second);
  const firstWait = waitForOrchestratorClarification(scopeId, first);
  const secondWait = waitForOrchestratorClarification(scopeId, second);
  const aborted = await firstWait;
  assert.equal(aborted.status, "aborted");

  assert.equal(submitOrchestratorClarification(scopeId, first.interactionId, { scope: "api" }).ok, false);
  assert.equal(rejectOrchestratorClarification(scopeId, first.interactionId), false);
  const invalid = submitOrchestratorClarification(scopeId, second.interactionId, { scope: "unknown" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.reason, "invalid");
  }

  const submitted = submitOrchestratorClarification(scopeId, second.interactionId, { scope: "all" });
  assert.equal(submitted.ok, true);
  const completed = await secondWait;
  assert.equal(completed.status, "completed");
  assert.equal(completed.values.scope, "all");
  assert.equal(submitOrchestratorClarification(scopeId, second.interactionId, { scope: "api" }).ok, false);

  const third = parseOrchestratorClarification(form([radioField]), "third-id");
  assert.ok(third);
  const thirdWait = waitForOrchestratorClarification(scopeId, third);
  abortOrchestratorClarification(scopeId);
  assert.equal((await thirdWait).status, "aborted");
  abortOrchestratorClarification(scopeId);
});

test("times out an unanswered clarification without treating it as rejection", async () => {
  const scopeId = loopClarificationScope("task-timeout");
  const request = parseOrchestratorClarification(form([radioField]), "timeout-id");
  assert.ok(request);
  const submission = await waitForOrchestratorClarification(scopeId, request, { timeoutMs: 20 });
  assert.equal(submission.status, "completed");
  assert.equal(submission.timedOut, true);
  assert.equal(formatOrchestratorClarificationAnswer(submission, request.formFields), HUMAN_INTERACTION_TIMEOUT_TEXT);
  assert.equal(submitOrchestratorClarification(scopeId, request.interactionId, { scope: "api" }).ok, false);
});

test("keeps a clarification submission that arrives before timeout", async () => {
  const scopeId = loopClarificationScope("task-timeout-submit");
  const request = parseOrchestratorClarification(form([radioField]), "timeout-submit");
  assert.ok(request);
  const pending = waitForOrchestratorClarification(scopeId, request, { timeoutMs: 40 });
  assert.equal(submitOrchestratorClarification(scopeId, request.interactionId, { scope: "api" }).ok, true);
  const submission = await pending;
  assert.equal(submission.timedOut, undefined);
  assert.equal(submission.values.scope, "api");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(submission.status, "completed");
});
