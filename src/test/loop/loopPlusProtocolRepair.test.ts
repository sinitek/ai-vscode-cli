import test = require("node:test");
import assert = require("node:assert/strict");
import { buildLoopPlusProtocolPauseSummary, buildLoopPlusProtocolRepairPrompt, readLoopPlusProtocolRepairFromSummary } from "../../loopPlusProtocolRepair";

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

test("format repair asks for JSON without repeating unrelated model prose", () => {
  const prompt = buildLoopPlusProtocolRepairPrompt({
    reason: "未找到可解析的 Loop+ 决策 JSON 对象",
    response: null,
    formatFailure: true,
  }, { number: 3, limit: 3 });
  assert.match(prompt, /第 3\/3 次自动纠错/);
  assert.match(prompt, /只返回一个完整 JSON 对象/);
  assert.doesNotMatch(prompt, /上次上下文摘要|Previous rejected response/);
});

test("restores the reason from a persisted pause without replaying stale recovery instructions", () => {
  const reason = "缺少验收证据\n请核对构建输出";
  assert.deepEqual(readLoopPlusProtocolRepairFromSummary(buildLoopPlusProtocolPauseSummary(reason, 2)), { reason, response: null });
  assert.equal(readLoopPlusProtocolRepairFromSummary("其他暂停原因"), null);
});
