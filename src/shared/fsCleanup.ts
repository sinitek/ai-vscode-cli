import * as fs from "fs";

export type RemovePathBestEffortOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
};

function defaultMaxRetries(): number {
  return process.platform === "win32" ? 10 : 2;
}

function defaultRetryDelayMs(): number {
  return process.platform === "win32" ? 75 : 100;
}

export function removePathBestEffort(
  targetPath: string,
  options: RemovePathBestEffortOptions = {},
): boolean {
  const normalized = String(targetPath || "").trim();
  if (!normalized) {
    return true;
  }
  try {
    fs.rmSync(normalized, {
      recursive: true,
      force: true,
      maxRetries: options.maxRetries ?? defaultMaxRetries(),
      retryDelay: options.retryDelayMs ?? defaultRetryDelayMs(),
    });
    return true;
  } catch {
    return false;
  }
}

export function removeEmptyDirBestEffort(targetPath: string): boolean {
  const normalized = String(targetPath || "").trim();
  if (!normalized) {
    return true;
  }
  try {
    fs.rmdirSync(normalized);
    return true;
  } catch {
    return false;
  }
}
