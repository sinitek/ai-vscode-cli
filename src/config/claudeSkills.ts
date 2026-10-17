import { ClaudeSkillToggle } from "./types";
import { isPlainObject, parseJsonObjectText } from "../shared/jsonObject";

function parseClaudeSettings(content: string): Record<string, unknown> {
  const parsed = parseJsonObjectText(content, {
    mode: "strict",
    rootErrorMessage: "Claude settings must be a JSON object.",
  });
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
