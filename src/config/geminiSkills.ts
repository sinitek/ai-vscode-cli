import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OpenCodeSkillItem, OpenCodeSkillToggle } from "./types";
import { t } from "../i18n";
import { isPlainObject, parseJsonObjectText } from "../shared/jsonObject";

const HOME_OPENCODE_SKILLS_DIR = path.join(os.homedir(), ".opencode", "skills");
const SYSTEM_OPENCODE_SKILLS_DIR = path.join(path.sep, "etc", "opencode", "skills");
const WORKSPACE_OPENCODE_SKILLS_RELATIVE_DIR = path.join(".opencode", "skills");

function parseOpenCodeConfig(content: string): Record<string, unknown> {
  const parsed = parseJsonObjectText(content, {
    mode: "strict",
    rootErrorMessage: "OpenCode config must be a JSON object.",
  });
  return { ...parsed };
}

function normalizeSkillName(name: string): string {
  return String(name ?? "").trim();
}

function normalizeWorkspaceRoots(workspaceRoots: string[] | undefined): string[] {
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

function collectAncestorDirs(startPath: string): string[] {
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

function resolveOpenCodeSkillRoots(workspaceRoots: string[] | undefined): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  const append = (candidate: string | undefined): void => {
    if (!candidate) {
      return;
    }
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    roots.push(normalized);
  };

  normalizeWorkspaceRoots(workspaceRoots).forEach((workspaceRoot) => {
    collectAncestorDirs(workspaceRoot).forEach((ancestor) => {
      append(path.join(ancestor, WORKSPACE_OPENCODE_SKILLS_RELATIVE_DIR));
    });
  });

  append(HOME_OPENCODE_SKILLS_DIR);
  append(SYSTEM_OPENCODE_SKILLS_DIR);

  return roots;
}

async function listSkillDirNames(skillRoot: string): Promise<string[]> {
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

function extractSkillDescription(content: string): string | undefined {
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
    if (trimmed.startsWith("description:")) {
      const raw = trimmed.slice("description:".length).trim();
      const unquoted = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      const description = unquoted.trim();
      if (description) {
        return description;
      }
    }
  }
  return undefined;
}

function toShortDescription(description?: string): string {
  const normalized = (description ?? "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return t("skill.descriptionMissing");
}

function normalizeDisabledSkills(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildManagedSkillNameSet(skills: OpenCodeSkillToggle[] | undefined): Set<string> {
  const managed = new Set<string>();
  (skills ?? []).forEach((skill) => {
    const name = normalizeSkillName(skill?.name ?? "");
    if (name) {
      managed.add(name);
    }
  });
  return managed;
}

function removeManagedDisabledSkills(disabledSkills: string[], managedSkillNames: Set<string>): string[] {
  if (managedSkillNames.size === 0) {
    return [...disabledSkills];
  }
  return disabledSkills.filter((item) => !managedSkillNames.has(item.trim()));
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  items.forEach((item) => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function applyManagedSkillsSettings(
  settings: Record<string, unknown>,
  skills: OpenCodeSkillToggle[] | undefined
): Record<string, unknown> {
  const managedSkillNames = buildManagedSkillNameSet(skills);
  const disabledManagedSkills = (skills ?? [])
    .filter((skill) => skill?.enabled === false)
    .map((skill) => normalizeSkillName(skill.name))
    .filter((name) => Boolean(name));

  const nextSettings: Record<string, unknown> = { ...settings };
  const currentSkills = isPlainObject(nextSettings.skills)
    ? { ...(nextSettings.skills as Record<string, unknown>) }
    : {};

  const existingDisabledSkills = normalizeDisabledSkills(currentSkills.disabled);
  const baseDisabledSkills = removeManagedDisabledSkills(existingDisabledSkills, managedSkillNames);
  const mergedDisabledSkills = dedupeStrings([...baseDisabledSkills, ...disabledManagedSkills]);

  currentSkills.enabled = true;
  if (mergedDisabledSkills.length > 0) {
    currentSkills.disabled = mergedDisabledSkills;
  } else {
    delete currentSkills.disabled;
  }

  if (Object.keys(currentSkills).length > 0) {
    nextSettings.skills = currentSkills;
  } else {
    delete nextSettings.skills;
  }

  return nextSettings;
}

export function mergeOpenCodeSkillsConfig(
  baseConfig: string,
  skills: OpenCodeSkillToggle[] | undefined
): string {
  const settings = parseOpenCodeConfig(baseConfig ?? "{}");
  const nextSettings = applyManagedSkillsSettings(settings, skills);
  return JSON.stringify(nextSettings, null, 2);
}

export function stripManagedOpenCodeSkillRules(
  content: string | undefined,
  skills: OpenCodeSkillToggle[] | undefined
): string {
  try {
    const settings = parseOpenCodeConfig(content ?? "{}");
    const managedSkillNames = buildManagedSkillNameSet(skills);
    if (managedSkillNames.size === 0) {
      return JSON.stringify(settings);
    }

    const nextSettings: Record<string, unknown> = { ...settings };
    const currentSkills = isPlainObject(nextSettings.skills)
      ? { ...(nextSettings.skills as Record<string, unknown>) }
      : null;
    if (!currentSkills) {
      return JSON.stringify(nextSettings);
    }

    if (currentSkills.enabled === true) {
      delete currentSkills.enabled;
    }

    const nextDisabledSkills = removeManagedDisabledSkills(
      normalizeDisabledSkills(currentSkills.disabled),
      managedSkillNames
    );
    if (nextDisabledSkills.length > 0) {
      currentSkills.disabled = nextDisabledSkills;
    } else {
      delete currentSkills.disabled;
    }

    if (Object.keys(currentSkills).length > 0) {
      nextSettings.skills = currentSkills;
    } else {
      delete nextSettings.skills;
    }

    return JSON.stringify(nextSettings);
  } catch {
    return (content ?? "").trim();
  }
}

export async function listOpenCodeSkills(workspaceRoots?: string[]): Promise<OpenCodeSkillItem[]> {
  const skillRoots = resolveOpenCodeSkillRoots(workspaceRoots);
  const skillsByName = new Map<string, OpenCodeSkillItem>();

  for (const skillRoot of skillRoots) {
    const dirs = await listSkillDirNames(skillRoot);
    for (const name of dirs) {
      if (skillsByName.has(name)) {
        continue;
      }
      const skillPath = path.join(skillRoot, name);
      try {
        const skillFile = path.join(skillPath, "SKILL.md");
        await fs.promises.access(skillFile);
        const content = await fs.promises.readFile(skillFile, "utf-8");
        const description = toShortDescription(extractSkillDescription(content));
        skillsByName.set(name, { name, path: skillPath, description });
      } catch {
        // Ignore non-skill directories.
      }
    }
  }

  const skills = [...skillsByName.values()];
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}
