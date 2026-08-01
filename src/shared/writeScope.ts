export function normalizeWriteFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => normalizeWriteFilePath(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

export function normalizeConflictGroup(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

export function writeFilePathsOverlap(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return isPathAncestor(left, right) || isPathAncestor(right, left);
}

function normalizeWriteFilePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/\.\//g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
  return normalized || null;
}

function isPathAncestor(parent: string, child: string): boolean {
  return Boolean(parent && child.startsWith(`${parent}/`));
}
