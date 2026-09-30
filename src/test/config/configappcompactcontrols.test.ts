import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");

function loadUiSource(): string {
  return fs.readFileSync(uiPath, "utf8");
}

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

test("renders a leftmost radio group for activation without changing config actions", () => {
  const source = loadUiSource();
  const listPanel = extractSection(source, "const ConfigListPanel =", "const jv =");
  const activationRadio = listPanel.match(
    /be\.jsx\("input", \{\s+type: "radio",[\s\S]*?onChange: \(\) => \{\},\s+\}\)/,
  );

  if (!activationRadio) {
    assert.fail("activation radio block should exist");
  }
  const activationRadioSource = activationRadio[0];
  assert.match(listPanel, /className: "config-list-main"/);
  assert.match(activationRadioSource, /config-activate-radio-active/);
  assert.match(activationRadioSource, /name: `config-active-\$\{k\}`/);
  assert.match(activationRadioSource, /checked: Y/);
  assert.match(activationRadioSource, /disabled: Boolean\(p\)/);
  assert.match(activationRadioSource, /if \(!Y && !p\) B\(ae, F\)/);
  assert.match(listPanel, /role: "radiogroup"/);
  assert.doesNotMatch(listPanel, /config-activate-button/);
  assert.doesNotMatch(listPanel, /children: Y \? "更新配置" : "激活"/);
  assert.match(listPanel, /className: "config-list-actions",\s+size: 4/);

  assert.match(listPanel, /onClick: \(\) => I\(k\),\s+children: "添加"/);
  assert.match(listPanel, /icon: be\.jsx\(zH, \{\}\),\s+onClick: \(ae\) => V\(ae, F\),\s+title: "复制配置"/);
  assert.match(listPanel, /icon: be\.jsx\(FH, \{\}\),\s+onClick: \(ae\) => W\(ae, F\),\s+title: "重命名"/);
  assert.match(listPanel, /icon: be\.jsx\(AH, \{\}\),\s+onClick: \(ae\) => A\(ae, F\),\s+title: "删除配置"/);
});

test("halves core inline spacing across the config list and editor cards", () => {
  const source = loadUiSource();
  const listPanel = extractSection(source, "const ConfigListPanel =", "const jv =");
  const editorPanel = extractSection(source, "const ConfigEditorPanel =", "// Config manager layout");
  const managerLayout = extractSection(source, "const ConfigManagerLayout =", "const readConfigVscodeColor =");

  assert.match(listPanel, /headStyle: \{ paddingLeft: "4px", paddingRight: "4px" \}/);
  assert.match(listPanel, /bodyStyle: \{ paddingLeft: "4px", paddingRight: "4px" \}/);
  assert.match(listPanel, /style: \{ marginBottom: "8px" \}/);
  assert.match(listPanel, /style: \{ height: "100%", padding: "4px", overflow: "auto" \}/);
  assert.match(listPanel, /className: "config-list-toolbar",[\s\S]*?gap: "4px",\s+marginBottom: "4px"/);

  assert.match(editorPanel, /renderOpenCodeField =[\s\S]*?gap: 3,[\s\S]*?padding: "8px"/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-claude",[\s\S]*?padding: "8px"[\s\S]*?gap: "8px"[\s\S]*?marginBottom: "6px"[\s\S]*?gap: 6/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-opencode",[\s\S]*?padding: "8px"[\s\S]*?bodyStyle: \{[\s\S]*?padding: "8px",\s+gap: "8px"/);
  assert.match(editorPanel, /className: "config-editor-shell config-editor-codex",[\s\S]*?padding: "8px"[\s\S]*?bodyStyle: \{[\s\S]*?padding: "8px",\s+gap: "8px"/);
  assert.match(managerLayout, /className: "config-app-header",[\s\S]*?padding: "0 12px"/);
  assert.match(managerLayout, /closeConfigPanel = \(\) => window\.sinitekConfigBridge\?\.close\?\.\(\)/);
  assert.match(managerLayout, /className: "config-app-close-button"[\s\S]*?"aria-label": "关闭配置弹窗"[\s\S]*?onClick: closeConfigPanel/);
});

test("opens the configuration list initially when the config page starts narrow", () => {
  const source = loadUiSource();
  const managerLayout = extractSection(source, "const CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY", "const readConfigVscodeColor =");

  assert.match(
    managerLayout,
    /const CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY = "\(max-width: 920px\)";/,
  );
  assert.match(
    managerLayout,
    /window\.matchMedia\(CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY\)\.matches/,
  );
  assert.match(
    managerLayout,
    /c\.useState\(\s*shouldOpenConfigMobileNavigationInitially,\s*\)/,
  );
  assert.match(managerLayout, /event\.key === "Escape" && closeMobileNavigation\(\)/);
  assert.match(managerLayout, /onClick: closeMobileNavigation/);
});

test("MCP install and uninstall refresh installation status without health probing", () => {
  const source = loadUiSource();
  const editorPanel = extractSection(source, "const ConfigEditorPanel =", "// Config manager layout");
  const mcpActions = extractSection(editorPanel, "refreshMcpInstalledIdsInBackground =", "V0 =");

  assert.match(mcpActions, /refreshMcpInstalledIdsInBackground = c\.useCallback/);
  assert.match(mcpActions, /setTimeout\(\(\) => \{\s+void refreshMcpInstalledIds\(W\);/);
  assert.doesNotMatch(mcpActions, /await checkMcpHealth/);
  assert.doesNotMatch(mcpActions, /void checkMcpHealth/);
  assert.match(mcpActions, /Kt\.success\(`已安装 MCP: \$\{W\.name\}`\);\s+refreshMcpInstalledIdsInBackground\(t\);/);
  assert.match(mcpActions, /Kt\.success\(`已卸载 MCP: \$\{W\.name\}`\);\s+refreshMcpInstalledIdsInBackground\(t\);/);
});

test("MCP marketplace loads installation status separately from health status", () => {
  const source = loadUiSource();
  const editorPanel = extractSection(source, "const ConfigEditorPanel =", "// Config manager layout");

  assert.match(editorPanel, /fetchMcpInstalledServerIds\(W\)/);
  assert.match(editorPanel, /O\?\.platform && void refreshMcpInstalledIds\(O\.platform\)/);
  assert.match(editorPanel, /if \(Array\.isArray\(mcpInstalledServerIds\)\) return mcpInstalledServerIds;/);
  assert.match(editorPanel, /setMcpHealthItems\(\[\]\)/);
});
