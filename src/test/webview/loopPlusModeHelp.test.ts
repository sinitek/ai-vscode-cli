import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "main_sub_multi_agent";
const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT = "debate_multi_agent";

function buildHtml(): string {
  return buildWebviewStaticHtml({
    cspSource: "vscode-resource://test-authority",
    nonce: "loop-plus-help-nonce",
    i18n: getWebviewStrings(),
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

test("使用固定中文帮助文案", () => {
  assert.ok(Object.keys(WEBVIEW_STRINGS).length > 0);
  assert.equal(WEBVIEW_STRINGS.helpModeLoopPlusTitle, "Loop+");
  assert.equal(getWebviewStrings().helpTabModes, "模式说明");
});

test("渲染简洁准确的中文模式说明", () => {
  const chinese = helpModesPanel(buildHtml());

  assert.ok(
    chinese.indexOf(">Loop<") < chinese.indexOf(">Loop+<") &&
      chinese.indexOf(">Loop+<") < chinese.indexOf(">Graph<"),
  );

  for (const snippet of [
    "如何选择",
    "Loop+ 按事件验收",
    "交互直接、启动快、开销低",
    "批次边界清楚、上下文共享、统一复核",
    "完成即验收",
    "可见队列",
    "追加消息或任务",
    "实现、契约、测试、产物、未授权改动",
    "需要时可以自行测试或启动应用，但不强制。",
    "默认 100，最大 999",
    "明确依赖、并行执行和证据可视化",
    "调度与恢复边界清楚",
  ]) {
    assert.ok(chinese.includes(snippet), `Missing Chinese help snippet: ${snippet}`);
  }
});

test("不再声称 Graph 无法处理冲突并保留帮助面板结构", () => {
  const chineseHtml = buildHtml();

  for (const html of [chineseHtml]) {
    assert.doesNotMatch(html, /automatic conflict resolution|自动解冲突|不能自动解冲突|没有自动解冲突/);
    assert.match(html, /id="helpTabInstall"/);
    assert.match(html, /id="helpTabModes"/);
    assert.match(html, /id="helpPanelInstall" class="help-panel active"/);
    assert.equal(html.split("npm i -g @openai/codex").length - 1, 1);
    assert.match(html, /npm install -g @anthropic-ai\/claude-code/);
    assert.match(html, /npm install -g opencode-ai/);
    assert.match(html, /winget install --id Microsoft\.PowerShell --source winget/);
    assert.doesNotMatch(html, /安装加速|Install Acceleration|registry\.npmmirror\.com|Windows 安装|macOS 安装|Windows Install|macOS Install/);
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

  assert.match(chineseHtml, /Windows 必须先安装 PowerShell，再执行上面的命令/);
  assert.doesNotMatch(chineseHtml, /准备成本和界面复杂度最高|目前还没有图编辑器|缺点：/);
});
