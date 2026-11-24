export const LOOP_PLUS_PROTOCOL_PAUSE_HEADING = "### 调度协议校验失败";
const PROTOCOL_REASON_HEADING = "### 具体原因";
const PROTOCOL_RESUME_HEADING = "### 恢复条件";

export function readLoopPlusProtocolFailureFromSummary(summary?: string): string | null {
  if (!summary?.startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)) return null;
  const reasonStart = summary.indexOf(`\n${PROTOCOL_REASON_HEADING}\n`);
  const body = reasonStart < 0 ? summary.slice(LOOP_PLUS_PROTOCOL_PAUSE_HEADING.length)
    : summary.slice(reasonStart + PROTOCOL_REASON_HEADING.length + 2);
  const resumeStart = body.lastIndexOf(`\n${PROTOCOL_RESUME_HEADING}\n`);
  const reason = (resumeStart < 0 ? body : body.slice(0, resumeStart)).trim();
  return reason || "历史记录未保存具体协议错误。";
}

export function buildLoopPlusProtocolContinuationPrompt(reason: string): string {
  return [
    "Loop+ 继续执行",
    `上一次决策被拒绝。具体拒绝原因：${reason}`,
    "请依据上方当前调度快照继续同一任务，并返回一个完整的决策 JSON 对象。复用已有验收和执行证据，避免重复确认事件、重启已启动的任务或重跑已有验证。",
  ].join("\n");
}

export function buildLoopPlusProtocolPauseSummary(reason: string, outcome?: "continuation-rejected"): string {
  return [
    LOOP_PLUS_PROTOCOL_PAUSE_HEADING,
    outcome === "continuation-rejected"
      ? "任务尚未完成。主模型决策未通过校验，已自动继续执行一次，续跑后的决策仍未通过校验。"
      : "任务尚未完成。主模型决策未通过协议或调度状态校验。",
    "",
    PROTOCOL_REASON_HEADING,
    reason,
    "",
    PROTOCOL_RESUME_HEADING,
    "主模型需要按当前验收批次返回合法 JSON，确认真实验收结论，并继续派发未完成工作；只有全部要求满足完成门禁后才能完成。现有验收队列保留。",
    "可以在群聊提交针对上述原因的补充说明或点击“继续执行”重新判断，无需为协议格式问题重复完成业务工作。",
  ].join("\n");
}
