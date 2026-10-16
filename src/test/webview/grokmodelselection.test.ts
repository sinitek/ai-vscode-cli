import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

type ThinkingOption = { value: string; textContent: string };
type ThinkingSelect = {
  options: ThinkingOption[];
  value: string;
  disabled: boolean;
  title: string;
  style: { display: string };
  innerHTML: string;
  appendChild(option: ThinkingOption): ThinkingOption;
};

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);
  const bodyStart = script.indexOf("{", start);
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

function optionPairs(select: ThinkingSelect): Array<[string, string]> {
  return select.options.map((option) => [option.value, option.textContent]);
}

function buildThinkingSync(cli: string, thinkingMode: string, interactiveMode = "coding") {
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
  const functionSource = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsLoopRoleModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isLoopRoleModelMode"),
    ...functionNames.map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name)),
  ].join("\n");
  const state = {
    currentCli: cli,
    thinkingMode,
    interactiveMode,
    selectedLoopThinkingByCli: {},
    openCodeThinking: null as unknown,
    openCodeSmallThinking: null as unknown,
  };
  const thinking = createThinkingSelect();
  const elements = {
    thinkingMode: thinking,
    openCodePrimaryThinkingMode: createThinkingSelect(),
    openCodeSmallThinkingMode: createThinkingSelect(),
    codexLoopMainThinkingMode: createThinkingSelect(),
    codexLoopSubtaskThinkingMode: createThinkingSelect(),
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
    thinking.value = nextMode;
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
  return { state, thinking, messages, syncThinkingOptions };
}

const GROK_THINKING_OPTIONS: Array<[string, string]> = [
  ["off", "off"],
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
  ["max", "max"],
  ["ultra", "ultra"],
];

test("Grok thinking options keep xhigh, max, and ultra", () => {
  for (const mode of ["coding", "loop", "graph", "loop_plus"]) {
    const savedMax = buildThinkingSync("grok", "max", mode);
    savedMax.syncThinkingOptions();
    assert.deepEqual(optionPairs(savedMax.thinking), GROK_THINKING_OPTIONS);
    assert.equal(savedMax.thinking.value, "max");
    assert.deepEqual(savedMax.messages, []);
    assert.equal(savedMax.thinking.style.display, "");

    const savedUltra = buildThinkingSync("grok", "ultra", mode);
    savedUltra.syncThinkingOptions();
    assert.equal(savedUltra.thinking.value, "ultra");
    assert.deepEqual(savedUltra.messages, []);
  }

  const codex = buildThinkingSync("codex", "off");
  codex.syncThinkingOptions();
  assert.deepEqual(optionPairs(codex.thinking), GROK_THINKING_OPTIONS.slice(1));
  assert.equal(codex.thinking.value, "low");

  const claude = buildThinkingSync("claude", "max");
  claude.syncThinkingOptions();
  assert.deepEqual(optionPairs(claude.thinking), GROK_THINKING_OPTIONS);
  assert.equal(claude.thinking.value, "max");
  assert.deepEqual(claude.messages, []);

  const other = buildThinkingSync("gemini", "xhigh");
  other.syncThinkingOptions();
  assert.deepEqual(optionPairs(other.thinking), GROK_THINKING_OPTIONS.slice(0, 4));
  assert.equal(other.state.thinkingMode, "high");
  const otherMax = buildThinkingSync("gemini", "max");
  otherMax.syncThinkingOptions();
  assert.equal(otherMax.state.thinkingMode, "high");
});

function styleTarget() {
  return { style: { display: "" }, disabled: false, value: "" };
}

test("Grok uses the single model select in every mode and posts the existing model messages", () => {
  const source = [
    "let hidden = false;",
    "function hideAddModelDialog() { hidden = true; }",
    "function getLoopExecutionModeForCli() { return \"main_sub_multi_agent\"; }",
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsManagedModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsLoopRoleModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isLoopRoleModelMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isOpenCodeRoleModelMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "syncModelSelectorByInteractiveMode"),
    "return { syncModelSelectorByInteractiveMode, cliSupportsManagedModelSelection, isLoopRoleModelMode, hideCount: () => hidden };",
  ].join("\n");
  const state = { currentCli: "grok", interactiveMode: "coding" };
  const elements = {
    codexLoopModelGroup: styleTarget(),
    codexLoopMainModelSelect: styleTarget(),
    codexLoopSubtaskModelSelect: styleTarget(),
    codexLoopMainThinkingMode: styleTarget(),
    codexLoopSubtaskThinkingMode: styleTarget(),
    openCodeModelGroup: styleTarget(),
    openCodePrimaryModelSelect: styleTarget(),
    openCodeSmallModelSelect: Object.assign(styleTarget(), { parentElement: styleTarget() }),
    modelSelect: styleTarget(),
    loopExecutionModeSelect: styleTarget(),
  };
  const runner = new Function(
    "state",
    "elements",
    `${source}`,
  )(state, elements) as {
    syncModelSelectorByInteractiveMode: () => void;
    cliSupportsManagedModelSelection: (cli?: string) => boolean;
    isLoopRoleModelMode: (cli?: string, mode?: string) => boolean;
  };
  assert.equal(runner.cliSupportsManagedModelSelection("grok"), true);
  assert.equal(runner.cliSupportsManagedModelSelection("codex"), true);
  assert.equal(runner.cliSupportsManagedModelSelection("claude"), false);
  for (const mode of ["coding", "loop", "graph", "loop_plus"]) {
    state.interactiveMode = mode;
    runner.syncModelSelectorByInteractiveMode();
    assert.equal(runner.isLoopRoleModelMode("grok", mode), false);
    assert.equal(elements.modelSelect.style.display, "");
    assert.equal(elements.modelSelect.disabled, false);
    assert.equal(elements.codexLoopModelGroup.style.display, "none");
  }
  state.currentCli = "claude";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(elements.modelSelect.style.display, "none");

  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "selectCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "addCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "renameCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "deleteCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "moveCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /configId: getCurrentModelConfigId\(\)/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /function appendCodexThinkingOptions\(selectElement\) \{\s*appendThinkingOption\(selectElement, "low", "low"\);/);
});
