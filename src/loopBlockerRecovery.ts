import { randomUUID } from "crypto";
import type { LoopBlocker } from "./loopBlocker";
import {
  formatOrchestratorClarificationAnswer,
  LOOP_RECOVERY_PLAN_FIELD,
  type OrchestratorClarification,
} from "./orchestratorClarification";

export function buildLoopBlockerRecoveryClarification(
  blocker: LoopBlocker | undefined,
  previousAnswers: readonly string[] = [],
): OrchestratorClarification | undefined {
  if (blocker?.kind !== "recoverable" || !blocker.recoveryOptions?.length) return undefined;
  const options = blocker.recoveryOptions.map((option, index) => ({
    label: option.label,
    value: String(index + 1),
    description: `处理：${option.action}\n验证：${option.verification}`,
  }));
  const field = { id: LOOP_RECOVERY_PLAN_FIELD, label: "恢复方案", type: "radio" as const, required: true, options };
  const available = options.filter((option) => ![false, true].some((timedOut) => previousAnswers.includes(
    formatOrchestratorClarificationAnswer({ interactionId: "", status: "completed", timedOut,
      values: { [field.id]: option.value } }, [field]),
  )));
  const recommended = available[0];
  if (!recommended) return undefined;
  return {
    interactionId: `loop-recovery-${randomUUID()}`,
    title: "选择任务恢复方案",
    instruction: `当前卡点：${blocker.cause.slice(0, 500)}\n超时未答复时采用推荐方案「${recommended.label}」，仅在现有授权内执行并验证。`,
    formFields: [{ ...field, defaultValue: recommended.value, options: available }],
    submitLabel: "采用所选方案",
    cancelLabel: "暂停任务",
  };
}
