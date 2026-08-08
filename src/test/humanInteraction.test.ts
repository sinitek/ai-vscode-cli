import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildNaturalLanguageHumanInteractionRequest,
  buildCodexHumanInteractionResolution,
  createHumanInteractionRejectedError,
  formatHumanInteractionSubmittedText,
  isHumanInteractionRejectedErrorInfo,
  normalizeHumanInteractionRequestFromCodex,
  type HumanInteractionFormField,
} from "../humanInteraction";

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

test("does not build natural-language requests without explicit user clarification intent", () => {
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

test("builds Codex request resolutions for app-server and MCP elicitation methods", () => {
  assert.deepEqual(
    buildCodexHumanInteractionResolution("item/tool/requestUserInput", {
      interactionId: "ask-1",
      status: "completed",
      values: { answer: "yes" },
    }),
    {
      result: {
        answers: { answer: "yes" },
        result: { values: { answer: "yes" } },
        text: "已提交补充信息。",
      },
    },
  );

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

test("identifies human interaction rejection errors", () => {
  const error = createHumanInteractionRejectedError();
  assert.equal(isHumanInteractionRejectedErrorInfo(error), true);
  assert.equal(isHumanInteractionRejectedErrorInfo({ message: "User rejected the human interaction request." }), true);
  assert.equal(isHumanInteractionRejectedErrorInfo({ message: "ordinary failure" }), false);
});
