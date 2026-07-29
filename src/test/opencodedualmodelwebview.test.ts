import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../webview/viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../webview/viewContentScript/modelManager";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import { INPUT_CONTROLS_STYLES } from "../webview/viewContentStyles/inputControls";

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

function extractCssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} should exist in input control styles`);
  return match[1];
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

function buildOpenCodeModelHarness(locale: "en" | "zh-CN" = "en") {
  const functionNames = [
    "normalizeOpenCodeModelsPayload",
    "clearOpenCodeModelOptions",
    "getOpenCodeModelIssueMessage",
    "getOpenCodeModelOptionLabel",
    "updateOpenCodeRoleModelSelect",
    "updateOpenCodeModelSelectOptions",
  ];
  const functionSource = functionNames.map((name) => extractFunctionSource(
    name === "normalizeOpenCodeModelsPayload"
      ? VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE
      : VIEW_CONTENT_SCRIPT_MODEL_MANAGER,
    name,
  )).join("\n");
  const state: { openCodeModels: any } = { openCodeModels: null };
  const elements = {
    openCodePrimaryModelSelect: createSelect(),
    openCodeSmallModelSelect: createSelect(),
    openCodeModelIssue: { textContent: "", style: { display: "none" } },
  };
  const document = {
    createElement(tagName: string): FakeOption {
      assert.equal(tagName, "option");
      return { value: "", textContent: "", disabled: false };
    },
  };
  const strings = WEBVIEW_I18N[locale];
  const t = (key: keyof typeof strings): string => strings[key];
  const runtime = new Function(
    "state",
    "elements",
    "document",
    "t",
    `${functionSource}; return { normalizeOpenCodeModelsPayload, clearOpenCodeModelOptions, updateOpenCodeModelSelectOptions };`,
  )(state, elements, document, t) as {
    normalizeOpenCodeModelsPayload(payload: unknown): any;
    clearOpenCodeModelOptions(): void;
    updateOpenCodeModelSelectOptions(): void;
  };
  return { state, elements, ...runtime };
}

function buildRoleModelChangeHarness() {
  const functionSource = [
    "getOpenCodeCompatModelRole",
    "handleOpenCodeRoleModelChange",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, name)).join("\n");
  const state = {
    openCodeModels: {
      configMainRef: "myAPI/main-chat",
      configSubtaskRef: "myAPI/subtask-worker",
      selectedMainRef: "myAPI/other",
      selectedSubtaskRef: "myAPI/other",
      configPrimaryRef: "myAPI/main-chat",
      configSmallRef: "myAPI/subtask-worker",
      selectedPrimaryRef: "myAPI/other",
      selectedSmallRef: "myAPI/other",
    },
    openCodeThinking: null as unknown,
    openCodeSmallThinking: null as unknown,
  };
  const postedMessages: unknown[] = [];
  let thinkingSyncCount = 0;
  const handleChange = new Function(
    "state",
    "vscode",
    "syncThinkingOptions",
    `${functionSource}; return handleOpenCodeRoleModelChange;`,
  )(
    state,
    { postMessage: (message: unknown) => postedMessages.push(message) },
    () => { thinkingSyncCount += 1; },
  ) as (role: "main" | "subtask", value: string) => void;
  return { state, postedMessages, handleChange, getThinkingSyncCount: () => thinkingSyncCount };
}

function optionPairs(select: FakeSelect): Array<[string, string]> {
  return select.options.map((option) => [option.value, option.textContent]);
}

function createVisibilityElement() {
  return { style: { display: "" }, disabled: false, value: "" };
}

function buildVisibilityHarness() {
  const functionSource = [
    "cliSupportsManagedModelSelection",
    "cliSupportsLoopRoleModelSelection",
    "isLoopRoleModelMode",
    "syncModelSelectorByInteractiveMode",
  ]
    .map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name))
    .join("\n");
  const state = { currentCli: "codex", interactiveMode: "coding" };
  const elements = {
    codexLoopModelGroup: createVisibilityElement(),
    codexLoopMainModelSelect: createVisibilityElement(),
    codexLoopSubtaskModelSelect: createVisibilityElement(),
    openCodeModelGroup: createVisibilityElement(),
    openCodePrimaryModelSelect: createVisibilityElement(),
    openCodeSmallModelSelect: createVisibilityElement(),
    modelSelect: createVisibilityElement(),
    loopExecutionModeSelect: createVisibilityElement(),
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
    (value: string) => value,
    () => "main-sub-multi-agent",
    () => undefined,
  ) as (cli?: string) => void;
  return { state, elements, sync };
}

test("renders OpenCode selectors as labeled main and subtask model rows", () => {
  const html = buildWebviewStaticHtml({
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
  const group = html.match(/<div id="openCodeModelGroup"[\s\S]*?<\/div>/)?.[0] || "";

  assert.match(group, /<label class="open-code-model-row" for="openCodePrimaryModelSelect">/);
  assert.match(group, /<label class="open-code-model-row" for="openCodeSmallModelSelect">/);
  assert.match(group, /<span class="open-code-model-label">Main<\/span>/);
  assert.match(group, /<span class="open-code-model-label">Subtask<\/span>/);
  assert.match(group, /id="openCodePrimaryModelSelect"[^>]*class="model-select"/);
  assert.match(group, /id="openCodeSmallModelSelect"[^>]*class="model-select"/);
  assert.match(group, /id="openCodePrimaryThinkingMode"[^>]*class="thinking-select"/);
  assert.match(group, /id="openCodeSmallThinkingMode"[^>]*class="thinking-select"/);
  assert.match(group, /<option value="xhigh">xhigh<\/option>/);
  assert.match(group, /<option value="max">max<\/option>/);
  const primaryThinking = html.match(/<select id="openCodePrimaryThinkingMode"[\s\S]*?<\/select>/)?.[0] || "";
  assert.match(
    primaryThinking,
    /<option value="xhigh">xhigh<\/option>\s*<option value="max">max<\/option>\s*<option value="ultra">ultra<\/option>/,
  );
  assert.match(group, /id="openCodePrimaryModelSelect"[^>]*aria-label="OpenCode main model selection"[^>]*title="OpenCode main model selection"/);
  assert.match(group, /id="openCodeSmallModelSelect"[^>]*aria-label="OpenCode subtask model selection"[^>]*aria-describedby="openCodeModelIssue"[^>]*title="OpenCode subtask model selection"/);
  assert.match(group, /id="openCodeSmallThinkingMode"[^>]*aria-label="OpenCode subtask model thinking mode"[^>]*title="OpenCode subtask model thinking mode"/);
  assert.doesNotMatch(group, /OpenCode small model|<span class="open-code-model-label">Small<\/span>/);
  assert.doesNotMatch(group, /openCodeSmallModelHint|open-code-model-hint|lightweight internal tasks|reasoning effort/);
  assert.doesNotMatch(html, /loopMainModelSelect|loopSubtaskModelSelect|Loop main-task model|Loop subtask model/);
  const genericThinking = html.match(/<select id="thinkingMode"[\s\S]*?<\/select>/)?.[0] || "";
  assert.match(genericThinking, /<option value="xhigh">xhigh<\/option>/);
  assert.match(genericThinking, /<option value="max">max<\/option>/);
  assert.match(
    genericThinking,
    /<option value="xhigh">xhigh<\/option>\s*<option value="max">max<\/option>\s*<option value="ultra">ultra<\/option>/,
  );
});

test("keeps OpenCode user-facing copy on main and subtask wording", () => {
  const englishCopy = Object.values(WEBVIEW_I18N.en).join("\n");
  const chineseCopy = Object.values(WEBVIEW_I18N["zh-CN"]).join("\n");

  assert.match(englishCopy, /OpenCode main model selection/);
  assert.match(englishCopy, /OpenCode subtask model selection/);
  assert.doesNotMatch(englishCopy, /OpenCode (?:large|small) model/i);
  assert.match(chineseCopy, /OpenCode 主模型选择/);
  assert.match(chineseCopy, /OpenCode 子模型选择/);
  assert.doesNotMatch(chineseCopy, /OpenCode (?:大模型|小模型)/);
});

test("lays out OpenCode selectors as two full-width model rows", () => {
  const inputThinkingRule = extractCssRule(INPUT_CONTROLS_STYLES, ".input-model-row .thinking-select");
  const openCodeGroupRule = extractCssRule(INPUT_CONTROLS_STYLES, ".open-code-model-group");
  const openCodeRowRule = extractCssRule(INPUT_CONTROLS_STYLES, ".open-code-model-row");
  const openCodeLabelRule = extractCssRule(INPUT_CONTROLS_STYLES, ".open-code-model-label");
  const openCodeModelRule = extractCssRule(INPUT_CONTROLS_STYLES, ".open-code-model-row .model-select");
  const openCodeThinkingRule = extractCssRule(INPUT_CONTROLS_STYLES, ".open-code-model-row .thinking-select");

  assert.match(inputThinkingRule, /width:\s*calc\(70px \* 1\.15\);/);
  assert.match(inputThinkingRule, /min-width:\s*calc\(70px \* 1\.15\);/);
  assert.match(openCodeGroupRule, /display:\s*flex;/);
  assert.match(openCodeGroupRule, /flex:\s*1 1 100%;/);
  assert.match(openCodeGroupRule, /flex-direction:\s*column;/);
  assert.match(openCodeGroupRule, /gap:\s*6px;/);
  assert.match(openCodeGroupRule, /min-width:\s*0;/);
  assert.match(openCodeRowRule, /display:\s*grid;/);
  assert.match(openCodeRowRule, /grid-template-columns:\s*minmax\(52px, auto\) minmax\(92px, 1fr\) calc\(70px \* 1\.15\);/);
  assert.match(openCodeLabelRule, /color:\s*var\(--vscode-descriptionForeground\);/);
  assert.match(openCodeModelRule, /width:\s*100%;/);
  assert.match(openCodeModelRule, /min-width:\s*0;/);
  assert.match(openCodeThinkingRule, /width:\s*calc\(70px \* 1\.15\);/);
});

test("rebuilds both OpenCode selects with model names and direct effective selections", () => {
  const harness = buildOpenCodeModelHarness("en");
  harness.state.openCodeModels = harness.normalizeOpenCodeModelsPayload({
    models: [
      { ref: "myAPI/main-chat", label: "Main Chat", providerId: "myAPI", modelId: "main-chat" },
      { ref: "myAPI/subtask-worker", label: "Subtask Worker", providerId: "myAPI", modelId: "subtask-worker" },
    ],
    configMainRef: "myAPI/main-chat",
    configSubtaskRef: "myAPI/subtask-worker",
    selectedMainRef: "myAPI/main-chat",
    selectedSubtaskRef: "removed/model",
    issues: [{ role: "subtask", code: "model-not-found" }],
  });
  harness.updateOpenCodeModelSelectOptions();

  assert.deepEqual(optionPairs(harness.elements.openCodePrimaryModelSelect), [
    ["myAPI/main-chat", "Main Chat"],
    ["myAPI/subtask-worker", "Subtask Worker"],
  ]);
  assert.deepEqual(optionPairs(harness.elements.openCodeSmallModelSelect), [
    ["myAPI/main-chat", "Main Chat"],
    ["myAPI/subtask-worker", "Subtask Worker"],
  ]);
  assert.equal(harness.elements.openCodePrimaryModelSelect.value, "myAPI/main-chat");
  assert.equal(harness.elements.openCodeSmallModelSelect.value, "");
  assert.equal(harness.state.openCodeModels.selectedSubtaskRef, null);
  assert.equal(harness.state.openCodeModels.selectedSmallRef, null);
  assert.equal(harness.elements.openCodeSmallModelSelect.attributes.get("aria-invalid"), "true");
  assert.match(harness.elements.openCodeModelIssue.textContent, /not declared/);
  assert.doesNotMatch(
    harness.elements.openCodePrimaryModelSelect.options.map((option) => option.textContent).join("|"),
    /manage|follow config|myAPI\//i,
  );
});

test("falls back to model id without exposing a full provider ref", () => {
  const harness = buildOpenCodeModelHarness("en");
  harness.state.openCodeModels = harness.normalizeOpenCodeModelsPayload({
    models: [{ ref: "myAPI/fallback-id", label: "myAPI/fallback-id", providerId: "myAPI", modelId: "fallback-id" }],
    configMainRef: "myAPI/fallback-id",
    selectedMainRef: "myAPI/fallback-id",
  });
  harness.updateOpenCodeModelSelectOptions();

  assert.deepEqual(optionPairs(harness.elements.openCodePrimaryModelSelect), [["myAPI/fallback-id", "fallback-id"]]);
});

test("strips only an exact legacy ref suffix from OpenCode model labels", () => {
  const harness = buildOpenCodeModelHarness("en");
  harness.state.openCodeModels = harness.normalizeOpenCodeModelsPayload({
    models: [
      {
        ref: "myAPI/gpt-5.6-sol",
        label: "gpt-5.6-sol (myAPI/gpt-5.6-sol)",
        providerId: "myAPI",
        modelId: "gpt-5.6-sol",
      },
      {
        ref: "myAPI/model-fast",
        label: "Model (Fast)",
        providerId: "myAPI",
        modelId: "model-fast",
      },
      {
        ref: "myAPI/fallback-id",
        label: " (myAPI/fallback-id)",
        providerId: "myAPI",
        modelId: "fallback-id",
      },
    ],
    selectedMainRef: "myAPI/gpt-5.6-sol",
  });
  harness.updateOpenCodeModelSelectOptions();

  assert.deepEqual(optionPairs(harness.elements.openCodePrimaryModelSelect), [
    ["myAPI/gpt-5.6-sol", "gpt-5.6-sol"],
    ["myAPI/model-fast", "Model (Fast)"],
    ["myAPI/fallback-id", "fallback-id"],
  ]);
  assert.equal(harness.elements.openCodePrimaryModelSelect.value, "myAPI/gpt-5.6-sol");
});

test("clears an override when selecting the configured default and sends exact refs otherwise", () => {
  const harness = buildRoleModelChangeHarness();

  harness.handleChange("main", "myAPI/main-chat");
  harness.handleChange("subtask", "myAPI/other-subtask");

  assert.deepEqual(harness.postedMessages, [
    { type: "updateOpenCodeRoleModel", role: "primary", modelRole: "main", value: null },
    { type: "updateOpenCodeRoleModel", role: "small", modelRole: "subtask", value: "myAPI/other-subtask" },
  ]);
  assert.equal(harness.state.openCodeModels.selectedMainRef, "myAPI/main-chat");
  assert.equal(harness.state.openCodeModels.selectedSubtaskRef, "myAPI/other-subtask");
  assert.equal(harness.state.openCodeModels.selectedPrimaryRef, "myAPI/main-chat");
  assert.equal(harness.state.openCodeModels.selectedSmallRef, "myAPI/other-subtask");
  assert.equal(harness.getThinkingSyncCount(), 2);
});

test("shows a localized disabled placeholder when no models are configured", () => {
  const englishHarness = buildOpenCodeModelHarness("en");
  englishHarness.state.openCodeModels = englishHarness.normalizeOpenCodeModelsPayload({ models: [] });
  englishHarness.updateOpenCodeModelSelectOptions();

  assert.deepEqual(optionPairs(englishHarness.elements.openCodePrimaryModelSelect), [["", "No configured model"]]);
  assert.equal(englishHarness.elements.openCodePrimaryModelSelect.options[0].disabled, true);

  const chineseHarness = buildOpenCodeModelHarness("zh-CN");
  chineseHarness.updateOpenCodeModelSelectOptions();
  assert.deepEqual(optionPairs(chineseHarness.elements.openCodeSmallModelSelect), [["", "未配置模型"]]);
  assert.equal(chineseHarness.elements.openCodeSmallModelSelect.options[0].disabled, true);
});

test("clears stale OpenCode options and selections during config or CLI switching", () => {
  const harness = buildOpenCodeModelHarness("zh-CN");
  harness.state.openCodeModels = harness.normalizeOpenCodeModelsPayload({
    models: [{ ref: "myAPI/main", label: "主对话", providerId: "myAPI", modelId: "main" }],
    selectedMainRef: "myAPI/main",
    selectedSubtaskRef: "myAPI/main",
  });
  harness.updateOpenCodeModelSelectOptions();
  harness.clearOpenCodeModelOptions();

  assert.deepEqual(optionPairs(harness.elements.openCodePrimaryModelSelect), [["", "未配置模型"]]);
  assert.deepEqual(optionPairs(harness.elements.openCodeSmallModelSelect), [["", "未配置模型"]]);
  assert.equal(harness.state.openCodeModels.selectedMainRef, null);
  assert.equal(harness.state.openCodeModels.selectedSubtaskRef, null);
  assert.equal(harness.state.openCodeModels.selectedPrimaryRef, null);
  assert.equal(harness.state.openCodeModels.selectedSmallRef, null);
  assert.match(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, /currentCli[\s\S]*clearOpenCodeModelOptions\(\)/);
  assert.match(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, /configSelect[\s\S]*clearOpenCodeModelOptions\(\)/);
});

test("keeps OpenCode dual models, Codex role models, and Claude no model across modes", () => {
  const harness = buildVisibilityHarness();

  harness.state.interactiveMode = "coding";
  harness.sync("opencode");
  assert.equal(harness.elements.openCodeModelGroup.style.display, "");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.modelSelect.style.display, "none");

  harness.state.interactiveMode = "loop";
  harness.sync("opencode");
  assert.equal(harness.elements.openCodeModelGroup.style.display, "");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "");
  assert.equal(harness.elements.modelSelect.style.display, "none");

  harness.state.interactiveMode = "coding";
  harness.sync("codex");
  assert.equal(harness.elements.openCodeModelGroup.style.display, "none");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.modelSelect.style.display, "");

  harness.state.interactiveMode = "loop";
  harness.sync("codex");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "");
  assert.equal(harness.elements.codexLoopMainModelSelect.disabled, false);
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.disabled, false);
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "");
  assert.equal(harness.elements.modelSelect.style.display, "none");

  harness.state.interactiveMode = "graph";
  harness.sync("codex");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "");
  assert.equal(harness.elements.codexLoopMainModelSelect.disabled, false);
  assert.equal(harness.elements.codexLoopSubtaskModelSelect.disabled, false);
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(harness.elements.modelSelect.style.display, "none");

  harness.state.interactiveMode = "coding";
  harness.sync("claude");
  assert.equal(harness.elements.openCodeModelGroup.style.display, "none");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.modelSelect.style.display, "none");

  harness.state.interactiveMode = "loop";
  harness.sync("claude");
  assert.equal(harness.elements.codexLoopModelGroup.style.display, "none");
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "");
  assert.equal(harness.elements.modelSelect.style.display, "none");
});
