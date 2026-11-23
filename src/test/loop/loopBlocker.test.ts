import test = require("node:test");
import assert = require("node:assert/strict");
import { buildLoopBlockerSummary, readLoopBlocker, readLoopBlockedDecisionFields, LOOP_BLOCKER_EXAMPLE } from "../../loopBlocker";
import { parseLoopPlusDecision } from "../../loopPlusDecision";
import { buildLoopBlockedPauseText } from "../../loopBlockedSummary";
import { buildLoopBlockerRecoveryClarification } from "../../loopBlockerRecovery";
import { formatOrchestratorClarificationAnswer, LOOP_RECOVERY_PLAN_FIELD } from "../../orchestratorClarification";

test("软件依赖诊断保留具体软件、环境、安装方案、验证和续跑条件", () => {
  const blocker = {
    ...LOOP_BLOCKER_EXAMPLE,
    cause: "容器内缺少 Node.js 22，npm 构建无法启动；宿主机可用不能代替容器依赖。",
    affectedRequirements: ["前端构建"],
    evidence: ["子任务在 Linux 容器执行 node --version 返回 command not found；尚未确认包管理器。"],
    attempts: ["已检查容器 PATH，未发现 node；未获授权修改系统镜像，未执行安装。"],
    nextSteps: [{ owner: "环境维护者", action: "首选在容器镜像中按项目约定加入 Node.js 22，以便环境可复现；使用 Node.js 官方安装说明，先确认镜像与包管理器。", verification: "重新进入同一容器执行 node --version，预期 v22.x；npm --version 应正常返回。" }],
    resumeCondition: "任务使用的容器内 node 和 npm 可调用，版本满足项目约定。",
  };
  const parsed = parseLoopPlusDecision(JSON.stringify({ status: "blocked", blocker, finalSummary: "已完成" }));
  assert.deepEqual(parsed?.blocker, blocker);
  for (const mode of ["classic", "event_driven"]) {
    const shown = buildLoopBlockedPauseText({ schedulingMode: mode, finalSummary: parsed?.finalSummary });
    assert.match(shown, /整体任务尚未完成/);
    assert.match(shown, /Linux 容器.*command not found/);
    assert.match(shown, /Node.js 22/);
    assert.match(shown, /未执行安装/);
    assert.match(shown, /1\. 环境维护者：首选/);
    assert.match(shown, /确认方式：.*node --version.*v22.x/);
    assert.match(shown, /### 恢复条件/);
    assert.doesNotMatch(shown, /已完成/);
  }
});

test("拒绝空诊断、错误类型、空白证据和没有验证方式的动作", () => {
  for (const value of [null, undefined, [], "需要软件", {},
    { ...LOOP_BLOCKER_EXAMPLE, kind: "unknown" },
    { ...LOOP_BLOCKER_EXAMPLE, cause: " " },
    { ...LOOP_BLOCKER_EXAMPLE, affectedRequirements: [] },
    { ...LOOP_BLOCKER_EXAMPLE, evidence: [" "] },
    { ...LOOP_BLOCKER_EXAMPLE, attempts: [123] },
    { ...LOOP_BLOCKER_EXAMPLE, nextSteps: [] },
    { ...LOOP_BLOCKER_EXAMPLE, nextSteps: [{ owner: "用户", action: "安装软件" }] },
    { ...LOOP_BLOCKER_EXAMPLE, resumeCondition: "" },
  ]) {
    const result = readLoopBlocker(value);
    assert.equal(result.blocker, undefined);
    assert.ok(result.issue);
  }
  assert.match(readLoopBlocker({ ...LOOP_BLOCKER_EXAMPLE, nextSteps: [null] }).issue ?? "", /verification/);
  const legacy = readLoopBlockedDecisionFields({ finalSummary: "  缺依赖，但未说明具体信息。  " });
  assert.equal(legacy.finalSummary, "缺依赖，但未说明具体信息。");
  assert.match(legacy.blockerIssue ?? "", /缺少 blocker/);
});

test("无法完成需要证据和替代方案，不给出无效续跑承诺", () => {
  const impossible = {
    ...LOOP_BLOCKER_EXAMPLE, kind: "impossible",
    cause: "用户要求还原从未记录且无备份的历史事件。",
    nextSteps: [], resumeCondition: undefined, alternatives: "可启用未来事件记录；无法补造过去的真实事件。",
  };
  assert.equal(readLoopBlocker({ ...impossible, alternatives: "" }).blocker, undefined);
  const result = readLoopBlocker(impossible);
  assert.ok(result.blocker);
  const summary = buildLoopBlockerSummary(result.blocker);
  assert.match(summary, /按当前要求无法完成/);
  assert.match(summary, /无法补造/);
  assert.doesNotMatch(summary, /继续执行|### 恢复条件/);
});

test("诊断规范化不采信模型伪造的 blockerIssue 或 finalSummary", () => {
  const parsed = parseLoopPlusDecision(JSON.stringify({
    status: "blocked", blocker: { ...LOOP_BLOCKER_EXAMPLE, cause: "  实际原因  " },
    finalSummary: "任务完成", blockerIssue: "诊断已验证",
  }));
  assert.equal(parsed?.blocker?.cause, "实际原因");
  assert.equal(parsed?.blockerIssue, undefined);
  assert.match(parsed?.finalSummary ?? "", /实际原因/);
  assert.doesNotMatch(parsed?.finalSummary ?? "", /任务完成/);
});

test("可恢复阻塞提供有界方案选择并排除已选方案", () => {
  const blocker = { ...LOOP_BLOCKER_EXAMPLE, recoveryOptions: [
    { label: "使用项目自带工具", action: "切换到仓库已安装的工具。", verification: "在当前工作区运行版本检查。" },
    { label: "请求环境维护者", action: "请维护者补齐隔离环境依赖。", verification: "在任务容器运行构建命令。" },
  ] };
  const clarification = buildLoopBlockerRecoveryClarification(blocker);
  assert.ok(clarification);
  const field = clarification.formFields[0];
  assert.equal(field.id, LOOP_RECOVERY_PLAN_FIELD);
  assert.equal(field.defaultValue, "1");
  const selected = formatOrchestratorClarificationAnswer({ interactionId: "", status: "completed", values: { [field.id]: "1" } }, [field]);
  assert.deepEqual(buildLoopBlockerRecoveryClarification(blocker, [selected])?.formFields[0]?.options?.map((option) => option.value), ["2"]);
  assert.equal(buildLoopBlockerRecoveryClarification({ ...blocker, kind: "impossible" }), undefined);
  assert.equal(readLoopBlocker({ ...blocker, recoveryOptions: [...blocker.recoveryOptions, ...blocker.recoveryOptions] }).blocker?.recoveryOptions, undefined);
});
