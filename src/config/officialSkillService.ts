import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

import {
  OfficialSkillCatalog,
  OfficialSkillCatalogItem,
  OfficialSkillInstallResult,
  OfficialSkillPlatform,
} from "./types";
import {
  buildResolvedOfficialSkillCatalogItem,
  computeOfficialSkillContentHash,
  readOfficialSkillMetadata,
  resolveOfficialSkillInstallState,
  writeOfficialSkillMetadata,
} from "./officialSkillVersioning";

const OFFICIAL_SKILL_CATALOG_PATH = path.join(__dirname, "..", "..", "media", "official_skills_catalog.json");
const OFFICIAL_SKILL_ASSETS_ROOT = path.join(__dirname, "..", "..", "media");
const OFFICIAL_CLAUDE_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");
const OFFICIAL_CODEX_SKILLS_DIR = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills");
const OFFICIAL_OPENCODE_SKILLS_DIR = path.join(os.homedir(), ".opencode", "skills");
const ZIP_EXTRACTION_TIMEOUT_MS = 120 * 1000;

type CurrentOfficialSkillPlatform = OfficialSkillPlatform;
type CurrentOfficialSkillCatalogItem = Omit<OfficialSkillCatalogItem, "platform"> & {
  platform: CurrentOfficialSkillPlatform;
};

function t(key: string, params?: Record<string, string>): string {
  return require("../i18n").t(key, params) as string;
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function isOfficialSkillPlatform(value: string): value is OfficialSkillPlatform {
  return value === "claude" || value === "codex" || value === "opencode";
}

async function readOfficialSkillsCatalogFile(): Promise<OfficialSkillCatalog> {
  try {
    const content = await fs.readFile(OFFICIAL_SKILL_CATALOG_PATH, "utf-8");
    const parsed = JSON.parse(content) as OfficialSkillCatalog;
    if (!parsed || !Array.isArray(parsed.skills)) {
      throw new Error("invalid catalog");
    }
    return parsed;
  } catch {
    throw new Error(t("skill.catalogMissing"));
  }
}

export function resolveOfficialSkillInstallRoot(platform: OfficialSkillPlatform): string {
  if (platform === "claude") {
    return OFFICIAL_CLAUDE_SKILLS_DIR;
  }
  if (platform === "opencode") {
    return OFFICIAL_OPENCODE_SKILLS_DIR;
  }
  return OFFICIAL_CODEX_SKILLS_DIR;
}

export function getOfficialSkillTargetDir(
  item: Pick<OfficialSkillCatalogItem, "platform" | "installFolderName"> | Pick<CurrentOfficialSkillCatalogItem, "platform" | "installFolderName">,
): string {
  return path.join(resolveOfficialSkillInstallRoot(item.platform), item.installFolderName);
}

async function resolveOfficialSkillCatalogItemState(
  item: OfficialSkillCatalogItem,
): Promise<OfficialSkillCatalogItem> {
  const targetDir = getOfficialSkillTargetDir(item);
  if (!(await pathExists(targetDir))) {
    return {
      ...item,
      installed: false,
      installedPath: targetDir,
      installState: "not_installed",
      canInstall: true,
      canUpdate: false,
      canUninstall: false,
    };
  }

  const metadata = await readOfficialSkillMetadata(targetDir);
  const computedInstalledContentHash = metadata ? await computeOfficialSkillContentHash(targetDir) : undefined;
  const resolvedState = resolveOfficialSkillInstallState({
    item,
    targetDir,
    metadata,
    computedInstalledContentHash,
  });

  return buildResolvedOfficialSkillCatalogItem(item, resolvedState);
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runUtilityCommand(
  command: string,
  args: string[],
  label: string,
  timeoutMs = ZIP_EXTRACTION_TIMEOUT_MS,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      const details = stderr.trim() || stdout.trim() || `${label} exited with code ${code}.`;
      reject(new Error(details));
    });
  });
}

function isMissingCommandError(error: unknown, commandName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`spawn ${commandName} ENOENT`) || message.includes(`'${commandName}' is not recognized`);
}

async function extractZipArchive(zipPath: string, destinationDir: string): Promise<void> {
  if (process.platform === "win32") {
    try {
      await runUtilityCommand(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath ${quotePowerShellLiteral(zipPath)} -DestinationPath ${quotePowerShellLiteral(destinationDir)} -Force`,
        ],
        "Expand-Archive",
      );
      return;
    } catch (error) {
      if (!isMissingCommandError(error, "powershell.exe")) {
        throw error;
      }
    }
  } else {
    try {
      await runUtilityCommand("unzip", ["-oq", zipPath, "-d", destinationDir], "unzip");
      return;
    } catch (error) {
      if (!isMissingCommandError(error, "unzip")) {
        throw error;
      }
    }
  }

  const pythonScript = [
    "import sys, zipfile",
    "zip_path, output_dir = sys.argv[1], sys.argv[2]",
    "with zipfile.ZipFile(zip_path) as archive:",
    "    archive.extractall(output_dir)",
  ].join("\n");

  for (const pythonCommand of ["python3", "python"]) {
    try {
      await runUtilityCommand(pythonCommand, ["-c", pythonScript, zipPath, destinationDir], pythonCommand);
      return;
    } catch (error) {
      if (!isMissingCommandError(error, pythonCommand)) {
        throw error;
      }
    }
  }

  throw new Error(t("skill.installZipToolMissing"));
}

async function moveDirectory(sourceDir: string, targetDir: string): Promise<void> {
  try {
    await fs.rename(sourceDir, targetDir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== "EXDEV") {
      throw error;
    }
    await fs.cp(sourceDir, targetDir, { recursive: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
}

async function findExtractedArchiveDir(tempRoot: string): Promise<string | null> {
  const entries = await fs.readdir(tempRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(tempRoot, entry.name));
  if (dirs.length !== 1) {
    return null;
  }
  return dirs[0];
}

export function getOfficialArchiveValidationFile(item: Pick<OfficialSkillCatalogItem, "platform">): string {
  return "SKILL.md";
}

async function installBundledOfficialSkill(
  item: OfficialSkillCatalogItem,
  options?: { overwrite?: boolean },
): Promise<OfficialSkillInstallResult> {
  const archivePath = path.join(OFFICIAL_SKILL_ASSETS_ROOT, item.archivePath);
  if (!(await pathExists(archivePath))) {
    throw new Error(t("skill.installAssetMissing", { path: archivePath }));
  }

  const targetDir = getOfficialSkillTargetDir(item);
  const targetExists = await pathExists(targetDir);
  if (targetExists && !options?.overwrite) {
    throw new Error(t("skill.installAlreadyExists", { path: targetDir }));
  }
  if (!targetExists && options?.overwrite) {
    throw new Error(t("skill.updateNotInstalled", { path: targetDir }));
  }

  await ensureDir(path.dirname(targetDir));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `sinitek-skill-${item.platform}-`));
  const backupDir = path.join(tempRoot, `${item.installFolderName}-backup`);
  try {
    await extractZipArchive(archivePath, tempRoot);
    const extractedDir = await findExtractedArchiveDir(tempRoot);
    if (!extractedDir) {
      throw new Error(t("skill.installArchiveInvalid"));
    }
    const validationFile = path.join(extractedDir, getOfficialArchiveValidationFile(item));
    if (!(await pathExists(validationFile))) {
      throw new Error(t("skill.installArchiveInvalid"));
    }
    await writeOfficialSkillMetadata(extractedDir, item);

    if (targetExists) {
      await moveDirectory(targetDir, backupDir);
    }

    try {
      await moveDirectory(extractedDir, targetDir);
    } catch (error) {
      if (await pathExists(backupDir)) {
        await moveDirectory(backupDir, targetDir);
      }
      throw error;
    }

    await fs.rm(backupDir, { recursive: true, force: true });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return {
    platform: item.platform,
    skillId: item.id,
    skillName: item.name,
    targetDir,
    action: options?.overwrite ? "update" : "install",
  };
}

async function uninstallBundledOfficialSkill(
  item: OfficialSkillCatalogItem,
): Promise<OfficialSkillInstallResult> {
  const targetDir = getOfficialSkillTargetDir(item);
  if (!(await pathExists(targetDir))) {
    throw new Error(t("skill.uninstallMissing", { path: targetDir }));
  }
  await fs.rm(targetDir, { recursive: true, force: true });
  return {
    platform: item.platform,
    skillId: item.id,
    skillName: item.name,
    targetDir,
    action: "uninstall",
  };
}

export async function getOfficialSkillsCatalog(
  platform: OfficialSkillPlatform | "opencode",
): Promise<OfficialSkillCatalogItem[]> {
  if (!isOfficialSkillPlatform(platform)) {
    throw new Error(t("skill.installUnsupportedPlatform"));
  }
  const catalog = await readOfficialSkillsCatalogFile();
  const items = catalog.skills
    .filter((item) => item.platform === platform)
    .sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(items.map((item) => resolveOfficialSkillCatalogItemState(item)));
}

async function getOfficialSkillCatalogEntry(
  platform: OfficialSkillPlatform | "opencode",
  skillId: string,
): Promise<OfficialSkillCatalogItem> {
  if (!isOfficialSkillPlatform(platform)) {
    throw new Error(t("skill.installUnsupportedPlatform"));
  }
  const catalog = await readOfficialSkillsCatalogFile();
  const item = catalog.skills.find((entry) => entry.platform === platform && entry.id === skillId);
  if (!item) {
    throw new Error(t("skill.catalogMissing"));
  }
  return item;
}

export async function installOfficialSkill(
  platform: OfficialSkillPlatform | "opencode",
  skillId: string,
): Promise<OfficialSkillInstallResult> {
  const item = await getOfficialSkillCatalogEntry(platform, skillId);
  return installBundledOfficialSkill(item);
}

export async function updateOfficialSkill(
  platform: OfficialSkillPlatform | "opencode",
  skillId: string,
): Promise<OfficialSkillInstallResult> {
  const item = await getOfficialSkillCatalogEntry(platform, skillId);
  return installBundledOfficialSkill(item, { overwrite: true });
}

export async function uninstallOfficialSkill(
  platform: OfficialSkillPlatform | "opencode",
  skillId: string,
): Promise<OfficialSkillInstallResult> {
  const item = await getOfficialSkillCatalogEntry(platform, skillId);
  return uninstallBundledOfficialSkill(item);
}
