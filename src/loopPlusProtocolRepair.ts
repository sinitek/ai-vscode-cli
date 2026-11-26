import type { LoopPlusDecisionParseResult, LoopPlusDecisionRejectionKind } from "./loopPlusDecision";
import {
  loopPlusProtocolDiagnosticHint,
  loopPlusProtocolParseDiagnostic,
  readLoopPlusProtocolDiagnostic,
  type LoopPlusProtocolDiagnostic,
} from "./loopPlusProtocolDiagnostics";

export const LOOP_PLUS_PROTOCOL_PAUSE_HEADING = "### 调度协议校验失败";
export const LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT = 3;
const PROTOCOL_REASON_HEADING = "### 具体原因";
const PROTOCOL_CODE_HEADING = "### 协议原因码";
const PROTOCOL_RESUME_HEADING = "### 恢复条件";

export function describeLoopPlusProtocolRejection(
  reason: string,
  kind: LoopPlusDecisionRejectionKind,
  diagnostic?: LoopPlusDecisionParseResult["formatDiagnostic"],
): string {
  const category = kind === "format" ? "决策 JSON 格式错误（format）"
    : kind === "state" ? "宿主状态拒绝（state）" : "决策协议校验失败（validation）";
  if (!diagnostic) return `${reason}\n拒绝类别：${category}。`;
  const position = diagnostic.position
    ? `，候选对象第 ${diagnostic.position.line} 行第 ${diagnostic.position.column} 列（从对象起始左花括号计）`
    : "";
  const hint = loopPlusProtocolDiagnosticHint(readLoopPlusProtocolDiagnostic(`format.${diagnostic.code}`, undefined, diagnostic.position));
  return `${reason}\n拒绝类别：${category}。错误代码：${diagnostic.code}${position}。${hint}`;
}

export type LoopPlusProtocolRecovery = { diagnostic: LoopPlusProtocolDiagnostic; hint: string };

export function readLoopPlusProtocolRecoveryFromSummary(summary?: string): LoopPlusProtocolRecovery | null {
  if (!summary?.startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)) return null;
  const codeStart = summary.indexOf(`\n${PROTOCOL_CODE_HEADING}\n`);
  if (codeStart >= 0) {
    const line = summary.slice(codeStart + PROTOCOL_CODE_HEADING.length + 2).split("\n", 1)[0] ?? "";
    const [reasonCode, fieldPath] = line.split("|");
    const diagnostic = readLoopPlusProtocolDiagnostic(reasonCode ?? "");
    if (diagnostic.reasonCode !== "validation.invalid_decision" || reasonCode === diagnostic.reasonCode) {
      const field = fieldPath?.startsWith("field=") ? fieldPath.slice(6) : undefined;
      return {
        diagnostic: readLoopPlusProtocolDiagnostic(diagnostic.reasonCode, field),
        hint: loopPlusProtocolDiagnosticHint(readLoopPlusProtocolDiagnostic(diagnostic.reasonCode, field)),
      };
    }
  }
  return { diagnostic: readLoopPlusProtocolDiagnostic("validation.invalid_decision"), hint: "请依据最新调度快照中的允许决策形状修正决策；保留现有事件、报告顺序与执行证据，不要重复业务操作。" };
}

export function readLoopPlusProtocolFailureFromSummary(summary?: string): string | null {
  if (!summary?.startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)) return null;
  const reasonStart = summary.indexOf(`\n${PROTOCOL_REASON_HEADING}\n`);
  const body = reasonStart < 0 ? summary.slice(LOOP_PLUS_PROTOCOL_PAUSE_HEADING.length)
    : summary.slice(reasonStart + PROTOCOL_REASON_HEADING.length + 2);
  const resumeStart = body.lastIndexOf(`\n${PROTOCOL_RESUME_HEADING}\n`);
  const reason = (resumeStart < 0 ? body : body.slice(0, resumeStart)).trim();
  return reason || "历史记录未保存具体协议错误。";
}

export function buildLoopPlusProtocolContinuationPrompt(_reason: string, recovery?: LoopPlusProtocolRecovery): string {
  const controlled = recovery ?? {
    diagnostic: readLoopPlusProtocolDiagnostic("validation.invalid_decision"),
    hint: "请依据最新调度快照修正决策，并保留现有事件、报告顺序与执行证据。",
  };
  const path = controlled.diagnostic.fieldPath ? `\n受控字段：${controlled.diagnostic.fieldPath}` : "";
  const position = controlled.diagnostic.position
    ? `\n候选对象位置：第 ${controlled.diagnostic.position.line} 行第 ${controlled.diagnostic.position.column} 列。` : "";
  return [
    "Loop+ 继续执行",
    `上一次决策被拒绝。拒绝类别：${controlled.diagnostic.rejectionKind}。原因码：${controlled.diagnostic.reasonCode}${path}`,
    position.trim(),
    `修正提示：${controlled.hint}`,
    "请依据上方当前调度快照继续同一任务，并返回一个完整的决策 JSON 对象。复用已有验收和执行证据，避免重复确认事件、重启已启动的任务或重跑已有验证。",
  ].join("\n");
}

export function buildLoopPlusProtocolPauseSummary(
  reason: string,
  outcome?: "continuation-rejected",
  diagnostic?: LoopPlusProtocolDiagnostic,
): string {
  return [
    LOOP_PLUS_PROTOCOL_PAUSE_HEADING,
    outcome === "continuation-rejected"
      ? `任务尚未完成。已自动继续执行 ${LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT} 次，主模型决策仍未通过校验。`
      : "任务尚未完成。主模型决策未通过协议或调度状态校验。",
    "",
    PROTOCOL_REASON_HEADING,
    reason,
    ...(diagnostic ? ["", PROTOCOL_CODE_HEADING,
      `${diagnostic.reasonCode}${diagnostic.fieldPath ? `|field=${diagnostic.fieldPath}` : ""}`] : []),
    "",
    PROTOCOL_RESUME_HEADING,
    "主模型需要按当前验收批次返回完整决策，确认真实验收结论，并继续派发未完成工作；只有全部要求满足完成门禁后才能完成。现有验收队列保留。",
    "可以在群聊提交针对上述原因的补充说明或点击“继续执行”重新判断，并复用已有验收和执行证据。",
  ].join("\n");
}
