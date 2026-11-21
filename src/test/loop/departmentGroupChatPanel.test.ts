import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";
import { installVscodeMock } from "../vscodeMock";
import { departmentState } from "./departmentGroupChatPanel.fixture";
import { buildLoopGroupChatPanelTitle, getStrings } from "../../webview/loopGroupChatPanelRenderer";
import type { DepartmentGroupChatProjection, LoopGroupChatPanelMessage } from "../../webview/loopGroupChatPanelTypes";
import { buildDepartmentChildBridge, DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT, LOOP_GROUP_CHAT_HOST_MESSAGE_SCRIPT } from "../../webview/departmentGroupChatModal";

installVscodeMock();
const { buildLoopGroupChatPanelHtml, buildLoopGroupChatPanelContentPatch, LoopGroupChatPanel } = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");

for (const role of ["director", "leader"] as const) {
  test(`${role}: initial HTML and content patch share escaped hierarchy, title and actions`, () => {
    const state = departmentState(role);
    const projection: DepartmentGroupChatProjection = state.department!;
    projection.leaders[0].progressPercent = 25;
    projection.director.title = "总监任务原始长标题 <需求>".repeat(12);
    const original = JSON.stringify(state);
    const patch = buildLoopGroupChatPanelContentPatch(state, 2);
    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as never, state);
    assert.ok(html.includes(patch.rosterPanelHtml));
    assert.ok(html.includes(patch.actionsHtml));
    assert.equal(patch.statusBarHtml, "");
    assert.doesNotMatch(html, /<footer id="statusBarSlot"/u);
    assert.equal(patch.headingText, role === "director" ? "产研部群聊" : "组长A");
    assert.equal(patch.tabTitle, patch.headingText);
    assert.ok(html.includes(`<title>${patch.headingText}</title>`));
    assert.deepEqual(
      Array.from(patch.rosterPanelHtml.matchAll(/<span class="avatar">([^<]*)<\/span>/gu), match => match[1]),
      role === "director" ? ["总", "组", "组", "组"] : ["组", "员"],
    );
    assert.doesNotMatch(patch.rosterPanelHtml, /[☀🌛⭐]/u);
    assert.match(patch.rosterPanelHtml, /class="member-name" title="组长A · 同名模块">组长A · 同名模块<\/div>/u);
    if (role === "leader") assert.match(patch.rosterPanelHtml, /class="member-name" title="(魏强 · 员工甲[^"]*)">\1<\/div>/u);
    assert.equal(patch.subtitleText, role === "director" ? state.task.id : `${projection.title} · ${state.task.id}`);
    if (role === "director") {
      assert.ok(html.includes(`<p id="panelSubtitle" title="${state.task.id}">${state.task.id}</p>`));
    } else {
      assert.match(html, /&lt;流程&gt; &amp; &quot;标题&quot;/u);
    }
    assert.equal(patch.tabTitle, buildLoopGroupChatPanelTitle(state, getStrings()));
    assert.doesNotMatch(patch.rosterPanelHtml, /<契约>/u);
    if (role === "director") assert.match(patch.rosterPanelHtml, /class="member-name" title="总监">总监<\/div>/u);
    else assert.doesNotMatch(patch.rosterPanelHtml, /class="member-name" title="总监"/u);
    assert.doesNotMatch(patch.rosterPanelHtml, /总监任务原始长标题/u);
    assert.match(patch.rosterPanelHtml, /组长 2\/4 · 员工 1\/20（全部门共享）/u);
    if (role === "director") {
      assert.match(patch.rosterPanelHtml, /<span class="member-status-running">运行中<\/span>&nbsp;<span class="department-leader-progress">25%<\/span>/u);
      assert.doesNotMatch(patch.rosterPanelHtml.match(/data-department-leader-task-id=""[\s\S]*?<\/li>/u)?.[0] ?? "", /department-leader-progress/u);
      assert.match(patch.rosterPanelHtml, /data-department-title="组长A" data-department-task-id="department-20261113-leader-111111"/u);
      assert.match(patch.rosterPanelHtml, /data-department-title="组长B" data-department-task-id="department-20261113-leader-222222"/u);
      assert.match(patch.rosterPanelHtml, /class="member-name" title="组长B · 同名模块">组长B · 同名模块<\/div>/u);
      assert.match(patch.rosterPanelHtml, /员工状态汇总"><span class="department-status-tag">运行中 0<\/span><span class="department-status-tag">验收中 0<\/span><span class="department-status-tag">待验收 0<\/span>/u);
      assert.doesNotMatch(patch.rosterPanelHtml, /员工甲|员工乙/u);
      assert.match(patch.rosterPanelHtml, /data-department-task-id=""[^>]*disabled[^>]*>打开组长群聊<\/button><div class="member-meta">群聊尚未创建/u);
    } else {
      assert.doesNotMatch(patch.rosterPanelHtml, /department-leader-progress/u);
      assert.match(patch.rosterPanelHtml, /data-department-leader-task-id="department-20261113-leader-111111"[\s\S]*魏强 · 员工甲/u);
      assert.doesNotMatch(patch.rosterPanelHtml, /leader-222222|员工乙|打开组长群聊/u);
    }
    assert.match(patch.rosterPanelHtml, /运行中/u);
    for (const action of ["supplementTask", "askMainModel", "switchModels", "continueTask"]) assert.ok(patch.actionsHtml.includes(`data-action="${action}"`));
    if (role === "director") {
      assert.doesNotMatch(patch.actionsHtml, /data-action="refresh"/u);
      assert.match(patch.actionsHtml, /data-action="askMainModel"[^>]*>我要提问<\/button><button[^>]*data-action="allocateEmployees"[^>]*>分配员工<\/button>/u);
      assert.match(patch.actionsHtml, /data-action="acceptancePlan"[^>]*>统一验收方案/u);
      assert.doesNotMatch(patch.rosterPanelHtml, /jumpToAcceptance|返回总监群聊/u);
      assert.match(html, /<div[^>]*id="acceptancePlanOverlay"/u);
      assert.match(html, /id="departmentChatBackdrop"/u);
    } else {
      assert.match(patch.actionsHtml, /data-action="refresh"/u);
      assert.doesNotMatch(patch.actionsHtml, /data-action="acceptancePlan"/u);
      assert.match(patch.taskPanelHtml, /继承产研部统一验收方案/u);
      assert.doesNotMatch(html, /<div[^>]*id="acceptancePlanOverlay"/u);
      assert.match(patch.rosterPanelHtml, /返回总监群聊/u);
      assert.match(patch.rosterPanelHtml, /data-action="jumpToAcceptance"/u);
      assert.match(patch.timelineHtml, /id="loop-plus-acceptance-0"/u);
    }
    assert.equal(JSON.stringify(state), original);
  });
}

test("director roster summarizes employee statuses without exposing employees or disclosure controls", () => {
  const state = departmentState("director");
  state.department!.leaders[0].employees = [
    { id: "running", title: "员工运行中", role: "subtask", status: "running" },
    { id: "reviewing", title: "员工验收中", role: "subtask", status: "reviewing" },
    { id: "queued", title: "员工待验收", role: "subtask", status: "queued_review" },
    { id: "pending", title: "员工待启动", role: "subtask", status: "pending" },
    { id: "blocked", title: "员工已阻塞", role: "subtask", status: "blocked" },
    { id: "completed", title: "员工已完成", role: "subtask", status: "completed" },
    { id: "passed", title: "员工验收成功", role: "subtask", status: "acceptance_passed" },
    { id: "failed", title: "员工验收失败", role: "subtask", status: "acceptance_failed" },
    { id: "no-acceptance", title: "员工无需验收", role: "subtask", status: "no_acceptance" },
    { id: "cancelled", title: "员工验收撤销", role: "subtask", status: "acceptance_cancelled" },
    { id: "execution-completed", title: "员工执行结束", role: "subtask", status: "execution_completed" },
  ];
  const html = buildLoopGroupChatPanelContentPatch(state, 2).rosterPanelHtml;
  const tagsFor = (leader: string) => {
    const summary = html.match(new RegExp(`aria-label="组长${leader}员工状态汇总">(.*?)</div>`, "u"))?.[1] ?? "";
    return [...summary.matchAll(/<span class="department-status-tag">([^<]+)<\/span>/gu)].map((match) => match[1]);
  };
  assert.deepEqual(tagsFor("A"), ["运行中 1", "验收中 1", "待验收 1", "待启动 1", "已阻塞 1", "已完成 4"]);
  assert.deepEqual(tagsFor("B"), ["运行中 0", "验收中 0", "待验收 0", "待启动 1", "已阻塞 0", "已完成 0"]);
  assert.doesNotMatch(html, /员工运行中|员工验收中|员工待验收|员工待启动|员工已阻塞|员工已完成|department-employees|toggleDepartmentEmployees/u);
  assert.match(html, /data-department-title="组长A" data-department-task-id="department-20261113-leader-111111"/u);
});

test("director roster opens the leader chat where its task can be stopped", () => {
  const director = departmentState("director");
  director.department!.leaders[1].participant.status = "failed";
  const roster = buildLoopGroupChatPanelContentPatch(director, 2).rosterPanelHtml;
  assert.match(roster, /data-department-title="组长A" data-department-task-id="department-20261113-leader-111111"/u);
  assert.doesNotMatch(roster, /cancelDepartmentLeader|取消此组长任务/u);

  const leader = departmentState("leader");
  leader.task.canStop = true;
  const actions = buildLoopGroupChatPanelContentPatch(leader, 2).actionsHtml;
  assert.match(actions, /data-action="stopTask"[^>]*>中止<\/button>/u);
});

test("director roster keeps the director first and displays newer leader modules first", () => {
  const state = departmentState("director");
  const roster = buildLoopGroupChatPanelContentPatch(state, 2).rosterPanelHtml;
  assert.match(roster, />总监<\/div>[\s\S]*>组长B · 同名模块<\/div>[\s\S]*>组长A · 同名模块<\/div>/u);
});

test("leader roster always shows its own employees without disclosure controls", () => {
  const state = departmentState("leader");
  const html = buildLoopGroupChatPanelContentPatch(state, 2).rosterPanelHtml;
  assert.match(html, /魏强 · 员工甲/u);
  assert.doesNotMatch(html, /department-status-tag|toggleDepartmentEmployees/u);
});

test("leader chat titles use their module number even when earlier groups are absent", () => {
  const state = departmentState("leader");
  assert.equal(buildLoopGroupChatPanelTitle(state, getStrings()), "组长A");
  state.task.id = "department-20261113-leader-222222";
  state.department!.leaders.shift();
  assert.equal(buildLoopGroupChatPanelTitle(state, getStrings()), "组长B");
  state.task.id = "unmatched-task";
  assert.equal(buildLoopGroupChatPanelTitle(state, getStrings()), "组长");
});

test("leader roster keeps the leader first and displays newer employees with distinct names", () => {
  const state = departmentState("leader");
  const department = state.department!;
  const template = department.leaders[0];
  department.leaders = [{ ...template, employees: ["王磊", "陈静"].map((employeeName) => ({
    ...template.employees[0], title: "子任务", employeeName,
  })) }];
  assert.match(buildLoopGroupChatPanelContentPatch(state, 2).rosterPanelHtml,
    />组长A · 同名模块<\/div>[\s\S]*>陈静 · 子任务<\/div>[\s\S]*>王磊 · 子任务<\/div>/u);
});

test("modal refresh does not force iframe focus and keeps the opaque child bridge bound", () => {
  const target = { taskId: "department-20261113-leader-111111", instanceId: "instance-a" };
  const bridge = buildDepartmentChildBridge(target);
  const sync = bridge.slice(bridge.indexOf("const sync = () =>"), bridge.indexOf("window.__departmentDialogOpened"));
  const observer = bridge.slice(bridge.indexOf("new MutationObserver(sync)"), bridge.indexOf('document.addEventListener("keydown"'));
  assert.match(DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT, /setAttribute\("sandbox", "allow-scripts"\)/u);
  assert.doesNotMatch(DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT, /child\(\{ control: "focus"/u);
  assert.match(bridge, /event\.source !== parent[\s\S]*data\.taskId !== binding\.taskId[\s\S]*data\.instanceId !== binding\.instanceId/u);
  assert.doesNotMatch(bridge, /message\.control === "focus"/u);
  assert.doesNotMatch(sync, /\.focus\(/u);
  assert.doesNotMatch(observer, /\.focus\(/u, "asynchronous mutation refresh never moves focus");
  assert.match(sync, /element\.inert = element !== top/u, "dialog lifecycle synchronizes inert state before returning focus");
  const close = bridge.slice(bridge.indexOf("window.__departmentDialogClosed"), bridge.indexOf("new MutationObserver(sync)"));
  assert.match(close, /restoreFocus = true/u);
  assert.match(close, /sync\(\);[\s\S]*if \(restoreFocus && wasTop/u, "focus restoration follows layer synchronization and can be suppressed for async close");
  assert.match(close, /opener\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(bridge, /event\.key !== "Tab"/u);
});

test("known hierarchy survives missing rounds and read errors; empty tree stays honest", () => {
  const state = departmentState();
  state.rounds = [];
  state.error = "读取失败 <路径>";
  let patch = buildLoopGroupChatPanelContentPatch(state, 1);
  assert.doesNotMatch(patch.rosterPanelHtml, /员工甲|员工乙/u);
  assert.match(patch.timelineHtml, /读取失败 &lt;路径&gt;/u);
  state.department!.leaders = [];
  state.department!.activeLeaders = 0;
  state.department!.activeEmployees = 0;
  patch = buildLoopGroupChatPanelContentPatch(state, 2);
  assert.match(patch.rosterPanelHtml, /尚未分配组长/u);
  assert.match(patch.rosterPanelHtml, />总监<\/div>/u);
  assert.doesNotMatch(patch.rosterPanelHtml, /员工甲|员工乙/u);
});

test("missing director target disables the return action; task ID alone enables a created chat", () => {
  const state = departmentState("leader");
  state.department!.rootTaskId = " ";
  state.department!.leaders[0].participant.sessionId = null;
  const patch = buildLoopGroupChatPanelContentPatch(state, 1);
  assert.match(patch.rosterPanelHtml, /aria-label="返回总监群聊：群聊尚未创建" disabled/u);
  assert.doesNotMatch(patch.rosterPanelHtml, /data-department-task-id="department-20261113-leader-111111"[^>]*>打开组长群聊/u);
});

test("leader roster requires an exact current task match and shows only its own empty group", () => {
  const state = departmentState("leader");
  state.task.id = "department-20261113-leader-unknown";
  let patch = buildLoopGroupChatPanelContentPatch(state, 1);
  assert.doesNotMatch(patch.rosterPanelHtml, />总监<\/div>|组长[AB] · 同名模块|员工甲|员工乙|leader-111111|leader-222222/u);
  assert.match(patch.rosterPanelHtml, /尚未分配组长/u);
  assert.match(patch.rosterPanelHtml, /返回总监群聊/u);

  state.task.id = "department-20261113-leader-111111";
  state.department!.leaders[0].employees = [];
  patch = buildLoopGroupChatPanelContentPatch(state, 2);
  assert.match(patch.rosterPanelHtml, /data-department-leader-task-id="department-20261113-leader-111111"/u);
  assert.match(patch.rosterPanelHtml, /尚未分配员工/u);
  assert.doesNotMatch(patch.rosterPanelHtml, />总监<\/div>|员工乙|leader-222222/u);
});

test("navigation posts only the exact task ID and never derives it from a label", () => {
  const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as never, departmentState());
  const start = html.indexOf('if (action === "openDepartmentTask")');
  const script = html.slice(start, html.indexOf('if (action === "refresh")', start));
  for (const taskId of ['department-<id>"&', "", " "]) {
    const sent: LoopGroupChatPanelMessage[] = [];
    vm.runInNewContext(`(function() { ${script} })()`, {
      action: "openDepartmentTask", target: { getAttribute: () => taskId },
      departmentModal: null, saveScrollState() {}, vscode: { postMessage: (message: LoopGroupChatPanelMessage) => sent.push(message) },
    });
    assert.equal(JSON.stringify(sent), JSON.stringify(taskId.trim() ? [{ type: "loopGroupChatChat:openDepartmentTask", taskId }] : []));
  }
});

test("ordinary Loop and Loop+ retain their roster, title and acceptance behavior", () => {
  const state = departmentState();
  delete state.department;
  let patch = buildLoopGroupChatPanelContentPatch(state, 1);
  assert.match(patch.rosterPanelHtml, /jumpToAcceptance/u);
  assert.match(patch.actionsHtml, /acceptancePlan/u);
  assert.doesNotMatch(patch.rosterPanelHtml, /department-tree|打开组长群聊/u);
  assert.equal(patch.headingText, getStrings().titleLoopPlus);
  delete state.loopPlus;
  patch = buildLoopGroupChatPanelContentPatch(state, 2);
  assert.equal(patch.headingText, getStrings().title);
  assert.doesNotMatch(patch.actionsHtml, /acceptancePlan/u);
  assert.doesNotMatch(patch.rosterPanelHtml, /jumpToAcceptance/u);
});


test("modal host API binds state, patches, questions, previews and close to the current task and instance", async () => {
  const vscode = require("vscode");
  const sent: any[] = [];
  const handled: any[] = [];
  let receive!: (message: unknown) => Promise<void>;
  let html = "";
  let installations = 0;
  const previous = vscode.window.createWebviewPanel;
  vscode.window.createWebviewPanel = () => ({
    webview: {
      cspSource: "self", get html() { return html; }, set html(value: string) { html = value; installations++; },
      postMessage: (message: unknown) => { sent.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (callback: typeof receive) => { receive = callback; },
    }, onDidDispose() {}, reveal() {},
  });
  try {
    const panel = new LoopGroupChatPanel({ fsPath: "/extension" } as never, { onMessage: (message) => handled.push(message) });
    panel.show(departmentState());
    const a = { taskId: "department-20261113-leader-111111", instanceId: "instance-a" };
    await receive({ type: "loopGroupChatChat:departmentModal", ...a, action: "load" });
    assert.deepEqual(panel.getDepartmentModalTarget(), a);
    const state = departmentState("leader");
    assert.equal(panel.setDepartmentModalState(a, state), true);
    const content = sent.at(-1);
    assert.equal(content.taskId, a.taskId);
    assert.match(content.html, /department-child/u);
    assert.equal(installations, 1);
    await receive({ type: "loopGroupChatChat:departmentTaskMessage", ...a, message: { type: "loopGroupChatChat:domReady" } });
    assert.ok(sent.some((message) => message.message?.type === "loopGroupChatChat:contentPatch" && message.instanceId === a.instanceId));
    const thread = { version: 1 as const, messages: [], running: false, dialogOpen: true, updatedAt: 1 };
    assert.equal(panel.publishDepartmentModalAskThread(a, thread), true);
    assert.equal(sent.at(-1).message.thread, thread);
    assert.equal(panel.postDepartmentModalCommunicationFilePreview(a, { type: "loopGroupChatChat:communicationFile", requestId: "r", path: "/display-only/file.md", ok: false, error: "missing" }), true);
    assert.equal(sent.at(-1).message.requestId, "r");
    const handledBefore = handled.length;
    await receive({ type: "loopGroupChatChat:departmentTaskMessage", ...a, message: { type: "loopGroupChatChat:updateAcceptancePlan", plan: {} } });
    assert.equal(handled.length, handledBefore, "leader cannot edit its inherited plan through the bridge");
    await receive({ type: "loopGroupChatChat:departmentTaskMessage", ...a, message: { type: "loopGroupChatChat:stopTask" } });
    assert.equal(handled.at(-1).taskId, a.taskId);
    const b = { taskId: "department-20261113-leader-222222", instanceId: "instance-b" };
    await receive({ type: "loopGroupChatChat:departmentModal", ...b, action: "load" });
    const count = sent.length;
    assert.equal(panel.setDepartmentModalState(a, state), false);
    assert.equal(panel.publishDepartmentModalAskThread(a, thread), false);
    assert.equal(panel.setDepartmentModalError(a, "迟到错误"), false);
    assert.equal(panel.closeDepartmentModal(a), false);
    assert.equal(sent.length, count);
    assert.equal(panel.setDepartmentModalState(b, state), false, "state task ID must match binding");
    assert.equal(panel.setDepartmentModalError(b, "组长读取失败"), true);
    assert.equal(sent.at(-1).error, "组长读取失败");
    assert.equal(panel.closeDepartmentModal(b), true);
    assert.equal(panel.getDepartmentModalTarget(), undefined);
    assert.equal(installations, 1);
  } finally { vscode.window.createWebviewPanel = previous; }
});

function themeElement() {
  const properties = new Map<string, string>();
  const attributes = new Map<string, string>();
  const classes = new Set(["department-chat-page"]);
  return {
    properties, attributes, classes,
    style: { setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) },
    classList: {
      contains: (name: string) => classes.has(name), add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
      toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
    },
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    getAttribute: (key: string) => attributes.get(key), hasAttribute: (key: string) => attributes.has(key),
    removeAttribute: (key: string) => attributes.delete(key),
  };
}

test("child theme snapshots are bound, restricted and remove obsolete tokens and metadata", () => {
  const root = themeElement();
  const body = themeElement();
  const parent = {};
  let receive!: (event: any) => void;
  const binding = { taskId: "leader-a", instanceId: "a-1" };
  const window = { name: JSON.stringify({ theme: { variables: { "--vscode-editor-background": "black", "--vscode-button-border": "gray" }, body: { classes: ["vscode-dark"], attributes: { "data-vscode-theme-id": "old" } } } }),
    addEventListener: (_: string, callback: typeof receive) => { receive = callback; } };
  vm.runInNewContext(buildDepartmentChildBridge(binding), { window, parent, document: { documentElement: root, body, addEventListener() {} } });
  assert.equal(root.properties.get("--vscode-editor-background"), "black");
  const theme = { variables: { "--vscode-editor-background": "white", "--other": "rejected", "--vscode-invalid": 42 },
    body: { classes: ["vscode-light", "untrusted-class"], attributes: { "data-vscode-theme-name": "新主题", onclick: "rejected" } }, colorScheme: "light" };
  const deliver = (source: unknown, target: object, channel = "department-host") => receive({ source, data: { channel, ...target, message: { control: "theme", theme } }, stopImmediatePropagation() {} });
  deliver({}, binding);
  deliver(parent, { ...binding, instanceId: "stale" });
  deliver(parent, binding, "wrong-channel");
  assert.equal(root.properties.get("--vscode-editor-background"), "black");
  deliver(parent, binding);
  assert.deepEqual([...root.properties], [["--vscode-editor-background", "white"]]);
  assert.deepEqual([...body.classes].sort(), ["department-chat-page", "vscode-light"]);
  assert.deepEqual([...body.attributes], [["data-vscode-theme-name", "新主题"]]);
  assert.equal(window.name, "");
});

test("parent observes theme carriers, resends latest theme on load and ignores detached frames", () => {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    const value = { ...themeElement(), listeners: {} as Record<string, () => void>, focus() {}, replaceChildren() {},
      addEventListener(type: string, callback: () => void) { this.listeners[type] = callback; } };
    elements.set(id, value); return value;
  };
  for (const id of ["departmentChatBackdrop", "departmentChatTitle", "departmentChatClose", "departmentChatRetry", "departmentChatStatus", "departmentChatContent", "panelHeading"]) element(id);
  const root = themeElement(); const body = themeElement(); const head = {};
  const shell = { inert: false };
  const frames: any[] = [];
  const sent: any[] = [];
  let receive!: (event: any) => void;
  let observe!: () => void;
  const observed: any[] = [];
  let tokens: Record<string, string> = { "--vscode-editor-background": "black" };
  const document = { documentElement: root, body, head, activeElement: null,
    getElementById: (id: string) => elements.get(id), querySelector: () => shell, querySelectorAll: () => [], addEventListener() {},
    createElement: () => {
      const value = { ...element("iframe"), contentWindow: { postMessage: (message: unknown) => sent.push({ frame: frames.indexOf(value), message }) } };
      frames.push(value); return value;
    },
  };
  const window: any = { location: { origin: "vscode-webview://owning-panel" }, addEventListener: (_: string, callback: typeof receive) => { receive = callback; } };
  window.parent = window;
  const hostShell = { document: { getElementById: (id: string) => id === "active-frame" ? { contentWindow: window } : null } };
  const modal = vm.runInNewContext(DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT.replace("PARENT_TASK_ID", '"root"') + "\ndepartmentModal;", {
    window, document, crypto: { randomUUID: (() => { let id = 0; return () => String(++id); })() }, vscode: { postMessage() {} },
    getComputedStyle: (element: unknown) => { assert.equal(element, body); return Object.assign(Object.keys(tokens), { getPropertyValue: (key: string) => tokens[key], colorScheme: "dark" }); },
    MutationObserver: class { constructor(callback: () => void) { observe = callback; } observe(target: unknown, options: unknown) { observed.push({ target, options }); } },
  });
  const install = (taskId: string, instanceId: string) => receive({ source: hostShell, origin: window.location.origin, data: { type: "loopGroupChatChat:departmentModalContent", taskId, instanceId, html: "local html" } });
  assert.deepEqual(observed.map((item) => item.target), [root, body, head]);
  modal.open("leader-a"); install("leader-a", "1");
  assert.equal(JSON.parse(frames[0].name).theme.variables["--vscode-editor-background"], "black");
  tokens = { "--vscode-editor-background": "white" }; observe(); sent.length = 0;
  frames[0].listeners.load();
  assert.equal(sent[0].message.message.theme.variables["--vscode-editor-background"], "white", "load repairs a theme change while srcdoc was parsing");
  modal.open("leader-b"); install("leader-b", "2"); sent.length = 0;
  frames[0].listeners.load(); assert.equal(sent.length, 0);
  tokens = { "--vscode-editor-background": "black" }; observe();
  assert.equal(sent[0].frame, 1); assert.equal(sent[0].message.taskId, "leader-b"); assert.equal(sent[0].message.instanceId, "2");
  elements.get("departmentChatClose").listeners.click(); sent.length = 0; observe();
  frames[1].listeners.load(); assert.equal(sent.length, 0, "closed frames receive no theme updates");
});


test("VS Code shell messages survive the parent alias and reject unrelated frames and origins", () => {
  const page: any = { location: { origin: "vscode-webview://owning-panel" } };
  page.parent = page; // acquireVsCodeApi deliberately hides the physical parent.
  const shell = { document: { getElementById: (id: string) => id === "active-frame" ? { contentWindow: page } : null } };
  const accepts = vm.runInNewContext(LOOP_GROUP_CHAT_HOST_MESSAGE_SCRIPT + "\nisLoopGroupChatHostMessage;", { window: page });
  assert.equal(accepts({ source: shell, origin: page.location.origin }), true);
  assert.equal(accepts({ source: page, origin: page.location.origin }), true);
  assert.equal(accepts({ source: shell, origin: "null" }), false);
  assert.equal(accepts({ source: { document: { getElementById: () => ({ contentWindow: {} }) } }, origin: page.location.origin }), false);
  assert.equal(accepts({ source: { get document() { throw new Error("cross-origin"); } }, origin: page.location.origin }), false);
  const directorHtml = buildLoopGroupChatPanelHtml({ cspSource: "self" } as never, departmentState());
  assert.match(directorHtml, /if \(!isLoopGroupChatHostMessage\(event\)\) return;/u,
    "ordinary content patches and modal content use the same owning-shell boundary");
});

test("allocation UI is director-only editable, honest when unavailable and escapes labels", () => {
  const state = departmentState();
  const projection = state.department!;
  projection.leaders[0].participant.title = '<组长 "甲">';
  const unavailable = buildLoopGroupChatPanelContentPatch(state, 1);
  assert.match(unavailable.actionsHtml, /data-action="allocateEmployees"[^>]*>分配员工/);
  assert.doesNotMatch(unavailable.rosterPanelHtml, /data-allocation|员工参考额度|额度未知|>分配员工</);
  assert.match(unavailable.employeeAllocationHtml, /员工额度未知，额度服务不可用/);
  assert.match(unavailable.employeeAllocationHtml, /class="department-allocation-input"[^>]*disabled/);
  projection.employeeAllocation = { rootTaskId: projection.rootTaskId, revision: 3, defaultLimit: 5,
    leaders: [{ leaderTaskId: projection.leaders[0].taskId, source: "manual", desiredLimit: 0, appliedLimit: null, activeEmployees: 2, pending: true }] };
  assert.match(buildLoopGroupChatPanelContentPatch(state, 2).employeeAllocationHtml, /额度写入服务不可用/);
  projection.employeeAllocationEditable = true;
  const director = buildLoopGroupChatPanelContentPatch(state, 3);
  const html = director.employeeAllocationHtml;
  assert.doesNotMatch(director.rosterPanelHtml, /data-allocation|员工参考额度|恢复均分/);
  assert.match(html, /aria-label="员工参考额度：组长A · &lt;组长 &quot;甲&quot;&gt;"/);
  assert.match(html, /实际占用 2 · 待首次派发 · 新参考值已保存/);
  assert.match(html, /type="number"[^>]*min="0"[^>]*max="20"[^>]*step="1"/);
  assert.doesNotMatch(html, /<button\b|恢复均分/);
  assert.match(html, /aria-live="polite"/);
  const dialogHtml = buildLoopGroupChatPanelHtml({ cspSource: "self" } as never, state)
    .match(/<dialog id="departmentAllocationDialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialogHtml);
  assert.equal(dialogHtml.match(/<button\b/g)?.length, 2);
  assert.match(dialogHtml, /class="dialog-header"[^>]*>[\s\S]*?<button id="departmentAllocationClose" class="icon-button"[^>]*><svg/);
  assert.match(dialogHtml, /class="dialog-actions"[^>]*>[\s\S]*?<button id="departmentAllocationSave" class="button primary"[^>]*>保存并关闭<\/button>/);
  const empty = buildLoopGroupChatPanelContentPatch({ ...state, department: { ...projection, leaders: [] } }, 4);
  assert.match(empty.employeeAllocationHtml, /尚未分配组长/);
  projection.role = "leader";
  state.task.id = projection.leaders[0].taskId;
  const leader = buildLoopGroupChatPanelContentPatch(state, 5);
  assert.doesNotMatch(leader.actionsHtml, /allocateEmployees/);
  assert.equal(leader.employeeAllocationHtml, "");
  assert.doesNotMatch(leader.rosterPanelHtml, /data-allocation-action|class="department-allocation-input"/);
  assert.match(leader.rosterPanelHtml, /员工参考额度 0 · 实际占用 2/);
});

test("allocation writes are explicitly absent from child forwarding contracts", () => {
  const { DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES } = require("../../webview/loopGroupChatPanelTypes") as typeof import("../../webview/loopGroupChatPanelTypes");
  assert.equal(DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES.has("loopGroupChatChat:updateDepartmentEmployeeLimit"), false);
  // @ts-expect-error director writes must never become a child-forwardable message
  const child: import("../../webview/loopGroupChatPanelTypes").DepartmentGroupChatTaskMessage = { type: "loopGroupChatChat:updateDepartmentEmployeeLimit", requestId: "x", leaderTaskId: "y", employeeLimit: 1, expectedRevision: 0 };
  assert.equal(child.type, "loopGroupChatChat:updateDepartmentEmployeeLimit");
});


test("director stop feedback keeps the progress action slot and incumbent button classes", () => {
  const state = departmentState("director");
  state.task.canStop = true; state.task.canContinue = false;
  const normal = buildLoopGroupChatPanelContentPatch(state, 1).actionsHtml;
  assert.match(normal, /class="progress-controls"[\s\S]*class="button danger"[^>]*data-action="stopTask"[^>]*>中止/);
  for (const feedback of ["stopping", "unconfirmed", "confirmed"] as const) {
    state.task.departmentStopState = feedback;
    state.task.status = "stopped";
    state.task.canStop = feedback === "stopping";
    state.task.canContinue = feedback === "confirmed";
    const patch = buildLoopGroupChatPanelContentPatch(state, 1);
    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as never, state);
    assert.ok(html.includes(patch.actionsHtml));
    if (feedback === "stopping") assert.match(patch.actionsHtml, /data-action="stopTask"[^>]*disabled[^>]*>正在停止…/);
    if (feedback === "unconfirmed") {
      assert.doesNotMatch(patch.actionsHtml, /核验停止|data-action="stopTask"/);
      assert.match(patch.actionsHtml, /data-action="continueTask"[^>]*disabled/);
      assert.match(patch.actionsHtml, /仍有原执行退出未确认，暂不能继续/);
    }
    if (feedback === "confirmed") {
      assert.doesNotMatch(patch.actionsHtml, /data-action="stopTask"|停止未确认/);
      assert.match(patch.actionsHtml, /data-action="continueTask"/);
    }
  }
});
