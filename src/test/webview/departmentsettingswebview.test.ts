import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import { test } from "node:test";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { buildWebviewRuntimeScript } from "../../webview/viewContentScript";
import { CLI_LIST } from "../../cli/types";
import { FINAL_ANSWER_TEXT_MARKER } from "../../finalAnswerProtocol";
import { normalizeDepartmentCapacity as normalizeHostDepartmentCapacity } from "../../departmentSettings";

function buildStaticHtml(): string {
  return buildWebviewStaticHtml({
    cspSource: "vscode-resource://department-settings-test",
    nonce: "test-nonce",
    i18n: getWebviewStrings(),
    cliOptions: "",
    markedScript: "",
    jsonFormatterScript: "",
    webviewStyles: "",
  });
}

test("department capacity settings render as associated numeric controls with defaults and notes", () => {
  const html = buildStaticHtml();
  assert.match(html, /for="departmentMaxLeaders"/u);
  assert.match(html, /id="departmentMaxLeaders"[^>]*min="1" step="1" value="4"/u);
  assert.match(html, /id="departmentMaxEmployees"[^>]*min="1" step="1" value="16"/u);
  assert.match(html, /向总监提供并发预算和当前占用，派发数量由 AI 决定。/u);
  assert.match(html, /全产研部共享的员工并发预算，默认 16 人。派发数量由 AI 根据任务决定。/u);
  assert.match(html, /id="workspaceDepartmentMaxEmployees"[^>]*placeholder="全局：16"/u);
});

function readFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} declaration must exist in generated runtime`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} declaration is incomplete`);
}

test("generated browser normalizer matches host rules for refresh and submitted values", () => {
  const runtime = buildWebviewRuntimeScript({
    i18n: getWebviewStrings(), cliList: CLI_LIST, loopMaxRoundsDefault: 20,
    loopMaxRoundsMin: 1, loopMaxRoundsMax: 100, finalAnswerTextMarker: FINAL_ANSWER_TEXT_MARKER,
  });
  const posted: unknown[] = [];
  const elements = {
    departmentMaxLeaders: { value: "" },
    departmentMaxEmployees: { value: "" },
  };
  const document: { activeElement: { value: string } | null } = { activeElement: null };
  const sandbox: Record<string, any> = {
    vscode: { postMessage: (message: unknown) => posted.push(message) },
    state: {},
    elements,
    document,
  };
  vm.runInNewContext([
    readFunction(runtime, "normalizeDepartmentCapacity"),
    readFunction(runtime, "syncDepartmentCapacityPanelState"),
    readFunction(runtime, "commitDepartmentCapacitySetting"),
    readFunction(runtime, "bindDepartmentCapacityInput"),
  ].join("\n"), sandbox);

  const normalize = sandbox.normalizeDepartmentCapacity as (value: unknown, fallback: number) => number;
  for (const fallback of [4, 16]) {
    for (const value of [0.5, 0, "  ", "invalid", Infinity, true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
      const hostValue = normalizeHostDepartmentCapacity(value, fallback);
      assert.equal(hostValue, fallback);
      assert.equal(normalize(value, fallback), hostValue);
    }
  }
  for (const [value, fallback, expected] of [["3.8", 4, 3], [6.1, 16, 6]] as const) {
    const hostValue = normalizeHostDepartmentCapacity(value, fallback);
    assert.equal(hostValue, expected);
    assert.equal(normalize(value, fallback), hostValue);
  }

  sandbox.syncDepartmentCapacityPanelState({ departmentMaxLeaders: 0.5, departmentMaxEmployees: "7.9" });
  assert.equal(sandbox.state.departmentMaxLeaders, 4);
  assert.equal(sandbox.state.departmentMaxEmployees, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.elements)), { departmentMaxLeaders: { value: "4" }, departmentMaxEmployees: { value: "7" } });
  sandbox.syncDepartmentCapacityPanelState({ departmentMaxLeaders: 0, departmentMaxEmployees: "invalid" });
  assert.equal(sandbox.elements.departmentMaxLeaders.value, "4");
  assert.equal(sandbox.elements.departmentMaxEmployees.value, "16");
  sandbox.syncDepartmentCapacityPanelState({ departmentMaxEmployees: 20 });
  assert.equal(sandbox.elements.departmentMaxEmployees.value, "20");

  const snapshot = { departmentMaxLeaders: 8, departmentMaxEmployees: 9 };
  for (const [focused, unfocused] of [
    ["departmentMaxLeaders", "departmentMaxEmployees"],
    ["departmentMaxEmployees", "departmentMaxLeaders"],
  ] as const) {
    sandbox.syncDepartmentCapacityPanelState({});
    const previous = sandbox.state[focused];
    const input = elements[focused];
    input.value = "12.5";
    document.activeElement = input;
    sandbox.syncDepartmentCapacityPanelState(snapshot);
    assert.equal(input.value, "12.5", focused);
    assert.equal(sandbox.state[focused], previous, focused);
    assert.equal(elements[unfocused].value, String(snapshot[unfocused]), unfocused);

    document.activeElement = null;
    sandbox.syncDepartmentCapacityPanelState(snapshot);
    assert.equal(input.value, String(snapshot[focused]), focused);
    assert.equal(sandbox.state[focused], snapshot[focused], focused);
  }
  assert.equal(posted.length, 0);

  const listeners = new Map<string, () => void>();
  const input = {
    value: "3.8",
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
  };
  const state: Record<string, number> = { departmentMaxLeaders: 4 };
  sandbox.bindDepartmentCapacityInput(input, "departmentMaxLeaders", state);
  listeners.get("change")?.();
  assert.equal(input.value, "3");
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: "updateSetting", key: "departmentMaxLeaders", value: 3 }]);
  listeners.get("blur")?.();
  assert.equal(posted.length, 1);

  input.value = "0.5";
  listeners.get("change")?.();
  assert.equal(input.value, "4");
  assert.equal(state.departmentMaxLeaders, 4);
  assert.equal(posted.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(posted[1])), { type: "updateSetting", key: "departmentMaxLeaders", value: 4 });
  listeners.get("blur")?.();
  assert.equal(posted.length, 2);
});

test("workspace capacity cards are independent siblings between dispatch and memory cards", () => {
  const html = buildStaticHtml();
  for (const key of ["workspaceDepartmentMaxLeaders", "workspaceDepartmentMaxEmployees"]) {
    assert.match(html, new RegExp(`for="${key}"`));
    assert.match(html, new RegExp(`id="${key}"[^>]*min="1" step="1"[^>]*disabled`));
    assert.doesNotMatch(html.match(new RegExp(`<input[^>]*id="${key}"[^>]*>`))![0], /\bmax=/);
  }
  assert.ok(html.indexOf('id="workspaceLoopPlusDecisionSubtaskMax"') < html.indexOf('id="workspaceDepartmentMaxLeaders"'));
  assert.ok(html.indexOf('id="workspaceDepartmentMaxEmployees"') < html.indexOf('id="longTermMemoryEnabled"'));
});

test("workspace generated runtime deduplicates saves, restores failure and rejects responses after ABA scope switch", () => {
  const runtime = buildWebviewRuntimeScript({ i18n: getWebviewStrings(), cliList: CLI_LIST, loopMaxRoundsDefault: 20,
    loopMaxRoundsMin: 1, loopMaxRoundsMax: 100, finalAnswerTextMarker: FINAL_ANSWER_TEXT_MARKER });
  const posted: any[] = [];
  const makeInput = () => ({ value: "", disabled: true, placeholder: "", validity: {}, setAttribute() {}, removeAttribute() {} });
  const elements = { workspaceDepartmentMaxLeaders: makeInput(), workspaceDepartmentMaxEmployees: makeInput() };
  const status: Record<string, { textContent: string }> = {};
  const sandbox: any = { vscode: { postMessage: (m: unknown) => posted.push(m) }, elements,
    state: { departmentMaxLeaders: 8, departmentMaxEmployees: 16 }, document: { getElementById: (id: string) => status[id] ??= { textContent: "" } } };
  vm.runInNewContext(`const workspaceCapacityUi = { scope: null, sequence: 0, pending: {}, values: {} };
    const workspaceCapacityKeys = ["workspaceDepartmentMaxLeaders", "workspaceDepartmentMaxEmployees"];\n` + [
    "normalizeDepartmentCapacity", "workspaceCapacityStatus", "syncWorkspaceDepartmentCapacityPanelState", "commitWorkspaceDepartmentCapacity", "applyWorkspaceDepartmentCapacitySaved",
  ].map((name) => readFunction(runtime, name)).join("\n"), sandbox);
  const panel = (scope: string, leaders: number | null = null, employees: number | null = null) => sandbox.syncWorkspaceDepartmentCapacityPanelState({ departmentConfigurationScope: scope, workspaceDepartmentMaxLeaders: leaders, workspaceDepartmentMaxEmployees: employees });
  panel("a:1"); assert.equal(elements.workspaceDepartmentMaxLeaders.placeholder, "全局：8");
  assert.equal(elements.workspaceDepartmentMaxEmployees.value, "");
  assert.equal(elements.workspaceDepartmentMaxEmployees.placeholder, "全局：16");
  elements.workspaceDepartmentMaxLeaders.value = "2.8";
  sandbox.commitWorkspaceDepartmentCapacity("workspaceDepartmentMaxLeaders"); sandbox.commitWorkspaceDepartmentCapacity("workspaceDepartmentMaxLeaders");
  assert.equal(posted.length, 1); assert.equal(elements.workspaceDepartmentMaxLeaders.disabled, true);
  const reply = (m: any, ok: boolean) => sandbox.applyWorkspaceDepartmentCapacitySaved({ ...m.value, key: m.key, ok, error: "保存失败" });
  reply(posted[0], false); assert.equal(elements.workspaceDepartmentMaxLeaders.value, ""); assert.equal(elements.workspaceDepartmentMaxLeaders.disabled, false);
  assert.equal(status.workspaceDepartmentMaxLeadersStatus.textContent, "保存失败");
  elements.workspaceDepartmentMaxLeaders.value = "2"; sandbox.commitWorkspaceDepartmentCapacity("workspaceDepartmentMaxLeaders"); reply(posted[1], true);
  assert.equal(elements.workspaceDepartmentMaxLeaders.value, "2");
  elements.workspaceDepartmentMaxLeaders.value = ""; sandbox.commitWorkspaceDepartmentCapacity("workspaceDepartmentMaxLeaders"); reply(posted[2], true);
  assert.equal(elements.workspaceDepartmentMaxLeaders.value, "");
  elements.workspaceDepartmentMaxLeaders.value = "0.5"; sandbox.commitWorkspaceDepartmentCapacity("workspaceDepartmentMaxLeaders"); assert.equal(posted.length, 3);
  panel("b:2", 7); assert.equal(status.workspaceDepartmentMaxLeadersStatus.textContent, "");
  panel("a:3"); elements.workspaceDepartmentMaxLeaders.value = "5"; sandbox.commitWorkspaceDepartmentCapacity("workspaceDepartmentMaxLeaders");
  reply(posted[0], true); assert.equal(elements.workspaceDepartmentMaxLeaders.disabled, true);
  reply(posted[3], true); assert.equal(elements.workspaceDepartmentMaxLeaders.value, "5");
  sandbox.state.departmentMaxLeaders = 10; panel("a:3", 5); assert.equal(elements.workspaceDepartmentMaxLeaders.placeholder, "全局：10");
  sandbox.state.departmentMaxEmployees = 20; panel("a:3", 5);
  assert.equal(elements.workspaceDepartmentMaxEmployees.value, "");
  assert.equal(elements.workspaceDepartmentMaxEmployees.placeholder, "全局：20");
  panel("a:3", 5, 12);
  assert.equal(elements.workspaceDepartmentMaxEmployees.value, "12");
});
