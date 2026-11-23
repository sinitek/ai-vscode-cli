/** 主模型报告的诊断；字段完整不代表宿主已验证其真实性。 */
export type LoopBlocker = {
  kind: "recoverable" | "impossible";
  cause: string;
  affectedRequirements: string[];
  evidence: string[];
  attempts: string[];
  nextSteps: Array<{ owner: string; action: string; verification: string }>;
  recoveryOptions?: LoopBlockerRecoveryOption[];
  resumeCondition?: string;
  alternatives?: string;
};

type LoopBlockerRecoveryOption = { label: string; action: string; verification: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function textList(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((item) => text(item))
    ? value.map((item) => (item as string).trim()) : null;
}

export function readLoopBlocker(value: unknown): { blocker?: LoopBlocker; issue?: string } {
  const raw = record(value);
  if (!raw) {
    return { issue: "blocked 缺少 blocker 诊断对象，不能只提供一句 finalSummary。" };
  }
  const issues: string[] = [];
  const kind = raw.kind;
  if (kind !== "recoverable" && kind !== "impossible") issues.push("kind 必须是 recoverable 或 impossible");
  const cause = text(raw.cause);
  if (!cause) issues.push("cause 必须解释具体卡点及为什么不能继续");
  const affectedRequirements = textList(raw.affectedRequirements);
  if (!affectedRequirements) issues.push("affectedRequirements 必须列出未完成要求");
  const evidence = textList(raw.evidence);
  if (!evidence) issues.push("evidence 必须列出实际证据或明确尚缺哪项证据");
  const attempts = textList(raw.attempts);
  if (!attempts) issues.push("attempts 必须列出已尝试动作与结果，未尝试须说明原因");
  const nextSteps: LoopBlocker["nextSteps"] = [];
  if (!Array.isArray(raw.nextSteps) || (kind === "recoverable" && raw.nextSteps.length === 0)) {
    issues.push("nextSteps 必须按推荐顺序列出解决步骤");
  } else {
    for (const value of raw.nextSteps) {
      const step = record(value);
      const owner = text(step?.owner);
      const action = text(step?.action);
      const verification = text(step?.verification);
      if (!owner || !action || !verification) {
        issues.push("nextSteps 每步必须包含 owner、action 和 verification");
        break;
      }
      nextSteps.push({ owner, action, verification });
    }
  }
  const resumeCondition = text(raw.resumeCondition);
  const alternatives = text(raw.alternatives);
  const recoveryOptions = kind === "recoverable" ? readRecoveryOptions(raw.recoveryOptions) : undefined;
  if (kind === "recoverable" && !resumeCondition) issues.push("resumeCondition 必须说明什么结果满足后可继续");
  if (kind === "impossible" && !alternatives) issues.push("alternatives 必须说明可行替代方案或无可行路径的依据");
  if (issues.length > 0) return { issue: `blocker 诊断不完整：${issues.join("；")}。` };
  return {
    blocker: {
      kind: kind as LoopBlocker["kind"], cause: cause!, affectedRequirements: affectedRequirements!,
      evidence: evidence!, attempts: attempts!, nextSteps,
      ...(recoveryOptions ? { recoveryOptions } : {}),
      ...(resumeCondition ? { resumeCondition } : {}), ...(alternatives ? { alternatives } : {}),
    },
  };
}

function readRecoveryOptions(value: unknown): LoopBlockerRecoveryOption[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return undefined;
  const options: LoopBlockerRecoveryOption[] = [];
  for (const candidate of value) {
    const raw = record(candidate);
    const label = text(raw?.label);
    const action = text(raw?.action);
    const verification = text(raw?.verification);
    if (!label || label.length > 80 || !action || action.length > 500 || !verification || verification.length > 300
      || options.some((option) => option.label === label || option.action === action)) return undefined;
    options.push({ label, action, verification });
  }
  return options;
}

const LOOP_BLOCKER_SUMMARY_HEADER = "### 当前结论\n子任务多次尝试仍无法解决问题，触发熔断；整体任务尚未完成。";

export function isLoopBlockerSummary(summary: string | undefined): boolean {
  return summary?.startsWith(`${LOOP_BLOCKER_SUMMARY_HEADER}\n`) === true;
}

export function buildLoopBlockerSummary(blocker: LoopBlocker): string {
  return [
    LOOP_BLOCKER_SUMMARY_HEADER,
    ...(blocker.kind === "impossible" ? ["按当前要求无法完成。"] : []),
    "", "### 熔断原因与未完成事项", blocker.cause,
    ...blocker.affectedRequirements.map((item) => `- 未完成：${item}`),
    "", "### 已知证据", ...blocker.evidence.map((item) => `- ${item}`),
    "", "### 已尝试的处理", ...blocker.attempts.map((item) => `- ${item}`),
    ...(blocker.nextSteps.length > 0 ? [
      "", "### 继续前需要解决的事项",
      "优先采用以下方案，按顺序处理：",
      ...blocker.nextSteps.map((step, index) => `${index + 1}. ${step.owner}：${step.action}\n\n   确认方式：${step.verification}`),
    ] : []),
    ...(blocker.kind === "recoverable" ? [
      "", "### 恢复条件", blocker.resumeCondition!,
      "条件满足后，在群聊点击“继续执行”或提交补充需求，主模型将重新判断并续跑未完成事项；仅点击继续不会解决触发熔断的问题。",
    ] : ["", "### 可行替代方案", blocker.alternatives!]),
  ].join("\n");
}

export function readLoopBlockedDecisionFields(raw: { blocker?: unknown; finalSummary?: unknown }): {
  blocker?: LoopBlocker; blockerIssue?: string; finalSummary?: string;
} {
  const { blocker, issue } = readLoopBlocker(raw.blocker);
  return blocker
    ? { blocker, finalSummary: buildLoopBlockerSummary(blocker) }
    : { blockerIssue: issue, finalSummary: text(raw.finalSummary) };
}

export function buildLoopBlockerDiagnosticFailure(summary?: string, issue?: string): string {
  return [
    "### 熔断诊断未补齐",
    "整体任务尚未完成。已自动请求主模型补充诊断，但仍未得到完整说明；以下信息不足以确定根因或最佳方案。",
    issue ?? "缺少具体原因、证据、已尝试动作、解决步骤及恢复条件。",
    "", "### 主模型原说明（尚未核实）", summary?.trim() || "主模型未提供具体熔断原因。",
    "", "### 下一步",
    "可通过“向主模型提问”要求补齐上述缺项，或提交已有错误输出、运行环境等补充信息后点击“继续执行”。无需替主模型猜测原因，也不要盲目安装软件或反复重试。",
  ].join("\n");
}

export const LOOP_BLOCKER_EXAMPLE: LoopBlocker = {
  kind: "recoverable",
  cause: "接口联调缺少已确认的请求字段，继续实现会猜测接口行为。",
  affectedRequirements: ["接口联调及用户要求的联调验证"],
  evidence: ["子任务报告指出现有接口文档未定义必填字段；尚缺接口负责人确认。"],
  attempts: ["已查阅现有接口文档，无法从中确定缺失字段；不能自行编造约定。"],
  nextSteps: [{ owner: "接口负责人", action: "提供已确认的请求、响应字段及测试方式。", verification: "主模型根据资料核对缺项，由子任务继续联调并汇报结果。" }],
  resumeCondition: "已确认的接口约定覆盖本次联调所需字段，并有可用的测试方式。",
};
