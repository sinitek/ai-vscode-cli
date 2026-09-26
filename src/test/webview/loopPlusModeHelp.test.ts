import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_I18N } from "../../webview/viewContentI18n";

const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "main_sub_multi_agent";
const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT = "debate_multi_agent";

function buildHtml(locale: "en" | "zh-CN"): string {
  return buildWebviewStaticHtml({
    locale,
    cspSource: "vscode-resource://test-authority",
    nonce: "loop-plus-help-nonce",
    i18n: getWebviewStrings(locale),
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent:
      LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT,
    loopExecutionModeDebateMultiAgent: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
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

test("keeps English and Chinese help keys aligned", () => {
  assert.deepEqual(
    Object.keys(WEBVIEW_I18N["zh-CN"]).sort(),
    Object.keys(WEBVIEW_I18N.en).sort(),
  );
  assert.equal(WEBVIEW_I18N.en.helpModeLoopPlusTitle, "Loop+");
  assert.equal(WEBVIEW_I18N["zh-CN"].helpModeLoopPlusTitle, "Loop+");
  assert.equal(getWebviewStrings("en").helpTabModes, "Modes");
  assert.equal(getWebviewStrings("zh-CN").helpTabModes, "模式说明");
});

test("renders Loop and Loop+ differences in both help locales", () => {
  const english = helpModesPanel(buildHtml("en"));
  const chinese = helpModesPanel(buildHtml("zh-CN"));

  assert.ok(
    english.indexOf(">Loop<") < english.indexOf(">Loop+<") &&
      english.indexOf(">Loop+<") < english.indexOf(">Graph<"),
  );
  assert.ok(
    chinese.indexOf(">Loop<") < chinese.indexOf(">Loop+<") &&
      chinese.indexOf(">Loop+<") < chinese.indexOf(">Graph<"),
  );

  for (const snippet of [
    "How to Choose",
    "whole batch should finish before one combined review",
    "reviews that batch together only after every subtask in the round has finished executing",
    "without waiting for a shared round",
    "visible queue",
    "accepted together",
    "waits while other tasks are still running",
    "Speaking wakes the main task",
    "reads the queued messages together",
    "Vibe",
  ]) {
    assert.ok(english.includes(snippet), `Missing English help snippet: ${snippet}`);
  }

  for (const snippet of [
    "如何选择",
    "等整批执行结束后集中复核",
    "再一次性集中复核",
    "而不按统一轮次等待整批",
    "可见队列",
    "一起验收",
    "仍有任务在运行时继续等待",
    "说话会唤醒主任务",
    "一起查看",
    "快速问答",
  ]) {
    assert.ok(chinese.includes(snippet), `Missing Chinese help snippet: ${snippet}`);
  }
});

test("stops claiming Graph cannot resolve conflicts and keeps the existing help shell", () => {
  const englishHtml = buildHtml("en");
  const chineseHtml = buildHtml("zh-CN");

  for (const html of [englishHtml, chineseHtml]) {
    assert.doesNotMatch(html, /automatic conflict resolution|自动解冲突|不能自动解冲突|没有自动解冲突/);
    assert.match(html, /id="helpTabInstall"/);
    assert.match(html, /id="helpTabModes"/);
    assert.match(html, /id="helpPanelInstall" class="help-panel active"/);
    assert.match(html, /npm i -g @openai\/codex/);
    assert.match(html, /npm install -g @anthropic-ai\/claude-code/);
    assert.match(html, /npm install -g opencode-ai/);
    assert.doesNotMatch(html, /help-section[^>]*style=/);
    const selects = interactiveModeSelects(html);
    assert.equal(selects.length, 2);
    assert.equal(selects.filter((select) => select.includes('id="interactiveModeSelect"')).length, 1);
    assert.equal(selects.filter((select) => select.includes('id="scheduledTaskMode"')).length, 1);
    for (const select of selects) {
      assert.match(select, /value="coding"/);
      assert.match(select, /value="loop"/);
      assert.match(select, /value="loop_plus"/);
      assert.match(select, /value="graph"/);
    }
  }

  assert.doesNotMatch(englishHtml, /highest setup cost and UI complexity|still no graph editor|Cons:/);
  assert.doesNotMatch(chineseHtml, /准备成本和界面复杂度最高|目前还没有图编辑器|缺点：/);
});
