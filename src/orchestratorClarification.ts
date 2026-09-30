import type {
  HumanInteractionFormField,
  HumanInteractionSubmission,
} from "./humanInteraction";
import {
  HUMAN_INTERACTION_TIMEOUT_TEXT,
  createInteractionTimeout,
  formatHumanInteractionSubmittedText,
  normalizeHumanInteractionRequestFromCodex,
} from "./humanInteraction";

export const ORCHESTRATOR_CLARIFICATION_LIMIT = 8;
const MAX_FIELDS = 8;
const MAX_OPTIONS = 12;

export type OrchestratorClarification = {
  interactionId: string;
  title: string;
  instruction: string;
  formFields: HumanInteractionFormField[];
  submitLabel: string;
  cancelLabel: string;
};

export type ClarificationSubmissionIssue = {
  code: "required" | "invalid-option";
  label: string;
};

type Waiter = {
  request: OrchestratorClarification;
  resolve: (submission: HumanInteractionSubmission) => void;
};

const waiters = new Map<string, Waiter>();

export function loopClarificationScope(taskId: string): string {
  return `loop:${taskId}`;
}

export function graphClarificationScope(graphRunId: string): string {
  return `graph:${graphRunId}`;
}

export function parseOrchestratorClarification(
  value: unknown,
  fallbackInteractionId: string,
): OrchestratorClarification | null {
  const record = asRecord(value);
  const nested = asRecord(record.clarification);
  const source = hasFieldList(nested) ? nested : record;
  const rawFields = readRawFields(source);
  if (!rawFields || rawFields.length < 1 || rawFields.length > MAX_FIELDS) {
    return null;
  }
  if (rawFields.some((field) => !isRecord(field))) {
    return null;
  }
  const request = normalizeHumanInteractionRequestFromCodex({
    method: "orchestrator/clarification",
    tabId: "orchestrator",
    fallbackInteractionId,
    params: source,
  });
  if (request.formFields.length !== rawFields.length) {
    return null;
  }
  const formFields = request.formFields.map((field) => ({
    ...field,
    ...(field.options && field.options.length > MAX_OPTIONS
      ? { options: field.options.slice(0, MAX_OPTIONS) }
      : {}),
  }));
  if (formFields.some((field) => choiceFieldMissingOptions(field))) {
    return null;
  }
  return {
    interactionId: request.interactionId || fallbackInteractionId,
    title: trimText(request.title, 120) || "需要补充信息",
    instruction: trimText(request.instruction, 2000),
    formFields: formFields.map((field) => ({
      ...field,
      label: trimText(field.label, 200) || field.id,
      ...(field.description ? { description: trimText(field.description, 500) } : {}),
    })),
    submitLabel: trimText(request.submitLabel, 40) || "提交",
    cancelLabel: trimText(request.cancelLabel, 40) || "拒绝",
  };
}

export function formatOrchestratorClarificationAnswer(
  submission: HumanInteractionSubmission,
  formFields: readonly HumanInteractionFormField[] = [],
): string {
  if (submission.timedOut) {
    return HUMAN_INTERACTION_TIMEOUT_TEXT;
  }
  return [
    "用户已提交主任务澄清表单。请据此继续决策，不要重复询问已回答的问题。",
    formatHumanInteractionSubmittedText(submission, formFields),
  ].join("\n");
}

export function normalizeClarificationSubmission(
  request: OrchestratorClarification,
  values: unknown,
): { ok: true; values: Record<string, unknown> } | { ok: false; issue: ClarificationSubmissionIssue } {
  const record = asRecord(values);
  const normalized: Record<string, unknown> = {};
  for (const field of request.formFields) {
    const rawValue = record[field.id];
    if (field.type === "checkbox" && !(field.options && field.options.length > 0)) {
      const checked = rawValue === true || rawValue === "true" || rawValue === "on";
      if (field.required && !checked) {
        return { ok: false, issue: { code: "required", label: field.label } };
      }
      normalized[field.id] = checked;
      continue;
    }
    if (field.type === "multiselect" || (field.type === "checkbox" && field.options && field.options.length > 0)) {
      const selected = (Array.isArray(rawValue) ? rawValue : [rawValue])
        .map((item) => normalizeText(item))
        .filter(Boolean);
      if (field.required && selected.length === 0) {
        return { ok: false, issue: { code: "required", label: field.label } };
      }
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (selected.some((item) => !allowed.has(item))) {
        return { ok: false, issue: { code: "invalid-option", label: field.label } };
      }
      normalized[field.id] = selected;
      continue;
    }
    const text = normalizeText(rawValue);
    if (field.required && !text) {
      return { ok: false, issue: { code: "required", label: field.label } };
    }
    if (text && (field.type === "radio" || field.type === "select")) {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (!allowed.has(text)) {
        return { ok: false, issue: { code: "invalid-option", label: field.label } };
      }
    }
    normalized[field.id] = text;
  }
  return { ok: true, values: normalized };
}

export function waitForOrchestratorClarification(
  scopeId: string,
  request: OrchestratorClarification,
  options: { timeoutMs?: number } = {},
): Promise<HumanInteractionSubmission> {
  abortOrchestratorClarification(scopeId);
  return new Promise((resolve) => {
    let settled = false;
    let clearWaitingTimeout = (): void => undefined;
    const finish = (submission: HumanInteractionSubmission): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearWaitingTimeout();
      resolve(submission);
    };
    const timeout = createInteractionTimeout(options.timeoutMs ?? 0, () => {
      const waiter = waiters.get(scopeId);
      if (!waiter || waiter.request.interactionId !== request.interactionId) {
        return;
      }
      waiters.delete(scopeId);
      finish({
        interactionId: request.interactionId,
        status: "completed",
        timedOut: true,
        values: {},
      });
    });
    clearWaitingTimeout = () => timeout.clear();
    waiters.set(scopeId, { request, resolve: finish });
  });
}

export function submitOrchestratorClarification(
  scopeId: string,
  interactionId: string,
  values: unknown,
): { ok: true } | { ok: false; reason: "missing" | "mismatch" | "invalid"; issue?: ClarificationSubmissionIssue } {
  const waiter = waiters.get(scopeId);
  if (!waiter) {
    return { ok: false, reason: "missing" };
  }
  if (waiter.request.interactionId !== interactionId) {
    return { ok: false, reason: "mismatch" };
  }
  const normalized = normalizeClarificationSubmission(waiter.request, values);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid", issue: normalized.issue };
  }
  waiters.delete(scopeId);
  waiter.resolve({
    interactionId,
    status: "completed",
    values: normalized.values,
  });
  return { ok: true };
}

export function rejectOrchestratorClarification(scopeId: string, interactionId: string): boolean {
  const waiter = waiters.get(scopeId);
  if (!waiter || waiter.request.interactionId !== interactionId) {
    return false;
  }
  waiters.delete(scopeId);
  waiter.resolve({
    interactionId,
    status: "aborted",
    values: {},
  });
  return true;
}

export function abortOrchestratorClarification(scopeId: string): void {
  const waiter = waiters.get(scopeId);
  if (!waiter) {
    return;
  }
  waiters.delete(scopeId);
  waiter.resolve({
    interactionId: waiter.request.interactionId,
    status: "aborted",
    values: {},
  });
}

function hasFieldList(value: Record<string, unknown>): boolean {
  return Array.isArray(value.formFields) || Array.isArray(value.fields) || Array.isArray(value.questions);
}

function readRawFields(source: Record<string, unknown>): unknown[] | null {
  for (const key of ["formFields", "fields", "questions"]) {
    if (Array.isArray(source[key])) {
      return source[key] as unknown[];
    }
  }
  return null;
}

function choiceFieldMissingOptions(field: HumanInteractionFormField): boolean {
  if (field.type === "radio" || field.type === "select" || field.type === "multiselect") {
    return !field.options || field.options.length === 0;
  }
  return false;
}

function trimText(value: unknown, maxLength: number): string {
  const text = normalizeText(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
