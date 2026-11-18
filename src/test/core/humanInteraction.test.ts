import test = require("node:test");
import assert = require("node:assert/strict");

import {
  HUMAN_INTERACTION_TIMEOUT_TEXT,
  buildNaturalLanguageHumanInteractionRequest,
  buildCodexHumanInteractionResolution,
  buildTimedOutHumanInteractionSubmission,
  createHumanInteractionRejectedError,
  formatHumanInteractionSubmittedText,
  isHumanInteractionRejectedErrorInfo,
  normalizeHumanInteractionRequestFromCodex,
  type HumanInteractionFormField,
} from "../../humanInteraction";

test("normalizes Codex human interaction requests with structured fields", () => {
  const request = normalizeHumanInteractionRequestFromCodex({
    method: "item/tool/requestUserInput",
    fallbackInteractionId: "fallback-id",
    tabId: "tab-1",
    params: {
      request: {
        id: "ask-1",
        title: "Need input",
        message: "Choose deployment scope.",
        fields: [
          {
            id: "scope",
            label: "Scope",
            type: "select",
            required: true,
            options: [
              { value: "api", label: "API" },
              { value: "web", label: "Web" },
            ],
          },
        ],
        submitLabel: "Continue",
        cancelLabel: "Stop",
      },
    },
  });

  assert.equal(request.interactionId, "ask-1");
  assert.equal(request.tabId, "tab-1");
  assert.equal(request.title, "Need input");
  assert.equal(request.instruction, "Choose deployment scope.");
  assert.equal(request.submitLabel, "Continue");
  assert.equal(request.cancelLabel, "Stop");
  assert.deepEqual(request.formFields, [
    {
      id: "scope",
      label: "Scope",
      type: "select",
      required: true,
      options: [
        { value: "api", label: "API" },
        { value: "web", label: "Web" },
      ],
    },
  ]);
});

test("falls back to a required textarea when no form schema is present", () => {
  const request = normalizeHumanInteractionRequestFromCodex({
    method: "mcpServer/elicitation/request",
    fallbackInteractionId: "fallback-id",
    tabId: "tab-2",
    params: { question: "What should I do next?" },
  });

  assert.equal(request.interactionId, "fallback-id");
  assert.equal(request.formFields.length, 1);
  assert.deepEqual(request.formFields[0], {
    id: "answer",
    label: "What should I do next?",
    type: "textarea",
    required: true,
    placeholder: "请输入补充信息...",
  });
});

test("builds natural-language human interaction requests for explicit clarification prompts", () => {
  const request = buildNaturalLanguageHumanInteractionRequest({
    tabId: "tab-poem",
    fallbackInteractionId: "natural-1",
    userPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
    assistantText: [
      "[final_answer] 可以。请先回答：",
      "1. 主题是什么？",
      "2. 希望是什么风格？",
      "3. 篇幅大概多长？",
    ].join("\n"),
  });

  assert.ok(request);
  assert.equal(request.interactionId, "natural-1");
  assert.equal(request.tabId, "tab-poem");
  assert.equal(request.title, "补充需求");
  assert.deepEqual(
    request.formFields.map((field) => ({ id: field.id, label: field.label, type: field.type })),
    [
      { id: "answer_1", label: "主题是什么？", type: "textarea" },
      { id: "answer_2", label: "希望是什么风格？", type: "textarea" },
      { id: "answer_3", label: "篇幅大概多长？", type: "textarea" },
    ],
  );
});

test("builds option fields from natural-language clarification choices", () => {
  const request = buildNaturalLanguageHumanInteractionRequest({
    tabId: "tab-poem-options",
    fallbackInteractionId: "natural-options-1",
    userPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
    assistantText: [
      "[final_answer] 可以。请先回答：",
      "1. 主题方向？（可选：爱情、自然、人生）",
      "2. 风格想要哪种？选项：古风 / 现代 / 自由诗",
      "3. 想包含哪些意象？（如：月亮、海、山）",
    ].join("\n"),
  });

  assert.ok(request);
  assert.deepEqual(
    request.formFields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      options: field.options?.map((option) => option.label) ?? [],
    })),
    [
      {
        id: "answer_1",
        label: "主题方向？",
        type: "radio",
        options: ["爱情", "自然", "人生"],
      },
      {
        id: "answer_2",
        label: "风格想要哪种？",
        type: "radio",
        options: ["古风", "现代", "自由诗"],
      },
      {
        id: "answer_3",
        label: "想包含哪些意象？",
        type: "checkbox",
        options: ["月亮", "海", "山"],
      },
    ],
  );
});

test("builds option fields from lettered natural-language clarification choices", () => {
  const request = buildNaturalLanguageHumanInteractionRequest({
    tabId: "tab-poem-lettered-options",
    fallbackInteractionId: "natural-lettered-options-1",
    userPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
    assistantText: [
      "[final_answer] 可以。你按下面格式回复选项即可，比如：1A 2C 3B。",
      "1. **主题想写什么？**",
      "A. 爱情 / 思念",
      "B. 人生 / 成长",
      "C. 自然 / 四季",
      "D. 城市 / 远方",
      "2. **情绪基调？** A. 温柔治愈 B. 孤独克制 C. 热烈浪漫",
      "3. **想包含哪些意象？**",
      "A. 月亮",
      "B. 海",
      "C. 山",
    ].join("\n"),
  });

  assert.ok(request);
  assert.deepEqual(
    request.formFields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      options: field.options?.map((option) => option.label) ?? [],
    })),
    [
      {
        id: "answer_1",
        label: "主题想写什么？",
        type: "radio",
        options: ["爱情 / 思念", "人生 / 成长", "自然 / 四季", "城市 / 远方"],
      },
      {
        id: "answer_2",
        label: "情绪基调？",
        type: "radio",
        options: ["温柔治愈", "孤独克制", "热烈浪漫"],
      },
      {
        id: "answer_3",
        label: "想包含哪些意象？",
        type: "checkbox",
        options: ["月亮", "海", "山"],
      },
    ],
  );
});

const acceptanceClarificationQuestion = "“撤销验收”希望如何处理？";
const acceptanceClarificationOptions = [
  "本次交付不再验收：记录撤销原因并移出待验收队列（推荐）",
  "撤回已有验收结论：恢复为待验收，重新审查",
];

for (const [format, prefix] of [
  ["plain", (_index: number) => ""],
  ["bullets", (_index: number) => "- "],
  ["numbered", (index: number) => `${index + 1}. `],
  ["lettered", (index: number) => `${String.fromCharCode(65 + index)}. `],
] as const) {
  test(`converts a single implicit clarification with ${format} choices and preserves full option text`, () => {
    const request = buildNaturalLanguageHumanInteractionRequest({
      tabId: "tab-acceptance",
      fallbackInteractionId: "acceptance-question",
      userPrompt: "增加撤销验收功能",
      assistantText: [
        `[final_answer] ${acceptanceClarificationQuestion}`,
        "",
        ...acceptanceClarificationOptions.map((option, index) => `${prefix(index)}${option}`),
      ].join("\r\n"),
    });

    assert.ok(request);
    assert.equal(request.formFields.length, 1);
    assert.deepEqual(request.formFields[0], {
      id: "answer_1",
      label: acceptanceClarificationQuestion,
      type: "radio",
      required: true,
      options: acceptanceClarificationOptions.map((label) => ({ value: label, label })),
    });
  });
}

test("converts single open-ended clarification and keeps choices with punctuation intact", () => {
  for (const userPrompt of ["部署应用", "先问我需要补充哪些信息"]) {
    const request = buildNaturalLanguageHumanInteractionRequest({
      tabId: "tab-deploy",
      fallbackInteractionId: "deploy-question",
      userPrompt,
      assistantText: "[final_answer] 请提供目标环境的名称？",
    });
    assert.equal(request?.formFields[0]?.type, "textarea");
    assert.equal(request?.formFields[0]?.label, "请提供目标环境的名称？");
  }
  const request = buildNaturalLanguageHumanInteractionRequest({
    tabId: "tab-deploy",
    fallbackInteractionId: "deploy-choice",
    userPrompt: "部署应用",
    assistantText: "请先确认部署范围：\n希望选择哪个环境？\n- 开发 / 测试，保留数据或日志\n- 生产，重新审查\n请回复你的选择。",
  });
  assert.deepEqual(request?.formFields[0]?.options?.map((option) => option.label), [
    "开发 / 测试，保留数据或日志", "生产，重新审查",
  ]);
});

test("converts a single explicit open question without requiring a second question", () => {
  const request = buildNaturalLanguageHumanInteractionRequest({
    tabId: "tab-topic",
    fallbackInteractionId: "topic-question",
    userPrompt: "先问我写作需求",
    assistantText: "[final_answer] 主题是什么？",
  });
  assert.equal(request?.formFields[0]?.label, "主题是什么？");
});

test("does not reinterpret quoted questions as forms even with explicit clarification intent", () => {
  for (const wrapper of ["> ", "```text\n"]) {
    assert.equal(buildNaturalLanguageHumanInteractionRequest({
      tabId: "tab-example",
      fallbackInteractionId: "example-question",
      userPrompt: "先问我需求细节",
      assistantText: `${wrapper}1. 希望哪个方案？\n2. 希望哪种环境？`,
    }), null);
  }
});

test("converts multiple implicit decisions into separate form fields", () => {
  const request = buildNaturalLanguageHumanInteractionRequest({
    tabId: "tab-acceptance",
    fallbackInteractionId: "multiple-decisions",
    userPrompt: "增加撤销验收功能",
    assistantText: [
      `1. ${acceptanceClarificationQuestion}`,
      ...acceptanceClarificationOptions.map((option) => `- ${option}`),
      "2. 哪些角色可以操作？",
      "- 管理员",
      "- 验收负责人",
    ].join("\n"),
  });
  assert.deepEqual(request?.formFields.map((field) => [field.type, field.options?.length]), [
    ["radio", 2], ["checkbox", 2],
  ]);
});

for (const [name, assistantText] of [
  ["rhetorical closing", "[final_answer] 秋风起，你喜欢这样的意象吗？"],
  ["completed result", `[final_answer] 已实现撤销验收功能。\n${acceptanceClarificationQuestion}\n${acceptanceClarificationOptions.join("\n")}`],
  ["quoted question", `> ${acceptanceClarificationQuestion}\n> ${acceptanceClarificationOptions.join("\n> ")}`],
  ["code example", `\`\`\`text\n${acceptanceClarificationQuestion}\n${acceptanceClarificationOptions.join("\n")}\n\`\`\``],
  ["document example", `界面文案示例：\n${acceptanceClarificationQuestion}\n${acceptanceClarificationOptions.join("\n")}`],
  ["explanation", "撤销验收是什么？\n移出待验收队列\n恢复为待验收"],
  ["incomplete choice list", `${acceptanceClarificationQuestion}\n只有一个选项`],
  ["duplicate choices", `${acceptanceClarificationQuestion}\n相同选项\n相同选项`],
] as const) {
  test(`does not open a clarification form for ${name}`, () => {
    assert.equal(buildNaturalLanguageHumanInteractionRequest({
      tabId: "tab-result",
      fallbackInteractionId: "result-question",
      userPrompt: "增加撤销验收功能",
      assistantText,
    }), null);
  });
}

test("does not convert rhetorical questions in ordinary final answers", () => {
  assert.equal(
    buildNaturalLanguageHumanInteractionRequest({
      tabId: "tab-normal",
      fallbackInteractionId: "natural-2",
      userPrompt: "写一首关于秋天的诗",
      assistantText: "[final_answer] 秋风起，你喜欢这样的意象吗？",
    }),
    null,
  );
});

test("formats submitted values with labels and hides passwords", () => {
  const fields: HumanInteractionFormField[] = [
    { id: "path", label: "Path", type: "text" },
    { id: "secret", label: "Secret", type: "password" },
    {
      id: "targets",
      label: "Targets",
      type: "checkbox",
      options: [
        { value: "api", label: "API" },
        { value: "web", label: "Web" },
      ],
    },
  ];

  assert.equal(
    formatHumanInteractionSubmittedText({
      interactionId: "ask-1",
      status: "completed",
      values: {
        path: "src/index.ts",
        secret: "token",
        targets: ["api", "web"],
      },
    }, fields),
    [
      "已提交补充信息：",
      "Path：src/index.ts",
      "Secret：已隐藏",
      "Targets：API、Web",
    ].join("\n"),
  );
});

test("encodes every Codex request-user-input answer with the app-server schema", () => {
  assert.deepEqual(
    buildCodexHumanInteractionResolution("item/tool/requestUserInput", {
      interactionId: "ask-1",
      status: "completed",
      values: {
        scope: "webview",
        targets: ["desktop", "mobile"],
        notes: null,
      },
    }),
    {
      result: {
        answers: {
          scope: { answers: ["webview"] },
          targets: { answers: ["desktop", "mobile"] },
          notes: { answers: [] },
        },
      },
    },
  );
});

test("keeps MCP elicitation responses on the action-content contract", () => {
  assert.deepEqual(
    buildCodexHumanInteractionResolution("mcpServer/elicitation/request", {
      interactionId: "ask-2",
      status: "completed",
      values: { answer: "go" },
    }),
    {
      result: {
        action: "accept",
        content: { answer: "go" },
        _meta: { text: "已提交补充信息。" },
      },
    },
  );
});

test("formats an unanswered human interaction as best-effort continuation", () => {
  const submission = buildTimedOutHumanInteractionSubmission({
    interactionId: "ask-timeout",
    tabId: "tab-1",
    formFields: [
      { id: "scope", label: "Scope", type: "radio", options: [{ label: "API", value: "api" }] },
      { id: "note", label: "Note", type: "textarea" },
    ],
  });
  assert.equal(submission.status, "completed");
  assert.equal(submission.timedOut, true);
  assert.equal(submission.values.scope, "api");
  assert.equal(formatHumanInteractionSubmittedText(submission, [
    { id: "scope", label: "Scope", type: "radio", options: [{ label: "API", value: "api" }] },
  ]), `${HUMAN_INTERACTION_TIMEOUT_TEXT}\n已提交补充信息：\nScope：API`);
  assert.deepEqual(buildCodexHumanInteractionResolution("item/tool/requestUserInput", submission), {
    result: {
      answers: {
        scope: { answers: ["api"] },
        note: { answers: [HUMAN_INTERACTION_TIMEOUT_TEXT] },
      },
    },
  });
  assert.deepEqual(buildCodexHumanInteractionResolution("mcpServer/elicitation/request", submission).result, {
    action: "accept",
    content: submission.values,
    _meta: { text: `${HUMAN_INTERACTION_TIMEOUT_TEXT}\n已提交补充信息。` },
  });
});

test("uses valid defaults before the first option for automatic selections", () => {
  const submission = buildTimedOutHumanInteractionSubmission({
    interactionId: "ask-defaults",
    tabId: "tab-1",
    formFields: [
      { id: "mode", label: "模式", type: "radio", defaultValue: "safe", options: [{ label: "重写", value: "rewrite" }, { label: "兼容", value: "safe" }] },
      { id: "targets", label: "目标", type: "multiselect", options: [{ label: "桌面", value: "desktop" }] },
      { id: "confirmed", label: "确认", type: "checkbox" },
    ],
  });
  assert.deepEqual(submission.values, { mode: "safe", targets: ["desktop"], confirmed: true });
});

test("identifies human interaction rejection errors", () => {
  const error = createHumanInteractionRejectedError();
  assert.equal(isHumanInteractionRejectedErrorInfo(error), true);
  assert.equal(isHumanInteractionRejectedErrorInfo({ message: "User rejected the human interaction request." }), true);
  assert.equal(isHumanInteractionRejectedErrorInfo({ message: "ordinary failure" }), false);
});
