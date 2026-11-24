export type LoopPlusNextStepPlan = {
  objective: string;
  acceptanceCriteria?: string[];
};

export function normalizeLoopPlusNextStepPlan(value: unknown): LoopPlusNextStepPlan | null {
  if (!isRecord(value)) {
    return null;
  }
  const objective = normalizeText(value.objective);
  if (!objective) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "acceptanceCriteria")) {
    return { objective };
  }
  const criteria = value.acceptanceCriteria;
  if (!Array.isArray(criteria)) {
    return null;
  }
  const acceptanceCriteria = criteria.map(normalizeText);
  if (acceptanceCriteria.some((item) => !item)) {
    return null;
  }
  return acceptanceCriteria.length > 0 ? { objective, acceptanceCriteria: acceptanceCriteria as string[] } : { objective };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
