export type HumanInteractionFieldType =
  | "text"
  | "password"
  | "textarea"
  | "radio"
  | "checkbox"
  | "select"
  | "multiselect";

export type HumanInteractionOption = {
  label: string;
  value: string;
  description?: string;
};

export type HumanInteractionFormField = {
  id: string;
  label: string;
  type: HumanInteractionFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: HumanInteractionOption[];
  defaultValue?: unknown;
};

export type HumanInteractionRequest = {
  interactionId: string;
  tabId: string;
  title: string;
  instruction: string;
  formFields: HumanInteractionFormField[];
  submitLabel: string;
  cancelLabel: string;
};

export type HumanInteractionSubmissionStatus = "completed" | "aborted";

export type HumanInteractionSubmission = {
  interactionId: string;
  tabId?: string;
  status: HumanInteractionSubmissionStatus;
  values: Record<string, unknown>;
};

export type CodexHumanInteractionRequest = {
  method: string;
  params?: unknown;
  fallbackInteractionId: string;
  tabId: string;
};

export type CodexHumanInteractionResolution = {
  result: unknown;
};

export type NaturalLanguageHumanInteractionInput = {
  tabId: string;
  fallbackInteractionId: string;
  userPrompt: string;
  assistantText: string;
};

type NaturalLanguageClarificationQuestion = {
  label: string;
  type: HumanInteractionFieldType;
  options: HumanInteractionOption[];
};

export class HumanInteractionRejectedError extends Error {
  public readonly code = "HUMAN_INTERACTION_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "HumanInteractionRejectedError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function stripFinalAnswerMarker(value: string): string {
  return value.replace(/^\s*\[final_answer\]\s*/i, "").trim();
}

function hasExplicitClarificationIntent(userPrompt: string): boolean {
  const prompt = normalizeText(userPrompt).toLowerCase();
  if (!prompt) {
    return false;
  }
  const asksMe = /(问我|詢問我|问一下我|向我确认|让我补充|讓我補充|让我回答|讓我回答)/.test(prompt)
    || /\bask\s+me\b/.test(prompt)
    || /\bquestion(?:s)?\s+for\s+me\b/.test(prompt);
  const asksForRequirements = /(要求|需求|细节|細節|偏好|条件|條件|信息|澄清|确认|確認)/.test(prompt)
    || /\b(requirements?|details?|preference(?:s)?|clarif(?:y|ication)|context|constraints?)\b/.test(prompt);
  return asksMe && asksForRequirements;
}

function cleanClarificationQuestion(value: string): string {
  return value
    .replace(/^\s*[*_`#>\-]+\s*/g, "")
    .replace(/\s*[*_`]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitClarificationLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line
      .replace(/\s+(?=(?:\d{1,2}[.、．)）]|[（(]\d{1,2}[)）]|[一二三四五六七八九十]{1,3}[.、．])\s*)/gu, "\n")
      .split("\n"))
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseClarificationQuestionLine(line: string): string {
  const numbered = line.match(/^(?:[-*]\s*)?(?:\d{1,2}[.、．)）]|[（(]\d{1,2}[)）]|[一二三四五六七八九十]{1,3}[.、．])\s*(.+)$/);
  const bulletedQuestion = line.match(/^[-*]\s+(.+[?？].*)$/);
  return cleanClarificationQuestion(numbered?.[1] ?? bulletedQuestion?.[1] ?? "");
}

function isNaturalLanguageOptionLine(line: string): boolean {
  return /^(?:[-*•]\s*)?[A-Ha-h][.、．)）]\s+\S/u.test(line.trim());
}

function collectClarificationQuestions(assistantText: string): string[] {
  const normalized = stripFinalAnswerMarker(assistantText);
  const seen = new Set<string>();
  const questions: string[] = [];
  const lines = splitClarificationLines(normalized);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const question = parseClarificationQuestionLine(line);
    if (!question || seen.has(question)) {
      continue;
    }
    const blockLines = [question];
    let optionCursor = index + 1;
    while (optionCursor < lines.length) {
      const nextLine = lines[optionCursor] ?? "";
      if (parseClarificationQuestionLine(nextLine)) {
        break;
      }
      if (!isNaturalLanguageOptionLine(nextLine)) {
        break;
      }
      blockLines.push(nextLine);
      optionCursor += 1;
    }
    const questionBlock = cleanClarificationQuestion(blockLines.join(" "));
    seen.add(question);
    questions.push(questionBlock);
    index = optionCursor - 1;
    if (questions.length >= 8) {
      break;
    }
  }
  if (questions.length > 0) {
    return questions;
  }
  const inlineQuestions = normalized
    .split(/(?<=[?？])\s+/)
    .map(cleanClarificationQuestion)
    .filter((item) => /[?？]/.test(item));
  for (const question of inlineQuestions) {
    if (seen.has(question)) {
      continue;
    }
    seen.add(question);
    questions.push(question);
    if (questions.length >= 8) {
      break;
    }
  }
  return questions;
}

function isQuestionListLike(assistantText: string, questions: readonly string[]): boolean {
  const text = stripFinalAnswerMarker(assistantText);
  if (!text) {
    return false;
  }
  if (questions.length >= 2) {
    return true;
  }
  const questionMarkCount = (text.match(/[?？]/g) ?? []).length;
  return questionMarkCount >= 2
    && /(请|可以|回复|选择|告诉我|补充|需求|要求|answer|choose|tell me|reply)/i.test(text);
}

function cleanNaturalLanguageOptionLabel(value: string): string {
  return value
    .replace(/^\s*(?:[-*•]\s*)?(?:[A-Ha-h]|\d{1,2})[.、．)）]\s*/u, "")
    .replace(/^\s*(?:推荐|首选|默认|recommended)[:：]\s*/iu, "")
    .replace(/^[“”"'‘’`]+|[“”"'‘’`]+$/g, "")
    .replace(/[。.!！?？；;，,、]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNaturalLanguageOptions(value: string): HumanInteractionOption[] {
  const normalized = value
    .replace(/(?:^|\s)(?:[A-Ha-h]|\d{1,2})[.、．)）]\s*/gu, "、")
    .replace(/\s+(?:and|or)\s+/giu, "、")
    .replace(/(?:还是|或者|或)/gu, "、")
    .replace(/[\/|｜]/gu, "、");
  const seen = new Set<string>();
  const options: HumanInteractionOption[] = [];
  normalized
    .split(/[、，,；;\n]+/u)
    .map(cleanNaturalLanguageOptionLabel)
    .filter(Boolean)
    .forEach((label) => {
      const dedupeKey = label.toLowerCase();
      if (seen.has(dedupeKey) || label.length > 60) {
        return;
      }
      seen.add(dedupeKey);
      options.push({ value: label, label });
    });
  return options.length >= 2 ? options.slice(0, 6) : [];
}

function buildLetteredNaturalLanguageOptions(value: string): HumanInteractionOption[] {
  const seen = new Set<string>();
  const options: HumanInteractionOption[] = [];
  const optionPattern = /(?:^|\s)(?:[-*•]\s*)?[A-Ha-h][.、．)）]\s*([\s\S]*?)(?=(?:\s+(?:[-*•]\s*)?[A-Ha-h][.、．)）]\s*)|$)/gu;
  for (const match of value.matchAll(optionPattern)) {
    const label = cleanNaturalLanguageOptionLabel(match[1] ?? "");
    const dedupeKey = label.toLowerCase();
    if (!label || seen.has(dedupeKey) || label.length > 80) {
      continue;
    }
    seen.add(dedupeKey);
    options.push({ value: label, label });
    if (options.length >= 8) {
      break;
    }
  }
  return options.length >= 2 ? options : [];
}

function cleanNaturalLanguageQuestionLabel(value: string): string {
  return cleanClarificationQuestion(value)
    .replace(/[（(]\s*[）)]/gu, "")
    .replace(/[：:，,；;]\s*$/u, "")
    .trim();
}

function extractLetteredOptions(question: string): { label: string; options: HumanInteractionOption[] } | null {
  const match = question.match(/(?:^|\s)(?:[-*•]\s*)?[A-Ha-h][.、．)）]\s*\S/u);
  if (!match) {
    return null;
  }
  const optionStart = (match.index ?? 0) + (match[0].match(/^\s/u) ? 1 : 0);
  const label = cleanNaturalLanguageQuestionLabel(question.slice(0, optionStart));
  if (!label) {
    return null;
  }
  const options = buildLetteredNaturalLanguageOptions(question.slice(optionStart));
  if (!options.length) {
    return null;
  }
  return { label, options };
}

function extractParentheticalOptions(question: string): { label: string; options: HumanInteractionOption[] } | null {
  for (const match of question.matchAll(/[（(]([^（）()]+)[）)]/gu)) {
    const fullMatch = match[0] ?? "";
    const content = match[1] ?? "";
    if (!/(可选|选项|选择|候选|参考|例如|比如|如|推荐|options?|examples?)/iu.test(content)) {
      continue;
    }
    const optionSource = content
      .replace(/^\s*(?:可选|选项|选择|候选|参考选项|例如|比如|如|推荐|options?|examples?)[:：]?\s*/iu, "");
    const options = buildNaturalLanguageOptions(optionSource);
    if (!options.length) {
      continue;
    }
    return {
      label: cleanNaturalLanguageQuestionLabel(question.replace(fullMatch, "")) || question,
      options,
    };
  }
  return null;
}

function extractInlineOptions(question: string): { label: string; options: HumanInteractionOption[] } | null {
  const match = question.match(/(^|[\s，,；;。.!！?？])(?:可选|选项|选择|候选|参考选项|例如|比如|如|推荐|options?|examples?)[:：]\s*(.+)$/iu);
  if (!match?.[2]) {
    return null;
  }
  const options = buildNaturalLanguageOptions(match[2]);
  if (!options.length) {
    return null;
  }
  const delimiter = match[1] ?? "";
  const keepsDelimiter = /^[。.!！?？]$/u.test(delimiter);
  const labelEnd = (match.index ?? 0) + (keepsDelimiter ? delimiter.length : 0);
  const label = cleanNaturalLanguageQuestionLabel(question.slice(0, labelEnd).replace(/[，,；;\s]+$/u, ""));
  return {
    label: label || question,
    options,
  };
}

function inferNaturalLanguageOptionFieldType(label: string, options: readonly HumanInteractionOption[]): HumanInteractionFieldType {
  if (!options.length) {
    return "textarea";
  }
  return /(多选|可多选|可以多选|多个|哪几|哪些|包含|包括|元素|意象|关键词|限制|要求有哪些)/u.test(label)
    ? "checkbox"
    : "radio";
}

function parseNaturalLanguageClarificationQuestion(question: string): NaturalLanguageClarificationQuestion {
  const parsed = extractLetteredOptions(question) ?? extractParentheticalOptions(question) ?? extractInlineOptions(question);
  const label = cleanNaturalLanguageQuestionLabel(parsed?.label ?? question) || question;
  const options = parsed?.options ?? [];
  return {
    label,
    type: inferNaturalLanguageOptionFieldType(label, options),
    options,
  };
}

function normalizeFieldType(value: unknown, hasOptions: boolean): HumanInteractionFieldType {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "text"
    || normalized === "password"
    || normalized === "textarea"
    || normalized === "radio"
    || normalized === "checkbox"
    || normalized === "select"
    || normalized === "multiselect"
  ) {
    return normalized;
  }
  return hasOptions ? "radio" : "textarea";
}

function normalizeOptions(value: unknown): HumanInteractionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: HumanInteractionOption[] = [];
  value.forEach((item) => {
    const record = asRecord(item);
    const valueText = firstText(record.value, record.id, record.key, record.label, item);
    if (!valueText || seen.has(valueText)) {
      return;
    }
    seen.add(valueText);
    result.push({
      value: valueText,
      label: firstText(record.label, record.title, record.name, valueText) || valueText,
      ...(firstText(record.description, record.help, record.detail) ? {
        description: firstText(record.description, record.help, record.detail),
      } : {}),
    });
  });
  return result;
}

function normalizeField(rawField: unknown, index: number): HumanInteractionFormField | null {
  const field = asRecord(rawField);
  const options = normalizeOptions(field.options ?? field.choices ?? field.suggestedOptions);
  const id = firstText(field.id, field.name, field.key, `answer_${index + 1}`)
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!id) {
    return null;
  }
  const type = normalizeFieldType(field.type ?? field.inputType, options.length > 0);
  return {
    id,
    label: firstText(field.label, field.question, field.header, field.title, id) || id,
    type,
    required: field.required !== false,
    ...(firstText(field.placeholder) ? { placeholder: firstText(field.placeholder) } : {}),
    ...(firstText(field.description, field.help, field.detail) ? {
      description: firstText(field.description, field.help, field.detail),
    } : {}),
    ...(options.length ? { options } : {}),
    ...(Object.prototype.hasOwnProperty.call(field, "defaultValue") ? { defaultValue: field.defaultValue } : {}),
  };
}

function pickRequestPayload(params: unknown): Record<string, unknown> {
  const record = asRecord(params);
  for (const key of ["request", "input", "payload", "item", "elicitation"]) {
    const nested = asRecord(record[key]);
    if (Object.keys(nested).length > 0) {
      return { ...record, ...nested };
    }
  }
  return record;
}

function collectRawFields(payload: Record<string, unknown>): unknown[] {
  for (const key of ["formFields", "fields", "questions", "schema"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
    const record = asRecord(value);
    if (Array.isArray(record.fields)) {
      return record.fields;
    }
    if (Array.isArray(record.questions)) {
      return record.questions;
    }
  }
  return [];
}

export function normalizeHumanInteractionRequestFromCodex(
  input: CodexHumanInteractionRequest,
): HumanInteractionRequest {
  const payload = pickRequestPayload(input.params);
  const interactionId = firstText(
    payload.interactionId,
    payload.requestId,
    payload.id,
    input.fallbackInteractionId,
  );
  const title = firstText(payload.title, payload.header, payload.name, "需要补充信息");
  const instruction = firstText(
    payload.instruction,
    payload.message,
    payload.prompt,
    payload.question,
    payload.description,
    "AI 需要你补充以下信息后继续执行当前 Vibe 任务。",
  );
  const rawFields = collectRawFields(payload);
  const formFields = rawFields
    .map((field, index) => normalizeField(field, index))
    .filter((field): field is HumanInteractionFormField => Boolean(field));
  const fallbackField: HumanInteractionFormField = {
    id: "answer",
    label: firstText(payload.question, payload.label, "补充信息"),
    type: "textarea",
    required: true,
    placeholder: firstText(payload.placeholder, "请输入补充信息..."),
  };
  return {
    interactionId,
    tabId: input.tabId,
    title,
    instruction,
    formFields: formFields.length ? formFields : [fallbackField],
    submitLabel: firstText(payload.submitLabel, payload.confirmLabel, "提交"),
    cancelLabel: firstText(payload.cancelLabel, payload.rejectLabel, "拒绝"),
  };
}

export function buildNaturalLanguageHumanInteractionRequest(
  input: NaturalLanguageHumanInteractionInput,
): HumanInteractionRequest | null {
  if (!hasExplicitClarificationIntent(input.userPrompt)) {
    return null;
  }
  const questions = collectClarificationQuestions(input.assistantText);
  if (!isQuestionListLike(input.assistantText, questions)) {
    return null;
  }
  const formFields: HumanInteractionFormField[] = questions.length > 0
    ? questions.map((question, index): HumanInteractionFormField => {
        const parsed = parseNaturalLanguageClarificationQuestion(question);
        return {
          id: `answer_${index + 1}`,
          label: parsed.label,
          type: parsed.type,
          required: true,
          ...(parsed.options.length ? { options: parsed.options } : { placeholder: "请输入你的要求..." }),
        };
      })
    : [{
        id: "answer",
        label: "补充要求",
        type: "textarea",
        required: true,
        placeholder: "请输入你的要求...",
      }];
  return {
    interactionId: input.fallbackInteractionId,
    tabId: input.tabId,
    title: "补充需求",
    instruction: "AI 需要你补充以下信息后继续执行当前 Vibe 任务。",
    formFields,
    submitLabel: "提交",
    cancelLabel: "拒绝",
  };
}

export function formatHumanInteractionSubmittedText(
  submission: HumanInteractionSubmission,
  formFields: readonly HumanInteractionFormField[] = [],
): string {
  if (submission.status === "aborted") {
    return "用户已拒绝补充信息。";
  }
  const values = asRecord(submission.values);
  const lines = formFields
    .map((field) => {
      if (!Object.prototype.hasOwnProperty.call(values, field.id)) {
        return "";
      }
      const rawValue = values[field.id];
      const valueParts = (Array.isArray(rawValue) ? rawValue : [rawValue])
        .map((item) => normalizeText(item))
        .filter(Boolean);
      if (!valueParts.length) {
        return "";
      }
      const optionLabels = new Map(
        (field.options ?? []).map((option) => [option.value, option.label] as const),
      );
      const displayValue = field.type === "password"
        ? "已隐藏"
        : valueParts.map((item) => optionLabels.get(item) ?? item).join("、");
      return `${field.label || field.id}：${displayValue}`;
    })
    .filter(Boolean);
  return lines.length
    ? ["已提交补充信息：", ...lines].join("\n")
    : "已提交补充信息。";
}

export function buildCodexHumanInteractionResolution(
  method: string,
  submission: HumanInteractionSubmission,
): CodexHumanInteractionResolution {
  const text = formatHumanInteractionSubmittedText(submission);
  if (method === "mcpServer/elicitation/request") {
    return {
      result: {
        action: "accept",
        content: submission.values,
        _meta: { text },
      },
    };
  }
  return {
    result: {
      answers: submission.values,
      result: { values: submission.values },
      text,
    },
  };
}

export function createHumanInteractionRejectedError(): HumanInteractionRejectedError {
  return new HumanInteractionRejectedError("User rejected the human interaction request.");
}

export function isHumanInteractionRejectedErrorInfo(info: { code?: unknown; name?: unknown; message?: unknown }): boolean {
  return info.code === "HUMAN_INTERACTION_REJECTED"
    || info.name === "HumanInteractionRejectedError"
    || /human interaction request/i.test(String(info.message ?? ""));
}
