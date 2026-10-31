import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildLoopGroupChatPanelHtml: buildLoopGroupChatPanelHtmlImpl,
  LoopGroupChatPanel,
} = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");
const {
  buildLoopGroupChatPanelTitle,
  getStrings,
} = require("../../webview/loopGroupChatPanelRenderer") as typeof import("../../webview/loopGroupChatPanelRenderer");
function buildLoopGroupChatPanelHtml(
  webview: Parameters<typeof buildLoopGroupChatPanelHtmlImpl>[0],
  state: Parameters<typeof buildLoopGroupChatPanelHtmlImpl>[1],
  askThread?: unknown,
): string {
  return buildLoopGroupChatPanelHtmlImpl(webview, state, askThread as never);
}

test("renders the Loop task prompt before submitted supplemental requirements", () => {
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    {
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
        status: "running",
        startedAt: Date.now(),
        participants: [],
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
  );

  assert.match(html, /data-action="supplementTask"[^>]*>补充需求<\/button>/u);
  assert.match(html, /data-action="askMainModel"[^>]*>我要提问<\/button>/u);
  assert.doesNotMatch(html, /data-action="acceptancePlan"/u);
  assert.ok(html.indexOf('data-action="supplementTask"') < html.indexOf('data-action="askMainModel"'));
  assert.match(html, /class="message user-message no-avatar"/u);
  assert.match(html, /\.message\.user-message \.bubble \{[^}]*border-color: var\(--vscode-charts-green/u);
  assert.match(html, /<span class="speaker">我<\/span>/u);
  assert.match(html, /<span class="tag">任务发起<\/span>/u);
  assert.match(html, /<div class="message-text markdown-body" data-markdown-source="完成任务">完成任务<\/div>/u);
  assert.match(html, /<div class="message-text markdown-body" data-markdown-source="请补充提交失败场景。">请补充提交失败场景。<\/div>/u);
  assert.ok(
    html.indexOf('data-markdown-source="完成任务">完成任务</div>')
      < html.indexOf('data-markdown-source="请补充提交失败场景。">请补充提交失败场景。</div>'),
  );
  assert.doesNotMatch(html, /data-markdown-source="[^"]*主任务轮次/u);
});

test("renders the Loop task prompt before chat records exist", () => {
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    {
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
  );

  assert.match(html, /<span class="tag">任务发起<\/span>/u);
  assert.match(html, /data-markdown-source="请先完成任务初始化。">请先完成任务初始化。<\/div>/u);
  assert.match(html, /暂无群聊记录。/u);
  assert.ok(
    html.indexOf('data-markdown-source="请先完成任务初始化。">请先完成任务初始化。</div>')
      < html.indexOf("暂无群聊记录。"),
  );
});

test("does not render removed automatic wake controls for review tasks", () => {
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    {
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
        status: "consensus",
        startedAt: Date.now(),
        participants: [],
      }],
      chatMarkdown: "# Loop chat\n\n## 任务事件\n等待人工复核。",
    },
  );

  assert.doesNotMatch(html, /class="auto-wake-banner"|id="autoWakeCountdown"|AUTO_WAKE_AT/u);
  assert.doesNotMatch(html, /Automatic sleep|Scheduled wake|window\.setInterval\(updateAutoWakeCountdown/u);
  assert.doesNotMatch(html, /<button[^>]*data-action="stopTask"/u);
  assert.match(html, /<button[^>]*data-action="continueTask"/u);
  assert.match(html, /恢复原分组和配置/u);
  assert.match(html, /使用新配置的主子模型/u);
  assert.match(html, /value="original" disabled/u);
  assert.match(html, /loopGroupChatChat:continueTask", prompt, modelSource: readContinueModelSource\(\)/u);
});

test("hides the continue model choice when speaking in Loop and Loop+ group chat", () => {
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    {
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
  assert.match(html, /loopGroupChatChat:supplementTask", prompt \}/);
  assert.doesNotMatch(html, /loopGroupChatChat:supplementTask", prompt, modelSource/);
  const askDialog = html.slice(
    html.indexOf("function openAskDialog"),
    html.indexOf("function closeAskDialog"),
  );
  assert.doesNotMatch(askDialog, /setContinueModelChoiceVisible\(/);
  assert.match(html, /loopGroupChatChat:askMainModel", prompt: prompt \}/);
  assert.match(html, /id="askChatBackdrop"/);
  assert.match(html, /loopGroupChatChat:abortMainModelQuestion/);
  assert.match(html, /ask-chat-message waiting/);
  assert.match(html, /ask-chat-waiting/);
  assert.doesNotMatch(html, /ask-chat-message thinking/);
  assert.match(html, /loopGroupChatChat:continueTask", prompt, modelSource: readContinueModelSource\(\)/);
});

test("restores the supplement dialog before a main-task refresh can mark it closed", () => {
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    {
      task: {
        id: "task-dialog-refresh",
        cli: "codex",
        status: "running",
        rootPrompt: "主任务刷新时不要关掉补充需求。",
        taskStoreFile: "/tmp/loop-tasks.json",
        mainCommunicationFile: "/tmp/main-task.md",
        currentRound: 1,
        updatedAt: Date.now(),
        canSupplement: true,
        canContinue: false,
        canStop: true,
      },
      rounds: [],
      chatMarkdown: "",
    },
  );

  const saveDialog = html.slice(html.indexOf("function saveDialogState"), html.indexOf("function clearDialogState"));
  const restoreDialog = html.slice(html.indexOf("function restoreDialogState"), html.indexOf("function submitAskDialog"));
  const synchronousRestore = html.indexOf("restoreDialogState();");
  const visibilityListener = html.indexOf('addEventListener("visibilitychange"');
  const unloadListener = html.indexOf('addEventListener("beforeunload"');
  const animationFrame = html.slice(html.lastIndexOf("window.requestAnimationFrame(() => {"), html.indexOf("startAutoRefresh"));

  assert.match(saveDialog, /if \(!dialogStateRestored\)/);
  assert.match(restoreDialog, /dialogStateRestored = true/);
  assert.match(restoreDialog, /openSupplementDialog\(preservedPrompt\)/);
  const patcher = html.slice(html.indexOf("function applyContentPatch"), html.indexOf("function startAutoRefresh"));
  assert.doesNotMatch(patcher, /continueDialogInput\.value/);
  assert.match(patcher, /timelineSlot/);
  assert.match(html, /loopGroupChatChat:domReady/);
  assert.ok(synchronousRestore > html.indexOf("function restoreDialogState"));
  assert.ok(synchronousRestore < visibilityListener);
  assert.ok(synchronousRestore < unloadListener);
  assert.doesNotMatch(animationFrame, /restoreDialogState\(\)/);
});

test("renders recorded and current Loop models on the continue dialog", () => {
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    {
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
  );

  assert.match(html, /恢复原分组和配置/u);
  assert.match(html, /使用新配置的主子模型/u);
  assert.match(html, /主模型 original-main，子模型 original-subtask/u);
  assert.match(html, /主模型 current-main，子模型 current-subtask/u);
  assert.match(html, /value="original" checked/u);
  assert.doesNotMatch(html, /value="original" disabled/u);
});

test("refreshes the current runtime configuration immediately when the continue dialog opens", () => {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  const openDialog = html.slice(html.indexOf("function openContinueDialog"), html.indexOf("function closeContinueDialog"));
  const calls: string[] = [];
  const input = { value: "", focus: () => undefined, select: () => undefined };
  const context = {
    continueDialogBackdrop: { classList: { add: () => undefined }, setAttribute: () => undefined },
    continueDialogInput: input,
    continueDialogConfirm: { dataset: {} },
    continueDialogOpen: false,
    continueDialogMode: undefined,
    setContinueDialogError: () => undefined,
    setContinueModelChoiceVisible: () => undefined,
    saveDialogState: () => calls.push("save"),
    requestRefresh: () => calls.push("refresh"),
    window: { setTimeout: () => undefined },
  };

  vm.runInNewContext(`${openDialog}\nopenContinueDialog("保留继续说明");`, context);

  assert.deepEqual(calls, ["save", "refresh"]);
  assert.equal(input.value, "保留继续说明");
  assert.equal(context.continueDialogOpen, true);
  assert.equal(context.continueDialogMode, "continue");
});

for (const scenario of [
  { name: "current selection and focus", source: "current", hidden: false, focused: true, originalAvailable: true, empty: false, expected: "current" },
  { name: "original selection", source: "original", hidden: false, focused: false, originalAvailable: true, empty: false, expected: "original" },
  { name: "unavailable original fallback", source: "original", hidden: false, focused: true, originalAvailable: false, empty: false, expected: "current" },
  { name: "hidden supplement controls", source: "current", hidden: true, focused: false, originalAvailable: true, empty: false, expected: "current" },
  { name: "empty patch", source: "current", hidden: false, focused: false, originalAvailable: true, empty: true, expected: "current" },
]) {
  test(`updates continue configuration while the dialog is open and preserves ${scenario.name}`, () => {
    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
    const readSource = html.slice(html.indexOf("function readContinueModelSource"), html.indexOf("function setContinueModelChoiceVisible"));
    const replaceChoice = html.slice(html.indexOf("function replaceContinueModelChoice"), html.indexOf("function applyClarificationPatch"));
    let focusedSource: string | undefined;
    type ModelChoiceHarness = {
      hidden: boolean;
      querySelector: (selector: string) => { value: string; disabled: boolean; checked?: boolean; focus: () => void };
      contains: () => boolean;
      replaceWith: (next: ModelChoiceHarness) => void;
    };
    const createChoice = (selectedSource: string, originalAvailable: boolean): ModelChoiceHarness => ({
      hidden: false,
      querySelector: (selector: string) => {
        const value = selector.includes(":checked") ? selectedSource : selector.includes('value="original"') ? "original" : "current";
        return {
          value,
          disabled: value === "original" && !originalAvailable,
          set checked(checked: boolean) {
            if (checked) {
              selectedSource = value;
            }
          },
          focus: () => { focusedSource = value; },
        };
      },
      contains: () => scenario.focused,
      replaceWith: (next) => { current = next; },
    });
    let current = createChoice(scenario.source, true);
    const original = current;
    current.hidden = scenario.hidden;
    const next = createChoice(scenario.originalAvailable ? "original" : "current", scenario.originalAvailable);
    const document = {
      activeElement: {},
      getElementById: () => current,
      querySelector: (selector: string) => current.querySelector(selector),
      createElement: () => ({ innerHTML: "", firstElementChild: next }),
    };

    vm.runInNewContext(`${readSource}\n${replaceChoice}\nreplaceContinueModelChoice(incomingHtml);`, {
      document,
      continueDialogMode: "continue",
      incomingHtml: scenario.empty ? "" : "<div>更新后的配置</div>",
    });

    assert.equal(current, scenario.empty ? original : next);
    assert.equal(current.hidden, scenario.hidden);
    assert.equal(current.querySelector(":checked").value, scenario.expected);
    assert.equal(focusedSource, scenario.focused ? scenario.expected : undefined);
  });
}

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
        postMessage(message: unknown) {
          harness.messages.push(message);
        },
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

test("group chat handles shared image messages without forwarding them to Loop orchestration", async () => {
  const { ChatImageHost } = require("../../webview/chatImageHost") as typeof import("../../webview/chatImageHost");
  const original = ChatImageHost.prototype.handleMessage;
  const handled: unknown[] = [];
  const forwarded: unknown[] = [];
  ChatImageHost.prototype.handleMessage = async (message) => { handled.push(message); };
  try {
    const harness = createPanelHarness();
    const panel = new LoopGroupChatPanel({ fsPath: "/extension" } as any, { onMessage: (message) => forwarded.push(message) });
    panel.show(createState());
    for (const type of ["resolveChatImage", "previewChatImage", "downloadChatImage"] as const) {
      await harness.messageHandler({ type, source: "/tmp/图示.svg", alt: "SVG 图示" });
    }
    await harness.messageHandler({ type: "loopGroupChatChat:refresh" });
    assert.equal(handled.length, 3);
    assert.deepEqual(forwarded, [{ type: "loopGroupChatChat:refresh" }]);
  } finally {
    ChatImageHost.prototype.handleMessage = original;
  }
});

function createState(overrides: any = {}) {
  return {
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
        key: "execution-2",
        kind: "execution",
        label: "主从群聊",
        loopRound: 2,
        status: "running",
        activeSpeaker: { kind: "main", id: "main", title: "主任务" },
        startedAt: Date.UTC(2026, 6, 15, 9, 0, 0),
        participants: [
          { id: "main", title: "主任务", role: "main", status: "running", sessionId: "main-session", updatedAt: 1 },
          { id: "subtask-1", title: "子任务 1", role: "subtask", status: "running", sessionId: null, updatedAt: 2 },
        ],
      },
    ],
    chatMarkdown: [
      "# Loop 主从群聊记录",
      "",
      "## 主任务决策",
      "已创建子任务。",
      "",
      "## 子任务加入：【子任务 1】",
      "子任务已加入。",
      "",
      "## 子任务发言：【子任务 1】",
      "子任务已完成。",
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

test("shows Loop-style execution animation for Loop+ runtime work without reusing a classic active speaker", () => {
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
  {
    const page = buildLoopGroupChatPanelHtml(
      { cspSource: "self" } as any,
      createState({
        loopPlus,
        task: { ...createState().task, status: "running", currentRound: 9, canStop: true, canContinue: false },
        rounds: [{
          key: "execution-1",
          kind: "execution",
          loopRound: 9,
            status: "running",
          startedAt: Date.now(),
          activeSpeaker: { kind: "main", id: "main", title: "Main task" },
          participants: [
            { id: "main", title: "Main task", role: "main", status: "reviewing" },
            { id: "D", title: "Delta", role: "subtask", status: "running" },
          ],
        }],
        chatMarkdown: "# Loop chat\n",
      }),
    );
    assert.match(page, /<h1 id="panelHeading">Loop\+ 群聊<\/h1>/u);
    assert.doesNotMatch(page, /data-loop-plus-list=|data-loop-plus-role=/u);
    assert.doesNotMatch(page, /<h2>(?:当前验收|待验收队列|仍在运行|待启动|验收结果)<\/h2>/u);
    assert.doesNotMatch(page, /<i>report<\/i>|&lt;i&gt;report&lt;\/i&gt;/u);
    assert.match(page, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
    assert.match(page, /data-thinking-kind="main" data-thinking-id="main"/u);
    assert.match(page, /typing-dots/u);
    assert.match(page, /Delta 思考中[\s\S]*Main task 思考中/u);
    assert.doesNotMatch(page, /<div class="meta-label">当前轮次<\/div>/u);
    assert.match(page, /<button[^>]*data-action="stopTask"/u);
    assert.doesNotMatch(page, /<button[^>]*data-action="continueTask"/u);
    assert.match(page, /data-action="acceptancePlan"[^>]*>验收方案<\/button>/u);
    const completedPage = buildLoopGroupChatPanelHtml(
      { cspSource: "self" } as any,
      createState({
        loopPlus,
        task: { ...createState().task, status: "completed", currentRound: 9, canStop: false, canContinue: false },
      }),
    );
    assert.doesNotMatch(completedPage, /data-action="acceptancePlan"/u);
    assert.match(page, /id="acceptancePlanOverlay"/u);
    assert.match(page, /id="confirmAcceptancePlan"[^>]*>确认<\/button>/u);
    assert.match(page, /id="acceptancePlanBaselineCheck"[^>]*disabled/u);
    assert.match(page, /loopGroupChatChat:updateAcceptancePlan/u);
  }
});

test("keeps a paused Loop+ review from looking active while a running subtask still animates", () => {
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
  {
    const page = buildLoopGroupChatPanelHtml(
      { cspSource: "self" } as any,
      createState({
        loopPlus,
        task: { ...createState().task, status: "needs-review", canContinue: true, canStop: false },
        rounds: [{
          key: "execution-1",
          kind: "execution",
          loopRound: 4,
            status: "reviewing",
          startedAt: Date.now(),
          activeSpeaker: { kind: "main", id: "main", title: "Main task" },
          participants: [
            { id: "main", title: "Main task", role: "main", status: "paused" },
            { id: "A", title: "Alpha", role: "subtask", status: "held_review" },
          ],
        }],
        chatMarkdown: "# Loop chat\n",
      }),
    );
    assert.match(page, /data-loop-plus-status="paused"/u);
    assert.match(page, /data-loop-plus-phase="reviewing"/u);
    assert.doesNotMatch(page, /data-loop-plus-list=|data-loop-plus-role=/u);
    assert.doesNotMatch(page, /<h2>(?:当前验收|待验收队列|仍在运行|待启动|验收结果)<\/h2>/u);
    assert.match(page, /data-thinking-kind="subtask" data-thinking-id="D" data-thinking-attempt="d-1"/u);
    assert.match(page, /Delta 思考中/u);
    assert.doesNotMatch(page, /data-thinking-kind="main"|Main task 思考中|正在验收/u);
    assert.match(page, /<button[^>]*data-action="continueTask"/u);
    assert.doesNotMatch(page, /<button[^>]*data-action="stopTask"/u);
    assert.match(page, /自动验收已暂停，需要继续后才会恢复/u);
    assert.match(page, /验收已暂停/u);
  }
});

test("renders communication file paths as preview links and posts markdown preview results", () => {
  const filePath = "/Users/demo/.sinitek_cli/loop-communications/task-1/subtasks/round-1-demo.md";
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    createState({
      chatMarkdown: [
        "# Loop 主从群聊记录",
        "",
        "## 子任务加入：【子任务 4】",
        [
          "- 成员 ID：chain-scenario-architecture",
          `- 沟通文件：${filePath}`,
          "- 说明：<b>keep</b>",
        ].join("\n"),
      ].join("\n"),
    }),
  );
  assert.match(html, new RegExp(`data-action="openCommunicationFile"[^>]*data-file-path="${escapeRegExp(filePath)}"`));
  assert.match(html, /id="filePreviewBackdrop"/u);
  assert.match(html, /查看沟通文件/u);
  assert.match(html, /loopGroupChatChat:openCommunicationFile/u);
  assert.match(html, /&lt;b&gt;keep&lt;\/b&gt;/u);

  const harness = createPanelHarness();
  const panel = new LoopGroupChatPanel({ fsPath: "/extension" } as any, { onMessage: () => undefined });
  panel.postCommunicationFilePreview({
    type: "loopGroupChatChat:communicationFile",
    requestId: "early",
    path: filePath,
    ok: false,
    error: "missing",
  });
  panel.show(createState());
  panel.postCommunicationFilePreview({
    type: "loopGroupChatChat:communicationFile",
    requestId: "req-1",
    path: filePath,
    ok: true,
    html: "<h1>标题</h1>",
  });
  assert.deepEqual(harness.messages, [{
    type: "loopGroupChatChat:communicationFile",
    requestId: "req-1",
    path: filePath,
    ok: true,
    html: "<h1>标题</h1>",
  }]);
});

test("renders the main-task clarification form in the group chat and pauses auto refresh", () => {
  const clarification = {
    interactionId: "clarify-loop",
    title: "需要确认需求",
    instruction: "请选择本次范围",
    submitLabel: "提交",
    cancelLabel: "拒绝",
    formFields: [{
      id: "scope",
      label: "范围",
      type: "radio",
      required: true,
      options: [
        { label: "只改接口", value: "api" },
        { label: "接口和调用方", value: "all" },
      ],
    }],
  };
  const html = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    createState({ clarification }),
  );
  assert.match(html, /id="clarificationDialogBackdrop"/);
  assert.match(html, /需要确认需求/);
  assert.match(html, /data-submit-type="loopGroupChatChat:submitClarification"/);
  assert.match(html, /data-reject-type="loopGroupChatChat:rejectClarification"/);
  assert.match(html, /请先填写\{label\}/);
  assert.match(html, /clarificationDialogBackdrop/);
  assert.match(html, /var\(--vscode-input-background\)/);
  const styles = Array.from(html.matchAll(/<style>([\s\S]*?)<\/style>/g), (match) => match[1]).join("\n");
  assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}/);

  const hidden = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    createState(),
  );
  assert.doesNotMatch(hidden, /id="clarificationDialogBackdrop"/);
});

test("renders a persistent ask chat with a waiting indicator and can publish updates", () => {
  const idle = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    createState(),
  );
  assert.match(idle, /id="askChatBackdrop" class="dialog-backdrop ask-chat-backdrop"/u);
  assert.match(idle, /class="dialog-header ask-chat-header"[\s\S]*id="askChatClose" class="icon-button ask-chat-close"/u);
  assert.match(idle, /id="askChatClose"[^>]*>\s*<svg class="icon"/u);
  assert.match(idle, /class="ask-chat-actions"/u);
  assert.match(idle, /id="askChatAbort" class="icon-button stop-button"[^>]*hidden/u);
  assert.match(idle, /id="askChatSend" class="icon-button send-icon-button"/u);
  assert.match(idle, /id="askChatSend"[^>]*>\s*<svg class="icon"[^>]*>[\s\S]*M22 2L11 13/u);
  assert.doesNotMatch(idle, /id="askChatClose" class="button"/u);
  assert.doesNotMatch(idle, /id="askChatSend" class="button/u);
  assert.doesNotMatch(idle, /id="askChatAbort" class="button/u);
  assert.match(idle, /id="askChatAbort"[^>]*hidden/u);
  assert.doesNotMatch(idle, /id="askChatSend"[^>]*disabled/u);
  assert.match(idle, /还没有提问/u);

  const running = buildLoopGroupChatPanelHtml(
    { cspSource: "self" } as any,
    createState({ task: { ...createState().task, canSupplement: true } }),
    {
      version: 1,
      dialogOpen: true,
      running: true,
      updatedAt: 5,
      messages: [
        { id: "q", role: "user", content: "可以合并吗", createdAt: 1 },
        { id: "t", role: "thinking", content: "先看冲突", createdAt: 2, streaming: true },
        { id: "a", role: "assistant", content: "可以合并。", createdAt: 3 },
      ],
    },
  );
  assert.match(running, /ask-chat-backdrop visible/u);
  assert.match(running, /id="askChatInput"[^>]*disabled/u);
  assert.match(running, /id="askChatSend"[^>]*disabled/u);
  assert.doesNotMatch(running, /id="askChatAbort"[^>]*hidden/u);
  assert.match(running, /可以合并吗/u);
  assert.match(running, /可以合并。/u);
  assert.match(running, /message && message\.role !== "thinking"/u);
  assert.match(running, /ask-chat-waiting/u);
  assert.match(running, /正在回答/u);
  assert.doesNotMatch(running, /ask-chat-thinking/u);

  const harness = createPanelHarness();
  const panel = new LoopGroupChatPanel({ fsPath: "/extension" } as any, { onMessage: () => undefined });
  const thread = {
    version: 1 as const,
    dialogOpen: false,
    running: false,
    updatedAt: 8,
    messages: [{ id: "old", role: "user" as const, content: "历史问题", createdAt: 1 }],
  };
  panel.setAskThread(thread);
  panel.publishAskThread();
  assert.deepEqual(harness.messages, []);
  panel.show(createState());
  assert.match(harness.panel.webview.html, /历史问题/u);
  panel.publishAskThread();
  assert.deepEqual(harness.messages.at(-1), {
    type: "loopGroupChatChat:askThread",
    thread,
  });
  assert.equal(panel.getAskThread(), thread);
});
