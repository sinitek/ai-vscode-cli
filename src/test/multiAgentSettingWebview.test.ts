import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import { TOAST_MISC_STYLES } from "../webview/viewContentStyles/toastMisc";
import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "../webview/viewContentScript/coreBootstrap";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../webview/viewContentScript/settingsAndOverlays";

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
