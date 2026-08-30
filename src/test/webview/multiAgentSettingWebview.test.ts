import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../../webview/viewContentI18n";
import { TOAST_MISC_STYLES } from "../../webview/viewContentStyles/toastMisc";
import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "../../webview/viewContentScript/coreBootstrap";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";

function buildStaticHtml(locale: "en" | "zh-CN"): string {
  return buildWebviewStaticHtml({
    locale,
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_I18N[locale],
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });
}

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

function createFakeDocument() {
  return {
    createElement(tag: string) {
      return {
        tag,
        attributes: {} as Record<string, string>,
        children: [] as any[],
        className: "",
        textContent: "",
        type: "",
        name: "",
        value: "",
        checked: false,
        selected: false,
        multiple: false,
        size: 0,
        rows: 0,
        placeholder: "",
        setAttribute(name: string, value: string) {
          this.attributes[name] = String(value);
        },
        appendChild(child: any) {
          this.children.push(child);
          return child;
        },
      };
    },
  };
}

test("renders one default-off global implicit-subagents setting and wires its panel state", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const html = buildStaticHtml(locale);
    const globalPanelIndex = html.indexOf('id="toolSettingsGlobalPanel"');
    const workspacePanelIndex = html.indexOf('id="toolSettingsWorkspacePanel"');
    const settingIndex = html.indexOf('id="multiAgentEnabled"');
    assert.match(html, /id="multiAgentEnabled"/u);
    assert.match(html, new RegExp(WEBVIEW_I18N[locale].toolSettingsImplicitSubagentsLabel, "u"));
    assert.notEqual(globalPanelIndex, -1);
    assert.notEqual(workspacePanelIndex, -1);
    assert.ok(globalPanelIndex < settingIndex && settingIndex < workspacePanelIndex);
    assert.doesNotMatch(html, /codexMultiAgentEnabled/u);
  }

  assert.equal(WEBVIEW_I18N.en.toolSettingsImplicitSubagentsLabel, "Implicit Subagents");
  assert.equal(WEBVIEW_I18N["zh-CN"].toolSettingsImplicitSubagentsLabel, "隐式子代理");
  assert.match(WEBVIEW_I18N.en.toolSettingsImplicitSubagentsTitle, /^Global setting/u);
  assert.match(WEBVIEW_I18N["zh-CN"].toolSettingsImplicitSubagentsTitle, /全局设置/u);

  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /multiAgentEnabled: false/u);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /key: "multiAgentEnabled"/u);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /panelState\.multiAgentEnabled/u);
});

test("renders default-on automatic compaction in the global settings panel", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const html = buildStaticHtml(locale);
    const globalPanelIndex = html.indexOf('id="toolSettingsGlobalPanel"');
    const workspacePanelIndex = html.indexOf('id="toolSettingsWorkspacePanel"');
    const settingIndex = html.indexOf('id="autoCompactContextAfterRun"');
    assert.match(html, new RegExp(WEBVIEW_I18N[locale].toolSettingsAutoCompactAfterRunLabel, "u"));
    assert.notEqual(globalPanelIndex, -1);
    assert.notEqual(workspacePanelIndex, -1);
    assert.ok(globalPanelIndex < settingIndex && settingIndex < workspacePanelIndex);
  }

  assert.match(WEBVIEW_I18N.en.toolSettingsAutoCompactAfterRunTitle, /^Global setting/u);
  assert.match(WEBVIEW_I18N["zh-CN"].toolSettingsAutoCompactAfterRunTitle, /全局设置/u);
  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /autoCompactContextAfterRun: true/u);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /key: "autoCompactContextAfterRun"/u);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /panelState\.autoCompactContextAfterRun/u);
});

test("renders default-on human interaction setting and dialog wiring", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const html = buildStaticHtml(locale);
    const globalPanelIndex = html.indexOf('id="toolSettingsGlobalPanel"');
    const workspacePanelIndex = html.indexOf('id="toolSettingsWorkspacePanel"');
    const settingIndex = html.indexOf('id="humanInteractionEnabled"');
    const dialogIndex = html.indexOf('id="humanInteractionOverlay"');
    assert.match(html, new RegExp(WEBVIEW_I18N[locale].toolSettingsHumanInteractionLabel, "u"));
    assert.notEqual(globalPanelIndex, -1);
    assert.notEqual(workspacePanelIndex, -1);
    assert.notEqual(dialogIndex, -1);
    assert.ok(globalPanelIndex < settingIndex && settingIndex < workspacePanelIndex);
  }

  assert.equal(WEBVIEW_I18N.en.toolSettingsHumanInteractionLabel, "Human Interaction");
  assert.equal(WEBVIEW_I18N["zh-CN"].toolSettingsHumanInteractionLabel, "人工交互");
  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /humanInteractionEnabled: true/u);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /key: "humanInteractionEnabled"/u);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /function openHumanInteractionDialog/u);
  assert.match(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, /humanInteractionRequest/u);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /panelState\.humanInteractionEnabled/u);
  assert.match(TOAST_MISC_STYLES, /\.human-interaction-modal/u);
});

test("renders human interaction option fields as radio controls", () => {
  const functionSource = [
    "normalizeHumanInteractionText",
    "normalizeHumanInteractionOptions",
    "normalizeHumanInteractionField",
    "normalizeHumanInteractionRequest",
    "getHumanInteractionDefaultValues",
    "createHumanInteractionInput",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, name)).join("\n");
  const runtime = new Function(
    "document",
    "createMessageId",
    "getActiveConversationTabId",
    "t",
    `${functionSource}; return { normalizeHumanInteractionRequest, createHumanInteractionInput };`,
  )(
    createFakeDocument(),
    () => "interaction-1",
    () => "tab-1",
    (key: string) => key,
  );

  const request = runtime.normalizeHumanInteractionRequest({
    interactionId: "ask-options",
    tabId: "tab-1",
    formFields: [{
      id: "topic",
      label: "主题想写什么？",
      options: [
        { value: "love", label: "爱情 / 思念" },
        { value: "nature", label: "自然 / 四季" },
      ],
    }],
  });
  assert.equal(request.formFields[0].type, "radio");
  assert.deepEqual(request.formFields[0].options.map((option: any) => option.label), ["爱情 / 思念", "自然 / 四季"]);

  const control = runtime.createHumanInteractionInput(request.formFields[0]);
  assert.equal(control.className, "human-interaction-options");
  assert.equal(control.children.length, 2);
  assert.equal(control.children[0].children[0].type, "radio");
  assert.equal(control.children[1].children[0].value, "nature");
});

test("lays out tool settings as compact masonry cards", () => {
  const html = buildStaticHtml("zh-CN");
  const globalPanelStart = html.indexOf('id="toolSettingsGlobalPanel"');
  const workspacePanelStart = html.indexOf('id="toolSettingsWorkspacePanel"');
  const firstCardStart = html.indexOf('class="tool-settings-card"', globalPanelStart);

  assert.notEqual(globalPanelStart, -1);
  assert.notEqual(workspacePanelStart, -1);
  assert.ok(firstCardStart > globalPanelStart && firstCardStart < workspacePanelStart);
  assert.match(
    html,
    /class="tool-settings-card"[\s\S]*id="multiAgentEnabled"[\s\S]*class="tool-settings-note"/u,
  );
  assert.match(TOAST_MISC_STYLES, /\.tool-settings-panel\.active \{\s+display: block;\s+column-count: 2;/u);
  assert.match(TOAST_MISC_STYLES, /\.tool-settings-card \{[\s\S]*break-inside: avoid;/u);
  assert.match(TOAST_MISC_STYLES, /@media \(max-width: 560px\) \{[\s\S]*\.tool-settings-panel\.active \{\s+column-count: 1;/u);
});
