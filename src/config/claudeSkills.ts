import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ClaudeSkillItem, ClaudeSkillToggle } from "./types";
import { t } from "../i18n";

const CLAUDE_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function parseClaudeSettings(content: string): Record<string, unknown> {
  const normalized = (content ?? "").trim();
  if (!normalized) {
    return {};
  }
  const parsed = JSON.parse(normalized) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("Claude settings must be a JSON object.");
  }
  return { ...parsed };
}

function normalizeSkillName(name: string): string {
  return String(name ?? "").trim();
}

function buildSkillRule(name: string): string {
  return `Skill(${normalizeSkillName(name)})`;
}

function buildManagedRuleSet(skills: ClaudeSkillToggle[] | undefined): Set<string> {
  const rules = new Set<string>();
  (skills ?? []).forEach((skill) => {
    const name = normalizeSkillName(skill?.name ?? "");
    if (name) {
      rules.add(buildSkillRule(name));
    }
  });
  return rules;
}

function normalizeDenyRules(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function removeManagedRules(rules: string[], managedRuleSet: Set<string>): string[] {
  if (managedRuleSet.size === 0) {
    return [...rules];
  }
  return rules.filter((rule) => !managedRuleSet.has(rule.trim()));
}

function dedupeRules(rules: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  rules.forEach((rule) => {
    const normalized = rule.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function applyManagedRulesToSettings(
  settings: Record<string, unknown>,
  skills: ClaudeSkillToggle[] | undefined
): Record<string, unknown> {
  const managedRuleSet = buildManagedRuleSet(skills);
  const disabledRules = (skills ?? [])
    .filter((skill) => skill?.enabled === false)
    .map((skill) => buildSkillRule(skill.name));

  const nextSettings: Record<string, unknown> = { ...settings };
  const currentPermissions = isPlainObject(nextSettings.permissions)
    ? { ...(nextSettings.permissions as Record<string, unknown>) }
    : {};

  const existingDenyRules = normalizeDenyRules(currentPermissions.deny);
  const baseDenyRules = removeManagedRules(existingDenyRules, managedRuleSet);
  const mergedDenyRules = dedupeRules([...baseDenyRules, ...disabledRules]);

  if (mergedDenyRules.length > 0) {
    currentPermissions.deny = mergedDenyRules;
  } else {
    delete currentPermissions.deny;
  }

  if (Object.keys(currentPermissions).length > 0) {
    nextSettings.permissions = currentPermissions;
  } else {
    delete nextSettings.permissions;
  }

  return nextSettings;
}

export function mergeClaudeSkillsConfig(
  baseConfig: string,
  skills: ClaudeSkillToggle[] | undefined
): string {
  const settings = parseClaudeSettings(baseConfig ?? "{}");
  const nextSettings = applyManagedRulesToSettings(settings, skills);
  return JSON.stringify(nextSettings, null, 2);
}

export function stripManagedClaudeSkillRules(
  content: string | undefined,
  skills: ClaudeSkillToggle[] | undefined
): string {
  try {
    const settings = parseClaudeSettings(content ?? "{}");
    const managedRuleSet = buildManagedRuleSet(skills);
    if (managedRuleSet.size === 0) {
      return JSON.stringify(settings);
    }

    const nextSettings: Record<string, unknown> = { ...settings };
    const currentPermissions = isPlainObject(nextSettings.permissions)
      ? { ...(nextSettings.permissions as Record<string, unknown>) }
      : {};
    const nextDenyRules = removeManagedRules(normalizeDenyRules(currentPermissions.deny), managedRuleSet);

    if (nextDenyRules.length > 0) {
      currentPermissions.deny = nextDenyRules;
    } else {
      delete currentPermissions.deny;
    }

    if (Object.keys(currentPermissions).length > 0) {
      nextSettings.permissions = currentPermissions;
    } else {
      delete nextSettings.permissions;
    }

    return JSON.stringify(nextSettings);
  } catch {
    return (content ?? "").trim();
  }
}

export async function listClaudeSkills(): Promise<ClaudeSkillItem[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(CLAUDE_SKILLS_DIR, { withFileTypes: true });
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
      const linkTargetStat = await fs.promises.stat(path.join(CLAUDE_SKILLS_DIR, entry.name));
      if (linkTargetStat.isDirectory()) {
        dirs.push(entry.name);
      }
    } catch {
      // Ignore broken symlinks.
    }
  }

  const skills: ClaudeSkillItem[] = [];
  for (const name of dirs) {
    const skillPath = path.join(CLAUDE_SKILLS_DIR, name);
    try {
      const skillFile = path.join(skillPath, "SKILL.md");
      await fs.promises.access(skillFile);
      const content = await fs.promises.readFile(skillFile, "utf-8");
      const description = toShortDescription(extractSkillDescription(content));
      skills.push({
        name,
        path: skillPath,
        description,
      });
    } catch {
      // Ignore non-skill directories.
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}
