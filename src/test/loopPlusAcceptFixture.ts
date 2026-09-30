type AcceptRecord = Record<string, unknown>;

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
  if (!isRecord(value) || value.status !== "accept" || Object.prototype.hasOwnProperty.call(value, "reviews")) {
    return value;
  }
  const ids = eventIds(value);
  if (ids.length === 0) {
    return value;
  }
  const subtasks = Array.isArray(value.subtasks) ? value.subtasks : [];
  const linked = subtasks.map(subtaskId).filter((id): id is string => Boolean(id));
  const reviews = ids.map((reviewEventId, index) => {
    const subtaskIds = index === ids.length - 1 ? linked : [];
    return {
      reviewEventId,
      acceptance: subtaskIds.length > 0 ? "failed" : "passed",
      ...(subtaskIds.length > 0 ? { subtaskIds } : {}),
    };
  });
  return { ...value, reviews } as T;
}
