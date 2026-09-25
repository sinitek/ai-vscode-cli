import test = require("node:test");
import assert = require("node:assert/strict");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildLoopDebateChatPanelHtml,
  LoopDebateChatPanel,
} = require("../../webview/loopDebatePanel") as typeof import("../../webview/loopDebatePanel");
const {
  buildLoopDebateChatPanelTitle,
  getStrings,
} = require("../../webview/loopDebatePanelRenderer") as typeof import("../../webview/loopDebatePanelRenderer");
const { resolveLocale } = require("../../i18n") as typeof import("../../i18n");

test("renders the Loop task prompt before submitted supplemental requirements", () => {
  const html = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      task: {
        id: "task-1",
        cli: "codex",
        status: "running",
        rootPrompt: "完成任务",
        taskStoreFile: "/tmp/loop-tasks.json",
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
        loopRound: 2,
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
  const html = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      task: {
        id: "task-2",
        cli: "codex",
        status: "running",
        rootPrompt: "请先完成任务初始化。",
        taskStoreFile: "/tmp/loop-tasks.json",
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

test("does not render removed automatic wake controls for review tasks", () => {
  const html = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      task: {
        id: "task-review",
        cli: "codex",
        status: "needs-review",
        rootPrompt: "Wait for the external deployment and verify it.",
        taskStoreFile: "/tmp/loop-tasks.json",
        mainCommunicationFile: "/tmp/main-task.md",
        currentRound: 3,
        updatedAt: Date.now(),
        canSupplement: true,
        canContinue: true,
        canStop: false,
      },
      rounds: [{
        key: "execution-3",
        kind: "execution",
        loopRound: 3,
        debateRound: 0,
        status: "consensus",
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: "# Loop chat\n\n## 任务事件\nWaiting for manual review.",
    },
    "en",
  );

  assert.doesNotMatch(html, /class="auto-wake-banner"|id="autoWakeCountdown"|AUTO_WAKE_AT/u);
  assert.doesNotMatch(html, /Automatic sleep|Scheduled wake|window\.setInterval\(updateAutoWakeCountdown/u);
  assert.doesNotMatch(html, /<button[^>]*data-action="stopTask"/u);
  assert.match(html, /<button[^>]*data-action="continueTask"/u);
  assert.match(html, /Restore the original runtime/u);
  assert.match(html, /Use the newly configured models/u);
  assert.match(html, /value="original" disabled/u);
  assert.match(html, /loopDebateChat:continueTask", prompt, modelSource: readContinueModelSource\(\)/u);
});

test("hides the continue model choice when speaking in Loop and Loop+ group chat", () => {
  const html = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      task: {
        id: "task-speak",
        cli: "codex",
        status: "running",
        rootPrompt: "继续补充需求。",
        taskStoreFile: "/tmp/loop-tasks.json",
        mainCommunicationFile: "/tmp/main-task.md",
        currentRound: 1,
        updatedAt: Date.now(),
        canSupplement: true,
        canContinue: true,
        canStop: false,
      },
      rounds: [],
      chatMarkdown: "",
    },
    "zh-CN",
  );

  assert.match(html, /\[hidden\],\s*\.model-choice\[hidden\] \{\s*display: none !important;\s*\}/);
  const supplementDialog = html.slice(
    html.indexOf("function openSupplementDialog"),
    html.indexOf("function restoreDialogState"),
  );
  const continueDialog = html.slice(
    html.indexOf("function openContinueDialog"),
    html.indexOf("function closeContinueDialog"),
  );
  assert.match(supplementDialog, /setContinueModelChoiceVisible\(false\)/);
  assert.doesNotMatch(supplementDialog, /setContinueModelChoiceVisible\(true\)/);
  assert.match(continueDialog, /setContinueModelChoiceVisible\(true\)/);
  assert.match(html, /loopDebateChat:supplementTask", prompt \}/);
  assert.doesNotMatch(html, /loopDebateChat:supplementTask", prompt, modelSource/);
  assert.match(html, /loopDebateChat:continueTask", prompt, modelSource: readContinueModelSource\(\)/);
});

test("renders recorded and current Loop models on the continue dialog", () => {
  const html = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    {
      mode: "main_sub",
      continueModels: {
        original: { main: "original-main", subtask: "original-subtask" },
        current: { main: "current-main", subtask: "current-subtask" },
      },
      task: {
        id: "task-models",
        cli: "codex",
        status: "stopped",
        rootPrompt: "Continue the task.",
        taskStoreFile: "/tmp/loop-tasks.json",
        mainCommunicationFile: "/tmp/main-task.md",
        currentRound: 2,
        updatedAt: Date.now(),
        canSupplement: true,
        canContinue: true,
        canStop: false,
      },
      rounds: [],
      chatMarkdown: "",
    },
    "zh-CN",
  );

  assert.match(html, /恢复原分组和配置/u);
  assert.match(html, /使用新配置的主子模型/u);
  assert.match(html, /主模型 original-main，子模型 original-subtask/u);
  assert.match(html, /主模型 current-main，子模型 current-subtask/u);
  assert.match(html, /value="original" checked/u);
  assert.doesNotMatch(html, /value="original" disabled/u);
});

function createPanelHarness() {
  const vscode = require("vscode") as any;
  const harness: any = {
    createCalls: [],
    messages: [],
    disposed: 0,
    panel: {
      title: "",
      webview: {
        cspSource: "self",
        html: "",
        onDidReceiveMessage(handler: (message: unknown) => void) {
          harness.messageHandler = handler;
          return { dispose: () => undefined };
        },
      },
      reveal(column: unknown, preserveFocus?: boolean) {
        harness.reveal = { column, preserveFocus };
      },
      onDidDispose(handler: () => void) {
        harness.disposeHandler = handler;
        return { dispose: () => undefined };
      },
    },
  };
  vscode.window.createWebviewPanel = (...args: unknown[]) => {
    harness.createCalls.push(args);
    return harness.panel;
  };
  return harness;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createState(overrides: any = {}) {
  return {
    mode: "debate",
    task: {
      id: "task-123456789abcdef",
      cli: "codex",
      status: "running",
      rootPrompt: "Review the implementation & escape <tags>.",
      taskStoreFile: "/tmp/loop-tasks.json",
      mainCommunicationFile: "/tmp/main-task.md",
      currentRound: 2,
      updatedAt: Date.UTC(2026, 6, 15, 10, 0, 0),
      canSupplement: true,
      canContinue: true,
      canStop: false,
    },
    rounds: [
      {
        key: "debate-1",
        kind: "debate",
        loopRound: 2,
        debateRound: 1,
        status: "running",
        participantRosterSessionId: "moderator-roster",
        dialogueTurns: 2,
        activeSpeaker: { kind: "moderator", id: "moderator", title: "裁判主持人", dialogueTurn: 2, finalPass: true },
        startedAt: Date.UTC(2026, 6, 15, 9, 0, 0),
        completedAt: Date.UTC(2026, 6, 15, 9, 30, 0),
        consensusSummary: "shared decision",
        openDisagreementCount: 2,
        participants: [
          { id: "main", title: "Main Task", role: "main", status: "idle", stance: "lead", sessionId: "main-session", updatedAt: 1 },
          { id: "blue-planner", title: "Blue Planner", role: "participant", status: "running", stance: "support", sessionId: null, updatedAt: 2 },
          { id: "blue-planner", title: "Stale Blue Planner", role: "participant", status: "idle", stance: "stale", updatedAt: 1 },
          { id: "blue-planner", title: "Missing Time Blue Planner", role: "participant", status: "idle", stance: "missing-time" },
          { id: "no-time", title: "No Time", role: "participant", status: "idle" },
          { id: "no-time", title: "No Time Updated", role: "participant", status: "idle" },
          { id: "", title: "", role: "participant", status: "idle", updatedAt: 3 },
        ],
        moderatorDecisions: [
          { dialogueTurn: 1, action: "continue", reason: "Need more discussion", sessionId: "moderator-session", updatedAt: 4 },
        ],
      },
    ],
    chatMarkdown: [
      "# Loop 红蓝对抗群聊记录",
      "",
      "## 群聊规则",
      "保持简洁。",
      "",
      "## 参与者加入：蓝队方案方（blue-planner）",
      "蓝队加入。",
      "",
      "## 第 1 轮发言：蓝队方案方（blue-planner）",
      "蓝队观点。",
      "",
      "## 主持人控场：【裁判主持人】",
      "- 群聊发言批次：2",
      "主持人控场。",
      "",
      "## 最终立场：红队攻击方（red-attacker）",
      "红队最终立场。",
      "",
      "## 运行时强制收束",
      "强制收束。",
      "",
      "## 任务成功完成",
      "完成。",
      "",
      "## 任务中断",
      "中断。",
      "",
      "## 主持人停止说明",
      "停止。",
      "",
      "## 发言：空发言（empty-speaker）",
      "",
    ].join("\n"),
    ...overrides,
  };
}

test("covers Loop transcript fallback speakers, avatars, and template placeholders", () => {
  const loopDebate = require("../../loopDebate") as typeof import("../../loopDebate");
  const originalParse = loopDebate.parseLoopDebateChatTranscript;
  const strings = getStrings("en");
  const originalThinking = strings.thinking;

  try {
    strings.thinking = "{speaker} {missing}";
    (loopDebate as any).parseLoopDebateChatTranscript = () => ({
      title: "Synthetic",
      closed: false,
      segments: [
        { kind: "main-turn", heading: "Main default", body: "main default" },
        { kind: "subtask-turn", heading: "Subtask actor id", body: "subtask actor id", actorId: "worker-only" },
        { kind: "subtask-joined", heading: "Subtask default", body: "subtask default" },
        { kind: "moderator-turn", heading: "Moderator default", body: "moderator default" },
        { kind: "participant-joined", heading: "Participant actor id", body: "participant actor id", actorId: "participant-only" },
        { kind: "participant-turn", heading: "Participant heading", body: "participant heading" },
        { kind: "final-stance", heading: "Final heading", body: "final heading" },
        { kind: "participant-turn", heading: "", body: "empty speaker", actorTitle: "", actorId: "" },
        { kind: "task-event", heading: "", body: "system fallback" },
      ],
    });

    const html = buildLoopDebateChatPanelHtml(
      { cspSource: "self" } as any,
      createState({
        task: { ...createState().task, rootPrompt: "", id: "fallbacks", status: "running", canSupplement: false },
        rounds: [{
          key: "synthetic",
          kind: "debate",
          loopRound: 1,
          debateRound: 1,
          status: "running",
          activeSpeaker: { kind: "participant", id: "template-bot", title: "Template Bot" },
          startedAt: Date.now(),
          participants: [],
          moderatorDecisions: [],
        }],
        chatMarkdown: "synthetic transcript",
      }),
      "en",
    );

    assert.match(html, /<span class="speaker">Main task<\/span>/u);
    assert.match(html, /<span class="speaker">worker-only<\/span>/u);
    assert.match(html, /<span class="speaker">Subtask<\/span>/u);
    assert.match(html, /<span class="speaker">Judge moderator<\/span>/u);
    assert.match(html, /<span class="speaker">participant-only<\/span>/u);
    assert.match(html, /<span class="speaker">Participant heading<\/span>/u);
    assert.match(html, /<span class="speaker">Final heading<\/span>/u);
    assert.match(html, /<span class="avatar">\?<\/span>/u);
    assert.match(html, /<span class="speaker">System<\/span>/u);
    assert.match(html, /Template Bot \{missing\}/u);
    assert.doesNotMatch(html, />I want to speak<\/button>/u);
  } finally {
    (loopDebate as any).parseLoopDebateChatTranscript = originalParse;
    strings.thinking = originalThinking;
  }
});

test("covers Loop debate panel lifecycle, title, roster, active speaker, and transcript branches", () => {
  const strings = getStrings("en");
  assert.equal(buildLoopDebateChatPanelTitle(createState({ task: { ...createState().task, id: "   " } }), strings), "Loop Group Chat");
  assert.equal(buildLoopDebateChatPanelTitle(createState(), strings), "Loop Group Chat: task-1234567");

  const harness = createPanelHarness();
  const received: unknown[] = [];
  let disposed = 0;
  const panel = new LoopDebateChatPanel({ fsPath: "/extension" } as any, {
    onMessage: (message) => received.push(message),
    onDispose: () => {
      disposed += 1;
    },
  });
  panel.update(createState({ task: { ...createState().task, id: "pre-show" } }));
  assert.equal(panel.getState()?.task.id, "pre-show");

  const state = createState();
  panel.show(state);
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0][0], "sinitek-cli-tools.loopDebateChat");
  assert.equal(harness.createCalls[0][3].enableScripts, true);
  const activeStrings = getStrings(resolveLocale());
  assert.match(harness.panel.title, /task-123456/u);
  assert.match(harness.panel.webview.html, new RegExp(escapeRegExp(activeStrings.debateSubtitle)));
  assert.match(harness.panel.webview.html, new RegExp(escapeRegExp(activeStrings.moderator)));
  assert.doesNotMatch(harness.panel.webview.html, /moderator-session|main-session|会话：|Session：/u);
  assert.match(harness.panel.webview.html, new RegExp(escapeRegExp(activeStrings.lastStarted)));
  assert.match(harness.panel.webview.html, new RegExp(escapeRegExp(activeStrings.openDisagreements)));
  assert.match(harness.panel.webview.html, new RegExp(escapeRegExp(activeStrings.finalStance)));
  assert.match(harness.panel.webview.html, new RegExp(escapeRegExp(activeStrings.stopped)));
  assert.match(harness.panel.webview.html, /<pre class="message-text empty">\(empty\)<\/pre>/u);
  harness.messageHandler({ type: "loopDebateChat:refresh" });
  assert.deepEqual(received, [{ type: "loopDebateChat:refresh" }]);

  panel.show({ ...state, task: { ...state.task, id: "task-2", canStop: true, canContinue: true } });
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.reveal.preserveFocus, true);
  assert.match(harness.panel.webview.html, new RegExp(`>${escapeRegExp(activeStrings.stopTask)}</button>`));
  assert.doesNotMatch(harness.panel.webview.html, new RegExp(`>${escapeRegExp(activeStrings.continueTask)}</button>`));

  harness.disposeHandler();
  assert.equal(disposed, 1);
  assert.equal(panel.getState(), undefined);
});

test("covers Loop panel empty, error, no transcript, execution, and active speaker variants", () => {
  const errorHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({ error: "missing transcript" }),
    "en",
  );
  assert.match(errorHtml, /Unable to load transcript\./u);

  const consensusHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      task: { ...createState().task, rootPrompt: "", updatedAt: Number.NaN },
      rounds: [{
        key: "debate-2",
        kind: "debate",
        loopRound: 3,
        debateRound: 2,
        status: "running",
        activeSpeaker: { kind: "consensus", id: "consensus", title: "Consensus" },
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: "",
    }),
    "en",
  );
  assert.match(consensusHtml, /No transcript is available yet\./u);
  assert.match(consensusHtml, /Consensus summarizer is thinking/u);

  const executionHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      mode: "main_sub",
      task: { ...createState().task, id: "execution", canStop: false, canContinue: true, status: "running" },
      rounds: [{
        key: "execution-1",
        kind: "execution",
        loopRound: 1,
        debateRound: 0,
        status: "running",
        startedAt: Date.now(),
        participants: [
          { id: "main", title: "Main Task", role: "main", status: "running" },
          { id: "implement-ui", title: "Implement UI", role: "subtask", status: "idle" },
        ],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 主从群聊记录",
        "",
        "## 群聊规则",
        "规则。",
        "",
        "## 主持人控场",
        "主持人无轮次。",
        "",
        "## 主任务发言：第 1 轮（main）",
        "主任务发言。",
        "",
        "## 子任务加入：子任务 1（implement-ui）",
        "子任务加入。",
        "",
        "## 子任务发言：子任务 1（implement-ui）",
        "子任务发言。",
        "",
        "## 群聊收束",
        "收束。",
      ].join("\n"),
    }),
    "en",
  );
  assert.match(executionHtml, /Main\/subtask group chat/u);
  assert.match(executionHtml, />Continue<\/button>/u);
  assert.match(executionHtml, /Main task · Round 1/u);
  assert.match(executionHtml, /<span class="tag">Judge moderator<\/span>/u);
  assert.match(executionHtml, /Main Task is thinking/u);
  assert.match(executionHtml, /Closed/u);

  const subtaskThinkingHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      mode: "main_sub",
      task: { ...createState().task, rootPrompt: "", id: "subtask-thinking", status: "running" },
      rounds: [{
        key: "execution-subtask",
        kind: "execution",
        loopRound: 1,
        debateRound: 0,
        status: "running",
        startedAt: Date.now(),
        participants: [
          { id: "main", title: "Main Task", role: "main", status: "idle" },
          { id: "implement-ui", title: "Implement UI", role: "subtask", status: "running" },
        ],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 主从群聊记录",
        "",
        "## 群聊规则",
        "规则。",
      ].join("\n"),
    }),
    "en",
  );
  assert.match(subtaskThinkingHtml, /<span class="tag">Subtask<\/span>/u);
  assert.match(subtaskThinkingHtml, /Implement UI is thinking/u);

  const participantTurnThinkingHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      task: { ...createState().task, rootPrompt: "", id: "participant-turn-thinking", status: "running" },
      rounds: [{
        key: "debate-participant-turn",
        kind: "debate",
        loopRound: 2,
        debateRound: 1,
        status: "running",
        activeSpeaker: { kind: "participant", id: "blue-planner", title: "Blue Planner", dialogueTurn: 3 },
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 红蓝对抗群聊记录",
        "",
        "## 群聊规则",
        "规则。",
      ].join("\n"),
    }),
    "en",
  );
  assert.match(participantTurnThinkingHtml, /<span class="tag">Turn 3<\/span>/u);
  assert.match(participantTurnThinkingHtml, /Blue Planner is thinking/u);

  const moderatorTurnThinkingHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      task: { ...createState().task, rootPrompt: "", id: "moderator-turn-thinking", status: "running" },
      rounds: [{
        key: "debate-moderator-turn",
        kind: "debate",
        loopRound: 2,
        debateRound: 1,
        status: "running",
        activeSpeaker: { kind: "moderator", id: "moderator", title: "Judge moderator", dialogueTurn: 4 },
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 红蓝对抗群聊记录",
        "",
        "## 群聊规则",
        "规则。",
      ].join("\n"),
    }),
    "en",
  );
  assert.match(moderatorTurnThinkingHtml, /<span class="tag">Judge moderator · Turn 4<\/span>/u);
  assert.match(moderatorTurnThinkingHtml, /Judge moderator is thinking/u);

  const inferredParticipantThinkingHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      task: { ...createState().task, rootPrompt: "", id: "inferred-participant", status: "running" },
      rounds: [{
        key: "debate-inferred-participant",
        kind: "debate",
        loopRound: 2,
        debateRound: 1,
        status: "running",
        startedAt: Date.now(),
        participants: [
          { id: "blue-planner", title: "Blue Planner", role: "participant", status: "running" },
        ],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 红蓝对抗群聊记录",
        "",
        "## 群聊规则",
        "规则。",
      ].join("\n"),
    }),
    "en",
  );
  assert.match(inferredParticipantThinkingHtml, /<span class="tag">Thinking<\/span>/u);
  assert.match(inferredParticipantThinkingHtml, /Blue Planner is thinking/u);

  const completedRoundHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      task: { ...createState().task, rootPrompt: "", id: "completed-round", status: "running" },
      rounds: [{
        key: "debate-completed",
        kind: "debate",
        loopRound: 2,
        debateRound: 1,
        status: "completed",
        activeSpeaker: { kind: "participant", id: "blue-planner", title: "Blue Planner" },
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 红蓝对抗群聊记录",
        "",
        "## 群聊规则",
        "规则。",
      ].join("\n"),
    }),
    "en",
  );
  assert.doesNotMatch(completedRoundHtml, /is thinking/u);

  const completedTaskHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      task: { ...createState().task, rootPrompt: "", id: "completed-task", status: "completed" },
      rounds: [{
        key: "debate-completed-task",
        kind: "debate",
        loopRound: 2,
        debateRound: 1,
        status: "running",
        activeSpeaker: { kind: "participant", id: "blue-planner", title: "Blue Planner" },
        startedAt: Date.now(),
        participants: [],
        moderatorDecisions: [],
      }],
      chatMarkdown: [
        "# Loop 红蓝对抗群聊记录",
        "",
        "## 群聊规则",
        "规则。",
      ].join("\n"),
    }),
    "en",
  );
  assert.doesNotMatch(completedTaskHtml, /is thinking/u);
});

test("keeps classic main/sub and debate panels on the round rhythm", () => {
  const mainHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      mode: "main_sub",
      rounds: [{
        key: "execution-1",
        kind: "execution",
        loopRound: 2,
        debateRound: 0,
        status: "running",
        startedAt: Date.now(),
        activeSpeaker: { kind: "main", id: "main", title: "Main task", dialogueTurn: 2 },
        participants: [{ id: "main", title: "Main task", role: "main", status: "running" }],
        moderatorDecisions: [],
      }],
      chatMarkdown: "# Loop 主从群聊记录\n",
    }),
    "zh-CN",
  );
  assert.match(mainHtml, /<h1>Loop 群聊<\/h1>/u);
  assert.match(mainHtml, /主从群聊/u);
  assert.match(mainHtml, /<div class="meta-label">当前轮次<\/div>/u);
  assert.match(mainHtml, /主任务 思考中|Main task 思考中/u);
  assert.doesNotMatch(mainHtml, /data-loop-plus-/u);

  const debateHtml = buildLoopDebateChatPanelHtml(
    { cspSource: "self" } as any,
    createState(),
    "en",
  );
  assert.match(debateHtml, /<h1>Loop Group Chat<\/h1>/u);
  assert.match(debateHtml, /Red\/Blue debate group chat/u);
  assert.match(debateHtml, /<div class="meta-label">Current round<\/div>/u);
  assert.match(debateHtml, /preparing a final stance/u);
  assert.doesNotMatch(debateHtml, /data-loop-plus-|Loop\+/u);

  assert.equal(getStrings("en").title, "Loop Group Chat");
  assert.equal(getStrings("zh-CN").title, "Loop 群聊");
  assert.equal(getStrings("en").titleLoopPlus, "Loop+ Group Chat");
  assert.equal(getStrings("zh-CN").titleLoopPlus, "Loop+ 群聊");
  assert.equal(getStrings("en").lastStarted, "Last started");
  assert.equal(getStrings("zh-CN").lastStarted, "最后启动");
  assert.equal(getStrings("en").notStarted, "Not started");
  assert.equal(getStrings("zh-CN").notStarted, "未启动");
  assert.equal(getStrings("en").loopPlusActivityStopped.includes("Reviewing"), false);
  assert.equal(getStrings("zh-CN").loopPlusActivityStopped.includes("正在验收"), false);
  assert.equal(getStrings("en").loopPlusActivityPaused.includes("Reviewing"), false);
  assert.equal(getStrings("zh-CN").loopPlusActivityPaused.includes("正在验收"), false);
  assert.match(getStrings("en").loopPlusActivityPaused, /paused until you continue/u);
  assert.match(getStrings("zh-CN").loopPlusActivityPaused, /自动验收已暂停，需要继续/u);
  assert.equal(getStrings("en").loopPlusStatusPaused, "Automatic review paused");
  assert.equal(getStrings("zh-CN").loopPlusStatusPaused, "自动验收已暂停");
});

test("does not show a generating speaker for an explicit Loop+ projection", () => {
  const loopPlus = {
    ok: true as const,
    schedulingMode: "event_driven" as const,
    activity: "reviewing" as const,
    phase: "reviewing" as const,
    wakePending: false,
    currentReview: {
      eventId: "loop-plus-finish#1:A3:a-1",
      subtaskId: "A",
      attemptId: "a-1",
      outcome: "completed" as const,
      detail: "<i>report</i>",
    },
    reviewQueue: [{
      eventId: "loop-plus-finish#1:B3:b-1",
      subtaskId: "B",
      attemptId: "b-1",
      outcome: "failed" as const,
      detail: null,
    }],
    currentReviewCount: 1,
    reviewQueueCount: 1,
    visibleReviewCount: 2,
    running: [{ subtaskId: "D", attemptId: "d-1", title: null, state: "running" as const }],
    pending: [{ subtaskId: "E", attemptId: "e-1", title: "Echo", state: "pending" as const }],
    runningCount: 1,
    pendingCount: 1,
    seenAttempts: [],
  };
  for (const locale of ["zh-CN", "en"] as const) {
    const page = buildLoopDebateChatPanelHtml(
      { cspSource: "self" } as any,
      createState({
        mode: "main_sub",
        loopPlus,
        task: { ...createState().task, status: "running", currentRound: 9, canStop: true, canContinue: false },
        rounds: [{
          key: "execution-1",
          kind: "execution",
          loopRound: 9,
          debateRound: 0,
          status: "running",
          startedAt: Date.now(),
          activeSpeaker: { kind: "main", id: "main", title: "Main task" },
          participants: [
            { id: "main", title: "Main task", role: "main", status: "reviewing" },
            { id: "D", title: "Delta", role: "subtask", status: "running" },
          ],
          moderatorDecisions: [],
        }],
        chatMarkdown: "# Loop chat\n",
      }),
      locale,
    );
    assert.match(page, locale === "zh-CN" ? /<h1>Loop\+ 群聊<\/h1>/u : /<h1>Loop\+ Group Chat<\/h1>/u);
    assert.match(page, /data-loop-plus-role="current" data-loop-plus-subtask="A"/u);
    assert.match(page, /data-loop-plus-role="queued" data-loop-plus-subtask="B"/u);
    assert.match(page, /data-loop-plus-role="running" data-loop-plus-subtask="D"/u);
    assert.match(page, /data-loop-plus-role="pending" data-loop-plus-subtask="E"/u);
    assert.match(page, /&lt;i&gt;report&lt;\/i&gt;/u);
    assert.doesNotMatch(page, /<i>report<\/i>/u);
    assert.doesNotMatch(page, /class="message [^"]*thinking|思考中| is thinking/u);
    assert.doesNotMatch(page, /<div class="meta-label">(?:当前轮次|Current round)<\/div>/u);
    assert.match(page, /<button[^>]*data-action="stopTask"/u);
    assert.doesNotMatch(page, /<button[^>]*data-action="continueTask"/u);
  }
});

test("renders an explicit paused Loop+ projection without a reviewing or thinking bubble", () => {
  const loopPlus = {
    ok: true as const,
    schedulingMode: "event_driven" as const,
    activity: "paused" as const,
    phase: "reviewing" as const,
    wakePending: false,
    currentReview: {
      eventId: "loop-plus-finish#1:A3:a-1",
      subtaskId: "A",
      attemptId: "a-1",
      outcome: "completed" as const,
      detail: null,
    },
    reviewQueue: [{
      eventId: "loop-plus-finish#1:B3:b-1",
      subtaskId: "B",
      attemptId: "b-1",
      outcome: "failed" as const,
      detail: null,
    }],
    currentReviewCount: 1,
    reviewQueueCount: 1,
    visibleReviewCount: 2,
    running: [{ subtaskId: "D", attemptId: "d-1", title: "Delta", state: "running" as const }],
    pending: [{ subtaskId: "E", attemptId: "e-1", title: "Echo", state: "pending" as const }],
    runningCount: 1,
    pendingCount: 1,
    seenAttempts: [],
  };
  for (const locale of ["zh-CN", "en"] as const) {
    const page = buildLoopDebateChatPanelHtml(
      { cspSource: "self" } as any,
      createState({
        mode: "main_sub",
        loopPlus,
        task: { ...createState().task, status: "needs-review", canContinue: true, canStop: false },
        rounds: [{
          key: "execution-1",
          kind: "execution",
          loopRound: 4,
          debateRound: 0,
          status: "reviewing",
          startedAt: Date.now(),
          activeSpeaker: { kind: "main", id: "main", title: "Main task" },
          participants: [
            { id: "main", title: "Main task", role: "main", status: "paused" },
            { id: "A", title: "Alpha", role: "subtask", status: "held_review" },
          ],
          moderatorDecisions: [],
        }],
        chatMarkdown: "# Loop chat\n",
      }),
      locale,
    );
    assert.match(page, /data-loop-plus-status="paused"/u);
    assert.match(page, /data-loop-plus-phase="reviewing"/u);
    assert.match(page, /data-loop-plus-role="current" data-loop-plus-subtask="A"/u);
    assert.match(page, /data-loop-plus-role="queued" data-loop-plus-subtask="B"/u);
    assert.match(page, /data-loop-plus-role="running" data-loop-plus-subtask="D"/u);
    assert.match(page, /data-loop-plus-role="pending" data-loop-plus-subtask="E"/u);
    assert.doesNotMatch(page, /class="message [^"]*thinking|思考中| is thinking|正在验收|Reviewing /u);
    assert.match(page, /<button[^>]*data-action="continueTask"/u);
    assert.doesNotMatch(page, /<button[^>]*data-action="stopTask"/u);
    if (locale === "zh-CN") {
      assert.match(page, /自动验收已暂停，需要继续后才会恢复/u);
      assert.match(page, /验收已暂停/u);
    } else {
      assert.match(page, /Automatic review is paused until you continue/u);
      assert.match(page, /Automatic review paused/u);
    }
  }
});
