import test = require("node:test");
import assert = require("node:assert/strict");

import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  buildLobsterDebateChatPanelHtml,
} = require("../webview/lobsterDebatePanel") as typeof import("../webview/lobsterDebatePanel");

test("renders the Loop task prompt before submitted supplemental requirements", () => {
  const html = buildLobsterDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      task: {
        id: "task-1",
        cli: "codex",
        status: "running",
        rootPrompt: "完成任务",
        taskStoreFile: "/tmp/lobster-tasks.json",
        mainCommunicationFile: "/tmp/main-task.md",
        currentRound: 2,
        updatedAt: Date.now(),
        canSupplement: true,
        canContinue: false,
        canStop: true,
      },
      rounds: [{
        key: "execution-2",
        kind: "execution",
        lobsterRound: 2,
        debateRound: 0,
        status: "running",
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 主从群聊记录",
        "",
        "## 补充需求",
        "- 时间：2026-07-10T08:00:00.000Z",
        "- 主任务轮次：2",
        "请补充提交失败场景。",
      ].join("\n"),
    },
    "zh-CN",
  );

  assert.match(html, />我要说话<\/button>/u);
  assert.match(html, /class="message user-message no-avatar"/u);
  assert.match(html, /\.message\.user-message \.bubble \{[^}]*border-color: var\(--vscode-charts-green/u);
  assert.match(html, /<span class="speaker">我<\/span>/u);
  assert.match(html, /<span class="tag">任务发起<\/span>/u);
  assert.match(html, /<pre class="message-text">完成任务<\/pre>/u);
  assert.match(html, /<pre class="message-text">请补充提交失败场景。<\/pre>/u);
  assert.ok(
    html.indexOf("<pre class=\"message-text\">完成任务</pre>")
      < html.indexOf("<pre class=\"message-text\">请补充提交失败场景。</pre>"),
  );
  assert.doesNotMatch(html, /<pre class="message-text">[^<]*主任务轮次/u);
});

test("renders the Loop task prompt before chat records exist", () => {
  const html = buildLobsterDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      task: {
        id: "task-2",
        cli: "codex",
        status: "running",
        rootPrompt: "请先完成任务初始化。",
        taskStoreFile: "/tmp/lobster-tasks.json",
        mainCommunicationFile: "/tmp/main-task.md",
        currentRound: 0,
        updatedAt: Date.now(),
        canSupplement: true,
        canContinue: false,
        canStop: true,
      },
      rounds: [],
      chatMarkdown: "",
    },
    "zh-CN",
  );

  assert.match(html, /<span class="tag">任务发起<\/span>/u);
  assert.match(html, /<pre class="message-text">请先完成任务初始化。<\/pre>/u);
  assert.match(html, /暂无群聊记录。/u);
  assert.ok(
    html.indexOf("<pre class=\"message-text\">请先完成任务初始化。</pre>")
      < html.indexOf("暂无群聊记录。"),
  );
});
