import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../webview/viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";

type ThinkingOption = {
  value: string;
  textContent: string;
};

type ThinkingSelect = {
  options: ThinkingOption[];
  value: string;
  disabled: boolean;
  title: string;
  innerHTML: string;
  appendChild(option: ThinkingOption): ThinkingOption;
};

type ThinkingState = {
  currentCli: string;
  thinkingMode: string;
  openCodeThinking: unknown;
};

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);
  const bodyStart = script.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${name} body was not terminated`);
}

function createThinkingSelect(): ThinkingSelect {
  let options: ThinkingOption[] = [];
  return {
    get options() {
      return options;
    },
    set options(value: ThinkingOption[]) {
      options = value;
    },
    value: "",
    disabled: false,
    title: "",
    get innerHTML() {
      return "";
    },
    set innerHTML(value: string) {
      assert.equal(value, "");
      options = [];
    },
    appendChild(option: ThinkingOption) {
      options.push(option);
      return option;
    },
  };
}

function buildThinkingSync(locale: "en" | "zh-CN") {
  const functionNames = [
    "normalizeOpenCodeThinkingPayload",
    "appendThinkingOption",
    "getOpenCodeThinkingOptionLabel",
    "getOpenCodeThinkingMessage",
    "syncOpenCodeThinkingOptions",
    "syncGenericThinkingOptions",
    "syncThinkingOptions",
  ];
  const functionSource = functionNames
    .map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name))
    .join("\n");
  const state: ThinkingState = {
    currentCli: "opencode",
    thinkingMode: "medium",
    openCodeThinking: null,
  };
  const thinkingMode = createThinkingSelect();
  const elements = { thinkingMode };
  const document = {
    createElement(tagName: string): ThinkingOption {
      assert.equal(tagName, "option");
      return { value: "", textContent: "" };
    },
  };
  const messages: unknown[] = [];
  const updateThinkingMode = (nextMode: string): void => {
    state.thinkingMode = nextMode;
    thinkingMode.value = nextMode;
    messages.push({ type: "updateSetting", key: "thinkingMode", value: nextMode });
  };
  const translations = WEBVIEW_I18N[locale] as Record<string, string>;
  const t = (key: string): string => translations[key] || key;
  const syncThinkingOptions = new Function(
    "state",
    "elements",
    "document",
    "t",
    "updateThinkingMode",
    `${functionSource}; return syncThinkingOptions;`,
  )(state, elements, document, t, updateThinkingMode) as () => void;

  return { state, thinkingMode, messages, syncThinkingOptions };
}

function optionPairs(select: ThinkingSelect): Array<[string, string]> {
  return select.options.map((option) => [option.value, option.textContent]);
}

function buildThinkingChangeHandler(currentCli: string) {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, "handleThinkingModeChange");
  const state = {
    currentCli,
    thinkingMode: "medium",
    openCodeThinking: { selectedVariant: "low" as string | null },
  };
  const messages: unknown[] = [];
  const vscode = {
    postMessage(message: unknown): void {
      messages.push(message);
    },
  };
  const handler = new Function(
    "state",
    "vscode",
    `${functionSource}; return handleThinkingModeChange;`,
  )(state, vscode) as (value: string) => void;
  return { handler, messages, state };
}

test("rebuilds OpenCode thinking options from each exact payload", () => {
  const harness = buildThinkingSync("en");
  harness.state.openCodeThinking = {
    selectedVariant: "turbo",
    options: [
      { value: "none", label: "ignored standard label" },
      { value: "low", label: "ignored low label" },
      { value: "turbo", label: "Turbo++", source: "config" },
    ],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.thinkingMode), [
    ["", "Default / Follow OpenCode"],
    ["none", "None"],
    ["low", "Low"],
    ["turbo", "Turbo++"],
  ]);
  assert.equal(harness.thinkingMode.value, "turbo");
  assert.equal(harness.thinkingMode.disabled, false);

  harness.state.openCodeThinking = {
    selectedVariant: "turbo",
    options: [{ value: "eco", label: "Eco" }],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.thinkingMode), [
    ["", "Default / Follow OpenCode"],
    ["eco", "Eco"],
  ]);
  assert.equal(harness.thinkingMode.value, "");
});

test("uses Default-only for unavailable or disabled OpenCode variants", () => {
  const emptyHarness = buildThinkingSync("en");
  emptyHarness.state.openCodeThinking = { selectedVariant: null, options: [] };
  emptyHarness.syncThinkingOptions();
  assert.deepEqual(optionPairs(emptyHarness.thinkingMode), [["", "Default / Follow OpenCode"]]);
  assert.equal(emptyHarness.thinkingMode.disabled, true);
  assert.equal(
    emptyHarness.thinkingMode.title,
    "Follow the OpenCode default for this model.",
  );

  const disabledHarness = buildThinkingSync("en");
  disabledHarness.state.openCodeThinking = {
    selectedVariant: "high",
    options: [{ value: "high", label: "High" }],
    disabled: true,
    message: "Variants disabled by provider",
  };
  disabledHarness.syncThinkingOptions();
  assert.deepEqual(optionPairs(disabledHarness.thinkingMode), [["", "Default / Follow OpenCode"]]);
  assert.equal(disabledHarness.thinkingMode.value, "");
  assert.equal(disabledHarness.thinkingMode.disabled, true);
  assert.equal(disabledHarness.thinkingMode.title, "Follow the OpenCode default for this model.");
});

test("localizes OpenCode status message keys and safely ignores legacy diagnostics", () => {
  const cases = [
    {
      messageKey: "follow-default",
      en: "Follow the OpenCode default for this model.",
      zh: "跟随此模型的 OpenCode 默认设置。",
    },
    {
      messageKey: "loading",
      en: "Reading variants declared for the selected OpenCode model.",
      zh: "正在读取所选 OpenCode 模型声明的 variants。",
    },
    {
      messageKey: "select-model",
      en: "Select an exact OpenCode provider/model to inspect available variants.",
      zh: "请选择明确的 OpenCode provider/model 以查看可用 variants。",
    },
    {
      messageKey: "metadata-error",
      en: "Unable to read OpenCode model metadata; following the OpenCode default.",
      zh: "无法读取 OpenCode 模型元数据，将跟随 OpenCode 默认设置。",
    },
    {
      messageKey: "no-variants",
      en: "This model does not declare adjustable OpenCode variants.",
      zh: "此模型未声明可调的 OpenCode variants。",
    },
    {
      messageKey: "config-variants",
      en: "Using variants declared by the active OpenCode config.",
      zh: "正在使用当前 OpenCode 配置声明的 variants。",
    },
  ];

  cases.forEach(({ messageKey, en, zh }) => {
    const englishHarness = buildThinkingSync("en");
    englishHarness.state.openCodeThinking = {
      selectedVariant: null,
      options: [],
      disabled: true,
      messageKey,
    };
    englishHarness.syncThinkingOptions();
    assert.equal(englishHarness.thinkingMode.title, en);

    const chineseHarness = buildThinkingSync("zh-CN");
    chineseHarness.state.openCodeThinking = {
      selectedVariant: null,
      options: [],
      disabled: true,
      messageKey,
    };
    chineseHarness.syncThinkingOptions();
    assert.equal(chineseHarness.thinkingMode.title, zh);
    assert.notEqual(chineseHarness.thinkingMode.title, en);
  });

  const fallbackHarness = buildThinkingSync("zh-CN");
  fallbackHarness.state.openCodeThinking = {
    selectedVariant: null,
    options: [],
    disabled: true,
    messageKey: "unknown-internal-status",
    message: "Raw English internal diagnostic",
  };
  fallbackHarness.syncThinkingOptions();
  assert.equal(fallbackHarness.thinkingMode.title, "跟随此模型的 OpenCode 默认设置。");
  assert.doesNotMatch(fallbackHarness.thinkingMode.title, /Raw English|internal diagnostic/);
});

test("localizes every standard OpenCode variant in English and Chinese", () => {
  const options = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "thinking"]
    .map((value) => ({ value, label: "ignored" }));
  const cases = [
    {
      locale: "en" as const,
      labels: ["None", "Minimal", "Low", "Medium", "High", "X-High", "Max", "Thinking"],
    },
    {
      locale: "zh-CN" as const,
      labels: ["无", "最小", "低", "中", "高", "超高", "最大", "思考"],
    },
  ];

  cases.forEach(({ locale, labels }) => {
    const harness = buildThinkingSync(locale);
    harness.state.openCodeThinking = { selectedVariant: "thinking", options };
    harness.syncThinkingOptions();
    assert.deepEqual(
      optionPairs(harness.thinkingMode).slice(1),
      options.map((option, index) => [option.value, labels[index]]),
    );
  });
});

test("preserves custom OpenCode labels and falls back to the variant name", () => {
  const harness = buildThinkingSync("zh-CN");
  harness.state.openCodeThinking = {
    selectedVariant: "custom",
    options: [
      { value: "custom", label: "自定义档" },
      { value: "raw-name", label: " " },
    ],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.thinkingMode), [
    ["", "默认 / 跟随 OpenCode"],
    ["custom", "自定义档"],
    ["raw-name", "raw-name"],
  ]);
});

test("keeps fixed Codex and Claude thinking mode behavior", () => {
  const codex = buildThinkingSync("en");
  codex.state.currentCli = "codex";
  codex.state.thinkingMode = "off";
  codex.syncThinkingOptions();
  assert.deepEqual(optionPairs(codex.thinkingMode).map(([value]) => value), [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.equal(codex.thinkingMode.value, "low");
  assert.deepEqual(codex.messages, [
    { type: "updateSetting", key: "thinkingMode", value: "low" },
  ]);

  const claude = buildThinkingSync("en");
  claude.state.currentCli = "claude";
  claude.state.thinkingMode = "max";
  claude.syncThinkingOptions();
  assert.deepEqual(optionPairs(claude.thinkingMode).map(([value]) => value), [
    "off",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.equal(claude.thinkingMode.value, "max");
  assert.deepEqual(claude.messages, []);
});

test("routes OpenCode variant changes separately from generic thinking settings", () => {
  const openCode = buildThinkingChangeHandler("opencode");
  openCode.handler("high");
  openCode.handler("");
  assert.deepEqual(openCode.messages, [
    { type: "updateOpenCodeVariant", value: "high" },
    { type: "updateOpenCodeVariant", value: null },
  ]);
  assert.equal(openCode.state.openCodeThinking.selectedVariant, null);

  const codex = buildThinkingChangeHandler("codex");
  codex.handler("xhigh");
  assert.deepEqual(codex.messages, [
    { type: "updateSetting", key: "thinkingMode", value: "xhigh" },
  ]);
  assert.equal(codex.state.thinkingMode, "xhigh");
});

test("applies the latest OpenCode thinking payload on every panel state", () => {
  assert.match(
    VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE,
    /state\.openCodeThinking = normalizeOpenCodeThinkingPayload\(panelState\.openCodeThinking\)/,
  );
  const handlerSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_EVENT_BINDINGS,
    "handleThinkingModeChange",
  );
  const genericBranchStart = handlerSource.indexOf("const nextMode");
  assert.notEqual(genericBranchStart, -1);
  assert.doesNotMatch(
    handlerSource.slice(0, genericBranchStart),
    /type: "updateSetting"|key: "thinkingMode"/,
  );
});
