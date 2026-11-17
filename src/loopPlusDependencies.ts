/**
 * Reads an explicit same-parent Loop+ dependency list. Missing fields are
 * compatible with legacy decisions and records; malformed values are rejected.
 */
export function readLoopPlusDependsOn(value: unknown, subtaskId: string): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const dependencies: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    const dependencyId = item.trim();
    if (!dependencyId || dependencyId === subtaskId || seen.has(dependencyId)) {
      return null;
    }
    seen.add(dependencyId);
    dependencies.push(dependencyId);
  }
  return dependencies;
}
