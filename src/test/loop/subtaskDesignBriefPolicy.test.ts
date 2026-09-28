import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import test = require("node:test");

test("classic Loop main prompt includes the design key point rule", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/extensionHost/loopOrchestration.ts"), "utf8");
  const rule = fs.readFileSync(path.join(process.cwd(), "src/subtaskDesignBriefPolicy.ts"), "utf8");
  assert.match(source, /SUBTASK_DESIGN_KEY_POINT_RULE_ZH,/u);
  assert.match(rule, /派发时禁止只给粗粒度目标/u);
  assert.match(source, /设计关键点：保持既有对外接口兼容/u);
  assert.match(source, /不要只派发粗粒度任务/u);
});
