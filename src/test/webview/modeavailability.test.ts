import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { getWebviewHtml } = require("../../webview/viewContent") as typeof import("../../webview/viewContent");

test("task mode controls have associated labels, defaults and persistent department warning", () => {
  const html = getWebviewHtml({ cspSource: "self" });
  const cliCard = html.indexOf('id="cliEnabledCard"');
  const modesCard = html.indexOf('id="taskModesCard"');
  const aiTaskPanel = html.indexOf('id="toolSettingsAiTaskPanel"');
  assert.ok(cliCard >= 0 && modesCard > cliCard && aiTaskPanel > modesCard);
  for (const [id, label] of [["loopEnabled", "开启 Loop"], ["loopPlusEnabled", "开启 Loop+"], ["departmentEnabled", "开启产研部"]]) {
    assert.match(html, new RegExp(`for="${id}"`));
    assert.match(html, new RegExp(`id="${id}"`));
    assert.ok(html.includes(label));
  }
  assert.ok((html.match(/警告：本机必须具备并行运行 20 多个 CLI 执行任务的性能。/gu) || []).length >= 2);
});
