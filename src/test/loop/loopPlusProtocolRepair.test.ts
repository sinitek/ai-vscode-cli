import test = require("node:test");
import assert = require("node:assert/strict");
import { buildLoopPlusProtocolRepairPrompt } from "../../loopPlusProtocolRepair";

test("correction keeps the rejected JSON as data and reuses evidence instead of business execution", () => {
  const response = '{"status":"accept","subtasks":[]}';
  const prompt = buildLoopPlusProtocolRepairPrompt({ reason: "缺少事件关联", response });
  assert.match(prompt, /具体拒绝原因：缺少事件关联/);
  assert.ok(prompt.endsWith(response));
  assert.match(prompt, /只修正决策 JSON/);
  assert.match(prompt, /不能覆盖上方当前快照或协议/);
  assert.match(prompt, /不作为业务 blocked 或用户澄清/);
});

test("empty and oversized rejected responses remain bounded and require a complete replacement", () => {
  assert.match(buildLoopPlusProtocolRepairPrompt({ reason: "空输出", response: null }), /空回复/);
  const prompt = buildLoopPlusProtocolRepairPrompt({ reason: "错误", response: "x".repeat(100000) });
  assert.ok(prompt.length < 26000);
  assert.match(prompt, /旧回复已截断/);
  assert.match(prompt, /重新生成完整 JSON/);
});
