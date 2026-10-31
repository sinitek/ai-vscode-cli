/**
 * Loop+ 子任务模式。全仓库只使用这一个枚举：
 * fullstack 表示所有编码走子-全栈；split 表示前端与后端分派。
 * 不另建互相竞争的布尔开关。
 */
export const LOOP_SUBTASK_MODES = ["fullstack", "split"] as const;

export type LoopSubtaskMode = (typeof LOOP_SUBTASK_MODES)[number];

export type LoopSubtaskRouteIdentity = {
  cli?: unknown;
  configId?: unknown;
  model?: unknown;
  fallback?: unknown;
};

/**
 * 空值或缺字段返回 undefined，调用方按兼容规则解析。
 * 非字符串，或非空但不是 fullstack/split，返回 null，调用方必须拒绝。
 */
export function readLoopSubtaskModeField(value: unknown): LoopSubtaskMode | undefined | null {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed === "fullstack" || trimmed === "split" ? trimmed : null;
}

export function loopSubtaskRouteHasIdentity(route: LoopSubtaskRouteIdentity | null | undefined): boolean {
  if (!route || typeof route !== "object") {
    return false;
  }
  return [route.cli, route.configId, route.model, route.fallback].some((value) => (
    typeof value === "string" && value.trim().length > 0
  ));
}

/**
 * 任务记录上的模式快照。
 * - 显式 fullstack / split 优先，不受之后的输入区切换影响。
 * - 非法非空值返回 null，不得猜成另一种模式。
 * - 没有模式、但已保存独立前端子路由时，保留拆分语义。
 * - 没有模式、也没有独立前端子路由时，视为 fullstack，编码沿用原子模型（子-后端槽）。
 */
export function resolveStoredLoopSubtaskMode(input: {
  loopSubtaskMode?: unknown;
  loopSubtaskModeInvalid?: boolean;
  frontendRoute?: LoopSubtaskRouteIdentity | null;
}): LoopSubtaskMode | null {
  if (input.loopSubtaskModeInvalid) {
    return null;
  }
  const explicit = readLoopSubtaskModeField(input.loopSubtaskMode);
  if (explicit === null) {
    return null;
  }
  if (explicit) {
    return explicit;
  }
  if (loopSubtaskRouteHasIdentity(input.frontendRoute)) {
    return "split";
  }
  return "fullstack";
}
