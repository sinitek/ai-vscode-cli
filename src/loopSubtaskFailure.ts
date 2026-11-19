import type { LoopSubtaskRecord } from "./loopTaskStore";

const DIAGNOSTIC_LIMIT = 1200;
const SECRET_ENV_KEY = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i;

export function normalizeLoopSubtaskFailure(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const secrets = Object.entries(process.env)
    .filter(([key, secret]) => SECRET_ENV_KEY.test(key) && typeof secret === "string" && secret.length >= 8)
    .map(([, secret]) => secret!)
    .sort((left, right) => right.length - left.length);
  let detail = value;
  for (const secret of secrets) detail = detail.split(secret).join("[redacted]");
  detail = detail
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b([\w-]*(?:api[_-]?key|token|secret|password|credential))(["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&"']+)/gi, "$1$2[redacted]")
    .replace(/\s+/g, " ").trim();
  return detail.length > DIAGNOSTIC_LIMIT ? `${detail.slice(0, DIAGNOSTIC_LIMIT)}…` : detail;
}

export function getLoopSubtaskFailureLines(subtasks: readonly LoopSubtaskRecord[]): string[] {
  return subtasks.flatMap(({ id, status, executionFailure }) => status === "blocked" && executionFailure
    ? [`- ${id}：${executionFailure}`]
    : []);
}

export function describeLoopSubtaskError(info: { code?: string; message: string }): string | undefined {
  const code = info.code && !info.message.includes(info.code) ? `${info.code}: ` : "";
  return normalizeLoopSubtaskFailure(`${code}${info.message}`);
}

export function appendLoopSubtaskFailureEvidence(summary: string | undefined, failures: readonly string[]): string | undefined {
  if (failures.length === 0) return summary;
  return [summary, "未解决的子任务执行错误（宿主记录）：\n" + failures.join("\n")].filter(Boolean).join("\n\n");
}
