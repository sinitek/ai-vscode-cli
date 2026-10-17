import * as fs from "fs";
import * as path from "path";
import { CodexSkillItem, GrokSkillSource, GrokSkillToggle } from "./types";
import { t } from "../i18n";
import { resolveGrokHomeDir } from "../shared/userHomePaths";
import { isGrokTomlTable, parseGrokToml, serializeGrokToml, type GrokTomlTable } from "./grokToml";
import {
  extractSkillDescription,
  listSkillDirNames,
  normalizeWorkspaceRoots,
  skillDescriptionStrategies,
} from "./skillDiscovery";

const WORKSPACE_GROK_SKILLS_RELATIVE_DIR = path.join(".grok", "skills");

export type GrokSkillItem = CodexSkillItem & {
  source?: GrokSkillSource;
};

export type GrokOfficialSkillItem = GrokSkillItem & {
  id: string;
  source: "bundled";
  canInstall: false;
  canUpdate: false;
  canUninstall: false;
};

export type MergeGrokSkillsConfigResult =
  | { ok: true; content: string }
  | { ok: false; error: string; content: string };

function toShortDescription(description?: string): string {
  const normalized = (description ?? "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return t("skill.descriptionMissing");
}

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

function userSkillsDir(): string {
  return path.join(resolveGrokHomeDir(), "skills");
}

function bundledSkillsDir(): string {
  return path.join(resolveGrokHomeDir(), "bundled", "skills");
}

function projectSkillRoots(workspaceRoots: string[] | undefined): string[] {
  return normalizeWorkspaceRoots(workspaceRoots).map((workspaceRoot) =>
    path.join(workspaceRoot, WORKSPACE_GROK_SKILLS_RELATIVE_DIR),
  );
}

async function readSkillItem(
  skillRoot: string,
  name: string,
  source?: GrokSkillSource,
): Promise<GrokSkillItem | null> {
  const skillPath = path.join(skillRoot, name);
  try {
    const content = await fs.promises.readFile(path.join(skillPath, "SKILL.md"), "utf8");
    const item: GrokSkillItem = {
      name,
      path: skillPath,
      description: toShortDescription(
        extractSkillDescription(content, skillDescriptionStrategies.stopAtFirstKey),
      ),
    };
    if (source) {
      item.source = source;
    }
    return item;
  } catch {
    return null;
  }
}

async function collectSkills(
  skillRoot: string,
  source: GrokSkillSource | undefined,
  skillsByName: Map<string, GrokSkillItem>,
): Promise<void> {
  const names = await listSkillDirNames(skillRoot);
  for (const name of names) {
    if (skillsByName.has(name)) {
      continue;
    }
    const item = await readSkillItem(skillRoot, name, source);
    if (item) {
      skillsByName.set(name, item);
    }
  }
}

export async function listGrokSkills(workspaceRoots?: string[]): Promise<GrokSkillItem[]> {
  const skillsByName = new Map<string, GrokSkillItem>();
  for (const skillRoot of projectSkillRoots(workspaceRoots)) {
    await collectSkills(skillRoot, undefined, skillsByName);
  }
  await collectSkills(userSkillsDir(), undefined, skillsByName);
  await collectSkills(bundledSkillsDir(), "bundled", skillsByName);
  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function listGrokOfficialSkills(): Promise<GrokOfficialSkillItem[]> {
  const names = await listSkillDirNames(bundledSkillsDir());
  const items: GrokOfficialSkillItem[] = [];
  for (const name of names) {
    const item = await readSkillItem(bundledSkillsDir(), name, "bundled");
    if (!item) {
      continue;
    }
    items.push({
      ...item,
      id: item.name,
      source: "bundled",
      canInstall: false,
      canUpdate: false,
      canUninstall: false,
    });
  }
  return items.sort((left, right) => left.name.localeCompare(right.name));
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
