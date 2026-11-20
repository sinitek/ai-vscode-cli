import test = require("node:test");
import assert = require("node:assert/strict");
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";

function getFunction(name: string, dependencies: string[] = [], values: unknown[] = []): Function {
  const start = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in the generated renderer`);
  const bodyStart = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.length; index += 1) {
    if (VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING[index] === "{") depth += 1;
    if (VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return new Function(...dependencies, `${VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.slice(start, index + 1)}; return ${name};`)(...values);
      }
    }
  }
  throw new Error(`${name} has no closing brace`);
}

const valid = { role: "director", rootTaskId: "root-long-abcdef01", taskId: "root-long-abcdef01", moduleTitle: "产研部" };

test("department tabs add the role icon and an available employee name to session labels", () => {
  const getPresentation = getFunction("getDepartmentConversationTabPresentation") as (tab: unknown) => unknown;
  const format = getFunction("formatConversationTabLabel", ["getDepartmentConversationTabPresentation", "getLoopMetaForTabSummary"],
    [getPresentation, (tab: any) => tab.loopTaskRole ? { taskRole: tab.loopTaskRole, loopTaskId: tab.loopTaskId } : null]) as (tab: unknown, base: string) => string;
  assert.equal(format({ loopTaskRole: "main", loopTaskId: valid.taskId, departmentPresentation: valid }, "Codex"), "☀️ Codex");
  assert.equal(format({ loopTaskRole: "main", loopTaskId: "leader-id-12345678", departmentPresentation: { ...valid, role: "leader", taskId: "leader-id-12345678", moduleTitle: "同名模块" } }, "Codex"),
    "🌛 Codex");
  assert.equal(format({ loopTaskRole: "subtask", loopTaskId: "root-long-abcdef01", departmentPresentation: { ...valid, role: "employee", employeeSubtaskId: "employee-87654321" } }, "Codex"),
    "⭐️ Codex");
  assert.equal(format({ loopTaskRole: "subtask", loopTaskId: "root-long-abcdef01", departmentPresentation: { ...valid, role: "employee", employeeSubtaskId: "employee-87654321", employeeName: "王磊" } }, "Codex"),
    "⭐️ 王磊 · Codex");
  assert.equal(format({ loopTaskRole: "main", loopTaskId: "leader-id-12345678", departmentPresentation: { ...valid, role: "leader", taskId: "leader-id-12345678" } }, "Codex2"),
    "🌛 Codex2");
  assert.equal(format({ loopTaskRole: "main", loopTaskId: "task" }, "Codex"), "🌛 Codex");
  for (const loopSchedulingMode of ["classic", "event_driven"]) {
    assert.equal(format({ loopTaskRole: "main", loopTaskId: "task", loopSchedulingMode }, "Codex2"), "🌛 Codex2");
    assert.equal(format({ loopTaskRole: "subtask", loopTaskId: "task", loopSchedulingMode }, "Codex3"), "⭐️ Codex3");
  }
  assert.equal(format({}, "总监 Codex"), "总监 Codex", "names do not grant a role decoration");
  assert.equal(format({}, "Codex"), "Codex");
});

test("trusted department projection drives the expected mode and role changes alter the auto-mode key", () => {
  const getPresentation = getFunction("getDepartmentConversationTabPresentation") as (tab: unknown) => typeof valid | null;
  const resolveRuntime = new Function("getDepartmentConversationTabPresentation", "getLoopMetaForTabSummary",
    `${VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.slice(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("function resolveAutoInteractiveModeForTab("), VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("function autoInteractiveModeTabKey("))}; return resolveAutoInteractiveModeForTab;`)(
      getPresentation, () => null) as (tab: unknown) => string;
  const keySource = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.slice(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("function autoInteractiveModeTabKey("), VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("function syncAutoInteractiveModeForActiveTab("));
  const keyRuntime = new Function("getDepartmentConversationTabPresentation", "getLoopMetaForTabSummary", `${keySource}; return autoInteractiveModeTabKey;`)(getPresentation, () => null) as (tab: unknown) => string;
  const tab = { id: "same-tab", loopTaskRole: "main", loopTaskId: valid.taskId, departmentPresentation: valid };
  assert.equal(resolveRuntime(tab), "department");
  assert.equal(resolveRuntime({ ...tab, loopTaskId: "leader-id", departmentPresentation: { ...valid, role: "leader", taskId: "leader-id" } }), "loop_plus");
  assert.equal(resolveRuntime({ ...tab, loopTaskRole: "subtask", loopTaskId: "leader-id", departmentPresentation: { ...valid, role: "employee", taskId: "leader-id", employeeSubtaskId: "sub-12345678" } }), "coding");
  const directorKey = keyRuntime(tab);
  const leaderKey = keyRuntime({ ...tab, loopTaskId: "leader-id", departmentPresentation: { ...valid, role: "leader", taskId: "leader-id" } });
  assert.notEqual(directorKey, leaderKey);
  assert.equal(getPresentation({ departmentPresentation: { ...valid, moduleTitle: " " } }), null);
  assert.equal(getPresentation({ loopTaskRole: "subtask", loopTaskId: valid.taskId, departmentPresentation: valid }), null);
});
