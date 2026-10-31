import { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "../loopPlusAcceptancePlan";

type AcceptRecord = Record<string, unknown>;

export function loopPlusAcceptanceChecksFixture() {
  return LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.map((name) => ({
    name,
    passed: true,
    detail: "已按测试夹具证据完成检查",
  }));
}

function isRecord(value: unknown): value is AcceptRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function eventIds(value: AcceptRecord): string[] {
  if (Array.isArray(value.reviewEventIds)) {
    return value.reviewEventIds
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value.reviewEventId === "string" && value.reviewEventId.trim()) {
    return [value.reviewEventId.trim()];
  }
  return [];
}

function subtaskId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }
  const id = value.id.trim();
  return id || undefined;
}

export function withLoopPlusAcceptReviews<T>(value: T): T {
  if (!isRecord(value) || (value.status !== "accept" && value.status !== "completed")) {
    return value;
  }
  const next: AcceptRecord = { ...value };
  if (value.status === "accept" && !Object.prototype.hasOwnProperty.call(value, "reviews")) {
    const ids = eventIds(value);
    if (ids.length > 0) {
      const subtasks = Array.isArray(value.subtasks) ? value.subtasks : [];
      const linked = subtasks.map(subtaskId).filter((id): id is string => Boolean(id));
      next.reviews = ids.map((reviewEventId, index) => {
        const subtaskIds = index === ids.length - 1 ? linked : [];
        return {
          reviewEventId,
          acceptance: subtaskIds.length > 0 ? "failed" : "passed",
          reason: subtaskIds.length > 0 ? "需要修复失败项" : "实现与证据均符合要求",
          ...(subtaskIds.length > 0 ? { subtaskIds } : {}),
        };
      });
    }
  } else if (value.status === "accept" && Array.isArray(next.reviews)) {
    next.reviews = next.reviews.map((review) => isRecord(review)
      ? { ...review, reason: typeof review.reason === "string" ? review.reason : "实现与证据均符合要求" }
      : review);
  }
  if (!Object.prototype.hasOwnProperty.call(next, "acceptance")) {
    next.acceptance = {
      passed: true,
      checks: loopPlusAcceptanceChecksFixture(),
    };
  }
  return next as T;
}
