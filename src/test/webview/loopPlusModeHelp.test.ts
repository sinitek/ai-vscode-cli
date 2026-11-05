import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

function buildHtml(): string {
  return buildWebviewStaticHtml({
    cspSource: "vscode-resource://test-authority",
    nonce: "loop-plus-help-nonce",
    i18n: getWebviewStrings(),
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
  });
}

function helpModesPanel(html: string): string {
  const start = html.indexOf('<div id="helpPanelModes"');
  assert.ok(start >= 0, "Modes help panel was not rendered");
  const openEnd = html.indexOf(">", start);
  let depth = 1;
  let index = openEnd + 1;
  while (index < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", index);
    const nextClose = html.indexOf("</div>", index);
    assert.ok(nextClose >= 0, "Modes help panel was not closed");
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      index = nextOpen + 4;
    } else {
      depth -= 1;
      index = nextClose + "</div>".length;
    }
  }
  assert.equal(depth, 0);
  return html.slice(openEnd + 1, index - "</div>".length);
}

function interactiveModeSelects(html: string): string[] {
  return html.match(/<select id="[^"]*" class="interactive-mode-select"[\s\S]*?<\/select>/g) ?? [];
}

test("使用固定中文帮助文案", () => {
  assert.ok(Object.keys(WEBVIEW_STRINGS).length > 0);
  assert.equal(WEBVIEW_STRINGS.helpModeVibe, "Vibe 模式，直接执行目标 cli 任务");
  assert.equal(getWebviewStrings().toolSettingsNotificationsTab, "通知设置");
});

test("渲染简洁准确的中文模式说明", () => {
  const chinese = helpModesPanel(buildHtml());

  const descriptions = [
    "Vibe 模式，直接执行目标 cli 任务",
    "Loop 模式，主模型相当于任务分发的项目经理调度多个子模型共用完成任务",
    "Loop+ 模式（主推），主模型除了分发任务还充当组长角色进行功能验收，如果发现有缺陷会再发起整改",
  ];
  assert.deepEqual([...chinese.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1]), descriptions);
});

test("使用说明仅保留模式说明，通知授权和两个默认开启的开关位于工具设置", () => {
  const chineseHtml = buildHtml();

  for (const html of [chineseHtml]) {
    assert.doesNotMatch(html, /automatic conflict resolution|自动解冲突|不能自动解冲突|没有自动解冲突/);
    assert.match(html, /id="helpPanelModes" class="help-panel active"/);
    assert.doesNotMatch(html, /helpTabModes|helpTabNotifications|helpPanelNotifications/);
    assert.match(html, /id="toolSettingsNotificationsTab"[^>]*aria-controls="toolSettingsNotificationsPanel"/);
    assert.match(html, /id="toolSettingsNotificationsPanel"[^>]*hidden/);
    assert.match(html, /id="taskCompletionNotifications"[^>]*checked/);
    assert.match(html, /id="humanInteractionNotifications"[^>]*checked/);
    assert.ok(html.indexOf('id="toolSettingsNotificationsPanel"') < html.indexOf('id="humanInteractionNotifications"'));
    assert.ok(html.indexOf('id="authorizeNotifications"') < html.indexOf('id="helpOverlay"'));
    assert.match(html, /任务完成通知/);
    assert.match(html, /人机交互通知/);
    assert.match(html, /id="helpNotificationMac" hidden/);
    assert.match(html, /id="authorizeNotifications"[^>]*disabled/);
    assert.match(html, /id="notificationAuthorizationStatus" role="status" aria-live="polite"/);
    assert.match(html, /系统设置 → 通知 → 携宁 CLI 提醒/);
    assert.match(html, /选择“不允许”后不会反复弹出/);
    assert.doesNotMatch(html, /helpTabInstall|helpPanelInstall|npm i(?:nstall)? -g|winget install|移除系统环境变量配置/);
    assert.doesNotMatch(html, /help-section[^>]*style=/);
    const selects = interactiveModeSelects(html);
    assert.equal(selects.length, 2);
    assert.equal(selects.filter((select) => select.includes('id="interactiveModeSelect"')).length, 1);
    assert.equal(selects.filter((select) => select.includes('id="scheduledTaskMode"')).length, 1);
    for (const select of selects) {
      assert.match(select, /value="coding"/);
      assert.match(select, /value="loop"/);
      assert.match(select, /value="loop_plus"/);
      assert.doesNotMatch(select, /value="graph"/);
      assert.equal((select.match(/<option /g) || []).length, 3);
    }
  }

  assert.doesNotMatch(chineseHtml, /准备成本和界面复杂度最高|目前还没有图编辑器|缺点：/);
});
