import { GrokSkillToggle } from "./types";
import { isGrokTomlTable, parseGrokToml, serializeGrokToml, type GrokTomlTable } from "./grokToml";

export type MergeGrokSkillsConfigResult =
  | { ok: true; content: string }
  | { ok: false; error: string; content: string };

function normalizeSkillName(name: string): string {
  return String(name ?? "").trim();
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

function readDisabledNames(skillsTable: GrokTomlTable): string[] {
  const value = skillsTable.disabled;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function mergeGrokSkillsConfig(
  content: string,
  skills: GrokSkillToggle[] | undefined,
): MergeGrokSkillsConfigResult {
  const original = content ?? "";
  const parsed = parseGrokToml(original);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, content: original };
  }
  if (parsed.value.skills !== undefined && !isGrokTomlTable(parsed.value.skills)) {
    return { ok: false, error: "skills 必须是表。", content: original };
  }

  const skillsTable: GrokTomlTable = isGrokTomlTable(parsed.value.skills) ? { ...parsed.value.skills } : {};
  const managedNames = new Set<string>();
  const disabledManaged: string[] = [];
  (skills ?? []).forEach((skill) => {
    const name = normalizeSkillName(skill?.name ?? "");
    if (!name) {
      return;
    }
    managedNames.add(name);
    if (skill.enabled === false) {
      disabledManaged.push(name);
    }
  });
  const preserved = readDisabledNames(skillsTable).filter((name) => !managedNames.has(name));
  const disabled = dedupeStrings([...preserved, ...disabledManaged]);
  if (disabled.length > 0) {
    skillsTable.disabled = disabled;
  } else {
    delete skillsTable.disabled;
  }
  if (Object.keys(skillsTable).length > 0) {
    parsed.value.skills = skillsTable;
  } else {
    delete parsed.value.skills;
  }

  const serialized = serializeGrokToml(parsed.value);
  if (!serialized.ok) {
    return { ok: false, error: serialized.error, content: original };
  }
  return { ok: true, content: serialized.content };
}
