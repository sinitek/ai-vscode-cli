import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

test("department role rows expose CLI, model and thinking without role profile selectors", () => {
  const html = buildWebviewStaticHtml({ cspSource: "test", nonce: "test", i18n: WEBVIEW_STRINGS,
    cliOptions: "", markedScript: "", jsonFormatterScript: "", webviewStyles: "" });
  assert.match(html, /id="departmentDirectorControls"/u);
  const prompt = html.indexOf('id="promptInput"');
  const footer = html.indexOf('class="input-footer"');
  const roles = html.indexOf('id="departmentRoleConfiguration"');
  assert.ok(prompt < footer && footer < roles && roles < html.indexOf('class="input-actions"'),
    "department role configuration follows the multiline input in the footer, before send actions");
  for (const role of ["leader", "employee"]) {
    assert.match(html, new RegExp(`id="department-${role}-cli"`, "u"));
    assert.match(html, new RegExp(`id="department-${role}-model"`, "u"));
    assert.match(html, new RegExp(`id="department-${role}-thinking"`, "u"));
    assert.doesNotMatch(html, new RegExp(`id="department-${role}-config"`, "u"));
    assert.doesNotMatch(html, new RegExp(`id="department-${role}-message"`, "u"));
    assert.match(html, new RegExp(`aria-label="重试${role === "leader" ? "组长" : "员工"}配置"`, "u"));
  }
  assert.match(html, /id="modelSelect"/u);
  assert.match(html, /id="thinkingMode"/u);
});

test("director model selection updates the normal panel state and posts the normal model message", () => {
  const start = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("function handleModelSelectChange(value)");
  assert.notEqual(start, -1);
  const end = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("\n      function reportModelManagerInspection", start);
  assert.notEqual(end, -1);
  const posted: Record<string, unknown>[] = [];
  const sandbox = vm.createContext({ MODEL_MANAGE_OPTION_VALUE: "__manage__", state: { currentCli: "codex", selectedModel: "old", selectedModelsByCli: {} },
    getCurrentModelConfigId: () => "director-config", vscode: { postMessage: (message: Record<string, unknown>) => posted.push(message) } });
  vm.runInContext(VIEW_CONTENT_SCRIPT_MODEL_MANAGER.slice(start, end), sandbox);
  sandbox.handleModelSelectChange("gpt-5");
  assert.equal(sandbox.state.selectedModel, "gpt-5");
  assert.equal(sandbox.state.selectedModelsByCli.codex, "gpt-5");
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: "selectCliModel", cli: "codex", model: "gpt-5", configId: "director-config" }]);
});
