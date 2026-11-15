export const DEPARTMENT_MAX_LEADERS_DEFAULT = 4;
export const DEPARTMENT_MAX_EMPLOYEES_DEFAULT = 20;

/** Closure-free so the exact host rule can be embedded in the Webview runtime. */
export function normalizeDepartmentCapacity(value: unknown, fallback: number): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  const integer = Math.floor(numeric);
  return Number.isSafeInteger(integer) && integer > 0 ? integer : fallback;
}

export function normalizeDepartmentMaxLeaders(value: unknown): number {
  return normalizeDepartmentCapacity(value, DEPARTMENT_MAX_LEADERS_DEFAULT);
}

export function normalizeDepartmentMaxEmployees(value: unknown): number {
  return normalizeDepartmentCapacity(value, DEPARTMENT_MAX_EMPLOYEES_DEFAULT);
}
