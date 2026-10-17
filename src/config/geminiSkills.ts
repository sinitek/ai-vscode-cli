import { OpenCodeSkillToggle } from "./types";
import { isPlainObject, parseJsonObjectText } from "../shared/jsonObject";

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
