import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { getWebviewHtml } = require("../../webview/viewContent") as typeof import("../../webview/viewContent");

test("task mode controls retain labels and employee capacity settings explain the shared dispatch budget", () => {
  const html = getWebviewHtml({ cspSource: "self" });
  const cliCard = html.indexOf('id="cliEnabledCard"');
  const modesCard = html.indexOf('id="taskModesCard"');
  const aiTaskPanel = html.indexOf('id="toolSettingsAiTaskPanel"');
  assert.ok(cliCard >= 0 && modesCard > cliCard && aiTaskPanel > modesCard);
  for (const [id, label] of [["loopEnabled", "开启 Loop"], ["loopPlusEnabled", "开启 Loop+"], ["departmentEnabled", "开启产研部 beta"]]) {
    assert.equal(html.match(new RegExp(`<label [^>]*for="${id}">([^<]+)</label>`))?.[1], label);
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const cardContaining = (id: string) => {
    const inputIndex = html.indexOf(`id="${id}"`);
    const cardStart = html.lastIndexOf("<section", inputIndex);
    const cardEnd = html.indexOf("</section>", inputIndex) + "</section>".length;
    return html.slice(cardStart, cardEnd);
  };
  for (const id of ["departmentMaxLeaders", "departmentMaxEmployees", "workspaceDepartmentMaxLeaders", "workspaceDepartmentMaxEmployees"]) {
    assert.match(cardContaining(id), /data-mode-requirement="department"/);
  }
  for (const id of ["newTaskInteractiveMode", "loopGroupChatMessageLimit", "loopPlusDecisionSubtaskMax", "workspaceLoopPlusDecisionSubtaskMax"]) {
    assert.match(cardContaining(id), /data-mode-requirement="loop-or-loop-plus"/);
  }
  assert.doesNotMatch(html, /department-performance-warning|警告：本机必须具备/);
  for (const id of ["departmentMaxEmployeesNote", "workspaceDepartmentMaxEmployeesNote"]) {
    const note = html.match(new RegExp(`<div id="${id}"[^>]*>([^<]+)</div>`))?.[1];
    assert.match(note || "", /全产研部共享.*并发预算.*默认 16 人.*派发数量由 AI 根据任务决定/);
  }
});
