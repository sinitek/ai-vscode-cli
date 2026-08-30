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
  style: { display: string };
  innerHTML: string;
  appendChild(option: ThinkingOption): ThinkingOption;
};

type ThinkingState = {
  currentCli: string;
  thinkingMode: string;
  interactiveMode?: string;
  selectedLoopThinkingByCli?: Record<string, { main?: string | null; subtask?: string | null }>;
  openCodeThinking: unknown;
  openCodeSmallThinking?: unknown;
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
    style: { display: "" },
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
    "normalizeThinkingModeSelection",
    "normalizeOpenCodeThinkingPayload",
    "appendThinkingOption",
    "getOpenCodeThinkingOptionLabel",
    "getOpenCodeThinkingMessage",
    "syncOpenCodeThinkingSelect",
    "getSelectedLoopRoleThinkingModeForCli",
    "getVisibleLoopRoleThinkingModeForCli",
    "appendCodexThinkingOptions",
    "updateCodexLoopRoleThinkingSelect",
    "updateCodexLoopThinkingSelectOptions",
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
    interactiveMode: "coding",
    openCodeThinking: null,
    openCodeSmallThinking: null,
  };
  const thinkingMode = createThinkingSelect();
  const openCodePrimaryThinkingMode = createThinkingSelect();
  const openCodeSmallThinkingMode = createThinkingSelect();
  const codexLoopMainThinkingMode = createThinkingSelect();
  const codexLoopSubtaskThinkingMode = createThinkingSelect();
  const elements = {
    thinkingMode,
    openCodePrimaryThinkingMode,
    openCodeSmallThinkingMode,
    codexLoopMainThinkingMode,
    codexLoopSubtaskThinkingMode,
  };
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

  return { state, thinkingMode, openCodePrimaryThinkingMode, openCodeSmallThinkingMode, messages, syncThinkingOptions };
}

function optionPairs(select: ThinkingSelect): Array<[string, string]> {
  return select.options.map((option) => [option.value, option.textContent]);
}

function buildThinkingChangeHandler(
  currentCli: string,
  configuredDefaultVariant: string | null = null,
) {
  const functionSource = [
    "getOpenCodeCompatModelRole",
    "handleOpenCodeThinkingModeChange",
    "handleThinkingModeChange",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, name)).join("\n");
  const state = {
    currentCli,
    thinkingMode: "medium",
    openCodeThinking: {
      selectedVariant: "low" as string | null,
      configuredDefaultVariant,
    },
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
    configuredDefaultVariant: "low",
    options: [
      { value: "none", label: "ignored standard label" },
      { value: "low", label: "ignored low label" },
      { value: "turbo", label: "Turbo++", source: "config" },
    ],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.openCodePrimaryThinkingMode), [
    ["none", "none"],
    ["low", "low"],
    ["turbo", "turbo"],
  ]);
  assert.equal(harness.openCodePrimaryThinkingMode.value, "turbo");
  assert.equal(harness.openCodePrimaryThinkingMode.disabled, false);
  assert.equal(harness.openCodePrimaryThinkingMode.style.display, "");
  assert.equal(harness.thinkingMode.style.display, "none");

  harness.state.openCodeThinking = {
    selectedVariant: "turbo",
    configuredDefaultVariant: "eco",
    options: [{ value: "eco", label: "Eco" }],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.openCodePrimaryThinkingMode), [["eco", "eco"]]);
  assert.equal(harness.openCodePrimaryThinkingMode.value, "eco");
});

test("shows only the configured real default variant without an explicit override", () => {
  const harness = buildThinkingSync("zh-CN");
  harness.state.openCodeThinking = {
    selectedVariant: null,
    configuredDefaultVariant: "xhigh",
    options: [{ value: "xhigh", label: "ignored" }],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.openCodePrimaryThinkingMode), [["xhigh", "xhigh"]]);
  assert.equal(harness.openCodePrimaryThinkingMode.value, "xhigh");
  assert.deepEqual(harness.messages, []);
});

test("keeps no selection when OpenCode has no mapped default variant", () => {
  const harness = buildThinkingSync("en");
  harness.state.openCodeThinking = {
    selectedVariant: null,
    configuredDefaultVariant: "missing",
    options: [{ value: "xhigh", label: "ignored" }],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.openCodePrimaryThinkingMode), [["xhigh", "xhigh"]]);
  assert.equal(harness.openCodePrimaryThinkingMode.value, "");
  assert.deepEqual(harness.messages, []);
});

test("uses no visible options for unavailable or disabled OpenCode variants", () => {
  const emptyHarness = buildThinkingSync("en");
  emptyHarness.state.openCodeThinking = { selectedVariant: null, options: [] };
  emptyHarness.syncThinkingOptions();
  assert.deepEqual(optionPairs(emptyHarness.openCodePrimaryThinkingMode), []);
  assert.equal(emptyHarness.openCodePrimaryThinkingMode.disabled, true);
  assert.equal(
    emptyHarness.openCodePrimaryThinkingMode.title,
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
  assert.deepEqual(optionPairs(disabledHarness.openCodePrimaryThinkingMode), []);
  assert.equal(disabledHarness.openCodePrimaryThinkingMode.value, "");
  assert.equal(disabledHarness.openCodePrimaryThinkingMode.disabled, true);
  assert.equal(disabledHarness.openCodePrimaryThinkingMode.title, "Follow the OpenCode default for this model.");
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
    assert.equal(englishHarness.openCodePrimaryThinkingMode.title, en);

    const chineseHarness = buildThinkingSync("zh-CN");
    chineseHarness.state.openCodeThinking = {
      selectedVariant: null,
      options: [],
      disabled: true,
      messageKey,
    };
    chineseHarness.syncThinkingOptions();
    assert.equal(chineseHarness.openCodePrimaryThinkingMode.title, zh);
    assert.notEqual(chineseHarness.openCodePrimaryThinkingMode.title, en);
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
  assert.equal(fallbackHarness.openCodePrimaryThinkingMode.title, "跟随此模型的 OpenCode 默认设置。");
  assert.doesNotMatch(fallbackHarness.openCodePrimaryThinkingMode.title, /Raw English|internal diagnostic/);
});

test("renders every standard OpenCode variant as its raw value in English and Chinese", () => {
  const options = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "ultra", "max", "thinking"]
    .map((value) => ({ value, label: "ignored" }));
  (["en", "zh-CN"] as const).forEach((locale) => {
    const harness = buildThinkingSync(locale);
    harness.state.openCodeThinking = { selectedVariant: "thinking", options };
    harness.syncThinkingOptions();
    assert.deepEqual(
      optionPairs(harness.openCodePrimaryThinkingMode),
      options.map((option) => [option.value, option.value]),
    );
  });
});

test("preserves custom OpenCode dynamic value order while using raw values", () => {
  const harness = buildThinkingSync("zh-CN");
  harness.state.openCodeThinking = {
    selectedVariant: "custom-after",
    options: [
      { value: "custom-before", label: "自定义档" },
      { value: "ultra", label: "Provider ultra" },
      { value: "max", label: "Provider max" },
      { value: "custom-after", label: " " },
    ],
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.openCodePrimaryThinkingMode), [
    ["custom-before", "custom-before"],
    ["ultra", "ultra"],
    ["max", "max"],
    ["custom-after", "custom-after"],
  ]);
  assert.equal(harness.openCodePrimaryThinkingMode.value, "custom-after");
});

test("keeps fixed Codex and Claude thinking modes raw while retaining legacy max", () => {
  const codex = buildThinkingSync("zh-CN");
  codex.state.currentCli = "codex";
  codex.state.thinkingMode = "off";
  codex.syncThinkingOptions();
  assert.deepEqual(optionPairs(codex.thinkingMode), [
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
    ["ultra", "ultra"],
  ]);
  assert.equal(codex.thinkingMode.value, "low");
  assert.deepEqual(codex.messages, [
    { type: "updateSetting", key: "thinkingMode", value: "low" },
  ]);

  const claude = buildThinkingSync("zh-CN");
  claude.state.currentCli = "claude";
  claude.state.thinkingMode = "max";
  claude.syncThinkingOptions();
  assert.deepEqual(optionPairs(claude.thinkingMode), [
    ["off", "off"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
    ["ultra", "ultra"],
  ]);
  assert.equal(claude.thinkingMode.value, "max");
  assert.deepEqual(claude.messages, []);
});

test("routes OpenCode variant changes separately from generic thinking settings", () => {
  const openCode = buildThinkingChangeHandler("opencode", "xhigh");
  openCode.handler("xhigh");
  assert.equal(openCode.state.openCodeThinking.selectedVariant, null);
  openCode.handler("high");
  assert.deepEqual(openCode.messages, [
    { type: "updateOpenCodeVariant", role: "primary", modelRole: "main", value: null },
    { type: "updateOpenCodeVariant", role: "primary", modelRole: "main", value: "high" },
  ]);
  assert.equal(openCode.state.openCodeThinking.selectedVariant, "high");

  const codex = buildThinkingChangeHandler("codex");
  codex.handler("xhigh");
  codex.handler("ultra");
  assert.deepEqual(codex.messages, [
    { type: "updateSetting", key: "thinkingMode", value: "xhigh" },
    { type: "updateSetting", key: "thinkingMode", value: "ultra" },
  ]);
  assert.equal(codex.state.thinkingMode, "ultra");
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

test("refreshes variants only when the OpenCode primary model changes", () => {
  const handlerSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_EVENT_BINDINGS,
    "handleOpenCodeRoleModelChange",
  );
  const roleHelperSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_EVENT_BINDINGS,
    "getOpenCodeCompatModelRole",
  );
  const messages: unknown[] = [];
  let thinkingSyncCount = 0;
  const state: any = {
    selectedConfigId: "config-a",
    openCodeModels: {
      selectedPrimaryRef: null,
      selectedSmallRef: null,
    },
    openCodeThinking: {
      selectedVariant: "high",
      configuredDefaultVariant: "high",
      options: [{ value: "high", label: "High" }],
      disabled: false,
      messageKey: "config-variants",
    },
    openCodeSmallThinking: {
      selectedVariant: "low",
      configuredDefaultVariant: "low",
      options: [{ value: "low", label: "Low" }],
      disabled: false,
      messageKey: "config-variants",
    },
  };
  const handler = new Function(
    "state",
    "vscode",
    "syncThinkingOptions",
    `${roleHelperSource}; ${handlerSource}; return handleOpenCodeRoleModelChange;`,
  )(
    state,
    { postMessage(message: unknown) { messages.push(message); } },
    () => { thinkingSyncCount += 1; },
  ) as (role: "main" | "subtask", value: string) => void;

  handler("subtask", "myAPI/small-task");
  assert.equal(state.openCodeThinking.selectedVariant, "high");
  assert.deepEqual(state.openCodeSmallThinking, {
    selectedVariant: null,
    configuredDefaultVariant: null,
    options: [],
    disabled: true,
    messageKey: "loading",
  });
  assert.equal(thinkingSyncCount, 1);

  handler("main", "myAPI/main-chat");
  assert.deepEqual(state.openCodeThinking, {
    selectedVariant: null,
    configuredDefaultVariant: null,
    options: [],
    disabled: true,
    messageKey: "loading",
  });
  assert.equal(thinkingSyncCount, 2);
  assert.deepEqual(messages, [
    { type: "updateOpenCodeRoleModel", role: "small", modelRole: "subtask", value: "myAPI/small-task", configId: "config-a" },
    { type: "updateOpenCodeRoleModel", role: "primary", modelRole: "main", value: "myAPI/main-chat", configId: "config-a" },
  ]);
});
