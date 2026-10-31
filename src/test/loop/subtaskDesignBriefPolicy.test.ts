import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import test = require("node:test");

test("Loop main prompt applies the subtask design key point rule", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/extensionHost/loopOrchestration.ts"), "utf8");
  const rule = fs.readFileSync(path.join(process.cwd(), "src/subtaskDesignBriefPolicy.ts"), "utf8");
  assert.match(source, /SUBTASK_DESIGN_KEY_POINT_RULE_ZH,/u);
  assert.match(rule, /派发时禁止只给粗粒度目标/u);
  assert.match(rule, /涉及 UI 美化、布局或交互时/u);
  assert.match(rule, /不得自行改配色、间距、组件结构或交互/u);
  assert.match(rule, /When the task changes UI appearance, layout, or interaction/u);
  assert.match(rule, /非这类任务不要编造界面设计/u);
  assert.match(rule, /架构约束、不变量、兼容口径、数据契约、边界条件、失败模式/u);
  assert.match(source, /不要把任务记录、调度状态、轮次或父任务协议写进 prompt/u);
});
