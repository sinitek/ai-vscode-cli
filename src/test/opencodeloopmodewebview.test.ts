import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../webview/viewContentScript/settingsAndOverlays";

type ChangeEvent = { target: FakeControl };
type ClickEvent = { target: FakeControl };

type FakeControl = {
  style: { display: string };
  disabled: boolean;
  checked: boolean;
  tabIndex: number;
  value: string;
  addEventListener(type: "change", listener: (event: ChangeEvent) => void): void;
  addEventListener(type: "click", listener: (event: ClickEvent) => void): void;
  dispatchChange(value: string): void;
  click(): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
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

function extractEventListenerSource(script: string, marker: string): string {
  const start = script.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist in webview script`);
  const bracedSource = extractBracedSource(script, start);
  const trailingSource = script.slice(start + bracedSource.length);
  const closeMatch = trailingSource.match(/^\s*\);/);
  assert.ok(closeMatch, `${marker} should be a complete listener statement`);
  return `${bracedSource}${closeMatch[0]}`;
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
  let clickListener: ((event: ClickEvent) => void) | undefined;
  const attributes = new Map<string, string>();
  const control: FakeControl = {
    style: { display: "" },
    disabled: false,
    checked: false,
    tabIndex: 0,
    value: "",
    addEventListener(type, listener) {
      if (type === "change") {
        changeListener = listener as (event: ChangeEvent) => void;
        return;
      }
      if (type === "click") {
        clickListener = listener as (event: ClickEvent) => void;
        return;
      }
      throw new Error(`unexpected listener type: ${type}`);
    },
    dispatchChange(value) {
      control.value = value;
      assert.ok(changeListener, "change listener should be registered");
      changeListener({ target: control });
    },
    click() {
      assert.ok(clickListener, "click listener should be registered");
      clickListener({ target: control });
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
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
    autoCompactContextAfterRun: false,
  };
  const elements = {
    interactiveModeSelect: createControl(),
    commonCommandButton: createControl(),
    commandCompact: createControl(),
    autoCompactContextAfterRun: createControl(),
    openCodeModelGroup: createControl(),
    openCodePrimaryModelSelect: createControl(),
    openCodeSmallModelSelect: createControl(),
    modelSelect: createControl(),
    loopExecutionModeSelect: createControl(),
  };
  const normalizeInteractiveMode = (value: string) => value === "loop" ? "loop" : "coding";
  const modelFunctionSource = ["cliSupportsManagedModelSelection", "syncModelSelectorByInteractiveMode"]
    .map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name))
    .join("\n");
  const syncModelSelectorByInteractiveMode = new Function(
    "state",
    "elements",
    "normalizeInteractiveMode",
    "getLoopExecutionModeForCli",
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
  const syncCommonCommandOptionsWithOpenCode = new Function(
    "state",
    "elements",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "syncCommonCommandOptions")}; return syncCommonCommandOptions;`,
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
  new Function(
    "state",
    "elements",
    "vscode",
    "closeCommonCommands",
    [
      extractBlockSource(
        VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS,
        "if (elements.autoCompactContextAfterRun) {",
      ),
      extractEventListenerSource(
        VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS,
        "elements.commandCompact.addEventListener",
      ),
    ].join("\n"),
  )(
    state,
    elements,
    { postMessage: (message: unknown) => postedMessages.push(message) },
    () => undefined,
  );
  return {
    state,
    elements,
    postedMessages,
    syncInteractiveModeSelector,
    syncCommonCommandOptions,
    syncCommonCommandOptionsWithOpenCode,
  };
}

test("shows the mode selector and compact command for OpenCode", () => {
  const harness = buildHarness();

  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptionsWithOpenCode();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "");
  assert.equal(harness.elements.interactiveModeSelect.disabled, false);
  assert.equal(harness.elements.interactiveModeSelect.value, "coding");
  assert.equal(harness.elements.commonCommandButton.style.display, "inline-flex");
  assert.equal(harness.elements.commonCommandButton.disabled, false);

  harness.state.currentCli = "codex";
  harness.state.interactive = { supported: true, enabled: true };
  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptionsWithOpenCode();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "");
  assert.equal(harness.elements.commonCommandButton.style.display, "inline-flex");

  harness.state.currentCli = "claude";
  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptionsWithOpenCode();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "");
  assert.equal(harness.elements.commonCommandButton.style.display, "inline-flex");

  harness.state.currentCli = "gemini";
  harness.state.interactive = { supported: false, enabled: false };
  harness.syncInteractiveModeSelector();
  harness.syncCommonCommandOptionsWithOpenCode();
  assert.equal(harness.elements.interactiveModeSelect.style.display, "none");
  assert.equal(harness.elements.interactiveModeSelect.disabled, true);
  assert.equal(harness.elements.commonCommandButton.style.display, "none");
});

test("switches OpenCode between coding and Loop model layouts and persists the mode", () => {
  const harness = buildHarness();

  harness.syncInteractiveModeSelector();
  assert.equal(harness.elements.openCodeModelGroup.style.display, "");
  assert.equal(harness.elements.openCodePrimaryModelSelect.disabled, false);
  assert.equal(harness.elements.openCodeSmallModelSelect.disabled, false);
  assert.equal(harness.elements.modelSelect.style.display, "none");
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(harness.elements.loopExecutionModeSelect.disabled, true);

  harness.elements.interactiveModeSelect.dispatchChange("loop");
  assert.equal(harness.state.interactiveMode, "loop");
  assert.deepEqual(harness.postedMessages[0], {
    type: "updateSetting",
    key: "interactiveMode.opencode",
    value: "loop",
  });
  assert.equal(harness.elements.openCodeModelGroup.style.display, "");
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "");
  assert.equal(harness.elements.loopExecutionModeSelect.disabled, false);
  assert.equal(harness.elements.loopExecutionModeSelect.value, "main-sub-multi-agent");

  harness.elements.interactiveModeSelect.dispatchChange("coding");
  assert.equal(harness.state.interactiveMode, "coding");
  assert.deepEqual(harness.postedMessages[1], {
    type: "updateSetting",
    key: "interactiveMode.opencode",
    value: "coding",
  });
  assert.equal(harness.elements.openCodeModelGroup.style.display, "");
  assert.equal(harness.elements.loopExecutionModeSelect.style.display, "none");
  assert.equal(harness.elements.loopExecutionModeSelect.disabled, true);
  assert.equal(harness.elements.modelSelect.style.display, "none");
});

test("shows and triggers the compact command for OpenCode", () => {
  const harness = buildHarness();

  harness.syncCommonCommandOptionsWithOpenCode();
  assert.equal(harness.elements.commonCommandButton.style.display, "inline-flex");
  assert.equal(harness.elements.commonCommandButton.disabled, false);
  assert.equal(harness.elements.commonCommandButton.getAttribute("aria-disabled"), "false");
  assert.equal(harness.elements.commandCompact.disabled, false);

  harness.elements.commandCompact.click();
  assert.deepEqual(harness.postedMessages[0], {
    type: "runCommonCommand",
    command: "compactContext",
  });
});

test("saves automatic compact setting while OpenCode is selected", () => {
  const harness = buildHarness();

  harness.elements.autoCompactContextAfterRun.checked = true;
  harness.elements.autoCompactContextAfterRun.dispatchChange("");

  assert.equal(harness.state.autoCompactContextAfterRun, true);
  assert.deepEqual(harness.postedMessages[0], {
    type: "updateSetting",
    key: "autoCompactContextAfterRun",
    value: true,
  });
});
