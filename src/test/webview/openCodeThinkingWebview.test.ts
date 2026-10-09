import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../../webview/viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

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

function buildThinkingSync() {
  const functionNames = [
    "normalizeThinkingModeSelection",
    "normalizeOpenCodeThinkingPayload",
    "appendThinkingOption",
    "isOpenCodeThinkingEffort",
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
  const translations = WEBVIEW_STRINGS as Record<string, string>;
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

const CODEX_THINKING_OPTIONS: Array<[string, string]> = [
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
  ["max", "max"],
  ["ultra", "ultra"],
];

test("uses the same OpenCode thinking options as Codex without config variants", () => {
  const harness = buildThinkingSync();
  harness.state.openCodeThinking = {
    selectedVariant: "turbo",
    configuredDefaultVariant: "low",
    options: [
      { value: "none", label: "ignored standard label" },
      { value: "low", label: "ignored low label" },
      { value: "turbo", label: "Turbo++", source: "config" },
    ],
    disabled: true,
    messageKey: "config-variants",
  };
  harness.syncThinkingOptions();

  assert.deepEqual(optionPairs(harness.openCodePrimaryThinkingMode), CODEX_THINKING_OPTIONS);
  assert.equal(harness.openCodePrimaryThinkingMode.value, "medium");
  assert.equal(harness.openCodePrimaryThinkingMode.disabled, false);
  assert.equal(harness.openCodePrimaryThinkingMode.style.display, "");
  assert.equal(harness.openCodePrimaryThinkingMode.title, WEBVIEW_STRINGS.openCodePrimaryThinkingModeAria);
  assert.equal(harness.thinkingMode.style.display, "none");
  assert.deepEqual(optionPairs(harness.openCodeSmallThinkingMode), CODEX_THINKING_OPTIONS);
  assert.equal(harness.openCodeSmallThinkingMode.disabled, false);
});

test("keeps a stored OpenCode effort and falls back to medium", () => {
  const selected = buildThinkingSync();
  selected.state.openCodeThinking = {
    selectedVariant: "xhigh",
    configuredDefaultVariant: "low",
    options: [],
    disabled: true,
    messageKey: "no-variants",
  };
  selected.syncThinkingOptions();
  assert.equal(selected.openCodePrimaryThinkingMode.value, "xhigh");
  assert.deepEqual(optionPairs(selected.openCodePrimaryThinkingMode), CODEX_THINKING_OPTIONS);
  assert.deepEqual(selected.messages, []);

  const fallback = buildThinkingSync();
  fallback.state.openCodeThinking = {
    selectedVariant: null,
    configuredDefaultVariant: "custom",
    options: [{ value: "custom", label: "Custom" }],
  };
  fallback.syncThinkingOptions();
  assert.equal(fallback.openCodePrimaryThinkingMode.value, "medium");
  assert.equal(fallback.openCodePrimaryThinkingMode.disabled, false);
});

test("keeps fixed Codex and Claude thinking modes raw while retaining legacy max", () => {
  const codex = buildThinkingSync();
  codex.state.currentCli = "codex";
  codex.state.thinkingMode = "off";
  codex.syncThinkingOptions();
  assert.deepEqual(optionPairs(codex.thinkingMode), CODEX_THINKING_OPTIONS);
  assert.equal(codex.thinkingMode.value, "low");
  assert.deepEqual(codex.messages, [
    { type: "updateSetting", key: "thinkingMode", value: "low" },
  ]);

  const claude = buildThinkingSync();
  claude.state.currentCli = "claude";
  claude.state.thinkingMode = "max";
  claude.syncThinkingOptions();
  assert.deepEqual(optionPairs(claude.thinkingMode), [
    ["off", "off"],
    ...CODEX_THINKING_OPTIONS,
  ]);
  assert.equal(claude.thinkingMode.value, "max");
  assert.deepEqual(claude.messages, []);
});

test("routes OpenCode variant changes separately from generic thinking settings", () => {
  const openCode = buildThinkingChangeHandler("opencode", "xhigh");
  openCode.handler("xhigh");
  assert.equal(openCode.state.openCodeThinking.selectedVariant, "xhigh");
  openCode.handler("high");
  assert.deepEqual(openCode.messages, [
    { type: "updateOpenCodeVariant", role: "primary", modelRole: "main", value: "xhigh" },
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

test("keeps OpenCode thinking selectable when the role model changes", () => {
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
    },
    openCodeSmallThinking: {
      selectedVariant: "low",
      configuredDefaultVariant: "low",
      options: [{ value: "low", label: "Low" }],
      disabled: false,
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
    disabled: false,
  });
  assert.equal(thinkingSyncCount, 1);

  handler("main", "myAPI/main-chat");
  assert.deepEqual(state.openCodeThinking, {
    selectedVariant: null,
    configuredDefaultVariant: null,
    options: [],
    disabled: false,
  });
  assert.equal(thinkingSyncCount, 2);
  assert.deepEqual(messages, [
    { type: "updateOpenCodeRoleModel", role: "small", modelRole: "subtask", value: "myAPI/small-task", configId: "config-a" },
    { type: "updateOpenCodeRoleModel", role: "primary", modelRole: "main", value: "myAPI/main-chat", configId: "config-a" },
  ]);
});
