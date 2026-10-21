import {
  HUMAN_INTERACTION_TIMEOUT_TEXT,
  type HumanInteractionFormField,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "../humanInteraction";

export const GROK_USER_QUESTION_METHOD = "_x.ai/ask_user_question";

export type GrokUserQuestion = {
  question: string;
  options: { label: string; description?: string; preview?: string }[];
  multiSelect: boolean;
};

export type GrokUserQuestionParams = {
  sessionId: string;
  toolCallId?: string;
  questions: GrokUserQuestion[];
};

export type GrokUserQuestionResponse =
  | { outcome: "accepted"; answers: Record<string, string[]> }
  | { outcome: "cancelled" };

export function isGrokUserQuestionMethod(method: string): boolean {
  return method === GROK_USER_QUESTION_METHOD || method === "x.ai/ask_user_question";
}

export function readGrokUserQuestionResponse(value: unknown): GrokUserQuestionResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.outcome === "cancelled") {
    return { outcome: "cancelled" };
  }
  if (record.outcome !== "accepted" || !record.answers || typeof record.answers !== "object" || Array.isArray(record.answers)) {
    return null;
  }
  const answers = Object.entries(record.answers);
  if (answers.some(([, answer]) => !Array.isArray(answer) || answer.some((item) => typeof item !== "string"))) {
    return null;
  }
  return { outcome: "accepted", answers: Object.fromEntries(answers) };
}

export function readGrokUserQuestionParams(value: unknown): GrokUserQuestionParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()
    || !Array.isArray(record.questions) || !record.questions.length) {
    return null;
  }
  const questions: GrokUserQuestion[] = [];
  for (const rawQuestion of record.questions) {
    if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
      return null;
    }
    const question = rawQuestion as Record<string, unknown>;
    const multiSelect = question.multiSelect ?? question.multi_select ?? false;
    if (typeof question.question !== "string" || !question.question.trim()
      || !Array.isArray(question.options) || typeof multiSelect !== "boolean") {
      return null;
    }
    const options: GrokUserQuestion["options"] = [];
    for (const rawOption of question.options) {
      if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
        return null;
      }
      const option = rawOption as Record<string, unknown>;
      if (typeof option.label !== "string" || !option.label.trim()) {
        return null;
      }
      options.push({
        label: option.label,
        ...(typeof option.description === "string" ? { description: option.description } : {}),
        ...(typeof option.preview === "string" ? { preview: option.preview } : {}),
      });
    }
    questions.push({ question: question.question, options, multiSelect });
  }
  return {
    sessionId: record.sessionId,
    ...(typeof record.toolCallId === "string" ? { toolCallId: record.toolCallId } : {}),
    questions,
  };
}

export function normalizeHumanInteractionRequestFromGrok(input: {
  params: unknown;
  fallbackInteractionId: string;
  tabId: string;
}): HumanInteractionRequest {
  const params = readGrokUserQuestionParams(input.params);
  if (!params) {
    throw new Error("无效的 Grok 提问参数");
  }
  const formFields: HumanInteractionFormField[] = [];
  params.questions.forEach((question, index) => {
    const id = `answer_${index + 1}`;
    formFields.push({
      id,
      label: question.question,
      type: question.options.length ? question.multiSelect ? "checkbox" : "radio" : "textarea",
      required: !question.options.length,
      ...(question.options.length ? {
        options: question.options.map((option) => ({
          label: option.label,
          value: option.label,
          description: [option.description, option.preview].filter(Boolean).join("\n\n"),
        })),
      } : { placeholder: "请输入你的回答..." }),
    });
    if (question.options.length) {
      formFields.push({
        id: `${id}_other`,
        label: `第 ${index + 1} 题的其他回答（可选）`,
        type: "textarea",
        required: false,
        placeholder: question.multiSelect ? "可填写其他选项，和已选项一起提交" : "填写后将以此回答代替已选项",
      });
    }
  });
  return {
    interactionId: input.fallbackInteractionId,
    tabId: input.tabId,
    title: "需要补充信息",
    instruction: "请选择答案，或填写对应的其他回答后继续执行当前任务。",
    formFields,
    submitLabel: "提交并继续",
    cancelLabel: "拒绝",
  };
}

export function buildGrokHumanInteractionResolution(
  params: unknown,
  submission: HumanInteractionSubmission,
): { result: GrokUserQuestionResponse } {
  const request = readGrokUserQuestionParams(params);
  if (!request) {
    throw new Error("无效的 Grok 提问参数");
  }
  if (submission.status === "aborted") {
    return { result: { outcome: "cancelled" } };
  }
  const answers = new Map<string, string[]>();
  request.questions.forEach((question, index) => {
    if (submission.timedOut) {
      answers.set(question.question, [HUMAN_INTERACTION_TIMEOUT_TEXT]);
      return;
    }
    const id = `answer_${index + 1}`;
    const value = submission.values[id];
    const selected = (Array.isArray(value) ? value : [value])
      .filter((answer): answer is string => typeof answer === "string" && Boolean(answer.trim()))
      .filter((answer) => !question.options.length || question.options.some((option) => option.label === answer));
    const other = submission.values[`${id}_other`];
    const custom = typeof other === "string" ? other.trim() : "";
    const answer = question.multiSelect
      ? [...new Set([...selected, ...(custom ? [custom] : [])])]
      : custom ? [custom] : selected.slice(0, 1);
    if (answer.length) {
      answers.set(question.question, answer);
    }
  });
  return { result: answers.size ? { outcome: "accepted", answers: Object.fromEntries(answers) } : { outcome: "cancelled" } };
}
