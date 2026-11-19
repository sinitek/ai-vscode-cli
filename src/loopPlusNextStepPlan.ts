export const LOOP_PLUS_NEXT_STEP_OBJECTIVE_MAX_LENGTH = 240;
export const LOOP_PLUS_NEXT_STEP_CRITERIA_MAX_COUNT = 3;
export const LOOP_PLUS_NEXT_STEP_CRITERION_MAX_LENGTH = 120;

export type LoopPlusNextStepPlan = {
  objective: string;
  acceptanceCriteria?: string[];
};

export function normalizeLoopPlusNextStepPlan(value: unknown): LoopPlusNextStepPlan | null {
  if (!isRecord(value)) {
    return null;
  }
  const objective = normalizeText(value.objective, LOOP_PLUS_NEXT_STEP_OBJECTIVE_MAX_LENGTH);
  if (!objective) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "acceptanceCriteria")) {
    return { objective };
  }
  const criteria = value.acceptanceCriteria;
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > LOOP_PLUS_NEXT_STEP_CRITERIA_MAX_COUNT) {
    return null;
  }
  const acceptanceCriteria = criteria.map((item) => normalizeText(item, LOOP_PLUS_NEXT_STEP_CRITERION_MAX_LENGTH));
  if (acceptanceCriteria.some((item) => !item)) {
    return null;
  }
  return { objective, acceptanceCriteria: acceptanceCriteria as string[] };
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
