import { LOOP_BLOCKER_EXAMPLE, type LoopBlocker } from "../loopBlocker";

export function loopBlockerFixture(cause?: string): LoopBlocker {
  return { ...LOOP_BLOCKER_EXAMPLE, cause: cause?.trim() || "测试场景：外部接口约定待确认。" };
}

/** 调度测试默认提供完整诊断；blocker:null 显式模拟模型漏报。 */
export function withLoopBlockerFixture(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    if (raw.status === "blocked" && !Object.prototype.hasOwnProperty.call(raw, "blocker")) {
      return { ...raw, blocker: loopBlockerFixture(typeof raw.finalSummary === "string" ? raw.finalSummary : undefined) };
    }
  }
  return value;
}
