import { buildLoopMainAiFailureSummary, isLoopMainAiFailureLimitReached, normalizeLoopMainAiFailureCount, type LoopMainAiFailureState } from "./loopMainFailure";
import { buildLoopBlockerSummary, LOOP_BLOCKER_EXAMPLE } from "./loopBlocker";
import { LOOP_PLUS_PROTOCOL_PAUSE_HEADING } from "./loopPlusProtocolRepair";

export const LOOP_BLOCKED_SUMMARY_INSTRUCTION = [
  "status=blocked 的 finalSummary 是直接展示给用户的熔断说明，必须用简体中文、通俗短句说明，不能只写 blocked、需要人工复核、等待外部结果或内部错误码。",
  "按以下 Markdown 小节组织：### 当前结论；### 熔断原因与未完成事项；### 继续前需要解决的事项。",
  "当前结论说明子任务多次尝试仍无法解决问题，触发熔断，整体任务尚未完成；再说明问题能否恢复，或有事实依据表明按当前要求无法完成。信息不足就明确不能判断，不把暂时缺权限、资料或环境说成永远不可能，不编造尝试次数或结果。",
  "原因逐项对应未完成的用户要求，说明卡在哪一步、为什么无法继续和已知证据；涉及错误码时先用人话解释含义，再保留必要的原始证据。不要编造检查结果。",
  "blocked 必须包含 blocker 诊断对象：kind=recoverable 或 impossible；cause 为具体卡点及因果解释；affectedRequirements、evidence、attempts 都是非空字符串数组，分别列未完成要求、实际证据、已尝试动作与结果。没有尝试须说明原因，证据不足须明确未知，不能声称已验证。宿主根据该对象统一生成 finalSummary，不能只写一句话或只提供 Markdown。",
  "blocker.nextSteps 是按推荐顺序排列的步骤数组，每项必须有 owner（谁处理）、action（具体操作）、verification（确认方法）；recoverable 时至少一步且必须提供 resumeCondition（可续跑的明确条件）。impossible 必须提供 alternatives，说明可行替代方案、需调整的约束，或无可行路径的依据，nextSteps 可为空。所有说明用简体中文。",
  "在判定熔断前，先根据已有证据判断能否在现有授权内安全修复、使用项目已有工具或推进独立剩余工作。能自行处理的继续执行或派发修复子任务；确需用户选择、授权或补充需求时优先 clarify。不得因单个检查失败就结束整体任务，也不得降低验收要求、绕过权限或无限重试。经典 Loop 根据子任务报告判断，缺证据先续接来源子任务补说明，不要求主模型自行验收。",
  "遇到缺软件、版本不兼容、配置/权限、网络/外部服务、缺资料等情况，cause 明确缺什么及阻碍哪一步，evidence 保留必要的命令、错误和实际运行环境。缺软件需区分未安装、PATH 不可见与版本不符，标明具体软件/包/所需版本（未知就说明）以及 Windows/macOS/Linux、本机/远程/容器等已知环境。不要猜测操作系统。",
  "nextSteps 给出基于现有证据的首选解决方案及选择理由，必要时再给备选；涉及环境依赖时给适用于已确认平台和包管理器的可执行安装/配置命令或官方安装入口，说明执行位置、是否需用户授权，以及验证命令和预期结果。不得默认已有 brew、winget、sudo 等工具或权限，不自动做超出授权的全局安装，不编造包名、下载链接或检查结果。",
  "恢复检查必须在实际执行任务的同一环境中进行，包括扩展宿主、远程环境或容器；终端可用不代表插件可见。仅在确有需要时说明刷新 PATH、重启终端或重载窗口的步骤，继续后先确认阻塞解除并只补未完成项，复用仍有效结果。",
  "可以恢复时，用编号列出前置条件：谁需要提供什么、执行什么操作、如何确认条件已满足；区分模型可自行处理和确需用户或外部人员处理的事情，不把模型可解决的问题推给用户。最后说明条件满足后，在群聊点击“继续执行”或提交补充需求，主模型将重新判断；仅点击继续不会解决触发熔断的问题。",
  "确实无法完成时，当前结论明确写“按当前要求无法完成”，解释无法满足的要求及不可消除的限制；最后一节改为 ### 可行替代方案，说明必须调整哪些要求或约束，以及可交付的替代结果。没有可行替代就如实说明，不附带无效的继续执行指引，不承诺重试即可成功。",
].join("\n");

export const LOOP_BLOCKED_SUMMARY_EXAMPLE = buildLoopBlockerSummary(LOOP_BLOCKER_EXAMPLE);

export function normalizeLoopBlockedSummary(summary: string | null | undefined): string {
  return summary?.trim() || [
    "### 当前结论",
    "任务已熔断，整体任务尚未完成；现有信息不足，无法判断问题能否恢复，或是否按当前要求无法完成。",
    "",
    "### 熔断原因与未完成事项",
    "主模型未提供具体熔断原因、依据和未完成事项，不能凭空判断。",
    "",
    "### 继续前需要解决的事项",
    "请通过“向主模型提问”要求说明卡在哪一步、为什么无法继续、谁需要做什么，以及满足哪些条件后才能继续。在原因和条件明确前，不建议反复点击“继续执行”。",
  ].join("\n");
}

export function buildLoopBlockedPauseText(task: {
  schedulingMode?: string;
  finalSummary?: string | null;
} & LoopMainAiFailureState): string {
  const mode = task.schedulingMode === "event_driven" ? "Loop+" : "Loop";
  const executionFailure = isLoopMainAiFailureLimitReached(task)
    || normalizeLoopMainAiFailureCount(task.mainAiFailureCount) > 0
    || task.finalSummary?.trim().startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)
    || task.finalSummary?.trim() === "Main task did not return a valid loop decision JSON.";
  const headline = executionFailure
    ? `${mode} 已暂停，整体任务尚未完成。`
    : `${mode} 已熔断：子任务多次尝试仍无法解决问题，整体任务尚未完成。`;
  return `${headline}\n\n${resolveLoopNeedsReviewSummary(task)}`;
}

export function resolveLoopNeedsReviewSummary(task: LoopMainAiFailureState & { finalSummary?: string | null }): string {
  return isLoopMainAiFailureLimitReached(task)
    ? buildLoopMainAiFailureSummary(task)
    : normalizeLoopBlockedSummary(task.finalSummary);
}
