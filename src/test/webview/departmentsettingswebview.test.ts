import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import { test } from "node:test";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { buildWebviewRuntimeScript } from "../../webview/viewContentScript";
import { CLI_LIST } from "../../cli/types";
import { FINAL_ANSWER_TEXT_MARKER } from "../../finalAnswerProtocol";

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
  assert.match(html, /id="departmentMaxEmployees"[^>]*min="1" step="1" value="20"/u);
  assert.match(html, /同时运行的组长上限，任务结束后释放名额。/u);
  assert.match(html, /全产研部共享的员工并发上限，所有组长合计计算。/u);
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
  const sandbox: Record<string, any> = {
    vscode: { postMessage: (message: unknown) => posted.push(message) },
    state: {},
    elements: {
      departmentMaxLeaders: { value: "" },
      departmentMaxEmployees: { value: "" },
    },
  };
  vm.runInNewContext([
    readFunction(runtime, "normalizeDepartmentCapacity"),
    readFunction(runtime, "syncDepartmentCapacityPanelState"),
    readFunction(runtime, "commitDepartmentCapacitySetting"),
    readFunction(runtime, "bindDepartmentCapacityInput"),
  ].join("\n"), sandbox);

  const normalize = sandbox.normalizeDepartmentCapacity as (value: unknown, fallback: number) => number;
  for (const value of [0.5, 0, "  ", "invalid", Infinity, true, {}, []]) {
    assert.equal(normalize(value, 4), 4);
    assert.equal(normalize(value, 20), 20);
  }
  assert.equal(normalize("3.8", 4), 3);
  assert.equal(normalize(6.1, 20), 6);
  assert.equal(normalize(Number.MAX_SAFE_INTEGER + 1, 4), 4);

  sandbox.syncDepartmentCapacityPanelState({ departmentMaxLeaders: 0.5, departmentMaxEmployees: "7.9" });
  assert.equal(sandbox.state.departmentMaxLeaders, 4);
  assert.equal(sandbox.state.departmentMaxEmployees, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.elements)), { departmentMaxLeaders: { value: "4" }, departmentMaxEmployees: { value: "7" } });
  sandbox.syncDepartmentCapacityPanelState({ departmentMaxLeaders: 0, departmentMaxEmployees: "invalid" });
  assert.equal(sandbox.elements.departmentMaxLeaders.value, "4");
  assert.equal(sandbox.elements.departmentMaxEmployees.value, "20");

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
  listeners.get("blur")?.();
  assert.equal(posted.length, 2);
});
