import assert = require("node:assert/strict");
import test = require("node:test");
import { buildLoopFinalSummaryMarkdown } from "../../loopFinalSummary";

test("classic report-driven completion never invents acceptance or empty coverage sections", () => {
  for (const schedulingMode of [undefined, "classic"] as const) {
    const markdown = buildLoopFinalSummaryMarkdown({ id: "classic", schedulingMode }, {
      finalSummary: "子任务汇报完成；项目规则要求的测试由独立子任务执行并汇报通过。",
    });
    assert.match(markdown, /完成依据：子任务汇报（未进行主模型验收）/u);
    assert.match(markdown, /## 问题回答结论/u);
    assert.match(markdown, /## 整体任务总结/u);
    assert.match(markdown, /独立子任务执行并汇报通过/u);
    assert.doesNotMatch(markdown, /验收状态：通过|## 验收结果|无可用的需求覆盖项|无可用的子任务摘要/u);
  }
});

test("Loop+ retains its existing final summary acceptance and coverage sections", () => {
  const markdown = buildLoopFinalSummaryMarkdown({ id: "plus", schedulingMode: "event_driven" }, {
    finalSummary: "原有 Loop+ 总结",
  });
  assert.match(markdown, /验收状态：通过/u);
  assert.match(markdown, /## 子任务完成摘要/u);
  assert.match(markdown, /## 验收结果/u);
  assert.match(markdown, /## 用户需求覆盖/u);
});
