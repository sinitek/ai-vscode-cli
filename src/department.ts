import { CLI_LIST, type CliName, type ThinkingMode } from "./cli/types";
import { normalizeDepartmentMaxLeaders } from "./departmentSettings";
import { normalizeRouteThinkingMode, parseCliNameField } from "./subtaskCliRoute";

export type DepartmentRole = "director" | "leader" | "employee";

export function getDepartmentLeaderCode(leaderNumber: number, maxLeaders: number): string {
  let slot = (leaderNumber - 1) % normalizeDepartmentMaxLeaders(maxLeaders) + 1;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  while (slot > 0) {
    code = alphabet[(slot - 1) % alphabet.length] + code;
    slot = Math.floor((slot - 1) / alphabet.length);
  }
  return code;
}

export function formatDepartmentLeaderLabel(leaderCode = ""): string {
  return `组长${leaderCode}`;
}

export function formatDepartmentMemberTitle(role: DepartmentRole, title: string, leaderCode = "", employeeNumber?: number): string {
  if (role === "director") return "总监";
  if (role === "leader") return `${formatDepartmentLeaderLabel(leaderCode)} · ${title}`;
  const label = employeeNumber === undefined ? "员工" : `员工 ${leaderCode}${employeeNumber}`;
  return `${label} · ${title}`;
}
/** Department roles reuse the same CLI capabilities as Loop and Loop+. */
export const DEPARTMENT_EXECUTION_CLIS = CLI_LIST;
export const DEPARTMENT_EXECUTION_CLI_REQUIREMENT = "请选择已启用且配置有效的 CLI。";
export function isDepartmentExecutionCli(cli: unknown): cli is typeof DEPARTMENT_EXECUTION_CLIS[number] {
  return (DEPARTMENT_EXECUTION_CLIS as readonly unknown[]).includes(cli);
}
export function departmentRoleCliIssue(role: DepartmentRole, cli: unknown): string | null {
  if (role === "director" || isDepartmentExecutionCli(cli)) return null;
  const label = role === "leader" ? "组长" : "员工";
  return `${label}所选 CLI（${typeof cli === "string" ? cli : "未选择"}）暂不支持。${DEPARTMENT_EXECUTION_CLI_REQUIREMENT}`;
}
export type DepartmentRoleRoute = {
  cli?: CliName;
  configId?: string;
  model?: string;
  fallback?: string;
  thinkingMode?: ThinkingMode;
  openCodeVariant?: string;
};
export type DepartmentMetadata = {
  version: 1;
  rootTaskId: string;
  parentTaskId: string | null;
  leaderSubtaskId: string | null;
  role: DepartmentRole;
  moduleTitle: string;
  routes: { director: DepartmentRoleRoute; leader: DepartmentRoleRoute; employee: DepartmentRoleRoute };
  limits: { maxLeaders: number; maxEmployees: number };
};

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown, allowEmpty = false): v is string => typeof v === "string" && (allowEmpty || Boolean(v.trim()));

function route(v: unknown): DepartmentRoleRoute | null {
  if (!object(v)) return null;
  let cli: CliName | undefined;
  if (Object.prototype.hasOwnProperty.call(v, "cli") && v.cli !== undefined) {
    if (typeof v.cli !== "string") return null;
    const parsed = parseCliNameField(v.cli);
    if (!parsed.ok || !parsed.cli || !(CLI_LIST as readonly string[]).includes(parsed.cli)) return null;
    cli = parsed.cli;
  }
  for (const key of ["configId", "model", "fallback", "openCodeVariant"] as const) {
    if (v[key] !== undefined && !text(v[key])) return null;
  }
  let thinkingMode: ThinkingMode | undefined;
  if (Object.prototype.hasOwnProperty.call(v, "thinkingMode") && v.thinkingMode !== undefined) {
    if (typeof v.thinkingMode !== "string") return null;
    thinkingMode = normalizeRouteThinkingMode(v.thinkingMode);
    if (!thinkingMode) return null;
  }
  return {
    ...(cli ? { cli } : {}),
    ...(text(v.configId) ? { configId: v.configId.trim() } : {}),
    ...(text(v.model) ? { model: v.model.trim() } : {}),
    ...(text(v.fallback) ? { fallback: v.fallback.trim() } : {}),
    ...(thinkingMode ? { thinkingMode } : {}),
    ...(text(v.openCodeVariant) ? { openCodeVariant: v.openCodeVariant.trim() } : {}),
  };
}

export function normalizeDepartmentMetadata(value: unknown): DepartmentMetadata | null {
  if (!object(value) || value.version !== 1 || !text(value.rootTaskId) || !text(value.moduleTitle)) return null;
  if (!(value.parentTaskId === null || text(value.parentTaskId)) || !(value.leaderSubtaskId === null || text(value.leaderSubtaskId))) return null;
  if (!(value.role === "director" || value.role === "leader" || value.role === "employee")) return null;
  if (!object(value.routes) || !object(value.limits)) return null;
  const director = route(value.routes.director), leader = route(value.routes.leader), employee = route(value.routes.employee);
  const { maxLeaders, maxEmployees } = value.limits;
  if (!director || !leader || !employee || !Number.isSafeInteger(maxLeaders) || !Number.isSafeInteger(maxEmployees)
    || (maxLeaders as number) < 0 || (maxEmployees as number) < 0) return null;
  return { version: 1, rootTaskId: value.rootTaskId.trim(), parentTaskId: value.parentTaskId === null ? null : value.parentTaskId.trim(),
    leaderSubtaskId: value.leaderSubtaskId === null ? null : value.leaderSubtaskId.trim(), role: value.role,
    moduleTitle: value.moduleTitle.trim(), routes: { director, leader, employee }, limits: { maxLeaders: maxLeaders as number, maxEmployees: maxEmployees as number } };
}

export function readDepartmentMetadataField(value: unknown, previouslyInvalid = false): { metadata?: DepartmentMetadata; invalid: boolean } {
  if (value === undefined) return { invalid: previouslyInvalid };
  const metadata = normalizeDepartmentMetadata(value);
  return metadata ? { metadata, invalid: false } : { invalid: true };
}
