import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

function buildHtml(helpModesMarkdown: string = WEBVIEW_STRINGS.helpModesMarkdown): string {
  return buildWebviewStaticHtml({
    cspSource: "vscode-resource://test-authority",
    nonce: "loop-plus-help-nonce",
    i18n: { ...getWebviewStrings(), helpModesMarkdown },
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
  assert.match(WEBVIEW_STRINGS.helpModesMarkdown, /^\| 模式 \| 使用说明 \|/);
  assert.equal(getWebviewStrings().toolSettingsNotificationsTab, "通知设置");
});

test("将中文模式说明的 Markdown 渲染为两列表格", () => {
  const chinese = helpModesPanel(buildHtml());

  assert.match(chinese, /<table>[\s\S]*<thead>[\s\S]*<tbody>/);
  assert.deepEqual([...chinese.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]), ["模式", "使用说明"]);
  assert.deepEqual([...chinese.matchAll(/<td>(.*?)<\/td>/g)].map((match) => match[1]), [
    "<strong>Vibe</strong>", "直接执行目标 CLI 任务。",
    "<strong>Loop</strong>", "主模型作为项目经理分发任务，调度多个子模型共同完成任务。",
    "<strong>Loop+（主推）</strong>", "主模型除分发任务外，还作为组长进行功能验收；发现缺陷时，会再次发起整改。",
  ]);
  assert.doesNotMatch(chinese, /<ul>|<li>|\| ---/);
  assert.match(chinese, /<\/table>\s*<p><a href="https:\/\/www\.yuque\.com\/hunjfang\/ul749m\/pkxei0ie9gc8bmim\?singleDoc#">《携宁 CLI 助手 - 教程》：点击进入详细教程<\/a><\/p>/);
  assert.doesNotMatch(chinese, /\[object Promise\]|undefined/);
});

test("帮助 Markdown 将原始 HTML 转为文本并拒绝可执行链接", () => {
  const panel = helpModesPanel(buildHtml([
    '<img src="x" onerror="alert(1)">',
    '<script>alert(1)</script>',
    '[不安全](javascript:alert%281%29)',
    '[编码协议](jav&#x61;script:alert%281%29)',
    '[教程](https://example.com/guide?first=1&second=2 "教程说明")',
  ].join("\n\n")));

  assert.match(panel, /&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(panel, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(panel, /<img|<script|href="(?:javascript|jav&#x61;script):/i);
  assert.match(panel, /<p>不安全<\/p>/);
  assert.match(panel, /<p>编码协议<\/p>/);
  assert.match(panel, /<a href="https:\/\/example\.com\/guide\?first=1&amp;second=2" title="教程说明">教程<\/a>/);
});

test("使用说明仅保留模式说明，通知授权和四个默认开启的开关位于工具设置", () => {
  const chineseHtml = buildHtml();

  for (const html of [chineseHtml]) {
    assert.doesNotMatch(html, /automatic conflict resolution|自动解冲突|不能自动解冲突|没有自动解冲突/);
    assert.match(html, /id="helpPanelModes" class="help-panel active"/);
    assert.doesNotMatch(html, /helpTabModes|helpTabNotifications|helpPanelNotifications/);
    assert.match(html, /id="toolSettingsNotificationsTab"[^>]*aria-controls="toolSettingsNotificationsPanel"/);
    assert.match(html, /id="toolSettingsNotificationsPanel"[^>]*hidden/);
    assert.match(html, /id="taskCompletionNotifications"[^>]*checked/);
    assert.match(html, /id="humanInteractionNotifications"[^>]*checked/);
    assert.match(html, /id="taskCompletionWindowAttention"[^>]*aria-labelledby="taskCompletionWindowAttentionLabel"[^>]*checked/);
    assert.match(html, /id="humanInteractionWindowAttention"[^>]*aria-labelledby="humanInteractionWindowAttentionLabel"[^>]*checked/);
    assert.ok(html.indexOf('id="toolSettingsNotificationsPanel"') < html.indexOf('id="humanInteractionNotifications"'));
    assert.ok(html.indexOf('id="authorizeNotifications"') < html.indexOf('id="helpOverlay"'));
    assert.match(html, /任务完成通知/);
    assert.match(html, /人机交互通知/);
    assert.match(html, /任务完成图标闪烁/);
    assert.match(html, /人机交互图标闪烁/);
    assert.match(html, /id="helpNotificationWindows"[^>]*hidden/);
    assert.match(html, /id="helpNotificationLinux"[^>]*hidden/);
    assert.match(html, /id="helpNotificationMac" hidden/);
    assert.match(html, /id="authorizeNotifications"[^>]*disabled/);
    assert.match(html, /id="notificationAuthorizationStatus" role="status" aria-live="polite"/);
    assert.match(html, /系统设置 → 通知 → 携宁 CLI 提醒/);
    assert.match(html, /拒绝后不再自动弹窗/);
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
