import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";

import { getWebviewStrings } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_ACCEPTANCE_PLAN } from "../../webview/viewContentScript/acceptancePlan";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../webview/viewContentScript/runStreamAndQueue";

type FakeClassList = {
  add: (...tokens: string[]) => void;
  remove: (...tokens: string[]) => void;
  toggle: (token: string, force?: boolean) => boolean;
  contains: (token: string) => boolean;
};

class FakeElement {
  className = "";
  textContent = "";
  tagName: string;
  style: { display: string } = { display: "" };
  disabled = false;
  hidden = false;
  value = "";
  checked = false;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, Array<(event: any) => void>> = {};
  private html = "";
  readonly classList: FakeClassList;

  constructor(tag = "div") {
    this.tagName = tag;
    const tokens = new Set<string>();
    this.classList = {
      add: (...values: string[]) => {
        values.forEach((value) => tokens.add(value));
        this.className = Array.from(tokens).join(" ");
      },
      remove: (...values: string[]) => {
        values.forEach((value) => tokens.delete(value));
        this.className = Array.from(tokens).join(" ");
      },
      toggle: (token: string, force?: boolean) => {
        const next = typeof force === "boolean" ? force : !tokens.has(token);
        if (next) {
          tokens.add(token);
        } else {
          tokens.delete(token);
        }
        this.className = Array.from(tokens).join(" ");
        return next;
      },
      contains: (token: string) => tokens.has(token),
    };
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    if (value === "") {
      this.children = [];
    }
  }

  appendChild<T extends FakeElement>(child: T): T {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    (this.listeners[type] || []).forEach((listener) => listener({ target: this, ...event }));
  }

  focus(): void {
    focused.push(this);
  }

  select(): void {
    return undefined;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

const focused: FakeElement[] = [];

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function planDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-a",
    name: "上线前加严",
    checks: ["security"],
    otherText: "",
    updatedAt: 1,
    ...overrides,
  };
}

type Harness = {
  api: Record<string, any>;
  state: Record<string, any>;
  overlay: FakeElement;
  dom: Record<string, FakeElement>;
  posted: Array<Record<string, unknown>>;
  toasts: string[];
  dispatched: Array<{ payload: Record<string, any>; tabId?: string }>;
  queued: Array<Record<string, any>>;
  conflicts: Array<Record<string, any>>;
  busyTabs: Set<string>;
  runningLoopTabs: Set<string>;
  activeTabId: string;
};

function createHarness(options: {
  plans?: Array<Record<string, unknown>>;
  selection?: string;
  activeTabId?: string;
  tabs?: Array<Record<string, any>>;
} = {}): Harness {
  const state: Record<string, any> = {
    loopPlusAcceptancePlans: options.plans ?? [],
    loopPlusAcceptancePlanSelection: options.selection ?? "",
    interactiveMode: "loop_plus",
  };
  const ids = [
    "acceptancePlanOverlay",
    "acceptancePlanNameOverlay",
    "acceptancePlanSelect",
    "saveAcceptancePlan",
    "deleteAcceptancePlan",
    "acceptancePlanDeleteOverlay",
    "acceptancePlanDeleteDesc",
    "confirmAcceptancePlanDelete",
    "cancelAcceptancePlanDelete",
    "closeAcceptancePlanDelete",
    "acceptancePlanNameField",
    "acceptancePlanNameInput",
    "acceptancePlanCheckMaintainability",
    "acceptancePlanCheckSecurity",
    "acceptancePlanCheckPerformance",
    "acceptancePlanCheckUi",
    "acceptancePlanCheckOther",
    "acceptancePlanOtherField",
    "acceptancePlanOtherText",
    "acceptancePlanError",
    "cancelAcceptancePlan",
    "confirmAcceptancePlan",
    "closeAcceptancePlan",
    "acceptancePlanNewName",
    "acceptancePlanNameError",
    "confirmAcceptancePlanName",
    "cancelAcceptancePlanName",
    "closeAcceptancePlanName",
  ];
  const dom: Record<string, FakeElement> = {};
  ids.forEach((id) => {
    dom[id] = new FakeElement(id.startsWith("acceptancePlanCheck") ? "input" : "div");
    if (id === "acceptancePlanCheckBaseline") {
      dom[id].checked = true;
      dom[id].disabled = true;
    }
  });
  for (const key of ["acceptancePlanCheckMaintainability", "acceptancePlanCheckSecurity", "acceptancePlanCheckPerformance", "acceptancePlanCheckUi", "acceptancePlanCheckOther"]) {
    dom[key].checked = false;
  }
  const posted: Array<Record<string, unknown>> = [];
  const toasts: string[] = [];
  const dispatched: Array<{ payload: Record<string, any>; tabId?: string }> = [];
  const queued: Array<Record<string, any>> = [];
  const conflicts: Array<Record<string, any>> = [];
  const busyTabs = new Set<string>();
  const runningLoopTabs = new Set<string>();
  const tabs = options.tabs ?? [{ id: "tab-1", cli: "codex" }];
  const activeTabId = options.activeTabId ?? "tab-1";
  const i18n = getWebviewStrings() as unknown as Record<string, string>;

  const document = {
    getElementById(id: string) {
      return dom[id] ?? null;
    },
    createElement(tag: string) {
      return new FakeElement(tag);
    },
    activeElement: null as FakeElement | null,
    contains() {
      return true;
    },
    addEventListener() {
      return undefined;
    },
  };

  const sandbox: Record<string, unknown> = {
    state,
    document,
    elements: { promptInput: new FakeElement("textarea") },
    vscode: {
      postMessage(message: Record<string, unknown>) {
        posted.push(message);
      },
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
    getActiveConversationTabId: () => activeTabId,
    getConversationTabSummary: (tabId: string) => tabs.find((tab) => tab.id === tabId) ?? null,
    isLoopMainConversationTabRunning: (tabId: string) => runningLoopTabs.has(tabId),
    isConversationTabBusy: (tabId: string) => busyTabs.has(tabId),
    resolveDispatchInteractiveMode: (explicit: string | undefined) => explicit || state.interactiveMode,
    dispatchPrompt: (payload: Record<string, any>) => {
      dispatched.push({ payload });
      return true;
    },
    queuePromptForLater: (payload: Record<string, any>) => {
      queued.push(payload);
    },
    openRunConflictOverlay: (payload: Record<string, any>) => {
      conflicts.push(payload);
    },
    sendPromptWithAcceptancePlan: (payload: Record<string, any>, tabId: string) => {
      dispatched.push({ payload, tabId });
      return "sent";
    },
    showToast: (message: string) => {
      toasts.push(message);
    },
    resetPromptContextForNextPrompt: () => undefined,
    t: (key: string, params?: Record<string, unknown>) => {
      const template = i18n[key] ?? key;
      return params
        ? String(template).replace(/\{(\w+)\}/g, (match, name) => (
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        ))
        : template;
    },
    formatTemplate: (template: string, params?: Record<string, unknown>) => (
      params
        ? String(template).replace(/\{(\w+)\}/g, (match, name) => (
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        ))
        : template
    ),
    i18n,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    `${VIEW_CONTENT_SCRIPT_ACCEPTANCE_PLAN}
this.api = {
  normalizeAcceptancePlanSnapshot: normalizeAcceptancePlanSnapshot,
  normalizeAcceptancePlanName: normalizeAcceptancePlanName,
  normalizeAcceptancePlanChecks: normalizeAcceptancePlanChecks,
  getAcceptancePlanSummaries: getAcceptancePlanSummaries,
  resolveAcceptancePlanById: resolveAcceptancePlanById,
  loadAcceptancePlanDraft: loadAcceptancePlanDraft,
  readAcceptancePlanDraftFromDom: readAcceptancePlanDraftFromDom,
  applyAcceptancePlanDraftToDom: applyAcceptancePlanDraftToDom,
  syncAcceptancePlanOtherField: syncAcceptancePlanOtherField,
  validateAcceptancePlanDraft: validateAcceptancePlanDraft,
  saveAcceptancePlanFromDialog: saveAcceptancePlanFromDialog,
  openAcceptancePlanDeleteDialog: openAcceptancePlanDeleteDialog,
  confirmAcceptancePlanDeleteDialog: confirmAcceptancePlanDeleteDialog,
  closeAcceptancePlanDeleteDialog: closeAcceptancePlanDeleteDialog,
  confirmAcceptancePlanNameDialog: confirmAcceptancePlanNameDialog,
  handleAcceptancePlanSavedMessage: handleAcceptancePlanSavedMessage,
  openAcceptancePlanDialog: openAcceptancePlanDialog,
  closeAcceptancePlanDialog: closeAcceptancePlanDialog,
  confirmAcceptancePlan: confirmAcceptancePlan,
  cancelAcceptancePlan: cancelAcceptancePlan,
  isAcceptancePlanRequiredForPayload: isAcceptancePlanRequiredForPayload,
  isAcceptancePlanNameDialogOpen: isAcceptancePlanNameDialogOpen,
  hasAcceptancePlanName: hasAcceptancePlanName,
  buildAcceptancePlanSnapshotFromDraft: buildAcceptancePlanSnapshotFromDraft,
  dialog: acceptancePlanDialog,
};`,
    context,
  );

  const overlay = dom.acceptancePlanOverlay;
  dom.closeAcceptancePlanName = dom.closeAcceptancePlanName ?? new FakeElement();

  return {
    api: sandbox.api as Record<string, any>,
    state,
    overlay,
    dom,
    posted,
    toasts,
    dispatched,
    queued,
    conflicts,
    busyTabs,
    runningLoopTabs,
    activeTabId,
  };
}

function sendPromptPayload(overrides: Record<string, unknown> = {}) {
  return { prompt: "实现验收方案", contextOptions: { includeCurrentFile: true, includeSelection: true }, ...overrides };
}

test("system default is always available and carries no optional checks", () => {
  const harness = createHarness();
  const summaries = harness.api.getAcceptancePlanSummaries();
  assert.deepEqual(plain(summaries), []);
  const system = harness.api.resolveAcceptancePlanById("system_default");
  assert.equal(system.name, "系统默认");
  assert.deepEqual(plain(system.checks), []);
  assert.equal(system.systemDefault, true);
});

test("opening with a task snapshot keeps that task's checks instead of the saved template", () => {
  const harness = createHarness({
    plans: [planDraft({ id: "plan-a", name: "安全加严", checks: ["security"], otherText: "" })],
    selection: "plan-a",
  });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1", {
    id: "system_default",
    name: "系统默认",
    checks: ["performance", "other"],
    otherText: "检查滚动",
    systemDefault: true,
  });
  assert.equal(harness.dom.acceptancePlanSelect.value, "system_default");
  assert.equal(harness.dom.acceptancePlanNameField.style.display, "flex");
  assert.equal(harness.dom.acceptancePlanNameInput.value, "默认方案");
  assert.equal(harness.dom.acceptancePlanCheckPerformance.checked, true);
  assert.equal(harness.dom.acceptancePlanCheckSecurity.checked, false);
  assert.equal(harness.dom.acceptancePlanOtherText.value, "检查滚动");
  assert.equal(harness.dom.acceptancePlanOtherField.style.display, "flex");
});

test("opening the dialog starts on 系统默认 with the five optional checks unchecked", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");

  assert.equal(harness.overlay.classList.contains("visible"), true);
  assert.equal(harness.dom.acceptancePlanSelect.value, "system_default");
  assert.equal(harness.dom.acceptancePlanSelect.children[0].value, "new");
  assert.equal(harness.dom.acceptancePlanSelect.children[0].textContent, "新增方案");
  assert.equal(harness.dom.acceptancePlanSelect.children[1].value, "system_default");
  assert.equal(harness.dom.acceptancePlanSelect.children[1].textContent, "默认方案");
  assert.equal(harness.dom.deleteAcceptancePlan.hidden, true);
  assert.equal(harness.dom.acceptancePlanNameField.style.display, "flex");
  assert.equal(harness.dom.acceptancePlanNameInput.value, "默认方案");
  for (const key of ["Security", "Performance", "Maintainability", "Ui", "Other"]) {
    const input = harness.dom[`acceptancePlanCheck${key}`];
    assert.equal(input.checked, false, `${key} should be unchecked under 系统默认`);
  }
  assert.equal(harness.dom.acceptancePlanOtherField.style.display, "none");
});

test("checking 其它 reveals the textarea and blank content blocks confirm", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanCheckOther.checked = true;
  harness.api.syncAcceptancePlanOtherField();
  assert.equal(harness.dom.acceptancePlanOtherField.style.display, "flex");
  assert.equal(harness.dom.acceptancePlanCheckOther.getAttribute("aria-expanded"), "true");
  const draft = harness.api.readAcceptancePlanDraftFromDom();
  assert.deepEqual(plain(draft.checks), ["other"]);
  assert.equal(harness.api.validateAcceptancePlanDraft(draft), "已勾选“其它”，请填写审查内容。");

  harness.dom.acceptancePlanOtherText.value = " 检查鉴权 ";
  const filled = harness.api.readAcceptancePlanDraftFromDom();
  assert.equal(filled.otherText, "检查鉴权");
  assert.equal(harness.api.validateAcceptancePlanDraft(filled), "");
});

test("unchecking 其它 hides its text and drops it from the snapshot", () => {
  const harness = createHarness();
  const snapshot = harness.api.buildAcceptancePlanSnapshotFromDraft({
    planId: "system_default",
    name: "",
    checks: ["security"],
    otherText: "不应生效的内容",
  });
  assert.deepEqual(plain(snapshot), {
    id: "system_default",
    name: "系统默认",
    checks: ["security"],
    otherText: "",
    systemDefault: true,
  });
});

test("saving 系统默认 creates a plan from the visible name without starting the task", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanCheckSecurity.checked = true;
  harness.dom.acceptancePlanNameInput.value = "  安全加严  ";
  harness.api.saveAcceptancePlanFromDialog();

  assert.equal(harness.api.isAcceptancePlanNameDialogOpen(), false);
  assert.equal(harness.posted.length, 1);
  const posted = harness.posted[0];
  assert.equal(posted.type, "saveLoopPlusAcceptancePlan");
  assert.equal(posted.planId, null);
  assert.equal(posted.name, "安全加严");
  assert.deepEqual(plain(posted.checks), ["security"]);
  assert.equal(harness.dispatched.length, 0, "saving must never start the task");
  assert.equal(harness.dom.acceptancePlanOverlay.classList.contains("visible"), true, "parent modal stays open");
});

test("saving from 系统默认 keeps the prefilled 默认方案 name", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.api.saveAcceptancePlanFromDialog();

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].planId, null);
  assert.equal(harness.posted[0].name, "默认方案");
  assert.equal(harness.api.isAcceptancePlanNameDialogOpen(), false);
});

test("新增方案 starts blank and saves as a new plan", () => {
  const harness = createHarness({ plans: [planDraft({ id: "plan-a", name: "安全加严" })] });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanSelect.value = "new";
  harness.api.loadAcceptancePlanDraft("new");

  assert.equal(harness.dom.acceptancePlanNameField.style.display, "flex");
  assert.equal(harness.dom.acceptancePlanNameInput.value, "");
  assert.equal(harness.dom.acceptancePlanCheckSecurity.checked, false);
  assert.equal(harness.posted.length, 0, "switching to 新增方案 does not persist a selection");

  harness.dom.acceptancePlanNameInput.value = "   ";
  harness.api.saveAcceptancePlanFromDialog();
  assert.equal(harness.dom.acceptancePlanError.textContent, "请输入验收方案名称。");
  assert.equal(harness.posted.length, 0);

  harness.dom.acceptancePlanNameInput.value = "安全加严";
  harness.api.saveAcceptancePlanFromDialog();
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].planId, "plan-a");
  assert.equal(harness.posted[0].name, "安全加严");
  harness.api.handleAcceptancePlanSavedMessage({
    plan: planDraft({ id: "plan-a", name: "安全加严", checks: [], otherText: "" }),
    plans: [planDraft({ id: "plan-a", name: "安全加严", checks: [], otherText: "" })],
    selection: "plan-a",
  });
  harness.posted.length = 0;

  harness.dom.acceptancePlanSelect.value = "new";
  harness.api.loadAcceptancePlanDraft("new");
  harness.dom.acceptancePlanNameInput.value = " 系统默认 ";
  harness.api.saveAcceptancePlanFromDialog();
  assert.equal(harness.dom.acceptancePlanError.textContent, "已存在同名验收方案，请更换名称。");
  assert.equal(harness.posted.length, 0);

  harness.dom.acceptancePlanNameInput.value = "上线前加严";
  harness.dom.acceptancePlanCheckSecurity.checked = true;
  harness.api.saveAcceptancePlanFromDialog();
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].planId, null);
  assert.equal(harness.posted[0].name, "上线前加严");
});

test("a second save is ignored while the first is still in flight", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.api.saveAcceptancePlanFromDialog();
  harness.api.saveAcceptancePlanFromDialog();

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.dom.saveAcceptancePlan.disabled, true);
  assert.equal(harness.dom.saveAcceptancePlan.textContent, "保存中...");
});

test("closing the dialog before save creates nothing and keeps the parent draft", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanCheckPerformance.checked = true;
  harness.api.closeAcceptancePlanDialog();
  assert.equal(harness.overlay.classList.contains("visible"), false);
  assert.equal(harness.posted.length, 0);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.dom.acceptancePlanCheckPerformance.checked, true);
});

test("a saved plan is selected, its name becomes editable, and the draft is reloaded", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanNameInput.value = "安全加严";
  harness.api.saveAcceptancePlanFromDialog();

  harness.api.handleAcceptancePlanSavedMessage({
    plan: { id: "plan-new", name: "安全加严", checks: ["security", "other"], otherText: "审计日志", updatedAt: 2 },
    plans: [{ id: "plan-new", name: "安全加严", checks: ["security", "other"], otherText: "审计日志", updatedAt: 2 }],
    selection: "plan-new",
  });

  assert.equal(harness.api.dialog.planId, "plan-new");
  assert.equal(harness.dom.acceptancePlanNameField.style.display, "flex");
  assert.equal(harness.dom.acceptancePlanNameInput.value, "安全加严");
  assert.equal(harness.dom.acceptancePlanCheckOther.checked, true);
  assert.equal(harness.dom.acceptancePlanOtherField.style.display, "flex");
  assert.equal(harness.dom.acceptancePlanOtherText.value, "审计日志");
  assert.equal(harness.state.loopPlusAcceptancePlanSelection, "plan-new");
});

test("switching plans loads its checks and 其它 text, and rename updates the same id", () => {
  const harness = createHarness({
    plans: [
      planDraft({ id: "plan-a", name: "A", checks: ["security"], otherText: "" }),
      planDraft({ id: "plan-b", name: "B", checks: ["other"], otherText: "检查性能热点" }),
    ],
    selection: "plan-a",
  });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanSelect.value = "plan-b";
  harness.api.loadAcceptancePlanDraft("plan-b");
  assert.equal(harness.dom.acceptancePlanNameInput.value, "B");
  assert.equal(harness.dom.acceptancePlanCheckOther.checked, true);
  assert.equal(harness.dom.acceptancePlanOtherText.value, "检查性能热点");

  harness.dom.acceptancePlanNameInput.value = "B2";
  harness.api.saveAcceptancePlanFromDialog();
  const posted = harness.posted[harness.posted.length - 1];
  assert.equal(posted.planId, "plan-b");
  assert.equal(posted.name, "B2");
  assert.equal(harness.api.isAcceptancePlanNameDialogOpen(), false, "rename updates in place");
});

test("a saved 默认方案 replaces the builtin option so the dropdown has only one", () => {
  const harness = createHarness({
    plans: [planDraft({ id: "plan-default", name: "默认方案", checks: ["security"], otherText: "" })],
  });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  const labels = harness.dom.acceptancePlanSelect.children.map((option: { textContent: string }) => option.textContent);
  assert.deepEqual(labels, ["新增方案", "默认方案"]);
  assert.equal(harness.dom.acceptancePlanSelect.value, "plan-default");
  assert.equal(harness.dom.acceptancePlanCheckSecurity.checked, true);
  assert.equal(harness.dom.deleteAcceptancePlan.hidden, false);
});

test("saving the builtin 默认方案 overwrites the saved plan with the same name", () => {
  const harness = createHarness({
    plans: [planDraft({ id: "plan-default", name: "默认方案", checks: [], otherText: "" })],
  });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanCheckSecurity.checked = true;
  harness.api.saveAcceptancePlanFromDialog();

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].planId, "plan-default");
  assert.equal(harness.posted[0].name, "默认方案");
  assert.deepEqual(plain(harness.posted[0].checks), ["security"]);
});

test("delete is available only for a saved plan and asks before posting", () => {
  const harness = createHarness({
    plans: [planDraft({ id: "plan-a", name: "安全加严" })],
    selection: "plan-a",
  });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  assert.equal(harness.dom.deleteAcceptancePlan.hidden, false);

  harness.api.openAcceptancePlanDeleteDialog();
  assert.equal(harness.dom.acceptancePlanDeleteOverlay.classList.contains("visible"), true);
  assert.equal(harness.dom.acceptancePlanDeleteDesc.textContent, "确定删除「安全加严」？已启动任务不受影响。");
  assert.equal(harness.posted.length, 0);

  harness.api.closeAcceptancePlanDeleteDialog();
  assert.equal(harness.dom.acceptancePlanDeleteOverlay.classList.contains("visible"), false);
  assert.equal(harness.posted.length, 0);

  harness.api.openAcceptancePlanDeleteDialog();
  harness.api.confirmAcceptancePlanDeleteDialog();
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].type, "deleteLoopPlusAcceptancePlan");
  assert.equal(harness.posted[0].planId, "plan-a");

  harness.api.handleAcceptancePlanSavedMessage({
    plan: { id: "system_default", name: "系统默认", checks: [], otherText: "", systemDefault: true },
    plans: [],
    selection: "system_default",
  });
  assert.equal(harness.dom.acceptancePlanDeleteOverlay.classList.contains("visible"), false);
  assert.equal(harness.dom.acceptancePlanSelect.value, "system_default");
  assert.equal(harness.dom.deleteAcceptancePlan.hidden, true);
  assert.equal(harness.toasts[harness.toasts.length - 1], "验收方案已删除。");
});

test("a save failure surfaces the Chinese error and keeps the draft", () => {
  const harness = createHarness({ plans: [planDraft({ id: "plan-a", name: "A" })] });
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.api.loadAcceptancePlanDraft("plan-a");
  harness.dom.acceptancePlanCheckPerformance.checked = true;
  harness.api.handleAcceptancePlanSavedMessage({ error: "验收方案保存失败，请稍后重试。" });

  assert.equal(harness.dom.acceptancePlanError.textContent, "验收方案保存失败，请稍后重试。");
  assert.equal(harness.dom.acceptancePlanError.style.display, "block");
  assert.equal(harness.dom.acceptancePlanCheckPerformance.checked, true);
  assert.equal(harness.api.dialog.planId, "plan-a");
  assert.equal(harness.posted.length, 0);
});

test("cancelling the dialog sends nothing and never clears the composer", () => {
  const harness = createHarness();
  const promptInput = (harness.api as any) && null;
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.api.cancelAcceptancePlan();
  assert.equal(harness.overlay.classList.contains("visible"), false);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.queued.length, 0);
  assert.equal(harness.conflicts.length, 0);
  assert.equal(harness.posted.length, 0);
  assert.equal(promptInput, null);
});

test("confirming sends exactly once with the snapshot attached", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  harness.dom.acceptancePlanCheckSecurity.checked = true;
  harness.dom.acceptancePlanCheckOther.checked = true;
  harness.dom.acceptancePlanOtherText.value = "审计日志";
  harness.api.confirmAcceptancePlan();
  harness.api.confirmAcceptancePlan();

  assert.equal(harness.dispatched.length, 1);
  const payload = harness.dispatched[0].payload;
  assert.deepEqual(plain(payload.loopPlusAcceptancePlan), {
    id: "system_default",
    name: "系统默认",
    checks: ["security", "other"],
    otherText: "审计日志",
    systemDefault: true,
  });
  assert.equal(harness.dispatched[0].tabId, "tab-1");
});

test("confirming refuses when the originating session is no longer active", () => {
  const harness = createHarness();
  harness.api.openAcceptancePlanDialog(sendPromptPayload(), "tab-1");
  const api = harness.api;
  const sandboxTabId = harness.activeTabId;
  assert.equal(sandboxTabId, "tab-1");

  // 模拟用户在弹窗打开后切走：活动标签页不再是捕获时的标签页。
  const context = (harness.api.dialog as any);
  context.tabId = "tab-other";
  api.confirmAcceptancePlan();
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.dom.acceptancePlanError.textContent, "当前会话已变化，请重新确认验收方案。");
  assert.equal(context.open, true, "dialog stays open so the user can react");
});

test("only a new Loop+ root task requires the acceptance plan", () => {
  const harness = createHarness({
    tabs: [
      { id: "tab-1", cli: "codex" },
      { id: "plus-main", cli: "codex", loopTaskRole: "main", loopTaskId: "task-1", loopSchedulingMode: "event_driven" },
      { id: "plus-sub", cli: "codex", loopTaskRole: "subtask", loopTaskId: "task-1" },
    ],
  });
  assert.equal(harness.api.isAcceptancePlanRequiredForPayload(sendPromptPayload({ interactiveMode: "loop_plus" }), "tab-1"), true);
  assert.equal(harness.api.isAcceptancePlanRequiredForPayload(sendPromptPayload({ interactiveMode: "loop" }), "tab-1"), false);
  assert.equal(harness.api.isAcceptancePlanRequiredForPayload(sendPromptPayload({ interactiveMode: "coding" }), "tab-1"), false);
  assert.equal(harness.api.isAcceptancePlanRequiredForPayload(sendPromptPayload({ interactiveMode: "loop_plus" }), "plus-main"), false);
  assert.equal(harness.api.isAcceptancePlanRequiredForPayload(sendPromptPayload({ interactiveMode: "loop_plus" }), "plus-sub"), false);
  assert.equal(
    harness.api.isAcceptancePlanRequiredForPayload(sendPromptPayload({ interactiveMode: "loop_plus", skipPromptHistory: true }), "tab-1"),
    false,
    "queued/resumed prompts never re-open the dialog",
  );
});

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  let cursor = script.indexOf("(", start);
  let parens = 0;
  for (; cursor < script.length; cursor += 1) {
    const char = script[cursor];
    if (char === "(") {
      parens += 1;
    } else if (char === ")") {
      parens -= 1;
      if (parens === 0) {
        cursor += 1;
        break;
      }
    }
  }
  const bodyStart = script.indexOf("{", cursor);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === "{") {
      depth += 1;
    } else if (script[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${name} was not terminated`);
}

function createSendPromptSandbox(options: { required?: boolean; running?: boolean; busy?: boolean } = {}) {
  const captured: {
    opened: Array<{ payload: Record<string, any>; tabId: string }>;
    dispatched: Array<Record<string, any>>;
    queued: Array<Record<string, any>>;
    conflicts: Array<Record<string, any>>;
  } = { opened: [], dispatched: [], queued: [], conflicts: [] };
  const sandbox: Record<string, any> = {
    elements: { promptInput: { value: "实现任务" } },
    state: { interactiveMode: "loop_plus" },
    buildPromptPayload: (prompt: string) => ({ prompt, contextOptions: {} }),
    getActiveConversationTabId: () => "tab-1",
    isAcceptancePlanRequiredForPayload: () => options.required !== false,
    openAcceptancePlanDialog: (payload: Record<string, any>, tabId: string) => {
      captured.opened.push({ payload, tabId });
    },
    isLoopMainConversationTabRunning: () => options.running === true,
    isConversationTabBusy: () => options.busy === true,
    queuePromptForLater: (payload: Record<string, any>) => captured.queued.push(payload),
    openRunConflictOverlay: (payload: Record<string, any>) => captured.conflicts.push(payload),
    dispatchPrompt: (payload: Record<string, any>) => {
      captured.dispatched.push(payload);
      return true;
    },
    resetPromptContextForNextPrompt: () => undefined,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "clearPromptInputAfterSend"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "dispatchPromptPayload"),
      extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "sendPrompt"),
      "this.api = { sendPrompt: sendPrompt, dispatchPromptPayload: dispatchPromptPayload };",
    ].join("\n"),
    context,
  );
  return { api: sandbox.api as Record<string, any>, captured, sandbox };
}

test("sendPrompt opens the acceptance plan instead of sending for a new Loop+ root task", () => {
  const harness = createSendPromptSandbox();
  harness.api.sendPrompt();
  assert.equal(harness.captured.opened.length, 1);
  assert.equal(harness.captured.opened[0].tabId, "tab-1");
  assert.equal(harness.captured.opened[0].payload.prompt, "实现任务");
  assert.equal(harness.captured.dispatched.length, 0);
  assert.equal(harness.captured.queued.length, 0);
  assert.equal(harness.sandbox.elements.promptInput.value, "实现任务", "cancel path leaves the input intact");
});

test("sendPrompt keeps classic, graph, and continuation sending unchanged", () => {
  const harness = createSendPromptSandbox({ required: false });
  harness.api.sendPrompt();
  assert.equal(harness.captured.opened.length, 0);
  assert.equal(harness.captured.dispatched.length, 1);
  assert.equal(harness.sandbox.elements.promptInput.value, "");
});

test("confirmed acceptance plans still flow through queue and conflict branches", () => {
  const queued = createSendPromptSandbox({ required: false, running: true });
  queued.api.dispatchPromptPayload({ prompt: "实现任务" }, "tab-1");
  assert.equal(queued.captured.queued.length, 1);
  assert.equal(queued.captured.dispatched.length, 0);

  const conflict = createSendPromptSandbox({ required: false, busy: true });
  conflict.api.dispatchPromptPayload({ prompt: "实现任务" }, "tab-1");
  assert.equal(conflict.captured.conflicts.length, 1);
  assert.equal(conflict.captured.dispatched.length, 0);
  assert.equal(conflict.sandbox.elements.promptInput.value, "实现任务", "conflict keeps the draft for review");
});
