import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { getWebviewHtml } = require("../../webview/viewContent") as typeof import("../../webview/viewContent");

test("task mode controls retain labels and department performance guidance belongs to employee capacity settings", () => {
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
  assert.doesNotMatch(html, /department-performance-warning|警告：本机必须具备/);
  for (const id of ["departmentMaxEmployeesNote", "workspaceDepartmentMaxEmployeesNote"]) {
    const note = html.match(new RegExp(`<div id="${id}"[^>]*>([^<]+)</div>`))?.[1];
    assert.match(note || "", /所有组长合计计算.*根据本机性能设置.*默认 16 人.*16 个员工 CLI/);
  }
});
