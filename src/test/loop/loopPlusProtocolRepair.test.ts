import test = require("node:test");
import assert = require("node:assert/strict");
import { buildLoopPlusProtocolContinuationPrompt, buildLoopPlusProtocolPauseSummary, readLoopPlusProtocolFailureFromSummary } from "../../loopPlusProtocolRepair";

test("continuation uses the latest state, supplies the reason and reuses evidence", () => {
  const prompt = buildLoopPlusProtocolContinuationPrompt("缺少事件关联");
  assert.match(prompt, /Loop\+ 继续执行/);
  assert.match(prompt, /具体拒绝原因：缺少事件关联/);
  assert.match(prompt, /依据上方当前调度快照继续同一任务/);
  assert.match(prompt, /返回一个完整的决策 JSON 对象/);
  assert.match(prompt, /复用已有验收和执行证据/);
});

test("restores the reason from a persisted pause without replaying stale recovery instructions", () => {
  const reason = "缺少验收证据\n请核对构建输出";
  assert.equal(readLoopPlusProtocolFailureFromSummary(buildLoopPlusProtocolPauseSummary(reason, "continuation-rejected")), reason);
  const historical = `### 调度协议校验失败\n已自动请求纠正 2 次\n\n### 具体原因\n${reason}\n\n### 恢复条件\n历史提示`;
  assert.equal(readLoopPlusProtocolFailureFromSummary(historical), reason);
  assert.equal(readLoopPlusProtocolFailureFromSummary("其他暂停原因"), null);
});
