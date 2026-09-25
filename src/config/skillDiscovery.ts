import * as fs from "fs";
import * as path from "path";

export const skillDescriptionStrategies = {
  stopAtFirstKey: "stop-at-first-key",
  continueOnEmpty: "continue-on-empty",
} as const;

export type SkillDescriptionStrategy =
  (typeof skillDescriptionStrategies)[keyof typeof skillDescriptionStrategies];

export function normalizeWorkspaceRoots(workspaceRoots: string[] | undefined): string[] {
  if (!Array.isArray(workspaceRoots)) {
    return [];
  }
  const unique = new Set<string>();
  workspaceRoots.forEach((root) => {
    if (typeof root !== "string") {
      return;
    }
    const normalized = root.trim();
    if (!normalized) {
      return;
    }
    unique.add(path.resolve(normalized));
  });
  return [...unique];
}

export function collectAncestorDirs(startPath: string): string[] {
  const output: string[] = [];
  let current = path.resolve(startPath);
  while (true) {
    output.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return output;
}

export async function listSkillDirNames(skillRoot: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(skillRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isDirectory()) {
      dirs.push(entry.name);
      continue;
    }
    if (!entry.isSymbolicLink()) {
      continue;
    }
    try {
      const linkTargetStat = await fs.promises.stat(path.join(skillRoot, entry.name));
      if (linkTargetStat.isDirectory()) {
        dirs.push(entry.name);
      }
    } catch {
      // Ignore broken symlinks.
    }
  }

  return dirs;
}

export function extractSkillDescription(
  content: string,
  strategy: SkillDescriptionStrategy,
): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!match) {
    return undefined;
  }
  const lines = match[1].split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!trimmed.startsWith("description:")) {
      continue;
    }
    const raw = trimmed.slice("description:".length).trim();
    const unquoted = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    const description = unquoted.trim();
    switch (strategy) {
      case skillDescriptionStrategies.stopAtFirstKey:
        return description || undefined;
      case skillDescriptionStrategies.continueOnEmpty:
        if (description) {
          return description;
        }
        break;
      default: {
        const unexpected: never = strategy;
        throw new Error(`Unexpected skill description strategy: ${String(unexpected)}`);
      }
    }
  }
  return undefined;
}
