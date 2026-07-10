import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../webview/viewContentScript/modelManager";

type ChangeEvent = { target: FakeControl };

type FakeControl = {
  style: { display: string };
  disabled: boolean;
  value: string;
  addEventListener(type: "change", listener: (event: ChangeEvent) => void): void;
  dispatchChange(value: string): void;
};

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);
  return extractBracedSource(script, start);
}

function extractBlockSource(script: string, marker: string): string {
  const start = script.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist in webview script`);
  return extractBracedSource(script, start);
}

function extractBracedSource(script: string, start: number): string {
  const bodyStart = script.indexOf("{", start);
  assert.notEqual(bodyStart, -1, "source block should have a body");
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
  throw new Error("source block was not terminated");
}

function createControl(): FakeControl {
  let changeListener: ((event: ChangeEvent) => void) | undefined;
  const control: FakeControl = {
    style: { display: "" },
    disabled: false,
    value: "",
    addEventListener(type, listener) {
      assert.equal(type, "change");
      changeListener = listener;
    },
    dispatchChange(value) {
      control.value = value;
      assert.ok(changeListener, "change listener should be registered");
      changeListener({ target: control });
    },
  };
  return control;
}

function buildHarness() {
  const state = {
    currentCli: "opencode",
    interactiveMode: "coding",
    interactive: { supported: false, enabled: false },
    isRunning: false,
  };
  const elements = {
    interactiveModeSelect: createControl(),
    commonCommandButton: createControl(),
    commandCompact: createControl(),
    openCodeModelGroup: createControl(),
    openCodePrimaryModelSelect: createControl(),
    openCodeSmallModelSelect: createControl(),
    modelSelect: createControl(),
    lobsterModelGroup: createControl(),
    lobsterExecutionModeSelect: createControl(),
    lobsterMainModelSelect: createControl(),
    lobsterSubtaskModelSelect: createControl(),
  };
  const normalizeInteractiveMode = (value: string) => value === "lobster" ? "lobster" : "coding";
  const modelFunctionSource = ["cliSupportsManagedModelSelection", "syncModelSelectorByInteractiveMode"]
    .map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name))
    .join("\n");
  const syncModelSelectorByInteractiveMode = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "getLobsterExecutionModeForCli",
    "hideAddModelDialog",
    `${modelFunctionSource}; return syncModelSelectorByInteractiveMode;`,
  )(
    state,
    elements,
    normalizeInteractiveMode,
    () => "main-sub-multi-agent",
    () => undefined,
  ) as (cli?: string) => void;
  const syncInteractiveModeSelector = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "syncModelSelectorByInteractiveMode",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "syncInteractiveModeSelector")}; return syncInteractiveModeSelector;`,
  )(
    state,
    elements,
    normalizeInteractiveMode,
    syncModelSelectorByInteractiveMode,
  ) as () => void;
  const syncCommonCommandOptions = new Function(
    "state",
    "elements",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "syncCommonCommandOptions")}; return syncCommonCommandOptions;`,
  )(state, elements) as () => void;
  const postedMessages: unknown[] = [];
  const bindingSource = extractBlockSource(
    VIEW_CONTENT_SCRIPT_MODEL_MANAGER,
    "if (elements.interactiveModeSelect) {",
  );
  new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "syncModelSelectorByInteractiveMode",
    "vscode",
    bindingSource,
  )(
    state,
    elements,
    normalizeInteractiveMode,
    syncModelSelectorByInteractiveMode,
    { postMessage: (message: unknown) => postedMessages.push(message) },
  );
  return {
    state,
    elements,
    postedMessages,
    syncInteractiveModeSelector,
    syncCommonCommandOptions,
  };
}

test("shows the mode selector for OpenCode without exposing interactive-runner commands", () => {
  const harness = buildHarness();

  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptions();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "");
  assert.equal(harness.elements.interactiveModeSelect.disabled, false);
  assert.equal(harness.elements.interactiveModeSelect.value, "coding");
  assert.equal(harness.elements.commonCommandButton.style.display, "none");
  assert.equal(harness.elements.commonCommandButton.disabled, true);

  harness.state.currentCli = "codex";
  harness.state.interactive = { supported: true, enabled: true };
  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptions();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "");
  assert.equal(harness.elements.commonCommandButton.style.display, "inline-flex");

  harness.state.currentCli = "claude";
  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptions();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "");
  assert.equal(harness.elements.commonCommandButton.style.display, "inline-flex");

  harness.state.currentCli = "gemini";
  harness.state.interactive = { supported: false, enabled: false };
  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptions();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "none");
  assert.equal(harness.elements.interactiveModeSelect.disabled, true);
  assert.equal(harness.elements.commonCommandButton.style.display, "none");
});

test("switches OpenCode between coding and Loop model layouts and persists the mode", () => {
  const harness = buildHarness();

  harness.syncInteractiveModeSelector();
  assert.equal(harness.elements.openCodeModelGroup.style.display, "inline-flex");
  assert.equal(harness.elements.openCodePrimaryModelSelect.disabled, false);
  assert.equal(harness.elements.openCodeSmallModelSelect.disabled, false);
  assert.equal(harness.elements.modelSelect.style.display, "none");
  assert.equal(harness.elements.lobsterModelGroup.style.display, "none");
  assert.equal(harness.elements.lobsterExecutionModeSelect.disabled, true);

  harness.elements.interactiveModeSelect.dispatchChange("lobster");
  assert.equal(harness.state.interactiveMode, "lobster");
  assert.deepEqual(harness.postedMessages[0], {
    type: "updateSetting",
    key: "interactiveMode.opencode",
    value: "lobster",
  });
  assert.equal(harness.elements.openCodeModelGroup.style.display, "inline-flex");
  assert.equal(harness.elements.lobsterModelGroup.style.display, "inline-flex");
  assert.equal(harness.elements.lobsterExecutionModeSelect.disabled, false);
  assert.equal(harness.elements.lobsterExecutionModeSelect.value, "main-sub-multi-agent");
  assert.equal(harness.elements.lobsterMainModelSelect.style.display, "none");
  assert.equal(harness.elements.lobsterSubtaskModelSelect.style.display, "none");

  harness.elements.interactiveModeSelect.dispatchChange("coding");
  assert.equal(harness.state.interactiveMode, "coding");
  assert.deepEqual(harness.postedMessages[1], {
    type: "updateSetting",
    key: "interactiveMode.opencode",
    value: "coding",
  });
  assert.equal(harness.elements.openCodeModelGroup.style.display, "inline-flex");
  assert.equal(harness.elements.lobsterModelGroup.style.display, "none");
  assert.equal(harness.elements.lobsterExecutionModeSelect.disabled, true);
  assert.equal(harness.elements.modelSelect.style.display, "none");
});
