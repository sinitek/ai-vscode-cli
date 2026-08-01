export const PATH_SEGMENT_REPLACEMENT_PATTERN = /[^a-zA-Z0-9_.-]/g;

export function sanitizePathSegment(value: unknown, fallback: string): string {
  const normalized = String(value ?? "").trim().replace(PATH_SEGMENT_REPLACEMENT_PATTERN, "_");
  return normalized || fallback;
}
