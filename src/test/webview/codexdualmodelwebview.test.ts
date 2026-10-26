import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

type FakeOption = {
  value: string;
  textContent: string;
  disabled?: boolean;
};

type FakeSelect = {
  options: FakeOption[];
  value: string;
  disabled: boolean;
  title: string;
  style: { display: string };
  attributes: Map<string, string>;
  innerHTML: string;
  appendChild(option: FakeOption): FakeOption;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

type VisibilityControl = {
  style: { display: string };
  disabled: boolean;
  value: string;
};

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = start + signature.length; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parameterDepth += 1;
    } else if (char === ")") {
      parameterDepth -= 1;
    } else if (char === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
  let depth = 0;
  let quote: string | null = null;
  let inRegex = false;
  let inRegexCharClass = false;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (inRegex) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "[") {
        inRegexCharClass = true;
      } else if (char === "]") {
        inRegexCharClass = false;
      } else if (char === "/" && !inRegexCharClass) {
        inRegex = false;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && source[index + 1] !== "/" && source[index + 1] !== "*") {
      inRegex = true;
      inRegexCharClass = false;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

function createSelect(): FakeSelect {
  let options: FakeOption[] = [];
  return {
    get options() {
      return options;
    },
    set options(value: FakeOption[]) {
      options = value;
    },
    value: "",
    disabled: false,
    title: "",
    style: { display: "" },
    attributes: new Map<string, string>(),
    get innerHTML() {
      return "";
    },
    set innerHTML(value: string) {
      assert.equal(value, "");
      options = [];
    },
    appendChild(option: FakeOption) {
      options.push(option);
      return option;
    },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    },
  };
}

function createVisibilityControl(): VisibilityControl {
  return { style: { display: "" }, disabled: false, value: "" };
}

function optionPairs(select: FakeSelect): Array<[string, string]> {
  return select.options.map((option) => [option.value, option.textContent]);
}

function buildCodexModelHarness() {
  const functionSource = [
    "normalizeModelNameList",
    "normalizeModelSelection",
    "normalizeLoopRoleModelsPayload",
    "normalizeLoopRoleSelectionPayload",
    "appendThinkingOption",
    "normalizeThinkingModeSelection",
    "normalizeLoopRoleThinkingPayload",
    "getDshReasoningOptionsForModel",
    "getLoopRoleThinkingOptionsForCli",
    "normalizeLoopRoleThinkingSelection",
    "getSelectedLoopRoleThinkingModeForCli",
    "getVisibleLoopRoleThinkingModeForCli",
    "appendCodexThinkingOptions",
    "updateCodexLoopRoleThinkingSelect",
    "updateCodexLoopThinkingSelectOptions",
    "shouldPreserveCurrentCliModelsOnEmptySnapshot",
    "applyModelState",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name)).join("\n")
    + "\n"
    + [
      "getCurrentModelConfigId",
      "getActiveConversationTabExecutionLock",
      "isActiveConversationTabExecutionLocked",
      "syncLockedConversationTabModelState",
      "getModelOptionLabel",
      "cliSupportsLoopRoleModelSelection",
      "getLoopRoleModelsForCli",
      "getSelectedLoopRoleModelForCli",
      "getActiveConfigIdForStateCli",
      "getLoopSubtaskRoute",
      "normalizeSubtaskThinkingValue",
      "readLoopSubtaskModelSelection",
      "readLoopSubtaskThinkingSelection",
      "handleLoopSubtaskModelChange",
      "handleLoopSubtaskThinkingChange",
      "updateCodexLoopRoleModelSelect",
      "updateCodexLoopModelSelectOptions",
      "handleCodexLoopRoleModelChange",
      "handleCodexLoopRoleThinkingChange",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)).join("\n");
  const state: Record<string, any> = {
    currentCli: "codex",
    selectedConfigId: "cfg-1",
    configState: { activeConfigId: "cfg-1" },
    modelsByCli: { codex: [], claude: [], opencode: [], dsh: [] },
    managedModelsByCli: { codex: [], claude: [], opencode: [], dsh: [] },
    selectedModelsByCli: { codex: "", claude: "", opencode: "", dsh: "" },
    selectedModel: "",
    loopModelsByCli: {
      codex: { main: [], subtask: [] },
      claude: { main: [], subtask: [] },
      opencode: { main: [], subtask: [] },
      dsh: { main: [], subtask: [] },
    },
    selectedLoopModelsByCli: {
      codex: { main: "", subtask: "" },
      claude: { main: "", subtask: "" },
      opencode: { main: "", subtask: "" },
      dsh: { main: "", subtask: "" },
    },
    selectedLoopThinkingByCli: {
      codex: { main: "", subtask: "" },
      claude: { main: "", subtask: "" },
      opencode: { main: "", subtask: "" },
      dsh: { main: "", subtask: "" },
    },
    dshReasoningOptions: [],
    dshReasoningOptionsByModel: {},
  };
  const elements = {
    codexLoopMainModelSelect: createSelect(),
    codexLoopSubtaskModelSelect: createSelect(),
    codexLoopMainThinkingMode: createSelect(),
    codexLoopSubtaskThinkingMode: createSelect(),
  };
  const postedMessages: unknown[] = [];
  const document = {
    createElement(tagName: string): FakeOption {
      assert.equal(tagName, "option");
      return { value: "", textContent: "", disabled: false };
    },
  };
  const strings = WEBVIEW_STRINGS;
  const helpers = new Function(
    "state",
    "elements",
    "document",
    "CLI_NAMES",
    "t",
    "vscode",
    `${functionSource}; return { applyModelState, updateCodexLoopModelSelectOptions, updateCodexLoopThinkingSelectOptions, handleCodexLoopRoleModelChange, handleCodexLoopRoleThinkingChange, handleLoopSubtaskModelChange, handleLoopSubtaskThinkingChange };`,
  )(
    state,
    elements,
    document,
    ["codex", "claude", "opencode", "grok", "dsh"],
    (key: keyof typeof strings): string => strings[key],
    { postMessage: (message: unknown) => postedMessages.push(message) },
  ) as {
    applyModelState(modelState: unknown, panelCurrentCli: string): void;
    updateCodexLoopModelSelectOptions(): void;
    updateCodexLoopThinkingSelectOptions(): void;
    handleCodexLoopRoleModelChange(role: "main" | "subtask", rawValue: string): void;
    handleCodexLoopRoleThinkingChange(role: "main" | "subtask", rawValue: string): void;
    handleLoopSubtaskModelChange(rawValue: string): void;
    handleLoopSubtaskThinkingChange(rawValue: string): void;
  };
  return { state, elements, postedMessages, ...helpers };
}

function buildVisibilityHarness() {
  const functionSource = [
    "cliSupportsModelSelection",
    "cliSupportsManagedModelSelection",
    "canOpenModelManagerDialog",
    "cliSupportsLoopRoleModelSelection",
    "isLoopRoleModelMode",
    "isOpenCodeRoleModelMode",
    "getActiveConversationTabExecutionLock",
    "isActiveConversationTabExecutionLocked",
    "syncLockedConversationTabModelState",
    "syncModelSelectorByInteractiveMode",
    "handleCurrentCliSelectionChange",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)).join("\n");
  const state: Record<string, any> = { currentCli: "codex", interactiveMode: "coding" };
  const elements = {
    codexLoopModelGroup: createVisibilityControl(),
    codexLoopMainModelSelect: createVisibilityControl(),
    codexLoopSubtaskModelSelect: createVisibilityControl(),
    codexLoopMainThinkingMode: createVisibilityControl(),
    codexLoopSubtaskThinkingMode: createVisibilityControl(),
    openCodeModelGroup: createVisibilityControl(),
    openCodePrimaryModelSelect: createVisibilityControl(),
    openCodeSmallModelSelect: createVisibilityControl(),
    modelSelect: createVisibilityControl(),
    loopExecutionModeSelect: createVisibilityControl(),
  };
  let hideDialogCount = 0;
  const helpers = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "getLoopExecutionModeForCli",
    "hideAddModelDialog",
    `${functionSource}; return { syncModelSelectorByInteractiveMode, handleCurrentCliSelectionChange };`,
  )(
    state,
    elements,
    (value: string) => (value === "loop" || value === "loop_plus" || value === "graph" ? value : "coding"),
    () => "main-sub-multi-agent",
    () => { hideDialogCount += 1; },
  ) as {
    syncModelSelectorByInteractiveMode(cli?: string): void;
    handleCurrentCliSelectionChange(cli: string): void;
  };
  return {
    state,
    elements,
    sync: helpers.syncModelSelectorByInteractiveMode,
    handleCurrentCliSelectionChange: helpers.handleCurrentCliSelectionChange,
    get hideDialogCount() { return hideDialogCount; },
  };
}

test("renders Codex Loop and Graph selectors as Chinese role model rows", () => {
  const html = buildWebviewStaticHtml({
    cspSource: "vscode-webview:",
    nonce: "test",
    i18n: WEBVIEW_STRINGS,
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main-sub-multi-agent",
    loopExecutionModeDebateMultiAgent: "debate-multi-agent",
  });
  const groupStart = html.indexOf('<div id="codexLoopModelGroup"');
  const groupEnd = html.indexOf('<div id="openCodeModelGroup"', groupStart);
  assert.notEqual(groupStart, -1);
  assert.notEqual(groupEnd, -1);
  const group = html.slice(groupStart, groupEnd);

  assert.match(group, /class="open-code-model-group codex-loop-model-group"/);
  assert.match(group, /<div class="open-code-model-row codex-loop-model-row">/);
  assert.doesNotMatch(group, /<label class="open-code-model-row/);
  assert.match(group, /<label class="open-code-model-label" for="codexLoopMainModelSelect">主模型<\/label>/);
  assert.match(group, /<label class="open-code-model-label" for="codexLoopSubtaskCliSelect">子模型<\/label>/);
  assert.match(group, /aria-label="子模型 CLI 分组"/);
  assert.match(group, /id="codexLoopMainModelSelect"[^>]*aria-label="Codex Loop\/Graph 主模型选择"/);
  assert.match(group, /id="codexLoopSubtaskModelSelect"[^>]*title="Codex Loop\/Graph 子模型选择"/);
  assert.doesNotMatch(group, /openCodePrimaryThinkingMode|openCodeSmallThinkingMode|openCodeModelIssue/);
  assert.match(html, /<label class="open-code-model-label" for="codexLoopMainModelSelect">主模型<\/label>/);
  assert.match(html, /<label class="open-code-model-label" for="codexLoopSubtaskCliSelect">子模型<\/label>/);
  assert.match(html, /aria-label="Codex Loop\/Graph 主模型选择"/);
  assert.match(html, /aria-label="Codex Loop\/Graph 子模型选择"/);
});

test("shows Codex role selectors only in Loop and Graph while preserving OpenCode dual layout", () => {
  const harness = buildVisibilityHarness();

  harness.state.currentCli = "codex";
  harness.state.interactiveMode = "coding";
  harness.sync("codex");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.modelSelect.style.display, "");
  assert.equal(harness.elements.modelSelect.disabled, false);
  assert.equal(harness.elements.openCodeModelGroup.style.display, "none");

  harness.state.interactiveMode = "loop";
  harness.sync("codex");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "");
  assert.equal(harness.elements.codexLoopMainModelSelect.disabled, false);
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.disabled, false);
  assert.equal(harness.elements.modelSelect.style.display, "none");
  assert.equal(harness.elements.modelSelect.disabled, true);
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "");

  harness.state.interactiveMode = "graph";
  harness.sync("codex");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "");
  assert.equal(harness.elements.modelSelect.style.display, "none");
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "none");

  harness.state.currentCli = "opencode";
  harness.state.interactiveMode = "graph";
  harness.sync("opencode");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.codexLoopMainModelSelect.disabled, true);
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.disabled, true);
  assert.equal(harness.elements.openCodeModelGroup.style.display, "");
  assert.equal(harness.elements.openCodePrimaryModelSelect.disabled, false);
  assert.equal(harness.elements.openCodeSmallModelSelect.disabled, false);
  assert.equal(harness.elements.modelSelect.style.display, "none");

  harness.state.currentCli = "dsh";
  for (const mode of ["loop", "loop_plus", "graph"]) {
    harness.state.interactiveMode = mode;
    harness.sync("dsh");
    assert.equal(harness.elements.codexLoopModelGroup.style.display, "", `${mode} shows DSH role selectors`);
    assert.equal(harness.elements.codexLoopMainModelSelect.disabled, false);
    assert.equal(harness.elements.codexLoopSubtaskModelSelect.disabled, false);
    assert.equal(harness.elements.codexLoopMainThinkingMode.disabled, false);
    assert.equal(harness.elements.codexLoopSubtaskThinkingMode.disabled, false);
    assert.equal(harness.elements.modelSelect.style.display, "none");
    assert.equal(harness.elements.loopExecutionModeSelect.style.display, mode === "loop" ? "" : "none");
  }
});

test("keeps model manager open during state sync and closes on explicit unsupported CLI selection", () => {
  const harness = buildVisibilityHarness();

  harness.state.currentCli = "claude";
  harness.sync();
  assert.equal(harness.hideDialogCount, 0);

  harness.handleCurrentCliSelectionChange("claude");
  assert.equal(harness.hideDialogCount, 1);

  harness.handleCurrentCliSelectionChange("codex");
  assert.equal(harness.hideDialogCount, 1);

  harness.handleCurrentCliSelectionChange("grok");
  assert.equal(harness.hideDialogCount, 2);
  harness.sync();
  assert.equal(harness.hideDialogCount, 2);
  harness.handleCurrentCliSelectionChange("codex");
  assert.equal(harness.hideDialogCount, 2);
});

test("keeps primary model selectors editable after execution", () => {
  const harness = buildVisibilityHarness();
  harness.state.conversationTabs = {
    activeTabId: "tab-1",
    tabs: [{ id: "tab-1", executionLocked: true, lockedPrimaryModel: "gpt-5" }],
  };

  harness.state.currentCli = "codex";
  harness.state.interactiveMode = "coding";
  harness.sync("codex");
  assert.equal(harness.elements.modelSelect.disabled, false);

  harness.state.interactiveMode = "loop";
  harness.sync("codex");
  assert.equal(harness.elements.codexLoopMainModelSelect.disabled, false);
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.disabled, false);

  harness.state.currentCli = "opencode";
  harness.sync("opencode");
  assert.equal(harness.elements.openCodePrimaryModelSelect.disabled, false);
});

test("replays Codex role model options and selections from panel state", () => {
  const harness = buildCodexModelHarness();

  harness.applyModelState({
    optionsByCli: { codex: ["fallback-model"] },
    managedByCli: { codex: ["fallback-model"] },
    selectedByCli: { codex: "fallback-model" },
    loopOptionsByCli: {
      codex: {
        main: [" main-large ", "main-large", "main-balanced"],
        subtask: ["sub-small", "sub-small"],
      },
    },
    selectedLoopByCli: {
      codex: { main: "main-large", subtask: "missing-model" },
    },
  }, "codex");
  harness.updateCodexLoopModelSelectOptions();

  assert.deepEqual(optionPairs(harness.elements.codexLoopMainModelSelect), [
    ["", "默认"],
    ["main-large", "main-large"],
    ["main-balanced", "main-balanced"],
  ]);
  assert.deepEqual(optionPairs(harness.elements.codexLoopSubtaskModelSelect), [
    ["", "默认"],
    ["sub-small", "sub-small"],
  ]);
  assert.equal(harness.elements.codexLoopMainModelSelect.value, "main-large");
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.value, "");

  harness.state.selectedConfigId = "draft";
  harness.state.configState.activeConfigId = "active";
  harness.applyModelState({
    optionsByCli: { codex: [] },
    managedByCli: { codex: [] },
    selectedByCli: { codex: "" },
    loopOptionsByCli: { codex: { main: [], subtask: [] } },
    selectedLoopByCli: { codex: { main: "", subtask: "" } },
  }, "codex");
  harness.updateCodexLoopModelSelectOptions();
  assert.deepEqual(optionPairs(harness.elements.codexLoopMainModelSelect), [
    ["", "默认"],
    ["main-large", "main-large"],
    ["main-balanced", "main-balanced"],
  ]);
  assert.equal(harness.elements.codexLoopMainModelSelect.value, "main-large");
});

test("posts Codex role model and thinking changes with role, cli, and config id", () => {
  const harness = buildCodexModelHarness();
  harness.state.selectedLoopModelsByCli.codex = { main: "main-large", subtask: "sub-small" };

  harness.handleCodexLoopRoleModelChange("subtask", " sub-large ");
  harness.handleCodexLoopRoleModelChange("main", "");
  harness.handleCodexLoopRoleThinkingChange("main", "xhigh");
  harness.handleCodexLoopRoleThinkingChange("subtask", " ultra ");

  assert.deepEqual(harness.state.selectedLoopModelsByCli.codex, {
    main: "",
    subtask: "sub-large",
  });
  assert.deepEqual(harness.state.selectedLoopThinkingByCli.codex, {
    main: "xhigh",
    subtask: "ultra",
  });
  assert.deepEqual(harness.postedMessages, [
    {
      type: "selectCliLoopModel",
      cli: "codex",
      role: "subtask",
      model: "sub-large",
      configId: "cfg-1",
    },
    {
      type: "selectCliLoopModel",
      cli: "codex",
      role: "main",
      model: null,
      configId: "cfg-1",
    },
    {
      type: "updateSetting",
      key: "selectedLoopThinkingMode.codex.main",
      value: "xhigh",
    },
    {
      type: "updateSetting",
      key: "selectedLoopThinkingMode.codex.subtask",
      value: "ultra",
    },
  ]);
});

test("renders and posts DSH Loop and Graph role model and thinking selections", () => {
  const harness = buildCodexModelHarness();
  harness.state.currentCli = "dsh";
  harness.state.modelsByCli.dsh = ["main-model", "subtask-model"];
  harness.state.loopModelsByCli.dsh = {
    main: ["main-model", "main-fallback"],
    subtask: ["subtask-model", "subtask-fallback"],
  };
  harness.state.selectedLoopModelsByCli.dsh = {
    main: "main-model",
    subtask: "subtask-model",
  };
  harness.state.dshReasoningOptionsByModel = {
    "main-model": ["low", "high"],
    "main-fallback": ["low", "max"],
    "subtask-model": ["low", "xhigh"],
    "subtask-fallback": ["max"],
  };
  harness.state.selectedLoopThinkingByCli.dsh = { main: "high", subtask: "xhigh" };

  harness.updateCodexLoopModelSelectOptions();
  assert.deepEqual(optionPairs(harness.elements.codexLoopMainModelSelect), [
    ["", "默认"],
    ["main-model", "main-model"],
    ["main-fallback", "main-fallback"],
  ]);
  assert.deepEqual(optionPairs(harness.elements.codexLoopSubtaskModelSelect), [
    ["", "默认"],
    ["subtask-model", "subtask-model"],
    ["subtask-fallback", "subtask-fallback"],
  ]);
  assert.equal(harness.elements.codexLoopMainModelSelect.value, "main-model");
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.value, "subtask-model");
  assert.deepEqual(optionPairs(harness.elements.codexLoopMainThinkingMode), [
    ["low", "low"],
    ["high", "high"],
  ]);
  assert.deepEqual(optionPairs(harness.elements.codexLoopSubtaskThinkingMode), [
    ["low", "low"],
    ["xhigh", "xhigh"],
  ]);
  assert.equal(harness.elements.codexLoopMainThinkingMode.value, "high");
  assert.equal(harness.elements.codexLoopSubtaskThinkingMode.value, "xhigh");
  assert.equal(harness.elements.codexLoopMainThinkingMode.title, WEBVIEW_STRINGS.dshLoopMainThinkingModeAria);
  assert.equal(harness.elements.codexLoopSubtaskThinkingMode.title, WEBVIEW_STRINGS.dshLoopSubtaskThinkingModeAria);

  harness.handleCodexLoopRoleModelChange("main", "main-fallback");
  harness.handleCodexLoopRoleThinkingChange("main", "max");
  harness.handleLoopSubtaskModelChange("subtask-fallback");
  harness.handleLoopSubtaskThinkingChange("max");

  assert.equal(harness.state.selectedLoopModelsByCli.dsh.main, "main-fallback");
  assert.equal(harness.state.selectedLoopModelsByCli.dsh.subtask, "subtask-fallback");
  assert.equal(harness.state.selectedLoopThinkingByCli.dsh.main, "max");
  assert.equal(harness.state.selectedLoopThinkingByCli.dsh.subtask, "max");
  assert.deepEqual(harness.postedMessages, [
    {
      type: "selectCliLoopModel",
      cli: "dsh",
      role: "main",
      model: "main-fallback",
      configId: "cfg-1",
    },
    {
      type: "updateSetting",
      key: "selectedLoopThinkingMode.dsh.main",
      value: "max",
    },
    {
      type: "selectCliLoopModel",
      cli: "dsh",
      role: "subtask",
      model: "subtask-fallback",
      configId: "cfg-1",
    },
    {
      type: "updateSetting",
      key: "selectedLoopThinkingMode.dsh.subtask",
      value: "max",
    },
  ]);
});
