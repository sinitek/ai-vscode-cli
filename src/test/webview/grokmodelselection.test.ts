import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "../../webview/viewContentScript/coreBootstrap";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { INPUT_CONTROLS_STYLES } from "../../webview/viewContentStyles/inputControls";
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

test("Grok dropdowns expose only configured models and retain Codex default/manage options", () => {
  const modelSelect = createThinkingSelect();
  const roleSelect = createThinkingSelect();
  const state = {
    currentCli: "grok",
    selectedModel: "gpt-6.1-sol",
    modelsByCli: { grok: ["grok", "gpt-6.1-sol"], codex: ["gpt-6.1-sol"] },
    modelLabelsByCli: { grok: { grok: "grok-4.7", "gpt-6.1-sol": "gpt-6.1-sol" } },
  };
  const source = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getModelsForCurrentCli"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getModelOptionLabel"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliUsesConfigDeclaredModels"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsManagedModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "canOpenModelManagerDialog"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getCliLoopModelSelectAria"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getNoConfiguredModelLabel"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "updateModelSelectOptions"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "updateCodexLoopRoleModelSelect"),
    "return { updateModelSelectOptions, updateCodexLoopRoleModelSelect };",
  ].join("\n");
  const renderer = new Function(
    "state", "elements", "document", "t", "MODEL_MANAGE_OPTION_VALUE",
    "getLoopRoleModelsForCli", "getSelectedLoopRoleModelForCli", source,
  )(
    state,
    { modelSelect },
    { createElement: () => ({ value: "", textContent: "" }) },
    (key: keyof typeof WEBVIEW_STRINGS) => WEBVIEW_STRINGS[key],
    "__manage__",
    () => state.modelsByCli.grok,
    () => "gpt-6.1-sol",
  ) as { updateModelSelectOptions: () => void; updateCodexLoopRoleModelSelect: (select: ThinkingSelect, role: string) => void };
  renderer.updateModelSelectOptions();
  assert.deepEqual(optionPairs(modelSelect), [["grok", "grok-4.7"], ["gpt-6.1-sol", "gpt-6.1-sol"]]);
  assert.equal(modelSelect.value, "gpt-6.1-sol");
  renderer.updateCodexLoopRoleModelSelect(roleSelect, "main");
  assert.deepEqual(optionPairs(roleSelect), optionPairs(modelSelect));
  assert.equal(roleSelect.value, "gpt-6.1-sol");
  renderer.updateCodexLoopRoleModelSelect(roleSelect, "subtask");
  assert.deepEqual(optionPairs(roleSelect), optionPairs(modelSelect));
  state.modelLabelsByCli.grok.grok = "updated-model";
  renderer.updateModelSelectOptions();
  assert.equal(modelSelect.options[0].textContent, "updated-model");
  state.modelLabelsByCli.grok.grok = "";
  renderer.updateModelSelectOptions();
  assert.equal(modelSelect.options[0].textContent, "grok");
  state.modelsByCli.grok = [];
  renderer.updateModelSelectOptions();
  assert.deepEqual(optionPairs(modelSelect), [["", WEBVIEW_STRINGS.grokNoConfiguredModel]]);
  state.currentCli = "codex";
  renderer.updateModelSelectOptions();
  assert.deepEqual(modelSelect.options.map((option) => option.value), ["", "gpt-6.1-sol", "__manage__"]);
  assert.doesNotMatch(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /modelRefreshButton|grok-model-refresh-row/);
  assert.doesNotMatch(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /modelRefreshButton/);
  assert.doesNotMatch(buildWebviewStaticHtml.toString(), /modelRefreshButton|model-refresh-button/);
  assert.doesNotMatch(INPUT_CONTROLS_STYLES, /model-refresh-button|grok-model-refresh-row/);
});

test("DSH dropdown exposes ordered configured models without the generic manager", () => {
  const modelSelect = createThinkingSelect();
  const messages: Array<Record<string, unknown>> = [];
  const state = {
    currentCli: "dsh",
    selectedModel: "vendor/second-model",
    selectedModelsByCli: { dsh: "vendor/second-model" },
    selectedConfigId: "dsh-profile",
    configState: { activeConfigId: "dsh-profile" },
    modelsByCli: { dsh: ["vendor/first-model", "vendor/second-model"] },
    modelLabelsByCli: { dsh: { "vendor/first-model": "vendor/first-model", "vendor/second-model": "vendor/second-model" } },
  };
  const source = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getModelsForCurrentCli"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getModelOptionLabel"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliUsesConfigDeclaredModels"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsManagedModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "canOpenModelManagerDialog"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getCurrentModelConfigId"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getCliLoopModelSelectAria"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getNoConfiguredModelLabel"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "handleModelSelectChange"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "updateModelSelectOptions"),
    "return { handleModelSelectChange, updateModelSelectOptions };",
  ].join("\n");
  const renderer = new Function(
    "state", "elements", "document", "t", "MODEL_MANAGE_OPTION_VALUE", "vscode", source,
  )(
    state,
    { modelSelect },
    { createElement: () => ({ value: "", textContent: "" }) },
    (key: keyof typeof WEBVIEW_STRINGS) => WEBVIEW_STRINGS[key],
    "__manage__",
    { postMessage: (message: Record<string, unknown>) => messages.push(message) },
  ) as { handleModelSelectChange: (value: string) => void; updateModelSelectOptions: () => void };

  renderer.updateModelSelectOptions();
  assert.deepEqual(optionPairs(modelSelect), [
    ["", WEBVIEW_STRINGS.modelOptionDefault],
    ["vendor/first-model", "vendor/first-model"],
    ["vendor/second-model", "vendor/second-model"],
  ]);
  assert.equal(modelSelect.value, "vendor/second-model");
  renderer.handleModelSelectChange("vendor/first-model");
  assert.equal(state.selectedModel, "vendor/first-model");
  assert.equal(state.selectedModelsByCli.dsh, "vendor/first-model");
  assert.deepEqual(messages, [{
    type: "selectCliModel",
    cli: "dsh",
    model: "vendor/first-model",
    configId: "dsh-profile",
  }]);
  assert.equal(modelSelect.options.some((option) => option.value === "__manage__"), false);
});

test("Grok label snapshots refresh with their config and clear when models are removed", () => {
  const state = {
    currentCli: "grok",
    selectedConfigId: "profile",
    configState: { activeConfigId: "profile" },
    modelLabelsByCli: {} as Record<string, Record<string, string>>,
  };
  const functionNames = [
    "normalizeModelNameList",
    "normalizeModelSelection",
    "normalizeLoopRoleModelsPayload",
    "normalizeLoopRoleSelectionPayload",
    "normalizeLoopRoleThinkingPayload",
    "shouldPreserveCurrentCliModelsOnEmptySnapshot",
    "applyModelState",
  ];
  const source = functionNames
    .map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name))
    .join("\n");
  const applyModelState = new Function("state", "CLI_NAMES", `${source}\nreturn applyModelState;`)(state, ["grok"]) as
    (snapshot: unknown, cli: string) => void;
  const snapshot = {
    optionsByCli: { grok: ["sol", "secondary"] },
    labelsByCli: { grok: { sol: "gpt-6.1-sol", secondary: "gpt-6.1-sol" } },
    selectedByCli: { grok: "secondary" },
  };
  applyModelState(snapshot, "grok");
  assert.deepEqual(state.modelLabelsByCli.grok, { sol: "gpt-6.1-sol", secondary: "gpt-6.1-sol" });
  applyModelState({ ...snapshot, labelsByCli: { grok: { sol: "updated", secondary: "gpt-6.1-sol" } } }, "grok");
  assert.equal(state.modelLabelsByCli.grok.sol, "updated");
  state.configState.activeConfigId = "";
  applyModelState({ optionsByCli: { grok: [] } }, "grok");
  assert.equal(state.modelLabelsByCli.grok.sol, "updated");
  state.configState.activeConfigId = "profile";
  applyModelState({ optionsByCli: { grok: [] } }, "grok");
  assert.deepEqual(state.modelLabelsByCli.grok, {});
  applyModelState(snapshot, "grok");
  applyModelState({ optionsByCli: { grok: ["sol"] } }, "grok");
  assert.deepEqual(state.modelLabelsByCli.grok, {});
});

test("Grok config keys remain case-sensitive while Codex keeps case-insensitive deduplication", () => {
  const normalize = new Function(
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeModelNameList")
      + "\nreturn normalizeModelNameList;",
  )() as (models: string[], caseSensitive?: boolean) => string[];
  assert.deepEqual(normalize(["Sol", "sol", "Sol"], true), ["Sol", "sol"]);
  assert.deepEqual(normalize(["Sol", "sol", "Sol"]), ["Sol"]);
});

function buildThinkingSync(cli: string, thinkingMode: string, interactiveMode = "coding") {
  const functionNames = [
    "normalizeThinkingModeSelection",
    "normalizeOpenCodeThinkingPayload",
    "appendThinkingOption",
    "isOpenCodeThinkingEffort",
    "syncOpenCodeThinkingSelect",
    "getSelectedLoopRoleThinkingModeForCli",
    "getVisibleLoopRoleThinkingModeForCli",
    "getCliLoopThinkingAria",
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
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliUsesConfigDeclaredModels"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getCliLoopModelSelectAria"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getNoConfiguredModelLabel"),
    ...functionNames.map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name)),
  ].join("\n");
  const state = {
    currentCli: cli,
    thinkingMode,
    interactiveMode,
    selectedLoopThinkingByCli: {} as Record<string, { main?: string; subtask?: string }>,
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
  return { state, elements, thinking, messages, syncThinkingOptions };
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

const CODEX_ROLE_THINKING_OPTIONS = GROK_THINKING_OPTIONS.slice(1);

test("Grok thinking options keep xhigh, max, ultra, and saved off", () => {
  const coding = buildThinkingSync("grok", "max", "coding");
  coding.syncThinkingOptions();
  assert.deepEqual(optionPairs(coding.thinking), GROK_THINKING_OPTIONS);
  assert.equal(coding.thinking.value, "max");
  assert.equal(coding.thinking.style.display, "");
  assert.equal(coding.elements.codexLoopMainThinkingMode.style.display, "none");
  assert.deepEqual(coding.messages, []);

  const codingOff = buildThinkingSync("grok", "off", "coding");
  codingOff.syncThinkingOptions();
  assert.equal(codingOff.thinking.value, "off");
  assert.equal(codingOff.state.thinkingMode, "off");
  assert.deepEqual(codingOff.messages, []);

  for (const mode of ["loop", "graph", "loop_plus"]) {
    const savedMax = buildThinkingSync("grok", "max", mode);
    savedMax.syncThinkingOptions();
    assert.equal(savedMax.thinking.style.display, "none");
    assert.deepEqual(optionPairs(savedMax.thinking), GROK_THINKING_OPTIONS);
    assert.equal(savedMax.thinking.value, "max");
    assert.deepEqual(savedMax.messages, []);
    assert.equal(savedMax.elements.codexLoopMainThinkingMode.style.display, "");
    assert.equal(savedMax.elements.codexLoopSubtaskThinkingMode.style.display, "");
    assert.deepEqual(optionPairs(savedMax.elements.codexLoopMainThinkingMode), GROK_THINKING_OPTIONS);
    assert.equal(savedMax.elements.codexLoopMainThinkingMode.value, "max");
    assert.equal(savedMax.elements.codexLoopMainThinkingMode.title, WEBVIEW_STRINGS.grokLoopMainThinkingModeAria);
    assert.equal(savedMax.elements.codexLoopSubtaskThinkingMode.title, WEBVIEW_STRINGS.grokLoopSubtaskThinkingModeAria);

    const savedOff = buildThinkingSync("grok", "medium", mode);
    savedOff.state.selectedLoopThinkingByCli = { grok: { main: "off", subtask: "ultra" } };
    savedOff.syncThinkingOptions();
    assert.equal(savedOff.elements.codexLoopMainThinkingMode.value, "off");
    assert.equal(savedOff.elements.codexLoopSubtaskThinkingMode.value, "ultra");
    assert.equal(savedOff.state.thinkingMode, "medium");
    assert.deepEqual(savedOff.messages, []);
  }

  const codex = buildThinkingSync("codex", "off");
  codex.syncThinkingOptions();
  assert.deepEqual(optionPairs(codex.thinking), CODEX_ROLE_THINKING_OPTIONS);
  assert.equal(codex.thinking.value, "low");

  const codexLoop = buildThinkingSync("codex", "off", "loop");
  codexLoop.state.selectedLoopThinkingByCli = { codex: { main: "off", subtask: "ultra" } };
  codexLoop.syncThinkingOptions();
  assert.deepEqual(optionPairs(codexLoop.elements.codexLoopMainThinkingMode), CODEX_ROLE_THINKING_OPTIONS);
  assert.equal(codexLoop.elements.codexLoopMainThinkingMode.value, "low");
  assert.equal(codexLoop.elements.codexLoopSubtaskThinkingMode.value, "ultra");
  assert.equal(codexLoop.elements.codexLoopMainThinkingMode.title, WEBVIEW_STRINGS.codexLoopMainThinkingModeAria);
  assert.equal(codexLoop.state.thinkingMode, "low");

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

test("Grok uses role model rows in Loop, Loop+, and Graph, and the single select in coding", () => {
  const source = [
    "let hidden = false;",
    "function hideAddModelDialog() { hidden = true; }",
    "function getLoopExecutionModeForCli() { return \"main_sub_multi_agent\"; }",
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "normalizeInteractiveMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsManagedModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliSupportsLoopRoleModelSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isLoopRoleModelMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "isOpenCodeRoleModelMode"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "syncModelSelectorByInteractiveMode"),
    "return { syncModelSelectorByInteractiveMode, cliSupportsManagedModelSelection, cliSupportsModelSelection, isLoopRoleModelMode, hideCount: () => hidden };",
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
    cliSupportsModelSelection: (cli?: string) => boolean;
    isLoopRoleModelMode: (cli?: string, mode?: string) => boolean;
  };
  assert.equal(runner.cliSupportsManagedModelSelection("grok"), true);
  assert.equal(runner.cliSupportsManagedModelSelection("codex"), true);
  assert.equal(runner.cliSupportsManagedModelSelection("claude"), false);
  assert.equal(runner.cliSupportsModelSelection("dsh"), true);
  assert.equal(runner.cliSupportsManagedModelSelection("dsh"), false);
  assert.equal(runner.isLoopRoleModelMode("grok", "coding"), false);
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(elements.modelSelect.style.display, "");
  assert.equal(elements.modelSelect.disabled, false);
  assert.equal(elements.codexLoopModelGroup.style.display, "none");
  assert.equal(elements.codexLoopMainThinkingMode.style.display, "none");

  for (const mode of ["loop", "graph", "loop_plus"]) {
    state.interactiveMode = mode;
    runner.syncModelSelectorByInteractiveMode();
    assert.equal(runner.isLoopRoleModelMode("grok", mode), true);
    assert.equal(elements.modelSelect.style.display, "none");
    assert.equal(elements.modelSelect.disabled, true);
    assert.equal(elements.codexLoopModelGroup.style.display, "");
    assert.equal(elements.codexLoopMainModelSelect.disabled, false);
    assert.equal(elements.codexLoopSubtaskModelSelect.disabled, false);
    assert.equal(elements.codexLoopMainThinkingMode.style.display, "");
    assert.equal(elements.codexLoopSubtaskThinkingMode.style.display, "");
    assert.equal(elements.codexLoopMainThinkingMode.disabled, false);
    assert.equal(elements.codexLoopSubtaskThinkingMode.disabled, false);
  }
  assert.equal(elements.loopExecutionModeSelect.style.display, "none");
  state.interactiveMode = "loop";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(elements.loopExecutionModeSelect.style.display, "");

  state.interactiveMode = "coding";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(elements.modelSelect.style.display, "");
  assert.equal(elements.codexLoopModelGroup.style.display, "none");

  state.currentCli = "codex";
  state.interactiveMode = "coding";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(runner.isLoopRoleModelMode("codex", "coding"), false);
  assert.equal(elements.modelSelect.style.display, "");
  assert.equal(elements.codexLoopModelGroup.style.display, "none");
  state.interactiveMode = "graph";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(runner.isLoopRoleModelMode("codex", "graph"), true);
  assert.equal(elements.codexLoopModelGroup.style.display, "");
  assert.equal(elements.modelSelect.style.display, "none");

  state.currentCli = "claude";
  state.interactiveMode = "loop";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(runner.isLoopRoleModelMode("claude", "loop"), false);
  assert.equal(elements.modelSelect.style.display, "none");
  assert.equal(elements.codexLoopModelGroup.style.display, "none");

  state.currentCli = "opencode";
  state.interactiveMode = "graph";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(runner.isLoopRoleModelMode("opencode", "graph"), false);
  assert.equal(elements.codexLoopModelGroup.style.display, "none");
  assert.equal(elements.openCodeModelGroup.style.display, "");
  assert.equal(elements.openCodePrimaryModelSelect.disabled, false);
  assert.equal(elements.openCodeSmallModelSelect.disabled, false);

  state.currentCli = "dsh";
  state.interactiveMode = "coding";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(elements.modelSelect.style.display, "");
  assert.equal(elements.modelSelect.disabled, false);
  assert.equal(elements.codexLoopModelGroup.style.display, "none");
  state.interactiveMode = "loop_plus";
  runner.syncModelSelectorByInteractiveMode();
  assert.equal(elements.modelSelect.style.display, "");
  assert.equal(elements.modelSelect.disabled, false);
  assert.equal(elements.codexLoopModelGroup.style.display, "none");

  assert.equal(WEBVIEW_STRINGS.codexLoopMainModelLabel, "主模型");
  assert.equal(WEBVIEW_STRINGS.codexLoopSubtaskModelLabel, "子模型");
  assert.equal(WEBVIEW_STRINGS.grokLoopMainModelSelectAria, "Grok Loop/Graph 主模型选择");
  assert.equal(WEBVIEW_STRINGS.grokLoopSubtaskModelSelectAria, "Grok Loop/Graph 子模型选择");
  assert.equal(WEBVIEW_STRINGS.grokLoopMainThinkingModeAria, "Grok Loop/Graph 主模型思考模式");
  assert.equal(WEBVIEW_STRINGS.grokLoopSubtaskThinkingModeAria, "Grok Loop/Graph 子模型思考模式");
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "selectCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "addCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "renameCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "deleteCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /type: "moveCliModel"/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /configId: getCurrentModelConfigId\(\)/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /grokLoopMainModelSelectAria/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /function appendCodexThinkingOptions\(selectElement\) \{\s*appendThinkingOption\(selectElement, "low", "low"\);/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /state\.currentCli === "grok"\) \{\s*appendThinkingOption\(selectElement, "off", "off"\);/);
});

test("Grok role thinking changes keep off and role model aria follows the CLI", () => {
  const thinkingSource = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "normalizeThinkingModeSelection"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "handleCodexLoopRoleThinkingChange"),
    "return handleCodexLoopRoleThinkingChange;",
  ].join("\n");
  const runThinkingChange = (cli: string, role: "main" | "subtask", value: string) => {
    const state = {
      currentCli: cli,
      selectedLoopThinkingByCli: {} as Record<string, { main: string; subtask: string }>,
    };
    const messages: unknown[] = [];
    const handle = new Function(
      "state",
      "vscode",
      thinkingSource,
    )(state, {
      postMessage(message: unknown) {
        messages.push(message);
      },
    }) as (nextRole: "main" | "subtask", rawValue: string) => void;
    handle(role, value);
    return { state, messages };
  };
  const grokOff = runThinkingChange("grok", "main", " off ");
  assert.equal(grokOff.state.selectedLoopThinkingByCli.grok.main, "off");
  assert.deepEqual(grokOff.messages, [{
    type: "updateSetting",
    key: "selectedLoopThinkingMode.grok.main",
    value: "off",
  }]);
  const codexOff = runThinkingChange("codex", "subtask", "off");
  assert.equal(codexOff.state.selectedLoopThinkingByCli.codex.subtask, "low");
  assert.deepEqual(codexOff.messages, [{
    type: "updateSetting",
    key: "selectedLoopThinkingMode.codex.subtask",
    value: "low",
  }]);

  const modelSource = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getModelOptionLabel"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getLoopRoleModelsForCli"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getSelectedLoopRoleModelForCli"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "cliUsesConfigDeclaredModels"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getCliLoopModelSelectAria"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "getNoConfiguredModelLabel"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "updateCodexLoopRoleModelSelect"),
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "updateCodexLoopModelSelectOptions"),
    "return updateCodexLoopModelSelectOptions;",
  ].join("\n");
  const state = {
    currentCli: "grok",
    loopModelsByCli: {
      grok: { main: ["grok-main"], subtask: ["grok-sub"] },
      codex: { main: ["gpt-main"], subtask: ["gpt-sub"] },
    },
    selectedLoopModelsByCli: {
      grok: { main: "grok-main", subtask: "grok-sub" },
      codex: { main: "gpt-main", subtask: "gpt-sub" },
    },
    modelsByCli: {},
  };
  const elements = {
    codexLoopMainModelSelect: createThinkingSelect(),
    codexLoopSubtaskModelSelect: createThinkingSelect(),
  };
  const document = {
    createElement(tagName: string): ThinkingOption {
      assert.equal(tagName, "option");
      return { value: "", textContent: "" };
    },
  };
  const translations = WEBVIEW_STRINGS as Record<string, string>;
  const update = new Function(
    "state",
    "elements",
    "document",
    "t",
    `${modelSource}; return updateCodexLoopModelSelectOptions;`,
  )(state, elements, document, (key: string) => translations[key] || key) as () => void;
  update();
  assert.equal(elements.codexLoopMainModelSelect.title, WEBVIEW_STRINGS.grokLoopMainModelSelectAria);
  assert.equal(elements.codexLoopSubtaskModelSelect.title, WEBVIEW_STRINGS.grokLoopSubtaskModelSelectAria);
  assert.equal(elements.codexLoopMainModelSelect.value, "grok-main");
  state.currentCli = "codex";
  update();
  assert.equal(elements.codexLoopMainModelSelect.title, WEBVIEW_STRINGS.codexLoopMainModelSelectAria);
  assert.equal(elements.codexLoopSubtaskModelSelect.title, WEBVIEW_STRINGS.codexLoopSubtaskModelSelectAria);
  assert.equal(elements.codexLoopMainModelSelect.value, "gpt-main");
});
