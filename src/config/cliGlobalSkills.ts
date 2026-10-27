import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { t } from "../i18n";
import {
  formatHomeDisplayPath,
  resolveClaudeHomeDir,
  resolveCodexHomeDir,
  resolveDshGlobalSkillsDirectory,
  resolveGrokHomeDir,
  resolveKimiCodeHomeDir,
  resolveXdgConfigHome,
} from "../shared/userHomePaths";
import {
  extractSkillDescription,
  listSkillDirNames,
  skillDescriptionStrategies,
} from "./skillDiscovery";

export const CLI_GLOBAL_SKILL_PLATFORMS = ["claude", "codex", "opencode", "grok", "dsh", "kimi-code"] as const;

export type CliGlobalSkillPlatform = (typeof CLI_GLOBAL_SKILL_PLATFORMS)[number];

export const DSH_UNSUPPORTED_CAPABILITIES = {
  explicitSkillsApi: "DSH ACP has no explicit skills method. Global skills are directories under <DSH_HOME>/skills.",
  nativeCompaction: "DSH ACP compactSession is not supported. Sending /compact is not a proven native compaction trigger.",
} as const;

export function readDshUnsupportedCapability(
  name: keyof typeof DSH_UNSUPPORTED_CAPABILITIES,
): { supported: false; reason: string } {
  return { supported: false, reason: DSH_UNSUPPORTED_CAPABILITIES[name] };
}

const SECRET_ENV_KEY = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i;

export type CliGlobalSkillSummary = {
  name: string;
  path: string;
  description?: string;
};

export type CliGlobalSkillsSnapshot = {
  directory: string;
  displayDirectory: string;
  skills: CliGlobalSkillSummary[];
};

function redactSkillDiagnostic(message: string): string {
  let redacted = message;
  const values: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 8 || !SECRET_ENV_KEY.test(key)) {
      continue;
    }
    values.push(value);
  }
  values.sort((left, right) => right.length - left.length);
  for (const value of values) {
    redacted = redacted.split(value).join("[redacted]");
  }
  return redacted.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : t("common.unknownError");
  return redactSkillDiagnostic(message);
}

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function isCliGlobalSkillPlatform(platform: unknown): platform is CliGlobalSkillPlatform {
  return typeof platform === "string"
    && (CLI_GLOBAL_SKILL_PLATFORMS as readonly string[]).includes(platform);
}

function assertPlatform(platform: unknown): CliGlobalSkillPlatform {
  if (isCliGlobalSkillPlatform(platform)) {
    return platform;
  }
  throw new Error(t("skill.global.invalidPlatform"));
}

function assertSkillName(name: unknown): string {
  if (typeof name !== "string" || name.length === 0 || name.trim().length === 0) {
    throw new Error(t("skill.global.invalidName"));
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name === "." || name === "..") {
    throw new Error(t("skill.global.invalidName"));
  }
  return name;
}

export function resolveCliGlobalSkillsDirectory(platform: CliGlobalSkillPlatform): string {
  switch (platform) {
    case "claude":
      return path.join(resolveClaudeHomeDir(), "skills");
    case "opencode":
      return path.join(resolveXdgConfigHome(), "opencode", "skills");
    case "grok":
      return path.join(resolveGrokHomeDir(), "skills");
    case "dsh":
      return resolveDshGlobalSkillsDirectory();
    case "kimi-code":
      // 官方 CLI 的用户级技能目录：<KIMI_CODE_HOME>/skills（默认 ~/.kimi-code/skills）。
      return path.join(resolveKimiCodeHomeDir(), "skills");
    case "codex":
      return path.join(resolveCodexHomeDir(), "skills");
    default: {
      const unexpected: never = platform;
      void unexpected;
      throw new Error(t("skill.global.invalidPlatform"));
    }
  }
}

function toDisplayDirectory(directory: string): string {
  const relative = path.relative(os.homedir(), directory);
  if (!relative) {
    return formatHomeDisplayPath();
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return directory;
  }
  return formatHomeDisplayPath(...relative.split(path.sep).filter(Boolean));
}

function assertInsideDirectory(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(t("skill.global.invalidName"));
  }
}

async function hasSkillFile(skillDirectory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(skillDirectory, "SKILL.md"));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readDescription(skillDirectory: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
    const description = extractSkillDescription(content, skillDescriptionStrategies.continueOnEmpty);
    return description && description.trim() ? description.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function listSkillSummaries(directory: string): Promise<CliGlobalSkillSummary[]> {
  const names = await listSkillDirNames(directory);
  const skills: CliGlobalSkillSummary[] = [];
  for (const name of names) {
    const skillDirectory = path.join(directory, name);
    if (!(await hasSkillFile(skillDirectory))) {
      continue;
    }
    const description = await readDescription(skillDirectory);
    const skill: CliGlobalSkillSummary = {
      name,
      path: path.resolve(skillDirectory),
    };
    if (description) {
      skill.description = description;
    }
    skills.push(skill);
  }
  skills.sort((left, right) => left.name.localeCompare(right.name));
  return skills;
}

async function requireListedSkill(directory: string, name: string): Promise<string> {
  const skillPath = path.resolve(directory, name);
  assertInsideDirectory(directory, skillPath);
  const names = await listSkillDirNames(directory);
  if (!names.includes(name) || !(await hasSkillFile(skillPath))) {
    throw new Error(t("skill.global.notFound", { name }));
  }
  return skillPath;
}

export async function getCliSkillsList(platform: unknown): Promise<CliGlobalSkillsSnapshot> {
  const directory = path.resolve(resolveCliGlobalSkillsDirectory(assertPlatform(platform)));
  return {
    directory,
    displayDirectory: toDisplayDirectory(directory),
    skills: await listSkillSummaries(directory),
  };
}

export async function openCliSkillsDirectory(platform: unknown): Promise<string> {
  const directory = path.resolve(resolveCliGlobalSkillsDirectory(assertPlatform(platform)));
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function deleteCliSkill(platform: unknown, name: unknown): Promise<CliGlobalSkillsSnapshot> {
  const sourcePlatform = assertPlatform(platform);
  const directory = path.resolve(resolveCliGlobalSkillsDirectory(sourcePlatform));
  const skillName = assertSkillName(name);
  const skillPath = await requireListedSkill(directory, skillName);
  try {
    const stat = await fs.lstat(skillPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(skillPath);
    } else {
      await fs.rm(skillPath, { recursive: true, force: false });
    }
  } catch (error) {
    if (isEnoent(error)) {
      throw new Error(t("skill.global.notFound", { name: skillName }));
    }
    throw new Error(t("skill.global.deleteFailed", { error: errorMessage(error) }));
  }
  return getCliSkillsList(sourcePlatform);
}

export async function copyCliSkill(
  platform: unknown,
  name: unknown,
  targetPlatform: unknown,
): Promise<CliGlobalSkillsSnapshot> {
  const sourcePlatform = assertPlatform(platform);
  const destinationPlatform = assertPlatform(targetPlatform);
  if (sourcePlatform === destinationPlatform) {
    throw new Error(t("skill.global.samePlatform"));
  }
  const sourceDirectory = path.resolve(resolveCliGlobalSkillsDirectory(sourcePlatform));
  const skillName = assertSkillName(name);
  const sourcePath = await requireListedSkill(sourceDirectory, skillName);
  const targetDirectory = path.resolve(resolveCliGlobalSkillsDirectory(destinationPlatform));
  await fs.mkdir(targetDirectory, { recursive: true });
  const targetPath = path.resolve(targetDirectory, skillName);
  assertInsideDirectory(targetDirectory, targetPath);
  try {
    await fs.lstat(targetPath);
  } catch (error) {
    if (!isEnoent(error)) {
      throw new Error(t("skill.global.copyFailed", { error: errorMessage(error) }));
    }
    try {
      await fs.cp(sourcePath, targetPath, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
    } catch (copyError) {
      throw new Error(t("skill.global.copyFailed", { error: errorMessage(copyError) }));
    }
    return getCliSkillsList(sourcePlatform);
  }
  throw new Error(t("skill.global.targetExists", { name: skillName }));
}

async function assertNoSymlinks(directory: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(t("skill.market.symlinkRejected"));
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(path.join(directory, entry.name));
    }
  }
}

async function discardPath(targetPath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    await fs.unlink(targetPath);
    return;
  }
  await fs.rm(targetPath, { recursive: true, force: false });
}

async function replaceSkillDirectory(sourcePath: string, targetPath: string): Promise<void> {
  const backupPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.sinitek-replacing`);
  await discardPath(backupPath);
  let moved = false;
  try {
    await fs.rename(targetPath, backupPath);
    moved = true;
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }
  try {
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
  } catch (error) {
    await discardPath(targetPath);
    if (moved) {
      try {
        await fs.rename(backupPath, targetPath);
      } catch (restoreError) {
        throw new Error(`${errorMessage(error)}; ${errorMessage(restoreError)}`);
      }
    }
    throw error;
  }
  if (moved) {
    await discardPath(backupPath);
  }
}

export async function installCliSkillDirectory(
  platform: unknown,
  name: unknown,
  sourceDirectory: unknown,
): Promise<"installed"> {
  const destinationPlatform = assertPlatform(platform);
  const skillName = assertSkillName(name);
  if (typeof sourceDirectory !== "string" || sourceDirectory.trim().length === 0) {
    throw new Error(t("skill.market.installFailed", { error: t("skill.global.invalidName") }));
  }
  const sourcePath = path.resolve(sourceDirectory);
  let sourceStat;
  try {
    sourceStat = await fs.lstat(sourcePath);
  } catch (error) {
    throw new Error(t("skill.market.installFailed", { error: errorMessage(error) }));
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(t("skill.market.installFailed", { error: t("skill.global.invalidName") }));
  }
  const skillFile = path.join(sourcePath, "SKILL.md");
  let skillStat;
  try {
    skillStat = await fs.lstat(skillFile);
  } catch (error) {
    throw new Error(t("skill.market.installFailed", { error: errorMessage(error) }));
  }
  if (!skillStat.isFile()) {
    throw new Error(t("skill.global.notFound", { name: skillName }));
  }
  await assertNoSymlinks(sourcePath);
  const targetDirectory = path.resolve(resolveCliGlobalSkillsDirectory(destinationPlatform));
  await fs.mkdir(targetDirectory, { recursive: true });
  const targetPath = path.resolve(targetDirectory, skillName);
  assertInsideDirectory(targetDirectory, targetPath);
  try {
    await replaceSkillDirectory(sourcePath, targetPath);
  } catch (error) {
    throw new Error(t("skill.market.installFailed", { error: errorMessage(error) }));
  }
  return "installed";
}
