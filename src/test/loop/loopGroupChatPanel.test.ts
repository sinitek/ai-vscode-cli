import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildLoopGroupChatPanelHtml: buildLoopGroupChatPanelHtmlImpl,
  buildLoopGroupChatPanelContentPatch,
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
  assert.match(html, /data-action="switchModels"[^>]*>切模型<\/button>/u);
  assert.doesNotMatch(html, /name="continueModelSource"/u);
  assert.match(html, /loopGroupChatChat:continueTask", prompt \}/u);
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
  assert.doesNotMatch(supplementDialog, /continueModelSource/);
  assert.doesNotMatch(supplementDialog, /setContinueModelChoiceVisible\(true\)/);
  assert.doesNotMatch(continueDialog, /continueModelSource/);
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
  assert.match(html, /loopGroupChatChat:continueTask", prompt \}/);
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

for (const roles of [["main", "subtask"], ["main", "fullstack"], ["main", "subtask", "frontend"]] as const) {
  test(`renders independent model switching fields for ${roles.join("/")}`, () => {
    const state = createState({
      modelSwitch: { fields: roles.map((role) => ({
        role, label: role === "main" ? "主模型" : "子模型", cli: "codex", configId: "current-config",
        model: `${role}-old`, options: [{ value: `${role}-new`, label: `${role} 新模型` }],
      })) },
    });
    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
    assert.match(html, /data-action="switchModels"[^>]*>切模型<\/button>/u);
    assert.doesNotMatch(html, /name="continueModelSource"|恢复原分组和配置|使用新配置的主子模型/u);
    for (const role of roles) {
      assert.ok(html.includes(`data-model-role="${role}"`));
      assert.ok(html.includes(`value="${role}-new"`));
    }
    const patch = buildLoopGroupChatPanelContentPatch(state, 2);
    assert.ok(patch.modelSwitchHtml.includes('data-config-id="current-config"'));
    assert.match(html, /下一次主、子模型执行使用新模型/u);
  });
}

function createSidebarHarness(narrow = true) {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  const source = html.slice(html.indexOf("function setSidebarOpen"), html.indexOf('sidebarToggle.addEventListener("click"'));
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const focusTargets: string[] = [];
  const sidebarElement = {
    inert: false,
    setAttribute: (name: string, value: string) => attributes.set(`sidebar:${name}`, value),
    focus: () => focusTargets.push("sidebar"),
    contains: (element: unknown): boolean => element === sidebarElement,
  };
  const sidebarToggle = {
    title: "",
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    focus: () => focusTargets.push("toggle"),
  };
  const context = {
    sidebarElement,
    sidebarToggle,
    sidebarBackdrop: { hidden: true },
    narrowSidebarQuery: { matches: narrow },
    sidebarOpen: false,
    layoutElement: { classList: { toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name) } },
    document: { activeElement: null as unknown, querySelector: () => null as unknown },
  };
  const actions = vm.runInNewContext(`${source}\n({ setSidebarOpen, syncSidebarMode, handleSidebarKeydown })`, context) as {
    setSidebarOpen: (open: boolean, restoreFocus?: boolean) => void;
    syncSidebarMode: () => void;
    handleSidebarKeydown: (event: { key: string; defaultPrevented?: boolean; preventDefault: () => void }) => void;
  };
  actions.syncSidebarMode();
  return { ...actions, context, attributes, classes, focusTargets, html };
}

test("narrow group chat starts with an inaccessible collapsed sidebar and opens it above chat", () => {
  const harness = createSidebarHarness();
  assert.equal(harness.context.sidebarElement.inert, true);
  assert.equal(harness.attributes.get("sidebar:aria-hidden"), "true");
  assert.equal(harness.attributes.get("aria-expanded"), "false");
  assert.match(harness.html, /id="sidebarToggle"[^>]*aria-controls="panelSidebar"/u);
  assert.match(harness.html, /\.sidebar\s*\{\s*position: absolute;/u);
  assert.doesNotMatch(harness.html, /max-height: 45vh/u);

  harness.setSidebarOpen(true);
  assert.ok(harness.classes.has("sidebar-open"));
  assert.equal(harness.context.sidebarElement.inert, false);
  assert.equal(harness.context.sidebarBackdrop.hidden, false);
  assert.equal(harness.attributes.get("aria-expanded"), "true");
  assert.equal(harness.attributes.get("aria-label"), "收起任务信息");
  assert.deepEqual(harness.focusTargets, ["sidebar"]);

  harness.setSidebarOpen(false, true);
  assert.equal(harness.context.sidebarElement.inert, true);
  assert.equal(harness.context.sidebarBackdrop.hidden, true);
  assert.equal(harness.attributes.get("aria-label"), "展开任务信息");
  assert.deepEqual(harness.focusTargets, ["sidebar", "toggle"]);
});

test("sidebar toggle border and icon share the theme primary color and 2px strokes", () => {
  const { html } = createSidebarHarness();
  const toggleStyles = /\.sidebar-toggle\s*\{([^}]+)\}/u.exec(html)?.[1];
  assert.ok(toggleStyles);
  assert.match(toggleStyles, /border: 2px solid currentColor;/u);
  assert.match(toggleStyles, /color: var\(--vscode-button-background, var\(--vscode-focusBorder\)\);/u);
  assert.match(html, /id="sidebarToggle"[^>]*>\s*<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*stroke-width="2"/u);
});

test("sidebar toggle is 30 percent narrower with a theme-aware shadow", () => {
  const { html } = createSidebarHarness();
  const toggleStyles = /\.sidebar-toggle\s*\{([^}]+)\}/u.exec(html)?.[1];
  assert.ok(toggleStyles);
  assert.match(toggleStyles, /width: 19\.6px;/u);
  assert.match(toggleStyles, /box-shadow: 2px 2px 6px var\(--vscode-widget-shadow,/u);
});

test("sidebar Escape closes only the drawer and defers to existing dialogs", () => {
  const harness = createSidebarHarness();
  let prevented = 0;
  const event = { key: "Escape", preventDefault: () => { prevented += 1; } };
  harness.setSidebarOpen(true);
  harness.handleSidebarKeydown({ ...event, key: "Enter" });
  assert.equal(harness.context.sidebarOpen, true);
  harness.context.document.querySelector = () => ({});
  harness.handleSidebarKeydown(event);
  assert.equal(harness.context.sidebarOpen, true);
  harness.context.document.querySelector = () => null;
  harness.handleSidebarKeydown({ ...event, defaultPrevented: true });
  assert.equal(harness.context.sidebarOpen, true);
  harness.handleSidebarKeydown(event);
  assert.equal(harness.context.sidebarOpen, false);
  assert.equal(prevented, 1);
  assert.equal(harness.focusTargets.at(-1), "toggle");
});

test("resizing restores the desktop sidebar and collapses it on reentering narrow mode", () => {
  const harness = createSidebarHarness(false);
  assert.equal(harness.context.sidebarElement.inert, false);
  harness.setSidebarOpen(true);
  assert.equal(harness.context.sidebarOpen, false);
  assert.equal(harness.context.sidebarBackdrop.hidden, true);

  harness.context.document.activeElement = harness.context.sidebarElement;
  harness.context.narrowSidebarQuery.matches = true;
  harness.syncSidebarMode();
  assert.equal(harness.context.sidebarElement.inert, true);
  assert.equal(harness.focusTargets.at(-1), "toggle");
  harness.setSidebarOpen(true);
  harness.context.narrowSidebarQuery.matches = false;
  harness.syncSidebarMode();
  assert.equal(harness.context.sidebarOpen, false);
  assert.equal(harness.context.sidebarElement.inert, false);
  assert.equal(harness.context.sidebarBackdrop.hidden, true);
  harness.context.narrowSidebarQuery.matches = true;
  harness.syncSidebarMode();
  assert.equal(harness.context.sidebarOpen, false);
  assert.equal(harness.context.sidebarElement.inert, true);
});

function createSupplementDialogHarness() {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  const source = html.slice(html.indexOf("function closeContinueDialog"), html.indexOf("const ASK_WAITING_LABEL"));
  const button = { disabled: false };
  const input = { value: "", focus: () => undefined, select: () => undefined };
  const messages: { type: string; prompt: string }[] = [];
  const errors: string[] = [];
  const context = {
    continueDialogBackdrop: { classList: { add: () => undefined, remove: () => undefined }, setAttribute: () => undefined },
    continueDialogInput: input,
    continueDialogConfirm: { dataset: {} },
    continueDialogOpen: false,
    continueRequestPending: false,
    continueDialogMode: undefined as string | undefined,
    setContinueDialogError: (error: string) => errors.push(error),
    setContinueModelChoiceVisible: () => undefined,
    saveDialogState: () => undefined,
    clearDialogState: () => undefined,
    readContinueModelSource: () => "original",
    actionButton: () => button,
    document: { getElementById: () => null, querySelector: () => null },
    window: { setTimeout: () => undefined },
    vscode: { postMessage: (message: { type: string; prompt: string }) => messages.push(message) },
  };
  const actions = vm.runInNewContext(`${source}\n({ openSupplementDialog, submitSupplementDialog, closeContinueDialog, submitContinueDialog, applyContinueTaskSettled });`, context) as {
    openSupplementDialog: (prompt?: string) => void;
    submitSupplementDialog: () => void;
    closeContinueDialog: () => void;
    submitContinueDialog: () => void;
    applyContinueTaskSettled: (message: { canContinue: boolean }) => void;
  };
  return { ...actions, button, input, messages, errors, context };
}

test("continuation settlement restores a locally disabled button even when the action HTML is unchanged", () => {
  const harness = createSupplementDialogHarness();
  harness.context.continueDialogOpen = true;
  harness.context.continueDialogMode = "continue";
  harness.input.value = "继续原任务";
  harness.submitContinueDialog();
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.context.continueRequestPending, true);
  harness.submitContinueDialog();
  assert.equal(harness.messages.length, 1);
  harness.applyContinueTaskSettled({ canContinue: true });
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.context.continueRequestPending, false);
  harness.context.continueDialogOpen = true;
  harness.context.continueDialogMode = "continue";
  harness.submitContinueDialog();
  assert.equal(harness.messages.length, 2);
  harness.applyContinueTaskSettled({ canContinue: false });
  assert.equal(harness.button.disabled, true);
});

test("ignores continuation confirmation while its dialog is closed or showing supplemental requirements", () => {
  const harness = createSupplementDialogHarness();
  harness.input.value = "继续原任务";
  harness.submitContinueDialog();
  harness.openSupplementDialog("补充要求");
  harness.submitContinueDialog();
  assert.equal(harness.messages.length, 0);
  assert.equal(harness.button.disabled, false);
});

test("keeps the supplement entry enabled for consecutive submissions without waiting for a patch", () => {
  const harness = createSupplementDialogHarness();
  for (const prompt of ["  补充第一个要求  ", "补充第二个要求", "补充第三个要求"]) {
    harness.openSupplementDialog(prompt);
    harness.submitSupplementDialog();
    assert.equal(harness.button.disabled, false);
    assert.equal(harness.context.continueDialogOpen, false);
  }
  assert.deepEqual(harness.messages.map((message) => message.prompt), ["补充第一个要求", "补充第二个要求", "补充第三个要求"]);
  assert.ok(harness.messages.every((message) => message.type === "loopGroupChatChat:supplementTask"));
});

test("ignores duplicate supplement confirmation after the dialog closes", () => {
  const harness = createSupplementDialogHarness();
  harness.openSupplementDialog("只发送一次");
  harness.submitSupplementDialog();
  harness.submitSupplementDialog();
  assert.equal(harness.messages.length, 1);
  harness.openSupplementDialog("取消的需求");
  harness.closeContinueDialog();
  harness.submitSupplementDialog();
  assert.equal(harness.messages.length, 1);
});

test("keeps empty supplement input editable and does not submit a continue dialog as a supplement", () => {
  const harness = createSupplementDialogHarness();
  harness.openSupplementDialog("   ");
  harness.submitSupplementDialog();
  assert.equal(harness.messages.length, 0);
  assert.equal(harness.context.continueDialogOpen, true);
  assert.equal(harness.errors.at(-1), "请输入需求内容。");
  vm.runInNewContext('continueDialogMode = "continue";', harness.context);
  harness.input.value = "继续执行";
  harness.submitSupplementDialog();
  assert.equal(harness.messages.length, 0);
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
    continueRequestPending: false,
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

type ScrollElementHarness = {
  tagName: string;
  scrollTop: number;
  scrollLeft: number;
  parentElement?: ScrollElementHarness;
  children: ScrollElementHarness[];
};

function createScrollElement(tagName: string, children: ScrollElementHarness[] = []): ScrollElementHarness {
  const element: ScrollElementHarness = { tagName, scrollTop: 0, scrollLeft: 0, children };
  children.forEach((child) => { child.parentElement = element; });
  return element;
}

function createScrollPatchHarness(normalizeHtml: (value: string) => string = (value) => value) {
  const page = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  const source = page.slice(page.indexOf("function captureNestedScrollState"), page.indexOf("function applyClarificationPatch"));
  const slot = createScrollElement("DIV", [createScrollElement("ARTICLE", [
    createScrollElement("PRE"),
    createScrollElement("DIV", [createScrollElement("TABLE")]),
  ])]);
  let replacements = 0;
  let mounts = 0;
  let html = "initial";
  let nextChildren = slot.children;
  Object.defineProperty(slot, "innerHTML", {
    get: () => html,
    set: (value: string) => {
      html = value;
      slot.children = nextChildren;
      slot.children.forEach((child) => { child.parentElement = slot; });
      replacements += 1;
    },
  });
  const descendants = (element: ScrollElementHarness): ScrollElementHarness[] =>
    element.children.flatMap((child) => [child, ...descendants(child)]);
  Object.assign(slot, { querySelectorAll: () => descendants(slot) });
  const context = vm.createContext({
    renderedSlotHtml: new WeakMap([[slot, { initial: html }]]),
    document: { createElement: () => {
      let value = "";
      return {
        get innerHTML() { return value; },
        set innerHTML(html: string) { value = normalizeHtml(html); },
      };
    } },
    mountGroupChatMarkdown: () => { mounts += 1; },
  });
  vm.runInContext(source, context);
  return {
    slot,
    replace: (value: unknown, children: ScrollElementHarness[], target: unknown = slot) => {
      nextChildren = children;
      context.slot = target;
      context.html = value;
      vm.runInContext("replaceHtml(slot, html);", context);
    },
    get replacements() { return replacements; },
    get mounts() { return mounts; },
  };
}

test("keeps unchanged group chat bubbles mounted, including their nested scroll state", () => {
  const harness = createScrollPatchHarness();
  const original = harness.slot.children[0];
  original.children[0].scrollLeft = 240;
  original.children[0].scrollTop = 180;

  harness.replace("initial", []);

  assert.equal(harness.replacements, 0);
  assert.equal(harness.mounts, 0);
  assert.equal(harness.slot.children[0], original);
  assert.equal(original.children[0].scrollLeft, 240);
  assert.equal(original.children[0].scrollTop, 180);
});

test("normalizes the first content patch before comparing it with browser-serialized HTML", () => {
  let normalizations = 0;
  const harness = createScrollPatchHarness((value) => {
    normalizations += 1;
    return value === "initial-serialized-differently" ? "initial" : value;
  });

  harness.replace("initial-serialized-differently", []);
  harness.replace("initial-serialized-differently", []);

  assert.equal(harness.replacements, 0);
  assert.equal(harness.mounts, 0);
  assert.equal(normalizations, 1);
});

test("restores independent horizontal and vertical bubble scroll positions when new messages arrive", () => {
  const harness = createScrollPatchHarness();
  const original = harness.slot.children[0];
  original.children[0].scrollLeft = 240;
  original.children[0].scrollTop = 180;
  original.children[1].scrollLeft = 90;
  original.children[1].children[0].scrollTop = 35;
  const next = createScrollElement("ARTICLE", [
    createScrollElement("PRE"),
    createScrollElement("DIV", [createScrollElement("TABLE")]),
  ]);

  harness.replace("updated", [next, createScrollElement("ARTICLE")]);

  assert.equal(harness.replacements, 1);
  assert.equal(harness.mounts, 1);
  assert.equal(next.children[0].scrollLeft, 240);
  assert.equal(next.children[0].scrollTop, 180);
  assert.equal(next.children[1].scrollLeft, 90);
  assert.equal(next.children[1].children[0].scrollTop, 35);
  next.children[0].scrollLeft = 320;
  harness.replace("updated", []);
  assert.equal(harness.replacements, 1);
  assert.equal(next.children[0].scrollLeft, 320);
});

test("ignores removed or changed scroll containers instead of restoring into unrelated elements", () => {
  const harness = createScrollPatchHarness();
  harness.slot.children[0].children[0].scrollLeft = 240;
  harness.slot.children[0].children[1].children[0].scrollTop = 35;
  const next = createScrollElement("ARTICLE", [createScrollElement("P")]);

  assert.doesNotThrow(() => harness.replace("shortened", [next]));
  assert.equal(next.children[0].scrollLeft, 0);
  assert.doesNotThrow(() => harness.replace("", []));
  assert.equal(harness.slot.children.length, 0);
});

test("rejects missing slots and non-string group chat patches without touching the DOM", () => {
  const harness = createScrollPatchHarness();
  harness.replace(undefined, []);
  harness.replace(null, []);
  harness.replace("updated", [], null);
  assert.equal(harness.replacements, 0);
  assert.equal(harness.mounts, 0);
});

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

for (const { status, label, statusClass } of [
  { status: "running", label: "运行中", statusClass: "member-status-running" },
  { status: "pending", label: "待启动", statusClass: "member-status-pending" },
  { status: "completed", label: "已完成", statusClass: "member-status-passed" },
  { status: "skipped", label: "已跳过", statusClass: "member-status-inactive" },
  { status: "blocked", label: "已阻塞", statusClass: "member-status-pending" },
  { status: "needs-review", label: "待复核", statusClass: "member-status-pending" },
  { status: "error", label: "执行失败", statusClass: "member-status-failed" },
  { status: "failed", label: "执行失败", statusClass: "member-status-failed" },
  { status: "stopped", label: "已停止", statusClass: "member-status-inactive" },
]) {
  test(`localizes and colors classic Loop member status ${status} in initial HTML and patches`, () => {
    const state = createState();
    for (const participant of state.rounds[0].participants) {
      participant.status = status;
    }
    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
    const patch = buildLoopGroupChatPanelContentPatch(state, 1);

    for (const content of [html, patch.rosterPanelHtml]) {
      const statusPattern = new RegExp(`<span class="${statusClass}">${label}</span>`, "gu");
      assert.equal((content.match(statusPattern) ?? []).length, 2);
      assert.doesNotMatch(content, new RegExp(`<div class="member-meta">${status}</div>`, "u"));
    }
  });
}

test("uses theme colors for member statuses and preserves the Loop+ completion label", () => {
  const state = createState({
    loopPlus: { ok: false, schedulingMode: "event_driven", activity: "invalid", phase: "invalid", error: "missing" },
  });
  state.rounds[0].participants[0].status = "completed";
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);

  assert.match(html, /<span class="member-status-passed">已收口<\/span>/u);
  assert.match(html, /\.member-status-running,[^}]*--vscode-charts-blue/u);
  assert.match(html, /\.member-status-passed\s*\{[^}]*--vscode-charts-green/u);
  assert.match(html, /\.member-status-pending,[^}]*--vscode-charts-orange/u);
  assert.match(html, /\.member-status-inactive\s*\{[^}]*--vscode-descriptionForeground/u);
});

test("escapes unknown member statuses and omits an empty roster", () => {
  const state = createState();
  state.rounds[0].participants[0].status = "<custom-status>";
  const patch = buildLoopGroupChatPanelContentPatch(state, 1);

  assert.match(patch.rosterPanelHtml, /&lt;custom-status&gt;/u);
  assert.doesNotMatch(patch.rosterPanelHtml, /<custom-status>/u);
  assert.equal(buildLoopGroupChatPanelContentPatch(createState({ rounds: [] }), 1).rosterPanelHtml, "");
});

function createLongChatState(count: number, overrides: any = {}) {
  const state = createState(overrides);
  return {
    ...state,
    task: { ...state.task, status: "completed" },
    chatMarkdown: Array.from({ length: count }, (_, index) => `## 主任务发言：第 ${index + 1} 轮\n群聊消息编号${String(index + 1).padStart(4, "0")}\n`).join("\n"),
  };
}

test("group chat initial HTML and content patches render only the newest bounded batch", () => {
  const state = createLongChatState(199);
  const patch = buildLoopGroupChatPanelContentPatch(state, 1);
  assert.equal((patch.timelineHtml.match(/<article class="message /g) ?? []).length, 150);
  assert.doesNotMatch(patch.timelineHtml, /群聊消息编号0049|任务发起/u);
  assert.match(patch.timelineHtml, /群聊消息编号0050/u);
  assert.match(patch.timelineHtml, /群聊消息编号0199/u);
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
  assert.equal((html.match(/<article class="message /g) ?? []).length, 150);
  assert.equal((buildLoopGroupChatPanelContentPatch(createLongChatState(198), 1).timelineHtml.match(/<article class="message /g) ?? []).length, 199);
  assert.equal((buildLoopGroupChatPanelContentPatch(createLongChatState(1000), 1).timelineHtml.match(/<article class="message /g) ?? []).length, 151);
  assert.equal(state.chatMarkdown.match(/## 主任务发言/g)?.length, 199);
});

test("group chat counts live thinking bubbles and does not restore the pruned prefix when they finish", () => {
  const state = createLongChatState(198);
  state.task.status = "running";
  const window = { start: 0 };
  const running = buildLoopGroupChatPanelContentPatch(state, 1, window);
  assert.equal((running.timelineHtml.match(/<article class="message /g) ?? []).length, 150);
  assert.match(running.timelineHtml, /data-thinking-kind="main"/u);
  state.task.status = "completed";
  const completed = buildLoopGroupChatPanelContentPatch(state, 2, window);
  assert.equal((completed.timelineHtml.match(/<article class="message /g) ?? []).length, 149);
  assert.doesNotMatch(completed.timelineHtml, /群聊消息编号0049/u);
  state.messageLimit = 400;
  assert.match(buildLoopGroupChatPanelContentPatch(state, 3, window).timelineHtml, /群聊消息编号0001/u);
});

test("group chat applies custom and minimum limits to Loop+ as well as classic Loop", () => {
  const loopPlus = { ok: false, schedulingMode: "event_driven", error: "invalid" };
  for (const projection of [undefined, loopPlus]) {
    const state = createLongChatState(9, { messageLimit: 10, loopPlus: projection });
    const patch = buildLoopGroupChatPanelContentPatch(state, 1);
    assert.equal((patch.timelineHtml.match(/<article class="message /g) ?? []).length, 7);
    state.messageLimit = 1;
    const minimum = buildLoopGroupChatPanelContentPatch(state, 2);
    assert.equal((minimum.timelineHtml.match(/<article class="message /g) ?? []).length, 1);
    assert.match(minimum.timelineHtml, /群聊消息编号0009/u);
  }
});

test("panel instances retain the cursor across patches and reset it for a different task or setting", () => {
  const harness = createPanelHarness();
  const panel = new LoopGroupChatPanel({ fsPath: "/extension" } as any, { onMessage: () => undefined });
  panel.show(createLongChatState(199));
  assert.equal((harness.panel.webview.html.match(/<article class="message /g) ?? []).length, 150);
  harness.messageHandler({ type: "loopGroupChatChat:domReady", generation: 1 });
  const next = createLongChatState(198);
  panel.update(next);
  assert.equal((harness.messages.at(-1).timelineHtml.match(/<article class="message /g) ?? []).length, 149);
  panel.update({ ...next, messageLimit: 400 });
  assert.equal((harness.messages.at(-1).timelineHtml.match(/<article class="message /g) ?? []).length, 199);
  panel.update(createLongChatState(249));
  assert.doesNotMatch(harness.messages.at(-1).timelineHtml, /群聊消息编号0099/u);
  panel.update({ ...next, task: { ...next.task, id: "other-task" } });
  assert.match(harness.messages.at(-1).timelineHtml, /群聊消息编号0001/u);
  harness.disposeHandler();
  panel.show(next);
  assert.match(harness.panel.webview.html, /群聊消息编号0001/u);
});

test("Loop and Loop+ preserve supplemental requirements in initial HTML and incremental cleanup", () => {
  const loopPlus = { ok: false, schedulingMode: "event_driven", error: "invalid" };
  for (const projection of [undefined, loopPlus]) {
    const state = createLongChatState(9, { messageLimit: 10, loopPlus: projection });
    const appendRequirements = (chatMarkdown: string) => `## 补充需求\n请保留早期补充需求。\n\n${chatMarkdown}\n\n## 补充需求\n请保留最新补充需求。\n`;
    state.chatMarkdown = appendRequirements(state.chatMarkdown);
    const window = { start: 0 };
    const patch = buildLoopGroupChatPanelContentPatch(state, 1, window);
    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);

    for (const content of [html, patch.timelineHtml]) {
      assert.match(content, /请保留早期补充需求。/u);
      assert.match(content, /请保留最新补充需求。/u);
      assert.doesNotMatch(content, /任务发起|群聊消息编号0002/u);
      assert.ok(content.indexOf('data-markdown-source="请保留早期补充需求。"') < content.indexOf('data-markdown-source="群聊消息编号0003"'));
      assert.equal((content.match(/<article class="message /g) ?? []).length, 9);
    }

    const refreshed = buildLoopGroupChatPanelContentPatch(state, 2, window);
    assert.equal(refreshed.timelineHtml, patch.timelineHtml);
    state.chatMarkdown = appendRequirements(createLongChatState(12).chatMarkdown);
    const next = buildLoopGroupChatPanelContentPatch(state, 3, window);
    assert.match(next.timelineHtml, /请保留早期补充需求。/u);
    assert.match(next.timelineHtml, /请保留最新补充需求。/u);
    assert.match(next.timelineHtml, /群聊消息编号0012/u);
    assert.doesNotMatch(next.timelineHtml, /群聊消息编号0005/u);
    assert.equal((next.timelineHtml.match(/<article class="message /g) ?? []).length, 9);

    state.messageLimit = 1;
    const minimum = buildLoopGroupChatPanelContentPatch(state, 4, window);
    assert.match(minimum.timelineHtml, /请保留早期补充需求。/u);
    assert.match(minimum.timelineHtml, /请保留最新补充需求。/u);
    assert.equal((minimum.timelineHtml.match(/<article class="message /g) ?? []).length, 2);
    assert.doesNotMatch(minimum.timelineHtml, /群聊消息编号/u);
  }
});

test("renders five progress bands beside stop and keeps subtitles limited to the task ID", () => {
  for (const loopPlus of [undefined, { ok: false, schedulingMode: "event_driven", error: "invalid" }]) {
    for (const progressPercent of [0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100]) {
      const state = createState({ loopPlus });
      state.task.progressPercent = progressPercent;
      state.task.canStop = true;
      const band = Math.min(4, Math.floor(progressPercent / 20));
      const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
      const patch = buildLoopGroupChatPanelContentPatch(state, progressPercent);
      assert.equal(patch.subtitleText, state.task.id);
      assert.ok(html.includes(`<p id="panelSubtitle">${state.task.id}</p>`));
      const badge = `data-progress-band="${band}" role="progressbar" aria-label="总体进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">${progressPercent}%</span>`;
      assert.ok(patch.actionsHtml.includes(badge));
      assert.ok(html.includes(patch.actionsHtml));
      assert.match(patch.actionsHtml, /class="progress-controls"><span[^>]+>\d+%<\/span><button[^>]+data-action="stopTask"[^>]*>中止<\/button><\/div>/u);
    }
  }
  const state = createState();
  assert.match(buildLoopGroupChatPanelContentPatch(state, 0).actionsHtml, /aria-valuenow="0">0%/u);
  assert.doesNotMatch(buildLoopGroupChatPanelContentPatch(state, 0).actionsHtml, /data-action="stopTask"/u);
});

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
    const loopPlusPanel = page.match(/<section class="panel" data-loop-plus-mode="event_driven"[\s\S]*?<\/section>/u)?.[0] ?? "";
    assert.match(loopPlusPanel, /data-loop-plus-field="activity"/u);
    assert.doesNotMatch(loopPlusPanel, /data-loop-plus-count="(?:current|reviewed)"|>当前项<|>验收结果<|data-loop-plus-activity=/u);
    assert.equal((loopPlusPanel.match(/正在验收/g) ?? []).length, 1);
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

test("shows the queue notice and keeps sending enabled while the main model is busy", () => {
  const state = createState({ mainModelBusy: true });
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, state);
  assert.match(html, /id="askChatBusy" class="ask-chat-busy" role="status">主模型正在处理，你的问题会放入队列。<\/span>/u);
  assert.match(html, /id="askChatBusy"[^>]*>[^<]*<\/span><button id="askChatAbort"/u);
  assert.doesNotMatch(html, /id="askChatSend"[^>]*disabled/u);
  assert.doesNotMatch(html, /id="askChatInput"[^>]*disabled/u);
  assert.match(html, /\.ask-chat-busy\s*\{[^}]*color: var\(--vscode-errorForeground\)/u);
  assert.equal(buildLoopGroupChatPanelContentPatch(state, 1).mainModelBusy, true);
  assert.equal(buildLoopGroupChatPanelContentPatch(createState(), 2).mainModelBusy, false);
});

test("does not show the busy notice for a submitted question awaiting dispatch", () => {
  for (const mainModelBusy of [false, true]) {
    const html = buildLoopGroupChatPanelHtml(
      { cspSource: "self" } as any,
      createState({ mainModelBusy }),
      { version: 1, messages: [], running: true, queued: true, dialogOpen: true, updatedAt: 0 },
    );
    assert.match(html, /id="askChatBusy"[^>]*hidden/u);
    assert.doesNotMatch(html, /id="askChatSend"[^>]*aria-describedby/u);
    assert.doesNotMatch(html, /id="askChatAbort"[^>]*hidden/u);
  }
});

test("keeps Markdown bubble edges compact without preserving generated HTML newlines", () => {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  assert.match(html, /\.ask-chat-message\.user \.ask-chat-bubble\s*\{[^}]*white-space: normal/u);
  assert.match(html, /\.ask-chat-bubble\.markdown-body > :first-child\s*\{\s*margin-top: 0;/u);
  assert.match(html, /\.ask-chat-bubble\.markdown-body > :last-child\s*\{\s*margin-bottom: 0;/u);
});

test("mounts ask bubbles through the shared group chat Markdown renderer", () => {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  const source = html.slice(html.indexOf("function askEscape"), html.indexOf("function renderAskWaiting"));
  const { CHAT_MARKDOWN_SCRIPT } = require("../../webview/chatMarkdown");
  const { getMarkedScript } = require("../../webview/markdownAssets");
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(`${getMarkedScript()}\n${source}\nconst escapeHtml = askEscape;\n${CHAT_MARKDOWN_SCRIPT}`, context);
  const content = '## 回答\n\n**成功**\n\n- 第一项\n\n| 检查 | 结果 |\n| --- | --- |\n| 构建 | 通过 |\n\n> 说明\n\n```ts\nconst value = "<安全>";\n```';
  for (const role of ["user", "assistant", "system"]) {
    context.message = { role, content };
    const bubble = vm.runInContext("renderAskBubble(message)", context);
    assert.match(bubble, /class="ask-chat-bubble markdown-body" data-markdown-source="/u);
    assert.match(bubble, /&quot;&lt;安全&gt;&quot;/u);
    assert.doesNotMatch(bubble, /<h2>|<安全>/u);
    let removedSource = false;
    const element = {
      innerHTML: "",
      querySelectorAll: () => [],
      getAttribute: () => content,
      removeAttribute: (name: string) => { removedSource = name === "data-markdown-source"; },
    };
    context.root = { querySelectorAll: (selector: string) => selector === "[data-markdown-source]" ? [element] : [] };
    vm.runInContext("mountGroupChatMarkdown(root)", context);
    assert.equal(removedSource, true);
    for (const tag of ["h2", "strong", "ul", "table", "blockquote", "pre"]) {
      assert.ok(element.innerHTML.includes(`<${tag}`), `${role}: ${tag}`);
    }
    assert.match(element.innerHTML, /language-ts/u);
    assert.match(element.innerHTML, /&lt;安全&gt;/u);
  }
  context.message = { role: "thinking", content: "不显示思考" };
  assert.equal(vm.runInContext("renderAskBubble(message)", context), "");
});

test("scrolls new ask bubbles and reopened dialogs to the bottom without disturbing unchanged history", () => {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  assert.match(html, /askChatMessages.addEventListener\("load", scrollAskToBottom, true\)/u);
  const source = html.slice(html.indexOf("function askEscape"), html.indexOf("function getStoredAskDialogState"));
  const frames: Array<() => void> = [];
  const renderedSlotHtml = new WeakMap();
  const log = { scrollHeight: 1200, clientHeight: 240, scrollTop: 0 };
  const context = vm.createContext({
    askChatMessages: log,
    askDialogOpen: true,
    askThread: { messages: [], running: false },
    ASK_WAITING_LABEL: "等待回复",
    ASK_EMPTY_LABEL: "暂无消息",
    renderedSlotHtml,
    window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
    replaceHtml: (slot: object, sourceHtml: string) => renderedSlotHtml.set(slot, { source: sourceHtml }),
    askChatSend: undefined,
    askChatBusy: undefined,
    askChatAbort: undefined,
    askChatInput: undefined,
    mainModelBusy: false,
  });
  vm.runInContext(source, context);
  const render = (thread: unknown) => {
    context.nextThread = thread;
    vm.runInContext("applyAskThread(nextThread)", context);
  };
  render({ messages: [], running: false });
  assert.equal(log.scrollTop, log.scrollHeight);
  frames.splice(0).forEach((callback) => callback());

  const messages: Array<{ role: string; content: string }> = [];
  for (const message of [
    { role: "user", content: "请分析问题" },
    { role: "assistant", content: "## 回答" },
    { role: "system", content: "已中止" },
  ]) {
    log.scrollTop = 0;
    messages.push(message);
    render({ messages: [...messages], running: false });
    assert.equal(log.scrollTop, log.scrollHeight, message.role);
    assert.equal(frames.length, 1);
    log.scrollHeight += 100;
    frames.splice(0).forEach((callback) => callback());
    assert.equal(log.scrollTop, log.scrollHeight, "布局完成后校正到底部");
  }
  log.scrollTop = 10;
  render({ messages: [...messages], running: false });
  assert.equal(log.scrollTop, 10, "无变化刷新保留阅读位置");
  assert.equal(frames.length, 0);

  render({ messages: [...messages], running: true });
  assert.equal(log.scrollTop, log.scrollHeight, "等待气泡出现后滚动");
  frames.splice(0).forEach((callback) => callback());
  log.scrollTop = 0;
  messages[1].content += "\n\n新增回复正文";
  render({ messages: [...messages], running: true });
  assert.equal(log.scrollTop, log.scrollHeight, "回复增长后滚动");

  context.askDialogOpen = false;
  log.scrollTop = 20;
  frames.splice(0).forEach((callback) => callback());
  assert.equal(log.scrollTop, 20, "关闭弹窗后不执行排队滚动");
  render({ messages: [...messages], running: false });
  assert.equal(log.scrollTop, 20);
  assert.equal(frames.length, 0);

  const showDialog = html.slice(html.indexOf("function showAskDialog"), html.indexOf("function hideAskDialog"));
  context.askChatBackdrop = { classList: { add: () => undefined }, setAttribute: () => undefined };
  vm.runInContext(showDialog + "\nshowAskDialog();", context);
  assert.equal(log.scrollTop, log.scrollHeight, "重新打开未变化的历史仍滚到底部");
  frames.splice(0).forEach((callback) => callback());
  log.scrollHeight += 100;
  vm.runInContext("scrollAskToBottom();", context);
  assert.equal(log.scrollTop, log.scrollHeight, "图片加载导致高度变化后校正滚动");
  vm.runInContext("askChatMessages = null; renderAskThread();", context);
  assert.equal(frames.length, 0);
});

test("live busy patches and an active question still allow consecutive queued submissions", () => {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as any, createState());
  const availability = html.slice(html.indexOf("function updateAskAvailability"), html.indexOf("function applyAskThread"));
  const submit = html.slice(html.indexOf("function submitAskChat"), html.indexOf("function restoreAskDialogState"));
  const patch = html.slice(html.indexOf("function applyContentPatch"), html.indexOf("function startAutoRefresh"));
  const sent: unknown[] = [];
  const context = vm.createContext({
    mainModelBusy: false,
    continueRequestPending: false,
    askThread: { running: false },
    askChatInput: { disabled: false, value: "  请检查结果  ", focus: () => undefined },
    askChatSend: {
      disabled: false,
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    },
    askChatAbort: { hidden: true },
    askChatBusy: { hidden: true },
    appliedPatchGeneration: 1,
    mainElement: null,
    document: { getElementById: () => null },
    replaceHtml: () => undefined,
    isNearBottom: () => true,
    applyClarificationPatch: () => undefined,
    replaceContinueModelChoice: () => undefined,
    saveAskDialogState: () => undefined,
    vscode: { postMessage: (message: unknown) => sent.push(message) },
  });
  vm.runInContext(`${availability}\n${submit}\n${patch}`, context);
  vm.runInContext('applyContentPatch({ type: "loopGroupChatChat:contentPatch", generation: 2, mainModelBusy: true }); submitAskChat();', context);
  assert.equal(context.askChatSend.disabled, false);
  assert.equal(context.askChatBusy.hidden, false);
  assert.equal(context.askChatInput.disabled, false);
  assert.equal(context.askChatInput.value, "");
  assert.equal(sent.length, 1);
  vm.runInContext('applyContentPatch({ type: "loopGroupChatChat:contentPatch", generation: 1, mainModelBusy: false });', context);
  assert.equal(context.askChatSend.disabled, false);
  vm.runInContext('applyContentPatch({ type: "loopGroupChatChat:contentPatch", generation: 3, mainModelBusy: false }); submitAskChat();', context);
  assert.equal(context.askChatSend.disabled, false);
  assert.equal(context.askChatBusy.hidden, true);
  assert.equal(context.askChatInput.value, "");
  assert.equal(JSON.stringify(sent), JSON.stringify([{ type: "loopGroupChatChat:askMainModel", prompt: "请检查结果" }]));
  vm.runInContext('mainModelBusy = true; askThread.running = true; askChatInput.value = "下一问"; updateAskAvailability(); submitAskChat();', context);
  assert.equal(context.askChatInput.disabled, false);
  assert.equal(context.askChatSend.disabled, false);
  assert.equal(context.askChatBusy.hidden, true);
  assert.equal(context.askChatAbort.hidden, false);
  assert.equal(sent.length, 2);
  vm.runInContext('askThread.queued = true; updateAskAvailability();', context);
  assert.equal(context.askChatBusy.hidden, true);
  vm.runInContext('mainModelBusy = false; updateAskAvailability();', context);
  assert.equal(context.askChatBusy.hidden, true);
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
  assert.doesNotMatch(running, /id="askChatInput"[^>]*disabled/u);
  assert.doesNotMatch(running, /id="askChatSend"[^>]*disabled/u);
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
