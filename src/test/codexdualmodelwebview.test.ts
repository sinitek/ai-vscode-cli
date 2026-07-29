import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../webview/viewContentScript/modelManager";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";

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

function buildCodexModelHarness(locale: "en" | "zh-CN" = "en") {
  const functionSource = [
    "normalizeModelNameList",
    "normalizeModelSelection",
    "normalizeLoopRoleModelsPayload",
    "normalizeLoopRoleSelectionPayload",
    "shouldPreserveCurrentCliModelsOnEmptySnapshot",
    "applyModelState",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name)).join("\n")
    + "\n"
    + [
      "getCurrentModelConfigId",
      "cliSupportsLoopRoleModelSelection",
      "getLoopRoleModelsForCli",
      "getSelectedLoopRoleModelForCli",
      "updateCodexLoopRoleModelSelect",
      "updateCodexLoopModelSelectOptions",
      "handleCodexLoopRoleModelChange",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)).join("\n");
  const state = {
    currentCli: "codex",
    selectedConfigId: "cfg-1",
    configState: { activeConfigId: "cfg-1" },
    modelsByCli: { codex: [], claude: [], opencode: [] },
    managedModelsByCli: { codex: [], claude: [], opencode: [] },
    selectedModelsByCli: { codex: "", claude: "", opencode: "" },
    selectedModel: "",
    loopModelsByCli: {
      codex: { main: [], subtask: [] },
      claude: { main: [], subtask: [] },
      opencode: { main: [], subtask: [] },
    },
    selectedLoopModelsByCli: {
      codex: { main: "", subtask: "" },
      claude: { main: "", subtask: "" },
      opencode: { main: "", subtask: "" },
    },
  };
  const elements = {
    codexLoopMainModelSelect: createSelect(),
    codexLoopSubtaskModelSelect: createSelect(),
  };
  const postedMessages: unknown[] = [];
  const document = {
    createElement(tagName: string): FakeOption {
      assert.equal(tagName, "option");
      return { value: "", textContent: "", disabled: false };
    },
  };
  const strings = WEBVIEW_I18N[locale];
  const helpers = new Function(
    "state",
    "elements",
    "document",
    "CLI_NAMES",
    "t",
    "vscode",
    `${functionSource}; return { applyModelState, updateCodexLoopModelSelectOptions, handleCodexLoopRoleModelChange };`,
  )(
    state,
    elements,
    document,
    ["codex", "claude", "opencode"],
    (key: keyof typeof strings): string => strings[key],
    { postMessage: (message: unknown) => postedMessages.push(message) },
  ) as {
    applyModelState(modelState: unknown, panelCurrentCli: string): void;
    updateCodexLoopModelSelectOptions(): void;
    handleCodexLoopRoleModelChange(role: "main" | "subtask", rawValue: string): void;
  };
  return { state, elements, postedMessages, ...helpers };
}

function buildVisibilityHarness() {
  const functionSource = [
    "cliSupportsManagedModelSelection",
    "cliSupportsLoopRoleModelSelection",
    "isLoopRoleModelMode",
    "syncModelSelectorByInteractiveMode",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)).join("\n");
  const state = { currentCli: "codex", interactiveMode: "coding" };
  const elements = {
    codexLoopModelGroup: createVisibilityControl(),
    codexLoopMainModelSelect: createVisibilityControl(),
    codexLoopSubtaskModelSelect: createVisibilityControl(),
    openCodeModelGroup: createVisibilityControl(),
    openCodePrimaryModelSelect: createVisibilityControl(),
    openCodeSmallModelSelect: createVisibilityControl(),
    modelSelect: createVisibilityControl(),
    loopExecutionModeSelect: createVisibilityControl(),
  };
  const sync = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "getLoopExecutionModeForCli",
    "hideAddModelDialog",
    `${functionSource}; return syncModelSelectorByInteractiveMode;`,
  )(
    state,
    elements,
    (value: string) => (value === "loop" || value === "graph" ? value : "coding"),
    () => "main-sub-multi-agent",
    () => undefined,
  ) as (cli?: string) => void;
  return { state, elements, sync };
}

test("renders Codex Loop and Graph selectors as localized role model rows", () => {
  const englishHtml = buildWebviewStaticHtml({
    locale: "en",
    cspSource: "vscode-webview:",
    nonce: "test",
    i18n: WEBVIEW_I18N.en,
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main-sub-multi-agent",
    loopExecutionModeDebateMultiAgent: "debate-multi-agent",
  });
  const chineseHtml = buildWebviewStaticHtml({
    locale: "zh-CN",
    cspSource: "vscode-webview:",
    nonce: "test",
    i18n: WEBVIEW_I18N["zh-CN"],
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main-sub-multi-agent",
    loopExecutionModeDebateMultiAgent: "debate-multi-agent",
  });
  const group = englishHtml.match(/<div id="codexLoopModelGroup"[\s\S]*?<\/div>/)?.[0] || "";

  assert.match(group, /class="open-code-model-group codex-loop-model-group"/);
  assert.match(group, /<label class="open-code-model-row codex-loop-model-row" for="codexLoopMainModelSelect">/);
  assert.match(group, /<label class="open-code-model-row codex-loop-model-row" for="codexLoopSubtaskModelSelect">/);
  assert.match(group, /<span class="open-code-model-label">Main<\/span>/);
  assert.match(group, /<span class="open-code-model-label">Subtask<\/span>/);
  assert.match(group, /id="codexLoopMainModelSelect"[^>]*aria-label="Codex Loop\/Graph main model selection"/);
  assert.match(group, /id="codexLoopSubtaskModelSelect"[^>]*title="Codex Loop\/Graph subtask model selection"/);
  assert.doesNotMatch(group, /openCodePrimaryThinkingMode|openCodeSmallThinkingMode|openCodeModelIssue/);
  assert.match(chineseHtml, /<span class="open-code-model-label">主模型<\/span>/);
  assert.match(chineseHtml, /<span class="open-code-model-label">子模型<\/span>/);
  assert.match(chineseHtml, /aria-label="Codex Loop\/Graph 主模型选择"/);
  assert.match(chineseHtml, /aria-label="Codex Loop\/Graph 子模型选择"/);
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
});

test("replays Codex role model options and selections from panel state", () => {
  const harness = buildCodexModelHarness("en");

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
    ["", "Model: Follow Config"],
    ["main-large", "main-large"],
    ["main-balanced", "main-balanced"],
  ]);
  assert.deepEqual(optionPairs(harness.elements.codexLoopSubtaskModelSelect), [
    ["", "Model: Follow Config"],
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
    ["", "Model: Follow Config"],
    ["main-large", "main-large"],
    ["main-balanced", "main-balanced"],
  ]);
  assert.equal(harness.elements.codexLoopMainModelSelect.value, "main-large");
});

test("posts Codex role model changes with role, model, cli, and config id", () => {
  const harness = buildCodexModelHarness("en");
  harness.state.selectedLoopModelsByCli.codex = { main: "main-large", subtask: "sub-small" };

  harness.handleCodexLoopRoleModelChange("subtask", " sub-large ");
  harness.handleCodexLoopRoleModelChange("main", "");

  assert.deepEqual(harness.state.selectedLoopModelsByCli.codex, {
    main: "",
    subtask: "sub-large",
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
  ]);
});
